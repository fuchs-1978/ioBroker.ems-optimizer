'use strict';

// The codec only changes diagnostic serialization. No field is interpreted as
// an electrical observation, and no regulator consumes a reconstructed frame.
const ENVELOPE_KEYS = ['recordSession', 'recordSequence', 'timestamp', 'cycleId',
    'adapterVersion', 'masterEnabled', 'mode', 'event', 'recording'];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 128;

function persisted(value) {
    return JSON.parse(JSON.stringify(value));
}

function safeData(value, depth = 0) {
    if (depth > MAX_DEPTH) return false;
    if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object') return false;
    return Object.keys(value).every(key => !FORBIDDEN_KEYS.has(key) && safeData(value[key], depth + 1));
}

function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sequence(value) { return Number.isSafeInteger(value) && value >= 1; }
function session(value) {
    return (typeof value === 'string' && value.length > 0)
        || (typeof value === 'number' && Number.isFinite(value));
}
function metadata(record) {
    return session(record.recordSession) && sequence(record.recordSequence)
        && typeof record.timestamp === 'number' && Number.isFinite(record.timestamp);
}

function split(record) {
    const envelope = {};
    const data = {};
    for (const [key, value] of Object.entries(record)) {
        if (key === 'schema') continue;
        if (ENVELOPE_KEYS.includes(key)) envelope[key] = value;
        else data[key] = value;
    }
    return {envelope, data};
}

function diff(before, after, path = [], operations = []) {
    if (equal(before, after)) return operations;
    const matchingArrays = Array.isArray(before) && Array.isArray(after) && before.length === after.length;
    if (matchingArrays) {
        for (let i = 0; i < after.length; i++) diff(before[i], after[i], [...path, i], operations);
    } else if (object(before) && object(after)) {
        for (const key of Object.keys(before)) {
            if (!Object.hasOwn(after, key)) operations.push({op: 'delete', path: [...path, key]});
        }
        for (const key of Object.keys(after)) {
            if (!Object.hasOwn(before, key)) operations.push({op: 'set', path: [...path, key], value: after[key]});
            else diff(before[key], after[key], [...path, key], operations);
        }
    } else {
        operations.push({op: 'set', path, value: after});
    }
    return operations;
}

function applyOperations(before, operations) {
    if (!Array.isArray(operations)) throw new Error('Delta ops fehlt oder ist ungueltig');
    let result = persisted(before);
    for (const operation of operations) {
        if (!object(operation) || !['set', 'delete'].includes(operation.op)
            || !Array.isArray(operation.path) || operation.path.length > MAX_DEPTH
            || operation.path.some(key => !(typeof key === 'string' || Number.isSafeInteger(key))
                || FORBIDDEN_KEYS.has(key) || typeof key === 'number' && key < 0)) {
            throw new Error('Ungueltige Delta-Operation');
        }
        if (operation.op === 'set' && (!Object.hasOwn(operation, 'value') || !safeData(operation.value)))
            throw new Error('Ungueltiger Delta-Wert');
        if (operation.path.length === 0) {
            if (operation.op !== 'set' || !object(operation.value)) throw new Error('Ungueltiger Delta-Wurzelwert');
            result = persisted(operation.value);
            continue;
        }
        let target = result;
        for (const key of operation.path.slice(0, -1)) {
            if (!validKey(target, key) || !Object.hasOwn(target, key)) throw new Error('Delta-Pfad fehlt');
            target = target[key];
        }
        const key = operation.path.at(-1);
        if (!validKey(target, key)) throw new Error('Ungueltiger Delta-Pfad');
        if (operation.op === 'delete') {
            if (Array.isArray(target) || !Object.hasOwn(target, key)) throw new Error('Ungueltige Delta-Loeschung');
            delete target[key];
        } else {
            Object.defineProperty(target, key, {value: persisted(operation.value), enumerable: true,
                configurable: true, writable: true});
        }
    }
    if (!safeData(result)) throw new Error('Ungueltiges Delta-Ergebnis');
    return result;
}

function validKey(target, key) {
    if (Array.isArray(target)) return Number.isSafeInteger(key) && key >= 0 && key < target.length;
    return object(target) && typeof key === 'string' && !FORBIDDEN_KEYS.has(key);
}

