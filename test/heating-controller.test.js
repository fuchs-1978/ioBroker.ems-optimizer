'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
    let now = 2000000;
    const states = new Map(), writes = [], pending = [];
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, ...extra});
    const own = (id, val, extra) => put(`ems.0.${id}`, val, extra);
    const nativeConfig = {globalWriteEnabled: true, heatingPresent: true, heatingControlEnabled: true,
        heatingProductionArmed: true, heatingSetpointId: 'hkSet', heatingConnectionId: 'hkOnline',
        heatingCoolingActiveId: 'cooling', heatingTempId: 'hkTemp',
        heatingOutput1Id: 'hk1', heatingOutput2Id: 'hk2', heatingOutput3Id: 'hk3'};
    const settings = {leader: 'Battery', importAllowed: false, batteryW: 0,
        limit: {valid: true, active: false, budgetW: null}};
    for (const id of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid',
        'Devices.MyPV_Heating.Present', 'Devices.MyPV_Heating.ControlEnabled', 'Devices.MyPV_Heating.DriverReady']) own(id, true);
    own('System.LastUpdate', now); own('Control.LastUpdate', now);
    own('Control.Targets.MyPV_Heating_W', 6000);
    own('Control.TargetGridPower_W', -100); own('Control.Deadband_W', 100);
    own('Config.HouseConnectionWorkingLimit_A', 46); own('Config.HouseConnectionFuse_A', 50);
    for (const [id, value] of Object.entries({hkOnline: true, cooling: false, hkTemp: 40,
        hk1: 0, hk2: 0, hk3: 0, h1: 10, h2: 10, h3: 10, gridIn: 0, gridOut: 6100,
        ww1: 0, ww2: 0, ww3: 0, critical: false})) put(id, value);
    const ctx = vm.createContext({Math, Number, Date: {now: () => now}, nativeConfig,
        gridConstraints: require('../lib/grid-constraints'),
        CFG: {root: 'ems.0', dataMaxAgeMs: 120000, dp: {
            myPvHeatingTemp: 'hkTemp', myPvDhwOutputW: ['ww1', 'ww2', 'ww3'],
            myPvDhwHaCurrentA: ['h1', 'h2', 'h3'], haCritical: 'critical',
            myPvDhwSetpoint: 'wwSet', myPvDhwConnection: 'wwOnline',
            myPvDhwOutletTemp: 'wwOutlet', dhwTemps: ['t1', 't2', 't3', 't4'],
            gridImport: 'gridIn', gridExport: 'gridOut', wallboxesKW: ['wb0', 'wb1', 'wb2']}},
        getState: id => states.get(id), existsState: id => states.has(id),
        write: (id, value) => put(id, value),
        stateDef: (id, value) => { if (!states.has(id)) put(id, value); },
        readNumber: (id, fallback) => states.has(id) ? Number(states.get(id).val) : fallback,
        writeForeignState: (id, value, callback) => { writes.push({id, value}); pending.push(callback); return true; },
        heaterUsesGridFeedback: name => settings.leader === name && !settings.importAllowed,
        batteryMeasuredPowerW: () => settings.batteryW,
        currentConsumptionLimit: () => settings.limit});
    for (const file of ['dhw-output.js', 'heating-controller.js']) vm.runInContext(
        fs.readFileSync(path.join(__dirname, '../lib/engine', file), 'utf8'), ctx);
    vm.runInContext('createHeatingStates()', ctx);
    const run = source => vm.runInContext(source, ctx);
    return {states, writes, put, own, nativeConfig, settings, run,
        tick: () => run('updateHeatingProductionOutput()'),
        complete: error => { for (const callback of pending.splice(0)) callback?.(error || null); },
        advance: ms => { now += ms; },
        fresh: () => {
            for (const s of states.values()) s.ts = now;
            own('System.LastUpdate', now); own('Control.LastUpdate', now);
        },
        command: () => writes.filter(w => w.id === 'hkSet').at(-1)?.value};
}

