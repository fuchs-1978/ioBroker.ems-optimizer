'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(time = '2026-10-01T00:00:00Z') {
    const now = Date.parse(time), states = new Map();
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    const put = (suffix, val) => states.set(`ems.0.${suffix}`, {val, ack: true, ts: now});
    const context = vm.createContext({Date: Clock, nativeConfig: {},
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => { if (!states.has(id)) states.set(id, {val, ack: true, ts: now}); },
        setState: (id, val) => states.set(id, {val, ack: true, ts: now}), log() {}});
    for (const name of ['core', 'planner']) vm.runInContext(fs.readFileSync(path.join(__dirname, `../lib/engine/${name}.js`), 'utf8')
        .replaceAll('__ADAPTER_ROOT__', 'ems.0'), context);
    const run = source => vm.runInContext(source, context);
    run('createStates()');
    return {now, run, put, context};
}
function slots(h, prices) {
    const start = Math.floor(h.now / 900000) * 900000;
    return prices.map((price, i) => ({timestamp: start + i * 900000, price, priceValid: price !== null,
        pvW: 0, baseW: 0, residualPvW: 0, dhwW: 0, heatW: 0, wbW: [0, 0, 0]}));
}
function vehicle(h, index = 0, energy = 1.84) {
    h.put(`Config.Wallbox${index}PriceChargingEnabled`, true);
    return {index, eligible: true, belowMinimum: false, mustCharge: false, effectivePriorityScore: 1 - index / 10,
        latestStartTimestamp: 0, priority: 1, socValid: true, priceRemainingKWh: energy,
        priceDeadlineTimestamp: h.now + 6 * 3600000, priceSessionId: `session-${index}`, priceSessionValid: true,
        phaseSwitchEnabled: false, maximumPhases: 1, maximumPowerW: 3680,
        minCurrent1pA: 6, maxCurrent1pA: 16, minCurrent3pA: 6, maxCurrent3pA: 16};
}
function evPlan(h, data, vehicles) {
    h.context.input = {data, vehicles,
        plans: [0, 1, 2].map(wb => data.map(slot => ({timestamp: slot.timestamp, valueW: slot.wbW[wb]}))),
        allocations: data.map(() => ({}))};
    const reports = h.run('addPriceWallboxPlan(input.data,input.plans,input.allocations,input.vehicles,0.9,Date.now())');
    return {...h.context.input, reports};
}
function batteryPlan(h, data, overrides = {}) {
    h.context.input = {data, targets: data.map(() => ({targetPct: 70})), options: {
        capacity: 10, initialSoc: 20, minSoc: 20, maxSoc: 100, reservePct: 0,
        maxCharge: 3000, maxDischarge: 3000, efficiency: 0.9, safety: 0.8,
        selfConsumption: true, now: h.now, ...overrides}};
    return h.run('buildPriceBatteryPlan(input.data,input.targets,input.options)');
}

test('EV waits for the cheapest later contiguous price block and requests only needed AC energy', () => {
    const h = harness(), data = slots(h, [30, 30, 8, 8, 20, 20]);
    const result = evPlan(h, data, [vehicle(h)]);
    assert.deepEqual(Array.from(result.plans[0], p => p.gridChargeW || 0), [0, 0, 3680, 3680, 0, 0]);
    assert.ok(Math.abs(result.plans[0].reduce((sum, p) => sum + (p.plannedGridEnergyKWh || 0), 0) - 1.84) < 1e-9);
    assert.equal(result.plans[0][2].priceSessionId, 'session-0');
    assert.equal(result.plans[0][2].priceLimitCt, 8);
});

test('EV PV demand coverage, missing prices and invalid session never authorize extra import', () => {
    for (const mode of ['pv', 'missing', 'session']) {
        const h = harness(), data = slots(h, mode === 'missing' ? [null, null, null, null] : [10, 10, 30, 30]);
        const car = vehicle(h);
        if (mode === 'pv') { data[2].wbW[0] = 3680; data[3].wbW[0] = 3680; }
        if (mode === 'session') car.priceSessionValid = false;
        const result = evPlan(h, data, [car]);
        assert.ok(result.plans[0].every(p => !p.gridChargeW), mode);
    }
});

