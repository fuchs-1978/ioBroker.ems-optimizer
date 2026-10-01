'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {MarketPrices, parseEnergyCharts, validCache, marketPriceUrl, fetchEnergyCharts,
    QUARTER_MS} = require('../lib/market-prices');

// Fully synthetic values, independent of any household or downloaded market data.
const START = Date.parse('2026-10-25T00:00:00+02:00');
function response(values = [120, -35, 0], start = START) {
    return {endpoint: 'price', bidding_zone: 'DE-LU', resolution: 'PT15M',
        interval_minutes: 15, unit: 'EUR / MWh', license: 'Synthetic fixture',
        series: [{id: 'day_ahead_price', name: 'Day-ahead spot market price'}],
        data: values.map((value, i) => ({timestamp: new Date(start + i * QUARTER_MS).toISOString(),
            values: {day_ahead_price: value}}))};
}
function fixture(config = {energyPriceSource: 'energy-charts'}, fetch = async () => response()) {
    const states = new Map();
    let now = START + 1000;
    let updates = 0;
    const adapter = {namespace: 'ems.0', config, log: {warn() {}},
        queueCompatState: async (id, val) => { if (!states.has(id)) states.set(id, {val}); },
        setCompatState: async (id, val) => { states.set(id, {val}); },
        getCachedState: id => states.get(id)};
    const source = new MarketPrices(adapter, {fetch, now: () => now, onUpdate: () => updates++});
    return {source, adapter, states, advance: ms => { now += ms; }, updates: () => updates,
        value: suffix => states.get(`ems.0.Market.${suffix}`)?.val};
}

test('native quarters, zero and negative exchange prices preserve exact delivery intervals', () => {
    const parsed = parseEnergyCharts(response());
    assert.deepEqual(parsed.entries, [12, -3.5, 0].map((val, i) =>
        ({ts: START + i * QUARTER_MS, endTs: START + (i + 1) * QUARTER_MS, val})));
});

test('null gaps and unpublished future prices are never filled or extended', () => {
    const parsed = parseEnergyCharts(response([120, null, 90, null]));
    assert.deepEqual(parsed.entries.map(e => [e.ts, e.endTs]), [
        [START, START + QUARTER_MS], [START + 2 * QUARTER_MS, START + 3 * QUARTER_MS]
    ]);
});

for (const [label, modify] of [
    ['hourly product', p => { p.interval_minutes = 60; p.resolution = 'PT1H'; }],
    ['unknown resolution', p => { p.interval_minutes = null; }],
    ['wrong unit', p => { p.unit = 'EUR/kWh'; }],
    ['wrong bidding zone', p => { p.bidding_zone = 'AT'; }],
    ['non-price endpoint', p => { p.endpoint = 'public_power'; }],
    ['string price', p => { p.data[0].values.day_ahead_price = '120'; }],
    ['infinite price', p => { p.data[0].values.day_ahead_price = Infinity; }],
    ['duplicate timestamp', p => { p.data[1].timestamp = p.data[0].timestamp; }],
    ['timestamp without offset', p => { p.data[0].timestamp = '2026-10-25T00:00:00'; }],
    ['non-quarter timestamp', p => { p.data[0].timestamp = new Date(START + 1000).toISOString(); }],
    ['oversized row count', p => { p.data = Array(513).fill(p.data[0]); }]
]) test(`rejects ${label}`, () => {
    const payload = response(); modify(payload);
    assert.throws(() => parseEnergyCharts(payload));
});

test('autumn and spring DST days preserve all native delivery intervals', () => {
    for (const [date, count] of [['2026-10-25T00:00:00+02:00', 100], ['2026-03-29T00:00:00+01:00', 92]]) {
        const start = Date.parse(date);
        const parsed = parseEnergyCharts(response(Array(count).fill(100), start));
        assert.equal(parsed.entries.length, count);
        assert.equal(parsed.entries.at(-1).endTs, start + count * QUARTER_MS);
    }
});

test('fixed URL requests exact UNIX delivery bounds including DST, with no user-controlled host', () => {
    const url = marketPriceUrl(START + 12000);
    assert.equal(url.origin, 'https://api.energy-charts.info');
    assert.equal(url.pathname, '/v2/price');
    assert.equal(url.searchParams.get('bzn'), 'DE-LU');
    assert.equal(Number(url.searchParams.get('start')), START / 1000);
    assert.equal(Number(url.searchParams.get('end')), START / 1000 + 48 * 3600);
});

