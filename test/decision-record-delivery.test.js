'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {unpackOriginals} = require('../lib/decision-record-transport');
const parsePublished = value => JSON.parse(unpackOriginals(value)[0]);
const DecisionRecordDelivery = require('../lib/decision-record-delivery');

function fixture(count = 1, options = {}) {
    let clock = 100000;
    const entries = Array.from({length: count}, (_, i) => {
        const payload = JSON.stringify({schema: 2, recordSession: 17, recordSequence: i + 1,
            timestamp: 10 + i, event: {type: 'source.update', sampleSequence: i + 1,
                state: {val: i ? -0.01 : null, ts: 5, lc: 2, ack: false, q: 64}}});
        return {id: String(i + 1).padStart(16, '0'), recordSession: 17, recordSequence: i + 1,
            sha256: createHash('sha256').update(payload).digest('hex'), payload,
            payloadBytes: Buffer.byteLength(payload), published: false};
    });
    const stored = new Map(entries.map(e => [e.id, e])), publications = [], confirmations = [], queries = [];
    const journal = {
        async readBatch({afterId, limit, maxBytes}) {
            const result = []; let bytes = 0;
            for (const e of stored.values()) {
                if (afterId && e.id <= afterId) continue;
                if (result.length >= limit || bytes + e.payloadBytes > maxBytes) break;
                result.push({...e}); bytes += e.payloadBytes;
            }
            return result;
        },
        markPublished(id) { const e = stored.get(id); if (e) e.published = true; },
        async prepareReplay(id) { assert.ok(stored.has(id)); return {ids: [id], groupId: id}; },
        async confirmStored(id, proof) {
            const e = stored.get(id);
            assert.ok(e);
            assert.deepEqual(proof, {kind: 'independent-history-match', recordSession: e.recordSession,
                recordSequence: e.recordSequence, sha256: e.sha256});
            confirmations.push({id, proof}); stored.delete(id);
            return true;
        }
    };
    const delivery = new DecisionRecordDelivery({journal, now: () => clock,
        publishIntervalMs: 10, checkIntervalMs: 10, minQueryGapMs: 1, queryTimeoutMs: 20,
        publish: async payload => {publications.push(payload); return {publishedAt: clock};},
        readHistory: async request => {
            queries.push(request);
            return {result: publications.map(val => ({ts: clock, val})), backendCompletionObserved: true};
        }, ...options});
    return {delivery, entries, stored, publications, confirmations, queries, journal,
        now: () => clock, advance: ms => {clock += ms;}};
}

test('bounded bundled transport drains a healthy backlog without increasing the write/query call budget', async () => {
    const sql = [], {unpackOriginals} = require('../lib/decision-record-transport');
    const h = fixture(64, {bundleOriginals: true, maxPublishPerTick: 16, maxWritesPerTick: 4,
        publishIntervalMs: 5000, maxQueriesPerTick: 1,
        publish: async val => {sql.push({ts: h.now(), val}); return {publishedAt: h.now()};},
        readHistory: async q => ({result: sql.filter(row => row.ts >= q.start && row.ts <= q.end),
            backendCompletionObserved: true})});
    for (let n = 0; n < 4; n++) {
        const writes = sql.length;
        await h.delivery.tick();
        assert.ok(sql.length - writes <= 4);
        h.advance(5000);
    }
    assert.equal(h.stored.size, 0, 'all original records require real exact SQL proof');
    assert.equal(sql.length, 4, 'sixteen originals fit one bounded state write');
    assert.deepEqual(sql.flatMap(row => unpackOriginals(row.val)), h.entries.map(entry => entry.payload));
    assert.equal(h.delivery.health().queryCount, 4);
    const oldSql = [];
    const old = fixture(64, {maxPublishPerTick: 4, maxWritesPerTick: 4, publishIntervalMs: 5000,
        maxQueriesPerTick: 1,
        publish: async val => {oldSql.push({ts: old.now(), val}); return {publishedAt: old.now()};},
        readHistory: async q => ({result: oldSql.filter(row => row.ts >= q.start && row.ts <= q.end),
            backendCompletionObserved: true})});
    for (let n = 0; n < 4; n++) {await old.delivery.tick(); old.advance(5000);}
    assert.equal(old.stored.size, 48, 'former four-individual-record contract cannot drain this backlog in the same rounds');
});

test('real retained checkpoint groups retire after bounded bundled SQL proof, not from publication or age', async () => {
    const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
    const Journal = require('../lib/decision-record-journal');
    const {DecisionRecordEncoder, decodeDecisionRecords} = require('../lib/decision-record-codec');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-bundle-backlog-'));
    let clock = 100000;
    const journal = new Journal({directory, now: () => clock});
    const sql = [], encoder = new DecisionRecordEncoder({checkpointMs: 10000}), original = [];
    try {
        await journal.initialize();
        for (let n = 1; n <= 64; n++) {
            const record = {schema: 2, recordSession: 'backlog', recordSequence: n, timestamp: n * 1000,
                mode: 'PRODUCTION', masterEnabled: true, production: {stable: 'x'.repeat(12000), value: n},
                event: {type: 'source.update', state: {val: n % 2 ? null : 0, ts: n * 1000 - 1, lc: 900,
                    ack: n % 2 === 0, q: n % 2 ? 64 : 0}}, recording: {bufferLost: 1}};
            original.push(record); await journal.append(JSON.stringify(encoder.encode(record)));
        }
        const delivery = new DecisionRecordDelivery({journal, now: () => clock,
            bundleOriginals: true, maxPublishPerTick: 16, maxWritesPerTick: 4, maxQueriesPerTick: 1,
            maxOriginalsPerTick: 64, maxReadOriginalBytes: 2 * 1024 * 1024,
            publishIntervalMs: 5000, minQueryGapMs: 1, wait: async ms => {clock += ms;},
            publish: async val => {sql.push({ts: clock, val: val.replace(/\\/g, '').slice(0, 65535)}); return {publishedAt: clock};},
            readHistory: async q => ({result: sql.filter(row => row.ts >= q.start && row.ts <= q.end),
                backendCompletionObserved: true})});
        for (let n = 0; n < 8 && journal.health().unconfirmedRecords; n++) {
            const writes = sql.length;
            await delivery.tick(); assert.ok(sql.length - writes <= 4); clock += 5000;
        }
        delivery.stop();
        assert.equal(journal.health().unconfirmedRecords, 0);
        assert.equal(journal.health().records, 4, 'latest dependency basis remains; all closed groups retire');
        assert.equal(journal.health().expiredRecords, 0);
        assert.equal(journal.health().rejectedRecords, 0);
        assert.deepEqual(decodeDecisionRecords(sql).map(row => row.val), original);
    } finally {await journal.close(); await fs.rm(directory, {recursive: true, force: true});}
});

test('a replay cursor reset walks a tracked unresolved prefix without starving the unsent suffix', async () => {
    const sql = [];
    const h = fixture(32, {bundleOriginals: true, maxPublishPerTick: 16, maxWritesPerTick: 4,
        publish: async val => {sql.push(val); return {publishedAt: h.now()};},
        readHistory: async () => ({result: [], backendCompletionObserved: true})});
    await h.delivery.tick(); assert.equal(sql.length, 1);
    h.delivery.cursor = null;
    h.advance(20); await h.delivery.tick();
    assert.equal(sql.length, 1, 'tracked missing originals are not spuriously republished');
    assert.equal(h.delivery.cursor, h.entries[15].id);
    h.advance(20); await h.delivery.tick();
    assert.equal(sql.length, 2, 'fresh suffix can still supply a future recovery proof');
    assert.equal(h.confirmations.length, 0);
});

