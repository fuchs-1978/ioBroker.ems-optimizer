'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
// The plant and its Modul 3 tariff both use German local time.
process.env.TZ = 'Europe/Berlin';
const {plant} = require('./control-plant');

const date = text => new Date(text).getTime();
const root = 'Vehicles.Wallbox2.';
const tariff = Array.from({length: 4}, (_, i) => [
    {quarter: i + 1, from: '00:00', to: '02:00', level: 'low'},
    {quarter: i + 1, from: '02:00', to: '24:00', level: 'standard'}
]).flat();
const localMorning = date('2026-11-28T06:00');
const fridayEvening = date('2026-11-27T18:00');

async function morningPlant({soc = 40, reserve = 20, cheap = false, start = fridayEvening, trip = null, parallel = true} = {}) {
    const h = await plant({initialTime: start, startDelayS: 0, split: false, initialSurplusW: 0,
        wallboxIndex: 2, sourceQuality: 0,
        nativeConfig: {wallboxParallelChargingEnabled: parallel, dhwControlEnabled: false, wb2DeadlineEnabled: true,
            wb2MinimumSocByDepartureEnabled: true, wb2CommissioningMaxA: 20, wb2TaperEnabled: false,
            gridFeeSource: 'schedule', gridTariffYear: 2026, gridTariffBasis: 'gross',
            gridTariffLowCt: 1, gridTariffStandardCt: 12, gridTariffHighCt: 20, gridTariffRules: tariff}});
    h.own('Devices.MyPV_DHW.Present', false);
    h.own('Devices.Wallbox0.Present', false);
    h.own('Config.Wallbox2VehicleCapacity_kWh', 50);
    h.own('Config.Wallbox2PriceChargingEnabled', false);
    h.own('Config.Wallbox2MaxPower_W', 4600);
    h.own(root + 'MaxCurrent1P_A', 20);
    h.own(root + 'MobilityReserve_pct', reserve);
    h.own(root + 'DepartureTime', '20:00');
    if (trip) h.own(root + 'DepartureTrip_JSON', JSON.stringify(trip));
    h.put('DP_WB2_SOC', soc);
    h.put('DP_WB2_MIN_SOC', 50);
    h.put('DP_WB2_TARGET', 90);
    h.run("CFG.dp.dynamicEnergyPriceEnabled='';CFG.dp.dynamicGridFeeEnabled=''");
    h.own('Config.DynamicEnergyPriceEnabled', false);
    h.own('Config.DynamicGridFeeEnabled', cheap);
    await h.advance(12);
    return h;
}
const plan = h => JSON.parse(h.value(root + 'DeparturePlan_JSON'));
async function at(h, when, soc, car = 2) {
    await h.replayAt(when, [['DP_WB2_CAR', car], ['DP_WB2_SOC', soc]]);
    await h.advance(15);
}

for (const parallel of [false, true]) test(`daily reserve, 06:00 minimum and flexible maximum through the physical output, parallel=${parallel}`, async () => {
    const h = await morningPlant({soc: 19, parallel});
    assert.equal(plan(h).morning.at, localMorning);
    assert.equal(h.value(root + 'DepartureTimestamp'), 0, 'a time without a trip SoC is no departure');
    assert.equal(plan(h).floor, 20);
    await h.advance(40);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    await at(h, h.now() + 1000, 40);
    assert.equal(h.value(root + 'MustCharge'), false);
    assert.equal(h.physical().wbPowerW, 0, h.diagnostic());
    const latest = plan(h).morning.latestStart;
    assert.ok(latest >= date('2026-11-28T03:00') && latest < localMorning);
    await at(h, latest + 1000, 40);
    assert.equal(plan(h).floor, 50);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    await at(h, h.now() + 1000, 50);
    assert.equal(h.value(root + 'MustCharge'), false);
    assert.equal(h.physical().wbPowerW, 0, h.diagnostic());
    assert.equal(h.value(root + 'TargetSoC_pct'), 90);
});

