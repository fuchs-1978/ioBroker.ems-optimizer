'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ShadowHistory = require('../lib/shadow-history');

const ROOT = 'ems-optimizer.0.Debug.Shadow.';
const series = [
    ['Targets.Battery_W', 'number'], ['Actuals.Battery_W', 'number'],
    ['Targets.Wallbox0_A', 'number'], ['Wallbox0.StartDelayRemaining_s', 'number'],
    ['Valid', 'boolean'], ['SelectedWallbox', 'number'], ['Targets.HeatPumpModeValue', 'number'],
    ['Targets.HeatPumpMode', 'string'], ['Battery.Summary', 'string']
];

function fixture({instance = 'sql.0', timeoutMs = 30} = {}) {
    const objects = new Map(series.map(([id, type]) => [ROOT + id, {
        type: 'state', common: {type, read: true, write: false}
    }]));
    const legacyId = 'ems-optimizer.0.Actual.PV_W';
    objects.set(legacyId, {type: 'state', common: {type: 'number', custom: {
        'sql.0': {enabled: true, retention: 7776000}
    }}});
    const states = new Map();
    const requests = [];
    const writes = [];
    const definitions = new Map();
    const adapter = {
        namespace: 'ems-optimizer.0', config: {historyInstance: instance}, unloading: false,
        objectPromises: new Map(),
        getForeignObjectAsync: async id => structuredClone(objects.get(id)),
        queueCompatState: async (id, val, common) => {
            definitions.set(id, common);
            if (!states.has(id)) states.set(id, val);
        },
        setCompatState: async (id, val, ack) => {
            assert.equal(ack, true);
            assert.ok(id.startsWith(ROOT + 'SQL.'), `Unexpected state write: ${id}`);
            states.set(id, val);
            writes.push({id, val});
        },
        compatSendTo: (target, command, message, callback) => {
            requests.push({target, command, message, callback});
            assert.equal(command, 'enableHistory');
            const object = objects.get(message.id);
            object.common.custom ||= {};
            object.common.custom[target] = {...object.common.custom[target], ...message.options};
            callback({success: true});
        }
    };
    const history = new ShadowHistory(adapter, {timeoutMs});
    const ids = series.map(([id]) => ROOT + id);
    const status = key => states.get(ROOT + 'SQL.' + key);
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    return {history, adapter, objects, states, requests, writes, definitions, ids, status, flush, legacyId};
}

test('configures only requested shadow scalar series and confirms exact 24h options from persisted metadata', async () => {
    const f = fixture();
    f.objects.get(f.ids[0]).common.custom = {'history.0': {enabled: true, retention: 12345}};
    const legacy = structuredClone(f.objects.get(f.legacyId));
    assert.equal(await f.history.initialize([...f.ids, f.ids[0]]), true);
    assert.equal(f.requests.length, f.ids.length);
    assert.equal(f.status('Enabled'), true);
    assert.equal(f.status('ConfiguredCount'), f.ids.length);
    assert.equal(f.status('Retention_s'), 86400);
    assert.equal(f.status('Instance'), 'sql.0');
    assert.ok(f.status('LastConfigured') > 0);
    assert.match(f.status('Status'), /24 h.*SQL-Loeschpuffer/);
    assert.deepEqual(f.objects.get(f.legacyId), legacy);
    assert.deepEqual(f.objects.get(f.ids[0]).common.custom['history.0'], {enabled: true, retention: 12345});
    for (const {target, message} of f.requests) {
        assert.equal(target, 'sql.0');
        const o = message.options;
        assert.equal(o.retention, 86400);
        assert.equal(o.changesOnly, true);
        assert.equal(o.debounce, 0);
        assert.equal(o.debounceTime, 0);
        assert.equal(o.changesRelogInterval, 60);
        assert.equal(o.disableSkippedValueLogging, true);
        assert.equal(o.ignoreZero, false);
        assert.equal(o.ignoreBelowZero, false);
        assert.equal(o.changesMinDelta, 0);
        assert.equal(o.aliasId, '');
    }
    assert.equal(f.definitions.size, 6);
    for (const common of f.definitions.values()) assert.equal(common.write, false);
});

test('limits continuous power samples to 10s while preserving brief validity, mode and reason transitions', async () => {
    const f = fixture();
    await f.history.initialize(f.ids);
    const blocks = Object.fromEntries(f.requests.map(r => [r.message.id.slice(ROOT.length), r.message.options.blockTime]));
    assert.deepEqual(blocks, {
        'Targets.Battery_W': 10000, 'Actuals.Battery_W': 10000, 'Targets.Wallbox0_A': 10000,
        'Wallbox0.StartDelayRemaining_s': 10000, 'Valid': 0, 'SelectedWallbox': 0,
        'Targets.HeatPumpModeValue': 0, 'Targets.HeatPumpMode': 0, 'Battery.Summary': 0
    });
});

test('never enables JSON, rings, SQL diagnostics, foreign states or a non-scalar state', async () => {
    const f = fixture();
    f.objects.set(ROOT + 'LargeObject', {type: 'state', common: {type: 'object'}});
    f.objects.set(ROOT + 'HiddenJSON', {type: 'state', common: {type: 'string', role: 'json'}});
    f.objects.set(ROOT + 'TypedAsText', {type: 'state', common: {type: 'string', role: 'json'}});
    f.objects.set(ROOT + 'Channel', {type: 'channel', common: {type: 'number'}});
    const blocked = [ROOT + 'Snapshot_JSON', ROOT + 'PowerTrace', ROOT + 'Events_JSON', ROOT + 'SQL.Enabled',
        'other.0.Debug.Shadow.Targets.Battery_W', f.legacyId, ROOT + 'LargeObject', ROOT + 'HiddenJSON',
        ROOT + 'TypedAsText', ROOT + 'Channel'];
    assert.equal(await f.history.initialize([...blocked, f.ids[0]]), false);
    assert.deepEqual(f.requests.map(r => r.message.id), [f.ids[0]]);
    assert.equal(f.status('ConfiguredCount'), 1);
    assert.equal(f.status('Enabled'), false);
});

