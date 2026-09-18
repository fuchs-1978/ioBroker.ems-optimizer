'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WallboxOutput = require('../lib/wallbox-output');

function setup() {
    const states = new Map(), writes = [];
    let now = Date.now();
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, ts: now, ...extra});
    const mapping = {DP_WB0_CAR: 'car', DP_WB0_SOC: 'soc', DP_WB0_ALLOW: 'userAllow',
        DP_WB0_POWER: 'power', DP_WB0_L1_A: 'i1', DP_WB0_L2_A: 'i2', DP_WB0_L3_A: 'i3',
        DP_GRID_IMPORT: 'import', DP_GRID_EXPORT: 'export', DP_HA_CRITICAL: 'critical',
        DP_PAR14A: 'par14a', DP_LPC_STATE: 'lpc'};
    const config = {globalWriteEnabled: true, wb0Present: true, wb0ControlEnabled: true,
        wb0ProductionArmed: true, wb0CommissioningMaxA: 32, wb0MaxCurrent1pA: 32,
        wb0MaxPowerW: 7360, wb0AmpereOutputId: 'cmd', wb0AllowOutputId: 'allow',
        wb0AmpereFeedbackId: 'feedback', wb0ConnectionId: 'connection', wb0ErrorId: 'error',
        dhwHaL1CurrentId: 'h1', dhwHaL2CurrentId: 'h2', dhwHaL3CurrentId: 'h3', slowCycleS: 5};
    const adapter = {namespace: 'ems.0', config, stateCache: states,
        getCachedState: id => states.get(id), readMapping: () => mapping,
        setCompatState: (id, val) => put(id, val),
        setStateAsync: async (id, val) => put(`ems.0.${id}`, val),
        setForeignStateAsync: async (id, val) => { writes.push({id, val}); put(id, val, {ack: false}); },
        getForeignStateAsync: async id => states.get(id), subscribeForeignStatesAsync: async () => {},
        getForeignObjectAsync: async () => ({type: 'state', common: {write: true, type: 'number'}}),
        queueCompatState: async (id, val) => { if (!states.has(id)) put(id, val); },
        log: {error: () => {}}};
    for (const key of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid', 'Control.Enabled',
        'Devices.Wallbox0.Present', 'Devices.Wallbox0.ControlEnabled', 'Vehicles.Wallbox0.SoCValid',
        'Vehicles.Wallbox0.Release']) put(`ems.0.${key}`, true);
    for (const key of ['System.LastUpdate', 'Control.LastUpdate']) put(`ems.0.${key}`, now);
    put('ems.0.Control.TargetGridPower_W', -100);
    put('ems.0.Control.Targets.Wallbox0_W', 7000);
    put('ems.0.Vehicles.Wallbox0.TargetSoC_pct', 80);
    put('ems.0.Vehicles.Wallbox0.MinimumSoC_pct', 20);
    for (const [id, val] of Object.entries({car: 2, soc: 50, userAllow: true, power: 0,
        i1: 0, i2: 0, i3: 0, h1: 10, h2: 10, h3: 10, import: 0, export: 8000,
        critical: false, par14a: false, lpc: 'unlimitedAutonomous', connection: true,
        error: 0, allow: 0, feedback: 6})) put(id, val);
    const output = new WallboxOutput(adapter);
    const ack = (id, value) => put(id, value, {ts: Date.now() + 1});
    const refresh = () => {
        now = Date.now();
        for (const [id, s] of states) if (s.ack) put(id, s.val);
        for (const key of ['System.LastUpdate', 'Control.LastUpdate']) put(`ems.0.${key}`, now);
    };
    const start = async () => {
        await output.initialize();
        await output.tick(); ack('allow', 0);
        await output.tick(); ack('feedback', 6);
        await output.tick(); ack('allow', 1);
        await output.tick();
    };
    return {adapter, config, mapping, states, writes, put, ack, refresh, start, output};
}

