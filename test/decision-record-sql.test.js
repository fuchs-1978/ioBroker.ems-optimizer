'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildVerificationSelect, buildDatapointSelect, readDecisionRecordDatabase, ID_CACHE_MS} = require('../lib/decision-record-sql');
const bounds = {start: 1000, end: 3000, limit: 32};
const id = 'ems-optimizer.0.Debug.Shadow.DecisionRecord';
const row = {ts: 2000, val: 'original'};
const numeric = 73; // Deliberately not the operator's installation-specific 358.
function fixture(native = {dbtype: 'mysql', dbname: 'iobroker'}, custom = {}) {
    const calls = [], adapter = {namespace: 'ems-optimizer.0', config: {historyInstance: 'sql.0'},
        getForeignObjectAsync: async key => key.startsWith('system.adapter.')
            ? {native} : {common: {custom: {'sql.0': custom}}},
        sendTo: (instance, command, message, callback) => {
            calls.push({instance, command, message, callback});
            callback({result: /SELECT (TOP 2 )?id, type FROM/.test(message) ? [{id: numeric, type: 1}] : [row]});
        }};
    return {adapter, calls, native, custom};
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('bounded dialects use a literal numeric ID and a separate exact metadata guard, never id=(subquery)', () => {
    for (const dbtype of ['mysql', 'postgresql', 'sqlite', 'mssql']) {
        const native = {dbtype, dbname: 'ems-test'}, sql = buildVerificationSelect(native, id, bounds, numeric);
        assert.match(sql, /WHERE id = 73 AND ts >= 1000 AND ts <= 3000/);
        assert.match(sql, /EXISTS \(SELECT 1 FROM .*datapoints WHERE id = 73 AND name = .* AND type = 1\)/);
        assert.doesNotMatch(sql, /id = \(SELECT|UNION|OFFSET|COUNT|INSERT|UPDATE|DELETE/);
        assert.equal(sql.split(';').length, 2);
        const lookup = buildDatapointSelect(native, id);
        if (dbtype === 'mssql') {assert.match(sql, /^SELECT TOP 32/); assert.match(lookup, /^SELECT TOP 2/); assert.doesNotMatch(sql, /LIMIT/);}
        else {assert.match(sql, /LIMIT 32;$/); assert.match(lookup, /LIMIT 2;$/);}
    }
});

test('unsafe identifiers, unresolved/noninteger IDs and unbounded requests never dispatch SQL', async () => {
    for (const native of [{dbtype: 'other'}, {dbtype: 'mysql', dbname: 'db`name'}, {dbtype: 'mssql', dbname: 'db];DELETE'}, {dbtype: 'mysql'}])
        assert.throws(() => buildVerificationSelect(native, id, bounds, numeric));
    for (const name of ['', "x' OR 1=1--", 'x\\y', 'x\n', 'x'.repeat(1025)])
        assert.throws(() => buildDatapointSelect({dbtype: 'sqlite'}, name));
    for (const n of [undefined, null, 0, -1, 2.5, NaN, Infinity, '1 OR 1=1', '1e2', 2147483648])
        assert.throws(() => buildVerificationSelect({dbtype: 'sqlite'}, id, bounds, n));
    for (const change of [{start: -1}, {end: 999}, {start: NaN}, {end: Infinity}, {end: 11001}, {limit: 0}, {limit: 33}, {limit: 1.5}, {start: '1000'}]) {
        const f = fixture(); const response = await readDecisionRecordDatabase(f.adapter, {...bounds, ...change});
        assert.equal(response.backendRequestIssued, false); assert.equal(f.calls.length, 0);
    }
});

test('cold lookup and history are serial; cached calls dispatch one SELECT and never return metadata as history', async () => {
    const f = fixture(); const one = await readDecisionRecordDatabase(f.adapter, bounds);
    assert.deepEqual(one.result, [row]); assert.equal(f.calls.length, 2);
    assert.match(f.calls[0].message, /^SELECT id, type/); assert.match(f.calls[1].message, /WHERE id = 73 AND ts/);
    const two = await readDecisionRecordDatabase(f.adapter, bounds);
    assert.deepEqual(two.result, [row]); assert.equal(f.calls.length, 3);
    assert.ok(f.calls.every(c => c.command === 'query' && c.instance === 'sql.0'));
    assert.equal(two.backendRequestIssued, true); assert.equal(two.backendCompletionObserved, true);
});

test('empty history remains empty, invalidates metadata, and issues no immediate fallback/retry query', async () => {
    const f = fixture(), send = f.adapter.sendTo;
    f.adapter.sendTo = (instance, command, sql, callback) => send(instance, command, sql,
        response => callback(/SELECT id, type/.test(sql) ? response : {result: []}));
    assert.deepEqual((await readDecisionRecordDatabase(f.adapter, bounds)).result, []); assert.equal(f.calls.length, 2);
    await readDecisionRecordDatabase(f.adapter, bounds); assert.equal(f.calls.length, 4);
});

test('SQL alias uses exact persisted metadata name and invalid alias fails without dispatch', async () => {
    const f = fixture(undefined, {aliasId: 'archive.Originals:EMS-0'});
    await readDecisionRecordDatabase(f.adapter, bounds);
    assert.ok(f.calls.every(c => c.message.includes("'archive.Originals:EMS-0'")));
    assert.ok(f.calls.every(c => !c.message.includes('ems-optimizer')));
    const invalid = fixture(undefined, {aliasId: 123});
    assert.equal((await readDecisionRecordDatabase(invalid.adapter, bounds)).backendRequestIssued, false);
    assert.equal(invalid.calls.length, 0);
});

for (const mode of ['abort', 'unload', 'changed-instance']) test(`initial metadata gate prevents all dispatch after ${mode}`, async () => {
    const f = fixture(), controller = new AbortController(); let release;
    f.adapter.getForeignObjectAsync = key => key.startsWith('system.adapter.')
        ? new Promise(resolve => {release = resolve;}) : Promise.resolve({common: {}});
    const reading = readDecisionRecordDatabase(f.adapter, {...bounds, signal: controller.signal});
    if (mode === 'abort') controller.abort(); if (mode === 'unload') f.adapter.unloading = true;
    if (mode === 'changed-instance') f.adapter.config.historyInstance = 'sql.1';
    release({native: f.native}); const response = await reading;
    assert.equal(response.backendRequestIssued, false); assert.equal(f.calls.length, 0);
});

for (const mode of ['abort', 'unload', 'changed-instance', 'alias', 'database'])
test(`completed ID lookup after ${mode} never dispatches history and reports actual backend completion`, async () => {
    const f = fixture(), controller = new AbortController(); let complete;
    f.adapter.sendTo = (instance, command, message, callback) => {f.calls.push({message}); complete = callback;};
    const reading = readDecisionRecordDatabase(f.adapter, {...bounds, signal: controller.signal}); await turn();
    if (mode === 'abort') controller.abort(); if (mode === 'unload') f.adapter.unloading = true;
    if (mode === 'changed-instance') f.adapter.config.historyInstance = 'sql.1';
    if (mode === 'alias') f.custom.aliasId = 'new.alias'; if (mode === 'database') f.native.dbname = 'new_db';
    complete({result: [{id: numeric, type: 1}]}); const response = await reading;
    assert.equal(f.calls.length, 1); assert.ok(response.error);
    assert.equal(response.backendRequestIssued, true); assert.equal(response.backendCompletionObserved, true);
    assert.equal(response.localNotIssuedEvidence, undefined); assert.equal(response.result, null);
});

test('duplicate metadata callback cannot start a second SELECT; abort after final dispatch retains its actual late result', async () => {
    const f = fixture(), controller = new AbortController(); const callbacks = [];
    f.adapter.sendTo = (instance, command, sql, callback) => {f.calls.push({message: sql}); callbacks.push(callback);};
    let settled = false; const reading = readDecisionRecordDatabase(f.adapter, {...bounds, signal: controller.signal})
        .then(result => {settled = true; return result;}); await turn();
    callbacks[0]({result: [{id: numeric, type: 1}]}); await turn(); assert.equal(callbacks.length, 2);
    callbacks[0]({result: [{id: 999, type: 1}]}); await turn(); assert.equal(callbacks.length, 2);
    controller.abort(); await turn(); assert.equal(settled, false);
    callbacks[1]({result: [row]}); const response = await reading;
    assert.deepEqual(response.result, [row]); assert.equal(response.backendCompletionObserved, true);
});

test('missing, duplicate, wrong-type and unsafe ID metadata never becomes a persistence proof', async () => {
    for (const result of [[], [{id: 1, type: 1}, {id: 2, type: 1}], [{id: 1, type: 0}], [{id: '1 OR 1=1', type: 1}], [{id: null, type: 1}], [{id: 2147483648, type: 1}]]) {
        const f = fixture(); f.adapter.sendTo = (instance, command, message, callback) => {f.calls.push({message}); callback({result});};
        const response = await readDecisionRecordDatabase(f.adapter, bounds);
        assert.ok(response.error); assert.equal(response.result, null); assert.equal(f.calls.length, 1);
        assert.equal(response.backendCompletionObserved, true);
    }
});

test('metadata errors never expose connection secrets or fall back to cached history', async () => {
    const f = fixture(); f.adapter.getForeignObjectAsync = async () => {throw new Error('private-connection-secret');};
    const response = await readDecisionRecordDatabase(f.adapter, bounds);
    assert.equal(response.backendRequestIssued, false); assert.equal(f.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(response), /private-connection-secret/);
    const g = fixture(); g.adapter.sendTo = (instance, command, sql, callback) => callback({error: 'private-secret', result: null});
    const failed = await readDecisionRecordDatabase(g.adapter, bounds);
    assert.equal(failed.backendCompletionObserved, true); assert.doesNotMatch(JSON.stringify(failed), /private-secret/);
});

test('a transport throw is never presented as proof of non-dispatch, whether in lookup or history', async () => {
    for (const phase of [1, 2]) {
        const f = fixture(), send = f.adapter.sendTo; let calls = 0;
        f.adapter.sendTo = (...args) => {if (++calls === phase) throw new Error('transport interrupted'); return send(...args);};
        await assert.rejects(readDecisionRecordDatabase(f.adapter, bounds), /transport interrupted/);
    }
});

for (const field of ['host', 'port', 'user', 'dbname', 'dbtype', 'socketPath', 'fileName', 'alias', 'instance'])
test(`cached ID is discarded after ${field} changes`, async () => {
    const f = fixture(); await readDecisionRecordDatabase(f.adapter, bounds);
    if (field === 'alias') f.custom.aliasId = 'changed.alias';
    else if (field === 'instance') f.adapter.config.historyInstance = 'sql.1';
    else f.native[field] = field === 'dbtype' ? 'sqlite' : 'changed';
    await readDecisionRecordDatabase(f.adapter, bounds);
    assert.equal(f.calls.length, 4); assert.match(f.calls[2].message, /SELECT id, type/);
});

test('cache expires within five minutes, rejects backwards time, and is isolated per adapter generation', async t => {
    let at = 1000; t.mock.method(Date, 'now', () => at); const f = fixture();
    await readDecisionRecordDatabase(f.adapter, bounds); at += ID_CACHE_MS - 1;
    await readDecisionRecordDatabase(f.adapter, bounds); assert.equal(f.calls.length, 3);
    at++; await readDecisionRecordDatabase(f.adapter, bounds); assert.equal(f.calls.length, 5);
    at = 0; await readDecisionRecordDatabase(f.adapter, bounds); assert.equal(f.calls.length, 7);
    const next = {...f.adapter}; await readDecisionRecordDatabase(next, bounds); assert.equal(f.calls.length, 9);
});

test('configuration changing during the final SQL response cannot prove the newly configured destination', async () => {
    const f = fixture(), send = f.adapter.sendTo;
    f.adapter.sendTo = (instance, command, sql, callback) => send(instance, command, sql, response => {
        if (sql.startsWith('SELECT ts')) f.custom.aliasId = 'changed.after.dispatch'; callback(response);
    });
    const result = await readDecisionRecordDatabase(f.adapter, bounds);
    assert.equal(result.backendCompletionObserved, true); assert.ok(result.error); assert.equal(result.result, null);
});

test('real SQLite direct range preserves ID/name/type, NULL, inclusive boundaries, LIMIT and rejects reassigned cache IDs', async t => {
    let DatabaseSync; try {({DatabaseSync} = require('node:sqlite'));} catch {return t.skip('node:sqlite unavailable on early Node 22');}
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE datapoints (id INTEGER PRIMARY KEY, name TEXT, type INTEGER);'
            + 'CREATE TABLE ts_string (id INTEGER, ts INTEGER, val TEXT, PRIMARY KEY(id,ts));');
        db.prepare('INSERT INTO datapoints VALUES(?,?,?)').run(numeric, id, 1);
        for (const r of [[numeric,999,'before'], [numeric,1000,null], [numeric,2000,'original'], [numeric,3000,'end'], [numeric,3001,'after']])
            db.prepare('INSERT INTO ts_string VALUES(?,?,?)').run(...r);
        const f = fixture({dbtype: 'sqlite'});
        f.adapter.sendTo = (instance, command, message, callback) => {f.calls.push({message}); callback({result: db.prepare(message).all().map(r => ({...r}))});};
        assert.deepEqual((await readDecisionRecordDatabase(f.adapter, bounds)).result, [{ts:1000,val:null},row,{ts:3000,val:'end'}]);
        assert.deepEqual((await readDecisionRecordDatabase(f.adapter, {...bounds, limit: 1})).result, [{ts:1000,val:null}]);
        const plan = db.prepare('EXPLAIN QUERY PLAN ' + buildVerificationSelect({dbtype:'sqlite'}, id, bounds, numeric)).all();
        assert.ok(plan.some(r => /SEARCH ts_string.*id=\?.*ts>\?.*ts<\?/.test(r.detail)));
        // Even an identical original at an old ID is NOT proof for a new name.
        db.exec("UPDATE datapoints SET name='other.name';");
        assert.deepEqual((await readDecisionRecordDatabase(f.adapter, bounds)).result, []);
        const absent = await readDecisionRecordDatabase(f.adapter, bounds); assert.ok(absent.error);
        db.prepare('INSERT INTO datapoints VALUES(?,?,?)').run(91, id, 1);
        db.prepare('INSERT INTO ts_string VALUES(?,?,?)').run(91, 2000, 'new-id-original');
        const moved = await readDecisionRecordDatabase(f.adapter, bounds);
        assert.deepEqual(moved.result, [{ts:2000,val:'new-id-original'}]);
        db.exec('UPDATE datapoints SET type=0 WHERE id=91;');
        assert.deepEqual((await readDecisionRecordDatabase(f.adapter, bounds)).result, []);
    } finally {db.close();}
});

