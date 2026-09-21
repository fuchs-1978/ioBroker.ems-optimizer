'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function adapter() {
    const adapterModule = {exports: {}};
    class Adapter {
        constructor() {
            this.namespace = 'ems.0';
            this.config = {globalWriteEnabled: true};
            this.log = Object.fromEntries(['warn', 'error', 'info', 'debug'].map(k => [k, () => {}]));
        }
        on() {}
    }
    const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    const customRequire = name => name === '@iobroker/adapter-core' ? {Adapter}
        : name === 'node-schedule' ? {scheduleJob: () => ({cancel() {}})}
        : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name);
    vm.runInNewContext(source, {require: customRequire, module: adapterModule,
        __dirname: path.join(__dirname, '..'), console, setTimeout, clearTimeout});
    const instance = adapterModule.exports();
    instance.setStateAsync = async () => {};
    instance.setObjectNotExistsAsync = async () => {};
    instance.getStateAsync = async () => null;
    return instance;
}

test('native settings and startup invalidation finish before outputs and schedules start', async () => {
    const a = adapter();
    const steps = [];
    a.preloadStates = async () => {
        for (const id of ['Plan.Valid', 'Control.Valid', 'System.DataValid'])
            a.stateCache.set(`ems.0.${id}`, {val: true, ts: 1, ack: true});
    };
    a.startEngine = async () => steps.push('load');
    a.applyNativeVehicleSettings = async () => steps.push('vehicles');
    a.applyNativeEmsSettings = async () => steps.push('native');
    a.publishMappingStatus = () => {};
    a.runEngine = source => steps.push(source.startsWith('// Objects') ? 'bootstrap' : source);
    a.wallboxOutput.initialize = async () => {
        assert.ok(steps.includes('native'));
        assert.equal(a.getCachedState('ems.0.Plan.Valid').val, false);
        assert.equal(a.getCachedState('ems.0.Plan.LastUpdate').val, 0);
        assert.ok(!steps.includes('bootstrap'));
        steps.push('outputs');
    };
    await a.onReady();
    assert.ok(steps.indexOf('outputs') < steps.indexOf('bootstrap'));
    assert.ok(steps.indexOf('native') < steps.indexOf('updateVehicles(); updateDhwSimulation(); observe();'));
});

test('asynchronous object reads cannot restore an old control value over new native settings', async () => {
    const a = adapter();
    const id = 'ems.0.Control.Valid';
    const old = {val: true, ts: 1, ack: true};
    a.stateCache.set(id, old);
    let finishRead;
    let readStarted;
    const reading = new Promise(resolve => { readStarted = resolve; });
    a.getStateAsync = () => new Promise(resolve => { finishRead = resolve; readStarted(); });
    const creating = a.queueCompatState(id, false);
    await reading;
    const writing = a.setCompatState(id, false);
    finishRead(old);
    await creating;
    await writing;
    assert.equal(a.getCachedState(id).val, false);
});

test('own-state database echoes cannot roll back newer pending decisions', async () => {
    const a = adapter();
    const id = 'ems.0.Control.Valid';
    let finish;
    let writeStarted;
    const started = new Promise(resolve => { writeStarted = resolve; });
    a.setStateAsync = () => new Promise(resolve => { finish = resolve; writeStarted(); });
    const writing = a.setCompatState(id, false);
    await started;
    a.onStateChange(id, {val: true, ts: Date.now(), ack: true});
    assert.equal(a.getCachedState(id).val, false);
    finish();
    await writing;
});

test('unchanged own-state values preserve lc while publishing a fresh ts', async () => {
    const a = adapter();
    a.stateCache.set('ems.0.x', {val: 6, ts: 100, lc: 50});
    await a.setCompatState('ems.0.x', 6);
    assert.equal(a.getCachedState('ems.0.x').lc, 50);
    assert.ok(a.getCachedState('ems.0.x').ts > 100);
});

test('late echoes stay ordered even after all write promises have completed', async () => {
    const a = adapter();
    const echoes = [];
    a.setStateAsync = async (id, state) => echoes.push({...state});
    await a.setCompatState('ems.0.Control.Valid', true);
    await a.setCompatState('ems.0.Control.Valid', false);
    a.onStateChange('ems.0.Control.Valid', echoes[0]);
    assert.equal(a.getCachedState('ems.0.Control.Valid').val, false);
    a.onStateChange('ems.0.Control.Valid', echoes[1]);
    assert.equal(a.getCachedState('ems.0.Control.Valid').val, false);
    assert.ok(echoes[1].ts > echoes[0].ts);
});

