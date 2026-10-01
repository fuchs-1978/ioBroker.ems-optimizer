'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const QUARTER = 900000;
// Public 2026 tariff schedule; no private runtime measurements.
const rules = [1, 4].flatMap(quarter => [
    {quarter, from: '23:00', to: '05:00', level: 'low'},
    {quarter, from: '05:00', to: '16:30', level: 'standard'},
    {quarter, from: '16:30', to: '21:00', level: 'high'},
    {quarter, from: '21:00', to: '23:00', level: 'standard'}
]).concat([2, 3].map(quarter => ({quarter, from: '00:00', to: '24:00', level: 'standard'})));
const tariffConfig = {gridFeeSource: 'schedule', gridTariffYear: 2026,
    gridTariffBasis: 'gross', gridTariffStandardCt: 7.19, gridTariffHighCt: 10.01,
    gridTariffLowCt: 0.71, gridTariffRules: rules};

function engine(config = {}, clock = '2026-10-01T14:00:00Z') {
    let now = Date.parse(clock);
    const states = new Map();
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    const context = vm.createContext({nativeConfig: config, Date: Clock,
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => { if (!states.has(id)) put(id, val); }, setState: put, log() {}});
    for (const file of ['core', 'prices', 'forecast', 'history', 'vehicles', 'planner', 'heatpump-controller']) {
        const source = fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) => key);
        vm.runInContext(source, context);
    }
    const run = code => vm.runInContext(code, context);
    run("createStates(); createHeatPumpStates(); CFG.dp.dynamicEnergyPriceEnabled=''; CFG.dp.dynamicGridFeeEnabled=''; historyReady=true;");
    return {run, put, config, states, now: () => now, at: value => { now = Date.parse(value); },
        own: (suffix, value) => put(`ems.0.${suffix}`, value),
        price: value => run(`evaluatePriceAt(${value === undefined ? 'Date.now()' : Date.parse(value)})`),
        forecast: () => run('buildPriceForecast(Date.now())')};
}

function schedule(config = {}, clock) {
    const h = engine({...tariffConfig, ...config}, clock);
    h.own('Config.DynamicGridFeeEnabled', true);
    return h;
}

test('annual network schedule preserves 16:30 boundary, midnight, quarters and a full independent 48h horizon', () => {
    const h = schedule();
    const forecast = h.forecast();
    assert.equal(forecast.grid.length, 192);
    assert.equal(forecast.grid[1].value_ct_kWh, 7.19); // Berlin 16:15
    assert.equal(forecast.grid[2].value_ct_kWh, 10.01); // Berlin 16:30
    assert.equal(h.price('2026-10-01T21:00:00Z').gridCt, 0.71);
    assert.equal(h.price('2026-10-01T22:00:00Z').gridCt, 0.71);
    assert.equal(h.price('2026-03-31T21:00:00Z').gridCt, 0.71);
    assert.equal(h.price('2026-03-31T22:00:00Z').gridCt, 7.19);
    assert.equal(h.price('2026-09-30T21:45:00Z').gridCt, 7.19);
    assert.equal(h.price('2026-09-30T22:00:00Z').gridCt, 0.71);
    assert.ok(forecast.grid.every(point => point.valid));
});

test('unknown market data does not truncate the known network schedule or receive a fixed fallback', () => {
    const h = schedule(); h.own('Config.DynamicEnergyPriceEnabled', true);
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts: h.now(), val: 8, endTs: h.now() + QUARTER}]));
    const prices = h.forecast();
    assert.equal(prices.total[0].valid, true);
    assert.equal(prices.total[1].value_ct_kWh, null);
    assert.ok(prices.grid.every(point => point.valid));
    assert.match(prices.status, /191\/192/);
    const chart = JSON.parse(h.run(`priceChartJson(${JSON.stringify(prices.total)})`));
    assert.equal(chart.length, 192);
    assert.equal(chart[1].val, null);
});

test('Berlin DST spring jump and both repeated autumn hours use the local tariff', () => {
    const h = schedule();
    for (const time of ['2026-03-29T00:45:00Z', '2026-03-29T01:00:00Z',
        '2026-10-25T00:15:00Z', '2026-10-25T01:15:00Z'])
        assert.equal(h.price(time).gridCt, 0.71, time);
    assert.equal(h.price('2026-03-29T03:00:00Z').gridCt, 7.19);
    assert.equal(h.price('2026-10-25T04:00:00Z').gridCt, 7.19);
});

test('tariff expires exactly at the local year boundary, with a visible gap', () => {
    const h = schedule();
    assert.equal(h.price('2026-12-31T22:45:00Z').valid, true);
    const expired = h.price('2026-12-31T23:00:00Z');
    assert.equal(expired.gridCt, null);
    assert.equal(expired.valid, false);
    assert.match(expired.gridReason, /2027.*nicht gueltig/);
});

