'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Backoff = require('../lib/sql-diagnostic-backoff');

test('SQL write error starts bounded pause; a log storm retains no raw payload and cannot extend it', () => {
    let now = 100000;
    const b = new Backoff({now: () => now});
    assert.equal(b.observeLog({from: 'sql.0', severity: 'error', ts: now,
        message: 'Cannot insert private payload: Out of resources when opening file (Errcode: 24)'}, 'sql.0'), true);
    assert.equal(b.health().retryAt, 160000);
    now += 10000;
    for (let n = 0; n < 10000; n++) b.observeLog({from: 'sql.0', severity: 'error', ts: now,
        message: "Can't open file (errno: 24)"}, 'sql.0');
    assert.equal(b.health().retryAt, 160000);
    assert.equal(b.health().failures, 1);
    assert.equal(JSON.stringify(b.health()).includes('private'), false);
});

test('only fresh warning/error logs from configured SQL instance activate backoff', () => {
    const b = new Backoff({now: () => 100000});
    const base = {from: 'sql.0', severity: 'error', ts: 100000, message: 'Cannot insert'};
    for (const entry of [{...base, from: 'sql.1'}, {...base, severity: 'info'}, {...base, ts: 1},
        {...base, ts: 200000}, {...base, message: 'ordinary status'}, {...base, ts: undefined}])
        assert.equal(b.observeLog(entry, 'sql.0'), false);
    assert.equal(b.observeLog(base, 'javascript.0'), false);
    assert.equal(b.degraded, false);
});

test('subsequent failures back off exponentially up to five minutes; exact persistence proof resets', () => {
    let now = 100000;
    const b = new Backoff({now: () => now});
    for (const delay of [60000, 120000, 240000, 300000, 300000]) {
        b.fail(); assert.equal(b.until - now, delay);
        now = b.until; assert.equal(b.paused(), false);
        assert.equal(b.degraded, true);
    }
    now++; b.proveStored(now); assert.equal(b.degraded, false); assert.equal(b.failures, 0);
    b.fail(); assert.equal(b.until - now, 60000);
});


test('old persistence proofs cannot clear a write-error pause', () => {
    let now = 100000;
    const b = new Backoff({now: () => now}); b.fail();
    now += 200000;
    for (const ts of [null, 99000, 100000, 200000, 300001]) {
        assert.equal(b.proveStored(ts), false); assert.equal(b.degraded, true);
    }
    assert.equal(b.proveStored(now), true);
});
