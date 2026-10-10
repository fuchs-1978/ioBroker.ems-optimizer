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

function headsFixture(count = 3, config = {}) {
    const f = fixture({batteryDispatchMode: 'sunenergy-heads', batterySunEnergyInstance: 'sunenergyxt500.0',
        batteryHeadCount: count, ...config});
    for (let index = 1; index <= count; index++) {
        f.objects.get('system.adapter.sunenergyxt500.0').native[`head${index}Host`] = `configured-${index}`;
        f.objects.set(`sunenergyxt500.0.heads.${index}.control.GS`,
            {type: 'state', common: {type: 'number', write: true, unit: 'W'}});
    }
    return f;
}

for (const count of [1, 2, 3]) {
    test(`${count} explicitly declared SunEnergy heads are verified atomically`, async () => {
        const f = headsFixture(count);
        await f.metadata.refresh();
        assert.equal(f.ready(), true);
        assert.equal(f.states.get('ems.0.Devices.Battery.HeadsVerified').val, true);
        assert.equal(f.states.get('ems.0.Devices.Battery.SingleHeadVerified').val, count === 1);
        assert.deepEqual([...f.adapter.allowedForeignWriteIds].sort(), Array.from({length: count}, (_, index) =>
            `sunenergyxt500.0.heads.${index + 1}.control.GS`));
    });
}

for (const change of ['undeclared-head', 'missing-head', 'head-gap', 'readonly-last', 'last-unit', 'collision',
    'controller', 'device-mode', 'disabled']) {
    test(`multihead metadata fails closed for ${change}`, async () => {
        const f = headsFixture(2);
        const driver = f.objects.get('system.adapter.sunenergyxt500.0');
        if (change === 'undeclared-head') driver.native.head3Host = 'third';
        if (change === 'missing-head') driver.native.head2Host = '';
        if (change === 'head-gap') { driver.native.head2Host = ''; driver.native.head3Host = 'third'; }
        if (change === 'readonly-last') f.objects.get('sunenergyxt500.0.heads.2.control.GS').common.write = false;
        if (change === 'last-unit') f.objects.get('sunenergyxt500.0.heads.2.control.GS').common.unit = 'kW';
        if (change === 'collision') f.adapter.config.wb1AmpereOutputId = 'sunenergyxt500.0.heads.2.control.GS';
        if (change === 'controller') driver.native.controlMode = 'controller';
        if (change === 'device-mode') driver.native.controlMode = 'device';
        if (change === 'disabled') driver.common.enabled = false;
        await f.metadata.refresh();
        assert.equal(f.ready(), false);
        assert.equal(f.states.get('ems.0.Devices.Battery.HeadsVerified').val, false);
        assert.equal(f.adapter.allowedForeignWriteIds.size, 0, 'no partially validated head output');
    });
}

test('multihead metadata is synchronously revoked before a driver recheck', async () => {
    const f = headsFixture(3);
    await f.metadata.refresh();
    f.objects.get('system.adapter.sunenergyxt500.0').native.controlMode = 'controller';
    f.metadata.changed('system.adapter.sunenergyxt500.0');
    assert.equal(f.ready(), false);
    assert.equal(f.states.get('ems.0.Devices.Battery.HeadsVerified').val, false);
    await f.metadata.pending;
    assert.equal(f.ready(), false);
});

function ownedHead(index, instance = 'sunenergyxt500.0') {
    return {index, setpointId: `${instance}.heads.${index}.control.GS`, owned: true, commandW: 600,
        commandAt: 1000, reservedChargeW: 600, unobservedCommandW: 600, unobservedSince: 1000};
}

test('former multihead ownership remains zero-only when switching back to the legacy mode', async () => {
    const f = headsFixture(3, {batteryDispatchMode: 'single', batterySetpointId: ''});
    f.states.set('ems.0.Devices.Battery.HeadOwnership_JSON',
        {val: JSON.stringify({version: 1, heads: [ownedHead(1), ownedHead(2), ownedHead(3)]})});
    await f.metadata.refresh();
    assert.equal(f.ready(), false);
    assert.equal(f.adapter.allowedForeignWriteIds.size, 3);
    assert.equal(f.adapter.zeroOnlyForeignWriteIds.size, 3);
});

