'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WallboxOutput = require('../lib/wallbox-output');

function setup({now: readNow = () => Date.now(), responseCurrentA = null, responseEvidence = null} = {}) {
    const states = new Map(), writes = [];
    let now = readNow();
    // A test publication follows the previous command within the logical
    // millisecond. Explicit old timestamps remain available for stale-input
    // and pre-command response regressions below.
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, ts: readNow() + 1, ...extra});
    const mapping = {DP_WB0_CAR: 'car', DP_WB0_SOC: 'soc', DP_WB0_ALLOW: 'userAllow',
        DP_WB0_POWER: 'power', DP_WB0_L1_A: 'i1', DP_WB0_L2_A: 'i2', DP_WB0_L3_A: 'i3',
        DP_GRID_IMPORT: 'import', DP_GRID_EXPORT: 'export', DP_HA_CRITICAL: 'critical',
        DP_PAR14A: 'par14a', DP_LPC_STATE: 'lpc', DP_LPC_LIMIT: 'lpcLimit',
        DP_DHW_PARALLEL_RELEASE: 'split'};
    const config = {globalWriteEnabled: true, wb0Present: true, wb0ControlEnabled: true,
        wb0ProductionArmed: true, wb0PhaseControlMode: 'ems', wb0CommissioningMaxA: 32, wb0MaxCurrent1pA: 32,
        wb0MaxPowerW: 7360, wb0AmpereOutputId: 'cmd', wb0AllowOutputId: 'allow',
        wb0AmpereFeedbackId: 'feedback', wb0ConnectionId: 'connection', wb0ErrorId: 'error',
        dhwHaL1CurrentId: 'h1', dhwHaL2CurrentId: 'h2', dhwHaL3CurrentId: 'h3', slowCycleS: 5,
        par14aActiveHigh: true, par14aLimitW: 4200, wallboxRestartHandoffSettleS: 0};
    const adapter = {namespace: 'ems.0', config, stateCache: states,
        getCachedState: id => states.get(id), readMapping: () => mapping,
        setCompatState: (id, val) => put(id, val),
        setStateAsync: async (id, val) => put(`ems.0.${id}`, val),
        setForeignStateAsync: async (id, val) => { writes.push({id, val}); put(id, val, {ack: false, ts: readNow()}); },
        getForeignStateAsync: async id => states.get(id), subscribeForeignStatesAsync: async () => {},
        getForeignObjectAsync: async () => ({type: 'state', common: {write: true, type: 'number'}}),
        queueCompatState: async (id, val) => { if (!states.has(id)) put(id, val); },
        log: {error: () => {}}};
    for (const key of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid', 'Control.Enabled',
        'Devices.Wallbox0.Present', 'Devices.Wallbox0.ControlEnabled', 'Vehicles.Wallbox0.SoCValid',
        'Vehicles.Wallbox0.Release']) put(`ems.0.${key}`, true);
    put('ems.0.Plan.Valid',true);
    for (const key of ['System.LastUpdate', 'Control.LastUpdate', 'Plan.LastUpdate']) put(`ems.0.${key}`, now);
    put('ems.0.Control.TargetGridPower_W', -100);
    put('ems.0.Actual.MyPV_DHW_W', 0);
    put('ems.0.Control.SelectedWallbox', 0);
    put('ems.0.Control.Targets.Wallbox0_W', 7000);
    put('ems.0.Control.Targets.Wallbox0_Phases', 1);
    put('ems.0.Vehicles.Wallbox0.TargetSoC_pct', 80);
    put('ems.0.Vehicles.Wallbox0.MinimumSoC_pct', 20);
    for (const [id, val] of Object.entries({car: 2, soc: 50, userAllow: true, power: 0,
        i1: 0, i2: 0, i3: 0, h1: 10, h2: 10, h3: 10, import: 0, export: 8000,
        critical: false, par14a: false, lpc: 'unlimitedAutonomous', lpcLimit: 0, connection: true,
        error: 0, allow: 0, feedback: 6, split: 0})) put(id, val);
    const output = new WallboxOutput(adapter, {now: readNow, responseCurrentA, responseEvidence});
    const ack = (id, value) => put(id, value, {ts: readNow() + 1});
    const electricalOff = (wb = 0) => {
        const ids = wb === 0 ? ['power', 'i1', 'i2', 'i3']
            : [`power${wb}`, `i${wb}1`, `i${wb}2`, `i${wb}3`];
        for (const id of ids) put(id, 0, {ts: readNow() + 2});
    };
    const refresh = () => {
        now = readNow();
        for (const [id, s] of states) if (s.ack) put(id, s.val);
        for (const key of ['System.LastUpdate', 'Control.LastUpdate', 'Plan.LastUpdate']) put(`ems.0.${key}`, now);
    };
    const start = async (wb = 0) => {
        const allowId = wb === 0 ? 'allow' : `allow${wb}`;
        const feedbackId = wb === 0 ? 'feedback' : `feedback${wb}`;
        await output.initialize();
        await output.tick(); ack(allowId, 0);
        await output.tick(); ack(feedbackId, 6);
        await output.tick(); ack(allowId, 1);
        await output.tick();
    };
    const enableWallbox = wb => {
        Object.assign(mapping, {
            [`DP_WB${wb}_CAR`]: `car${wb}`, [`DP_WB${wb}_SOC`]: `soc${wb}`,
            [`DP_WB${wb}_ALLOW`]: `userAllow${wb}`, [`DP_WB${wb}_POWER`]: `power${wb}`,
            [`DP_WB${wb}_L1_A`]: `i${wb}1`, [`DP_WB${wb}_L2_A`]: `i${wb}2`,
            [`DP_WB${wb}_L3_A`]: `i${wb}3`
        });
        Object.assign(config, {
            [`wb${wb}Present`]: true, [`wb${wb}ControlEnabled`]: true,
            [`wb${wb}ProductionArmed`]: true, [`wb${wb}ProductionPhases`]: 1,
            [`wb${wb}SinglePhaseGridPhase`]: wb + 1,
            [`wb${wb}CommissioningMaxA`]: 32, [`wb${wb}MaxCurrent1pA`]: 32,
            [`wb${wb}MaxPowerW`]: 7360, [`wb${wb}AmpereOutputId`]: `cmd${wb}`,
            [`wb${wb}AllowOutputId`]: `allow${wb}`, [`wb${wb}AmpereFeedbackId`]: `feedback${wb}`,
            [`wb${wb}ConnectionId`]: `connection${wb}`, [`wb${wb}ErrorId`]: `error${wb}`
        });
        for (const key of [`Devices.Wallbox${wb}.Present`, `Devices.Wallbox${wb}.ControlEnabled`,
            `Vehicles.Wallbox${wb}.SoCValid`, `Vehicles.Wallbox${wb}.Release`]) put(`ems.0.${key}`, true);
        put(`ems.0.Control.Targets.Wallbox${wb}_W`, 0);
        put(`ems.0.Vehicles.Wallbox${wb}.TargetSoC_pct`, 80);
        put(`ems.0.Vehicles.Wallbox${wb}.MinimumSoC_pct`, 20);
        for (const [id, val] of Object.entries({[`car${wb}`]:2,[`soc${wb}`]:50,[`userAllow${wb}`]:true,
            [`power${wb}`]:0,[`i${wb}1`]:0,[`i${wb}2`]:0,[`i${wb}3`]:0,
            [`connection${wb}`]:true,[`error${wb}`]:0,[`allow${wb}`]:0,[`feedback${wb}`]:6})) put(id,val);
    };
    return {adapter, config, mapping, states, writes, put, ack, electricalOff, refresh, start, output, enableWallbox};
}


