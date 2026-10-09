'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const heatPumpTelemetryParser = require('../lib/heatpump-telemetry');
const gridConstraints = require('../lib/grid-constraints');
const {SMA_GRID_MAX_AGE_MS} = require('../lib/source-diagnostics');

const now = Date.UTC(2026, 9, 9, 12);
const sample = (val = 2, extra = {}) => ({val, ack: true, q: 0, ts: now, ...extra});
const evaluate = extra => heatPumpTelemetryParser.evaluateHeatPumpPower({id: 'wp',
    unit: 'kW', scope: 'total', maxAgeMs: 30000, now, state: sample(), ...extra});

test('WP power explicitly normalizes kW and W, preserving a confirmed measured zero', () => {
    assert.equal(evaluate().watts, 2000);
    assert.equal(evaluate({unit: 'W', state: sample('2000')}).watts, 2000);
    for (const unit of ['W', 'kW']) {
        const result = evaluate({unit, state: sample(0)});
        assert.equal(result.valid, true); assert.equal(result.watts, 0);
    }
    const partial = evaluate({scope: 'inverter'});
    assert.equal(partial.valid, true); assert.equal(partial.scope, 'inverter');
    assert.match(partial.reason, /Teilleistung/);
});

test('missing, malformed and unqualified WP samples remain unknown rather than zero', () => {
    for (const state of [null, sample(null), sample(false), sample(true), sample(''), sample(' '),
        sample('not-a-number'), sample(NaN), sample(Infinity), sample(-1), sample(2, {ack: false}),
        sample(2, {ack: undefined}), sample(2, {q: 64}), sample(2, {ts: 0}),
        sample(2, {ts: now + 1001}), sample(2, {ts: now - 30001})]) {
        const result = evaluate({state});
        assert.equal(result.valid, false, JSON.stringify(state));
        assert.equal(result.watts, null, JSON.stringify(state));
    }
    assert.equal(evaluate({state: sample(2, {ts: now - 30000})}).valid, true);
    for (const extra of [{id: ''}, {unit: 'MW'}, {scope: 'unknown'}, {maxAgeMs: 0}, {maxAgeMs: NaN}])
        assert.equal(evaluate(extra).valid, false, JSON.stringify(extra));
});

test('the ISG kW unavailable marker cannot become a multi-megawatt load', () => {
    assert.equal(evaluate({state: sample(32768)}).watts, null);
    assert.equal(evaluate({state: sample(32768), scope: 'inverter'}).valid, false);
    assert.equal(evaluate({state: sample(32768), unit: 'W'}).watts, 32768,
        'a W-valued total source has no universally established sentinel');
});

function engine(config = {}) {
    const states = new Map();
    class Clock extends Date { static now() { return now; } }
    const nativeConfig = {heatPumpPowerId: 'wp', heatPumpPowerUnit: 'kW', heatPumpPowerScope: 'total',
        heatPumpPowerMaxAgeS: 30, par14aLimitW: 4200, ...config};
    const put = (id, val, extra = {}) => states.set(id, sample(val, extra));
    const context = vm.createContext({Date: Clock, nativeConfig, gridConstraints, heatPumpTelemetryParser,
        SMA_GRID_MAX_AGE_MS, getState: id => states.get(id), existsState: id => states.has(id),
        setState: put, log: () => {}});
    for (const name of ['core', 'realtime', 'observer']) vm.runInContext(
        fs.readFileSync(path.join(__dirname, '../lib/engine', `${name}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0'), context);
    const run = code => vm.runInContext(code, context);
    run(`CFG.dp.heatPumpPower='wp';CFG.dp.par14a='contact';CFG.dp.lpcState='';CFG.dp.lpcLimit='';
        CFG.dp.houseMetersW=[];CFG.dp.wallboxesKW=[];CFG.dp.myPvDhwW=[];CFG.dp.myPvHeatingW=[];
        recommend=()=>{};`);
    put('contact', true); put('ems.0.Devices.HeatPump.Present', true); put('wp', 2);
    put('__DP_PV_POWER__', 3000); put('__DP_GRID_IMPORT__', 0); put('__DP_GRID_EXPORT__', 500);
    return {states, put, run, config: nativeConfig};
}

test('engine shared budget deducts normalized total watts and never accepts inverter-only power', () => {
    const h = engine();
    assert.equal(h.run('currentConsumptionLimit().budgetW'), 2200);
    for (const extra of [{val: null}, {ack: false}, {ts: now - 30001}, {q: 2}]) {
        h.put('wp', 2, extra);
        assert.equal(h.run('currentConsumptionLimit().valid'), false);
        assert.equal(h.run('currentConsumptionLimit().budgetW'), 0);
    }
    h.put('wp', 2); h.config.heatPumpPowerScope = 'inverter';
    assert.equal(h.run('currentConsumptionLimit().valid'), false);
    assert.match(h.run('currentConsumptionLimit().reason'), /Teilleistung/);
    h.put('ems.0.Devices.HeatPump.Present', false);
    assert.equal(h.run('currentConsumptionLimit().budgetW'), 4200,
        'an absent future WP does not restrict the current fleet');
    h.put('ems.0.Devices.HeatPump.Present', true); h.put('contact', false);
    assert.equal(h.run('currentConsumptionLimit().valid'), true,
        'without an active cap, incomplete WP power cannot manufacture a cap');
});

test('WP power follows its configured freshness interval consistently', () => {
    const h = engine(); h.put('wp', 2, {ts: now - 45000});
    assert.equal(h.run('currentConsumptionLimit().valid'), false);
    h.put('ems.0.Config.HeatPumpPowerMaxAge_s', 60);
    assert.equal(h.run('currentConsumptionLimit().budgetW'), 2200);
    h.put('ems.0.Config.HeatPumpPowerMaxAge_s', null);
    assert.equal(h.run('currentConsumptionLimit().valid'), false);
});

test('observer keeps unknown WP power null and does not subtract it twice from the SMA balance', () => {
    const h = engine(); h.run('observe()');
    const value = suffix => h.states.get(`ems.0.${suffix}`).val;
    assert.equal(value('Actual.HeatPump_W'), 2000);
    assert.equal(value('Actual.GridPower_W'), -500);
    assert.equal(value('Actual.HouseLoad_W'), 2500);
    assert.equal(value('System.DataValid'), true);
    h.put('wp', null); h.run('observe()');
    assert.equal(value('Actual.HeatPump_W'), null);
    assert.equal(value('System.DataValid'), false);
    h.put('ems.0.Devices.HeatPump.Present', false); h.run('observe()');
    assert.equal(value('Actual.HeatPump_W'), null);
    assert.equal(value('System.DataValid'), true);
    h.put('ems.0.Devices.HeatPump.Present', true); h.put('wp', 0); h.run('observe()');
    assert.equal(value('Actual.HeatPump_W'), 0);
    h.config.heatPumpPowerScope = 'inverter'; h.put('wp', 2); h.run('observe()');
    assert.equal(value('Actual.HeatPump_W'), 2000);
    assert.equal(value('System.DataValid'), true,
        'an explicitly partial but valid observation does not become a telemetry fault');
});
