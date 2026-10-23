'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {SourcePowerHistory, POLICY} = require('../lib/source-power-history');

function fixture(config = {}, options = {}) {
    const ids = ['javascript.0.pv', 'go-e.0.energy.power', 'go-e.1.energy.power', 'go-e.2.energy.power'];
    const old = {enabled: true, changesOnly: true, changesRelogInterval: '60', changesMinDelta: 100,
        debounce: '1000', debounceTime: 0, blockTime: 1000, retention: 7948800, storageType: '',
        customRetentionDuration: 365, disableSkippedValueLogging: false};
    const objects = new Map(ids.map((id, i) => [id, {type: 'state', common: {type: 'number',
        unit: i ? 'kW' : 'W', read: true, write: false,
        custom: {'sql.0': {...old}, 'history.0': {enabled: true, retention: 123}}}}]));
    const calls = [], published = new Map();
    let inFlight = 0, highWater = 0;
    const adapter = {namespace: 'ems.0', config: {historyInstance: 'sql.0', pvPowerId: ids[0],
        wb0PowerId: ids[1], wb1PowerId: ids[2], wb2PowerId: ids[3], ...config},
    getForeignObjectAsync: async id => structuredClone(objects.get(id)),
    compatSendTo(instance, command, message, callback) {
        calls.push({instance, command, message: structuredClone(message)});
        highWater = Math.max(highWater, ++inFlight);
        setImmediate(() => {
            Object.assign(objects.get(message.id).common.custom[instance], message.options);
            inFlight--;
            callback({success: true});
        });
    },
    queueCompatState: async () => {},
    setCompatState: (id, value, ack) => published.set(id, {value, ack}),
    setForeignStateAsync: () => assert.fail('history setup must not write an actuator or source'),
    extendForeignObjectAsync: () => assert.fail('use SQL message API only')};
    return {adapter, manager: new SourcePowerHistory(adapter, options), ids, objects, calls, published,
        highWater: () => highWater};
}

test('PV and all three wallboxes keep changes with 600-second unchanged replay; retention and other instances survive', async () => {
    const f = fixture();
    const before = structuredClone(f.objects);
    const result = await f.manager.initialize();
    assert.equal(result.status, 'complete');
    assert.equal(result.sources.length, 4);
    assert.ok(result.sources.every(source => source.status === 'configured'));
    assert.equal(f.highWater(), 1, 'SQL messages must remain sequential');
    assert.deepEqual(f.calls.map(call => call.message.id), f.ids);
    for (const call of f.calls) {
        assert.equal(call.command, 'enableHistory');
        assert.equal(call.instance, 'sql.0');
        const settings = f.objects.get(call.message.id).common.custom;
        assert.equal(settings['sql.0'].retention, 7948800);
        assert.equal(settings['sql.0'].customRetentionDuration, 365);
        assert.equal(settings['sql.0'].storageType, '');
        assert.deepEqual(settings['history.0'], before.get(call.message.id).common.custom['history.0']);
        // These are the actual ioBroker.sql filters that could erase a short
        // 0 -> positive -> 0 pulse or a PV crossing smaller than the old 100 W.
        assert.equal(call.message.options.changesOnly, true);
        assert.equal(call.message.options.changesRelogInterval, 600);
        for (const key of ['changesMinDelta', 'blockTime', 'debounceTime', 'debounce']) assert.equal(call.message.options[key], 0);
        assert.equal(call.message.options.ignoreZero, false);
        assert.equal(call.message.options.disableSkippedValueLogging, true);
        for (const key of ['ignoreBelowNumber', 'ignoreAboveNumber']) assert.equal(call.message.options[key], '');
        assert.equal('retention' in call.message.options, false);
    }
    const diagnostic = JSON.parse(f.published.get('ems.0.Debug.SourcePowerHistory').value);
    assert.equal(diagnostic.status, 'complete');
    assert.equal(f.published.get('ems.0.Debug.SourcePowerHistory').ack, true);
});

test('matching persisted policy is idempotent across restarts and concurrent initialize callers', async () => {
    const f = fixture();
    for (const object of f.objects.values()) Object.assign(object.common.custom['sql.0'], POLICY);
    assert.equal(f.manager.initialize(), f.manager.initialize());
    const result = await f.manager.initialize();
    assert.ok(result.sources.every(s => s.status === 'already-configured'));
    assert.equal(f.calls.length, 0);
});

