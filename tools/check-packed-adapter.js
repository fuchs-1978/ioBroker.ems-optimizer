'use strict';

// Install the real tarball into an empty project. Never connect to ioBroker.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-packed-'));
const npm = (args, cwd) => execFileSync('npm', args, {cwd, encoding: 'utf8',
    env: {...process.env, npm_config_update_notifier: 'false'}});
try {
    const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', directory], root))[0];
    assert.ok(packed.files.some(file => file.path === 'lib/wallbox-allocation.js'));
    assert.ok(packed.files.some(file => file.path === 'lib/wallbox-source-diagnostics.js'));
    assert.ok(packed.files.some(file => file.path === 'lib/grid-operator-accounting.js'));
    assert.ok(!packed.files.some(file => /^(test|node_modules|\.github)\//.test(file.path)));
    fs.writeFileSync(path.join(directory, 'package.json'), '{"name":"ems-artifact-check","private":true}');
    npm(['install', '--omit=dev', '--package-lock=false', '--no-audit', '--no-fund',
        path.join(directory, packed.filename)], directory);
    const installed = path.join(directory, 'node_modules', 'iobroker.ems-optimizer');
    const localRequire = createRequire(path.join(installed, 'package.json'));
    assert.equal(localRequire('./package.json').version, packed.version);
    assert.equal(localRequire('./io-package.json').common.version, packed.version);
    assert.equal(typeof localRequire('node-schedule').scheduleJob, 'function');
    assert.ok(localRequire.resolve('@iobroker/adapter-core'));
    // Exercise the new pure core from the installed package, independently of
    // the deliberately unchanged production loader and output controllers.
    const accounting = localRequire('./lib/grid-operator-accounting');
    const reading = (id, val) => ({id, boundaryId: 'site', unit: 'W', scope: 'total-ac',
        state: {val, ts: 2000000, ack: true, q: 0}});
    const core = accounting.evaluateGroupAccounting({mode: 'groupNet', now: 2000000,
        limit: {valid: true, active: true, budgetW: 4200, groupId: 'group', boundaryId: 'site'},
        group: {id: 'group', boundaryId: 'site', participants: [{id: 'ev', deviceId: 'Wallbox0'}]},
        site: {import: reading('import', 1000), export: reading('export', 0)},
        participantMeters: [{...reading('ev', 3000), participantIds: ['ev']}],
        storage: {coverage: 'none', meters: []},
        devices: [{id: 'Wallbox0', participantId: 'ev', measurement: reading('ev', 3000),
            commandW: 3000, reservedW: 3000}]});
    assert.equal(core.valid, true);
    assert.equal(core.actualGroupNetW, 1000);
    assert.equal(core.grossBudgetW, 6200);
    assert.equal(accounting.reserveGroupCommands(core, {Wallbox0: 6201}).allowed, false);
    const states = new Map();
    const loader = localRequire('./lib/engine-loader');
    const context = loader.createEngineContext('ems.0', {}, {
        nativeConfig: {}, console,
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => {if (!states.has(id)) states.set(id, {val, ack: true, ts: 2000000});},
        setState: (id, val) => states.set(id, {val, ack: true, ts: 2000000}),
        log() {}, sendTo() {},
        writeForeignState() {assert.fail('artifact check attempted a foreign write');},
        gridConstraints: localRequire('./lib/grid-constraints')
    });
    vm.runInContext('createStates(); createBatteryStates(); createHeatingStates(); createHeatPumpStates(); createEnergyCoordinationStates()', context);
    assert.ok(states.size > 100);
    assert.equal(vm.runInContext('splitRealtimePair(6000, 9000, 7360, 50).wallboxW', context), 3000);
    assert.equal(vm.runInContext('quantizeWallbox(1380, {phaseSwitchEnabled:false, maximumPhases:1, minCurrent1pA:6, maxCurrent1pA:16, maximumPowerW:3680}, 0).amps', context), 6);
    assert.equal(typeof localRequire('./lib/wallbox-output'), 'function');
    const module = {exports: {}};
    // The controller is intentionally absent. Verify the installed entry point
    // using only an Adapter constructor; no ready event, schedules or I/O run.
    class Adapter { constructor() {this.config = {}; this.namespace = 'ems.0';} on() {} }
    vm.runInNewContext(fs.readFileSync(path.join(installed, 'main.js'), 'utf8'), {
        module, __dirname: installed, console, setTimeout, clearTimeout,
        require: name => name === '@iobroker/adapter-core' ? {Adapter} : localRequire(name)
    });
    assert.equal(typeof module.exports, 'function');
    assert.ok(module.exports());
    console.log(JSON.stringify({node: process.version, version: localRequire('./package.json').version,
        files: packed.files.length, states: states.size, installedTarball: true}));
} finally {
    fs.rmSync(directory, {recursive: true, force: true});
}
