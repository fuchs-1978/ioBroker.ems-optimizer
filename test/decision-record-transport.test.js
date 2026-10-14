'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {packOriginals, unpackOriginals, expandTransportRows, MAX_BUNDLE_BYTES} = require('../lib/decision-record-transport');
const {DecisionRecordEncoder, decodeDecisionRecords} = require('../lib/decision-record-codec');

function originals(count = 4) {
    const encoder = new DecisionRecordEncoder();
    return Array.from({length: count}, (_, i) => JSON.stringify(encoder.encode({schema: 2,
        recordSession: 'original-session', recordSequence: i + 1, timestamp: 1000 + i,
        mode: 'PRODUCTION', masterEnabled: true, production: {stable: 'x'.repeat(4000), value: i},
        event: {type: i ? 'source.update' : 'command.attempt', commandId: 'command', sampleSequence: i,
            receivedAt: 1000 + i, state: {val: i ? null : 0, ts: 900 + i, lc: 800, ack: i === 0, q: i ? 64 : 0}},
        recording: {dropped: 2, bufferLost: 1}})));
}

test('transport bundle restores byte-exact originals and both SQL and source clocks', () => {
    const raw = originals();
    const bundle = packOriginals(raw);
    assert.deepEqual(unpackOriginals(bundle), raw);
    assert.deepEqual(expandTransportRows([{ts: 5000, val: bundle}]), raw.map(val => ({ts: 5000, val})));
    assert.deepEqual(decodeDecisionRecords([{ts: 5000, val: bundle}]),
        decodeDecisionRecords(raw.map(val => ({ts: 5000, val}))));
    assert.equal(decodeDecisionRecords([{ts: 5000, val: bundle}])[1].val.event.state.val, null);
    assert.equal(packOriginals([raw[0]]), raw[0], 'singletons remain backward compatible');
});

test('bad suffix, nested bundle, excessive counts and bytes never expose a valid prefix', () => {
    const raw = originals();
    for (const records of [[raw[0], '{bad'], [raw[0], packOriginals(raw)],
        [raw[0], null], Array(17).fill(raw[0]), [raw[0], JSON.stringify({schema: 2, value: 'x'.repeat(MAX_BUNDLE_BYTES)})]]) {
        const val = JSON.stringify({schema: 4, frameType: 'transport-bundle', records});
        assert.throws(() => unpackOriginals(val));
        assert.deepEqual(expandTransportRows([{ts: 5000, val}]), [{ts: 5000, val}]);
        const decoded = decodeDecisionRecords([{ts: 5000, val}]);
        assert.equal(decoded.length, 1);
        assert.equal(decoded[0].val.reconstruction.valid, false);
    }
});

test('mixed legacy, bundles, border duplicates and conflicting inner identities remain conservative', () => {
    const raw = originals();
    const rows = [{ts: 5000, val: packOriginals(raw)}, {ts: 5000, val: raw[1]},
        {ts: 5001, val: JSON.stringify({schema: 1, timestamp: 5001, valid: false})}];
    assert.equal(decodeDecisionRecords(rows).length, 5);
    const wrong = JSON.parse(raw[0]); wrong.data.production.value = 999;
    const conflicted = decodeDecisionRecords([{ts: 5000, val: packOriginals(raw)}, {ts: 5001, val: JSON.stringify(wrong)}]);
    assert.ok(conflicted.every(row => row.val.reconstruction?.valid === false));
});
