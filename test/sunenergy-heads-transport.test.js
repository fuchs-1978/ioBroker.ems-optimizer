'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(count = 3) {
    const adapterModule = {exports: {}};
    class Adapter {
        constructor() {
            this.namespace = 'ems.0';
            this.config = {globalWriteEnabled: true, batteryPresent: true, batteryControlEnabled: true,
                batteryProductionArmed: true, batteryDispatchMode: 'sunenergy-heads',
                batterySunEnergyInstance: 'sunenergyxt500.0', batteryHeadCount: count,
                batterySetpointId: 'sunenergyxt500.0.heads.1.control.GS'};
            this.log = Object.fromEntries(['warn', 'error', 'info', 'debug'].map(key => [key, () => {}]));
        }
        on() {}
    }
    const customRequire = name => name === '@iobroker/adapter-core' ? {Adapter}
        : name === 'node-schedule' ? {scheduleJob: () => ({cancel() {}})}
        : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'),
        {require: customRequire, module: adapterModule, __dirname: path.join(__dirname, '..'), console, setTimeout, clearTimeout});
    const adapter = adapterModule.exports();
    const base = 'ems.0.Devices.Battery';
    adapter.stateCache.set('ems.0.System.RealOutputsEnabled', {val: true});
    for (const key of ['Present', 'ControlEnabled', 'DriverReady', 'OutputOwned', 'HeadsVerified'])
        adapter.stateCache.set(`${base}.${key}`, {val: true});
    const ownership = Array.from({length: count}, (_, offset) => {
        const index = offset + 1;
        const setpointId = `sunenergyxt500.0.heads.${index}.control.GS`;
        adapter.allowedForeignWriteIds.add(setpointId);
        for (const [key, val] of Object.entries({OutputOwned: true, OutputSetpointId: setpointId,
            OutputCommandInternal_W: 600, OutputReservedCharge_W: 600, OutputUnobservedCommand_W: 600,
            OutputUnobservedCommandSince: 1000}))
            adapter.stateCache.set(`${base}.Heads.${index}.${key}`, {val});
        return {index, setpointId, owned: true, commandW: 600, commandAt: 1000, reservedChargeW: 600,
            unobservedCommandW: 600, unobservedSince: 1000};
    });
    adapter.stateCache.set(`${base}.HeadOwnership_JSON`, {val: JSON.stringify({version: 1, heads: ownership})});
    adapter.engineContext = {};
    const checks = [];
    const check = {allowed: true, reason: 'ready'};
    adapter.runEngine = source => {
        assert.match(source, /^batteryHeadsQueuedCheck\(/, 'never substitute the legacy per-command battery budget');
        checks.push(source);
        return check;
    };
    const writes = [];
    adapter.setForeignStateAsync = async (id, value, ack) => writes.push({id, value, ack});
    adapter.setStateAsync = async () => {};
    const id = index => `sunenergyxt500.0.heads.${index}.control.GS`;
    const drain = async () => { await Promise.allSettled([...adapter.pendingForeignWrites]); };
    return {adapter, base, checks, check, writes, ownership, id, drain};
}

for (const count of [1, 2, 3]) {
    test(`${count}-head transport classifies every GS as signed battery output`, async () => {
        const f = fixture(count);
        for (let index = 1; index <= count; index++)
            assert.equal(f.adapter.writeForeignStateGuarded(f.id(index), -600), true);
        await f.drain();
        assert.deepEqual(f.writes.map(write => [write.id, write.value, write.ack]),
            Array.from({length: count}, (_, offset) => [f.id(offset + 1), -600, false]));
        assert.equal(f.checks.length, count);
    });
}

test('each nonzero head waits for the durable peer reservation and whole ownership plan', async () => {
    const f = fixture(3);
    let persistPeer;
    let persistOwnership;
    f.adapter.pendingOwnWrites.set(`${f.base}.Heads.3.OutputUnobservedCommand_W`,
        new Promise(resolve => { persistPeer = resolve; }));
    f.adapter.pendingOwnWrites.set(`${f.base}.HeadOwnership_JSON`,
        new Promise(resolve => { persistOwnership = resolve; }));
    f.adapter.writeForeignStateGuarded(f.id(1), -600);
    await Promise.resolve();
    persistOwnership();
    await Promise.resolve();
    assert.equal(f.writes.length, 0);
    persistPeer();
    await f.drain();
    assert.equal(f.writes.length, 1);
});