function parallelSetup(count = 2) {
    let now = 1000000;
    const h = setup({now: () => now});
    h.advance = ms => { now += ms; h.refresh(); };
    h.config.multiWallboxAlphaArmed = true;
    h.config.wallboxParallelChargingEnabled = true;
    h.config.wb0PhaseControlMode = 'fixed';
    for (let wb = 1; wb < count; wb++) h.enableWallbox(wb);
    h.grant = (amps = Array(count).fill(6), {hardBudgetW = null, budgetW = null, phases = Array(count).fill(1)} = {}) => {
        const voltage = h.output.parallelNominalVoltage();
        const allocations = amps.map((a, wb) => ({wb, authorized: a > 0, targetA: a,
            phases: phases[wb], reservedW: Math.round(a * phases[wb] * voltage),
            minimumW: a > 0 ? Math.round(6 * voltage) : 0}));
        for (const entry of allocations) {
            h.put(`ems.0.Control.Targets.Wallbox${entry.wb}_W`, Math.round(entry.targetA * entry.phases * voltage));
            h.put(`ems.0.Control.Targets.Wallbox${entry.wb}_Phases`, entry.phases);
            h.put(`ems.0.Control.Targets.Wallbox${entry.wb}_A`, entry.targetA);
        }
        h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify({schema: 1, timestamp: now,
            valid: true, voltage, order: [0, 1, 2].slice(0, count), hardBudgetW,
            budgetW: budgetW ?? allocations.reduce((sum, a) => sum + a.reservedW, 0), allocations}));
    };
    h.measure = (wb, amps, phases = 1) => {
        h.ack(wb === 0 ? 'feedback' : `feedback${wb}`, amps);
        const ids = wb === 0 ? ['power', 'i1', 'i2', 'i3']
            : [`power${wb}`, `i${wb}1`, `i${wb}2`, `i${wb}3`];
        h.put(ids[0], amps * phases * h.output.parallelNominalVoltage() / 1000, {ts: now + 2});
        ids.slice(1).forEach((id, p) => h.put(id, p === 0 || phases === 3 ? amps : 0, {ts: now + 2}));
    };
    h.startParallel = async amps => {
        h.grant(amps);
        await h.output.initialize();
        await h.output.tick();
        for (let wb = 0; wb < count; wb++) h.ack(wb === 0 ? 'allow' : `allow${wb}`, 0);
        await h.output.tick();
        for (let wb = 0; wb < count; wb++) h.ack(wb === 0 ? 'feedback' : `feedback${wb}`, 6);
        await h.output.tick();
        for (let wb = 0; wb < count; wb++) {
            h.ack(wb === 0 ? 'allow' : `allow${wb}`, 1);
            h.measure(wb, 6);
        }
        await h.output.tick();
    };
    h.grant();
    return h;
}

