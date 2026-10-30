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
function socStatus(sample, reported) {
    if (sample.reason?.startsWith('manual-')) return sample.valid
        ? 'Manuell korrigierter SoC; alte Cloud-Meldungen gesperrt'
        : 'Manuelle SoC-Basis ungeprueft; neue Korrektur oder Fahrzeugmessung erforderlich';
    if (!sample.valid) return 'SoC unbekannt/ungueltig';
    if (sample.reason === 'energy-estimate') return 'Gemeldeter SoC mit gemessener Ladeenergie fortgeschrieben'
        + (reported.stale ? '; Fahrzeugbericht aelter als 2 Stunden' : '');
    return reported.stale ? 'Letzter gueltiger SoC bleibt wirksam; Fahrzeugbericht aelter als 2 Stunden'
        : sample.estimated ? 'Gemeldeter SoC mit gemessener Ladeenergie fortgeschrieben' : 'Gemeldeter SoC';
}
function estimateReportedSoc({now, reported, counter, car, measurementTime, measurementTimeConfigured = false,
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
            && (ledger.basis.continuous === undefined || typeof ledger.basis.continuous === 'boolean')
            && (ledger.basis.continuous !== true || Number.isFinite(ledger.basis.through)
                && ledger.basis.through >= ledger.basis.at && ledger.basis.through <= now + 1000)
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
    if (capacity === null || capacity < 1 || capacity > 300 || efficiency === null || efficiency < 50 || efficiency > 99) {
        if (ledger.basis) ledger.basis.continuous = false;
        return result('invalid-settings');
    }
    if (!connection || ![2, 3, 4].includes(connection.value)) {
        ledger.basis = null; ledger.samples = []; ledger.blockedAfter = now; ledger.lastAt = now;
        return result('disconnected-or-unknown');
    }
    // A connection transition during an unobserved restart interval cannot
    // prove that the same vehicle/session remained connected.
    if (sane && numeric(car.lc) > ledger.lastAt) {
        ledger.basis = null; ledger.samples = []; ledger.blockedAfter = numeric(car.lc);
    }
    if (!raw || !energy) {
        if (ledger.basis) ledger.basis.continuous = false;
        return result(!raw ? 'reported-soc-invalid' : 'energy-invalid-or-stale');
    }
    const previous = ledger.samples.at(-1);
    // Keep the original anchor; advancing its time would count old energy again.
    // A separate watermark proves the observed counter chain beyond two hours.
    // Legacy ledgers without that evidence cannot extend an expired anchor.
    if (ledger.basis?.continuous === true) {
        if (!previous || ledger.basis.through !== previous[0] || now - ledger.lastAt > 60000
            || energy.ts - previous[0] > 60000 || energy.ts < previous[0] || energy.value < previous[1])
            ledger.basis.continuous = false;
        else ledger.basis.through = energy.ts;
    }
    if (previous && (energy.ts < previous[0] || energy.value < previous[1])) {
        ledger.basis = null; ledger.samples = []; ledger.blockedAfter = now;
    }
    const last = ledger.samples.at(-1);
    if (!last || energy.ts > last[0]) ledger.samples.push([energy.ts, energy.value]);
    else if (energy.value !== last[1]) {
        if (ledger.basis) ledger.basis.continuous = false;
        return result('inconsistent-energy-sample');
    }
    ledger.samples = ledger.samples.filter(p => now - p[0] <= 7200000).slice(-256);
    ledger.lastAt = now;
    let reportAt = raw.ts;
    if (measurementTimeConfigured) {
        const measured = sample(measurementTime, now, Infinity, 1, now + 1000);
        if (!measured || measured.value > raw.ts + 1000) {
            if (ledger.basis) ledger.basis.continuous = false;
            return {...result('measurement-time-invalid'), valid: false, value: null, timestamp: 0};
        }
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
            const agrees = (kwh, at) => oldBasis && (now - oldBasis.at <= 7200000
                || oldBasis.continuous === true && oldBasis.through === energy.ts)
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
                    kwh: aligned[1], at: reportAt, reportTs: raw.ts,
                    continuous: ledger.samples.filter(p => p[0] >= aligned[0])
                        .every((p, i, points) => i === 0 || p[0] - points[i - 1][0] <= 60000),
                    through: energy.ts};
            }
        }
    }
    const b = ledger.basis;
    if (!b || energy.value < b.kwh || now - b.at > 7200000
        && !(b.continuous === true && b.through === energy.ts))
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
// Manual correction is a separate, persisted authority. Publication timestamps
// from the cloud cannot release it. Only a qualified measurement newer than the
// correction/session boundary, or an explicit operator reset, may do so.
function estimateSoc(input) {
    const result = estimateReportedSoc(input);
    delete result.ledger.manual;
    let prior;
    try { prior = JSON.parse(input.ledgerText || '{}'); } catch { /* no correction */ }
    const sameSource = prior?.signature === input.signature;
    const m = sameSource ? prior.manual : null;
    const b = sameSource ? prior.basis : null;
    const last = prior?.samples?.at(-1);
    const cloud = reportedSocSample(input.reported, input.now);
    const meter = sample(input.counter, input.now, 60000, 0, 1e9);
    const connected = sample(input.car, input.now, Infinity, 2, 4);
    const capacity = numeric(input.capacityKWh), efficiency = numeric(input.efficiencyPct);
    const predicted = b && meter && capacity >= 1 && efficiency >= 50
        ? b.soc + (meter.value - b.kwh) * efficiency / capacity : null;
    // A repeated cloud percentage with a new publication timestamp contradicts
    // an uninterrupted measured charging chain. This is suspicion, not proof
    // of the physical battery level, and never changes a charge permission.
    const suspect = !m && !input.measurementTimeConfigured && cloud.valid && connected
        && b?.continuous === true && last && prior.lastAt <= input.now
        && input.now - prior.lastAt <= 60000 && b.through === last[0]
        && meter && meter.ts >= last[0] && meter.ts - last[0] <= 60000
        && meter.value >= last[1] && meter.value - last[1] <= (meter.ts - last[0]) / 3600000 * 100 + 0.02
        && !(numeric(input.car?.lc) > prior.lastAt)
        && cloud.timestamp > b.reportTs && cloud.value === (prior.cloudReportValue ?? Math.round(b.soc))
        && predicted !== null && predicted - cloud.value >= 3;
    if (suspect) result.ledger.socWarning = {at: input.now, reported: cloud.value,
        expected: Math.min(100, predicted)};
    result.ledger.cloudReportValue = cloud.value;
    if (m) delete result.ledger.socWarning;
    result.socWarning = Boolean(result.ledger.socWarning);
    result.socWarningText = result.socWarning
        ? 'Fahrzeug-SoC unplausibel niedrig gegenueber gemessener Ladeenergie. SoC am Fahrzeug/in der App pruefen und unter SoCCorrection_pct eintragen.' : '';
    if (!m || !Number.isFinite(m.soc) || m.soc < 0 || m.soc > 100
        || !Number.isFinite(m.at) || m.at <= 0 || m.at > input.now
        || !Number.isFinite(m.kwh) || m.kwh < 0
        || !Number.isFinite(m.lastKwh) || m.lastKwh < m.kwh
        || !Number.isFinite(m.lastTs) || m.lastTs < m.at || m.lastTs > input.now + 1000
        || !Number.isFinite(m.lastValue) || m.lastValue < 0 || m.lastValue > 100
        || !Number.isFinite(m.lastAt) || m.lastAt < m.at || m.lastAt > input.now
        || typeof m.suspended !== 'boolean') return result;
    const manual = {...m};
    const connection = sample(input.car, input.now, Infinity, 1, 4);
    const energy = sample(input.counter, input.now, 60000, 0, 1e9);
    const transition = input.now - m.lastAt > 60000 && numeric(input.car?.lc) > m.lastAt;
    if (!connection || ![2, 3, 4].includes(connection.value) || transition) {
        manual.suspended = true;
        manual.blockedAfter = input.now;
    }
    const measured = input.measurementTimeConfigured
        ? sample(input.measurementTime, input.now, Infinity, 1, input.now) : null;
    const report = reportedSocSample(input.reported, input.now);
    if (connection && [2, 3, 4].includes(connection.value) && measured && report.valid
        && measured.value > Math.max(m.at, manual.blockedAfter || 0)
        && measured.value <= report.timestamp + 1000 && result.estimated
        && result.ledger.basis?.at === measured.value) return result;
    let reason = 'manual-energy-estimate';
    if (!manual.suspended && energy && capacity >= 1 && capacity <= 300 && efficiency >= 50 && efficiency <= 99) {
        const gap = energy.ts - m.lastTs;
        if (energy.ts < m.at && energy.value === m.kwh) {
            result.ledger.manual = manual;
            return {...result, valid: true, value: m.lastValue, estimated: true,
                timestamp: m.at, manual: true, reason: 'manual-awaiting-counter'};
        }
        if (energy.value < m.lastKwh || gap < 0 || input.now - m.lastAt > 60000 || gap > 60000
            || energy.value - m.lastKwh > gap / 3600000 * 100 + 0.02
            || energy.ts < m.at || energy.value - m.kwh > capacity * 1.5) {
            manual.suspended = true;
            manual.blockedAfter = input.now;
        } else {
            manual.lastValue = Math.min(100, m.soc + (energy.value - m.kwh) * efficiency / capacity);
            manual.lastKwh = energy.value;
            manual.lastTs = energy.ts;
        }
    } else if (!manual.suspended) reason = 'manual-retained-energy-unavailable';
    // Without a source measurement clock, a changed publication is only a
    // recovery candidate. Align its SoC to the counter at that publication,
    // and compare against the uninterrupted manual energy estimate there.
    // Never treat repeated publications of the same percentage as new proof.
    const previousCloud = numeric(m.cloudValue) ?? numeric(prior.cloudReportValue);
    const previousCloudTs = numeric(m.cloudTs) ?? m.at;
    if (report.valid && report.timestamp > previousCloudTs) {
        manual.recoveryCandidate = !input.measurementTimeConfigured
            && previousCloud !== null && report.value !== previousCloud && report.timestamp > m.at
            ? {value: report.value, ts: report.timestamp} : null;
        manual.cloudValue = report.value;
        manual.cloudTs = report.timestamp;
    }
    const candidate = manual.recoveryCandidate;
    if (!input.measurementTimeConfigured && !manual.suspended && energy
        && capacity >= 1 && capacity <= 300 && efficiency >= 50 && efficiency <= 99
        && candidate && report.valid && candidate.value === report.value
        && candidate.ts === report.timestamp && candidate.ts > m.at
        && input.now - candidate.ts <= 60000 && result.estimated
        && result.ledger.basis?.at === candidate.ts) {
        const aligned = result.ledger.samples.find(p => p[0] >= candidate.ts && p[0] - candidate.ts <= 60000);
        const expected = aligned && aligned[1] >= m.kwh
            ? Math.min(100, m.soc + (aligned[1] - m.kwh) * efficiency / capacity) : null;
        if (expected !== null && Math.abs(candidate.value - expected) <= 1) {
            delete result.ledger.socWarning;
            return {...result, socWarning: false, socWarningText: '', automaticRecovery: true,
                reason: 'automatic-cloud-recovery'};
        }
    }
    // A missing counter must not hide a long gap when it comes back.
    if (energy && energy.ts >= m.lastTs) manual.lastAt = input.now;
    result.ledger.manual = manual;
    return {...result, valid: !manual.suspended, value: manual.suspended ? null : manual.lastValue,
        estimated: true, timestamp: manual.lastTs, manual: true,
        reason: manual.suspended ? 'manual-suspended' : reason};
}

