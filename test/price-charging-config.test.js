'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EXTENSION_SETTINGS} = require('../lib/extension-settings');

const readEngine = file => fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')
    .replaceAll('__ADAPTER_ROOT__', 'ems.0');
const priceSettings = Object.fromEntries(Object.entries(EXTENSION_SETTINGS)
    .filter(([name]) => /^(?:PriceCharging|BatteryPrice|BatteryRoundTrip|Wallbox\dPrice)/.test(name)));
const de = JSON.parse(fs.readFileSync(path.join(__dirname, '../admin/i18n/de/translations.json'), 'utf8'));
const admin = JSON.parse(fs.readFileSync(path.join(__dirname, '../admin/jsonConfig.json'), 'utf8'));
const fields = Object.assign({}, ...Object.values(admin.items).map(tab => tab.items || {}));

function adapter(config = {}, persisted = new Map()) {
    const exported = {exports: {}};
    class Adapter {
        constructor() {
            this.namespace = 'ems.0';
            this.config = config;
            this.log = Object.fromEntries(['warn', 'error', 'info', 'debug'].map(name => [name, () => {}]));
        }
        on() {}
    }
    const customRequire = name => name === '@iobroker/adapter-core' ? {Adapter}
        : name === 'node-schedule' ? {scheduleJob: () => ({cancel() {}})}
        : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
        require: customRequire, module: exported, __dirname: path.join(__dirname, '..'), console, setTimeout, clearTimeout
    });
    const a = exported.exports();
    const objects = new Map();
    const writes = [];
    a.setObjectNotExistsAsync = async (id, object) => { if (!objects.has(id)) objects.set(id, object); };
    a.getStateAsync = async id => persisted.get(id) || null;
    a.setStateAsync = async (id, state) => { writes.push(id); persisted.set(id, state); };
    return {a, objects, writes, persisted};
}

test('price settings initialize through the real native mapping without enabling new charging on upgrade', async () => {
    const {a} = adapter({globalWriteEnabled: false, batteryMinSocPct: 23});
    await a.applyNativeEmsSettings();
    await a.flushOwnWrites();
    assert.equal(Object.keys(priceSettings).length, 17);
    for (const [suffix, [name, fallback]] of Object.entries(priceSettings)) {
        assert.equal(a.getCachedState(`ems.0.Config.${suffix}`).val, fallback, name);
    }
    assert.equal(a.getCachedState('ems.0.Config.BatteryMinSoC_pct').val, 23,
        'price reserve must not replace the established minimum SoC');
    assert.equal(a.getCachedState('ems.0.System.RealOutputsEnabled').val, false);
    const enabled = adapter({batteryPriceChargingEnabled: true, wb2PriceChargingEnabled: true,
        batteryPriceMaxCt: -1.5, wb2PriceEnergyKWh: 9, globalWriteEnabled: false}).a;
    await enabled.applyNativeEmsSettings();
    await enabled.flushOwnWrites();
    assert.equal(enabled.getCachedState('ems.0.Config.BatteryPriceChargingEnabled').val, true);
    assert.equal(enabled.getCachedState('ems.0.Config.Wallbox2PriceChargingEnabled').val, true);
    assert.equal(enabled.getCachedState('ems.0.Config.BatteryPriceMax_ct_kWh').val, -1.5);
    assert.equal(enabled.getCachedState('ems.0.Config.Wallbox2PriceEnergy_kWh').val, 9);
    assert.equal(enabled.getCachedState('ems.0.System.RealOutputsEnabled').val, false);
    assert.equal(enabled.getCachedState('ems.0.Devices.Battery.ControlEnabled').val, false);
});