test('failed persisted peer reserve blocks a different head even after its pending promise disappears', async () => {
    const f = fixture(3);
    const key = `${f.base}.Heads.2.OutputReservedCharge_W`;
    f.adapter.setStateAsync = async () => { throw new Error('peer reserve persistence failed'); };
    await assert.rejects(f.adapter.setCompatState(key, 600));
    await Promise.resolve();
    assert.equal(f.adapter.pendingOwnWrites.has(key), false);
    f.adapter.writeForeignStateGuarded(f.id(1), -600);
    await f.drain();
    assert.equal(f.writes.length, 0);
    assert.equal(f.checks.length, 0);
});

test('a peer reservation added after enqueue must become durable before an unchanged head command', async () => {
    const f = fixture(3);
    let persistInitial;
    let persistLaterPeer;
    f.adapter.pendingOwnWrites.set(`${f.base}.HeadOwnership_JSON`,
        new Promise(resolve => { persistInitial = resolve; }));
    f.adapter.writeForeignStateGuarded(f.id(1), -600);
    await Promise.resolve();
    f.adapter.pendingOwnWrites.set(`${f.base}.Heads.3.OutputReservedCharge_W`,
        new Promise(resolve => { persistLaterPeer = resolve; }));
    persistInitial();
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    assert.equal(f.writes.length, 0);
    persistLaterPeer();
    await f.drain();
    assert.equal(f.writes.length, 1);
});

test('failed initial topology claim cannot be hidden by replacing or deleting the pending write', async () => {
    const f = fixture(2);
    let reject;
    f.adapter.pendingOwnWrites.set(`${f.base}.HeadOwnership_JSON`,
        new Promise((resolve, fail) => { reject = fail; }));
    f.adapter.writeForeignStateGuarded(f.id(2), -600);
    reject(new Error('topology DB write failed'));
    f.adapter.pendingOwnWrites.delete(`${f.base}.HeadOwnership_JSON`);
    await f.drain();
    assert.equal(f.writes.length, 0);
});

for (const change of ['driver', 'master', 'native-control', 'native-armed', 'json-owned', 'head-owned',
    'head-target', 'topology-count', 'mode-switch', 'full-check']) {
    test(`queued head checks ${change} again before reaching the standard driver`, async () => {
        const f = fixture(3);
        let persist;
        f.adapter.pendingOwnWrites.set(`${f.base}.HeadOwnership_JSON`, new Promise(resolve => { persist = resolve; }));
        f.adapter.writeForeignStateGuarded(f.id(2), -600);
        if (change === 'driver') f.adapter.stateCache.set(`${f.base}.DriverReady`, {val: false});
        if (change === 'master') f.adapter.stateCache.set('ems.0.System.RealOutputsEnabled', {val: false});
        if (change === 'native-control') f.adapter.config.batteryControlEnabled = false;
        if (change === 'native-armed') f.adapter.config.batteryProductionArmed = false;
        if (change === 'json-owned') {
            f.ownership[1].owned = false;
            f.adapter.stateCache.set(`${f.base}.HeadOwnership_JSON`, {val: JSON.stringify({version: 1, heads: f.ownership})});
        }
        if (change === 'head-owned') f.adapter.stateCache.set(`${f.base}.Heads.2.OutputOwned`, {val: false});
        if (change === 'head-target') f.adapter.stateCache.set(`${f.base}.Heads.2.OutputSetpointId`, {val: f.id(1)});
        if (change === 'topology-count') f.adapter.config.batteryHeadCount = 1;
        if (change === 'mode-switch') f.adapter.config.batteryDispatchMode = 'single';
        if (change === 'full-check') { f.check.allowed = false; f.check.reason = 'aggregate charge/phase limit changed'; }
        persist();
        await f.drain();
        assert.equal(f.writes.length, 0);
    });
}

