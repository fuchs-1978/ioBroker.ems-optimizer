'use strict';

const {normalizeWallboxPowerKW, WALLBOX_POWER_NOISE_TOLERANCE_W} = require('./wallbox-measurement');

const NO_DRAW_MS = 15 * 60000;
const RETRY_MS = 15 * 60000;
const FINISH_MS = 10000;
const PAUSE_REASON = '15 Minuten bestaetigte Ladefreigabe ohne Leistungsaufnahme; Ladeversuch pausiert';
const FINISH_REASON = 'Wallbox meldet Ladeende und elektrische Ruhe bestaetigt; SoC und Fahrzeug-Ladelimit bitte pruefen';

function finishedPause(raw, now) {
    try {
        if (typeof raw !== 'string' || raw.length > 2048) return null;
        const p = JSON.parse(raw);
        return p?.schema === 1 && p.kind === 'charger-finished' && typeof p.signature === 'string'
            && p.signature.length <= 1024 && Number.isFinite(p.at) && p.at > 0 && p.at <= now
            && p.retryAfter === p.at + RETRY_MS ? p : null;
    } catch {return null;}
}
const pauseReason = pause => pause?.kind === 'charger-finished' ? FINISH_REASON : PAUSE_REASON;

function publish(controller, wb, key, value) {
    // Passive annotation must never delay or prevent the physical OFF path.
    try { controller.publish(wb, key, value)?.catch?.(() => {}); } catch { /* continue to OFF */ }
}

function resetNoDrawObservation(controller, device) {
    device.noDrawObservation = null;
    publish(controller, device.wb, 'NoDrawElapsed_s', 0);
    publish(controller, device.wb, 'NoDrawRemaining_s', 0);
}

function publishPause(controller, device) {
    publish(controller, device.wb, 'NoDrawPause_JSON', device.noDrawPause ? JSON.stringify(device.noDrawPause) : '');
    publish(controller, device.wb, 'NoDrawPaused', Boolean(device.noDrawPause));
    publish(controller, device.wb, 'NoDrawRetryAfter', device.noDrawPause?.retryAfter || 0);
}

