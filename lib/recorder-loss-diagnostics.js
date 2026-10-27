'use strict';

// Only scalar queue/timing metadata is admitted here. Never retain a raw frame,
// source identifier, command payload or arbitrary property from health files.
const MAX_EPISODES = 4;
const safe = value => Number.isSafeInteger(value) && value >= 0;
const number = value => safe(value) ? value : null;
const sum = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
const copy = value => structuredClone(value);
const canonical = value => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(canonical)
        : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fields = (value, keys) => Object.fromEntries(keys.map(key => [key, number(value?.[key])]));
const session = value => (safe(value) || typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value)) ? value : null;
const KINDS = ['maintenance', 'health', 'append', 'append-batch', 'read-batch', 'confirm-stored', 'replay', 'verification'];
const APPEND_PHASES = ['write-files', 'link-files', 'commit-directory-sync', 'unlink-temporaries', 'cleanup-directory-sync'];

function operation(value) {
    if (!value || !KINDS.includes(value.kind)) return null;
    const result = {kind: value.kind, ...fields(value, ['queuedAt', 'startedAt', 'waitMs', 'elapsedMs'])};
    if (APPEND_PHASES.includes(value.phase)) {
        result.phase = value.phase;
        Object.assign(result, fields(value, ['phaseStartedAt', 'phaseElapsedMs']));
        if (value.fileIO) result.fileIO = Object.fromEntries(['open', 'write', 'sync', 'close']
            .map(key => [key, safe(value.fileIO[key]) && value.fileIO[key] <= 4 ? value.fileIO[key] : null]));
    }
    return result;
}
function append(value) {
    if (!value) return null;
    return {...fields(value, ['records', 'bytes', 'elapsedMs', 'parallelFiles',
        'queuedAt', 'startedAt', 'completedAt', 'waitMs', 'appendMs']),
    ...(value.phases ? {phases: fields(value.phases, APPEND_PHASES)} : {})};
}
function active(value) {
    return value ? fields(value, ['queuedAt', 'startedAt', 'waitMs', 'elapsedMs',
        'records', 'rawBytes', 'firstSequence', 'lastSequence']) : null;
}
function queue(value) {
    return {...fields(value, ['records', 'bytes', 'maxRecords', 'maxBytes', 'oldestQueuedAt', 'oldestWaitMs']),
        active: active(value?.active)};
}
function context(value) {
    return {queue: queue(value?.queue), journal: {
        ...fields(value?.journal, ['pendingRecords', 'pendingBytes', 'queuedOperations']),
        activeOperation: operation(value?.journal?.activeOperation)},
    lastAppendBatch: append(value?.lastAppendBatch)};
}
function lastQueue(value) { return fields(value, ['records', 'bytes', 'oldestWaitMs']); }
function limits(value) { return {records: value?.records === true, bytes: value?.bytes === true}; }

class RecorderLossDiagnostics {
    constructor() {
        this.episodes = [];
        this.evictedEpisodes = 0; this.evictedRecords = 0; this.evictedRawBytes = 0;
    }

    snapshot() {
        return {schema: 1, maxEpisodes: MAX_EPISODES, evictedEpisodes: this.evictedEpisodes,
            evictedRecords: this.evictedRecords, evictedRawBytes: this.evictedRawBytes,
            episodes: copy(this.episodes)};
    }

    evictOldest() {
        const evicted = this.episodes.shift();
        if (!evicted) return false;
        this.evictedEpisodes = sum(this.evictedEpisodes, 1);
        this.evictedRecords = sum(this.evictedRecords, evicted.rejectedRecords);
        this.evictedRawBytes = sum(this.evictedRawBytes, evicted.rejectedRawBytes);
        return true;
    }