class DecisionRecordEncoder {
    constructor({checkpointMs = 30000} = {}) {
        if (!Number.isFinite(checkpointMs) || checkpointMs <= 0) throw new Error('checkpointMs muss positiv sein');
        this.checkpointMs = checkpointMs;
        this.reset();
    }

    reset() { this.previous = null; this.checkpointSequence = null; this.checkpointAt = null; }

    encode(input) {
        const record = persisted(input);
        // Legacy shadow records stay self-contained. They can never accidentally
        // become the baseline of a productive delta stream.
        if (record.schema !== 2) { this.reset(); return record; }
        if (!object(record) || !metadata(record) || !safeData(record)) {
            this.reset();
            throw new Error('Produktivrecord besitzt keine sicheren Session-/Sequenz-/Zeitmetadaten');
        }
        const {envelope, data} = split(record);
        const previous = this.previous;
        let checkpoint = !previous || previous.recordSession !== record.recordSession
            || record.recordSequence !== previous.recordSequence + 1
            || record.timestamp < previous.timestamp
            || record.timestamp - this.checkpointAt >= this.checkpointMs
            || !equal(previous.mode, record.mode) || !equal(previous.masterEnabled, record.masterEnabled);
        const full = {schema: 3, frameType: 'snapshot', ...envelope,
            checkpointSequence: record.recordSequence, data};
        let frame = full;
        if (!checkpoint) {
            const delta = {schema: 3, frameType: 'delta', ...envelope,
                baseSequence: previous.recordSequence, checkpointSequence: this.checkpointSequence,
                ops: diff(split(previous).data, data)};
            if (JSON.stringify(delta).length < JSON.stringify(full).length) frame = delta;
            else checkpoint = true;
        }
        if (checkpoint) {
            this.checkpointSequence = record.recordSequence;
            this.checkpointAt = record.timestamp;
        }
        this.previous = record;
        return frame;
    }
}

class DecisionRecordDecoder {
    constructor() { this.reset(); }

    reset(reason = '') {
        this.previous = null; this.checkpointSequence = null; this.reason = reason;
        this.seenSequence = new Map();
    }

    unknown(frame, reason) {
        this.previous = null; this.checkpointSequence = null; this.reason = reason;
        const marker = {schema: 3, frameType: 'unknown', reconstruction: {valid: false, reason}};
        if (object(frame)) for (const key of ENVELOPE_KEYS) if (Object.hasOwn(frame, key)) marker[key] = frame[key];
        return marker;
    }

    decode(input) {
        let frame;
        try { frame = persisted(input); }
        catch { return this.unknown(null, 'Record ist kein JSON-persistierbarer Wert'); }
        if (!object(frame)) return this.unknown(frame, 'Record ist kein Objekt');
        if ([1, 2].includes(frame.schema)) {
            this.previous = null; this.checkpointSequence = null;
            this.reason = 'Legacy-Vollrecord unterbricht Delta-Basis';
            return frame;
        }
        if (frame.schema !== 3 || !['snapshot', 'delta'].includes(frame.frameType)
            || !metadata(frame) || !safeData(frame)) return this.unknown(frame, 'Ungueltiges kompaktes Recordformat');
        const sessionKey = JSON.stringify(frame.recordSession);
        if (frame.recordSequence <= (this.seenSequence.get(sessionKey) ?? 0))
            return this.unknown(frame, 'Doppelte oder ruecklaeufige Sequenz innerhalb derselben Session');
        this.seenSequence.set(sessionKey, frame.recordSequence);
        // Keep diagnostic memory bounded even when many adapter sessions appear.
        if (this.seenSequence.size > 128) this.seenSequence.delete(this.seenSequence.keys().next().value);
        const envelope = {};
        for (const key of ENVELOPE_KEYS) if (Object.hasOwn(frame, key)) envelope[key] = frame[key];
        let data;
        if (frame.frameType === 'snapshot') {
            if (frame.checkpointSequence !== frame.recordSequence || !object(frame.data)
                || Object.keys(frame.data).some(key => ENVELOPE_KEYS.includes(key) || key === 'schema'))
                return this.unknown(frame, 'Ungueltiger Vollsnapshot');
            data = frame.data;
        } else {
            const previous = this.previous;
            if (!previous) return this.unknown(frame, 'Delta ohne verfuegbaren Vollsnapshot');
            if (frame.recordSession !== previous.recordSession || frame.recordSequence !== previous.recordSequence + 1
                || frame.baseSequence !== previous.recordSequence || frame.checkpointSequence !== this.checkpointSequence
                || frame.timestamp < previous.timestamp || !equal(frame.mode, previous.mode)
                || !equal(frame.masterEnabled, previous.masterEnabled))
                return this.unknown(frame, 'Delta-Basis, Session, Sequenz oder Zeitbezug stimmt nicht');
            try { data = applyOperations(split(previous).data, frame.ops); }
            catch (error) { return this.unknown(frame, error.message); }
            if (Object.keys(data).some(key => ENVELOPE_KEYS.includes(key) || key === 'schema'))
                return this.unknown(frame, 'Delta ueberschreibt Recordmetadaten');
        }
        const reconstructed = {schema: 2, ...envelope, ...data};
        this.previous = reconstructed;
        this.checkpointSequence = frame.checkpointSequence;
        this.reason = '';
        return persisted(reconstructed);
    }
}

