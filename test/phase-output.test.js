'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PhaseOutput = require('../lib/phase-output');

function setup(overrides = {}) {
    const states = new Map(), writes = [];
    const now = Date.now();
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, ts: now, ...extra});
    const config = {
        globalWriteEnabled: true,
        wb0Present: true,
        wb0PhaseSwitchEnabled: true,
        wb0PhaseOutputEnabled: true,
        wb0PhaseOutputId: 'javascript.0.ev.pha0',
        wb0MaxCurrent1pA: 16,
        phaseSwitchLookAheadMin: 30,
        phaseSwitchMinHoldMin: 30,
        ...overrides
    };
    const adapter = {
        namespace: 'ems.0', config, stateCache: states, allowedForeignWriteIds: new Set(),
        getCachedState: id => states.get(id),
        setCompatState: (id, val) => put(id, val),
        queueCompatState: async (id, val) => { if (!states.has(id)) put(id, val); },
        getForeignObjectAsync: async id => id ? ({type: 'state', common: {write: true, type: 'number'}}) : null,
        getForeignStateAsync: async id => states.get(id),
        subscribeForeignStatesAsync: async () => {},
        setForeignStateAsync: async (id, val) => { writes.push({id, val}); put(id, val, {ack: false}); },
        log: {error: () => {}}
    };
    for (const [id, value] of Object.entries({
        'ems.0.System.RealOutputsEnabled': true,
        'ems.0.Devices.Wallbox0.Present': true,
        'ems.0.Vehicles.Wallbox0.PhaseSwitchEnabled': true,
        'ems.0.Vehicles.Wallbox0.Connected': true,
        'ems.0.Vehicles.Wallbox0.Release': true,
        'ems.0.Vehicles.Wallbox0.GridEnergyRequired_kWh': 5,
        'ems.0.Vehicles.Wallbox0.DepartureTimestamp': now + 4 * 3600000,
        'ems.0.Plan.Valid': true,
        'ems.0.Plan.LastUpdate': now,
        'ems.0.Control.Valid': true,
        'ems.0.Control.LastUpdate': now,
        'ems.0.Devices.Wallbox0.PhaseOutputLastWrite': 0,
        'javascript.0.ev.pha0': 0
    })) put(id, value);
    const plan = phases => phases.map((phase, index) => ({
        timestamp: now + index * 15 * 60000,
        valueW: phase === 3 ? 6000 : 2300,
        phases: phase,
        chargingMinutes: 15
    }));
    put('ems.0.Plan.Wallbox0_48h_JSON', JSON.stringify(plan([3, 3])));
    const output = new PhaseOutput(adapter);
    return {adapter, config, states, writes, put, plan, output, now};
}

test('phase output is disabled by default and never writes', async () => {
    const h = setup({wb0PhaseOutputEnabled: false});
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.PhaseOutputStatus').val, /Admin aus/);
});

test('stable forecast writes three phases to the configured existing object', async () => {
    const h = setup();
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'javascript.0.ev.pha0', val: 3}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseOutputCommand').val, 3);
});

test('mixed short phase windows do not cause a switch', async () => {
    const h = setup();
    h.put('ems.0.Plan.Wallbox0_48h_JSON', JSON.stringify(h.plan([3, 1])));
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.PhaseOutputStatus').val, /kein ausreichend/);
});

test('energy that cannot be delivered one-phase before departure selects three phases immediately', async () => {
    const h = setup();
    h.put('ems.0.Plan.Wallbox0_48h_JSON', JSON.stringify(h.plan([1, 1])));
    h.put('ems.0.Vehicles.Wallbox0.GridEnergyRequired_kWh', 10);
    h.put('ems.0.Vehicles.Wallbox0.DepartureTimestamp', h.now + 2 * 3600000);
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'javascript.0.ev.pha0', val: 3}]);
});

test('minimum hold time prevents frequent one/three-phase switching', async () => {
    const h = setup();
    h.put('javascript.0.ev.pha0', 1);
    h.put('ems.0.Devices.Wallbox0.PhaseOutputLastWrite', h.now);
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.PhaseOutputStatus').val, /Mindesthaltezeit/);
    h.output.devices[0].lastWriteAt = h.now - 31 * 60000;
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'javascript.0.ev.pha0', val: 3}]);
});

test('unchanged phase command is not written repeatedly', async () => {
    const h = setup();
    await h.output.initialize(); await h.output.tick(); await h.output.tick();
    assert.equal(h.writes.length, 1);
});

test('invalid or stale planning data fails closed', async () => {
    const h = setup();
    h.put('ems.0.Plan.Valid', false);
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
});