test('empty series and non-SQL instances cannot report a successful SQL configuration', async () => {
    for (const instance of ['history.0', 'influxdb.0', 'sql.0.extra', '', 'sql']) {
        const f = fixture({instance});
        f.states.set(ROOT + 'SQL.Enabled', true);
        f.states.set(ROOT + 'SQL.LastConfigured', 12345);
        assert.equal(await f.history.initialize(f.ids), false);
        assert.equal(f.requests.length, 0);
        assert.equal(f.status('Enabled'), false);
        assert.equal(f.status('LastConfigured'), 0);
        assert.match(f.status('Status'), /Keine SQL-Instanz/);
    }
    const f = fixture();
    assert.equal(await f.history.initialize([]), false);
    assert.equal(f.status('Enabled'), false);
});

test('SQL failures and ambiguous replies never count as confirmed setup', async () => {
    for (const response of [{error: 'offline'}, {}, null, {success: true, error: 'not persisted'}]) {
        const f = fixture();
        f.adapter.compatSendTo = (instance, command, message, callback) => callback(response);
        assert.equal(await f.history.initialize([f.ids[0]]), false);
        assert.equal(f.status('Enabled'), false);
        assert.equal(f.status('ConfiguredCount'), 0);
        assert.equal(f.status('LastConfigured'), 0);
    }
});

test('success callback without matching persisted SQL configuration remains unconfirmed', async () => {
    const f = fixture();
    f.adapter.compatSendTo = (instance, command, message, callback) => callback({success: true});
    assert.equal(await f.history.initialize([f.ids[0]]), false);
    assert.equal(f.status('Enabled'), false);
    assert.equal(f.status('ConfiguredCount'), 0);
});

test('missing SQL replies time out and late replies cannot turn failure into success', async () => {
    const f = fixture({timeoutMs: 5});
    let callback;
    f.adapter.compatSendTo = (instance, command, message, cb) => { callback = cb; };
    assert.equal(await f.history.initialize([f.ids[0]]), false);
    assert.match(f.status('Status'), /SQL-Antwort fehlt/);
    assert.equal(f.history.pending.size, 0);
    callback({success: true});
    await f.flush();
    assert.equal(f.status('Enabled'), false);
});

test('waits for target object creation before metadata lookup and SQL enablement', async () => {
    const f = fixture();
    let ready;
    const id = f.ids[0];
    f.adapter.objectPromises.set(id, new Promise(resolve => { ready = resolve; }));
    const pending = f.history.initialize([id]);
    await f.flush();
    assert.equal(f.requests.length, 0);
    ready();
    assert.equal(await pending, true);
    assert.equal(f.requests.length, 1);
});

test('object creation, metadata and synchronous messaging errors fail safely', async () => {
    for (const failure of ['creation', 'metadata', 'send']) {
        const f = fixture();
        if (failure === 'creation') {
            const creation = Promise.reject(new Error('creation unavailable'));
            void creation.catch(() => {});
            f.adapter.objectPromises.set(f.ids[0], creation);
        }
        if (failure === 'metadata') f.adapter.getForeignObjectAsync = async () => { throw new Error('offline'); };
        if (failure === 'send') f.adapter.compatSendTo = () => { throw new Error('offline'); };
        assert.equal(await f.history.initialize([f.ids[0]]), false);
        assert.equal(f.status('Enabled'), false);
        assert.equal(f.status('LastConfigured'), 0);
    }
});

test('stop cancels pending calls immediately and prevents all late status writes', async () => {
    const f = fixture({timeoutMs: 10000});
    let callback;
    f.adapter.compatSendTo = (instance, command, message, cb) => { callback = cb; };
    const pending = f.history.initialize([f.ids[0]]);
    await f.flush();
    assert.equal(typeof callback, 'function');
    f.history.stop();
    const written = f.writes.length;
    assert.equal(await pending, false);
    callback({success: true});
    await f.flush();
    assert.equal(f.writes.length, written);
    assert.equal(f.history.pending.size, 0);
    assert.equal(f.status('Enabled'), false);
});

test('adapter unload prevents new history calls and ignores outstanding replies', async () => {
    const f = fixture();
    f.adapter.compatSendTo = (instance, command, message, callback) => {
        f.adapter.unloading = true;
        callback({success: true});
    };
    assert.equal(await f.history.initialize(f.ids), false);
    assert.equal(f.status('Enabled'), false);
});

test('metadata timeout is bounded and missing state storage cannot throw into control startup', async () => {
    const f = fixture({timeoutMs: 5});
    f.adapter.getForeignObjectAsync = () => new Promise(() => {});
    assert.equal(await f.history.initialize([f.ids[0]]), false);
    assert.equal(f.requests.length, 0);
    assert.match(f.status('Status'), /SQL-Antwort fehlt/);
    const failed = fixture();
    failed.adapter.queueCompatState = async () => { throw new Error('database unavailable'); };
    assert.equal(await failed.history.initialize(failed.ids), false);
    assert.equal(failed.requests.length, 0);
});
