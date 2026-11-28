'use strict';

const {chargeCounterSample} = require('./vehicle-soc-estimator');

// The departure owns a separate AC budget. Vehicle telemetry remains the authority
// for the displayed SoC, manual corrections and a confirmed end of charge.
function updateDepartureMeter(prior, {key, now, counter, sample, capacity, efficiency, target, maxPowerW}) {
    const validTime = ts => Number.isSafeInteger(ts) && ts > 0 && ts <= now + 1000;
    let state = prior?.key === key && validTime(prior.lastAt) && Number.isFinite(prior.lastKWh) && prior.lastKWh >= 0
        && (validTime(prior.blockedAfter) || Number.isFinite(prior.anchorSoc) && prior.anchorSoc >= 0 && prior.anchorSoc <= 100
            && Number.isFinite(prior.anchorKWh) && prior.anchorKWh >= 0 && prior.anchorKWh <= prior.lastKWh
            && (prior.reportAt === 0 || validTime(prior.reportAt)) && [-1, 0, 1].includes(prior.conflict)) ? prior : null;
    const meter = chargeCounterSample(counter, now, state?.lastKWh);
    if (!meter || !sample?.valid || !Number.isFinite(sample.value)) return null;
    const report = sample.observation;
    const validReport = Number.isFinite(report?.value) && report.value >= 0 && report.value <= 100
        && Number.isSafeInteger(report.timestamp) && report.timestamp > 0 && report.timestamp <= now + 1000;
    const lastAt = state?.lastAt, lastKWh = state?.lastKWh;
    if (lastAt && meter.ts < lastAt) return null;
    const delta = meter.value - lastKWh, elapsed = meter.ts - lastAt;
    let blockedAfter = state?.blockedAfter || 0;
    if (lastAt && (elapsed > 60000 || delta < 0 || delta > maxPowerW * elapsed / 3600000000 + 0.02)) {
        blockedAfter = elapsed > 60000 ? lastAt : meter.ts;
        state = null;
    }
    // After a counter reset or telemetry gap only a new, time-aligned vehicle
    // observation can start another budget. Meanwhile the normal deadline applies.
    if (blockedAfter && !(validReport && report.timestamp > blockedAfter
        && report.timestamp <= meter.ts && meter.ts - report.timestamp <= 60000))
        return {key, blockedAfter, lastAt: meter.ts, lastKWh: meter.value};
    const fresh = validReport && report.timestamp > (state?.reportAt || 0);
    const scale = 100 * efficiency / capacity;
    let anchorSoc = state?.anchorSoc, anchorKWh = state?.anchorKWh;
    if (!Number.isFinite(anchorSoc) || !Number.isFinite(anchorKWh)) {
        anchorSoc = sample.value; anchorKWh = meter.value;
    }
    let soc = Math.min(100, anchorSoc + (meter.value - anchorKWh) * scale);
    let conflict = state?.conflict || 0;
    let reportAt = state?.reportAt || 0;
    if (fresh) {
        // A delayed intermediate report must be checked at its observation,
        // not against energy delivered since then. The next aligned poll can
        // settle a report that arrived moments before the counter update.
        const aligned = meter.ts >= report.timestamp && meter.ts - report.timestamp <= 60000;
        const manual = sample.manual === true;
        const reached = report.value >= target;
        if (reached || manual || aligned) {
            const afterReport = state && elapsed > 0 && report.timestamp >= lastAt && report.timestamp <= meter.ts
                ? delta * scale * (meter.ts - report.timestamp) / elapsed : 0;
            const difference = report.value - (soc - afterReport);
            const direction = Math.abs(difference) > (Number.isInteger(report.value) ? 1 : 0.1) + 1e-8
                ? Math.sign(difference) : 0;
            if (reached || manual || direction && direction === conflict) {
                anchorSoc = reached ? Math.max(target, sample.value) : sample.value;
                anchorKWh = meter.value; soc = anchorSoc; conflict = 0;
            } else conflict = direction;
            reportAt = report.timestamp;
        }
    }
    return {key, lastAt: meter.ts, lastKWh: meter.value, anchorSoc, anchorKWh, reportAt, conflict, soc};
}

// Confirm uptake at one physical current and phase count before extrapolating
// it. Duplicate reads of the same power timestamp never qualify a correction.
function observeUptake(previous, {power, amps, phases, since, now}) {
    if (!(amps > 0 && [1, 3].includes(phases) && since > 0 && power?.ack === true && !power.q
        && Number.isFinite(power.val) && power.val > 0 && power.ts >= since
        && power.ts <= now + 1000 && now - power.ts <= 30000)) return null;
    const watts = power.val * 1000;
    const same = previous?.amps === amps && previous.phases === phases && previous.since === since
        && Number.isFinite(previous.watts) && previous.watts > 0 && Number.isInteger(previous.samples) && previous.samples >= 1
        && previous.started >= since && previous.started <= previous.at
        && power.ts >= previous.at && power.ts - previous.at <= 30000;
    if (!same) return {amps, phases, since, started: power.ts, at: power.ts, samples: 1, watts};
    if (power.ts === previous.at) return previous;
    return {...previous, at: power.ts, samples: Math.min(5, previous.samples + 1),
        watts: previous.watts + (watts - previous.watts) / Math.min(5, previous.samples + 1)};
}

module.exports = {updateDepartureMeter, observeUptake};
