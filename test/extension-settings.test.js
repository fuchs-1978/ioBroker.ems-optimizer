'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {EXTENSION_SETTINGS} = require('../lib/extension-settings');
const {buildNativeMapping, FIELD_TO_MAPPING} = require('../lib/native-mapping');

const ioPackage = JSON.parse(fs.readFileSync('io-package.json', 'utf8'));
const native = ioPackage.native;
const admin = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));
const fields = Object.assign({}, ...Object.values(admin.items).map(tab => tab.items || {}));
const extensionIds = {
    batteryAcPowerId: 'DP_BATTERY_AC_POWER',
    batterySetpointId: 'DP_BATTERY_SETPOINT', batteryHeartbeatId: 'DP_BATTERY_HEARTBEAT',
    batteryOnlineId: 'DP_BATTERY_ONLINE', batteryManualModeId: 'DP_BATTERY_MANUAL_MODE',
    batteryLocalModeId: 'DP_BATTERY_LOCAL_MODE', batteryFaultId: 'DP_BATTERY_FAULT',
    batteryTemperatureId: 'DP_BATTERY_TEMPERATURE',
    heatingSetpointId: 'DP_HEAT_SETPOINT', heatingConnectionId: 'DP_HEAT_CONNECTION',
    heatingCoolingActiveId: 'DP_HEAT_COOLING_ACTIVE',
    heatingCoolingHeartbeatId: 'DP_HEAT_COOLING_HEARTBEAT',
    heatingOutput1Id: 'DP_HEAT_OUTPUT1', heatingOutput2Id: 'DP_HEAT_OUTPUT2',
    heatingOutput3Id: 'DP_HEAT_OUTPUT3', heatingOutletTempId: 'DP_HEAT_OUTLET_TEMP',
    heatPumpBufferTemperatureId: 'DP_HEAT_PUMP_BUFFER_TEMP',
    heatPumpDhwTemperatureId: 'DP_HEAT_PUMP_DHW_TEMP'
};

test('every extension setting has matching Admin and native defaults', () => {
    assert.equal(Object.keys(EXTENSION_SETTINGS).length, 28);
    const names = new Set();
    for (const [suffix, [name, fallback]] of Object.entries(EXTENSION_SETTINGS)) {
        assert.ok(!suffix.startsWith('Config.'), suffix);
        assert.ok(!names.has(name), `Duplicate native name: ${name}`);
        names.add(name);
        assert.equal(native[name], fallback, `native ${name}`);
        assert.ok(fields[name], `missing Admin ${name}`);
        assert.equal(fields[name].default, fallback, `Admin ${name}`);
        assert.equal(fields[name].type, typeof fallback === 'boolean' ? 'checkbox' : 'number', name);
        if (typeof fallback === 'number') {
            assert.ok(Number.isFinite(fallback), name);
            assert.ok(fields[name].min <= fallback && fields[name].max >= fallback, name);
        }
    }
});

test('extension metadata is immutable and can be spread into the startup settings map', () => {
    assert.ok(Object.isFrozen(EXTENSION_SETTINGS));
    for (const pair of Object.values(EXTENSION_SETTINGS)) assert.ok(Object.isFrozen(pair));
    assert.deepEqual({...EXTENSION_SETTINGS}.HeatingTemperatureMaxAge_s, ['heatingTemperatureMaxAgeS', 3600]);
    assert.ok(!Object.hasOwn(EXTENSION_SETTINGS, 'BatteryMinSoC_pct'), 'Existing configured reserve is not overwritten by extension defaults');
});

test('new source and actuator IDs are explicit, unmapped by default and discoverable for subscriptions', () => {
    for (const [name, key] of Object.entries(extensionIds)) {
        assert.equal(native[name], '', name);
        assert.equal(fields[name].default, '', name);
        assert.equal(fields[name].type, 'objectId', `source selector ${name}`);
        assert.equal(FIELD_TO_MAPPING[name], key, `preload mapping ${name}`);
        const config = {[name]: `example.${name}`};
        assert.equal(buildNativeMapping(config)[key], config[name]);
        assert.deepEqual(config, {[name]: `example.${name}`}, 'mapping must not modify saved configuration');
    }
});

