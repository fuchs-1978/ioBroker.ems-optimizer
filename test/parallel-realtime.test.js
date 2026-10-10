'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {SMA_GRID_MAX_AGE_MS} = require('../lib/source-diagnostics');

// Exercise the production engine files, with explicit source snapshots rather
// than fabricated derived eligibility. No output-driver or ioBroker writes run.
function engine({production = false, clock = Date, ...config} = {}) {
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
    const put = (id, val, overrides = {}) => states.set(id, {val, ts: clock.now(), ack: true, q: 0, ...overrides});
    const ctx = vm.createContext({nativeConfig, SMA_GRID_MAX_AGE_MS, Date: clock, console,
        gridConstraints: require('../lib/grid-constraints'),
        normalizeWallboxPowerKW: require('../lib/wallbox-measurement').normalizeWallboxPowerKW,
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

test('issue123 mandatory running allocation uses measured response and preserves its mandatory floor', () => {
    const h = engine({production: true}); h.exclude(1); h.exclude(2);
    h.put('DP_WB0_SOC', 10); h.owned(0, 9, 1290);
    h.update(1657);
    let diagnostic = JSON.parse(h.states.get('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON').val);
    assert.equal(diagnostic.actualPowerW, 1290);
    assert.equal(diagnostic.responseBasis, 'power-response');
    assert.equal(diagnostic.deltaW, 367);
    assert.ok(diagnostic.measuredPowerAt > 0);
    h.owned(0, 6, 1700);
    const targets = h.update(0, 4200);
    assert.equal(targets.amps[0], 6, 'measured overshoot cannot erase an admitted mandatory floor');
    diagnostic = JSON.parse(h.states.get('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON').val);
    assert.equal(diagnostic.actualPowerW, 1700);
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

test('finishing Mii minimum charge does not interrupt the already charging EQV floor', () => {
    for (const hardW of [Infinity, 4200]) {
        const h = engine({production: true}); h.exclude(2);
        h.put('ems.0.Config.WallboxStopDelay_s', 600);
        h.put('ems.0.Config.Wallbox0PriceChargingEnabled', false);
        h.put('ems.0.Config.Wallbox1PriceChargingEnabled', false);
        h.put('DP_WB0_SOC', 70.2); h.put('DP_WB0_MIN_SOC', 70);
        h.put('DP_WB1_SOC', 79); h.put('DP_WB1_MIN_SOC', 80);
        h.owned(0, 6); h.owned(1, 6);

        // Reproduce 09 October 03:01: Mii has met its minimum, but its real
        // 6 A remains committed until the productive stop/response completes.
        const targets = h.update(0, hardW);
        assert.deepEqual(targets.amps, [0, 6, 0], `${hardW} W hard limit`);
        assert.equal(targets.reserve[0], 1380, 'the Mii stop delay does not release physical watts');
        assert.equal(targets.reserve[1], 1380, 'the EQV remains on its own minimum charge');
        assert.equal(targets.dhw, 0, 'mandatory grid charging is not heater surplus');
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputCommand_A').val, 6,
            'the allocator does not fabricate the Mii OFF acknowledgement');
        assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputCommand_A').val, 6,
            'allocation does not write productive ampere commands');
    }
});

test('one finishing car preserves both running minimum charges regardless of priority order', () => {
    for (const finishing of [0, 1, 2]) {
        const h = engine({production: true, wallboxPriority: (finishing + 1) % 3});
        for (let wb = 0; wb < 3; wb++) {
            h.put(`DP_WB${wb}_SOC`, wb === finishing ? 70.2 : 69);
            h.put(`DP_WB${wb}_MIN_SOC`, 70);
            h.put(`ems.0.Config.Wallbox${wb}PriceChargingEnabled`, false);
            h.owned(wb, 6);
        }
        const targets = h.update(0, 4200);
        assert.deepEqual(targets.amps, [0, 1, 2].map(wb => wb === finishing ? 0 : 6),
            `finishing Wallbox${finishing}`);
        assert.deepEqual(targets.reserve, [1380, 1380, 1380]);
        assert.ok(targets.reserve.reduce((sum, watts) => sum + watts, 0) <= 4200,
            'three outstanding physical floors still fit the actual hard cap');
    }
});

test('continuing minimum charge still waits for physical headroom under a real hard cap', () => {
    for (const {hardW, heaterW} of [{hardW: 2500, heaterW: 0}, {hardW: 4200, heaterW: 1500}]) {
        const h = engine({production: true, dhwControlEnabled: heaterW > 0}); h.exclude(2);
        h.put('DP_WB0_SOC', 70.2); h.put('DP_WB0_MIN_SOC', 70);
        h.put('DP_WB1_SOC', 79); h.put('DP_WB1_MIN_SOC', 80);
        h.owned(0, 6); h.owned(1, 6);
        h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', heaterW);
        h.put('DP_DHW_OUTPUT1', heaterW);
        let targets = h.update(0, hardW);
        assert.deepEqual(targets.amps, [0, 0, 0], `${hardW} W hard cap with ${heaterW} W heater reserve`);
        assert.equal(targets.reserve[0], 1380, 'a pending stop cannot free its physical reservation');

        h.put('ems.0.Devices.Wallbox0.OutputActive', false);
        h.put('ems.0.Devices.Wallbox0.OutputOwned', false);
        h.put('ems.0.Devices.Wallbox0.OutputCommand_A', 0);
        h.put('DP_WB0_POWER', 0); h.put('DP_WB0_L1_A', 0);
        h.put('raw.allow0', 0); h.put('raw.amps0', 0);
        targets = h.update(0, hardW);
        assert.deepEqual(targets.amps, [0, 6, 0], 'confirmed physical Mii OFF restores enough headroom');
        assert.equal(targets.reserve[0], 0);
        assert.ok(targets.reserve[1] + heaterW <= hardW);
    }
});

test('a new inactive minimum charge cannot reuse another cars pending stop reservation', () => {
    const h = engine({production: true}); h.exclude(2);
    h.put('DP_WB0_SOC', 70.2); h.put('DP_WB0_MIN_SOC', 70);
    h.put('DP_WB1_SOC', 79); h.put('DP_WB1_MIN_SOC', 80);
    h.owned(0, 6);
    let targets = h.update(0, 4200);
    assert.deepEqual(targets.amps, [0, 0, 0], 'continuation protection must not authorize a new start');
    assert.equal(targets.reserve[0], 1380);

    h.put('ems.0.Devices.Wallbox0.OutputActive', false);
    h.put('ems.0.Devices.Wallbox0.OutputOwned', false);
    h.put('ems.0.Devices.Wallbox0.OutputCommand_A', 0);
    h.put('DP_WB0_POWER', 0); h.put('DP_WB0_L1_A', 0);
    h.put('raw.allow0', 0); h.put('raw.amps0', 0);
    targets = h.update(0, 4200);
    assert.deepEqual(targets.amps, [0, 6, 0], 'a new minimum charge can start once old watts are really free');
});

test('running minimum floor protection never bypasses invalid productive sources', () => {
    for (const cause of ['stale-power', 'unconfirmed-car', 'bad-quality-error']) {
        const h = engine({production: true}); h.exclude(2);
        h.put('DP_WB0_SOC', 70.2); h.put('DP_WB0_MIN_SOC', 70);
        h.put('DP_WB1_SOC', 79); h.put('DP_WB1_MIN_SOC', 80);
        h.owned(0, 6); h.owned(1, 6);
        if (cause === 'stale-power') h.put('DP_WB1_POWER', 1.38, {ts: Date.now() - 31000});
        if (cause === 'unconfirmed-car') h.put('DP_WB1_CAR', 2, {ack: false});
        if (cause === 'bad-quality-error') h.put('raw.error1', 0, {q: 64});
        const targets = h.update(0, 4200);
        assert.equal(targets.amps[1], 0, cause);
        assert.equal(targets.reserve[1], 1380, `${cause}: unknown physical load stays reserved`);
        const allocation = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
        assert.equal(allocation.allocations.find(item => item.wb === 1).authorized, false, cause);
    }
});

test('running minimum continuation cannot authorize a different topology or unconfirmed allow', () => {
    for (const cause of ['three-phase', 'phase-pending', 'phase-transition', 'allow-command-echo']) {
        const h = engine({production: true, wb1PhaseControlMode: 'ems', wb1PhaseModeId: 'raw.phase1'});
        h.exclude(2);
        h.put('DP_WB0_SOC', 70.2); h.put('DP_WB0_MIN_SOC', 70);
        h.put('DP_WB1_SOC', 79); h.put('DP_WB1_MIN_SOC', 80);
        h.owned(0, 6); h.owned(1, 6);
        h.put('raw.phase1', 1);
        if (cause === 'three-phase') {
            h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled', true);
            h.put('ems.0.Vehicles.Wallbox1.MaximumPhases', 3);
            h.put('raw.phase1', 2);
            h.owned(1, 6, 4140, 3);
            h.plans[1] = {valueW: 0, phases: 3};
        }
        if (cause === 'phase-pending') h.put('ems.0.Devices.Wallbox1.PhaseSwitchPending', true);
        if (cause === 'phase-transition') h.put('ems.0.Devices.Wallbox1.PhaseTransitionActive', true);
        if (cause === 'allow-command-echo') h.put('raw.allow1', 1, {ack: false});

        // No restrictive hard cap: a zero target must come from the narrow
        // continuation/feedback gate, not accidentally from capacity denial.
        const targets = h.update(0, Infinity);
        assert.equal(targets.amps[1], 0, cause);
        assert.equal(targets.reserve[1], cause === 'three-phase' ? 4140 : 1380,
            `${cause}: physical commitment is retained until real response`);
    }
});

// Preserve a start the real output driver has already authorized. Its own
// 6 A reservation is not a second copy of the EQE's pending physical draw.
function pendingMinimumStartFixture(stage = 'allow', {hardW = 4200, heaterW = 0} = {}) {
    const h = engine({production: true, wallboxPriority: 1, dhwControlEnabled: heaterW > 0});
    h.exclude(0);
    h.put('DP_WB1_SOC', 85); h.put('DP_WB1_MIN_SOC', 90); h.put('DP_WB1_TARGET', 100);
    h.put('DP_WB2_SOC', 90); h.put('DP_WB2_MIN_SOC', 95); h.put('DP_WB2_TARGET', 100);
    h.owned(2, 6);
    assert.deepEqual(h.update(0, 4200).amps, [0, 6, 6],
        'both minimum floors are granted before the real start begins');
    const now = Date.now();
    h.put('ems.0.Devices.Wallbox1.OutputOwned', true);
    h.put('ems.0.Devices.Wallbox1.OutputActive', stage === 'vehicle_response');
    h.put('ems.0.Devices.Wallbox1.OutputCommand_A', stage === 'vehicle_response' ? 6 : 0);
    h.put('ems.0.Devices.Wallbox1.OutputReservedPower_W', 1380);
    h.put('raw.allow1', ['allow', 'vehicle_response'].includes(stage) ? 1 : 0);
    h.put('raw.amps1', stage === 'stop' ? 0 : 6);
    h.put('ems.0.Devices.Wallbox1.OutputStartReservation_JSON', JSON.stringify({schema: 1,
        pending: true, stage, amps: 6, phases: 1, stageAt: now - 2000,
        validUntil: now - 2000 + (stage === 'vehicle_response' ? 45000 : 20000)}));
    // Reproduce 09 October 16:34:36-38: lowering EQE's minimum from 95 to
    // its already attained 90 removes that floor while its 6 A still exist.
    h.put('DP_WB2_MIN_SOC', 90);
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', heaterW);
    h.put('DP_DHW_OUTPUT1', heaterW);
    return {h, hardW};
}

test('EQE minimum removal preserves the already reserved EQV asynchronous minimum start', () => {
    for (const stage of ['current', 'allow', 'vehicle_response']) {
        const {h, hardW} = pendingMinimumStartFixture(stage);
        const targets = h.update(0, hardW);
        assert.deepEqual(targets.amps, [0, 6, 0], stage);
        assert.deepEqual(targets.reserve, [0, 1380, 1380],
            `${stage}: each car keeps its own outstanding 1380 W exactly once`);
        assert.equal(targets.dhw, 0, 'grid minimums do not create heater surplus');
        const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
        assert.equal(grant.allocations.find(entry => entry.wb === 1).pendingMinimumStartW, 1380,
            'the shared diagnostic identifies an existing pending reservation, not free PV');
        assert.equal(h.states.get('ems.0.Devices.Wallbox2.OutputActive').val, true,
            'allocation does not manufacture donor electrical OFF');
        assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputCommand_A').val,
            stage === 'vehicle_response' ? 6 : 0, 'allocation never writes real current');
    }
});

test('ordinary Modbus command ACK waits do not cancel a reserved pending minimum start', () => {
    for (const stage of ['current', 'allow']) {
        const {h} = pendingMinimumStartFixture(stage);
        const awaitingId = stage === 'current' ? 'raw.amps1' : 'raw.allow1';
        h.put(awaitingId, stage === 'current' ? 6 : 1, {ack: false});
        assert.equal(h.update(0, 4200).amps[1], 6, `${stage}: ordinary write echo is not final feedback`);
    }
});

test('acknowledged initial ON retains a minimum only within its genuine vehicle-response proof', () => {
    for (const cause of ['good', 'unconfirmed-allow', 'old-allow', 'unconfirmed-current', 'changed-current', 'expired']) {
        const {h} = pendingMinimumStartFixture('vehicle_response');
        const proofId = 'ems.0.Devices.Wallbox1.OutputStartReservation_JSON';
        const proof = JSON.parse(h.states.get(proofId).val);
        if (cause === 'unconfirmed-allow') h.put('raw.allow1', 1, {ack: false});
        if (cause === 'old-allow') h.put('raw.allow1', 1, {ts: proof.stageAt - 1});
        if (cause === 'unconfirmed-current') h.put('raw.amps1', 6, {ack: false});
        if (cause === 'changed-current') h.put('raw.amps1', 7);
        if (cause === 'expired') h.put(proofId, JSON.stringify({...proof,
            stageAt: Date.now() - 46000, validUntil: Date.now() - 1000}));
        assert.equal(h.update(0, 4200).amps[1], cause === 'good' ? 6 : 0, cause);
    }
    const {h} = pendingMinimumStartFixture('vehicle_response');
    h.owned(1, 6);
    h.put('ems.0.Devices.Wallbox1.OutputStartReservation_JSON', JSON.stringify({schema: 1, pending: false}));
    assert.equal(h.update(0, 4200).amps[1], 6, 'real vehicle draw restores the established running-floor path');
});

test('pending minimum-start preservation remains subordinate to real hard and heater reservations', () => {
    for (const limits of [{hardW: 2500, heaterW: 0}, {hardW: 4200, heaterW: 1500}]) {
        const {h, hardW} = pendingMinimumStartFixture('allow', limits);
        const targets = h.update(0, hardW);
        assert.equal(targets.amps[1], 0, JSON.stringify(limits));
        assert.equal(targets.reserve[2], 1380, 'EQE physical reservation stays accounted for');
        assert.equal(targets.reserve[1], 1380, 'unknown pending own power is not declared free');
    }
});

test('only a current bounded own start proof retains an asynchronous minimum floor', () => {
    for (const cause of ['no-proof', 'not-pending', 'stop-stage', 'expired', 'future-stage',
        'unconfirmed-proof', 'bad-quality-proof', 'no-reservation', 'not-owned',
        'no-minimum-need', 'stale-power', 'unconfirmed-car', 'bad-quality-error',
        'phase-pending', 'phase-transition', 'unconfirmed-phase', 'bad-quality-allow',
        'stale-allow', 'future-current', 'missing-current', 'extended-command-deadline']) {
        const {h} = pendingMinimumStartFixture('allow');
        const id = 'ems.0.Devices.Wallbox1.OutputStartReservation_JSON';
        const proof = JSON.parse(h.states.get(id).val);
        if (cause === 'no-proof') h.states.delete(id);
        if (cause === 'not-pending') h.put(id, JSON.stringify({...proof, pending: false}));
        if (cause === 'stop-stage') h.put(id, JSON.stringify({...proof, stage: 'stopping'}));
        if (cause === 'expired') h.put(id, JSON.stringify({...proof,
            stageAt: Date.now() - 21000, validUntil: Date.now() - 1000}));
        if (cause === 'future-stage') h.put(id, JSON.stringify({...proof, stageAt: Date.now() + 2000}));
        if (cause === 'unconfirmed-proof') h.put(id, JSON.stringify(proof), {ack: false});
        if (cause === 'bad-quality-proof') h.put(id, JSON.stringify(proof), {q: 64});
        if (cause === 'no-reservation') h.put('ems.0.Devices.Wallbox1.OutputReservedPower_W', 0);
        if (cause === 'not-owned') h.put('ems.0.Devices.Wallbox1.OutputOwned', false);
        if (cause === 'no-minimum-need') h.put('DP_WB1_SOC', 90);
        if (cause === 'stale-power') h.put('DP_WB1_POWER', 0, {ts: Date.now() - 31000});
        if (cause === 'unconfirmed-car') h.put('DP_WB1_CAR', 2, {ack: false});
        if (cause === 'bad-quality-error') h.put('raw.error1', 0, {q: 64});
        if (cause === 'phase-pending') h.put('ems.0.Devices.Wallbox1.PhaseSwitchPending', true);
        if (cause === 'phase-transition') h.put('ems.0.Devices.Wallbox1.PhaseTransitionActive', true);
        if (cause === 'unconfirmed-phase') h.put('DP_WB1_PHASE_MODE', 1, {ack: false});
        if (cause === 'bad-quality-allow') h.put('raw.allow1', 1, {q: 64});
        if (cause === 'stale-allow') h.put('raw.allow1', 1, {ts: Date.now() - 31000});
        if (cause === 'future-current') h.put('raw.amps1', 6, {ts: Date.now() + 2000});
        if (cause === 'missing-current') h.states.delete('raw.amps1');
        if (cause === 'extended-command-deadline') h.put(id, JSON.stringify({...proof,
            validUntil: proof.stageAt + 21000}));
        assert.equal(h.update(0, Infinity).amps[1], 0, cause);
    }
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

test('parallel provenance never labels mandatory grid floors as available PV', () => {
    const h = engine({production: true}); h.exclude(2);
    h.put('DP_WB0_SOC', 10); h.put('DP_WB1_SOC', 10);
    h.owned(0, 6); h.owned(1, 6);
    let targets = h.update(0, 6000);
    let grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.deepEqual(targets.amps, [6, 6, 0]);
    assert.deepEqual(grant.allocations.map(entry => entry.pvBudgetW), [0, 0, 0],
        'the forced grid floors authorize charging, but are not PV continuation proof');
    targets = h.update(4140, 6000);
    grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.ok(grant.allocations.reduce((sum, entry) => sum + entry.pvBudgetW, 0) <= 4140);
    for (const entry of grant.allocations) {
        assert.ok(entry.pvBudgetW >= 0 && entry.pvBudgetW <= targets.watts[entry.wb]);
        if (entry.authorized)
            assert.equal(JSON.parse(h.states.get(`ems.0.Control.Wallbox${entry.wb}.AllocationDiagnostics_JSON`).val).pvBudgetW,
                entry.pvBudgetW, 'the per-car explanation uses the same independent PV share');
    }
});

test('PV continuation proof uses confirmed three-phase capacity rather than the smaller one-phase cap', () => {
    const h = engine({production: true, wallboxPriority: 1,
        wb1PhaseControlMode: 'script', wb1PhaseModeId: 'raw.phase1'});
    h.exclude(0); h.exclude(2);
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled', true);
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases', 3);
    h.put('ems.0.Vehicles.Wallbox1.MaxCurrent1P_A', 6);
    h.put('raw.phase1', 2); h.owned(1, 6, 4140, 3);
    const targets = h.update(4140);
    const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.equal(targets.phases[1], 3);
    assert.equal(targets.amps[1], 6);
    assert.equal(grant.allocations.find(entry => entry.wb === 1).pvBudgetW, 4140,
        'a valid 6 A three-phase PV session needs 4140 W of continuation proof');
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

// The allocator consumes independent output facts. These fixtures deliberately
// do not call a handoff helper or inject its private proof: the engine must see
// an idle donor, a real running episode, target-SoC completion, then the output
// guard's OFF/quiet ownership release in successive allocation cycles.
function completedParallelChargeFixture({observeIdle = true} = {}) {
    let at = Date.now();
    class Clock extends Date { static now() { return at; } }
    const h = engine({production: true, clock: Clock, wallboxPriority: 1,
        wb2PhaseControlMode: 'ems', wb2PhaseModeId: 'raw.phase2'});
    h.exclude(0);
    h.put('DP_WB1_SOC', 90); h.put('DP_WB1_TARGET', 100);
    h.put('DP_WB2_SOC', 90); h.put('DP_WB2_TARGET', 100);
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled', true);
    h.put('ems.0.Vehicles.Wallbox2.MaximumPhases', 3);
    h.put('raw.phase2', 1);
    h.put('DP_WB2_ALLOW', false);
    const step = (mutate = () => {}, watts = 4600, hard = 4600) => {
        at += 1000;
        for (const state of h.states.values()) state.ts = at;
        mutate();
        return h.update(watts, hard);
    };
    if (!observeIdle) h.owned(1, 20, 4600);
    h.update(4600, 4600);
    step(() => h.owned(1, 20, 4600));
    h.put('ems.0.Config.WallboxStartDelay_s', 300);
    step(() => h.put('DP_WB2_ALLOW', true));
    const diagnostic = wb => JSON.parse(h.states.get(
        `ems.0.Control.Wallbox${wb}.AllocationDiagnostics_JSON`).val);
    const complete = () => step(() => h.put('DP_WB1_SOC', 100));
    const acknowledgeStop = (watts = 4600, hard = 4600) => step(() => {
        h.put('ems.0.Devices.Wallbox1.OutputActive', false);
        h.put('ems.0.Devices.Wallbox1.OutputCommand_A', 0);
        h.put('ems.0.Devices.Wallbox1.OutputReservedPower_W', 4600);
        h.put('ems.0.Devices.Wallbox1.OutputStopPowerPending', true);
        h.put('raw.allow1', 0);
        h.put('ems.0.Devices.Wallbox1.OutputStopConfirmedAt', at);
    }, watts, hard);
    const releaseQuiet = () => {
        h.put('ems.0.Devices.Wallbox1.OutputActive', false);
        h.put('ems.0.Devices.Wallbox1.OutputOwned', false);
        h.put('ems.0.Devices.Wallbox1.OutputReservedPower_W', 0);
        h.put('ems.0.Devices.Wallbox1.OutputStopPowerPending', false);
        h.put('raw.allow1', 0); h.put('raw.amps1', 0);
        h.put('DP_WB1_POWER', 0); h.put('DP_WB1_CAR', 4);
        for (const phase of [1, 2, 3]) h.put(`DP_WB1_L${phase}_A`, 0);
    };
    return {...h, step, diagnostic, complete, acknowledgeStop, releaseQuiet,
        advance: ms => { at += ms; }, now: () => at};
}

test('parallel target-SoC completion transfers an observed charge without another 300 second start delay', () => {
    const h = completedParallelChargeFixture();
    let targets = h.complete();
    assert.equal(targets.amps[1], 0, 'the completed EQV receives no new target');
    assert.equal(targets.amps[2], 0, 'the recipient cannot spend the still running EQV watts');
    assert.equal(targets.reserve[1], 4600, 'the entire physical donor draw stays reserved');
    targets = h.acknowledgeStop();
    assert.equal(targets.amps[2], 0, 'OFF register ACK is not electrical rest');
    assert.equal(targets.reserve[1], 4600, 'post-ACK draw stays reserved');
    targets = h.step(h.releaseQuiet);
    assert.ok(targets.amps[2] >= 6, 'fresh confirmed OFF and quiet release permit the already prepared EQE');
    assert.equal(h.diagnostic(2).start.reason, 'prepared-vehicle-handoff');
    assert.equal(h.states.get('ems.0.Vehicles.Wallbox2.StartDelayRemaining_s').val, 0);
    assert.equal(h.states.get('ems.0.Config.WallboxStartDelay_s').val, 300,
        'the ordinary timer configuration is unchanged');
    assert.ok(targets.watts.reduce((sum, watts) => sum + watts, 0) <= 4600);
});

test('a target-SoC completion with no observed idle-to-running donor cannot waive the ordinary timer', () => {
    const h = completedParallelChargeFixture({observeIdle: false});
    h.complete(); h.acknowledgeStop();
    const targets = h.step(h.releaseQuiet);
    assert.equal(targets.amps[2], 0, 'retained startup output is not an observed charge qualification');
    assert.ok(h.states.get('ems.0.Vehicles.Wallbox2.StartDelayRemaining_s').val > 0);
});

test('unrelated new starts retain 300 seconds after a below-target donor loses release or is disabled', () => {
    for (const cause of ['user-release', 'device-disabled']) {
        const h = completedParallelChargeFixture();
        h.step(() => {
            if (cause === 'user-release') h.put('DP_WB1_ALLOW', false);
            else h.put('ems.0.Devices.Wallbox1.Present', false);
        });
        h.acknowledgeStop();
        const targets = h.step(h.releaseQuiet);
        assert.equal(targets.amps[2], 0, cause);
        assert.ok(h.states.get('ems.0.Vehicles.Wallbox2.StartDelayRemaining_s').val > 0, cause);
    }
});

test('automatic completion handoff does not bypass independent donor OFF or electrical evidence', () => {
    for (const cause of ['unconfirmed-off', 'bad-quality-off', 'stale-off', 'power-still-positive',
        'phase-current-still-positive', 'retained-ownership', 'phase-transition']) {
        const h = completedParallelChargeFixture();
        h.complete(); h.acknowledgeStop();
        const targets = h.step(() => {
            h.releaseQuiet();
            if (cause === 'unconfirmed-off') h.put('raw.allow1', 0, {ack: false});
            if (cause === 'bad-quality-off') h.put('raw.allow1', 0, {q: 64});
            if (cause === 'stale-off') h.put('raw.allow1', 0, {ts: h.now() - 31000});
            if (cause === 'power-still-positive') h.put('DP_WB1_POWER', 0.3);
            if (cause === 'phase-current-still-positive') h.put('DP_WB1_L3_A', 1.3);
            if (cause === 'retained-ownership') h.put('ems.0.Devices.Wallbox1.OutputOwned', true);
            if (cause === 'phase-transition') h.put('ems.0.Devices.Wallbox1.PhaseTransitionActive', true);
        });
        assert.equal(targets.amps[2], 0, cause);
    }
});

test('automatic completion handoff keeps recipient phase, quality, release and safety gates binding', () => {
    for (const cause of ['recipient-release', 'recipient-target', 'recipient-error', 'unconfirmed-phase',
        'bad-phase-quality', 'future-phase', 'unsupported-phase',
        'phase-pending', 'grid-quality', 'hard-cap', 'heater-reserve']) {
        const h = completedParallelChargeFixture();
        h.complete(); h.acknowledgeStop();
        const targets = h.step(() => {
            h.releaseQuiet();
            if (cause === 'recipient-release') h.put('DP_WB2_ALLOW', false);
            if (cause === 'recipient-target') h.put('DP_WB2_SOC', 100);
            if (cause === 'recipient-error') h.put('raw.error2', 5);
            if (cause === 'unconfirmed-phase') h.put('raw.phase2', 1, {ack: false});
            if (cause === 'bad-phase-quality') h.put('raw.phase2', 1, {q: 64});
            if (cause === 'future-phase') h.put('raw.phase2', 1, {ts: h.now() + 2000});
            if (cause === 'unsupported-phase') h.put('raw.phase2', 0);
            if (cause === 'phase-pending') h.put('ems.0.Devices.Wallbox2.PhaseSwitchPending', true);
            if (cause === 'grid-quality') h.put('DP_GRID_IMPORT', 0, {q: 64});
            if (cause === 'heater-reserve') h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 3500);
        }, 4600, cause === 'hard-cap' ? 1000 : 4600);
        assert.equal(targets.amps[2], 0, cause);
    }
});

test('automatic completion accepts an old independently confirmed retained go-e phase mode', () => {
    const h = completedParallelChargeFixture();
    h.complete(); h.acknowledgeStop();
    const targets = h.step(() => {
        h.releaseQuiet();
        h.put('raw.phase2', 1, {ts: h.now() - 3600000});
    });
    assert.ok(targets.amps[2] >= 6,
        'psm is a retained mode: old confirmed topology alone is not a missing periodic measurement');
    assert.equal(h.diagnostic(2).start.reason, 'prepared-vehicle-handoff');
});

test('automatic target completion preserves a different running mandatory floor and its physical reservation', () => {
    const h = completedParallelChargeFixture();
    let targets = h.step(() => {
        h.put('DP_WB1_SOC', 100);
        h.put('ems.0.Devices.Wallbox0.Present', true);
        h.put('DP_WB0_SOC', 10);
        h.put('ems.0.Vehicles.Wallbox0.MaxCurrent1P_A', 6);
        h.owned(0, 6, 1380);
    }, 5980, 5980);
    assert.equal(targets.amps[0], 6, 'the already charging mandatory peer is not a replacement donor');
    assert.equal(targets.amps[2], 0, 'the EQV reservation plus Mii floor leave no premature recipient budget');
    h.acknowledgeStop(5980, 5980);
    targets = h.step(h.releaseQuiet, 5980, 5980);
    assert.equal(targets.amps[0], 6, 'the Mii minimum is preserved after EQV target completion');
    assert.ok(targets.amps[2] >= 6, 'the highest eligible inactive car can receive the completed charge');
    assert.ok(targets.reserve[0] >= 1380);
    assert.ok(targets.watts[2] + targets.reserve[0] <= 5980,
        'the waiting recipient cannot consume an independent running peers watts');
});

test('automatic completion never derives target attainment from missing or invalid SoC samples', () => {
    for (const cause of ['null', 'unconfirmed', 'quality', 'future']) {
        const h = completedParallelChargeFixture();
        h.step(() => h.put('DP_WB1_SOC', cause === 'null' ? null : 100,
            cause === 'unconfirmed' ? {ack: false} : cause === 'quality' ? {q: 64}
                : cause === 'future' ? {ts: h.now() + 2000} : {}));
        h.acknowledgeStop();
        const targets = h.step(h.releaseQuiet);
        assert.equal(targets.amps[2], 0, cause);
    }
});

test('natural target completion at the first quiet poll preserves only a previously qualified donor episode', () => {
    for (const cause of ['good', 'bounded-zero-noise', 'unconfirmed-power', 'bad-current-quality', 'missing-power']) {
        const h = completedParallelChargeFixture();
        h.step(() => {
            h.put('DP_WB1_SOC', 100);
            h.put('DP_WB1_POWER', cause === 'bounded-zero-noise' ? -0.01 : 0,
                cause === 'unconfirmed-power' ? {ack: false} : {});
            for (const phase of [1, 2, 3]) h.put(`DP_WB1_L${phase}_A`, 0,
                cause === 'bad-current-quality' && phase === 3 ? {q: 64} : {});
            if (cause === 'missing-power') h.states.delete('DP_WB1_POWER');
        });
        h.acknowledgeStop();
        const targets = h.step(h.releaseQuiet);
        if (cause === 'good' || cause === 'bounded-zero-noise') assert.ok(targets.amps[2] >= 6,
            'normal car completion may report zero before the EMS output flag is cleared');
        else assert.equal(targets.amps[2], 0, `${cause}: unknown quiet is not an observed completion`);
    }
});

test('expired or reset automatic completion evidence cannot be renewed by a still full donor', () => {
    for (const cause of ['observation-gap', 'expired', 'reset']) {
        const h = completedParallelChargeFixture();
        h.complete(); h.acknowledgeStop();
        if (cause === 'observation-gap') h.advance(11000);
        if (cause === 'expired') h.advance(301000);
        if (cause === 'reset') h.run('resetSlowTargets()');
        let targets = h.step(h.releaseQuiet);
        assert.equal(targets.amps[2], 0, cause);
        targets = h.step();
        assert.equal(targets.amps[2], 0, `${cause}: unchanged full SoC does not replenish a failed transfer`);
        assert.ok(h.states.get('ems.0.Vehicles.Wallbox2.StartDelayRemaining_s').val > 0, cause);
    }
});

test('central parallel budget accepts only bounded go-e zero noise while preserving the exact raw sample', () => {
    for (const rawKW of [-0.01, -0.02, 0]) {
        const h = engine({production: true}); h.exclude(1); h.exclude(2);
        h.put('DP_WB0_POWER', rawKW);
        const before = {...h.states.get('DP_WB0_POWER')};
        const targets = h.update(3000, 3000);
        const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
        assert.equal(grant.valid, true, `${rawKW} kW is inside the shared zero-noise contract`);
        assert.ok(targets.amps[0] >= 6, `${rawKW} kW does not manufacture a global source failure`);
        assert.deepEqual(h.states.get('DP_WB0_POWER'), before, 'normalization cannot rewrite raw telemetry');
        assert.ok(targets.watts[0] >= 1380 && targets.watts[0] <= 3000,
            'operational zero is never negative available load or additional budget');
    }
});

test('central budget zero-noise tolerance never accepts invalid wallbox, SMA or heater sources', () => {
    const cases = [
        {id: 'DP_WB0_POWER', value: -0.020001, reason: 'source-value-invalid'},
        {id: 'DP_WB0_POWER', value: -0.03, reason: 'source-value-invalid'},
        {id: 'DP_WB0_POWER', value: null, reason: 'source-value-invalid'},
        {id: 'DP_WB0_POWER', value: -0.01, extra: {ack: false}, reason: 'source-unacknowledged'},
        {id: 'DP_WB0_POWER', value: -0.01, extra: {q: 64}, reason: 'source-quality-invalid'},
        {id: 'DP_WB0_POWER', value: -0.01, ageMs: 31000, reason: 'source-stale'},
        {id: 'DP_WB0_POWER', value: -0.01, ageMs: -2000, reason: 'source-timestamp-invalid'},
        {id: 'DP_GRID_IMPORT', value: -0.01, reason: 'source-value-invalid'},
        {id: 'DP_GRID_EXPORT', value: -0.01, reason: 'source-value-invalid'},
        {id: 'DP_DHW_OUTPUT1', value: -0.01, heater: true, reason: 'source-value-invalid'}
    ];
    for (const sample of cases) {
        const h = engine({production: true, dhwControlEnabled: sample.heater === true});
        h.exclude(1); h.exclude(2);
        h.put(sample.id, sample.value, {...sample.extra,
            ...(sample.ageMs === undefined ? {} : {ts: Date.now() - sample.ageMs})});
        const before = {...h.states.get(sample.id)};
        const diagnostic = h.run('(() => {const faults=[]; return {valid:wallboxPhaseBudgetSourcesValid('
            + 'realtimeProductionScope(),Date.now(),null,faults),faults};})()');
        assert.equal(diagnostic.valid, false, JSON.stringify(sample));
        assert.equal(diagnostic.faults[0].id, sample.id);
        assert.equal(diagnostic.faults[0].rawValue, sample.value);
        assert.equal(diagnostic.faults[0].ack, before.ack);
        assert.equal(diagnostic.faults[0].q, before.q);
        assert.equal(diagnostic.faults[0].ts, before.ts);
        assert.equal(diagnostic.faults[0].reason, sample.reason);
        const targets = h.update(3000, 3000);
        assert.equal(JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val).valid, false);
        assert.deepEqual(targets.amps, [0, 0, 0]);
        assert.deepEqual(h.states.get(sample.id), before, 'invalid raw evidence remains available for diagnosis');
    }
});