test('independent HK controller follows budget while battery absorbs NVP residual', () => {
    const h = setup();
    h.put('gridOut', 0); h.put('gridIn', 2400);
    h.tick(); h.complete();
    assert.equal(h.command(), 1000, 'intentional coordinated load is not cancelled by local grid import');
    h.put('hk1', 1000);
    h.tick(); h.complete();
    assert.equal(h.command(), 2000);
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputOwned').val, true);
});

test('HK cooling interlock and manual inhibit stop an active heater immediately', () => {
    for (const trigger of ['cooling', 'manual']) {
        const h = setup(); h.tick(); h.complete();
        if (trigger === 'cooling') h.put('cooling', true);
        else h.own('Config.HeatingInhibit', true);
        h.tick(); h.complete();
        assert.equal(h.command(), 0);
        assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.Release').val, false);
        const length = h.writes.length;
        h.tick();
        assert.equal(h.writes.length, length, 'no recurring write after relinquishment');
    }
});

test('missing, bad-quality and stale cooling status fail closed without disabling DHW', () => {
    for (const [value, extra] of [[null, {}], [false, {q: 64}], [false, {ack: false}], [false, {ts: 1000000}]]) {
        const h = setup();
        h.own('Devices.MyPV_DHW.Release', true);
        h.put('cooling', value, extra); h.tick();
        assert.equal(h.command(), undefined);
        assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.CoolingDataValid').val, false);
        assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.Release').val, true);
    }
});

test('fresh trusted timestamp heartbeat permits an unchanged cooling signal but fails closed when missing', () => {
    const h = setup();
    h.nativeConfig.heatingCoolingHeartbeatId = 'heartbeat';
    h.put('cooling', false, {ts: 1000000}); h.put('heartbeat', 2000000);
    h.tick(); h.complete(); assert.equal(h.command(), 1000);
    h.put('heartbeat', 1000000); h.tick(); h.complete();
    assert.equal(h.command(), 0);
    assert.match(h.states.get('ems.0.Devices.MyPV_Heating.Status').val, /Heartbeat/);
});

test('HK target-temperature hysteresis, missing sensors and emergency limits remain hard caps', () => {
    const h = setup(); h.tick(); h.complete();
    h.put('hkTemp', 50); h.tick(); h.complete(); assert.equal(h.command(), 0);
    h.put('hkTemp', 49); h.tick(); assert.equal(h.command(), 0);
    h.put('hkTemp', 48); h.tick(); h.complete(); assert.equal(h.command(), 1000);
    h.put('hkTemp', null); h.tick(); h.complete(); assert.equal(h.command(), 0);
    h.put('hkTemp', 40); h.nativeConfig.heatingOutletTempId = 'outlet';
    h.put('outlet', 81); h.tick(); assert.equal(h.command(), 0);
});

test('HK rejects unsafe configuration and future-control timestamps beyond the clock tolerance', () => {
    for (const [key, value] of [['HeatingStopTemperature_C', 500], ['HeatingBufferTargetTemperature_C', 100],
        ['HeatingMaxStep_W', ''], ['HouseConnectionWorkingLimit_A', 'bad']]) {
        const h = setup(); h.own(`Config.${key}`, value); h.tick();
        assert.equal(h.command(), undefined);
    }
    const h = setup();
    h.own('Control.LastUpdate', 2000001, {ts: 2000001}); h.tick(); h.complete();
    assert.equal(h.command(), 1000, 'same-millisecond own-state monotonic timestamp is allowed');
    h.own('Control.LastUpdate', 2010000, {ts: 2010000}); h.tick(); h.complete();
    assert.equal(h.command(), 0);
});

test('HK never increases blind while actuator feedback has not reached its previous command', () => {
    const h = setup(); h.tick(); h.complete();
    h.advance(20000); h.fresh(); h.tick(); h.complete();
    assert.equal(h.command(), 1000);
    h.put('hk1', 1000); h.tick(); h.complete(); assert.equal(h.command(), 2000);
    h.own('Control.Targets.MyPV_Heating_W', 200); h.tick(); h.complete(); assert.equal(h.command(), 200);
});

