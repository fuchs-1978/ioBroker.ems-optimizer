'use strict';

// Pure, read-only analysis of exported SQL data. A measured power dip is not
// evidence of an EMS stop: the master is off in the records accepted here.
const WALLBOXES = ['Wallbox0', 'Wallbox1', 'Wallbox2'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const timestamp = value => finite(value) ? value
    : typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;

function windowBounds(window) {
    const start = timestamp(window?.from), end = timestamp(window?.to);
    if (!finite(start) || !finite(end) || end <= start) {
        throw new Error('window.from/to must be milliseconds or ISO timestamps with timezone; to must follow from');
    }
    return {start, end};
}

function positiveOption(value, fallback, name) {
    if (value === undefined) return fallback;
    if (!finite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
    return value;
}

function normalizeRecords(input, start, end) {
    if (!Array.isArray(input)) throw new Error('records must be an array of DecisionRecords or SQL {ts,val} rows');
    const diagnostics = {inputCount: input.length, parsedCount: 0, malformed: 0,
        outsideWindow: 0, outOfOrder: 0, duplicates: 0, conflictingDuplicates: 0,
        missingIdentity: 0, invalid: 0, masterNotOff: 0, sessions: [],
        sequenceGaps: 0, missingSequences: 0, sequenceResets: 0, sessionChanges: 0,
        timestampCollisions: 0, recordingDrops: 0, recordingWriteErrors: 0,
        recordingCountersMissing: 0};
    const rows = [], identities = new Map(), sessions = new Set();
    let previousTimestamp = -Infinity;
    for (const raw of input) {
        let record;
        try {
            const payload = raw && Object.hasOwn(raw, 'val') ? raw.val : raw;
            record = typeof payload === 'string' ? JSON.parse(payload) : payload;
        } catch { /* Keep a known SQL timestamp as an explicit unknown point. */ }
        const validObject = record && typeof record === 'object' && !Array.isArray(record);
        const decisionTime = timestamp(validObject ? record.timestamp : undefined);
        const ts = finite(decisionTime) ? decisionTime : timestamp(raw?.ts);
        if (!validObject || !finite(decisionTime)) diagnostics.malformed++;
        if (!finite(ts)) continue;
        if (ts < start || ts > end) { diagnostics.outsideWindow++; continue; }
        if (ts < previousTimestamp) diagnostics.outOfOrder++;
        previousTimestamp = ts;
        const row = {ts, record: validObject ? record : {}, eligible: Boolean(validObject) && finite(decisionTime)};
        if (validObject) diagnostics.parsedCount++;
        const session = record?.recordSession, sequence = record?.recordSequence;
        const identityValid = ((finite(session) && session > 0) || (typeof session === 'string' && session.length > 0))
            && Number.isSafeInteger(sequence) && sequence >= 0;
        if (!identityValid) { diagnostics.missingIdentity++; row.eligible = false; }
        else {
            row.session = session;
            row.sequence = sequence;
            sessions.add(session);
            const key = JSON.stringify([session, sequence]);
            // sqlTs/transport timestamp is not part of the decision identity.
            const content = {...record};
            delete content.sqlTs;
            const fingerprint = JSON.stringify(content);
            const prior = identities.get(key);
            if (prior) {
                diagnostics.duplicates++;
                if (prior.fingerprint === fingerprint) continue;
                diagnostics.conflictingDuplicates++;
                prior.row.eligible = false;
                row.eligible = false;
            } else identities.set(key, {fingerprint, row});
        }
        if (record?.valid !== true) { diagnostics.invalid++; row.eligible = false; }
        if (record?.masterEnabled !== false) { diagnostics.masterNotOff++; row.eligible = false; }
        const dropped = record?.recording?.dropped, errors = record?.recording?.writeErrors;
        if (!finite(dropped) || dropped < 0 || !finite(errors) || errors < 0) {
            diagnostics.recordingCountersMissing++;
        } else {
            diagnostics.recordingDrops = Math.max(diagnostics.recordingDrops, dropped);
            diagnostics.recordingWriteErrors = Math.max(diagnostics.recordingWriteErrors, errors);
        }
        rows.push(row);
    }
    rows.sort((a, b) => a.ts - b.ts || (a.sequence ?? 0) - (b.sequence ?? 0));
    for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1], b = rows[i];
        if (a.ts === b.ts) {
            diagnostics.timestampCollisions++;
            a.eligible = false;
            b.eligible = false;
        }
        if (a.session === undefined || b.session === undefined) continue;
        if (a.session !== b.session) { diagnostics.sessionChanges++; continue; }
        if (b.sequence <= a.sequence) diagnostics.sequenceResets++;
        else if (b.sequence > a.sequence + 1) {
            diagnostics.sequenceGaps++;
            diagnostics.missingSequences += b.sequence - a.sequence - 1;
        }
    }
    diagnostics.sessions = [...sessions];
    return {rows, diagnostics};
}