test('Modul 3 reserves low tariff quarters before 06:00 with optional vehicle price charging off', async () => {
    const h = await morningPlant({cheap: true});
    const m = plan(h).morning;
    assert.ok(m.windows.length > 0);
    assert.ok(m.windows.every(s => s.from >= date('2026-11-28T00:00') && s.until <= date('2026-11-28T02:00')));
    assert.equal(h.physical().wbPowerW, 0);
    await at(h, m.windows[0].from + 1000, 40);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    await h.advance(150); // Each real current step waits for feedback.
    assert.equal(h.physical().wbPowerW, m.powerW, h.diagnostic());
    await at(h, h.now() + 1000, 46);
    assert.equal(h.value(root + 'MustCharge'), true, 'a fresh SoC does not interrupt an equally cheap running window');
    await at(h, h.now() + 1000, 50);
    assert.equal(h.physical().wbPowerW, 0, h.diagnostic());
});

test('a later or expired booking cannot delay the morning minimum and only an explicit trip target has a departure clock', async () => {
    const entry = {date: '2026-11-30', time: '10:30', soc: 80, allowGrid: true};
    const h = await morningPlant({trip: entry});
    assert.equal(plan(h).morning.at, localMorning);
    assert.ok(plan(h).latestStart > localMorning);
    await at(h, plan(h).morning.latestStart + 1000, 40);
    assert.equal(plan(h).floor, 50);
    await at(h, localMorning + 60000, 47);
    assert.equal(plan(h).floor, 50, 'a continuously connected car catches up after 06:00');
    await at(h, h.now() + 60000, 47, 1);
    await at(h, h.now() + 60000, 40);
    assert.equal(plan(h).morning.at, date('2026-11-29T06:00'));
    assert.equal(plan(h).floor, 20);
    h.own(root + 'DepartureTrip_JSON', JSON.stringify({...entry, soc: null}));
    await h.advance(3);
    assert.equal(h.value(root + 'DepartureTimestamp'), 0);
    assert.equal(h.value(root + 'TargetSoC_pct'), 90);
});

test('an earlier one-off trip independently covers its explicit higher SoC only with grid permission', async () => {
    for (const allowGrid of [false, true]) {
        const trip = {date: '2026-11-28', time: '04:30', soc: 65, allowGrid};
        const h = await morningPlant({soc: 52, trip});
        assert.equal(plan(h).gridGoal, allowGrid ? 65 : 50);
        await at(h, date('2026-11-28T03:45'), 52);
        assert.equal(h.value(root + 'MustCharge'), allowGrid);
        assert.equal(h.value(root + 'TargetSoC_pct'), 65);
        await at(h, date('2026-11-28T04:31'), 65);
        assert.equal(h.value(root + 'TargetSoC_pct'), 90);
        assert.equal(h.value(root + 'DepartureTimestamp'), 0);
    }
});

test('the 48-hour forecast buys only the missing minimum in low-tariff quarters and uses subsequent PV up to max', async () => {
    const h = await morningPlant({cheap: true});
    const first = Math.floor(h.now() / 900000) * 900000;
    const sunrise = date('2026-11-28T10:00'), sunset = date('2026-11-28T17:00');
    const slots = Array.from({length: 192}, (_, i) => ({timestamp: first + i * 900000}));
    h.engineContext.nextDay = {pv: slots.map(s => ({...s, valueW: s.timestamp >= sunrise && s.timestamp < sunset ? 9500 : 0})),
        house: slots.map(s => ({...s, valueW: 900})), prices: {total: slots.map(s => ({...s, value_ct_kWh: 30}))}};
    h.run('historyReady=true; buildDevicePlan(nextDay); updateVehicles()');
    const points = JSON.parse(h.value('Plan.Wallbox2_48h_JSON'));
    const watts = (from, until) => points.filter(s => from <= s.timestamp && s.timestamp < until)
        .reduce((wh, slot) => wh + slot.valueW / 4, 0);
    const neededWh = (50 - 40) * 50 * 10 / 0.9;
    assert.ok(Math.abs(watts(first, sunrise) - neededWh) < 5, 'morning grid Wh: '+watts(first, sunrise));
    assert.ok(Math.abs(watts(date('2026-11-28T00:00'), date('2026-11-28T02:00')) - neededWh) < 5);
    assert.ok(watts(sunrise, sunset) > 10000, 'PV can charge above the morning minimum');
    assert.ok(watts(first, Infinity) <= (90 - 40) * 50 * 10 / 0.9 + 5);
    assert.equal(watts(sunset, Infinity), 0);
});

