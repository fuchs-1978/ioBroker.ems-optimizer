'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../lib/battery-temperature-reserve');

const forecastId = 'weather.0.forecast.minimum';
const evening = Date.parse('2026-10-10T18:00:00Z'); // 20:00 Europe/Berlin
const configuration = overrides => ({batteryTemperatureMinSocEnabled: true,
    batteryTemperatureForecastId: forecastId,
    batteryTemperatureLowerThresholdC: 0, batteryTemperatureUpperThresholdC: 5,
    batteryTemperatureColdMinSocPct: 30, batteryTemperatureCoolMinSocPct: 20,
    batteryTemperatureWarmMinSocPct: 10, batteryTemperatureForecastMaxAgeH: 24,
    batteryMinSocPct: 15, batteryMaxSocPct: 100, ...overrides});
const reading = (val, now = evening, extra = {}) => ({val, ack: true, q: 0, ts: now, ...extra});
const evaluate = (value, {now = evening, config = {}, extra = {}, previous = null} = {}) =>
    policy.evaluate({now, config: configuration(config), source: reading(value, now, extra), previous});

test('temperature bands preserve exact boundaries: frost below zero, cool through five inclusive', () => {
    for (const [temperature, expected] of [[-20, 30], [-0.001, 30], [0, 20], [5, 20], [5.001, 10], [30, 10]]) {
        const result = evaluate(temperature);
        assert.equal(result.effectiveMinSoc, expected, `${temperature} °C`);
        assert.equal(result.sourceValid, true);
        assert.equal(result.configValid, true);
        assert.equal(result.selection.temperatureC, temperature);
        assert.equal(result.selection.sourceTs, evening);
    }
});

test('custom thresholds and all three custom minimum reserves affect only the selected minimum', () => {
    const config = {batteryTemperatureLowerThresholdC: -3, batteryTemperatureUpperThresholdC: 8,
        batteryTemperatureColdMinSocPct: 45, batteryTemperatureCoolMinSocPct: 28,
        batteryTemperatureWarmMinSocPct: 12, batteryMaxSocPct: 95};
    for (const [temperature, expected] of [[-3.01, 45], [-3, 28], [8, 28], [8.01, 12]]) {
        assert.equal(evaluate(temperature, {config}).effectiveMinSoc, expected);
    }
    assert.equal(config.batteryMaxSocPct, 95);
});

test('disabled feature retains the configured static minimum without requiring a forecast or old selection', () => {
    const previous = evaluate(-5).selection;
    for (const source of [null, reading(-5), reading(false)]) {
        const result = policy.evaluate({now: evening, config: configuration({batteryTemperatureMinSocEnabled: false}),
            source, previous});
        assert.equal(result.effectiveMinSoc, 15);
        assert.equal(result.enabled, false);
    }
});

test('missing, empty, boolean and nonnumeric forecasts never become zero-temperature observations', () => {
    for (const value of [null, undefined, '', ' ', false, true, 'true', 'cold', NaN, Infinity, -Infinity]) {
        const result = evaluate(value);
        assert.equal(result.sourceValid, false, String(value));
        assert.equal(result.effectiveMinSoc, 15, String(value));
        assert.equal(result.selection, null, String(value));
    }
});

test('numeric temperature text is accepted without rewriting its original timestamp', () => {
    const result = evaluate(' -1.5 ', {extra: {ts: evening - 3600000}});
    assert.equal(result.sourceValid, true);
    assert.equal(result.effectiveMinSoc, 30);
    assert.equal(result.selection.temperatureC, -1.5);
    assert.equal(result.selection.sourceTs, evening - 3600000);
});

test('quality, ACK, future and invalid timestamps reject a forecast independently of its plausible value', () => {
    for (const extra of [{ack: false}, {ack: undefined}, {q: 1}, {q: 0x80}, {ts: 0},
        {ts: null}, {ts: evening + 1}, {ts: evening - 24 * 3600000 - 1}]) {
        const result = evaluate(-5, {extra});
        assert.equal(result.sourceValid, false, JSON.stringify(extra));
        assert.equal(result.effectiveMinSoc, 15, JSON.stringify(extra));
        assert.equal(result.selection, null);
    }
});

