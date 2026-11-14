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
    const writes = [], pending = [], logs = [];
    const grid = {valid: true, gridW: -1500};
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
        put(`sunenergyxt500.0.heads.${index}.info.rawResponse`, JSON.stringify(body),
            {from: 'system.adapter.sunenergyxt500.0', ...extra});
        put(`sunenergyxt500.0.heads.${index}.info.online`, true);
    };
    for (let index = 1; index <= count; index++) snapshot(index);
    for (const id of ['ha1', 'ha2', 'ha3']) put(id, 0);
    const limit = {valid: true, budgetW: null}, loads = {valid: true, dhwW: 0, heatingW: 0, wallboxW: 0};
    const reservations = {valid: true, otherW: [0, 0, 0]};
    const ctx = vm.createContext({Math, Date: {now: () => now, parse: Date.parse}, nativeConfig,
        sunEnergyHeads, SMA_GRID_MAX_AGE_MS, CFG: {root: 'ems.0', dp: {myPvDhwHaCurrentA: ['ha1', 'ha2', 'ha3']}},
        realtimeGridMeasurement: () => ({sourceTs: [now, now], ...grid}), log: (message, level) => logs.push({message, level}),
        getState: id => states.get(id), existsState: id => states.has(id),
        write: put, stateDef: (id, val) => { if (!states.has(id)) put(id, val); },
        configDef: (id, val) => { if (!states.has(id)) put(id, val); },
        writeForeignState: (id, val, cb) => { writes.push({id, val, at: now}); pending.push(cb); return true; },
        currentConsumptionLimit: () => limit, gridGroupDeviceLimit: () => ({valid: true, maximumW: limit.groupMaximumW ?? null}),
        coordinatedConsumptionLoads: () => loads,
        coordinatedPhaseReservations: () => reservations});
    vm.runInContext(source, ctx);
    const run = code => vm.runInContext(code, ctx);
    run('createBatteryStates()');
    const time = () => now;
    const fresh = () => {
        own('Control.LastUpdate', now);
        for (const id of ['ha1', 'ha2', 'ha3']) put(id, 0);
        for (let index = 1; index <= count; index++) snapshot(index);
    };
    return {nativeConfig, states, writes, pending, logs, grid, put, own, snapshot, run, limit, loads, reservations, time,
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

test('a qualified 50 W wallbox buffer passes the normal deadband in SunEnergy head mode', () => {
    const h = harness(1, new Map(), {batteryPvPriorityEnabled: true, batteryDeadbandW: 50});
    h.own('Control.Targets.Battery_W', -50);
    h.tick();
    assert.deepEqual(h.commands(), []);
    h.own('Control.BatteryWallboxBuffer_W', 50);
    h.tick();
    assert.deepEqual(h.commands(), [50]);
    assert.equal(h.run(`batteryHeadsQueuedCheck(${JSON.stringify(h.writes[0].id)},50).allowed`), true);
    h.own('Control.BatteryWallboxBuffer_W', 0);
    assert.equal(h.run(`batteryHeadsQueuedCheck(${JSON.stringify(h.writes[0].id)},50).allowed`), false);
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

test('restart automatically returns an observed SunEnergy charge and starts again after fresh zero', () => {
    const before = harness(1);
    before.own('Config.BatteryFineStep_W', 600);
    before.own('Control.Targets.Battery_W', 600);
    before.tick(); before.complete(); before.follow(); before.tick();
    assert.equal(before.value('Devices.Battery.OutputUnobservedCommand_W'), 0);
    before.run("stopBatteryOutput('Adapter wird beendet')"); before.complete();
    const h = harness(1, before.states);
    h.own('Config.BatteryFineStep_W', 600);
    h.tick(); assert.deepEqual(h.commands(), [0]);
    h.advance(1000); h.fresh(); h.complete(); h.tick();
    assert.deepEqual(h.commands(), [0], 'zero telemetry from before write completion is insufficient');
    h.advance(1000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [0, -600]);
    assert.equal(h.value('Devices.Battery.Fault'), '');
    assert.equal(h.value('Devices.Battery.RegulationAvailable'), true);
    assert.equal(h.value('Devices.Battery.ConfirmPhysicalStop'), false);
});

for (const target of [600, -514]) {
    test(`normal restart adopts a confirmed ${target} W SunEnergy output without writing zero`, () => {
        const before = harness(1);
        before.own('Control.Targets.Battery_W', target);
        before.own('Config.BatteryFineStep_W', 600);
        before.tick(); before.complete(); before.follow(); before.tick();
        assert.equal(before.run('prepareBatteryHeadsRestartHandoff()'), true);
        assert.deepEqual(before.commands(), [-target]);

        const after = harness(1, before.states);
        after.advance(2200);
        after.own('Control.Targets.Battery_W', target);
        after.snapshot(1, {GS: -target, GP: -target}); after.fresh();
        after.tick();
        assert.deepEqual(after.commands(), []);
        assert.equal(after.value('Devices.Battery.OutputCommandInternal_W'), target);
        assert.equal(after.value('Devices.Battery.Fault'), '');
        assert.equal(after.value('Devices.Battery.RegulationAvailable'), true);
        assert.equal(JSON.parse(after.value('Devices.Battery.HeadOwnership_JSON')).heads[0].handoffAt, undefined);
    });
}

test('a stale or mismatched SunEnergy handoff returns through zero', () => {
    for (const expired of [true, false]) {
        const before = harness(1);
        before.own('Control.Targets.Battery_W', 600); before.own('Config.BatteryFineStep_W', 600);
        before.tick(); before.complete(); before.follow(); before.tick();
        assert.equal(before.run('prepareBatteryHeadsRestartHandoff()'), true);
        const after = harness(1, before.states);
        after.advance(expired ? 32000 : 2200);
        after.snapshot(1, {GS: expired ? -600 : -601, GP: -600}); after.fresh();
        after.tick();
        assert.deepEqual(after.commands(), [0]);
    }
});

test('restart returns a charge whose GS was confirmed while its AC power was still ramping', () => {
    const before = harness(1);
    before.own('Config.BatteryFineStep_W', 600); before.tick(); before.complete();
    before.advance(2000); before.snapshot(1, {GS: -600, GP: -180}); before.fresh(); before.tick();
    assert.equal(before.value('Devices.Battery.OutputUnobservedCommand_W'), 600);
    assert.ok(JSON.parse(before.value('Devices.Battery.HeadOwnership_JSON')).heads[0].unobservedEchoAt > 0);
    before.run("stopBatteryOutput('Adapter wird beendet')"); before.complete();
    const h = harness(1, before.states);
    h.advance(3000); h.fresh();
    h.tick(); h.complete(); assert.deepEqual(h.commands(), [0]);
    h.advance(1000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [0, -600]);
    assert.equal(h.value('Devices.Battery.ConfirmPhysicalStop'), false);
    assert.equal(h.value('Devices.Battery.Fault'), '');
});

test('restart keeps genuinely unseen charge reserved despite new zero telemetry', () => {
    const before = harness(1);
    before.own('Config.BatteryFineStep_W', 600); before.tick(); before.complete();
    before.run("stopBatteryOutput('Adapter wird beendet')"); before.complete();
    const h = harness(1, before.states);
    h.tick(); h.complete(); h.advance(1000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [0]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 600);
});

for (const target of [600, -514]) {
    test(`fresh online zeros automatically clear a previously unseen ${target} W command after restart`, () => {
        const before = harness(1);
        before.own('Config.BatteryFineStep_W', 600);
        before.own('Control.Targets.Battery_W', target);
        before.tick(); before.complete();
        before.run("stopBatteryOutput('Adapter wird beendet')"); before.complete();
        const h = harness(1, before.states);
        h.tick(); h.complete();
        h.advance(1000); h.fresh(); h.tick();
        h.advance(10000); h.tick();
        assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), target, 'repeated cache read is no new sample');
        h.fresh(); h.tick();
        h.advance(1000); h.fresh(); h.put('sunenergyxt500.0.heads.1.info.online', false); h.tick();
        assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), target, 'offline breaks the proof');
        for (let sample = 0; sample < 3; sample++) {
            h.advance(5000); h.fresh(); h.tick(); h.complete();
            if (sample < 2) assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), target);
        }
        assert.equal(h.value('Devices.Battery.Fault'), '');
        assert.deepEqual(h.commands(), [0, -600]);
        assert.equal(h.value('Devices.Battery.ConfirmPhysicalStop'), false);
    });
}