test('safe zero cancels obsolete queued nonzero but remains ordered after an in-flight write', async () => {
    const f = fixture(1);
    let complete;
    f.adapter.setForeignStateAsync = async (id, value, ack) => {
        f.writes.push({id, value, ack});
        if (value === -600) await new Promise(resolve => { complete = resolve; });
    };
    f.adapter.writeForeignStateGuarded(f.id(1), -600);
    while (!complete) await Promise.resolve();
    f.adapter.writeForeignStateGuarded(f.id(1), -1200);
    f.adapter.writeForeignStateGuarded(f.id(1), 0);
    f.adapter.unloading = true;
    complete();
    await f.drain();
    assert.deepEqual(f.writes.map(write => write.value), [-600, 0]);
});

test('former owned head GS is zero-only even before a changed topology metadata refresh finishes', async () => {
    const f = fixture(3);
    f.adapter.config.batteryHeadCount = 2;
    assert.equal(f.adapter.writeForeignStateGuarded(f.id(3), 500), false);
    assert.equal(f.adapter.writeForeignStateGuarded(f.id(3), -500), false);
    assert.equal(f.adapter.writeForeignStateGuarded(f.id(3), 0), true);
    await f.drain();
    assert.deepEqual(f.writes.map(write => write.value), [0]);
    f.adapter.config.batteryDispatchMode = 'single';
    assert.equal(f.adapter.writeForeignStateGuarded(f.id(2), 500), false);
});

test('zero-only former GS remains stoppable with master and driver off and no live engine', async () => {
    const f = fixture(3);
    f.adapter.config.batteryDispatchMode = 'single';
    f.adapter.config.batterySetpointId = '';
    f.adapter.config.globalWriteEnabled = false;
    f.adapter.engineContext = null;
    f.adapter.stateCache.set(`${f.base}.DriverReady`, {val: false});
    for (let index = 1; index <= 3; index++) {
        f.adapter.zeroOnlyForeignWriteIds.add(f.id(index));
        assert.equal(f.adapter.writeForeignStateGuarded(f.id(index), 0), true);
    }
    await f.drain();
    assert.equal(f.writes.length, 3);
    assert.equal(f.checks.length, 0);
});

test('multihead startup preloads specific standard-driver telemetry without instance-wide wildcards', async () => {
    const f = fixture(2);
    const reads = [];
    const subscriptions = [];
    f.adapter.getForeignStatesAsync = async pattern => { reads.push(pattern); return {}; };
    f.adapter.subscribeForeignStatesAsync = async pattern => subscriptions.push(pattern);
    f.adapter.readMapping = () => ({});
    await f.adapter.preloadStates();
    for (const index of [1, 2])
        for (const suffix of ['info.rawResponse', 'info.online', 'control.GS', 'control.MM', 'control.LM', 'grid.GP'])
            assert.ok(reads.includes(`sunenergyxt500.0.heads.${index}.${suffix}`), suffix);
    assert.equal(reads.filter(id => id.startsWith('sunenergyxt500.')).length, 20);
    assert.ok(!reads.some(id => id.startsWith('sunenergyxt500.') && id.includes('*')));
    assert.deepEqual(subscriptions, reads);
});

test('preloading recovers exact former-head telemetry from persisted ownership even in legacy mode', async () => {
    const f = fixture(1);
    f.adapter.stateCache.clear();
    f.adapter.config.batteryDispatchMode = 'single';
    const formerId = 'sunenergyxt500.2.heads.3.control.GS';
    const reads = [];
    f.adapter.getForeignStatesAsync = async pattern => {
        reads.push(pattern);
        return pattern === 'ems.0.*' ? {'ems.0.Devices.Battery.HeadOwnership_JSON': {val: JSON.stringify({version: 1,
            heads: [{index: 3, setpointId: formerId, owned: true}]})}} : {};
    };
    f.adapter.subscribeForeignStatesAsync = async () => {};
    f.adapter.readMapping = () => ({});
    await f.adapter.preloadStates();
    assert.equal(reads[0], 'ems.0.*');
    assert.ok(reads.includes('sunenergyxt500.2.heads.3.info.rawResponse'));
    assert.ok(reads.includes('sunenergyxt500.2.heads.3.info.online'));
    assert.equal(reads.filter(id => id.startsWith('sunenergyxt500.2.')).length, 10);
    assert.ok(!reads.some(id => id.startsWith('sunenergyxt500.') && id.includes('*')));
});