    record(value, count, journal) {
        if (value?.kind !== 'recorder-queue-full' || session(value.recordSession) === null
            || !safe(value.recordSequence) || value.recordSequence < 1 || count !== 1
            || !safe(value.rawBytes) || !safe(value.observedAt)) return;
        const hit = limits(value.limitsHit);
        if (!hit.records && !hit.bytes) return;
        const previous = this.episodes.at(-1);
        if (previous && previous.recordSession === value.recordSession
            && previous.lastSequence + 1 === value.recordSequence) {
            previous.lastSequence = value.recordSequence;
            previous.lastEventAt = number(value.eventAt); previous.lastObservedAt = value.observedAt;
            previous.rejectedRecords = sum(previous.rejectedRecords, count);
            previous.rejectedRawBytes = sum(previous.rejectedRawBytes, value.rawBytes);
            previous.limitsHit.records ||= hit.records; previous.limitsHit.bytes ||= hit.bytes;
            previous.lastQueue = lastQueue(value.queue);
            previous.peakQueue.records = Math.max(previous.peakQueue.records, number(value.queue?.records) ?? 0);
            previous.peakQueue.bytes = Math.max(previous.peakQueue.bytes, number(value.queue?.bytes) ?? 0);
            previous.peakQueue.oldestWaitMs = Math.max(previous.peakQueue.oldestWaitMs, number(value.queue?.oldestWaitMs) ?? 0);
            return;
        }
        if (this.episodes.length === MAX_EPISODES) {
            this.evictOldest();
        }
        this.episodes.push({recordSession: value.recordSession,
            firstSequence: value.recordSequence, lastSequence: value.recordSequence,
            firstEventAt: number(value.eventAt), lastEventAt: number(value.eventAt),
            firstObservedAt: value.observedAt, lastObservedAt: value.observedAt,
            rejectedRecords: count, rejectedRawBytes: value.rawBytes, limitsHit: hit,
            firstContext: context({queue: value.queue, journal, lastAppendBatch: journal?.lastAppendBatch}),
            lastQueue: lastQueue(value.queue), peakQueue: {
                records: number(value.queue?.records) ?? 0, bytes: number(value.queue?.bytes) ?? 0,
                oldestWaitMs: number(value.queue?.oldestWaitMs) ?? 0}});
    }

    restore(value) {
        if (!value || value.schema !== 1 || value.maxEpisodes !== MAX_EPISODES
            || !['evictedEpisodes', 'evictedRecords', 'evictedRawBytes'].every(key => safe(value[key]))
            || !Array.isArray(value.episodes) || value.episodes.length > MAX_EPISODES)
            throw new Error('invalid bounded recorder loss diagnostics');
        const episodes = value.episodes.map(item => {
            if (!item || session(item.recordSession) === null
                || !['firstSequence', 'lastSequence', 'firstObservedAt', 'lastObservedAt',
                    'rejectedRecords', 'rejectedRawBytes'].every(key => safe(item[key]))
                || item.firstSequence < 1 || item.lastSequence < item.firstSequence || item.rejectedRecords < 1
                || item.rejectedRecords !== item.lastSequence - item.firstSequence + 1)
                throw new Error('invalid recorder loss episode');
            const clean = {recordSession: item.recordSession,
                ...fields(item, ['firstSequence', 'lastSequence', 'firstEventAt', 'lastEventAt',
                    'firstObservedAt', 'lastObservedAt', 'rejectedRecords', 'rejectedRawBytes']),
                limitsHit: limits(item.limitsHit), firstContext: context(item.firstContext),
                lastQueue: lastQueue(item.lastQueue), peakQueue: lastQueue(item.peakQueue)};
            // The schema contains only finite bounded metadata. Invalid or
            // unexpected stored properties must not silently become evidence.
            if (JSON.stringify(canonical(clean)) !== JSON.stringify(canonical(item)))
                throw new Error('invalid recorder loss episode metadata');
            return clean;
        });
        const total = (evicted, retained) => retained.reduce((count, item) => sum(count, item.rejectedRecords), evicted);
        // health.json is examined first. An older surviving temporary cannot
        // replace a newer history; equal totals keep the committed checkpoint.
        if (total(value.evictedRecords, episodes) <= total(this.evictedRecords, this.episodes)) return;
        this.episodes = episodes;
        for (const key of ['evictedEpisodes', 'evictedRecords', 'evictedRawBytes']) this[key] = value[key];
    }
}

module.exports = RecorderLossDiagnostics;