test('a late nonzero response restarts the zero verification window before any new command', () => {
    const h = harness(1);
    h.own('Control.Targets.Battery_W', -514);
    h.tick(); h.complete();
    h.own('Control.Targets.Battery_W', 0);
    h.tick(); h.complete();
    h.advance(1000); h.fresh(); h.tick();
    h.advance(5000); h.fresh(); h.tick();
    h.advance(5000); h.snapshot(1, {GS: 80, GP: 80}); h.fresh(); h.tick(); h.complete();
    assert.deepEqual(h.commands(), [100, 0, 0]);
    h.advance(5000); h.snapshot(1, {GS: 0, GP: 0}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), -100);
    h.advance(5000); h.fresh(); h.tick();
    h.advance(5000); h.fresh(); h.own('Control.Targets.Battery_W', 650); h.tick();
    assert.deepEqual(h.commands(), [100, 0, 0, -100]);
});

test('direction reversal waits for physically confirmed zero of every head', () => {
    const h = harness(2); h.tick(); h.complete(); h.follow(); h.own('Control.Targets.Battery_W', -1000); h.tick();
    assert.deepEqual(h.commands(), [-50, -50, 0, 0]); h.complete(); h.advance(1100); h.fresh();
    h.snapshot(1, {GS: 0, GP: 0}); h.tick(); assert.deepEqual(h.commands(), [-50, -50, 0, 0]);
    h.advance(1); h.snapshot(2, {GS: 0, GP: 0}); h.tick();
    assert.deepEqual(h.commands(), [-50, -50, 0, 0, 50, 50]);
});

test('reversal resumes after driver-confirmed zero and falling AC power reach standstill', () => {
    for (const direction of [-1, 1]) {
        for (const missing of [null, 'driver ack', 'ack source', 'stale ack', 'rundown', 'old GS', 'offline']) {
            const h = harness(1);
            const id = 'sunenergyxt500.0.heads.1.control.GS';
            const from = 'system.adapter.sunenergyxt500.0';
            h.own('Config.BatteryFineStep_W', 600);
            h.own('Control.Targets.Battery_W', direction * 500); h.tick(); h.complete();
            h.follow();
            h.own('Control.Targets.Battery_W', direction * 550); h.tick(); h.complete();
            assert.deepEqual(h.commands(), [-direction * 500, -direction * 550]);
            h.own('Control.Targets.Battery_W', -direction * 650); h.tick(); h.complete();
            assert.deepEqual(h.commands(), [-direction * 500, -direction * 550, 0]);
            h.advance(1000); h.fresh();
            h.put(id, 0, {ack: missing !== 'driver ack', from: missing === 'ack source' ? 'system.adapter.other.0' : from,
                ...(missing === 'stale ack' ? {ts: 2000000} : {})});
            h.snapshot(1, {GS: 0, GP: missing === 'rundown' ? 0 : -direction * 300});
            h.tick();
            assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), direction * 550);
            assert.equal(h.commands().length, 3);
            h.advance(5000); h.fresh();
            h.snapshot(1, {GS: missing === 'old GS' ? -direction * 525 : 0, GP: 0});
            if (missing === 'offline') h.put('sunenergyxt500.0.heads.1.info.online', false);
            h.tick();
            assert.deepEqual(h.commands(), [-direction * 500, -direction * 550, 0,
                ...(missing === 'old GS' ? [0] : missing === null ? [direction * 600] : [])], missing);
            assert.equal(h.logs.some(l => l.message.includes('AC-Stillstand freigegeben')), missing === null);
        }
    }
});

test('explicit manual return with both global releases off and fresh per-head zeros clears unseen debt', () => {
    for (const released of [true, false]) {
        const h = harness(2); h.tick(); h.complete(); h.own('Control.Targets.Battery_W', 0); h.tick(); h.complete();
        h.advance(1100); h.snapshot(1, {GS: 0, GP: 0}); h.snapshot(2, {GS: 0, GP: 0});
        if (!released) { h.nativeConfig.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false); }
        h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
        assert.equal(h.value('Devices.Battery.OutputOwned'), released);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), released ? 100 : 0);
    }
});

test('SunEnergy recovery can return an unseen command with only the battery disabled', () => {
    for (const missing of [null, 'native disable', 'state disable', 'transport', 'fresh snapshot', 'zero GS', 'zero GP', 'valid ledger']) {
        const h = harness(1); h.own('Config.BatteryFineStep_W', 800); h.tick(); h.complete();
        h.nativeConfig.batteryControlEnabled = false;
        h.own('Devices.Battery.ControlEnabled', false);
        h.own('Control.Targets.Battery_W', 0); h.tick();
        if (missing !== 'transport') h.complete();
        h.nativeConfig.batteryControlEnabled = missing === 'native disable';
        h.own('Devices.Battery.ControlEnabled', missing === 'state disable');
        h.advance(1600);
        if (missing !== 'fresh snapshot')
            h.snapshot(1, {GS: missing === 'zero GS' ? -800 : 0, GP: missing === 'zero GP' ? -200 : 0});
        if (missing === 'valid ledger') h.run("batteryHeadsOwnershipFault = 'invalid ledger'");
        h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
        assert.equal(h.value('System.RealOutputsEnabled'), true, missing);
        assert.equal(h.value('Devices.Battery.OutputOwned'), missing !== null, missing);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), missing === null ? 0 : 800, missing);
        if (missing !== null) continue;
        h.nativeConfig.batteryControlEnabled = true;
        h.own('Devices.Battery.ControlEnabled', true);
        h.own('Control.Targets.Battery_W', 1000); h.fresh(); h.tick();
        assert.deepEqual(h.commands(), [-800, 0, -800]);
    }
});

test('a settled head with an unexpected fresh GS echo faults instead of treating another writer as normal feedback', () => {
    const h = harness(2); h.tick(); h.complete(); h.follow();
    h.run('observeBatteryHeads()'); h.advance(1); h.snapshot(1, {GS: 2400, GP: 0}); h.tick();
    assert.deepEqual(h.commands().slice(-2), [0, 0]);
    assert.match(h.value('Devices.Battery.Fault'), /Reglerzustaendigkeit/);
});

const firstHeadGs = 'sunenergyxt500.0.heads.1.control.GS';
const driverGs = {from: 'system.adapter.sunenergyxt500.0'};

function reachGsConflict(h, {reportedGs = 100, sampleAt = 2001100} = {}) {
    h.grid.gridW = 150;
    h.own('Config.BatteryDeadband_W', 10);
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.Targets.Battery_W', -100); h.tick(); h.complete();
    h.advance(1100); h.fresh();
    h.put(firstHeadGs, 100, driverGs);
    h.snapshot(1, {GS: 100, GP: 100, timestamp: h.time()}); h.tick();
    h.own('Control.Targets.Battery_W', -150); h.tick(); h.complete();
    h.advance(1100); h.fresh();
    h.put(firstHeadGs, 150, driverGs);
    h.snapshot(1, {GS: 150, GP: 150, timestamp: h.time()}); h.tick();
    h.advance(100); h.fresh();
    h.put(firstHeadGs, reportedGs, driverGs);
    h.snapshot(1, {GS: reportedGs, GP: 100, timestamp: sampleAt}); h.tick();
    assert.deepEqual(h.commands(), [100, 150, 0]);
    assert.match(h.value('Devices.Battery.Fault'), /Reglerzustaendigkeit/);
}