test('two authorized cars start through independent OFF, current ACK and ON ACK sequences', async () => {
    const h = parallelSetup();
    await h.startParallel();
    assert.deepEqual(h.writes, [
        {id: 'allow', val: 0}, {id: 'allow1', val: 0},
        {id: 'cmd', val: 6}, {id: 'cmd1', val: 6},
        {id: 'allow', val: 1}, {id: 'allow1', val: 1}
    ]);
    for (const wb of [0, 1]) {
        assert.equal(h.output.devices[wb].owned, true);
        assert.equal(h.states.get(`ems.0.Devices.Wallbox${wb}.OutputActive`).val, true);
    }
});

test('three minimum-SoC cars receive six amps without the legacy low-SoC current boost', async () => {
    const h = parallelSetup(3);
    for (const wb of [0, 1, 2]) {
        h.put(wb === 0 ? 'soc' : `soc${wb}`, 10);
        h.put(`ems.0.Vehicles.Wallbox${wb}.RequestedMinimumCurrent_A`, 25);
    }
    await h.startParallel();
    assert.equal(h.writes.filter(w => w.id.startsWith('cmd')).length, 3);
    assert.ok(h.writes.filter(w => w.id.startsWith('cmd')).every(w => w.val === 6));
    assert.ok([0, 1, 2].every(wb => h.states.get(`ems.0.Devices.Wallbox${wb}.OutputActive`).val));
});

