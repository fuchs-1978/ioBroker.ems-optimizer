'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {compareRecorded, timeline} = require('../lib/recorded-replay');
const {engineFactory} = require('../tools/compare-recorded-versions');
const start = 1800000000000;
function input() {
    return {schema: 1, from: start, to: start + 10000, sourceCoverage: 'complete-export',
        namespace: 'ems.0', config: {}, mapping: {}, initialStateMode: 'cold-start',
        initialStates: [], inputStateIds: ['meter.power'], records: [1, 2].map((seq, i) => ({schema: 2,
            recordSession: 1, recordSequence: seq, timestamp: start + i * 5000,
            production: {freshness: {control: {ts: start + i * 5000}}}, event: {type: 'source.update',
                id: 'meter.power', state: {val: i * 100, ts: start - 1000 + i * 5000, ack: true, q: 0}, receivedAt: start + i * 5000}}))};
}
const factory = factor => ({version: factor, create: () => {let value; return {source(id, state) {value = state.val;}, tick() {return {value: factor * value};}};}});
test('two versions receive identical original source order and timestamped differences are deterministic', () => {
    const a = compareRecorded(input(), [factory(1), factory(2)]);
    assert.equal(a.status, 'open-loop-comparison'); assert.equal(a.comparedTicks, 2);
    assert.equal(a.differences.length, 1); assert.equal(a.differences[0].at, start + 5000);
    assert.deepEqual(compareRecorded(input(), [factory(1), factory(2)]), a);
    assert.equal(timeline(input()).events[0].state.ts, start - 1000, 'source time never rewritten');
});
test('missing sequences, sources or unknown delta bases prevent guessed replay', () => {
    const x = input(); x.records[1].recordSequence = 3;
    assert.equal(compareRecorded(x, [factory(1), factory(2)]).status, 'unknown');
    const y = input(); delete y.sourceCoverage;
    assert.equal(compareRecorded(y, [factory(1), factory(2)]).comparedTicks, 0);
    assert.throws(() => timeline({records: []}));
});
test('real engine checkouts execute the same cold-start source tape with zero plant APIs', () => {
    const f = engineFactory(require('node:path').join(__dirname, '..'));
    const r = compareRecorded(input(), [f, f]); assert.equal(r.comparedTicks, 2);
    assert.equal(r.status, 'open-loop-comparison'); assert.equal(r.unknownTicks, 0);
    assert.equal(r.differences.length, 0); assert.equal(r.versions[0].sha256, r.versions[1].sha256);
    assert.ok(r.scope.includes('Keine simulierten Gegenfaktik-Energien'));
});