test('a booking below the daily minimum has its own earlier target and 06:00 remains independent', async () => {
    for (const allowGrid of [false, true]) {
        const trip = {date:'2026-11-27',time:'20:00',soc:45,allowGrid};
        const h = await morningPlant({soc:40,trip});
        await at(h, date('2026-11-27T19:45'), 40);
        assert.equal(plan(h).floor, allowGrid ? 45 : 20);
        assert.equal(h.value(root + 'MustCharge'), allowGrid);
        await at(h, date('2026-11-27T19:50'), 45);
        assert.equal(h.value(root + 'MustCharge'), false);
        assert.equal(plan(h).morning.at, localMorning);
    }
});

test('equal or zero reserves, a change while plugged in, and local clocks across DST', async () => {
    const h = await morningPlant({soc: 40, reserve: 50});
    assert.equal(h.value(root + 'MustCharge'), true);
    h.own(root + 'MobilityReserve_pct', 0);
    await h.advance(8);
    assert.equal(plan(h).reserve, 0);
    assert.equal(h.value(root + 'MustCharge'), false);
    for (const [evening, morning] of [['2026-03-28T20:00','2026-03-29T06:00'], ['2026-10-24T20:00','2026-10-25T06:00']])
        assert.equal(h.run(`nextDepartureTimestamp('06:00', ${date(evening)})`), date(morning));
});

test('selecting contiguous tariff quarters counts a long physical start delay just once', async () => {
    const h = await morningPlant({cheap: true});
    const windows = h.run(`morningTariffWindows(Date.now(), ${localMorning},
        {hours: 1.5, startDelay: 5*60000}, readPriceContext())`);
    assert.equal(windows.length, 1);
    assert.equal(windows[0].until - windows[0].from, 105 * 60000);
    assert.ok(windows[0].from >= date('2026-11-28T00:00') && windows[0].until <= date('2026-11-28T02:00'));
});

test('a missing tariff interval leaves only the latest start and a stale time does not restrict flexible price charging', async () => {
    const h = await morningPlant({cheap:true});
    h.config.gridTariffRules = tariff.filter(rule => rule.quarter !== 4 || rule.level !== 'low');
    h.own('Config.Wallbox2PriceChargingEnabled', true);
    h.own('Config.Wallbox2PriceMax_ct_kWh', 35);
    await h.advance(3);
    assert.deepEqual(plan(h).morning.windows, []);
    assert.equal(h.value(root + 'MustCharge'), false);
    assert.equal(h.value(root + 'PriceDeadlineMode'), 'flexible');
    assert.equal(h.value(root + 'DepartureTimestamp'), 0);
    assert.ok(h.value(root + 'PriceDeadlineTimestamp') > localMorning);
    await at(h, plan(h).morning.latestStart + 1000, 42);
    assert.equal(h.value(root + 'MustCharge'), true);
});

test('without departure control, the daily minimum still runs and daytime surplus can reach max', async () => {
    const h = await morningPlant({soc:55, trip:{date:'2026-11-28',time:'05:00',soc:80,allowGrid:true}});
    h.config.wb2DeadlineEnabled = false;
    await h.advance(3);
    assert.equal(h.value(root + 'DepartureTimestamp'), 0);
    assert.equal(h.value(root + 'TargetSoC_pct'), 90);
    assert.equal(plan(h).morning.at, localMorning);
    h.setSurplus(6500);
    await h.advance(75);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    await at(h, h.now() + 1000, 90);
    assert.equal(h.value(root + 'Release'), false);
    assert.equal(h.physical().wbPowerW, 0, h.diagnostic());
});

const hamburg = {date: '2026-11-30', time: '06:00', soc: 100, allowGrid: true};
const hamburgDeadline = date('2026-11-30T06:00');

