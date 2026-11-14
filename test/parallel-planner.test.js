'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(config = {}, minute = 0) {
    const now = Date.parse('2026-10-08T10:00:00Z') + minute * 60000;
    const states = new Map();
    const put = (id, val) => states.set(id, {val, ts: now, ack: true});
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const context = vm.createContext({vehicleSocEstimator: require('../lib/vehicle-soc-estimator'),
        wallboxAllocationPolicy: require('../lib/wallbox-allocation'), nativeConfig: {wallboxParallelChargingEnabled: true,
        wb0PhaseControlMode: 'ems', wb1PhaseControlMode: 'ems', wb2PhaseControlMode: 'ems', ...config},
    Date: Clock, getState: id => states.get(id), existsState: id => states.has(id),
    createState: (id, val) => { if (!states.has(id)) put(id, val); }, setState: put, log() {}});
    for (const name of ['core', 'prices', 'history', 'forecast', 'vehicles', 'energy-coordination', 'planner', 'config-mapping']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, `../lib/engine/${name}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) => key), context);
    }
    const run = source => vm.runInContext(source, context);
    run('createStates(); historyReady=true');
    // The old static protection sources are configured even in this sandbox.
    put('DP_PAR14A', false); put('DP_LPC_STATE', 'unlimitedControlled'); put('DP_LPC_LIMIT', 4200);
    const ids = run('[CFG.dp.par14a,CFG.dp.lpcState,CFG.dp.lpcLimit]');
    put(ids[0], false); put(ids[1], 'unlimitedControlled'); put(ids[2], 4200);
    for (const name of ['Battery', 'MyPV_DHW', 'MyPV_Heating', 'HeatPump']) put(`ems.0.Devices.${name}.Present`, false);
    for (const wb of [0, 1, 2]) put(`ems.0.Devices.Wallbox${wb}.Present`, false);
    put('ems.0.Config.DHWDailyDemand_kWh', 0); put('ems.0.Config.DHWStandingLoss_kWh_day', 0);
    put('ems.0.Config.DHWForecastReserve_kWh', 0);
    put('ems.0.Config.WallboxParallelChargingEnabled', config.wallboxParallelChargingEnabled !== false);
    const series = name => JSON.parse(states.get(`ems.0.Plan.${name}_48h_JSON`).val);
    const plan = ({pvW = 0, houseW = 0, slots = 4, price = 30} = {}) => {
        const start = Math.floor(now / 900000) * 900000;
        const pick = (value, i) => Array.isArray(value) ? value[i] : value;
        context.data = {pv: Array.from({length: slots}, (_, i) => ({timestamp: start + i * 900000, valueW: pick(pvW, i)})),
            house: Array.from({length: slots}, (_, i) => ({valueW: pick(houseW, i)})),
            prices: {total: Array.from({length: slots}, (_, i) => ({value_ct_kWh: pick(price, i)}))}};
        run('buildDevicePlan(data)');
        return {cars: [0, 1, 2].map(wb => series(`Wallbox${wb}`)), allocation: series('Allocation'), grid: series('GridPower')};
    };
    return {now, put, run, states, plan, series};
}

function car(h, wb, {soc = 40, minimum = 70, target = 90, maxA = 32,
    capacity = 50, phases = 1, priority = false, manualA = 0, connected = true} = {}) {
    h.put(`ems.0.Devices.Wallbox${wb}.Present`, true);
    const ids = h.run(`[CFG.dp.wallboxCar[${wb}],CFG.dp.wallboxSoc[${wb}],CFG.dp.wallboxMinSoc[${wb}],
        CFG.dp.wallboxSocTarget[${wb}],CFG.dp.wallboxAllow[${wb}],CFG.dp.wallboxSocRelease[${wb}],
        CFG.dp.wallboxManualMinCurrent[${wb}]]`);
    [connected ? 2 : 1, soc, minimum, target, true, soc < minimum ? 2 : 1, manualA].forEach((value, i) => h.put(ids[i], value));
    h.put(`ems.0.Config.Wallbox${wb}VehicleCapacity_kWh`, capacity);
    h.put(`ems.0.Config.Wallbox${wb}MaxPower_W`, maxA * 230 * phases);
    for (const p of [1, 3]) {
        h.put(`ems.0.Vehicles.Wallbox${wb}.MinCurrent${p}P_A`, 6);
        h.put(`ems.0.Vehicles.Wallbox${wb}.MaxCurrent${p}P_A`, maxA);
    }
    h.put(`ems.0.Vehicles.Wallbox${wb}.MaximumPhases`, phases);
    h.put(`ems.0.Vehicles.Wallbox${wb}.PhaseSwitchEnabled`, phases === 3);
    if (priority) { h.put(h.run('CFG.dp.wallboxPriority'), wb); }
}

function balance(result, pvW, houseW = 0) {
    for (let i = 0; i < result.grid.length; i++) {
        const pv = Array.isArray(pvW) ? pvW[i] : pvW;
        const house = Array.isArray(houseW) ? houseW[i] : houseW;
        const a = result.allocation[i];
        assert.equal(result.grid[i].valueW, Math.round(house) + Math.round(a.dhwW) + Math.round(a.heatingW)
            + result.cars.reduce((sum, series) => sum + series[i].valueW, 0) + Math.round(a.batteryW) - Math.round(pv));
    }
}

function battery(h, soc, capacity = 5.02) {
    h.put('ems.0.Devices.Battery.Present', true);
    h.put(h.run('CFG.dp.batterySoc'), soc);
    h.put('ems.0.Config.BatteryCapacity_kWh', capacity);
    h.put('ems.0.Config.BatteryEfficiency_pct', 100);
    h.put('ems.0.Config.BatteryMinSoC_pct', 10);
    h.put('ems.0.Config.BatteryMaxCharge_W', 2400);
    h.put('ems.0.Config.WallboxStartReserve_W', 150);
}

const coordinatedBattery = {batteryPvPriorityEnabled: true, batteryWallboxHalfStepEnabled: true};

for (const phases of [1, 3]) {
    test(`forecast shares PV with a ${phases}P wallbox at minimum without missing the storage target`, () => {
        const h = fixture({...coordinatedBattery, wb2PhaseControlMode: 'script'});
        battery(h, 18);
        car(h, 0, {soc: 70, minimum: 60, connected: phases === 1});
        car(h, 2, {soc: 75, minimum: 30, phases, connected: phases === 3});
        h.put(h.run('CFG.dp.wallboxPhaseModes[2]'), 2);
        const wb = phases === 1 ? 0 : 2;
        const minimumW = 1380 * phases;
        const pvW = [minimumW + 1170, minimumW + 1220, ...Array(6).fill(6000), 6500, 6000, 4500, 3000];
        const r = h.plan({pvW, slots: pvW.length});
        assert.equal(r.cars[wb][0].valueW, 0);
        assert.equal(r.allocation[0].batteryW, 2400);
        assert.equal(r.cars[wb][1].currentA, 6);
        assert.equal(r.cars[wb][1].phases, phases);
        assert.equal(r.cars[wb][1].valueW, minimumW);
        assert.equal(r.allocation[1].batteryW, 1220);
        assert.equal(r.grid[1].valueW, 0);
        balance(r, pvW);
    });
}

test('forecast protects the storage deadline and the minimum SoC from an early wallbox start', () => {
    const h = fixture(coordinatedBattery);
    car(h, 0, {soc: 75, minimum: 60});
    battery(h, 18, 15);
    const urgent = h.plan({pvW: [2600, 5000, 0], slots: 3});
    assert.equal(urgent.cars[0][0].valueW, 0);
    assert.equal(urgent.allocation[0].batteryW, 2400);
    assert.equal(h.series('BatteryPower')[0].requiredPvChargeW, 2400);

    battery(h, 10);
    const enoughLater = [2600, ...Array(8).fill(6000), 6500, 6000, 4500, 3000];
    const atMinimum = h.plan({pvW: enoughLater, slots: enoughLater.length});
    assert.equal(atMinimum.cars[0][0].valueW, 0);
    assert.equal(atMinimum.allocation[0].batteryW, 2400);
    assert.equal(h.series('BatteryPower')[0].requiredPvChargeW, 0);
});

test('forecast fills the configured stages and starts the final charge earlier for a weak PV tail', () => {
    const h = fixture(coordinatedBattery);
    battery(h, 60, 10);
    car(h, 0, {soc: 75, minimum: 60});
    const pvW = [3500, 5000, 6000, 5100, 4200, 4000, 3100, 2000, 900, 700, 500, 0];
    const r = h.plan({pvW, slots: pvW.length});
    assert.deepEqual(h.series('BatteryTargetSoC').slice(0, 9).map(slot => slot.value_pct), [70, 70, 90, 90, 90, 90, 100, 100, 100]);
    assert.equal(h.series('BatterySoC')[1].value_pct, 70);
    assert.equal(h.series('BatterySoC')[5].value_pct, 90);
    assert.equal(h.series('BatterySoC')[7].value_pct, 100);
    assert.equal(h.series('BatteryPower')[8].valueW, 0);
    assert.ok(r.cars[0][1].valueW > 0, 'only the watts needed to reach 70% are reserved in that slot');
    balance(r, pvW);
});

test('forecast keeps a completed PV stage closed after household discharge', () => {
    const h = fixture(coordinatedBattery);
    battery(h, 90, 10);
    h.put('ems.0.Config.BatterySelfConsumptionEnabled', true);
    car(h, 0, {soc: 75, minimum: 60, target: 100});
    const pvW = [5000, 0, 3000, 3000, 3000, 3000, 3000, 3000, 0];
    const houseW = Array(pvW.length).fill(300);
    const result = h.plan({pvW, houseW, slots: pvW.length});
    const target = h.series('BatteryTargetSoC'), power = h.series('BatteryPower');
    assert.equal(target[0].value_pct, 90);
    assert.equal(power[1].valueW, -300);
    assert.equal(target[2].value_pct, 90);
    assert.equal(power[2].valueW, 0);
    assert.equal(result.cars[0][2].valueW, 2530);
    const finalStart = target.findIndex(slot => slot.value_pct === 100);
    assert.ok(finalStart > 2 && power[finalStart].valueW > 0);
    balance(result, pvW, houseW);

    battery(h, 89, 10);
    const day = h.run('localDateKey(new Date())');
    h.put('ems.0.Control.BatteryPVReachedTarget_JSON', JSON.stringify({day, target: 90}));
    h.plan({pvW, houseW, slots: pvW.length});
    assert.equal(h.series('BatteryPower')[0].valueW, 0, 'a new forecast retains the measured pause');
});

test('storage priority preserves mandatory vehicle service and rejects an invalid joint power budget', () => {
    const h = fixture({...coordinatedBattery, par14aLimitW: 2700});
    battery(h, 18);
    car(h, 2, {soc: 20, minimum: 40});
    h.put(h.run('CFG.dp.par14a'), true);
    const r = h.plan({pvW: 3000, slots: 1});
    assert.equal(r.cars[2][0].valueW, 1380);
    assert.equal(r.allocation[0].batteryW, 1320);
    assert.equal(r.grid[0].valueW, -300);

    h.put('ems.0.Config.HouseConnectionWorkingLimit_A', null);
    const invalid = h.plan({pvW: 3000, slots: 1});
    assert.equal(invalid.cars[2][0].valueW, 0);
    assert.equal(invalid.allocation[0].batteryW, 0);
});

test('parallel forecast plans the Mii SoC step alongside both peer minimums without PV', () => {
    const h = fixture();
    for (const wb of [0, 1, 2]) car(h, wb, {soc: 5, priority: wb === 0});
    const r = h.plan();
    assert.deepEqual(r.cars.map(points => points[0].valueW), [3680, 1380, 1380]);
    assert.ok(r.cars.every(points => points[0].phases === 1));
    assert.deepEqual(r.cars.map(points => points[0].currentA), [16, 6, 6]);
    assert.equal(r.grid[0].valueW, 6440);
    balance(r, 0);
    h.put(h.run('CFG.dp.lpcState'), 'limited');
    const constrained = h.plan();
    assert.deepEqual(constrained.cars.map(points => points[0].currentA), [6, 6, 6]);
    balance(constrained, 0);
});

test('preferred Mii gets 32 A and remaining PV starts another vehicle above minimum with no heater need', () => {
    const h = fixture();
    car(h, 0, {soc: 70, minimum: 20, priority: true});
    car(h, 1, {soc: 70, minimum: 20});
    const r = h.plan({pvW: 10000, slots: 1});
    assert.deepEqual(r.cars.map(points => points[0].valueW), [7360, 2530, 0]);
    assert.equal(r.cars[0][0].currentA, 32);
    balance(r, 10000);
});

test('nonpreferred mandatory vehicle retains 6 A before the preferred vehicle receives extra PV', () => {
    const h = fixture();
    car(h, 0, {soc: 70, minimum: 20, priority: true}); car(h, 1);
    const r = h.plan({pvW: 6000, slots: 1});
    assert.equal(r.cars[0][0].valueW, 4600);
    assert.equal(r.cars[1][0].valueW, 1380);
    assert.equal(r.grid[0].valueW, -20);
});

test('hard phase capacity admits mandatory cars in preference order rather than exceeding L1', () => {
    const h = fixture();
    h.put('ems.0.Config.HouseConnectionWorkingLimit_A', 11);
    car(h, 0); car(h, 1, {priority: true}); car(h, 2);
    const r = h.plan({slots: 1});
    assert.equal(r.cars[1][0].valueW, 1380);
    assert.equal(r.cars[0][0].valueW + r.cars[2][0].valueW, 0);
    assert.ok(r.allocation[0].waitingWallboxes.length === 2);
    assert.ok(r.allocation[0].wallboxW <= 2530);
});

test('active §14a shared cap binds minimum service and surplus', () => {
    const h = fixture({par14aLimitW: 3000});
    h.put(h.run('CFG.dp.par14a'), true);
    car(h, 0, {priority: true}); car(h, 1); car(h, 2);
    const r = h.plan({pvW: 20000, slots: 1});
    assert.ok(r.allocation[0].wallboxW <= 3000);
    assert.equal(r.cars[1][0].valueW, 0);
    assert.equal(r.cars.filter(points => points[0].valueW > 0).length, 2);
});

test('target completion uses shortened whole-amp command, then drops demand without recreating energy', () => {
    const h = fixture();
    car(h, 0, {soc: 79.9, minimum: 80, target: 80, capacity: 10, priority: true}); car(h, 1);
    const r = h.plan();
    assert.equal(r.cars[0][0].currentA, 6);
    assert.ok(r.cars[0][0].chargingMinutes > 0 && r.cars[0][0].chargingMinutes < 1);
    assert.ok(r.cars[0].slice(1).every(point => point.valueW === 0));
    const energy = r.cars[0].reduce((sum, point) => sum + point.valueW * .25 / 1000 * .9, 0);
    assert.ok(Math.abs(energy - .01) < .001);
    assert.equal(r.cars[1][0].valueW, 1380);
    balance(r, 0);
});

test('partial current forecast slot counts only remaining time toward every vehicle target', () => {
    const h = fixture({}, 14);
    car(h, 0, {soc: 79, minimum: 80, target: 80, capacity: 10, priority: true}); car(h, 1, {soc: 79, minimum: 80, target: 80, capacity: 10});
    const r = h.plan({slots: 3});
    for (const points of r.cars.slice(0, 2)) {
        const energy = points.reduce((sum, point, i) => sum + point.valueW * (i ? .25 : 1 / 60) / 1000 * .9, 0);
        assert.ok(Math.abs(energy - .1) < .001);
    }
});

test('disconnected and target-complete vehicles are not given a protected minimum', () => {
    const h = fixture();
    car(h, 0, {soc: 90, target: 90, priority: true}); car(h, 1, {connected: false}); car(h, 2);
    const r = h.plan({slots: 1});
    assert.deepEqual(r.cars.map(points => points[0].valueW), [0, 0, 1380]);
});

test('parallel feature disabled preserves sequential legacy forecast', () => {
    const h = fixture({wallboxParallelChargingEnabled: false});
    car(h, 0, {priority: true}); car(h, 1);
    const r = h.plan({pvW: 20000, slots: 1});
    assert.equal(r.cars.filter(points => points[0].valueW > 0).length, 1);
    assert.equal(r.allocation[0].parallelWallboxCharging, undefined);
});

test('parallel price plans share a slot without replacing previous vehicle allocation or exceeding shared cap', () => {
    const h = fixture({par14aLimitW: 4200});
    h.put(h.run('CFG.dp.par14a'), true);
    h.run(`cars=[0,1].map(index=>({index,eligible:true,belowMinimum:false,mustCharge:false,
      effectivePriorityScore:1-index/10,latestStartTimestamp:0,priority:1,socValid:true,
      priceRemainingKWh:.69,priceDeadlineTimestamp:Date.now()+3600000,priceSessionValid:true,
      priceSessionId:'s'+index,phaseSwitchEnabled:false,maximumPhases:1,maximumPowerW:3680,
      minCurrent1pA:6,maxCurrent1pA:16,minCurrent3pA:6,maxCurrent3pA:16,
      baseMinCurrent1pA:6,baseMinCurrent3pA:6,manualMinimumCurrentA:0}));
      slots=[0,1,2,3].map(i=>({timestamp:Date.now()+i*900000,price:5,priceValid:true,pvW:0,
      baseW:0,residualPvW:0,dhwW:0,heatW:0,wbW:[0,0,0]}));
      points=[0,1,2].map(wb=>slots.map(slot=>({timestamp:slot.timestamp,valueW:0})));
      allocations=slots.map(()=>({wallboxW:0,wallboxRequestedW:0,wallboxPvW:0,wallboxGridW:0}));`);
    h.put('ems.0.Config.Wallbox0PriceChargingEnabled', true); h.put('ems.0.Config.Wallbox1PriceChargingEnabled', true);
    h.run('addPriceWallboxPlan(slots,points,allocations,cars,.9,Date.now())');
    const slots = h.run('slots');
    assert.ok(slots.some(slot => slot.wbW[0] > 0 && slot.wbW[1] > 0));
    for (let i = 0; i < slots.length; i++) {
        const allocation = h.run(`allocations[${i}]`);
        assert.ok(allocation.wallboxW <= 4200 + 1e-6);
        assert.ok(Math.abs(allocation.wallboxW - slots[i].wbW.reduce((sum, power) => sum + power, 0)) < 1e-6);
    }
});


test('optional DHW share remains available while every mandatory vehicle keeps its minimum', () => {
    const h = fixture();
    car(h, 0, {priority: true}); car(h, 1);
    h.put('ems.0.Devices.MyPV_DHW.Present', true);
    h.put('ems.0.Config.DHWMinTemperature_C', 40); h.put('ems.0.Config.DHWTargetTemperature_C', 70);
    for (const id of h.run('CFG.dp.dhwTemps')) h.put(id, 55);
    h.put('ems.0.Config.DHWParallelDistributionEnabled', true);
    h.put(h.run('CFG.dp.dhwParallelRelease'), true);
    const r = h.plan({pvW: 10000, slots: 1});
    assert.ok(r.allocation[0].dhwW > 0);
    assert.ok(r.cars[0][0].valueW >= 1380 && r.cars[1][0].valueW >= 1380);
    assert.equal(r.allocation[0].wallboxGridW, 0);
    balance(r, 10000);
});

test('three-phase forecast wish depends on own budget after peer minimum reservations', () => {
    const h = fixture();
    car(h, 0); car(h, 2, {priority: true, phases: 3});
    const constrained = h.plan({pvW: 10000, slots: 1});
    assert.equal(constrained.cars[2][0].phases, 1);
    assert.ok(constrained.cars[0][0].valueW >= 1380);
    const ample = h.plan({pvW: 14000, slots: 1});
    assert.equal(ample.cars[2][0].phases, 3);
    assert.equal(ample.cars[0][0].valueW, 1380);
    balance(ample, 14000);
});

test('manual minimum is retained rather than replaced by automatic six-amp minimum service', () => {
    const h = fixture();
    car(h, 0, {manualA: 12, priority: true}); car(h, 1);
    const r = h.plan({slots: 1});
    assert.equal(r.cars[0][0].currentA, 12);
    assert.equal(r.cars[1][0].currentA, 6);
});

test('unknown configured safety limit blocks requested minimums and reports waiters', () => {
    const h = fixture();
    car(h, 0, {priority: true}); car(h, 1);
    h.put('ems.0.Config.HouseConnectionWorkingLimit_A', null);
    const r = h.plan({pvW: 10000, slots: 1});
    assert.ok(r.cars.every(points => points[0].valueW === 0));
    assert.equal(r.allocation[0].wallboxForecastLimits.valid, false);
});


test('script-confirmed three-phase minimum cannot be invented as one-phase charging', () => {
    const h = fixture({wb1PhaseControlMode: 'script'});
    car(h, 0, {priority: true}); car(h, 1, {phases: 3});
    h.put(h.run('CFG.dp.wallboxPhaseModes[1]'), 2);
    const r = h.plan({slots: 1});
    assert.equal(r.cars[0][0].valueW, 1380);
    assert.equal(r.cars[1][0].phases, 3);
    assert.equal(r.cars[1][0].currentA, 6);
    assert.equal(r.cars[1][0].valueW, 4140);
});

test('device maximum clips manual request without admitting less than the hardware floor', () => {
    const h = fixture();
    car(h, 0, {manualA: 12, maxA: 8, priority: true}); car(h, 1);
    const r = h.plan({slots: 1});
    assert.equal(r.cars[0][0].currentA, 8);
    assert.equal(r.cars[1][0].currentA, 6);
});