test('bundle size, transport-write and actual byte ceilings retain an unsent suffix for the next tick', async () => {
    const sql = [];
    const h = fixture(16, {bundleOriginals: true, maxWritesPerTick: 2, maxPublishPerTick: 16,
        publish: async val => {sql.push(val); return {publishedAt: h.now()};},
        readHistory: async () => ({result: [], backendCompletionObserved: true})});
    for (const entry of h.entries) {
        const frame = JSON.parse(entry.payload); frame.padding = require('node:crypto').randomBytes(40000).toString('base64');
        entry.payload = JSON.stringify(frame); entry.payloadBytes = Buffer.byteLength(entry.payload);
        entry.sha256 = createHash('sha256').update(entry.payload).digest('hex');
    }
    await h.delivery.tick();
    assert.equal(sql.length, 2, 'large originals remain individual, never oversized bundles');
    assert.equal(h.delivery.cursor, h.entries[1].id);
    h.advance(20); await h.delivery.tick();
    assert.equal(sql.length, 4); assert.equal(h.delivery.cursor, h.entries[3].id);
    assert.equal(h.confirmations.length, 0, 'publication never proves SQL storage');
});

test('malformed bundle suffix never confirms its valid prefix and degradation still sends one original', async () => {
    const h = fixture(2, {bundleOriginals: true,
        readHistory: async () => ({result: [{ts: h.now(), val: JSON.stringify({schema: 4,
            frameType: 'transport-bundle', records: [h.entries[0].payload, '{bad']})}], backendCompletionObserved: true})});
    await h.delivery.tick(); assert.equal(h.confirmations.length, 0);
    assert.equal(h.delivery.health().lastQuery.malformedPayloads, 1);
    h.delivery.backoff = {degraded: true, paused: () => false, health: () => ({}), fail() {}};
    h.advance(30000); await h.delivery.tick();
    assert.equal(h.delivery.health().transportWrites, 1, 'already tracked originals are not republished without complete miss proof');
    const d = fixture(10, {bundleOriginals: true, backoff: h.delivery.backoff});
    await d.delivery.tick();
    assert.equal(d.publications.length, 1);
    assert.equal(parsePublished(d.publications[0]).recordSequence, 1, 'degraded recovery never bundles a burst');
});

test('ioBroker publication alone never removes a locally durable record or repeats publication', async () => {
    const h = fixture(1, {readHistory: async () => ({result: [], backendCompletionObserved: true})});
    await h.delivery.tick({force: true});
    h.advance(20); await h.delivery.tick({force: true});
    assert.equal(h.publications.length, 1);
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.stored.size, 1);
    assert.equal(h.delivery.health().sqlConfirmed, 0);
});

test('only exact independent history payload hash and session/sequence permit confirmation', async () => {
    const h = fixture();
    await h.delivery.tick({force: true});
    assert.equal(h.confirmations.length, 1);
    assert.equal(h.stored.size, 0);
    assert.equal(unpackOriginals(h.publications[0])[0], h.entries[0].payload);
    assert.deepEqual(parsePublished(h.publications[0]).event.state,
        {val: null, ts: 5, lc: 2, ack: false, q: 64});
    assert.equal(h.delivery.health().sqlConfirmed, 1);
});

test('wrong hash, NULL, malformed and matching latest state are never independent storage proof', async () => {
    const h = fixture(1, {readHistory: async () => ({result: [
        {ts: 100000, val: null}, {ts: 100000, val: '{invalid'},
        {ts: 100000, val: JSON.stringify({schema: 2, recordSession: 17, recordSequence: 1, timestamp: 10})}
    ], backendCompletionObserved: true})});
    await h.delivery.tick({force: true});
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.stored.size, 1);
});

test('startup publication is limited to sixteen records and preserves sequence order', async () => {
    const h = fixture(20, {readHistory: async () => ({result: [], backendCompletionObserved: true})});
    await h.delivery.tick({force: true});
    assert.equal(h.publications.length, 16);
    assert.deepEqual(h.publications.map(p => parsePublished(p).recordSequence), Array.from({length: 16}, (_, i) => i + 1));
    h.advance(20); await h.delivery.tick({force: true});
    assert.equal(h.publications.length, 20);
    h.advance(20); await h.delivery.tick({force: true});
    assert.equal(h.publications.length, 20, 'unconfirmed records are checked without repeated publication');
});

test('confirmation reads use bounded publication windows, never original source event time', async () => {
    const h = fixture();
    await h.delivery.tick({force: true});
    assert.ok(h.queries.length > 0);
    for (const q of h.queries) {
        assert.equal(q.limit, 32);
        assert.ok(q.end - q.start <= 2000);
        assert.ok(q.start > 90000, 'the original timestamp 10 is not the new SQL publication time');
    }
});

test('saturated history windows divide adaptively with finite per-tick query budget', async () => {
    let active = 0, maxActive = 0, calls = 0;
    const h = fixture(4, {maxQueriesPerTick: 1, readHistory: async q => {
        active++; maxActive = Math.max(maxActive, active); calls++;
        await Promise.resolve(); active--;
        if (q.end - q.start > 1000) return {result: Array.from({length: 32}, (_, i) =>
            ({ts: q.start, val: JSON.stringify({other: i})})), backendCompletionObserved: true};
        return {result: h.publications.map(val => ({ts: 100000, val})), backendCompletionObserved: true};
    }});
    await h.delivery.tick({force: true});
    assert.equal(calls, 1);
    assert.equal(h.stored.size, 4);
    h.advance(1); await h.delivery.tick({force: true});
    assert.ok(h.confirmations.length > 0);
    assert.equal(maxActive, 1);
    assert.ok(calls <= 2);
});

test('unknown backend deadline latches all SQL attempts until completion is independently observed', async () => {
    let finish, calls = 0;
    const h = fixture(1, {queryTimeoutMs: 5, readHistory: async () => {
        calls++;
        return new Promise(resolve => { finish = resolve; });
    }});
    await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().backendBlocked, true);
    h.advance(100); await h.delivery.tick({force: true});
    assert.equal(calls, 1);
    finish({result: [], backendCompletionObserved: true});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.delivery.health().backendBlocked, false);
    assert.equal(h.stored.size, 1);
});

test('connector rejection preserves its original error and does not prove backend completion', async () => {
    let calls = 0;
    const h = fixture(1, {readHistory: async () => {
        calls++;
        const error = new Error('ioBroker did not answer in time'); error.name = 'McpServerError'; throw error;
    }});
    await h.delivery.tick({force: true});
    h.advance(100); await h.delivery.tick({force: true});
    assert.equal(calls, 1);
    assert.equal(h.delivery.health().backendBlocked, true);
    assert.match(h.delivery.health().lastError, /McpServerError: ioBroker did not answer in time/);
    assert.throws(() => h.delivery.recoverBackend({kind: 'health-snapshot'}), /observed/);
    h.delivery.recoverBackend({kind: 'observed-backend-completion'});
    assert.equal(h.delivery.health().backendBlocked, false);
});

test('concurrent ticks never run overlapping SQL requests and stop suppresses future work', async () => {
    let finish, calls = 0;
    const h = fixture(1, {readHistory: async () => {
        calls++; return new Promise(resolve => {finish = resolve;});
    }});
    const running = h.delivery.tick({force: true});
    await new Promise(resolve => setImmediate(resolve));
    await h.delivery.tick({force: true});
    assert.equal(calls, 1);
    h.delivery.stop();
    finish({result: [], backendCompletionObserved: true}); await running;
    h.advance(100); await h.delivery.tick({force: true});
    assert.equal(calls, 1);
});

