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

test('issue116 late OFF releases only the stopped parallel car and preserves its lock and peer load', async () => {
    const h = parallelSetup(); await h.startParallel();
    h.grant([6, 0]); h.writes.length = 0; await h.output.tick();
    h.advance(21000); h.grant([6, 0]); await h.output.tick();
    const stopped = h.output.devices[1], peer = h.output.devices[0];
    assert.match(stopped.fault, /AUS-Rueckmeldung/);
    assert.equal(stopped.owned, true);
    h.advance(1000); h.grant([6, 0]); h.ack('allow1', 0); h.electricalOff(1);
    await h.output.tick();
    assert.equal(stopped.owned, false);
    assert.match(stopped.fault, /AUS-Rueckmeldung/);
    assert.match(h.states.get('ems.0.Devices.Wallbox1.OutputStatus').val, /elektrisch ruhig, Wiederfreigabe gesperrt/);
    assert.equal(peer.owned, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.ok(h.output.parallelLoadReservations(h.mapping, 1).wallboxesW[0] >= 1380);
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 0));
    assert.ok(!h.writes.some(w => w.id === 'allow1' && w.val === 1));
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

test('completed minimum charge stops only its own car while a below-minimum peer stays on six amps', async () => {
    const h = parallelSetup();
    h.config.wallboxMinimumRunTimeS = 600; h.config.wallboxStopDelayS = 600;
    h.put('soc', 19); h.put('soc1', 19); h.put('export', 0); h.put('import', 2760);
    await h.startParallel();
    h.advance(1000); h.grant([6, 6]); await h.output.tick(); h.writes.length = 0;
    const releaseCompletedDemand = () => {
        // A soft zero target is still valid for an established output; its
        // real residual load remains reserved until OFF and electrical quiet.
        h.grant([0, 6], {budgetW: 2760});
        const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
        grant.allocations[0].authorized = true;
        grant.allocations[0].minimumW = 1380;
        h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
    };
    h.advance(1000); h.put('soc', 20); releaseCompletedDemand(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputCommand_A').val, 6);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 1380);
    h.advance(1000); h.ack('allow', 0); releaseCompletedDemand(); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopPowerPending').val, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
    h.advance(1000); h.electricalOff(0); h.put('import', 1380);
    releaseCompletedDemand(); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 0);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputOwned').val, false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}], 'no OFF/ON or extra start delay for the peer');
});

test('a stale positive parallel grant containing no PV cannot prolong an ended grid minimum charge', async () => {
    const h = parallelSetup();
    h.config.wallboxMinimumRunTimeS = 600; h.config.wallboxStopDelayS = 600;
    h.put('soc', 19); h.put('soc1', 19); h.put('export', 0); h.put('import', 2760);
    await h.startParallel();
    h.advance(1000); h.grant([6, 6]); await h.output.tick(); h.writes.length = 0;
    h.advance(1000); h.put('soc', 20); h.grant([6, 6]);
    const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    grant.allocations[0].pvBudgetW = 0;
    h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}],
        'positive old mandatory allocation is not a new permission for grid energy');
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
});

test('allocated PV continues above minimum despite a grid-backed peer, and a later PV dip uses 600 seconds', async () => {
    const h = parallelSetup();
    h.config.wallboxMinimumRunTimeS = 600; h.config.wallboxStopDelayS = 600;
    h.put('soc', 19); h.put('soc1', 19); h.put('export', 0); h.put('import', 2760);
    await h.startParallel();
    h.advance(1000); h.grant([6, 6]); await h.output.tick(); h.writes.length = 0;
    const assignPv = (pvW, targetA = 6) => {
        h.grant([targetA, 6], {budgetW: 2760});
        const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
        grant.allocations[0].pvBudgetW = pvW;
        grant.allocations[0].authorized = true;
        grant.allocations[0].minimumW = 1380;
        h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
    };
    h.advance(1000); h.put('soc', 20); h.put('import', 1380); assignPv(1380);
    await h.output.tick();
    assert.deepEqual(h.writes, [], 'the peer grid import does not cancel this car\'s allocated PV');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    h.advance(1000); h.put('import', 2760); assignPv(0, 0); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 600);
    h.advance(599000); assignPv(0, 0); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 1);
    h.advance(1000); assignPv(0, 0); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
});