test('EV scheduling preserves mandatory occupancy and assigns only one vehicle per slot', () => {
    const h = harness(), data = slots(h, [5, 5, 10, 10, 15, 15]);
    data[0].wbW[2] = 1380; data[1].wbW[2] = 1380;
    const result = evPlan(h, data, [vehicle(h, 0), vehicle(h, 1)]);
    assert.equal(result.plans[0][2].gridChargeW, 3680);
    assert.equal(result.plans[1][4].gridChargeW, 3680);
    assert.ok(result.data.every(slot => slot.wbW.filter(w => w > 0).length === 1));
});

test('EV manual no-SoC budget gets a bounded final charge and negative price cap is respected', () => {
    const h = harness(), data = slots(h, [-1, -1, -3, -3]);
    const car = {...vehicle(h, 0, 0.4), socValid: false};
    h.put('Config.Wallbox0PriceMax_ct_kWh', -2);
    const result = evPlan(h, data, [car]);
    assert.ok(!result.plans[0][0].gridChargeW);
    const charged = result.plans[0].filter(p => p.gridChargeW > 0);
    assert.equal(charged.length, 2);
    assert.ok(charged.every(p => p.gridChargeW >= 1380));
    assert.equal(charged[0].chargingMinutes, 15);
    assert.ok(charged[1].chargingMinutes < 15);
    assert.equal(charged[0].priceChargeUntil, charged[1].timestamp);
    assert.ok(Math.abs(charged.reduce((sum, p) => sum + p.plannedGridEnergyKWh, 0) - 0.4) < 1e-8);
    assert.ok(charged.every(p => p.priceChargeUntil <= p.timestamp + 900000));
});

test('EV current-quarter capacity counts only remaining minute, never elapsed fourteen minutes', () => {
    const h = harness('2026-10-01T00:14:00Z'), data = slots(h, [1, 1, 1, 20]);
    const result = evPlan(h, data, [vehicle(h, 0, 0.4)]);
    assert.ok(result.plans[0][0].plannedGridEnergyKWh <= 3.68 / 60 + 1e-8);
    assert.ok(result.plans[0][0].chargingMinutes <= 1);
    assert.ok(Math.abs(result.plans[0].reduce((sum, p) => sum + (p.plannedGridEnergyKWh || 0), 0) - 0.4) < 1e-8);
});

test('battery buys only its future household shortage in cheaper later preceding blocks, including losses', () => {
    const h = harness(), data = slots(h, [12, 12, 5, 5, 40, 40]);
    data[4].baseW = data[5].baseW = 1000;
    const result = batteryPlan(h, data);
    assert.equal(result.slots[0].gridChargeW, 0);
    assert.equal(result.slots[1].gridChargeW, 0);
    assert.ok(result.slots[2].gridChargeW > 0 && result.slots[3].gridChargeW > 0);
    assert.ok(Math.abs(result.report.gridKWh - 0.5 / (0.9 * 0.9)) < 1e-6);
    assert.ok(result.slots[4].valueW < 0 && result.slots[5].valueW < 0);
    assert.ok(result.report.unmetHouseholdKWh < 1e-6);
});

test('battery PV sufficient for subsequent demand produces no grid purchases despite cheaper night', () => {
    const h = harness(), data = slots(h, [5, 5, 5, 5, 35, 35, 40, 40]);
    data[4].pvW = data[5].pvW = data[4].residualPvW = data[5].residualPvW = 3000;
    data[6].baseW = data[7].baseW = 1000;
    const result = batteryPlan(h, data);
    assert.equal(result.report.gridKWh, 0);
    assert.ok(result.report.unmetHouseholdKWh < 1e-8);
});