for (const [label, config] of [
    ['missing table', {gridTariffRules: []}],
    ['gap', {gridTariffRules: rules.filter(rule => rule.quarter !== 2)}],
    ['overlap', {gridTariffRules: [...rules, rules[0]]}],
    ['bad quarter', {gridTariffRules: [...rules, {...rules[0], quarter: 5}]}],
    ['bad minute', {gridTariffRules: [{...rules[0], from: '23:03'}, ...rules.slice(1)]}],
    ['ambiguous empty day', {gridTariffRules: [{...rules[0], from: '00:00', to: '00:00'}, ...rules.slice(1)]}],
    ['invalid amount', {gridTariffLowCt: -1}],
    ['invalid year', {gridTariffYear: ''}],
    ['invalid basis', {gridTariffBasis: 'unknown'}]
]) test(`invalid annual tariff fails closed: ${label}`, () => {
    const h = schedule(config);
    assert.equal(h.price().valid, false);
    assert.match(h.price().gridReason, /Netztarif/);
});

test('legacy hourly prices fill four quarters, quarter-hour prices preserve changes and gaps', () => {
    const h = engine(); const ts = h.now();
    h.own('Config.DynamicEnergyPriceEnabled', true);
    h.own('Config.DynamicEnergyAdders_ct_kWh', 0);
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts, val: 5}, {ts: ts + 3600000, val: 9}]));
    let prices = h.forecast();
    assert.deepEqual(Array.from(prices.energy.slice(0, 5), x => x.value_ct_kWh), [5, 5, 5, 5, 9]);
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts, val: 5}, {ts: ts + QUARTER, val: -1}, {ts: ts + 3 * QUARTER, val: 7}]));
    prices = h.forecast();
    assert.deepEqual(Array.from(prices.energy.slice(0, 5), x => x.value_ct_kWh), [5, -1, null, 7, null]);
});

test('explicit end timestamps prevent sparse hourly-aligned quarter prices extending across missing quarters', () => {
    const h = engine(); const ts = h.now();
    h.own('Config.DynamicEnergyPriceEnabled', true);
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts, val: -10, endTs: ts + QUARTER},
        {ts: ts + 3600000, val: 8, endTs: ts + 5 * QUARTER}]));
    const prices = h.forecast();
    assert.equal(prices.energy[0].valid, true);
    assert.equal(prices.energy[1].value_ct_kWh, null);
    assert.equal(prices.energy[3].value_ct_kWh, null);
    assert.equal(prices.energy[4].valid, true);
    assert.equal(prices.energy[5].value_ct_kWh, null);
});

test('overlapping and too short intervals cannot authorize a full planning slot', () => {
    const h = engine(); const ts = h.now();
    h.own('Config.DynamicEnergyPriceEnabled', true);
    for (const series of [[{ts, val: 5, endTs: ts + 1000}],
        [{ts, val: 5, endTs: ts + QUARTER}, {ts, val: 9, endTs: ts + QUARTER}]]) {
        h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify(series));
        assert.equal(h.forecast().total[0].valid, false);
    }
});

test('an overlap beginning inside a quarter invalidates that entire forecast quarter', () => {
    const h = engine(); const ts = h.now();
    h.own('Config.DynamicEnergyPriceEnabled', true);
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([
        {ts, val: 5, endTs: ts + 3600000},
        {ts: ts + 5 * 60000, val: 40, endTs: ts + 20 * 60000}
    ]));
    const prices = h.forecast();
    assert.equal(prices.total[0].valid, false);
    assert.match(prices.total[0].reason, /ueberlappen/);
    assert.equal(prices.total[1].valid, false);
    assert.equal(prices.total[2].valid, true);
    // Instantaneous thermal authorization is revoked as soon as that point
    // actually becomes ambiguous; it need not reject a known earlier point.
    assert.equal(h.price().valid, true);
    h.at(new Date(ts + 10 * 60000).toISOString());
    assert.equal(h.run('evaluateThermalPricePolicy().valid'), false);
});

test('component inputs and external market prices have independent net/gross bases, including negatives', () => {
    const h = schedule({priceInputBasis: 'net', energyPriceSeriesBasis: 'net'});
    h.own('Config.DynamicEnergyPriceEnabled', true);
    h.own('Config.DynamicEnergyAdders_ct_kWh', 5);
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts: h.now(), val: -10, endTs: h.now() + QUARTER}]));
    assert.ok(Math.abs(h.price().energyCt - -5.95) < 1e-10);
    assert.ok(Math.abs(h.price().totalCt - 1.24) < 1e-10);
    h.config.energyPriceSeriesBasis = 'gross';
    assert.ok(Math.abs(h.price().energyCt - -4.05) < 1e-10);
    h.config.gridTariffBasis = 'net'; h.config.gridTariffStandardCt = 6.04;
    assert.ok(Math.abs(h.price().gridCt - 7.1876) < 1e-10);
});

