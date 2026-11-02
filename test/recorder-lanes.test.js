'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Journal = require('../lib/decision-record-journal');
const Delivery = require('../lib/decision-record-delivery');
const Backoff = require('../lib/sql-diagnostic-backoff');
const payload = n => JSON.stringify({schema: 2, recordSession: 'lanes', recordSequence: n,
    timestamp: 1000 + n, event: {type: 'source.update', state: {val: n, ack: true}}});

test('real files and an inherited unknown reader fence retain originals while bounded publication resumes after restart', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-lanes-'));
    const journals = [], deliveries = [];
    t.after(async () => {
        for (const d of deliveries) d.stop();
        for (const j of journals) await j.close();
        await fs.rm(directory, {recursive: true, force: true});
    });
    let now = 100000, queries = 0;const publications = [];
    const options = journal => ({journal, now: () => now, backoff: new Backoff({now: () => now}),
        publishIntervalMs: 5000, maxPublishPerTick: 1, maxQueriesPerTick: 1, queryTimeoutMs: 1000,
        publish: async val => {publications.push(val);return {publishedAt: now};},
        readHistory: () => {queries++;return new Promise(() => {});}});
    const j = new Journal({directory, now: () => now});journals.push(j);await j.initialize();
    await j.append(payload(1));await j.append(payload(2));
    const d = new Delivery(options(j));deliveries.push(d);await d.tick();
    assert.equal(queries, 1);assert.equal(j.health().sqlVerificationPending, true);
    const queryId = j.health().sqlVerificationQuery.verificationId;
    now += 2 * 86400000;
    await j.append(payload(3));await d.tick();
    assert.equal(publications.length, 2, 'publication progresses across the original read timeout');
    assert.equal(j.health().records, 3);assert.equal(j.health().sqlConfirmedRecords, 0);
    const originals = (await j.readBatch()).map(e => e.payload);
    d.stop();await j.close();

    const r = new Journal({directory, now: () => now});journals.push(r);await r.initialize();
    const after = new Delivery(options(r));deliveries.push(after);await after.tick();
    assert.equal(queries, 1, 'restart cannot bypass the persisted unresolved reader request');
    assert.equal(after.health().reader.state, 'blocked');
    assert.equal(after.health().reader.persistentFence, true);
    assert.equal(after.health().reader.lastOperation.verificationId, queryId);
    assert.equal(after.health().writer.completedWrites, 1, 'an inherited reader fence does not stop publication');
    assert.deepEqual((await r.readBatch()).map(e => e.payload), originals);
    assert.equal(r.health().expiredUnconfirmedRecords, 0);
    assert.equal(r.health().sqlConfirmedRecords, 0);
});

test('separate lane backoffs cannot accidentally be configured as the same mutable brake', () => {
    const shared = new Backoff();
    assert.throws(() => new Delivery({journal: {readBatch() {}, markPublished() {}, confirmStored() {}},
        backoff: shared, writeBackoff: shared, publish() {}, readHistory() {}}), /must be independent/);
});
