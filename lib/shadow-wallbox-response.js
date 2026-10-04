'use strict';

const {normalizeWallboxPowerKW} = require('./wallbox-measurement');

const ASSUMPTION = 'Ideale elektrische WB-Antwort: letzte modellierte Ausgabe bei 230 V; Netzleistung um alle modellierten WB-Lasten korrigiert. Reale Phasen, Schutzwerte und SoC bleiben bindend; EHZ, Speicher und thermische Anlage werden nicht simuliert.';
// A large substitution needs readings from the same physical moment. A late
// wallbox sample paired with a newer grid sample can invent several kW of PV.
const MAX_LARGE_CORRECTION_SKEW_MS = 2000;
const LARGE_CORRECTION_W = 1000;

function sampleNumber(state, now, maxAgeMs) {
    if (!state) return {value: null, reason: 'missing'};
    if (state.ack !== true) return {value: null, reason: 'unacknowledged'};
    if (state.q && Number(state.q) !== 0) return {value: null, reason: 'quality'};
    if (!Number.isFinite(state.ts) || state.ts <= 0) return {value: null, reason: 'timestamp'};
    if (state.ts > now + 1000) return {value: null, reason: 'future'};
    if (now - state.ts > maxAgeMs) return {value: null, reason: 'stale'};
    if (!['number', 'string'].includes(typeof state.val) || String(state.val).trim() === ''
        || !Number.isFinite(Number(state.val))) return {value: null, reason: 'numeric'};
    return {value: Number(state.val), reason: ''};
}

/** Counterfactual electrical inputs only. Original states and their metadata
 * are never mutated. Invalid real sources are never repaired by an assumption.
 * All participating WBs are substituted together with the net meter, so a
 * virtual 6 A can never be paired with a legacy script's unrelated 17 A load.
 */
