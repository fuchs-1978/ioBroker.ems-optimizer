'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {SMA_GRID_MAX_AGE_MS} = require('../lib/source-diagnostics');
const heatPumpTelemetryParser = require('../lib/heatpump-telemetry');

// Run the production engine fragments with source states, rather than
// imitating the heat-pump decision formula in a test-only controller.
function engine(overrides = {}) {
    let now = Date.UTC(2026, 9, 9, 10);
    const states = new Map(), foreignWrites = [];
    const config = {
        globalWriteEnabled: true, heatPumpAdviceEnabled: true,
        heatPumpPowerId: 'wpPower', heatPumpPowerUnit: 'W', heatPumpPowerScope: 'total',
        heatPumpPowerMaxAgeS: 30, heatPumpFeedbackMaxAgeS: 120,
        heatPumpBufferTemperatureId: 'buffer', heatPumpHeatingTargetC: 45,
        heatingCoolingActiveId: 'cooling', heatPumpMinHoldS: 300,
        heatPumpMaxBoostEnabled: false, heatPumpMaxBoostOnW: 5000, heatPumpMaxBoostOffW: 4000,
        heatPumpCoolingBoostEnabled: false, heatPumpCoolingRoomTemperatureId: 'room',
        heatPumpCoolingDewPointId: 'dew', heatPumpCoolingFlowTemperatureId: 'flow',
        heatPumpCoolingRoomTargetC: 23, heatPumpCoolingFlowTargetC: 20,
        heatPumpCoolingDewPointMarginK: 2, ...overrides
    };
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    const context = vm.createContext({SMA_GRID_MAX_AGE_MS, heatPumpTelemetryParser,
        nativeConfig: config, Date: Clock, getState: id => states.get(id),
        existsState: id => states.has(id), createState: (id, val) => {
            if (!states.has(id)) put(id, val);
        }, setState: (id, value) => {
            if (!id.startsWith('ems.0.')) foreignWrites.push({id, value});
            put(id, value);
        }, writeForeignState: (...args) => foreignWrites.push(args), log: () => {}});
    for (const file of ['core', 'prices', 'heating-controller', 'heatpump-controller']) {
        const source = fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) => {
                if (['DP_HEAT_PUMP_BUFFER_TEMP', 'DP_HEAT_PUMP_DHW_TEMP'].includes(key)) return '';
                if (key === 'DP_HEAT_PUMP_POWER') return config.heatPumpPowerId;
                return key;
            });
        vm.runInContext(source, context);
    }
    const run = source => vm.runInContext(source, context);
    run(`createStates(); createHeatPumpStates();
        CFG.dp.dynamicEnergyPriceEnabled='';CFG.dp.dynamicGridFeeEnabled='';`);
    for (const suffix of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Enabled', 'Control.Valid',
        'Devices.HeatPump.Present', 'Devices.HeatPump.ControlEnabled']) put(`ems.0.${suffix}`, true);
    for (const suffix of ['System.LastUpdate', 'Control.LastUpdate']) put(`ems.0.${suffix}`, now);
    for (const [id, value] of Object.entries({DP_GRID_IMPORT: 0, DP_GRID_EXPORT: 3000,
        wpPower: 0, buffer: 40, cooling: false, room: 26, dew: 18, flow: 25})) put(id, value);
    const read = suffix => states.get(`ems.0.Devices.HeatPump.${suffix}`)?.val;
    const assertReadOnly = () => {
        assert.deepEqual(foreignWrites, [], 'preparation never writes to the ISG, SG inputs or actuators');
        assert.equal(read('OutputOwned'), false);
        assert.equal(read('OutputActive'), false);
    };
    const refresh = () => {
        for (const [id, state] of states) if (state.ack) put(id, state.val, {q: state.q});
        for (const suffix of ['System.LastUpdate', 'Control.LastUpdate']) put(`ems.0.${suffix}`, now);
    };
    return {config, states, put, run, read, assertReadOnly, now: () => now,
        advance: (seconds, shouldRefresh = true) => { now += seconds * 1000; if (shouldRefresh) refresh(); },
        update: budget => {
            const result = run(`updateHeatPumpAdvice(Date.now(), ${budget === undefined ? 'null' : budget})`);
            assertReadOnly();
            return result;
        }};
}

test('WP preparation publishes real zero power and unit-normalized inverter-only scope without implying total consumption', () => {
    const zero = engine(); zero.update();
    assert.equal(zero.read('PowerValid'), true);
    assert.equal(zero.read('Power_W'), 0);
    assert.equal(zero.read('PowerScope'), 'total');
    assert.equal(zero.read('SGReadyRequestedState'), 3);
    const inverter = engine({heatPumpPowerUnit: 'kW', heatPumpPowerScope: 'inverter'});
    inverter.put('wpPower', 1.5); inverter.update();
    assert.equal(inverter.read('PowerValid'), true);
    assert.equal(inverter.read('Power_W'), 1500);
    assert.equal(inverter.read('PowerScope'), 'inverter');
    assert.match(inverter.read('PowerStatus'), /inverter|verdichter/i);
});