test('uses the configured SQL instance and native mapping precedence including legacy JSON fallback', async () => {
    const f = fixture({historyInstance: '', pvPowerId: '', wb0PowerId: '', wb1PowerId: '', wb2PowerId: '',
        dataPointMapJson: JSON.stringify({DP_SQL_INSTANCE: 'sql.2', DP_PV_POWER: 'javascript.0.pv'})});
    f.objects.get(f.ids[0]).common.custom['sql.2'] = {enabled: true};
    await f.manager.initialize();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].instance, 'sql.2');
    assert.equal(f.objects.get(f.ids[0]).common.custom['sql.0'].changesRelogInterval, '60');
});

for (const config of [{sourcePowerHistoryEnabled: false}, {historyInstance: 'history.0'}, {historyInstance: 'sql.0.bad'}]) {
    test(`explicit opt-out or non-SQL backend produces no reads/writes: ${JSON.stringify(config)}`, async () => {
        const f = fixture(config);
        f.adapter.getForeignObjectAsync = () => assert.fail('no metadata read expected');
        await f.manager.initialize();
        assert.equal(f.calls.length, 0);
    });
}

test('never enables absent or disabled history and skips unsafe types, aliases and counters', async () => {
    for (const mutate of [o => {delete o.common.custom['sql.0'];},
        o => {o.common.custom['sql.0'].enabled = false;}, o => {o.common.type = 'string';},
        o => {o.common.write = true;}, o => {o.common.read = false;}, o => {o.common.unit = '%';},
        o => {o.common.alias = {id: 'other'};}, o => {o.common.custom['sql.0'].aliasId = 'other';},
        o => {o.common.custom['sql.0'].counter = true;}, o => {o.common.custom['sql.0'].storageType = 'Boolean';}]) {
        const f = fixture();
        for (const object of f.objects.values()) mutate(object);
        await f.manager.initialize();
        assert.equal(f.calls.length, 0);
    }
});

test('only explicit configured source IDs are considered; duplicates are configured once', async () => {
    const f = fixture({wb0PowerId: 'javascript.0.pv', wb1PowerId: 'ems.0.Debug.Shadow.DecisionRecord',
        wb2PowerId: 'go-e.*.energy.power'});
    await f.manager.initialize();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].message.id, f.ids[0]);
    assert.equal(f.objects.get(f.ids[1]).common.custom['sql.0'].changesRelogInterval, '60');
});

test('SQL error aborts the remaining sources without retries or false success', async () => {
    const f = fixture();
    f.adapter.compatSendTo = (instance, command, message, callback) => {
        f.calls.push({message}); callback({error: 'not available'});
    };
    const result = await f.manager.initialize();
    assert.equal(f.calls.length, 1);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.sources[0].status, 'sql-rejected');
});

test('successful message without metadata change fails readback verification', async () => {
    const f = fixture();
    f.adapter.compatSendTo = (instance, command, message, callback) => callback({success: true});
    const result = await f.manager.initialize();
    assert.equal(result.status, 'incomplete');
    assert.equal(result.sources[0].status, 'verification-failed');
});

test('metadata read failures are bounded and do not configure any source', async () => {
    const f = fixture();
    f.adapter.getForeignObjectAsync = async () => {throw new Error('unavailable');};
    const result = await f.manager.initialize();
    assert.equal(result.sources[0].status, 'read-error');
    assert.equal(f.calls.length, 0);
});

test('unknown SQL completion times out once; a late callback cannot start more setup', async () => {
    const f = fixture({}, {timeoutMs: 10}); let late;
    f.adapter.compatSendTo = (instance, command, message, callback) => {f.calls.push({message}); late = callback;};
    const result = await f.manager.initialize();
    assert.equal(result.status, 'incomplete');
    assert.equal(result.sources[0].status, 'timeout');
    late({success: true});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.parse(f.published.get('ems.0.Debug.SourcePowerHistory').value).status, 'incomplete');
});

test('stop cancels optional setup and suppresses writes and success after unload', async () => {
    const f = fixture(); let late;
    f.adapter.getForeignObjectAsync = () => new Promise(resolve => {late = resolve;});
    const work = f.manager.initialize();
    f.adapter.unloading = true;
    f.manager.stop();
    await work;
    late(f.objects.get(f.ids[0]));
    assert.equal(f.calls.length, 0);
    assert.equal(f.published.size, 0);
});
