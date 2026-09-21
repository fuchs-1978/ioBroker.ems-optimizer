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
    const plan = ({pvW = 10000, houseW = 0, slots = 8} = {}) => run(`buildDevicePlan({
        pv: Array.from({length: ${slots}}, (_, i) => ({timestamp: Date.now() + i * 900000, valueW: ${pvW}})),
        house: Array.from({length: ${slots}}, () => ({valueW: ${houseW}})),
        prices: {total: Array.from({length: ${slots}}, () => ({value_ct_kWh: 28.89}))}
    })`);
    return {put, states, run, plan, now};
}

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
