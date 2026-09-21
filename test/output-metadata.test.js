'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {OutputMetadata} = require('../lib/output-metadata');

const target = 'sunenergyxt500.0.heads.1.control.GS';
function fixture(config = {}) {
    const states = new Map();
    const objects = new Map([
        [target, {type: 'state', common: {type: 'number', write: true, unit: 'W'}}],
        ['system.adapter.sunenergyxt500.0', {common: {enabled: true}, native: {controlMode: 'off', head1Host: 'configured-device'}}]
    ]);
    const adapter = {
        namespace: 'ems.0', config: {batterySetpointId: target, ...config},
        allowedForeignWriteIds: new Set(), zeroOnlyForeignWriteIds: new Set(),
        getForeignObjectAsync: async id => objects.get(id),
        subscribeForeignObjectsAsync: async () => {},
        getCachedState: id => states.get(id),
        setCompatState: async (id, val) => states.set(id, {val, ack: true}),
        log: {warn() {}}
    };
    return {adapter, states, objects, metadata: new OutputMetadata(adapter),
        ready: () => states.get('ems.0.Devices.Battery.DriverReady')?.val};
}

test('valid direct GS target is allowlisted only with external manual driver mode', async () => {
    const f = fixture();
    await f.metadata.refresh();
    assert.equal(f.ready(), true);
    assert.equal(f.adapter.allowedForeignWriteIds.has(target), true);
    assert.ok(f.metadata.watched.has('system.adapter.sunenergyxt500.0'));
    assert.equal(f.states.get('ems.0.Devices.Battery.SingleHeadVerified').val, true);
});

for (const change of ['controller', 'disabled', 'readonly', 'wrong-unit', 'duplicate', 'own-state'])
    test(`unsafe battery output metadata is rejected: ${change}`, async () => {
        const f = fixture();
        if (change === 'controller') f.objects.get('system.adapter.sunenergyxt500.0').native.controlMode = 'controller';
        if (change === 'disabled') f.objects.get('system.adapter.sunenergyxt500.0').common.enabled = false;
        if (change === 'readonly') f.objects.get(target).common.write = false;
        if (change === 'wrong-unit') f.objects.get(target).common.unit = 'kW';
        if (change === 'duplicate') f.adapter.config.heatingSetpointId = target;
        if (change === 'own-state') f.adapter.config.batterySetpointId = 'ems.0.Control.Targets.Battery_W';
        await f.metadata.refresh();
        assert.equal(f.ready(), false);
        assert.equal(f.adapter.allowedForeignWriteIds.size, 0);
    });

test('driver mode changes revoke readiness synchronously before asynchronous validation', async () => {
    const f = fixture();
    await f.metadata.refresh();
    f.objects.get('system.adapter.sunenergyxt500.0').native.controlMode = 'controller';
    f.metadata.changed('system.adapter.sunenergyxt500.0');
    assert.equal(f.ready(), false);
    await f.metadata.pending;
    assert.equal(f.ready(), false);
});

test('persisted old battery sink is only allowlisted for zero after mapping changes', async () => {
    const f = fixture({batterySetpointId: ''});
    f.states.set('ems.0.Devices.Battery.OutputOwned', {val: true});
    f.states.set('ems.0.Devices.Battery.OutputSetpointId', {val: target});
    await f.metadata.refresh();
    assert.equal(f.ready(), false);
    assert.equal(f.adapter.allowedForeignWriteIds.has(target), true);
    assert.equal(f.adapter.zeroOnlyForeignWriteIds.has(target), true);
});

test('invalid former sink is not allowed to write any arbitrary foreign state', async () => {
    const f = fixture({batterySetpointId: ''});
    f.states.set('ems.0.Devices.Battery.OutputOwned', {val: true});
    f.states.set('ems.0.Devices.Battery.OutputSetpointId', {val: 'unrelated.0.power'});
    await f.metadata.refresh();
    assert.equal(f.adapter.allowedForeignWriteIds.size, 0);
    assert.match(f.states.get('ems.0.Devices.Battery.DriverStatus').val, /manuelle Rueckgabe/);
});