test('a delayed previously confirmed GS permits a single return and resumption only after three acquired zeros', () => {
    const h = harness(1);
    reachGsConflict(h);
    // A raw zero published before the zero transport finishes earns no proof.
    h.advance(100); h.fresh();
    h.put(firstHeadGs, 0, driverGs);
    h.snapshot(1, {GS: 0, GP: 0, timestamp: h.time()}); h.tick();
    h.complete(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    h.advance(100); h.fresh();
    h.put(firstHeadGs, 0, driverGs);
    h.snapshot(1, {GS: 0, GP: 2, timestamp: h.time()}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    // The first exact stop sample returns ownership. Re-publishing the same
    // device acquisition with a new ioBroker timestamp does not count twice.
    h.advance(100); h.fresh(); h.snapshot(1, {GP: 0, timestamp: h.time()}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    h.advance(5000); h.fresh(); h.tick();
    h.advance(5000); h.fresh(); h.snapshot(1, {timestamp: h.time()}); h.tick();
    assert.match(h.value('Devices.Battery.Fault'), /Reglerzustaendigkeit/);
    assert.deepEqual(h.commands(), [100, 150, 0]);
    h.advance(5000); h.fresh(); h.snapshot(1, {timestamp: h.time()}); h.tick();
    assert.equal(h.value('Devices.Battery.Fault'), '');
    h.tick();
    assert.deepEqual(h.commands(), [100, 150, 0, 150]);
    h.complete(); h.advance(1100); h.fresh(); h.snapshot(1, {GS: 150, GP: 150, timestamp: h.time()}); h.tick();
    h.grid.gridW = 8;
    h.advance(1100); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [100, 150, 0, 150]);
});

test('fresh unexpected GS and a foreign writer during recovery remain latched after exact zeros and restart', () => {
    for (const scenario of ['different GS', 'new acquisition', 'acquisition after current command', 'foreign write', 'direct write before zero',
        'no driver acknowledgement', 'restart during return']) {
        let h = harness(1);
        reachGsConflict(h, {reportedGs: scenario === 'different GS' ? 180 : 100,
            sampleAt: {'new acquisition': 2002300, 'acquisition after current command': 2001600}[scenario]});
        h.complete();
        if (scenario === 'foreign write') {
            h.put(firstHeadGs, 100, {ack: false, from: 'system.adapter.javascript.0'});
            h.run(`observeForeignBatteryHeadGsWrite(${JSON.stringify(firstHeadGs)})`);
        }
        if (scenario === 'restart during return') {
            h = harness(1, h.states);
            h.own('Control.Targets.Battery_W', -150); h.tick(); h.complete();
            assert.deepEqual(h.commands(), [0]);
        }
        if (scenario === 'direct write before zero') {
            h.advance(100); h.fresh();
            h.put(firstHeadGs, 200, driverGs);
            h.snapshot(1, {GS: 200, GP: 200, timestamp: h.time()}); h.tick();
        }
        h.advance(2000); h.fresh();
        h.put(firstHeadGs, 0, scenario === 'no driver acknowledgement' ? {from: 'system.adapter.javascript.0'} : driverGs);
        for (let sample = 0; sample < 3; sample++) {
            h.fresh(); h.snapshot(1, {GS: 0, GP: 0, timestamp: h.time()}); h.tick(); h.advance(6000);
        }
        assert.match(h.value('Devices.Battery.Fault'), /Reglerzustaendigkeit/, scenario);
        assert.deepEqual(h.commands(), scenario === 'restart during return' ? [0] : [100, 150, 0], scenario);
        const restarted = harness(1, h.states);
        restarted.own('Control.Targets.Battery_W', -150); restarted.tick();
        assert.deepEqual(restarted.commands(), [], scenario);
        assert.match(restarted.value('Devices.Battery.Fault'), /Reglerzustaendigkeit/, scenario);
        restarted.own('Devices.Battery.ResetFault', true);
        restarted.tick();
        assert.deepEqual(restarted.commands(), [150], scenario);
    }
});

test('a delayed idle acquisition after the first discharge can use the confirmed standstill return', () => {
    const h = harness(1);
    h.snapshot(1, {timestamp: h.time()});
    h.grid.gridW = 150; h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.Targets.Battery_W', -150); h.tick(); h.complete();
    h.advance(2000); h.fresh();
    h.put(firstHeadGs, 150, driverGs);
    h.snapshot(1, {GS: 150, GP: 150, timestamp: h.time()}); h.tick();
    h.advance(100); h.fresh();
    h.put(firstHeadGs, 0, driverGs);
    h.snapshot(1, {GS: 0, GP: 0, timestamp: h.time() - 2100}); h.tick(); h.complete();
    assert.deepEqual(h.commands(), [150, 0]);
    h.advance(2000); h.fresh(); h.put(firstHeadGs, 0, driverGs);
    for (let sample = 0; sample < 3; sample++) {
        h.fresh(); h.snapshot(1, {GS: 0, GP: 0, timestamp: h.time()}); h.tick(); h.advance(6000);
    }
    assert.deepEqual(h.commands(), [150, 0, 150]);
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

test('confirmed 2400 W discharge stays active through the recorded AC shortfall and is eligible for handoff', () => {
    const h = harness(1, new Map(), {batteryHead1MaxDischargeW: 2400});
    h.snapshot(1, {PK: 2, MG: 2400, IS: 2400});
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.Targets.Battery_W', -2400);
    h.grid.gridW = 2200;
    for (let step = 0; step < 4; step++) {
        h.tick(); h.complete();
        if (step < 3) h.follow();
    }
    for (const watts of [2166, 2372, 2388, 2380, 2375, 2368, 2367, 2360, 2361]) {
        h.advance(5000); h.fresh(); h.snapshot(1, {GS: 2400, GP: watts}); h.tick();
    }
    assert.deepEqual(h.commands(), [600, 1200, 1800, 2400]);
    assert.equal(h.value('Devices.Battery.Fault'), '');
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 0);
    assert.equal(h.value('Devices.Battery.Heads.1.ActuatorSettled'), true);
    assert.equal(h.run('prepareBatteryHeadsRestartHandoff()'), true);
    const restarted = harness(1, h.states, {batteryHead1MaxDischargeW: 2400});
    restarted.advance(h.time() - restarted.time() + 1000);
    restarted.own('Control.Targets.Battery_W', -2400);
    restarted.snapshot(1, {GS: 2400, GP: 2361, PK: 2, MG: 2400, IS: 2400});
    restarted.fresh(); restarted.tick();
    assert.deepEqual(restarted.commands(), [], 'a restored owner uses the current topology to verify the ceiling');
    assert.equal(restarted.value('Devices.Battery.OutputCommandInternal_W'), -2400);
    h.own('Control.Targets.Battery_W', -2300); h.tick();
    assert.equal(h.commands().at(-1), 2300);
});

test('the discharge ceiling allowance excludes stale or wrong GS, large deficits and overshoot', () => {
    for (const [name, target, gs, gp, stale] of [
        ['below ceiling', 2200, 2200, 2160, false],
        ['wrong GS', 2400, 2300, 2360, false],
        ['large deficit', 2400, 2400, 2349, false],
        ['wrong direction', 2400, 2400, -2360, false],
        ['overshoot', 2400, 2400, 2440, false],
        ['stale echo', 2400, 2400, 2360, true]
    ]) {
        const h = harness(1, new Map(), {batteryHead1MaxDischargeW: 2400});
        h.snapshot(1, {PK: 2, MG: 2400, IS: 2400});
        h.own('Config.BatteryFineStep_W', 1000);
        h.own('Control.Targets.Battery_W', -target);
        for (let step = 0; step < 3; step++) {
            h.tick(); h.complete();
            if (step < 2) h.follow();
        }
        h.advance(15000); h.fresh();
        h.snapshot(1, {GS: gs, GP: gp}, stale ? {ts: h.writes.at(-1).at} : {});
        h.tick();
        assert.deepEqual(h.commands(), [1000, 2000, target, 0], name);
        assert.match(h.value('Devices.Battery.Fault'), /Rueckmeldefrist/, name);
    }
});

function dischargeAtCeiling() {
    const config = {batteryHead1MaxDischargeW: 2400};
    const before = householdDischargeAt(2387, 2374, 15);
    assert.equal(before.run('prepareBatteryHeadsRestartHandoff()'), true);
    const h = harness(1, before.states, config);
    h.advance(before.time() - h.time() + 1000);
    h.own('Config.BatteryMinSoC_pct', 10);
    h.own('Config.BatteryDeadband_W', 10);
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.Targets.Battery_W', -2400);
    h.grid.gridW = 72;
    h.snapshot(1, {GS: 2387, GP: 2374, SC: 15, SI1: 5, PK: 2, MG: 2400, IS: 2400, timestamp: h.time() - 60});
    h.fresh(); h.tick(); h.complete();
    assert.deepEqual(h.commands(), [2400]);
    return h;
}

test('the recorded 05:59 discharge keeps running after the confirmed 2400 W ceiling falls to 2316 W', () => {
    const h = dischargeAtCeiling();
    for (const [delay, gp, gridW] of [[1600, 2367, 82.9], [2520, 2355, 88.1], [5100, 2333, 109], [5070, 2316, 138.1]]) {
        h.advance(delay); h.fresh();
        h.snapshot(1, {GS: 2400, GP: gp, timestamp: h.time() - 60});
        h.grid.gridW = gridW; h.grid.sourceTs = [h.time() - 100, h.time() - 100];
        h.tick();
        assert.deepEqual(h.commands(), [2400], 'wait for a meter sample after the latest GP');
    }
    h.advance(850);
    h.grid.gridW = 132.8; h.grid.sourceTs = [h.time(), h.time()];
    h.tick();
    assert.deepEqual(h.commands(), [2400, 2316]);
    const id = JSON.stringify(h.writes.at(-1).id);
    assert.equal(h.run(`batteryHeadsQueuedCheck(${id},2316).allowed`), true);
    h.complete();
    for (let i = 0; i < 8; i++) {
        h.advance(5000); h.fresh(); h.snapshot(1, {GS: 2316, GP: 2308, timestamp: h.time() - 60}); h.tick();
    }
    assert.deepEqual(h.commands(), [2400, 2316]);
    assert.equal(h.value('Devices.Battery.Fault'), '');
    assert.equal(h.value('Devices.Battery.Heads.1.ActuatorSettled'), true);
    assert.match(h.value('Devices.Battery.OutputStatus'), /2316 W von 2400 W/);
    h.advance(1000); h.fresh(); h.snapshot(1, {IS: 2250}); h.tick();
    assert.deepEqual(h.commands(), [2400, 2316, 2250]);
    assert.equal(h.run(`batteryHeadsQueuedCheck(${id},2250).allowed`), true);
    h.complete(); h.advance(1000); h.fresh(); h.snapshot(1, {GS: 2250, GP: 2242, SC: 10}); h.tick();
    assert.deepEqual(h.commands(), [2400, 2316, 2250, 0]);
});

test('ceiling adaptation requires independent device acquisitions and live discharge inside protection limits', () => {
    for (const scenario of ['duplicate acquisition', 'no GS echo', 'no GP', 'device fault', 'UPS mode', 'foreign GS',
        'expired GP', 'meter held', 'release lost', 'lower inverter limit']) {
        const h = dischargeAtCeiling();
        h.grid.gridW = 130;
        const firstAt = h.time() + 1440;
        for (let i = 0; i < 4; i++) {
            h.advance(i === 0 ? 1500 : 4600); h.fresh();
            h.snapshot(1, {GS: scenario === 'no GS echo' ? 2387 : 2400,
                GP: scenario === 'no GP' ? 0 : 2320,
                timestamp: scenario === 'duplicate acquisition' ? firstAt : h.time() - 60,
                ...(scenario === 'device fault' ? {DF1: 1} : {}), ...(scenario === 'UPS mode' ? {UO: 1} : {})},
            scenario === 'expired GP' ? {ts: h.time() - 31000} : {});
            if (scenario === 'meter held') h.grid.held = true;
            if (scenario === 'foreign GS') h.run(`observeForeignBatteryHeadGsWrite('${h.writes[0].id}')`);
            if (scenario === 'release lost' && i === 1) h.own('System.RealOutputsEnabled', false);
            if (scenario === 'lower inverter limit' && i === 1) h.snapshot(1, {IS: 2250});
            h.tick();
            if (h.commands().length > 1) break;
        }
        const expected = scenario === 'lower inverter limit' ? 2250 : 0;
        assert.deepEqual(h.commands(), [2400, expected], scenario);
    }
});

test('a queued ceiling correction is vetoed if current feedback, source ownership or household demand changes', () => {
    for (const scenario of ['AC stopped', 'old GS reappeared', 'new device limit', 'larger shortfall', 'no demand',
        'SMA older than GP', 'foreign writer', 'fault mask']) {
        const h = dischargeAtCeiling();
        h.grid.gridW = 125;
        for (const gp of [2355, 2333, 2316]) {
            h.advance(2400); h.fresh(); h.snapshot(1, {GS: 2400, GP: gp, timestamp: h.time() - 60}); h.tick();
        }
        assert.deepEqual(h.commands(), [2400, 2316]);
        const id = JSON.stringify(h.writes.at(-1).id);
        assert.equal(h.run(`batteryHeadsQueuedCheck(${id},2316).allowed`), true);
        h.advance(1000); h.fresh(); h.snapshot(1, {timestamp: h.time() - 60});
        if (scenario === 'AC stopped') h.snapshot(1, {GP: 0});
        if (scenario === 'old GS reappeared') h.snapshot(1, {GS: 2387});
        if (scenario === 'new device limit') h.snapshot(1, {IS: 2350});
        if (scenario === 'larger shortfall') h.snapshot(1, {GP: 2285});
        if (scenario === 'no demand') h.own('Control.Targets.Battery_W', 0);
        if (scenario === 'SMA older than GP') h.grid.sourceTs = [h.time() - 700, h.time() - 700];
        if (scenario === 'foreign writer') h.run(`observeForeignBatteryHeadGsWrite(${id})`);
        if (scenario === 'fault mask') h.snapshot(1, {DF1: 1});
        assert.equal(h.run(`batteryHeadsQueuedCheck(${id},2316).allowed`), false, scenario);
    }
});

test('stable partial PV charging at timeout reduces the echoed command and retains its reserve until confirmed', () => {
    const h = harness(1);
    h.own('Config.BatteryFineStep_W', 1000);
    h.own('Control.Targets.Battery_W', 1270);
    h.tick(); h.complete(); h.follow(); h.tick(); h.complete(); h.follow();
    h.own('Config.BatteryFineStep_W', 100);
    h.own('Control.Targets.Battery_W', 2400); h.tick(); h.complete();
    h.advance(5000); h.snapshot(1, {GS: -1370, GP: -1180}); h.fresh(); h.tick();
    h.advance(5000); h.snapshot(1, {GS: -1370, GP: -1170}); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-1000, -1270, -1370]);
    h.advance(5000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-1000, -1270, -1370, -1170]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1370);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 1170);
    assert.equal(h.run('batteryHeadsQueuedCheck("sunenergyxt500.0.heads.1.control.GS", -1170).allowed'), true);
    h.complete();
    h.advance(5000); h.snapshot(1, {GS: -1370, GP: -1170}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1370);
    h.advance(5000); h.snapshot(1, {GS: -1170, GP: -1168}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1170);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 0);
    h.advance(59000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-1000, -1270, -1370, -1170]);
    h.advance(1000); h.fresh(); h.tick();
    assert.equal(h.commands().at(-1), -1220);
    h.complete();
    h.advance(5000); h.snapshot(1, {GS: -1220, GP: -1170}); h.fresh(); h.tick();
    h.advance(10000); h.fresh(); h.tick();
    assert.deepEqual(h.commands().slice(-3), [-1170, -1220, -1170]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1220);
    h.complete();
    h.advance(5000); h.snapshot(1, {GS: -1170, GP: -1168}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1170);
    h.advance(60000); h.fresh(); h.tick();
    assert.equal(h.commands().at(-1), -1220);
    h.complete();
    h.advance(5000); h.snapshot(1, {GS: -1220, GP: -1212}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1220);
    h.advance(60000); h.fresh(); h.tick();
    assert.equal(h.commands().at(-1), -1270);
});

