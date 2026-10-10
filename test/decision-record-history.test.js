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
        if (fail(request)) {
            const error = new Error('ioBroker did not answer in time');
            error.transport = {backendCompletion: 'observed',
                backendCompletionEvidence: 'offline fixture: rejected operation has completed'};
            throw error;
        }
        return {result: rows.filter(row => row.ts >= request.start && row.ts <= request.end).slice(0, request.limit)};
    };
}
async function collect(rows, options = {}) {
    const output = [], raw = [], queries = [], sources = [];
    const report = await readDecisionRecordHistory({readHistory: history(rows), basisLookbackMs: 0,
        minGapMs: 0, maxRequests: 20000, maxRunMs: Infinity,
        start: rows[0]?.ts ?? 0, end: rows.at(-1)?.ts ?? 100, onRecords: batch => output.push(...batch),
        onRawPage: page => raw.push(page), onQuery: query => queries.push(query),
        onSourceSamples: batch => sources.push(...batch), ...options});
    return {report, output, raw, queries, sources};
}

function sourceRows(events, {session = 'source-session', sampling = {schema: 1, rawSourcesContinuous: true},
    deltaWithoutBasis = false} = {}) {
    return events.map((event, index) => ({ts: index + 1000, val: JSON.stringify({
        schema: deltaWithoutBasis ? 3 : 2,
        ...(deltaWithoutBasis ? {frameType: 'delta', baseSequence: index + 9, checkpointSequence: 1, ops: []} : {sampling}),
        recordSession: session, recordSequence: index + 10, timestamp: index + 999,
        mode: 'PRODUCTION', masterEnabled: true, recording: {dropped: 0, writeErrors: 0}, event})}));
}

test('overlapping pre-event/source batches and single updates deduplicate actual probes without altering NULL or source fields', async () => {
    const first = {sampleSequence: 11, id: 'power', receivedAt: 900,
        state: {val: 0, ts: 890, lc: 800, ack: true, q: 0}};
    const absent = {sampleSequence: 12, id: 'feedback', receivedAt: 901, state: null};
    const invalid = {sampleSequence: 13, id: 'command', receivedAt: 902,
        state: {val: null, ts: 891, lc: 801, ack: false, q: 64}};
    const reordered = {...first, state: {q: 0, ack: true, lc: 800, ts: 890, val: 0}};
    const rows = sourceRows([{type: 'recording.pre_event', samples: [first, absent]},
        {type: 'recording.sources', samples: [absent, reordered, invalid]},
        {type: 'source.update', ...invalid, triggerReason: 'quality-edge'}]);
    const result = await collect(rows);
    assert.deepEqual(result.sources.map(entry => entry.sample), [first, absent, invalid]);
    assert.ok(result.sources.every(entry => entry.recordSession === 'source-session'));
    assert.equal(result.sources[1].sample.state, null);
    assert.equal(result.sources[2].sample.state.ack, false);
    assert.equal(result.sources[2].sample.state.q, 64);
    assert.equal(result.report.sourceObservations.duplicates, 3);
    assert.equal(result.report.sourceObservations.conflictingDuplicates, 0);
    assert.equal(result.report.sourceObservations.unique, 3);
    assert.equal(result.report.sourceObservations.sessions[0].missingSequencesInsideObservedSpan, 0);
    assert.equal(result.report.sourceObservations.sampling.continuousDeclaredRecords, 3);
});

test('raw event probes survive missing full basis and sample gaps concern only the observed sequence span', async () => {
    const sample = sequence => ({sampleSequence: sequence, id: 'power', receivedAt: 100 + sequence,
        state: {val: sequence === 40 ? null : 0, ts: sequence, lc: sequence - 1, ack: true, q: 0}});
    const result = await collect(sourceRows([{type: 'recording.sources', samples: [sample(40), sample(42)]}],
        {deltaWithoutBasis: true}));
    assert.equal(result.sources.length, 2);
    assert.equal(result.report.replayValid, false);
    assert.equal(result.report.sourceObservations.sampling.unknownRecords, 1);
    assert.equal(result.report.sourceObservations.sessions[0].firstSequence, 40);
    assert.equal(result.report.sourceObservations.sessions[0].lastSequence, 42);
    assert.equal(result.report.sourceObservations.sessions[0].missingSequencesInsideObservedSpan, 1);
    const filledLater = await collect(sourceRows([
        {type: 'recording.sources', samples: [sample(40), sample(42)]},
        {type: 'recording.pre_event', samples: [sample(41)]}], {deltaWithoutBasis: true}));
    assert.equal(filledLater.report.sourceObservations.sessions[0].missingSequencesInsideObservedSpan, 0,
        'late pre-event samples fill the observed span rather than leaving a false missing count');
});

