'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {SMA_GRID_MAX_AGE_MS} = require('../lib/source-diagnostics');

// Exercise the production engine files, with explicit source snapshots rather
// than fabricated derived eligibility. No output-driver or ioBroker writes run.
function engine({production = false, ...config} = {}) {
    const nativeConfig = {
        wallboxParallelChargingEnabled: true,
        wallboxPrioritySource: 'internal', wallboxPriority: 0,
        globalWriteEnabled: true, multiWallboxAlphaArmed: true,
        combinedProductionArmed: true, dhwControlEnabled: false,
        wb0ControlEnabled: true, wb0ProductionArmed: true,
        wb1ControlEnabled: true, wb1ProductionArmed: true,
        wb2ControlEnabled: true, wb2ProductionArmed: true,
        ...config
    };
    for (let wb = 0; wb < 3; wb++) {
        nativeConfig[`wb${wb}AllowOutputId`] = `raw.allow${wb}`;
        nativeConfig[`wb${wb}AmpereFeedbackId`] = `raw.amps${wb}`;
        nativeConfig[`wb${wb}ErrorId`] = `raw.error${wb}`;
        nativeConfig[`wb${wb}ConnectionId`] = `raw.connected${wb}`;
    }
    const states = new Map();
    const put = (id, val, overrides = {}) => states.set(id, {val, ts: Date.now(), ack: true, q: 0, ...overrides});
    const ctx = vm.createContext({nativeConfig, SMA_GRID_MAX_AGE_MS, Date, console,
        gridConstraints: require('../lib/grid-constraints'),
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => { if (!states.has(id)) put(id, val); }, setState: put,
        log: () => {}, sendTo: () => {}});
    const run = source => vm.runInContext(source, ctx);
    for (const name of ['core', 'prices', 'history', 'forecast', 'vehicles', 'dhw-controller', 'planner', 'realtime']) {
        run(fs.readFileSync(path.join(__dirname, '../lib/engine', `${name}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) => key));
    }
    run('createStates()');
    run(fs.readFileSync(path.join(__dirname, '../lib/engine/config-mapping.js'), 'utf8')
        .replace(/__([A-Z0-9_]+)__/g, (_, key) => key));
    put('ems.0.System.RealOutputsEnabled', production);
    put('ems.0.Control.Enabled', true);
    put('ems.0.System.DataValid', true);
    put('ems.0.Plan.Valid', true);
    put('ems.0.Config.WallboxStartDelay_s', 0);
    put('ems.0.Config.WallboxStartReserve_W', 0);
    put('ems.0.Config.WallboxMinimumRunTime_s', 0);
    put('ems.0.Config.WallboxMaxStep_A', 32);
    put('ems.0.Config.WallboxCombinedMaxStep_A', 32);
    put('ems.0.Config.DHWParallelDistributionEnabled', true);
    put('ems.0.Devices.MyPV_DHW.Present', nativeConfig.dhwControlEnabled === true);
    put('ems.0.Devices.MyPV_DHW.ControlEnabled', nativeConfig.dhwControlEnabled === true);
    put('ems.0.Devices.MyPV_DHW.Release', nativeConfig.dhwControlEnabled === true);
    put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W', 9000);
    put('ems.0.Config.DHWCommissioningMaxPower_W', 9000);
    put('DP_DHW_PARALLEL_RELEASE', true);
    put('DP_GRID_IMPORT', 0); put('DP_GRID_EXPORT', 0);
    for (let leg = 1; leg <= 3; leg++) {
        put(`DP_DHW_OUTPUT${leg}`, 0);
        put(`DP_HA_L${leg}_IMPORT_W`, 0); put(`DP_HA_L${leg}_EXPORT_W`, 0);
    }
    run('simulateDhwTarget = watts => watts');
    for (let wb = 0; wb < 3; wb++) {
        const base = `ems.0.Devices.Wallbox${wb}`;
        put(`${base}.Present`, true); put(`${base}.ControlEnabled`, production);
        put(`${base}.OutputActive`, false); put(`${base}.OutputOwned`, false);
        put(`${base}.OutputPhases`, 1); put(`${base}.OutputCommand_A`, 0);
        put(`DP_WB${wb}_CAR`, 2); put(`DP_WB${wb}_SOC`, 50);
        put(`DP_WB${wb}_MIN_SOC`, 20); put(`DP_WB${wb}_TARGET`, 80);
        put(`DP_WB${wb}_ALLOW`, true); put(`DP_WB${wb}_RELEASE`, 1);
        put(`DP_WB${wb}_POWER`, 0); put(`DP_WB${wb}_PHASE_MODE`, 1);
        put(`raw.allow${wb}`, 0); put(`raw.amps${wb}`, 0);
        put(`raw.error${wb}`, 0); put(`raw.connected${wb}`, true);
        for (const phase of [1, 2, 3]) put(`DP_WB${wb}_L${phase}_A`, 0);
        put(`ems.0.Vehicles.Wallbox${wb}.MaxCurrent1P_A`, 32);
        put(`ems.0.Vehicles.Wallbox${wb}.MinCurrent1P_A`, 6);
        put(`ems.0.Vehicles.Wallbox${wb}.MaxCurrent3P_A`, 16);
        put(`ems.0.Vehicles.Wallbox${wb}.MinCurrent3P_A`, 6);
        put(`ems.0.Config.Wallbox${wb}VehicleCapacity_kWh`, 50);
        put(`ems.0.Config.Wallbox${wb}MaxPower_W`, 7360);
    }
    const plans = Array.from({length: 3}, () => ({valueW: 0, phases: 1}));
    const update = (watts, hard = Infinity, heating = {valueW: 0}, coordination = null) => {
        run(`updateSlowTargets(${watts},${JSON.stringify(plans)},${JSON.stringify(heating)},${hard},${JSON.stringify(coordination)})`);
        return {
            amps: Array.from(run('slowTargets.wallboxA')),
            watts: Array.from(run('slowTargets.wallboxW')),
            reserve: Array.from(run('slowTargets.wallboxExpectedW')),
            phases: Array.from(run('slowTargets.wallboxPhases')),
            dhw: run('slowTargets.dhwW')
        };
    };
    const exclude = wb => put(`ems.0.Devices.Wallbox${wb}.Present`, false);
    const owned = (wb, amps, actualW = amps * 230, phases = 1) => {
        const base = `ems.0.Devices.Wallbox${wb}`;
        put(`${base}.OutputActive`, true); put(`${base}.OutputOwned`, true);
        put(`${base}.OutputCommand_A`, amps); put(`${base}.OutputPhases`, phases);
        put(`raw.allow${wb}`, 1); put(`raw.amps${wb}`, amps);
        put(`DP_WB${wb}_POWER`, actualW / 1000);
        for (const phase of [1, 2, 3]) put(`DP_WB${wb}_L${phase}_A`, phase <= phases ? actualW / (230 * phases) : 0);
    };
    run('updateVehicles()');
    return {nativeConfig, states, put, run, plans, update, exclude, owned};
}

test('manual Mii priority cannot starve EQV below its minimum SoC', () => {
    const h = engine(); h.exclude(2);
    h.put('DP_WB0_SOC', 58.2); h.put('DP_WB0_MIN_SOC', 70);
    h.put('DP_WB1_SOC', 79); h.put('DP_WB1_MIN_SOC', 80);
    const targets = h.update(6000);
    assert.ok(targets.amps[0] > 6, 'priority receives the surplus');
    assert.equal(targets.amps[1], 6, 'EQV retains its independent one-phase minimum');
    assert.deepEqual(targets.phases, [1, 1, 1]);
    assert.ok(targets.watts.reduce((a, b) => a + b, 0) <= 6000);
});

test('three below-minimum vehicles can import their 6 A floor without PV within a 4.2 kW hard cap', () => {
    for (const production of [false, true]) {
        const h = engine({production});
        for (let wb = 0; wb < 3; wb++) h.put(`DP_WB${wb}_SOC`, 10);
        const targets = h.update(0, 4200);
        assert.deepEqual(targets.amps, [6, 6, 6]);
        assert.deepEqual(targets.watts, [1380, 1380, 1380]);
        assert.equal(targets.dhw, 0, 'minimum-SoC grid import is not heater energy');
    }
});

test('insufficient shared capacity admits an entire minimum, never a sub-six amp charger', () => {
    const h = engine(); h.exclude(2);
    h.put('DP_WB0_SOC', 10); h.put('DP_WB1_SOC', 10);
    const targets = h.update(0, 2500);
    assert.deepEqual(targets.amps, [6, 0, 0]);
    assert.ok(targets.watts.reduce((a, b) => a + b, 0) <= 2500);
});

test('full warm-water tank lets priority Mii reach 32 A and residual serve EQV', () => {
    const h = engine(); h.exclude(2);
    h.put('ems.0.Devices.MyPV_DHW.Release', false);
    const targets = h.update(10000);
    assert.equal(targets.amps[0], 32);
    assert.equal(targets.amps[1], 11);
    assert.equal(targets.dhw, 0);
    assert.equal(targets.watts.reduce((a, b) => a + b, 0), 9890);
});

test('target-SoC, unplugged, and unconfirmed car states do not get a parallel charge target', () => {
    for (const cause of ['target', 'unplugged', 'quality', 'command-echo']) {
        const h = engine({production: true});
        h.put('ems.0.Vehicles.Wallbox0.MaxCurrent1P_A', 16);
        if (cause === 'target') h.put('DP_WB2_SOC', 80);
        if (cause === 'unplugged') h.put('DP_WB2_CAR', 1);
        if (cause === 'quality') h.put('DP_WB2_CAR', 2, {q: 64});
        if (cause === 'command-echo') h.put('DP_WB2_CAR', 2, {ack: false});
        const targets = h.update(20000);
        assert.equal(targets.amps[2], 0, cause);
        assert.ok(targets.amps[0] >= 6, cause);
    }
});

test('owned stopped or ineligible vehicle watts stay reserved until the real OFF response', () => {
    const h = engine({production: true}); h.exclude(2);
    h.owned(1, 20); h.put('DP_WB1_ALLOW', false);
    const targets = h.update(6000, 6000);
    assert.equal(targets.amps[1], 0);
    assert.ok(targets.reserve[1] >= 4600, 'old physical 20 A cannot be spent on Mii');
    assert.equal(targets.amps[0], 6, 'the genuinely remaining 1400 W can still supply Mii');
    assert.ok(targets.watts[0] + targets.reserve[1] <= 6000);
});

test('donor reduction reserves actual high-water draw before priority gets more watts', () => {
    const h = engine({production: true}); h.exclude(2);
    h.owned(0, 6); h.owned(1, 20);
    h.put('DP_WB1_SOC', 10);
    const targets = h.update(6000, 6000);
    assert.equal(targets.amps[1], 6, 'low-priority donor is reduced towards its floor');
    assert.ok(targets.reserve[1] >= 4600);
    assert.ok(targets.watts[0] + targets.reserve[1] <= 6000,
        'nominally freed watts are unavailable before vehicle response');
});

test('heater receives unused quantization residual, never a second copy of car watts', () => {
    const h = engine(); h.exclude(2);
    h.put('ems.0.Devices.MyPV_DHW.Release', true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W', 9000);
    h.put('DP_DHW_PARALLEL_RELEASE', false);
    h.put('ems.0.Vehicles.Wallbox0.MaxCurrent1P_A', 6);
    h.put('ems.0.Vehicles.Wallbox1.MaxCurrent1P_A', 6);
    const targets = h.update(4000);
    assert.deepEqual(targets.amps, [6, 6, 0]);
    assert.equal(targets.dhw, 1240);
    assert.equal(targets.dhw + targets.watts.reduce((a, b) => a + b, 0), 4000);
});

test('existing productive heater reserve does not subtract twice from its own 4.2 kW target', () => {
    for (const reserveW of [0, 2000, 3000, 4200]) {
        const h = engine({production: true, dhwControlEnabled: true});
        for (let wb = 0; wb < 3; wb++) h.exclude(wb);
        h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', reserveW);
        h.put('DP_DHW_OUTPUT1', reserveW);
        const targets = h.update(4200, 4200);
        assert.equal(targets.dhw, 4200, `${reserveW} W already reserved by this same heater`);
        assert.deepEqual(targets.amps, [0, 0, 0]);
    }
});

test('minimum-SoC floors can request heater reduction and start once its physical reserve falls', () => {
    const h = engine({production: true, dhwControlEnabled: true}); h.exclude(2);
    h.put('DP_WB0_SOC', 10); h.put('DP_WB1_SOC', 10);
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 2000);
    h.put('DP_DHW_OUTPUT1', 2000);
    let targets = h.update(4200, 4200);
    const allocation = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.equal(allocation.minimumTotalW, 2760, 'both whole minimum floors remain the desired allocation');
    assert.ok(targets.dhw <= 1440, 'reduce the heater to make room for the two minimum charges');
    assert.ok(targets.watts.reduce((sum, watts) => sum + watts, 0) + 2000 <= 4200,
        'the old heater draw stays reserved while its reduction is pending');
    assert.ok(targets.amps.slice(0, 2).includes(0), 'insufficient physical headroom delays a new charger');
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 1440);
    h.put('DP_DHW_OUTPUT1', 1440);
    targets = h.update(4200, 4200);
    assert.deepEqual(targets.amps, [6, 6, 0], 'fresh heater reduction releases both 6 A floors');
    assert.ok(targets.dhw + targets.watts.reduce((sum, watts) => sum + watts, 0) <= 4200);
});

test('coordinated battery keeps the 4.2 kW global cap separate from the 3.2 kW slow-load budget', () => {
    const h = engine({production: true}); h.exclude(2);
    h.put('DP_WB0_SOC', 10); h.put('DP_WB1_SOC', 10);
    h.put('ems.0.Control.Targets.Battery_W', 1000);
    const targets = h.update(0, 3200, {valueW: 0}, {heaterCapW: 0, consumptionBudgetW: 4200});
    const allocation = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.equal(allocation.hardBudgetW, 4200, 'output authorization retains the shared global device cap');
    assert.equal(allocation.slowBudgetW, 3200, 'battery commitment reduces the available slow-load pool');
    assert.deepEqual(targets.amps, [6, 6, 0]);
    assert.equal(targets.watts.reduce((sum, watts) => sum + watts, 0), 2760);
    assert.ok(targets.watts.reduce((sum, watts) => sum + watts, 0) + 1000 <= allocation.hardBudgetW);
});

test('secondary minimum-SoC car requests one phase only under EMS phase authority', () => {
    for (const authority of ['ems', 'script']) {
        const h = engine({production: true, wb1PhaseControlMode: authority,
            wb1PhaseModeId: 'raw.phase1'});
        h.exclude(2);
        h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled', true);
        h.put('ems.0.Vehicles.Wallbox1.MaximumPhases', 3);
        h.put('raw.phase1', 2);
        h.put('DP_WB1_SOC', 10);
        h.put('ems.0.Devices.Wallbox1.OutputPhases', 3);
        const targets = h.update(6000);
        assert.equal(targets.phases[1], authority === 'ems' ? 1 : 3, authority);
        assert.equal(h.states.get('raw.phase1').val, 2,
            'requesting a phase never fabricates a device ACK or writes its original source');
    }
});

test('one-to-three-phase preparation lowers EQV current and waits for its physical response', () => {
    const h = engine({production: true, wallboxPriority: 1,
        wb1PhaseControlMode: 'ems', wb1PhaseModeId: 'raw.phase1',
        phaseSwitchRealUpDelayS: 30, phaseSwitchMinHoldMin: 30});
    h.exclude(2);
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled', true);
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases', 3);
    h.put('ems.0.Vehicles.Wallbox1.MaxCurrent3P_A', 11);
    h.put('ems.0.Config.Wallbox1MaxPower_W', 7590);
    h.put('raw.phase1', 1);
    h.put('DP_WB0_SOC', 10);
    h.owned(1, 32, 7360, 1);
    h.plans[1] = {valueW: 7590, phases: 3};
    // The budget has already qualified for 30 seconds. The point of this
    // regression is the topology/response interlock after that qualification.
    h.run(`wallboxRealPhaseEpisode[1] = true;
        stableWallboxPhases[1] = 1;
        wallboxRealPhaseCandidate[1] = {phase: 3, since: Date.now()-31000, lastObservationAt: Date.now()};
        lastRealPhaseChangeAt[1] = 0; lastPhaseChangeAt[1] = 0;`);
    const beganAt = Date.now();
    let targets = h.update(15000, 15000);
    assert.equal(targets.phases[1], 1, '32 A cannot become a 22 kW three-phase request');
    assert.ok(targets.amps[1] <= 11, 'prepare the configured three-phase ampere ceiling first');
    assert.equal(h.states.get('raw.phase1').val, 1);
    assert.equal(h.run('lastRealPhaseChangeAt[1]'), 0,
        'current preparation has not issued a phase request and cannot start its hold');
    assert.equal(h.run('lastPhaseChangeAt[1]'), 0);

    // Current-register ACK alone is insufficient: the car still draws 32 A.
    h.owned(1, 11, 7360, 1);
    targets = h.update(15000, 15000);
    assert.equal(targets.phases[1], 1, 'await the independent vehicle response after ACK');
    assert.ok(targets.amps[1] <= 11, 'retained preparation cannot ramp back up in one-phase mode');
    assert.equal(h.run('lastRealPhaseChangeAt[1]'), 0);

    h.owned(1, 11, 2530, 1);
    targets = h.update(15000, 15000);
    assert.equal(targets.phases[1], 3, 'fresh one-phase 11 A response permits the prepared switch');
    assert.ok(targets.amps[1] <= 11);
    assert.ok(h.run('lastRealPhaseChangeAt[1]') >= beganAt,
        'the real phase hold starts only when the qualified 3P request is issued');
    assert.equal(h.states.get('raw.phase1').val, 1,
        'an EMS phase request never changes confirmed hardware evidence');
});

test('three-phase preparation cannot certify missing or bad-quality house phase evidence', () => {
    for (const cause of ['missing', 'quality', 'unconfirmed']) {
        const h = engine({production: true, wallboxPriority: 1,
            wb1PhaseControlMode: 'ems', wb1PhaseModeId: 'raw.phase1',
            phaseSwitchRealUpDelayS: 30, phaseSwitchMinHoldMin: 0});
        h.exclude(0); h.exclude(2);
        h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled', true);
        h.put('ems.0.Vehicles.Wallbox1.MaximumPhases', 3);
        h.put('ems.0.Vehicles.Wallbox1.MaxCurrent3P_A', 11);
        h.put('ems.0.Config.Wallbox1MaxPower_W', 7590);
        h.put('raw.phase1', 1); h.owned(1, 11, 2530, 1);
        h.plans[1] = {valueW: 7590, phases: 3};
        if (cause === 'missing') h.states.delete('DP_HA_L3_IMPORT_W');
        if (cause === 'quality') h.put('DP_HA_L3_IMPORT_W', 0, {q: 64});
        if (cause === 'unconfirmed') h.put('DP_HA_L3_IMPORT_W', 0, {ack: false});
        h.run(`wallboxRealPhaseEpisode[1] = true; stableWallboxPhases[1] = 1;
            wallboxRealPhaseCandidate[1] = {phase: 3, since: Date.now()-31000, lastObservationAt: Date.now()};
            lastRealPhaseChangeAt[1] = 0;`);
        const targets = h.update(15000, 15000);
        assert.equal(targets.phases[1], 1, cause);
        assert.equal(h.states.get('raw.phase1').val, 1, cause);
    }
});

test('explicitly disabled policy retains the previous single-wallbox contract', () => {
    const h = engine({wallboxParallelChargingEnabled: false});
    const targets = h.update(20000);
    assert.equal(targets.amps.filter(a => a > 0).length, 1);
});