test('battery losses, absent prices, price cap and absence of useful load block speculative purchases', () => {
    for (const mode of ['loss', 'missing', 'cap', 'no-load']) {
        const h = harness(), data = slots(h, mode === 'missing' ? [null, null, 40, 40] : [20, 20, 25, 25]);
        if (mode !== 'no-load') data[2].baseW = data[3].baseW = 1000;
        if (mode === 'cap') h.put('Config.BatteryPriceMax_ct_kWh', -2);
        assert.equal(batteryPlan(h, data).report.gridKWh, 0, mode);
    }
});

test('battery retains bought energy through cheaper intervening household slots for the costly demand', () => {
    const h = harness(), data = slots(h, [5, 5, 3, 3, 40, 40]);
    data[2].baseW = data[3].baseW = data[4].baseW = data[5].baseW = 1000;
    const result = batteryPlan(h, data);
    // Cheapest eligible block is 2/3; household there is intentionally bought
    // directly while charging, and retained energy supplies the later demand.
    assert.equal(result.slots[0].gridChargeW, 0);
    assert.ok(result.slots[2].valueW > 0);
    assert.ok(result.slots[3].dischargeFloorPct > 20);
    assert.ok(result.slots[4].valueW < 0);
    assert.ok(result.slots[5].dischargeFloorPct <= 20 + 1e-8);
});

test('battery cannot buy future energy for an earlier deficit or exceed partial-current-slot charge capacity', () => {
    const h = harness('2026-10-01T00:14:00Z'), data = slots(h, [40, 5, 5, 40, 40]);
    data[0].baseW = data[3].baseW = data[4].baseW = 1000;
    const result = batteryPlan(h, data);
    assert.equal(result.slots[0].gridChargeW, 0);
    assert.ok(result.slots[0].unmetUsefulKWh > 0);
    assert.ok(result.slots.every(p => p.gridChargeW <= 3000 + 1e-8 && p.socPct <= 100));
});


test('tiny final EV demand is one contiguous shortened charge rather than split pulses', () => {
    const h = harness(), data = slots(h, [10, 10, 20, 20]);
    const result = evPlan(h, data, [vehicle(h, 0, 0.1)]);
    const charged = result.plans[0].filter(point => point.gridChargeW > 0);
    assert.equal(charged.length, 1);
    assert.ok(Math.abs(charged[0].chargingMinutes - 0.1 / 1.38 * 60) < 1e-8);
    assert.ok(Math.abs(charged[0].plannedGridEnergyKWh - 0.1) < 1e-8);
});

test('battery never buys an unfilled extra reserve at a loss to serve a tiny future demand', () => {
    const h = harness(), data = slots(h, [22.41, 22.41, 28.89]);
    data[2].baseW = 800;
    const result = batteryPlan(h, data, {initialSoc: 20, minSoc: 15, reservePct: 10, efficiency: 0.92, maxCharge: 2400});
    const purchaseCost = result.slots.reduce((sum, point, i) => sum + point.plannedGridEnergyKWh * data[i].price, 0);
    assert.ok(purchaseCost <= 0.2 * 28.89, `${purchaseCost} exceeds displaced household cost`);
    assert.ok(result.slots.every(point => point.dischargeFloorPct <= point.targetSoCPct + 1e-6));
    assert.ok(result.slots[2].socPct <= 20.001, 'does not purchase the missing reserve to 25%');
});

test('battery PV stage targets remain effective in price mode', () => {
    const h = harness(), data = slots(h, [10, 10, 10, 10]);
    for (const slot of data) slot.pvW = slot.residualPvW = 10000;
    h.context.input = {data, targets: data.map(() => ({targetPct: 30})), options: {
        capacity: 10, initialSoc: 20, minSoc: 15, maxSoc: 100, reservePct: 0,
        maxCharge: 5000, maxDischarge: 3000, efficiency: 0.9, safety: 1, selfConsumption: true, now: h.now}};
    const result = h.run('buildPriceBatteryPlan(input.data,input.targets,input.options)');
    assert.ok(Math.abs(result.slots[3].socPct - 30) < 1e-8);
    assert.equal(result.report.gridKWh, 0);
});