function wallboxResponse({states, rawStates, devices, mapping, namespace, config, now, decision, sampleBuffer,
    historicalBaseline}) {
    const response = {valid: true, applied: false, assumption: ASSUMPTION, basis: 'previous-output', voltageV: 230,
        realGridW: null, gridW: null, deltaW: 0, wallboxes: {}, reason: ''};
    const age = Math.max(5, Number(config.wallboxMeasurementMaxAgeS) || 30) * 1000;
    const updates = [], currents = new Map(), failures = [];
    // Only the internal retry supplies a previously validated, common frame.
    // The outer call always requires current original grid readings <= 10 s.
    const gridAgeMs = historicalBaseline ? Math.min(20000, age, historicalBaseline.maxAgeMs) : 10000;
    const imported = sampleNumber(rawStates.get(mapping.DP_GRID_IMPORT), now, gridAgeMs);
    const exported = sampleNumber(rawStates.get(mapping.DP_GRID_EXPORT), now, gridAgeMs);
    const gridTimestamp = Math.max(rawStates.get(mapping.DP_GRID_IMPORT)?.ts || 0,
        rawStates.get(mapping.DP_GRID_EXPORT)?.ts || 0);
    for (const [label, sample] of [['gridImport', imported], ['gridExport', exported]])
        if (sample.reason || sample.value < 0) failures.push(`${label}:${sample.reason || 'negative'}`);
    if (!failures.length) response.realGridW = response.gridW = imported.value - exported.value;
    for (const d of devices) {
        const name = `Wallbox${d.wb}`;
        if (!d.valid || rawStates.get(`${namespace}.Devices.${name}.Present`)?.val !== true
            || rawStates.get(`${namespace}.Devices.${name}.ControlEnabled`)?.val !== true
            || config[`wb${d.wb}ProductionArmed`] !== true) continue;
        const id = mapping[`DP_WB${d.wb}_POWER`], raw = rawStates.get(id);
        const sample = sampleNumber(raw, now, age);
        const powerKW = sample.reason ? null : normalizeWallboxPowerKW(sample.value);
        const reason = sample.reason || (powerKW === null ? 'negative' : '');
        const modeled = decision(d.wb);
        response.wallboxes[name] = {valid: !reason, reason, rawPowerW: sample.value === null ? null : sample.value * 1000,
            telemetryValid: !reason, correctionValid: !reason, powerTs: raw?.ts ?? null, gridTs: gridTimestamp,
            realPowerW: powerKW === null ? null : powerKW * 1000,
            powerW: modeled.powerW, amps: modeled.amps, phases: modeled.phases};
        if (reason) { failures.push(`${name}:${reason}`); continue; }
        const correctionW = modeled.powerW - powerKW * 1000;
        const skewMs = Math.abs(gridTimestamp - raw.ts);
        response.wallboxes[name].gridPowerSkewMs = skewMs;
        if (Math.abs(correctionW) >= LARGE_CORRECTION_W && skewMs > MAX_LARGE_CORRECTION_SKEW_MS) {
            failures.push(`${name}:grid-power-asynchronous (${skewMs} ms, ${Math.round(correctionW)} W)`);
            Object.assign(response.wallboxes[name], {valid: false, correctionValid: false,
                reason: 'grid-power-asynchronous'});
        }
        if (raw.alignment) response.wallboxes[name].alignment = raw.alignment;
        response.deltaW += correctionW;
        updates.push([id, {...raw, val: modeled.powerW / 1000}]);
        // The optional ramp feedback does not replace real per-phase samples.
        // Safety and phase-topology checks continue to consume the originals.
        const phaseSamples = [1, 2, 3].map(p => sampleNumber(rawStates.get(mapping[`DP_WB${d.wb}_L${p}_A`]), now, age));
        if (phaseSamples.every(s => !s.reason && s.value >= 0)) currents.set(d.wb, modeled.amps);
    }
    response.valid = failures.length === 0;
    response.reason = failures.join('; ');
    // Retry only timing failures, never repair missing/stale/ACK/quality inputs.
    // A common, bracketed baseline replaces ALL participating loads together.
    if (sampleBuffer && failures.length && failures.every(reason => reason.includes(':grid-power-asynchronous'))) {
        const ids = Object.keys(response.wallboxes).map(name => mapping[`DP_WB${name.slice(7)}_POWER`]);
        const aligned = sampleBuffer.align(rawStates, mapping, ids, now, age);
        if (aligned) {
            const retried = wallboxResponse({states, rawStates: aligned.states, devices, mapping,
                namespace, config, now, decision, historicalBaseline: aligned});
            if (retried.response.valid) {
                Object.assign(retried.response, {basis: 'bracketed-historical-input',
                    timingState: 'aligned-historical-frame',
                    inputTimestamp: aligned.timestamp, inputAgeMs: aligned.ageMs,
                    maximumObservedPowerSpreadW: aligned.maximumObservedPowerSpreadW,
                    powerUncertaintyBoundW: aligned.maximumObservedPowerSpreadW,
                    observedPowerSpreadW: aligned.observedPowerSpreadW,
                    alignment: {...sampleBuffer.lastAlignment},
                    gridDriftW: aligned.gridDriftW,
                    currentRealGridW: response.realGridW, currentTimingReason: response.reason});
                return retried;
            }
        }
        response.alignment = {...sampleBuffer.lastAlignment};
        response.timingState = 'waiting-for-common-measurements';
    }
    if (!response.valid && !response.timingState) response.timingState = 'invalid-source';
    if (response.valid && !response.timingState) response.timingState = 'current-input';
    if (response.valid && updates.length) {
        response.applied = true;
        response.gridW = response.realGridW + response.deltaW;
        for (const [id, state] of updates) states.set(id, state);
        states.set(mapping.DP_GRID_IMPORT, {...rawStates.get(mapping.DP_GRID_IMPORT), val: Math.max(0, response.gridW)});
        states.set(mapping.DP_GRID_EXPORT, {...rawStates.get(mapping.DP_GRID_EXPORT), val: Math.max(0, -response.gridW)});
    } else currents.clear();
    return {response, currents};
}

module.exports = {wallboxResponse, sampleNumber, ASSUMPTION};
