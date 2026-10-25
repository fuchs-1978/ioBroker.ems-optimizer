'use strict';

// Passive metadata only. Never retain SQL text, raw records, arbitrary errors,
// source IDs or credentials. This checkpoint does not authorize recovery.
const MAX_ENTRIES = 16, MAX_BYTES = 16384;
const REASONS = ['deadline', 'transport-rejection', 'sql-response-error', 'invalid-response',
    'local-journal', 'proof-processing', 'completion-unknown'];
const PHASES = ['journal-begin', 'transport', 'journal-complete', 'response-validation', 'proof-processing'];
const NUMBERS = ['start', 'end', 'limit', 'beganAt', 'failureAt', 'journalBeginAt', 'journalBeginMs',
    'transportAt', 'callbackAt', 'transportWaitMs', 'transportSettledAt', 'fenceCompletedAt',
    'fenceCompleteMs', 'deadlineAt', 'deadlineOverrunMs', 'journalQueuedOperations',
    'journalPendingRecords', 'journalPendingBytes'];
const BOOLEANS = ['issued', 'backendCompletionObserved', 'localIssuanceCancelled'];
const LATE_NUMBERS = ['lateResponseAt', 'lateProcessedAt', 'lateConfirmedRecords'];
const LATE_OUTCOMES = ['complete', 'limit', 'completion-unknown', 'stopped', 'not-issued',
    'sql-response-error', 'local-journal', 'proof-processing', 'transport-rejection', 'invalid-response'];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
    && value <= Number.MAX_SAFE_INTEGER ? value : null;
const copy = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
        .map(key => [key, canonical(value[key])])) : value;
function clean(query, reason, phase, failureAt) {
    if (!/^decision-record:[A-Za-z0-9-]{1,80}$/.test(query?.verificationId || '')
        || !REASONS.includes(reason) || !PHASES.includes(phase)) return null;
    return {verificationId: query.verificationId, reason, phase,
        ...Object.fromEntries(NUMBERS.map(key => [key, number(key === 'failureAt' ? failureAt : query[key])])),
        ...Object.fromEntries(BOOLEANS.map(key => [key, query[key] === true])),
        // Optional additions keep existing schema1 checkpoints strictly readable.
        ...Object.fromEntries(LATE_NUMBERS.filter(key => Object.hasOwn(query, key))
            .map(key => [key, number(query[key])])),
        ...(LATE_OUTCOMES.includes(query.lateOutcome) ? {lateOutcome: query.lateOutcome} : {})};
}

class SqlQueryFailures {
    constructor(saved = null) {
        this.failures = []; this.evicted = 0; this.revision = 0; this.checkpointStatus = 'new';
        if (!saved) return;
        try {
            if (typeof saved !== 'string' || Buffer.byteLength(saved) > MAX_BYTES) throw new Error('size');
            const data = JSON.parse(saved);
            if (data.schema !== 1 || data.maxEntries !== MAX_ENTRIES || data.maxBytes !== MAX_BYTES
                || !Number.isSafeInteger(data.evicted) || data.evicted < 0
                || !Array.isArray(data.failures) || data.failures.length > MAX_ENTRIES)
                throw new Error('header');
            const ids = new Set();
            const failures = data.failures.map(item => {
                const projected = clean(item, item.reason, item.phase, item.failureAt);
                if (!projected || ids.has(item.verificationId)
                    || JSON.stringify(canonical(projected)) !== JSON.stringify(canonical(item)))
                    throw new Error('entry');
                ids.add(item.verificationId); return projected;
            });
            this.failures = failures; this.evicted = data.evicted; this.checkpointStatus = 'restored';
        } catch { this.checkpointStatus = 'invalid'; }
    }
    report() {
        return {schema: 1, maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES, evicted: this.evicted,
            checkpointStatus: this.checkpointStatus, failures: copy(this.failures)};
    }
    capture(query, reason, phase, failureAt) {
        const item = clean(query, reason, phase, failureAt);
        if (!item || this.failures.some(value => value.verificationId === item.verificationId)) return;
        this.failures.push(item); this.revision++; this.bound();
    }
    bound() {
        while (this.failures.length > MAX_ENTRIES || Buffer.byteLength(JSON.stringify(this.report())) > MAX_BYTES) {
            this.failures.shift(); this.evicted = Math.min(Number.MAX_SAFE_INTEGER, this.evicted + 1);
        }
    }
    update(query) {
        const index = this.failures.findIndex(item => item.verificationId === query.verificationId);
        if (index < 0) return;
        const old = this.failures[index], item = clean(query, old.reason, old.phase, old.failureAt);
        if (JSON.stringify(old) !== JSON.stringify(item)) {
            this.failures[index] = item; this.revision++; this.bound();
        }
    }
}
SqlQueryFailures.MAX_BYTES = MAX_BYTES;
module.exports = SqlQueryFailures;
