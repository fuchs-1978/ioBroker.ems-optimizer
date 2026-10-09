'use strict';

const {createHash} = require('node:crypto');
const {DecisionRecordDecoder} = require('../lib/decision-record-codec');

function integer(value, name, minimum = 1) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
    return value;
}

/** Read raw history sequentially through an injected read-only transport.
 * No SQL connection/configuration or actuator API is supplied by this module.
 * Sinks can persist each bounded page without retaining a day's payload here.
 */
async function readDecisionRecordHistory({readHistory, start, end, windowMs = 15000, limit = 80, basisLookbackMs = 60000,
    maxRequests = 20000, maxIdentities = 1000000, maxSessions = 128, maxErrorDepth = 3,
    queryTimeoutMs = 30000, retryErrors = false,
    onRawPage = async () => {}, onRecords = async () => {}, onQuery = async () => {}, onReport = async () => {}} = {}) {
    if (typeof readHistory !== 'function') throw new Error('readHistory must be a function');
    for (const [name, value] of Object.entries({start, end})) integer(value, name, 0);
    integer(basisLookbackMs, 'basisLookbackMs', 0);
    if (end < start) throw new Error('end precedes start');
    for (const [name, value] of Object.entries({windowMs, limit, maxRequests, maxIdentities, maxSessions, maxErrorDepth, queryTimeoutMs}))
        integer(value, name);
    if (queryTimeoutMs > 60000) throw new Error('queryTimeoutMs must not exceed 60000');
    if (typeof retryErrors !== 'boolean') throw new Error('retryErrors must be boolean');
    for (const sink of [onRawPage, onRecords, onQuery, onReport]) if (typeof sink !== 'function') throw new Error('sinks must be functions');
    const readStart = Math.max(0, start - basisLookbackMs);
    const report = {start, end, readStart, basisLookbackMs, windowMs, limit, queryCount: 0, successfulWindows: 0,
        rawRows: 0, emittedRows: 0, payloadBytes: 0, duplicates: 0, conflictingDuplicates: 0,
        malformedRecords: 0, missingIdentity: 0, sequenceGaps: 0, missingSequences: 0,
        sequenceReversals: 0, unknownReplayRecords: 0, unknownBasisRecords: 0,
        recordingCountersMissing: 0, counterRegressions: 0, failedWindows: [], sessions: [],
        queryCoverageComplete: false, sequenceContinuityValid: false, replayValid: false,
        retentionVerified: false, storageCompleteness: 'not_proven_by_history_queries', stoppedReason: ''};
    const identities = new Map(), sessions = new Map();
    let capacityReached = false;

    async function accept(rows) {
        const emitted = [];
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
            if (session.decoder.decode(frame).reconstruction?.valid === false)
                report[row.ts >= start ? 'unknownReplayRecords' : 'unknownBasisRecords']++;
            emitted.push(row);
        }
        await onRecords(emitted);
        report.emittedRows += emitted.length;
    }

    function miss(from, to, reason) { report.failedWindows.push({start: from, end: to, reason}); }
    async function window(from, to, errorDepth = 0) {
        if (report.stoppedReason) { miss(from, to, report.stoppedReason); return; }
        if (capacityReached || report.queryCount >= maxRequests) {
            miss(from, to, capacityReached ? 'identity/session capacity reached' : 'request capacity reached');
            capacityReached = true;
            return;
        }
        const request = {start: from, end: to, limit, aggregate: 'none', ignoreNull: false};
        const query = {number: ++report.queryCount, ...request};
        const began = performance.now();
        let rows, failure, saturated = false, timedOut = false, timer;
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
            if (response?.error) throw new Error(String(response.error));
            rows = Array.isArray(response) ? response : response?.result;
            if (!Array.isArray(rows)) throw new Error('history response contains no raw result array');
            if (rows.some(row => !row || !Number.isSafeInteger(row.ts) || row.ts < from || row.ts > to
                || !Object.hasOwn(row, 'val'))) throw new Error('history response contains invalid/outside-window raw rows');
            saturated = rows.length >= limit || response?.truncated === true || response?.hasMore === true;
        } catch (error) { failure = error.message; rows = undefined; }
        finally { clearTimeout(timer); }
        query.elapsedMs = performance.now() - began;
        query.rows = rows?.length ?? 0;
        query.payloadBytes = rows?.reduce((total, row) => total
            + Buffer.byteLength(typeof row.val === 'string' ? row.val : JSON.stringify(row.val)), 0) ?? 0;
        query.outcome = failure ? 'error' : saturated ? 'limit' : 'complete';
        if (failure) query.error = failure;
        await onQuery(query);
        if (rows) {
            // Archive even a truncated parent page before splitting, together
            // with its request. This preserves provenance and raw SQL clocks.
            await onRawPage({query, rows});
            report.rawRows += rows.length;
            report.payloadBytes += query.payloadBytes;
        }
        if (failure || saturated) {
            // A connector rejection alone need not terminate its backend SQL
            // request. Only an explicit caller guarantee permits error retries.
            // A local deadline always stops: AbortSignal is a request to cancel,
            // never evidence that an uncooperative backend actually stopped.
            if (failure && (timedOut || !retryErrors)) {
                report.stoppedReason = failure;
                miss(from, to, failure);
                return;
            }
            if (to - from <= 1 || (failure && errorDepth >= maxErrorDepth)) {
                miss(from, to, failure || 'limit reached in indivisible millisecond window');
                if (rows) await accept(rows);
                return;
            }
            const middle = Math.floor((from + to) / 2);
            await window(from, middle, failure ? errorDepth + 1 : 0);
            await window(middle, to, failure ? errorDepth + 1 : 0);
            return;
        }
        await accept(rows);
        if (capacityReached) miss(from, to, 'identity/session capacity reached');
        else report.successfulWindows++;
    }

    for (let from = readStart; from <= end;) {
        const to = Math.min(end, from + windowMs);
        await window(from, to);
        if ((capacityReached || report.stoppedReason) && to < end) {
            miss(to, end, report.stoppedReason || 'capacity reached before remaining window'); break;
        }
        if (to === end) break;
        from = to; // Inclusive border overlap; exact identities are deduplicated.
    }
    report.sessions = [...sessions.values()].map(({decoder, previousCounters, ...session}) => session);
    report.queryCoverageComplete = report.failedWindows.length === 0;
    report.sequenceContinuityValid = report.queryCoverageComplete && report.missingIdentity === 0 && report.conflictingDuplicates === 0
        && report.sequenceGaps === 0 && report.sequenceReversals === 0 && report.emittedRows > 0 && !capacityReached;
    report.replayValid = report.queryCoverageComplete && report.unknownReplayRecords === 0 && report.conflictingDuplicates === 0
        && report.emittedRows > 0 && !capacityReached;
    await onReport(report);
    return report;
}

module.exports = {readDecisionRecordHistory};
