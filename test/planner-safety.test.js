'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function engine(config = {}) {
    const states = new Map();
    const now = new Date(2026, 8, 21, 12, 0, 0).getTime();
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const put = (id, val) => states.set(id, {val, ts: now, ack: true});
    const context = vm.createContext({nativeConfig: config, Date: Clock,
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => { if (!states.has(id)) put(id, val); },
        setState: put, log: () => {}});
    for (const file of ['core', 'history', 'forecast', 'vehicles', 'planner', 'config-mapping']) {
        const source = fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) => key);
        vm.runInContext(source, context);
    }
    const run = source => vm.runInContext(source, context);
    run('createStates(); historyReady = true;');
    for (let wb = 0; wb < 3; wb++) put(`ems.0.Devices.Wallbox${wb}.Present`, false);
    put('ems.0.Devices.Battery.Present', false);
    put('ems.0.Devices.MyPV_Heating.Present', false);
    const plan = ({pvW = 10000, houseW = 0, price = 28.89, slots = 8} = {}) => {
        const at = (value, i) => Array.isArray(value) ? value[i] : value;
        const data = {
            pv: Array.from({length: slots}, (_, i) => ({timestamp: now + i * 900000, valueW: at(pvW, i)})),
            house: Array.from({length: slots}, (_, i) => ({valueW: at(houseW, i)})),
            prices: {total: Array.from({length: slots}, (_, i) => ({value_ct_kWh: at(price, i)}))}
        };
        run(`buildDevicePlan(${JSON.stringify(data)})`);
        return data;
    };
    const series = name => JSON.parse(states.get(`ems.0.Plan.${name}_48h_JSON`).val);
    return {put, states, run, plan, series, now};
}

function vehicle(h, {wb = 2, soc = 20, minimum = 50, target = 80,
    capacityKWh = 32.3, maximumW = 22000, maximum1pA = 20,
    maximum3pA = 32, maximumPhases = 3, phaseSwitch = true,
    departure = ''} = {}) {
    h.put(`ems.0.Devices.Wallbox${wb}.Present`, true);
    h.put(`DP_WB${wb}_CAR`, 2);
    h.put(`DP_WB${wb}_SOC`, soc);
    h.put(`DP_WB${wb}_MIN_SOC`, minimum);
    h.put(`DP_WB${wb}_TARGET`, target);
    h.put(`DP_WB${wb}_ALLOW`, true);
    h.put(`DP_WB${wb}_RELEASE`, soc < minimum ? 2 : 1);
    h.put(`ems.0.Config.Wallbox${wb}VehicleCapacity_kWh`, capacityKWh);
    h.put(`ems.0.Config.Wallbox${wb}MaxPower_W`, maximumW);
    h.put(`ems.0.Vehicles.Wallbox${wb}.MinCurrent1P_A`, 6);
    h.put(`ems.0.Vehicles.Wallbox${wb}.MaxCurrent1P_A`, maximum1pA);
    h.put(`ems.0.Vehicles.Wallbox${wb}.MinCurrent3P_A`, 6);
    h.put(`ems.0.Vehicles.Wallbox${wb}.MaxCurrent3P_A`, maximum3pA);
    h.put(`ems.0.Vehicles.Wallbox${wb}.MaximumPhases`, maximumPhases);
    h.put(`ems.0.Vehicles.Wallbox${wb}.PhaseSwitchEnabled`, phaseSwitch);
    h.put(`ems.0.Vehicles.Wallbox${wb}.DepartureTime`, departure);
}

function dhw(h, {volumeL = 500, temperature = 51.6, minimum = 40, target = 76} = {}) {
    h.put('ems.0.Devices.MyPV_DHW.Present', true);
    h.put('ems.0.Config.DHWVolume_l', volumeL);
    h.put('ems.0.Actual.DHWTemperature_C', temperature);
    h.put('ems.0.Config.DHWMinTemperature_C', minimum);
    h.put('ems.0.Config.DHWTargetTemperature_C', target);
    return Math.max(0, volumeL * 1.163 * (target - temperature) / 1000);
}