test('parallel starts require a fresh valid joint grant even with positive central targets', async t => {
    for (const fault of ['missing', 'stale', 'bad_quality', 'ack_false', 'mismatch', 'duplicate', 'overspend']) {
        await t.test(fault, async () => {
            const h = parallelSetup();
            const id = 'ems.0.Control.ParallelWallboxAllocation_JSON';
            if (fault === 'missing') h.states.delete(id);
            else if (fault === 'stale') h.put(id, h.states.get(id).val, {ts: 980000});
            else if (fault === 'bad_quality') h.put(id, h.states.get(id).val, {q: 1});
            else if (fault === 'ack_false') h.put(id, h.states.get(id).val, {ack: false});
            else if (fault === 'mismatch') h.put('ems.0.Control.Targets.Wallbox0_W', 2300);
            else {
                const grant = JSON.parse(h.states.get(id).val);
                if (fault === 'duplicate') grant.allocations.push({...grant.allocations[0]});
                else grant.budgetW = 2000;
                h.put(id, JSON.stringify(grant));
            }
            await h.output.initialize(); await h.output.tick();
            assert.equal(h.writes.length, 0);
            assert.ok(h.output.devices.every(d => !d.owned));
        });
    }
});

test('joint allocation reserves both car floors before allowing the first car to ramp', async () => {
    const h = parallelSetup(); await h.startParallel([10, 6]);
    h.advance(6000); h.grant([10, 6]);
    h.measure(0, 6); h.measure(1, 6);
    h.writes.length = 0; await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 10}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
});

test('a peer reduction ACK does not free its previous power before new electrical feedback', async () => {
    const h = parallelSetup(); await h.startParallel([10, 6]);
    h.advance(6000); h.grant([10, 6]); h.measure(0, 6); h.measure(1, 6);
    await h.output.tick(); h.measure(0, 10); await h.output.tick();
    h.advance(6000); h.grant([6, 10]); h.writes.length = 0;
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 6}]);
    h.ack('feedback', 6); h.writes.length = 0;
    await h.output.tick();
    assert.equal(h.writes.some(w => w.id === 'cmd1' && w.val > 6), false);
    assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val >= 2300);
    h.measure(0, 6); await h.output.tick();
    assert.ok(h.writes.some(w => w.id === 'cmd1' && w.val === 10));
});

test('shared operator cap counts the real EHZ and all car reservations', async () => {
    const h = parallelSetup();
    h.put('par14a', true);
    h.put('Devices.MyPV_DHW.Present', true);
    h.put('ems.0.Devices.MyPV_DHW.Present', true);
    h.put('ems.0.Actual.MyPV_DHW_W', 2000);
    h.grant([6, 6], {hardBudgetW: 4200});
    await h.output.initialize(); await h.output.tick();
    h.ack('allow', 0); h.ack('allow1', 0);
    await h.output.tick();
    assert.equal(h.writes.filter(w => w.id.startsWith('cmd')).length, 1);
    assert.match(h.states.get('ems.0.Devices.Wallbox1.OutputStatus').val, /Sicherheitsgrenze/);
});

