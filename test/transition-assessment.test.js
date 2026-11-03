'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {TransitionAssessment, quantile} = require('../lib/transition-assessment');
const at = 1800000000000;
const source = (val, ts) => ({val, ts, valid: true, ack: true, q: 0});
const frame = (ts, w = {}) => ({ts, wallboxes: [{wb: 0, ResponseSentAt: 0, OutputActive: false, PhaseTransitionActive: false, ...w}]});
test('current response needs independent fresh ACK and electrical source; no startup reconstruction', () => {
    const a = new TransitionAssessment();
    a.observe(frame(at)); a.observe(frame(at + 5000, {ResponseSentAt: at + 1000, OutputCommand_A: 6}));
    const r = a.observe(frame(at + 10000, {ResponseSentAt: at + 1000, OutputCommand_A: 6,
        ResponseState: 'confirmed', ResponsePending: false, ResponseAcknowledgedAt: at + 2000,
        ResponseConfirmedAt: at + 7000, actual_W: 1380,
        measurements: {feedback: source(6, at + 2000), power: source(1.38, at + 6000)}}));
    assert.equal(r.events.at(-1).status, 'observed-success'); assert.equal(r.reactions[0].ackP50Ms, 1000);
    assert.equal(r.reactions[0].electricalP50Ms, 6000); assert.equal(r.reactions[0].transportP50Ms, null);
    const b = new TransitionAssessment(); assert.equal(b.observe(frame(at, {ResponseSentAt: at - 1})).reactions.length, 0);
});
test('supersession and gaps invalidate pending attribution rather than proving success', () => {
    const a = new TransitionAssessment(); a.observe(frame(at));
    a.observe(frame(at + 5000, {ResponseSentAt: at + 1000, OutputCommand_A: 6}));
    assert.equal(a.observe(frame(at + 10000, {ResponseSentAt: at + 1000, OutputCommand_A: 7})).events.at(-1).status, 'unknown');
    assert.equal(a.observe(frame(at + 30000)).events.at(-1).kind, 'coverage-gap');
    assert.equal(a.report().reactions.length, 0);
});
test('phase success requires observed quiet, new native mode and all three source currents', () => {
    const a = new TransitionAssessment(); a.observe(frame(at, {ConfirmedPhases: 1}));
    a.observe(frame(at + 5000, {PhaseTransitionActive: true, ConfirmedPhases: 1}));
    a.observe(frame(at + 10000, {PhaseTransitionActive: true, actual_W: 0, measurements: {power: source(0, at + 9000)}}));
    const r = a.observe(frame(at + 15000, {ConfirmedPhases: 3, actual_W: 4100,
        measurements: {phaseMode: source(2, at + 12000), phaseCurrents: [6, 6, 6].map(x => source(x, at + 14000))}}));
    assert.equal(r.events.at(-1).status, 'observed-success');
});
test('heater transport, ACK and physical observation remain separate; delays can complete later', () => {
    const a = new TransitionAssessment(); a.observe({ts: at, wallboxes: []});
    const c = {commandId: 'a', issuedAt: at + 1000, at: at + 1200, type: 'command.transport_complete', value: 1000};
    a.observe({ts: at + 5000, wallboxes: []}, {heaterCommand: c});
    const r = a.observe({ts: at + 10000, wallboxes: [], ehz: {actual_W: 1000},
        measurements: {ehzOutputs: [source(1000, at + 8000)]}},
    {heaterCommand: c, heaterAck: {val: 1000, ts: at + 6000, ack: true, from: 'system.adapter.modbus.0'}, owner: 'system.adapter.ems.0', heaterDriver: 'system.adapter.modbus.0'});
    assert.equal(r.events.at(-1).status, 'observed-success'); assert.equal(r.reactions[0].transportP50Ms, 200);
    assert.equal(r.reactions[0].ackP50Ms, 5000); assert.equal(r.reactions[0].electricalP50Ms, 9000);
});
test('sample memory and quantiles are bounded and missing series remain null', () => {
    const a = new TransitionAssessment(); for (let i = 0; i < 100; i++) {a.sample('wallbox0', 'current', i, i); a.add({at: i});}
    assert.equal(a.report().reactions[0].count, 64); assert.equal(a.report().events.length, 24);
    assert.equal(quantile([], 0.9), null); assert.equal(quantile([1, 3], 0.5), 2);
});
test('an ACK without physical response and a phase switch without observed pause never pass', () => {
    const a = new TransitionAssessment(); a.observe(frame(at));
    a.observe(frame(at + 5000, {ResponseSentAt: at + 1000, OutputCommand_A: 6}));
    const r = a.observe(frame(at + 10000, {ResponseSentAt: at + 1000, OutputCommand_A: 6,
        ResponseState: 'confirmed', ResponsePending: false, ResponseAcknowledgedAt: at + 2000,
        ResponseConfirmedAt: at + 7000, actual_W: 0,
        measurements: {feedback: source(6, at + 2000), power: source(0, at + 6000)}}));
    assert.equal(r.events.at(-1).status, 'unknown'); assert.equal(r.reactions.length, 0);
    const p = new TransitionAssessment(); p.observe(frame(at, {ConfirmedPhases: 3}));
    p.observe(frame(at + 5000, {PhaseTransitionActive: true, ConfirmedPhases: 3}));
    assert.equal(p.observe(frame(at + 10000, {ConfirmedPhases: 1, actual_W: 1380})).events.at(-1).status, 'unknown');
});
test('handover can finish after the start edge but needs released reserve and an independent donor zero', () => {
    const a = new TransitionAssessment();
    const donor = ts => ({wb: 0, OutputActive: false, OutputOwned: false, StopPowerPending: false, OutputReservedPower_W: 0,
        StopConfirmedAt: at - 1000, actual_W: 0, measurements: {allow: source(0, ts), power: source(0, ts),
            phaseCurrents: [0, 0, 0].map(x => source(x, ts))}});
    a.observe({ts: at, wallboxes: [donor(at), {wb: 1, OutputActive: false}]});
    a.observe({ts: at + 5000, wallboxes: [donor(at + 4000), {wb: 1, OutputActive: true, OutputOwned: true}]});
    const r = a.observe({ts: at + 10000, wallboxes: [donor(at + 9000), {wb: 1, OutputActive: true, OutputOwned: true,
        ResponseState: 'confirmed', actual_W: 1380, measurements: {allow: source(1, at + 6000), power: source(1.38, at + 9000)}}]});
    assert.equal(r.events.at(-1).kind, 'handover'); assert.equal(r.events.at(-1).status, 'observed-success');
});

