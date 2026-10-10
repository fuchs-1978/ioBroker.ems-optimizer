'use strict';

const {createHash} = require('node:crypto');
const {DecisionRecordDecoder} = require('../lib/decision-record-codec');

function integer(value, name, minimum = 1) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
    return value;
}

function originalError(error, origin = 'thrown') {
    return {name: typeof error?.name === 'string' ? error.name : null,
        message: typeof error?.message === 'string' ? error.message : String(error),
        original: String(error), origin};
}

function observeResponse(query, response, metadata = response?.transport) {
    query.responseCharacters = typeof metadata?.responseText === 'string' ? metadata.responseText.length : null;
    query.wireBytes = Number.isSafeInteger(metadata?.wireBytes) && metadata.wireBytes >= 0 ? metadata.wireBytes : null;
    query.parseStatus = ['parsed', 'failed', 'unknown'].includes(metadata?.parseStatus) ? metadata.parseStatus : 'unknown';
    query.backendCompletion = metadata?.backendCompletion === 'observed'
        && typeof metadata.backendCompletionEvidence === 'string' && metadata.backendCompletionEvidence.trim()
        ? 'observed' : 'unknown';
    query.backendCompletionEvidence = query.backendCompletion === 'observed' ? metadata.backendCompletionEvidence : null;
    query.truncated = typeof response?.truncated === 'boolean' ? response.truncated : null;
    query.hasMore = typeof response?.hasMore === 'boolean' ? response.hasMore : null;
    try {
        const normalized = Array.isArray(response) ? response : response && typeof response === 'object'
            ? Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'transport')) : response;
        const text = JSON.stringify(normalized);
        query.normalizedResponseCharacters = typeof text === 'string' ? text.length : null;
    } catch {query.normalizedResponseCharacters = null;}
}

function recordParse(rows) {
    const result = {nullValues: 0, invalidJson: 0, objectValues: 0, otherValues: 0};
    for (const row of rows) {
        let value = row?.val;
        if (typeof value === 'string') {
            try {value = JSON.parse(value);} catch {result.invalidJson++; continue;}
        }
        if (value === null) result.nullValues++;
        else if (value && typeof value === 'object' && !Array.isArray(value)) result.objectValues++;
        else result.otherValues++;
    }
    return result;
}

function payloadBytes(rows) {
    return rows.reduce((total, row) => {
        try {
            const text = typeof row?.val === 'string' ? row.val : JSON.stringify(row?.val);
            return total + (typeof text === 'string' ? Buffer.byteLength(text) : 0);
        } catch {return total;}
    }, 0);
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}

function validSession(value) {
    return typeof value === 'string' && value.length > 0 || typeof value === 'number' && Number.isFinite(value);
}

/** Read raw history sequentially through an injected read-only transport.
 * No SQL connection/configuration or actuator API is supplied by this module.
 * Sinks can persist each bounded page without retaining a day's payload here.
 */
