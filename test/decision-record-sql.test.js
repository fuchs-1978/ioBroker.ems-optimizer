'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {buildVerificationSelect, readDecisionRecordDatabase} = require('../lib/decision-record-sql');
const bounds = {start: 1000, end: 3000, limit: 32};
const id = 'ems-optimizer.0.Debug.Shadow.DecisionRecord';
function fixture(native = {dbtype: 'mysql', dbname: 'iobroker'}, custom = {}) {
    const calls = [];
    const adapter = {namespace: 'ems-optimizer.0', config: {historyInstance: 'sql.0'},
        getForeignObjectAsync: async key => key.startsWith('system.adapter.')
            ? {native} : {common: {custom: {'sql.0': custom}}},
        sendTo: (instance, command, message, callback) => {
            calls.push({instance, command, message, callback});
            callback({result: []});
        }};
    return {adapter, calls};
}

test('database-only bounded SELECT follows the four SQL-adapter table/dialect contracts', () => {
    for (const dbtype of ['mysql', 'postgresql', 'sqlite', 'mssql']) {
        const sql = buildVerificationSelect({dbtype, dbname: 'ems-test'}, id, bounds);
        assert.match(sql, /WHERE id = \(SELECT id FROM .*datapoints WHERE name = /);
        assert.match(sql, /AND type = 1\) AND ts >= 1000 AND ts <= 3000 ORDER BY ts ASC/);
        assert.doesNotMatch(sql, /UNION|JOIN|OFFSET|COUNT|INSERT|UPDATE|DELETE/);
        assert.equal(sql.split(';').length, 2, 'exactly one statement');
        if (dbtype === 'mssql') {
            assert.match(sql, /^SELECT TOP 32 ts, val FROM \[ems-test\]\.dbo\.ts_string/);
            assert.doesNotMatch(sql, /LIMIT/);
        } else assert.match(sql, /LIMIT 32;$/);
        if (dbtype === 'mysql') assert.match(sql, /FROM `ems-test`\.ts_string/);
        if (dbtype === 'sqlite' || dbtype === 'postgresql') assert.match(sql, /FROM ts_string/);
    }
});

test('untrusted identifiers, unsupported engines and unbounded requests never form a query', () => {
    for (const native of [{dbtype: 'other'}, {dbtype: 'mysql', dbname: 'db`name'},
        {dbtype: 'mssql', dbname: 'db];DELETE'}, {dbtype: 'mysql'}, {dbtype: 'mysql', dbname: 'x'.repeat(129)}])
        assert.throws(() => buildVerificationSelect(native, id, bounds));
    for (const name of ['', "x' OR 1=1--", 'x\\y', 'x\n', 'x'.repeat(1025)])
        assert.throws(() => buildVerificationSelect({dbtype: 'sqlite'}, name, bounds));
    for (const change of [{start: -1}, {end: 999}, {start: NaN}, {end: Infinity},
        {end: 11001}, {limit: 0}, {limit: 33}, {limit: 1.5}, {start: '1000'}])
        assert.throws(() => buildVerificationSelect({dbtype: 'sqlite'}, id, {...bounds, ...change}));
});

test('empty database rows remain empty; no cache/history or metadata query fallback', async () => {
    const f = fixture();
    const result = await readDecisionRecordDatabase(f.adapter, bounds);
    assert.deepEqual(result.result, []);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].instance, 'sql.0');
    assert.equal(f.calls[0].command, 'query');
    assert.equal(result.backendRequestIssued, true);
    assert.equal(result.backendCompletionObserved, true);
    assert.match(result.backendCompletionEvidence, /database-only/);
});

test('persisted SQL alias is used without silently querying the unaliased metadata name', async () => {
    const f = fixture(undefined, {aliasId: 'archive.Originals:EMS-0'});
    await readDecisionRecordDatabase(f.adapter, bounds);
    assert.match(f.calls[0].message, /name = 'archive\.Originals:EMS-0'/);
    assert.doesNotMatch(f.calls[0].message, /ems-optimizer/);
    const invalid = fixture(undefined, {aliasId: 123});
    const response = await readDecisionRecordDatabase(invalid.adapter, bounds);
    assert.equal(response.backendRequestIssued, false); assert.equal(invalid.calls.length, 0);
});

