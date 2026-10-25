'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ShadowController = require('../lib/shadow-controller');
const DebugRecorder = require('../lib/debug-recorder');
const DecisionRecordJournal = require('../lib/decision-record-journal');
const {DecisionRecordDecoder} = require('../lib/decision-record-codec');

async function fixture(t, blocked) {
    let now = 2000000, release, began;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-recorder-slow-append-'));
    const gate = new Promise(resolve => {release = resolve;});
    const started = new Promise(resolve => {began = resolve;});
    let blockNextOriginal = blocked;
    const fileSystem = {...fs, open: async (file, flags, mode) => {
        const handle = await fs.open(file, flags, mode);
        if (!blockNextOriginal || !/^\d{16}\.tmp$/.test(path.basename(file))) return handle;
        blockNextOriginal = false;
        return {
            writeFile: async (...args) => {began(); await gate; return handle.writeFile(...args);},
            sync: () => handle.sync(), close: () => handle.close()
        };
    }};
    const journal = new DecisionRecordJournal({directory, fileSystem, now: () => now});
    t.after(async () => {
        release();
        await journal.close();
        await fs.rm(directory, {recursive: true, force: true});
    });
    await journal.initialize();
    const states = new Map();
    const put = (id, val) => states.set(id, {val, ts: now, lc: 1, ack: true, q: 0});
    const adapter = {namespace: 'ems.0', config: {globalWriteEnabled: true}, decisionRecordJournal: journal,
        readMapping: () => ({DP_GRID_IMPORT: 'import', DP_GRID_EXPORT: 'export', DP_PV_POWER: 'pv'}),
        getCachedState: id => states.get(id), setCompatState: async () => {}, log: {warn() {}}};
    adapter.debugRecorder = new DebugRecorder(adapter);
    const recorder = new ShadowController(adapter, {now: () => now});
    recorder.initialized = true;
    put('ems.0.System.RealOutputsEnabled', true); put('ems.0.Control.Valid', true);
    for (const [id, value] of [['import', 100], ['export', 0], ['pv', 2000]]) put(id, value);
    return {recorder, journal, states, put, release, started, directory,
        blockNextAppend: () => {blockNextOriginal = true;},
        advance: ms => {now += ms;}, now: () => now};
}

