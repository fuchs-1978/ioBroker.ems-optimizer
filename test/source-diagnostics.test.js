'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {sourceSnapshot, probeSource} = require('../lib/source-diagnostics');

test('source snapshot preserves source timestamps and excludes unrelated state fields', () => {
    const s = sourceSnapshot({val: 0, ts: 100, lc: 80, ack: true, q: 0, secret: 'omit'}, 200);
    assert.deepEqual(s, {present: true, val: 0, ts: 100, lc: 80, ack: true, q: 0, ageMs: 100});
    assert.equal(sourceSnapshot(null, 200).ageMs, null);
    assert.equal(sourceSnapshot({val: null, ts: 100}, 200).val, null);
});

test('diagnostic direct read records its own completion time without replacing source time', async () => {
    let now = 1000;
    const r = await probeSource(async () => {now = 1040; return {val: 50, ts: 1020, ack: true, q: 0};}, () => now);
    assert.equal(r.durationMs, 40);
    assert.equal(r.snapshot.ageMs, 20);
    assert.equal(r.snapshot.ts, 1020);
});

test('missing and rejected direct reads remain unknown', async () => {
    assert.equal((await probeSource(async () => null, () => 1000)).status, 'missing');
    const r = await probeSource(async () => {throw new Error('read unavailable');}, () => 1000);
    assert.equal(r.status, 'error'); assert.equal(r.snapshot, null);
});

test('a stalled diagnostic read times out and a late answer cannot revise its result', async () => {
    const keepAlive = setInterval(() => {}, 100);
    let finish;
    try {
        const r = await probeSource(() => new Promise(resolve => {finish = resolve;}), Date.now, 5);
        assert.equal(r.status, 'timeout'); assert.equal(r.snapshot, null);
        finish({val: 100, ts: Date.now(), ack: true});
        await Promise.resolve(); assert.equal(r.status, 'timeout');
    } finally {clearInterval(keepAlive);}
});
