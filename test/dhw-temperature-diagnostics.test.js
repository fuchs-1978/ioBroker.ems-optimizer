'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
    let now = 10000000;
    const states = new Map();
    const writes = [];
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, ...extra});
    const own = (suffix, val, extra) => put(`ems.0.${suffix}`, val, extra);
    const dp = {dhwTemps: ['bottom', 'lower', 'upper', 'top'], myPvDhwOutletTemp: 'outlet',
        myPvDhwConnection: 'connection', myPvDhwRelease: 'old-release', myPvDhwHysteresis: 'old-lock'};
    for (const id of [...dp.dhwTemps, 'outlet']) put(id, 50);
    put('connection', true);
    own('Devices.MyPV_DHW.Present', true);
    const ctx = vm.createContext({Math, Date: {now: () => now},
        CFG: {root: 'ems.0', dp, limits: {myPvDhwMaxW: 9000}}, nativeConfig: {},
        existsState: id => states.has(id), getState: id => states.get(id),
        readNumber: (id, fallback) => states.has(id) ? Number(states.get(id).val) : fallback,
        write: (id, val) => {writes.push({id, val}); put(id, val);}});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/engine/dhw-controller.js'), 'utf8'), ctx);
    const value = suffix => states.get(`ems.0.Devices.MyPV_DHW.${suffix}`).val;
    return {states, writes, put, own, dp, value,
        tick: () => vm.runInContext('evaluateDhwSimulation()', ctx),
        target: watts => vm.runInContext(`simulateDhwTarget(${watts})`, ctx),
        advance: ms => {now += ms;}, now: () => now,
        diagnostics: () => JSON.parse(value('TemperatureSources_JSON'))};
}

test('stale constant tank reading is unknown, names its source and retains its last real measurement', () => {
    const h = harness();
    h.put('bottom', 39.9, {ts: h.now() - 3600001, lc: h.now() - 86400000});
    const result = h.tick();
    assert.equal(h.value('BottomTemperature_C'), null);
    assert.equal(h.value('AverageTemperature_C'), null);
    assert.equal(h.value('RemainingCapacity_kWh'), null);
    assert.equal(h.value('TemperatureValid'), false);
    assert.equal(result.release, false);
    assert.equal(result.temperaturePowerLimitW, 0);
    const source = h.diagnostics().sources.find(item => item.name === 'Speicher unten');
    assert.equal(source.id, 'bottom');
    assert.equal(source.rawValue, 39.9);
    assert.equal(source.valueC, null);
    assert.equal(source.status, 'stale');
    assert.equal(source.ageMs, 3600001);
    assert.equal(source.maxAgeMs, 3600000);
    assert.match(h.value('Status'), /Speicher unten.*bottom.*veraltet/);
});

test('a confirmed equal-temperature report refreshes freshness by ts while old lc remains diagnostic', () => {
    const h = harness();
    const oldLc = h.now() - 7200000;
    h.put('bottom', 39.9, {lc: oldLc});
    assert.equal(h.tick().release, true);
    h.advance(60000);
    h.put('bottom', 39.9, {lc: oldLc});
    assert.equal(h.tick().release, true);
    const source = h.diagnostics().sources.find(item => item.id === 'bottom');
    assert.equal(source.ts, h.now());
    assert.equal(source.lc, oldLc);
    assert.equal(source.ageMs, 0);
    assert.equal(h.value('BottomTemperature_C'), 39.9);
});

for (const [label, val, extra, status] of [
    ['null', null, {}, 'missing_value'], ['blank', '', {}, 'invalid_value'],
    ['boolean', false, {}, 'invalid_value'], ['pending', 50, {ack: false}, 'unconfirmed'],
    ['quality', 50, {q: 64}, 'bad_quality'], ['missing timestamp', 50, {ts: null}, 'invalid_timestamp'],
    ['future timestamp', 50, {ts: 10000001}, 'future_timestamp'],
    ['implausible', -127, {}, 'out_of_range']
]) {
    test(`invalid outlet ${label} stays unknown and blocks heating without hiding tank readings`, () => {
        const h = harness();
        h.put('outlet', val, extra);
        const result = h.tick();
        assert.equal(h.value('OutletTemperature_C'), null);
        assert.equal(h.value('BottomTemperature_C'), 50);
        assert.equal(h.value('AverageTemperature_C'), 50);
        assert.equal(h.value('RemainingCapacity_kWh'), null);
        assert.equal(h.diagnostics().sources.find(item => item.id === 'outlet').status, status);
        assert.equal(result.release, false);
        assert.equal(h.target(9000), 0);
    });
}

test('missing sensor object and missing configuration remain distinct unknown sources', () => {
    const h = harness();
    h.states.delete('bottom');
    h.dp.dhwTemps[1] = '';
    h.tick();
    const sources = h.diagnostics().sources;
    assert.equal(sources[0].status, 'missing_state');
    assert.equal(sources[1].status, 'unconfigured');
    assert.equal(h.value('BottomTemperature_C'), null);
    assert.equal(h.value('MiddleLowerTemperature_C'), null);
    assert.equal(h.value('Release'), false);
});

test('real zero Celsius stays valid and thermal shutdown and resume limits are unchanged', () => {
    const h = harness();
    h.put('bottom', 0);
    assert.equal(h.tick().release, true);
    assert.equal(h.value('BottomTemperature_C'), 0);
    assert.equal(h.diagnostics().sources[0].valueC, 0);
    h.put('bottom', 76);
    assert.equal(h.tick().release, false);
    h.put('bottom', 75.7);
    assert.equal(h.tick().release, false);
    h.put('bottom', 75.5);
    assert.equal(h.tick().release, true);
    h.put('top', 82);
    assert.equal(h.tick().release, false);
});

test('tank and outlet deadlines retain their configured sixty-minute and two-minute boundaries', () => {
    const h = harness();
    h.put('bottom', 50, {ts: h.now() - 3600000});
    h.put('outlet', 50, {ts: h.now() - 120000});
    assert.equal(h.tick().release, true);
    h.advance(1);
    assert.equal(h.tick().release, false);
    const sources = h.diagnostics().sources;
    assert.equal(sources[0].status, 'stale');
    assert.equal(sources[4].status, 'stale');
    h.own('Config.DHWTemperatureMaxAge_min', 90);
    h.put('outlet', 50);
    assert.equal(h.tick().release, true);
    assert.equal(h.diagnostics().sources[0].maxAgeMs, 5400000);
});

test('unchanged thermal diagnostics refresh at most once a minute but invalidity and source reports publish immediately', () => {
    const h = harness();
    h.tick();
    const count = () => h.writes.filter(item => item.id.endsWith('.TemperatureSources_JSON')).length;
    assert.equal(count(), 1);
    h.advance(2000); h.tick();
    assert.equal(count(), 1);
    h.advance(58000); h.tick();
    assert.equal(count(), 2);
    h.put('bottom', 50); h.tick();
    assert.equal(count(), 3);
    h.put('bottom', 50, {ack: false}); h.tick();
    assert.equal(count(), 4);
});
