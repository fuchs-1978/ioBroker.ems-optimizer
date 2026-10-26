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
    const ctx = vm.createContext({wallboxAllocationPolicy: require('../lib/wallbox-allocation'), nativeConfig, SMA_GRID_MAX_AGE_MS, Date: clock, console,
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
    run('globalThis.originalDhwTarget = simulateDhwTarget; simulateDhwTarget = watts => watts');
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

test('manual Mii minimum receives a protected start with no PV despite stale script SOC release zero', () => {
    const h = engine({production: true, dhwControlEnabled: true});
    h.exclude(1); h.exclude(2);
    h.put('DP_WB0_SOC', 51); h.put('DP_WB0_MIN_SOC', 50); h.put('DP_WB0_TARGET', 90);
    h.put('DP_WB0_RELEASE', 0); h.put('DP_WB0_AMIN', 6);
    h.run('updateVehicles()');
    const result = h.update(0, Infinity, {valueW: 1400});
    assert.equal(result.amps[0], 6, 'explicit manual minimum must authorize 1380 W without PV');
    assert.equal(result.watts[0], 1380);
    assert.equal(result.dhw, 0, 'optional EHZ cannot consume an unprovided PV budget');
    h.put('DP_WB0_SOC', 90); h.run('updateVehicles()');
    assert.equal(h.update(0).amps[0], 0, 'target SoC still stops manual charging');
});

for (const [minimumA, hardLimit] of [[6, Infinity], [6, 3000], [20, Infinity]]) test(`manual EQE ${minimumA} A pre-start topology uses its own usable budget, hard limit ${hardLimit}`, () => {
    const h = engine({production: true, wb2PhaseControlMode: 'ems', wb2PhaseModeId: 'raw.phase2',
        phaseSwitchRealUpDelayS: 300});
    h.exclude(0); h.exclude(1);
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled', true);
    h.put('ems.0.Vehicles.Wallbox2.MaximumPhases', 3);
    h.put('ems.0.Vehicles.Wallbox2.MaxCurrent1P_A', 20);
    h.put('ems.0.Vehicles.Wallbox2.MaxCurrent3P_A', 32);
    h.put('ems.0.Config.Wallbox2MaxPower_W', 22080);
    h.put('ems.0.Config.WallboxStartReserve_W', 150);
    h.put('DP_WB2_AMIN', minimumA);
    h.put('raw.phase2', 1);
    h.run('updateVehicles()');
    const result = h.update(7000, hardLimit);
    const canStart3p = minimumA === 6 && hardLimit === Infinity;
    assert.equal(result.phases[2], canStart3p ? 3 : 1);
    const diagnostic = JSON.parse(h.states.get('ems.0.Control.Wallbox2.PhaseDecision_JSON').val);
    assert.equal(diagnostic.reason, canStart3p ? 'pre-start-budget-phase' : 'parallel-minimum-one-phase');
    assert.ok(result.reserve.reduce((sum, watts) => sum + watts, 0) <= hardLimit);
    assert.equal(h.states.get('raw.phase2').val, 1, 'the allocator never manufactures hardware confirmation');
});

test('optional EHZ yields a mandatory 3P start plus reserve before the car can start; its physical reservation remains binding', () => {
    const h = engine({production: true, dhwControlEnabled: true,
        wb2PhaseControlMode: 'ems', wb2PhaseModeId: 'raw.phase2'});
    h.exclude(0); h.exclude(1);
    h.put('DP_DHW_PARALLEL_RELEASE', false);
    h.put('DP_WB2_SOC', 10);
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled', true);
    h.put('ems.0.Vehicles.Wallbox2.MaximumPhases', 3);
    h.put('ems.0.Vehicles.Wallbox2.MaxCurrent1P_A', 20);
    h.put('ems.0.Vehicles.Wallbox2.MaxCurrent3P_A', 32);
    h.put('ems.0.Config.Wallbox2MaxPower_W', 22080);
    h.put('ems.0.Config.WallboxStartReserve_W', 300);
    h.put('ems.0.Control.Targets.Wallbox2_Phases', 3);
    h.put('raw.phase2', 2);
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 5140);
    h.plans[2] = {valueW: 22080, phases: 3};
    let target = h.update(9361, 9361);
    assert.equal(target.phases[2], 3);
    assert.equal(target.amps[2], 0, '81 W headroom is insufficient for a fresh 3P admission');
    assert.ok(target.dhw <= 9361 - 4440, 'heater target yields the full startup requirement');
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val, 5140,
        'planning a reduction never releases its real reservation');
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 2140);
    target = h.update(9361, 9361);
    assert.ok(target.amps[2] >= 6, 'only released physical capacity permits the start');
});

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

function waitingEqvFixture() {
    const h = engine({production: true, wallboxPriority: 2,
        wb1PhaseControlMode: 'ems', wb1PhaseModeId: 'raw.phase1'});
    h.exclude(0);
    h.put('DP_WB2_SOC', 58); h.put('DP_WB2_TARGET', 60);
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled', true);
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases', 3);
    h.put('ems.0.Vehicles.Wallbox1.MaxCurrent3P_A', 11);
    h.put('raw.phase1', 2);
    h.put('ems.0.Control.Targets.Wallbox1_Phases', 3);
    h.put('ems.0.Devices.Wallbox1.ConfirmedPhases', 3);
    h.put('ems.0.Config.WallboxStartReserve_W', 300);
    h.update(2608, 8000);
    h.owned(2, 12, 2450);
    return h;
}

test('stopped EQV prepares 1P before the EQE reaches target without borrowing its live watts or qualifying an early start', () => {
    const h = waitingEqvFixture();
    const target = h.update(2608, 8000);
    assert.equal(target.phases[1], 1, 'the prospective replacement budget fits 1P but not 3P');
    assert.equal(target.amps[1], 0, 'no premature current allocation');
    assert.ok(target.amps[2] >= 6, 'the running donor continues normally');
    assert.ok(target.reserve[2] >= 2760, 'its unanswered nominal draw stays reserved');
    assert.equal(h.states.get('raw.phase1').val, 2, 'request is not a fabricated device ACK');
    const phase = JSON.parse(h.states.get('ems.0.Control.Wallbox1.PhaseDecision_JSON').val);
    assert.equal(phase.reason, 'idle-replacement-one-phase');
    assert.equal(phase.replacementBudgetW, 2608);
    assert.equal(phase.allocatedBudgetW, 0);
    const allocation = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.equal(allocation.priorityHandoff, null, 'phase preparation is no start-delay waiver');
    assert.equal(h.run('wallboxVehicleHandoff'), null);
});