function correctSoc({value, now, signature, counter, car, reported, ledgerText = ''}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 100
        || value < 0 && value !== -1) return {ok: false, reason: 'Korrektur muss 0 bis 100 oder -1 sein'};
    let ledger;
    try { ledger = JSON.parse(ledgerText); } catch { /* new ledger */ }
    if (!ledger || ledger.signature !== signature || ledger.version !== 1)
        ledger = {version: 1, signature, samples: [], basis: null, blockedAfter: 0, lastAt: now};
    delete ledger.socWarning;
    if (value === -1) {
        delete ledger.manual;
        return {ok: true, ledger, reason: 'Manuelle Korrektur aufgehoben; Fahrzeugquelle gilt wieder'};
    }
    const energy = sample(counter, now, 60000, 0, 1e9);
    const connected = sample(car, now, Infinity, 2, 4);
    if (!energy || !connected) return {ok: false,
        reason: 'Korrektur abgelehnt: angeschlossenes Fahrzeug und frischer Ladeenergiezaehler erforderlich'};
    // A retained counter predating this command is allowed only if recent;
    // no historical charge is added to the manually observed current SoC.
    const report = reportedSocSample(reported, now);
    ledger.manual = {cloudValue: report.valid ? report.value : numeric(ledger.cloudReportValue),
        cloudTs: report.valid ? report.timestamp : now, recoveryCandidate: null,
        soc: value, at: now, kwh: energy.value, lastKwh: energy.value,
        lastTs: now, lastValue: value, lastAt: now, suspended: false, blockedAfter: 0};
    return {ok: true, ledger, reason: `SoC auf ${value} % korrigiert; Cloud-Ruecksetzung gesperrt`};
}
module.exports = {estimateSoc, reportedSocSample, socStatus, correctSoc};