test('PV noise does not create a new outstanding write before a larger reduction', () => {
    for (const hardLimit of [false, true]) {
        const h = harness(1);
        h.own('Config.BatteryFineStep_W', 1000);
        h.own('Control.Targets.Battery_W', 1061);
        h.tick(); h.complete(); h.follow(); h.tick(); h.complete(); h.follow();
        h.own('Config.BatteryFineStep_W', 100);
        h.own('Control.Targets.Battery_W', 1057);
        if (hardLimit) h.limit.budgetW = 1057;
        h.tick();
        assert.deepEqual(h.commands(), hardLimit ? [-1000, -1061, -1057] : [-1000, -1061]);
        if (hardLimit) continue;
        h.advance(1000); h.fresh();
        h.own('Control.Targets.Battery_W', 704); h.tick();
        assert.deepEqual(h.commands(), [-1000, -1061, -704]);
    }
});

test('a PV dip does not lower the confirmed charge ceiling or restart its probe timer', () => {
    const h = harness(1);
    h.own('Config.BatteryFineStep_W', 1000);
    h.tick(); h.complete();
    h.advance(5000); h.snapshot(1, {GS: -1000, GP: -850}); h.fresh(); h.tick();
    h.advance(10000); h.fresh(); h.tick(); h.complete(); h.follow();
    assert.deepEqual(h.commands(), [-1000, -850]);
    h.own('Control.Targets.Battery_W', 600);
    h.tick(); h.complete(); h.follow();
    assert.equal(h.commands().at(-1), -600);
    h.own('Config.BatteryFineStep_W', 100);
    h.own('Control.Targets.Battery_W', 1200);
    for (const expected of [-700, -800, -850]) {
        h.tick();
        assert.equal(h.commands().at(-1), expected);
        h.complete(); h.follow();
    }
    h.advance(55600); h.fresh(); h.tick();
    assert.equal(h.commands().at(-1), -900);
});

test('an already settled PV charge can also adapt to a sustained lower response', () => {
    const h = harness(1);
    h.own('Config.BatteryFineStep_W', 1000); h.tick(); h.complete(); h.follow(); h.tick();
    h.advance(1000); h.snapshot(1, {GS: -1000, GP: -850}); h.fresh(); h.tick();
    h.advance(15000); h.snapshot(1, {GS: -1000, GP: -840}); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-1000, -840]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1000);
    h.advance(1); h.snapshot(1, {GS: -990, GP: -840});
    const check = h.run('batteryHeadsQueuedCheck("sunenergyxt500.0.heads.1.control.GS", -840)');
    assert.equal(check.allowed, false);
    assert.match(check.reason, /Rueckmeldung/);
});

