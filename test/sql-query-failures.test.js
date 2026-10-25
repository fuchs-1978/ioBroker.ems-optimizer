'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Failures = require('../lib/sql-query-failures');
const Delivery = require('../lib/decision-record-delivery');

function fixture(options = {}) {
    let clock = 100000;
    const journal = {readBatch: async () => [], markPublished() {}, confirmStored() {},
        beginVerification: async () => {}, completeVerification: async () => {},
        health: () => ({queuedOperations: 2, pendingRecords: 1})};
    const delivery = new Delivery({journal, publish: async () => {}, now: () => clock,
        readHistory: async () => ({result: [], backendCompletionObserved: true}), queryTimeoutMs: 10,
        ...options});
    const task = n => ({key: String(n), start: 100000 + n * 2000, end: 101999 + n * 2000,
        ids: new Set(), depth: 0, checkedAt: null, limit: 32});
    return {delivery, journal, task, advance: ms => {clock += ms;}};
}

test('failed query survives more than 128 later successful reads and contains no raw response or error secrets', async () => {
    let fail = true;
    const h = fixture({readHistory: async () => fail
        ? {error: 'database password=private and private-host', backendCompletionObserved: true}
        : {result: [], backendCompletionObserved: true}});
    await h.delivery.readWindow(h.task(0)); fail = false;
    for (let n = 1; n < 140; n++) await h.delivery.readWindow(h.task(n));
    const report = h.delivery.queryFailures.report();
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].reason, 'sql-response-error');
    assert.equal(report.failures[0].phase, 'response-validation');
    assert.equal(report.failures[0].limit, 32);
    assert.equal(h.delivery.queryErrors, 1);
    assert.ok(!JSON.stringify(report).includes('private'));
    assert.equal(h.delivery.health().lastQuery.outcome, 'complete');
});

test('late real callback updates the retained failure without admitting another query or claiming storage', async () => {
    let finish, calls = 0;
    const h = fixture({readHistory: () => {calls++; return new Promise(r => {finish = r;});}});
    await h.delivery.readWindow(h.task(0));
    const first = h.delivery.queryFailures.report().failures[0];
    assert.equal(first.reason, 'deadline');
    assert.equal(first.backendCompletionObserved, false);
    assert.equal(first.callbackAt, null);
    assert.equal(h.delivery.backendBlocked, true);
    h.advance(500); finish({result: [], backendCompletionObserved: true});
    await new Promise(r => setImmediate(r));
    const late = h.delivery.queryFailures.report().failures[0];
    assert.equal(late.verificationId, first.verificationId);
    assert.equal(late.failureAt, first.failureAt);
    assert.equal(late.callbackAt, 100500);
    assert.equal(late.backendCompletionObserved, true);
    assert.equal(late.fenceCompletedAt, 100500);
    assert.ok(late.transportWaitMs >= 0);
    assert.equal(h.delivery.backendBlocked, false);
    assert.equal(calls, 1);
    assert.equal(h.delivery.sqlConfirmed, 0);
});

test('journal preparation timeout remains distinct from an issued transport and a later local cancellation', async () => {
    let begin, issued = 0;
    const h = fixture({readHistory: async () => {issued++; return {result: []};}});
    h.journal.beginVerification = () => new Promise(r => {begin = r;});
    h.journal.cancelUnissuedVerification = async () => {};
    await h.delivery.readWindow(h.task(0));
    const first = h.delivery.queryFailures.report().failures[0];
    assert.equal(first.phase, 'journal-begin');
    assert.equal(first.issued, false);
    assert.equal(first.transportAt, null);
    begin(); await new Promise(r => setImmediate(r));
    const late = h.delivery.queryFailures.report().failures[0];
    assert.equal(late.localIssuanceCancelled, true);
    assert.equal(late.backendCompletionObserved, false);
    assert.equal(issued, 0);
});

test('bounded failure checkpoint restores strictly and never evicts errors for successful queries', () => {
    const f = new Failures();
    for (let i = 0; i < 25; i++) f.capture({verificationId: `decision-record:${i}`,
        start: i, end: i + 1, limit: 32, beganAt: i, issued: true},
    'deadline', 'transport', i + 10);
    const saved = JSON.stringify(f.report());
    assert.ok(Buffer.byteLength(saved) <= Failures.MAX_BYTES);
    assert.equal(f.report().failures.length, 16);
    assert.equal(f.report().evicted, 9);
    const restored = new Failures(saved);
    assert.deepEqual(restored.report().failures, f.report().failures);
    assert.equal(restored.report().checkpointStatus, 'restored');
    const bad = JSON.parse(saved); bad.failures[0].rawSecret = 'private';
    const invalid = new Failures(JSON.stringify(bad));
    assert.equal(invalid.report().failures.length, 0);
    assert.equal(invalid.report().checkpointStatus, 'invalid');
});

test('an observed SQL callback and a stalled local fence completion are diagnosed separately', async () => {
    let complete, pending = false;
    const h = fixture();
    h.journal.beginVerification = async () => {pending = true;};
    h.journal.completeVerification = () => new Promise(r => {complete = () => {pending = false; r();};});
    h.journal.health = () => ({sqlVerificationPending: pending});
    await h.delivery.readWindow(h.task(0));
    const f = h.delivery.queryFailures.report().failures[0];
    assert.equal(f.reason, 'deadline'); assert.equal(f.phase, 'journal-complete');
    assert.equal(f.callbackAt, 100000); assert.equal(f.fenceCompletedAt, null);
    assert.equal(f.backendCompletionObserved, true);
    assert.equal(h.delivery.backendBlocked, true);
    h.advance(100); complete(); await new Promise(r => setImmediate(r));
    assert.equal(h.delivery.queryFailures.report().failures[0].fenceCompletedAt, 100100);
    assert.equal(h.delivery.backendBlocked, false);
});

test('transport rejection and malformed completed response retain different failure classes', async () => {
    for (const [readHistory, reason, phase] of [
        [async () => {throw new Error('secret');}, 'transport-rejection', 'transport'],
        [async () => ({result: 'invalid', backendCompletionObserved: true}), 'invalid-response', 'response-validation']
    ]) {
        const h = fixture({readHistory}); await h.delivery.readWindow(h.task(0));
        const f = h.delivery.queryFailures.report().failures[0];
        assert.equal(f.reason, reason); assert.equal(f.phase, phase);
        assert.equal(h.delivery.backendBlocked, reason === 'transport-rejection');
        assert.ok(!JSON.stringify(f).includes('secret'));
    }
});

test('late metadata after capacity eviction cannot resurrect an old error or exceed the byte bound', () => {
    const f = new Failures();
    for (let i = 0; i < 30; i++) f.capture({verificationId: `decision-record:${i}`,
        start: i, end: i + 1, limit: 32, beganAt: i, issued: true}, 'deadline', 'transport', i + 10);
    const before = f.revision;
    f.update({verificationId: 'decision-record:0', callbackAt: 100});
    assert.equal(f.revision, before);
    assert.equal(f.report().failures.length, 16);
    const bad = f.report(); bad.failures[0].phase = 'unrecognised';
    assert.equal(new Failures(JSON.stringify(bad)).report().checkpointStatus, 'invalid');
});
