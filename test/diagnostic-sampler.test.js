'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sampler = require('../lib/diagnostic-sampler');
const state = (val, ts, extra = {}) => ({val, ts, lc: ts, ack: true, q: 0, ...extra});

test('quiet interval captures excursions, NULL and original source times without inventing energy/coverage', () => {
    const s = new Sampler();
    let previous;
    for (const [at, val, extra] of [[1000, 100], [2000, 900], [3000, null], [4000, 0], [5000, 700, {q: 64}]]) {
        const current = state(val, at - 500, extra);
        s.observe('grid', current, previous, at); previous = current;
    }
    assert.equal(s.summary(30999), null);
    const interval = s.summary(31000);
    const x = interval.sources[0];
    assert.equal(x.count, 5); assert.equal(x.validCount, 3); assert.equal(x.invalidCount, 2);
    assert.equal(x.min, 0); assert.equal(x.max, 900); assert.equal(x.mean, 1000 / 3);
    assert.equal(x.firstSourceTs, 500); assert.equal(x.lastSourceTs, 4500);
    assert.match(interval.coverage, /no interpolation/);
    assert.equal(s.stats.size, 0);
});

test('pre-event window is bounded, immutable and overlapping triggers preserve each raw observation once', () => {
    const s = new Sampler({maxSamples: 3, maxBytes: 1000});
    let previous;
    for (let i = 1; i <= 5; i++) {
        const x = state(i, i * 1000); s.observe('power', x, previous, i * 1000); previous = x;
    }
    assert.equal(s.lost, 2); assert.equal(s.ring.length, 3); assert.ok(s.bytes <= 1000);
    const pre = s.trigger(5000); assert.deepEqual(pre.samples.map(x => x.state.val), [3, 4, 5]);
    previous.val = 999; assert.equal(pre.samples.at(-1).state.val, 5);
    const x = state(6, 6000); s.observe('power', x, state(5, 5000), 6000);
    assert.deepEqual(s.trigger(6000).samples.map(x => x.state.val), [6]);
    assert.equal(s.denseUntil, 126000);
    assert.equal(new Sampler().trigger(6000).actualStart, null, 'restart cannot invent prehistory');
});

test('power dips and quality/source-time discontinuities trigger; routine positive ramps do not', () => {
    const cases = [
        [state(1000, 1000), state(1500, 2000), {powerScale: 1}, false],
        [state(1000, 1000), state(0, 2000), {powerScale: 1}, true],
        [state(1.38, 1000), state(0, 2000), {powerScale: 1000}, true],
        [state(0, 1000), state(0, 2000, {ack: false}), {}, true],
        [state(0, 1000), state(0, 12000), {}, true],
        [state(0, 2000), state(0, 1000), {}, true],
        [state(0, 1000), null, {}, true],
        [state(0, 1000), state(1, 2000), {discrete: true}, true]
    ];
    for (const [before, after, options, expected] of cases)
        assert.equal(new Sampler().observe('source', after, before, 2000, options).important, expected);
});

test('expired prehistory is intentionally sampled, capacity drops stay explicit and input cannot be mutated', () => {
    const s = new Sampler({preMs: 1000, maxBytes: 500});
    const x = state(3, 1000); s.observe('source', x, x, 1000);
    x.val = 99;
    assert.equal(s.trigger(1000).samples[0].state.val, 3);
    s.observe('source', state(4, 4000), state(3, 1000), 4000);
    assert.equal(s.ring.length, 1); assert.equal(s.lost, 0);
    s.observe('big', state('x'.repeat(1000), 4000), null, 4000);
    assert.equal(s.lost, 1); assert.ok(s.bytes <= 500);
});

test('normal minute-scale temperature updates do not force dense windows; late updates and quality edges still do', () => {
    const s = new Sampler();
    const previous = state(21, 1000);
    assert.equal(s.observe('temperature', state(21, 61000), previous, 61000,
        {maxGapMs: 120000}).important, false);
    assert.equal(s.observe('temperature', state(21, 181001), state(21, 61000), 181001,
        {maxGapMs: 120000}).reason, 'source-gap');
    assert.equal(s.observe('temperature', state(21, 182000, {q: 64}), state(21, 181001), 182000,
        {maxGapMs: 120000}).reason, 'quality-edge');
    assert.equal(new Sampler().observe('grid', state(0, 61000), previous, 61000).reason, 'source-gap');
});