test('a PV change after the last allocation is reconciled before deciding minimum-charge completion', async () => {
    const h = parallelSetup();
    h.config.wallboxMinimumRunTimeS = 600; h.config.wallboxStopDelayS = 600;
    h.put('soc', 19); h.put('soc1', 19); h.put('export', 0); h.put('import', 2760);
    await h.startParallel();
    const assignPv = (pvW, targetA = 6) => {
        h.grant([targetA, 6], {budgetW: 2760});
        const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
        grant.allocations[0].pvBudgetW = pvW;
        grant.allocations[0].authorized = true;
        grant.allocations[0].minimumW = 1380;
        h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
    };
    h.advance(1000); assignPv(0); await h.output.tick(); h.writes.length = 0;
    // Both the observed SoC edge and real PV recovery postdate this grant.
    // Its old zero PV attribution cannot prove there is still no PV now.
    h.advance(1000); h.put('soc', 20); h.put('import', 0); h.put('export', 200);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    h.advance(1000); assignPv(1380); h.put('import', 1380); h.put('export', 0);
    await h.output.tick();
    assert.deepEqual(h.writes, [], 'a new qualified PV allocation continues the existing charging session');
    h.advance(1000); assignPv(0, 0); h.put('import', 2760); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 600);
    h.advance(599000); assignPv(0, 0); await h.output.tick();
    assert.deepEqual(h.writes, []);
    h.advance(1000); assignPv(0, 0); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
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


// Reproduce an actual second-car start while the first car is still drawing.
// Every pending stage is reached through real driver writes and acknowledgements;
// no manually fabricated ownership/start reservation can make this pass.
async function startBesideDonor(stage = 'current') {
    const h = parallelSetup();
    h.config.wallboxMinimumRunTimeS = 600;
    h.config.wallboxStopDelayS = 600;
    await h.startParallel();
    h.put('ems.0.Vehicles.Wallbox1.Release', false);
    h.grant([6, 0], {budgetW: 2760});
    await h.output.tick();
    h.ack('allow1', 0); h.electricalOff(1);
    await h.output.tick();
    assert.equal(h.output.devices[1].owned, false);
    h.put('ems.0.Vehicles.Wallbox1.Release', true);
    h.grant([6, 6], {budgetW: 2760});
    await h.output.tick();
    h.ack('allow1', 0); await h.output.tick();
    assert.equal(h.output.devices[1].pending.stage, 'current');
    if (stage !== 'current') {
        h.ack('feedback1', 6); await h.output.tick();
        assert.equal(h.output.devices[1].pending.stage, 'allow');
    }
    if (stage === 'vehicle_response') {
        h.ack('allow1', 1); await h.output.tick();
        assert.equal(h.output.devices[1].pending, null);
        assert.equal(h.output.devices[1].response.ackId, 'allow1');
    }
    h.writes.length = 0;
    return h;
}

test('a real pending minimum-current start waits through donor OFF without an extra OFF or ON', async () => {
    const h = await startBesideDonor('current');
    const before = h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON')?.val;
    h.grant([0, 6], {budgetW: 2760});
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.output.devices[1].pending.stage, 'current');
    assert.match(h.states.get('ems.0.Devices.Wallbox1.OutputStatus').val, /Startauftrag erhalten.*AUS.*elektrisch/);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val, before,
        'waiting cannot refresh the stage deadline');
    h.ack('allow', 0); await h.output.tick();
    assert.equal(h.output.devices[1].pending.stage, 'current', 'OFF ACK alone does not free donor power');
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    h.electricalOff(0); h.ack('feedback1', 6); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}, {id: 'allow1', val: 1}]);
    h.ack('allow1', 1); h.measure(1, 6); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
});

