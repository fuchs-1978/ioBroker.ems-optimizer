'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ShadowController = require('../lib/shadow-controller');
const Sampler = require('../lib/diagnostic-sampler');

test('absent q and q=0 retain raw samples without manufacturing a quality edge', () => {
    const sampler = new Sampler();
    const synthetic = {val: false, ack: true, ts: 1000};
    const echo = {...synthetic, q: 0};
    const result = sampler.observe('own', echo, synthetic, 1000, {discrete: true});
    assert.equal(result.important, false);
    assert.deepEqual(result.sample.state, echo);
    assert.equal(sampler.observe('own', {...echo, q: 64}, echo, 1001).reason, 'quality-edge');
    assert.equal(sampler.observe('own', {...echo, val: true}, echo, 1001, {discrete: true}).important, true);
});

test('capacity backpressure suppresses queued encodes, reports losses and resumes with a snapshot', async () => {
    let at = 1000, fail = true, attempts = 0, loss = 0;
    let health = {bytes: 100, maxBytes: 100, records: 1, maxRecords: 2, capacityVerified: true};
    const payloads = [];
    const journal = {health: () => health,
        reportLoss: (message, count = 1) => {loss += count;},
        append: async payload => {attempts++; if (fail) {const e = new Error('journal disk/record capacity exceeded'); e.code = 'EMS_JOURNAL_REJECTED'; throw e;} payloads.push(JSON.parse(payload));}};
    const adapter = {namespace: 'ems.0', config: {}, decisionRecordJournal: journal, setCompatState: async () => {}, warnDebug() {}};
    const recorder = new ShadowController(adapter, {now: () => at});
    recorder.enqueueRecord({schema: 2, timestamp: at, event: {type: 'first'}});
    await recorder.recordAppendTail;
    const baseline = attempts;
    for (let i = 0; i < 500; i++) recorder.enqueueRecord({schema: 2, timestamp: at, event: {type: 'command.attempt'}});
    await recorder.recordAppendTail;
    assert.equal(attempts, baseline, 'full journal must not queue hundreds of doomed appends');
    assert.equal(recorder.durablePending.size, 0);
    assert.equal(recorder.recordDropped, 501);
    at += 1000; recorder.publishRecordHealth();
    assert.equal(loss, 500, 'skipped records remain explicit in persistent journal counters');
    health = {...health, bytes: 0, maxBytes: 1024 * 1024, records: 0}; fail = false; at += 1000;
    recorder.enqueueRecord({schema: 2, timestamp: at, event: {type: 'recovered'}});
    await recorder.recordAppendTail;
    assert.equal(payloads[0].frameType, 'snapshot');
    assert.equal(payloads[0].recording.dropped, 501);
    assert.equal(recorder.recordBackpressure, false);
});


test('already queued frames stop encoding after the first disk capacity failure', async () => {
    let attempts = 0;
    const journal = {health: () => ({bytes: 100, maxBytes: 100, records: 1, maxRecords: 2, capacityVerified: true}),
        reportLoss() {}, append: async () => {attempts++; const e = new Error('journal disk/record capacity exceeded'); e.code = 'EMS_JOURNAL_REJECTED'; throw e;}};
    const r = new ShadowController({namespace: 'ems.0', config: {}, decisionRecordJournal: journal,
        setCompatState: async () => {}, warnDebug() {}}, {now: () => 1000});
    for (let i = 0; i < 50; i++) r.enqueueRecord({schema: 2, timestamp: 1000, data: i});
    await r.recordAppendTail;
    assert.equal(attempts, 1);
    assert.equal(r.recordDropped, 50);
    assert.equal(r.recordSequence, 50);
    assert.equal(r.durablePending.size, 0);
    await r.finishRecording();
    assert.equal(r.recordBackpressureLosses, 0, 'shutdown flushes the last batched loss count');
});