for (const [name, change, watts = 2608, hard = 8000] of [
    ['insufficient 1P reserve', () => {}, 1600],
    ['3P budget available', () => {}, 8000],
    ['peer/house hard limit', () => {}, 2608, 1000],
    ['heater reservation', h => h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 7000)],
    ['recipient still owned', h => h.put('ems.0.Devices.Wallbox1.OutputOwned', true)],
    ['recipient release withdrawn', h => h.put('DP_WB1_ALLOW', false)],
    ['recipient physical current', h => h.put('DP_WB1_L1_A', 1)],
    ['recipient ON echo', h => h.put('raw.allow1', 0, {ack: false})],
    ['recipient phase quality', h => h.put('raw.phase1', 2, {q: 64})],
    ['unconfirmed old phase', h => h.put('raw.phase1', 2, {ack: false})],
    ['external phase authority', h => {h.nativeConfig.wb1PhaseControlMode = 'script';}],
    ['grid quality', h => h.put('DP_GRID_IMPORT', 0, {q: 64})],
    ['master control off', h => h.put('ems.0.Control.Enabled', false)],
    ['donor phase work', h => h.put('ems.0.Devices.Wallbox2.PhaseSwitchPending', true)],
    ['donor no longer active', h => h.put('ems.0.Devices.Wallbox2.OutputActive', false)],
    ['higher-priority Mii waiting', h => h.put('ems.0.Devices.Wallbox0.Present', true)]
]) test(`idle replacement phase advice cannot bypass ${name}`, () => {
    const h = waitingEqvFixture(); change(h);
    h.update(watts, hard);
    const phase = JSON.parse(h.states.get('ems.0.Control.Wallbox1.PhaseDecision_JSON').val);
    assert.notEqual(phase.reason, 'idle-replacement-one-phase');
});

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
    for (const rawKW of [-0.01, -0.02, -0.03, 0]) {
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
        {id: 'DP_WB0_POWER', value: -0.030001, reason: 'source-value-invalid'},
        {id: 'DP_WB0_POWER', value: -0.04, reason: 'source-value-invalid'},
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

function measuredHoldEngine(wb = 0) {
    const h = engine({production: true});
    for (const peer of [0, 1, 2]) if (peer !== wb) h.exclude(peer);
    h.owned(wb, 8, 1730);
    h.put(`ems.0.Devices.Wallbox${wb}.ResponsePending`, false);
    h.put(`ems.0.Devices.Wallbox${wb}.ResponseState`, 'confirmed');
    h.put(`ems.0.Devices.Wallbox${wb}.OutputLastWrite`, Date.now() - 1000);
    return h;
}

function fixedOnePhaseMeasuredEngine(wb = 0) {
    const h = measuredHoldEngine(wb);
    h.nativeConfig[`wb${wb}PhaseSwitchEnabled`] = false;
    h.nativeConfig[`wb${wb}PhaseModeId`] = '';
    h.put(`ems.0.Vehicles.Wallbox${wb}.PhaseSwitchEnabled`, false);
    h.states.delete(`DP_WB${wb}_PHASE_MODE`);
    h.owned(wb, 6, 1310);
    h.put(`DP_WB${wb}_AMIN`, 6);
    h.nativeConfig.wallboxPVImportToleranceW = 100;
    h.run('updateVehicles()');
    return h;
}

for (const wb of [0,1,2]) test(`fixed 1P WB${wb} without mode ACK uses 1310 W response to admit the next PV ampere`, () => {
    const h = fixedOnePhaseMeasuredEngine(wb);
    const target = h.update(1569);
    const d = JSON.parse(h.states.get(`ems.0.Control.Wallbox${wb}.AllocationDiagnostics_JSON`).val);
    assert.equal(target.amps[wb], 7, JSON.stringify(d));
    assert.equal(d.actualPowerW, 1310);
    assert.equal(d.responseBasis, 'power-response');
    assert.equal(d.measuredPVStep, true);
    assert.equal(d.phases, 1);
    assert.ok(target.reserve[wb] >= 1610, 'soft PV measurement must not shrink the hard command reserve');
});

test('fixed 1P measured PV step still needs the full nominal hard budget', () => {
    const h = fixedOnePhaseMeasuredEngine();
    assert.equal(h.update(1569,1600).amps[0],6);
    assert.equal(h.update(1569,1610).amps[0],7);
});

for (const [name, change] of [
    ['real pending mode request', h=>h.put('ems.0.Devices.Wallbox0.PhaseSwitchPending',true)],
    ['real phase settling', h=>h.put('ems.0.Devices.Wallbox0.PhaseTransitionActive',true)],
    ['different actual topology', h=>h.put('ems.0.Devices.Wallbox0.OutputPhases',3)],
    ['pending electrical response', h=>h.put('ems.0.Devices.Wallbox0.ResponsePending',true)],
    ['bad power quality', h=>h.put('DP_WB0_POWER',1.31,{q:64})],
    ['unconfirmed power', h=>h.put('DP_WB0_POWER',1.31,{ack:false})],
    ['stale power', h=>h.put('DP_WB0_POWER',1.31,{ts:Date.now()-31000})],
    ['switchable topology with missing mode feedback', h=>{
        h.nativeConfig.wb0PhaseSwitchEnabled=true;
        h.put('ems.0.Vehicles.Wallbox0.PhaseSwitchEnabled',true);
    }]
]) test(`fixed-topology correction cannot grant the measured PV step with ${name}`,()=>{
    const h=fixedOnePhaseMeasuredEngine();change(h);h.run('updateVehicles()');
    assert.ok(h.update(1569).amps[0]<=6);
});

test('confirmed running EQV-like response survives a nominal soft cap without a down-up cycle', () => {
    const h = measuredHoldEngine();
    for (const budget of [1800, 1750, 1810, 1740]) {
        const targets = h.update(budget);
        assert.equal(targets.amps[0], 8);
        assert.ok(targets.reserve[0] >= 1840, 'keep full nominal reservation against peers/heater');
        const d = JSON.parse(h.states.get('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON').val);
        assert.equal(d.reason, 'measured-current-held');
        assert.equal(d.measuredCurrentHeld, true);
    }
    assert.equal(h.update(1600).amps[0], 7, 'a real 130 W deficit reduces one ampere rather than two nominal amps');
});

test('measured current hold cannot spend an operator cap or authorize an increase', () => {
    const h = measuredHoldEngine();
    assert.equal(h.update(1800, 1800).amps[0], 7, 'hard cap retains nominal watts');
    assert.equal(h.update(1800).amps[0], 8, 'soft ceiling alone may hold only the existing command');
    h.put('ems.0.Vehicles.Wallbox0.MaxCurrent1P_A', 7);
    assert.equal(h.update(1800).amps[0], 7, 'device cap remains binding');
});

test('missing, unconfirmed or pre-command electrical evidence earns no measured hold', () => {
    for (const change of [
        h => h.put('ems.0.Devices.Wallbox0.ResponsePending', true),
        h => h.put('ems.0.Devices.Wallbox0.ResponseState', 'vehicle_response'),
        h => h.put('raw.amps0', 7),
        h => h.put('DP_WB0_POWER', 1.73, {ack: false}),
        h => h.put('DP_WB0_POWER', 1.73, {ts: Date.now() - 2000}),
        h => h.put('ems.0.Devices.Wallbox0.PhaseTransitionActive', true)
    ]) {
        const h = measuredHoldEngine(); change(h);
        assert.ok(h.update(1800).amps[0] <= 7);
    }
});

test('measured hold retains peer reservations and cannot consume another minimum charge', () => {
    const h = measuredHoldEngine();
    h.put('ems.0.Devices.Wallbox1.Present', true);
    h.put('DP_WB1_SOC', 10);
    h.owned(1, 6, 1380);
    const targets = h.update(3180, 4200);
    assert.equal(targets.amps[0], 8);
    assert.equal(targets.amps[1], 6);
    assert.ok(targets.reserve[0] >= 1840 && targets.reserve[1] >= 1380);
    assert.ok(targets.watts.reduce((sum, value) => sum + value, 0) <= 4200);
    const limited = h.update(3180, 3000);
    assert.ok(limited.watts.reduce((sum, value) => sum + value, 0) <= 3000);
});

test('measured current hold applies to each of the three wallbox allocations', () => {
    for (const wb of [0, 1, 2]) {
        const h = measuredHoldEngine(wb);
        const targets = h.update(1800);
        assert.equal(targets.amps[wb], 8);
        assert.equal(targets.watts[wb], 1840);
        assert.ok(targets.amps.every((amps, index) => index === wb || amps === 0));
    }
});

test('one-amp PV step replaces 220 W export by predicted 10 W import with a shared hysteresis', () => {
    const h = measuredHoldEngine();
    h.nativeConfig.wallboxPVImportToleranceW = 50;
    let targets = h.update(1950); // 1730 actual + 220 export, target zero.
    assert.equal(targets.amps[0], 9);
    assert.ok(targets.reserve[0] >= 2070);
    let d = JSON.parse(h.states.get('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON').val);
    assert.equal(d.reason, 'measured-pv-step');
    // Physical answer: 1960 W at 9 A, 10 W net import. Hold, no second step.
    h.owned(0, 9, 1960);
    targets = h.update(1950);
    assert.equal(targets.amps[0], 9);
    assert.equal(h.update(1920).amps[0], 9, '40 W import may be held');
    assert.ok(h.update(1900).amps[0] <= 8, '60 W import exceeds the hold limit');
    const lower = measuredHoldEngine();
    assert.equal(lower.update(1929).amps[0], 8, '31 W expected import cannot arm a new step (30 W admission)');
    lower.nativeConfig.wallboxPVImportToleranceW = 0;
    assert.equal(lower.update(1950).amps[0], 8, 'zero disables the new allowance');
    lower.nativeConfig.wallboxPVImportToleranceW = -1;
    assert.equal(lower.update(1950).amps[0], 8, 'invalid config earns no allowance');
});

test('shared PV tolerance has one owner and preserves hard budgets, peer reservations and cold-start gates', () => {
    const h = measuredHoldEngine();
    h.put('ems.0.Devices.Wallbox1.Present', true);
    h.owned(1, 8, 1730);
    h.put('ems.0.Devices.Wallbox1.ResponsePending', false);
    h.put('ems.0.Devices.Wallbox1.ResponseState', 'confirmed');
    h.put('ems.0.Devices.Wallbox1.OutputLastWrite', Date.now() - 1000);
    h.update(3900);
    const a = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.equal(a.pvStepOwner, 0);
    assert.equal(a.pvStepToleranceW, 50);
    const peer = JSON.parse(h.states.get('ems.0.Control.Wallbox1.AllocationDiagnostics_JSON').val);
    assert.equal(peer.pvStepToleranceW ?? 0, 0);
    assert.ok(h.update(1950, 1950).amps[0] <= 8, 'nominal hard cap is not raised');
    const cold = engine({production: true}); cold.exclude(1); cold.exclude(2);
    assert.equal(cold.update(1360).amps[0], 0, 'no subsidized cold start');
});

test('productive planner uses configured EMS binary budget and publishes its calculation without scaling LPC', () => {
    const h=engine({production:true,par14aBudgetMode:'ems',par14aParticipants:[
        {name:'WB0',kind:'wallbox',connectionPowerW:11000},
        {name:'WB1',kind:'wallbox',connectionPowerW:11000}]});
    h.put('DP_PAR14A',true); h.put('DP_LPC_STATE','unlimitedAutonomous');
    assert.equal(h.run('currentConsumptionLimit().budgetW'),7560);
    const trace=JSON.parse(h.states.get('ems.0.Control.GridOperatorCalculation_JSON').val);
    assert.equal(trace.count,2); assert.equal(trace.factor,.8); assert.equal(trace.lpcRecalculated,false);
    assert.match(trace.accounting,/conservative-gross/);
    h.put('DP_LPC_STATE','limited'); h.put('DP_LPC_LIMIT',5000);
    assert.equal(h.run('currentConsumptionLimit().budgetW'),5000);
    h.put('DP_PAR14A',false);
    assert.equal(h.run('currentConsumptionLimit().budgetW'),5000);
});

test('planner external binary budget uses the same 15-second quality gate as the output', () => {
    const h=engine({production:true,par14aBudgetMode:'external',par14aLimitUnit:'kW'});
    h.put('DP_PAR14A',true); h.put('DP_LPC_STATE','unlimitedAutonomous');
    h.put('DP_PAR14A_LIMIT',7.56);
    assert.equal(h.run('currentConsumptionLimit().budgetW'),7560);
    h.put('DP_PAR14A_LIMIT',7.56,{ts:Date.now()-20000});
    assert.equal(h.run('currentConsumptionLimit().valid'),false);
    assert.equal(h.run('currentConsumptionLimit().budgetW'),0);
});

// Live EQV signature: 1 A down/up at a nominal PV ceiling while below minimum SoC.
test('mandatory charging holds a confirmed PV-funded current across the nominal ceiling', () => {
    for (const wb of [0, 1, 2]) {
        const h = measuredHoldEngine(wb);
        h.nativeConfig.wallboxPVImportToleranceW = 0;
        h.put(`DP_WB${wb}_SOC`, 10);
        for (const budget of [1800, 1750, 1810, 1740]) {
            assert.equal(h.update(budget).amps[wb], 8);
        }
        assert.ok(h.update(1600).amps[wb] <= 7, 'actual deficit reduces above-floor current');
        assert.ok(h.update(1800, 1800).amps[wb] <= 7, 'operator cap uses nominal watts');
        assert.equal(h.update(0).amps[wb], 6, 'only the authorized minimum survives lost PV');
    }
});


function coldLayeredHeaterEngine({top=65,bottom=28,peer=false}={}) {
    const h=engine({production:true,dhwControlEnabled:true,wallboxPriority:1});
    h.exclude(0);if(!peer)h.exclude(2);
    h.put('DP_WB1_SOC',10);h.owned(1,6,1270);
    if(peer){h.put('DP_WB2_SOC',10);h.owned(2,6,1380);}
    h.put('ems.0.Devices.MyPV_DHW.MustHeat',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperatureValid',true);
    h.put('ems.0.Devices.MyPV_DHW.TopTemperature_C',top);
    h.put('ems.0.Devices.MyPV_DHW.BottomTemperature_C',bottom);
    // Use the real heater target function, with the already-qualified source
    // status at the allocation boundary rather than an unrelated sensor setup.
    h.run(`evaluateDhwSimulation=()=>({release:true,valid:true,top:${top},bottom:${bottom},temperaturePowerLimitW:9000}); simulateDhwTarget=originalDhwTarget;`);
    return h;
}

test('EQV receives surplus rejected by a stratified mandatory heater instead of remaining at six amps', () => {
    const h=coldLayeredHeaterEngine();
    const target=h.update(1892.5);
    assert.equal(target.amps[1],8);
    assert.equal(target.dhw,0);
    assert.ok(target.watts.reduce((a,b)=>a+b,0)<=1892.5);
});
test('warm-layer heater minimum rejects sub-500 W shares but retains usable mandatory heat', () => {
    const h=coldLayeredHeaterEngine({top:50,bottom:40});
    assert.equal(h.update(1800).amps[1],7);
    const enough=h.update(1980);
    assert.equal(enough.amps[1],6);
    assert.equal(enough.dhw,600);
});
test('released heater share preserves hard caps and another mandatory vehicle floor', () => {
    const h=coldLayeredHeaterEngine({peer:true});
    const target=h.update(3272.5,3272.5);
    assert.equal(target.amps[1],8);assert.equal(target.amps[2],6);assert.equal(target.dhw,0);
    assert.ok(target.watts.reduce((a,b)=>a+b,0)<=3272.5);
    const limited=h.update(3272.5,2760);
    assert.equal(limited.amps[1],6);assert.equal(limited.amps[2],6);
    assert.ok(limited.watts.reduce((a,b)=>a+b,0)+limited.dhw<=2760);
});
test('a usable stratified mandatory heater budget is retained rather than donated to the car', () => {
    const h=coldLayeredHeaterEngine();const target=h.update(2400);
    assert.equal(target.amps[1],6);assert.equal(target.dhw,1000);
});

test('active heater sharing also releases an unusable sub-900 W share to wallboxes', () => {
    const h=coldLayeredHeaterEngine({peer:true});
    h.put('ems.0.Devices.MyPV_DHW.MustHeat',false);
    const target=h.update(4000,4200);
    assert.equal(target.dhw,0);
    assert.equal(target.amps[1],11);assert.equal(target.amps[2],6);
    assert.ok(target.watts.reduce((a,b)=>a+b,0)<=4000);
});

test('configured 100 W admits the 160 W export step during minimum-SoC charging and holds only to 100 W', () => {
    const h=measuredHoldEngine();h.nativeConfig.wallboxPVImportToleranceW=100;
    h.put('DP_WB0_SOC',10);
    assert.equal(h.update(1890).amps[0],9, '1730 W uptake plus 160 W export can fund the next 230 W step with 70 W import');
    h.owned(0,9,1960);
    assert.equal(h.update(1870).amps[0],9, '90 W import retains the confirmed current');
    assert.ok(h.update(1850).amps[0]<=8, '110 W import cannot retain the discretionary step');
    const edge=measuredHoldEngine();edge.nativeConfig.wallboxPVImportToleranceW=100;edge.put('DP_WB0_SOC',10);
    assert.equal(edge.update(1880).amps[0],9, '80 W predicted import is the admission boundary');
    assert.equal(edge.update(1879).amps[0],8, '81 W may not arm the step');
});

test('mandatory grid floors cannot manufacture another PV import step and tolerance has one owner', () => {
    const scarce=measuredHoldEngine();scarce.nativeConfig.wallboxPVImportToleranceW=100;
    scarce.put('DP_WB0_SOC',10);scarce.owned(0,6,1200);
    assert.equal(scarce.update(900).amps[0],6, 'authorized 1380 W floor is not real 1430 W next-step funding');
    const h=measuredHoldEngine();h.nativeConfig.wallboxPVImportToleranceW=100;
    h.put('DP_WB0_SOC',10);h.put('ems.0.Devices.Wallbox1.Present',true);h.put('DP_WB1_SOC',10);
    h.owned(1,8,1730);h.put('ems.0.Devices.Wallbox1.ResponsePending',false);
    h.put('ems.0.Devices.Wallbox1.ResponseState','confirmed');
    h.put('ems.0.Devices.Wallbox1.OutputLastWrite',Date.now()-1000);
    h.update(3900,4200);
    const a=JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.equal(a.pvStepOwner,0);
    assert.equal(JSON.parse(h.states.get('ems.0.Control.Wallbox1.AllocationDiagnostics_JSON').val).pvStepToleranceW,0);
    assert.ok(a.allocations.reduce((sum,x)=>sum+x.targetA*x.phases*230,0)<=4200);
});

test('delayed unused Mii telemetry leaves EQV budget valid and blocks only the Mii', () => {
    const h = engine({production: true, wallboxPriority: 1}); h.exclude(2);
    h.owned(1, 16, 3680);
    const old = Date.now() - 50000;
    h.put('raw.allow0', 0, {ts: old, lc: old - 1000});
    h.put('DP_WB0_POWER', 0, {ts: old});
    for (let p = 1; p <= 3; p++) h.put(`DP_WB0_L${p}_A`, 0, {ts: old});
    const result = h.update(4000);
    const allocation = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    assert.equal(allocation.valid, true);
    assert.deepEqual(allocation.isolatedIdleWallboxes, [0]);
    assert.ok(result.amps[1] >= 16);
    assert.equal(result.amps[0], 0);
    assert.equal(h.run('parallelWallboxCommitment(0,230,true).reservedW'), 0);
    h.put('DP_WB0_POWER', 0); h.put('raw.allow0', 0);
    for (let p = 1; p <= 3; p++) h.put(`DP_WB0_L${p}_A`, 0);
    h.update(6000);
    assert.ok(!JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val).isolatedIdleWallboxes);
});

for (const [name, change] of [
    ['ownership', h => h.put('ems.0.Devices.Wallbox0.OutputOwned', true)],
    ['pending stop', h => h.put('ems.0.Devices.Wallbox0.StopPowerPending', true)],
    ['pending response', h => h.put('ems.0.Devices.Wallbox0.ResponsePending', true)],
    ['phase transition', h => h.put('ems.0.Devices.Wallbox0.PhaseTransitionActive', true)],
    ['reservation', h => h.put('ems.0.Devices.Wallbox0.OutputReservedPower_W', 1380)],
    ['known draw', h => h.put('DP_WB0_POWER', 1, {ts: Date.now() - 50000})],
    ['unconfirmed OFF', h => h.put('raw.allow0', 0, {ack: false})],
    ['stale grid', h => h.put('DP_GRID_IMPORT', 0, {ts: 1})]
]) test('idle isolation keeps shared safeguards: ' + name, () => {
    const h = engine({production: true, wallboxPriority: 1}); h.exclude(2); h.owned(1, 16, 3680);
    const old = Date.now() - 50000;
    h.put('raw.allow0', 0, {ts: old, lc: old - 1000}); h.put('DP_WB0_POWER', 0, {ts: old});
    for (let p = 1; p <= 3; p++) h.put(`DP_WB0_L${p}_A`, 0, {ts: old});
    change(h); h.update(4000);
    assert.equal(JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val).valid, false);
});