for (const blocked of [false, true]) {
    test(blocked
        ? 'a stalled local append plus source backlog explicitly loses a later command completion and resumes reconstructably'
        : 'the same source callbacks retain every sample and command completion when local appends drain', async t => {
        const h = await fixture(t, blocked);
        t.mock.method(Date, 'now', h.now);
        h.recorder.productionRecord({type: 'baseline'});
        if (blocked) await h.started;
        else await h.recorder.recordAppendTail;
        const commandId = h.recorder.commandEvent('attempt', 'heater', 0);
        if (!blocked) await h.recorder.recordAppendTail;
        const expected = new Map();
        for (let i = 0; i < 300; i++) {
            const previous = h.states.get('import');
            h.advance(1000);
            for (const [id, value] of [['import', 100], ['export', 0], ['pv', 2000]]) h.put(id, value);
            h.recorder.captureProduction('import', h.states.get('import'), previous);
            expected.set(h.recorder.diagnosticSampler.sequence, structuredClone(h.states.get('import')));
            if (!blocked) await h.recorder.recordAppendTail;
        }
        h.recorder.flushSourceBatch(true);
        const beforeCompletion = {pending: h.recorder.durablePending.size,
            bytes: h.recorder.durablePendingBytes, dropped: h.recorder.recordDropped};
        h.recorder.commandEvent('transport_complete', 'heater', 0, commandId);
        const completionLoss = h.recorder.recordDropped - beforeCompletion.dropped;
        h.release();
        await h.recorder.recordAppendTail; await h.journal.tail;
        const losses = h.recorder.recordDropped;

        // The ordinary codec checkpoint interval must restore a standalone
        // basis; no test-only encoder reset or invented missing record is used.
        h.advance(60000);
        h.recorder.productionRecord({type: 'continued'});
        await h.recorder.recordAppendTail; await h.journal.tail;
        const stored = await h.journal.readBatch({limit: 512, maxBytes: 16 * 1024 * 1024});
        const frames = stored.map(entry => JSON.parse(entry.payload));
        const decoder = new DecisionRecordDecoder();
        const records = frames.map(frame => decoder.decode(frame));
        assert.ok(records.every(record => record.schema === 2 && !record.reconstruction));
        assert.equal(frames.at(-1).frameType, 'snapshot');
        assert.equal(records.at(-1).event.type, 'continued');
        assert.equal(records.at(-1).recording.dropped, losses);
        assert.equal(records.at(-1).recording.writeErrors, losses);
        assert.equal(h.recorder.durablePending.size, 0);
        assert.equal(h.recorder.durablePendingBytes, 0);
        assert.equal(h.journal.health().rejectedRecords, losses);
        assert.equal(h.journal.health().writeErrors, 0, 'pre-append rejection is distinct from a filesystem write failure');
        assert.ok(records.some(record => record.event?.type === 'command.attempt' && record.event.commandId === commandId));
        const completion = records.some(record => record.event?.type === 'command.transport_complete'
            && record.event.commandId === commandId);
        const samples = records.flatMap(record => record.event?.samples || []).filter(sample => sample.id === 'import');
        const actual = new Map(samples.map(sample => [sample.sampleSequence, sample.state]));
        assert.equal(actual.size, samples.length, 'surviving raw samples are not duplicated');
        for (const [sequence, state] of actual) assert.deepEqual(state, expected.get(sequence));
        const sequences = new Set(records.map(record => record.recordSequence));
        const missingRecords = h.recorder.recordSequence - sequences.size;
        assert.equal(missingRecords, losses, 'every rejected record remains visible as a sequence gap');

        if (blocked) {
            assert.equal(beforeCompletion.pending, 128, 'the existing record-count bound is reached');
            assert.ok(beforeCompletion.bytes > 0 && beforeCompletion.bytes < 8 * 1024 * 1024,
                'this case reaches the count bound rather than assuming which production limit was hit');
            assert.ok(beforeCompletion.dropped > 0);
            assert.equal(completionLoss, 1);
            assert.equal(completion, false, 'a saturated FIFO cannot promise that later command transitions survive');
            assert.ok(actual.size < expected.size, 'lost source samples are not reconstructed from later cache frames');
            assert.match(records.at(-1).recording.lastError, /Lokale Recorder-Warteschlange voll/);
            const history = records.at(-1).recording.localJournal.lossEpisodes;
            assert.equal(history.episodes.length, 1);
            const episode = history.episodes[0];
            const missing = Array.from({length: h.recorder.recordSequence}, (_, index) => index + 1)
                .filter(sequence => !sequences.has(sequence));
            assert.equal(episode.recordSession, h.recorder.recordSession);
            assert.equal(episode.firstSequence, missing[0]);
            assert.equal(episode.lastSequence, missing.at(-1));
            assert.equal(episode.rejectedRecords, losses);
            assert.ok(episode.rejectedRawBytes > 0);
            assert.deepEqual(episode.limitsHit, {records: true, bytes: false});
            assert.equal(episode.firstContext.queue.records, 128);
            assert.equal(episode.firstContext.queue.maxRecords, 128);
            assert.equal(episode.firstContext.queue.maxBytes, 8 * 1024 * 1024);
            assert.ok(episode.firstContext.queue.oldestWaitMs > 0);
            assert.ok(episode.firstContext.queue.active);
            assert.ok(episode.firstContext.journal.activeOperation);
            assert.equal(episode.firstContext.lastAppendBatch, null,
                'an unfinished first append is never presented as a completed batch measurement');
            assert.deepEqual(history, h.journal.health().lossEpisodes);
            assert.deepEqual(records[1].recording.localJournal.lossEpisodes, history,
                'the first original encoded after the stalled append already carries the losses');
        } else {
            assert.equal(losses, 0);
            assert.equal(completionLoss, 0);
            assert.equal(completion, true);
            assert.deepEqual(actual, expected);
        }
    });
}

function largeRawContext(at) {
    const sources = Object.fromEntries(Array.from({length: 768}, (_, index) => [`meter.${index}`, {
        val: index % 5 ? index * 0.125 : null, ts: at - index, lc: at - 60000,
        ack: index % 3 !== 0, q: index % 7 ? 0 : 64,
        source: 'observed-original-source', unit: index % 2 ? 'W' : 'A'
    }]));
    return {schema: 2, timestamp: at, mode: 'PRODUCTION', masterEnabled: true,
        event: {type: 'raw-context'}, production: {sources}};
}