test('a partial charge without independent stable matching snapshots still stops and retains the reserve', () => {
    for (const [initial, final] of [
        [{GS: -999, GP: -800}, {GS: -999, GP: -800}],
        [{GS: -1000, GP: -800}, null],
        [{GS: -1000, GP: -800}, {GS: -1000, GP: -700}],
        [{GS: -1000, GP: 0}, {GS: -1000, GP: 0}]
    ]) {
        const h = harness(1);
        h.own('Config.BatteryFineStep_W', 1000);
        h.tick(); h.complete();
        h.advance(5000); h.fresh(); h.snapshot(1, initial); h.tick();
        h.advance(10000); h.own('Control.LastUpdate', 2015000);
        for (const id of ['ha1', 'ha2', 'ha3']) h.put(id, 0);
        if (final) h.snapshot(1, final);
        h.tick();
        assert.deepEqual(h.commands(), [-1000, 0]);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1000);
    }
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
    h.tick(); h.complete(); h.own('Control.Targets.Battery_W', 500); h.tick();
    assert.deepEqual(h.commands(), [-600]);
    h.advance(6000); h.fresh(); h.tick(); h.complete();
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

test('PV target drops up to 200 W wait for feedback before evaluating a reduction', () => {
    const cases = [
        {command: 1500, previous: 1400, actual: 1324, target: 1488, expected: 1500},
        {command: 764, previous: 700, actual: 677, target: 714},
        {command: 900, previous: 800, actual: 715, target: 700}
    ];
    for (const {command, previous, actual, target, expected = target} of cases) {
        const h = harness(1);
        h.own('Config.BatteryFineStep_W', 1000);
        h.own('Control.Targets.Battery_W', previous);
        h.tick(); h.complete(); h.follow();
        if (previous > 1000) { h.tick(); h.complete(); h.follow(); }
        h.own('Config.BatteryFineStep_W', 100);
        h.own('Control.Targets.Battery_W', command); h.tick(); h.complete();
        h.advance(4000); h.snapshot(1, {GS: -command, GP: -actual}); h.fresh();
        h.own('Control.Targets.Battery_W', target); h.tick();
        assert.deepEqual(h.commands(), [-Math.min(previous, 1000), ...(previous > 1000 ? [-previous] : []), -command]);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), command);
        assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), command);
        assert.match(h.value('Devices.Battery.OutputStatus'), /PV-Sollwert gesunken/);
        h.advance(1000); h.snapshot(1, {GS: -command, GP: -(command - 18)}); h.fresh(); h.tick();
        assert.equal(h.commands().at(-1), -expected);
    }
});

test('confirmed GS permits successive PV reductions while actual charging lags', () => {
    const h = harness(1);
    h.own('Config.BatteryFineStep_W', 500);
    h.tick(); h.complete(); h.follow();
    h.own('Control.Targets.Battery_W', 700);
    h.tick(); h.complete();
    h.advance(2000); h.snapshot(1, {GS: -700, GP: -673}); h.fresh();
    h.own('Control.Targets.Battery_W', 176); h.tick();
    assert.deepEqual(h.commands(), [-500, -700, -176]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 700);
    const check = () => h.run('batteryHeadsQueuedCheck("sunenergyxt500.0.heads.1.control.GS", -176)');
    assert.equal(check().allowed, true);
    h.snapshot(1, {GS: -500}); assert.equal(check().allowed, false);
    h.snapshot(1, {GS: -700}); h.complete();
    h.advance(1000); h.snapshot(1, {GS: -176, GP: -260}); h.fresh();
    h.own('Control.Targets.Battery_W', 90); h.tick(); h.complete();
    assert.deepEqual(h.commands(), [-500, -700, -176, -90]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 700);
    h.advance(1000); h.snapshot(1, {GS: -90, GP: -80}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 90);
    h.own('Control.Targets.Battery_W', 1800); h.tick();
    assert.equal(h.commands().at(-1), -580, 'one step from the actual 80 W');
});

test('zero after an echoed charge releases the reserve only with post-write zero feedback', () => {
    const h = harness(1);
    h.own('Config.BatteryFineStep_W', 500);
    h.tick(); h.complete();
    h.advance(1000); h.snapshot(1, {GS: -500, GP: -450}); h.fresh();
    h.own('Control.Targets.Battery_W', 0); h.tick();
    assert.deepEqual(h.commands(), [-500, 0]);
    h.advance(1000); h.snapshot(1, {GS: 0, GP: 0}); h.fresh();
    h.complete(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 500);
    h.advance(1000); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 0);
    h.own('Control.Targets.Battery_W', 350); h.tick();
    assert.equal(h.commands().at(-1), -350);
});

test('a PV dip during a dispatched 600 W start waits for the first GS echo and then recovers', () => {
    for (const lowerTarget of [0, 176]) {
        const h = harness(1);
        h.own('Config.BatteryFineStep_W', 600);
        h.own('Control.Targets.Battery_W', 998);
        h.tick(); h.complete();
        h.advance(2000); h.fresh();
        h.own('Control.Targets.Battery_W', lowerTarget); h.tick();
        assert.deepEqual(h.commands(), [-600]);
        assert.match(h.value('Devices.Battery.OutputStatus'), /GS-Bestaetigung des Ladestarts/);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
        h.advance(3000); h.snapshot(1, {GS: -600, GP: -542}); h.fresh(); h.tick(); h.complete();
        assert.deepEqual(h.commands(), [-600, lowerTarget === 0 ? 0 : -lowerTarget]);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
        h.advance(1000); h.snapshot(1, {GS: -lowerTarget, GP: -lowerTarget}); h.fresh(); h.tick();
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), lowerTarget);
        h.own('Control.Targets.Battery_W', 998); h.tick();
        assert.equal(h.commands().at(-1), -(lowerTarget + 600));
    }
});

test('start echo wait is bounded and does not mask a safety limit or reverse direction', () => {
    const scenarios = [
        h => { h.advance(6000); h.fresh(); },
        h => { h.limit.budgetW = 500; },
        h => { h.nativeConfig.batteryHead1MaxChargeW = 500; },
        h => { h.snapshot(1, {SC: 100}); },
        h => { h.own('Control.Targets.Battery_W', -100); },
        h => { h.own('Control.BatteryPriceGridCharge_W', 100); },
        h => { h.snapshot(1, {GP: -60}); }
    ];
    for (const change of scenarios) {
        const h = harness(1);
        h.own('Config.BatteryFineStep_W', 600);
        h.tick(); h.complete();
        h.advance(2000); h.fresh();
        h.own('Control.Targets.Battery_W', 0);
        change(h); h.tick();
        assert.deepEqual(h.commands(), [-600, 0]);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
    }
});

test('a late charge echo still requires fresh zero after the stop before releasing its reserve', () => {
    const h = harness(1);
    h.own('Config.BatteryFineStep_W', 600);
    h.tick(); h.complete();
    h.advance(6000); h.fresh();
    h.own('Control.Targets.Battery_W', 0); h.tick();
    assert.deepEqual(h.commands(), [-600, 0]);
    h.advance(1000); h.snapshot(1, {GS: -600, GP: -200}); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
    h.advance(1000); h.snapshot(1, {GS: 0, GP: 0}); h.fresh();
    h.complete(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 600);
    h.advance(1000); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 0);
});

test('a brief discharge target drop waits for GS and then returns the output without intervention', () => {
    const h = harness(1);
    h.grid.gridW = 0;
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.Targets.Battery_W', -514);
    h.tick(); h.complete();
    h.advance(1000); h.fresh();
    h.own('Control.Targets.Battery_W', 0); h.tick();
    assert.deepEqual(h.commands(), [514]);
    assert.equal(h.run('batteryHasUnconfirmedWriteOnRestart()'), true);
    h.advance(1000); h.snapshot(1, {GS: 514, GP: 60}); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [514, 0]); h.complete();
    h.advance(1000); h.snapshot(1, {GS: 0, GP: 0}); h.fresh();
    h.own('Control.Targets.Battery_W', 650); h.tick();
    assert.deepEqual(h.commands(), [514, 0, -600]);
});

test('discharge echo waiting stops at export, a changed limit, or the deadline', () => {
    for (const expire of [h => { h.grid.gridW = -300; }, h => h.own('Config.BatteryMaxDischarge_W', 300),
        h => { h.advance(6000); h.fresh(); }]) {
        const h = harness(1);
        h.grid.gridW = 0;
        h.own('Config.BatteryFineStep_W', 600);
        h.own('Control.Targets.Battery_W', -514);
        h.tick(); h.complete();
        h.own('Control.Targets.Battery_W', 0);
        expire(h); h.tick();
        assert.deepEqual(h.commands(), [514, 0]);
    }
});

