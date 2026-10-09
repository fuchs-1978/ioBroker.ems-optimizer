'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {DecisionRecordEncoder, decodeDecisionRecords} = require('../lib/decision-record-codec');
const {readDecisionRecordHistory} = require('../tools/read-decision-records');

function records(times, session = 'session') {
    const encoder = new DecisionRecordEncoder();
    return times.map((ts, i) => ({ts: ts + 1, val: JSON.stringify(encoder.encode({schema: 2,
        recordSession: session, recordSequence: i + 1, timestamp: ts, masterEnabled: true,
        mode: 'PRODUCTION', event: {type: 'command.attempt', commandId: `${session}:${i}`},
        recording: {dropped: 0, writeErrors: 0}, production: {actual_W: i % 2 ? null : 0,
            source: {ts: ts - 2, ack: i % 2 === 0, q: i % 3}, description: 'full basis '.repeat(100)}}))}));
}
function history(rows, fail = () => false) {
    return async request => {
        assert.equal(request.aggregate, 'none');
        assert.equal(request.ignoreNull, false);
        if (fail(request)) throw new Error('ioBroker did not answer in time');
        return {result: rows.filter(row => row.ts >= request.start && row.ts <= request.end).slice(0, request.limit)};
    };
}
async function collect(rows, options = {}) {
    const output = [], raw = [], queries = [];
    const report = await readDecisionRecordHistory({readHistory: history(rows), basisLookbackMs: 0,
        start: rows[0]?.ts ?? 0, end: rows.at(-1)?.ts ?? 100, onRecords: batch => output.push(...batch),
        onRawPage: page => raw.push(page), onQuery: query => queries.push(query), ...options});
    return {report, output, raw, queries};
}

test('24-hour simulated retrieval uses bounded windows, deduplicates borders and verifies two sessions', async () => {
    const day = 24 * 60 * 60 * 1000;
    const rows = [...records(Array.from({length: 145}, (_, i) => i * 300000), 'before-restart'),
        ...records(Array.from({length: 144}, (_, i) => (i + 145) * 300000), 'after-restart')];
    const {report, output, queries} = await collect(rows, {start: 1, end: day + 1, windowMs: 300000, limit: 4});
    assert.equal(report.queryCoverageComplete, true);
    assert.equal(report.sequenceContinuityValid, true);
    assert.equal(report.replayValid, true);
    assert.equal(report.retentionVerified, false, 'software fixture does not prove retention');
    assert.equal(report.storageCompleteness, 'not_proven_by_history_queries');
    assert.equal(report.sessions.length, 2);
    assert.equal(report.duplicates, 287);
    assert.deepEqual(output, rows, 'SQL clocks and original string payloads must stay exact');
    assert.ok(queries.every(query => query.end - query.start <= 300000 && query.rows <= 4));
    assert.equal(report.sequenceGaps, 0);
    assert.deepEqual(decodeDecisionRecords(output), decodeDecisionRecords(rows));
});

test('a saturated page is archived and split; timeout recovery is sequential and does not skip rows', async () => {
    const rows = records(Array.from({length: 12}, (_, i) => i * 10));
    let running = 0, peak = 0;
    const reader = history(rows, request => request.end - request.start > 70);
    const result = await collect(rows, {start: 0, end: 120, windowMs: 120, limit: 4,
        retryErrors: true,
        readHistory: async request => {
            peak = Math.max(peak, ++running);
            try { return await reader(request); } finally { running--; }
        }});
    assert.equal(peak, 1, 'no parallel retries while a query is outstanding');
    assert.ok(result.queries.some(query => query.outcome === 'error'));
    assert.ok(result.queries.some(query => query.outcome === 'limit'));
    assert.equal(result.report.queryCoverageComplete, true);
    assert.deepEqual(result.output, rows);
    assert.ok(result.raw.some(page => page.query.outcome === 'limit'));
});

test('60-second lookback obtains the full basis before the requested start', async () => {
    const rows = records([100000, 101000, 102000]);
    const {report, output} = await collect(rows, {start: rows[1].ts, end: rows[2].ts,
        basisLookbackMs: 60000, windowMs: 15000});
    assert.equal(report.readStart, rows[1].ts - 60000);
    assert.equal(report.replayValid, true);
    assert.deepEqual(output, rows);
    const withoutBasis = await collect(rows, {start: rows[1].ts, end: rows[2].ts});
    assert.equal(withoutBasis.report.queryCoverageComplete, true);
    assert.equal(withoutBasis.report.replayValid, false);
    assert.equal(withoutBasis.report.unknownReplayRecords, 2);
});

test('unavailable history, invalid rows and millisecond limit collisions stay explicit blockers', async () => {
    const rows = records([10, 10, 10]);
    const saturated = await collect(rows, {limit: 2});
    assert.equal(saturated.report.queryCoverageComplete, false);
    assert.match(saturated.report.failedWindows[0].reason, /indivisible/);
    const failed = await collect([], {start: 0, end: 100, windowMs: 100, maxErrorDepth: 1,
        retryErrors: true,
        readHistory: async () => { throw new Error('ioBroker did not answer in time'); }});
    assert.equal(failed.report.queryCoverageComplete, false);
    assert.equal(failed.report.emittedRows, 0);
    assert.equal(failed.report.replayValid, false);
    assert.ok(failed.report.failedWindows.every(window => /in time/.test(window.reason)));
    const invalid = await collect([], {start: 0, end: 1,
        readHistory: async () => [{ts: 100, val: null}]});
    assert.equal(invalid.report.queryCoverageComplete, false);
    assert.match(invalid.report.failedWindows[0].reason, /outside-window/);
});

