'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createEngineContext, MODULES} = require('../lib/engine-loader');
const allocation = require('../lib/wallbox-allocation');
const grid = require('../lib/grid-constraints');

test('production engine contexts retain module order, isolated state and no implicit bootstrap', () => {
    assert.deepEqual(MODULES, ['core', 'config-mapping', 'history', 'prices', 'forecast', 'vehicles',
        'dhw-controller', 'battery-controller', 'heating-controller', 'heatpump-controller',
        'energy-coordination', 'grid-operator-control', 'planner', 'observer', 'realtime', 'dhw-output']);
    assert.ok(Object.isFrozen(MODULES));
    const sandbox = {nativeConfig: {}, Date: class extends Date {static now() {return 2000000;}},
        getState: () => null, existsState: () => false,
        setState: () => assert.fail('loading modules wrote a state'),
        schedule: () => assert.fail('loading modules scheduled work'),
        setTimeout: () => assert.fail('loading modules started a timer')};
    const first = createEngineContext('ems.0', {DP_WB0_MIN_SOC: "sensor.'quoted\\path"}, sandbox);
    const second = createEngineContext('other.0', {}, sandbox);
    assert.equal(vm.runInContext('CFG.dp.wallboxMinSoc[0]', first), "sensor.'quoted\\path");
    assert.equal(vm.runInContext('CFG.root', second), 'other.0');
    assert.equal(first.wallboxAllocationPolicy, allocation);
    vm.runInContext('slowTargets.wallboxA[0] = 13; lastSlowUpdate = 1234;', first);
    assert.equal(vm.runInContext('slowTargets.wallboxA[0]', second), 0);
    assert.equal(vm.runInContext('lastSlowUpdate', second), 0);
    assert.equal(Object.getOwnPropertyDescriptor(first, 'SMA_GRID_MAX_AGE_MS').writable, false);
});

test('allocation reads settings lazily and leaves the caller inputs untouched', () => {
    const reads = [];
    const dependencies = {readSetting: (key, fallback) => {reads.push(key); return fallback;},
        pvImportAdmissionW: grid.pvImportAdmissionW};
    const vehicle = Object.freeze({phaseSwitchEnabled: true, maximumPhases: 3,
        minCurrent1pA: 6, maxCurrent1pA: 16, minCurrent3pA: 6, maxCurrent3pA: 16, maximumPowerW: 11040});
    const options = Object.freeze({});
    assert.equal(allocation.quantizeWallbox(0, vehicle, 0, 1, null, options, dependencies).amps, 0);
    assert.deepEqual(reads, ['Config.WallboxNominalVoltage_V']);
    reads.length = 0;
    const result = allocation.quantizeWallbox(1450, vehicle, 6, 1, 1380, options, dependencies);
    assert.equal(result.amps, 6);
    assert.equal(result.diagnostics.responseBasis, 'power-response');
    assert.deepEqual(reads, ['Config.WallboxNominalVoltage_V', 'Config.WallboxMaxStep_A', 'Control.Deadband_W']);
});