test('brief export during a small household correction can wait for the pending GS echo', () => {
    for (const scenario of ['brief export', 'large load drop', 'revoked release', 'lower limit', 'deadline']) {
        const h = harness(1);
        h.own('Config.BatteryDeadband_W', 10);
        h.own('Config.BatteryFineStep_W', 600);
        h.own('Control.Targets.Battery_W', -129);
        h.grid.gridW = 129;
        h.tick(); h.complete(); h.follow();
        h.grid.gridW = 32;
        h.own('Control.Targets.Battery_W', -161);
        h.tick(); h.complete();

        h.advance(scenario === 'deadline' ? 6000 : 1000);
        h.fresh(); h.snapshot(1, {GS: 129, GP: 137});
        h.grid.gridW = scenario === 'large load drop' ? -90 : -27.6;
        h.own('Control.Targets.Battery_W', scenario === 'large load drop' ? -47 : -109);
        if (scenario === 'revoked release') h.own('Config.BatterySelfConsumptionEnabled', false);
        if (scenario === 'lower limit') h.own('Config.BatteryMaxDischarge_W', 150);
        h.tick();
        if (scenario !== 'brief export') {
            assert.deepEqual(h.commands(), [129, 161, 0], scenario);
            continue;
        }
        assert.deepEqual(h.commands(), [129, 161]);
        h.advance(1000); h.fresh(); h.snapshot(1, {GS: 161, GP: 132});
        h.grid.gridW = -23;
        h.tick();
        assert.deepEqual(h.commands(), [129, 161, 109]);
    }
});

function householdDischargeAt(gsW, gpW, soc) {
    const h = harness(1, new Map(), {batteryHead1MaxDischargeW: 2400});
    h.own('Config.BatteryMinSoC_pct', 10);
    h.own('Config.BatteryDeadband_W', 10);
    h.own('Config.BatteryFineStep_W', 1000);
    h.own('Control.Targets.Battery_W', -gsW);
    h.snapshot(1, {PK: 2, MG: 2400, IS: 2400, SI1: 5, SC: 16});
    let remaining = gsW;
    while (remaining > 0) {
        h.tick(); h.complete(); h.follow();
        remaining -= 1000;
    }
    h.advance(200);
    h.snapshot(1, {GP: gpW, SC: soc, timestamp: h.time() - 60}); h.fresh(); h.tick();
    return h;
}

test('the recorded 07:14 and 04:45 trims leave the confirmed GS free to follow a later load drop', () => {
    for (const [gs, gp, soc, trim, initialGrid, nextTarget, nextGrid, expected] of [
        [654, 647, 15, 649, 1.6, 635, -11.7, 635],
        [2034, 2028, 14, 2033, 4.9, 1843, -185.1, 1843]
    ]) {
        const h = householdDischargeAt(gs, gp, soc);
        const gpAt = h.time();
        h.advance(150);
        h.grid.gridW = initialGrid;
        h.grid.sourceTs = [gpAt - 570, gpAt - 2570];
        h.own('Control.Targets.Battery_W', -trim); h.tick();
        assert.equal(h.commands().at(-1), gs, 'a 1–5 W change within the grid deadband creates no outstanding write');
        assert.match(h.value('Devices.Battery.OutputStatus'), /Netzleistung im Totband/);
        h.advance(650);
        h.grid.gridW = nextGrid; h.grid.sourceTs = [h.time() - 50, h.time() - 50];
        h.own('Control.Targets.Battery_W', -nextTarget); h.tick();
        assert.equal(h.commands().at(-1), expected);
        assert.ok(!h.commands().includes(0));
        const id = JSON.stringify(h.writes.at(-1).id);
        assert.equal(h.run(`batteryHeadsQueuedCheck(${id},${expected}).allowed`), true);
        h.complete(); h.advance(1900); h.fresh();
        h.snapshot(1, {GS: expected, GP: expected - 4, timestamp: h.time() - 60}); h.tick();
        assert.equal(h.value('Devices.Battery.OutputOwned'), true);
        assert.equal(h.value('Devices.Battery.Heads.1.ActuatorSettled'), true);
    }
});

test('small discharge trims still follow a newly lowered aggregate or head cap', () => {
    for (const limit of ['aggregate', 'head', 'inverter']) {
        const h = householdDischargeAt(654, 647, 15);
        h.grid.gridW = 2;
        if (limit === 'aggregate') h.own('Config.BatteryMaxDischarge_W', 651);
        if (limit === 'head') h.nativeConfig.batteryHead1MaxDischargeW = 651;
        if (limit === 'inverter') h.snapshot(1, {IS: 651});
        h.tick();
        assert.deepEqual(h.commands(), [654, 651], limit);
        const id = JSON.stringify(h.writes.at(-1).id);
        assert.equal(h.run(`batteryHeadsQueuedCheck(${id},651).allowed`), true, limit);
    }
});

test('an already dispatched small household trim waits briefly for the matching GS on a coherent SMA pair', () => {
    for (const scenario of ['echo', 'no echo', 'no load', 'lower cap', 'lower previous cap', 'bad net data', 'larger export', 'SoC floor']) {
        const h = householdDischargeAt(654, 647, 15);
        const gpAt = h.time();
        h.advance(150);
        h.own('Control.Targets.Battery_W', -649);
        h.grid.gridW = 13;
        h.grid.sourceTs = [gpAt - 600, gpAt - 2600];
        h.tick(); h.complete();
        assert.deepEqual(h.commands(), [654, 649]);
        h.advance(725);
        h.grid.gridW = scenario === 'larger export' ? -185 : -11.7;
        h.grid.sourceTs = [gpAt + 404, gpAt + 404];
        h.own('Control.Targets.Battery_W', scenario === 'no load' ? 0 : -635);
        if (scenario === 'lower cap') h.own('Config.BatteryMaxDischarge_W', 640);
        if (scenario === 'lower previous cap') h.own('Config.BatteryMaxDischarge_W', 651);
        if (scenario === 'bad net data') h.grid.valid = false;
        if (scenario === 'SoC floor') h.snapshot(1, {SC: 10});
        h.tick();
        if (!['echo', 'no echo'].includes(scenario)) {
            assert.deepEqual(h.commands(), [654, 649, 0], scenario);
            continue;
        }
        assert.deepEqual(h.commands(), [654, 649], scenario);
        if (scenario === 'no echo') {
            h.advance(6000); h.fresh();
            h.grid.sourceTs = [h.time(), h.time()];
            h.tick();
            assert.deepEqual(h.commands(), [654, 649, 0]);
            continue;
        }
        h.advance(1025); h.fresh(); h.snapshot(1, {GS: 649, GP: 645, timestamp: h.time() - 60});
        h.grid.gridW = -10; h.grid.sourceTs = [h.time(), h.time()];
        h.tick();
        assert.deepEqual(h.commands(), [654, 649, 635]);
    }
});

function pendingWallboxDischarge() {
    const h = harness(1, new Map(), {batteryPvPriorityEnabled: true, batteryDeadbandW: 50});
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.BatteryWallboxBuffer_W', 458);
    h.own('Control.Targets.Battery_W', -458);
    h.grid.gridW = 458;
    h.tick(); h.complete();
    h.advance(1000); h.fresh();
    h.grid.gridW = 439;
    h.own('Control.Targets.Battery_W', -438);
    h.tick();
    assert.deepEqual(h.commands(), [458]);
    h.advance(1000); h.fresh();
    h.grid.gridW = -26;
    h.own('Control.BatteryWallboxBuffer_W', 250);
    h.own('Control.Targets.Battery_W', -250);
    return h;
}

test('a wallbox buffer reduces the echoed discharge while GP is still settling', () => {
    const h = pendingWallboxDischarge();
    h.snapshot(1, {GS: 458, GP: 276});
    h.tick();
    assert.deepEqual(h.commands(), [458, 250]);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), -250);
    const check = `batteryHeadsQueuedCheck(${JSON.stringify(h.writes[1].id)},250).allowed`;
    assert.equal(h.run(check), true);
    h.grid.gridW = -100;
    assert.equal(h.run(check), false);
    h.grid.gridW = -26;
    h.own('Control.BatteryWallboxBuffer_W', 0);
    h.own('Control.Targets.Battery_W', 0);
    assert.equal(h.run(check), false);
    h.own('Control.BatteryWallboxBuffer_W', 250);
    h.own('Control.Targets.Battery_W', -250);
    h.snapshot(1, {GS: 400, GP: 276});
    assert.equal(h.run(check), false);
    h.snapshot(1, {GS: 458, GP: 276});
    assert.equal(h.run(check), true);
    h.complete(); h.advance(1000); h.fresh();
    h.snapshot(1, {GS: 250, GP: 250});
    h.grid.gridW = 0;
    h.tick();
    assert.deepEqual(h.commands(), [458, 250]);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 0);
    assert.equal(h.value('Devices.Battery.Heads.1.ActuatorSettled'), true);
});

