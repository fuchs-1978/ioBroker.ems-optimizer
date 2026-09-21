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
    assert.ok(steps.indexOf('native') < steps.indexOf('updateVehicles(); updateDhwSimulation(); updateHeatingSimulation(); observe();'));
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
    a.runEngine = source => source.includes('stopDhwOutput') && a.writeForeignStateGuarded('heater', 0);
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
    await a.debugInitialization;
    assert.equal(stored.get('info.connection').val, true, errors.join('\n'));
    assert.equal(a.getCachedState('ems.0.System.RealOutputsEnabled').val, false);
    assert.equal(a.getCachedState('ems.0.Plan.Valid').val, false);
    assert.equal(a.wallboxOutput.ready, true);
    for (const suffix of ['Control.FineRegulator', 'Devices.Battery.OutputSetpointId',
        'Devices.MyPV_Heating.OutputSetpointId', 'Devices.HeatPump.RequestedMode'])
        assert.ok(a.knownObjects.has(`ems.0.${suffix}`), `Missing engine object ${suffix}`);
    await a.prepareUnload({allowHandoff: false});
    assert.equal(foreignWrites.length, 0);
    assert.equal(errors.length, 0, errors.join('\n'));
});

function extensionOutput(device = 'Battery') {
    const a = adapter();
    const prefix = device === 'Battery' ? 'battery' : device === 'MyPV_DHW' ? 'dhw' : 'heating';
    const id = device === 'Battery' ? 'sunenergyxt500.0.heads.1.control.GS'
        : device === 'MyPV_DHW' ? 'modbus.4.power' : 'modbus.5.power';
    Object.assign(a.config, {[`${prefix}SetpointId`]: id, [`${prefix}Present`]: true,
        [`${prefix}ControlEnabled`]: true, [`${prefix}ProductionArmed`]: true});
    a.allowedForeignWriteIds.add(id);
    a.stateCache.set('ems.0.System.RealOutputsEnabled', {val: true});
    for (const name of ['Present', 'ControlEnabled', 'DriverReady', 'OutputOwned', 'Release'])
        a.stateCache.set(`ems.0.Devices.${device}.${name}`, {val: true});
    a.stateCache.set(`ems.0.Devices.${device}.OutputSetpointId`, {val: id});
    a.engineContext = {};
    const physical = device === 'Battery' ? {eligible: true, canCharge: true, canDischarge: true,
        maxChargeW: 2400, maxDischargeW: 2400, reason: 'ready'} : {release: true, thermalCapW: 6000};
    const electrical = {allowed: true, reason: 'ready'};
    a.runEngine = source => source.includes('checkQueuedElectricalOutput') ? electrical : physical;
    const writes = [];
    a.setForeignStateAsync = async (target, value) => writes.push({target, value});
    return {a, id, physical, electrical, writes};
}

for (const value of [-100, 100]) {
    test(`signed GS ${value} respects durable ownership and global output gates`, async () => {
        const {a, id, writes} = extensionOutput();
        let persist;
        const pending = new Promise(resolve => { persist = resolve; });
        a.pendingOwnWrites.set('ems.0.Devices.Battery.OutputOwned', pending);
        assert.equal(a.writeForeignStateGuarded(id, value), true);
        await Promise.resolve();
        assert.equal(writes.length, 0);
        persist();
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.deepEqual(writes.map(write => write.value), [value]);
        a.config.globalWriteEnabled = false;
        assert.equal(a.writeForeignStateGuarded(id, value), false);
        assert.equal(a.writeForeignStateGuarded(id, 0), true);
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.deepEqual(writes.map(write => write.value), [value, 0]);
    });
    test(`queued GS ${value} rechecks SoC direction and magnitude`, async () => {
        for (const change of ['direction', 'cap', 'driver']) {
            const {a, id, physical, writes} = extensionOutput();
            a.writeForeignStateGuarded(id, value);
            if (change === 'direction') physical[value < 0 ? 'canCharge' : 'canDischarge'] = false;
            if (change === 'cap') physical[value < 0 ? 'maxChargeW' : 'maxDischargeW'] = 50;
            if (change === 'driver') a.stateCache.set('ems.0.Devices.Battery.DriverReady', {val: false});
            await Promise.allSettled([...a.pendingForeignWrites]);
            assert.equal(writes.length, 0, change);
        }
    });
}