for (const delayedPhase of ['lookup', 'history']) test(`real delivery fence survives ${delayedPhase} deadline; late metadata is not a storage proof`, async t => {
    const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
    const Journal = require('../lib/decision-record-journal');
    const Delivery = require('../lib/decision-record-delivery');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-sql161-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const journal = new Journal({directory}); await journal.initialize();
    const original = JSON.stringify({schema: 2, recordSession: 'proof', recordSequence: 1, timestamp: 2000});
    const saved = await journal.append(original); const f = fixture(); const callbacks = [];
    f.adapter.sendTo = (instance, command, sql, callback) => {
        f.calls.push({message: sql});
        if (delayedPhase === 'history' && sql.startsWith('SELECT id')) callback({result: [{id: numeric, type: 1}]});
        else callbacks.push(callback);
    };
    const delivery = new Delivery({journal, publish: async () => {}, now: () => 100000,
        readHistory: options => readDecisionRecordDatabase(f.adapter, options), queryTimeoutMs: 1000});
    delivery.entries.set(saved.id, {...saved, payload: original});
    delivery.identities.set(JSON.stringify(['proof', 1]), saved.id);
    const task = {key: '1000:3000', start: 1000, end: 3000, limit: 32, ids: new Set([saved.id])};
    delivery.windows.set(task.key, task);
    await delivery.readWindow(task);
    assert.equal(delivery.health().backendBlocked, true); assert.equal(journal.health().sqlVerificationPending, true);
    assert.equal(journal.health().sqlConfirmedRecords, 0);
    if (delayedPhase === 'lookup') callbacks[0]({result: [{id: numeric, type: 1}]});
    else callbacks[0]({result: [{ts: 2000, val: original}]});
    await Promise.allSettled([...delivery.backendOperations]);
    assert.equal(journal.health().sqlVerificationPending, false); assert.equal(delivery.health().backendBlocked, false);
    assert.equal(f.calls.length, delayedPhase === 'lookup' ? 1 : 2);
    assert.equal(journal.health().sqlConfirmedRecords, delayedPhase === 'lookup' ? 0 : 1);
    assert.equal(delivery.health().sqlConfirmed, delayedPhase === 'lookup' ? 0 : 1);
    await delivery.stopAndDrain(); await journal.close();
});
