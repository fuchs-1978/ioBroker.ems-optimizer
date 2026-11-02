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

for (const [error, expected] of [
    ["sql.0 (16131) Host 'private-host' is blocked because of many connection errors; unblock with 'mysqladmin flush-hosts' (code: ER_HOST_IS_BLOCKED) (errno: 1129)", 'ER_HOST_IS_BLOCKED'],
    [{code: 'ER_HOST_IS_BLOCKED', message: 'private SQL and password'}, 'ER_HOST_IS_BLOCKED'],
    [{errno: 1129}, 'ER_HOST_IS_BLOCKED'],
    ['(errno: 1129)', 'ER_HOST_IS_BLOCKED'],
    ['Error: connect ETIMEDOUT', 'ETIMEDOUT'],
    [Object.assign(new Error('private endpoint'), {code: 'ETIMEDOUT', syscall: 'connect'}), 'ETIMEDOUT'],
    ['sql.0 (16131) connect ECONNREFUSED 10.0.0.1:3306', 'ECONNREFUSED']
]) test(`connection failure is classified without retaining private payload: ${expected}, ${typeof error}`, () => {
    const b = new Backoff({now: () => 100000});
    assert.equal(b.observeError(error), true);
    assert.equal(b.paused(), true);
    assert.equal(b.health().errorCode, expected);
    assert.equal(b.health().retryAt, 160000);
    assert.doesNotMatch(JSON.stringify(b.health()), /private|password|10\.0\.0\.1|flush-hosts/);
});

test('a host block promotes an earlier connect timeout without extending a storm pause', () => {
    let now = 100000; const b = new Backoff({now: () => now});
    b.observeError('connect ETIMEDOUT');
    now += 10000;
    b.observeError({code: 'ER_HOST_IS_BLOCKED'});
    for (let n = 0; n < 1000; n++) b.observeError('connect ETIMEDOUT');
    assert.equal(b.health().retryAt, 160000);
    assert.equal(b.health().failures, 1);
    assert.equal(b.health().reason, 'sql-host-blocked');
    assert.equal(b.proveStored(100000), false);
    now++;
    assert.equal(b.proveStored(now), true);
    assert.equal(b.health().errorCode, undefined);
    assert.equal(b.health().message, undefined);
});

for (const error of ['ETIMEDOUT', 'query ETIMEDOUT', 'Query inactivity timeout',
    'local query deadline; backend completion unknown; verification stopped',
    'SELECT ER_HOST_IS_BLOCKED FROM records', "SELECT 'connect ETIMEDOUT'", {code: 'ETIMEDOUT'},
    {code: 'ETIMEDOUT', syscall: 'query'}, {code: 'ECONNREFUSED', syscall: 'read'}, null])
test(`a local/query deadline or data literal cannot trigger a connection pause: ${JSON.stringify(error)}`, () => {
    const b = new Backoff(); assert.equal(b.observeError(error), false);
    assert.equal(b.degraded, false);
});

test('connection errors obey the configured-instance, severity and freshness gates', () => {
    const b = new Backoff({now: () => 100000});
    const valid = {from: 'sql.0', severity: 'error', ts: 100000, message: 'connect ETIMEDOUT'};
    for (const changed of [{from: 'sql.1'}, {severity: 'info'}, {ts: 69999}, {ts: 106000}])
        assert.equal(b.observeLog({...valid, ...changed}, 'sql.0'), false);
    assert.equal(b.observeLog(valid, 'sql.0'), true);
});