test('EQE confirmed 17 A retains measured 3300 W across a multi-amp nominal PV gap', () => {
    const h = measuredHoldEngine(2);
    h.owned(2, 17, 3300);
    for (const budget of [3404, 3341, 3380, 3300]) {
        const target = h.update(budget);
        assert.equal(target.amps[2], 17);
        assert.ok(target.reserve[2] >= 3910, 'full nominal peer reservation remains');
    }
    assert.ok(h.update(3404, 3500).amps[2] <= 15, 'hard gross cap cannot use measured hold');
});

test('EQE pending response with 112 W deficit reduces 17 to 16 A instead of nominal 12 A', () => {
    const h = measuredHoldEngine(2);
    h.owned(2, 17, 3100);
    h.put('ems.0.Devices.Wallbox2.ResponseState', 'vehicle_response');
    h.put('ems.0.Devices.Wallbox2.ResponsePending', true);
    const target = h.update(2988);
    assert.equal(target.amps[2], 16);
    assert.ok(target.reserve[2] >= 3910);
    h.put('DP_WB2_POWER', 3.1, {ts:Date.now()-2000});
    assert.ok(h.update(2988).amps[2] <= 12, 'old evidence cannot earn a relative reduction');
});

for(const consumed of [true,false]) test('156 W deficit keeps relative 9→8 A reduction with pre-ACK power, ACK consumed='+consumed,()=>{
    const h=measuredHoldEngine(2),now=Date.now();
    h.owned(2,consumed?9:8,1730);
    h.put('raw.amps2',9,{ts:now});
    h.put('ems.0.Devices.Wallbox2.OutputLastWrite',now-1000);
    h.put('ems.0.Devices.Wallbox2.ResponseSentAt',now-1000);
    h.put('ems.0.Devices.Wallbox2.ResponseCommand_A',9);
    h.put('ems.0.Devices.Wallbox2.ResponsePreviousCommand_A',8);
    h.put('ems.0.Devices.Wallbox2.ResponseAcknowledgedAt',now-200);
    h.put('ems.0.Devices.Wallbox2.ResponseState','vehicle_response');
    h.put('ems.0.Devices.Wallbox2.ResponsePending',true);
    h.put('ems.0.Devices.Wallbox2.OutputReservedPower_W',2070);
    for(const id of ['DP_WB2_POWER','DP_WB2_L1_A']){const s=h.states.get(id);h.put(id,s.val,{ts:now-500});}
    const target=h.update(1573.5);
    assert.equal(target.amps[2],8);
    assert.ok(target.reserve[2]>=2070);
});