test('missing optional outputs require no metadata subscriptions or actuator access', async () => {
    const f = fixture({batterySetpointId: ''});
    f.adapter.getForeignObjectAsync = async () => assert.fail('Unexpected metadata read');
    await f.metadata.refresh();
    assert.equal(f.ready(), false);
    assert.equal(f.metadata.watched.size, 0);
});

test('heating output must be distinct and numeric writable watts', async () => {
    const f = fixture({batterySetpointId: '', heatingSetpointId: 'modbus.5.power'});
    f.objects.set('modbus.5.power', {type: 'state', common: {type: 'number', write: true, unit: 'W'}});
    await f.metadata.refresh();
    assert.equal(f.states.get('ems.0.Devices.MyPV_Heating.DriverReady').val, true);
    assert.equal(f.adapter.allowedForeignWriteIds.has('modbus.5.power'), true);
});

for (const device of ['Battery', 'MyPV_Heating', 'MyPV_DHW']) {
    test(`invalid replacement never blocks recorded former ${device} zero`, async () => {
        const isBattery = device === 'Battery';
        const previous = isBattery ? target : 'modbus.5.oldPower';
        const key = isBattery ? 'batterySetpointId' : device === 'MyPV_DHW' ? 'dhwSetpointId' : 'heatingSetpointId';
        const f = fixture({batterySetpointId: '', [key]: 'invalid.0.readOnly'});
        f.objects.set(previous, {type: 'state', common: {type: 'number', write: true, unit: 'W'}});
        f.objects.set('invalid.0.readOnly', {type: 'state', common: {type: 'number', write: false}});
        f.states.set(`ems.0.Devices.${device}.OutputOwned`, {val: true});
        f.states.set(`ems.0.Devices.${device}.OutputSetpointId`, {val: previous});
        await f.metadata.refresh();
        assert.equal(f.states.get(`ems.0.Devices.${device}.DriverReady`).val, false);
        assert.equal(f.adapter.allowedForeignWriteIds.has(previous), true);
        assert.equal(f.adapter.zeroOnlyForeignWriteIds.has(previous), true);
        assert.equal(f.adapter.allowedForeignWriteIds.has('invalid.0.readOnly'), false);
    });
}

test('aggregate battery telemetry is not certified for multiple configured heads', async () => {
    const f = fixture();
    f.objects.get('system.adapter.sunenergyxt500.0').native.head2Host = 'second-device';
    await f.metadata.refresh();
    assert.equal(f.ready(), true);
    assert.equal(f.states.get('ems.0.Devices.Battery.SingleHeadVerified').val, false);
});

test('a GS object without a configured matching head is rejected', async () => {
    const f = fixture();
    f.objects.get('system.adapter.sunenergyxt500.0').native.head1Host = '';
    await f.metadata.refresh();
    assert.equal(f.ready(), false);
});

test('a newly assigned heater cannot take another still-owned heater output', async () => {
    const f = fixture({batterySetpointId: '', dhwSetpointId: 'modbus.5.power'});
    f.objects.set('modbus.5.power', {type: 'state', common: {type: 'number', write: true, unit: 'W'}});
    f.states.set('ems.0.Devices.MyPV_Heating.OutputOwned', {val: true});
    f.states.set('ems.0.Devices.MyPV_Heating.OutputSetpointId', {val: 'modbus.5.power'});
    await f.metadata.refresh();
    assert.equal(f.states.get('ems.0.Devices.MyPV_DHW.DriverReady').val, false);
    assert.equal(f.adapter.allowedForeignWriteIds.size, 0);
});

test('a SunEnergy GS watt target must never be interpreted as a heating output', async () => {
    const f = fixture({batterySetpointId: '', heatingSetpointId: target});
    await f.metadata.refresh();
    assert.equal(f.states.get('ems.0.Devices.MyPV_Heating.DriverReady').val, false);
    assert.equal(f.adapter.allowedForeignWriteIds.size, 0);
});