test('simultaneous pending starts cannot exceed the shared house phase fuse', async () => {
    const h = parallelSetup();
    h.config.wb0SinglePhaseGridPhase = 1; h.config.wb1SinglePhaseGridPhase = 1;
    h.config.houseConnectionFuseA = 63; h.config.houseConnectionReserveA = 0;
    h.put('h1', 55); h.put('h2', 10); h.put('h3', 10);
    await h.output.initialize(); await h.output.tick();
    h.ack('allow', 0); h.ack('allow1', 0); await h.output.tick();
    assert.deepEqual(h.writes.filter(w => w.id.startsWith('cmd')), [{id: 'cmd', val: 6}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox1.OutputStatus').val, /Sicherheitsgrenze/);
});

test('a withdrawn grant stops only its car while the other admitted car remains live', async () => {
    const h = parallelSetup(); await h.startParallel();
    h.grant([6, 0]); h.writes.length = 0; await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow1', val: 0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.equal(h.output.devices[1].owned, true);
    assert.ok(h.states.get('ems.0.Devices.Wallbox1.OutputReservedPower_W').val >= 1380);
});

test('unknown peer power and uncontrolled ON release cannot become parallel start permission', async t => {
    for (const mode of ['unknown_power', 'foreign_release']) await t.test(mode, async () => {
        const h = parallelSetup();
        if (mode === 'unknown_power') h.put('power1', null);
        else h.put('allow1', 1);
        await h.output.initialize(); await h.output.tick();
        assert.equal(h.writes.some(w => w.id === 'allow' && w.val === 1), false);
        assert.equal(h.writes.some(w => w.id === 'cmd'), false);
    });
});

test('runtime config switch can keep legacy sequential mode despite a native parallel default', async () => {
    const h = parallelSetup();
    h.put('ems.0.Config.WallboxParallelChargingEnabled', false);
    await h.output.initialize(); await h.output.tick();
    assert.equal(h.output.parallelEnabled(), false);
    assert.match(h.states.get('ems.0.Devices.Wallbox1.OutputStatus').val, /Sequenzbetrieb/);
});


test('zero soft grants preserve an established minimum run/stop timer but never start a waiting car', async () => {
    const h = parallelSetup();
    h.config.wallboxMinimumRunTimeS = 0; h.config.wallboxStopDelayS = 5;
    await h.startParallel();
    const softGrant = () => {
        h.grant([0, 0]);
        const state = h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON');
        const grant = JSON.parse(state.val);
        grant.allocations.forEach(entry => { entry.authorized = true; entry.minimumW = 1380; });
        h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
    };
    softGrant(); h.writes.length = 0; await h.output.tick();
    assert.equal(h.writes.some(w => w.id.startsWith('allow') && w.val === 0), false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 5);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.StopDelayRemaining_s').val, 5);
    h.advance(6000); softGrant(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}, {id: 'allow1', val: 0}]);

    const waiting = parallelSetup(); waiting.grant([0, 6]);
    const grant = JSON.parse(waiting.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    grant.allocations[0].authorized = true; grant.allocations[0].minimumW = 1380;
    waiting.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
    await waiting.output.initialize(); await waiting.output.tick();
    assert.equal(waiting.writes.some(w => w.id === 'cmd' || w.id === 'allow'), false);
});

test('stale shared grants stop productive cars rather than maintaining an unprovable parallel allocation', async () => {
    const h = parallelSetup(); await h.startParallel();
    h.advance(10001); h.writes.length = 0; await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}, {id: 'allow1', val: 0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /abgelaufen/);
});

test('a phase transition keeps the union of old and new topology reserved for its peer', async () => {
    const h = parallelSetup(); await h.startParallel();
    const car = h.output.devices[0];
    car.confirmedPhases = 3; car.phaseRequest = {phases: 1, since: 1000000};
    car.parallelReservationW = 4140;
    h.put('ems.0.Devices.Wallbox0.OutputReservedPower_W', 4140);
    h.put('ems.0.Devices.Wallbox0.PhaseSwitchPending', true);
    const loads = h.output.parallelLoadReservations(h.mapping, 1);
    assert.equal(loads.valid, true);
    assert.equal(loads.wallboxesW[0], 4140);
    assert.deepEqual(loads.pendingPhasesW, [0, 1380, 1380]);
});

test('two previously EMS-owned cars are adopted only against a fresh complete aggregate grant', async () => {
    const h = parallelSetup();
    h.put('ems.0.Control.RestartHandoffActive', true);
    h.put('ems.0.Control.RestartHandoffSince', 1000000);
    for (const wb of [0, 1]) {
        h.put(`ems.0.Devices.Wallbox${wb}.OutputOwned`, true);
        h.put(`ems.0.Devices.Wallbox${wb}.OutputActive`, true);
        h.ack(wb === 0 ? 'allow' : `allow${wb}`, 1);
        h.measure(wb, 6);
    }
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.ok([0, 1].every(wb => h.output.devices[wb].owned && !h.output.devices[wb].recovering));
});