function connected(a, b, maxGapMs) {
    if (!a?.eligible || !b?.eligible || b.ts <= a.ts || b.ts - a.ts > maxGapMs) return false;
    if (a.session !== b.session || b.sequence !== a.sequence + 1) return false;
    // Cumulative errors before this interval remain reported, but a new error
    // breaks continuity even if the following successful record is consecutive.
    for (const key of ['dropped', 'writeErrors']) {
        const before = a.record.recording?.[key], after = b.record.recording?.[key];
        if (finite(before) && finite(after) && after !== before) return false;
    }
    return true;
}

function powerState(row, wallbox, kind, thresholdW) {
    if (!row.eligible) return 'unknown';
    if (kind === 'modeled') {
        if (row.record.response?.valid === false) return 'unknown';
        const model = row.record.modeled?.[wallbox];
        if (typeof model?.active !== 'boolean' || !finite(model.powerW) || model.powerW < 0) return 'unknown';
        return model.active && model.powerW > thresholdW ? 'active' : 'inactive';
    }
    const feedback = row.record.realFeedback?.[wallbox]?.powerKW;
    if (feedback && (feedback.fresh === false || feedback.ack === false
        || (feedback.q !== undefined && feedback.q !== 0))) return 'unknown';
    const power = row.record.actuals?.[wallbox];
    return finite(power) ? power > thresholdW ? 'active' : 'inactive' : 'unknown';
}

function regularEnd(row, wallbox) {
    if (!row.eligible) return null;
    const feedback = row.record.realFeedback?.[wallbox];
    const value = (name, staticSetting = false) => {
        const field = feedback?.[name];
        if (!field || (field.q !== undefined && field.q !== 0)) return undefined;
        if (field.ts !== undefined) {
            const ts = timestamp(field.ts);
            if (!finite(ts) || ts > row.ts) return undefined;
        }
        // Retained user settings can legitimately be old and unacknowledged;
        // measured car/SoC feedback must still be fresh and acknowledged.
        if (!staticSetting && (field.fresh === false || field.ack === false)) return undefined;
        return field.value;
    };
    if (value('car') === 1) return 'vehicle disconnected';
    const release = value('userRelease', true);
    if (release === false || release === 0) return 'user release withdrawn';
    const soc = value('soc'), target = value('targetSoc', true);
    if (finite(soc) && finite(target) && target > 0 && target <= 100 && soc >= target && soc <= 100) {
        return 'target SoC reached';
    }
    // The actuator's allow=0 is deliberately not a regular end: an unexpected
    // stop/resume with a connected, released vehicle is what we want to count.
    return null;
}