test('source conflicts retain both originals and separate sessions may reuse sample sequence numbers', async () => {
    const sample = {sampleSequence: 9, id: 'power', receivedAt: 900,
        state: {val: 0, ts: 890, lc: 800, ack: true, q: 0}};
    const conflicting = {...sample, state: {...sample.state, q: 64}};
    const rows = sourceRows([{type: 'recording.sources', samples: [sample]},
        {type: 'source.update', ...conflicting}]);
    rows.push(...sourceRows([{type: 'recording.sources', samples: [sample]}], {session: 'after-restart'})
        .map(row => ({...row, ts: 1002})));
    const result = await collect(rows);
    assert.equal(result.sources.length, 3);
    assert.equal(result.report.sourceObservations.conflictingDuplicates, 1);
    assert.equal(result.report.sourceObservations.unique, 2);
    assert.equal(result.report.sourceObservations.sessions.length, 2);
    assert.equal(result.report.sourceObservations.sequenceContinuityWithinObservedSpan, false);
});

test('interval statistics and older sampling declarations never become manufactured raw samples', async () => {
    const summary = {from: 0, to: 30000, resolutionMs: 30000,
        sources: [{id: 'power', count: 2, min: 0, max: 100, mean: 50}]};
    const result = await collect(sourceRows([{type: 'recording.interval', summary}],
        {sampling: {schema: 1, rawSourcesContinuous: false, quietIntervalMs: 30000}}));
    assert.equal(result.sources.length, 0);
    assert.equal(result.report.sourceObservations.intervalSummaries, 1);
    assert.equal(result.report.sourceObservations.sampling.sampledDeclaredRecords, 1);
    assert.equal(result.report.sourceObservations.sequenceContinuityWithinObservedSpan, false);
    assert.deepEqual(JSON.parse(result.raw[0].rows[0].val).event.summary, summary);
});

test('source identity capacity and source sink failures leave explicit unaccepted windows', async () => {
    const samples = [1, 2].map(sampleSequence => ({sampleSequence, id: 'power', receivedAt: sampleSequence,
        state: {val: 0, ts: sampleSequence, lc: 0, ack: true, q: 0}}));
    const rows = sourceRows([{type: 'recording.sources', samples}]);
    const limited = await collect(rows, {maxSourceSamples: 1});
    assert.equal(limited.sources.length, 1);
    assert.equal(limited.report.sourceObservations.capacityReached, true);
    assert.equal(limited.report.queryCoverageComplete, false);
    assert.equal(limited.report.sourceObservations.sequenceContinuityWithinObservedSpan, false);
    assert.ok(limited.report.failedWindows.length > 0);
    let persisted;
    await assert.rejects(collect(rows, {onSourceSamples: () => {throw new Error('source archive unavailable');},
        onReport: report => {persisted = report;}}), /source archive unavailable/);
    assert.equal(persisted.queryCoverageComplete, false);
    assert.equal(persisted.sourceObservations.emittedSamples, 0);
});

test('a historical event appears only in its later SQL recovery window and retains its original source clocks', async () => {
    const original = {schema: 2, recordSession: 'recovered-original', recordSequence: 1, timestamp: 1700,
        mode: 'PRODUCTION', masterEnabled: true, sampling: {schema: 1, rawSourcesContinuous: true},
        recording: {dropped: 0, writeErrors: 0}, event: {type: 'recording.sources', at: 1700,
            samples: [{sampleSequence: 7, id: 'power', receivedAt: 1695,
                state: {val: null, ts: 1660, lc: 1600, ack: false, q: 64}}]}};
    const encoder = new DecisionRecordEncoder();
    const recoveredSqlRow = {ts: 60001, val: JSON.stringify(encoder.encode(original))};
    const day = await collect([recoveredSqlRow], {start: 1000, end: 2000});
    assert.equal(day.report.queryCoverageComplete, true, 'this covers SQL time only');
    assert.equal(day.output.length, 0, 'event timestamp 1700 does not place SQL row 60001 in the day query');
    assert.equal(day.report.replayValid, false, 'an empty SQL interval is no historical-decision proof');
    const recovery = await collect([recoveredSqlRow], {start: 60000, end: 62000});
    assert.deepEqual(recovery.output, [recoveredSqlRow]);
    assert.equal(recovery.output[0].ts, 60001);
    assert.equal(JSON.parse(recovery.output[0].val).timestamp, 1700);
    assert.deepEqual(recovery.sources[0].sample, original.event.samples[0]);
    assert.equal(recovery.sources[0].provenance.sqlTs, 60001);
    assert.equal(recovery.sources[0].provenance.frameTimestamp, 1700);
    assert.deepEqual(decodeDecisionRecords(recovery.output)[0].val, original);
});

