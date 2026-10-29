'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {strategy, vehicleMinimums, integrate} = require('../lib/battery-strategy');
const now = 1800000000000;
const make = (soc = 70) => ({now, sourceAt: now - 1000, planAt: now - 2000, targetAt: now - 1000, targetPct: 70,
    efficiency: 0.9, horizonEnd: now + 900000, pv: [{timestamp: now, valueW: 4000}], house: [{timestamp: now, valueW: 500}],
    snapshot: {ts: now, power: {pv_W: 4000}, wallboxes: [{wb: 0, Present: true, SoCValid: true, SoC_pct: 60,
        MinimumSoC_pct: 50, TargetSoC_pct: 90, Connected: true, UserRelease: true}],
    battery: {Present: true, minimumSoC_pct: 15, maximumSoC_pct: 100, deviceProfile: {Valid: true, CapacityValid: true,
        DeviceMinSoC_pct: 20, DeviceMaxSoC_pct: 95, SoC_pct: soc, Capacity_kWh: 10, MaxCharge_W: 2400, MaxDischarge_W: 2400}}},
    planning: {config: {batteryPresent: true}, vehicles: [{capacityKWh: 50, efficiencyPct: 90}]}});
test('stage reached still permits fine buffering; excess EV energy is bounded and never max-charge', () => {
    const atGoal = strategy(make(70)); assert.equal(atGoal.mode, 'hold-stage-and-buffer');
    assert.equal(atGoal.fineDischargeAvailableW, 2400); assert.equal(atGoal.fineChargeAvailableW, 2400);
    assert.equal(atGoal.vehicleSupportW, 0); assert.equal(atGoal.floorPct, 69);
    const excess = strategy(make(80)); assert.equal(excess.mode, 'bounded-vehicle-support');
    assert.equal(excess.vehicleSupportW, 500); assert.equal(excess.vehicleIncreaseMaxA, 1);
    assert.equal(excess.productionReady, false); assert.equal(excess.maximumPct, 95);
});
test('car below minimum has priority; target above minimum never raises its night target', () => {
    const x = make(60); x.snapshot.wallboxes[0].SoC_pct = 40;
    const r = strategy(x); assert.equal(r.mode, 'vehicle-minimum-first'); assert.equal(r.chargePriorityW, 0);
    assert.equal(r.vehicleSupportW, 0); assert.equal(r.vehicleNightTargets[0].targetSoc, 50);
    assert.equal(r.vehicleNightTargets[0].acKWh, 5 / 0.9);
    const base = strategy(make(60)); assert.equal(base.mode, 'battery-priority'); assert.equal(base.chargePriorityW, 2400);
});
test('missing/stale device bounds and plans never become positive preparation permissions', () => {
    for (const alter of [x => {x.sourceAt = now - 30001;}, x => {x.snapshot.battery.deviceProfile.DeviceMaxSoC_pct = null;},
        x => {x.snapshot.battery.deviceProfile.DeviceMinSoC_pct = 99;}, x => {x.planAt = null;},
        x => {x.targetAt = now + 1000;}, x => {x.efficiency = null;}]) {
        const x = make(); alter(x); const r = strategy(x); assert.equal(r.mode, 'unknown');
        assert.equal(r.vehicleSupportW, null); assert.equal(r.productionReady, false);
    }
});
test('night energy is zero when forecast covers the terminal need, unknown with a coverage gap and always capped', () => {
    const x = make(90); x.pv[0].valueW = 10000;
    assert.equal(strategy(x).nightBattery.acKWh, 0);
    x.house = []; assert.equal(strategy(x).nightBattery.acKWh, null);
    x.house = [{timestamp: now, valueW: 100000}];
    assert.ok(strategy(x).nightBattery.acKWh <= (95 - 90) * 10 / 100 / 0.9);
    assert.equal(integrate([{timestamp: now, valueW: 1000}, {timestamp: now + 1000, valueW: 1000}], now, now + 900000), null);
});
test('night target lacks fictitious SOC for unknown or blocked vehicles', () => {
    const x = make(); x.snapshot.wallboxes[0].SoCValid = false;
    assert.equal(strategy(x).mode, 'unknown-vehicle-demand');
    assert.equal(vehicleMinimums(x.snapshot.wallboxes, x.planning.vehicles)[0].acKWh, null);
    x.snapshot.wallboxes[0].SoCValid = true; x.snapshot.wallboxes[0].UserRelease = false;
    assert.equal(vehicleMinimums(x.snapshot.wallboxes, x.planning.vehicles)[0].status, 'blocked');
    x.snapshot.wallboxes[0].ControlEnabled = false;
    assert.equal(vehicleMinimums(x.snapshot.wallboxes, x.planning.vehicles)[0].status, 'disabled');
});

test('mobility reserve defaults off in preview and never adds a second night-energy requirement', () => {
    const x = make(); x.snapshot.wallboxes[0].SoC_pct = 10;
    const p = x.planning.vehicles[0]; p.mobilityReservePct = 0;
    const before = strategy(x); assert.equal(before.vehicleNightTargets[0].mobilityReserve.status, 'disabled');
    assert.equal(before.vehicleNightTargets[0].mobilityReserve.acKWh, 0);
    p.mobilityReservePct = 15; p.deadlineEnabled = true; p.departureAt = now + 3600000;
    const after = strategy(x), v = after.vehicleNightTargets[0];
    assert.equal(v.mobilityReserve.targetPct, 15); assert.equal(v.mobilityReserve.status, 'reserve-needed');
    assert.equal(v.mobilityReserve.acKWh, 2.5 / 0.9); assert.equal(v.departureAt, p.departureAt);
    assert.equal(after.nightBattery.acKWh, before.nightBattery.acKWh);
    assert.equal(v.mobilityReserve.automaticGridPermission, false);
    assert.equal(after.productionReady, false);
    p.mobilityReservePct = 70;
    assert.equal(strategy(x).vehicleNightTargets[0].mobilityReserve.targetPct, 50);
});
test('invalid reserve never grants charging; configured departure is reused only when enabled', () => {
    const x = make(), p = x.planning.vehicles[0];
    for (const value of [null, undefined, NaN, -1, 101, '15']) {
        p.mobilityReservePct = value;
        const reserve = strategy(x).vehicleNightTargets[0].mobilityReserve;
        assert.equal(reserve.status, 'unknown'); assert.equal(reserve.targetPct, null);
        assert.equal(reserve.automaticGridPermission, false);
    }
    p.mobilityReservePct = 15; x.snapshot.wallboxes[0].SoC_pct = 10;
    x.snapshot.wallboxes[0].UserRelease = false;
    p.departureAt = now + 3600000; p.deadlineEnabled = false;
    const v = strategy(x).vehicleNightTargets[0];
    assert.equal(v.mobilityReserve.status, 'blocked'); assert.equal(v.departureAt, null);
});
test('vehicle reserve states start at zero and preserve an explicit setting when states are recreated', async () => {
    const {plant} = require('./control-plant');
    const h = await plant({wallbox: false});
    for (const wb of [0, 1, 2]) assert.equal(h.value(`Vehicles.Wallbox${wb}.MobilityReserve_pct`), 0);
    h.own('Vehicles.Wallbox1.MobilityReserve_pct', 15);
    h.run('createStates()');
    assert.equal(h.value('Vehicles.Wallbox1.MobilityReserve_pct'), 15);
});
