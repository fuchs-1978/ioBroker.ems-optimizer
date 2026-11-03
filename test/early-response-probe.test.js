'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readEarlyResponseProbe} = require('../lib/wallbox-allocation');
const now = 1800000000000;
function fixture(phases = 1) {
    const options = {now, sessionStartedAt: now - 120000, commandAt: now - 20000,
        ackAt: now - 19000, amps: 18, phases, settleMs: 45000};
    const proof = {schema: 1, valid: true, commandAt: options.commandAt, ackAt: options.ackAt,
        amps: 18, nextA: 19, phases, qualifiedAt: now - 9000, observedAt: now,
        validUntil: now + 9000, remainingAttempts: 2};
    return {options, proof, state: {val: JSON.stringify(proof), ack: true, q: 0, ts: now}};
}
test('only a recent command-bound proof nominates one extra ampere for the same topology', () => {
    for (const phases of [1, 3]) {
        const {state, options, proof} = fixture(phases);
        assert.deepEqual(readEarlyResponseProbe(state, options), proof);
    }
});
for (const [name, change] of [
    ['wrong command', f => {f.proof.commandAt--;}],
    ['wrong ACK', f => {f.proof.ackAt--;}],
    ['wrong amps', f => {f.proof.amps--;}],
    ['multiple ampere grant', f => {f.proof.nextA = 20;}],
    ['wrong phases', f => {f.proof.phases = 3;}],
    ['exhausted attempts', f => {f.proof.remainingAttempts = 0;}],
    ['invalid attempt count', f => {f.proof.remainingAttempts = 3;}],
    ['short qualification', f => {f.proof.qualifiedAt = f.options.ackAt + 9999;}],
    ['future observation', f => {f.proof.observedAt = now + 1;}],
    ['expired proof', f => {f.proof.validUntil = now;}],
    ['renewed response deadline', f => {f.proof.validUntil = f.options.ackAt + 45001;}],
    ['long nomination', f => {f.proof.validUntil = now + 10001;}],
    ['previous output session', f => {f.options.sessionStartedAt = now - 10000;}],
    ['old observation', f => {f.proof.observedAt = now - 11000;}],
    ['bad source quality', f => {f.state.q = 64;}],
    ['unacknowledged state', f => {f.state.ack = false;}],
    ['future source time', f => {f.state.ts = now + 1;}],
    ['stale source time', f => {f.state.ts = now - 11000;}]
]) test('early probe nomination rejects ' + name, () => {
    const f = fixture(); change(f); f.state.val = JSON.stringify(f.proof);
    assert.equal(readEarlyResponseProbe(f.state, f.options), null);
});
test('malformed, absent and oversized nomination payloads stay unavailable', () => {
    const {state, options} = fixture();
    for (const val of ['{', 'null', '[]', '{}', 'x'.repeat(2049)])
        assert.equal(readEarlyResponseProbe({...state, val}, options), null);
    assert.equal(readEarlyResponseProbe(null, options), null);
});