test('an unmapped WP power source stays unknown and cannot produce an SG3 recommendation from PV alone', () => {
    const h = engine({heatPumpPowerId: ''}); h.update();
    assert.equal(h.read('PowerValid'), false);
    assert.equal(h.read('Power_W'), null);
    assert.equal(h.read('PowerSourceAge_s'), null);
    assert.equal(h.read('SGReadyRequestedState'), 2);
    assert.equal(h.read('SGReadyRecommendationValid'), false);
});

test('loss of qualified WP power cancels a held heating boost and never replaces unknown with zero', async t => {
    for (const mode of ['missing', 'null', 'stale', 'unacknowledged']) await t.test(mode, () => {
        const h = engine(); assert.equal(h.update().mode, 'BOOST');
        h.advance(1);
        if (mode === 'missing') h.states.delete('wpPower');
        else h.put('wpPower', mode === 'null' ? null : 0,
            mode === 'stale' ? {ts: h.now() - 30001} : mode === 'unacknowledged' ? {ack: false} : {});
        assert.equal(h.update().mode, 'NORMAL');
        assert.equal(h.read('Power_W'), null);
        assert.equal(h.read('PowerValid'), false);
        assert.equal(h.read('HeatingBoostRequested'), false);
        assert.equal(h.read('SGReadyRequestedState'), 2);
        assert.equal(h.read('HoldRemaining_s'), 0);
    });
});

test('an explicitly null WP-power age limit cannot fall back to a permissive default during a held boost', () => {
    const h = engine(); assert.equal(h.update().mode, 'BOOST');
    h.advance(1); h.put('ems.0.Config.HeatPumpPowerMaxAge_s', null);
    assert.equal(h.update().mode, 'NORMAL');
    assert.equal(h.read('PowerValid'), false);
    assert.equal(h.read('Power_W'), null);
    assert.equal(h.read('HeatingBoostRequested'), false);
    assert.equal(h.read('SGReadyRequestedState'), 2);
});

test('unusable configured hysteresis or hold values revoke a held heating recommendation', async t => {
    for (const key of ['HeatPumpPVBoostOff_W', 'HeatPumpMinimumHold_s', 'HeatPumpMaxBoostOff_W']) {
        for (const value of [null, '', 'not a number', -1]) await t.test(`${key}: ${JSON.stringify(value)}`, () => {
            const maximum = key === 'HeatPumpMaxBoostOff_W';
            const h = engine({heatPumpMaxBoostEnabled: maximum});
            h.put('DP_GRID_EXPORT', maximum ? 6000 : 3000);
            assert.equal(h.update().mode, maximum ? 'MAX' : 'BOOST');
            h.advance(1); h.put(`ems.0.Config.${key}`, value); h.update();
            assert.equal(h.read('RequestedMode'), 'NORMAL');
            assert.equal(h.read('SGReadyRequestedState'), 2);
            assert.equal(h.read('HeatingBoostRequested'), false);
            assert.equal(h.read('HoldRemaining_s'), 0);
        });
    }
});

test('optional connection is explicitly unknown, while a mapped disconnected WP blocks heating boost', () => {
    const optional = engine(); optional.update();
    assert.equal(optional.read('Connected'), null);
    assert.equal(optional.read('ConnectionValid'), false);
    assert.equal(optional.read('SGReadyRequestedState'), 3);
    const mapped = engine({heatPumpConnectionId: 'connected'});
    mapped.put('connected', true); mapped.update();
    assert.equal(mapped.read('ConnectionValid'), true);
    assert.equal(mapped.read('Connected'), true);
    mapped.advance(1); mapped.put('connected', false); mapped.update();
    assert.equal(mapped.read('Connected'), false);
    assert.equal(mapped.read('ConnectionValid'), true);
    assert.equal(mapped.read('HeatingBoostRequested'), false);
    assert.equal(mapped.read('SGReadyRequestedState'), 2);
});

test('observed SG state is independent of the recommendation and expires without inventing a command ACK', () => {
    const h = engine({heatPumpSgReadyStateId: 'sg'});
    h.put('sg', 2); h.update();
    assert.equal(h.read('SGReadyRequestedState'), 3);
    assert.equal(h.read('SGReadyFeedbackValid'), true);
    assert.equal(h.read('SGReadyFeedbackState'), 2, 'observed NORMAL remains distinct from recommended BOOST');
    h.advance(1); h.put('sg', 3, {ts: h.now() - 120001}); h.update();
    assert.equal(h.read('SGReadyRequestedState'), 3);
    assert.equal(h.read('SGReadyFeedbackValid'), false);
    assert.equal(h.read('SGReadyFeedbackState'), null);
});