function near(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
}

function balancedPlan(h, data) {
    const wallboxes = [0, 1, 2].map(wb => h.series(`Wallbox${wb}`));
    const hotWater = h.series('MyPV_DHW');
    const heating = h.series('MyPV_Heating');
    const battery = h.series('BatteryPower');
    const grid = h.series('GridPower');
    const allocations = h.series('Allocation');
    assert.equal(allocations.length, data.pv.length);
    assert.equal(h.states.get('ems.0.Plan.AllocationSource').val, data.houseSource || 'data.house');
    const chartPairs = [
        ['BatteryPower', 'BatteryPower', 'valueW'],
        ['BatterySoC', 'BatterySoC', 'value_pct'],
        ['BatteryTargetSoC', 'BatteryTargetSoC', 'value_pct'],
        ['MyPV_DHW', 'MyPV_DHW', 'valueW'],
        ['MyPV_Heating', 'MyPV_Heating', 'valueW'],
        ['PVBoost', 'PVBoostBudget', 'budgetW'],
        ['ParallelDistribution', 'ParallelDistribution', 'value'],
        ...[0, 1, 2].map(wb => [`Wallbox${wb}`, `Wallbox${wb}`, 'valueW']),
        ['GridPower', 'GridPower', 'valueW']
    ];
    for (const [planName, chartName, key] of chartPairs) {
        const chart = JSON.parse(h.states.get(`ems.0.Chart.${chartName}_48h_json_chart`).val);
        assert.deepEqual(chart, h.series(planName).map(slot => ({ts: String(slot.timestamp), val: slot[key]})),
            `${chartName} chart matches its plan`);
    }
    allocations.forEach((slot, i) => {
        const loadsW = data.house[i].valueW + hotWater[i].valueW + heating[i].valueW
            + battery[i].valueW + wallboxes.reduce((sum, series) => sum + series[i].valueW, 0);
        assert.equal(grid[i].valueW, loadsW - data.pv[i].valueW,
            `published energy balance in slot ${i}`);
        assert.equal(slot.gridW, grid[i].valueW, `diagnostic and published grid in slot ${i}`);
        near(slot.pvAfterBaseW, Math.max(0, slot.pvW - slot.baseW), `initial PV in slot ${i}`);
        near(slot.wallboxW, slot.wallboxPvW + slot.wallboxGridW, `wallbox sources in slot ${i}`);
        near(slot.dhwW, slot.dhwPvW + slot.dhwGridW, `DHW sources in slot ${i}`);
        near(slot.heatingW, slot.heatingPvW + slot.heatingGridW, `heating sources in slot ${i}`);
        near(Math.max(0, slot.batteryW), slot.batteryPvW + slot.batteryGridChargeW,
            `battery charging sources in slot ${i}`);
        near(slot.pvAfterBaseW,
            slot.wallboxPvW + slot.dhwPvW + slot.heatingPvW + slot.batteryPvW + slot.remainingPvW,
            `PV is allocated once in slot ${i}`);
        near(slot.baseW + slot.wallboxW + slot.dhwW + slot.heatingW + slot.batteryW - slot.pvW,
            slot.rawGridW, `unrounded energy balance in slot ${i}`);
        for (const key of ['wallboxPvW', 'wallboxGridW', 'dhwPvW', 'dhwGridW',
            'heatingPvW', 'heatingGridW', 'batteryPvW', 'batteryGridChargeW', 'remainingPvW',
            'releasedPvW', 'discardedGridRequestW']) {
            assert.ok(Number.isFinite(slot[key]) && slot[key] >= 0, `${key} in slot ${i}`);
        }
        assert.ok(wallboxes.filter(series => series[i].valueW > 0).length <= 1,
            `at most one wallbox in slot ${i}`);
    });
    return allocations;
}