test('a wallbox buffer still stops for missing proof, export, zero, reversal or expired feedback', () => {
    for (const [reason, change] of Object.entries({
        'missing GS echo after grace': h => { h.advance(6000); h.fresh(); h.snapshot(1, {GS: 0, GP: 276}); },
        'held grid sample': h => { h.grid.held = true; },
        export: h => { h.grid.gridW = -100; },
        'zero target': h => h.own('Control.Targets.Battery_W', 0),
        reversal: h => h.own('Control.Targets.Battery_W', 300),
        'expired feedback': h => { h.advance(15000); h.fresh(); }
    })) {
        const h = pendingWallboxDischarge();
        h.snapshot(1, {GS: 458, GP: 276});
        change(h); h.tick();
        assert.deepEqual(h.commands(), [458, 0], reason);
    }
});

test('household discharge follows 547 to 432 W after the GS echo while actual power is 369 W', () => {
    const h = harness(1);
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.BatteryWallboxBuffer_W', 0);
    h.own('Control.Targets.Battery_W', -547);
    h.grid.gridW = 471;
    h.tick(); h.complete();
    h.advance(1000); h.fresh();
    h.snapshot(1, {GS: 547, GP: 369});
    h.grid.gridW = 516;
    h.own('Control.Targets.Battery_W', -592);
    h.tick();
    assert.deepEqual(h.commands(), [547]);

    h.advance(1000); h.fresh();
    h.grid.gridW = 63;
    h.own('Control.Targets.Battery_W', -432);
    h.tick();
    assert.deepEqual(h.commands(), [547, 432]);
    const check = `batteryHeadsQueuedCheck(${JSON.stringify(h.writes[1].id)},432).allowed`;
    assert.equal(h.run(check), true);
    h.own('Config.BatteryMaxDischarge_W', 400);
    assert.equal(h.run(check), false);
    h.own('Config.BatteryMaxDischarge_W', 2400);
    h.complete(); h.advance(1000); h.fresh();
    h.snapshot(1, {GS: 432, GP: 432});
    h.grid.gridW = 0;
    h.tick();
    assert.deepEqual(h.commands(), [547, 432]);
    assert.equal(h.value('Devices.Battery.Heads.1.ActuatorSettled'), true);
});

test('an echoed household discharge is reduced during export when measured demand supports a lower output', () => {
    const h = harness(1);
    h.own('Config.BatteryDeadband_W', 10);
    h.own('Config.BatteryFineStep_W', 600);
    h.grid.gridW = 100;
    h.own('Control.Targets.Battery_W', -125);
    h.tick(); h.complete();
    h.advance(2000); h.fresh(); h.snapshot(1, {GS: 125, GP: 80});
    h.grid.gridW = -30.9;
    h.own('Control.Targets.Battery_W', -54);
    h.tick();
    assert.deepEqual(h.commands(), [125, 49]);

    const check = `batteryHeadsQueuedCheck(${JSON.stringify(h.writes[1].id)},49).allowed`;
    assert.equal(h.run(check), true);
    h.grid.gridW = -37;
    assert.equal(h.run(check), false, 'a newer export measurement reduces the supported command');
    h.grid.gridW = -30.9;
    h.advance(1000); h.fresh();
    h.grid.sourceTs = [2002000, 2002000];
    assert.equal(h.run(check), false, 'a newer inverter response needs a matching meter sample');
    delete h.grid.sourceTs;
    assert.equal(h.run(check), true);
    h.complete(); h.advance(1100); h.fresh(); h.snapshot(1, {GS: 49, GP: 49});
    h.grid.gridW = 0;
    h.own('Control.Targets.Battery_W', -49);
    h.tick();
    assert.deepEqual(h.commands(), [125, 49]);
    assert.equal(h.value('Devices.Battery.Heads.1.ActuatorSettled'), true);
});

test('export with insufficient household demand or unproven measurements still stops pending discharge', () => {
    for (const [reason, change] of Object.entries({
        'demand below deadband': h => { h.grid.gridW = -71; },
        'missing GS echo': h => { h.snapshot(1, {GS: 0, GP: 80}); },
        'held meter pair': h => { h.grid.held = true; },
        'pre-command meter pair': h => { h.grid.sourceTs = [1999999, 2002000]; },
        'revoked discharge permission': h => { h.own('Config.BatterySelfConsumptionEnabled', false); },
        'expired feedback': h => { h.advance(15000); h.fresh(); }
    })) {
        const h = harness(1);
        h.own('Config.BatteryDeadband_W', 10);
        h.own('Config.BatteryFineStep_W', 600);
        h.grid.gridW = 100;
        h.own('Control.Targets.Battery_W', -125);
        h.tick(); h.complete();
        h.advance(2000); h.fresh(); h.snapshot(1, {GS: 125, GP: 80});
        h.grid.gridW = -31;
        h.own('Control.Targets.Battery_W', -54);
        change(h); h.tick();
        assert.deepEqual(h.commands(), [125, 0], reason);
    }
});

test('a household discharge waits briefly for a meter sample after the XT500 response', () => {
    for (const outcome of ['valid meter sample', 'deadline', 'reduced limit']) {
        const h = harness(1);
        h.own('Config.BatteryDeadband_W', 10);
        h.own('Config.BatteryFineStep_W', 600);
        h.grid.gridW = 104;
        h.own('Control.Targets.Battery_W', -104);
        h.tick(); h.complete();

        h.advance(2000); h.fresh(); h.snapshot(1, {GS: 104, GP: 66});
        h.grid.gridW = -5;
        h.grid.sourceTs = [2001900, 2001900];
        h.own('Control.Targets.Battery_W', -61);
        h.tick();
        assert.deepEqual(h.commands(), [104], outcome);
        assert.match(h.value('Devices.Battery.OutputStatus'), /Netzmessung nach/);

        if (outcome === 'deadline') h.advance(4000);
        if (outcome === 'reduced limit') h.own('Config.BatteryMaxDischarge_W', 80);
        if (outcome === 'valid meter sample') {
            h.advance(1000); h.fresh(); h.snapshot(1, {GS: 104, GP: 85});
            h.grid.gridW = 19;
            h.grid.sourceTs = [2002800, 2002800];
            h.own('Control.Targets.Battery_W', -104);
        }
        h.tick();
        assert.deepEqual(h.commands(), outcome === 'valid meter sample' ? [104] : [104, 0], outcome);
    }
});

test('late discharge echo permits automatic return after a fresh zero and then PV charging', () => {
    const h = harness(1);
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.Targets.Battery_W', -514);
    h.tick(); h.complete();
    h.own('Control.Targets.Battery_W', 0);
    h.tick(); h.complete();
    h.advance(1000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [514, 0]);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), -514);
    h.advance(1000); h.snapshot(1, {GS: 514, GP: 60}); h.fresh(); h.tick(); h.complete();
    h.advance(1000); h.snapshot(1, {GS: 0, GP: 0}); h.fresh();
    h.own('Control.Targets.Battery_W', 650);
    h.tick();
    assert.deepEqual(h.commands(), [514, 0, 0, -600]);
    assert.equal(h.value('Devices.Battery.ConfirmPhysicalStop'), false);
});

test('a pending charge without a GS echo still stops when immediate reduction is needed', () => {
    const cases = {
        house: h => h.put('ha3', 45.3),
        operator: h => { h.limit.budgetW = 1488; },
        group: h => { h.limit.groupNet = true; h.limit.groupMaximumW = 1488; },
        configured: h => h.own('Config.BatteryMaxCharge_W', 1488),
        head: h => { h.nativeConfig.batteryHead1MaxChargeW = 1488; },
        soc: h => h.snapshot(1, {SC: 100}),
        price: h => h.own('Control.BatteryPriceGridCharge_W', 100),
        actual: h => h.snapshot(1, {GS: -1400, GP: -1530}),
        'actual above target with 200 W drop': h => { h.snapshot(1, {GS: -1400, GP: -1326}); h.own('Control.Targets.Battery_W', 1300); },
        'over 200 W drop': h => { h.snapshot(1, {GS: -1400, GP: -1250}); h.own('Control.Targets.Battery_W', 1299); },
        'zero target': h => h.own('Control.Targets.Battery_W', 0),
        timeout: h => { h.advance(15000); h.fresh(); }
    };
    for (const [reason, change] of Object.entries(cases)) {
        const h = harness(1);
        h.own('Config.BatteryFineStep_W', 1000);
        h.own('Control.Targets.Battery_W', 1400); h.tick(); h.complete(); h.follow();
        h.tick(); h.complete(); h.follow();
        h.own('Config.BatteryFineStep_W', 100);
        h.own('Control.Targets.Battery_W', 1500); h.tick(); h.complete();
        h.advance(4000); h.snapshot(1, {GS: -1400, GP: -1324}); h.fresh();
        h.own('Control.Targets.Battery_W', 1488);
        change(h); h.tick();
        assert.deepEqual(h.commands(), [-1000, -1400, -1500, 0], reason);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1500, reason);
    }
});

