'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
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
    assert.equal(h.publications[0], h.entries[0].payload);
    assert.deepEqual(JSON.parse(h.publications[0]).event.state,
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
    assert.deepEqual(h.publications.map(p => JSON.parse(p).recordSequence), Array.from({length: 16}, (_, i) => i + 1));
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
            publish: async value => {assert.equal(value, payload); attempts++; return {publishedAt: 100000};},
            readHistory: async () => ({result: [], backendCompletionObserved: true})});
        await first.tick({force: true}); first.stop();
        assert.equal(journal.health().records, 1);
        await journal.close();
        journal = new DecisionRecordJournal({directory}); await journal.initialize();
        const second = new DecisionRecordDelivery({journal, now: () => 102000,
            publish: async value => {assert.equal(value, payload); attempts++; return {publishedAt: 102000};},
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
    assert.equal(h.publications[1], h.entries[0].payload);
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
    assert.equal(h.publications.filter(p => JSON.parse(p).recordSequence === 1).length, 5);
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
                if (recovered || JSON.parse(payload).recordSequence === 1) sql.push({ts: clock, val: payload});
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
        assert.deepEqual(publications.slice(2), originals, 'byte-exact original snapshot precedes its delta');
        assert.equal(journal.health().unconfirmedRecords, 0);
        assert.deepEqual(decodeDecisionRecords(sql).map(row => row.val.production.budgetW), [1, 2]);
    } finally {await journal.close(); await fs.rm(directory, {recursive: true, force: true});}
});

test('an unresolved SQL request remains fenced across journal and delivery restart', async () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    const DecisionRecordJournal = require('../lib/decision-record-journal');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-delivery-fence-'));
    let journal = new DecisionRecordJournal({directory}), calls = 0;
    try {
        await journal.initialize(); await journal.append(fixture().entries[0].payload);
        const first = new DecisionRecordDelivery({journal, now: () => 100000, queryTimeoutMs: 50,
            publish: async () => ({publishedAt: 100000}),
            readHistory: async () => {calls++; return new Promise(() => {});}});
        await first.tick({force: true}); first.stop();
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
    } finally {await journal.close(); await fs.rm(directory, {recursive: true, force: true});}
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