test('same 2430 W sample moves central allocation 10→11 A only after electrical confirmation',()=>{
    const h=measuredHoldEngine(2);h.owned(2,11,2430);
    h.put('ems.0.Devices.Wallbox2.ResponseState','vehicle_response');h.put('ems.0.Devices.Wallbox2.ResponsePending',true);
    const power={...h.states.get('DP_WB2_POWER')};
    assert.equal(h.update(2527).amps[2],10);
    h.put('ems.0.Devices.Wallbox2.ResponseState','confirmed');h.put('ems.0.Devices.Wallbox2.ResponsePending',false);
    assert.equal(h.update(2527).amps[2],11);
    assert.deepEqual(h.states.get('DP_WB2_POWER'),power,'no new sample is required by the next allocator cycle');
});

function limitedPVEngine(change = () => {}) {
    const h = engine({production:true, wallboxPVImportToleranceW:100});
    h.exclude(1); h.exclude(2); h.owned(0,19,4100);
    const base='ems.0.Devices.Wallbox0', now=Date.now();
    h.put(`${base}.OutputLastWrite`,now-80000);
    h.put(`${base}.ResponseSentAt`,now-80000);
    h.put(`${base}.ResponseAcknowledgedAt`,now-79000);
    h.put(`${base}.ResponseCommand_A`,19);
    h.put(`${base}.ResponseState`,'limited');
    h.put(`${base}.ResponsePending`,false);
    change(h,base,now);return h;
}