test('SQL arrival order 1,3,2 stays conservative until archived originals are batch-reconstructed in session sequence order', async () => {
    const encoder = new DecisionRecordEncoder();
    const originals = [1, 2, 3].map(recordSequence => ({schema: 2,
        recordSession: 'recovery-delta-chain', recordSequence, timestamp: 1500 + recordSequence,
        mode: 'PRODUCTION', masterEnabled: true, sampling: {schema: 1, rawSourcesContinuous: true},
        recording: {dropped: 0, writeErrors: 0}, production: {cacheOnlyValue: recordSequence * 50,
            unchangedContext: 'original cache context '.repeat(100)}, event: {type: 'recording.sources',
            at: 1502 + recordSequence, samples: [{sampleSequence: recordSequence, id: 'power',
                receivedAt: 1501 + recordSequence, state: {val: recordSequence === 2 ? null : recordSequence * 100,
                    ts: 1480 + recordSequence, lc: 1400, ack: recordSequence !== 2, q: recordSequence === 2 ? 64 : 0}}]}}));
    const frames = originals.map(record => encoder.encode(record));
    assert.equal(frames[1].frameType, 'delta');
    assert.equal(frames[2].frameType, 'delta');
    const sqlRows = [
        {ts: 1600, val: JSON.stringify(frames[0])},
        {ts: 1601, val: JSON.stringify(frames[2])},
        {ts: 5001, val: JSON.stringify(frames[1])},
    ];
    const result = await collect(sqlRows, {start: 1000, end: 5001, windowMs: 2000});
    assert.equal(result.report.queryCoverageComplete, true);
    assert.equal(result.report.sequenceGaps, 1);
    assert.equal(result.report.sequenceReversals, 1);
    assert.equal(result.report.replayValid, false, 'incremental SQL-order decoding cannot silently repair its earlier missing basis');
    assert.equal(result.report.unknownReplayRecords, 2);
    const archived = result.raw.flatMap(page => page.rows);
    assert.deepEqual(archived, sqlRows);
    const complete = decodeDecisionRecords(archived);
    assert.deepEqual(complete.map(row => row.val), originals);
    assert.deepEqual(complete.map(row => row.ts), [1600, 5001, 1601], 'batch reordering never rewrites original SQL clocks');
    assert.deepEqual(result.sources.map(entry => entry.sample.sampleSequence), [1, 3, 2]);
    assert.deepEqual([...result.sources].sort((a, b) => a.sample.sampleSequence - b.sample.sampleSequence)
        .map(entry => entry.sample), originals.map(record => record.event.samples[0]));
    assert.equal(result.report.sourceObservations.sessions[0].missingSequencesInsideObservedSpan, 0);
    assert.equal(result.sources.find(entry => entry.sample.sampleSequence === 2).sample.state.ack, false);
    assert.equal(result.sources.find(entry => entry.sample.sampleSequence === 2).sample.state.q, 64);
});

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

test('default requests use bounded two-second pages and thirty-two raw records', async () => {
    const requests = [];
    const report = await readDecisionRecordHistory({start: 60000, end: 70000,
        readHistory: async request => {requests.push(request); throw new Error('stop fixture');}});
    assert.equal(requests.length, 1);
    assert.equal(requests[0].end - requests[0].start, 2000);
    assert.equal(requests[0].limit, 32);
    assert.equal(report.maxRequests, 64);
    assert.equal(report.maxRunMs, 60000);
    assert.equal(report.minGapMs, 1000);
});

test('retry permission without observed backend completion stops and blocks automatic resume', async () => {
    let calls = 0;
    const result = await collect([], {start: 0, end: 100, retryErrors: true,
        readHistory: async () => {calls++; throw new Error('connector rejected; backend unknown');}});
    assert.equal(calls, 1);
    assert.equal(result.queries[0].backendCompletion, 'unknown');
    assert.equal(result.report.resumeCursor.nextStart, 0);
    assert.equal(result.report.resumeCursor.end, 100);
    assert.equal(result.report.resumeCursor.blockedByUnknownBackend, true);
});

test('query diagnostics retain original connector errors and independently observed response size', async () => {
    const failure = new Error('ioBroker did not answer in time');
    failure.name = 'McpServerError';
    const failed = await collect([], {readHistory: async () => {throw failure;}});
    assert.equal(failed.queries[0].originalError.name, 'McpServerError');
    assert.equal(failed.queries[0].originalError.original, 'McpServerError: ioBroker did not answer in time');
    const responseText = '{"result":[],"note":"ä😊"}';
    const result = await collect([], {readHistory: async () => ({result: [],
        transport: {responseText, wireBytes: Buffer.byteLength(responseText), parseStatus: 'parsed'}})});
    const query = result.queries[0];
    assert.equal(query.responseCharacters, responseText.length);
    assert.equal(query.wireBytes, Buffer.byteLength(responseText));
    assert.notEqual(query.responseCharacters, query.wireBytes);
    assert.equal(query.parseStatus, 'parsed');
    assert.equal(query.truncated, null);
    assert.equal(query.hasMore, null);
    assert.equal(query.backendCompletion, 'unknown');
    assert.match(query.startedAtUTC, /^\d{4}-\d\d-\d\dT/);
    assert.match(query.endedAtUTC, /^\d{4}-\d\d-\d\dT/);
});