async function hamburgPlant(start, soc = 74, parallel = true) {
    const h = await morningPlant({start, soc, trip: hamburg, cheap: true, parallel});
    h.config.gridTariffRules = [1, 2, 3, 4].flatMap(quarter => [
        {quarter, from: '00:00', to: '05:00', level: 'low'},
        {quarter, from: '05:00', to: '23:00', level: 'standard'},
        {quarter, from: '23:00', to: '24:00', level: 'low'}
    ]);
    h.own('Config.Wallbox2VehicleCapacity_kWh', 90);
    h.own('Config.VehicleChargingEfficiency_pct', 90);
    await h.advance(3);
    return h;
}

function forecastTrip(h, solar = () => 0, revise = () => {}) {
    const first = Math.floor(h.now() / 900000) * 900000;
    const slots = Array.from({length: 192}, (_, i) => ({timestamp: first + i * 900000}));
    const data = {pv: slots.map(s => ({...s, valueW: solar(s.timestamp)})),
        house: slots.map(s => ({...s, valueW: 0})),
        prices: {total: slots.map(s => ({...s, value_ct_kWh: h.run(`evaluatePriceAt(${s.timestamp}).totalCt`)}))}};
    revise(data);
    h.engineContext.tripForecast = data;
    h.run('historyReady = true; buildDevicePlan(tripForecast); updateVehicles()');
    return JSON.parse(h.value('Plan.Wallbox2_48h_JSON'));
}

for (const parallel of [false, true]) test('Hamburg departure uses Modul 3 with the optional switch off, parallel=' + parallel, async () => {
    const start = date('2026-11-29T22:40');
    const h = await hamburgPlant(start, 74, parallel);
    const cheapStart = date('2026-11-29T23:00'), cheapEnd = date('2026-11-30T05:00');
    const series = forecastTrip(h), purchases = series.filter(p => p.bookedPurchase);
    assert.ok(purchases.length > 0);
    assert.ok(purchases.every(p => p.timestamp >= cheapStart && p.priceChargeUntil <= cheapEnd));
    const energy = purchases.reduce((sum, p) => sum + p.plannedGridEnergyKWh, 0);
    assert.ok(Math.abs(energy - 26) < 0.001, 'expected 26 AC kWh, got ' + energy);
    assert.ok(series.every(p => !p.valueW || p.bookedPurchase));
    assert.ok(purchases.every(p => p.currentA <= 20 && p.priceDepartureAt === hamburgDeadline));
    assert.equal(h.value('Config.Wallbox2PriceChargingEnabled'), false);
    await h.advance(90); // Complete outstanding go-e acknowledgements before advancing the clock.
    assert.equal(h.physical().wbPowerW, 0);
    await h.replayAt(cheapStart + 1000, [['DP_WB2_SOC', 74]], {allocate: false, output: false});
    forecastTrip(h);
    assert.equal(h.run("priceChargingAuthorization('Wallbox2').allowed"), true);
    await h.advance(45);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    h.own(root + 'DepartureTrip_JSON', JSON.stringify({...hamburg, allowGrid: false}));
    assert.equal(h.run("priceChargingAuthorization('Wallbox2').allowed"), false);
    await h.advance(25);
    assert.equal(h.physical().wbPowerW, 0, h.diagnostic());
});

test('the first cheap quarter allows for a five-minute startup, even just before the tariff changes', async () => {
    const h = await hamburgPlant(date('2026-11-29T22:59'));
    h.own('Config.WallboxStartDelay_s', 300);
    const purchases = forecastTrip(h).filter(p => p.bookedPurchase);
    assert.equal(purchases[0].timestamp, date('2026-11-29T23:00'));
    assert.ok(purchases[0].chargingMinutes <= 10.0001);
    assert.ok(purchases.every(p => p.priceChargeUntil <= date('2026-11-30T05:00')));
    assert.ok(Math.abs(purchases.reduce((sum, p) => sum + p.plannedGridEnergyKWh, 0) - 26) < 0.001);
});