test('maximum source age is inclusive and configurable; omitted quality means good rather than unknown', () => {
    const config = {batteryTemperatureForecastMaxAgeH: 2};
    const fresh = evaluate(-5, {config, extra: {q: undefined, ts: evening - 2 * 3600000}});
    assert.equal(fresh.sourceValid, true);
    assert.equal(fresh.effectiveMinSoc, 30);
    const stale = evaluate(-5, {config, extra: {ts: evening - 2 * 3600000 - 1}});
    assert.equal(stale.sourceValid, false);
    assert.equal(stale.effectiveMinSoc, 15);
});

test('impossible weather readings are unavailable rather than a cold or warm operating instruction', () => {
    for (const temperature of [-80.001, 60.001]) {
        const result = evaluate(temperature);
        assert.equal(result.sourceValid, false);
        assert.equal(result.effectiveMinSoc, 15);
    }
});

test('a forecast change does not replace or extend an already selected daily reserve', () => {
    const first = evaluate(-1);
    const later = evaluate(15, {now: evening + 3600000, previous: first.selection});
    assert.equal(later.effectiveMinSoc, 30);
    assert.deepEqual(later.selection, first.selection);
    assert.equal(later.selection.selectedAt, evening);
    assert.equal(later.selection.sourceTs, evening);
});

test('the next Berlin evening can select a new warm reserve without carrying over old weather', () => {
    const first = evaluate(-1);
    const next = evaluate(15, {now: evening + 24 * 3600000, previous: first.selection});
    assert.equal(next.effectiveMinSoc, 10);
    assert.equal(next.selection.periodKey, '2026-10-11');
    assert.equal(next.selection.selectedAt, evening + 24 * 3600000);
});

test('missing weather at the next evening holds the proved reserve and its original evidence across restart', () => {
    const first = evaluate(-1);
    const nextNow = evening + 24 * 3600000;
    const held = policy.evaluate({now: nextNow, config: configuration(), source: null,
        previous: JSON.parse(JSON.stringify(first.selection))});
    assert.equal(held.effectiveMinSoc, 30);
    assert.equal(held.held, true);
    assert.equal(held.sourceValid, false);
    assert.equal(held.selection.selectedAt, evening);
    assert.equal(held.selection.sourceTs, evening);
    const repeated = policy.evaluate({now: nextNow + 60000, config: configuration(), source: null,
        previous: JSON.parse(JSON.stringify(held.selection))});
    assert.equal(repeated.effectiveMinSoc, 30);
    assert.equal(repeated.selection.selectedAt, evening);
});

test('a late first usable forecast selects once at its real arrival time, never backdated to 20:00', () => {
    const previous = evaluate(-1).selection;
    const nextEvening = evening + 24 * 3600000;
    const missing = policy.evaluate({now: nextEvening, config: configuration(), source: null, previous});
    assert.equal(missing.held, true);
    assert.equal(missing.selection.selectedAt, evening);
    const arrivalAt = nextEvening + 5 * 60000;
    const recovered = evaluate(10, {now: arrivalAt, extra: {ts: arrivalAt - 60000}, previous: missing.selection});
    assert.equal(recovered.effectiveMinSoc, 10);
    assert.equal(recovered.selection.selectedAt, arrivalAt);
    assert.equal(recovered.selection.sourceTs, arrivalAt - 60000);
    assert.equal(recovered.selection.periodKey, '2026-10-11');
    const later = evaluate(-10, {now: arrivalAt + 60000, previous: recovered.selection});
    assert.equal(later.effectiveMinSoc, 10);
    assert.equal(later.selection.selectedAt, arrivalAt);
});

test('persisted reserve requires its original qualified weather, exact policy and plausible selection time', () => {
    const first = evaluate(-1).selection;
    for (const change of [{sourceAck: false}, {sourceQ: 64}, {minSoc: 40},
        {sourceTs: evening + 1}, {selectedAt: evening + 1}, {periodKey: '2026-10-11'},
        {temperatureC: 10}, {signature: 'different policy'}, {sourceId: 'other.weather'}]) {
        const result = policy.evaluate({now: evening, config: configuration(), source: null,
            previous: {...first, ...change}});
        assert.equal(result.effectiveMinSoc, 15, JSON.stringify(change));
        assert.equal(result.selection, null, JSON.stringify(change));
        assert.equal(result.valid, false);
    }
    assert.equal(first.sourceAck, true);
    assert.equal(first.sourceQ, 0);
});