test('limited EQE 19 A/4100 W may request one measured 20 A step at 4510 W while reserving 4600 W',()=>{
    const h=limitedPVEngine();const t=h.update(4510);
    assert.equal(t.amps[0],20);assert.ok(t.reserve[0]>=4600);
    assert.equal(JSON.parse(h.states.get('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON').val).measuredPVStep,true);
});
for(const [name,change,hard,budget] of [
    ['hard watts',()=>{},4510,4510],
    ['too little measured budget',()=>{},Infinity,4200],
    ['missing ACK',(h,b)=>h.put(`${b}.ResponseAcknowledgedAt`,0),Infinity,4510],
    ['late ACK',(h,b,n)=>h.put(`${b}.ResponseAcknowledgedAt`,n-50000),Infinity,4510],
    ['before settle',(h,b,n)=>{h.put(`${b}.ResponseSentAt`,n-20000);h.put(`${b}.ResponseAcknowledgedAt`,n-19000);},Infinity,4510],
    ['pre-deadline power',(h,b,n)=>h.put('DP_WB0_POWER',4.1,{ts:n-40000}),Infinity,4510],
    ['device cap',h=>h.put('ems.0.Vehicles.Wallbox0.MaxCurrent1P_A',19),Infinity,4510],
    ['phase transition',(h,b)=>h.put(`${b}.PhaseTransitionActive`,true),Infinity,4510]
]) test('limited measured allocation respects '+name,()=>{
    const h=limitedPVEngine(change);assert.ok(h.update(budget,hard).amps[0]<=19);
});

