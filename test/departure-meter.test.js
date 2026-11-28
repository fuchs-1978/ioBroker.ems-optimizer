'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {updateDepartureMeter, observeUptake} = require('../lib/departure-meter');
const {plant} = require('./control-plant');

const start = Date.UTC(2026, 10, 28, 8, 50, 56, 379);
const point = (offset, kWh, soc, reportAt = offset, extra = {}) => ({
    key: 'trip-A', capacity: 90.6, efficiency: 0.9, target: 60, maxPowerW: 4600, now: start + offset,
    counter: {ts: start + offset, val: kWh, ack: true},
    sample: {valid: true, value: soc, observation: {value: soc, timestamp: start + reportAt}}, ...extra});

test('metered departure replays the EQE counter through a repeated 59% and finishes on the 60% report', () => {
    // Measured AC counter, 09:50:56–10:11:25 local. The vehicle published
    // 59% again at 10:05:56 and reported its 60% target at 10:10:56.
    const readings = [
        [0,22.782567], [43504,22.814272], [88589,22.846886], [133546,22.880272], [178561,22.912847],
        [223585,22.946111], [268580,22.979339], [313533,23.011936], [358602,23.045175], [403208,23.077000],
        [451001,23.102175], [493644,23.143400], [540590,23.173225], [583659,23.202897], [628664,23.235914],
        [674664,23.263761], [718956,23.294172], [763703,23.326119], [809179,23.355747], [853731,23.384850],
        [898973,23.416858], [899947,23.417594], [943809,23.469225], [988953,23.524903], [1034012,23.579672],
        [1076556,23.631617], [1119033,23.683644], [1164167,23.739156], [1201420,23.784750], [1228973,23.787200]
    ];
    let m = null;
    for (const [offset, kWh] of readings) {
        const reached = offset >= 1201420, reportAt = reached ? 1199835 : offset >= 899947 ? 899700 : 0;
        m = updateDepartureMeter(m && JSON.parse(JSON.stringify(m)), point(offset, kWh, reached ? 60 : 59, reportAt));
        if (!reached) assert.ok(Math.abs(m.soc - (59 + (kWh - readings[0][1]) * 90 / 90.6)) < 1e-9);
        else assert.ok(m.soc >= 60);
    }
});

test('two distinct conflicting source observations, a manual change, reset or reconnect adjust a trip budget', () => {
    let m = updateDepartureMeter(null, point(0, 10, 51));
    m = updateDepartureMeter(m, point(10000, 10.01, 48));
    assert.ok(m.soc > 51);
    m = updateDepartureMeter(m, point(14000, 10.015, 48, 10000));
    assert.ok(m.soc > 51, 'polling the same report is not independent confirmation');
    m = updateDepartureMeter(m, point(20000, 10.021, 48));
    assert.equal(m.soc, 48);
    const manual = point(25000, 10.025, 55); manual.sample.manual = true;
    m = updateDepartureMeter(m, manual);
    assert.equal(m.soc, 55);
    assert.equal(updateDepartureMeter(m, point(24000, 10.024, 55)), null);
    m = updateDepartureMeter(m, point(30000, 0.1, 55, 25000));
    assert.equal(m.soc, undefined);
    m = updateDepartureMeter(m, point(40000, 0.11, 52));
    assert.equal(m.soc, 52);
    m = updateDepartureMeter(m, point(110000, 0.13, 52, 40000));
    assert.equal(m.soc, undefined);
    assert.equal(updateDepartureMeter(m, point(115000, 0.14, 45, 115000, {key: 'trip-B'})).soc, 45);
    const invalid = point(115000, 0.14, 45); invalid.counter.q = 16;
    assert.equal(updateDepartureMeter(m, invalid), null);
});

test('feedback corrections require separate fresh samples for the confirmed amperage', () => {
    const sample = (at, amps = 15) => ({amps, phases: 1, since: start, now: start + at,
        power: {val: 3.31, ts: start + at, ack: true}});
    let u = observeUptake(null, sample(0));
    u = observeUptake(u, sample(10000));
    assert.equal(observeUptake(u, sample(10000)).samples, 2);
    u = observeUptake(u, sample(20000));
    assert.equal(u.samples, 3);
    assert.equal(u.watts, 3310);
    assert.equal(observeUptake(u, sample(22000, 16)).samples, 1);
    assert.equal(observeUptake(u, {...sample(22000), now: start + 56000}), null);
});