test('unchanged HK budget remains valid while the real controller heartbeat continues', () => {
    const h = setup(); h.tick(); h.complete();
    const oldTargetTs = h.states.get('ems.0.Control.Targets.MyPV_Heating_W').ts;
    h.advance(60000); h.fresh();
    h.states.get('ems.0.Control.Targets.MyPV_Heating_W').ts = oldTargetTs;
    h.put('hk1', 1000); h.tick(); h.complete();
    assert.equal(h.command(), 2000);
});

test('one heater fine leader regulates NVP and hands the loop back to budget mode for cheap import', () => {
    const h = setup(); h.settings.leader = 'MyPV_Heating';
    h.put('gridOut', 2100); h.tick(); h.complete(); assert.equal(h.command(), 2000);
    h.put('hk1', 2000); h.put('gridOut', 0); h.put('gridIn', 1100);
    h.tick(); h.complete(); assert.equal(h.command(), 800);
    h.settings.importAllowed = true; h.put('hk1', 800);
    h.tick(); h.complete(); assert.equal(h.command(), 1800);
});

test('HK shared LPC cap reserves other heater and battery pending charging, never discharge credit', () => {
    const h = setup();
    h.settings.limit = {valid: true, active: true, budgetW: 4200};
    h.own('Devices.MyPV_DHW.Present', true); h.own('Devices.MyPV_DHW.OutputOwned', true);
    h.own('Devices.MyPV_DHW.OutputCommand_W', 3000);
    h.own('Devices.Battery.Present', true); h.own('Devices.Battery.OutputOwned', true);
    h.own('Devices.Battery.OutputCommandInternal_W', 700);
    h.settings.batteryW = -2000;
    h.tick(); h.complete(); assert.equal(h.command(), 500);
    h.own('Devices.MyPV_DHW.OutputCommand_W', 4200);
    h.tick(); h.complete(); assert.equal(h.command(), 0);
});

test('HK accounts for a wallbox held at minimum even with zero allocator target', () => {
    const h = setup();
    h.settings.limit = {valid: true, active: true, budgetW: 2000};
    h.own('Devices.Wallbox0.Present', true); h.own('Devices.Wallbox0.OutputOwned', true);
    h.own('Devices.Wallbox0.OutputCommand_A', 6); h.own('Devices.Wallbox0.OutputPhases', 1);
    h.own('Control.Targets.Wallbox0_W', 0); h.put('wb0', 0);
    h.tick(); h.complete(); assert.equal(h.command(), 620);
    h.put('wb0', null); h.tick(); h.complete(); assert.equal(h.command(), 0);
});

test('HK ownership survives unclean restart, sends zero to the old mapping and never claims foreign heat', () => {
    const h = setup();
    h.own('Devices.MyPV_Heating.OutputOwned', true);
    h.own('Devices.MyPV_Heating.OutputActive', true);
    h.own('Devices.MyPV_Heating.OutputCommand_W', 3000);
    h.own('Devices.MyPV_Heating.OutputSetpointId', 'oldHkSet');
    h.tick(); h.complete();
    assert.deepEqual(h.writes, [{id: 'oldHkSet', value: 0}]);
    const foreign = setup(); foreign.put('hk1', 1000); foreign.nativeConfig.globalWriteEnabled = false;
    foreign.tick(); assert.deepEqual(foreign.writes, []);
});

test('HK asynchronous write failures retain physical highwater after a database zero acknowledgement', () => {
    const h = setup(); h.tick(); h.complete(new Error('offline'));
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputActive').val, false);
    assert.equal(h.run('hasOwnedHeatingOutput()'), true);
    h.tick(); h.complete(); assert.equal(h.command(), 0);
    assert.equal(h.run('hasOwnedHeatingOutput()'), true);
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPower_W').val, 1000);
});