test('a former and current three-head ownership ledger is retained entirely for safe cleanup', async () => {
    const f = headsFixture(3, {batteryDispatchMode: 'single', batterySetpointId: ''});
    const former = [1, 2, 3].map(index => ownedHead(index, 'sunenergyxt500.1'));
    for (const head of former) f.objects.set(head.setpointId,
        {type: 'state', common: {type: 'number', write: true, unit: 'W'}});
    f.states.set('ems.0.Devices.Battery.HeadOwnership_JSON',
        {val: JSON.stringify({version: 1, heads: [...[1, 2, 3].map(index => ownedHead(index)), ...former]})});
    await f.metadata.refresh();
    assert.equal(f.ready(), false);
    assert.equal(f.adapter.allowedForeignWriteIds.size, 6);
    assert.equal(f.adapter.zeroOnlyForeignWriteIds.size, 6);
});

test('a lost owned flag cannot discard a former head with an unresolved command or reserve', async () => {
    for (const highwater of [{commandW: 0, reservedChargeW: 300, unobservedCommandW: 0},
        {commandW: 0, reservedChargeW: 0, unobservedCommandW: -300},
        {commandW: -300, reservedChargeW: 0, unobservedCommandW: 0}]) {
        const f = headsFixture(1, {batteryDispatchMode: 'single-head', batterySetpointId: ''});
        f.states.set('ems.0.Devices.Battery.HeadOwnership_JSON',
            {val: JSON.stringify({version: 1, heads: [{...ownedHead(1), owned: false, ...highwater}]})});
        await f.metadata.refresh();
        assert.equal(f.adapter.allowedForeignWriteIds.has(target), true);
        assert.equal(f.adapter.zeroOnlyForeignWriteIds.has(target), true);
    }
});

test('reducing head count retains the removed owned head for zero despite driver mismatch', async () => {
    const f = headsFixture(3);
    f.adapter.config.batteryHeadCount = 2;
    f.states.set('ems.0.Devices.Battery.HeadOwnership_JSON',
        {val: JSON.stringify({version: 1, heads: [ownedHead(1), ownedHead(2), ownedHead(3)]})});
    await f.metadata.refresh();
    assert.equal(f.ready(), false);
    assert.equal(f.adapter.allowedForeignWriteIds.size, 3);
    assert.equal(f.adapter.zeroOnlyForeignWriteIds.size, 3);
});

test('invalid replacement instance still permits only previously owned head zeros', async () => {
    const f = headsFixture(2, {batterySunEnergyInstance: 'invalid.0'});
    f.states.set('ems.0.Devices.Battery.HeadOwnership_JSON',
        {val: JSON.stringify({version: 1, heads: [ownedHead(1), ownedHead(2)]})});
    await f.metadata.refresh();
    assert.equal(f.ready(), false);
    assert.equal(f.adapter.allowedForeignWriteIds.size, 2);
    assert.equal(f.adapter.zeroOnlyForeignWriteIds.size, 2);
});

for (const value of ['{bad-json', JSON.stringify({version: 1, heads: [{...ownedHead(1), setpointId: 'evil.0.power'}]}),
    JSON.stringify({version: 1, heads: [ownedHead(1), ownedHead(1)]})]) {
    test('corrupt inherited multihead ownership never authorizes a new production output', async () => {
        const f = headsFixture(1);
        f.states.set('ems.0.Devices.Battery.HeadOwnership_JSON', {val: value});
        await f.metadata.refresh();
        assert.equal(f.ready(), false);
        assert.equal(f.adapter.allowedForeignWriteIds.size, 0);
        assert.match(f.states.get('ems.0.Devices.Battery.DriverStatus').val, /Besitzliste.*manuelle Rueckgabe/);
    });
}

test('unknown storage dispatch mode cannot fall back silently to the live legacy output', async () => {
    const f = fixture({batteryDispatchMode: 'sunenergy-heads-typo'});
    await f.metadata.refresh();
    assert.equal(f.ready(), false);
    assert.equal(f.adapter.allowedForeignWriteIds.size, 0);
    assert.match(f.states.get('ems.0.Devices.Battery.DriverStatus').val, /Unbekannter Speicher-Ausgabemodus/);
});

test('the explicit Admin single-head default retains the checked legacy GS interface', async () => {
    const f = fixture({batteryDispatchMode: 'single-head'});
    await f.metadata.refresh();
    assert.equal(f.ready(), true);
    assert.equal(f.states.get('ems.0.Devices.Battery.SingleHeadVerified').val, true);
    assert.equal(f.adapter.allowedForeignWriteIds.has(target), true);
});
