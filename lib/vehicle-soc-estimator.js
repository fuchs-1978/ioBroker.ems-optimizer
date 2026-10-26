'use strict';

// Cumulative AC energy is counted exactly once from a time-aligned vehicle
// report. Missing alignment/reset/session evidence never invents charged kWh.
function numeric(value) {
    return ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
        && Number.isFinite(Number(value)) ? Number(value) : null;
}
function sample(state, now, age, min, max) {
    const value = numeric(state?.val), ts = numeric(state?.ts);
    return state?.ack === true && !state.q && value !== null && value >= min && value <= max
        && ts !== null && ts > 0 && ts <= now + 1000 && now - ts <= age ? {value, ts} : null;
}
// A vehicle/cloud report is retained telemetry, not a fast electrical meter.
// Its age is diagnostic; it does not turn a known battery level into zero.
// A malformed value, command echo, bad quality or future timestamp still fails.
function reportedSocSample(reported, now) {
    const raw = sample(reported, now, Infinity, 0, 100);
    return {valid: Boolean(raw), value: raw?.value ?? null, timestamp: raw?.ts ?? 0,
        stale: Boolean(raw && now - raw.ts > 7200000),
        ageS: raw ? Math.max(0, Math.floor((now - raw.ts) / 1000)) : null};
}
function estimateSoc({now, reported, counter, car, measurementTime, measurementTimeConfigured = false,
    capacityKWh, efficiencyPct, signature, ledgerText = ''}) {
    const report = reportedSocSample(reported, now);
    const raw = report.valid ? {value: report.value, ts: report.timestamp} : null;
    const energy = sample(counter, now, 60000, 0, 1e9);
    const connection = sample(car, now, Infinity, 1, 4);
    let ledger;
    try { if (typeof ledgerText === 'string' && ledgerText.length <= 30000) ledger = JSON.parse(ledgerText); } catch { /* no retained basis */ }
    const sane = ledger?.version === 1 && ledger.signature === signature
        && Array.isArray(ledger.samples) && ledger.samples.length <= 256
        && ledger.samples.every(p => Array.isArray(p) && p.length === 2
            && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] > 0 && p[0] <= now + 1000 && p[1] >= 0)
        && ledger.samples.every((p, i) => i === 0 || p[0] > ledger.samples[i-1][0] && p[1] >= ledger.samples[i-1][1])
        && Number.isFinite(ledger.blockedAfter) && ledger.blockedAfter >= 0 && ledger.blockedAfter <= now + 1000
        && Number.isFinite(ledger.lastAt) && ledger.lastAt > 0 && ledger.lastAt <= now + 1000
        && (ledger.basis === null || ledger.basis && Number.isFinite(ledger.basis.soc)
            && ledger.basis.soc >= 0 && ledger.basis.soc <= 100
            && Number.isFinite(ledger.basis.kwh) && ledger.basis.kwh >= 0
            && Number.isFinite(ledger.basis.at) && ledger.basis.at > ledger.blockedAfter
            && Number.isFinite(ledger.basis.reportTs) && ledger.basis.reportTs > 0
            && ledger.basis.at <= now + 1000 && ledger.basis.reportTs <= now + 1000);
    if (!sane) ledger = {version: 1, signature, samples: [], basis: null, blockedAfter: 0, lastAt: now};
    const result = reason => {
        const held = ledger.lastEstimate;
        const retainEstimate = report.stale && held && held.reportTs === raw?.ts
            && Number.isFinite(held.value) && held.value >= raw.value && held.value <= 100
            && Number.isFinite(held.timestamp) && held.timestamp >= raw.ts && held.timestamp <= now + 1000;
        return {...report, value: retainEstimate ? held.value : report.value,
            timestamp: retainEstimate ? held.timestamp : report.timestamp,
            estimated: Boolean(retainEstimate), reason: retainEstimate ? `retained-estimate:${reason}` : reason,
            reported: raw?.value ?? null, ledger};
    };
    const capacity = numeric(capacityKWh), efficiency = numeric(efficiencyPct);
    if (capacity === null || capacity < 1 || capacity > 300 || efficiency === null || efficiency < 50 || efficiency > 99)
        return result('invalid-settings');
    if (!connection || ![2, 3, 4].includes(connection.value)) {
        ledger.basis = null; ledger.samples = []; ledger.blockedAfter = now; ledger.lastAt = now;
        return result('disconnected-or-unknown');
    }
    // A connection transition during an unobserved restart interval cannot
    // prove that the same vehicle/session remained connected.
    if (sane && numeric(car.lc) > ledger.lastAt) {
        ledger.basis = null; ledger.samples = []; ledger.blockedAfter = numeric(car.lc);
    }
    if (!raw || !energy) return result(!raw ? 'reported-soc-invalid' : 'energy-invalid-or-stale');
    const previous = ledger.samples.at(-1);
    if (previous && (energy.ts < previous[0] || energy.value < previous[1])) {
        ledger.basis = null; ledger.samples = []; ledger.blockedAfter = now;
    }
    const last = ledger.samples.at(-1);
    if (!last || energy.ts > last[0]) ledger.samples.push([energy.ts, energy.value]);
    else if (energy.value !== last[1]) return result('inconsistent-energy-sample');
    ledger.samples = ledger.samples.filter(p => now - p[0] <= 7200000).slice(-256);
    ledger.lastAt = now;
    let reportAt = raw.ts;
    if (measurementTimeConfigured) {
        const measured = sample(measurementTime, now, Infinity, 1, now + 1000);
        if (!measured || measured.value > raw.ts + 1000)
            return {...result('measurement-time-invalid'), valid: false, value: null, timestamp: 0};
        reportAt = measured.value;
    }
    if (!ledger.basis || raw.ts > ledger.basis.reportTs) {
        // Use a sample at/after the report, not energy already reflected in it.
        // A delayed report can use retained aligned samples, but never current
        // energy with an old report. Re-polls without a new measurement time do
        // not rebase a report which already has an explicit source timestamp.
        if (!ledger.basis || reportAt > ledger.basis.at
            || reportAt === ledger.basis.at && raw.value !== ledger.basis.soc) {
            const aligned = ledger.samples.find(p => p[0] >= reportAt && p[0] - reportAt <= 60000);
            const oldBasis = ledger.basis;
            const predict = kwh => oldBasis
                ? Math.min(100, oldBasis.soc + (kwh - oldBasis.kwh) * efficiency / capacity) : NaN;
            const agrees = (kwh, at) => oldBasis && now - oldBasis.at <= 7200000
                && at >= oldBasis.at && kwh >= oldBasis.kwh && kwh - oldBasis.kwh <= capacity * 1.5
                && Number.isInteger(raw.value) && Math.round(predict(kwh)) === raw.value;
            if (!aligned || reportAt <= ledger.blockedAfter) {
                // The report often arrives just before the next counter poll.
                // Preserve the still-valid matching estimate while awaiting it,
                // but do not refresh the anchor or manufacture missing energy.
                const awaitingCounter = !aligned && reportAt > ledger.blockedAfter
                    && reportAt > energy.ts && reportAt - energy.ts <= 60000
                    && agrees(energy.value, energy.ts);
                if (!awaitingCounter) return result('waiting-for-aligned-report');
            } else {
                // Preserve fractional progress only for a report which agrees
                // at its own time. A true disagreement, including a lower
                // arrival SoC, remains an authoritative correction.
                ledger.basis = {soc: agrees(aligned[1], aligned[0]) ? predict(aligned[1]) : raw.value,
                    kwh: aligned[1], at: reportAt, reportTs: raw.ts};
            }
        }
    }
    const b = ledger.basis;
    if (!b || energy.value < b.kwh || now - b.at > 7200000)
        return result('basis-invalid-or-stale');
    const delta = energy.value - b.kwh;
    // An implausible counter jump is not battery energy. Require a new report.
    if (delta > capacity * 1.5 || (previous && energy.ts > previous[0]
        && energy.value - previous[1] > (energy.ts - previous[0]) / 3600000 * 100 + 0.02)) {
        ledger.basis = null; ledger.samples = []; ledger.blockedAfter = now;
        return result('energy-jump');
    }
    const value = Math.min(100, b.soc + delta * efficiency / 100 / capacity * 100);
    ledger.lastEstimate = {reportTs: raw.ts, value, timestamp: energy.ts};
    return {...report, valid: true, value,
        timestamp: energy.ts, estimated: true, reported: raw.value, reason: 'energy-estimate', ledger};
}
module.exports = {estimateSoc, reportedSocSample};
