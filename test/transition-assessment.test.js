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
