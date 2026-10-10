'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ShadowController = require('../lib/shadow-controller');
const DebugRecorder = require('../lib/debug-recorder');
const {DecisionRecordDecoder} = require('../lib/decision-record-codec');

function fixture() {
    let now = 2000000;
    const states = new Map(), writes = [];
    const mapping = {DP_WB0_POWER: 'power', DP_WB0_SOC: 'soc', DP_WB0_ALLOW: 'userAllow',
        DP_WB_PRIORITY: 'priority', DP_DHW_SETPOINT: 'heater', DP_DHW_ACTUAL_MIRROR: 'mirror'};
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, lc: 1, ack: true, q: 0, ...extra});
    const adapter = {namespace: 'ems.0', config: {globalWriteEnabled: true,
        diagnosticPumpSourcesJson: '["pump","pumpAck"]'}, readMapping: () => mapping,
        getCachedState: id => states.get(id), wallboxOutput: {devices: [{wb: 0, ids: {allow: 'allow', command: 'cmd'}}]},
        setCompatState: async (id, value) => { writes.push({id, value}); }, log: {warn() {}}};
    adapter.debugRecorder = new DebugRecorder(adapter);
    const recorder = new ShadowController(adapter, {now: () => now}); recorder.initialized = true;
    put('ems.0.System.RealOutputsEnabled', true); put('ems.0.Control.Valid', true); put('power', 1.38);
    const flush = async () => { for (let i = 0; i < 1000; i++) await Promise.resolve(); };
    const records = () => {const d = new DecisionRecordDecoder(); return writes.filter(w => w.id.endsWith('.DecisionRecord')).map(w => d.decode(JSON.parse(w.value)));};
    const samples = () => records().flatMap(r => r.event?.samples || (r.event?.type === 'source.update'
        ? [{id: r.event.id, state: r.event.state, sampleSequence: r.event.sampleSequence, receivedAt: r.event.receivedAt}] : []));
    return {adapter, recorder, states, writes, put, flush, records, samples, advance: ms => {now += ms;}};
}

test('quiet operation retains every delivered raw observation beyond the pre-event ring', async () => {
    const h = fixture(); h.recorder.productionRecord();
    const expected = [];
    for (let i = 0; i < 90; i++) {
        const previous = h.states.get('power'); h.advance(1000);
        h.put('power', 1.38, {lc: 1}); const state = structuredClone(h.states.get('power'));
        expected.push(state); h.recorder.captureProduction('power', state, previous); h.recorder.productionRecord();
        await h.flush();
    }
    h.advance(1000); h.recorder.flushSourceBatch(true); await h.flush();
    const unique = new Map(h.samples().filter(s => s.id === 'power').map(s => [s.sampleSequence, s.state]));
    assert.deepEqual([...unique.values()], expected);
    assert.equal(h.recorder.diagnosticSampler.lost, 0);
});

test('the raw recording contract declares its start without claiming earlier observations', async () => {
    const h = fixture(); h.recorder.productionRecord(); await h.flush();
    const first = h.records()[0];
    assert.equal(first.sampling.recordingStartedAt, first.timestamp);
    assert.equal(first.sampling.unknownBeforeRecordingStart, true);
    h.advance(1000); h.recorder.productionRecord({type: 'later'}); await h.flush();
    assert.equal(h.records().at(-1).sampling.recordingStartedAt, first.timestamp);
});

test('vehicle input, priority and configured pump sources retain original NULL ACK q and lc', async () => {
    const h = fixture(); h.recorder.productionRecord();
    const expected = new Map();
    for (const id of ['soc', 'userAllow', 'priority', 'pump', 'pumpAck']) {
        h.advance(1); h.put(id, null, {ack: false, q: 64, lc: 123});
        const state = structuredClone(h.states.get(id)); expected.set(id, state);
        h.recorder.captureProduction(id, state, undefined);
    }
    h.recorder.flushSourceBatch(true); await h.flush();
    for (const [id, state] of expected) assert.deepEqual(h.samples().find(s => s.id === id)?.state, state, id);
});

test('beginShutdown keeps final stop commands and source observations available before final drain', async () => {
    const h = fixture(); h.recorder.productionRecord(); await h.flush();
    h.recorder.beginShutdown(); h.adapter.unloading = true;
    const token = h.recorder.commandEvent('attempt', 'heater', 0);
    h.advance(1); h.put('heater', 0, {ack: true, lc: 12});
    h.recorder.captureProduction('heater', h.states.get('heater'), undefined);
    h.recorder.commandEvent('transport_complete', 'heater', 0, token);
    await h.recorder.finishRecording(); await h.flush();
    const records = h.records();
    assert.ok(records.some(r => r.event?.type === 'command.attempt' && r.event.commandId === token));
    assert.ok(records.some(r => r.event?.type === 'source.update' && r.event.id === 'heater' && r.event.state.ack === true));
    assert.equal(records.at(-1).event.type, 'recording.shutdown');
});