test('default/unarmed wallbox never writes, even with global release', async () => {
    const h = setup(); h.config.wb0ProductionArmed = false;
    await h.output.initialize(); await h.output.tick(); assert.equal(h.writes.length, 0);
});
test('confirmed stop, current, then release are separate steps', async () => {
    const h = setup(); await h.start();
    assert.deepEqual(h.writes, [{id:'allow', val:0}, {id:'cmd', val:6}, {id:'allow', val:1}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
});
test('current write is never treated as device acknowledgement', async () => {
    const h = setup(); await h.output.initialize(); await h.output.tick(); h.ack('allow', 0);
    await h.output.tick(); h.put('feedback', 6, {ack:false}); await h.output.tick();
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 1));
});
test('feedback timeout latches fault and never enables charging', async () => {
    const h = setup(); await h.output.initialize(); await h.output.tick(); h.ack('allow', 0);
    await h.output.tick(); h.output.devices[0].pending.at -= 30000;
    await h.output.tick(); assert.match(h.output.devices[0].fault, /Rueckmeldung/);
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 1));
});
for (const [name, change] of [
    ['global off', h => h.put('ems.0.System.RealOutputsEnabled', false)],
    ['device off', h => h.put('ems.0.Devices.Wallbox0.ControlEnabled', false)],
    ['absent', h => {h.config.wb0Present = false;}],
    ['offline', h => h.put('connection', false)],
    ['error/overtemperature', h => h.put('error', 8)],
    ['SoC target', h => h.put('soc', 80)],
    ['null SoC', h => h.put('soc', null)],
    ['HA trip', h => h.put('critical', true)],
    ['stale meter', h => h.put('import', 0, {ts:Date.now()-60000})],
    ['invalid quality', h => h.put('export', 8000, {q:0x40})],
    ['unknown curtailment', h => h.put('lpc', 'limited')],
    ['14a active', h => h.put('par14a', true)],
    ['user release off', h => h.put('userAllow', false)],
    ['unexpected phases', h => h.put('i2', 6)],
    ['no PV', h => h.put('export', 0)],
    ['second wallbox enabled', h => {h.config.wb1ControlEnabled = true;}],
    ['DHW production enabled', h => h.put('ems.0.Devices.MyPV_DHW.ControlEnabled', true)]
]) test(`${name}: active charger gets stop, no positive write`, async () => {
    const h = setup(); await h.start(); h.writes.length = 0; change(h);
    await h.output.tick(); assert.deepEqual(h.writes, [{id:'allow', val:0}]);
});
test('below minimum SoC can start without solar power', async () => {
    const h = setup(); h.put('soc',10); h.put('export',0); await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
});
test('HA cap cannot be defeated by minimum-SoC charging', async () => {
    const h = setup(); h.put('soc',10); h.put('h1',49); await h.output.initialize(); await h.output.tick();
    assert.equal(h.writes.length, 0);
});
test('no current ramp-up while device takes less than commanded', async () => {
    const h = setup(); await h.start(); h.output.devices[0].lastAt -= 10000;
    h.writes.length = 0; await h.output.tick(); assert.equal(h.writes.length,0);
});
test('current increase uses whole amps and configured ramp', async () => {
    const h = setup(); await h.start(); h.output.devices[0].lastAt -= 10000;
    h.put('i1',6); h.put('power',1.38); h.writes.length=0;
    await h.output.tick(); assert.deepEqual(h.writes,[{id:'cmd',val:12}]);
});
test('taper and available-current limits apply to production', async () => {
    const h = setup(); h.config.wb0TaperEnabled=true; h.config.wb0AvailableCurrentId='available';
    h.put('soc',79); h.put('available',7); await h.start();
    h.output.devices[0].lastAt -= 10000; h.put('i1',6); h.put('power',1.38); h.writes.length=0;
    await h.output.tick(); assert.deepEqual(h.writes,[{id:'cmd',val:7}]);
});
test('configured missing available-current signal fails closed', async () => {
    const h = setup(); h.config.wb0AvailableCurrentId='available'; h.put('available',null);
    await h.output.initialize(); await h.output.tick(); assert.equal(h.writes.length,0);
});
test('unload sends stop only to owned charger', async () => {
    const h=setup(); await h.start(); h.writes.length=0;
    h.output.stopping=true; await h.output.stopAll(); assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});
test('failed current write cannot be followed by enable', async () => {
    const h=setup(); const send=h.adapter.setForeignStateAsync;
    h.adapter.setForeignStateAsync=async(id,val)=>{if(id==='cmd')throw new Error('network');return send(id,val);};
    await h.output.initialize(); await h.output.tick(); h.ack('allow',0); await h.output.tick();
    assert.ok(h.output.devices[0].fault); assert.ok(!h.writes.some(w=>w.id==='allow'&&w.val===1));
});
test('duplicate output mappings are rejected', async () => {
    const h=setup(); h.config.wb1AmpereOutputId='cmd'; await h.output.initialize(); await h.output.tick();
    assert.equal(h.writes.length,0); assert.equal(h.output.devices[0].valid,false);
});

module.exports={setup};