test('already issued ON remains reserved during donor OFF and observes its own ACK without cycling', async () => {
    const h = await startBesideDonor('allow');
    h.grant([0, 6], {budgetW: 2760});
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.output.devices[1].pending.stage, 'allow');
    assert.ok(h.states.get('ems.0.Devices.Wallbox1.OutputReservedPower_W').val >= 1380);
    h.ack('allow1', 1); await h.output.tick();
    assert.equal(h.output.devices[1].pending, null, 'its existing ON acknowledgement is consumed while peer stops');
    const proof = JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val);
    assert.equal(proof.stage, 'vehicle_response');
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    h.ack('allow', 0); h.electricalOff(0); h.measure(1, 6); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
    assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
        {schema: 1, pending: false});
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
});

test('the initial electrical-response window keeps a fixed truthful start proof after ON ACK', async () => {
    const h = await startBesideDonor('vehicle_response');
    const before = JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val);
    assert.deepEqual(before, {schema: 1, pending: true, stage: 'vehicle_response', amps: 6,
        phases: 1, stageAt: h.states.get('allow1').ts,
        validUntil: h.states.get('allow1').ts + 45000});
    h.advance(2000); h.grant([0, 6], {budgetW: 2760}); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val), before);
});

test('waiting start reservations never weaken source, device, target, operator or house protection', async t => {
    for (const fault of ['source', 'device', 'release', 'target', 'operator', 'house', 'master']) await t.test(fault, async () => {
        const h = await startBesideDonor('allow');
        h.grant([0, 6], {budgetW: 2760, hardBudgetW: fault === 'operator' ? 1000 : null});
        if (fault === 'source') h.put('import', 0, {ts: 960000});
        if (fault === 'device') h.put('error1', 5);
        if (fault === 'release') h.put('ems.0.Vehicles.Wallbox1.Release', false);
        if (fault === 'target') h.put('soc1', 80);
        if (fault === 'house') h.put('h2', 70);
        if (fault === 'master') h.put('ems.0.Control.Enabled', false);
        await h.output.tick();
        assert.ok(h.writes.some(w => w.id === 'allow1' && w.val === 0), `${fault} must stop its owned start`);
        assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
            {schema: 1, pending: false});
        assert.equal(h.writes.some(w => w.id === 'allow1' && w.val === 1), false);
    });
});

test('waiting for donor OFF does not extend the pending current ACK deadline', async () => {
    const h = await startBesideDonor('current');
    const proof = JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val);
    h.put('feedback1', 6, {ts: 999999});
    h.grant([0, 6], {budgetW: 2760}); await h.output.tick();
    h.advance(21000); h.put('feedback1', 6, {ts: 999999}); h.grant([0, 6], {budgetW: 2760}); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.ResponseState').val, 'timeout');
    assert.match(h.output.devices[1].fault, /Rueckmeldung.*gesperrt/);
    assert.equal(proof.validUntil, proof.stageAt + 20000);
    assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
        {schema: 1, pending: false});
    assert.equal(h.output.devices[1].pending, null);
    assert.equal(h.output.devices[1].owned, false, 'an already OFF current stage needs no redundant OFF write');
});

test('a fresh idle car without a previously written start remains blocked by donor OFF', async () => {
    const h = parallelSetup();
    h.grant([6, 0], {budgetW: 2760});
    await h.output.initialize();
    await h.output.tick(); h.ack('allow', 0); await h.output.tick();
    h.ack('feedback', 6); await h.output.tick();
    h.ack('allow', 1); h.measure(0, 6); await h.output.tick();
    h.grant([0, 6], {budgetW: 2760}); h.writes.length = 0; await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.output.devices[1].owned, false);
    assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
        {schema: 1, pending: false});
});