test('sixteen varied publication timestamps coalesce into at most three aligned two-second windows', async () => {
    let published = 0;
    const queries = [];
    const h = fixture(16, {publish: async () => ({publishedAt: 100000 + published++ * 150}),
        readHistory: async q => {
            queries.push(q); return {result: [], backendCompletionObserved: true};
        }, wait: async ms => h.advance(ms)});
    await h.delivery.tick({force: true});
    assert.equal(published, 16);
    assert.ok(queries.length <= 3);
    assert.equal(new Set(queries.map(q => `${q.start}:${q.end}`)).size, queries.length);
    assert.ok(queries.every(q => q.start % 2000 === 0 && q.end - q.start < 2000));
    assert.equal(h.delivery.health().pendingEntries, 16);
});

test('observed backend completion with invalid response stops this tick and respects the next check interval', async () => {
    let calls = 0;
    const h = fixture(1, {readHistory: async () => {
        calls++;
        return {result: calls === 1 ? 'invalid rows' : [{ts: 100000, val: h.entries[0].payload}],
            backendCompletionObserved: true};
    }});
    await h.delivery.tick();
    assert.equal(h.delivery.health().backendBlocked, false);
    assert.equal(h.delivery.health().activeSqlRequests, 0);
    assert.equal(h.delivery.health().sqlConfirmed, 0);
    h.advance(1); await h.delivery.tick();
    assert.equal(calls, 1, 'known completion does not create a rapid parse retry');
    h.advance(10); await h.delivery.tick();
    assert.equal(calls, 2);
    assert.equal(h.delivery.health().sqlConfirmed, 1);
});

test('late transport settlement without an observed backend result leaves the SQL fence intact', async () => {
    let finish, calls = 0;
    const h = fixture(1, {queryTimeoutMs: 5, readHistory: async () => {
        calls++; return new Promise(resolve => {finish = resolve;});
    }});
    await h.delivery.tick({force: true});
    finish({result: []}); await new Promise(resolve => setImmediate(resolve));
    h.advance(100); await h.delivery.tick({force: true});
    assert.equal(calls, 1);
    assert.equal(h.delivery.health().backendBlocked, true);
    assert.equal(h.delivery.health().backendCompletion, 'unknown');
    assert.equal(h.stored.size, 1);
});

test('unresolved publication deadline stops the batch until its original write really settles', async () => {
    let finish, calls = 0;
    const h = fixture(2, {publishTimeoutMs: 5, publish: async () => {
        calls++;
        if (calls === 1) return new Promise(resolve => {finish = resolve;});
        return {publishedAt: 100000};
    }, readHistory: async () => ({result: [], backendCompletionObserved: true})});
    await h.delivery.tick({force: true});
    assert.equal(calls, 1);
    assert.equal(h.delivery.health().publicationBlocked, true);
    await h.delivery.tick({force: true}); assert.equal(calls, 1);
    finish({publishedAt: 100000}); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.delivery.health().publicationBlocked, false);
    await h.delivery.tick({force: true}); assert.equal(calls, 2);
    await h.delivery.tick({force: true}); assert.equal(calls, 2);
    assert.equal(h.stored.size, 2, 'publication completion still does not prove SQL storage');
});

test('a journal rejection or false return cannot be reported as a successful SQL confirmation', async () => {
    const h = fixture();
    h.journal.confirmStored = async () => false;
    await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().sqlConfirmed, 0);
    assert.equal(h.delivery.health().pendingEntries, 1);
    assert.equal(h.stored.size, 1);
});

test('post-unlink durability error retains the cleanup failure without retrying the removed ID', async () => {
    const h = fixture();
    h.journal.confirmStored = async id => {
        h.stored.delete(id);
        const error = new Error('directory sync failed after independently confirmed removal');
        Object.assign(error, {recordRemoved: true, sqlProofVerified: true, journalId: id});
        throw error;
    };
    await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().sqlConfirmed, 1);
    assert.equal(h.delivery.health().localCleanupErrors, 1);
    assert.equal(h.delivery.health().pendingEntries, 0);
    assert.match(h.delivery.health().lastError, /directory sync failed/);
    h.advance(20); await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().pendingWindows, 0);
});

test('verification-window capacity recovers pending proof work after other records confirm, without republishing', async () => {
    let published = 0;
    const h = fixture(3, {maxQueuedWindows: 2, maxQueriesPerTick: 2,
        publish: async () => ({publishedAt: 100000 + published++ * 2000}),
        readHistory: async q => ({result: [{ts: q.start,
            val: h.entries[(q.start - 100000) / 2000].payload}], backendCompletionObserved: true}),
        wait: async ms => h.advance(ms)});
    await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().sqlConfirmed, 2);
    assert.equal(h.stored.size, 1);
    assert.equal(published, 3);
    h.advance(10); await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().sqlConfirmed, 3);
    assert.equal(h.stored.size, 0);
    assert.equal(published, 3);
});

test('real journal survives publication-only restart and removes an original only after later raw-history proof', async () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    const DecisionRecordJournal = require('../lib/decision-record-journal');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-delivery-journal-'));
    let journal = new DecisionRecordJournal({directory});
    try {
        await journal.initialize();
        const payload = fixture().entries[0].payload;
        await journal.append(payload);
        let attempts = 0;
        const first = new DecisionRecordDelivery({journal, now: () => 100000,
            publish: async value => {assert.equal(unpackOriginals(value)[0], payload); attempts++; return {publishedAt: 100000};},
            readHistory: async () => ({result: [], backendCompletionObserved: true})});
        await first.tick({force: true}); first.stop();
        assert.equal(journal.health().records, 1);
        await journal.close();
        journal = new DecisionRecordJournal({directory}); await journal.initialize();
        const second = new DecisionRecordDelivery({journal, now: () => 102000,
            publish: async value => {assert.equal(unpackOriginals(value)[0], payload); attempts++; return {publishedAt: 102000};},
            readHistory: async () => ({result: [{ts: 102000, val: payload}], backendCompletionObserved: true})});
        await second.tick({force: true}); second.stop();
        assert.equal(attempts, 2, 'exact original is republished only once per process after recovery');
        assert.equal(journal.health().records, 0);
        assert.equal(journal.health().sqlConfirmedRecords, 1);
    } finally { await journal.close(); await fs.rm(directory, {recursive: true, force: true}); }
});

test('two complete observed misses permit exact bounded recovery after sixty seconds without restart', async () => {
    let sqlRecovered = false;
    const queries = [];
    const h = fixture(1, {readHistory: async q => {
        queries.push(q);
        return {result: sqlRecovered ? [{ts: h.now(), val: h.entries[0].payload}] : [],
            backendCompletionObserved: true};
    }});
    await h.delivery.tick();
    h.advance(30000); await h.delivery.tick();
    h.advance(29999); await h.delivery.tick();
    assert.equal(h.publications.length, 1, 'no early retry after a missing row');
    sqlRecovered = true; h.advance(11); await h.delivery.tick();
    assert.equal(h.publications.length, 2);
    assert.equal(unpackOriginals(h.publications[1])[0], h.entries[0].payload);
    assert.equal(h.delivery.health().republishAttempts, 1);
    assert.equal(h.delivery.health().sqlConfirmed, 1);
    assert.equal(h.delivery.health().pendingWindows, 0, 'old proof windows are removed');
    assert.ok(queries.at(-1).start >= 160000, 'new publication window is verified');
});