test('fixed gross total subtracts its fixed gross reference once and adds the selected gross network fee', () => {
    const h = schedule({fixedTariffMode: 'total', priceInputBasis: 'net'});
    h.own('Config.FixedTotalPrice_ct_kWh', 30);
    h.own('Config.ReferenceGridFee_ct_kWh', 7.19);
    assert.ok(Math.abs(h.price().totalCt - 30) < 1e-10);
    assert.ok(Math.abs(h.price('2026-10-01T15:00:00Z').totalCt - 32.82) < 1e-10);
    assert.ok(Math.abs(h.price('2026-10-01T22:00:00Z').totalCt - 23.52) < 1e-10);
    h.own('Config.FixedTotalPrice_ct_kWh', 0); h.own('Config.ReferenceGridFee_ct_kWh', 0);
    assert.equal(h.price().valid, false);
});

test('provider always supplies net prices, unknown selected sources fail closed', () => {
    const h = engine({energyPriceSource: 'energy-charts', energyPriceSeriesBasis: 'gross'});
    h.own('Config.DynamicEnergyPriceEnabled', true); h.own('Config.DynamicEnergyAdders_ct_kWh', 0);
    h.own('Market.EnergyPrice_JSON', JSON.stringify([{ts: h.now(), val: 10, endTs: h.now() + QUARTER}]));
    assert.equal(h.forecast().energy[0].value_ct_kWh, 11.9);
    h.config.energyPriceSource = 'unknown';
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts: h.now(), val: -10}]));
    assert.equal(h.price().valid, false);
});

test('forecast and thermal use one calculation and identical series quality, timestamp and switch protections', () => {
    const h = schedule({priceInputBasis: 'net', energyPriceSeriesBasis: 'net', thermalCheapPriceEnabled: true});
    h.own('Config.DynamicEnergyPriceEnabled', true);
    const series = JSON.stringify([{ts: h.now(), val: -12, endTs: h.now() + QUARTER}]);
    h.put('DP_ENERGY_PRICE_SERIES', series);
    const thermal = h.run('evaluateThermalPricePolicy()');
    assert.equal(h.forecast().total[0].value_ct_kWh, Math.round(thermal.totalCt * 1000) / 1000);
    for (const extra of [{ack: false}, {q: 64}, {ts: 0}, {ts: h.now() + 10000}]) {
        h.put('DP_ENERGY_PRICE_SERIES', series, extra);
        assert.equal(h.forecast().total[0].valid, false);
        assert.equal(h.run('evaluateThermalPricePolicy().valid'), false);
    }
    h.put('DP_ENERGY_PRICE_SERIES', series);
    h.run("CFG.dp.dynamicEnergyPriceEnabled='external.enabled'");
    assert.equal(h.forecast().total[0].valid, false);
    assert.equal(h.run('evaluateThermalPricePolicy().cheapAllowed'), false);
    h.put('external.enabled', false);
    assert.equal(h.forecast().energy[0].source, 'fixed');
});

test('planner never turns a missing price into grid heat or cheap battery charging; PV planning remains usable', () => {
    const h = engine();
    for (let wb = 0; wb < 3; wb++) h.own(`Devices.Wallbox${wb}.Present`, false);
    h.own('Devices.Battery.Present', true); h.own('Devices.MyPV_Heating.Present', true);
    h.own('Actual.DHWTemperature_C', 20); h.own('Config.HeatingBufferTemperature_C', 20);
    const slots = [null, 5, 35, null];
    const data = {pv: slots.map((_, i) => ({timestamp: h.now() + i * QUARTER, valueW: i === 3 ? 12000 : 0})),
        house: slots.map(() => ({valueW: 500})), prices: {total: slots.map(value_ct_kWh => ({value_ct_kWh}))}};
    h.run(`buildDevicePlan(${JSON.stringify(data)})`);
    const allocation = JSON.parse(h.states.get('ems.0.Plan.Allocation_48h_JSON').val);
    assert.equal(allocation[0].price, null);
    assert.equal(allocation[0].priceValid, false);
    assert.equal(allocation[0].dhwGridW, 0);
    assert.equal(allocation[0].heatingGridW, 0);
    assert.equal(allocation[0].batteryGridChargeW, 0);
    assert.ok(allocation[3].dhwW + allocation[3].heatingW + Math.max(0, allocation[3].batteryW) > 0);
    assert.equal(h.states.get('ems.0.Plan.Valid').val, true);
});
