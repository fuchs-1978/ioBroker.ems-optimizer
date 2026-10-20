'use strict';

// Explicit bug-fix contracts, separate from compare-refactor.js's unchanged
// historical traces. Both workers receive this same fixture and fixed clock;
// each resolves the production modules from its own checkout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const BASE = '25fd38b4e5a3568a6d1aeefda5277c94397c7e91';
const root = path.resolve(__dirname, '..');

function fixture(tree) {
    const source = fs.readFileSync(path.join(root, 'test/wallbox-output.test.js'), 'utf8');
    const firstTest = source.indexOf("\ntest('default/unarmed wallbox");
    assert.ok(firstTest > 0, 'wallbox setup fixture must be found');
    const filename = path.join(tree, 'test/intentional-fixes-fixture.js');
    const module = new Module(filename);
    module.filename = filename;
    module.paths = Module._nodeModulePaths(path.dirname(filename));
    module._compile(source.slice(0, firstTest) + '\nmodule.exports = setup;\n', filename);
    return module.exports;
}

function summary(name, trace, contract) {
    return {scenario: name, events: trace.length,
        sha256: createHash('sha256').update(JSON.stringify(trace)).digest('hex'), contract};
}

async function worker(tree, fixed) {
    const setup = fixture(tree);
    const results = [], unchanged = [];
    function harness(config = {}) {
        let now = 1000000000000;
        const h = setup({now: () => now});
        Object.assign(h.config, config);
        const trace = [];
        const originalSet = h.states.set;
        h.states.set = function(id, state) {
            trace.push({kind: 'state', at: now, id, state: {...state}});
            return originalSet.call(this, id, state);
        };
        const originalWrite = h.adapter.setForeignStateAsync;
        h.adapter.setForeignStateAsync = async (id, val) => {
            trace.push({kind: 'command', at: now, id, val});
            return originalWrite(id, val);
        };
        const snapshot = label => {
            const d = h.output.devices[0];
            const result = {label, at: now, writes: h.writes.map(write => ({...write})),
                device: JSON.parse(JSON.stringify({pending: d.pending, response: d.response,
                    lastA: d.lastA, lastAt: d.lastAt, activeSince: d.activeSince,
                    owned: d.owned, fault: d.fault, confirmedPhases: d.confirmedPhases,
                    phasePreviousPhases: d.phasePreviousPhases, phaseTransitionUntil: d.phaseTransitionUntil})),
                states: [...h.states].map(([id, state]) => [id, {...state}])};
            trace.push({kind: 'checkpoint', ...result});
            return result;
        };
        return {h, trace, snapshot, now: () => now,
            advance: ms => {now += ms; h.refresh();}};
    }

    // The ordinary on-time case and rejected late/missing/invalid ACK cases
    // remain byte-for-byte equal. Only timely processing after the deadline
    // is intentionally different.
    for (const mode of ['on-time', 'timely-delayed', 'late', 'missing', 'wrong-value', 'bad-quality', 'unacknowledged', 'stale']) {
        const a = harness();
        const {h} = a;
        await h.start();
        const d = h.output.devices[0];
        a.advance(6000); h.put('i1', 6); h.put('power', 1.38);
        await h.output.tick();
        const issuedAt = a.now();
        assert.equal(d.pending.stage, 'current');
        assert.equal(d.pending.start, false);
        assert.equal(d.pending.amps, 12);
        a.snapshot('12A issued');
        a.advance(mode === 'late' ? 20500 : 1000);
        if (mode !== 'missing') h.ack('feedback', mode === 'wrong-value' ? 11 : 12);
        h.put('i1', 12); h.put('power', 2.76);
        const feedback = {...h.states.get('feedback')};
        if (mode === 'bad-quality') feedback.q = 64;
        if (mode === 'unacknowledged') feedback.ack = false;
        if (mode === 'stale') feedback.ts = issuedAt - 31000;
        if (mode !== 'on-time') {
            a.advance(issuedAt + 21000 - a.now());
        }
        h.states.set('feedback', feedback);
        h.writes.length = 0;
        await h.output.tick();
        const final = a.snapshot('ACK evaluated');
        const changed = mode === 'timely-delayed';
        if (mode === 'on-time' || (changed && fixed)) {
            assert.equal(d.fault, '');
            assert.equal(d.pending, null);
            assert.equal(d.response, null);
            assert.equal(d.lastA, 12);
            assert.deepEqual(h.writes, []);
            assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'confirmed');
            assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt').val, issuedAt + 1001);
        } else {
            assert.match(d.fault, /Keine passende go-e-Rueckmeldung/);
            assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
        }
        const name = `current-ack-${mode}`;
        if (!changed) unchanged.push({scenario: name, trace: a.trace});
        results.push(summary(name, a.trace, {changed, writes: final.writes,
            fault: d.fault, pending: d.pending, lastA: d.lastA}));
    }

    // A script's mode ACK is not proof that L2/L3 have electrically stopped.
    // Use the exact same post-mode 3P samples on each tree, including the
    // original 16A/11,040W reproduction that used to issue an 18A request.
    {
        const a = harness({wb0PhaseSwitchEnabled: true, wb0PhaseControlMode: 'script',
            wb0PhaseModeId: 'phaseMode', wb0MaxCurrent3pA: 16, wb0MaxPowerW: 11040});
        const {h} = a;
        h.put('phaseMode', 2); h.put('ems.0.Control.Targets.Wallbox0_Phases', 3);
        await h.start();
        const d = h.output.devices[0];
        a.advance(1000);
        for (const phase of [1, 2, 3]) h.put(`i${phase}`, 6);
        h.put('power', 4.14);
        await h.output.tick(); a.snapshot('3P6A running');
        a.advance(6000);
        h.put('phaseMode', 1); h.put('ems.0.Control.Targets.Wallbox0_Phases', 1);
        h.writes.length = 0;
        await h.output.tick();
        const modeAck = a.snapshot('1P mode ACK with 3P6A electrical draw');
        const modeReserve = h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val;
        if (fixed) {
            assert.ok(modeReserve >= 4140, 'mode ACK alone must retain old3P reserve');
            assert.ok(d.response?.phaseChange, 'electrical phase proof must remain pending');
            assert.deepEqual(h.writes, [], 'mode ACK alone must not earn a current increase');
        } else {
            assert.deepEqual(h.writes, [{id: 'cmd', val: 12}]);
            assert.equal(modeReserve, 2760);
        }
        a.advance(1000); h.ack('feedback', 12);
        for (const phase of [1, 2, 3]) h.put(`i${phase}`, 12);
        h.put('power', 8.28);
        await h.output.tick();
        const externalChange = a.snapshot('post-mode 3P12A electrical draw');
        a.advance(6000); h.writes.length = 0;
        await h.output.tick();
        const final = a.snapshot('next ramp opportunity');
        const finalReserve = h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val;
        if (fixed) {
            assert.ok(!h.writes.some(write => write.id === 'cmd' && write.val > 16));
            assert.ok(finalReserve >= 8280, 'fresh old-topology draw must remain reserved');
            assert.deepEqual(externalChange.writes, [{id: 'allow', val: 0}],
                '12A was never requested by this controller; its external-change stop must remain effective');
            assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,
                /Sollstrom-Rueckmeldung widerspruechlich/);
        } else {
            assert.deepEqual(h.writes, [{id: 'cmd', val: 18}]);
            assert.equal(finalReserve, 4140);
        }
        results.push(summary('script-mode-ACK-does-not-confirm-electrical-1P', a.trace,
            {changed: true, modeAckWrites: modeAck.writes, modeReserve,
                externalChangeWrites: externalChange.writes,
                finalWrites: final.writes, finalReserve, response: d.response, fault: d.fault}));
    }

    // The phase guard must also complete. Keep current at the actual6A
    // command, then supply a fresh1P power/current pair after the mode ACK.
    {
        const a = harness({wb0PhaseSwitchEnabled: true, wb0PhaseControlMode: 'script',
            wb0PhaseModeId: 'phaseMode', wb0MaxCurrent3pA: 16, wb0MaxPowerW: 11040});
        const {h} = a;
        h.put('phaseMode', 2); h.put('ems.0.Control.Targets.Wallbox0_Phases', 3);
        await h.start();
        const d = h.output.devices[0], sessionAt = d.activeSince;
        a.advance(1000);
        for (const phase of [1, 2, 3]) h.put(`i${phase}`, 6);
        h.put('power', 4.14);
        await h.output.tick();
        a.advance(6000);
        h.put('phaseMode', 1); h.put('ems.0.Control.Targets.Wallbox0_Phases', 1);
        h.writes.length = 0;
        await h.output.tick(); a.snapshot('mode ACK before real1P response');
        a.advance(1000);
        h.ack('feedback', 6); h.put('i1', 6); h.put('i2', 0); h.put('i3', 0);
        h.put('power', 1.38); h.put('ems.0.Control.Targets.Wallbox0_W', 4140);
        await h.output.tick(); a.snapshot('fresh actual1P response');
        const responseAfterProof = h.states.get('ems.0.Devices.Wallbox0.ResponseState').val;
        if (fixed) {
            assert.equal(d.response, null);
            assert.equal(d.pending, null);
            assert.equal(responseAfterProof, 'confirmed');
            assert.deepEqual(h.writes, []);
        } else {
            assert.equal(d.pending.amps, 12);
            assert.equal(d.response.amps, 12);
            assert.notEqual(responseAfterProof, 'confirmed');
            assert.deepEqual(h.writes, [{id: 'cmd', val: 12}]);
        }
        await h.output.tick(); a.snapshot('after electrical proof');
        assert.equal(d.fault, '');
        assert.equal(d.activeSince, sessionAt, 'electrical proof must not create a new session');
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputPhases').val, 1);
        assert.deepEqual(h.writes, [{id: 'cmd', val: 12}]);
        assert.ok(!h.writes.some(write => write.id === 'allow'));
        results.push(summary('script-phase-completes-after-fresh-electrical-1P', a.trace,
            {changed: true, responseAfterProof, writes: h.writes, activeSince: d.activeSince,
                pending: d.pending, response: d.response}));
    }

    const {createEngineContext} = require(path.join(tree, 'lib/engine-loader'));
    const {buildNativeMapping} = require(path.join(tree, 'lib/native-mapping'));
    for (const id of ['mqtt.0.grid.normal', 'mqtt.0.grid.$&', 'mqtt.0.grid.$$']) {
        const now = 2000000;
        const states = new Map([[id, {val: 1200, ack: true, ts: now}],
            ['mqtt.0.export', {val: 0, ack: true, ts: now}]]);
        const config = {gridImportId: id, gridExportId: 'mqtt.0.export'};
        const context = createEngineContext('ems.0', buildNativeMapping(config), {
            Date: class extends Date {static now() {return now;}}, nativeConfig: config,
            getState: key => states.get(key), existsState: key => states.has(key)});
        const observed = JSON.parse(JSON.stringify(vm.runInContext(
            '({id:CFG.dp.gridImport,measurement:realtimeGridMeasurement()})', context)));
        const changed = id.includes('$');
        if (!changed || fixed) {
            assert.equal(observed.id, id);
            assert.equal(observed.measurement.valid, true);
            assert.equal(observed.measurement.gridW, 1200);
            assert.deepEqual(observed.measurement.invalid, []);
        } else {
            assert.equal(observed.id, id.includes('$&') ? 'mqtt.0.grid.__DP_GRID_IMPORT__' : 'mqtt.0.grid.$');
            assert.equal(observed.measurement.valid, false);
            assert.equal(observed.measurement.gridW, 0);
            assert.deepEqual(observed.measurement.invalid, [`${observed.id}: fehlt`]);
        }
        if (!changed) unchanged.push({scenario: 'ordinary-data-point-ID', observed});
        results.push(summary(`literal-ID:${id}`, [observed], {changed, ...observed}));
    }
    return {node: process.version, results, unchanged};
}

