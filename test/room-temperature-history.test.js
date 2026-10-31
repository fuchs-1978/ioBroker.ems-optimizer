'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {RoomTemperatureHistory, roomSources} = require('../lib/room-temperature-history');
const rooms = [{name: 'Living', heatingType: 'hydronic', actualId: 'knx.0.living.actual', setpointId: 'knx.0.living.target'},
    {name: 'Electric', heatingType: 'electric', actualId: 'knx.0.electric.actual', setpointId: 'knx.0.electric.target'}];
const oldSettings = {enabled: true, retention: '1209600', changesOnly: true, changesRelogInterval: '60',
    debounce: '1000', changesMinDelta: '0', storageType: '', aliasId: '', disableSkippedValueLogging: false};
function fixture(config = {}) {
    const objects = new Map(), cache = new Map(), calls = [], writes = [], timers = new Map(); let timer = 0;
    for (const room of rooms) for (const key of ['actualId', 'setpointId']) objects.set(room[key],
        {type: 'state', common: {type: 'number', unit: '°C', custom: {'sql.0': {...oldSettings}}}});
    const adapter = {namespace: 'ems.0', config: {roomHistoryEnabled: true, roomHistoryRooms: rooms,
        roomHistoryRetentionDays: 90, historyInstance: 'sql.0', ...config},
    setTimeout: (fn, delay) => {timers.set(++timer, {fn, delay}); return timer;}, clearTimeout: id => timers.delete(id),
    getCachedState: id => cache.get(id),
    getForeignObjectAsync: async id => {calls.push({read: id}); return structuredClone(objects.get(id));},
    queueCompatState: async (id, val) => {if (!cache.has(id)) cache.set(id, {val});},
    setCompatState: async (id, val) => {writes.push({id, val}); cache.set(id, {val});},
    compatSendTo(instance, command, message, callback) {
        calls.push({instance, command, message});
        objects.get(message.id).common.custom[instance] = structuredClone(message.options);
        callback({success: true});
    }};
    const manager = new RoomTemperatureHistory(adapter, {now: () => 1793436000000, timeoutMs: 10});
    return {adapter, manager, objects, cache, calls, writes, timers,
        report: () => JSON.parse(cache.get(manager.id)?.val || 'null')};
}
test('extend only retention on existing numeric sources, preserving all original settings and electric classification', async () => {
    const h = fixture(); await h.manager.initialize();
    const writes = h.calls.filter(call => call.command);
    assert.equal(writes.length, 4);
    for (const call of writes) {
        assert.equal(call.command, 'enableHistory');
        assert.deepEqual(call.message.options, {...oldSettings, retention: 7776000});
        assert.ok(rooms.some(room => [room.actualId, room.setpointId].includes(call.message.id)));
    }
    assert.equal(h.report().sources.filter(source => source.status === 'verified-extended').length, 4);
    assert.equal(h.report().rooms[1].heatingType, 'electric');
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.RoomHistory.')));
    assert.ok(h.calls.every(call => !call.command || call.message.id.startsWith('knx.0.')));
    const count = h.calls.length; await h.manager.tick(); assert.equal(h.calls.length, count);
    h.manager.stop(); assert.equal(h.timers.size, 0);
});
test('longer and unlimited original histories are never shortened', async () => {
    const h = fixture();
    for (const [i, object] of [...h.objects.values()].entries()) object.common.custom['sql.0'].retention = i % 2 ? 0 : '31536000';
    await h.manager.initialize();
    assert.equal(h.calls.filter(call => call.command).length, 0);
    assert.ok(h.report().sources.every(source => source.status === 'verified-existing')); h.manager.stop();
});
test('disabled manager, empty or invalid maps do not change SQL or discover arbitrary sources', async () => {
    for (const config of [{roomHistoryEnabled: false}, {roomHistoryRooms: []},
        {roomHistoryRooms: [{...rooms[0], actualId: 'knx.0.*'}]}, {roomHistoryRetentionDays: 1}]) {
        const h = fixture(config); await h.manager.initialize();
        assert.equal(h.calls.length, 0); h.manager.stop();
    }
    for (const source of ['system.adapter.knx.0', 'ems.0.Config.Test', rooms[0].setpointId])
        assert.throws(() => roomSources([{...rooms[0], actualId: source}], 'ems.0'));
});
test('unrecorded, unsupported or unknown-retention objects are reported without enabling new histories', async () => {
    const h = fixture(), objects = [...h.objects.values()];
    objects[0].common.custom['sql.0'].enabled = false;
    objects[1].common.unit = '°F'; objects[2].common.type = 'string';
    objects[3].common.custom['sql.0'].retention = '';
    await h.manager.initialize(); assert.equal(h.calls.filter(call => call.command).length, 0);
    assert.deepEqual(h.report().sources.map(source => source.status),
        ['not-already-recorded', 'invalid-temperature-object', 'invalid-temperature-object', 'unknown-retention']); h.manager.stop();
});
test('SQL errors and changed unrelated settings remain unconfirmed and are not automatically retried', async () => {
    for (const mode of ['error', 'mismatch']) {
        const h = fixture();
        h.adapter.compatSendTo = (instance, command, message, callback) => {
            h.calls.push({command});
            if (mode === 'mismatch') h.objects.get(message.id).common.custom[instance] = {...message.options, debounce: '0'};
            callback({success: mode !== 'error'});
        };
        await h.manager.initialize();
        assert.ok(h.report().sources.every(source => source.status === (mode === 'error' ? 'update-unconfirmed' : 'settings-unconfirmed')));
        const count = h.calls.length; await h.manager.tick(); assert.equal(h.calls.length, count); h.manager.stop();
    }
});
test('runtime room mapping can be supplied without embedding installation-specific IDs in the code', async () => {
    const h = fixture({roomHistoryRooms: []}); await h.manager.initialize();
    h.cache.set(h.manager.configId, {val: JSON.stringify(rooms), ack: false});
    await h.manager.tick(); assert.equal(h.report().rooms.length, 2);
    h.cache.set(h.manager.configId, {val: '[invalid'});
    const count = h.calls.length; await h.manager.tick(); assert.equal(h.calls.length, count);
    h.cache.set(h.manager.configId, {val: JSON.stringify(rooms)});
    await h.manager.tick(); assert.ok(h.calls.length > count);
    h.cache.set(h.manager.configId, {val: '[]'}); await h.manager.tick();
    h.cache.set(h.manager.configId, {val: JSON.stringify(rooms)}); await h.manager.tick();
    assert.match(h.cache.get('ems.0.Debug.RoomHistory.Status').val, /4\/4/); h.manager.stop();
});
test('stop during a pending SQL request prevents all follow-up metadata writes and publications', async () => {
    const h = fixture(); let entered;
    const started = new Promise(resolve => {entered = resolve;});
    h.adapter.compatSendTo = () => entered();
    const initializing = h.manager.initialize(); await started; h.manager.stop(); await initializing;
    assert.equal(h.report(), null); assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 0);
});

test('failed status publication cannot repeat uncertain metadata updates', async () => {
    const h = fixture();
    // Resolve requests as errors without relying on backend completion.
    h.adapter.compatSendTo = (instance, command, message, callback) => {
        h.calls.push({command}); callback({error: 'unknown completion'});
    };
    h.adapter.setCompatState = async () => {throw new Error('status unavailable');};
    await assert.rejects(h.manager.initialize(), /status unavailable/);
    const count = h.calls.length;
    await h.manager.tick(); assert.equal(h.calls.length, count); h.manager.stop();
});
