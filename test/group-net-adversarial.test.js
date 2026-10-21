'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {evaluateRuntimeGroup, checkGroupCommand} = require('../lib/grid-operator-runtime');

const NOW = 2000000;
const NS = 'ems.0';
const AC1 = 'sunenergyxt500.0.heads.1.grid.GP';
const OLD_GS = 'sunenergyxt500.0.heads.3.control.GS';
const OLD_AC = 'sunenergyxt500.0.heads.3.grid.GP';

function fixture() {
    const states = new Map();
    const put = (id, val, extra = {}) => states.set(id, {val, ts: NOW, ack: true, q: 0, ...extra});
    const own = (suffix, val, extra) => put(`${NS}.${suffix}`, val, extra);
    const mapping = {DP_GRID_IMPORT: 'meter.import', DP_GRID_EXPORT: 'meter.export',
        DP_PAR14A: 'dso.contact', DP_WB0_POWER: 'wb.power'};
    const config = {
        par14aAccountingMode: 'groupNet', par14aGroupId: 'g', par14aBoundaryId: 'site',
        par14aSiteScope: 'whole-site-ac', par14aLimitW: 4200, par14aBudgetMode: 'fixed',
        par14aActiveHigh: true, par14aStorageCoverage: 'complete-ac',
        par14aStorageMeters: [{powerId: AC1, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'}],
        par14aParticipants: [{name: 'wb', kind: 'wallbox', deviceId: 'Wallbox0', connectionPowerW: 7360,
            powerId: 'wb.power', powerUnit: 'kW', powerScope: 'total-ac'}],
        wb0Present: true, batteryPresent: true, batteryDispatchMode: 'sunenergy-heads',
        batteryHeadCount: 1, batterySunEnergyInstance: 'sunenergyxt500.0'
    };
    put('meter.import', 2000); put('meter.export', 0); put('dso.contact', true); put('wb.power', 3);
    put(AC1, 0); put(OLD_AC, 1000);
    own('Devices.Battery.OutputOwned', false); own('Devices.Battery.OutputReservedCharge_W', 0);
    own('Devices.Battery.OutputCommandInternal_W', 0); own('Devices.Battery.OutputUnobservedCommand_W', 0);
    own('Devices.Battery.HeadOwnership_JSON', JSON.stringify({version: 1, heads: []}));
    const evaluate = () => evaluateRuntimeGroup({config, mapping, namespace: NS, getState: id => states.get(id), now: NOW});
    const retainedHead = (overrides = {}) => ({index: 3, setpointId: OLD_GS, owned: true,
        commandW: -1000, commandAt: NOW - 1000, reservedChargeW: 0,
        unobservedCommandW: -1000, unobservedSince: NOW - 1000, ...overrides});
    const ledger = head => own('Devices.Battery.HeadOwnership_JSON', JSON.stringify({version: 1, heads: [head]}));
    return {states, put, own, config, mapping, evaluate, retainedHead, ledger};
}

function assertUncoveredDenied(f) {
    const result = f.evaluate();
    assert.equal(result.valid, false, JSON.stringify(result));
    assert.equal(checkGroupCommand(result, 'Wallbox0', 5000).allowed, false,
        'discharge from a known but uncovered previous battery actuator cannot fund another consumer');
    assert.equal(checkGroupCommand(result, 'Wallbox0', 0).allowed, true, 'safe OFF remains possible');
}

test('a retained head outside the new topology cannot become unrecorded own generation', () => {
    const f = fixture();
    f.ledger(f.retainedHead());
    f.own('Devices.Battery.OutputOwned', true);
    f.own('Devices.Battery.OutputCommandInternal_W', -1000);
    f.own('Devices.Battery.OutputUnobservedCommand_W', -1000);
    assertUncoveredDenied(f);
});

test('durable head ownership is checked even when aggregate ownership and charge reserve are zero', () => {
    const f = fixture();
    f.ledger(f.retainedHead());
    assertUncoveredDenied(f);
});

test('a retained head claim cannot be ignored because Battery.Present was turned off', () => {
    const f = fixture();
    f.config.batteryPresent = false;
    f.own('Devices.Battery.Present', false);
    f.ledger(f.retainedHead());
    assertUncoveredDenied(f);
});

for (const [name, overrides] of [
    ['unobserved discharge', {owned: false, commandW: 0, unobservedCommandW: -1000}],
    ['unobserved charge', {owned: false, commandW: 0, unobservedCommandW: 1000}],
    ['retained positive reserve', {owned: false, commandW: 0, unobservedCommandW: 0, reservedChargeW: 1000}]
]) {
    test(`an uncovered previous head with ${name} still requires its actual AC boundary`, () => {
        const f = fixture();
        f.ledger(f.retainedHead(overrides));
        assertUncoveredDenied(f);
    });
}

test('a retained head from another SunEnergy instance cannot be replaced by the current instance meter', () => {
    const f = fixture();
    f.ledger(f.retainedHead({index: 1, setpointId: 'sunenergyxt500.1.heads.1.control.GS'}));
    f.put('sunenergyxt500.1.heads.1.grid.GP', 1000);
    assertUncoveredDenied(f);
});

test('a former single-head GS target cannot use the newly configured AC meter as its proof', () => {
    const f = fixture();
    Object.assign(f.config, {batteryDispatchMode: 'single-head', batterySetpointId: 'sunenergyxt500.0.heads.1.control.GS',
        batteryAcPowerId: AC1});
    f.mapping.DP_BATTERY_AC_POWER = AC1;
    f.own('Devices.Battery.OutputOwned', true);
    f.own('Devices.Battery.OutputSetpointId', OLD_GS);
    f.own('Devices.Battery.OutputCommandInternal_W', -1000);
    f.own('Devices.Battery.OutputUnobservedCommand_W', -1000);
    assertUncoveredDenied(f);
});

test('an unobserved single-head target remains relevant after aggregate ownership becomes false', () => {
    const f = fixture();
    Object.assign(f.config, {batteryDispatchMode: 'single-head', batterySetpointId: 'sunenergyxt500.0.heads.1.control.GS',
        batteryAcPowerId: AC1});
    f.mapping.DP_BATTERY_AC_POWER = AC1;
    f.config.batteryPresent = false;
    f.own('Devices.Battery.OutputSetpointId', OLD_GS);
    f.own('Devices.Battery.OutputUnobservedCommand_W', -1000);
    assertUncoveredDenied(f);
});

for (const [name, value, extra] of [
    ['truncated JSON', '{"version":1,"heads":['],
    ['invalid version', '{"version":2,"heads":[]}'],
    ['missing head list', '{"version":1}'],
    ['invalid head target', '{"version":1,"heads":[{"index":3,"setpointId":"foreign.arbitrary","owned":true}]}'],
    ['unacknowledged durable proof', '{"version":1,"heads":[]}', {ack: false}],
    ['bad-quality durable proof', '{"version":1,"heads":[]}', {q: 64}]
]) {
    test(`a ${name} does not prove absence of a former storage actuator`, () => {
        const f = fixture();
        f.own('Devices.Battery.HeadOwnership_JSON', value, extra);
        assertUncoveredDenied(f);
    });
}

test('complete original AC coverage of a retained discharging head cannot create own-supply credit', () => {
    const f = fixture();
    f.ledger(f.retainedHead());
    f.config.par14aStorageMeters.push({powerId: OLD_AC, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'});
    const result = f.evaluate();
    if (result.valid) {
        assert.equal(result.snapshot.storageDischargeW, 1000);
        assert.equal(result.snapshot.eligibleOwnAvailableW, 0);
        assert.equal(result.snapshot.grossBudgetW, 4200);
    }
    assert.equal(checkGroupCommand(result, 'Wallbox0', 5000).allowed, false);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 0).allowed, true);
});

test('the coordinated combined heater pool is not lost when DHW is absent and heating is available', async () => {
    const {plant} = require('./control-plant');
    const h = await plant({wallbox: false, heating: true, split: false, sourceQuality: 0,
        nativeConfig: {dhwControlEnabled: false, par14aAccountingMode: 'groupNet',
            par14aGroupId: 'g', par14aBoundaryId: 'site', par14aSiteScope: 'whole-site-ac',
            par14aStorageCoverage: 'none', par14aStorageMeters: [],
            par14aBudgetMode: 'fixed', par14aLimitW: 4200,
            par14aParticipants: [{name: 'idle WB', kind: 'wallbox', connectionPowerW: 7360,
                deviceId: 'Wallbox2', powerId: 'DP_WB2_POWER', powerUnit: 'kW', powerScope: 'total-ac'}]}});
    h.mapping.DP_PAR14A = 'network.contact';
    h.mapping.DP_LPC_STATE = ''; h.mapping.DP_LPC_LIMIT = '';
    h.run("CFG.dp.par14a='network.contact';CFG.dp.lpcState='';CFG.dp.lpcLimit=''");
    h.put('network.contact', true);
    h.own('Devices.MyPV_DHW.Present', false);
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    h.own('Devices.MyPV_DHW.Release', false);
    await h.advance(30);
    assert.equal(h.run('currentConsumptionLimit().valid'), true, h.diagnostic());
    assert.ok(h.value('Control.Targets.MyPV_Heating_W') > 0, h.diagnostic());
    assert.ok(h.physical().heatingW > 0, h.diagnostic());
    assert.ok(h.writes.some(write => write.id === 'hk.setpoint' && write.val > 0),
        'the real heating output must receive the allocated pool after splitting it into actual heater devices');
});

test('fractional nominal voltage retains integer amperes and the established rounded parallel target format', async () => {
    const {plant} = require('./control-plant');
    const voltage = 221.06;
    const h = await plant({startDelayS: 0, minimumRuntimeS: 0, mii: true, split: false, sourceQuality: 0,
        nativeConfig: {dhwControlEnabled: false, wallboxParallelChargingEnabled: true,
            par14aAccountingMode: 'groupNet', par14aGroupId: 'g', par14aBoundaryId: 'site',
            par14aSiteScope: 'whole-site-ac', par14aStorageCoverage: 'none', par14aStorageMeters: [],
            par14aBudgetMode: 'fixed', par14aLimitW: 4200,
            par14aParticipants: [0, 2].map(wb => ({name: `WB${wb}`, kind: 'wallbox', connectionPowerW: 7360,
                deviceId: `Wallbox${wb}`, powerId: `DP_WB${wb}_POWER`, powerUnit: 'kW', powerScope: 'total-ac'}))}});
    h.mapping.DP_PAR14A = 'network.contact';
    h.mapping.DP_LPC_STATE = ''; h.mapping.DP_LPC_LIMIT = '';
    h.run("CFG.dp.par14a='network.contact';CFG.dp.lpcState='';CFG.dp.lpcLimit=''");
    h.put('network.contact', true);
    h.own('Devices.MyPV_DHW.Present', false);
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    h.own('Devices.MyPV_DHW.Release', false);
    h.own('Config.WallboxParallelChargingEnabled', true);
    h.own('Config.WallboxNominalVoltage_V', voltage);
    h.own('Config.WallboxStartReserve_W', 0);
    await h.replayAt(h.now() + 1000, [], {output: false});
    for (const wb of [0, 2]) {
        const amps = h.value(`Control.Targets.Wallbox${wb}_A`);
        const phases = h.value(`Control.Targets.Wallbox${wb}_Phases`);
        assert.ok(Number.isInteger(amps), `WB${wb} amperes: ${amps}`);
        assert.equal(h.value(`Control.Targets.Wallbox${wb}_W`), Math.round(amps * voltage * phases));
    }
    const independent = h.output.parallelAllocation(2);
    assert.equal(independent.valid, true, independent.reason);
});