test('external remains the default and does not fetch or modify the mapped external source', async () => {
    const f = fixture({}, async () => assert.fail('External source must not access network'));
    await f.source.initialize();
    await f.source.refresh();
    assert.equal(f.value('Source'), 'Externer ioBroker-Datenpunkt');
    assert.equal(f.value('Resolution_min'), 0);
    assert.equal(f.updates(), 0);
});

test('changed data triggers a forecast rebuild and unchanged data does not', async () => {
    const f = fixture();
    await f.source.initialize();
    await f.source.refresh();
    assert.equal(f.value('Valid'), true);
    assert.equal(f.value('Resolution_min'), 15);
    assert.match(f.value('License'), /Fraunhofer ISE.*Synthetic fixture/);
    assert.equal(f.updates(), 1);
    await f.source.refresh();
    assert.equal(f.updates(), 1);
});

test('failed fetch retains only still-valid cached products, then expires them explicitly', async () => {
    let failed = false;
    const f = fixture(undefined, async () => { if (failed) throw new Error('offline'); return response(); });
    await f.source.initialize();
    await f.source.refresh();
    const lastUpdate = f.value('LastUpdate');
    failed = true;
    f.advance(QUARTER_MS);
    await f.source.refresh();
    assert.equal(f.value('Valid'), true);
    assert.equal(JSON.parse(f.value('EnergyPrice_JSON')).length, 2);
    assert.equal(f.value('LastUpdate'), lastUpdate);
    assert.match(f.value('Status'), /Abruffehler/);
    f.advance(2 * QUARTER_MS);
    await f.source.refresh();
    assert.equal(f.value('Valid'), false);
    assert.equal(f.value('EnergyPrice_JSON'), '[]');
    assert.equal(f.value('ValidUntil'), 0);
    assert.match(f.value('Status'), /Keine gueltigen/);
});

test('future availability does not conceal a gap in the current product', async () => {
    const f = fixture(undefined, async () => response([null, 100]));
    await f.source.initialize(); await f.source.refresh();
    assert.equal(f.value('Valid'), false);
    assert.match(f.value('Status'), /fehlt im aktuellen/);
    assert.equal(JSON.parse(f.value('EnergyPrice_JSON')).length, 1);
});

test('cached data is validated before startup reuse', async () => {
    const f = fixture();
    f.states.set('ems.0.Market.EnergyPrice_JSON', {val: JSON.stringify(parseEnergyCharts(response()).entries)});
    await f.source.initialize();
    assert.equal(f.value('Valid'), true);
    assert.deepEqual(validCache('[{"ts":1,"endTs":2,"val":3}]', START), []);
    assert.deepEqual(validCache('null', START), []);
    assert.deepEqual(validCache('[]', START), []);
});

test('stop aborts a pending fetch and rejects late writes or rebuilds', async () => {
    let resolve;
    let signal;
    const f = fixture(undefined, async (_url, options) => {
        signal = options.signal;
        return new Promise(done => { resolve = done; });
    });
    await f.source.initialize();
    const pending = f.source.refresh();
    assert.equal(f.source.refresh(), pending, 'only one concurrent fetch');
    f.source.stop();
    assert.equal(signal.aborted, true);
    resolve(response());
    await pending;
    assert.equal(f.updates(), 0);
    assert.equal(f.value('EnergyPrice_JSON'), '[]');
});

test('Retry-After avoids repeated requests but still expires cached delivery products', async () => {
    let calls = 0;
    const f = fixture(undefined, async () => {
        calls++;
        const error = new Error('HTTP 429'); error.retryAfterMs = 2 * QUARTER_MS; throw error;
    });
    await f.source.initialize();
    await f.source.refresh();
    f.advance(QUARTER_MS);
    await f.source.refresh();
    assert.equal(calls, 1);
    f.advance(QUARTER_MS);
    await f.source.refresh();
    assert.equal(calls, 2);
});