test('the explicit Admin single-head default permits a properly owned and guarded legacy command', async () => {
    const f = fixture(1);
    f.adapter.config.batteryDispatchMode = 'single-head';
    f.adapter.stateCache.set(`${f.base}.HeadOwnership_JSON`, {val: '{"version":1,"heads":[]}'});
    f.adapter.stateCache.set(`${f.base}.OutputSetpointId`, {val: f.id(1)});
    f.adapter.runEngine = code => code.includes('batteryRegulationState')
        ? {eligible: true, canCharge: true, canDischarge: true, maxChargeW: 2400, maxDischargeW: 800}
        : {allowed: true};
    assert.equal(f.adapter.writeForeignStateGuarded(f.id(1), -600), true);
    await f.drain();
    assert.deepEqual(f.writes.map(write => write.value), [-600]);
});

function attachRealController(f) {
    let now = 2000000;
    const adapter = f.adapter;
    adapter.stateCache.clear();
    const put = (id, val, extra = {}) => adapter.stateCache.set(id, {val, ack: true, ts: now, ...extra});
    const own = (suffix, val) => put(`ems.0.${suffix}`, val);
    for (const suffix of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid',
        'Devices.Battery.Present', 'Devices.Battery.ControlEnabled', 'Devices.Battery.DriverReady',
        'Devices.Battery.HeadsVerified']) own(suffix, true);
    own('Control.LastUpdate', now); own('Control.Targets.Battery_W', 1000);
    own('Config.BatteryMinSoC_pct', 15); own('Config.BatteryMaxSoC_pct', 100);
    own('Config.BatteryMaxCharge_W', 7200); own('Config.BatteryMaxDischarge_W', 2400);
    own('Config.BatterySelfConsumptionEnabled', true);
    for (let index = 1; index <= adapter.config.batteryHeadCount; index++) {
        put(`sunenergyxt500.0.heads.${index}.info.rawResponse`, JSON.stringify({SC: 20 + (index - 1) * 30,
            ON: 1, GS: 0, GP: 0, MM: 0, LM: 1, SI: 10, SA: 100, MG: 800, IS: 800, LP: 0, PK: 1}));
        put(`sunenergyxt500.0.heads.${index}.info.online`, true);
    }
    for (const id of ['ha1', 'ha2', 'ha3']) put(id, 0);
    const limit = {valid: true, budgetW: null};
    const loads = {valid: true, dhwW: 0, heatingW: 0, wallboxW: 0};
    const grid = {valid: true, gridW: 0};
    const ctx = vm.createContext({Math, Date: {now: () => now, parse: Date.parse}, nativeConfig: adapter.config,
        sunEnergyHeads: require('../lib/sunenergy-heads'),
        SMA_GRID_MAX_AGE_MS: require('../lib/source-diagnostics').SMA_GRID_MAX_AGE_MS,
        CFG: {root: 'ems.0', dp: {myPvDhwHaCurrentA: ['ha1', 'ha2', 'ha3']}},
        realtimeGridMeasurement: () => ({sourceTs: [now, now], ...grid}),
        getState: id => adapter.getCachedState(id), existsState: id => adapter.stateCache.has(id),
        write: (id, val) => adapter.setCompatState(id, val),
        stateDef: (id, val) => { if (!adapter.stateCache.has(id)) put(id, val); },
        configDef: (id, val) => { if (!adapter.stateCache.has(id)) put(id, val); },
        writeForeignState: (id, val, callback) => adapter.writeForeignStateGuarded(id, val, callback),
        currentConsumptionLimit: () => limit, coordinatedConsumptionLoads: () => loads,
        coordinatedPhaseReservations: () => ({valid: true, otherW: [0, 0, 0]})});
    vm.runInContext(fs.readFileSync(require.resolve('../lib/engine/battery-controller'), 'utf8'), ctx);
    adapter.engineContext = ctx;
    adapter.runEngine = code => vm.runInContext(code, ctx);
    adapter.runEngine('createBatteryStates()');
    own('Config.BatteryFineStep_W', 600);
    return {own, put, limit, loads, grid, now: () => now, advance: ms => { now += ms; },
        tick: () => adapter.runEngine('updateBatteryProductionOutput()')};
}