test('unknown completion, saturated rows or only one full miss never admit a repeat publication', async () => {
    for (const kind of ['unknown', 'saturated', 'single-miss']) {
        let calls = 0;
        const h = fixture(1, {maxQueriesPerTick: 1, readHistory: async q => {
            calls++;
            return {result: kind === 'saturated' || kind === 'single-miss' && calls > 1
                ? Array.from({length: 32}, (_, i) => ({ts: q.start, val: JSON.stringify({other: i})})) : [],
            backendCompletionObserved: kind !== 'unknown'};
        }});
        await h.delivery.tick();
        h.advance(60000); await h.delivery.tick();
        h.advance(60000); await h.delivery.tick();
        assert.equal(h.publications.length, 1, kind);
    }
});

test('three repeats exhaust the record budget until a fresh exact proof of a newer record creates recovery epoch', async () => {
    let newerStored = false;
    const h = fixture(2, {readHistory: async q => ({result: newerStored && h.now() >= q.start && h.now() <= q.end
        ? [{ts: h.now(), val: h.entries[1].payload}] : [], backendCompletionObserved: true})});
    const second = h.stored.get(h.entries[1].id); h.stored.delete(second.id);
    await h.delivery.tick();
    for (let n = 0; n < 7; n++) {h.advance(30000); await h.delivery.tick();}
    assert.equal(h.publications.length, 4, 'one original plus at most three repeats');
    assert.equal(h.delivery.health().retryExhausted, 1);
    h.advance(60000); await h.delivery.tick();
    assert.equal(h.publications.length, 4, 'healthy empty callbacks cannot reset budget');
    h.stored.set(second.id, second); newerStored = true;
    h.advance(10); await h.delivery.tick();
    assert.equal(h.delivery.health().recoveryEpoch > 0, true);
    newerStored = false; h.advance(60000); await h.delivery.tick();
    assert.equal(h.publications.filter(p => parsePublished(p).recordSequence === 1).length, 5);
});

test('a slow independent SQL proof cannot block new bounded publication or create overlapping SQL queries', async () => {
    let finish, calls = 0;
    const h = fixture(2, {publishIntervalMs: 5000, queryTimeoutMs: 1000, readHistory: async () => {
        calls++; return calls === 1 ? new Promise(resolve => {finish = resolve;})
            : {result: [], backendCompletionObserved: true};
    }});
    const second = h.stored.get(h.entries[1].id); h.stored.delete(second.id);
    const firstTick = h.delivery.tick();
    await new Promise(resolve => setImmediate(resolve));
    h.stored.set(second.id, second); h.advance(5000);
    await h.delivery.tick();
    const publicationCount = h.publications.length;
    const queryCount = calls;
    finish({result: [], backendCompletionObserved: true}); await firstTick;
    assert.equal(publicationCount, 2, 'producer drain continues while the one history query awaits its callback');
    assert.equal(queryCount, 1);
    assert.equal(h.delivery.health().verificationBusy, false);
    assert.equal(h.delivery.health().publishBusy, false);
});

test('same-process SQL recovery republishes the retained original snapshot and every dependent delta in order', async () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    const DecisionRecordJournal = require('../lib/decision-record-journal');
    const {DecisionRecordEncoder, decodeDecisionRecords} = require('../lib/decision-record-codec');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-delivery-chain-'));
    const journal = new DecisionRecordJournal({directory});
    let clock = 100000, recovered = false;
    const sql = [], publications = [];
    try {
        await journal.initialize();
        const encoder = new DecisionRecordEncoder();
        const frames = [1, 2].map(recordSequence => encoder.encode({schema: 2, recordSession: 19, recordSequence,
            timestamp: 1000 + recordSequence, mode: 'PRODUCTION', masterEnabled: true,
            production: {stable: 'x'.repeat(1600), budgetW: recordSequence}}));
        assert.deepEqual(frames.map(frame => frame.frameType), ['snapshot', 'delta']);
        const originals = frames.map(frame => JSON.stringify(frame));
        for (const payload of originals) await journal.append(payload);
        const delivery = new DecisionRecordDelivery({journal, now: () => clock, publishIntervalMs: 10,
            minQueryGapMs: 1, wait: async ms => {clock += ms;},
            publish: async payload => {
                publications.push(payload);
                if (recovered || parsePublished(payload).recordSequence === 1) sql.push({ts: clock, val: payload});
                return {publishedAt: clock};
            }, readHistory: async q => ({result: sql.filter(row => row.ts >= q.start && row.ts <= q.end).slice(0, q.limit),
                backendCompletionObserved: true})});
        await delivery.tick();
        assert.equal(journal.health().records, 2, 'confirmed full basis remains available for the pending delta');
        assert.equal(journal.health().unconfirmedRecords, 1);
        sql.length = 0; // Simulated SQL retention removes the independently confirmed old basis.
        clock += 86400001; await delivery.tick();
        assert.equal(publications.length, 2, 'a single fully observed miss after expiry is insufficient');
        recovered = true; clock += 10; await delivery.tick(); delivery.stop();
        assert.deepEqual(publications.slice(2).flatMap(unpackOriginals), originals, 'byte-exact original snapshot precedes its delta');
        assert.equal(journal.health().unconfirmedRecords, 0);
        assert.deepEqual(decodeDecisionRecords(sql).map(row => row.val.production.budgetW), [1, 2]);
    } finally {await journal.close(); await fs.rm(directory, {recursive: true, force: true});}
});

test('an unresolved SQL request remains fenced across journal and delivery restart', {timeout: 10000}, async t => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    const DecisionRecordJournal = require('../lib/decision-record-journal');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-delivery-fence-'));
    let journal = new DecisionRecordJournal({directory}), calls = 0;
    try {
        await journal.initialize(); await journal.append(fixture().entries[0].payload);
        let started;
        const issued = new Promise(resolve => {started = resolve;});
        // This case requires an issued backend request. Do not race the
        // durable filesystem write against an arbitrary 50-ms CI deadline;
        // expiry before issuance is covered independently below.
        t.mock.timers.enable({apis: ['setTimeout']});
        const first = new DecisionRecordDelivery({journal, now: () => 100000, queryTimeoutMs: 50,
            publish: async () => ({publishedAt: 100000}),
            readHistory: async () => {calls++; started(); return new Promise(() => {});}});
        const running = first.tick({force: true});
        await issued;
        t.mock.timers.tick(51);
        await running; first.stop();
        t.mock.timers.reset();
        assert.equal(calls, 1);
        await journal.close();
        journal = new DecisionRecordJournal({directory}); await journal.initialize();
        const second = new DecisionRecordDelivery({journal, now: () => 200000,
            publish: async () => ({publishedAt: 200000}),
            readHistory: async () => {calls++; return {result: [], backendCompletionObserved: true};}});
        await second.tick({force: true}); second.stop();
        assert.equal(calls, 1, 'restart is not proof that the original backend SQL finished');
        assert.equal(second.health().backendBlocked, true);
        assert.equal(journal.health().sqlVerificationPending, true);
    } finally {t.mock.timers.reset(); await journal.close(); await fs.rm(directory, {recursive: true, force: true});}
});

