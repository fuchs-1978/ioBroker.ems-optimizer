'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {SMA_GRID_MAX_AGE_MS} = require('../lib/source-diagnostics');
const fs = require('node:fs');

function fixture(config = {}) {
    const now = Date.UTC(2026, 9, 1, 12);
    class Clock extends Date { static now() { return now; } }
    const states = new Map();
    const nativeConfig = {bhkwPresent: true, bhkwEnergyUnit: 'J', ...config};
    const context = vm.createContext({SMA_GRID_MAX_AGE_MS, Date: Clock, nativeConfig,
        getState: id => states.get(id), existsState: id => states.has(id),
        setState: (id, val) => states.set(id, {val, ts: now, ack: true}), log: () => {}});
    for (const file of ['core', 'observer'])
        vm.runInContext(fs.readFileSync(`lib/engine/${file}.js`, 'utf8').replaceAll('__ADAPTER_ROOT__', 'ems.0'), context);
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    put('__DP_BHKW_POWER__', 920);
    put('__DP_BHKW_ENERGY__', 360000000);
    return {put, states, now, config: nativeConfig, run: code => vm.runInContext(code, context)};
}

test('BHKW energy converts Joule, Wh and kWh explicitly without estimating daily energy', () => {
    const h = fixture();
    for (const [unit, raw] of [['J', 360000000], ['Wh', 100000], ['kWh', 100]]) {
        h.config.bhkwEnergyUnit = unit; h.put('__DP_BHKW_ENERGY__', raw);
        const result = h.run('bhkwTelemetry()');
        assert.equal(result.powerW, 920); assert.equal(result.energyKWh, 100);
        assert.equal(result.valid, true);
    }
    h.config.bhkwEnergyUnit = 'unknown';
    assert.equal(h.run('bhkwTelemetry().energyKWh'), null);
});

test('BHKW null, stale, bad-quality, unacknowledged and future samples stay unknown', () => {
    const h = fixture();
    for (const [val, extra] of [[null, {}], [false, {}], ['', {}], [-1, {}],
        [920, {ts: h.now - 121000}], [920, {ts: h.now + 60000}],
        [920, {q: 0x82}], [920, {ack: false}], [920, {ts: null}]]) {
        h.put('__DP_BHKW_POWER__', val, extra);
        const result = h.run('bhkwTelemetry()');
        assert.equal(result.powerW, null); assert.equal(result.valid, false);
        assert.equal(result.energyKWh, 100, 'power loss cannot manufacture a counter loss');
    }
    h.put('__DP_BHKW_POWER__', 0);
    assert.equal(h.run('bhkwTelemetry().powerW'), 0, 'measured zero remains valid');
    h.put('__DP_BHKW_ENERGY__', 360000000, {ts: h.now - 86401000});
    assert.equal(h.run('bhkwTelemetry().energyKWh'), null);
    assert.equal(h.run('bhkwTelemetry().valid'), true, 'counter failure is distinct from power validity');
});

test('BHKW decommissioning ignores old source values and cannot create generation', () => {
    const h = fixture({bhkwPresent: false});
    const result = h.run('bhkwTelemetry()');
    assert.equal(result.present, false); assert.equal(result.powerW, null);
    assert.equal(result.energyKWh, null); assert.equal(result.valid, false);
});

test('BHKW corrects measured household balance without adding to PV or net budget', () => {
    const h = fixture();
    h.run('recommend = () => {};');
    h.run('CFG.dp.houseMetersW = []; CFG.dp.wallboxesKW = []; CFG.dp.myPvDhwW = []; CFG.dp.myPvHeatingW = [];');
    h.put('__DP_PV_POWER__', 3000); h.put('__DP_GRID_IMPORT__', 0); h.put('__DP_GRID_EXPORT__', 1920);
    h.run('observe()');
    const val = key => h.states.get(`ems.0.${key}`)?.val;
    assert.equal(val('Actual.PV_W'), 3000); assert.equal(val('Actual.TotalGeneration_W'), 3920);
    assert.equal(val('Actual.HouseLoad_W'), 2000); assert.equal(val('Actual.GridPower_W'), -1920);
    assert.equal(val('System.DataValid'), true);
    h.put('__DP_BHKW_POWER__', null); h.run('observe()');
    assert.equal(val('Actual.HouseLoad_W'), null); assert.equal(val('Actual.TotalGeneration_W'), null);
    assert.equal(val('System.DataValid'), true, 'optional diagnostic loss does not stop the regulator');
    h.config.bhkwPresent = false; h.run('observe()');
    assert.equal(val('Actual.HouseLoad_W'), 1080);
});

test('BHKW rejects the observed near-zero KNX counter but accepts a genuine counter zero', () => {
    const h = fixture();
    h.put('__DP_BHKW_ENERGY__', 9.999805971268327e-41);
    let r = h.run('bhkwTelemetry()');
    assert.equal(r.energyKWh, null);
    assert.equal(r.energy.issue, 'counter-implausible');
    assert.equal(r.energy.rawValue, 9.999805971268327e-41);
    assert.equal(r.powerW, 920);
    h.put('__DP_BHKW_ENERGY__', 0);
    r = h.run('bhkwTelemetry()');
    assert.equal(r.energyKWh, 0);
    assert.equal(r.energy.valid, true);
});

test('BHKW metadata mismatch is explicit and cannot apply a wrong energy conversion', () => {
    const h = fixture({bhkwEnergyUnit: 'kWh'});
    h.run("getSourceUnit = id => id === CFG.dp.bhkwEnergy ? 'J' : 'W';");
    const r = h.run('bhkwTelemetry()');
    assert.equal(r.energyKWh, null);
    assert.equal(r.energy.issue, 'unit-mismatch');
    assert.equal(r.energy.sourceUnit, 'J');
    assert.equal(r.powerW, 920);
    h.run("getSourceUnit = () => 'kW';");
    assert.equal(h.run('bhkwTelemetry().powerW'), null);
    assert.equal(h.run('bhkwTelemetry().power.issue'), 'unit-mismatch');
});
