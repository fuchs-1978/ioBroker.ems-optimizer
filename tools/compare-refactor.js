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
const {historicalStateView} = require('./historical-state-view');
const BASE = '9585b276c75c3ed79634204ba8318166e577dc44';
const root = path.resolve(__dirname, '..');

function compile(source, filename, properties = {}) {
    const module = new Module(filename);
    module.filename = filename;
    module.paths = Module._nodeModulePaths(path.dirname(filename));
    Object.assign(module, properties);
    // Current phase fixtures carry an injected reader. The historical phase
    // arithmetic never calls it; resolve the fixture dependency independently
    // of the production tree being compared (no controller substitution).
    source = source.replaceAll("require('../lib/grid-measurement')",
        `require(${JSON.stringify(path.join(root, 'lib/grid-measurement'))})`);
    module._compile(source, filename);
    return module.exports;
}

async function worker(tree) {
    // Entropy and monotonic timing are inputs too. Supply identical values
    // before loading recorder/delivery modules; never erase diagnostic fields.
    let uuid = 0, monotonic = 0;
    require('node:crypto').randomUUID = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;
    Object.defineProperty(performance, 'now', {configurable: true, value: () => ++monotonic});
    // Pin only the published version metadata before recorder compression.
    // Normalizing hashes afterwards cannot compare compressed JSON/byte counts.
    // Admin-config and packed-artifact tests check the real release version.
    const packageMetadata = require(path.join(tree, 'package.json'));
    const adapterVersion = packageMetadata.version;
    packageMetadata.version = '0.17.0-alpha.96';
    const readSource = fs.readFileSync.bind(fs);
    const versionSources = new Set(['core.js', 'bootstrap.js'].map(name => path.join(tree, 'lib/engine', name)));
    const admissionSource = path.join(tree, 'lib/engine/dhw-controller.js');
    const heaterOutputSource = path.join(tree, 'lib/engine/dhw-output.js');
    const recorderSource = path.join(tree, 'lib/debug-recorder.js');
    fs.readFileSync = (filename, options) => {
        const data = readSource(filename, options);
        if (!versionSources.has(String(filename)) && String(filename) !== admissionSource
            && String(filename) !== recorderSource && String(filename) !== heaterOutputSource) return data;
        let pinned = String(data).replaceAll(adapterVersion, '0.17.0-alpha.96');
        // alpha.167 introduces three unused production configuration slots.
        // Give the historical fixture exactly the same zero-valued objects;
        // retain all writes, input values and allocator decisions in the trace.
        if (String(filename).endsWith('/core.js') && !pinned.includes('MobilityReserve_pct')) {
            const anchor = "        configDef(`${r}.Vehicles.Wallbox${wb}.DepartureTime`, '06:00', 'string', 'text', '', `Abfahrtszeit Wallbox ${wb}`);";
            assert.equal(pinned.split(anchor).length, 2);
            pinned = pinned.replace(anchor, anchor + "\n        configDef(`${r}.Vehicles.Wallbox${wb}.MobilityReserve_pct`, 0, 'number', 'level', '%', `Mobilitaetsreserve Wallbox ${wb}; 0 deaktiviert; aktuell Strategie-Vorschau, keine produktive Sofortladefreigabe`);");
        }
        // alpha.171 adds five initially inactive SoC command/diagnostic slots
        // per vehicle. Define exactly the same slots in the immutable fixture;
        // keep every event and checkpoint in the comparison, including their
        // initial values. Manual-correction behavior is tested separately.
        if (String(filename).endsWith('/core.js') && !pinned.includes('SoCCorrection_pct')) {
            const anchor = "        stateDef(`${r}.Vehicles.Wallbox${wb}.SocEstimateLedger_JSON`, '', 'string', 'json', '', 'Persistente SoC-Schaetzbasis');";
            assert.equal(pinned.split(anchor).length, 2);
            pinned = pinned.replace(anchor, [
                "        configDef(`${r}.Vehicles.Wallbox${wb}.SoCCorrection_pct`, -1, 'number', 'level', '%', 'SoC einmalig korrigieren (0-100); -1 hebt Korrektur auf');",
                "        stateDef(`${r}.Vehicles.Wallbox${wb}.SoCWarning`, false, 'boolean', 'indicator.alarm', '', 'Fahrzeug-SoC auf Plausibilitaet pruefen');",
                "        stateDef(`${r}.Vehicles.Wallbox${wb}.SoCWarningText`, '', 'string', 'text', '', 'Hinweis zur manuellen SoC-Pruefung');",
                "        stateDef(`${r}.Vehicles.Wallbox${wb}.SoCCorrectionStatus`, '', 'string', 'text', '', 'Ergebnis der manuellen SoC-Korrektur');",
                "        stateDef(`${r}.Vehicles.Wallbox${wb}.SoCCorrectionActive`, false, 'boolean', 'indicator', '', 'Manuelle SoC-Basis gespeichert; Status auf Gueltigkeit pruefen');",
                anchor
            ].join('\n'));
        }
        // alpha.176 adds seven passive comparison objects. Give the immutable
        // fixture their exact disabled defaults; all production and diagnostic
        // events still remain in the ordered trace. Enabled behavior has its
        // own comparison tests and cannot feed the production plan.
        if (String(filename).endsWith('/core.js') && !pinned.includes('Forecast.LoadComparison.Ready')) {
            const anchor = "    stateDef(`${r}.Forecast.PV_48h_JSON`";
            assert.equal(pinned.split(anchor).length, 2);
            const current = readSource(path.join(root, 'lib/engine/core.js'), 'utf8');
            const start = current.indexOf('    stateDef(`${r}.Forecast.LoadComparison.Ready`');
            const end = current.indexOf(anchor, start);
            assert.ok(start >= 0 && end > start);
            pinned = pinned.replace(anchor, current.slice(start, end) + anchor);
        }
        if (String(filename).endsWith('/bootstrap.js') && !pinned.includes('Forecast.LoadComparison.Ready')) {
            const current = readSource(path.join(root, 'lib/engine/bootstrap.js'), 'utf8');
            const start = current.indexOf('// Comparison readiness');
            const end = current.indexOf('// Rebuild all vehicle', start);
            assert.ok(start >= 0 && end > start);
            const insert = pinned.indexOf('\n\n') + 2;
            pinned = pinned.slice(0, insert) + current.slice(start, end) + pinned.slice(insert);
        }
        // The startup-order fixture records bootstrap source text without
        // executing it. Align the new command subscriptions there too; no
        // correction commands are injected into historical control scenarios.
        if (String(filename).endsWith('/bootstrap.js') && !pinned.includes('SoCCorrection_pct')) {
            pinned += "\n[0, 1, 2].forEach(wb => {\n"
                + "    on({id: `${CFG.root}.Vehicles.Wallbox${wb}.SoCCorrection_pct`, change: 'any'},\n"
                + "        ({state}) => applyVehicleSocCorrection(wb, state));\n});\n";
        }
        // alpha.155 represents an unknown initial vehicle SoC as null. Align
        // only the object default; observed reports and all control writes
        // still come from the respective production tree.
        if (String(filename).endsWith('/core.js')) pinned = pinned.replace(
            'stateDef(`${r}.Vehicles.Wallbox${wb}.SoC_pct`, 0,',
            'stateDef(`${r}.Vehicles.Wallbox${wb}.SoC_pct`, null,');
        // alpha.138 adds one passive state definition. Supply that same
        // unknown diagnostic slot to the historical fixture, rather than
        // dropping state writes/checkpoints or relaxing command comparison.
        // Its evaluated values and status/context are tested independently.
        if (String(filename).endsWith('/core.js') && !pinned.includes('MinimumAdmissionPower_W')) {
            const anchor = "    stateDef(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0, 'number', 'value.power', 'W', 'Temperaturabhaengige Leistungsgrenze');";
            assert.equal(pinned.split(anchor).length, 2);
            pinned = pinned.replace(anchor, anchor + "\n    stateDef(`${r}.Devices.MyPV_DHW.MinimumAdmissionPower_W`, null, 'number', 'value.power', 'W', 'Schichtungsabhaengige Mindestleistung; null bei unbekannten Temperaturen, keine Leistungsfreigabe');");
        }
        if (String(filename) === admissionSource && !pinned.includes('MinimumAdmissionPower_W')) {
            const anchor = '    write(`${r}.TemperaturePowerLimit_W`, Math.round(temperaturePowerLimitW));';
            assert.equal(pinned.split(anchor).length, 2);
            // Read-only annotation of the old rule; do not alter its target
            // function or any actuator path in the baseline.
            pinned = pinned.replace(anchor, anchor + '\n    write(`${r}.MinimumAdmissionPower_W`, valid ? (top - bottom > 15 ? 900 : top > 35 ? 500 : 0) : null);');
        }
        if (String(filename) === recorderSource && !pinned.includes('MinimumAdmissionPower_W')) {
            const anchor = "'TemperaturePowerLimit_W', 'BottomTemperature_C'";
            assert.equal(pinned.split(anchor).length, 2);
            pinned = pinned.replace(anchor, "'TemperaturePowerLimit_W', 'MinimumAdmissionPower_W', 'BottomTemperature_C'");
        }
        if (String(filename) === heaterOutputSource && !pinned.includes('MinimumAdmissionPower_W')) {
            const anchor = "        reason = 'Fahrplan-/EMS-Freigabe ohne Leistungsbudget';";
            assert.equal(pinned.split(anchor).length, 2);
            // Forward-port only the intentional status explanation. The
            // baseline's desiredW, caps, ramps and writes stay untouched.
            pinned = pinned.replace(anchor, anchor + `
        const minimumW = getState(\`\${r}.Devices.MyPV_DHW.MinimumAdmissionPower_W\`)?.val;
        const availableW = Math.max(0, actualW - gridErrorW);
        if (fineRegulation && getState(\`\${r}.Devices.MyPV_DHW.TemperatureValid\`)?.val === true
            && typeof minimumW === 'number' && Number.isFinite(minimumW) && minimumW > 0
            && gridErrorW < -deadbandW && availableW < minimumW) {
            reason = \`Ueberschuss \${Math.round(availableW)} W unter Schichtungsminimum \${minimumW} W; kein Heizstart\`;
        }`);
        }
        return typeof data === 'string' ? pinned : Buffer.from(pinned);
    };
    // alpha.159 adds passive append phase metadata. Align ONLY these new
    // leaves before originals and loss checkpoints are serialized/compressed.
    // Keep every pre-existing timing, queue, durability and command field.
    // Dedicated delayed-I/O regressions assert the new metadata and barriers.
    const historicalAppendHealth = health => {
        if (health.lastAppendBatch) delete health.lastAppendBatch.phases;
        if (health.activeOperation) for (const key of ['phase', 'phaseStartedAt', 'phaseElapsedMs', 'fileIO'])
            delete health.activeOperation[key];
        return health;
    };
    let hash, eventCount, scenario;
    const results = [];
    // Preserve values JSON would otherwise collapse (e.g. NaN/null, -0/0,
    // absent/explicit undefined). Apart from pinned version metadata above,
    // strings, including published JSON and transport bytes, stay exact.
    const record = value => {
        value = historicalStateView(value);
        if (value === undefined) return;
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
    // controllers. Record every pre-existing state write, including intermediate transitions.
    let plantSource = fs.readFileSync(path.join(root, 'test/control-plant.js'), 'utf8');
    assert.equal(plantSource.split('states.set(id, state);').length, 2);
    plantSource = 'const auditEvent = module.auditEvent;\n' + plantSource.replace(
        'states.set(id, state);', 'states.set(id, state); auditEvent({kind:"state", at:now, id, state});');
    const {plant: createPlant} = compile(plantSource, path.join(tree, 'test/control-plant.js'), {auditEvent: record});
    const plant = async options => {
        const h = await createPlant(options);
        // These byte-exact historical traces cover unchanged, confirmed
        // topology. Explicitly supply their synthetic 1P mode observation:
        // alpha.128 intentionally changes measured diagnostics/steps when a
        // fixed device has no psm source. That missing-source contract is
        // tested separately by fixed-one-phase-pv-step and parallel-realtime.
        // Never manufacture mode feedback in production or switchable cases.
        for (const wb of [0, 2]) if (h.config[`wb${wb}ControlEnabled`]
            && !h.config[`wb${wb}PhaseSwitchEnabled`]) h.put(`DP_WB${wb}_PHASE_MODE`, 1);
        return h;
    };
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
        // alpha.152 deliberately changes lending during a pending start delay.
        // Compare restart adoption/handoff without that changed delay policy;
        // alpha.154's start-lifecycle tests cover delayed starts and recipient
        // transfer. This old byte-exact spine isolates donor adoption/stop
        // at the already stable 6-A load, with no receiving wallbox, rather
        // than requiring the fixed transfer or ramp/heat allocation to reproduce its historical defect.
        ['restart-adopted-owner-continuity', {mii: true, adoptRunningMii: true, wallbox: false, split: false, startDelayS: 0, initialSurplusW: 1480}, h => {
            h.put('DP_WB_PRIORITY', 2); h.put('DP_WB0_SOC', 100);
        }],
        ['soc-maximum-and-output-stop', {split: false}, h => h.put('DP_WB2_SOC', 100)],
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
    // The old mixed cold-start/mode fixture intentionally differs in 154.
    // Keep the running 300-s up / 120-s down qualification byte-exact here;
    // start-lifecycle tests exercise the full changed allocator/output path.
    start('running-real-phase-qualification');
    {
        let source = fs.readFileSync(path.join(root, 'test/realtime-phase.test.js'), 'utf8');
        source = source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = {phaseEngine};';
        // These extracted arithmetic/measurement modules did not exist at
        // alpha.96 and are unused by this pure phase-policy replay. Do not
        // substitute any production phase function from the current tree.
        source = source.replace("wallboxAllocationPolicy: require('../lib/wallbox-allocation')", 'wallboxAllocationPolicy: {}')
            .replace("normalizeWallboxPowerKW: require('../lib/wallbox-measurement').normalizeWallboxPowerKW", 'normalizeWallboxPowerKW: value => value');
        const {phaseEngine} = compile(source, path.join(tree, 'test/phase-audit-fixture.js'));
        const h = phaseEngine({phaseSwitchRealUpDelayS: 300, phaseSwitchRealDownDelayS: 120}, 1);
        let phase;
        for (let second = 0; second <= 300; second += 5) {
            phase = h.run(second, 6500);
            record({phase, diagnostic: h.diagnostic(), states: [...h.states]});
        }
        assert.equal(phase, 3);
        h.vehicle.confirmedPhases = 3;
        for (let second = 305; second <= 425; second += 5) {
            phase = h.run(second, 3500);
            record({phase, diagnostic: h.diagnostic(), states: [...h.states]});
        }
        assert.equal(phase, 1);
    }
    finish();
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

    // Keep the historical spines above intact. This additional scenario sets
    // both configuration surfaces and proves that parallel minimum charging
    // really ran, rather than merely trusting its scenario name.
    start('verified-parallel-minimum-charging');
    {
        const h = await plant({mii: true, split: false});
        h.config.wallboxParallelChargingEnabled = true;
        h.own('Config.WallboxParallelChargingEnabled', true);
        h.put('DP_WB0_MIN_SOC', 60); h.put('DP_WB2_MIN_SOC', 60);
        h.setSurplus(0);
        assert.equal(h.run('parallelWallboxChargingEnabled()'), true);
        await h.advance(200); checkpoint(h);
        const allocation = JSON.parse(h.value('Control.ParallelWallboxAllocation_JSON'));
        assert.equal(allocation.valid, true);
        assert.ok(allocation.allocations.filter(entry => entry.minimumW > 0 && entry.targetA >= 6).length >= 2,
            'both below-minimum vehicles must receive an actual parallel grant');
        assert.ok(h.writes.some(write => write.id === 'goe0.allow' && write.val === 1));
        assert.ok(h.writes.some(write => write.id === 'goe.allow' && write.val === 1));
        h.put('DP_WB0_SOC', 60); h.put('DP_WB2_SOC', 60);
        await h.advance(35); checkpoint(h);
        await h.output.stopAll(); checkpoint(h);
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
        // Isolate the new optional scalar-history setup, just like startShadow
        // below. Its own metadata/status is intentional alpha.125 behavior;
        // source-power-history/lifecycle tests cover it separately. Keep all
        // pre-existing ordered output/startup/shutdown traces byte-exact.
        if (a.sourcePowerHistory) a.sourcePowerHistory.initialize = async () => {};
        // alpha.132 adds passive summary state creation/checkpoints, not control
        // behavior. Its bounded persistence/coverage contract is tested in
        // daily-summary.test.js. Keep the original actuator trace exact.
        if (a.dailySummary) {
            a.startDailySummary = async () => {};
            a.dailySummary.stop = async () => {};
        }
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
        // alpha.163 routes bootstrap timeouts through the existing sandbox
        // delegate. This fixture records source text rather than running it;
        // align only that API spelling. Timer ownership/cancellation and the
        // executed bootstrap order are tested separately, with unchanged traces.
        a.runEngine = source => record({kind: 'engine',
            source: source.replace(/\bengineTimers\.(setTimeout|clearTimeout)\b/g, '$1')});
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

    // A 3,680-W cap cannot admit even the 3P hardware minimum. Exercise
    // successful 3P branches separately and assert the path before hashing.
    start('verified-positive-three-phase-quantization');
    for (const [watts, previous, actual, expectedA, expectedReason] of [
        [4140, 0, null, 6, 'budget'],
        [11040, 0, null, 6, 'ramp-limit'],
        [11040, 6, 4140, 12, 'ramp-limit'],
        [11040, 12, 8280, 16, 'budget'],
        [4140, 12, 8280, 6, 'budget']
    ]) {
        reads.length = 0;
        const result = context.quantizeWallbox(watts, vehicle, previous, 3, actual,
            {maximumPowerW: 11040, holdMaximumPowerW: 11040});
        assert.equal(result.phases, 3);
        assert.equal(result.amps, expectedA);
        assert.equal(result.powerW, expectedA * 690);
        assert.equal(result.diagnostics.reason, expectedReason);
        record({watts, previous, actual, result, reads});
    }
    finish();

    // alpha.142 and alpha.147 deliberately change the local drain/read/cleanup schedule and
    // group size. Pin ONLY this explicit policy in both recorder fixtures;
    // comparing its old timing/health bytes would assert the removed behavior.
    // Recorder-drain regressions fail on unchanged141; the stalled-read
    // regressions separately fail on146 and pass on147. Keep codec, source/event capture, capacity/loss accounting,
    // real files, restart and ALL other scenarios/actuator traces comparable.
    // No fields, records, hashes or outputs are dropped from the comparison.
    const pinRecorderDrainPolicy = h => {
        const Journal = require(path.join(root, 'lib/decision-record-journal'));
        const Shadow = require(path.join(root, 'lib/shadow-controller'));
        for (const method of ['health', '_enqueue', 'setRecorderBacklog', '_scheduleRetirement',
            '_nextConfirmedGroup', '_retireConfirmedGroups', '_retireGroup', 'expireOldGroups', 'prepareReplay',
            'readBatch', '_readBatch', 'close'])
            h.journal[method] = Journal.prototype[method];
        Object.assign(h.journal, {operationQueue: [], operationRunning: false,
            appendTurns: 0, recorderBacklog: 0, retirementPending: false,
            readTail: Promise.resolve(), readPins: new Set(), activeRead: null});
        const journalHealth = h.journal.health.bind(h.journal);
        h.journal.health = () => historicalAppendHealth(journalHealth());
        const recordLoss = h.journal.lossDiagnostics.record.bind(h.journal.lossDiagnostics);
        h.journal.lossDiagnostics.record = (value, count, journal) =>
            recordLoss(value, count, historicalAppendHealth(structuredClone(journal)));
        h.recorder.enqueueDurableBatch = Shadow.prototype.enqueueDurableBatch;
    };

    // Reuse the existing gated real-file fixture with a controlled clock.
    // Both trees perform actual write/fsync/read operations; no SQL is contacted.
    start('recorder-queue-loss-journal-durability-and-restart');
    let source = fs.readFileSync(path.join(tree, 'test/recorder-slow-append.test.js'), 'utf8');
    source = source.slice(0, source.indexOf('\nfor (const blocked of')) + '\nmodule.exports = {fixture};';
    const {fixture} = compile(source, path.join(tree, 'test/recorder-audit-fixture.js'));
    const cleanups = [];
    const h = await fixture({after: fn => cleanups.push(fn)}, true);
    pinRecorderDrainPolicy(h);
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
        pinRecorderDrainPolicy({journal: reopened, recorder: {}});
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
    pinRecorderDrainPolicy(bytes);
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
    // alpha.141 adds passive phase measurements. The number of profiling
    // clock reads must not itself advance the mock time of the old query
    // contract. Exact phase/callback/checkpoint behavior is covered by the
    // dedicated failure regressions; keep all pre-existing SQL fields and
    // publication, confirmation and request ordering in this comparison.
    Object.defineProperty(performance, 'now', {configurable: true, value: () => 100000});
    const existingQuery = query => {
        if (!query) return query;
        const {journalBeginAt, journalBeginMs, transportAt, callbackAt, transportWaitMs,
            transportSettledAt, fenceCompletedAt, fenceCompleteMs, ...existing} = query;
        return existing;
    };
    source = fs.readFileSync(path.join(tree, 'test/decision-record-delivery.test.js'), 'utf8');
    source = source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = {fixture};';
    const {fixture: deliveryFixture} = compile(source, path.join(tree, 'test/delivery-audit-fixture.js'));
    const delivery = deliveryFixture(16, {bundleOriginals: true});
    for (let n = 0; n < 4; n++) {
        await delivery.delivery.tick();
        const health = delivery.delivery.health();
        health.lastQuery = existingQuery(health.lastQuery);
        health.recentQueries = health.recentQueries.map(existingQuery);
        record({publications: delivery.publications, confirmations: delivery.confirmations,
            queries: delivery.queries, health});
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