function transport({status = 200, chunks = ['{}'], headers = {}, never = false} = {}) {
    const request = new EventEmitter();
    request.destroy = () => {};
    return (_url, _options, callback) => {
        const response = new EventEmitter();
        response.statusCode = status;
        response.headers = headers;
        response.destroy = () => {};
        queueMicrotask(() => {
            callback(response);
            if (!never) {
                for (const chunk of chunks) response.emit('data', chunk);
                response.emit('end');
            }
        });
        return request;
    };
}

test('HTTP client accepts JSON, bounds total response bytes and never follows redirects', async () => {
    const url = marketPriceUrl(START);
    assert.deepEqual(await fetchEnergyCharts(url, {get: transport()}), {});
    await assert.rejects(fetchEnergyCharts(url, {get: transport({chunks: ['abcdefghij']}), maxBytes: 4}), /Groessenlimit/);
    await assert.rejects(fetchEnergyCharts(url, {get: transport({status: 302, headers: {location: 'https://example.org/'}})}), /HTTP 302/);
    await assert.rejects(fetchEnergyCharts(new URL('https://example.org/v2/price')), /Unzulaessige/);
    await assert.rejects(fetchEnergyCharts(url, {get: transport({chunks: ['invalid']})}), /kein gueltiges JSON/);
});

test('HTTP client deadline and abort bound hanging responses', async () => {
    await assert.rejects(fetchEnergyCharts(marketPriceUrl(START), {get: transport({never: true}), timeoutMs: 5}), /Zeitlimit/);
    const controller = new AbortController();
    const result = fetchEnergyCharts(marketPriceUrl(START), {get: transport({never: true}), signal: controller.signal});
    controller.abort();
    await assert.rejects(result, /abgebrochen/);
});

function mainAdapter() {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const adapterModule = {exports: {}};
    class Adapter {
        constructor() {
            this.namespace = 'ems.0'; this.config = {};
            this.log = {warn() {}, error() {}, info() {}, debug() {}};
        }
        on() {}
    }
    const customRequire = name => name === '@iobroker/adapter-core' ? {Adapter}
        : name === 'node-schedule' ? {scheduleJob: () => ({cancel() {}})}
            : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
        require: customRequire, module: adapterModule, __dirname: path.join(__dirname, '..'),
        setTimeout, clearTimeout
    });
    return adapterModule.exports();
}

test('main maps the selected source to its own cached state and preserves external default', () => {
    const adapter = mainAdapter();
    adapter.config.energyPriceSeriesId = 'user.0.externalPrices';
    assert.equal(adapter.readMapping().DP_ENERGY_PRICE_SERIES, 'user.0.externalPrices');
    adapter.config.energyPriceSource = 'energy-charts';
    assert.equal(adapter.readMapping().DP_ENERGY_PRICE_SERIES, 'ems.0.Market.EnergyPrice_JSON');
});

test('main installs quarter-hour refresh and initializes actuators without awaiting network', async () => {
    const adapter = mainAdapter();
    const events = [];
    adapter.setStateAsync = async () => {};
    adapter.preloadStates = async () => {};
    adapter.migrateBatteryCadence = async () => {};
    adapter.startEngine = async () => {};
    adapter.runEngine = () => {};
    adapter.applyNativeVehicleSettings = async () => {};
    adapter.applyNativeEmsSettings = async () => {};
    adapter.setCompatState = async () => {};
    adapter.flushOwnWrites = async () => {};
    adapter.outputMetadata.refresh = async () => {};
    adapter.publishMappingStatus = () => {};
    adapter.wallboxOutput.initialize = async () => { events.push('outputs'); };
    adapter.startDebug = async () => {};
    adapter.startShadow = async () => {};
    adapter.persistBatteryCadenceMigration = async () => {};
    adapter.config.energyPriceSource = 'energy-charts';
    adapter.marketPrices.initialize = async () => { events.push('market'); };
    let complete;
    adapter.marketPrices.refresh = () => new Promise(resolve => { complete = resolve; events.push('request'); });
    const jobs = [];
    adapter.registerSchedule = (expression, callback) => jobs.push({expression, callback});
    await adapter.initializeAdapter();
    assert.deepEqual(events, ['outputs', 'market', 'request']);
    assert.equal(jobs[0].expression, '0 */15 * * * *');
    complete(false);
    await adapter.marketInitialization;
});
