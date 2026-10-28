'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Journal = require('../lib/decision-record-journal');
const {DecisionRecordEncoder, decodeDecisionRecords} = require('../lib/decision-record-codec');
const {createHash} = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
async function dir(t) {const d = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-segments-')); t.after(() => fs.rm(d, {recursive: true, force: true})); return d;}
function frames(count = 8, session = 'segments', start = 1000) {
    const encoder = new DecisionRecordEncoder();
    return Array.from({length: count}, (_, i) => JSON.stringify(encoder.encode({schema: 2,
        recordSession: session, recordSequence: i + 1, timestamp: start + i * 100,
        data: {padding: 'Äußere\n中文'.repeat(1000), value: i, ack: i % 2 === 0, q: 0, missing: null},
        command: {id: `${session}:${i}`, target: i, sourceTs: start + i}})));
}
const proof = entry => ({kind: 'independent-history-match', recordSession: entry.recordSession,
    recordSequence: entry.recordSequence, sha256: entry.sha256});
async function journal(t, options = {}) {const j = new Journal({directory: await dir(t), segmentBatches: true, ...options}); await j.initialize(); return j;}

// This compares real filesystem calls before/after, not wall-clock claims.
test('eight original compact frames need one file sync/link instead of eight; payloads and hashes survive restart', async t => {
    const originals = frames(); let syncs = 0, links = 0;
    const d = await dir(t), fileSystem = {...fs,
        async link(...args) {links++; return fs.link(...args);},
        async open(file, ...args) {const h = await fs.open(file, ...args);
            if (file === d) return h;
            return new Proxy(h, {get(target, prop) {if (prop === 'sync') return async () => {syncs++; return target.sync();};
                const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;}});
        }};
    const j = new Journal({directory: d, segmentBatches: true, fileSystem}); await j.initialize();
    const saved = await j.appendBatch(originals);
    assert.equal(syncs, 1); assert.equal(links, 1);
    assert.equal(j.segments.size, 1); assert.equal(j.health().records, 8);
    assert.deepEqual((await j.readBatch()).map(e => e.payload), originals);
    assert.deepEqual(saved.map(e => e.sha256), originals.map(hash));
    const files = await fs.readdir(d); assert.equal(files.filter(f => f.endsWith('.segment')).length, 1);
    assert.equal(j.health().bytes, (await fs.stat(path.join(d, files.find(f => f.endsWith('.segment'))))).size);
    await j.close();
    const r = new Journal({directory: d}); await r.initialize();
    assert.deepEqual((await r.readBatch()).map(e => e.payload), originals);
    assert.equal(decodeDecisionRecords((await r.readBatch()).map(e => e.payload)).length, 8);
    assert.deepEqual((await r.readBatch()).map(e => e.sha256), saved.map(e => e.sha256)); await r.close();
    const legacyDir = await dir(t); let oldSyncs = 0;
    const old = new Journal({directory: legacyDir, fileSystem: {...fs, async open(file, ...args) {
        const h = await fs.open(file, ...args); if (!file.endsWith('.tmp')) return h;
        return {writeFile: (...a) => h.writeFile(...a), close: () => h.close(), sync: async () => {oldSyncs++; return h.sync();}};
    }}}); await old.initialize(); await old.appendBatch(originals); assert.equal(oldSyncs, 8); await old.close();
});

test('segments split at snapshot/session/gap boundaries and mixed legacy/segment recovery is ordered', async t => {
    const d = await dir(t), old = new Journal({directory: d}); await old.initialize();
    const a = frames(5); await old.appendBatch(a.slice(0, 2)); await old.close();
    const j = new Journal({directory: d, segmentBatches: true}); await j.initialize();
    const b = frames(2, 'second'); await j.appendBatch([...a.slice(2), ...b]);
    assert.equal(j.segments.size, 2); assert.equal(j.groups.size, 2);
    await j.close(); const r = new Journal({directory: d, segmentBatches: true}); await r.initialize();
    assert.deepEqual((await r.readBatch()).map(e => e.payload), [...a, ...b]);
    assert.deepEqual([...r.groups.values()].map(g => g.ids.size), [5, 2]); await r.close();
});

test('proof of one delta never deletes a segment or its basis; complete closed group frees physical bytes', async t => {
    const j = await journal(t), a = frames(4); const saved = await j.appendBatch(a);
    const bytes = j.health().bytes; await j.confirmStored(saved[1].id, proof(saved[1]));
    assert.equal(j.health().records, 4); assert.equal(j.health().bytes, bytes);
    await j.append(frames(1, 'new-session')[0]);
    await j.confirmStoredBatch(saved.map(entry => ({id: entry.id, proof: proof(entry)})));
    await j.tail; assert.equal(j.health().records, 1); assert.equal(j.segments.size, 1);
    assert.ok(j.health().bytes < bytes); assert.equal(j.health().sqlConfirmedRecords, 4);
    await j.close(); const r = new Journal({directory: j.directory}); await r.initialize();
    assert.equal(r.health().records, 1); assert.equal(r.health().bytes, j.health().bytes); await r.close();
});

test('partial cleanup turn retains group marker until the last segment and restarts without replaying retired deltas', async t => {
    const j = await journal(t); const originals = frames(24); const saved = [];
    saved.push(...await j.appendBatch(originals.slice(0, 16))); saved.push(...await j.appendBatch(originals.slice(16)));
    await j.append(frames(1, 'next')[0]); j.setRecorderBacklog(1);
    await j.confirmStoredBatch(saved.map(entry => ({id: entry.id, proof: proof(entry)})));
    await j._enqueue(() => j._retireGroup(j.groups.get(saved[0].groupId), null, 5));
    assert.equal(j.segments.size, 3, 'partly forgotten segment remains physically retained');
    await j.close();
    const r = new Journal({directory: j.directory}); await r.initialize();
    assert.equal(r.health().records, 1); assert.equal(r.health().bytes, (await fs.stat(path.join(j.directory, [...r.segments.keys()][0]))).size);
    assert.equal(r.health().integrityValid, true); await r.close();
});

for (const phase of ['write-files', 'link-files', 'commit-directory-sync', 'unlink-temporaries', 'cleanup-directory-sync']) {
    test(`failed ${phase} exposes no prefix, blocks further appends and recovers exact originals`, async t => {
        const j = await journal(t); let armed = true;
        const stage = j._appendStage.bind(j);
        j._appendStage = async (name, times, run) => {
            const result = await stage(name, times, run);
            if (armed && name === phase) {armed = false; throw new Error('power loss boundary');} return result;
        };
        const originals = frames(4); await assert.rejects(j.appendBatch(originals), /power loss/);
        assert.equal(j.health().records, 0); assert.equal(j.health().writeErrors, 1);
        assert.equal(j.health().capacityVerified, false);
        await assert.rejects(j.append(frames(1, 'another')[0]), /capacity is unknown/);
        await j.close(); const r = new Journal({directory: j.directory}); await r.initialize();
        assert.equal(r.health().integrityValid, true);
        assert.deepEqual((await r.readBatch()).map(e => e.payload), originals); await r.close();
    });
}

test('pending segment file sync prevents publication and close waits for accepted work', async t => {
    const j = await journal(t), entered = deferred(), gate = deferred();
    const write = j._writeFile.bind(j); j._writeFile = async (...args) => {
        if (args[0].endsWith('.segment-tmp')) {entered.resolve(); await gate.promise;} return write(...args);
    };
    const originals = frames(4), pending = j.appendBatch(originals); await entered.promise;
    assert.equal(j.health().records, 0); assert.equal(j.health().activeOperation.phase, 'write-files');
    let closed = false; const closing = j.close().then(() => {closed = true;});
    await Promise.resolve(); assert.equal(closed, false); gate.resolve(); await pending; await closing;
    const r = new Journal({directory: j.directory}); await r.initialize();
    assert.deepEqual((await r.readBatch()).map(e => e.payload), originals); await r.close();
});

test('a pinned segment read neither blocks new appends nor allows its checkpoint retirement', async t => {
    const j = await journal(t), originals = frames(4); const saved = await j.appendBatch(originals);
    await j.append(frames(1, 'next')[0]); const entered = deferred(), gate = deferred();
    const read = j._readBoundedFile.bind(j); let calls = 0;
    j._readBoundedFile = async (file, ...args) => {if (file.endsWith('.segment')) {calls++; entered.resolve(); await gate.promise;} return read(file, ...args);};
    const reading = j.readBatch({limit: 4}); await entered.promise;
    try {
        await j.append(frames(1, 'third')[0]);
        await j.confirmStoredBatch(saved.map(entry => ({id: entry.id, proof: proof(entry)})));
        assert.equal(j.health().records, 6); assert.equal(j.segments.size, 3);
        gate.resolve(); assert.deepEqual((await reading).map(e => e.payload), originals);
        await j.tail; assert.equal(calls, 1, 'shared immutable segment is read once'); assert.equal(j.health().records, 2);
    } finally {gate.resolve(); await reading; await j.close();}
});

test('corrupt segment checksum yields no prefix; restart retains all bytes and invalid coverage', async t => {
    const j = await journal(t); await j.appendBatch(frames(4));
    const file = path.join(j.directory, [...j.segments.keys()][0]), before = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, before.replace('segments', 'segmentX'));
    await assert.rejects(j.readBatch(), /checksum/); assert.equal(j.readPins.size, 0);
    await j.close(); const r = new Journal({directory: j.directory}); await r.initialize();
    assert.equal(r.health().records, 0); assert.equal(r.health().invalidFiles, 1);
    assert.equal(r.health().integrityValid, false); assert.equal((await fs.stat(file)).size, Buffer.byteLength(before)); await r.close();
});