test('failed envelope parsing and invalid raw rows preserve response provenance without claiming coverage', async () => {
    const text = '{"result":[';
    const failed = await collect([], {readHistory: async () => ({result: [],
        transport: {responseText: text, parseStatus: 'failed'}})});
    assert.equal(failed.report.queryCoverageComplete, false);
    assert.equal(failed.queries[0].parseStatus, 'failed');
    assert.equal(failed.queries[0].responseCharacters, text.length);
    const invalidRows = [{ts: 9999, val: null}];
    const invalid = await collect([], {start: 0, end: 100, readHistory: async () => ({result: invalidRows})});
    assert.equal(invalid.report.queryCoverageComplete, false);
    assert.equal(invalid.raw[0].rows, invalidRows, 'an invalid response must survive local raw archival');
    assert.equal(invalid.output.length, 0);
});

test('slow completed pages shrink following windows without re-querying the already covered interval', async () => {
    const rows = records(Array.from({length: 8}, (_, index) => index * 10));
    let first = true;
    const requests = [];
    const result = await collect(rows, {start: 0, end: 80, windowMs: 20, slowQueryMs: 5,
        readHistory: async request => {
            requests.push({...request});
            if (first) {first = false; await new Promise(resolve => setTimeout(resolve, 15));}
            return history(rows)(request);
        }});
    assert.equal(requests[0].end - requests[0].start, 20);
    assert.equal(requests[1].start, 20);
    assert.ok(requests.slice(1).every(request => request.end - request.start <= 10));
    assert.deepEqual(result.output, rows);
    assert.equal(result.report.queryCoverageComplete, true);
    assert.ok(result.report.windowAdjustments.some(change => change.reason === 'slow_completed_response'));
});

test('run budget preserves a cursor and remaining windows after the outstanding request has returned', async () => {
    let calls = 0;
    const result = await collect([], {start: 0, end: 40, windowMs: 10, maxRunMs: 10,
        readHistory: async () => {calls++; await new Promise(resolve => setTimeout(resolve, 25)); return [];}});
    assert.equal(calls, 1);
    assert.equal(result.report.queryCoverageComplete, false);
    assert.ok(result.report.failedWindows.some(window => window.end === 40));
    assert.equal(result.report.resumeCursor.nextStart, 10);
    assert.equal(result.report.resumeCursor.blockedByUnknownBackend, false);
});

test('a query-start journal is persisted before transport issuance and requests are paced sequentially', async () => {
    const events = [], starts = [];
    let running = 0, peak = 0;
    const result = await collect([], {start: 0, end: 20, windowMs: 10, minGapMs: 20,
        onQueryStart: query => {events.push(`journal:${query.number}`);},
        readHistory: async () => {
            events.push(`read:${starts.length + 1}`); starts.push(performance.now());
            peak = Math.max(peak, ++running);
            await new Promise(resolve => setTimeout(resolve, 1)); running--;
            return [];
        }});
    assert.deepEqual(events, ['journal:1', 'read:1', 'journal:2', 'read:2']);
    assert.equal(peak, 1);
    assert.ok(starts[1] - starts[0] >= 17);
    assert.equal(result.report.queryCoverageComplete, true);
});

test('query journal failures preserve a partial report and stop before issuing an unrecorded request', async () => {
    let calls = 0, persisted;
    await assert.rejects(collect([], {start: 0, end: 20, windowMs: 10,
        readHistory: async () => {calls++; return [];},
        onQueryStart: () => {throw new Error('journal unavailable');},
        onReport: report => {persisted = report;}}), /journal unavailable/);
    assert.equal(calls, 0);
    assert.equal(persisted.queryCoverageComplete, false);
    assert.ok(persisted.failedWindows.some(window => window.start === 0 && window.end === 20));
});

test('an unknown backend outcome still blocks resume when its completed query journal also fails', async () => {
    let calls = 0, persisted;
    await assert.rejects(collect([], {start: 0, end: 20,
        readHistory: async () => {calls++; throw new Error('connector deadline; backend unknown');},
        onQuery: () => {throw new Error('completed journal unavailable');},
        onReport: report => {persisted = report;}}), /completed journal unavailable/);
    assert.equal(calls, 1);
    assert.equal(persisted.resumeCursor.blockedByUnknownBackend, true);
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
