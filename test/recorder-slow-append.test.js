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
    return {recorder, journal, states, put, release, started,
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
        } else {
            assert.equal(losses, 0);
            assert.equal(completionLoss, 0);
            assert.equal(completion, true);
            assert.deepEqual(actual, expected);
        }
    });
}