test('segment capacity and conflicting identity reject atomically without deleting or rewriting earlier originals', async t => {
    const j = await journal(t, {maxRecords: 4}); const originals = frames(5);
    const saved = await j.appendBatch(originals.slice(0, 4));
    assert.equal((await j.append(originals[0])).duplicate, true);
    await assert.rejects(j.append(originals[4]), /capacity/);
    const conflict = JSON.parse(originals[3]); conflict.recordSession = 'segments'; conflict.timestamp++;
    await assert.rejects(j.appendBatch([originals[4], JSON.stringify(conflict)]), /conflicting/);
    assert.equal(j.health().records, 4);
    assert.deepEqual((await j.readBatch()).map(e => e.payload), originals.slice(0, 4));
    assert.deepEqual((await j.readBatch()).map(e => e.sha256), saved.map(e => e.sha256)); await j.close();
});

test('expiry of a closed segment chain records unknown SQL coverage before removing originals', async t => {
    let at = 1000; const j = await journal(t, {now: () => at});
    await j.appendBatch(frames(4)); await j.append(frames(1, 'new')[0]); at += 86400000;
    assert.equal((await j.expireOldGroups()).length, 4); assert.equal(j.health().expiredUnconfirmedRecords, 4);
    assert.equal(j.health().sqlConfirmedRecords, 0); assert.equal(j.health().records, 1); await j.close();
    const r = new Journal({directory: j.directory}); await r.initialize();
    assert.equal(r.health().expiredUnconfirmedRecords, 4); assert.equal(r.health().records, 1); await r.close();
});