function analyzePowerStates(rows, wallbox, kind, start, end, maxGapMs, thresholdW) {
    const states = rows.map(row => powerState(row, wallbox, kind, thresholdW));
    const ends = rows.map(row => regularEnd(row, wallbox));
    const interruptions = [], normalEnds = [];
    let candidate = null, coveredMs = 0, activeMs = 0, inactiveMs = 0;
    for (let i = 1; i < rows.length; i++) {
        const before = rows[i - 1], current = rows[i];
        const continuous = connected(before, current, maxGapMs);
        if (ends[i] && !ends[i - 1]) normalEnds.push({at: current.ts, reason: ends[i]});
        if (continuous && states[i - 1] !== 'unknown' && states[i] !== 'unknown') {
            const duration = current.ts - before.ts;
            coveredMs += duration;
            if (states[i - 1] === 'active') activeMs += duration;
            else inactiveMs += duration;
        }
        if (!continuous || states[i - 1] === 'unknown' || states[i] === 'unknown' || ends[i] || ends[i - 1]) {
            candidate = null;
            continue;
        }
        if (states[i - 1] === 'active' && states[i] === 'inactive') {
            candidate = {from: current.ts, status: current.record.modeled?.[wallbox]?.status ?? null};
        } else if (candidate && states[i] === 'active') {
            interruptions.push({...candidate, to: current.ts, durationMs: current.ts - candidate.from});
            candidate = null;
        }
    }
    return {
        meaning: kind === 'modeled' ? 'virtual output interruptions; not physical EMS stops'
            : 'measured power dips; cause and physical switching are not inferred',
        interruptionCount: interruptions.length,
        interruptionMs: interruptions.reduce((sum, item) => sum + item.durationMs, 0),
        interruptions,
        normalEndCount: normalEnds.length, normalEnds,
        openInterruption: candidate,
        activeMs, inactiveMs, coveredMs, unknownMs: end - start - coveredMs,
        coverage: coveredMs / (end - start)
    };
}

function normalizeSeries(input) {
    const rows = [], diagnostics = {inputCount: 0, malformed: 0, duplicates: 0,
        conflictingDuplicates: 0, outOfOrder: 0, invalidValues: 0};
    if (input === undefined) return {rows, diagnostics};
    if (!Array.isArray(input)) throw new Error('energy series must be arrays of {ts,val} rows');
    let previous = -Infinity;
    const byTime = new Map();
    diagnostics.inputCount = input.length;
    for (const raw of input) {
        const ts = timestamp(raw?.ts);
        if (!finite(ts)) { diagnostics.malformed++; continue; }
        if (ts < previous) diagnostics.outOfOrder++;
        previous = ts;
        const valid = finite(raw.val) && raw.ack !== false && (raw.q === undefined || raw.q === 0);
        const val = valid ? raw.val : null;
        if (!valid) diagnostics.invalidValues++;
        const prior = byTime.get(ts);
        if (prior) {
            diagnostics.duplicates++;
            if (prior.val !== val) { prior.val = null; diagnostics.conflictingDuplicates++; }
        } else { const row = {ts, val}; rows.push(row); byTime.set(ts, row); }
    }
    rows.sort((a, b) => a.ts - b.ts);
    return {rows, diagnostics};
}

function counterDelta(series, start, end) {
    const inWindow = series.rows.filter(row => row.ts >= start && row.ts <= end);
    if (inWindow[0]?.ts !== start || inWindow.at(-1)?.ts !== end) return {valid: false, reason: 'window endpoints missing'};
    if (series.diagnostics.malformed) return {valid: false, reason: 'counter timestamp malformed'};
    for (let i = 0; i < inWindow.length; i++) {
        if (!finite(inWindow[i].val) || inWindow[i].val < 0) return {valid: false, reason: 'invalid counter value'};
        if (i > 0 && inWindow[i].val < inWindow[i - 1].val) return {valid: false, reason: 'counter reset or decrease'};
    }
    return {valid: true, delta: inWindow.at(-1).val - inWindow[0].val};
}

