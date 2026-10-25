'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Journal = require('../lib/decision-record-journal');
const ShadowController = require('../lib/shadow-controller');
const {DecisionRecordEncoder, DecisionRecordDecoder} = require('../lib/decision-record-codec');

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-recorder-drain-'));
    const journal = new Journal({directory});
    await journal.initialize();
    t.after(async () => {await journal.close(); await fs.rm(directory, {recursive: true, force: true});});
    return {journal, directory};
}
const payload = sequence => JSON.stringify({schema: 2, recordSession: 'drain',
    recordSequence: sequence, timestamp: 1000 + sequence, value: sequence});
const proof = entry => ({id: entry.id, proof: {kind: 'independent-history-match',
    recordSession: entry.recordSession, recordSequence: entry.recordSequence, sha256: entry.sha256}});

test('source appends and the fair SQL fence progress while publication reads use their own bounded lane', async t => {
    const {journal} = await fixture(t);
    await journal.append(payload(1));
    const read = journal._readBoundedFile.bind(journal);
    let release, entered;
    const gate = new Promise(resolve => {release = resolve;});
    const started = new Promise(resolve => {entered = resolve;});
    let first = true;
    journal._readBoundedFile = async (...args) => {
        if (first) {first = false; entered(); await gate;}
        return read(...args);
    };
    const active = journal.readBatch();
    await started;
    const queuedRead = journal.readBatch({limit: 16});
    const persist = journal._persistVerification.bind(journal);
    let sequencesAtFence;
    journal._persistVerification = async (...args) => {
        sequencesAtFence = [...journal.entries.values()].map(e => e.recordSequence);
        return persist(...args);
    };
    const query = {verificationId: 'fair-fence', start: 1, end: 2, limit: 2, beganAt: 1};
    const fence = journal.beginVerification(query);
    const appends = Array.from({length: 10}, (_, i) => journal.append(payload(i + 2)));
    try {
        let timer;
        try {await Promise.race([fence, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('SQL fence blocked behind immutable read')), 2000);
        })]);} finally {clearTimeout(timer);}
        assert.deepEqual(sequencesAtFence, [1, 2, 3, 4, 5],
            'four FIFO appends get priority, then the older SQL fence gets a turn');
        assert.equal(journal.health().sqlVerificationPending, true);
        await assert.rejects(journal.beginVerification({...query, verificationId: 'forbidden-overlap'}), /already pending/);
        await Promise.all(appends);
        assert.equal(journal.health().records, 11, 'a stalled reader cannot own the append lane');
    } finally {release(); await active;}
    assert.deepEqual((await queuedRead).map(entry => entry.recordSequence),
        Array.from({length: 11}, (_, i) => i + 1), 'the next read selects a complete current snapshot');
    assert.deepEqual((await journal.readBatch({limit: 16})).map(entry => entry.payload),
        Array.from({length: 11}, (_, i) => payload(i + 1)));
    await journal.completeVerification({kind: 'observed-backend-completion',
        verificationId: query.verificationId, evidence: 'actual injected transport callback'});
    assert.equal(journal.health().sqlVerificationPending, false);
});

test('confirmed cleanup waits for recorder backlog and retires at most sixteen originals per turn', async t => {
    const {journal, directory} = await fixture(t);
    const encoder = new DecisionRecordEncoder({checkpointMs: 100000});
    const originals = Array.from({length: 41}, (_, i) => JSON.stringify(encoder.encode({
        schema: 2, recordSession: 'bounded-cleanup', recordSequence: i + 1,
        timestamp: i === 40 ? 200000 : 1000 + i, mode: 'PRODUCTION', masterEnabled: true,
        value: i, stable: 'retained basis '.repeat(200)})));
    const saved = [];
    for (let offset = 0; offset < originals.length; offset += 16)
        saved.push(...await journal.appendBatch(originals.slice(offset, offset + 16)));
    journal.setRecorderBacklog(20);
    await journal.confirmStoredBatch(saved.slice(0, 40).map(proof));
    assert.equal(journal.health().records, 41, 'proof does not make cleanup outrank queued observations');
    assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.retired')).length, 0);
    const retire = journal._retireGroup.bind(journal);
    const chunks = [];
    journal._retireGroup = async (...args) => {
        const before = journal.entries.size;
        await retire(...args);
        chunks.push(before - journal.entries.size);
        if (chunks.length === 1) journal.setRecorderBacklog(1);
    };
    journal.setRecorderBacklog(0);
    await journal.tail;
    assert.deepEqual(chunks, [16]);
    assert.equal(journal.health().records, 25);
    assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.retired')).length, 1);
    await assert.rejects(journal.prepareReplay(saved[20].id), /complete checkpoint basis/,
        'a durably retiring partial chain must never be replayed without its deleted snapshot');
    await journal.append(payload(100));
    await journal.close();
    const restarted = new Journal({directory});
    await restarted.initialize();
    t.after(() => restarted.close());
    assert.deepEqual((await restarted.readBatch()).map(entry => entry.payload), [originals[40], payload(100)],
        'existing retirement recovery finishes only the proven group after interrupted chunking');
    assert.equal(restarted.health().integrityValid, true);
});