test('durable SQL issuance is recorded before transport and only observed completion clears its exact fence', async () => {
    const h = fixture();
    let fence = null; const order = [];
    h.journal.beginVerification = async query => {fence = query; order.push('durable-issuance');};
    h.journal.completeVerification = async proof => {
        assert.equal(proof.verificationId, fence.verificationId);
        assert.equal(proof.kind, 'observed-backend-completion'); assert.ok(proof.evidence);
        fence = null; order.push('durable-completion');
    };
    h.delivery.readHistory = async () => {
        assert.ok(fence); order.push('sql-transport');
        return {result: [], backendCompletionObserved: true};
    };
    await h.delivery.tick({force: true});
    assert.deepEqual(order, ['durable-issuance', 'sql-transport', 'durable-completion']);
    assert.equal(fence, null);
});

test('stop or local deadline during durable issuance never starts SQL after the fence write settles', async () => {
    for (const reason of ['stop', 'deadline']) {
        let release, calls = 0;
        const h = fixture(1, {queryTimeoutMs: 5, readHistory: async () => {
            calls++; return {result: [], backendCompletionObserved: true};
        }});
        h.journal.beginVerification = async () => new Promise(resolve => {release = resolve;});
        const running = h.delivery.tick({force: true});
        await new Promise(resolve => setImmediate(resolve));
        if (reason === 'stop') h.delivery.stop();
        else await running;
        release(); await running; await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls, 0, reason);
    }
});

test('a late actual SQL callback can durably clear its original fence after delivery stop while journal remains open', async () => {
    let finish, fence = null;
    const h = fixture(1, {queryTimeoutMs: 5, readHistory: async () => new Promise(resolve => {finish = resolve;})});
    h.journal.health = () => ({sqlVerificationPending: fence !== null, sqlVerificationQuery: fence});
    h.journal.beginVerification = async query => {fence = query;};
    h.journal.completeVerification = async proof => {
        assert.equal(proof.verificationId, fence.verificationId); fence = null;
    };
    await h.delivery.tick({force: true}); h.delivery.stop();
    assert.ok(fence);
    finish({result: [], backendCompletionObserved: true});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fence, null);
    assert.equal(h.delivery.health().backendBlocked, false);
});

test('an explicitly observed local no-SQL branch cancels an unissued intent without inventing backend completion', async () => {
    let fence = null;
    const h = fixture(1, {readHistory: async () => ({error: 'No SQL instance configured',
        backendCompletionObserved: false, backendRequestIssued: false,
        localNotIssuedEvidence: 'configuration has no valid sql.N adapter; sendTo was never invoked'})});
    h.journal.health = () => ({sqlVerificationPending: fence !== null, sqlVerificationQuery: fence});
    h.journal.beginVerification = async query => {fence = query;};
    h.journal.cancelUnissuedVerification = async proof => {
        assert.equal(proof.kind, 'locally-never-issued');
        assert.equal(proof.verificationId, fence.verificationId); assert.ok(proof.evidence); fence = null;
    };
    h.journal.completeVerification = async () => assert.fail('no backend completion was observed');
    await h.delivery.tick({force: true});
    assert.equal(fence, null);
    assert.equal(h.delivery.health().backendBlocked, false);
    assert.equal(h.delivery.health().lastQuery.issued, false);
    assert.equal(h.delivery.health().lastQuery.backendCompletionObserved, false);
    assert.equal(h.stored.size, 1);
});



test('an observed completed SQL error narrows its next query without retrying inside the failed tick', async () => {
    let failed = false;
    const h = fixture(1, {readHistory: async request => {
        if (!failed) {failed = true; return {error: 'SQL read failed', backendCompletionObserved: true};}
        h.queries.push(request);
        return {result: [], backendCompletionObserved: true};
    }});
    await h.delivery.tick();
    assert.equal(h.delivery.health().backendBlocked, false);
    assert.equal(h.delivery.health().queryCount, 1);
    h.advance(100); await h.delivery.tick();
    assert.ok(h.queries.length > 0);
    assert.ok(h.queries.every(q => q.end - q.start <= 1000 && q.limit <= 16));
    assert.equal(h.confirmations.length, 0, 'an error or empty response cannot delete an original');
    h.delivery.stop();
});

test('local expiry removes delivery tracking and replay references without SQL success or a fast maintenance loop', async () => {
    const h = fixture(1, {readHistory: async () => ({result: [], backendCompletionObserved: true})});
    await h.delivery.tick({force: true});
    const id = h.entries[0].id;
    h.delivery.replayIds.add(id);
    h.delivery.replayGroups.set(id, {pending: new Set([id]), requests: 1});
    let maintenance = 0;
    h.journal.expireOldGroups = async () => {maintenance++; h.stored.delete(id); return [id];};
    await h.delivery.tick({force: true});
    assert.equal(h.delivery.entries.size, 0);
    assert.equal(h.delivery.identities.size, 0);
    assert.equal(h.delivery.replayIds.size, 0);
    assert.equal(h.delivery.replayGroups.size, 0);
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.delivery.health().sqlConfirmed, 0);
    await h.delivery.tick({force: true});
    assert.equal(maintenance, 1);
    h.advance(60000); await h.delivery.tick({force: true});
    assert.equal(maintenance, 2);
});

test('local expiry does not race an active verification or an unresolved publication', async () => {
    const h = fixture(); let maintenance = 0;
    h.journal.expireOldGroups = async () => {maintenance++; return [];};
    h.delivery.verificationBusy = true;
    await h.delivery.tick({force: true});assert.equal(maintenance, 0);
    h.delivery.verificationBusy = false;h.delivery.publicationBlocked = true;
    await h.delivery.tick({force: true});assert.equal(maintenance, 0);
});

test('observed SQL failure pauses publication and verification even under forced ticks; originals retained', async () => {
    const Backoff = require('../lib/sql-diagnostic-backoff');
    let clock = 100000;
    const backoff = new Backoff({now: () => clock});
    const h = fixture(2, {now: () => clock, backoff, readHistory: async () =>
        ({error: 'Out of resources (Errcode: 24)', backendCompletionObserved: true})});
    await h.delivery.tick({force: true});
    const before = h.delivery.health();
    assert.equal(backoff.paused(), true);
    for (let n = 0; n < 20; n++) await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().queryCount, before.queryCount);
    assert.equal(h.delivery.health().publicationAttempts, before.publicationAttempts);
    assert.equal(h.stored.size, 2);
    clock += 60000;
    await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().queryCount, before.queryCount + 1);
    assert.equal(backoff.health().failures, 2);
});

test('SQL log pause suppresses writes before any history request; exact proof is required for recovery', async () => {
    const Backoff = require('../lib/sql-diagnostic-backoff');
    let clock = 100000;
    const backoff = new Backoff({now: () => clock});
    let h;
    h = fixture(4, {now: () => clock, backoff, readHistory: async () =>
        ({result: h.publications.map(val => ({ts: clock, val})), backendCompletionObserved: true})});
    backoff.fail('sql-open-files-error-24');
    await h.delivery.tick({force: true});
    assert.equal(h.publications.length, 0); assert.equal(h.queries.length, 0);
    clock += 60000; h.advance(60000);
    await h.delivery.tick({force: true});
    assert.equal(h.publications.length, 1);
    assert.equal(h.confirmations.length, 1);
    assert.equal(backoff.degraded, false);
    assert.equal(h.stored.size, 3);
});