test('explicit extension mappings override their own legacy key without replacing another actuator', () => {
    const mapping = buildNativeMapping({
        dataPointMapJson: JSON.stringify({DP_HEAT_SETPOINT: 'old.heat', DP_DHW_SETPOINT: 'existing.dhw',
            DP_WB2_ALLOW: 'existing.wallbox', DP_BATTERY_SOC: 'existing.battery.soc'}),
        heatingSetpointId: 'new.independent.heat', batterySetpointId: 'sunenergyxt.0.device.set.gs'
    });
    assert.equal(mapping.DP_HEAT_SETPOINT, 'new.independent.heat');
    assert.equal(mapping.DP_DHW_SETPOINT, 'existing.dhw');
    assert.equal(mapping.DP_WB2_ALLOW, 'existing.wallbox');
    assert.equal(mapping.DP_BATTERY_SOC, 'existing.battery.soc');
    assert.equal(mapping.DP_BATTERY_SETPOINT, 'sunenergyxt.0.device.set.gs');
});

test('new physical controls and price-based grid-heating permissions cannot start by default', () => {
    for (const name of ['batteryPresent', 'batteryControlEnabled', 'batteryProductionArmed',
        'heatingPresent', 'heatingControlEnabled', 'heatingProductionArmed',
        'heatPumpPresent', 'heatPumpControlEnabled', 'heatPumpAdviceEnabled',
        'thermalCheapPriceEnabled', 'thermalCheapFixedTariffAllowed']) {
        assert.equal(native[name], false, name);
        assert.equal(fields[name].default, false, name);
    }
    assert.equal(native.thermalCheapGridMaxW, 0);
    assert.equal(native.batteryMinSocPct, 15);
    assert.equal(fields.batteryMinSocPct.default, 15);
    assert.equal(native.heatingInhibit, false);
});

test('output selectors restrict choices to numeric writable states and never preselect a live target', () => {
    for (const id of ['batterySetpointId', 'heatingSetpointId']) {
        assert.equal(fields[id].type, 'objectId');
        assert.deepEqual(fields[id].customFilter, {type: 'state', common: {type: 'number', write: true}});
        assert.ok(!Object.hasOwn(fields[id], 'types'), 'objectId customFilter must not be combined with types');
        assert.equal(fields[id].default, '');
    }
});

test('battery measurement and command conventions are documented independently', () => {
    assert.equal(native.batteryPowerSign, 1);
    assert.deepEqual(fields.batteryPowerSign.options.map(option => option.value), [1, -1]);
    assert.match(fields.batterySetpointId.label, /positive discharge.*negative charge/);
    assert.match(fields.batteryPowerSign.options[0].label, /positive = charge/);
    assert.match(fields._batteryOutputHelp.text, /host crash/);
    assert.match(fields._batteryOutputHelp.text, /watchdog/);
    assert.match(fields.batteryProductionArmed.label, /supervised/i);
    assert.match(fields.batteryAcPowerId.label, /Required AC power feedback/);
    assert.match(fields.batteryAcPowerId.label, /grid.GP/);
    assert.match(fields.batteryPowerId.label, /DC power for history\/planning/);
    assert.match(fields.batteryPowerSign.label, /never used for GS \/ AC feedback/);
    assert.equal(native.batteryAcPowerId, '');
});

test('heat-pump extension exposes advice only and uses the shared cooling source', () => {
    assert.deepEqual(Object.keys(native).filter(name => /^heatPump.*(?:Setpoint|Output|ModeId|ProductionArmed)/.test(name)), []);
    assert.match(fields._heatPumpAdviceHelp.text, /No ISG mode endpoint is written/);
    assert.match(fields.heatPumpControlEnabled.label, /no external actuator write/);
    assert.equal(native.heatingCoolingActiveId, '');
    assert.equal(native.heatingCoolingHeartbeatId, '');
    assert.match(fields.heatingCoolingActiveId.label, /true\/1 = cooling/);
    assert.equal(EXTENSION_SETTINGS.HeatPumpTemperatureMaxAge_s[1], 3600);
});

test('battery fine reserve is an explicit PV power reserve, not an implicit grid-charge release', () => {
    assert.deepEqual(EXTENSION_SETTINGS.BatteryFineReserve_W, ['batteryFineReserveW', 200]);
    assert.equal(native.batteryFineReserveW, 200);
    assert.equal(fields.batteryFineReserveW.default, 200);
    assert.equal(fields.batteryFineReserveW.min, 0);
    assert.match(fields._batteryFineReserveHelp.text, /without available PV there is no reserve/);
    assert.match(fields._batteryFineReserveHelp.text, /not an additional SoC reserve/);
});