test('issue #54: capped mandatory WB2 charging does not invent PV for hot water', () => {
    const h = engine();
    vehicle(h);
    dhw(h);
    const data = h.plan({pvW: 2954, houseW: 615, slots: 1});
    const wb = h.series('Wallbox2')[0];
    assert.equal(wb.phases, 1);
    assert.equal(wb.currentA, 20);
    assert.equal(wb.valueW, 4600);
    assert.equal(h.series('MyPV_DHW')[0].valueW, 0);
    assert.equal(h.series('GridPower')[0].valueW, 2261);
    const [allocation] = balancedPlan(h, data);
    assert.equal(allocation.wallboxPvW, 2339);
    assert.equal(allocation.wallboxGridW, 2261);
    assert.equal(allocation.releasedPvW, 0);
    assert.equal(allocation.discardedGridRequestW, 17400);
    assert.equal(allocation.dhwReason, 'off');
});

test('mandatory and deadline phase limits cannot release requested grid power as PV', () => {
    for (const scenario of [
        {name: 'mandatory 6 A one-phase cap', options: {maximum1pA: 6}, expectedW: 1380},
        {name: 'deadline one-phase cap', deadline: true,
            options: {soc: 50, minimum: 20, maximum1pA: 16, maximumPhases: 1,
                phaseSwitch: false, departure: '12:15'}, expectedW: 3680},
        {name: 'deadline three-phase cap', deadline: true,
            options: {soc: 50, minimum: 20, maximum3pA: 6, departure: '12:15'}, expectedW: 4140}
    ]) {
        const h = engine({wb2DeadlineEnabled: Boolean(scenario.deadline), wb2LowSocStepsEnabled: false});
        vehicle(h, scenario.options);
        dhw(h);
        const data = h.plan({pvW: 1000, houseW: 500, slots: 1});
        assert.equal(h.series('Wallbox2')[0].valueW, scenario.expectedW, scenario.name);
        assert.equal(h.series('MyPV_DHW')[0].valueW, 0, scenario.name);
        assert.equal(h.series('GridPower')[0].valueW, scenario.expectedW - 500, scenario.name);
        const [allocation] = balancedPlan(h, data);
        assert.equal(allocation.releasedPvW, 0, scenario.name);
        assert.ok(allocation.discardedGridRequestW > 10000, scenario.name);
    }
});

test('discarded mandatory grid demand cannot feed heating, battery charging, or PV boost', () => {
    const h = engine();
    vehicle(h);
    h.put('ems.0.Devices.MyPV_DHW.Present', false);
    h.put('ems.0.Devices.MyPV_Heating.Present', true);
    h.put('ems.0.Config.HeatingBufferTemperature_C', 40);
    h.put('ems.0.Config.HeatingBufferMinTemperature_C', 35);
    h.put('ems.0.Config.HeatingBufferTargetTemperature_C', 50);
    h.put('ems.0.Devices.Battery.Present', true);
    h.put('ems.0.Config.BatteryManualSoC_pct', 20);
    h.put('ems.0.Config.BatterySelfConsumptionEnabled', false);
    const data = h.plan({pvW: 0, houseW: 615, slots: 4});
    for (const name of ['MyPV_Heating', 'BatteryPower']) {
        assert.deepEqual(h.series(name).map(slot => slot.valueW), [0, 0, 0, 0]);
    }
    assert.deepEqual(h.series('PVBoost').map(slot => slot.budgetW), [0, 0, 0, 0]);
    balancedPlan(h, data);
});

test('real PV left by whole-amp quantization remains available to hot water', () => {
    for (const scenario of [
        {pvW: 2954, expectedW: 2300, expectedDhwW: 39, phases: 1},
        {pvW: 10000, expectedW: 8970, expectedDhwW: 415, phases: 3}
    ]) {
        const h = engine();
        vehicle(h, {soc: 50, minimum: 20});
        dhw(h);
        const data = h.plan({pvW: scenario.pvW, houseW: 615, slots: 1});
        assert.equal(h.series('Wallbox2')[0].valueW, scenario.expectedW);
        assert.equal(h.series('Wallbox2')[0].phases, scenario.phases);
        assert.equal(h.series('MyPV_DHW')[0].valueW, scenario.expectedDhwW);
        assert.equal(h.series('GridPower')[0].valueW, 0);
        const [allocation] = balancedPlan(h, data);
        assert.equal(allocation.releasedPvW, scenario.expectedDhwW);
        assert.equal(allocation.discardedGridRequestW, 0);
        assert.equal(allocation.dhwReason, 'pv-surplus');
    }
});

