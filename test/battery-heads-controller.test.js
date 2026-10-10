'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../lib/engine/battery-controller'), 'utf8');
const sunEnergyHeads = require('../lib/sunenergy-heads');
const {SMA_GRID_MAX_AGE_MS} = require('../lib/source-diagnostics');

function harness(count = 3, persisted = new Map(), config = {}) {
    let now = 2000000;
    const states = new Map([...persisted].map(([id, state]) => [id, {...state}]));
    const writes = [], pending = [];
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, ...extra});
    const own = (suffix, value, extra) => put(`ems.0.${suffix}`, value, extra);
    const nativeConfig = {batteryDispatchMode: 'sunenergy-heads', batterySunEnergyInstance: 'sunenergyxt500.0',
        batteryHeadCount: count, globalWriteEnabled: true, batteryPresent: true, batteryControlEnabled: true,
        batteryProductionArmed: true, ...config};
    for (const suffix of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid',
        'Devices.Battery.Present', 'Devices.Battery.ControlEnabled', 'Devices.Battery.DriverReady',
        'Devices.Battery.HeadsVerified']) own(suffix, true);
    own('Control.LastUpdate', now); own('Control.Targets.Battery_W', 1000);
    own('Config.BatteryMinSoC_pct', 15); own('Config.BatteryMaxSoC_pct', 100);
    own('Config.BatteryMaxCharge_W', 7200); own('Config.BatteryMaxDischarge_W', 2400);
    own('Config.BatterySelfConsumptionEnabled', true);
    const bodies = new Map();
    const snapshot = (index, delta = {}, extra = {}) => {
        const body = {...(bodies.get(index) || {SC: 50, ON: 1, GS: 0, GP: 0, MM: 0, LM: 1,
            SI: 10, SA: 100, MG: 800, IS: 800, LP: 0, PK: 1}), ...delta};
        bodies.set(index, body);
        put(`sunenergyxt500.0.heads.${index}.info.rawResponse`, JSON.stringify(body), extra);
        put(`sunenergyxt500.0.heads.${index}.info.online`, true);
    };
    for (let index = 1; index <= count; index++) snapshot(index);
    for (const id of ['ha1', 'ha2', 'ha3']) put(id, 0);
    const limit = {valid: true, budgetW: null}, loads = {valid: true, dhwW: 0, heatingW: 0, wallboxW: 0};
    const reservations = {valid: true, otherW: [0, 0, 0]};
    const ctx = vm.createContext({Math, Date: {now: () => now, parse: Date.parse}, nativeConfig,
        sunEnergyHeads, SMA_GRID_MAX_AGE_MS, CFG: {root: 'ems.0', dp: {myPvDhwHaCurrentA: ['ha1', 'ha2', 'ha3']}},
        getState: id => states.get(id), existsState: id => states.has(id),
        write: put, stateDef: (id, val) => { if (!states.has(id)) put(id, val); },
        configDef: (id, val) => { if (!states.has(id)) put(id, val); },
        writeForeignState: (id, val, cb) => { writes.push({id, val, at: now}); pending.push(cb); return true; },
        currentConsumptionLimit: () => limit, coordinatedConsumptionLoads: () => loads,
        coordinatedPhaseReservations: () => reservations});
    vm.runInContext(source, ctx);
    const run = code => vm.runInContext(code, ctx);
    run('createBatteryStates()');
    const fresh = () => {
        own('Control.LastUpdate', now);
        for (const id of ['ha1', 'ha2', 'ha3']) put(id, 0);
        for (let index = 1; index <= count; index++) snapshot(index);
    };
    return {nativeConfig, states, writes, pending, put, own, snapshot, run, limit, loads, reservations,
        tick: () => run('updateBatteryProductionOutput()'), advance: ms => { now += ms; }, fresh,
        complete: error => { for (const cb of pending.splice(0)) cb(error || null); },
        follow: () => { now += 1100; for (const w of writes) {
            const index = Number(w.id.match(/heads\.(\d)/)[1]); snapshot(index, {GS: w.val, GP: w.val}); }
            fresh(); },
        value: suffix => states.get(`ems.0.${suffix}`)?.val,
        commands: () => writes.map(w => w.val)};
}