test('failed ownership persistence blocks an actuator even if cache already reports ownership', async () => {
    const {a, id, writes} = extensionOutput();
    let fail;
    const pending = new Promise((resolve, reject) => { fail = reject; });
    a.pendingOwnWrites.set('ems.0.Devices.Battery.OutputOwned', pending);
    a.writeForeignStateGuarded(id, -100);
    fail(new Error('database failure'));
    a.pendingOwnWrites.delete('ems.0.Devices.Battery.OutputOwned');
    await Promise.allSettled([...a.pendingForeignWrites]);
    assert.equal(writes.length, 0);
});

for (const device of ['Battery', 'MyPV_DHW', 'MyPV_Heating']) {
    test(`${device} cannot forget failed durable reservation on a later retry`, async () => {
        const {a, id, writes} = extensionOutput(device);
        const key = `ems.0.Devices.${device}.${device === 'Battery'
            ? 'OutputReservedCharge_W' : 'OutputReservedPhase1_W'}`;
        a.setStateAsync = async () => { throw new Error('reservation database unavailable'); };
        await assert.rejects(a.setCompatState(key, 100));
        await Promise.resolve();
        assert.equal(a.pendingOwnWrites.has(key), false);
        assert.equal(a.getCachedState(key).val, 100);
        a.writeForeignStateGuarded(id, device === 'Battery' ? -100 : 100);
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.equal(writes.length, 0);
        a.setStateAsync = async () => {};
        await a.setCompatState(key, 100);
        a.writeForeignStateGuarded(id, device === 'Battery' ? -100 : 100);
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.equal(writes.length, 1);
    });
    test(`${device} waits for persisted high-water reserve before sending any nonzero`, async () => {
        const {a, id, writes} = extensionOutput(device);
        const key = `ems.0.Devices.${device}.${device === 'Battery'
            ? 'OutputUnobservedCommand_W' : 'OutputReservationState_JSON'}`;
        let persist;
        a.pendingOwnWrites.set(key, new Promise(resolve => { persist = resolve; }));
        a.writeForeignStateGuarded(id, 100);
        await Promise.resolve();
        assert.equal(writes.length, 0);
        persist();
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.equal(writes.length, 1);
    });
    test(`${device} rechecks electrical limits after waiting for durable output state`, async () => {
        const {a, id, writes, electrical} = extensionOutput(device);
        let persist;
        a.pendingOwnWrites.set(`ems.0.Devices.${device}.OutputOwned`,
            new Promise(resolve => { persist = resolve; }));
        a.writeForeignStateGuarded(id, 100);
        await Promise.resolve();
        electrical.allowed = false;
        electrical.reason = 'Netzbetreiberlimit oder Hausanschluss hat sich geaendert';
        persist();
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.equal(writes.length, 0);
    });
}

test('surrounding Admin whitespace cannot bypass device-specific queued output guards', async () => {
    for (const device of ['Battery', 'MyPV_Heating']) {
        const {a, id, writes} = extensionOutput(device);
        a.config[device === 'Battery' ? 'batterySetpointId' : 'heatingSetpointId'] = ` ${id} `;
        a.writeForeignStateGuarded(id, 100);
        a.stateCache.set(`ems.0.Devices.${device}.DriverReady`, {val: false});
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.equal(writes.length, 0);
    }
});

test('queued heating write rechecks actual cooling permission and reduced thermal cap', async () => {
    for (const change of ['cooling', 'cap', 'inhibit']) {
        const {a, id, physical, writes} = extensionOutput('MyPV_Heating');
        a.writeForeignStateGuarded(id, 3000);
        if (change === 'cooling') physical.release = false;
        if (change === 'cap') physical.thermalCapW = 1000;
        if (change === 'inhibit') a.stateCache.set('ems.0.Config.HeatingInhibit', {val: true});
        await Promise.allSettled([...a.pendingForeignWrites]);
        assert.equal(writes.length, 0, change);
    }
});

