'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function engine(overrides = {}) {
    let now = Date.UTC(2026, 8, 21, 12);
    const states = new Map(), foreignWrites = [];
    const config = {globalWriteEnabled: true, heatPumpAdviceEnabled: true,
        heatPumpBufferTemperatureId: 'buffer', heatPumpHeatingTargetC: 45,
        heatingCoolingActiveId: 'cooling', ...overrides};
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, ...extra});
    const context = vm.createContext({nativeConfig: config, Date: Clock,
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => { if (!states.has(id)) put(id, val); },
        setState: put, writeForeignState: (...args) => foreignWrites.push(args), log: () => {}});
    for (const file of ['core', 'heating-controller', 'heatpump-controller']) {
        const source = fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) =>
                ['DP_HEAT_PUMP_BUFFER_TEMP', 'DP_HEAT_PUMP_DHW_TEMP'].includes(key) ? '' : key);
        vm.runInContext(source, context);
    }
    const run = source => vm.runInContext(source, context);
    run(`createStates(); createHeatPumpStates();
        CFG.dp.dynamicEnergyPriceEnabled='';CFG.dp.dynamicGridFeeEnabled='';`);
    for (const suffix of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Enabled',
        'Devices.HeatPump.Present', 'Devices.HeatPump.ControlEnabled']) put(`ems.0.${suffix}`, true);
    put('ems.0.System.LastUpdate', now);
    put('DP_GRID_IMPORT', 0); put('DP_GRID_EXPORT', 3000);
    put('buffer', 40); put('cooling', false);
    const refresh = () => {
        for (const [id, state] of states) if (state.ack) put(id, state.val, {q: state.q});
        put('ems.0.System.LastUpdate', now);
    };
    return {run, put, states, config, foreignWrites, now: () => now,
        advance: (seconds, shouldRefresh = true) => { now += seconds * 1000; if (shouldRefresh) refresh(); },
        update: budget => run(`updateHeatPumpAdvice(Date.now(), ${budget === undefined ? 'null' : budget})`),
        dynamicPrice: (rawCt, {gridCt = 6.04, addersCt = 9.301} = {}) => {
            put('ems.0.Config.DynamicEnergyPriceEnabled', true);
            put('ems.0.Config.FixedGridFee_ct_kWh', gridCt);
            put('ems.0.Config.DynamicEnergyAdders_ct_kWh', addersCt);
            put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts: now, val: rawCt}]));
        }};
}

test('WP high PV recommends BOOST without any foreign write or output ownership', () => {
    const h = engine();
    const advice = h.update();
    assert.equal(advice.mode, 'BOOST');
    assert.equal(advice.value, 2);
    assert.equal(advice.heatRoomAvailable, true);
    assert.equal(h.run('hasOwnedHeatPumpOutput()'), false);
    assert.equal(h.foreignWrites.length, 0);
});

test('WP uses separate PV hysteresis and minimum hold without fast NVP switching', () => {
    const h = engine();
    assert.equal(h.update().mode, 'BOOST');
    h.put('DP_GRID_EXPORT', 1000);
    h.advance(30);
    assert.equal(h.update().mode, 'BOOST');
    assert.equal(h.states.get('ems.0.Devices.HeatPump.HoldRemaining_s').val, 270);
    h.advance(271);
    assert.equal(h.update().mode, 'NORMAL');
    h.advance(301); h.put('DP_GRID_EXPORT', 1800);
    assert.equal(h.update().mode, 'NORMAL', 'hysteresis requires on-threshold after falling below off-threshold');
    h.put('DP_GRID_EXPORT', 3000);
    assert.equal(h.update().mode, 'BOOST');
    h.advance(301); h.put('DP_GRID_EXPORT', 1800);
    assert.equal(h.update().mode, 'BOOST', 'inside hysteresis band maintains boost');
});

test('verified reclaimable central PV budget may trigger WP even when EHZ masks export', () => {
    const h = engine(); h.put('DP_GRID_EXPORT', 0);
    assert.equal(h.update(3000).mode, 'BOOST');
});

for (const [label, change] of [
    ['master OFF', h => h.put('ems.0.System.RealOutputsEnabled', false)],
    ['cooling active', h => h.put('cooling', true)],
    ['unknown cooling', h => h.states.delete('cooling')],
    ['stale cooling', h => h.put('cooling', false, {ts: h.now() - 121000})],
    ['invalid thermal value', h => h.put('buffer', null)],
    ['stale thermal value', h => h.put('buffer', 40, {ts: h.now() - 3601000})],
    ['stale grid value', h => h.put('DP_GRID_EXPORT', 3000, {ts: h.now() - 11000})],
    ['stale system observer', h => h.put('ems.0.System.LastUpdate', h.now() - 31000)]
]) test(`WP ${label} returns NORMAL immediately despite active hold`, () => {
    const h = engine(); assert.equal(h.update().mode, 'BOOST');
    h.advance(1); change(h);
    const advice = h.update();
    assert.equal(advice.mode, 'NORMAL');
    assert.equal(advice.value, 1);
    assert.equal(advice.valid, false);
    assert.equal(h.foreignWrites.length, 0);
});

test('reached thermal target cancels BOOST during hold and REDUCED never means compressor OFF', () => {
    const h = engine(); assert.equal(h.update().mode, 'BOOST');
    h.advance(1); h.put('buffer', 45);
    const advice = h.update();
    assert.equal(advice.mode, 'REDUCED');
    assert.equal(advice.value, 0);
    assert.equal(advice.heatRoomAvailable, false);
    assert.equal(h.foreignWrites.length, 0);
    h.run('stopHeatPumpOutput()');
    assert.equal(h.run('getHeatPumpAdvice().mode'), 'NORMAL');
});

