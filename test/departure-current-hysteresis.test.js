'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

const at = (hour, minute, second = 0) => new Date(2026, 10, 21, hour, minute, second).getTime();

async function departurePlant(parallel = true, initialTime = at(7, 6, 54)) {
    const h = await plant({mii: true, wallbox: false, split: false, startDelayS: 0, minimumRuntimeS: 0,
        initialTime, initialSurplusW: -350, lpcLimitW: 3680,
        nativeConfig: {wallboxParallelChargingEnabled: parallel, wb0DeadlineEnabled: true, wb0TaperEnabled: true,
            dhwControlEnabled: false}});
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    h.own('Config.Wallbox0VehicleCapacity_kWh', 32.3);
    h.own('Vehicles.Wallbox0.DepartureTime', '08:30');
    h.put('DP_WB0_MIN_SOC', 100);
    h.put('DP_WB0_TARGET', 100);
    h.put('DP_WB0_SOC', 93.8);
    h.run('updateVehicles()');
    return h;
}

for (const parallel of [true, false]) test(`Mii above 75% before departure stays off without surplus, parallel=${parallel}`, async () => {
    const h = await departurePlant(parallel, at(6, 37));
    h.own('Vehicles.Wallbox0.DepartureTime', '07:00');
    h.put('DP_WB0_MIN_SOC', 75);
    h.put('DP_WB0_SOC', 81.4);
    await h.advance(40);
    assert.equal(h.value('Vehicles.Wallbox0.MustCharge'), false);
    assert.equal(h.value('Control.Targets.Wallbox0_A'), 0);
    assert.equal(h.physical().miiAllow, 0);
    assert.ok(!h.writes.some(w => w.id === 'goe0.allow' && w.val === 1));
    h.put('DP_WB0_SOC', 74.9);
    await h.advance(40);
    assert.equal(h.physical().miiAllow, 1);
    assert.equal(h.physical().miiAmps, 6);
    h.put('DP_WB0_SOC', 75);
    await h.advance(10);
    assert.equal(h.value('Vehicles.Wallbox0.MustCharge'), false);
    assert.equal(h.physical().miiAllow, 0);
});

for (const parallel of [true, false]) test(`departure at the 9/10 A boundary reaches the actual output, parallel=${parallel}`, async () => {
    const h = await departurePlant(parallel);
    await h.advance(40); // 07:07:34, 93.8%
    assert.equal(h.physical().miiAmps, 9);
    assert.equal(h.physical().miiAllow, 1);
    await h.advance(30); // time alone crosses the upward boundary
    assert.equal(h.physical().miiAmps, 10);
    h.put('DP_WB0_SOC', 93.9);
    await h.advance(29);
    assert.equal(h.value('Control.Targets.Wallbox0_A'), 10);
    assert.equal(h.physical().miiAmps, 10, 'the independent output gate also retains the granted step');
    assert.equal(h.writes.filter(w => w.id === 'goe0.cmd' && w.val === 9 && w.at >= at(7, 8, 4)).length, 0);
    h.put('lpc.limit', 1840);
    await h.advance(5);
    assert.equal(h.value('Control.Targets.Wallbox0_A'), 8);
    assert.equal(h.physical().miiAmps, 8, 'the live hard limit overrides a held step');
    h.put('lpc.limit', 3680);
    await h.advance(8);
    assert.equal(h.physical().miiAmps, 9, 'the revoked 10 A cannot latch again');
    h.put('DP_WB0_SOC', 100);
    await h.advance(8);
    assert.equal(h.physical().miiAllow, 0);
    assert.equal(h.run('liveDepartureGrants[0]'), null);
});

test('only a fresh personal step for the same departure can ease a downward transition', async () => {
    const h = await departurePlant();
    const {departureMinimumPower: power, departureGrant: grant} = h.engineContext;
    const vehicle = {...h.run('vehicleState(0)'), socPct: 93.9};
    const now = at(7, 8, 33);
    const previous = grant(vehicle, 2300, 2300, 1, 230, now - 5000, now + 5000);
    assert.equal(power(vehicle, now, 230, 1), 2070);
    assert.equal(power(vehicle, now, 230, 1, previous), 2300);
    for (const changed of [{phases: 3}, {voltage: 231}, {index: 2}, {targetSocPct: 99}, {minimumSocPct: 98},
        {departureTimestamp: now + 600000}, {validUntil: now - 1}, {now: now + 1}])
        assert.equal(power(vehicle, now, 230, 1, {...previous, ...changed}), 2070);
    assert.equal(power(vehicle, now, 230, 1, grant(vehicle, 2070, 7360, 1, 230, now, now + 5000)), 2070,
        'discretionary watts cannot become a departure step');
    assert.equal(grant(vehicle, 0, 7360, 1, 230, now, now + 5000), null);
    for (const changed of [{socValid: false}, {socPct: 100}, {deadlineEnabled: false}, {readyBy: {}}])
        assert.equal(power({...vehicle, ...changed}, now, 230, 1, previous), 0);
    assert.equal(power({...vehicle, maximumPowerW: 2070}, now, 230, 1, previous), 2070);
    assert.equal(power({...vehicle, socPct: 95}, now, 230, 1, previous), 1840);
    assert.equal(power({...vehicle, socPct: 98}, at(8, 17), 230, 1,
        {...previous, watts: 2070, validUntil: at(8, 30)}), 1840, 'the final taper has immediate priority');
    h.config.wb0TaperEnabled = false;
    const exact = {...vehicle, capacityKWh: 50, efficiency: 1,
        socPct: 100 - 2070 * 70 / 60 / 500}; // exactly 70 minutes at 9 A
    const releaseAt = at(7, 0);
    const held = grant(exact, 2300, 2300, 1, 230, releaseAt, releaseAt + 10000);
    assert.equal(power(exact, releaseAt, 230, 1, held), 2070, '20 minutes left on completion');
    assert.equal(power(exact, releaseAt + 1000, 230, 1, held), 2300, 'just inside the five-minute band');
});

test('overnight closed-loop pacing uses the measured uptake at each command', async () => {
    const h = await departurePlant();
    const {departureMinimumPower, departureGrant} = h.engineContext;
    const car = {...h.run('vehicleState(0)'), socPct: 58.1};
    const uptakeKW = new Map([[9, 1.90], [10, 2.24]]);
    const end = at(7, 3);
    let previous = null, switches = 0;
    for (let now = at(0, 55); now <= end; now += 5000) {
        const watts = departureMinimumPower(car, now, 230, 1, previous);
        const kW = uptakeKW.get(watts / 230);
        assert.ok(kW, 'simulation stays within the two measured power levels');
        if (previous && previous.watts !== watts) switches++;
        previous = departureGrant(car, watts, watts, 1, 230, now, now + 10000);
        if (now < end) car.socPct += kW * (5 / 3600) * car.efficiency / car.capacityKWh * 100;
    }
    assert.ok(switches > 0 && switches <= 10, `changed ${switches} times in over six hours`);
    assert.ok(car.socPct > 93 && car.socPct < 94, 'physical energy is integrated from each new command');
});