test('unload waits for initializing output ownership before deciding what to stop', async () => {
    const a = adapter();
    let finishInitialization;
    let initialized = false;
    let stopChecked = false;
    a.outputInitialization = new Promise(resolve => { finishInitialization = () => {
        initialized = true; resolve();
    }; });
    a.wallboxOutput.waitForIdle = async () => {};
    a.getForeignObjectAsync = async () => ({common: {enabled: false}});
    a.wallboxOutput.hasActiveOwnedOutput = () => initialized;
    a.wallboxOutput.stopAll = async () => {
        assert.equal(initialized, true);
        stopChecked = true;
    };
    const stopping = a.prepareUnload();
    assert.equal(stopChecked, false);
    finishInitialization();
    await stopping;
    assert.equal(stopChecked, true);
});

test('queued nonzero EHZ write rechecks master release before reaching actuator', async () => {
    const a = adapter();
    const writes = [];
    a.allowedForeignWriteIds.add('heater');
    a.stateCache.set('ems.0.System.RealOutputsEnabled', {val: true});
    a.setForeignStateAsync = async (id, val) => writes.push({id, val});
    let failure;
    assert.equal(a.writeForeignStateGuarded('heater', 3000, error => { failure = error; }), true);
    a.stateCache.set('ems.0.System.RealOutputsEnabled', {val: false});
    await Promise.allSettled([...a.pendingForeignWrites]);
    await Promise.resolve();
    assert.equal(writes.length, 0);
    assert.ok(failure);
});

test('foreign write failure is reported to output controller', async () => {
    const a = adapter();
    a.allowedForeignWriteIds.add('heater');
    a.stateCache.set('ems.0.System.RealOutputsEnabled', {val: true});
    a.setForeignStateAsync = async () => { throw new Error('link down'); };
    let failure;
    a.writeForeignStateGuarded('heater', 1000, error => { failure = error; });
    await Promise.allSettled([...a.pendingForeignWrites]);
    await Promise.resolve();
    assert.match(failure.message, /link down/);
});

test('unload drains pending actuator write before final zero and suppresses future callbacks', async () => {
    const a = adapter();
    const writes = [];
    a.allowedForeignWriteIds.add('heater');
    a.stateCache.set('ems.0.System.RealOutputsEnabled', {val: true});
    let completePositive;
    let positiveStarted;
    const started = new Promise(resolve => { positiveStarted = resolve; });
    a.setForeignStateAsync = (id, val) => val > 0 ? new Promise(resolve => {
        completePositive = () => { writes.push(val); resolve(); };
        positiveStarted();
    }) : Promise.resolve(writes.push(val));
    a.getForeignObjectAsync = async () => ({common: {enabled: false}});
    a.wallboxOutput.waitForIdle = async () => {};
    a.wallboxOutput.stopAll = async () => {};
    a.wallboxOutput.hasActiveOwnedOutput = () => false;
    a.engineContext = {};
    a.runEngine = () => a.writeForeignStateGuarded('heater', 0);
    a.writeForeignStateGuarded('heater', 2000);
    await started;
    const unloading = a.prepareUnload();
    assert.equal(a.writeForeignStateGuarded('heater', 5000), false);
    completePositive();
    await unloading;
    assert.deepEqual(writes, [2000, 0]);
});

test('normal safe zero is serialized behind earlier in-flight EHZ command', async () => {
    const a = adapter();
    const completed = [];
    let finishPositive;
    let positiveStarted;
    const started = new Promise(resolve => { positiveStarted = resolve; });
    a.allowedForeignWriteIds.add('heater');
    a.stateCache.set('ems.0.System.RealOutputsEnabled', {val: true});
    a.setForeignStateAsync = async (id, val) => {
        if (val > 0) await new Promise(resolve => { finishPositive = resolve; positiveStarted(); });
        completed.push(val);
    };
    a.writeForeignStateGuarded('heater', 3000);
    await started;
    a.writeForeignStateGuarded('heater', 0);
    assert.equal(completed.length, 0);
    finishPositive();
    await Promise.allSettled([...a.pendingForeignWrites]);
    assert.deepEqual(completed, [3000, 0]);
});

test('early startup failure attempts cleanup and warns about unvalidated inherited outputs', async () => {
    const a = adapter();
    let stopped = false;
    const errors = [];
    a.log.error = message => errors.push(message);
    a.initializeAdapter = async () => { throw new Error('state connection failed'); };
    a.prepareUnload = async options => { assert.equal(options.allowHandoff, false); stopped = true; };
    await a.onReady();
    assert.equal(stopped, true);
    assert.ok(errors.some(message => message.includes('ownership could not yet be validated')));
});