test('one, two and three heads receive absolute GS with capacity-weighted SoC distribution', () => {
    for (const count of [1, 2, 3]) {
        const h = harness(count); h.own('Config.BatteryFineStep_W', 600); h.tick();
        assert.equal(h.writes.length, count);
        assert.equal(h.commands().reduce((sum, value) => sum + value, 0), -600);
        assert.equal(h.value('Devices.Battery.OutputCommandInternal_W'), 600);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
        assert.equal(JSON.parse(h.value('Devices.Battery.HeadOwnership_JSON')).heads.length, count);
        for (const w of h.writes) assert.equal(h.run(`batteryHeadsQueuedCheck(${JSON.stringify(w.id)},${w.val}).allowed`), true);
    }
    const charge = harness(2); charge.snapshot(1, {SC: 20}); charge.snapshot(2, {SC: 80});
    charge.own('Config.BatteryFineStep_W', 500); charge.tick();
    assert.deepEqual(charge.commands(), [-400, -100]);
    const discharge = harness(2); discharge.snapshot(1, {SC: 20}); discharge.snapshot(2, {SC: 80});
    discharge.own('Config.BatteryFineStep_W', 700); discharge.own('Control.Targets.Battery_W', -700); discharge.tick();
    assert.deepEqual(discharge.commands(), [50, 650]);
});

test('transport acknowledgement requires a later per-head GS and GP response before the next increase', () => {
    const h = harness(2); h.tick(); h.advance(1100); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-50, -50]);
    h.complete(); h.tick(); assert.deepEqual(h.commands(), [-50, -50]);
    h.snapshot(1, {GS: -50, GP: -50}); h.snapshot(2, {GS: -50, GP: 0}); h.tick();
    assert.deepEqual(h.commands(), [-50, -50]);
    h.advance(1); h.snapshot(2, {GS: -50, GP: -50}); h.tick();
    assert.deepEqual(h.commands(), [-50, -50, -100, -100]);
});

test('redistribution reduces the loaded head first and waits for physical reduction before increasing its peer', () => {
    const h = harness(2); h.own('Config.BatteryFineStep_W', 1000); h.tick(); h.complete(); h.follow();
    h.own('Control.Targets.Battery_W', 1000); h.snapshot(1, {SC: 90}); h.snapshot(2, {SC: 10}); h.tick();
    assert.deepEqual(h.commands(), [-500, -500, -100]);
    h.complete(); h.advance(1100); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-500, -500, -100]);
    h.snapshot(1, {GS: -100, GP: -100}); h.tick();
    assert.deepEqual(h.commands(), [-500, -500, -100, -900]);
});

test('offline or stale configured head stops all owned outputs without using total heartbeat as proof', () => {
    for (const stale of [false, true]) {
        const h = harness(3); h.tick(); h.complete();
        if (stale) h.put('sunenergyxt500.0.heads.2.info.rawResponse', h.states.get('sunenergyxt500.0.heads.2.info.rawResponse').val, {ts: 1});
        else h.put('sunenergyxt500.0.heads.2.info.online', false);
        h.put('sunenergyxt500.0.info.lastUpdate', 2000000); h.tick();
        assert.deepEqual(h.commands().slice(-3), [0, 0, 0]);
        assert.equal(h.value('Devices.Battery.OutputOwned'), true);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
    }
});