test('vehicle session metadata remains read-only and persisted values survive real state creation and native application', async () => {
    const persisted = new Map([
        ['Vehicles.Wallbox1.PriceSessionId', {val: 'synthetic-session', ack: true}],
        ['Vehicles.Wallbox1.PriceChargedEnergy_kWh', {val: 3.75, ack: true}],
        ['Vehicles.Wallbox1.PriceLastMeasurementAt', {val: 1700000000000, ack: true}],
        ['Vehicles.Wallbox1.PriceEnergyTrackingValid', {val: false, ack: true}]
    ]);
    const h = adapter({}, persisted);
    const definitions = new Map();
    const ctx = vm.createContext({nativeConfig: {}, createState: (id, value, common) => {
        definitions.set(id, {value, common});
        void h.a.queueCompatState(id, value, common);
    }});
    vm.runInContext(readEngine('core'), ctx);
    vm.runInContext('createStates()', ctx);
    await Promise.all([...h.a.objectPromises.values()]);
    const beforeApply = h.writes.length;
    await h.a.applyNativeEmsSettings();
    await h.a.flushOwnWrites();
    for (const wb of [0, 1, 2]) {
        for (const suffix of ['PriceSessionLedger_JSON', 'PriceSessionId', 'PriceSessionStartedAt', 'PriceChargedEnergy_kWh',
            'PriceRemainingEnergy_kWh', 'PriceDeadlineTimestamp', 'PriceLastMeasurementAt',
            'PriceLastPower_kW', 'PriceSessionConnected', 'PriceEnergyTrackingValid',
            'PriceSessionUsesSoC', 'PriceSoCSampleAt', 'PriceSoCSample_pct', 'PriceEnergyAtSoCSample_kWh',
            'PriceSessionValid', 'PriceSessionStatus']) {
            const id = `ems.0.Vehicles.Wallbox${wb}.${suffix}`;
            assert.equal(definitions.get(id).common.write, false, id);
            assert.equal(h.writes.slice(beforeApply).includes(id.replace('ems.0.', '')), false,
                `${id} must not be reset by native settings`);
        }
    }
    assert.equal(h.a.getCachedState('ems.0.Vehicles.Wallbox1.PriceSessionId').val, 'synthetic-session');
    assert.equal(h.a.getCachedState('ems.0.Vehicles.Wallbox1.PriceChargedEnergy_kWh').val, 3.75);
    assert.equal(h.a.getCachedState('ems.0.Vehicles.Wallbox1.PriceLastMeasurementAt').val, 1700000000000);
    assert.equal(h.a.getCachedState('ems.0.Vehicles.Wallbox1.PriceEnergyTrackingValid').val, false);
    for (const suffix of ['Plan.PriceChargingStatus', 'Plan.PriceChargingDiagnostics_JSON'])
        assert.equal(definitions.get(`ems.0.${suffix}`).common.write, false);
});

test('all price settings trigger session refresh before a deferred forecast rebuild', () => {
    const subscriptions = [];
    const events = [];
    const noop = () => {};
    const ctx = vm.createContext({nativeConfig: {}, setTimeout: noop, schedule: noop, log: noop,
        getState: noop, existsState: () => false, setState: noop,
        on: (spec, callback) => subscriptions.push({spec, callback}),
        updateVehicles: () => events.push('vehicles'), requestForecastRebuild: () => events.push('forecast'),
        buildHistory: noop, observe: noop, updateDhwSimulation: noop, updateHeatingSimulation: noop,
        batteryEffectiveMinimumSoc: noop,
        updateHeatPumpAdvice: noop, updateDhwProductionOutput: noop, updateHeatingProductionOutput: noop,
        updateWallboxProductionOutput: noop, updateBatteryProductionOutput: noop, buildForecast: noop
    });
    vm.runInContext(readEngine('core'), ctx);
    vm.runInContext(readEngine('config-mapping'), ctx);
    vm.runInContext(readEngine('bootstrap'), ctx);
    for (const name of Object.keys(priceSettings)) {
        const found = subscriptions.find(({spec}) => Array.isArray(spec.id) && spec.id.includes(`ems.0.Config.${name}`));
        assert.ok(found, `${name} has no change subscription`);
        events.length = 0;
        found.callback();
        assert.deepEqual(events, ['vehicles', 'forecast'], name);
    }
});

test('price-charging Admin bounds distinguish negative caps, zero energy and optional permissions', () => {
    assert.equal(fields.priceChargingHorizonH.min, 6);
    assert.equal(fields.priceChargingHorizonH.max, 48);
    assert.equal(fields.priceChargingMinBlockMin.min, 15);
    assert.equal(fields.priceChargingMinBlockMin.max, 240);
    assert.equal(fields.priceChargingMinBlockMin.step, 15);
    for (const name of ['batteryPriceChargingEnabled', 'wb0PriceChargingEnabled',
        'wb1PriceChargingEnabled', 'wb2PriceChargingEnabled']) assert.equal(fields[name].default, false);
    for (const name of ['batteryPriceMaxCt', 'wb0PriceMaxCt', 'wb1PriceMaxCt', 'wb2PriceMaxCt']) {
        assert.ok(fields[name].min < 0, `${name} must support negative prices`);
        assert.equal(fields[name].default, 0);
        assert.match(de[fields[name].label], /0 = keine Grenze/);
    }
    for (const wb of [0, 1, 2]) {
        assert.equal(fields[`wb${wb}PriceEnergyKWh`].default, 0);
        assert.match(de[fields[`_wb${wb}PriceHelp`].text], /AC-Ladeenergie je Anstecken/);
        assert.match(de[fields[`_wb${wb}PriceHelp`].text], /Neustart setzt ihn nicht zurück/);
    }
    assert.match(de[fields._priceChargingHelp.text], /festem Energiepreis und zeitabhängigen Netzentgelten/);
});