test('MAX is opt-in, uses separate PV hysteresis, and REDUCED maps to normal SG2 rather than blocking SG1', () => {
    const disabled = engine(); disabled.put('DP_GRID_EXPORT', 6000); disabled.update();
    assert.equal(disabled.read('SGReadyRequestedState'), 3);
    const h = engine({heatPumpMaxBoostEnabled: true});
    h.put('DP_GRID_EXPORT', 6000); assert.equal(h.update().mode, 'MAX');
    assert.equal(h.read('RequestedModeValue'), 3);
    assert.equal(h.read('SGReadyRequestedState'), 4);
    h.advance(301); h.put('DP_GRID_EXPORT', 4500); h.update();
    assert.equal(h.read('SGReadyRequestedState'), 4);
    h.advance(301); h.put('DP_GRID_EXPORT', 3999); h.update();
    assert.equal(h.read('SGReadyRequestedState'), 3);
    h.advance(1); h.put('buffer', 45); assert.equal(h.update().mode, 'REDUCED');
    assert.equal(h.read('RequestedModeValue'), 0);
    assert.equal(h.read('SGReadyRequestedState'), 2);
});

test('disabling MAX revokes SG4 immediately even while its minimum hold is active', () => {
    const h = engine({heatPumpMaxBoostEnabled: true});
    h.put('DP_GRID_EXPORT', 6000); h.update();
    assert.equal(h.read('SGReadyRequestedState'), 4);
    h.advance(1); h.put('ems.0.Config.HeatPumpMaxBoostEnabled', false); h.update();
    assert.equal(h.read('SGReadyRequestedState'), 3);
    assert.equal(h.read('RequestedMode'), 'BOOST');
});

test('an active or unverified consumption limit revokes MAX immediately without pretending SG2 enforces a watt limit', async t => {
    for (const mode of ['active limit', 'invalid limit', 'active mirrored limit']) await t.test(mode, () => {
        const h = engine({heatPumpMaxBoostEnabled: true});
        h.put('DP_GRID_EXPORT', 6000); h.update();
        assert.equal(h.read('SGReadyRequestedState'), 4);
        h.advance(1);
        if (mode === 'active mirrored limit') h.put('ems.0.Control.GridOperatorLimitActive', true);
        else h.run(`function currentConsumptionLimit() { return {
            valid: ${mode === 'active limit'}, active: true, budgetW: 4200,
            reason: 'Test: §14a/LPC-Leistungsbegrenzung'}; }`);
        h.update();
        assert.equal(h.read('SGReadyRequestedState'), 2);
        assert.equal(h.read('HeatingBoostRequested'), false);
        assert.equal(h.read('CoolingBoostRequested'), false);
        assert.equal(h.read('RequestedMode'), 'NORMAL');
    });
});

test('DHW-only demand may recommend SG3 without claiming a heating-buffer boost', () => {
    const h = engine({heatPumpBufferTemperatureId: '', heatPumpDhwTemperatureId: 'dhw'});
    h.put('dhw', 50); h.update();
    assert.equal(h.read('SGReadyRequestedState'), 3);
    assert.equal(h.read('DHWRoomAvailable'), true);
    assert.equal(h.read('HeatingBoostRequested'), false);
});

test('confirmed cooling has its own demand sources and keeps heating SG normal even with MAX-sized PV', () => {
    const h = engine({heatPumpCoolingBoostEnabled: true, heatPumpMaxBoostEnabled: true,
        heatPumpBufferTemperatureId: '', heatPumpDhwTemperatureId: ''});
    h.put('cooling', true); h.put('DP_GRID_EXPORT', 6000); h.update();
    assert.equal(h.read('CoolingBoostValid'), true);
    assert.equal(h.read('CoolingBoostRequested'), true);
    assert.equal(h.read('CoolingRoomTarget_C'), 23);
    assert.equal(h.read('CoolingFlowTarget_C'), 20);
    assert.equal(h.read('HeatingBoostRequested'), false);
    assert.equal(h.read('SGReadyRequestedState'), 2);
});