test('an older foreign GS write remains evidence of conflicting ownership after a newer driver echo', () => {
    const f = fixture(1);
    const h = attachRealController(f);
    const id = f.id(1), now = Date.now();
    f.adapter.stateCache.set(id, {val: 0, ack: true, ts: now, from: 'system.adapter.sunenergyxt500.0'});
    f.adapter.onStateChange(id, {val: 100, ack: false, ts: now - 100, from: 'system.adapter.javascript.0'});
    assert.equal(f.adapter.getCachedState(id).val, 0);
    assert.equal(f.adapter.runEngine(`batteryHeadForeignGsWrites.get(${JSON.stringify(id)})`), h.now());
    h.advance(1000);
    f.adapter.onStateChange(id, {val: 100, ack: false, ts: now - 100, from: 'system.adapter.ems.0'});
    assert.equal(f.adapter.runEngine(`batteryHeadForeignGsWrites.get(${JSON.stringify(id)})`), h.now() - 1000);
});

for (const count of [1, 2, 3]) {
    test(`real ${count}-head runtime and production transport complete a durable SoC-weighted plan then stop`, async () => {
        const f = fixture(count);
        const controller = attachRealController(f);
        controller.tick();
        await f.drain();
        assert.equal(f.writes.length, count);
        assert.equal(f.writes.reduce((sum, write) => sum + write.value, 0), -600);
        assert.equal(f.adapter.getCachedState(`${f.base}.OutputReservedCharge_W`).val, 600);
        if (count > 1) assert.ok(Math.abs(f.writes[0].value) > Math.abs(f.writes.at(-1).value));
        const json = JSON.parse(f.adapter.getCachedState(`${f.base}.HeadOwnership_JSON`).val);
        assert.equal(json.heads.length, count);
        assert.ok(json.heads.every(head => head.owned && head.commandW > 0));
        controller.own('System.RealOutputsEnabled', false);
        controller.tick();
        await f.drain();
        assert.deepEqual(f.writes.slice(count).map(write => write.value), Array(count).fill(0));
        assert.equal(f.adapter.getCachedState(`${f.base}.OutputOwned`).val, true,
            'successful transport alone is no electrical stop proof');
        assert.equal(f.adapter.getCachedState(`${f.base}.OutputReservedCharge_W`).val, 600,
            'unobserved old commands retain their reserve until independent head response');
    });
}

test('real controller/transport recheck an aggregate operator limit reduced during durable persistence', async () => {
    const f = fixture(3);
    const controller = attachRealController(f);
    let persist;
    const pending = new Promise(resolve => { persist = resolve; });
    f.adapter.setStateAsync = async (id, state) => {
        if (id === 'Devices.Battery.Heads.3.OutputReservedCharge_W' && state.val > 0) await pending;
    };
    controller.tick();
    await Promise.resolve();
    controller.limit.budgetW = 100;
    persist();
    await f.drain();
    assert.deepEqual(f.writes.map(write => write.value), [0, 0, 0],
        'neither an individually small head nor the old plan bypasses the aggregate limit');
    assert.equal(f.adapter.getCachedState(`${f.base}.OutputReservedCharge_W`).val, 600);
});