const stopFrame = (ts, w = {}) => frame(ts, {OutputActive: false, LastStopAt: at + 1000,
    SoCValid: true, SoC_pct: 80, TargetSoC_pct: 80, ...w});
const stoppedMeasurements = ts => ({allow: source(0, ts), power: source(0, ts),
    phaseCurrents: [0, 0, 0].map(x => source(x, ts))});
function stopping() {
    const a = new TransitionAssessment();
    a.observe(frame(at, {OutputActive: true}));
    a.observe(stopFrame(at + 5000));
    return a;
}
test('stop ACK and electrical quiet can arrive in later frames and emit one attributed target stop', () => {
    const a = stopping();
    assert.equal(a.report().events.length, 0);
    assert.equal(a.report().pendingStops.length, 1);
    a.observe(stopFrame(at + 10000, {StopConfirmedAt: at + 8000,
        measurements: {allow: source(0, at + 8000)}}));
    const r = a.observe(stopFrame(at + 15000, {StopConfirmedAt: at + 8000,
        measurements: stoppedMeasurements(at + 12000), actual_W: 0}));
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].kind, 'target-stop');
    assert.equal(r.events[0].status, 'observed-success');
    assert.equal(r.events[0].stopAt, at + 1000);
    assert.equal(r.events[0].ackAt, at + 8000);
    assert.equal(r.events[0].electricalObservedAt, at + 12000);
    assert.equal(r.pendingStops.length, 0);
    a.observe(stopFrame(at + 20000, {StopConfirmedAt: at + 8000,
        measurements: stoppedMeasurements(at + 18000), actual_W: 0}));
    assert.equal(a.report().events.length, 1);
});
test('an independently observed OFF witness survives freshness expiry within the fixed stop chain', () => {
    const a = stopping();
    a.observe(stopFrame(at + 10000, {StopConfirmedAt: at + 8000, measurements: {allow: source(0, at + 8000)}}));
    a.observe(stopFrame(at + 20000, {StopConfirmedAt: at + 8000}));
    const measurements = stoppedMeasurements(at + 22000);
    measurements.allow = {...source(0, at + 8000), valid: false};
    const r = a.observe(stopFrame(at + 25000, {StopConfirmedAt: at + 8000, measurements, actual_W: 0}));
    assert.equal(r.events.at(-1).status, 'observed-success');
});
test('old, echo, faulty, future, missing and incomplete witnesses cannot prove a stop', () => {
    const mutations = [m => {m.allow.ts = at;}, m => {m.allow.ack = false;}, m => {m.allow.q = 64;},
        m => {m.allow.ts = at + 20000;}, m => {delete m.power;}, m => {m.power.valid = false;},
        m => {m.phaseCurrents[2].val = 1;}, m => {m.phaseCurrents[0].ts = at;}, m => {m.phaseCurrents.pop();}];
    for (const mutate of mutations) {
        const a = stopping(), measurements = stoppedMeasurements(at + 8000); mutate(measurements);
        a.observe(stopFrame(at + 10000, {StopConfirmedAt: at + 8000, actual_W: 0, measurements}));
        assert.equal(a.report().events.some(e => e.status === 'observed-success'), false);
        assert.equal(a.report().pendingStops.length, 1);
    }
});
test('stop chains end as unknown on restart, missing actor, sampling gaps, supersession and fixed timeout', () => {
    assert.equal(new TransitionAssessment().observe(stopFrame(at + 5000)).pendingStops.length, 0);
    for (const next of [frame(at + 10000, {OutputActive: true}), {ts: at + 10000, wallboxes: []},
        stopFrame(at + 10000, {LastStopAt: at + 9000}), stopFrame(at + 20000)]) {
        const a = stopping(), r = a.observe(next);
        assert.equal(r.pendingStops.length, 0);
        assert.equal(r.events.some(e => e.status === 'observed-success'), false);
        assert.equal(r.events.some(e => e.kind === 'target-stop' && e.status === 'unknown'), true);
    }
    const a = stopping();
    for (let t = 10000; t <= 125000; t += 5000) a.observe(stopFrame(at + t));
    assert.equal(a.report().pendingStops.length, 0);
    assert.equal(a.report().events.at(-1).status, 'unknown');
});
test('a later ON witness or an output fault aborts a pending stop without inventing electrical success', () => {
    for (const w of [{measurements: {allow: source(1, at + 14000)}}, {OutputFault: 'write failure'}]) {
        const a = stopping();
        a.observe(stopFrame(at + 10000, {StopConfirmedAt: at + 8000, measurements: {allow: source(0, at + 8000)}}));
        const r = a.observe(stopFrame(at + 15000, w));
        assert.equal(r.pendingStops.length, 0);
        assert.equal(r.events.at(-1).status, 'unknown');
    }
});
test('ordinary ON feedback before the first OFF witness keeps the asynchronous stop pending', () => {
    const a = stopping();
    a.observe(stopFrame(at + 10000, {measurements: {allow: source(1, at + 8000)}}));
    assert.equal(a.report().pendingStops.length, 1);
    const r = a.observe(stopFrame(at + 15000, {StopConfirmedAt: at + 12000,
        actual_W: 0, measurements: stoppedMeasurements(at + 12000)}));
    assert.equal(r.events.at(-1).status, 'observed-success');
});
test('same-interval non-target stops remain supported, without mutating any source frame', () => {
    const a = new TransitionAssessment(); a.observe(frame(at, {OutputActive: true}));
    const s = stopFrame(at + 5000, {SoC_pct: 70, StopConfirmedAt: at + 3000,
        actual_W: 0, measurements: stoppedMeasurements(at + 3000)}), before = structuredClone(s);
    const r = a.observe(s);
    assert.deepEqual(s, before);
    assert.equal(r.events.at(-1).kind, 'stop'); assert.equal(r.events.at(-1).status, 'observed-success');
});
