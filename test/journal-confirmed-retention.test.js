'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const Journal = require('../lib/decision-record-journal');
const {DecisionRecordEncoder, decodeDecisionRecords} = require('../lib/decision-record-codec');
const AGE = 86400000;
const legacy = seq => JSON.stringify({schema: 2, recordSession: 'legacy', recordSequence: seq, timestamp: 1000 + seq});
const proof = e => ({kind: 'independent-history-match', recordSession: e.recordSession,
    recordSequence: e.recordSequence, sha256: e.sha256});
async function dir(t) {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-confirmed-retention-'));
    t.after(() => fs.rm(d, {recursive: true, force: true}));return d;
}
function frames() {
    const encoder = new DecisionRecordEncoder();
    return [1000, 2000, 31000].map((timestamp, i) => JSON.stringify(encoder.encode({schema: 2,
        recordSession: 'chain', recordSequence: i + 1, timestamp, production: {long: 'context'.repeat(100), value: i}})));
}

test('unconfirmed originals survive multiple days and a restart, then retire only on exact SQL proof', async t => {
    const d = await dir(t);let now = 1000;
    const j = new Journal({directory: d, now: () => now});await j.initialize();
    const item = await j.append(legacy(1));j.markPublished(item.id);
    now += 30 * AGE;
    assert.deepEqual(await j.expireOldGroups(), []);
    assert.equal(j.health().records, 1);assert.equal(j.health().maxAgeMs, null);
    assert.equal(j.health().expiredUnconfirmedRecords, 0);await j.close();
    const r = new Journal({directory: d, now: () => now});await r.initialize();
    assert.deepEqual((await r.readBatch()).map(e => e.payload), [legacy(1)]);
    assert.deepEqual(await r.expireOldGroups(), []);
    await r.confirmStored(item.id, proof(item));await r.tail;
    assert.equal(r.health().records, 0);assert.equal(r.health().sqlConfirmedRecords, 1);await r.close();
});

test('an old checkpoint chain waits for every member proof and preserves the latest live basis', async t => {
    let now = 1000;const j = new Journal({directory: await dir(t), now: () => now});await j.initialize();
    const f = frames(), entries = [];
    for (const payload of f) entries.push(await j.append(payload));
    now += 30 * AGE;assert.deepEqual(await j.expireOldGroups(), []);
    await j.confirmStored(entries[0].id, proof(entries[0]));await j.tail;
    assert.equal(j.health().records, 3, 'a proved snapshot cannot orphan its unproved delta');
    await j.confirmStored(entries[1].id, proof(entries[1]));await j.tail;
    assert.equal(j.health().records, 1);
    assert.equal(decodeDecisionRecords((await j.readBatch()).map(e => e.payload)).length, 1);
    await j.confirmStored(entries[2].id, proof(entries[2]));await j.tail;
    assert.equal(j.health().records, 1, 'the latest live dependency basis is retained even when confirmed');
    assert.equal(j.health().expiredUnconfirmedRecords, 0);
    assert.equal(j.health().confirmedRetainedRecords, 1);await j.close();
});

test('an inherited unresolved reader fence does not age out its local original', async t => {
    const d = await dir(t), j = new Journal({directory: d});await j.initialize();await j.append(legacy(1));
    await j.beginVerification({verificationId: 'old-query', start: 1, end: 2, limit: 1, beganAt: 1});await j.close();
    for (const f of await fs.readdir(d)) if (/^\d+\.json$/.test(f))
        await fs.utimes(path.join(d, f), new Date(1000), new Date(1000));
    const r = new Journal({directory: d, now: () => 30 * AGE});await r.initialize();
    assert.deepEqual(await r.expireOldGroups(), []);assert.equal(r.health().records, 1);
    assert.equal(r.health().sqlVerificationPending, true);await r.close();
});

test('full capacity rejects the new original without evicting an old unconfirmed record', async t => {
    let now = 1000;const j = new Journal({directory: await dir(t), now: () => now, maxRecords: 1});
    await j.initialize();await j.append(legacy(1));now += 30 * AGE;
    await assert.rejects(j.append(legacy(2)), /capacity/);
    assert.deepEqual(await j.expireOldGroups(), []);
    assert.deepEqual((await j.readBatch()).map(e => e.payload), [legacy(1)]);
    assert.equal(j.health().rejectedRecords, 1);await j.close();
});

test('an old committed expiry marker preserves surviving originals during upgrade and retains historical counters', async t => {
    const d = await dir(t), j = new Journal({directory: d});await j.initialize();
    const item = await j.append(legacy(1));await j.close();
    const data = {schema: 1, kind: 'expired-local-group', groupId: item.id,
        recordSession: item.recordSession, checkpointSequence: null, firstId: item.id, lastId: item.id,
        expiredRecords: 1, expiredUnconfirmedRecords: 1,
        lastExpiry: {at: 2000, reason: 'local-retention-expired-sql-coverage-unknown', firstEventAt: 1001}};
    await fs.writeFile(path.join(d, `${item.id}.retired`), JSON.stringify({data,
        sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex')}));
    const r = new Journal({directory: d});await r.initialize();
    assert.equal(r.health().records, 1, 'legacy age marker cannot delete another unconfirmed original');
    assert.equal(r.health().expiredUnconfirmedRecords, 1, 'historical loss counters are not rewritten');
    assert.equal(r.health().integrityValid, true);
    assert.deepEqual((await r.readBatch()).map(e => e.payload), [legacy(1)]);await r.close();
    const again = new Journal({directory: d});await again.initialize();
    assert.equal(again.health().records, 1);await again.confirmStored(item.id, proof(item));await again.tail;
    assert.equal(again.health().records, 0);await again.close();
});

test('an attempted private age retirement cannot bypass the confirmed-only cleanup guard', async t => {
    const j = new Journal({directory: await dir(t)});await j.initialize();await j.append(legacy(1));
    const group = [...j.groups.values()][0];
    await assert.rejects(j._retireGroup(group, {expiredRecords: 1}), /cannot be retired by age/);
    assert.equal(j.health().records, 1);await j.close();
});

test('corrupt old originals stay visible and cannot be deleted by age or fabricated proof', async t => {
    const d = await dir(t), j = new Journal({directory: d});await j.initialize();
    const item = await j.append(legacy(1));await j.close();await fs.writeFile(path.join(d, `${item.id}.json`), 'broken');
    const r = new Journal({directory: d, now: () => 30 * AGE});await r.initialize();
    assert.equal(r.health().integrityValid, false);assert.deepEqual(await r.expireOldGroups(), []);
    await assert.rejects(r.confirmStored(item.id, proof(item)), /unknown|identity|match|record/);
    assert.ok((await fs.readdir(d)).includes(`${item.id}.json`));await r.close();
});