for (const parallel of [false, true]) test(`metered departure keeps physical current through rounded updates, parallel=${parallel}`, async () => {
    const at = new Date(2026, 10, 28, 9, 45).getTime();
    const h = await plant({initialTime: at, initialSurplusW: -400, split: false, startDelayS: 0,
        minimumRuntimeS: 0, lpcLimitW: 4600, wallboxUptakeA: (_, a) => a * 0.955,
        nativeConfig: {wb2DeadlineEnabled: true, wb2CommissioningMaxA: 20, wb2MaxCurrent1pA: 20,
            wallboxParallelChargingEnabled: parallel, dhwControlEnabled: false}});
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    h.own('Config.Wallbox2VehicleCapacity_kWh', 90.6);
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON', JSON.stringify({date: '2026-11-28', time: '10:30', soc: 60, allowGrid: true}));
    h.put('DP_WB2_MIN_SOC', 45); h.put('DP_WB2_SOC', 58.35);
    h.run("CFG.dp.wallboxSocEnergy[2]='eqe.meter'");
    let kWh = 11;
    const amps = [];
    for (let i = 0; i < 145; i++) {
        if (i === 62 || i === 102) h.put('DP_WB2_SOC', 58);
        kWh += h.physical().wbPowerW / 3600000;
        h.put('eqe.meter', kWh);
        await h.advance(1);
        if (i > 50) amps.push(h.physical().amps);
    }
    const meter = JSON.parse(h.value('Vehicles.Wallbox2.DepartureMeter_JSON'));
    assert.ok(Math.abs(meter.soc - (58.35 + (kWh - 11) * 90 / 90.6)) < 1e-8, JSON.stringify(meter));
    assert.ok(meter.uptake?.samples >= 3, JSON.stringify(meter));
    assert.equal(h.physical().allow, 1);
    assert.ok(Math.max(...amps) - Math.min(...amps) <= 1, JSON.stringify([...new Set(amps)]));
    h.put('lpc.limit', 1840);
    await h.advance(8);
    assert.ok(h.physical().amps <= 8, h.diagnostic());
    h.put('DP_WB2_SOC', 60);
    await h.advance(8);
    assert.equal(h.physical().allow, 0, h.diagnostic());
    h.put('DP_WB2_CAR', 1);
    await h.advance(4);
    assert.equal(h.value('Vehicles.Wallbox2.DepartureMeter_JSON'), '');
});

test('a measured shortfall moves one amp at a time and releases to the urgent or hard limit', async () => {
    const h = await plant();
    const {departureMinimumPower: power, departureGrant: grant} = h.engineContext;
    const now = h.now(), at = now + 45 * 60000;
    const car = {index: 2, socPct: 58.35, socValid: true, capacityKWh: 90, efficiency: 0.9, minimumSocPct: 60,
        targetSocPct: 60, deadlineEnabled: true, departureTimestamp: at, maximumPowerW: 4600,
        baseMaxCurrent1pA: 20, datedTrip: {allowGrid: true, at, latestStart: now - 3600000},
        departureMeter: {key: 'this trip', anchorSoc: 55, anchorKWh: 10,
            uptake: {amps: 15, phases: 1, started: now - 25000, at: now, samples: 4, watts: 2800}}};
    const last = grant(car, 3450, 3450, 1, 230, now - 3000, now + 10000);
    assert.equal(power(car, now, 230, 1), 15 * 230);
    assert.equal(power(car, now, 230, 1, last), 16 * 230);
    const changing = grant(car, 3680, 3680, 1, 230, now, now + 10000, last);
    assert.equal(power(car, now + 2000, 230, 1, changing), 16 * 230, 'wait for physical confirmation at the new current');
    assert.equal(power({...car, maximumPowerW: 2300}, now, 230, 1, last), 2300);
    const urgent = {...car, departureTimestamp: now + 15 * 60000 + 30000};
    assert.equal(power(urgent, now, 230, 1, {...last, departureTimestamp: urgent.departureTimestamp}), 4600);
});