test('only the residual after usable PV before a booking is bought, and dearer slots cover a short cheap window', async () => {
    const start = date('2026-11-29T12:00');
    const h = await hamburgPlant(start);
    const noon = date('2026-11-29T12:15'), until = date('2026-11-29T14:15');
    const sunlight = t => (t >= noon && t < until || t >= hamburgDeadline) ? 11000 : 0;
    const series = forecastTrip(h, sunlight);
    const total = series.reduce((n, p) => n + p.valueW / 4000, 0);
    const grid = series.reduce((n, p) => n + p.plannedGridEnergyKWh, 0);
    assert.ok(grid > 0 && grid < 26 && Math.abs(total - 26) < 0.005, JSON.stringify({grid, total}));
    assert.ok(series.every(p => p.timestamp < hamburgDeadline || !p.valueW));
    const solarOnly = forecastTrip(h, t => t >= noon && t < date('2026-11-29T21:00') ? 11000 : 0);
    assert.ok(solarOnly.some(p => p.valueW > 0));
    assert.ok(solarOnly.every(p => !p.bookedPurchase && !p.gridChargeW));

    const short = await hamburgPlant(date('2026-11-30T03:00'), 88);
    const rest = forecastTrip(short);
    const byPrice = rest.filter(p => p.bookedPurchase);
    assert.ok(byPrice.some(p => p.timestamp >= date('2026-11-30T05:00')));
    assert.ok(Math.abs(byPrice.reduce((n, p) => n + p.plannedGridEnergyKWh, 0) - 12) < 0.001);
    assert.ok(byPrice.every(p => p.priceChargeUntil <= hamburgDeadline - 900000));
    const lostPrice = forecastTrip(short, undefined, data => {data.prices.total[1].valid = false;});
    assert.ok(lostPrice.every(p => !p.bookedPurchase));
    assert.ok(lostPrice.some(p => p.valueW > 0), 'latest-start fallback');
});

test('a cheaper night leaves room for the following afternoon PV and ignores energy after departure', async () => {
    const h = await hamburgPlant(date('2026-11-28T22:45'));
    const departure = {date: '2026-11-29', time: '16:07', soc: 95, allowGrid: true};
    h.own(root + 'DepartureTrip_JSON', JSON.stringify(departure));
    const noon = date('2026-11-29T11:45'), endSolar = date('2026-11-29T13:45');
    const end = date('2026-11-29T16:07');
    const series = forecastTrip(h, t => (t >= noon && t < endSolar || t >= end) ? 10000 : 0);
    const solar = series.filter(p => p.timestamp >= noon && p.timestamp < endSolar)
        .reduce((sum, p) => sum + p.valueW / 4000, 0);
    const bought = series.filter(p => p.bookedPurchase);
    const importKWh = bought.reduce((sum, p) => sum + p.plannedGridEnergyKWh, 0);
    assert.ok(solar > 1 && bought.length);
    assert.ok(bought.every(p => p.timestamp < noon && p.bookedTariff.ceilingSoc <= 95 - solar + 0.01));
    assert.ok(Math.abs(importKWh + solar - 21) < 0.01);
    assert.ok(series.every(p => p.timestamp < end || p.valueW === 0));

    h.own(root + 'DepartureTrip_JSON', '');
    const normal = forecastTrip(h);
    assert.ok(normal.every(p => !p.bookedTariff && !p.bookedPurchase && !p.gridChargeW));
});

test('tariff revision revokes an active trip purchase and stale plans retain the deadline fallback', async () => {
    const h = await hamburgPlant(date('2026-11-30T00:00'), 85);
    forecastTrip(h);
    assert.equal(h.run("priceChargingAuthorization('Wallbox2').allowed"), true);
    h.config.gridTariffLowCt += 10;
    assert.equal(h.run("priceChargingAuthorization('Wallbox2').allowed"), false);
    h.config.gridTariffLowCt -= 10;
    h.own('Plan.Valid', false);
    assert.equal(h.run("priceChargingAuthorization('Wallbox2').allowed"), false);
    const due = plan(h).latestStart;
    await at(h, due + 1000, 85);
    assert.equal(h.value(root + 'MustCharge'), true);
});