test('parallel PV allocation preserves already planned DHW and a finite short final vehicle slot', () => {
    const h = engine();
    vehicle(h, {soc: 50, minimum: 20, target: 70, capacityKWh: 5.4});
    const dhwCapacityKWh = dhw(h, {volumeL: 1000 / 1.163, target: 61.6});
    h.put('DP_DHW_PARALLEL_RELEASE', true);
    const data = h.plan({pvW: 8615, houseW: 615, slots: 8});
    const wb = h.series('Wallbox2');
    assert.equal(h.series('ParallelDistribution')[0].value, 1);
    assert.deepEqual(wb.map(slot => slot.valueW), [3910, 890, 0, 0, 0, 0, 0, 0]);
    assert.equal(wb[1].currentA, 6);
    near(wb[1].chargingMinutes, 15 * 890 / 1380, 'final charge duration');
    assert.deepEqual(h.series('MyPV_DHW').map(slot => slot.valueW),
        [4090, 7110, 8000, 8000, 8000, 4800, 0, 0]);
    const allocations = balancedPlan(h, data);
    near(allocations.reduce((sum, slot) => sum + slot.wallboxW * 0.9 / 4000, 0), 1.08,
        'vehicle receives its finite battery energy');
    near(allocations.reduce((sum, slot) => sum + slot.dhwW / 4000, 0), dhwCapacityKWh,
        'hot water stops at remaining storage capacity');
    assert.equal(allocations[0].dhwBeforeQuantizationW, 4000);
    assert.equal(allocations[1].dhwBeforeQuantizationW, 7110);
    for (const slot of allocations) {
        near(slot.wallboxGridW + slot.dhwGridW, 0, 'parallel loads use PV');
        assert.ok(slot.wallboxW + slot.dhwW <= 8000 + 1e-7);
    }
});

test('fractional final energy respects both storage caps and published slot balances', () => {
    const h = engine({wb2LowSocStepsEnabled: false});
    vehicle(h, {soc: 49.9, minimum: 50, target: 50.1, capacityKWh: 10});
    const dhwCapacityKWh = dhw(h, {volumeL: 1});
    const data = h.plan({pvW: 1000, houseW: 615, slots: 4});
    const allocations = balancedPlan(h, data);
    near(allocations.reduce((sum, slot) => sum + slot.wallboxW * 0.9 / 4000, 0), 0.02,
        'fractional vehicle energy cap');
    near(allocations.reduce((sum, slot) => sum + slot.dhwW / 4000, 0), dhwCapacityKWh,
        'fractional thermal energy cap');
    assert.equal(h.series('Wallbox2')[0].currentA, 6);
    assert.ok(h.series('Wallbox2')[0].chargingMinutes < 1);
    assert.ok(allocations.slice(1).every(slot => slot.wallboxW === 0 && slot.dhwW === 0));
});

test('cheap minimum-temperature hot water remains explicit grid heating', () => {
    const h = engine();
    vehicle(h);
    dhw(h, {temperature: 39});
    const data = h.plan({pvW: 2954, houseW: 615, price: [5, 35, 35, 35], slots: 4});
    assert.deepEqual(h.series('MyPV_DHW').map(slot => slot.valueW), [9000, 0, 0, 0]);
    assert.deepEqual(h.series('Wallbox2').map(slot => slot.valueW), [0, 4600, 4600, 4600]);
    assert.deepEqual(h.series('GridPower').map(slot => slot.valueW), [6661, 2261, 2261, 2261]);
    const allocations = balancedPlan(h, data);
    assert.equal(allocations[0].dhwReason, 'minimum-temperature');
    assert.equal(allocations[0].dhwPvW, 2339);
    assert.equal(allocations[0].dhwGridW, 6661);
    assert.equal(allocations[1].dhwReason, 'off');
});