test('cooling respects the dew-point margin and cancels boost when room or flow headroom is exhausted', () => {
    const h = engine({heatPumpCoolingBoostEnabled: true}); h.put('cooling', true);
    h.put('dew', 21); h.update();
    assert.equal(h.read('CoolingBoostRequested'), true);
    assert.equal(h.read('CoolingFlowTarget_C'), 23);
    h.advance(1); h.put('dew', 24); h.update();
    assert.equal(h.read('CoolingFlowTarget_C'), 26);
    assert.equal(h.read('CoolingBoostRequested'), false, 'target above the actual flow is not extra cooling headroom');
    h.advance(1); h.put('dew', 18); h.put('room', 23); h.update();
    assert.equal(h.read('CoolingBoostRequested'), false, 'reached room target ends the boost without waiting out a hold');
});

test('cooling rejects unsupported targets and preserves the dew-point margin without inventing a safe clamp', async t => {
    const cases = [
        ['derived flow 42 °C', h => { h.put('room', 50); h.put('dew', 40); h.put('flow', 50); }],
        ['zero dew-point safety margin', h => h.put('ems.0.Config.HeatPumpCoolingDewPointMargin_K', 0)],
        ['room target below Admin minimum', h => h.put('ems.0.Config.HeatPumpCoolingRoomTarget_C', 15)],
        ['room target above Admin maximum', h => h.put('ems.0.Config.HeatPumpCoolingRoomTarget_C', 31)],
        ['flow target above Admin maximum', h => h.put('ems.0.Config.HeatPumpCoolingFlowTarget_C', 31)]
    ];
    for (const [label, change] of cases) await t.test(label, () => {
        const h = engine({heatPumpCoolingBoostEnabled: true});
        h.put('cooling', true); h.update();
        assert.equal(h.read('CoolingBoostRequested'), true);
        h.advance(1); change(h); h.update();
        assert.equal(h.read('CoolingBoostValid'), false);
        assert.equal(h.read('CoolingBoostRequested'), false);
        assert.equal(h.read('CoolingFlowTarget_C'), null);
        assert.equal(h.read('SGReadyRequestedState'), 2);
    });
});

test('cooling boost is disabled by default and cannot be authorized solely by a forecast or cheap-price permission', () => {
    const disabled = engine(); disabled.put('cooling', true); disabled.update();
    assert.equal(disabled.read('CoolingBoostRequested'), false);
    const noPv = engine({heatPumpCoolingBoostEnabled: true,
        thermalCheapPriceEnabled: true, thermalCheapPriceMaxCt: 100,
        thermalCheapFixedTariffAllowed: true, thermalCheapGridMaxW: 6000});
    noPv.put('cooling', true); noPv.put('DP_GRID_EXPORT', 0);
    noPv.put('ems.0.Forecast.HeatPumpCooling_W', 5000); noPv.update();
    assert.equal(noPv.read('CoolingBoostRequested'), false);
    assert.equal(noPv.read('SGReadyRequestedState'), 2);
});

test('a cooling request is cleared immediately by loss of any required source or master permission', async t => {
    const cases = [
        ['master OFF', h => h.put('ems.0.System.RealOutputsEnabled', false)],
        ['unknown cooling mode', h => h.states.delete('cooling')],
        ['stale room', h => h.put('room', 26, {ts: h.now() - 120001})],
        ['bad dew-point quality', h => h.put('dew', 18, {q: 0x40})],
        ['missing flow', h => h.put('flow', null)],
        ['stale WP power', h => h.put('wpPower', 0, {ts: h.now() - 30001})],
        ['stale grid power', h => h.put('DP_GRID_EXPORT', 3000, {ts: h.now() - SMA_GRID_MAX_AGE_MS - 1})],
        ['stale system', h => h.put('ems.0.System.LastUpdate', h.now() - 31000)],
        ['invalid central control', h => h.put('ems.0.Control.Valid', false)],
        ['stale central control', h => h.put('ems.0.Control.LastUpdate', h.now() - 31000)]
    ];
    for (const [label, change] of cases) await t.test(label, () => {
        const h = engine({heatPumpCoolingBoostEnabled: true});
        h.put('cooling', true); h.update();
        assert.equal(h.read('CoolingBoostRequested'), true);
        h.advance(1); change(h); h.update();
        assert.equal(h.read('CoolingBoostRequested'), false);
        assert.equal(h.read('SGReadyRequestedState'), 2);
        assert.equal(h.read('HeatingBoostRequested'), false);
    });
});

test('stopping WP preparation clears every request and ownership without a foreign command', () => {
    const h = engine({heatPumpCoolingBoostEnabled: true});
    h.put('cooling', true); h.update();
    assert.equal(h.read('CoolingBoostRequested'), true);
    h.run('stopHeatPumpOutput("Master wird ausgeschaltet")'); h.assertReadOnly();
    assert.equal(h.read('SGReadyRequestedState'), 2);
    assert.equal(h.read('HeatingBoostRequested'), false);
    assert.equal(h.read('CoolingBoostRequested'), false);
});