test('negative market price alone is not cheap when total electricity price remains positive', () => {
    const h = engine({thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 0, thermalCheapGridMaxW: 3000});
    h.put('DP_GRID_EXPORT', 0); h.dynamicPrice(-5);
    const policy = h.run('evaluateThermalPricePolicy()');
    assert.equal(policy.valid, true);
    assert.ok(policy.totalCt > 10);
    assert.equal(policy.cheapAllowed, false);
    assert.equal(h.update().mode, 'NORMAL');
});

test('cheap total price only boosts WP with positive bounded grid allowance and thermal headroom', () => {
    const h = engine({thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 0, thermalCheapGridMaxW: 3000});
    h.put('DP_GRID_EXPORT', 0); h.dynamicPrice(-20);
    assert.equal(h.run('evaluateThermalPricePolicy().cheapAllowed'), true);
    assert.equal(h.update().mode, 'BOOST');
    h.advance(301); h.put('buffer', 45);
    assert.equal(h.update().mode, 'REDUCED');
    const disabled = engine({thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 0, thermalCheapGridMaxW: 0});
    disabled.put('DP_GRID_EXPORT', 0); disabled.dynamicPrice(-20);
    assert.equal(disabled.update().mode, 'NORMAL');
});

test('missing requested dynamic price is never replaced by a cheap fixed fallback', () => {
    const h = engine({thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 50, thermalCheapGridMaxW: 3000});
    h.put('DP_GRID_EXPORT', 0); h.put('ems.0.Config.DynamicEnergyPriceEnabled', true);
    const policy = h.run('evaluateThermalPricePolicy()');
    assert.equal(policy.valid, false);
    assert.equal(policy.totalCt, null);
    assert.equal(policy.cheapAllowed, false);
    assert.equal(h.update().mode, 'NORMAL');
});

test('fixed tariff remains explicitly fixed and needs separate permission for cheap grid heat', () => {
    const h = engine({thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 50});
    const policy = h.run('evaluateThermalPricePolicy()');
    assert.equal(policy.valid, true);
    assert.match(policy.source, /Fester Gesamtstromtarif/);
    assert.equal(policy.cheapAllowed, false);
    h.config.thermalCheapFixedTariffAllowed = true;
    assert.equal(h.run('evaluateThermalPricePolicy().cheapAllowed'), true);
});

test('finite price components cannot overflow into a valid negative infinite total', () => {
    const h = engine({thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 0});
    h.dynamicPrice(-1e308, {gridCt: -1e308, addersCt: 0});
    const policy = h.run('evaluateThermalPricePolicy()');
    assert.equal(policy.valid, false);
    assert.equal(policy.cheapAllowed, false);
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts: h.now(), val: -20}]), {ts: h.now() + 60000});
    assert.equal(h.run('evaluateThermalPricePolicy().valid'), false);
});

test('expired cheap-price authorization cannot retain a price-only BOOST during hold', () => {
    const h = engine({thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 0, thermalCheapGridMaxW: 3000});
    h.put('DP_GRID_EXPORT', 0); h.dynamicPrice(-20);
    assert.equal(h.update().mode, 'BOOST');
    h.advance(1); h.states.delete('DP_ENERGY_PRICE_SERIES');
    assert.equal(h.update().mode, 'NORMAL');
    assert.equal(h.states.get('ems.0.Devices.HeatPump.HoldRemaining_s').val, 0);
});

test('quarter-hour price changes are used and a missing quarter is never filled with the hour price', () => {
    const h = engine({thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 0});
    h.dynamicPrice(-20);
    h.put('DP_ENERGY_PRICE_SERIES', JSON.stringify([{ts: h.now(), val: -20}, {ts: h.now() + 900000, val: 5}]));
    assert.equal(h.run('evaluateThermalPricePolicy().cheapAllowed'), true);
    h.advance(901);
    assert.equal(h.run('evaluateThermalPricePolicy().cheapAllowed'), false);
    h.advance(900);
    assert.equal(h.run('evaluateThermalPricePolicy().valid'), false);
});

test('WP default disabled remains NORMAL even with PV, cold buffer and cheap total price', () => {
    const h = engine({heatPumpAdviceEnabled: false});
    assert.equal(h.update().mode, 'NORMAL');
    assert.equal(h.update().enabled, false);
});

test('unmapped WP thermal inputs remain NORMAL instead of pretending an empty sensor is cold', () => {
    const h = engine({heatPumpBufferTemperatureId: '', heatPumpDhwTemperatureId: ''});
    assert.equal(h.update().mode, 'NORMAL');
    assert.equal(h.update().valid, false);
    assert.equal(h.update().heatRoomAvailable, false);
});

test('WP can use one explicitly mapped DHW sensor without an invented second temperature source', () => {
    const h = engine({heatPumpBufferTemperatureId: '', heatPumpDhwTemperatureId: 'dhw'});
    h.put('dhw', 55);
    const advice = h.update();
    assert.equal(advice.mode, 'BOOST');
    assert.equal(advice.heatingRoomAvailable, false);
    assert.equal(advice.dhwRoomAvailable, true);
});

test('WP uses the same confirmed heartbeat policy as the heating-buffer cooling guard', () => {
    const h = engine({heatingCoolingHeartbeatId: 'coolingHeartbeat'});
    h.put('cooling', false, {ts: h.now() - 86400000});
    h.put('coolingHeartbeat', h.now());
    assert.equal(h.update().mode, 'BOOST');
    h.advance(1);
    h.put('coolingHeartbeat', h.now() - 121000);
    assert.equal(h.update().mode, 'NORMAL');
    assert.equal(h.states.get('ems.0.Devices.HeatPump.CoolingDataValid').val, false);
});