test('outage recovery resumes bounded backlog delivery only after a fresh exact storage proof', async () => {
    const Backoff = require('../lib/sql-diagnostic-backoff');
    let clock = 100000, healthy = false, active = 0, peakActive = 0, h;
    const sqlRows = [];
    const backoff = new Backoff({now: () => clock});
    h = fixture(12, {now: () => clock, backoff, maxPublishPerTick: 4, maxQueriesPerTick: 1,
        publish: async val => {
            h.publications.push(val);
            if (healthy) sqlRows.push({ts: clock, val});
            return {publishedAt: clock};
        },
        readHistory: async q => {
            active++; peakActive = Math.max(peakActive, active);
            try {
                if (!healthy) return {error: 'controlled database outage', backendCompletionObserved: true};
                return {result: sqlRows.filter(row => row.ts >= q.start && row.ts <= q.end),
                    backendCompletionObserved: true};
            } finally {active--;}
        }});
    await h.delivery.tick({force: true});
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.stored.size, 12, 'an error is never a persistence proof');
    const attempts = h.delivery.health().publicationAttempts;
    for (let n = 0; n < 10; n++) await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().publicationAttempts, attempts);
    healthy = true; clock += 60000; h.advance(60000);
    await h.delivery.tick({force: true});
    for (let n = 0; n < 12 && backoff.degraded; n++) {
        clock += 30000; h.advance(30000);
        const before = h.delivery.health();
        await h.delivery.tick({force: true});
        const after = h.delivery.health();
        assert.ok(after.queryCount - before.queryCount <= 1);
        assert.ok(after.publicationAttempts - before.publicationAttempts <= 1);
    }
    assert.equal(backoff.degraded, false, 'new exact storage match clears diagnostic pause');
    assert.ok(h.confirmations.length > 0);
    for (let n = 0; n < 60 && h.stored.size; n++) {
        clock += 61000; h.advance(61000);
        const before = h.delivery.health();
        await h.delivery.tick({force: true});
        const after = h.delivery.health();
        assert.ok(after.publicationAttempts - before.publicationAttempts <= 4);
        assert.ok(after.queryCount - before.queryCount <= 1);
    }
    assert.equal(h.stored.size, 0, 'healthy backend eventually drains a finite backlog');
    assert.equal(peakActive, 1);
    assert.equal(new Set(h.confirmations.map(e => e.id)).size, 12);
});

test('a completed empty history response does not prove database recovery or erase originals', async () => {
    const Backoff = require('../lib/sql-diagnostic-backoff');
    let clock = 100000;
    const backoff = new Backoff({now: () => clock});
    const h = fixture(4, {now: () => clock, backoff,
        readHistory: async () => ({result: [], backendCompletionObserved: true})});
    backoff.fail(); clock += 60000;
    await h.delivery.tick({force: true});
    await h.delivery.tick({force: true});
    assert.equal(h.publications.length, 1);
    assert.equal(h.delivery.health().queryCount, 1);
    assert.equal(backoff.degraded, true); assert.equal(h.stored.size, 4);
});


test('cooldown cannot override unknown backend completion or resume publications behind its fence', async () => {
    const Backoff = require('../lib/sql-diagnostic-backoff');
    let clock = 100000;
    const backoff = new Backoff({now: () => clock});
    const h = fixture(8, {now: () => clock, backoff, maxPublishPerTick: 1,
        readHistory: async () => ({error: 'connector failure', backendCompletionObserved: false})});
    await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().backendBlocked, true);
    clock += 600000; await h.delivery.tick({force: true});
    assert.equal(h.publications.length, 1);
    assert.equal(h.delivery.health().queryCount, 1);
    assert.equal(h.stored.size, 8);
    assert.equal(backoff.degraded, true);
});

test('degraded verification cadence applies across different queued windows, including forced ticks', async () => {
    const Backoff = require('../lib/sql-diagnostic-backoff');
    let clock = 100000;
    const backoff = new Backoff({now: () => clock});
    const h = fixture(4, {now: () => clock, backoff,
        readHistory: async () => ({result: [], backendCompletionObserved: true})});
    backoff.fail(); clock += 60000; h.advance(60000);
    await h.delivery.tick({force: true});
    const entry = [...h.delivery.entries.values()][0];
    h.delivery.addWindow(clock + 2000, clock + 3000, entry.id);
    for (let i = 0; i < 10; i++) {clock += 1000; await h.delivery.tick({force: true});}
    assert.equal(h.delivery.health().queryCount, 1);
    clock += 20000; h.advance(30000);
    await h.delivery.tick({force: true});
    assert.equal(h.delivery.health().queryCount, 2);
    assert.equal(backoff.degraded, true);
});


// Regression: fresh persistence proof must not wait behind a stale verification
// queue until its timestamp can no longer satisfy the unchanged recovery guard.
async function recoveryBacklog({visibilityDelayMs = 0, withholdFresh = false} = {}) {
    const Backoff = require('../lib/sql-diagnostic-backoff');
    let clock = 100000, expose = false, active = 0, peak = 0;
    const sql = [], requests = [];
    const backoff = new Backoff({now: () => clock});
    const h = fixture(1000, {now: () => clock, backoff, bundleOriginals: true,
        maxPublishPerTick: 16, maxWritesPerTick: 4, maxQueriesPerTick: 1,
        publishIntervalMs: 5000, checkIntervalMs: 30000, minQueryGapMs: 1,
        publish: async val => {sql.push({ts: clock, val}); return {publishedAt: clock};},
        readHistory: async q => {
            active++; peak = Math.max(peak, active); requests.push({...q});
            try {return {result: expose ? sql.filter(row => row.ts >= q.start && row.ts <= q.end
                && row.ts <= clock - visibilityDelayMs
                && (!withholdFresh || row.ts < backoff.lastFailureAt)) : [], backendCompletionObserved: true};}
            finally {active--;}
        }});
    for (let n = 0; n < 10; n++) {await h.delivery.tick(); clock += 5000;}
    assert.equal(h.delivery.health().pendingWindows, 10);
    backoff.fail('controlled-completed-error'); expose = true; clock += 60000;
    const before = h.delivery.health();
    for (let n = 0; n < 180 && (n < 60 || h.stored.size); n++) {
        const previous = h.delivery.health();
        await h.delivery.tick();
        const current = h.delivery.health();
        assert.ok(current.queryCount - previous.queryCount <= 1, 'existing one-query budget');
        assert.ok(current.transportWrites - previous.transportWrites <= 4, 'existing transport call budget');
        if (previous.sqlBackoff.degraded) assert.ok(current.publicationAttempts - previous.publicationAttempts <= 1);
        clock += 30000;
    }
    const after = h.delivery.health(); h.delivery.stop();
    return {h, backoff, before, after, requests, peak};
}

test('healthy backend recovers from ten stale proof windows without raising SQL budgets', async () => {
    const r = await recoveryBacklog();
    assert.equal(r.backoff.degraded, false);
    assert.equal(r.h.stored.size, 0, 'finite backlog drains through exact storage matches');
    assert.equal(r.after.sqlConfirmed, 1000);
    assert.equal(r.after.queryErrors, 0);
    assert.equal(r.peak, 1);
});

test('fresh recovery proof tolerates asynchronous persistence within the unchanged freshness guard', async () => {
    const r = await recoveryBacklog({visibilityDelayMs: 5000});
    assert.equal(r.backoff.degraded, false, 'a just-published miss must not starve a committed recent original');
    assert.ok(r.after.sqlConfirmed > 206);
    assert.equal(r.after.queryErrors, 0);
    assert.equal(r.peak, 1);
});

test('fresh-probe scheduling never invents recovery and still services old stored originals', async () => {
    const r = await recoveryBacklog({withholdFresh: true});
    assert.equal(r.backoff.degraded, true, 'old storage and empty recent windows cannot prove new writes');
    assert.equal(r.backoff.lastProofAt, null);
    assert.ok(r.after.sqlConfirmed >= 128 && r.after.sqlConfirmed <= 160, 'old proof work is not starved');
    assert.ok(r.h.confirmations.every(proof => Number(proof.id) <= 160), 'no new write is falsely confirmed');
    assert.equal(r.h.stored.size + r.after.sqlConfirmed, 1000, 'all unproven originals remain retained');
    assert.equal(r.peak, 1);
});