test('a reduced nonzero command is still immediate after the previous command physically settles', () => {
    const h = harness(1); h.own('Config.BatteryFineStep_W', 600); h.own('Control.Targets.Battery_W', 600);
    h.tick(); h.complete(); h.follow(); h.tick(); h.own('Control.Targets.Battery_W', 500); h.tick();
    assert.deepEqual(h.commands(), [-600, -500]);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 500);
});


test('PV feedback observation warns and keeps the outstanding lower charge through a zero target', () => {
    const h = harness(1);
    h.own('Config.BatteryPvFeedbackObservationEnabled', true);
    h.own('Config.BatteryFineStep_W', 600); h.tick(); h.complete(); h.follow(); h.tick(); h.complete();
    h.advance(2000); h.snapshot(1, {GS: -1000, GP: -620}); h.fresh();
    h.own('Control.Targets.Battery_W', 157); h.tick(); h.complete();
    assert.deepEqual(h.commands(), [-600, -1000, -157]);
    h.advance(650); h.fresh(); h.grid.gridW = 80; h.own('Control.Targets.Battery_W', 0); h.tick();
    assert.deepEqual(h.commands(), [-600, -1000, -157]);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 1000);
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].level, 'warn');
    assert.match(h.logs[0].message, /Auftrag 157 W.*GS -1000 W.*AC-Ladung 620 W.*PV-Ziel 0 W.*Netz 80 W/);
    h.tick(); assert.equal(h.logs.length, 1);
    h.advance(2000); h.snapshot(1, {GS: -157, GP: -150}); h.fresh();
    h.grid.gridW = -350; h.own('Control.Targets.Battery_W', 500); h.tick();
    assert.deepEqual(h.commands(), [-600, -1000, -157, -500]);
});

test('PV observation ramps past the learned ceiling only against fresh export after confirmation', () => {
    const h = harness(1);
    h.own('Config.BatteryPvFeedbackObservationEnabled', true);
    h.own('Config.BatteryFineStep_W', 1000);
    h.tick(); h.complete();
    h.advance(5000); h.snapshot(1, {GS: -1000, GP: -850}); h.fresh(); h.tick();
    h.advance(10000); h.fresh(); h.tick(); h.complete();
    assert.deepEqual(h.commands(), [-1000, -850]);
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.Targets.Battery_W', 2000);
    h.advance(2000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-1000, -850]);
    h.snapshot(1, {GS: -850, GP: -842}); h.fresh();
    for (const grid of [{valid: false, gridW: -390}, {valid: true, gridW: -390, held: true},
        {valid: true, gridW: -390, held: false, sourceTs: [2000000, 2000000]}]) {
        Object.assign(h.grid, grid); h.tick();
        assert.deepEqual(h.commands(), [-1000, -850]);
    }
    delete h.grid.sourceTs; h.grid.gridW = -390; h.tick();
    assert.equal(h.commands().at(-1), -1232, '842 W actual plus 390 W export');
    h.complete(); h.advance(1000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-1000, -850, -1232], 'keep the probe while feedback is pending');
    h.advance(2000); h.snapshot(1, {GS: -1232, GP: -1230}); h.fresh();
    h.grid.gridW = -900; h.tick();
    assert.equal(h.commands().at(-1), -1830, 'next step is limited to 600 W above actual');
    h.complete(); h.advance(2000); h.snapshot(1, {GS: -1830, GP: -1820}); h.fresh();
    h.own('Control.Targets.Battery_W', 2700); h.own('Config.BatteryMaxCharge_W', 2000); h.tick();
    assert.equal(h.commands().at(-1), -2000, 'configured charge ceiling is still binding');
});

test('SunEnergy observation corrects 150 W export, then 10 W export, then 20 W import', () => {
    const h = harness(1);
    h.own('Config.BatteryPvFeedbackObservationEnabled', true);
    h.own('Config.BatteryFineStep_W', 600);
    h.own('Control.TargetGridPower_W', 0);
    h.tick(); h.complete(); h.follow();
    for (const [gridW, targetW] of [[-150, 750], [-10, 760], [20, 740], [0, 740]]) {
        h.grid.gridW = gridW;
        h.own('Control.Targets.Battery_W', targetW);
        h.tick();
        assert.equal(h.commands().at(-1), -targetW);
        h.complete(); h.follow();
    }
    assert.deepEqual(h.commands(), [-600, -750, -760, -740]);
});

test('PV feedback observation keeps waiting past the deadline and stops when disabled', () => {
    const h = harness(1);
    h.own('Config.BatteryPvFeedbackObservationEnabled', true);
    h.own('Config.BatteryFineStep_W', 600); h.tick(); h.complete();
    h.advance(16000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-600]);
    assert.match(h.logs[0].message, /Rueckmeldefrist/);
    assert.equal(h.value('Devices.Battery.Fault'), '');
    h.own('Config.BatteryPvFeedbackObservationEnabled', false); h.tick();
    assert.deepEqual(h.commands(), [-600, 0]);
});

test('an echoed 12 W idle charge yields to fresh 99 W export through one exact zero', () => {
    for (const nextTargetW of [99, 0]) {
        const h = harness(1);
        h.own('Config.BatteryPvFeedbackObservationEnabled', true);
        h.own('Config.BatteryFineStep_W', 600);
        h.own('Config.BatteryDeadband_W', 10);
        h.own('Control.TargetGridPower_W', 0);
        h.grid.gridW = -12; h.own('Control.Targets.Battery_W', 12); h.tick(); h.complete();
        h.advance(1000); h.fresh(); h.snapshot(1, {GS: -12, GP: 0}); h.tick();
        h.grid.gridW = -99; h.own('Control.Targets.Battery_W', 99); h.tick();
        assert.deepEqual(h.commands(), [-12], 'allow time for physical response');
        h.advance(15000); h.fresh();
        for (const grid of [{sourceTs: [2000000, 2000000]}, {gridW: -18}]) {
            Object.assign(h.grid, grid); h.tick();
            assert.deepEqual(h.commands(), [-12], 'no replacement on stale or small export');
            delete h.grid.sourceTs; h.grid.gridW = -99;
        }
        h.tick();
        assert.deepEqual(h.commands(), [-12, 0]);
        h.complete();
        const completedAt = h.time();
        h.advance(100); h.fresh(); h.snapshot(1, {GS: 0, GP: 0, timestamp: completedAt - 1}); h.tick();
        assert.deepEqual(h.commands(), [-12, 0], 'publication after transport cannot make a pre-write acquisition fresh');
        h.advance(1100); h.fresh(); h.snapshot(1, {GS: 0, GP: -12}); h.tick();
        assert.deepEqual(h.commands(), [-12, 0]);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 12);
        h.advance(1100); h.fresh(); h.snapshot(1, {GP: 0, timestamp: h.time()});
        h.grid.gridW = -nextTargetW;
        h.own('Control.Targets.Battery_W', nextTargetW); h.tick();
        assert.deepEqual(h.commands(), [-12, 0, ...(nextTargetW ? [-99] : [])]);
        assert.equal(h.value('Devices.Battery.Fault'), '');
    }
});

test('PV feedback observation respects meter availability, electrical caps and the battery release', () => {
    for (const stop of [h => { h.grid.valid = false; }, h => { h.grid.held = true; },
        h => { h.limit.budgetW = 500; }, h => h.snapshot(1, {SC: 100}),
        h => h.own('Devices.Battery.ControlEnabled', false)]) {
        const h = harness(1);
        h.own('Config.BatteryPvFeedbackObservationEnabled', true);
        h.own('Config.BatteryFineStep_W', 600); h.tick(); h.complete();
        h.advance(16000); h.fresh(); h.own('Control.Targets.Battery_W', 0); stop(h); h.tick();
        assert.deepEqual(h.commands(), [-600, 0]);
        assert.equal(h.logs.length, 0);
    }
});