test('cleanup resumes automatically after backlog drains without waiting for another SQL proof', async t => {
    const {journal} = await fixture(t);
    const entries = await journal.appendBatch([payload(1), payload(2), payload(3)]);
    journal.setRecorderBacklog(3);
    await journal.confirmStoredBatch(entries.map(proof));
    assert.equal(journal.health().records, 3);
    journal.setRecorderBacklog(0);
    await journal.tail;
    assert.equal(journal.health().records, 0);
    assert.equal(journal.health().sqlConfirmedRecords, 3);
});

test('large source contexts share fewer directory barriers while retaining every accepted original exactly', async t => {
    const {journal} = await fixture(t);
    const adapter = {namespace: 'ems.0', config: {}, decisionRecordJournal: journal,
        setCompatState: async () => {}, getCachedState: () => null, log: {warn() {}}};
    const recorder = new ShadowController(adapter, {now: () => 1000000});
    let appendTurns = 0, barriers = 0;
    const append = journal.appendBatch.bind(journal), sync = journal._syncDirectory.bind(journal);
    journal.appendBatch = async values => {appendTurns++; return append(values);};
    journal._syncDirectory = async () => {barriers++; await sync();};
    const inputs = Array.from({length: 12}, (_, i) => ({schema: 2, timestamp: 1000000 + i,
        mode: 'PRODUCTION', masterEnabled: true, event: {type: 'source.update',
            samples: [{sampleSequence: i + 1, state: {val: i % 2 ? null : i, ts: 999000 + i,
                lc: 990000, ack: i % 2 === 0, q: i % 3 ? 0 : 64}}]},
        context: 'original UTF-8 source ä '.repeat(3600)}));
    inputs.forEach(input => recorder.enqueueRecord(input));
    await recorder.recordAppendTail;
    await journal.tail;
    assert.equal(recorder.recordDropped, 0);
    assert.ok(appendTurns <= 3, 'twelve roughly 90KiB contexts need at most three group commits, previously six');
    assert.ok(barriers <= 6, 'directory durability barriers are shared, never removed');
    const stored = await journal.readBatch({limit: 16, maxBytes: 4 * 1024 * 1024});
    const decoder = new DecisionRecordDecoder();
    assert.deepEqual(stored.map(entry => {
        const {recording, recordSession, recordSequence, ...original} = decoder.decode(JSON.parse(entry.payload));
        return original;
    }), inputs);
    assert.equal(journal.health().recorderBacklog, 0);
    assert.equal(recorder.durablePendingBytes, 0);
});

test('larger raw batches split by actual encoded bytes and count only an unwritten suffix after failure', async t => {
    const {journal} = await fixture(t);
    const adapter = {namespace: 'ems.0', config: {}, decisionRecordJournal: journal,
        setCompatState: async () => {}, getCachedState: () => null, log: {warn() {}}};
    const recorder = new ShadowController(adapter, {now: () => 1000000});
    // Force large dispatch metadata without generating a live source burst.
    recorder.localJournalRecordSnapshot = () => ({context: 'x'.repeat(300000)});
    let calls = 0;
    const append = journal.append.bind(journal);
    journal.append = async value => {
        if (++calls === 2) throw new Error('injected later group append failure');
        return append(value);
    };
    // Alternating non-ASCII values force independent snapshots; the encoder
    // selects by character length, so byte accounting must be on actual output.
    for (let i = 0; i < 3; i++) recorder.enqueueRecord({schema: 2, timestamp: 1000000 + i,
        mode: i % 2 ? 'SHADOW' : 'PRODUCTION', masterEnabled: true, value: i});
    await recorder.recordAppendTail;
    const stored = await journal.readBatch({limit: 16, maxBytes: 2 * 1024 * 1024});
    assert.equal(stored.length, 1);
    assert.equal(recorder.recordDropped, 2, 'the first durable original is not falsely counted as lost');
    assert.equal(recorder.recordWriteErrors, 2);
    assert.equal(recorder.durablePendingBytes, 0);
    assert.equal(journal.health().integrityValid, true);
});