test('startup database and cleanup failure still logs the manual intervention requirement', async () => {
    const a = adapter();
    const errors = [];
    a.log.error = message => errors.push(message);
    a.initializeAdapter = async () => { throw new Error('database unavailable'); };
    a.prepareUnload = async () => { throw new Error('cleanup database unavailable'); };
    a.setStateAsync = async () => { throw new Error('connection database unavailable'); };
    await a.onReady();
    assert.ok(errors.some(message => message.includes('check physical outputs manually')));
    assert.ok(errors.some(message => message.includes('Cannot publish failed connection')));
});

for (const withStop of [false, true]) test(
    `new lower EHZ budget supersedes queued increase and preserves stop=${withStop}`, async () => {
        const a = adapter();
        const completed = [];
        let finishPositive;
        let positiveStarted;
        const started = new Promise(resolve => { positiveStarted = resolve; });
        a.allowedForeignWriteIds.add('heater');
        a.stateCache.set('ems.0.System.RealOutputsEnabled', {val: true});
        a.setForeignStateAsync = async (id, val) => {
            if (val === 1000) await new Promise(resolve => { finishPositive = resolve; positiveStarted(); });
            completed.push(val);
        };
        a.writeForeignStateGuarded('heater', 1000);
        await started;
        a.writeForeignStateGuarded('heater', 6000);
        if (withStop) a.writeForeignStateGuarded('heater', 0);
        a.writeForeignStateGuarded('heater', 3000);
        finishPositive();
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.deepEqual(completed, withStop ? [1000, 0, 3000] : [1000, 3000]);
    });

test('a later safe stop cancels older queued increases before they reach the heater', async () => {
    const a = adapter();
    const completed = [];
    let finishPositive;
    let positiveStarted;
    const started = new Promise(resolve => { positiveStarted = resolve; });
    a.allowedForeignWriteIds.add('heater');
    a.stateCache.set('ems.0.System.RealOutputsEnabled', {val: true});
    a.setForeignStateAsync = async (id, val) => {
        if (val === 3000) await new Promise(resolve => { finishPositive = resolve; positiveStarted(); });
        completed.push(val);
    };
    a.writeForeignStateGuarded('heater', 3000);
    await started;
    a.writeForeignStateGuarded('heater', 6000);
    a.writeForeignStateGuarded('heater', 0);
    finishPositive();
    await Promise.allSettled([...a.pendingForeignWrites]);
    assert.deepEqual(completed, [3000, 0]);
});

test('startup-failure cleanup never prepares restart handoff for an active owned charger', async () => {
    const a = adapter();
    a.config = {globalWriteEnabled: true, controlEnabled: true, wb2Present: true,
        wb2ControlEnabled: true, wb2ProductionArmed: true};
    a.getForeignObjectAsync = async () => ({common: {enabled: true}, native: {...a.config}});
    a.wallboxOutput.devices = [{wb: 2, owned: true}];
    a.wallboxOutput.waitForIdle = async () => {};
    a.wallboxOutput.hasActiveOwnedOutput = () => true;
    let stopped = false;
    a.wallboxOutput.stopAll = async () => { stopped = true; };
    await a.prepareUnload({allowHandoff: false});
    assert.equal(stopped, true);
    assert.equal(a.getCachedState('ems.0.Control.RestartHandoffActive').val, false);
});

test('late history response after unload cannot restart planner or outputs', async () => {
    const a = adapter();
    let response;
    let calls = 0;
    a.sendTo = (instance, command, message, callback) => { response = callback; };
    a.compatSendTo('sql.0', 'getHistory', {}, () => calls++);
    a.unloading = true;
    response({result: []});
    assert.equal(calls, 0);
});

test('real engine startup and shutdown with default configuration never writes an actuator', async () => {
    const a = adapter();
    a.config = JSON.parse(fs.readFileSync(path.join(__dirname, '../io-package.json'))).native;
    const stored = new Map();
    const foreignWrites = [];
    const errors = [];
    a.log.error = message => errors.push(message);
    a.preloadStates = async () => {};
    a.setStateAsync = async (id, value, ack) => stored.set(id,
        typeof value === 'object' && value !== null ? {...value}
            : {val: value, ack: Boolean(ack), ts: Date.now()});
    a.getStateAsync = async id => stored.get(id) || null;
    a.getForeignStateAsync = async () => null;
    a.getForeignObjectAsync = async () => null;
    a.subscribeForeignStatesAsync = async () => {};
    a.setForeignStateAsync = async (id, value) => foreignWrites.push({id, value});
    await a.onReady();
    assert.equal(stored.get('info.connection').val, true, errors.join('\n'));
    assert.equal(a.getCachedState('ems.0.System.RealOutputsEnabled').val, false);
    assert.equal(a.getCachedState('ems.0.Plan.Valid').val, false);
    assert.equal(a.wallboxOutput.ready, true);
    await a.prepareUnload({allowHandoff: false});
    assert.equal(foreignWrites.length, 0);
    assert.equal(errors.length, 0, errors.join('\n'));
});