function decodeDecisionRecords(records) {
    if (!Array.isArray(records)) throw new Error('records muss ein Array sein');
    const decoder = new DecisionRecordDecoder();
    const prepared = records.map((entry, index) => {
        const wrapped = object(entry) && Object.hasOwn(entry, 'val');
        let record = wrapped ? entry.val : entry;
        let parseError = '';
        if (typeof record === 'string') {
            try { record = JSON.parse(record); }
            catch { record = null; parseError = 'Record-JSON unlesbar'; }
        }
        const identity = object(record) && metadata(record)
            ? JSON.stringify([record.recordSession, record.recordSequence]) : null;
        const sqlTime = wrapped && typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : null;
        const at = sqlTime ?? (object(record) && Number.isFinite(record.timestamp) ? record.timestamp : index);
        return {entry, wrapped, record, parseError, identity, at, index};
    });
    // Preflight every identity before decoding: a conflicting full checkpoint
    // must never briefly supply a seemingly valid baseline to later deltas.
    const signatures = new Map();
    const conflicts = new Set();
    for (const row of prepared) {
        if (row.identity === null) continue;
        const signature = JSON.stringify(row.record);
        if (signatures.has(row.identity) && signatures.get(row.identity) !== signature) conflicts.add(row.identity);
        else signatures.set(row.identity, signature);
    }
    const sessionOrder = new Map();
    for (const row of prepared) {
        if (row.identity === null) continue;
        row.sessionKey = JSON.stringify(row.record.recordSession);
        const previous = sessionOrder.get(row.sessionKey);
        if (!previous) sessionOrder.set(row.sessionKey, {at: row.at, index: row.index});
        else previous.at = Math.min(previous.at, row.at);
    }
    // Sequence is authoritative inside a session. Sorting only by timestamps
    // would invert a legitimate full checkpoint after an adapter clock jump.
    // Sessions are ordered by their earliest available SQL/event timestamp.
    prepared.sort((a, b) => (sessionOrder.get(a.sessionKey)?.at ?? a.at)
        - (sessionOrder.get(b.sessionKey)?.at ?? b.at)
        || (sessionOrder.get(a.sessionKey)?.index ?? a.index)
        - (sessionOrder.get(b.sessionKey)?.index ?? b.index)
        || (a.sessionKey !== undefined && a.sessionKey === b.sessionKey
            ? a.record.recordSequence - b.record.recordSequence : a.at - b.at)
        || a.index - b.index);
    const emitted = new Set();
    const decoded = [];
    for (const row of prepared) {
        if (row.identity !== null && emitted.has(row.identity)) continue;
        if (row.identity !== null) emitted.add(row.identity);
        const result = row.parseError ? decoder.unknown({timestamp: row.at}, row.parseError)
            : conflicts.has(row.identity) ? decoder.unknown(row.record, 'Widerspruechliche Duplikate derselben Session/Sequenz')
                : decoder.decode(row.record);
        decoded.push(row.wrapped && Object.hasOwn(row.entry, 'ts') ? {ts: row.entry.ts, val: result} : result);
    }
    return decoded;
}

module.exports = {DecisionRecordEncoder, DecisionRecordDecoder, decodeDecisionRecords};
