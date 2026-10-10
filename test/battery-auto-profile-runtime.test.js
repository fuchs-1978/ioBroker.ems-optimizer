'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sunEnergyHeads = require('../lib/sunenergy-heads');

function engine({count = 2, mode = 'sunenergy-heads', capacitySource = 'sunenergy-packs', packSize = 2.5} = {}) {
    let now = Date.parse('2026-10-10T10:00:00Z');
    const states = new Map(), writes = [], rebuilds = [];
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const nativeConfig = {batteryDispatchMode: mode, batterySunEnergyInstance: 'sunenergyxt500.0',
        batteryHeadCount: count, batteryPresent: true, batteryHead1MaxChargeW: 2000,
        batteryHead1MaxDischargeW: 800, batteryHead2MaxChargeW: 2400,
        batteryHead2MaxDischargeW: 800};
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    const own = (suffix, val, extra) => put(`ems.0.${suffix}`, val, extra);
    const ctx = vm.createContext({Date: Clock, nativeConfig, sunEnergyHeads,
        batteryTemperatureReserve: require('../lib/battery-temperature-reserve'),
        SMA_GRID_MAX_AGE_MS: 30000,
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => { if (!states.has(id)) put(id, val); }, setState: put, log() {},
        writeForeignState: (...args) => { writes.push(args); return false; }, setTimeout() {},
        gridConstraints: require('../lib/grid-constraints')});
    for (const name of ['core', 'prices', 'history', 'forecast', 'vehicles', 'battery-controller', 'planner', 'realtime']) {
        const source = fs.readFileSync(path.join(process.env.EMS_AUTO_PROFILE_ENGINE_DIR || path.join(__dirname, '../lib/engine'), `${name}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) => key);
        vm.runInContext(source, ctx);
    }
    const run = source => vm.runInContext(source, ctx);
    ctx.requestForecastRebuild = () => rebuilds.push(now);
    run('createStates(); createBatteryStates(); historyReady=true');
    run("CFG.dp.batterySoc='legacySoc'; CFG.dp.batteryPower='legacyDc'; CFG.dp.batteryAcPower='legacyAc';");
    own('Devices.Battery.Present', true);
    own('Devices.MyPV_DHW.Present', false); own('Devices.MyPV_Heating.Present', false);
    for (const wb of [0, 1, 2]) own(`Devices.Wallbox${wb}.Present`, false);
    const config = {BatteryCapacitySource: capacitySource, BatteryPackCapacity_kWh: packSize,
        BatteryCapacity_kWh: 99, BatteryMaxCharge_W: 4000, BatteryMaxDischarge_W: 2000,
        BatteryMinSoC_pct: 15, BatteryMaxSoC_pct: 100, BatteryManualSoC_pct: 1,
        BatterySelfConsumptionEnabled: false};
    for (const [key, val] of Object.entries(config)) own(`Config.${key}`, val);
    put('legacySoc', 1); put('legacyDc', 9999); put('legacyAc', 9999);
    const bodies = new Map();
    const snapshot = (index, delta = {}, extra = {}) => {
        const body = {...(bodies.get(index) || {SC: 50, ON: 1, GS: 0, GP: 0, MM: 0, LM: 1,
            SI: 10, SA: 100, MG: 800, IS: 800, LP: 0, PK: 1}), ...delta};
        bodies.set(index, body);
        put(`sunenergyxt500.0.heads.${index}.info.rawResponse`, JSON.stringify(body), extra);
        put(`sunenergyxt500.0.heads.${index}.info.online`, true);
    };
    for (let i = 1; i <= count; i++) snapshot(i);
    const value = suffix => states.get(`ems.0.${suffix}`)?.val;
    const series = name => JSON.parse(value(`Plan.${name}_48h_JSON`));
    const plan = ({pvW = 10000, houseW = 0, slots = 8} = {}) => {
        const data = {pv: [], house: [], prices: {total: []}};
        for (let i = 0; i < slots; i++) {
            data.pv.push({timestamp: now + i * 900000, valueW: pvW});
            data.house.push({valueW: houseW}); data.prices.total.push({value_ct_kWh: 30});
        }
        run(`buildDevicePlan(${JSON.stringify(data)})`);
    };
    return {run, put, own, states, writes, snapshot, value, series, plan, nativeConfig, rebuilds,
        advance: ms => { now += ms; }};
}

test('head profile uses per-head AC responses, ON-weighted SOC and an explicit pack capacity', () => {
    const h = engine();
    h.snapshot(1, {SC: 20, ON: 1, GP: -600});
    h.snapshot(2, {SC: 80, ON: 3, GP: -400});
    h.run('batteryPlanningProfile()');
    assert.equal(h.value('Devices.Battery.Profile.SoC_pct'), 65);
    assert.equal(h.value('Devices.Battery.Profile.ActualPower_W'), 1000);
    assert.equal(h.value('Devices.Battery.Profile.OnlinePacks'), 4);
    assert.equal(h.value('Devices.Battery.Profile.Capacity_kWh'), 10);
    assert.equal(h.value('Config.BatteryCapacity_kWh'), 99, 'manual configuration remains an explicit alternative');
    assert.equal(h.value('Devices.Battery.Profile.MaxCharge_W'), 4000);
    assert.equal(h.value('Devices.Battery.Profile.MaxDischarge_W'), 1600);
    assert.deepEqual(h.writes, [], 'reading/publishing a profile never actuates');
});

test('planner takes derived capacity and actual head SOC instead of legacy or manual SOC', () => {
    const h = engine();
    h.snapshot(1, {SC: 20, ON: 1}); h.snapshot(2, {SC: 80, ON: 3});
    h.plan({pvW: 0});
    assert.equal(h.value('Plan.BatteryForecastValid'), true);
    assert.ok(h.series('BatterySoC').every(x => x.value_pct === 65));
    assert.match(h.value('Plan.BatterySoCSource'), /rawResponse.*ON-gewichtet/);
    assert.equal(h.value('Devices.Battery.Profile.Capacity_kWh'), 10);
    h.own('Config.BatteryMaxCharge_W', 3500); h.plan();
    assert.ok(h.series('BatteryPower').every(x => x.valueW <= 3500));
    assert.ok(h.series('BatteryPower').some(x => x.valueW > 0));
});

test('planner intersects real model/perhead caps and device SOC bounds with editable EMS policy', () => {
    const h = engine();
    h.snapshot(1, {SC: 75, SI: 30, SA: 85}); h.snapshot(2, {SC: 75, SI: 20, SA: 90});
    h.own('Config.BatteryMaxCharge_W', 9000); h.own('Config.BatterySelfConsumptionEnabled', true);
    h.plan();
    assert.equal(h.value('Devices.Battery.Profile.MaxCharge_W'), 4400);
    assert.equal(h.value('Devices.Battery.Profile.MaxDischarge_W'), 1600);
    assert.ok(h.series('BatteryTargetSoC').every(x => x.value_pct <= 85));
    assert.ok(h.series('BatteryPower').every(x => x.valueW <= 4400));
    h.own('Config.BatteryMinSoC_pct', 40); h.plan({pvW: 0, houseW: 10000});
    assert.ok(h.series('BatterySoC').every(x => x.value_pct >= 40));
    assert.ok(h.series('BatteryPower').every(x => x.valueW >= -1600));
    assert.equal(h.value('Config.BatteryMaxSoC_pct'), 100);
});

test('missing explicit pack size suppresses only the battery forecast with unknown SOC output', () => {
    const h = engine({packSize: 0}); h.plan();
    assert.equal(h.value('Devices.Battery.Profile.Valid'), true);
    assert.equal(h.value('Devices.Battery.Profile.CapacityValid'), false);
    assert.equal(h.value('Devices.Battery.Profile.Capacity_kWh'), null);
    assert.equal(h.value('Plan.BatteryForecastValid'), false);
    assert.match(h.value('Plan.BatteryForecastStatus'), /online-pack-capacity-unknown/);
    assert.ok(h.series('BatteryPower').every(x => x.valueW === 0 && !x.forecastValid && x.pvHeadroomKWh === null));
    assert.ok(h.series('BatterySoC').every(x => x.value_pct === null));
    assert.ok(h.series('BatteryTargetSoC').every(x => x.value_pct === null));
    assert.equal(h.value('Plan.Valid'), true, 'other-device plans remain available');
    for (const name of ['BatteryMaxPlannedCharge_W', 'BatteryMaxPlannedDischarge_W',
        'BatteryAtMinSoC_h', 'BatteryAtTargetSoC_h', 'AdditionalShiftPotential_kWh'])
        assert.equal(h.value(`Evaluation.${name}`), null, name);
    assert.match(h.value('Evaluation.BatterySizingHint'), /Nicht bewertbar/);
});

test('an offline/stale/bad-quality selected head is unknown despite a fresh aggregate heartbeat and legacy SOC', () => {
    for (const bad of ['offline', 'stale', 'quality', 'ack', 'missing']) {
        const h = engine();
        if (bad === 'offline') h.put('sunenergyxt500.0.heads.2.info.online', false);
        if (bad === 'stale') h.snapshot(2, {}, {ts: 1});
        if (bad === 'quality') h.snapshot(2, {}, {q: 1});
        if (bad === 'ack') h.snapshot(2, {}, {ack: false});
        if (bad === 'missing') h.states.delete('sunenergyxt500.0.heads.2.info.rawResponse');
        h.put('sunenergyxt500.0.total.soc', 80); h.put('sunenergyxt500.0.info.lastUpdate', Date.now());
        h.plan();
        assert.equal(h.value('Plan.BatteryForecastValid'), false, bad);
        assert.equal(h.value('Devices.Battery.Profile.SoC_pct'), null, bad);
        assert.ok(h.series('BatteryPower').every(x => x.valueW === 0), bad);
        assert.ok(h.series('BatterySoC').every(x => x.value_pct === null), bad);
        assert.deepEqual(h.writes, [], bad);
    }
});

test('selected manual capacity stays authoritative while head telemetry and device caps remain automatic', () => {
    const h = engine({capacitySource: 'manual', packSize: 0});
    h.own('Config.BatteryCapacity_kWh', 7); h.snapshot(1, {SC: 20}); h.snapshot(2, {SC: 80}); h.plan({pvW: 0});
    assert.equal(h.value('Devices.Battery.Profile.Capacity_kWh'), 7);
    assert.equal(h.value('Plan.BatteryForecastValid'), true);
    assert.ok(h.series('BatterySoC').every(x => x.value_pct === 50));
    h.own('Config.BatteryCapacity_kWh', null); h.plan();
    assert.equal(h.value('Plan.BatteryForecastValid'), false);
    assert.equal(h.value('Devices.Battery.Profile.Capacity_kWh'), null);
});

test('SOC and power polls do not schedule forecast rebuilds; capacity proof changes do', () => {
    const h = engine(); h.run('batteryPlanningProfile()');
    h.advance(1000); h.snapshot(1, {SC: 51, GP: -100}); h.snapshot(2); h.run('batteryPlanningProfile()');
    assert.equal(h.rebuilds.length, 0);
    h.snapshot(1, {ON: 2}); h.run('batteryPlanningProfile()'); assert.equal(h.rebuilds.length, 1);
    h.put('sunenergyxt500.0.heads.2.info.online', false); h.run('batteryPlanningProfile()');
    assert.equal(h.rebuilds.length, 2);
});

test('profile timestamps retain the oldest and newest genuine per-head source times', () => {
    const h = engine(); h.snapshot(1, {}, {ts: Date.parse('2026-10-10T09:59:55Z')});
    h.run('batteryPlanningProfile()');
    assert.equal(h.value('Devices.Battery.Profile.SourceAt'), Date.parse('2026-10-10T10:00:00Z'));
    assert.equal(h.value('Devices.Battery.Profile.OldestSourceAt'), Date.parse('2026-10-10T09:59:55Z'));
});

test('legacy single-head planning preserves the configured mapping and manual capacity', () => {
    const h = engine({mode: 'single-head'}); h.plan({pvW: 0});
    assert.equal(h.run('batteryPlanningProfile()'), null);
    assert.ok(h.series('BatterySoC').every(x => x.value_pct === 1));
    assert.equal(h.value('Plan.BatterySoCSource'), 'legacySoc');
    h.states.delete('legacySoc'); h.own('Config.BatteryManualSoC_pct', 42); h.plan({pvW: 0});
    assert.ok(h.series('BatterySoC').every(x => x.value_pct === 42));
});


test('losing required forecast/history invalidates battery forecast diagnosis instead of retaining a prior pass', () => {
    const h = engine(); h.plan(); assert.equal(h.value('Plan.BatteryForecastValid'), true);
    h.run('historyReady=false; buildDevicePlan({pv:[],house:[]})');
    assert.equal(h.value('Plan.BatteryForecastValid'), false);
    assert.match(h.value('Plan.BatteryForecastStatus'), /Wartet auf gueltige Historie/);
});

test('variable load-port use does not schedule repeated expensive forecast rebuilds', () => {
    const h = engine(); h.run('batteryPlanningProfile()');
    for (let watts = 1; watts < 10; watts++) {
        h.advance(1000); h.snapshot(1, {LP: watts}); h.snapshot(2); h.run('batteryPlanningProfile()');
    }
    assert.equal(h.rebuilds.length, 0);
    h.own('Config.BatteryMaxCharge_W', 2000); h.run('batteryPlanningProfile()');
    assert.equal(h.rebuilds.length, 1, 'operator cap change still invalidates the planning basis');
});


test('switching away from head mode clears retained automatic profile success without actuating', () => {
    const h = engine(); h.run('batteryPlanningProfile()');
    assert.equal(h.value('Devices.Battery.Profile.Valid'), true);
    h.nativeConfig.batteryDispatchMode = 'single-head'; h.run('updateBatteryProductionOutput()');
    assert.equal(h.value('Devices.Battery.Profile.Valid'), false);
    assert.equal(h.value('Devices.Battery.Profile.CapacityValid'), false);
    assert.equal(h.value('Devices.Battery.Profile.SoC_pct'), null);
    assert.equal(h.value('Devices.Battery.Profile.OldestSourceAt'), 0);
    assert.deepEqual(h.writes, []);
});

test('battery price authorization checks coherent head SOC rather than a low legacy SOC', () => {
    const h = engine(); h.plan({pvW: 0});
    h.own('Config.BatteryPriceChargingEnabled', true);
    h.run('evaluatePriceAt = () => ({valid:true,totalCt:30})');
    const authorization = target => h.run(`priceChargingAuthorization('Battery', {
        timestamp:Date.now(),priceOptimized:true,gridChargeW:1000,priceLimitCt:30,targetSoCPct:${target}})`);
    assert.equal(authorization(10).allowed, false, 'real 50% SOC already exceeds target despite legacy 1%');
    h.states.delete('legacySoc');
    assert.equal(authorization(80).allowed, true, 'explicit legacy mapping is unnecessary');
    h.put('sunenergyxt500.0.heads.2.info.online', false);
    assert.equal(authorization(80).allowed, false, 'missing configured-head proof cannot authorize import');
});


test('real SOC above a newly applied device charging ceiling is not erased by either forecast path', () => {
    for (const priceEnabled of [false, true]) {
        const h = engine(); h.snapshot(1, {SC: 95, SA: 90}); h.snapshot(2, {SC: 95, SA: 90});
        h.own('Config.BatteryPriceChargingEnabled', priceEnabled); h.plan({pvW: 0, houseW: 0});
        assert.equal(h.value('Plan.BatteryForecastValid'), true);
        assert.ok(h.series('BatteryPower').every(x => x.valueW === 0));
        assert.ok(h.series('BatterySoC').every(x => x.value_pct === 95), String(priceEnabled));
    }
});
