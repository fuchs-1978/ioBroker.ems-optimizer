'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {isolatedIdleTelemetry} = require('../lib/wallbox-allocation');
const snapshot = () => {
    const state = val => ({val, ts: 960000, lc: 950000, ack: true, q: 0});
    return {now: 1000000, maximumAgeMs: 30000, busy: false,
        allow: state(0), power: state(0), currents: [state(0), state(0), state(0)]};
};
test('delayed idle OFF telemetry can be isolated without inventing fresh zero samples', () => {
    const s = snapshot(), before = JSON.stringify(s);
    assert.equal(isolatedIdleTelemetry(s), true);
    assert.equal(JSON.stringify(s), before);
});
for (const [name, change] of [
    ['owned/pending/reserved', s => {s.busy = true;}],
    ['ON', s => {s.allow.val = 1;}],
    ['unacknowledged OFF', s => {s.allow.ack = false;}],
    ['missing power', s => {s.power = null;}],
    ['bad power quality', s => {s.power.q = 64;}],
    ['nonzero power', s => {s.power.val = 0.1;}],
    ['nonzero phase', s => {s.currents[2].val = 1;}],
    ['missing phase', s => {s.currents[1] = null;}],
    ['future sample', s => {s.power.ts = 1002000;}],
    ['pre-OFF zero', s => {s.allow.lc = 970000;}],
    ['fresh telemetry', s => {for (const v of [s.allow, s.power, ...s.currents]) v.ts = s.now;}]
]) test('idle isolation rejected: ' + name, () => {
    const s = snapshot(); change(s); assert.equal(isolatedIdleTelemetry(s), false);
});
