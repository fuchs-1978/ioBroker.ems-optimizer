'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {SqlVerificationRecovery, GRANTS, QUIET} = require('../lib/sql-verification-recovery');

function fixture({permission = true, active = false, restarted = true, query} = {}) {
    let now = 100000, inspection = null, pending = true, clears = 0;
    const calls = [], original = {verificationId: 'old', start: 1, end: 2, limit: 32, beganAt: 1000};
    const journal = {health: () => ({sqlVerificationPending: pending, sqlVerificationQuery: original, sqlRecoveryInspection: inspection}),
        async beginRecoveryInspection(id, value) {assert.equal(id, 'old'); assert.equal(inspection, null); inspection = value;},
        async completeRecoveryInspection(id) {assert.equal(id, inspection.verificationId); inspection = null;}};
    const states = () => ({alive: {val: true, ack: true, ts: now, lc: restarted ? 3000 : 500},
        kill: {val: 42, ack: true, ts: 2000}, connection: {val: true, ack: true, ts: 3001},
        uptime: {val: (now - 3000) / 1000, ack: true, ts: now}});
    const recovery = new SqlVerificationRecovery({journal, now: () => now, timeoutMs: 5, states: async () => states(),
        delivery: {async recoverBackend(proof) {assert.equal(proof.verificationId, 'old'); assert.equal(inspection, null); pending = false; clears++;}},
        query: async sql => {calls.push(sql); return query ? query(sql) : {backendCompletionObserved: true,
            result: sql === GRANTS ? [{grants: permission ? 'GRANT PROCESS, SELECT ON *.* TO x' : 'GRANT ALL PRIVILEGES ON db.* TO x'}]
                : active ? [{ID: 7, COMMAND: 'Query'}] : []};}});
    return {recovery, calls, journal, states, advance: ms => {now += ms;}, clears: () => clears};
}

test('a later terminated SQL generation plus global quiescence clears only the orphan fence, not storage coverage', async () => {
    const h = fixture();
    assert.equal((await h.recovery.tick()).state, 'recovered');
    assert.deepEqual(h.calls, [GRANTS, QUIET]); assert.equal(h.clears(), 1);
    assert.match(h.recovery.status.reason, /coverage still unknown/);
});

test('connection alone, insufficient visibility and active database work never clear an orphan fence', async () => {
    for (const options of [{restarted: false}, {permission: false}, {active: true}]) {
        const h = fixture(options); assert.equal((await h.recovery.tick()).state, 'blocked');
        assert.equal(h.clears(), 0);
    }
});

test('recovery inspection attempts are paced, finite, read-only and never overlap', async () => {
    const h = fixture({active: true});
    for (let n = 0; n < 10; n++) {await Promise.all([h.recovery.tick(), h.recovery.tick()]); h.advance(60000);}
    assert.equal(h.calls.length, 6); assert.equal(h.clears(), 0);
    assert.ok(h.calls.every(sql => [GRANTS, QUIET].includes(sql)));
});

test('changed SQL generation and locally cancelled unload probes cannot clear the original fence', async () => {
    const h = fixture(); let reads = 0;
    h.recovery.states = async () => {
        const states = h.states();
        if (++reads > 1) states.alive.lc = 4000;
        return states;
    };
    assert.equal((await h.recovery.tick()).state, 'blocked'); assert.equal(h.clears(), 0);
    const stopped = fixture({query: async () => ({backendRequestIssued: false, localNotIssuedEvidence: 'unload gate'})});
    await stopped.recovery.tick(); assert.equal(stopped.journal.health().sqlRecoveryInspection, null);
    assert.equal(stopped.clears(), 0);
});

test('unknown metadata timeout keeps its durable inspection fence and prevents retry', async () => {
    const h = fixture({query: () => new Promise(() => {})});
    assert.equal((await h.recovery.tick()).state, 'blocked');
    h.advance(60000); await h.recovery.tick();
    assert.equal(h.calls.length, 1); assert.ok(h.journal.health().sqlRecoveryInspection);
    assert.equal(h.clears(), 0);
});

test('a persistent recovery inspection survives restart and cannot be mistaken for old query completion', async t => {
    const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
    const Journal = require('../lib/decision-record-journal');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-inspection-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    let journal = new Journal({directory}); await journal.initialize();
    const old = {verificationId: 'old', start: 1, end: 2, limit: 32, beganAt: 1000};
    await journal.beginVerification(old);
    await journal.beginRecoveryInspection('old', {...old, verificationId: 'metadata'}); await journal.close();
    journal = new Journal({directory}); await journal.initialize();
    assert.equal(journal.health().sqlRecoveryInspection.verificationId, 'metadata');
    await assert.rejects(journal.completeVerification({kind: 'observed-backend-completion', verificationId: 'old', evidence: 'callback'}));
    await journal.completeRecoveryInspection('metadata');
    assert.equal(journal.health().sqlVerificationPending, true);
    await journal.completeVerification({kind: 'observed-backend-completion', verificationId: 'old', evidence: 'independent end proof'});
    assert.equal(journal.health().sqlVerificationPending, false); await journal.close();
});