test('a superseded household reduction resumes from the acknowledged discharge after a missed write', async () => {
    const recoverable = ['newer XT500 sample', 'smaller grid budget'];
    for (const scenario of [...recoverable, 'no remaining demand', 'lower device limit', 'previous deadline', 'revoked release']) {
        const f = fixture(1);
        const h = attachRealController(f);
        const rawId = 'sunenergyxt500.0.heads.1.info.rawResponse';
        const snapshot = (GS, GP, limits = {}) => h.put(rawId, JSON.stringify({
            ...JSON.parse(f.adapter.getCachedState(rawId).val), GS, GP, ...limits
        }));
        const commands = () => f.writes.map(write => write.value);
        const output = () => f.adapter.getCachedState(`${f.base}.OutputCommandInternal_W`).val;
        h.own('Config.BatteryDeadband_W', 10);
        h.own('Control.Targets.Battery_W', -125);
        h.grid.gridW = 125;
        h.tick(); await f.drain();
        h.advance(2000); snapshot(125, 80);
        h.own('Control.Targets.Battery_W', -54);
        h.grid.gridW = -31;

        let finish;
        const durableWrite = new Promise(resolve => { finish = resolve; });
        f.adapter.setStateAsync = async (id, state) => {
            if (id === 'Devices.Battery.Heads.1.OutputCommandInternal_W' && state.val === -49) await durableWrite;
        };
        h.tick();
        assert.equal(output(), -49);
        h.advance(scenario === 'previous deadline' ? 15000 : 1000);
        if (scenario === 'newer XT500 sample') {
            snapshot(125, 91);
            h.grid.sourceTs = [h.now() - 100, h.now() - 100];
        }
        if (scenario === 'smaller grid budget' || scenario === 'previous deadline') {
            h.grid.gridW = -37;
            h.own('Control.Targets.Battery_W', -43);
        }
        if (scenario === 'no remaining demand') {
            snapshot(125, 91);
            h.own('Control.Targets.Battery_W', 0);
        }
        if (scenario === 'lower device limit') {
            snapshot(125, 80, {MG: 100});
            h.grid.gridW = -37;
        }
        if (scenario === 'revoked release') h.own('System.RealOutputsEnabled', false);
        finish(); await f.drain();

        if (!recoverable.includes(scenario)) {
            assert.deepEqual(commands(), [125, 0], scenario);
            assert.equal(f.adapter.getCachedState(`${f.base}.Fault`).val, '', scenario);
            continue;
        }
        assert.deepEqual(commands(), [125], scenario);
        assert.equal(output(), -125);
        h.advance(1000); snapshot(125, 96);
        h.own('Control.Targets.Battery_W', -56);
        h.grid.gridW = -40;
        delete h.grid.sourceTs;
        h.tick(); await f.drain();
        assert.deepEqual(commands(), [125, 56], scenario);
    }
});


for (const dispatched of [false, true]) {
    test(`zero releases only a proven unsent head command, dispatch started: ${dispatched}`, async () => {
        const f = fixture(1);
        const h = attachRealController(f);
        const rawId = 'sunenergyxt500.0.heads.1.info.rawResponse';
        const snapshot = f.adapter.getCachedState(rawId).val;
        let finishWrite, finishZero;
        let signalWrite, signalZero;
        const writing = new Promise(resolve => { signalWrite = resolve; });
        const zeroWriting = new Promise(resolve => { signalZero = resolve; });
        f.adapter.setForeignStateAsync = async (id, value, ack) => {
            f.writes.push({id, value, ack});
            if (value < 0 && dispatched)
                await new Promise((resolve, reject) => { finishWrite = reject; signalWrite(); });
            if (value === 0)
                await new Promise(resolve => { finishZero = resolve; signalZero(); });
        };
        h.own('Config.BatteryFineStep_W', 100);
        h.tick();
        if (dispatched) await writing;
        h.advance(1000);
        h.own('Control.Targets.Battery_W', 14);
        h.own('Control.LastUpdate', 2001000);
        h.tick();
        if (dispatched) finishWrite(new Error('transport outcome unknown'));
        await zeroWriting;
        h.advance(1000);
        h.put(rawId, snapshot);
        finishZero();
        await f.drain();
        assert.deepEqual(f.writes.map(write => write.value), dispatched ? [-100, 0] : [0]);
        const reserve = () => f.adapter.getCachedState(`${f.base}.OutputReservedCharge_W`).val;
        h.tick();
        assert.equal(reserve(), 100, 'snapshot during the zero write cannot confirm zero');
        h.advance(1000);
        h.put(rawId, snapshot);
        h.tick();
        assert.equal(reserve(), dispatched ? 100 : 0);
        if (dispatched) return;
        h.own('Control.Targets.Battery_W', 1000);
        h.tick();
        await f.drain();
        assert.deepEqual(f.writes.map(write => write.value), [0, -100]);
    });
}