test('an acknowledged current that cannot reach ON expires as a bounded handover wait, not a missing ACK', async () => {
    const h = await startBesideDonor('current');
    h.grant([0, 6], {budgetW: 2760}); await h.output.tick();
    h.advance(2000); h.ack('feedback1', 6); h.grant([0, 6], {budgetW: 2760}); await h.output.tick();
    // The original ACK at two seconds is kept, rather than renewed each tick.
    const ackAt = h.states.get('feedback1').ts;
    h.advance(19000); h.ack('feedback1', 6);
    assert.ok(h.states.get('feedback1').ts > ackAt);
    h.grant([0, 6], {budgetW: 2760}); await h.output.tick();
    assert.equal(h.output.devices[1].pending, null);
    assert.equal(h.output.devices[1].fault, '', 'a timely ACK is not labelled a go-e communication fault');
    assert.match(h.states.get('ems.0.Devices.Wallbox1.OutputStatus').val, /Start-Uebergabe-Frist abgelaufen trotz bestaetigtem/);
    assert.equal(h.writes.some(w => w.id === 'allow1' && w.val === 1), false);
    assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
        {schema: 1, pending: false});
});

test('a timely ON ACK read by a delayed tick keeps its actual vehicle deadline without a second ON', async () => {
    const h = await startBesideDonor('allow');
    h.grant([0, 6], {budgetW: 2760}); await h.output.tick();
    h.advance(18000); h.ack('allow1', 1);
    const ackAt = h.states.get('allow1').ts;
    h.advance(3000); h.put('allow1', 1, {ts: ackAt}); h.grant([0, 6], {budgetW: 2760});
    await h.output.tick();
    assert.equal(h.output.devices[1].fault, '');
    assert.equal(h.output.devices[1].pending, null);
    const proof = JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val);
    assert.equal(proof.stage, 'vehicle_response');
    assert.equal(proof.stageAt, ackAt);
    assert.equal(proof.validUntil, ackAt + 45000);
    assert.equal(h.writes.some(w => w.id === 'allow1'), false);
});

test('start evidence is published only after a successful command write and cleared after a failed ON', async t => {
    await t.test('failed current write', async () => {
        const h = parallelSetup();
        await h.output.initialize(); await h.output.tick();
        h.ack('allow', 0); h.ack('allow1', 0);
        const write = h.adapter.setForeignStateAsync;
        h.adapter.setForeignStateAsync = async (id, value, ack) => {
            if (id === 'cmd1') throw new Error('test transport rejected current');
            return write(id, value, ack);
        };
        await h.output.tick();
        assert.match(h.output.devices[1].fault, /transport rejected current/);
        assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
            {schema: 1, pending: false});
        assert.equal(h.writes.some(w => w.id === 'allow1' && w.val === 1), false);
    });
    await t.test('failed ON write', async () => {
        const h = await startBesideDonor('current');
        const write = h.adapter.setForeignStateAsync;
        h.adapter.setForeignStateAsync = async (id, value, ack) => {
            if (id === 'allow1' && value === 1) throw new Error('test transport rejected ON');
            return write(id, value, ack);
        };
        h.ack('feedback1', 6); await h.output.tick();
        assert.match(h.output.devices[1].fault, /transport rejected ON/);
        assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
            {schema: 1, pending: false});
    });
});

test('initial vehicle deadline expiry clears startup evidence without claiming a new electrical response', async () => {
    const h = await startBesideDonor('vehicle_response');
    const oldProof = JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val);
    h.advance(46000); h.grant([6, 6], {budgetW: 2760});
    h.put('power1', 0); h.put('i11', 0); h.put('i12', 0); h.put('i13', 0);
    await h.output.tick();
    assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
        {schema: 1, pending: false});
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.ResponseState').val, 'limited');
    assert.notEqual(h.states.get('ems.0.Devices.Wallbox1.ResponseConfirmedAt').val, oldProof.validUntil);
    assert.equal(h.writes.some(w => w.id === 'allow1'), false);
});