for(const wb of [0,1,2]) test(`restart invalidation preserves inherited 3P target for wallbox ${wb}`,()=>{
    const h=engine({production:true,[`wb${wb}PhaseControlMode`]:'ems'});
    h.owned(wb,6,4100,3);
    h.put('ems.0.Control.RestartHandoffActive',true);
    h.put(`ems.0.Control.Targets.Wallbox${wb}_Phases`,3);
    h.run("zeroRealtimeTargets('Kein gueltiger 48-h-Fahrplan')");
    assert.equal(h.states.get(`ems.0.Control.Targets.Wallbox${wb}_Phases`).val,3);
    assert.equal(h.run(`slowTargets.wallboxPhases[${wb}]`),3);
    assert.equal(h.states.get(`ems.0.Control.Targets.Wallbox${wb}_A`).val,0);
    assert.equal(h.states.get(`ems.0.Control.Targets.Wallbox${wb}_W`).val,0);
    assert.equal(h.states.get('ems.0.Control.Valid').val,false);
    h.run("zeroRealtimeTargets('Eingangsdaten ungueltig oder veraltet')");
    assert.equal(h.states.get(`ems.0.Control.Targets.Wallbox${wb}_Phases`).val,3);
});
for(const [name,change] of [
    ['no handoff',h=>h.put('ems.0.Control.RestartHandoffActive',false)],
    ['not owned',h=>h.put('ems.0.Devices.Wallbox0.OutputOwned',false)],
    ['not active',h=>h.put('ems.0.Devices.Wallbox0.OutputActive',false)],
    ['external phase authority',h=>{h.nativeConfig.wb0PhaseControlMode='script';}]
]) test('ordinary invalidation is unchanged: '+name,()=>{
    const h=engine({production:true,wb0PhaseControlMode:'ems'});h.owned(0,6,4100,3);
    h.put('ems.0.Control.RestartHandoffActive',true);h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    change(h);h.run("zeroRealtimeTargets('invalid')");
    assert.equal(h.states.get('ems.0.Control.Targets.Wallbox0_Phases').val,1);
});

test('restart invalidation preserves a genuine 1P destination and never validates a corrupt phase target',()=>{
    const h=engine({production:true,wb0PhaseControlMode:'ems'});h.owned(0,6,4100,3);
    h.put('ems.0.Control.RestartHandoffActive',true);
    for(const value of [1,0]) {
        h.put('ems.0.Control.Targets.Wallbox0_Phases',value);
        h.run("zeroRealtimeTargets('invalid')");
        assert.equal(h.states.get('ems.0.Control.Targets.Wallbox0_Phases').val,value);
        assert.equal(h.states.get('ems.0.Control.Valid').val,false);
    }
});

function timedPhasePreparation() {
    let now=Date.now();class Clock extends Date {static now(){return now;}}
    const h=engine({production:true,clock:Clock,wallboxPriority:1,wb1PhaseControlMode:'ems',
        wb1PhaseModeId:'raw.phase1',phaseSwitchRealUpDelayS:300,phaseSwitchMinHoldMin:15});
    h.exclude(0);h.exclude(2);
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases',3);
    h.put('ems.0.Vehicles.Wallbox1.MaxCurrent3P_A',11);
    h.put('ems.0.Vehicles.Wallbox1.MaxCurrent1P_A',20);
    h.put('ems.0.Config.Wallbox1MaxPower_W',7590);
    h.put('ems.0.Config.SlowControlCycle_s',5);
    h.put('raw.phase1',1);h.owned(1,20,4430,1);
    h.plans[1]={valueW:7000,phases:3};
    h.run(`wallboxRealPhaseEpisode[1]=true;stableWallboxPhases[1]=1;
        wallboxRealPhaseCandidate[1]={phase:3,since:Date.now()-301000,lastObservationAt:Date.now()-6000};
        lastRealPhaseChangeAt[1]=0;lastPhaseChangeAt[1]=0;`);
    return {h,advance:ms=>{now+=ms;},now:()=>now};
}