async function readDecisionRecordHistory({readHistory, start, end, windowMs = 2000, limit = 32, basisLookbackMs = 60000,
    maxRequests = 64, maxIdentities = 1000000, maxSourceSamples = 1000000, maxSessions = 128, maxErrorDepth = 3,
    queryTimeoutMs = 30000, retryErrors = false, maxRunMs = 60000, minGapMs = 1000,
    adaptiveWindow = true, slowQueryMs = 10000,
    onRawPage = async () => {}, onRecords = async () => {}, onQueryStart = async () => {},
    onSourceSamples = async () => {}, onQuery = async () => {}, onReport = async () => {}} = {}) {
    if (typeof readHistory !== 'function') throw new Error('readHistory must be a function');
    for (const [name, value] of Object.entries({start, end})) integer(value, name, 0);
    integer(basisLookbackMs, 'basisLookbackMs', 0);
    if (end < start) throw new Error('end precedes start');
    for (const [name, value] of Object.entries({windowMs, limit, maxRequests, maxIdentities, maxSourceSamples, maxSessions, maxErrorDepth,
        queryTimeoutMs, slowQueryMs}))
        integer(value, name);
    integer(minGapMs, 'minGapMs', 0);
    if (maxRunMs !== Infinity) integer(maxRunMs, 'maxRunMs');
    if (queryTimeoutMs > 60000) throw new Error('queryTimeoutMs must not exceed 60000');
    if (typeof retryErrors !== 'boolean') throw new Error('retryErrors must be boolean');
    if (typeof adaptiveWindow !== 'boolean') throw new Error('adaptiveWindow must be boolean');
    for (const sink of [onRawPage, onRecords, onQueryStart, onSourceSamples, onQuery, onReport])
        if (typeof sink !== 'function') throw new Error('sinks must be functions');
    const readStart = Math.max(0, start - basisLookbackMs);
    const report = {start, end, readStart, basisLookbackMs, windowMs, limit, maxRequests, maxRunMs, minGapMs,
        adaptiveWindow, slowQueryMs, windowAdjustments: [], queryCount: 0, issuedQueries: 0, successfulWindows: 0,
        rawRows: 0, emittedRows: 0, payloadBytes: 0, duplicates: 0, conflictingDuplicates: 0,
        malformedRecords: 0, missingIdentity: 0, sequenceGaps: 0, missingSequences: 0,
        sequenceReversals: 0, unknownReplayRecords: 0, unknownBasisRecords: 0,
        recordingCountersMissing: 0, counterRegressions: 0, failedWindows: [], sessions: [],
        sourceObservations: {rawSamples: 0, emittedSamples: 0, unique: 0, duplicates: 0,
            conflictingDuplicates: 0, missingIdentity: 0, malformedSamples: 0, intervalSummaries: 0,
            malformedIntervals: 0, intervalResolutionMinMs: null, intervalResolutionMaxMs: null,
            sampling: {continuousDeclaredRecords: 0, sampledDeclaredRecords: 0,
                legacySamplingRecords: 0, unknownRecords: 0}, capacityReached: false, sessions: [],
            sequenceContinuityWithinObservedSpan: false,
            coverage: 'original received probes only; no leading/trailing coverage or simultaneous cache decision is inferred'},
        queryCoverageComplete: false, sequenceContinuityValid: false, replayValid: false,
        retentionVerified: false, storageCompleteness: 'not_proven_by_history_queries', stoppedReason: '', resumeCursor: null};
    const identities = new Map(), sessions = new Map();
    const sourceIdentities = new Map(), sourceSessions = new Map();
    const runBegan = performance.now();
    let capacityReached = false, activeWindowMs = windowMs, lastIssuedAt = null, blockedByUnknownBackend = false;

    function sourceRecord(row, frame, decoded, emitted) {
        if (!frame || typeof frame !== 'object') return;
        const sourceReport = report.sourceObservations;
        const sampling = decoded && decoded.reconstruction?.valid !== false ? decoded.sampling : null;
        const declaration = sampling?.rawSourcesContinuous === true ? 'continuousDeclaredRecords'
            : sampling?.rawSourcesContinuous === false ? 'sampledDeclaredRecords'
            : sampling && typeof sampling === 'object' ? 'legacySamplingRecords' : 'unknownRecords';
        sourceReport.sampling[declaration]++;
        const event = frame.event;
        if (event?.type === 'recording.interval') {
            sourceReport.intervalSummaries++;
            const summary = event.summary;
            if (!summary || typeof summary !== 'object' || Array.isArray(summary)) sourceReport.malformedIntervals++;
            const resolution = summary?.resolutionMs;
            if (Number.isFinite(resolution) && resolution > 0) {
                sourceReport.intervalResolutionMinMs = Math.min(sourceReport.intervalResolutionMinMs ?? resolution, resolution);
                sourceReport.intervalResolutionMaxMs = Math.max(sourceReport.intervalResolutionMaxMs ?? resolution, resolution);
            }
        }
        const samples = ['recording.sources', 'recording.pre_event'].includes(event?.type)
            ? Array.isArray(event.samples) ? event.samples : [] : event?.type === 'source.update' ? [event] : [];
        for (const sample of samples) {
            sourceReport.rawSamples++;
            const entry = {recordSession: frame.recordSession, sample,
                provenance: {recordSequence: frame.recordSequence, sqlTs: row.ts,
                    frameTimestamp: frame.timestamp, eventType: event.type}};
            const identified = validSession(frame.recordSession) && Number.isSafeInteger(sample?.sampleSequence)
                && sample.sampleSequence >= 1;
            if (!sample || typeof sample !== 'object' || typeof sample.id !== 'string' || !sample.id
                || !Number.isFinite(sample.receivedAt) || !Object.hasOwn(sample, 'state')) sourceReport.malformedSamples++;
            if (!identified) {sourceReport.missingIdentity++; emitted.push(entry); continue;}
            // Parent frame/type/sequence and property order cannot turn the same
            // original pre-event/source/update observation into a conflict.
            const key = JSON.stringify([frame.recordSession, sample.sampleSequence]);
            const signature = createHash('sha256').update(JSON.stringify(canonical({id: sample.id,
                state: sample.state, receivedAt: sample.receivedAt}))).digest('hex');
            if (sourceIdentities.has(key)) {
                if (sourceIdentities.get(key) === signature) {sourceReport.duplicates++; continue;}
                sourceReport.conflictingDuplicates++; emitted.push(entry); continue;
            }
            const sessionKey = JSON.stringify(frame.recordSession);
            if (sourceIdentities.size >= maxSourceSamples || !sourceSessions.has(sessionKey) && sourceSessions.size >= maxSessions) {
                sourceReport.capacityReached = true; capacityReached = true; break;
            }
            sourceIdentities.set(key, signature);
            if (!sourceSessions.has(sessionKey)) sourceSessions.set(sessionKey, {recordSession: frame.recordSession,
                firstSequence: sample.sampleSequence, lastSequence: sample.sampleSequence, unique: 0,
                missingSequencesInsideObservedSpan: 0});
            const session = sourceSessions.get(sessionKey);
            session.firstSequence = Math.min(session.firstSequence, sample.sampleSequence);
            session.lastSequence = Math.max(session.lastSequence, sample.sampleSequence);
            session.unique++; sourceReport.unique++; emitted.push(entry);
        }
    }

    async function accept(rows) {
        const emitted = [], sourceSamples = [];
        // SQL timestamps determine page membership. Sequence resolves equal-ms
        // rows; the original SQL ts and event/source timestamps stay untouched.
        const parsed = rows.map(row => {
            let frame = row.val;
            try { if (typeof frame === 'string') frame = JSON.parse(frame); } catch { frame = null; }
            return {row, frame};
        }).sort((a, b) => a.row.ts - b.row.ts
            || (a.frame?.recordSession === b.frame?.recordSession
                ? (a.frame?.recordSequence || 0) - (b.frame?.recordSequence || 0) : 0));
        for (const {row, frame} of parsed) {
            const isObject = frame !== null && typeof frame === 'object' && !Array.isArray(frame);
            const hasIdentity = isObject && ((typeof frame.recordSession === 'string' && frame.recordSession.length > 0)
                || (typeof frame.recordSession === 'number' && Number.isFinite(frame.recordSession)))
                && Number.isSafeInteger(frame.recordSequence) && frame.recordSequence >= 1;
            if (!hasIdentity) {
                report.missingIdentity++;
                if (!isObject) report.malformedRecords++;
                report[row.ts >= start ? 'unknownReplayRecords' : 'unknownBasisRecords']++;
                emitted.push(row); // An unknown/null row is never converted to 0 or silently removed.
                sourceRecord(row, frame, null, sourceSamples);
                continue;
            }
            const key = JSON.stringify([frame.recordSession, frame.recordSequence]);
            const signature = createHash('sha256').update(JSON.stringify(frame)).digest('hex');
            if (identities.has(key)) {
                if (identities.get(key) === signature) { report.duplicates++; continue; }
                report.conflictingDuplicates++;
                // Preserve both conflicting originals for decoder preflight.
                // The report invalidates replay for the entire export.
                emitted.push(row);
                sourceRecord(row, frame, null, sourceSamples);
                continue;
            }
            if (identities.size >= maxIdentities) { capacityReached = true; break; }
            identities.set(key, signature);
            const sessionKey = JSON.stringify(frame.recordSession);
            if (!sessions.has(sessionKey)) {
                if (sessions.size >= maxSessions) { capacityReached = true; break; }
                sessions.set(sessionKey, {recordSession: frame.recordSession, firstSequence: frame.recordSequence,
                    lastSequence: null, records: 0, snapshots: 0, deltas: 0,
                    firstSqlTs: row.ts, lastSqlTs: row.ts, dropped: null, writeErrors: null,
                    recordingCountersMissing: 0, counterRegressions: 0, previousCounters: {},
                    decoder: new DecisionRecordDecoder()});
            }
            const session = sessions.get(sessionKey);
            if (session.lastSequence !== null) {
                if (frame.recordSequence <= session.lastSequence) report.sequenceReversals++;
                else if (frame.recordSequence > session.lastSequence + 1) {
                    report.sequenceGaps++;
                    report.missingSequences += frame.recordSequence - session.lastSequence - 1;
                }
            }
            session.lastSequence = frame.recordSequence;
            session.lastSqlTs = row.ts;
            session.records++;
            if (frame.frameType === 'snapshot') session.snapshots++;
            if (frame.frameType === 'delta') session.deltas++;
            for (const name of ['dropped', 'writeErrors']) {
                const value = frame.recording?.[name];
                if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                    if (session.previousCounters[name] !== undefined && value < session.previousCounters[name]) {
                        session.counterRegressions++;
                        report.counterRegressions++;
                    }
                    session.previousCounters[name] = value;
                    session[name] = Math.max(session[name] ?? 0, value);
                } else {
                    session.recordingCountersMissing++;
                    report.recordingCountersMissing++;
                }
            }
            const decoded = session.decoder.decode(frame);
            if (decoded.reconstruction?.valid === false)
                report[row.ts >= start ? 'unknownReplayRecords' : 'unknownBasisRecords']++;
            sourceRecord(row, frame, decoded, sourceSamples);
            emitted.push(row);
            if (capacityReached) break;
        }
        await onSourceSamples(sourceSamples);
        report.sourceObservations.emittedSamples += sourceSamples.length;
        await onRecords(emitted);
        report.emittedRows += emitted.length;
    }

    function miss(from, to, reason, query) {
        report.failedWindows.push({start: from, end: to, reason,
            ...(query ? {queryNumber: query.number, originalError: query.originalError,
                backendCompletion: query.backendCompletion} : {})});
    }
    function shrink(width, reason, query) {
        if (!adaptiveWindow || width <= 1) return;
        const next = Math.max(1, Math.min(activeWindowMs, Math.floor(width / 2)));
        if (next >= activeWindowMs) return;
        report.windowAdjustments.push({queryNumber: query.number, fromMs: activeWindowMs, toMs: next, reason});
        activeWindowMs = next;
    }
    async function pace() {
        while (lastIssuedAt !== null && performance.now() - lastIssuedAt < minGapMs)
            await new Promise(resolve => setTimeout(resolve, Math.ceil(minGapMs - (performance.now() - lastIssuedAt))));
    }
    async function window(from, to, errorDepth = 0) {
        if (report.stoppedReason) { miss(from, to, report.stoppedReason); return; }
        if (capacityReached || report.queryCount >= maxRequests) {
            miss(from, to, capacityReached ? 'identity/session capacity reached' : 'request capacity reached');
            capacityReached = true;
            return;
        }
        const gap = lastIssuedAt === null ? 0 : Math.max(0, minGapMs - (performance.now() - lastIssuedAt));
        if (performance.now() - runBegan + gap >= maxRunMs) {
            report.stoppedReason = 'local run budget exhausted; remaining windows not read';
            miss(from, to, report.stoppedReason); return;
        }
        await pace();
        const request = {start: from, end: to, limit, aggregate: 'none', ignoreNull: false};
        const query = {number: ++report.queryCount, ...request, requestedAtUTC: new Date().toISOString(),
            startedAtUTC: null, endedAtUTC: null, issued: false, responseCharacters: null, wireBytes: null,
            normalizedResponseCharacters: null, parseStatus: 'unknown', truncated: null, hasMore: null,
            backendCompletion: 'unknown', backendCompletionEvidence: null, originalError: null, recordParse: null};
        // A caller can durably append/fsync this exact request before issuing it.
        // A sink error propagates and leaves the whole unissued range open.
        await onQueryStart(structuredClone(query));
        if (performance.now() - runBegan >= maxRunMs) {
            report.stoppedReason = 'local run budget exhausted; remaining windows not read';
            query.outcome = 'not-issued'; query.elapsedMs = 0; query.rows = 0; query.payloadBytes = 0;
            query.endedAtUTC = new Date().toISOString();
            await onQuery(query);
            miss(from, to, report.stoppedReason, query); return;
        }
        const began = performance.now();
        query.startedAtUTC = new Date().toISOString(); query.issued = true;
        lastIssuedAt = began; report.issuedQueries++;
        let rows, rawRows, failure, saturated = false, timedOut = false, timer;
        const controller = new AbortController();
        try {
            const deadline = new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                    reject(new Error('local query deadline; backend completion unknown; retrieval stopped'));
                }, queryTimeoutMs);
            });
            const response = await Promise.race([Promise.resolve().then(() => readHistory({...request,
                signal: controller.signal})), deadline]);
            observeResponse(query, response);
            rawRows = Array.isArray(response) ? response : response?.result;
            if (!Array.isArray(rawRows)) rawRows = undefined;
            if (response?.error) {
                query.originalError = originalError(response.error, 'response.error');
                throw response.error;
            }
            if (query.parseStatus === 'failed') throw new Error('history response transport parse failed');
            rows = rawRows;
            if (!Array.isArray(rows)) throw new Error('history response contains no raw result array');
            if (rows.some(row => !row || !Number.isSafeInteger(row.ts) || row.ts < from || row.ts > to
                || !Object.hasOwn(row, 'val'))) throw new Error('history response contains invalid/outside-window raw rows');
            saturated = rows.length >= limit || response?.truncated === true || response?.hasMore === true;
        } catch (error) {
            if (!query.originalError) query.originalError = originalError(error);
            if (error?.transport) observeResponse(query, undefined, error.transport);
            if (error?.name === 'SyntaxError') query.parseStatus = 'failed';
            if (timedOut) {query.backendCompletion = 'unknown'; query.backendCompletionEvidence = null;}
            failure = query.originalError.message; rows = undefined;
        }
        finally { clearTimeout(timer); }
        query.endedAtUTC = new Date().toISOString();
        query.elapsedMs = performance.now() - began;
        query.rows = rawRows?.length ?? 0;
        query.payloadBytes = rawRows ? payloadBytes(rawRows) : 0;
        query.recordParse = rawRows ? recordParse(rawRows) : null;
        query.outcome = failure ? 'error' : saturated ? 'limit' : 'complete';
        if (failure) {
            query.error = failure;
            // Retain this guard even if persisting the finished query fails.
            // A broken local journal cannot make an unknown backend safe.
            if (timedOut || query.backendCompletion !== 'observed') blockedByUnknownBackend = true;
        }
        await onQuery(query);
        if (rawRows) {
            // Archive even a truncated parent page before splitting, together
            // with its request. This preserves provenance and raw SQL clocks.
            await onRawPage({query, rows: rawRows});
            report.rawRows += rawRows.length;
            report.payloadBytes += query.payloadBytes;
        }
        if (failure || saturated) {
            // A connector rejection alone need not terminate its backend SQL
            // request. Retry permission also requires an independently observed
            // completion plus its evidence on this specific response/error.
            // A local deadline always stops: AbortSignal is a request to cancel,
            // never evidence that an uncooperative backend actually stopped.
            if (failure && (timedOut || !retryErrors || query.backendCompletion !== 'observed')) {
                report.stoppedReason = failure;
                blockedByUnknownBackend = timedOut || query.backendCompletion !== 'observed';
                miss(from, to, failure, query);
                return;
            }
            if (to - from <= 1 || (failure && errorDepth >= maxErrorDepth)) {
                miss(from, to, failure || 'limit reached in indivisible millisecond window', query);
                if (rows) await accept(rows);
                return;
            }
            shrink(to - from, failure ? 'confirmed_error_division' : 'saturated_response', query);
            const middle = Math.floor((from + to) / 2);
            await window(from, middle, failure ? errorDepth + 1 : 0);
            await window(middle, to, failure ? errorDepth + 1 : 0);
            return;
        }
        if (query.elapsedMs >= slowQueryMs) shrink(to - from, 'slow_completed_response', query);
        await accept(rows);
        if (capacityReached) miss(from, to, 'identity/session capacity reached');
        else report.successfulWindows++;
    }

    let currentFrom = readStart, sinkFailure;
    try {
        for (let from = readStart; from <= end;) {
            currentFrom = from;
            const to = Math.min(end, from + activeWindowMs);
            await window(from, to);
            if ((capacityReached || report.stoppedReason) && to < end) {
                miss(to, end, report.stoppedReason || 'capacity reached before remaining window'); break;
            }
            if (to === end) break;
            from = to; // Inclusive border overlap; exact identities are deduplicated.
        }
    } catch (error) {
        sinkFailure = error;
        report.stoppedReason = `local sink/processing failure: ${originalError(error).message}`;
        miss(currentFrom, end, report.stoppedReason);
    }
    report.sessions = [...sessions.values()].map(({decoder, previousCounters, ...session}) => session);
    report.sourceObservations.sessions = [...sourceSessions.values()].map(session => ({...session,
        missingSequencesInsideObservedSpan: session.lastSequence - session.firstSequence + 1 - session.unique}));
    report.sourceObservations.sequenceContinuityWithinObservedSpan = report.sourceObservations.unique > 0
        && report.sourceObservations.missingIdentity === 0 && report.sourceObservations.conflictingDuplicates === 0
        && report.sourceObservations.malformedSamples === 0 && !report.sourceObservations.capacityReached
        && report.sourceObservations.sessions.every(session => session.missingSequencesInsideObservedSpan === 0);
    report.queryCoverageComplete = report.failedWindows.length === 0;
    report.sequenceContinuityValid = report.queryCoverageComplete && report.missingIdentity === 0 && report.conflictingDuplicates === 0
        && report.sequenceGaps === 0 && report.sequenceReversals === 0 && report.emittedRows > 0 && !capacityReached;
    report.replayValid = report.queryCoverageComplete && report.unknownReplayRecords === 0 && report.conflictingDuplicates === 0
        && report.emittedRows > 0 && !capacityReached;
    report.finalWindowMs = activeWindowMs;
    report.resumeCursor = report.failedWindows.length ? {
        nextStart: report.failedWindows.reduce((minimum, window) => Math.min(minimum, window.start), Infinity),
        end, originalStart: start,
        basisLookbackMs, blockedByUnknownBackend,
        contract: 'candidate only; preserve prior pages and validate session/sequence/basis across runs'} : null;
    await onReport(report);
    if (sinkFailure) throw sinkFailure;
    return report;
}

module.exports = {readDecisionRecordHistory};