test('the write preflight reevaluates a newly reduced operator limit even for a current reduction', async () => {
    const h = parallelSetup(); await h.startParallel([10, 6]);
    h.output.devices[0].lastA = 10;
    h.put('par14a', true); h.config.par14aLimitW = 2000;
    assert.match(h.output.parallelWriteProblem(h.output.devices[0], 'command', 6, h.mapping), /Schutzbudget/);
    assert.equal(h.output.parallelWriteProblem(h.output.devices[0], 'allow', 0, h.mapping), '');
});


test('a zero power poll cannot erase simultaneous real current from the shared reservation', async () => {
    const h = parallelSetup(); await h.startParallel();
    h.measure(0, 10); h.put('power', 0);
    const loads = h.output.parallelLoadReservations(h.mapping, 1);
    assert.equal(loads.valid, true);
    assert.equal(loads.wallboxesW[0], 2300);
});


test('a 240 V allocation starts both minimum currents and ramps without a false 230 V mismatch', async () => {
    const h = parallelSetup();
    h.put('ems.0.Config.WallboxNominalVoltage_V', 240);
    await h.startParallel([10, 6]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputCommand_A').val, 6);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputCommand_A').val, 6);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputReservedPower_W').val, 1440);
    h.advance(6000); h.grant([10, 6]); h.measure(0, 6); h.measure(1, 6);
    h.writes.length = 0; await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 10}]);
    assert.equal(h.output.parallelWriteProblem(h.output.devices[1], 'command', 6, h.mapping), '');
});

test('a bounded restart retains owned outputs while waiting for a new aggregate grant, without writes', async () => {
    const h = parallelSetup();
    h.put('ems.0.Control.RestartHandoffActive', true);
    h.put('ems.0.Control.RestartHandoffSince', 1000000);
    h.put('ems.0.Control.Valid', false);
    h.states.delete('ems.0.Control.ParallelWallboxAllocation_JSON');
    for (const wb of [0, 1]) {
        h.put(`ems.0.Devices.Wallbox${wb}.OutputOwned`, true);
        h.put(`ems.0.Devices.Wallbox${wb}.OutputActive`, true);
        h.ack(wb === 0 ? 'allow' : `allow${wb}`, 1); h.measure(wb, 6);
    }
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.ok([0, 1].every(wb => h.output.devices[wb].owned && h.output.devices[wb].recovering));
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /warte auf frisch/);
    h.grant(); h.put('ems.0.Control.Valid', true); h.refresh(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.ok([0, 1].every(wb => h.output.devices[wb].owned && !h.output.devices[wb].recovering));
});

test('an expired grant cannot extend restart handoff or bypass an actual shared operator cap', async t => {
    for (const fault of ['handoff_expired', 'shared_cap']) await t.test(fault, async () => {
        const h = parallelSetup();
        h.put('ems.0.Control.RestartHandoffActive', true);
        h.put('ems.0.Control.RestartHandoffSince', fault === 'handoff_expired' ? 700000 : 1000000);
        h.states.delete('ems.0.Control.ParallelWallboxAllocation_JSON');
        for (const wb of [0, 1]) {
            h.put(`ems.0.Devices.Wallbox${wb}.OutputOwned`, true);
            h.put(`ems.0.Devices.Wallbox${wb}.OutputActive`, true);
            h.ack(wb === 0 ? 'allow' : `allow${wb}`, 1); h.measure(wb, 6);
        }
        if (fault === 'shared_cap') { h.put('par14a', true); h.config.par14aLimitW = 2000; }
        await h.output.initialize(); await h.output.tick();
        assert.ok(h.writes.length > 0);
        assert.ok(h.writes.every(w => w.id.startsWith('allow') && w.val === 0));
        assert.ok(h.output.devices.every(d => !d.recovering));
    });
});

