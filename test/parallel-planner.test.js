'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(config = {}, minute = 0, start = Date.parse('2026-10-08T10:00:00Z')) {
    const now = start + minute * 60000;
    const states = new Map();
    const put = (id, val) => states.set(id, {val, ts: now, ack: true});
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const context = vm.createContext({vehicleSocEstimator: require('../lib/vehicle-soc-estimator'),
        gridConstraints: require('../lib/grid-constraints'), batteryOperatingWindow: require('../lib/battery-operating-window'),
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
            house: Array.from({length: slots}, (_, i) => ({timestamp: start + i * 900000, valueW: pick(houseW, i)})),
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

function headroomFixture(soc, config = {}, minute = 0) {
    const h = fixture({...coordinatedBattery, batteryPresent: true, batteryDispatchMode: 'sunenergy-heads',
        wb0ControlEnabled: true, wb0CommissioningMaxA: 32, ...config}, minute);
    battery(h, soc, 15.06);
    h.run(`function batteryHeadsMode() { return true; }
        function batteryPlanningProfile() { return {valid:true, capacityValid:true, capacityKWh:15.06,
            soc:${soc}, deviceMinSoc:20, deviceMaxSoc:100, maxChargeW:2400, maxDischargeW:2400}; }`);
    h.put('ems.0.Config.BatteryRoundTripEfficiency_pct', 0);
    for (const stage of ['Morning', 'Afternoon', 'Late']) h.put(`ems.0.Config.Battery${stage}TargetSoC_pct`, 100);
    car(h, 0, {soc: 54, minimum: 50, target: 90, capacity: 32});
    return h;
}

test('late full-battery spill repays an earlier running EV step exactly, including its short first increment', () => {
    const pvW = [...Array(10).fill(4000), 993, 1036.5, 1115, 0];
    const h = headroomFixture(100 - (2390 * 10 + 980) * 0.25 / 15060 * 100);
    const result = h.plan({pvW, slots: pvW.length});
    const carPlan = result.cars[0], allocations = result.allocation;
    const carWh = allocations.reduce((sum, a) => sum + (a.pvHeadroomWallboxW || 0) / 4, 0);
    const recoveredWh = allocations.reduce((sum, a) => sum + (a.pvHeadroomBatteryW || 0) / 4, 0);
    assert.ok(Math.abs(carWh - 541.125) < 1e-6);
    assert.ok(Math.abs(recoveredWh - carWh) < 1e-6);
    assert.ok(carPlan.slice(0, 10).every(p => p.currentA === 8 && p.pvHeadroom.baseA === 7 && p.chargingMinutes === 15));
    assert.ok(carPlan[0].pvHeadroom.from > carPlan[0].timestamp);
    assert.ok(carPlan.slice(1, 10).every(p => p.pvHeadroom.from === p.timestamp));
    assert.ok(carPlan.slice(10).every(p => p.currentA === 0));
    assert.ok(allocations.every(a => Math.abs(a.rawGridW) < 1e-6 && a.batteryW <= 2400));
    assert.equal(h.series('BatterySoC').at(-1).value_pct, 100);
    balance(result, pvW);
    h.run(fs.readFileSync(path.join(__dirname, '../lib/engine/realtime.js'), 'utf8'));
    const from = carPlan[0].pvHeadroom.from;
    assert.equal(h.run(`currentPlanItem('Wallbox0', ${from - 1}).valueW`), 1610);
    assert.equal(h.run(`currentPlanItem('Wallbox0', ${from}).valueW`), 1840);
});

test('the 15:30 spill left by fourteen 1 A increments funds a second step, including its partial quarter', () => {
    // Afternoon PV left after the house load. The original battery trajectory
    // could still accept 35.64 W in the first quarter before reaching 100%.
    const tail = [1054.5, 993, 1036.5, 1115], baselineTailW = 35.64;
    const pvW = [...Array(14).fill(4000), ...tail];
    const initialSoc = 100 - (14 * 2390 + baselineTailW) * 0.25 / 15060 * 100;
    const plan = maxA => {
        const h = headroomFixture(initialSoc, {wb0CommissioningMaxA: maxA});
        const result = h.plan({pvW, slots: pvW.length});
        balance(result, pvW);
        return {h, ...result};
    };
    const limited = plan(8);
    assert.ok(Math.abs(limited.allocation.at(-1).rawGridW + 943.36) < 1e-6);
    assert.ok(limited.cars[0].every(p => p.currentA <= 8));

    const {h, allocation, cars} = plan(32);
    const extraWh = allocation.reduce((sum, a) => sum + (a.pvHeadroomWallboxW || 0) * 0.25, 0);
    const storedWh = allocation.reduce((sum, a) => sum + (a.pvHeadroomBatteryW || 0) * 0.25, 0);
    assert.ok(Math.abs(extraWh - 805 - 943.36 * 0.25) < 1e-6);
    assert.ok(Math.abs(storedWh - extraWh) < 1e-6);
    assert.ok(allocation.every(a => Math.abs(a.rawGridW) < 1e-6));
    assert.ok(allocation.slice(0, 14).every(a => a.batteryW >= 1200));
    assert.equal(allocation.at(-1).batteryW, 1115);
    assert.equal(h.series('BatterySoC').at(-1).value_pct, 100);
    const raised = cars[0].filter(p => p.currentA === 9);
    assert.equal(raised.length, 5);
    assert.ok(raised.every(p => p.pvHeadroom.baseA === 7 && p.chargingMinutes === 15));
    assert.ok(raised.slice(1).every(p => p.pvHeadroom.from === p.timestamp));
    const from = raised[0].pvHeadroom.from;
    assert.ok(from > raised[0].timestamp && from < raised[0].timestamp + 900000);
    h.run(fs.readFileSync(path.join(__dirname, '../lib/engine/realtime.js'), 'utf8'));
    assert.equal(h.run(`currentPlanItem('Wallbox0', ${from - 1}).currentA`), 8);
    assert.equal(h.run(`currentPlanItem('Wallbox0', ${from}).currentA`), 9);
    assert.ok(cars[0].slice(14).every(p => p.currentA === 0));
});

test('additional ampere steps share one vehicle energy budget and preserve minimum battery charging power', () => {
    const pvW = [...Array(10).fill(3000), ...Array(6).fill(1100)];
    const run = capacity => {
        const h = headroomFixture(100 - 1620 * 2.5 / 15060 * 100);
        car(h, 0, {soc: 70, minimum: 50, target: 90, capacity});
        const result = h.plan({pvW, slots: pvW.length});
        balance(result, pvW);
        return result;
    };
    const ample = run(50);
    assert.ok(ample.cars[0].slice(0, 10).every(p => p.currentA === 7));
    assert.ok(ample.allocation.slice(0, 10).every(a => a.batteryW === 1390));
    assert.ok(ample.allocation.some(a => a.rawGridW < -1), 'a second step would breach the 1200 W floor');
    const limited = run(16);
    const kWh = limited.allocation.reduce((sum, a) => sum + a.wallboxW * 0.25 * 0.9 / 1000, 0);
    assert.ok(Math.abs(kWh - 3.2) < 1e-6, 'recoverable PV cannot expand the target SoC');
});

test('headroom requires recoverable future PV, ongoing flexible demand and current-limit clearance', () => {
    for (const condition of ['no spill', 'intervening deficit', 'commissioning cap', 'target reached', 'grid limit']) {
        const h = headroomFixture(condition === 'intervening deficit' ? 91 : 94,
            condition === 'commissioning cap' ? {wb0CommissioningMaxA: 7} : {});
        if (condition === 'target reached') car(h, 0, {soc: 89.5, target: 90, minimum: 50, capacity: 32});
        if (condition === 'grid limit') h.put(h.run('CFG.dp.lpcState'), 'limited');
        const pvW = condition === 'no spill' ? [4000, 0] : [4000, 4000, 0, 1100, 1100];
        if (condition !== 'intervening deficit' && pvW.length > 2) pvW[2] = 1100;
        const r = h.plan({pvW, houseW: condition === 'intervening deficit' ? [0, 0, 800, 0, 0] : 0, slots: pvW.length});
        assert.ok(r.cars[0].every(p => !p.pvHeadroom), condition);
        balance(r, pvW, condition === 'intervening deficit' ? [0, 0, 800, 0, 0] : 0);
    }
});

test('running hot water takes only residual PV at the storage AC ceiling and respects heat and connection caps', () => {
    for (const [rest, limit, expected] of [[94, 9000, 94], [122, 9000, 122], [47, 9000, 47], [122, 1180, 55], [0, 9000, 0]]) {
        const h = headroomFixture(45);
        h.put('ems.0.Devices.MyPV_DHW.Present', true);
        h.put('ems.0.Config.DHWMinTemperature_C', 48);
        h.put('ems.0.Config.DHWTargetTemperature_C', 76);
        h.put('ems.0.Config.DHWDailyDemand_kWh', 25);
        h.put('ems.0.Config.DHWStandingLoss_kWh_day', 2);
        h.put('ems.0.Config.DHWCommissioningMaxPower_W', limit);
        for (const id of h.run('CFG.dp.dhwTemps')) h.put(id, 48);
        const pvW = 1125 + 2400 + rest;
        const result = h.plan({pvW, slots: 1}), a = result.allocation[0];
        assert.equal(a.mandatoryThermalW, 1125);
        assert.equal(a.dhwPvTrimW || 0, expected);
        assert.equal(a.batteryPvW, 2400);
        assert.equal(a.dhwW, 1125 + expected);
        assert.equal(result.grid[0].valueW, expected - rest);
        assert.equal(h.series('MyPV_DHW')[0].valueW, a.dhwW);
        balance(result, pvW);
        h.put(h.run('CFG.dp.lpcState'), 'limited');
        assert.equal(h.plan({pvW, slots: 1}).allocation[0].dhwPvTrimW, undefined);
        h.put(h.run('CFG.dp.lpcState'), 'unlimitedControlled');
        for (const id of h.run('CFG.dp.dhwTemps')) h.put(id, 76);
        assert.equal(h.plan({pvW, slots: 1}).allocation[0].dhwW, 0);
    }
});

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

test('SunEnergy forecast shares a saturated battery with one-phase whole-amp vehicle steps', () => {
    const h = fixture({...coordinatedBattery, batteryDispatchMode: 'sunenergy-heads', batteryPresent: true,
        wb0ControlEnabled: true});
    battery(h, 24, 15);
    car(h, 0, {soc: 54, minimum: 50, target: 90, capacity: 32});
    h.run(`function batteryHeadsMode() { return true; }
        function batteryPlanningProfile() { return {valid:true, capacityValid:true, capacityKWh:15,
            soc:24, deviceMinSoc:20, deviceMaxSoc:100, maxChargeW:2400, maxDischargeW:2400}; }`);
    // Four morning slots from the 23 November forecast, then two
    // increasing PV slots and a falling edge. House load already deducted.
    const pvW = [3272.5, 3240.5, 3240.5, 3162, 3850, 4100, 2400];
    const r = h.plan({pvW, slots: pvW.length});
    assert.deepEqual(r.cars[0].map(s => s.currentA), [6, 6, 6, 6, 7, 8, 0]);
    assert.deepEqual(r.allocation.map(s => s.batteryW), [1892.5, 1860.5, 1860.5, 1782, 2240, 2260, 2400]);
    assert.ok(r.grid.every(s => Math.abs(s.valueW) <= 1), 'no modeled import or export');
    assert.ok(h.series('BatterySoC').every(s => s.value_pct >= 20), 'device reserve remains binding');
    balance(r, pvW);

    // The hard floor (not the soft target) still blocks sharing.
    h.run('batteryPlanningProfile = () => ({valid:true,capacityValid:true,capacityKWh:15,soc:20,deviceMinSoc:20,deviceMaxSoc:100,maxChargeW:2400,maxDischargeW:2400})');
    const floor = h.plan({pvW: 3272.5, slots: 1});
    assert.equal(floor.cars[0][0].currentA, 0);
    assert.equal(floor.allocation[0].batteryW, 2400);
    h.run('batteryPlanningProfile = () => ({valid:true,capacityValid:true,capacityKWh:15,soc:24,deviceMinSoc:20,deviceMaxSoc:100,maxChargeW:2400,maxDischargeW:2400})');
    h.put(h.run('CFG.dp.lpcState'), 'limited');
    const constrained = h.plan({pvW: 3272.5, slots: 1});
    assert.equal(constrained.cars[0][0].currentA, 0, 'no special sharing under a group limit');
    h.put(h.run('CFG.dp.lpcState'), 'unlimitedControlled');
    h.put('ems.0.Devices.MyPV_DHW.Present', true);
    h.put('ems.0.Config.DHWMinTemperature_C', 40);
    h.put('ems.0.Config.DHWTargetTemperature_C', 70);
    h.put('ems.0.Config.DHWParallelDistributionEnabled', true);
    h.put(h.run('CFG.dp.dhwParallelRelease'), true);
    for (const id of h.run('CFG.dp.dhwTemps')) h.put(id, 55);
    const warm = h.plan({pvW: 3272.5, slots: 1});
    assert.equal(warm.cars[0][0].currentA, 6);
    assert.equal(warm.allocation[0].dhwW, 0, 'optional heat stays behind battery and vehicle');
    for (const id of h.run('CFG.dp.dhwTemps')) h.put(id, 35);
    const cold = h.plan({pvW: 3272.5, slots: 1});
    assert.ok(cold.allocation[0].mandatoryThermalW > 0, 'cold service request preserved');
    assert.ok(cold.allocation[0].dhwW >= Math.min(3272.5, cold.allocation[0].mandatoryThermalW));
    balance(cold, 3272.5);
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

test('paced Mii departure reaches minimum with no PV alongside the preferred EQE', () => {
    const h = fixture({wb0DeadlineEnabled: true, wb0TaperEnabled: true}, 10);
    car(h, 0, {soc: 56.3, minimum: 100, target: 100, capacity: 32.3});
    car(h, 2, {soc: 50, minimum: 90, capacity: 80, priority: true});
    // The first and last slots both have a partial charging interval.
    const departure = new Date(h.now + (8 * 60 + 7) * 60000);
    h.put('ems.0.Vehicles.Wallbox0.DepartureTime', departure.toTimeString().slice(0, 5));
    const r = h.plan({slots: 35});
    assert.equal(r.cars[0][0].currentA, 9);
    assert.equal(r.cars[2][0].currentA, 6);
    const requiredKWh = 0.437 * 32.3 / 0.9;
    const {plannedEnergy} = require('../lib/planning-explanation');
    const planned = plannedEnergy(r.cars[0], h.now, +departure);
    assert.ok(planned >= requiredKWh - 0.01, `${planned} kWh planned for ${requiredKWh} kWh required: ${r.cars[0].map(s => s.valueW)}`);
    assert.ok(r.cars[0].every(s => s.timestamp < +departure || s.valueW === 0));
    balance(r, 0);
});

test('phase and group protection limit a departure before discretionary priority', () => {
    const h = fixture({wb0DeadlineEnabled: true});
    car(h, 0, {soc: 50, minimum: 70, target: 100, capacity: 50});
    car(h, 2, {minimum: 70, priority: true});
    const departure = new Date(h.now + 2 * 3600000);
    h.put('ems.0.Vehicles.Wallbox0.DepartureTime', departure.toTimeString().slice(0, 5));
    h.put(h.run('CFG.dp.lpcState'), 'limited');
    h.put(h.run('CFG.dp.lpcLimit'), 1840);
    const r = h.plan({slots: 8});
    assert.deepEqual(r.cars.map(series => series[0].currentA), [8, 0, 0]);
    assert.ok(r.cars[0].every(s => s.valueW <= 1840));
    assert.ok(require('../lib/planning-explanation').plannedEnergy(r.cars[0], h.now, +departure) < 10 / 0.9);
    balance(r, 0);
});

test('confirmed three-phase departure uses three phase budgets and only the time before departure', () => {
    const h = fixture({wb1DeadlineEnabled: true, wb1PhaseControlMode: 'script', wb1PhaseModeId: 'mode1'}, 2);
    car(h, 1, {soc: 50, minimum: 90, target: 95, capacity: 60, phases: 3, maxA: 16});
    h.put('mode1', 2);
    const departure = new Date(h.now + 5 * 60000);
    h.put('ems.0.Vehicles.Wallbox1.DepartureTime', departure.toTimeString().slice(0, 5));
    const r = h.plan({slots: 2});
    const slot = r.cars[1][0];
    assert.equal(slot.currentA, 16);
    assert.equal(slot.phases, 3);
    assert.equal(slot.chargingUntil, +departure);
    assert.ok(Math.abs(slot.chargingMinutes - 5) < 0.001);
    assert.ok(Math.abs(require('../lib/planning-explanation').plannedEnergy(r.cars[1], h.now, +departure) - 0.92) < 0.001);
    balance(r, 0);
});

for (const parallel of [false, true]) test(`two departures share time when protection allows only one running car, parallel=${parallel}`, () => {
    const h = fixture({wb0DeadlineEnabled: true, wb2DeadlineEnabled: true, wallboxParallelChargingEnabled: parallel});
    for (const wb of [0, 2]) {
        car(h, wb, {soc: 50, minimum: 60, target: 60, capacity: 15, priority: wb === 2});
        const departure = new Date(h.now + (wb === 0 ? 90 : 120) * 60000);
        h.put(`ems.0.Vehicles.Wallbox${wb}.DepartureTime`, departure.toTimeString().slice(0, 5));
    }
    h.put(h.run('CFG.dp.lpcState'), 'limited');
    h.put(h.run('CFG.dp.lpcLimit'), 2300);
    const r = h.plan({slots: 8});
    assert.deepEqual(r.cars.map(series => series[0].currentA), [10, 0, 0]);
    for (const wb of [0, 2])
        assert.ok(require('../lib/planning-explanation').plannedEnergy(r.cars[wb], h.now, h.now + (wb ? 120 : 90) * 60000) >= 1.5 / 0.9 - 0.002);
    assert.ok(r.grid.every(slot => slot.valueW <= 2300));
    balance(r, 0);
});

test('a new forecast starts from the personal live step and keeps later simulated grants private', () => {
    const h = fixture({wb0DeadlineEnabled: true, wb0TaperEnabled: true});
    car(h, 0, {soc: 93.9, minimum: 100, target: 100, capacity: 32.3});
    const departure = new Date(h.now + 82 * 60000);
    h.put('ems.0.Vehicles.Wallbox0.DepartureTime', departure.toTimeString().slice(0, 5));
    assert.equal(h.plan({slots: 6}).cars[0][0].currentA, 9);
    assert.equal(h.run('liveDepartureGrants[0]'), null);
    h.run('liveDepartureGrants[0] = departureGrant(vehicleState(0), 2300, 2300, 1, 230, Date.now(), Date.now() + 10000)');
    const before = h.run('JSON.stringify(liveDepartureGrants)');
    const plan = h.plan({slots: 6});
    assert.equal(plan.cars[0][0].currentA, 10);
    assert.equal(h.run('JSON.stringify(liveDepartureGrants)'), before);
    balance(plan, 0);
});

const eveningStart = new Date(2026, 10, 21, 19, 30).getTime();
const nextDeparture = eveningStart + 16.5 * 3600000;
const solarStart = eveningStart + 57 * 900000;
const morningSurplus = [701.5, 646.5, 575, 851.5, 1978, 1992, 1885, 1928.5, 1857.5, 1921.5, 1865, 1823, 1626.5];
const overnightPv = [...Array(53).fill(0), ...morningSurplus.map(w => w + 1000), 3000, 3000];

function departureFixture(start = eveningStart, minute = 5, soc = 81.1, config = {}) {
    const h = fixture({...coordinatedBattery, wb2DeadlineEnabled: true, wb2CommissioningMaxA: 32, ...config}, minute, start);
    car(h, 2, {soc, minimum: 90, target: 90, capacity: 90.6, maxA: 20, phases: 3, priority: true});
    h.put('ems.0.Vehicles.Wallbox2.DepartureTime', new Date(nextDeparture).toTimeString().slice(0, 5));
    h.put('ems.0.Config.WallboxStartDelay_s', 300);
    return h;
}

test('EQE keeps PV headroom overnight and reaches the departure minimum from quantized morning PV', () => {
    const h = departureFixture();
    battery(h, 62, 15.06);
    h.put('ems.0.Config.BatteryEfficiency_pct', 92);
    car(h, 0, {soc: 27.7, minimum: 50, target: 90, capacity: 32.3});
    car(h, 1, {soc: 50, minimum: 50, target: 90, capacity: 90});
    const r = h.plan({houseW: 1000, pvW: overnightPv, slots: overnightPv.length});
    const eqe = r.cars[2], proof = eqe[0].departurePv;
    assert.ok(proof, 'a usable PV window should replace part of the overnight charge');
    assert.equal(proof.releaseAt, solarStart);
    assert.equal(proof.reservePct, 87.2);
    assert.equal(proof.minimumSocPct, 90);
    const energies = h.run('departurePvEnergy(' + JSON.stringify(eqe) + ','
        + JSON.stringify(r.allocation) + ',' + h.now + ',' + solarStart + ',' + (nextDeparture - 900000) + ')');
    assert.ok(Math.abs(energies.earlyGrid - (87.2 - 81.1) * 0.906 / 0.9) < 0.003);
    assert.ok(energies.solar > 2.80);
    assert.ok(Math.abs(energies.delivered * 0.9 / 0.906 + 81.1 - 90) < 0.003);
    assert.ok(eqe.slice(0, 57).some((p, i) => i > 10 && p.valueW === 0));
    assert.ok(eqe.slice(57, 65).some(p => p.valueW >= 1610));
    assert.ok(eqe.slice(65).every(p => p.valueW === 0));
    assert.ok(r.cars[0].every(p => !p.departurePv));
    balance(r, overnightPv, 1000);

    // Exercise the fresh-plan reader also used directly by the wallbox output.
    h.run(fs.readFileSync(path.join(__dirname, '../lib/engine/realtime.js'), 'utf8'));
    const policy = () => h.run('wallboxReadinessPolicy(2,90,Date.now(),null,null,87.2)');
    assert.equal(policy()?.reservePct, 87.2);
    h.run('updateVehicles()');
    assert.match(h.states.get('ems.0.Vehicles.Wallbox2.Status').val, /PV-Fenster/);
    h.put('ems.0.Vehicles.Wallbox2.DepartureTime', new Date(nextDeparture - 3600000).toTimeString().slice(0, 5));
    assert.equal(policy(), null);
    h.put('ems.0.Vehicles.Wallbox2.DepartureTime', new Date(nextDeparture).toTimeString().slice(0, 5));
    h.put('ems.0.Plan.LastUpdate', h.now - 21 * 60000);
    assert.equal(policy(), null);
});

test('the EQE completes with zero PV from the reserved overnight SoC, including the 15 minute finish margin', () => {
    const h = departureFixture(solarStart, 0, 87.2);
    const r = h.plan({houseW: 1000, pvW: 0, slots: 12});
    const eqe = r.cars[2];
    assert.ok(eqe.every(p => !p.departurePv));
    assert.ok(eqe[0].valueW >= 1380);
    const energy = require('../lib/planning-explanation').plannedEnergy(eqe, h.now, nextDeparture - 900000);
    assert.ok(Math.abs(87.2 + energy * 0.9 / 0.906 - 90) < 0.01);
});

function rollingDeparture() {
    const now = new Date(2026, 10, 22, 3, 4).getTime();
    const h = departureFixture(now, 0, 88.1);
    h.run(fs.readFileSync(path.join(__dirname, '../lib/engine/realtime.js'), 'utf8'));
    const pv = Array.from({length: 40}, (_, i) => i >= 27 && i < 35 ? 3600 : 0);
    const plan = h.plan({pvW: pv, houseW: 1000, slots: pv.length});
    const initial = plan.cars[2][0].departurePv;
    assert.ok(initial && initial.reservePct <= 88.1 && initial.releaseAt === solarStart);
    const rebuild = () => { h.run('buildDevicePlan(data); updateVehicles()'); return h.series('Wallbox2'); };
    return {h, initial, rebuild};
}

test('03:04 EQE rebuild gives a missing dark PV sample zero watts and keeps the 09:45 window', () => {
    const {h, initial, rebuild} = rollingDeparture();
    h.run("data.pv[1].source = 'unavailable'; data.pv[1].valueW = 6000");
    const result = rebuild();
    assert.equal(result[0].departurePv.releaseAt, initial.releaseAt);
    assert.equal(result[0].departurePv.backupUntil, undefined);
    assert.equal(h.series('Allocation')[1].pvW, 0);
    assert.ok(result.slice(0, 27).every(slot => slot.valueW === 0));
    assert.equal(h.states.get('ems.0.Vehicles.Wallbox2.MustCharge').val, false);
});

test('a zero-PV fallback covers the measured night deficit at minimum current before 11:45', () => {
    const {h, rebuild} = rollingDeparture();
    h.run('data.pv.forEach(p => { p.valueW = 0; })');
    const eqe = rebuild(), hold = eqe[0].departurePv;
    const finish = nextDeparture - 15 * 60000;
    const need = (90 - 88.1) * 90.6 / 90;
    assert.equal(hold.releaseAt, solarStart);
    assert.equal(hold.backupUntil, finish);
    assert.equal(hold.backupMinimumW, 1380);
    assert.equal(hold.backupAcKWh, (finish - solarStart - 300000) * 1380 * 0.8 / 3600000000);
    assert.ok(hold.backupAcKWh >= need && hold.backupAcKWh - 0.25 * 1.38 * 0.8 < need);
    assert.ok(eqe.filter(s => s.timestamp < hold.releaseAt).every(s => s.valueW === 0));
    const energy = require('../lib/planning-explanation').plannedEnergy(eqe, h.now, finish);
    assert.ok(Math.abs(energy - need) < 0.003);
    assert.equal(rebuild()[0].departurePv.releaseAt, hold.releaseAt);
    assert.match(h.states.get('ems.0.Vehicles.Wallbox2.Status').val, /Nachladung ab 09:45/);
});

test('a previous solar plan cannot defer an unearned pause, a new session, a competing departure or unsafe recovery', () => {
    for (const reason of ['below reserve', 'replug', 'departure edit', 'mobile reserve', 'manual', 'grid limit', 'house gap', 'competing']) {
        const {h, initial, rebuild} = rollingDeparture();
        h.run('data.pv.forEach(p => { p.valueW = 0; })');
        if (reason === 'below reserve') h.put(h.run('CFG.dp.wallboxSoc[2]'), initial.reservePct - 0.1);
        if (reason === 'replug') h.states.get('ems.0.Vehicles.Wallbox2.Connected').lc = h.now - 1;
        if (reason === 'departure edit') h.put('ems.0.Vehicles.Wallbox2.DepartureTime', '11:45');
        if (reason === 'mobile reserve') h.put('ems.0.Vehicles.Wallbox2.MobilityReserve_pct', 89);
        if (reason === 'manual') h.put(h.run('CFG.dp.wallboxManualMinCurrent[2]'), 10);
        if (reason === 'grid limit') h.put('ems.0.Config.HouseConnectionWorkingLimit_A', 8);
        if (reason === 'house gap') h.run('data.house[8].valueW = null');
        if (reason === 'competing') {
            h.run('nativeConfig.wb0DeadlineEnabled = true');
            car(h, 0, {soc: 40, minimum: 60});
            h.put('ems.0.Vehicles.Wallbox0.DepartureTime', '11:00');
        }
        assert.ok(rebuild().every(slot => !slot.departurePv), reason);
    }
});

test('weak PV, local limits, manual minimum current and competing departures retain the immediate minimum', () => {
    for (const mode of ['weak', 'limited', 'manual', 'competing', 'lowSoc']) {
        const h = departureFixture(eveningStart, 5, mode === 'lowSoc' ? 29 : 81.1,
            {wb0DeadlineEnabled: mode === 'competing'});
        if (mode === 'limited') h.put('ems.0.Config.HouseConnectionWorkingLimit_A', 7);
        if (mode === 'manual') h.put(h.run('CFG.dp.wallboxManualMinCurrent[2]'), 10);
        if (mode === 'competing') {
            car(h, 0, {soc: 35, minimum: 75, target: 90});
            h.put('ems.0.Vehicles.Wallbox0.DepartureTime', new Date(nextDeparture).toTimeString().slice(0, 5));
        }
        const r = h.plan({houseW: 1000, pvW: mode === 'weak' ? 2300 : overnightPv, slots: overnightPv.length});
        assert.ok(r.cars[2].every(p => !p.departurePv), mode);
    }
});

function summerWindow({nightW = 500, lastFullDays = 2, disable = false, hardMax = 100, cloudy = false, startSoc = 57} = {}) {
    const h = fixture({...coordinatedBattery, batteryAdaptiveTargetsEnabled: !disable}, 0, Date.parse('2026-07-20T04:00:00Z'));
    battery(h, startSoc, 15);
    h.put('ems.0.Config.BatteryMaxSoC_pct', hardMax);
    h.put('ems.0.Config.BatterySelfConsumptionEnabled', true);
    h.put('ems.0.Config.BatteryForecastSafetyFactor_pct', 80);
    h.put('ems.0.Devices.Battery.LastFullChargeAt', lastFullDays ? h.now - lastFullDays * 86400000 : 0);
    const pvW = Array.from({length: 192}, (_, i) => {
        const hour = i % 96 / 4;
        return hour < 14 && !(cloudy && i >= 96) ? Math.round(9000 * Math.sin((hour + 0.5) / 15 * Math.PI)) : 0;
    });
    const houseW = pvW.map(w => w > 0 ? 550 : nightW);
    const plan = h.plan({pvW, houseW, slots: 192});
    return {h, plan, info: JSON.parse(h.states.get('ems.0.Plan.BatteryOperatingWindow_JSON').val)};
}

test('two sunny days lower all three targets and still supply the same household energy', () => {
    const {h, info} = summerWindow();
    assert.deepEqual(info.targets, {morning: 50, afternoon: 70, late: 80});
    assert.equal(info.offsetPct, 20);
    assert.ok(info.lowestForecastPct >= 15);
    assert.ok(h.series('BatterySoC').every(p => p.value_pct <= 80.01));
    assert.equal(info.calibration, null);
    const full = summerWindow({disable: true});
    assert.ok(h.states.get('ems.0.Plan.ExpectedImport_kWh').val <= full.h.states.get('ems.0.Plan.ExpectedImport_kWh').val + 0.01);
    const highStart = summerWindow({startSoc: 95});
    assert.ok(highStart.h.series('BatterySoC')[0].value_pct > 90, 'a lower ceiling cannot discard stored energy');
});

test('larger night demand selects 90 or 100 and the 48-hour proof reacts to a cloudy following day', () => {
    assert.equal(summerWindow({nightW: 1050}).info.offsetPct, 10);
    assert.equal(summerWindow({nightW: 1340}).info.offsetPct, 0);
    assert.equal(summerWindow({cloudy: true}).info.offsetPct, 0);
    assert.equal(summerWindow({disable: true}).info.offsetPct, 0);
});

test('a due full charge uses the late solar tail once and returns to the lower ceiling the next day', () => {
    const {h, info, plan} = summerWindow({lastFullDays: 32});
    assert.equal(info.offsetPct, 20);
    assert.ok(info.calibration, JSON.stringify(info));
    const {start, end} = info.calibration;
    assert.ok(start >= h.now + 8 * 3600000 && end <= h.now + 15 * 3600000);
    const stages = h.series('BatteryStage'), soc = h.series('BatterySoC');
    assert.ok(stages.filter(p => p.target_pct === 100).every(p => p.timestamp >= start && p.timestamp < end));
    assert.ok(soc.some(p => p.timestamp >= start && p.timestamp < end && p.value_pct >= 99.9));
    assert.ok(plan.allocation.filter(p => p.timestamp >= start && p.timestamp < end)
        .every(p => p.batteryGridChargeW <= 1 && p.gridW <= 0));
    assert.equal(Math.max(...stages.slice(96).map(p => p.target_pct)), 80);
    assert.equal(h.states.get('ems.0.Devices.Battery.LastFullChargeAt').val, h.now - 32 * 86400000);
    assert.equal(summerWindow({lastFullDays: 32, hardMax: 90}).info.calibration, null);
    assert.ok(summerWindow({lastFullDays: 0}).info.calibration);
});