test('real recorder batching preserves large source contexts and commands through segment restart without raw queue loss', async t => {
    const ShadowController = require('../lib/shadow-controller');
    const {DecisionRecordDecoder} = require('../lib/decision-record-codec');
    const j = await journal(t);
    const adapter = {namespace: 'ems.0', config: {}, decisionRecordJournal: j,
        setCompatState: async () => {}, getCachedState: () => null, log: {warn() {}}};
    const recorder = new ShadowController(adapter, {now: () => 1000000});
    const inputs = Array.from({length: 24}, (_, i) => ({schema: 2, timestamp: 1000000 + i,
        mode: 'PRODUCTION', masterEnabled: true, event: {type: i === 12 ? 'command.transport_complete' : 'source.update',
            commandId: i === 12 ? 'full-original-command-id' : null,
            samples: [{sampleSequence: i + 1, state: {val: i % 2 ? null : i, ts: 999000 + i,
                lc: 990000, ack: i % 2 === 0, q: i % 3 ? 0 : 64}}]},
        context: 'original UTF-8 source ä '.repeat(3600)}));
    inputs.forEach(input => recorder.enqueueRecord(input)); await recorder.recordAppendTail; await j.tail;
    assert.equal(recorder.recordDropped, 0); assert.equal(recorder.durablePendingBytes, 0);
    const saved = await j.readBatch({limit: 64, maxBytes: 4 * 1024 * 1024});
    const decoder = new DecisionRecordDecoder();
    assert.deepEqual(saved.map(entry => {
        const {recording, recordSession, recordSequence, ...original} = decoder.decode(JSON.parse(entry.payload)); return original;
    }), inputs);
    assert.ok(j.segments.size < saved.length, 'actual recorder uses the segment grouping path');
    await j.close(); const r = new Journal({directory: j.directory}); await r.initialize();
    assert.deepEqual((await r.readBatch({limit: 64, maxBytes: 4 * 1024 * 1024})).map(entry => entry.sha256), saved.map(entry => entry.sha256));
    await r.close();
});