test('large raw contexts reach the byte bound with separate wait, append and concurrent local-work evidence', async t => {
    const h = await fixture(t, false);
    t.mock.method(Date, 'now', h.now);
    // A completed batch predates the stalled append and remains a separate
    // historical measurement; the test never labels its time as current work.
    h.recorder.enqueueRecord(largeRawContext(h.now()));
    h.recorder.enqueueRecord(largeRawContext(h.now()));
    await h.recorder.recordAppendTail;
    const previousBatch = structuredClone(h.journal.health().lastAppendBatch);
    assert.equal(previousBatch.records, 2);

    h.blockNextAppend();
    const originals = new Map();
    const rejected = [];
    function enqueue() {
        const original = largeRawContext(h.now());
        const before = h.recorder.recordDropped;
        h.recorder.enqueueRecord(original);
        const entry = {...original, recordSession: h.recorder.recordSession,
            recordSequence: h.recorder.recordSequence};
        originals.set(entry.recordSequence, structuredClone(entry));
        if (h.recorder.recordDropped > before) rejected.push({entry,
            rawBytes: Buffer.byteLength(JSON.stringify(entry))});
    }
    enqueue();
    await h.started;
    const localRead = h.journal.readBatch({limit: 2, maxBytes: 256 * 1024});
    await Promise.resolve(); // The independent read lane submits its short selection turn.
    enqueue();
    h.advance(4500);
    for (let index = 0; index < 160; index++) {enqueue(); h.advance(10);}
    const beforeDrain = h.journal.health();
    assert.ok(rejected.length > 0);
    assert.ok(h.recorder.durablePending.size < 128, 'only the existing byte bound is reached');
    assert.ok(h.recorder.durablePendingBytes <= 8 * 1024 * 1024);
    assert.ok(h.recorder.durablePendingBytes + rejected[0].rawBytes > 8 * 1024 * 1024);
    assert.ok(beforeDrain.queuedOperations >= 2,
        'the single read and coalesced health write wait behind the same local append');
    assert.ok(beforeDrain.queuedOperations <= 3, 'losses do not create one health operation per frame');
    h.release();
    await h.recorder.recordAppendTail;
    await localRead;
    await h.journal.tail;
    const continuation = {schema: 2, timestamp: h.now(), mode: 'PRODUCTION', masterEnabled: true,
        event: {type: 'continued-after-byte-loss'}};
    h.recorder.enqueueRecord(continuation);
    await h.recorder.recordAppendTail;
    const stored = await h.journal.readBatch({limit: 256, maxBytes: 16 * 1024 * 1024});
    const decoder = new DecisionRecordDecoder();
    const records = stored.map(entry => decoder.decode(JSON.parse(entry.payload)));
    assert.ok(records.every(record => !record.reconstruction));
    const next = records.at(-1);
    assert.equal(next.event.type, continuation.event.type);
    assert.equal(JSON.parse(stored.at(-1).payload).frameType, 'snapshot', 'the sequence gap gets an ordinary standalone basis');
    const history = next.recording.localJournal.lossEpisodes;
    assert.deepEqual(records[3].recording.localJournal.lossEpisodes, history,
        'the first surviving original encoded after the stalled append carries the complete episode');
    assert.equal(history.episodes.length, 1);
    const episode = history.episodes[0];
    assert.equal(episode.recordSession, h.recorder.recordSession);
    assert.equal(episode.firstSequence, rejected[0].entry.recordSequence);
    assert.equal(episode.lastSequence, rejected.at(-1).entry.recordSequence);
    assert.equal(episode.firstEventAt, rejected[0].entry.timestamp);
    assert.equal(episode.lastEventAt, rejected.at(-1).entry.timestamp);
    assert.equal(episode.firstObservedAt, rejected[0].entry.timestamp);
    assert.equal(episode.lastObservedAt, rejected.at(-1).entry.timestamp);
    assert.equal(episode.rejectedRecords, rejected.length);
    assert.equal(episode.rejectedRawBytes, rejected.reduce((sum, item) => sum + item.rawBytes, 0));
    assert.deepEqual(episode.limitsHit, {records: false, bytes: true});
    assert.ok(episode.firstContext.queue.records < 128);
    assert.ok(episode.firstContext.queue.oldestWaitMs >= 4500);
    assert.ok(episode.firstContext.queue.active);
    assert.ok(episode.firstContext.journal.activeOperation);
    assert.ok(episode.firstContext.journal.queuedOperations >= 1);
    assert.deepEqual(episode.firstContext.lastAppendBatch, previousBatch);
    assert.ok(episode.firstContext.queue.active.startedAt >= previousBatch.completedAt);
    for (const record of records) {
        const original = originals.get(record.recordSequence);
        if (!original) continue;
        const {recording, ...unchanged} = record;
        assert.deepEqual(unchanged, original, 'accepted raw state values, NULL/ACK/q and timestamps are unchanged');
    }
    assert.equal(next.recording.writeErrors, rejected.length);
    assert.equal(h.journal.health().writeErrors, 0);
    const immutablePayloads = stored.map(entry => entry.payload);
    const status = await h.recorder.finishRecording();
    assert.equal(status.drained, true);
    assert.equal(status.durability, 'loss_reported');
    await h.journal.close();
    const restarted = new DecisionRecordJournal({directory: h.directory, now: h.now});
    await restarted.initialize();
    t.after(() => restarted.close());
    assert.deepEqual(restarted.health().lossEpisodes, history, 'shutdown and restart retain the historical episode');
    assert.deepEqual((await restarted.readBatch({limit: immutablePayloads.length, maxBytes: 16 * 1024 * 1024}))
        .map(entry => entry.payload), immutablePayloads);
    h.advance(1000);
    const nextSession = new ShadowController({...h.recorder.adapter, decisionRecordJournal: restarted}, {now: h.now});
    nextSession.enqueueRecord({schema: 2, timestamp: h.now(), event: {type: 'new-session'}});
    await nextSession.recordAppendTail;
    const newSessionEntries = await restarted.readBatch({afterId: stored.at(-1).id, limit: 16, maxBytes: 512 * 1024});
    const newSession = newSessionEntries.map(entry => JSON.parse(entry.payload))
        .find(frame => frame.recordSession === nextSession.recordSession);
    assert.ok(newSession);
    assert.deepEqual(newSession.recording.localJournal.lossEpisodes, history,
        'a new session carries the old loss evidence without changing its session identity');
    await restarted.close();
});