test('former actuator target only accepts zero and other outputs reject negative watts', async () => {
    const {a, id, writes} = extensionOutput();
    a.zeroOnlyForeignWriteIds.add(id);
    assert.equal(a.writeForeignStateGuarded(id, -100), false);
    assert.equal(a.writeForeignStateGuarded(id, 100), false);
    a.unloading = true;
    assert.equal(a.writeForeignStateGuarded(id, 0), true);
    await Promise.allSettled([...a.pendingForeignWrites]);
    assert.equal(writes.length, 1);
    const heater = extensionOutput('MyPV_Heating');
    assert.equal(heater.a.writeForeignStateGuarded(heater.id, -100), false);
});

test('a broken stop callback cannot skip other owned outputs during unload', async () => {
    const a = adapter();
    a.engineContext = {};
    const calls = [];
    a.runEngine = source => {
        calls.push(source);
        if (source.includes('stopDhwOutput')) throw new Error('broken heater cleanup');
    };
    a.wallboxOutput.waitForIdle = async () => {};
    a.wallboxOutput.stopAll = async () => {};
    a.getForeignObjectAsync = async () => null;
    await a.prepareUnload({allowHandoff: false});
    for (const name of ['stopDhwOutput', 'stopBatteryOutput', 'stopHeatingOutput', 'stopHeatPumpOutput'])
        assert.ok(calls.some(source => source.includes(name)), name);
});

test('a stalled battery write cannot defer independent heater and wallbox stop requests', async () => {
    const a = adapter();
    let finishBattery;
    a.pendingForeignWrites.add(new Promise(resolve => { finishBattery = resolve; }));
    a.engineContext = {};
    const stopped = [];
    a.runEngine = source => stopped.push(source);
    a.wallboxOutput.waitForIdle = async () => {};
    a.wallboxOutput.stopAll = async () => stopped.push('wallboxes');
    a.getForeignObjectAsync = async () => null;
    const unloading = a.prepareUnload({allowHandoff: false});
    for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    assert.ok(stopped.some(source => source.includes('stopDhwOutput')));
    assert.ok(stopped.some(source => source.includes('stopHeatingOutput')));
    assert.ok(stopped.includes('wallboxes'));
    finishBattery();
    await unloading;
});

test('debug capture failures never reject control writes and warnings are rate limited', async () => {
    const a = adapter();
    const warnings = [];
    a.log.warn = message => warnings.push(message);
    a.debugRecorder.capture = () => { throw new Error('diagnostic snapshot failed'); };
    await a.setCompatState('ems.0.Control.Valid', true);
    await a.setCompatState('ems.0.Control.Valid', false);
    assert.equal(a.getCachedState('ems.0.Control.Valid').val, false);
    assert.equal(warnings.length, 1);
});

test('debug persistence failure is excluded from critical own-state flush', async () => {
    const a = adapter();
    a.setStateAsync = async id => {
        if (id.startsWith('Debug.')) throw new Error('diagnostic storage unavailable');
    };
    const debug = a.setCompatState('ems.0.Debug.Snapshot_JSON', '{}').catch(() => {});
    a.setCompatState('ems.0.Control.Valid', true);
    await a.flushOwnWrites();
    await debug;
    assert.equal(a.getCachedState('ems.0.Control.Valid').val, true);
});

test('a failing diagnostic logger cannot propagate into a control write', async () => {
    const a = adapter();
    a.debugRecorder.capture = () => { throw new Error('snapshot failed'); };
    a.log.warn = () => { throw new Error('logger unavailable'); };
    await a.setCompatState('ems.0.Control.Valid', true);
    assert.equal(a.getCachedState('ems.0.Control.Valid').val, true);
});