test('Berlin daily boundary uses local 20:00 in winter and summer, independently of host timezone', () => {
    for (const [at, key] of [
        ['2026-01-10T18:59:59.999Z', '2026-01-09'],
        ['2026-01-10T19:00:00Z', '2026-01-10'],
        ['2026-07-10T17:59:59.999Z', '2026-07-09'],
        ['2026-07-10T18:00:00Z', '2026-07-10'],
        ['2026-03-29T17:59:59.999Z', '2026-03-28'],
        ['2026-03-29T18:00:00Z', '2026-03-29'],
        ['2026-10-25T18:59:59.999Z', '2026-10-24'],
        ['2026-10-25T19:00:00Z', '2026-10-25']]) {
        const result = policy.period(Date.parse(at));
        assert.equal(result.key, key, at);
    }
});

// Execute the actual planner and productive GS controller in one clock/state
// harness. The directory override is used solely to run these regressions
// against the unchanged predecessor; no product fallback is mocked here.
function engine({time = evening, config = {}, retained = null} = {}) {
    let now = time;
    const states = new Map(), writes = [];
    const ids = {soc: 'sunenergyxt500.0.total.soc', ac: 'sunenergyxt500.0.total.gridPower',
        gs: 'sunenergyxt500.0.heads.1.control.GS', heartbeat: 'sunenergyxt500.0.info.lastUpdate',
        online: 'sunenergyxt500.0.heads.1.online', mm: 'sunenergyxt500.0.heads.1.control.MM',
        lm: 'sunenergyxt500.0.heads.1.control.LM'};
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, q: 0, ts: now, ...extra});
    const own = (suffix, value, extra) => put(`ems.0.${suffix}`, value, extra);
    const nativeConfig = {...configuration(config), batterySetpointId: ids.gs, batteryAcPowerId: ids.ac,
        batteryProductionArmed: true, globalWriteEnabled: true, batteryPresent: true,
        batteryControlEnabled: true, batteryHeartbeatId: ids.heartbeat, batteryOnlineId: ids.online,
        batteryManualModeId: ids.mm, batteryLocalModeId: ids.lm};
    const ctx = vm.createContext({Date: Clock, nativeConfig, batteryTemperatureReserve: policy,
        gridConstraints: require('../lib/grid-constraints'),
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, value) => { if (!states.has(id)) put(id, value); }, setState: put, log() {},
        SMA_GRID_MAX_AGE_MS: 30000,
        writeForeignState: (id, value, callback) => { writes.push({id, value, at: now}); callback(null); return true; },
        currentConsumptionLimit: () => ({valid: true, active: false, budgetW: null}),
        coordinatedConsumptionLoads: () => ({batteryW: 0, totalW: 0}),
        coordinatedPhaseReservations: () => ({valid: true, otherW: [0, 0, 0]})});
    const directory = process.env.EMS_TEMPERATURE_TEST_ENGINE_DIR || path.join(__dirname, '../lib/engine');
    for (const name of ['core', 'prices', 'history', 'forecast', 'vehicles', 'battery-controller', 'planner', 'realtime']) {
        const source = fs.readFileSync(path.join(directory, `${name}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) => key);
        vm.runInContext(source, ctx);
    }
    const run = source => vm.runInContext(source, ctx);
    run('createStates(); createBatteryStates(); historyReady=true');
    run(`CFG.dp.batterySoc=${JSON.stringify(ids.soc)}; CFG.dp.batteryAcPower=${JSON.stringify(ids.ac)};
        CFG.dp.myPvDhwHaCurrentA=['ha1','ha2','ha3']; CFG.dp.haPhaseImportW=[];
        CFG.dp.haPhaseExportW=[]; CFG.dp.haCritical=''; CFG.dp.par14a='';
        CFG.dp.lpcState=''; CFG.dp.lpcLimit='';`);
    const settings = {BatteryMinSoC_pct: nativeConfig.batteryMinSocPct, BatteryMaxSoC_pct: nativeConfig.batteryMaxSocPct,
        BatteryTemperatureMinSoCEnabled: nativeConfig.batteryTemperatureMinSocEnabled,
        BatteryTemperatureForecastId: nativeConfig.batteryTemperatureForecastId,
        BatteryTemperatureLowerThreshold_C: nativeConfig.batteryTemperatureLowerThresholdC,
        BatteryTemperatureUpperThreshold_C: nativeConfig.batteryTemperatureUpperThresholdC,
        BatteryTemperatureColdMinSoC_pct: nativeConfig.batteryTemperatureColdMinSocPct,
        BatteryTemperatureCoolMinSoC_pct: nativeConfig.batteryTemperatureCoolMinSocPct,
        BatteryTemperatureWarmMinSoC_pct: nativeConfig.batteryTemperatureWarmMinSocPct,
        BatteryTemperatureForecastMaxAge_h: nativeConfig.batteryTemperatureForecastMaxAgeH};
    for (const [key, value] of Object.entries(settings)) own(`Config.${key}`, value);
    for (const suffix of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid',
        'Devices.Battery.Present', 'Devices.Battery.ControlEnabled', 'Devices.Battery.DriverReady',
        'Devices.Battery.SingleHeadVerified']) own(suffix, true);
    for (const wb of [0, 1, 2]) own(`Devices.Wallbox${wb}.Present`, false);
    own('Devices.MyPV_DHW.Present', false); own('Devices.MyPV_Heating.Present', false);
    own('Config.BatteryMaxCharge_W', 2400); own('Config.BatteryMaxDischarge_W', 2400);
    own('Config.BatteryCapacity_kWh', 10); own('Config.BatterySelfConsumptionEnabled', true);
    own('Config.BatteryManualSoC_pct', 20); own('Control.LastUpdate', now);
    own('Control.Targets.Battery_W', -1000);
    put(ids.soc, 20); put(ids.ac, 0); put(ids.heartbeat, now);
    put(ids.online, true); put(ids.mm, false); put(ids.lm, true);
    for (const id of ['ha1', 'ha2', 'ha3']) put(id, 0);
    put(forecastId, -1);
    if (retained) own('Devices.Battery.TemperatureReserveSelection_JSON', JSON.stringify(retained));
    const series = name => JSON.parse(states.get(`ems.0.Plan.${name}_48h_JSON`).val);
    const plan = ({pvW = 0, houseW = 1000, slots = 8} = {}) => {
        const data = {pv: [], house: [], prices: {total: []}};
        for (let i = 0; i < slots; i++) {
            data.pv.push({timestamp: now + i * 900000, valueW: Array.isArray(pvW) ? pvW[i] : pvW});
            data.house.push({valueW: houseW});
            data.prices.total.push({value_ct_kWh: 30});
        }
        run(`buildDevicePlan(${JSON.stringify(data)})`);
        return {power: series('BatteryPower'), soc: series('BatterySoC'),
            targets: series('BatteryTargetSoC'), stages: series('BatteryStage')};
    };
    return {run, put, own, states, nativeConfig, writes, ids, plan,
        tick: () => run('updateBatteryProductionOutput()'),
        value: suffix => states.get(`ems.0.${suffix}`)?.val,
        advance: ms => { now += ms; own('Control.LastUpdate', now); put(ids.heartbeat, now); },
        now: () => now};
}

test('productive discharge stops at the temperature minimum even when the old static minimum is lower', () => {
    const h = engine();
    assert.equal(h.run('batteryRegulationState().minSoc'), 30);
    h.tick();
    assert.deepEqual(h.writes, [], '20% may not discharge into a proved 30% reserve');
    assert.equal(h.value('Devices.Battery.EffectiveMinimumSoC_pct'), 30);
    assert.equal(h.value('Config.BatteryMinSoC_pct'), 15, 'static configuration remains untouched');
    assert.equal(h.value('Config.BatteryMaxSoC_pct'), 100, 'hard maximum remains untouched');
});

test('disabled temperature policy preserves actual legacy GS discharge and requires no weather source', () => {
    const h = engine({config: {batteryTemperatureMinSocEnabled: false}});
    h.states.delete(forecastId);
    assert.equal(h.run('batteryRegulationState().minSoc'), 15);
    h.tick();
    assert.deepEqual(h.writes.map(item => item.value), [100]);
    assert.ok(h.writes.every(item => item.id === h.ids.gs));
});

test('a newly selected higher evening reserve stops an already operating GS discharge immediately', () => {
    const h = engine();
    h.put(forecastId, 10);
    h.tick();
    assert.deepEqual(h.writes.map(item => item.value), [100]);
    assert.equal(h.run('batteryRegulationState().minSoc'), 10);
    h.advance(24 * 3600000);
    h.put(forecastId, -5); h.put(h.ids.ac, 100); h.put(h.ids.soc, 20);
    for (const id of ['ha1', 'ha2', 'ha3']) h.put(id, 0);
    h.tick();
    assert.deepEqual(h.writes.map(item => item.value), [100, 0]);
    assert.equal(h.run('batteryRegulationState().minSoc'), 30);
    assert.match(h.value('Devices.Battery.OutputStatus'), /Mindest-SoC/);
    assert.ok(h.writes.every(item => item.id === h.ids.gs), 'no SI controller is introduced');
});

test('disabling discards a previous daily selection; re-enabling with unknown weather uses the explicit static fallback', () => {
    const h = engine();
    assert.equal(h.run('batteryEffectiveMinimumSoc()'), 30);
    h.own('Config.BatteryTemperatureMinSoCEnabled', false);
    assert.equal(h.run('batteryEffectiveMinimumSoc()'), 15);
    assert.deepEqual(JSON.parse(h.value('Devices.Battery.TemperatureReserveSelection_JSON')), {});
    h.states.delete(forecastId);
    h.own('Config.BatteryTemperatureMinSoCEnabled', true);
    assert.equal(h.run('batteryEffectiveMinimumSoc()'), 15);
    assert.equal(h.value('Devices.Battery.TemperatureReserveValid'), false);
    assert.equal(h.value('Devices.Battery.TemperatureReserveHeld'), false);
    assert.match(h.value('Devices.Battery.TemperatureReserveStatus'), /Fallback/);
});

test('temperature minimum is shared by the whole forecast and productive regulator without inventing stored energy', () => {
    const h = engine();
    const result = h.plan();
    assert.equal(h.run('batteryRegulationState().minSoc'), 30);
    assert.ok(result.power.every(point => point.valueW === 0 && point.gridChargeW === 0));
    assert.ok(result.power.every(point => point.dischargeFloorPct === 30));
    assert.ok(result.soc.every(point => point.value_pct === 20), 'unknown missing 10% is never claimed as stored');
    assert.ok(result.targets.every(point => point.value_pct >= 70));
    assert.equal(h.value('Config.BatteryMorningTargetSoC_pct'), 70);
    assert.equal(h.value('Config.BatteryAfternoonTargetSoC_pct'), 90);
    assert.equal(h.value('Config.BatteryLateTargetSoC_pct'), 100);
});

test('real forecast PV fills an unmet reserve gradually, rather than jumping to the reserve before a watt is stored', () => {
    const h = engine();
    const result = h.plan({pvW: [0, 2000, 2000, 2000], houseW: 0, slots: 4});
    assert.equal(result.soc[0].value_pct, 20);
    assert.equal(result.power[0].valueW, 0);
    assert.ok(result.soc[1].value_pct > 20 && result.soc[1].value_pct < 30);
    assert.ok(result.soc[3].value_pct >= 30);
    assert.ok(result.power.every(point => point.gridChargeW === 0));
});

test('price planning also preserves a real SoC below the new reserve and does not buy or spend fictitious energy', () => {
    const h = engine();
    h.own('Config.BatteryPriceChargingEnabled', true);
    const result = h.plan();
    assert.equal(h.run('batteryRegulationState().minSoc'), 30);
    assert.ok(result.power.every(point => point.valueW === 0 && point.gridChargeW === 0));
    assert.ok(result.soc.every(point => point.value_pct === 20));
    h.own('Control.Targets.Battery_W', -1000);
    h.tick();
    assert.deepEqual(h.writes, []);
});

test('a selected zero reserve permits charging but cannot unlock discharge in planning or productive GS', () => {
    const h = engine({config: {batteryTemperatureColdMinSocPct: 0,
        batteryTemperatureCoolMinSocPct: 0, batteryTemperatureWarmMinSocPct: 0}});
    const result = h.plan();
    assert.equal(h.run('batteryRegulationState().minSoc'), 0);
    assert.equal(h.run('batteryRegulationState().canDischarge'), false);
    assert.ok(result.power.every(point => point.valueW === 0));
    assert.ok(result.soc.every(point => point.value_pct === 20));
    h.own('Control.Targets.Battery_W', -1000); h.tick();
    assert.deepEqual(h.writes, []);
    h.own('Control.Targets.Battery_W', 1000); h.tick();
    assert.deepEqual(h.writes.map(item => item.value), [-100]);
});

test('reserve conflict with the hard maximum blocks productive output and yields no planning power', () => {
    const h = engine({config: {batteryMaxSocPct: 25}});
    h.own('Control.Targets.Battery_W', 1000);
    h.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.run('batteryRegulationState().eligible'), false);
    const result = h.plan({pvW: 10000, houseW: 0});
    assert.ok(result.power.every(point => point.valueW === 0));
    assert.equal(h.value('Config.BatteryMaxSoC_pct'), 25);
    assert.ok(result.soc.every(point => point.value_pct <= 25));
});

test('absent or unarmed battery never writes foreign SI or GS when temperature selection changes', () => {
    for (const absent of [false, true]) {
        const h = engine();
        if (absent) { h.nativeConfig.batteryPresent = false; h.own('Devices.Battery.Present', false); }
        else h.nativeConfig.batteryProductionArmed = false;
        h.own('Control.Targets.Battery_W', 1000); h.tick();
        h.advance(24 * 3600000); h.put(forecastId, 10); h.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.value('Config.BatteryMinSoC_pct'), 15);
    }
});

test('restart reads the persisted temperature reserve for both planning and GS without recreating its observation time', () => {
    const retained = evaluate(-1).selection;
    const h = engine({time: evening + 24 * 3600000, retained});
    h.states.delete(forecastId);
    const result = h.plan();
    assert.equal(h.run('batteryRegulationState().minSoc'), 30);
    h.tick();
    assert.deepEqual(h.writes, []);
    assert.ok(result.power.every(point => point.dischargeFloorPct === 30));
    const saved = JSON.parse(h.value('Devices.Battery.TemperatureReserveSelection_JSON'));
    assert.equal(saved.selectedAt, evening);
    assert.equal(saved.sourceTs, evening);
    assert.equal(h.value('Devices.Battery.TemperatureReserveHeld'), true);
});

test('same-period process restart keeps the qualified daily selection despite newer warmer weather', () => {
    const retained = evaluate(-1).selection;
    const h = engine({time: evening + 3600000, retained});
    h.put(forecastId, 10);
    const result = h.plan();
    assert.equal(h.run('batteryRegulationState().minSoc'), 30);
    assert.ok(result.power.every(point => point.dischargeFloorPct === 30));
    const saved = JSON.parse(h.value('Devices.Battery.TemperatureReserveSelection_JSON'));
    assert.equal(saved.selectedAt, evening);
    assert.equal(saved.sourceTs, evening);
    assert.equal(saved.temperatureC, -1);
    assert.equal(saved.sourceAck, true);
    assert.equal(saved.sourceQ, 0);
});

test('unknown startup or malformed retained evidence cannot invent a temperature-dependent minimum', () => {
    for (const previous of [null, {}, {schema: 1, minSoc: 30}, {schema: 99, minSoc: 30}, 'invalid JSON']) {
        const result = policy.evaluate({now: evening, config: configuration(), source: null, previous});
        assert.equal(result.effectiveMinSoc, 15);
        assert.equal(result.selection, null);
    }
});

test('invalid temperature settings do not lift a configured battery maximum or make a numeric command', () => {
    for (const config of [{batteryTemperatureLowerThresholdC: 5, batteryTemperatureUpperThresholdC: 0},
        {batteryTemperatureLowerThresholdC: 5, batteryTemperatureUpperThresholdC: 5},
        {batteryTemperatureColdMinSocPct: 101}, {batteryTemperatureCoolMinSocPct: -1},
        {batteryTemperatureWarmMinSocPct: true}, {batteryTemperatureForecastMaxAgeH: 0},
        {batteryTemperatureForecastId: ''}]) {
        const result = evaluate(-5, {config});
        assert.equal(result.configValid, false, JSON.stringify(config));
        assert.equal(result.selection, null);
    }
});

test('a temperature reserve conflicting with the hard maximum is unusable instead of raising the maximum', () => {
    const result = evaluate(-5, {config: {batteryMaxSocPct: 25}});
    assert.equal(result.effectiveMinSoc, null);
    assert.equal(result.configValid, false);
    assert.equal(result.usable, false);
});