test('adapter initialization clears an old startup proof instead of adopting its timer', async () => {
    const h = await startBesideDonor('allow');
    const restarted = new WallboxOutput(h.adapter, {now: h.output.now});
    await restarted.initialize();
    assert.deepEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox1.OutputStartReservation_JSON').val),
        {schema: 1, pending: false});
    assert.equal(restarted.devices[1].startReservation, null);
});

test('a three-phase start records its actual three-phase reservation rather than a one-phase floor', async () => {
    const h = parallelSetup();
    for (let wb = 0; wb < 2; wb++) Object.assign(h.config, {
        [`wb${wb}PhaseSwitchEnabled`]: true, [`wb${wb}PhaseControlMode`]: 'fixed',
        [`wb${wb}ProductionPhases`]: 3, [`wb${wb}MaxCurrent3pA`]: 32, [`wb${wb}MaxPowerW`]: 22080
    });
    h.grant([6, 6], {phases: [3, 3], budgetW: 8280});
    await h.output.initialize(); await h.output.tick();
    h.ack('allow', 0); h.ack('allow1', 0); await h.output.tick();
    for (const wb of [0, 1]) {
        const proof = JSON.parse(h.states.get(`ems.0.Devices.Wallbox${wb}.OutputStartReservation_JSON`).val);
        assert.equal(proof.stage, 'current');
        assert.equal(proof.phases, 3);
        assert.equal(proof.amps, 6);
        assert.ok(h.states.get(`ems.0.Devices.Wallbox${wb}.OutputReservedPower_W`).val >= 4140);
    }
});

// Issue #123: alpha.58 live records at 15:43:08/14/22 Europe/Berlin
// contain 6 -> 9 -> 7 -> 10 with a still-unanswered 9-A command at 14 s.
// The same command path reproduced on unchanged alpha.59. The samples below
// retain the raw ordering; an ACK is deliberately not a vehicle response.
async function unansweredParallelIncrease({phases = 1, count = 1} = {}) {
    const h = parallelSetup(count);
    if (phases === 3) for (let wb = 0; wb < count; wb++) Object.assign(h.config, {
        [`wb${wb}PhaseSwitchEnabled`]: true, [`wb${wb}ProductionPhases`]: 3,
        [`wb${wb}MaxCurrent3pA`]: 32, [`wb${wb}MaxPowerW`]: 22080
    });
    const topology = Array(count).fill(phases);
    // The helper's ordinary startup uses 1P; construct the same independent
    // ACK sequence with explicitly matching 3P samples when required.
    h.grant(Array(count).fill(6), {phases: topology});
    await h.output.initialize(); await h.output.tick();
    for (let wb = 0; wb < count; wb++) h.ack(wb === 0 ? 'allow' : `allow${wb}`, 0);
    await h.output.tick();
    for (let wb = 0; wb < count; wb++) h.ack(wb === 0 ? 'feedback' : `feedback${wb}`, 6);
    await h.output.tick();
    for (let wb = 0; wb < count; wb++) { h.ack(wb === 0 ? 'allow' : `allow${wb}`, 1); h.measure(wb, 6, phases); }
    await h.output.tick();
    h.put('soc', 10);
    h.advance(6000);
    h.grant([9, ...Array(count - 1).fill(6)], {phases: topology});
    h.measure(0, 5.9, phases); h.ack('feedback', 6); h.put('power', 1.29 * phases);
    h.put('export', 907.8 * phases); h.writes.length = 0;
    await h.output.tick(); assert.deepEqual(h.writes, [{id: 'cmd', val: 9}]);
    h.advance(6000); h.ack('feedback', 9);
    h.measure(0, 5.8, phases); h.ack('feedback', 9); h.put('power', 1.29 * phases);
    h.put('export', 471.4 * phases);
    h.grant([7, ...Array(count - 1).fill(6)], {phases: topology});
    h.writes.length = 0;
    await h.output.tick();
    h.writes.length = 0;
    return h;
}