test('debug publication does not recursively capture its own data', async () => {
    const a = adapter();
    let captures = 0;
    a.debugRecorder.capture = () => captures++;
    await a.setCompatState('ems.0.Debug.Summary', 'Bereit');
    assert.equal(captures, 0);
    await a.setCompatState('ems.0.Control.SelectedWallbox', 2);
    assert.equal(captures, 1);
});

test('debug commands are handled without running control listeners', () => {
    const a = adapter();
    const id = 'ems.0.Debug.Clear';
    let captures = 0;
    let listeners = 0;
    a.debugRecorder.handleCommand = (changedId, state) => changedId === id && state.ack === false;
    a.debugRecorder.capture = () => captures++;
    a.listeners.push({ids: new Set([id]), change: 'any', callback: () => listeners++});
    a.onStateChange(id, {val: true, ack: false, ts: Date.now()});
    assert.equal(captures, 0);
    assert.equal(listeners, 0);
});

test('debug initialization completing after unload cannot restart sampling', async () => {
    const a = adapter();
    let finish;
    let sampled = 0;
    let scheduled = 0;
    a.debugRecorder.initialize = () => new Promise(resolve => { finish = resolve; });
    a.debugRecorder.sample = () => sampled++;
    a.registerSchedule = () => scheduled++;
    const starting = a.startDebug();
    a.unloading = true;
    finish();
    await starting;
    assert.equal(sampled, 0);
    assert.equal(scheduled, 0);
});

test('debug initialization failure is optional and never installs a sampling job', async () => {
    const a = adapter();
    let scheduled = 0;
    const warnings = [];
    a.log.warn = message => warnings.push(message);
    a.debugRecorder.initialize = async () => { throw new Error('debug objects unavailable'); };
    a.registerSchedule = () => scheduled++;
    await a.startDebug();
    assert.equal(scheduled, 0);
    assert.equal(warnings.length, 1);
});

test('shutdown never waits indefinitely for optional debug persistence', async () => {
    const a = adapter();
    a.pendingOwnWrites.set('ems.0.Debug.Events_JSON', new Promise(() => {}));
    const started = Date.now();
    await a.flushDebugWrites();
    assert.ok(Date.now() - started < 1500);
});

test('bounded shutdown drain includes the final coalesced diagnostic replacement', async () => {
    const a = adapter();
    const stored = [];
    let finishOld;
    let started;
    const starting = new Promise(resolve => { started = resolve; });
    a.setStateAsync = async (id, state) => {
        if (state.val === 'old') await new Promise(resolve => { finishOld = resolve; started(); });
        else await new Promise(resolve => setTimeout(resolve, 10));
        stored.push(state.val);
    };
    a.debugRecorder.publish('Events_JSON', 'old');
    await starting;
    a.debugRecorder.publish('Events_JSON', 'final');
    const flushing = a.flushDebugWrites();
    finishOld();
    await flushing;
    assert.deepEqual(stored, ['old', 'final']);
});

test('real Debug.Clear is acknowledged again when pressed during an older reset write', async () => {
    const a = adapter();
    await a.debugRecorder.initialize();
    await a.flushDebugWrites();
    let finishOld;
    let started;
    let writes = 0;
    const starting = new Promise(resolve => { started = resolve; });
    a.setStateAsync = async id => {
        if (id === 'Debug.Clear' && ++writes === 1)
            await new Promise(resolve => { finishOld = resolve; started(); });
    };
    a.debugRecorder.lastPublished.delete('Clear');
    a.debugRecorder.publish('Clear', false);
    await starting;
    a.onStateChange('ems.0.Debug.Clear', {val: true, ack: false, ts: Date.now()});
    assert.equal(a.getCachedState('ems.0.Debug.Clear').ack, false);
    finishOld();
    await a.flushDebugWrites();
    assert.equal(a.getCachedState('ems.0.Debug.Clear').val, false);
    assert.equal(a.getCachedState('ems.0.Debug.Clear').ack, true);
    assert.equal(a.getCachedState('ems.0.System.RealOutputsEnabled'), null);
});