test('qualified 3P preparation retains fresh observations across real six-second cycles',()=>{
    const {h,advance,now}=timedPhasePreparation();const since=h.run('wallboxRealPhaseCandidate[1].since');
    let t=h.update(7000,7000);assert.equal(t.phases[1],1);assert.equal(t.amps[1],10);
    assert.equal(h.run('wallboxRealPhaseCandidate[1].since'),since);
    assert.equal(h.run('wallboxRealPhaseCandidate[1].lastObservationAt'),now());
    advance(6000);h.owned(1,10,4430,1);t=h.update(7000,7000);
    assert.equal(t.phases[1],1,'current ACK alone cannot authorize topology change');
    assert.ok(t.amps[1]<=10);assert.equal(h.run('wallboxRealPhaseCandidate[1].since'),since);
    assert.equal(h.run('lastRealPhaseChangeAt[1]'),0);
    advance(6000);h.owned(1,10,2300,1);t=h.update(7000,7000);
    assert.equal(t.phases[1],3,'fresh safe current permits 3P without another 300 seconds');
    assert.ok(h.run('lastRealPhaseChangeAt[1]')===now());
    assert.equal(h.states.get('raw.phase1').val,1,'request is not a hardware confirmation');
});
for(const [name,change] of [
    ['genuine observation gap',(s)=>s.advance(8000)],
    ['budget below threshold',(s)=>{s.budget=4500;}],
    ['invalid phase feedback',(s)=>s.h.put('raw.phase1',1,{ack:false})],
    ['hard watts below 3P minimum',(s)=>{s.hard=4000;}]
]) test('timed phase preparation still rejects '+name,()=>{
    const s=timedPhasePreparation();s.h.update(7000,7000);
    s.advance(6000);s.h.owned(1,10,2300,1);change(s);
    const t=s.h.update(s.budget??7000,s.hard??7000);
    assert.notEqual(t.phases[1],3);
});

test('waiting priority car passes unused PV to a running follower before the optional heater', () => {
    const h = engine({production: true, dhwControlEnabled: true, wallboxPriority: 2});
    h.exclude(0);
    h.put('DP_DHW_PARALLEL_RELEASE', false);
    h.put('ems.0.Config.WallboxStartDelay_s', 300);
    h.owned(1, 6, 1310);
    const target = h.update(4285);
    assert.equal(target.amps[2], 0, 'priority car still observes its own start delay');
    assert.ok(target.amps[1] > 6, 'running EQV receives usable surplus without manual priority');
    assert.ok(target.dhw < 1000, 'heater receives only remaining unusable watts');
    assert.ok(target.dhw + target.reserve.reduce((sum, value) => sum + value, 0) <= 4285);
});

test('redistributed PV respects heater reservations and the shared 4.2 kW ceiling', () => {
    const h = engine({production: true, dhwControlEnabled: true, wallboxPriority: 2});
    h.exclude(0);
    h.put('DP_DHW_PARALLEL_RELEASE', false);
    h.put('ems.0.Config.WallboxStartDelay_s', 300);
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 1000);
    h.put('DP_DHW_OUTPUT1', 1000);
    h.owned(1, 6, 1310);
    const target = h.update(6000, 4200);
    assert.ok(target.amps[1] > 6);
    assert.ok(target.watts.reduce((sum, value) => sum + value, 0) + 1000 <= 4200);
});

test('redistributed PV does not bypass the follower start delay', () => {
    const h = engine({production: true, dhwControlEnabled: true, wallboxPriority: 2});
    h.exclude(0);
    h.put('DP_DHW_PARALLEL_RELEASE', false);
    h.put('ems.0.Config.WallboxStartDelay_s', 300);
    const target = h.update(4285);
    assert.deepEqual(target.amps, [0, 0, 0]);
    const follower = JSON.parse(h.states.get('ems.0.Control.Wallbox1.AllocationDiagnostics_JSON').val);
    assert.equal(follower.start.reason, 'start-delay');
    assert.equal(follower.start.startDelayRemainingS, 300);
});


test('target completion during donor phase settling retains handoff until confirmed stop', () => {
    const h = completedParallelChargeFixture();
    h.step(() => h.put('ems.0.Devices.Wallbox1.PhaseTransitionActive', true));
    h.complete();
    assert.equal(h.diagnostic(2).start.vehicleHandoff.qualified, true);
    assert.equal(h.diagnostic(2).start.vehicleHandoff.reason, 'donor-stop-confirmation-pending');
    h.acknowledgeStop();
    let targets = h.step(h.releaseQuiet);
    assert.equal(targets.amps[2], 0, 'a still pending phase transition is not waived by allocation');
    targets = h.step(() => h.put('ems.0.Devices.Wallbox1.PhaseTransitionActive', false));
    assert.ok(targets.amps[2] >= 6);
    assert.equal(h.diagnostic(2).start.reason, 'prepared-vehicle-handoff');
    assert.equal(h.diagnostic(2).start.startDelayRemainingS, 0);
});

test('busy donor cannot manufacture a handoff without an observed charging episode', () => {
    const h = completedParallelChargeFixture({observeIdle: false});
    h.step(() => h.put('ems.0.Devices.Wallbox1.PhaseTransitionActive', true));
    h.complete(); h.acknowledgeStop();
    const targets = h.step(() => {
        h.releaseQuiet(); h.put('ems.0.Devices.Wallbox1.PhaseTransitionActive', false);
    });
    assert.equal(targets.amps[2], 0);
    assert.ok(h.diagnostic(2).start.startDelayRemainingS > 0);
});

test('confirmed low actual draw admits one PV ampere beyond a multi-amp nominal gap', () => {
    const h = measuredHoldEngine(2);
    h.nativeConfig.wallboxPVImportToleranceW = 100;
    h.owned(2, 17, 3300);
    const target = h.update(3600);
    assert.equal(target.amps[2], 18);
    assert.ok(target.reserve[2] >= 4140);
    const d = JSON.parse(h.states.get('ems.0.Control.Wallbox2.AllocationDiagnostics_JSON').val);
    assert.equal(d.nominalMaximumA, 15);
    assert.equal(d.measuredPVStep, true);
    assert.ok(h.update(3600, 4139).amps[2] <= 17, 'one watt below full nominal hard reserve denies increase');
    assert.equal(h.update(3600, 4140).amps[2], 18);
    assert.equal(h.update(3449).amps[2], 17, '81 W above soft target exceeds 80 W admission');
    h.put('ems.0.Devices.Wallbox2.ResponsePending', true);
    h.put('ems.0.Devices.Wallbox2.ResponseState', 'vehicle_response');
    assert.ok(h.update(3600).amps[2] <= 17, 'no further increase while previous effect is unknown');
});

test('50 W target prefers predicted 100 W import over 130 W export at confirmed low draw', () => {
    const h = measuredHoldEngine(2);
    h.nativeConfig.wallboxPVImportToleranceW = 100;
    h.owned(2, 17, 3300);
    // Allocation input includes NVP target: actual + export + target.
    assert.equal(h.update(3300 + 130 + 50).amps[2], 18);
    h.owned(2, 18, 3530);
    assert.equal(h.update(3480).amps[2], 18, 'settled 100 W import is held without a down/up cycle');
});

