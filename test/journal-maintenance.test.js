'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Journal = require('../lib/decision-record-journal');
const {DecisionRecordEncoder} = require('../lib/decision-record-codec');
const {copyJournal} = require('../tools/copy-decision-journal');
const {journalDirectory} = require('../lib/journal-location');
const {hasTimeIndex, queries, rows} = require('../tools/inspect-storage-sql');
async function setup(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-maintenance-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
    const source = path.join(root, 'source'), encoder = new DecisionRecordEncoder();
    const originals = [1,2,3].map(recordSequence => JSON.stringify(encoder.encode({schema: 2,
        recordSession: 'maintenance', recordSequence, timestamp: 1000 + recordSequence,
        payload: {padding: 'original'.repeat(1000), value: recordSequence, missing: null, ack: false}})));
    const j = new Journal({directory: source, segmentBatches: true}); await j.initialize(); await j.appendBatch(originals);
    await j.beginVerification({verificationId: 'unresolved-query', start: 1000, end: 2000, limit: 32, beganAt: 3000}); await j.close();
    return {root, source, originals};
}
for (const legacy of [false, true]) test(`offline copy preserves exact hashes, age and unresolved SQL fence; legacy=${legacy}`, async t => {
    const {root, source, originals} = await setup(t), destination = path.join(root, 'copy');
    const names = await fs.readdir(source), before = await Promise.all(names.map(name => fs.readFile(path.join(source, name))));
    const originalTime = new Date(123000); for (const name of names) if (name.endsWith('.segment')) await fs.utimes(path.join(source, name), originalTime, originalTime);
    const result = await copyJournal({source, destination, legacy, stopped: true}); assert.equal(result.sourceUnchanged, true);
    assert.equal(result.pendingSqlFence, true); assert.equal(result.recordsRetained, 3);
    const targetFiles = await fs.readdir(destination); assert.equal(targetFiles.some(name => name.endsWith('.segment')), !legacy);
    for (const name of targetFiles.filter(name => /^\d.*\.(json|segment)$/.test(name)))
        assert.equal((await fs.stat(path.join(destination, name))).mtimeMs, originalTime.getTime());
    assert.deepEqual(await fs.readdir(source), names); assert.deepEqual(await Promise.all(names.map(name => fs.readFile(path.join(source, name)))), before);
    const r = new Journal({directory: destination}); await r.initialize();
    assert.deepEqual((await r.readBatch()).map(entry => entry.payload), originals);
    assert.equal(r.health().sqlVerificationQuery.verificationId, 'unresolved-query'); await r.close();
});
test('offline copy refuses online claims, existing targets and damaged sources without a ready marker', async t => {
    const {root, source} = await setup(t), destination = path.join(root, 'target');
    await assert.rejects(copyJournal({source, destination}), /Stop the adapter/);
    await fs.mkdir(destination); await assert.rejects(copyJournal({source, destination, stopped: true}), /EEXIST/);
    const segment = (await fs.readdir(source)).find(name => name.endsWith('.segment'));
    await fs.writeFile(path.join(source, segment), 'bad segment'); const bad = path.join(root, 'bad');
    await assert.rejects(copyJournal({source, destination: bad, stopped: true}), /inspection/);
    await assert.rejects(fs.stat(path.join(bad, '.ems-journal-copy-ready')), /ENOENT/);
});
test('configured location requires verified per-instance offline copy, default location is unchanged', async t => {
    const {root, source} = await setup(t), relocation = path.join(root, 'ssd'), destination = path.join(relocation, 'ems-optimizer.0', 'decision-record-journal');
    assert.equal(await journalDirectory(source, '', 'ems-optimizer.0'), path.join(source, 'decision-record-journal'));
    await assert.rejects(journalDirectory(source, 'relative', 'ems-optimizer.0'), /absolute/);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await assert.rejects(journalDirectory(source, relocation, 'ems-optimizer.0'), /ENOENT/);
    await copyJournal({source, destination, stopped: true});
    assert.equal(await journalDirectory(source, relocation, 'ems-optimizer.0'), destination);
    await assert.rejects(journalDirectory(source, relocation, 'ems-optimizer.1'), /ENOENT/);
});
test('index inspection recognizes column order, visible full BTREE indexes and avoids inventing an index problem', () => {
    const fixture = rows('Key_name\tSeq_in_index\tColumn_name\tIndex_type\tSub_part\tVisible\nPRIMARY\t1\tid\tBTREE\tNULL\tYES\nPRIMARY\t2\tts\tBTREE\tNULL\tYES\n');
    assert.equal(hasTimeIndex(fixture), true);
    assert.equal(hasTimeIndex(fixture.map(row => ({...row, Column_name: row.Column_name === 'id' ? 'ts' : 'id'}))), false);
    assert.equal(hasTimeIndex(fixture.map(row => ({...row, Visible: 'NO'}))), false);
    assert.equal(hasTimeIndex(fixture.map(row => ({...row, Sub_part: '8'}))), false);
    assert.equal(hasTimeIndex(fixture.map(row => ({...row, Index_type: 'HASH'}))), false);
    assert.equal(hasTimeIndex(fixture.map(row => ({...row, Ignored: 'YES'}))), false);
});
test('host inspection uses bounded EXPLAIN, excludes history values/query texts, and limits conditional DDL to online index creation', () => {
    const q = queries({database: 'iobroker', now: 10000});
    assert.match(q.plan, /^EXPLAIN SELECT/); assert.match(q.plan, /ts >= 8000 AND ts <= 10000.*LIMIT 32/);
    assert.doesNotMatch(q.sessions, /\bINFO\b/); assert.doesNotMatch(q.transactions, /trx_query/);
    assert.match(q.createIndex, /ALGORITHM=INPLACE, LOCK=NONE/); assert.doesNotMatch(q.createIndex, /GLOBAL/);
    assert.throws(() => queries({database: 'bad;DROP', now: 10000}), /Invalid/);
    assert.throws(() => queries({database: 'good', datapoint: "a' OR 1=1", now: 10000}), /Invalid/);
});