test('delayed earlier nonzero writes cannot be discharged by a newer zero echo or aggregate cancellation', () => {
    const h = harness(2); h.tick(); h.complete();
    h.nativeConfig.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    h.advance(1100); h.snapshot(1, {GS: 0, GP: 0}); h.snapshot(2, {GS: 0, GP: 0}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
    // An old /write applied last: observe it and keep driving both outputs to zero.
    h.advance(16000); h.snapshot(1, {GS: -50, GP: -50}); h.snapshot(2, {GS: -50, GP: -50}); h.fresh(); h.tick();
    assert.deepEqual(h.commands().slice(-2), [0, 0]); h.complete(); h.advance(1000);
    h.snapshot(1, {GS: 0, GP: 0}); h.snapshot(2, {GS: 0, GP: 0}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 0);
    const cancellation = harness(2); cancellation.snapshot(1, {GS: -100, GP: -100}); cancellation.snapshot(2, {GS: 100, GP: 100});
    cancellation.tick(); assert.deepEqual(cancellation.commands(), []);
    assert.match(cancellation.value('Devices.Battery.OutputStatus'), /Nullleistung je Kopf/);
});

test('failed writes retain the durable claim and high-water reserve before retrying zero', () => {
    const h = harness(2); h.tick(); h.complete(new Error('transport failed')); h.tick();
    assert.deepEqual(h.commands(), [-50, -50, 0, 0]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
    assert.match(h.value('Devices.Battery.Fault'), /Ausgangsschreibfehler/);
});

test('queued stale plans and fresh aggregate/SoC/quality/house operator limits are independently rechecked', () => {
    for (const change of ['target', 'operator', 'phase', 'quality', 'soc', 'mode']) {
        const h = harness(2); h.tick(); const write = h.writes[0];
        if (change === 'target') h.own('Control.Targets.Battery_W', 50);
        if (change === 'operator') { h.limit.budgetW = 50; }
        if (change === 'phase') h.put('ha3', 46);
        if (change === 'quality') h.snapshot(2, {}, {q: 2});
        if (change === 'soc') h.snapshot(1, {SC: 100});
        if (change === 'mode') h.snapshot(1, {MM: 1});
        assert.equal(h.run(`batteryHeadsQueuedCheck(${JSON.stringify(write.id)},${write.val}).allowed`), false, change);
    }
    const h = harness(2); h.tick(); const old = h.writes[0]; h.own('Control.Targets.Battery_W', 60); h.tick();
    assert.equal(h.run(`batteryHeadsQueuedCheck(${JSON.stringify(old.id)},${old.val}).allowed`), false);
});

test('restart or topology change returns all former IDs and never reuses their aggregate as zero proof', () => {
    const before = harness(3); before.tick();
    const restarted = harness(1, before.states); restarted.tick();
    assert.deepEqual(restarted.writes.map(w => w.id), [1, 2, 3].map(index => `sunenergyxt500.0.heads.${index}.control.GS`));
    assert.deepEqual(restarted.commands(), [0, 0, 0]);
    assert.equal(restarted.value('Devices.Battery.OutputReservedCharge_W'), 100);
    const remap = harness(1, before.states, {batterySunEnergyInstance: 'sunenergyxt500.1'}); remap.tick();
    assert.ok(remap.writes.every(w => w.id.startsWith('sunenergyxt500.0.')));
    assert.deepEqual(remap.commands(), [0, 0, 0]);
});

test('direction reversal waits for physically confirmed zero of every head', () => {
    const h = harness(2); h.tick(); h.complete(); h.follow(); h.own('Control.Targets.Battery_W', -1000); h.tick();
    assert.deepEqual(h.commands(), [-50, -50, 0, 0]); h.complete(); h.advance(1100); h.fresh();
    h.snapshot(1, {GS: 0, GP: 0}); h.tick(); assert.deepEqual(h.commands(), [-50, -50, 0, 0]);
    h.advance(1); h.snapshot(2, {GS: 0, GP: 0}); h.tick();
    assert.deepEqual(h.commands(), [-50, -50, 0, 0, 50, 50]);
});

test('only explicit manual return with both global releases off and fresh per-head zeros can clear unseen debt', () => {
    for (const released of [true, false]) {
        const h = harness(2); h.tick(); h.complete(); h.own('Control.Targets.Battery_W', 0); h.tick(); h.complete();
        h.advance(1100); h.snapshot(1, {GS: 0, GP: 0}); h.snapshot(2, {GS: 0, GP: 0});
        if (!released) { h.nativeConfig.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false); }
        h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
        assert.equal(h.value('Devices.Battery.OutputOwned'), released);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), released ? 100 : 0);
    }
});