function disconnectedParallelFixture(options={}) {
    const h=completedParallelChargeFixture(options);
    const unplug=(watts=4600,hard=4600)=>h.step(()=>h.put('DP_WB1_CAR',1),watts,hard);
    const quiet=()=>{h.releaseQuiet();h.put('DP_WB1_CAR',1);};
    return {...h,unplug,quiet};
}
test('parallel unplug retains witnessed qualification while donor stop is pending',()=>{
    const h=disconnectedParallelFixture();
    assert.equal(h.unplug().amps[2],0);
    assert.equal(h.diagnostic(2).start.vehicleHandoff.qualified,true);
    assert.equal(h.diagnostic(2).start.vehicleHandoff.reason,'donor-stop-confirmation-pending');
    h.acknowledgeStop();
    assert.ok(h.step(h.quiet).amps[2]>=6);
    assert.equal(h.diagnostic(2).start.reason,'prepared-vehicle-handoff');
    assert.equal(h.diagnostic(2).start.startDelayRemainingS,0);
});
test('parallel unplug can wait briefly for sufficient budget without fabricating a donor',()=>{
    const h=disconnectedParallelFixture();assert.equal(h.unplug(1075,1075).amps[2],0);
    assert.ok(h.run('wallboxDisconnectedDonor'));
    assert.ok(h.step(h.quiet,3115,3115).amps[2]>=6);
    assert.equal(h.diagnostic(2).start.reason,'prepared-vehicle-handoff');
});
for(const [name,change] of [
    ['no observed idle-to-charge episode',null],
    ['unconfirmed donor power',h=>h.put('DP_WB1_POWER',4.6,{ack:false})],
    ['bad donor current quality',h=>h.put('DP_WB1_L1_A',20,{q:64})],
    ['donor device error',h=>h.put('raw.error1',1)]
])test('parallel unplug cannot qualify with '+name,()=>{
    const h=disconnectedParallelFixture({observeIdle:name!=='no observed idle-to-charge episode'});
    h.step(()=>{h.put('DP_WB1_CAR',1);change?.(h);});
    assert.notEqual(h.diagnostic(2).start?.vehicleHandoff?.qualified,true);
});
test('disconnected parallel donor still requires fresh ACK and physical quiet',()=>{
    const h=disconnectedParallelFixture();h.unplug();
    for(const mutate of [
        ()=>{h.quiet();h.put('raw.allow1',1);},
        ()=>{h.quiet();h.put('DP_WB1_POWER',0.8);h.put('DP_WB1_L1_A',3.5);},
        ()=>{h.quiet();h.put('ems.0.Devices.Wallbox1.OutputOwned',true);}
    ])assert.equal(h.step(mutate).amps[2],0);
    assert.ok(h.step(h.quiet).amps[2]>=6);
});
test('qualified unplug loses shortcut after a real budget deficit',()=>{
    const h=disconnectedParallelFixture();h.unplug();h.step(()=>{},1000,1000);
    assert.equal(h.step(h.quiet).amps[2],0,JSON.stringify({diagnostic:h.diagnostic(2),handoff:h.run('wallboxVehicleHandoff'),token:h.run('wallboxDisconnectedDonor')}));
    assert.ok(h.diagnostic(2).start.startDelayRemainingS>0);
});
test('disconnected donor expires rather than qualifying a much later parallel start',()=>{
    const h=disconnectedParallelFixture();h.unplug(1000,1000);
    h.advance(100000);assert.equal(h.step(h.quiet).amps[2],0);
    assert.notEqual(h.diagnostic(2).start.vehicleHandoff.qualified,true);
});

for(const [name,change] of [
    ['recipient release withdrawn',h=>h.put('DP_WB2_ALLOW',false)],
    ['master disabled',h=>h.put('ems.0.Control.Enabled',false)],
    ['bad donor source',h=>h.put('DP_WB1_POWER',0,{q:64})],
    ['priority changed',h=>{h.nativeConfig.wallboxPriority=2;}]
])test('prepared disconnected parallel transfer yields to '+name,()=>{
    const h=disconnectedParallelFixture();h.unplug();
    assert.equal(h.step(()=>{h.quiet();change(h);}).amps[2],0);
    assert.notEqual(h.diagnostic(2).start?.vehicleHandoff?.eligible,true);
});

test('priority start retains its minimum while lending only excess to EQV over repeated live cycles', () => {
    let now = Date.now(); class Clock extends Date {static now() {return now;}}
    const h = engine({production: true, clock: Clock, dhwControlEnabled: true,
        wallboxPriority: 2, wb2PhaseControlMode: 'ems'});
    h.exclude(0); h.put('DP_DHW_PARALLEL_RELEASE', false);
    h.put('ems.0.Config.WallboxStartDelay_s', 300);
    h.put('ems.0.Config.WallboxStartReserve_W', 150);
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled', true);
    h.put('ems.0.Vehicles.Wallbox2.MaximumPhases', 3);
    h.put('ems.0.Vehicles.Wallbox2.MaxCurrent1P_A', 20);
    h.put('DP_WB2_PHASE_MODE', 3);
    h.put('ems.0.Control.Targets.Wallbox2_Phases', 3);
    h.plans[2] = {valueW: 7430, phases: 3};
    h.owned(1, 6, 1270);
    let started = false;
    for (let tick = 0; tick < 54; tick++) {
        for (const state of h.states.values()) state.ts = now;
        const t = h.update(7430, 20000);
        const d = JSON.parse(h.states.get('ems.0.Control.Wallbox2.AllocationDiagnostics_JSON').val);
        if (t.amps[2] > 0) {started = true; break;}
        assert.equal(d.start.reason, 'start-delay');
        assert.ok(t.amps[1] >= 6, 'follower continues on the genuine remainder');
        assert.ok(t.watts[1] + t.dhw + 4140 <= 7430,
            JSON.stringify({tick,t,claim:d.qualificationClaimW}));
        h.owned(1, t.amps[1], t.amps[1] * 230);
        h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', t.dhw);
        h.put('DP_DHW_OUTPUT1', t.dhw);
        now += 6000;
    }
    assert.equal(started, true, 'five-minute start qualification completes instead of resetting indefinitely');
});