test('issue123 falling nominal PV target preserves an unanswered command with measured surplus in 1P and 3P', async t => {
    for (const phases of [1, 3]) await t.test(`${phases}P`, async () => {
        const h = await unansweredParallelIncrease({phases});
        await h.output.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.output.devices[0].lastA, 9);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
        assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val >= 2070 * phases);
        const diagnostic = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
        assert.equal(diagnostic.decision, 'await-electrical-response');
        assert.equal(diagnostic.softTargetA, 7);
        assert.equal(diagnostic.nextA, 9);
        assert.equal(diagnostic.awaitingElectricalStep, true);
        assert.equal(diagnostic.responseDeadlineAt,
            h.output.devices[0].response.ackAt + h.output.responseSettleTimeoutMs());
        assert.ok(diagnostic.budgetSources.every(source => source.ts > diagnostic.electricalCommandAt));
        h.advance(6000); h.grant([10], {phases: [phases]});
        await h.output.tick(); assert.deepEqual(h.writes, [], 'a PV jump still awaits the electrical response');
        h.measure(0, 9, phases); await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'cmd', val: 10}], 'new electrical response permits the fresh budget immediately');
    });
});

test('issue123 physical PV deficit and protection reductions supersede the response hold immediately', async t => {
    for (const fault of ['PV deficit', 'house fuse', 'operator', 'device current']) await t.test(fault, async () => {
        const h = await unansweredParallelIncrease();
        if (fault === 'PV deficit') { h.put('import', 400); h.put('export', 0); }
        if (fault === 'house fuse') h.put('h1', 48);
        if (fault === 'operator') h.grant([7], {hardBudgetW: 1610});
        if (fault === 'device current') h.put('feedbackAvailable', 7);
        if (fault === 'device current') h.output.devices[0].ids.available = 'feedbackAvailable';
        await h.output.tick();
        assert.deepEqual(h.writes, fault === 'house fuse' ? [{id: 'allow', val: 0}]
            : [{id: 'cmd', val: fault === 'PV deficit' ? 6 : 7}]);
    });
});

test('issue123 a held response keeps its peer reservation until a new physical reply frees it', async () => {
    const h = await unansweredParallelIncrease({count: 2});
    h.grant([7, 8]); await h.output.tick();
    assert.deepEqual(h.writes, [], 'peer cannot spend the held 9-A reservation');
    assert.equal(h.output.devices[0].lastA, 9);
    h.measure(0, 9); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 7}]);
    h.ack('feedback', 7); await h.output.tick();
    assert.equal(h.writes.some(write => write.id === 'cmd1'), false, 'current ACK alone cannot free watts');
    h.measure(0, 7); h.put('export', 1000); await h.output.tick();
    assert.ok(h.writes.some(write => write.id === 'cmd1' && write.val === 8));
});

test('issue123 expired electrical wait is explicit and does not refresh its deadline or fabricate confirmation', async () => {
    const h = await unansweredParallelIncrease(); await h.output.tick();
    const response = h.output.devices[0].response, deadline = response.ackAt + h.output.responseSettleTimeoutMs();
    h.advance(46000); h.grant([7]); h.measure(0, 5.8); h.ack('feedback', 9);
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 7}]);
    const diagnostic = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
    assert.equal(diagnostic.responseDeadlineAt, deadline);
    assert.equal(diagnostic.responseState, 'limited');
    assert.ok(diagnostic.timestamp > deadline);
});

test('issue123 a budget poll preceding the last command cannot fund a new increase despite valid source age', async () => {
    const h = await unansweredParallelIncrease();
    h.advance(6000); h.grant([10]); h.measure(0, 9); h.ack('feedback', 9);
    const commandAt = h.output.devices[0].response.at;
    h.put('import', 0, {ts: commandAt - 1}); h.put('export', 5000, {ts: commandAt - 1});
    await h.output.tick(); assert.deepEqual(h.writes, []);
    const diagnostic = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
    assert.equal(diagnostic.freshIncreaseBudget, false);
    assert.equal(diagnostic.decision, 'await-new-budget');
    h.put('import', 0); h.put('export', 5000); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 10}]);
});