// Owns only a scheduling exclusion. The existing output stop state machine
// keeps every watt reserved until independent OFF + electrical quiet evidence.
function updateNoDraw(controller, device, mapping) {
    const c = controller, d = device, now = c.now(), wb = d.wb;
    const carId = mapping[`DP_WB${wb}_CAR`];
    const signature = JSON.stringify([carId, mapping[`DP_WB${wb}_SOC`], d.ids.command, d.ids.allow]);
    if (!d.noDrawPauseLoaded) {
        d.noDrawPauseLoaded = true;
        try {
            const text = c.own(`Devices.Wallbox${wb}.NoDrawPause_JSON`);
            const saved = typeof text === 'string' && text.length < 2048 ? JSON.parse(text || 'null') : null;
            if (saved?.schema === 1 && saved.signature === signature
                && Number.isFinite(saved.at) && saved.at > 0 && saved.at <= now + 1000
                && saved.retryAfter === saved.at + RETRY_MS) d.noDrawPause = saved;
        } catch { /* A damaged diagnostic cannot manufacture a charging permission. */ }
        publishPause(c, d);
    }
    const maxAgeMs = c.measurementMaxAgeMs();
    const car = c.number(carId, maxAgeMs);
    const userAllowId = mapping[`DP_WB${wb}_ALLOW`];
    const manual = c.number(mapping[`DP_WB${wb}_AMIN`], Infinity)
        ?? Number(c.own(`Vehicles.Wallbox${wb}.ManualMinimumCurrent_A`) || 0);
    if (d.noDrawPause) {
        const peerBusy = c.devices.some(peer => peer !== d && (peer.owned || peer.pending
            || peer.stopRequest || c.own(`Devices.Wallbox${peer.wb}.OutputActive`) === true));
        const userReset = car === 1 || userAllowId && c.booleanInput(userAllowId) === false
            || manual > 0 && Number.isFinite(manual) && manual !== d.noDrawPause.manualMinimumA;
        // Do not interrupt a working peer for a periodic retry. Unplugging or
        // an explicit OFF/new manual-minimum request can retry via normal gates.
        const retry = now >= d.noDrawPause.retryAfter && !peerBusy && !d.owned && !d.stopRequest
            && !(d.noDrawPause.kind === 'charger-finished' && car === 4);
        if (!d.stopRequest && (userReset || retry || d.noDrawPause.signature !== signature)) {
            d.noDrawPause = null;
            publishPause(c, d);
        } else return pauseReason(d.noDrawPause);
    }
    const commandAt = Math.max(d.activeSince || 0, d.electricalCommandAt || 0, d.recoveredAt || 0);
    const electricalIds = [mapping[`DP_WB${wb}_POWER`],
        ...[1, 2, 3].map(p => mapping[`DP_WB${wb}_L${p}_A`])];
    const values = electricalIds.map(id => c.number(id, maxAgeMs));
    const powerKW = normalizeWallboxPowerKW(values[0]);
    const allow = c.number(d.ids.allow, maxAgeMs);
    const feedback = c.number(d.ids.feedback, maxAgeMs);
    const sources = [...electricalIds, d.ids.allow, d.ids.feedback, carId];
    const stamps = sources.map(id => c.measurementState(id)?.ts);
    const qualified = d.owned && !d.recovering && !d.pending && !d.stopRequest && !d.fault
        && d.activeSince > 0 && d.lastA >= 6 && allow === 1 && feedback === d.lastA
        && c.own(`Devices.Wallbox${wb}.OutputActive`) === true
        && !d.phaseRequest && !(d.phaseTransitionUntil > now) && !d.response?.phaseChange
        && c.own(`Devices.Wallbox${wb}.PhaseSwitchPending`) !== true
        && c.own(`Devices.Wallbox${wb}.PhaseTransitionActive`) !== true
        && c.staticValue(d.ids.connection) === true && c.number(d.ids.error, maxAgeMs) === 0
        && [2, 3, 4].includes(car) && !c.measurementSource
        && c.responseEvidence?.(wb)?.assumed !== true
        && powerKW !== null && powerKW * 1000 <= WALLBOX_POWER_NOISE_TOLERANCE_W
        && values.slice(1).every(amps => amps !== null && amps >= 0 && amps <= 0.5)
        && sources.every(id => !c.measurementProblem(id, maxAgeMs))
        && stamps.every(ts => ts >= commandAt && ts <= now + 1000);
    if (!qualified) {
        resetNoDrawObservation(c, d);
        return '';
    }
    const sampleAt = Math.min(...stamps);
    const previous = d.noDrawObservation;
    const kind = car === 4 ? 'charger-finished' : 'no-draw';
    const requiredMs = kind === 'charger-finished' ? FINISH_MS : NO_DRAW_MS;
    // A scheduler/source gap or time reversal is not 15 minutes of observed
    // inactivity. Fresh repeated polls do not reset an uninterrupted episode.
    if (!previous || previous.kind !== kind || now < previous.observedAt || now - previous.observedAt > maxAgeMs
        || sampleAt < previous.sampleAt || sampleAt - previous.sampleAt > maxAgeMs)
        d.noDrawObservation = {since: now, sampleAt, observedAt: now, kind};
    else Object.assign(previous, {sampleAt, observedAt: now});
    const elapsed = Math.max(0, Math.min(now, sampleAt) - d.noDrawObservation.since);
    publish(c, wb, 'NoDrawElapsed_s', Math.floor(elapsed / 1000));
    publish(c, wb, 'NoDrawRemaining_s', Math.max(0, Math.ceil((requiredMs - elapsed) / 1000)));
    if (elapsed < requiredMs) return '';
    d.noDrawPause = {schema: 1, signature, at: now, retryAfter: now + RETRY_MS,
        ...(kind === 'charger-finished' ? {kind} : {}),
        manualMinimumA: Number.isFinite(manual) ? manual : 0};
    publishPause(c, d);
    return pauseReason(d.noDrawPause);
}

module.exports = {updateNoDraw, resetNoDrawObservation, NO_DRAW_MS, RETRY_MS, FINISH_MS, finishedPause};