test('a 4200 W gross limit admits two 6 A cars and a separately reserved 1000 W battery once', async () => {
    const h = parallelSetup(); h.put('par14a', true);
    h.adapter.engineContext = {
        coordinatedEnergyEnabled: () => true,
        coordinatedConsumptionLoads: () => {
            const wallboxesW = [0, 1, 2].map(wb => Math.max(0,
                Number(h.states.get(`ems.0.Devices.Wallbox${wb}.OutputReservedPower_W`)?.val) || 0));
            const wallboxW = wallboxesW.reduce((sum, watts) => sum + watts, 0);
            return {valid: true, wallboxesW, wallboxW, totalW: 1000 + wallboxW, batteryW: 1000};
        },
        coordinatedPhaseReservations: () => ({valid: true, otherW: [1000, 1000, 1000]})
    };
    await h.startParallel();
    assert.equal(h.writes.filter(w => w.id.startsWith('allow') && w.val === 1).length, 2);
    assert.ok([0, 1].every(wb => h.states.get(`ems.0.Devices.Wallbox${wb}.OutputActive`).val));
    h.grant([6, 6], {hardBudgetW: 4200}); await h.output.tick();
    assert.ok([0, 1].every(wb => h.states.get(`ems.0.Devices.Wallbox${wb}.OutputActive`).val));
});


test('fresh lower restart allocations reduce confirmed old currents without restarting the cars', async () => {
    const h = parallelSetup();
    h.put('ems.0.Control.RestartHandoffActive', true);
    h.put('ems.0.Control.RestartHandoffSince', 1000000);
    for (const wb of [0, 1]) {
        h.put(`ems.0.Devices.Wallbox${wb}.OutputOwned`, true);
        h.put(`ems.0.Devices.Wallbox${wb}.OutputActive`, true);
        h.ack(wb === 0 ? 'allow' : `allow${wb}`, 1); h.measure(wb, 10);
    }
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 6}, {id: 'cmd1', val: 6}]);
    assert.ok([0, 1].every(wb => h.output.devices[wb].owned && !h.output.devices[wb].recovering));
});


test('fractional nominal voltage uses the same rounded target watts without losing a six-amp floor', async () => {
    const h = parallelSetup(); h.put('ems.0.Config.WallboxNominalVoltage_V', 235.05);
    await h.startParallel();
    assert.equal(h.states.get('ems.0.Control.Targets.Wallbox0_W').val, 1410);
    assert.ok([0, 1].every(wb => h.states.get(`ems.0.Devices.Wallbox${wb}.OutputActive`).val));
    assert.equal(h.writes.filter(w => w.id.startsWith('allow') && w.val === 1).length, 2);
});


test('fresh OFF/Standby/zero-power evidence isolates an unowned inactive peer from stale current polls', async () => {
    const h = parallelSetup(); await h.startParallel();
    // Complete an actual OFF before making the idle peer current polls stale.
    h.grant([6, 0]); await h.output.tick();
    h.ack('allow1', 0); h.electricalOff(1); await h.output.tick();
    h.put('car1', 1); h.put('i12', 0, {ts: 960000});
    h.grant([6, 0]); h.writes.length = 0; await h.output.tick();
    assert.equal(h.output.devices[1].owned, false);
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.equal(h.output.parallelLoadReservations(h.mapping, 0).valid, true);
});

test('idle-peer current exception never turns missing power or OFF acknowledgement into zero load', async t => {
    for (const fault of ['power', 'allow', 'current_draw']) await t.test(fault, async () => {
        const h = parallelSetup();
        h.grant([6, 0]); h.put('car1', 1); h.put('i12', 0, {ts: 960000});
        if (fault === 'power') h.put('power1', null);
        if (fault === 'allow') h.put('allow1', null);
        if (fault === 'current_draw') h.put('i11', 10);
        await h.output.initialize(); await h.output.tick();
        assert.equal(h.writes.some(w => w.id === 'cmd' || w.id === 'allow' && w.val === 1), false);
        assert.equal(h.output.parallelLoadReservations(h.mapping, 0).valid, false);
    });
});