function analyzeEnergy(energy = {}, window) {
    const {start, end} = windowBounds(window);
    const maxHoldMs = positiveOption(energy.maxPowerHoldMs, 65000, 'energy.maxPowerHoldMs');
    const unit = energy.counterUnit ?? 'kWh';
    if (!['kWh', 'Wh'].includes(unit)) throw new Error('energy.counterUnit must be kWh or Wh');
    const imports = normalizeSeries(energy.importCounter), exports = normalizeSeries(energy.exportCounter);
    const importDelta = counterDelta(imports, start, end), exportDelta = counterDelta(exports, start, end);
    const diagnostics = {importCounter: {...imports.diagnostics, ...importDelta},
        exportCounter: {...exports.diagnostics, ...exportDelta}};
    if (importDelta.valid && exportDelta.valid) {
        const factor = unit === 'Wh' ? 0.001 : 1;
        const importKWh = importDelta.delta * factor, exportKWh = exportDelta.delta * factor;
        return {source: 'pairedCounters', estimated: false, complete: true, coverage: 1,
            coveredMs: end - start, unknownMs: 0, importKWh, exportKWh,
            netKWh: importKWh - exportKWh, diagnostics};
    }
    const net = normalizeSeries(energy.netPower);
    diagnostics.netPower = net.diagnostics;
    let importWs = 0, exportWs = 0, coveredMs = 0, maximumSampleGapMs = 0;
    // Never carry the final value beyond its last observed timestamp. Inside
    // gaps carry at most maxHoldMs, and expose the remainder as unknown.
    for (let i = 1; i < net.rows.length; i++) {
        const a = net.rows[i - 1], b = net.rows[i];
        if (b.ts <= start || a.ts >= end) continue;
        maximumSampleGapMs = Math.max(maximumSampleGapMs, b.ts - a.ts);
        if (!finite(a.val)) continue;
        const intervalStart = Math.max(start, a.ts);
        const intervalEnd = Math.min(end, b.ts, a.ts + maxHoldMs);
        if (intervalEnd <= intervalStart) continue;
        const durationMs = intervalEnd - intervalStart;
        coveredMs += durationMs;
        importWs += Math.max(0, a.val) * durationMs / 1000;
        exportWs += Math.max(0, -a.val) * durationMs / 1000;
    }
    const complete = coveredMs === end - start && !net.diagnostics.malformed;
    return {source: coveredMs ? 'netPower' : 'unavailable', estimated: true, complete,
        coverage: coveredMs / (end - start), coveredMs, unknownMs: end - start - coveredMs,
        importKWh: coveredMs ? importWs / 3600000 : null,
        exportKWh: coveredMs ? exportWs / 3600000 : null,
        netKWh: coveredMs ? (importWs - exportWs) / 3600000 : null,
        maxPowerHoldMs: maxHoldMs, maximumSampleGapMs,
        meaning: 'power-derived energy covers observed intervals only; incomplete totals are not whole-window energy',
        diagnostics};
}

function analyzeShadow(input) {
    if (!input || typeof input !== 'object') throw new Error('input must be an object');
    const {start, end} = windowBounds(input.window);
    const maxRecordGapMs = positiveOption(input.maxRecordGapMs, 65000, 'maxRecordGapMs');
    const thresholdW = input.activePowerThresholdW ?? 100;
    if (!finite(thresholdW) || thresholdW < 0) throw new Error('activePowerThresholdW must be a non-negative number');
    const {rows, diagnostics} = normalizeRecords(input.records ?? [], start, end);
    const wallboxes = {};
    for (const wallbox of WALLBOXES) {
        wallboxes[wallbox] = {
            modeled: analyzePowerStates(rows, wallbox, 'modeled', start, end, maxRecordGapMs, thresholdW),
            measured: analyzePowerStates(rows, wallbox, 'measured', start, end, maxRecordGapMs, thresholdW)
        };
    }
    return {schema: 1, window: {from: start, to: end}, maxRecordGapMs,
        activePowerThresholdW: thresholdW, diagnostics, wallboxes,
        energy: analyzeEnergy(input.energy, input.window)};
}

module.exports = {analyzeShadow, analyzeEnergy};