test('production forecast uses baseload rather than historical total house demand for the plan', () => {
    const h = engine();
    h.put('ems.0.Devices.MyPV_DHW.Present', false);
    h.run(`
        for (const day of DAY_TYPES) {
            historyProfiles.houseTotal[day].fill(9000);
            historyProfiles.baseload[day].fill(615);
        }
        buildForecast();
    `);
    const forecast = name => JSON.parse(h.states.get(`ems.0.Forecast.${name}_48h_JSON`).val);
    const pv = forecast('PV');
    const house = forecast('Baseload');
    assert.equal(house.length, 192);
    assert.ok(forecast('HouseLoad').every(slot => slot.valueW === 9000));
    assert.ok(house.every(slot => slot.valueW === 615));
    assert.ok(h.series('GridPower').every(slot => slot.valueW === 615));
    balancedPlan(h, {pv, house, houseSource: 'Forecast.Baseload_48h_JSON'});
    for (const name of ['PV', 'HouseLoad', 'Baseload']) {
        const chart = JSON.parse(h.states.get(`ems.0.Chart.${name}_48h_json_chart`).val);
        assert.deepEqual(chart, forecast(name).map(slot => ({ts: String(slot.timestamp), val: slot.valueW})));
    }
});

test('DHW planner never schedules more heat than the remaining storage capacity', () => {
    const h = engine();
    h.put('ems.0.Config.DHWVolume_l', 1000 / 1.163);
    h.put('ems.0.Actual.DHWTemperature_C', 40);
    h.put('ems.0.Config.DHWTargetTemperature_C', 41);
    h.put('ems.0.Config.DHWMinTemperature_C', 45);
    h.plan();
    const plan = JSON.parse(h.states.get('ems.0.Plan.MyPV_DHW_48h_JSON').val);
    assert.equal(plan[0].valueW, 4000);
    assert.equal(plan.reduce((sum, slot) => sum + slot.valueW / 4000, 0), 1);
});

test('future enabled departure deadline enters forecast and charges at feasible deadline power', () => {
    const h = engine({wb0DeadlineEnabled: true, wb0LowSocStepsEnabled: false});
    h.put('ems.0.Devices.MyPV_DHW.Present', false);
    h.put('ems.0.Devices.Wallbox0.Present', true);
    h.put('DP_WB0_CAR', 2);
    h.put('DP_WB0_SOC', 50);
    h.put('DP_WB0_MIN_SOC', 20);
    h.put('DP_WB0_TARGET', 80);
    h.put('DP_WB0_ALLOW', true);
    h.put('DP_WB0_RELEASE', 1);
    h.put('ems.0.Config.Wallbox0VehicleCapacity_kWh', 11.04);
    h.put('ems.0.Config.Wallbox0MaxPower_W', 3680);
    h.put('ems.0.Vehicles.Wallbox0.MaxCurrent1P_A', 16);
    h.put('ems.0.Vehicles.Wallbox0.MinCurrent1P_A', 6);
    h.put('ems.0.Vehicles.Wallbox0.DepartureTime', '14:00');
    h.plan({pvW: 0, slots: 8});
    const plan = JSON.parse(h.states.get('ems.0.Plan.Wallbox0_48h_JSON').val);
    assert.equal(plan.slice(0, 4).some(slot => slot.valueW > 0), false);
    assert.ok(plan[4].valueW >= 3680, `deadline only schedules ${plan[4].valueW} W`);
    const batteryKWh = plan.reduce((sum, slot) => sum + slot.valueW / 4000 * 0.9, 0);
    // Public EnergyRequired_kWh is rounded to two decimals by the vehicle manager.
    assert.ok(Math.abs(batteryKWh - 3.31) < 0.001, `charged ${batteryKWh} kWh`);
});