function wholePlan(h, price, pv, car) {
    for (const name of ['Battery', 'MyPV_DHW', 'MyPV_Heating']) h.put(`Devices.${name}.Present`, false);
    h.context.cars = [0, 1, 2].map(index => ({...vehicle(h, index, 1), connected: false,
        release: false, eligible: false, socValid: false, energyRequiredKWh: 0,
        minimumSocPct: 0, targetSocPct: 80, socPct: 40, capacityKWh: 50,
        manualMinimumCurrentA: 0, status: 'unavailable', ...index === car.index ? car : {}}));
    h.run('historyReady=true; updateVehicles=()=>{}; vehicleState=wb=>cars[wb]; plannedVehicleAtSoc=v=>v; localDateKey=d=>d.toISOString().slice(0,10)');
    const start = Math.floor(h.now / 900000) * 900000;
    h.context.planInput = {pv: price.map((_, i) => ({timestamp: start + i * 900000, valueW: pv[i] || 0})),
        house: price.map(() => ({valueW: 0})), prices: {total: price.map(value_ct_kWh => ({value_ct_kWh}))}};
    h.run('buildDevicePlan(planInput)');
    return [0, 1, 2].map(wb => JSON.parse(h.run(`getState('ems.0.Plan.Wallbox${wb}_48h_JSON').val`)));
}

test('whole planner caps no-SoC PV baseline to remaining per-session AC demand', () => {
    const h = harness();
    const car = {...vehicle(h, 0, 1), socValid: false, priceChargingEnabled: true,
        release: true, connected: true, energyRequiredKWh: 0};
    const plans = wholePlan(h, [10, 10, 10, 10], [5000, 5000, 5000, 5000], car);
    const totalAC = plans[0].reduce((sum, p) => sum + p.valueW * 0.25 / 1000, 0);
    assert.ok(Math.abs(totalAC - 1) < 0.001);
    assert.ok(plans[0].every(point => point.gridChargeW === 0));
});

test('whole planner does not count PV after the fixed session deadline then duplicate its energy with grid', () => {
    const h = harness();
    const car = {...vehicle(h, 0, 1.84), socValid: true, priceChargingEnabled: true,
        priceDeadlineTimestamp: h.now + 3600000, release: true, connected: true,
        energyRequiredKWh: 1.84 * 0.9};
    const plans = wholePlan(h, [10, 10, 20, 20, 40, 40, 40, 40], [0, 0, 0, 0, 5000, 5000, 5000, 5000], car);
    const totalAC = plans[0].reduce((sum, p) => sum + p.valueW * 0.25 / 1000, 0);
    assert.ok(Math.abs(totalAC - 1.84) < 0.001);
    assert.ok(plans[0].slice(4).every(point => point.valueW === 0));
});


test('replanning retains existing energy for expensive unmet demand instead of cheap discharge and repurchase', () => {
    const h = harness(), data = slots(h, [5, 5, 5, 5, 40, 40]);
    for (const point of data) point.baseW = 1000;
    const result = batteryPlan(h, data, {initialSoc: 20 + 0.5 / 0.9 / 10 * 100, minSoc: 20, reservePct: 0});
    assert.ok(result.slots[0].dischargeFloorPct > 20);
    assert.ok(Math.abs(result.slots[0].valueW) < 1e-6, 'initial stored energy is retained for future expensive demand');
    assert.equal(result.slots[4].gridChargeW, 0);
    assert.ok(result.slots[4].valueW < 0 && result.slots[5].valueW < 0);
    assert.equal(result.report.gridKWh, 0, 'all expensive demand already covered by available initial storage');
});