test('a settled head with an unexpected fresh GS echo faults instead of treating another writer as normal feedback', () => {
    const h = harness(2); h.tick(); h.complete(); h.follow();
    h.run('observeBatteryHeads()'); h.advance(1); h.snapshot(1, {GS: 2400, GP: 0}); h.tick();
    assert.deepEqual(h.commands().slice(-2), [0, 0]);
    assert.match(h.value('Devices.Battery.Fault'), /Reglerzustaendigkeit/);
});

test('retained peer charge reservation blocks an increase and pending reduction goes directly to zero', () => {
    const h = harness(2); h.own('Config.BatteryFineStep_W', 600); h.own('Control.Targets.Battery_W', 600); h.tick();
    h.run('batteryHeadOwners[1].reservedChargeW = 600; publishBatteryHeadsStatus("retained peer")');
    assert.equal(h.run('batteryHeadsQueuedCheck("sunenergyxt500.0.heads.1.control.GS", -300).allowed'), false);
    h.own('Control.Targets.Battery_W', 200); h.tick();
    assert.deepEqual(h.commands().slice(-2), [0, 0]);
    assert.equal(h.run('batteryHeadsQueuedCheck("sunenergyxt500.0.heads.1.control.GS", -100).allowed'), false);
});

test('malformed durable ownership preserves its original claims and reserves instead of reconstructing a free output', () => {
    const states = new Map([
        ['ems.0.Devices.Battery.HeadOwnership_JSON', {val: '{broken', ack: true, ts: 1990000}],
        ['ems.0.Devices.Battery.OutputReservedCharge_W', {val: 600, ack: true, ts: 1990000}]
    ]);
    const h = harness(2, states); h.tick();
    assert.deepEqual(h.commands(), []);
    assert.equal(h.value('Devices.Battery.HeadOwnership_JSON'), '{broken');
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
});

test('unknown own-consumption permission never authorizes discharge and phase overload only stops charge', () => {
    const h = harness(2); h.own('Config.BatterySelfConsumptionEnabled', false); h.put('ha3', 60); h.tick();
    assert.deepEqual(h.commands(), []);
    h.own('Control.Targets.Battery_W', -600); h.tick();
    assert.deepEqual(h.commands(), []);
});

test('repeated confirmed charge blocks reuse bounded per-head lifecycle entries', () => {
    const h = harness(3);
    for (let cycle = 0; cycle < 10; cycle++) {
        h.own('Control.Targets.Battery_W', 100); h.tick(); h.complete(); h.follow();
        h.own('Control.Targets.Battery_W', 0); h.tick(); h.complete(); h.follow(); h.tick();
        assert.equal(h.run('batteryHeadOwners.length'), 3);
        assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    }
});