for (const mode of ['abort', 'unload', 'changed-instance']) test(`metadata preparation cannot dispatch after ${mode}`, async () => {
    const f = fixture(), controller = new AbortController();
    let release;
    f.adapter.getForeignObjectAsync = key => key.startsWith('system.adapter.')
        ? new Promise(resolve => {release = resolve;}) : Promise.resolve({common: {}});
    const result = readDecisionRecordDatabase(f.adapter, {...bounds, signal: controller.signal});
    if (mode === 'abort') controller.abort();
    if (mode === 'unload') f.adapter.unloading = true;
    if (mode === 'changed-instance') f.adapter.config.historyInstance = 'sql.1';
    release({native: {dbtype: 'mysql', dbname: 'iobroker'}});
    const response = await result;
    assert.equal(response.backendRequestIssued, false);
    assert.equal(response.backendCompletionObserved, false);
    assert.match(response.localNotIssuedEvidence, /no SQL transport/);
    assert.equal(f.calls.length, 0);
});

test('unavailable/unsafe configuration fails closed without exposing arbitrary object errors', async () => {
    const variants = [null, {}, {native: {dbtype: 'unknown'}}, {native: {dbtype: 'mysql', dbname: 'bad;name'}}];
    for (const value of variants) {
        const f = fixture(); f.adapter.getForeignObjectAsync = async () => value;
        const response = await readDecisionRecordDatabase(f.adapter, bounds);
        assert.equal(response.backendRequestIssued, false); assert.equal(f.calls.length, 0);
    }
    const f = fixture();
    f.adapter.getForeignObjectAsync = async () => {throw new Error('private-connection-secret');};
    const response = await readDecisionRecordDatabase(f.adapter, bounds);
    assert.equal(response.backendRequestIssued, false);
    assert.doesNotMatch(JSON.stringify(response), /private-connection-secret/);
});

test('abort after dispatch waits for actual callback; error callback proves completion, not storage', async () => {
    const f = fixture(), controller = new AbortController(); let complete;
    f.adapter.sendTo = (instance, command, sql, callback) => {complete = callback;};
    let settled = false;
    const reading = readDecisionRecordDatabase(f.adapter, {...bounds, signal: controller.signal})
        .then(value => {settled = true; return value;});
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(); await Promise.resolve();
    assert.equal(settled, false);
    complete({error: 'read denied', result: null});
    const response = await reading;
    assert.equal(response.error, 'read denied');
    assert.equal(response.backendCompletionObserved, true);
    assert.equal(response.backendRequestIssued, true);
    assert.equal(response.result, null);
});

test('a transport throw is never presented as proof that dispatch did not happen', async () => {
    const f = fixture(); f.adapter.sendTo = () => {throw new Error('transport interrupted');};
    await assert.rejects(readDecisionRecordDatabase(f.adapter, bounds), /transport interrupted/);
});

test('single SELECT executes against local SQLite with exact identity, type, inclusive bounds and LIMIT', t => {
    let DatabaseSync;
    try {({DatabaseSync} = require('node:sqlite'));} catch {return t.skip('node:sqlite unavailable on early Node 22');}
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE datapoints (id INTEGER PRIMARY KEY, name TEXT UNIQUE, type INTEGER);'
            + 'CREATE TABLE ts_string (id INTEGER, ts INTEGER, val TEXT);');
        const insertId = db.prepare('INSERT INTO datapoints VALUES (?, ?, ?)');
        insertId.run(1, id, 1); insertId.run(2, 'other.0', 1); insertId.run(3, 'number.0', 0);
        const insert = db.prepare('INSERT INTO ts_string VALUES (?, ?, ?)');
        for (const row of [[1,999,'before'],[1,1000,null],[1,2000,'original'],[1,3000,'end'],
            [1,3001,'after'],[2,2000,'wrong id'],[3,2000,'wrong type']]) insert.run(...row);
        const read = (name, limit = 32) => db.prepare(buildVerificationSelect({dbtype: 'sqlite'}, name,
            {...bounds, limit})).all().map(row => ({...row}));
        assert.deepEqual(read(id), [{ts:1000,val:null},{ts:2000,val:'original'},{ts:3000,val:'end'}]);
        assert.deepEqual(read(id, 1), [{ts:1000,val:null}]);
        assert.deepEqual(read('number.0'), []); assert.deepEqual(read('absent.0'), []);
    } finally {db.close();}
});