test('issue123 pre-command current and power inside tolerance never count as a new response', async () => {
    const h = await unansweredParallelIncrease();
    h.advance(6000); h.grant([10]); h.measure(0, 9); h.ack('feedback', 9);
    const commandAt = h.output.devices[0].response.at;
    for (const id of ['power', 'i1', 'i2', 'i3']) h.put(id, h.states.get(id).val, {ts: commandAt - 1});
    await h.output.tick(); assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
    h.measure(0, 9); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 10}]);
});

test('issue123 a hard current reduction smaller than a held command also obeys its new soft grant without OFF', async () => {
    const h = await unansweredParallelIncrease();
    h.output.devices[0].ids.available = 'feedbackAvailable';
    h.put('feedbackAvailable', 8); // Hard 8 A, soft 7 A, unanswered old 9 A.
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 7}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputFault').val, '');
});

test('issue123 original live budgets cap mandatory increases below an older still-valid allocation', async t => {
    const fixtures = [
        {seq: 27749, at: 1791553594017, previousA: 7, targetA: 9, expectedA: 8,
            commandAt: 1791553586022, ackAt: 1791553586171, allocationAt: 1791553591015,
            powerW: 1470, powerAt: 1791553591246, currentA: 6.6, currentAt: 1791553591188,
            importAt: 1791553593869, exportW: 666.1, exportAt: 1791553593871},
        {seq: 27856, at: 1791553606022, previousA: 7, targetA: 10, expectedA: 8,
            commandAt: 1791553598018, ackAt: 1791553598205, allocationAt: 1791553603017,
            powerW: 1470, powerAt: 1791553605945, currentA: 6.6, currentAt: 1791553605907,
            importAt: 1791553605876, exportW: 695.3, exportAt: 1791553605883},
        {seq: 29220, at: 1791553834017, previousA: 6, targetA: 9, expectedA: 7,
            commandAt: 1791553826021, ackAt: 1791553826199, allocationAt: 1791553831016,
            powerW: 1290, powerAt: 1791553831031, currentA: 5.8, currentAt: 1791553831010,
            importAt: 1791553833790, exportW: 590.6, exportAt: 1791553833792}
    ];
    for (const fixture of fixtures) await t.test(`raw session 1791548168417 / sequence ${fixture.seq}`, async () => {
        const h = parallelSetup(1); h.put('soc', 10); await h.startParallel(); h.advance(6000);
        const offset = 1006000 - fixture.at, raw = ts => ts + offset;
        const d = h.output.devices[0];
        d.lastA = fixture.previousA; d.pending = null; d.response = null;
        d.lastAt = raw(fixture.ackAt); d.electricalCommandAt = raw(fixture.commandAt);
        h.put('feedback', fixture.previousA, {ts: raw(fixture.ackAt)});
        h.put('power', fixture.powerW / 1000, {ts: raw(fixture.powerAt)});
        h.put('i1', fixture.currentA, {ts: raw(fixture.currentAt)});
        h.put('import', 0, {ts: raw(fixture.importAt)});
        h.put('export', fixture.exportW, {ts: raw(fixture.exportAt)});
        h.grant([fixture.targetA]);
        const id = 'ems.0.Control.ParallelWallboxAllocation_JSON';
        const grant = JSON.parse(h.states.get(id).val); grant.timestamp = raw(fixture.allocationAt);
        h.put(id, JSON.stringify(grant), {ts: raw(fixture.allocationAt)});
        h.writes.length = 0; await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'cmd', val: fixture.expectedA}]);
        const diagnostic = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
        assert.equal(diagnostic.liveBudgetW, fixture.powerW - 100 + fixture.exportW);
        assert.ok(fixture.expectedA * 230 <= diagnostic.liveBudgetW);
        assert.ok(fixture.targetA * 230 > diagnostic.liveBudgetW);
        assert.equal(diagnostic.authorizedMinimumW, 1380);
    });
});