test('a partially persisted lost ownership flag cannot erase a nonzero head command responsibility', () => {
    const ledger = {version: 1, heads: [{index: 2, setpointId: 'sunenergyxt500.0.heads.2.control.GS',
        owned: false, commandW: 600, commandAt: 1900000, reservedChargeW: 0,
        unobservedCommandW: 0, unobservedSince: 0}]};
    const states = new Map([['ems.0.Devices.Battery.HeadOwnership_JSON', {val: JSON.stringify(ledger), ts: 1900000, ack: true}]]);
    const h = harness(1, states); h.tick();
    assert.deepEqual(h.writes.map(write => ({id: write.id, val: write.val})), [{id: 'sunenergyxt500.0.heads.2.control.GS', val: 0}]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
});

test('settled unchanged standard-adapter GS holds without creating repeated identical downstream HTTP requests', () => {
    const h = harness(2); h.own('Control.Targets.Battery_W', 100); h.tick(); h.complete(); h.follow();
    for (let cycle = 0; cycle < 8; cycle++) { h.tick(); h.advance(1100); h.fresh(); }
    assert.deepEqual(h.commands(), [-50, -50]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
    assert.match(h.value('Devices.Battery.OutputStatus'), /unveraenderte GS/);
});

test('settled diagnostics remain true on later fresh matching polls and a lost electrical response blocks increases', () => {
    const h = harness(2); h.own('Control.Targets.Battery_W', 100); h.tick(); h.complete(); h.follow(); h.tick();
    h.advance(1100); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.Heads.1.ActuatorSettled'), true);
    assert.equal(h.value('Devices.Battery.ActuatorSettled'), true);
    h.snapshot(1, {GP: 0}); h.own('Control.Targets.Battery_W', 1000); h.tick();
    assert.deepEqual(h.commands(), [-50, -50]);
    assert.equal(h.value('Devices.Battery.Heads.1.ActuatorSettled'), false);
    h.advance(15000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-50, -50, 0, 0]);
    assert.match(h.value('Devices.Battery.Fault'), /Rueckmeldefrist/);
});

test('a 100 to 101 W increase cannot use old 100 W GS/GP as proof before a later zero and delayed 101 W write', () => {
    const h = harness(1); h.own('Control.Targets.Battery_W', 100); h.tick(); h.complete(); h.follow(); h.tick();
    h.own('Control.Targets.Battery_W', 101); h.tick(); h.complete();
    h.advance(1100); h.snapshot(1, {GS: -100, GP: -100}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 101);
    h.nativeConfig.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    h.advance(1100); h.snapshot(1, {GS: 0, GP: 0}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 101);
    h.advance(16000); h.snapshot(1, {GS: -101, GP: -101}); h.fresh(); h.tick(); h.complete();
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 0);
    h.advance(1100); h.snapshot(1, {GS: 0, GP: 0}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
});

test('GP near an unseen higher command does not clear its debt when the same snapshot echoes only the later lower GS', () => {
    const h = harness(1); h.own('Config.BatteryFineStep_W', 600); h.own('Control.Targets.Battery_W', 600); h.tick(); h.complete();
    h.own('Control.Targets.Battery_W', 500); h.tick(); h.complete();
    h.advance(1100); h.snapshot(1, {GS: -500, GP: -600}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 600);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
    h.nativeConfig.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    h.advance(1100); h.snapshot(1, {GS: 0, GP: 0}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
});

test('an unseen 600 W request followed by requested 500 W reduction creates only zero, never a second delayed nonzero request', () => {
    const h = harness(1); h.own('Config.BatteryFineStep_W', 600); h.own('Control.Targets.Battery_W', 600);
    h.tick(); h.complete(); h.own('Control.Targets.Battery_W', 500); h.tick(); h.complete();
    assert.deepEqual(h.commands(), [-600, 0]);
    h.own('Control.Targets.Battery_W', 0); h.tick();
    h.advance(1100); h.snapshot(1, {GS: 0, GP: 0}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 600);
    h.advance(16000); h.snapshot(1, {GS: -600, GP: -600}); h.fresh(); h.tick(); h.complete();
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 0);
    h.advance(1100); h.snapshot(1, {GS: 0, GP: 0}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    assert.ok(!h.commands().includes(-500));
});

test('a reduced nonzero command is still immediate after the previous command physically settles', () => {
    const h = harness(1); h.own('Config.BatteryFineStep_W', 600); h.own('Control.Targets.Battery_W', 600);
    h.tick(); h.complete(); h.follow(); h.tick(); h.own('Control.Targets.Battery_W', 500); h.tick();
    assert.deepEqual(h.commands(), [-600, -500]);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 500);
});