test('a stalled publication read cannot fill the recorder byte queue while durable appends remain available',async t=>{
    const h=await fixture(t,false);t.mock.method(Date,'now',h.now);
    h.recorder.enqueueRecord(largeRawContext(h.now()));await h.recorder.recordAppendTail;
    let entered,releaseRead;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{releaseRead=r;});
    const read=h.journal._readBoundedFile.bind(h.journal);
    h.journal._readBoundedFile=async(...args)=>{entered();await gate;return read(...args);};
    const reading=h.journal.readBatch({limit:1});await started;
    const expected=[];
    try {
        for(let n=0;n<140;n++) {
            h.advance(100);const original=largeRawContext(h.now());expected.push(original);
            h.recorder.enqueueRecord(original);
            let timer;
            try {await Promise.race([h.recorder.recordAppendTail,new Promise((_,reject)=>{
                timer=setTimeout(()=>reject(new Error('recorder drain blocked by immutable read')),2000);
            })]);} finally {clearTimeout(timer);}
            assert.equal(h.recorder.recordDropped,0);
            assert.equal(h.recorder.durablePending.size,0);
            assert.equal(h.recorder.durablePendingBytes,0);
        }
        assert.equal(h.journal.health().records,141);
    } finally {releaseRead();await reading;await h.recorder.recordAppendTail;}
    const stored=await h.journal.readBatch({limit:150,maxBytes:32*1024*1024});
    const decoder=new DecisionRecordDecoder();const decoded=stored.map(e=>decoder.decode(JSON.parse(e.payload)));
    assert.equal(decoded.length,141);assert.ok(decoded.every(e=>!e.reconstruction));
    for(let n=0;n<expected.length;n++)assert.deepEqual(decoded[n+1].production,expected[n].production);
    await h.recorder.finishRecording();
    const final=await h.journal.readBatch({limit:150,maxBytes:32*1024*1024});
    assert.deepEqual(final.slice(0,stored.length).map(e=>e.sha256),stored.map(e=>e.sha256));
    await h.journal.close();
    const recovered=new DecisionRecordJournal({directory:h.directory,now:h.now});await recovered.initialize();
    try {assert.deepEqual((await recovered.readBatch({limit:150,maxBytes:32*1024*1024})).map(e=>e.sha256),final.map(e=>e.sha256));}
    finally {await recovered.close();}
});
