'use strict';

// Differential replay against an immutable Git commit, using identical input
// fixtures in separate processes. Nothing connects to an ioBroker installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const BASE = '9585b276c75c3ed79634204ba8318166e577dc44';
const root = path.resolve(__dirname, '..');

function compile(source, filename, properties = {}) {
    const module = new Module(filename);
    module.filename = filename;
    module.paths = Module._nodeModulePaths(path.dirname(filename));
    Object.assign(module, properties);
    module._compile(source, filename);
    return module.exports;
}

async function worker(tree) {
    // Entropy and monotonic timing are inputs too. Supply identical values
    // before loading recorder/delivery modules; never erase diagnostic fields.
    let uuid = 0, monotonic = 0;
    require('node:crypto').randomUUID = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;
    Object.defineProperty(performance, 'now', {configurable: true, value: () => ++monotonic});
    let hash, eventCount, scenario;
    const results = [];
    // Preserve values JSON would otherwise collapse (e.g. NaN/null, -0/0,
    // absent/explicit undefined). Strings, including published JSON, stay byte exact.
    const record = value => {
        const serialized = JSON.stringify(value, (_key, item) => {
            if (item === undefined) return {$auditType: 'undefined'};
            if (typeof item === 'number' && (!Number.isFinite(item) || Object.is(item, -0)))
                return {$auditType: 'number', value: Object.is(item, -0) ? '-0' : String(item)};
            return item;
        });
        hash.update(serialized + '\n'); eventCount++;
    };
    const start = name => {scenario = name; hash = createHash('sha256'); eventCount = 0;};
    const finish = () => {
        assert.ok(eventCount > 0, `${scenario}: no observations`);
        results.push({scenario, events: eventCount, sha256: hash.digest('hex')});
    };
    // One shared fixture, evaluated with each tree's own production loader and
    // controllers. Record every state write, including intermediate transitions.
    let plantSource = fs.readFileSync(path.join(root, 'test/control-plant.js'), 'utf8');
    assert.equal(plantSource.split('states.set(id, state);').length, 2);
    plantSource = 'const auditEvent = module.auditEvent;\n' + plantSource.replace(
        'states.set(id, state);', 'states.set(id, state); auditEvent({kind:"state", at:now, id, state});');
    const {plant} = compile(plantSource, path.join(tree, 'test/control-plant.js'), {auditEvent: record});
    const checkpoint = h => record({kind: 'checkpoint', at: h.now(), commands: h.writes,
        trace: h.trace, diagnostics: h.diagnosticWrites, states: [...h.states],
        devices: h.output.devices,
        engine: h.run('({slowTargets, realtimeParallelActive, lastSlowUpdate, wallboxStartCandidateSince, wallboxRunStartedAt, wallboxPhaseDecision, wallboxSequenceResume})')});
    for (const [name, options, change] of [
        ['sequential-pv-and-minimum-end', {split: false}, h => {
            h.put('DP_WB2_MIN_SOC', 60); h.put('DP_WB2_SOC', 59); h.setSurplus(0);
        }],
        ['parallel-minimum-and-priority', {mii: true, split: false}, h => {
            h.config.wallboxParallelChargingEnabled = true;
            h.put('DP_WB0_MIN_SOC', 60); h.put('DP_WB2_MIN_SOC', 60); h.setSurplus(0);
        }],
        ['pv-tolerance-and-load-step', {split: false}, h => {
            h.config.wallboxPVImportToleranceW = 100; h.own('Config.WallboxPVImportTolerance_W', 100);
            h.setSurplus(1540);
        }],
        ['ehz-release-and-delayed-response', {dhwDelayMs: 9000}, h => h.setSurplus(0)],
        ['lpc-and-house-phase-ceiling', {mii: true, lpcLimitW: 4200, phaseBiasW: [6000, -3000, -3000]}, h => {
            h.put('lpc.limit', 1380); h.put('DP_WB2_MIN_SOC', 90);
        }],
        ['restart-adopted-owner-and-handoff', {mii: true, adoptRunningMii: true, split: false}, h => {
            h.put('DP_WB_PRIORITY', 2); h.put('DP_WB0_SOC', 100);
        }],
        ['soc-maximum-and-output-stop', {split: false}, h => h.put('DP_WB2_SOC', 100)],
        ['phase-request-and-confirmation', {wb2InitialPhaseMode: 1}, h => {
            h.put('goe.phase', 2); h.own('Vehicles.Wallbox2.MaximumPhases', 3);
        }],
        ['battery-heating-and-diagnostics', {battery: true, heating: true, diagnostics: true}, h => {
            h.setBatteryResponse(false); h.setSurplus(2000);
        }]
    ]) {
        start(name);
        const h = await plant(options);
        await h.advance(160); checkpoint(h);
        change(h);
        await h.advance(35); checkpoint(h);
        h.put('DP_WB2_SOC', 60);
        await h.advance(25); checkpoint(h);
        h.config.globalWriteEnabled = false;
        h.own('System.RealOutputsEnabled', false);
        await h.advance(10); checkpoint(h);
        await h.output.stopAll(); checkpoint(h);
        finish();
    }
    start('missing-stale-future-and-bad-quality-sources');
    {
        const h = await plant({split: false});
        await h.advance(160);
        h.output.adapter.shadowController = {recordSession: 'audit', recordSequence: 0,
            productionRecord: event => record({kind: 'recorder', event})};
        for (const extra of [{ts: h.now() - 31000}, {ts: h.now() + 2000}, {ack: false}, {q: 64}]) {
            h.put('DP_GRID_IMPORT', 0, extra);
            await h.output.tick();
            await new Promise(resolve => setImmediate(resolve));
            checkpoint(h);
        }
        h.states.delete('DP_GRID_EXPORT');
        await h.output.tick();
        await new Promise(resolve => setImmediate(resolve));
        checkpoint(h); await h.output.stopAll(); checkpoint(h);
    }
    finish();

    start('productive-ehz-zero-receipts-and-release');
    {
        let source = fs.readFileSync(path.join(tree, 'test/ehz-production-tick.test.js'), 'utf8');
        source = source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = {fixture};';
        const {fixture} = compile(source, path.join(tree, 'test/ehz-audit-fixture.js'));
        const h = await fixture();
        const snapshot = () => record({writes: h.writes, cache: [...h.a.stateCache],
            receipt: h.record(), reserve: h.reserve()});
        await h.stop(); snapshot();
        for (let i = 0; i < 5; i++) {
            h.advance(); await h.tick(); snapshot(); await h.complete(); snapshot();
        }
        assert.equal(h.reserve(), 0);
    }
    finish();

    start('phase-hysteresis-timers-and-transition-diagnostics');
    {
        let source = fs.readFileSync(path.join(tree, 'test/realtime-phase.test.js'), 'utf8');
        source = source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = {phaseEngine};';
        // The fixture supplies explicit phase decision times; also fix the
        // otherwise real engine-session initialization time.
        source = source.replace('Date, console, vehicle,', 'Date: class extends Date {static now() {return 2000000;}}, console, vehicle,');
        const {phaseEngine} = compile(source, path.join(tree, 'test/phase-audit-fixture.js'));
        for (const initial of [1, 3]) {
            const h = phaseEngine({}, initial);
            for (let second = 0; second <= 700; second += 5) {
                const budget = second < 200 ? 3500 : 5500;
                const phase = h.run(second, budget, second === 350 ? {pending: true, valid: false} : {});
                record({initial, second, phase, diagnostic: h.diagnostic(), states: [...h.states]});
            }
        }
    }
    finish();

    start('startup-invalidation-and-ordered-shutdown');
    {
        let source = fs.readFileSync(path.join(tree, 'test/lifecycle.test.js'), 'utf8');
        source = source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = {adapter};';
        source = source.replace('console, setTimeout, clearTimeout', 'Date: module.auditClock, console, setTimeout, clearTimeout');
        // Supply the clock through a lexical variable: the VM's module is the
        // adapter module, whereas this fixture's module owns auditClock.
        source = 'const auditClock = module.auditClock;\n' + source.replace('Date: module.auditClock', 'Date: auditClock');
        const {adapter} = compile(source, path.join(tree, 'test/lifecycle-audit-fixture.js'),
            {auditClock: class extends Date {static now() {return 2000000;}}});
        const a = adapter();
        a.setStateAsync = async (...args) => record({kind: 'state', args});
        a.preloadStates = async () => {
            for (const key of ['Plan.Valid', 'Control.Valid', 'System.DataValid'])
                a.stateCache.set(`ems.0.${key}`, {val: true, ts: 1, ack: true});
        };
        for (const method of ['startEngine', 'applyNativeVehicleSettings', 'applyNativeEmsSettings',
            'startDebug', 'startShadow', 'startMarketPrices'])
            a[method] = async () => record({kind: 'startup', method});
        a.outputMetadata.refresh = async () => record({kind: 'metadata'});
        a.publishMappingStatus = () => record({kind: 'mapping'});
        a.runEngine = source => record({kind: 'engine', source});
        a.wallboxOutput.initialize = async () => record({kind: 'initialize-output', states: [...a.stateCache]});
        await a.onReady();
        a.engineContext = {};
        a.wallboxOutput.waitForIdle = async () => record({kind: 'idle'});
        a.wallboxOutput.stopAll = async () => record({kind: 'stop-wallboxes'});
        a.getForeignObjectAsync = async () => null;
        a.runShadow = method => record({kind: 'shadow', method});
        a.decisionRecordDelivery = {stop: () => record({kind: 'delivery-stop'})};
        a.decisionRecordJournal = {close: async () => record({kind: 'journal-close'})};
        await a.prepareUnload({allowHandoff: false});
        record({kind: 'final-cache', states: [...a.stateCache]});
    }
    finish();

    // Branch-sensitive arithmetic: compare full diagnostics and the ordered,
    // lazy setting reads, not just the rounded ampere result.
    start('allocation-boundaries-and-setting-read-order');
    const reads = [];
    const sandbox = {gridConstraints: require(path.join(tree, 'lib/grid-constraints')),
        wallboxAllocationPolicy: fs.existsSync(path.join(tree, 'lib/wallbox-allocation.js'))
            ? require(path.join(tree, 'lib/wallbox-allocation')) : null,
        Date: class extends Date {static now() {return 2000000;}},
        readNumber: (id, fallback) => {reads.push({id, fallback}); return fallback;}};
    const context = vm.createContext(sandbox);
    vm.runInContext('const CFG = {root:"ems.0"};', context);
    vm.runInContext(fs.readFileSync(path.join(tree, 'lib/engine/realtime.js'), 'utf8'), context);
    const vehicle = {phaseSwitchEnabled: true, maximumPhases: 3,
        minCurrent1pA: 6, maxCurrent1pA: 16, minCurrent3pA: 6, maxCurrent3pA: 16, maximumPowerW: 11040};
    for (const watts of [0, 1, 1149.9, 1380, 1459.99, 1460, 1540, 1609.99, 1610, 3680, 11040])
        for (const previous of [0, 6, 7, 16]) for (const phases of [1, 3])
            for (const actual of [null, 0, 1280, 1380, 1540, 4140])
                for (const tolerance of [0, 100, 200]) {
                    reads.length = 0;
                    const result = context.quantizeWallbox(watts, vehicle, previous, phases, actual,
                        {pvStepToleranceW: tolerance, holdMeasuredCurrent: true, holdMaximumPowerW: 11040,
                            maximumPowerW: 3680, pvStepMaximumPowerW: watts});
                    record({watts, previous, phases, actual, tolerance, result, reads});
                }
    for (const available of [0, 1380, 6000, 9000]) for (const share of [0, 25, 50, 100])
        record(context.splitRealtimePair(available, 3000, 7360, share));
    finish();

    // Reuse the existing gated real-file fixture with a controlled clock.
    // Both trees perform actual write/fsync/read operations; no SQL is contacted.
    start('recorder-queue-loss-journal-durability-and-restart');
    let source = fs.readFileSync(path.join(tree, 'test/recorder-slow-append.test.js'), 'utf8');
    source = source.slice(0, source.indexOf('\nfor (const blocked of')) + '\nmodule.exports = {fixture};';
    const {fixture} = compile(source, path.join(tree, 'test/recorder-audit-fixture.js'));
    const cleanups = [];
    const h = await fixture({after: fn => cleanups.push(fn)}, true);
    const originalNow = Date.now;
    Date.now = h.now;
    try {
        h.recorder.productionRecord({type: 'baseline'});
        await h.started;
        const command = h.recorder.commandEvent('attempt', 'heater', 0);
        for (let i = 0; i < 300; i++) {
            h.advance(1000);
            const previous = h.states.get('import');
            h.put('import', i);
            h.recorder.captureProduction('import', h.states.get('import'), previous);
        }
        h.recorder.flushSourceBatch(true);
        h.recorder.commandEvent('transport_complete', 'heater', 0, command);
        record({pending: h.recorder.durablePending.size, bytes: h.recorder.durablePendingBytes,
            drops: h.recorder.recordDropped, health: h.journal.health()});
        assert.equal(h.recorder.durablePending.size, 128);
        assert.ok(h.recorder.recordDropped > 0);
        h.release(); await h.recorder.recordAppendTail; await h.journal.tail;
        h.advance(60000); h.recorder.productionRecord({type: 'continued'});
        await h.recorder.recordAppendTail; await h.journal.tail;
        record(await h.journal.readBatch({limit: 512, maxBytes: 16 * 1024 * 1024}));
        record(h.journal.health());
        await h.journal.close();
        // Recovery uses file mtime as its retention clock. Fix that filesystem
        // input explicitly rather than discarding oldestRetainedAt from output.
        for (const name of fs.readdirSync(h.directory))
            if (/^\d{16}\.json$/.test(name)) fs.utimesSync(path.join(h.directory, name), h.now() / 1000, h.now() / 1000);
        const Journal = require(path.join(tree, 'lib/decision-record-journal'));
        const reopened = new Journal({directory: h.directory, now: h.now});
        await reopened.initialize();
        record(await reopened.readBatch({limit: 512, maxBytes: 16 * 1024 * 1024}));
        record(reopened.health()); await reopened.close();
    } finally {
        Date.now = originalNow;
        for (const cleanup of cleanups.reverse()) await cleanup();
    }
    finish();

    start('recorder-byte-bound-and-concurrent-local-read');
    source = fs.readFileSync(path.join(tree, 'test/recorder-slow-append.test.js'), 'utf8');
    const largeStart = source.indexOf('function largeRawContext(');
    const largeEnd = source.indexOf('\ntest(', largeStart);
    source = source.slice(0, source.indexOf('\nfor (const blocked of'))
        + source.slice(largeStart, largeEnd) + '\nmodule.exports = {fixture, largeRawContext};';
    const {fixture: byteFixture, largeRawContext} = compile(source, path.join(tree, 'test/recorder-byte-audit-fixture.js'));
    const byteCleanups = [];
    const bytes = await byteFixture({after: fn => byteCleanups.push(fn)}, true);
    Date.now = bytes.now;
    try {
        bytes.recorder.enqueueRecord(largeRawContext(bytes.now()));
        await bytes.started;
        const localRead = bytes.journal.readBatch({limit: 2, maxBytes: 256 * 1024});
        bytes.advance(4500);
        for (let index = 0; index < 160; index++) {
            bytes.recorder.enqueueRecord(largeRawContext(bytes.now())); bytes.advance(10);
        }
        assert.ok(bytes.recorder.durablePending.size < 128);
        assert.ok(bytes.recorder.recordDropped > 0);
        record({pending: bytes.recorder.durablePending.size, rawBytes: bytes.recorder.durablePendingBytes,
            dropped: bytes.recorder.recordDropped, health: bytes.journal.health()});
        bytes.release(); await bytes.recorder.recordAppendTail; await localRead; await bytes.journal.tail;
        bytes.recorder.enqueueRecord({schema: 2, timestamp: bytes.now(), mode: 'PRODUCTION',
            masterEnabled: true, event: {type: 'continued-after-byte-loss'}});
        await bytes.recorder.recordAppendTail;
        record(await bytes.journal.readBatch({limit: 256, maxBytes: 16 * 1024 * 1024}));
        record(await bytes.recorder.finishRecording());
        record(bytes.journal.health());
    } finally {
        Date.now = originalNow;
        for (const cleanup of byteCleanups.reverse()) await cleanup();
    }
    finish();

    start('sql-exact-confirmation-and-query-order');
    source = fs.readFileSync(path.join(tree, 'test/decision-record-delivery.test.js'), 'utf8');
    source = source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = {fixture};';
    const {fixture: deliveryFixture} = compile(source, path.join(tree, 'test/delivery-audit-fixture.js'));
    const delivery = deliveryFixture(16, {bundleOriginals: true});
    for (let n = 0; n < 4; n++) {
        await delivery.delivery.tick();
        record({publications: delivery.publications, confirmations: delivery.confirmations,
            queries: delivery.queries, health: delivery.delivery.health()});
        delivery.advance(1000);
    }
    assert.equal(delivery.stored.size, 0);
    delivery.delivery.stop(); finish();
    return {node: process.version, results};
}