async function main() {
    if (process.argv[2] === '--worker') {
        const report = await worker(path.resolve(process.argv[3]), process.argv[4] === 'fixed');
        fs.writeFileSync(process.argv[5], JSON.stringify(report) + '\n');
        return;
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-intentional-fixes-'));
    try {
        const baseline = path.join(directory, 'baseline'); fs.mkdirSync(baseline);
        const archive = execFileSync('git', ['archive', BASE], {cwd: root, maxBuffer: 32 * 1024 * 1024});
        execFileSync('tar', ['-x', '-C', baseline], {input: archive});
        fs.symlinkSync(path.join(root, 'node_modules'), path.join(baseline, 'node_modules'), 'dir');
        const reports = [];
        for (const [name, tree, contract] of [['before', baseline, 'legacy'], ['after', root, 'fixed']]) {
            const report = path.join(directory, name + '.json');
            execFileSync(process.execPath, [__filename, '--worker', tree, contract, report], {stdio: 'inherit'});
            reports.push(JSON.parse(fs.readFileSync(report, 'utf8')));
        }
        assert.deepEqual(reports[1].unchanged, reports[0].unchanged,
            'ordinary IDs and on-time/rejected ACK contracts must remain byte exact');
        assert.deepEqual(reports[1].results.map(result => result.scenario),
            reports[0].results.map(result => result.scenario));
        for (let index = 0; index < reports[0].results.length; index++) {
            if (reports[1].results[index].contract.changed)
                assert.notEqual(reports[1].results[index].sha256, reports[0].results[index].sha256);
        }
        console.log(JSON.stringify({baseline: BASE, node: process.version,
            before: reports[0].results, after: reports[1].results,
            unchangedContracts: reports[1].unchanged.map(item => item.scenario)}, null, 2));
    } finally {fs.rmSync(directory, {recursive: true, force: true});}
}

main().catch(error => {console.error(error); process.exitCode = 1;});