test('HK cooling cancellation reserves the delayed first rise until it is seen and subsequently stops', () => {
    const h = setup(); h.tick(); h.complete();
    h.advance(1000); h.put('cooling', true); h.tick(); h.complete();
    h.advance(5000); h.fresh(); h.tick();
    assert.equal(h.command(), 0);
    assert.equal(h.run('hasOwnedHeatingOutput()'), true);
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPower_W').val, 1000);
    h.advance(2000); h.put('hk1', 1000); h.tick();
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPower_W').val, 1000);
    h.advance(1000); h.put('hk1', 0); h.tick();
    assert.equal(h.run('hasOwnedHeatingOutput()'), false);
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPower_W').val, 0);
    assert.deepEqual(h.writes.map(w => w.value), [1000, 0]);
});

test('HK phase highwater preserves different staged commands instead of redecomposing their total', () => {
    const h = setup();
    h.run('sendHeatingSetpoint(2000)'); h.complete();
    h.advance(1); h.put('hk1', 2000);
    h.run('sendHeatingSetpoint(2100)'); h.complete();
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPhase1_W').val, 2000);
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPhase2_W').val, 2000);
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPower_W').val, 4000);
    h.put('cooling', true); h.tick(); h.complete();
    h.advance(8000); h.put('hk1', 100); h.put('hk2', 2000); h.tick();
    assert.equal(h.run('hasOwnedHeatingOutput()'), true);
    h.advance(1000); h.put('hk1', 0); h.put('hk2', 0); h.tick();
    assert.equal(h.run('hasOwnedHeatingOutput()'), false);
});

test('HK sink and meter changes cannot claim a new target or use its zero to clear old reservations', () => {
    const h = setup(); h.tick(); h.complete();
    h.nativeConfig.heatingSetpointId = 'newHK';
    for (const p of [1, 2, 3]) { h.nativeConfig[`heatingOutput${p}Id`] = `new${p}`; h.put(`new${p}`, 0); }
    h.tick(); h.complete(); h.advance(1000); h.fresh(); h.tick();
    assert.equal(h.command(), 0);
    assert.equal(h.writes.some(w => w.id === 'newHK'), false);
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputSetpointId').val, 'hkSet');
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPower_W').val, 1000);
});

test('HK restarted unconfirmed zero remains owned until an explicit fresh physical stop confirmation', () => {
    const first = setup(); first.tick(); first.complete();
    first.own('System.RealOutputsEnabled', false); first.tick(); first.complete();
    const h = setup(); for (const [id, state] of first.states) h.states.set(id, {...state});
    h.nativeConfig.globalWriteEnabled = false; h.tick(); h.complete();
    h.own('Devices.MyPV_Heating.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.run('hasOwnedHeatingOutput()'), true, 'unchanged pre-zero samples do not acknowledge shutdown');
    h.advance(1000); h.fresh(); const before = h.writes.length;
    h.own('Devices.MyPV_Heating.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.run('hasOwnedHeatingOutput()'), false);
    assert.equal(h.writes.length, before);
    assert.equal(h.states.get('ems.0.System.NoActuation').val, true);
});

test('HK restores protective zero ownership from phase highwater when its ownership boolean was lost', () => {
    const h = setup();
    h.own('Devices.MyPV_Heating.OutputOwned', false);
    h.own('Devices.MyPV_Heating.OutputReservedPhase2_W', 2000);
    h.own('Devices.MyPV_Heating.OutputSetpointId', 'oldHK');
    h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    assert.deepEqual(h.writes, [{id: 'oldHK', value: 0}]);
    assert.equal(h.run('hasOwnedHeatingOutput()'), true);
    assert.equal(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservedPhase2_W').val, 2000);
});

test('HK phase cap reserves pending peers and actively removes its own contribution to an overload', () => {
    const h = setup();
    h.put('h1', 45);
    h.run(`coordinatedEnergyEnabled=()=>true;
        coordinatedPhaseReservations=()=>({valid:true,otherW:[200,0,0]});`);
    h.tick(); h.complete(); assert.equal(h.command(), 30);
    h.put('hk1', 30); h.put('h1', 51);
    h.tick(); h.complete(); assert.equal(h.command(), 0);
});