function multiBundleFixture(count, options = {}) {
    const sql = [];
    const h = fixture(count, {bundleOriginals: true, maxPublishPerTick: 16, maxWritesPerTick: 4,
        maxOriginalsPerTick: 64, maxReadOriginalBytes: 2 * 1024 * 1024,
        maxBatchBytes: 512 * 1024, publishIntervalMs: 5000, maxQueriesPerTick: 1,
        publish: async val => {sql.push({ts: h.now(), val}); return {publishedAt: h.now()};},
        readHistory: async q => ({result: sql.filter(row => row.ts >= q.start && row.ts <= q.end),
            backendCompletionObserved: true}), ...options});
    for (const entry of h.entries) {
        const frame = JSON.parse(entry.payload); frame.production = {stable: 'x'.repeat(12000)};
        entry.payload = JSON.stringify(frame); entry.payloadBytes = Buffer.byteLength(entry.payload);
        entry.sha256 = createHash('sha256').update(entry.payload).digest('hex');
    }
    return {...h, sql};
}

test('multiple bounded bundles drain a backlog while forty new raw originals arrive every five seconds', async () => {
    const h = multiBundleFixture(1200);
    h.stored.clear();
    for (const entry of h.entries.slice(0, 400)) h.stored.set(entry.id, entry);
    for (let round = 0; round < 20; round++) {
        for (const entry of h.entries.slice(400 + round * 40, 440 + round * 40)) h.stored.set(entry.id, entry);
        const before = h.sql.length, queries = h.delivery.health().queryCount;
        await h.delivery.tick();
        const writes = h.sql.slice(before);
        assert.ok(writes.length <= 4);
        assert.ok(writes.reduce((n, r) => n + Buffer.byteLength(r.val), 0) <= 512 * 1024);
        assert.ok(writes.every(r => Buffer.byteLength(r.val) <= 60 * 1024 && unpackOriginals(r.val).length <= 16));
        assert.ok(h.delivery.health().queryCount - queries <= 1);
        h.advance(5000);
    }
    assert.equal(h.stored.size, 0, 'finite initial backlog drains despite continuous new immutable observations');
    assert.equal(h.confirmations.length, 1200);
    assert.deepEqual(h.sql.flatMap(r => unpackOriginals(r.val)), h.entries.map(e => e.payload));
    assert.equal(h.delivery.health().queryErrors, 0);
});

test('multiple-bundle delivery does not confirm or discard originals when SQL misses them', async () => {
    const h = multiBundleFixture(128, {readHistory: async () => ({result: [], backendCompletionObserved: true})});
    await h.delivery.tick(); h.advance(5000); await h.delivery.tick();
    assert.equal(h.sql.length, 8);
    assert.equal(h.stored.size, 128);
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.delivery.health().publicationAttempts, 128);
});

test('multiple-bundle delivery preserves strict degraded single-original cadence', async () => {
    const Backoff = require('../lib/sql-diagnostic-backoff');
    let clock = 100000;
    const backoff = new Backoff({now: () => clock}); backoff.fail('completed-error');
    clock += 60000;
    const h = multiBundleFixture(128, {now: () => clock, backoff,
        publish: async () => ({publishedAt: clock}),
        readHistory: async () => ({result: [], backendCompletionObserved: true})});
    await h.delivery.tick();
    assert.equal(h.delivery.health().publicationAttempts, 1);
    clock += 5000; await h.delivery.tick();
    assert.equal(h.delivery.health().publicationAttempts, 1);
    clock += 25000; await h.delivery.tick();
    assert.equal(h.delivery.health().publicationAttempts, 2);
    assert.equal(backoff.degraded, true);
});

test('expanded original work still respects encoded size limits and retains a bounded unsent suffix', async () => {
    const h = multiBundleFixture(64);
    for (const e of h.entries) {
        const f = JSON.parse(e.payload); f.production.stable = require('node:crypto').randomBytes(40000).toString('base64');
        e.payload = JSON.stringify(f); e.payloadBytes = Buffer.byteLength(e.payload);
        e.sha256 = createHash('sha256').update(e.payload).digest('hex');
    }
    await h.delivery.tick();
    assert.equal(h.sql.length, 4);
    assert.equal(h.confirmations.length, 4);
    assert.equal(h.stored.size, 60);
    assert.equal(h.delivery.cursor, h.entries[3].id);
    h.advance(5000); await h.delivery.tick();
    assert.equal(h.confirmations.length, 8);
    assert.equal(h.stored.size, 56);
});

test('original-work expansion rejects unbounded or unbundled configurations', () => {
    for (const options of [{maxOriginalsPerTick: 65}, {maxReadOriginalBytes: 2 * 1024 * 1024 + 1},
        {bundleOriginals: false, maxOriginalsPerTick: 64},
        {bundleOriginals: true, maxOriginalsPerTick: 64, maxWritesPerTick: 2}])
        assert.throws(() => fixture(1, options), /bounded transport contract/);
});

test('SQL coalescing or loss of sibling bundles cannot falsely confirm the missing originals', async () => {
    let last = null;
    const h = multiBundleFixture(64, {
        publish: async val => {last = {ts: h.now(), val}; return {publishedAt: h.now()};},
        readHistory: async () => ({result: [last], backendCompletionObserved: true})});
    await h.delivery.tick();
    assert.equal(h.confirmations.length, 16, 'only the actually returned final bundle proves storage');
    assert.equal(h.stored.size, 48, 'other successful state writes remain unconfirmed, not discarded');
    assert.equal(h.delivery.health().pendingEntries, 48);
});

test('unresolved publication completion stops the expanded batch and retains every original', async () => {
    let complete, calls = 0;
    const h = multiBundleFixture(64, {publishTimeoutMs: 10,
        publish: () => {calls++; return new Promise(resolve => {complete = resolve;});},
        readHistory: async () => ({result: [], backendCompletionObserved: true})});
    await h.delivery.tick();
    assert.equal(calls, 1);
    assert.equal(h.delivery.health().publicationBlocked, true);
    assert.equal(h.delivery.health().publicationAttempts, 16);
    h.advance(5000); await h.delivery.tick();
    assert.equal(calls, 1, 'unknown write completion cannot launch sibling bundles');
    assert.equal(h.stored.size, 64);
    assert.equal(h.confirmations.length, 0);
    complete({publishedAt: h.now()}); await new Promise(resolve => setImmediate(resolve));
    h.delivery.stop();
});

function spreadBundleFixture(count, options = {}) {
    let h;
    const read = options.readHistory || (async q => ({result: h.sql.filter(row => row.ts >= q.start && row.ts <= q.end),
        backendCompletionObserved: true}));
    h = multiBundleFixture(count, {maxVerificationSpanMs: 10000,
        publish: async val => {h.advance(700); h.sql.push({ts: h.now(), val}); return {publishedAt: h.now()};},
        ...options, readHistory: q => {h.queries.push(q); return read(q);}});
    return h;
}