async function main() {
    if (process.argv[2] === '--worker') {
        const report = await worker(path.resolve(process.argv[3]));
        fs.writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
        return;
    }
    const revision = process.argv[2] || BASE;
    assert.match(revision, /^[a-f0-9]{40}$/);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-equivalence-'));
    try {
        const baseline = path.join(directory, 'baseline'); fs.mkdirSync(baseline);
        const archive = execFileSync('git', ['archive', revision], {cwd: root, maxBuffer: 32 * 1024 * 1024});
        execFileSync('tar', ['-x', '-C', baseline], {input: archive});
        fs.symlinkSync(path.join(root, 'node_modules'), path.join(baseline, 'node_modules'), 'dir');
        const reports = [];
        for (const [name, tree] of [['before', baseline], ['after', root]]) {
            const report = path.join(directory, name + '.json');
            execFileSync(process.execPath, [__filename, '--worker', tree, report], {stdio: 'inherit'});
            reports.push(JSON.parse(fs.readFileSync(report, 'utf8')));
        }
        assert.deepEqual(reports[1], reports[0], 'ordered output/diagnostic traces differ from baseline');
        console.log(JSON.stringify({baseline: revision, ...reports[1]}, null, 2));
    } finally {fs.rmSync(directory, {recursive: true, force: true});}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