test('master OFF still records selected source q edges and repeated timestamp observations', async () => {
    const h = fixture(); h.adapter.config.globalWriteEnabled = false;
    h.put('ems.0.System.RealOutputsEnabled', false);
    for (const [id, value] of [['pumpAck', false], ['ems.0.System.RealOutputsEnabled', false],
        ['ems.0.Devices.Wallbox0.OutputOwned', false]]) {
        h.put(id, value); const previous = structuredClone(h.states.get(id));
        h.advance(1); h.put(id, value, {q: 64, lc: 42});
        const expected = structuredClone(h.states.get(id));
        h.recorder.captureProduction(id, expected, previous);
        await h.flush();
        assert.deepEqual(h.samples().find(s => s.id === id)?.state, expected, id);
    }
});

test('repeated receipt of an unchanged selected state preserves receipt times and sample sequences', async () => {
    const h = fixture(); const state = structuredClone(h.states.get('power'));
    h.recorder.captureProduction('power', state, state);
    h.advance(1000);
    h.recorder.captureProduction('power', state, state);
    h.recorder.flushSourceBatch(true); await h.flush();
    const received = h.samples().filter(sample => sample.id === 'power');
    const unique = new Map(received.map(sample => [sample.sampleSequence, sample]));
    assert.equal(unique.size, 2);
    const values = [...unique.values()];
    assert.deepEqual(values[0].state, state);
    assert.deepEqual(values[1].state, state);
    assert.equal(values[1].receivedAt - values[0].receivedAt, 1000);
    assert.equal(values[1].sampleSequence, values[0].sampleSequence + 1);
});

test('durable appends precede publication and a rejected base cannot seed later queued deltas', async () => {
    const h = fixture(); const saved = [];
    let attempts = 0, releases = 0;
    h.adapter.decisionRecordJournal = {
        append: async payload => { if (++attempts === 1) throw Error('disk unavailable'); saved.push(JSON.parse(payload)); },
        health: () => ({bytes: 0, records: saved.length, sqlConfirmedRecords: 0})
    };
    h.adapter.decisionRecordDelivery = {tick: async () => {releases++;}, health: () => ({lastError: ''})};
    h.recorder.productionRecord({type: 'first'});
    h.advance(1); h.recorder.productionRecord({type: 'second'});
    h.advance(1); h.recorder.productionRecord({type: 'third'});
    await h.flush();
    assert.equal(h.writes.filter(w => w.id.endsWith('.DecisionRecord')).length, 0, 'state publication belongs to the independent delivery path');
    assert.equal(saved.length, 2); assert.equal(releases, 2);
    assert.equal(saved[0].recordSequence, 2); assert.equal(saved[0].frameType, 'snapshot');
    const decoder = new DecisionRecordDecoder();
    assert.equal(decoder.decode(saved[0]).event.type, 'second');
    assert.equal(decoder.decode(saved[1]).event.type, 'third');
    assert.equal(h.recorder.recordWriteErrors, 1);
});

test('a stalled local append cannot hold shutdown indefinitely or claim SQL completion', async () => {
    const h = fixture();
    h.adapter.decisionRecordJournal = {append: () => new Promise(() => {}),
        health: () => ({bytes: 0, records: 0, sqlConfirmedRecords: 0})};
    h.recorder.productionRecord({type: 'pending'});
    await h.flush();
    h.recorder.beginShutdown(); h.adapter.unloading = true;
    const result = await h.recorder.finishRecording(10);
    assert.equal(result.drained, false);
    assert.equal(result.durability, 'unconfirmed');
    assert.equal(h.recorder.stopped, true);
    assert.ok(h.recorder.durablePending.size > 0);
});

test('a completed but rejected journal append is a loss rather than confirmed shutdown durability', async () => {
    const h = fixture();
    h.adapter.decisionRecordJournal = {append: async () => {throw new Error('journal capacity exhausted');},
        health: () => ({bytes: 0, records: 0, sqlConfirmedRecords: 0})};
    h.recorder.productionRecord({type: 'rejected'});
    await h.flush();
    h.recorder.beginShutdown(); h.adapter.unloading = true;
    const result = await h.recorder.finishRecording();
    assert.equal(result.drained, true);
    assert.equal(result.durability, 'loss_reported');
    assert.ok(h.recorder.recordDropped > 0);
    assert.ok(h.recorder.recordWriteErrors > 0);
});

test('persisted losses from an earlier journal session remain visible in later records and shutdown', async () => {
    const h = fixture(); const saved = [];
    h.adapter.decisionRecordJournal = {append: async payload => saved.push(JSON.parse(payload)),
        health: () => ({bytes: 0, records: saved.length, rejectedRecords: 3, writeErrors: 1,
            readErrors: 0, integrityValid: false, sqlVerificationPending: true})};
    h.recorder.productionRecord({type: 'after-restart'}); await h.flush();
    assert.equal(saved[0].recording.localJournal.rejectedRecords, 3);
    assert.equal(saved[0].recording.localJournal.writeErrors, 1);
    assert.equal(saved[0].recording.localJournal.integrityValid, false);
    assert.equal(saved[0].recording.localJournal.snapshotPhase, 'before-current-append');
    assert.equal(saved[0].recording.dropped, 0, 'session counters remain distinct from persisted journal counters');
    h.recorder.beginShutdown(); h.adapter.unloading = true;
    const result = await h.recorder.finishRecording();
    assert.equal(result.drained, true);
    assert.equal(result.durability, 'loss_reported');
});