test('null and malformed records, sequence gaps and conflicting identities are never hidden as zero', async () => {
    const rows = records([10, 20, 30, 40]);
    const gap = await collect([rows[0], rows[2], rows[3]]);
    assert.equal(gap.report.sequenceGaps, 1);
    assert.equal(gap.report.missingSequences, 1);
    assert.equal(gap.report.sequenceContinuityValid, false);
    assert.equal(gap.report.replayValid, false);
    const unknown = [{ts: 1, val: null}, {ts: 2, val: '{invalid'}, ...rows];
    const malformed = await collect(unknown);
    assert.deepEqual(malformed.output.slice(0, 2), unknown.slice(0, 2));
    assert.equal(malformed.report.malformedRecords, 2);
    assert.equal(malformed.report.unknownReplayRecords, 2);
    const conflict = {...rows[0], ts: 12, val: JSON.stringify({...JSON.parse(rows[0].val), event: {type: 'different'}})};
    const conflicted = await collect([rows[0], conflict, ...rows.slice(1)]);
    assert.equal(conflicted.report.conflictingDuplicates, 1);
    assert.equal(conflicted.report.replayValid, false);
    assert.equal(conflicted.output.length, 5, 'both conflicting originals survive decoder preflight');
    assert.equal(decodeDecisionRecords(conflicted.output)[0].val.reconstruction.valid, false);
});

test('request, identity and session capacities stop with an uncovered-window report', async () => {
    const rows = records([10, 20, 30]);
    for (const options of [{maxRequests: 1, windowMs: 5}, {maxIdentities: 1}, {maxSessions: 1}]) {
        const source = options.maxSessions ? [rows[0], ...records([20, 30], 'another')] : rows;
        const {report} = await collect(source, options);
        assert.equal(report.queryCoverageComplete, false);
        assert.equal(report.sequenceContinuityValid, false);
        assert.equal(report.replayValid, false);
        assert.ok(report.failedWindows.some(window => /capacity/.test(window.reason)));
    }
});

test('historical recorder counters are reported per session and empty history never certifies a day', async () => {
    const rows = records([10, 20], 'old').map(row => ({...row,
        val: JSON.stringify({...JSON.parse(row.val), recording: {dropped: 3, writeErrors: 2}})}));
    rows.push(...records([30, 40], 'new'));
    const {report} = await collect(rows);
    assert.deepEqual(report.sessions.map(session => [session.recordSession, session.dropped, session.writeErrors]),
        [['old', 3, 2], ['new', 0, 0]]);
    const brokenCounters = await collect(records([10, 20, 30]).map((row, i) => ({...row,
        val: JSON.stringify({...JSON.parse(row.val), recording: i === 0 ? null
            : {dropped: i === 1 ? 3 : 0, writeErrors: 0}})})));
    assert.equal(brokenCounters.report.recordingCountersMissing, 2);
    assert.equal(brokenCounters.report.counterRegressions, 1);
    assert.equal(brokenCounters.report.sessions[0].dropped, 3);
    assert.equal(brokenCounters.report.sessions[0].recordingCountersMissing, 2);
    assert.equal(brokenCounters.report.sessions[0].counterRegressions, 1);
    const empty = await collect([]);
    assert.equal(empty.report.queryCoverageComplete, true);
    assert.equal(empty.report.sequenceContinuityValid, false);
    assert.equal(empty.report.replayValid, false);
    assert.equal(empty.report.retentionVerified, false);
});

test('projection of real alpha58 records preserves source clocks, ACK, null and event metadata', async () => {
    const fixture = require('./fixtures/issue123-recorder-projection.json');
    const {output, report} = await collect(fixture.records, {limit: 3});
    assert.equal(report.queryCoverageComplete, true);
    assert.equal(report.sequenceContinuityValid, true);
    assert.equal(report.replayValid, true);
    assert.deepEqual(output, fixture.records);
    assert.deepEqual(decodeDecisionRecords(output), fixture.decoded);
    assert.ok(fixture.decoded.some(row => row.val.production.wallboxes[2].allocation.actualPowerW === null));
    assert.equal(fixture.decoded[0].val.realFeedback.Wallbox2.powerKW.ts, 1791553425932);
});

test('invalid options and sink failures cannot produce a successful result', async () => {
    await assert.rejects(readDecisionRecordHistory(), /readHistory/);
    await assert.rejects(readDecisionRecordHistory({readHistory: history([]), start: 2, end: 1}), /precedes/);
    await assert.rejects(readDecisionRecordHistory({readHistory: history([]), start: 0, end: 1, limit: 0}), /limit/);
    await assert.rejects(collect(records([10]), {onRawPage: () => { throw new Error('archive write failed'); }}), /archive write failed/);
});

test('a never-resolving or unconfirmed failed transport stops after one request and persists partial diagnostics', async () => {
    let requests = 0, persisted, signal;
    const report = await readDecisionRecordHistory({start: 0, end: 100, basisLookbackMs: 0,
        queryTimeoutMs: 5, retryErrors: true, readHistory: request => {
            requests++; signal = request.signal;
            return new Promise(() => {});
        }, onReport: value => { persisted = JSON.parse(JSON.stringify(value)); }});
    assert.equal(requests, 1);
    assert.equal(signal.aborted, true);
    assert.equal(report.queryCoverageComplete, false);
    assert.match(report.stoppedReason, /backend completion unknown/);
    assert.deepEqual(persisted, report);
    const rejected = await collect(records([10, 20]), {readHistory: async () => {
        throw new Error('connector deadline; backend status unknown');
    }});
    assert.equal(rejected.report.queryCount, 1);
    assert.equal(rejected.report.queryCoverageComplete, false);
    assert.match(rejected.report.stoppedReason, /backend status unknown/);
});
