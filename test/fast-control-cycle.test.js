'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = name => fs.readFileSync(path.join(__dirname, '../lib/engine', `${name}.js`), 'utf8');

function bootstrapHarness() {
    const jobs = [], timers = [], calls = [];
    const context = vm.createContext({
        CFG: {root: 'ems.0', refreshSeconds: 10, forecastRefreshMinutes: 15,
            dp: new Proxy({}, {get: () => []})},
        write() {}, on() {}, log() {},
        schedule(expression, callback) { jobs.push({expression, callback}); },
        setTimeout(callback, delay) { timers.push({callback, delay}); }
    });
    for (const name of ['updateVehicles', 'enableOutputHistory', 'buildHistory',
        'updateDhwSimulation', 'observe', 'realtimeControl', 'zeroRealtimeTargets',
        'updateHeatingSimulation', 'updateHeatPumpAdvice', 'updateBatteryProductionOutput',
        'updateDhwProductionOutput', 'updateHeatingProductionOutput', 'updateWallboxProductionOutput',
        'buildForecast', 'requestForecastRebuild']) {
        context[name] = () => calls.push(name);
    }
    vm.runInContext(source('bootstrap'), context);
    calls.length = 0;
    return {jobs, timers, calls, context};
}

test('one ordered one-second job computes fresh demand before the battery, retaining slower output jobs', () => {
    const h = bootstrapHarness();
    const fast = h.jobs.filter(job => job.callback.name === 'fastControlCycle');
    assert.equal(fast.length, 1);
    assert.equal(fast[0].expression, '* * * * * *');
    assert.equal(h.jobs.some(job => job.callback === h.context.realtimeControl
        || job.callback === h.context.updateBatteryProductionOutput), false);
    assert.equal(h.timers.some(timer => timer.callback.name === 'fastControlCycle'
        || timer.callback === h.context.realtimeControl), false,
    'no startup timer duplicates the cron calculation');
    fast[0].callback();
    assert.deepEqual(h.calls, ['realtimeControl', 'updateBatteryProductionOutput']);
    assert.equal(h.jobs.find(job => job.callback === h.context.updateDhwProductionOutput).expression,
        '*/5 * * * * *');
    assert.equal(h.jobs.find(job => job.callback === h.context.updateWallboxProductionOutput).expression,
        '*/2 * * * * *');
});

test('failed fast calculation invalidates old budgets before the battery stop guard still runs', () => {
    const h = bootstrapHarness();
    h.context.realtimeControl = () => { throw new Error('invalid allocation'); };
    h.jobs.find(job => job.callback.name === 'fastControlCycle').callback();
    assert.deepEqual(h.calls, ['zeroRealtimeTargets', 'updateBatteryProductionOutput']);
});

function gridHarness() {
    const states = new Map();
    const context = vm.createContext({nativeConfig: {}, Date,
        getState: id => states.get(id), existsState: id => states.has(id)});
    vm.runInContext(source('core'), context);
    vm.runInContext(source('realtime'), context);
    vm.runInContext("CFG.dp.gridImport='grid.import';CFG.dp.gridExport='grid.export'", context);
    const put = (id, val, extra = {}) => states.set(id, {val, ts: Date.now(), q: 0, ack: true, ...extra});
    put('grid.import', 0); put('grid.export', 1000);
    put('__ADAPTER_ROOT__.Actual.GridPower_W', 5000);
    return {put, measure: () => vm.runInContext('realtimeGridMeasurement()', context)};
}

test('fast allocation uses current source net power independently of the ten-second observer cache', () => {
    const h = gridHarness();
    assert.equal(h.measure().gridW, -1000);
    h.put('grid.import', 750); h.put('grid.export', 0);
    assert.equal(h.measure().gridW, 750);
});

test('invalid or stale live grid sources cannot be replaced by the previous observer value', () => {
    for (const [value, extra] of [[null, {}], [false, {}], ['', {}], [0, {q: 0x82}],
        [0, {ts: Date.now() - 180000}], [0, {ts: Date.now() + 60000}], [-1, {}]]) {
        const h = gridHarness(); h.put('grid.import', value, extra);
        const result = h.measure();
        assert.equal(result.valid, false);
        assert.ok(result.invalid.length > 0);
    }
});