test('adjacent publication windows confirm all spread bundles in one bounded query per batch', async () => {
    const h = spreadBundleFixture(640);
    for (let round = 0; round < 10; round++) {
        const queries = h.delivery.health().queryCount;
        await h.delivery.tick(); h.advance(5000);
        assert.equal(h.delivery.health().queryCount - queries, 1);
    }
    assert.equal(h.confirmations.length, 640);
    assert.equal(h.stored.size, 0);
    assert.ok(h.queries.every(q => q.end - q.start < 10000 && q.limit === 32));
    assert.equal(h.delivery.health().pendingWindows, 0);
    assert.ok(h.delivery.health().lastQuery.responseObservedMs >= 0);
    assert.ok(h.delivery.health().lastQuery.proofProcessingMs >= 0);
});

test('coalesced exact proof leaves a missing sibling bundle and its original identities unknown', async () => {
    let h;
    h = spreadBundleFixture(64, {readHistory: async q => ({result: h.sql.slice(1)
        .filter(row => row.ts >= q.start && row.ts <= q.end), backendCompletionObserved: true})});
    await h.delivery.tick();
    assert.equal(h.confirmations.length, 48);
    assert.equal(h.stored.size, 16);
    assert.ok(h.confirmations.every(p => Number(p.id) > 16));
    assert.equal(h.delivery.health().pendingEntries, 16);
});

test('saturated coalesced windows split without remerging or claiming complete miss coverage', async () => {
    let h;
    h = spreadBundleFixture(64, {readHistory: async q => ({result: Array.from({length: q.limit}, () =>
        ({ts: q.start, val: JSON.stringify({schema: 2, recordSession: 'unrelated', recordSequence: 1})})),
        backendCompletionObserved: true})});
    await h.delivery.tick();
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.delivery.health().saturatedWindows, 1);
    assert.ok([...h.delivery.windows.values()].every(w => w.depth === 1 && w.end - w.start <= 2000));
    assert.ok([...h.delivery.entries.values()].every(e => e.completeMisses === 0));
    h.advance(5000); await h.delivery.tick();
    assert.ok(h.queries.at(-1).end - h.queries.at(-1).start <= 2000, 'split windows stay narrow');
});

test('coalescing respects due times, failure windows, ID limits and the ten-second ceiling', () => {
    const h = spreadBundleFixture(1), d = h.delivery;
    d.windows.clear();
    d.addWindow(100000, 101999, 'a'); d.addWindow(108000, 109999, 'b'); d.addWindow(110000, 111999, 'c');
    const first = d.windows.get('100000:101999');
    const m = d.coalesceVerification(first, [...d.windows.values()]);
    assert.equal(m.end, 109999); assert.deepEqual([...m.ids], ['a', 'b']);
    assert.equal(d.windows.size, 2);
    m.depth = 1;
    assert.equal(d.coalesceVerification(m, [...d.windows.values()]), m);
    m.depth = 0; d.backoff = {degraded: true};
    assert.equal(d.coalesceVerification(m, [...d.windows.values()]), m);
    d.backoff = null; m.noCoalesce = true;
    assert.equal(d.coalesceVerification(m, [...d.windows.values()]), m, 'failed work is never expanded');
    d.windows.clear();
    d.addWindow(100000, 100999, 'a'); d.addWindow(101000, 101999, 'b');
    const limited = d.windows.get('100000:100999');
    limited.ids = new Set(Array.from({length: 600}, (_, i) => `a${i}`));
    d.windows.get('101000:101999').ids = new Set(Array.from({length: 500}, (_, i) => `b${i}`));
    assert.equal(d.coalesceVerification(limited, [...d.windows.values()]), limited, 'identity work remains bounded');
    assert.throws(() => fixture(1, {maxVerificationSpanMs: 10001}), /bounded transport/);
});

test('unknown completion of a coalesced read fences all later reads and retains every original', async () => {
    let queries = 0, complete;
    const h = spreadBundleFixture(64, {queryTimeoutMs: 10,
        readHistory: () => {queries++; return new Promise(resolve => {complete = resolve;});}});
    await h.delivery.tick();
    assert.equal(h.delivery.health().backendBlocked, true);
    assert.equal(h.confirmations.length, 0);
    h.advance(5000); await h.delivery.tick();
    assert.equal(queries, 1);
    assert.equal(h.stored.size, 64);
    complete({result: [], backendCompletionObserved: true});
    await new Promise(resolve => setImmediate(resolve)); h.delivery.stop();
});

test('one independent SQL response submits a deduplicated exact proof batch once', async () => {
    let h, calls = 0;
    h = fixture(16, {bundleOriginals: true, readHistory: async () => ({
        result: h.publications.flatMap(val => [{ts: h.now(), val}, {ts: h.now(), val}]),
        backendCompletionObserved: true})});
    h.journal.confirmStoredBatch = async proofs => {
        calls++;
        for (const {id, proof} of proofs) await h.journal.confirmStored(id, proof);
        return {confirmedIds: proofs.map(p => p.id), cleanupError: ''};
    };
    await h.delivery.tick();
    assert.equal(calls, 1); assert.equal(h.confirmations.length, 16); assert.equal(h.stored.size, 0);
});

test('shutdown drains an actual late SQL callback and its durable fence before journal close', {timeout:10000},async t=>{
    const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
    const Journal=require('../lib/decision-record-journal');
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ems-sql-drain-'));
    let journal=new Journal({directory});
    try{
        await journal.initialize();await journal.append(fixture().entries[0].payload);
        let started,finish;const issued=new Promise(r=>{started=r;});
        t.mock.timers.enable({apis:['setTimeout']});
        const d=new DecisionRecordDelivery({journal,now:()=>100000,queryTimeoutMs:50,
            publish:async()=>({publishedAt:100000}),readHistory:()=>{started();return new Promise(r=>{finish=r;});}});
        const running=d.tick({force:true});await issued;t.mock.timers.tick(51);await running;
        assert.equal(journal.health().sqlVerificationPending,true);
        const draining=d.stopAndDrain(2000);
        finish({result:[],backendCompletionObserved:true});
        const result=await draining;
        assert.equal(result.settled,true);assert.equal(result.fencePending,false);
        assert.equal(journal.health().unconfirmedRecords,1,'callback is not a matching storage proof');
        t.mock.timers.reset();await journal.close();
        journal=new Journal({directory});await journal.initialize();
        assert.equal(journal.health().sqlVerificationPending,false,'completion survives process restart');
        assert.equal(journal.health().unconfirmedRecords,1);
    }finally{t.mock.timers.reset();await journal.close();await fs.rm(directory,{recursive:true,force:true});}
});

test('bounded shutdown never clears an unresolved backend request or issues another query',async t=>{
    let pending=false,started,calls=0;const issued=new Promise(r=>{started=r;});
    const h=fixture(1,{readHistory:()=>{calls++;started();return new Promise(()=>{});}});
    h.journal.health=()=>({sqlVerificationPending:pending});
    h.journal.beginVerification=async()=>{pending=true;};
    h.journal.completeVerification=async()=>{pending=false;};
    t.mock.timers.enable({apis:['setTimeout']});
    const running=h.delivery.tick({force:true});await issued;t.mock.timers.tick(21);await running;
    const draining=h.delivery.stopAndDrain(10);t.mock.timers.tick(11);
    const result=await draining;
    assert.equal(result.settled,false);assert.equal(result.fencePending,true);
    assert.equal(pending,true);await h.delivery.tick({force:true});assert.equal(calls,1);
});

test('an inherited orphan fence remains unknown even when this process has no backend operations',async()=>{
    const h=fixture();h.journal.health=()=>({sqlVerificationPending:true});
    const result=await h.delivery.stopAndDrain(0);
    assert.equal(result.settled,true);assert.equal(result.fencePending,true);
    assert.equal(h.queries.length,0);assert.equal(h.confirmations.length,0);
});
