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

async function correctionCandidate(phases = 1) {
    const h = parallelSetup(1);
    if (phases === 3) Object.assign(h.config, {wb0ProductionPhases: 3, wb0PhaseSwitchEnabled: true,
        wb0MaxCurrent3pA: 32, wb0MaxPowerW: 22080});
    h.grant([10], {phases: [phases]});
    await h.output.initialize();
    await h.output.tick(); h.ack('allow', 0);
    await h.output.tick(); h.ack('feedback', 6);
    await h.output.tick(); h.ack('allow', 1); h.measure(0, 6, phases);
    await h.output.tick();
    h.advance(6000); h.grant([10], {phases: [phases]}); h.measure(0, 6, phases);
    await h.output.tick();
    h.advance(2000); h.grant([10], {phases: [phases]}); h.measure(0, 10, phases); h.ack('cmd', 10);
    await h.output.tick();
    assert.equal(h.output.devices[0].lastA, 10, h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val);
    h.advance(2000); h.grant([10], {phases: [phases]}); h.measure(0, 10, phases);
    h.ack('cmd', 10); h.ack('feedback', 11); h.writes.length = 0;
    return h;
}

for (const phases of [1, 3]) test(`issue216: isolated 10/11/10 A conflict is corrected once in ${phases}P without ON or OFF`, async () => {
    const h = await correctionCandidate(phases);
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 10}]);
    const d = h.output.devices[0], deadline = d.currentCorrection.deadline;
    h.advance(2000); h.grant([12], {phases: [phases]});
    await h.output.tick();
    assert.equal(d.currentCorrection.deadline, deadline);
    assert.equal(h.writes.length, 1, 'no retry/increase while the old poll remains');
    h.ack('feedback', 10); await h.output.tick();
    assert.equal(d.currentCorrection.result, 'confirmed');
    assert.equal(h.writes.length, 1, 'ACK does not allow an increase in the same tick');
    h.advance(2000); h.grant([10], {phases: [phases]}); h.measure(0, 10, phases); h.ack('cmd', 10);
    h.ack('feedback', 11); await h.output.tick();
    assert.deepEqual(h.writes.at(-1), {id: 'allow', val: 0});
    assert.equal(h.writes.filter(w => w.id === 'cmd').length, 1, 'confirmation does not replenish correction allowance');
});

test('issue216: missing ACK stops at the original deadline; polls cannot prolong it', async () => {
    const h = await correctionCandidate(); await h.output.tick();
    const deadline = h.output.devices[0].currentCorrection.deadline;
    h.advance(21000); h.grant([10]); h.ack('feedback', 11);
    await h.output.tick();
    assert.equal(h.output.devices[0].currentCorrection.deadline, deadline);
    assert.deepEqual(h.writes, [{id: 'cmd', val: 10}, {id: 'allow', val: 0}]);
});

test('issue216: refreshing the separate command ACK after the conflicting poll cannot replenish or block the one attempt', async () => {
    const h = await correctionCandidate();
    const sourceAt = h.states.get('feedback').ts;
    h.advance(1000); h.grant([10]); h.ack('cmd', 10);
    h.put('feedback', 11, {ts: sourceAt});
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 10}]);
    h.advance(2000); h.grant([10]); h.ack('cmd', 10);
    await h.output.tick();
    assert.equal(h.writes.length, 1, 'command ACK alone is not the configured current feedback');
});

test('issue216: delayed processing accepts a genuinely timely ACK, while a pre-dispatch value cannot confirm correction', async () => {
    const h = await correctionCandidate(); await h.output.tick();
    const {at, deadline} = h.output.devices[0].currentCorrection;
    h.put('feedback', 10, {ts: at - 1});
    await h.output.tick();
    assert.equal(h.output.devices[0].currentCorrection.result, 'pending');
    h.advance(21000); h.grant([10]); h.put('feedback', 10, {ts: deadline - 1});
    await h.output.tick();
    assert.equal(h.output.devices[0].currentCorrection.result, 'confirmed');
    assert.deepEqual(h.writes, [{id: 'cmd', val: 10}]);
});

test('issue216: a late ACK stops, even when its value matches the correction', async () => {
    const h = await correctionCandidate(); await h.output.tick();
    h.advance(21000); h.grant([10]); h.ack('feedback', 10);
    await h.output.tick();
    assert.deepEqual(h.writes.at(-1), {id: 'allow', val: 0});
});

test('issue216: a restart retains the spent correction allowance after confirmation', async () => {
    const h = await correctionCandidate(); await h.output.tick();
    h.advance(2000); h.grant([10]); h.ack('feedback', 10); await h.output.tick();
    const restarted = new WallboxOutput(h.adapter, {now: h.output.now});
    await restarted.initialize();
    assert.equal(restarted.devices[0].currentCorrection.result, 'confirmed');
    assert.equal(restarted.devices[0].currentCorrection.at, h.output.devices[0].currentCorrection.at);
});

for (const [name, change, expected] of [
    ['master loss', h => h.put('ems.0.System.RealOutputsEnabled', false), [{id: 'allow', val: 0}]],
    ['hard cap loss', h => h.grant([10], {hardBudgetW: 1000}), [{id: 'allow', val: 0}]],
    ['current reduction', h => {h.grant([8]); h.put('export', 1840);}, [{id: 'cmd', val: 8}]],
    ['storage delay beyond deadline', h => {h.advance(21000); h.grant([10]);}, [{id: 'allow', val: 0}]]
]) test(`issue216: recheck ${name} after saving the restart fence and before sending correction`, async () => {
    const h = await correctionCandidate(), original = h.adapter.setCompatState;
    let changed = false;
    h.adapter.setCompatState = async (id, value, ack) => {
        await original(id, value, ack);
        if (!changed && id.endsWith('.CurrentCorrection_JSON')) {
            changed = true; change(h);
        }
    };
    await h.output.tick();
    assert.deepEqual(h.writes, expected);
});

test('issue216: failed restart-fence storage never dispatches a corrective current', async () => {
    const h = await correctionCandidate(), original = h.adapter.setCompatState;
    h.adapter.setCompatState = async (id, value, ack) => {
        if (id.endsWith('.CurrentCorrection_JSON')) throw new Error('fixture storage failure');
        return original(id, value, ack);
    };
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
});

test('issue216: a reduction supersedes the correction without restoring old current or extending its deadline', async () => {
    const h = await correctionCandidate(); await h.output.tick();
    const deadline = h.output.devices[0].currentCorrection.deadline;
    h.advance(2000); h.grant([8]); h.put('export', 1840);
    await h.output.tick();
    assert.deepEqual(h.writes.at(-1), {id: 'cmd', val: 8});
    assert.equal(h.output.devices[0].currentCorrection.deadline, deadline);
    h.advance(2000); h.grant([8]); h.ack('feedback', 8); h.measure(0, 8);
    await h.output.tick();
    assert.equal(h.output.devices[0].lastA, 8);
    assert.ok(!h.writes.some(w => w.id === 'allow'));
});

for (const [name, change] of [
    ['unconfirmed command ID', h => h.put('cmd', 10, {ack: false})],
    ['larger current conflict', h => h.ack('feedback', 13)],
    ['stale power', h => h.put('power', 2.3, {ts: 1})],
    ['bad quality', h => h.put('power', 2.3, {q: 128})],
    ['device error', h => h.put('error', 5)],
    ['master off', h => h.put('ems.0.System.RealOutputsEnabled', false)],
    ['user release withdrawn', h => h.put('userAllow', false)],
    ['unexpected OFF', h => h.ack('allow', 0)],
    ['hard budget below minimum', h => h.grant([10], {hardBudgetW: 1000})],
    ['peer/heater hard reservation', h => {
        h.grant([10], {hardBudgetW: 5000});
        h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 4000);
    }]
]) test(`issue216: no correction bypasses ${name}`, async () => {
    const h = await correctionCandidate(); change(h); await h.output.tick();
    assert.ok(!h.writes.some(w => w.id === 'cmd'));
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, false);
});

test('issue216: restart does not adopt an unresolved correction as healthy charging', async () => {
    const h = await correctionCandidate(); await h.output.tick(); h.writes.length = 0;
    const restarted = new WallboxOutput(h.adapter, {now: h.output.now});
    await restarted.initialize();
    assert.equal(restarted.devices[0].recovering, false);
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /ungeklärte Sollstrom/);
});

test('3P admission waits for the actual heater reservation plus 300 W headroom at every start stage', async () => {
    const h = parallelSetup(1);
    Object.assign(h.config, {wb0ProductionPhases: 3, wb0PhaseSwitchEnabled: true, wb0MaxCurrent3pA: 32, wb0MaxPowerW: 22080});
    h.put('ems.0.Config.WallboxStartReserve_W', 300);
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 5140);
    h.grant([6], {phases: [3], hardBudgetW: 9361}); // 81 W remaining above 6 A
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val, 5140);
    h.advance(2000); h.grant([6], {phases: [3], hardBudgetW: 9361});
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 2140);
    await h.output.tick(); h.ack('allow', 0); await h.output.tick(); h.ack('feedback', 6);
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 5140);
    await h.output.tick();
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 1), 'renewed reservation blocks ON');
    h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 2140);
    await h.output.tick();
    assert.deepEqual(h.writes.at(-1), {id: 'allow', val: 1}, h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val);
});

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

test('issue116 late OFF recovers only the stopped parallel car and preserves peer load', async () => {
    const h = parallelSetup(); await h.startParallel();
    h.grant([6, 0]); h.writes.length = 0; await h.output.tick();
    h.advance(21000); h.grant([6, 0]); await h.output.tick();
    const stopped = h.output.devices[1], peer = h.output.devices[0];
    assert.match(stopped.fault, /AUS-Rueckmeldung/);
    assert.equal(stopped.owned, true);
    h.advance(1000); h.grant([6, 0]); h.ack('allow1', 0); h.electricalOff(1);
    await h.output.tick();
    assert.equal(stopped.owned, false);
    assert.equal(stopped.fault, '');
    assert.match(h.states.get('ems.0.Devices.Wallbox1.OutputStatus').val, /Fehlersperre automatisch aufgehoben/);
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
        h.put('ems.0.Control.RestartHandoffSince', fault === 'handoff_expired' ? 99000 : 1000000);
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

async function measuredHoldOutput() {
    const h = parallelSetup(1); await h.startParallel(); h.advance(10000);
    const d = h.output.devices[0];
    d.lastA = 8; d.lastAt = 990000; d.pending = null; d.response = null;
    d.electricalCommandAt = 1000000;
    h.grant([8]); h.measure(0, 8);
    h.put('power', 1.73, {ts: 1010002}); h.put('i1', 7.5, {ts: 1010002});
    h.put('import', 0); h.put('export', 170);
    h.writes.length = 0;
    return h;
}

test('parallel output holds a fresh confirmed 8 A response within 1800 W instead of dropping to 7 A', async () => {
    const h = await measuredHoldOutput();
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    const d = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
    assert.equal(d.basis, 'measured-current-hold');
    assert.equal(d.requiredW, 1730);
    assert.equal(d.nominalRequiredW, 1840);
    assert.equal(d.nextA, 8);
    assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val >= 1840);
    h.grant([9]); h.writes.length = 0;
    await h.output.tick();
    assert.deepEqual(h.writes, [], 'measured hold must not create a new increase');
});

test('measured output hold yields to deficits, lower allocations, hard caps and pre-command samples', async () => {
    for (const change of [
        h => h.put('export', 50),
        h => h.grant([7]),
        h => { h.config.wb0CommissioningMaxA = 7; },
        h => h.grant([8], {hardBudgetW: 1800}),
        h => h.put('power', 1.73, {ts: 1000000})
    ]) {
        const h = await measuredHoldOutput(); change(h);
        await h.output.tick();
        assert.ok(h.writes.some(write => write.id === 'cmd' && write.val <= 7));
        assert.ok(!h.writes.some(write => write.id === 'cmd' && write.val > 8));
    }
});

function grantPVStep(h, amps = 9, tolerance = 50, owner = 0) {
    h.grant([amps]);
    const key = 'ems.0.Control.ParallelWallboxAllocation_JSON';
    const allocation = JSON.parse(h.states.get(key).val);
    h.put(key, JSON.stringify({...allocation, pvStepOwner: owner, pvStepToleranceW: tolerance}));
    h.put('ems.0.Control.TargetGridPower_W', 0);
}

test('shared measured PV step sends 9 A for 220 W export and waits for a real reply before another step', async () => {
    const h = await measuredHoldOutput();
    grantPVStep(h); h.put('export', 220);
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 9}]);
    assert.equal(h.output.devices[0].measuredBudgetStep.amps, 9);
    const d = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
    assert.equal(d.requiredW, 1960);
    assert.equal(d.pvStepToleranceW, 50);
    assert.equal(d.pvStepAdmissionW, 30);
    h.advance(6000); grantPVStep(h, 10); h.ack('feedback', 9);
    h.writes.length = 0;
    await h.output.tick();
    assert.deepEqual(h.writes, [], JSON.stringify({message:'ACK/unchanged uptake cannot earn a second step', budget:h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON'),status:h.states.get('ems.0.Devices.Wallbox0.OutputStatus')}));
});

test('PV step respects admission hysteresis, ownership, disabled config and hard current caps', async () => {
    for (const change of [
        h => h.put('export', 199), // 31 W expected import > 30 W admission.
        h => { h.config.wallboxPVImportToleranceW = 0; },
        h => grantPVStep(h, 9, 50, 1),
        h => { h.config.wb0CommissioningMaxA = 8; },
        h => h.put('power', 1.73, {ts: 1000000})
    ]) {
        const h = await measuredHoldOutput(); grantPVStep(h); h.put('export', 220); change(h);
        await h.output.tick();
        assert.ok(!h.writes.some(write => write.id === 'cmd' && write.val > 8));
    }
});

test('falling live meter budget at send boundary rejects the additional measured PV step', async () => {
    const h = await measuredHoldOutput(); grantPVStep(h); h.put('export', 220);
    const send = h.output.send.bind(h.output);
    h.output.send = async (device, key, value) => {
        if (key === 'command' && value === 9) h.put('export', 0);
        return send(device, key, value);
    };
    await h.output.tick();
    assert.ok(!h.writes.some(write => write.id === 'cmd' && write.val === 9));
});

test('an unanswered measured PV step yields immediately to a genuine deficit or hard cap', async () => {
    for (const hard of [false, true]) {
        const h = await measuredHoldOutput(); grantPVStep(h); h.put('export', 220);
        await h.output.tick(); h.writes.length = 0; h.advance(6000); grantPVStep(h);
        if (hard) h.config.wb0CommissioningMaxA = 8;
        else h.put('export', 0);
        await h.output.tick();
        assert.ok(h.writes.some(write => write.id === 'cmd' && write.val <= 8));
    }
});

test('mandatory output retains confirmed PV-funded current but yields to real deficits and hard limits', async () => {
    for (const scenario of ['hold', 'deficit', 'hard', 'unconfirmed']) {
        const h = await measuredHoldOutput();
        h.put('soc', 10);
        if (scenario === 'deficit') h.put('export', 50);
        if (scenario === 'hard') h.grant([8], {hardBudgetW: 1800});
        if (scenario === 'unconfirmed') h.put('power', 1.73, {ts: 1000000});
        await h.output.tick();
        if (scenario === 'hold') {
            assert.deepEqual(h.writes, []);
            const d = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
            assert.equal(d.basis, 'measured-current-hold');
            assert.equal(d.pvStepToleranceW, 0, 'mandatory charging gains no PV import extension');
        } else assert.ok(h.writes.some(w => w.id === 'cmd' && w.val <= 7), scenario);
    }
});

test('output independently stops at energy-estimated target with unchanged raw SoC', async () => {
    for (const staleCounter of [false, true]) {
        const h=await measuredHoldOutput();
        h.config.wb0SocEstimationEnabled=true;
        h.config.wb0CapacityKWh=50;h.config.wb0SocEfficiencyPct=90;
        h.mapping.DP_WB0_SOC_ENERGY='chargedKWh';
        h.put('soc',79.8,{ts:1000000});
        const {estimateSoc}=require('../lib/vehicle-soc-estimator');
        const signature=JSON.stringify(['soc','chargedKWh','',50,90]);
        const seed=estimateSoc({now:1000000,reported:{val:79.8,ts:1000000,ack:true},
            counter:{val:10,ts:1000000,ack:true},car:{val:2,ts:1000000,ack:true},
            signature,capacityKWh:50,efficiencyPct:90});
        h.put('ems.0.Vehicles.Wallbox0.SocEstimateLedger_JSON',JSON.stringify(seed.ledger));
        h.put('chargedKWh',10.2,{ts:staleCounter ? 900000 : 1010001});
        h.writes.length=0;await h.output.tick();
        if(staleCounter) assert.ok(!h.writes.some(w=>w.id==='allow'&&w.val===0), 'invalid counter falls back to raw SoC');
        else {
            assert.ok(h.writes.some(w=>w.id==='allow'&&w.val===0));
            assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Ziel-SoC/);
        }
        assert.equal(h.states.get('soc').val,79.8);
    }
});

test('minimum-SoC output admits one 70 W import step with 100 W setting but not a 90 W new step', async () => {
    for(const exportW of [160,140]) {
        const h=await measuredHoldOutput();h.put('soc',10);
        h.config.wallboxPVImportToleranceW=100;grantPVStep(h,9,100);h.put('export',exportW);
        await h.output.tick();
        if(exportW===160) {
            assert.ok(h.writes.some(w=>w.id==='cmd'&&w.val===9));
            const d=JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
            assert.equal(d.pvStepToleranceW,100);assert.equal(d.pvStepAdmissionW,80);
        } else assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>8));
    }
});

test('minimum-SoC PV step rechecks the meter at send boundary with the same 100 W policy', async () => {
    const h=await measuredHoldOutput();h.put('soc',10);
    h.config.wallboxPVImportToleranceW=100;grantPVStep(h,9,100);h.put('export',160);
    const send=h.output.send.bind(h.output);
    h.output.send=async(d,key,value)=>{if(key==='command'&&value===9)h.put('export',140);return send(d,key,value);};
    await h.output.tick();
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val===9));
});
test('minimum-SoC output holds at 100 W allowance and reduces above it', async () => {
    for(const imported of [100,101]) {
        const h=await measuredHoldOutput();h.put('soc',10);h.config.wallboxPVImportToleranceW=100;
        const d=h.output.devices[0];d.lastA=9;
        grantPVStep(h,9,100);h.ack('feedback',9);
        h.put('power',1.96,{ts:1010002});h.put('i1',8.5,{ts:1010002});
        h.put('export',0);h.put('import',imported);
        h.writes.length=0;await h.output.tick();
        if(imported===100)assert.deepEqual(h.writes,[]);
        else assert.ok(h.writes.some(w=>w.id==='cmd'&&w.val<=8));
    }
});


// 19 Oct 2026 10:31:30-36 MESZ: SMA already sees the 9-A uptake,
// while the go-e power/current cache still describes the preceding 6 A.
async function asynchronousMeterIncrease({count = 1} = {}) {
    const h = parallelSetup(count);
    await h.startParallel(Array(count).fill(6));
    h.put('ems.0.Control.TargetGridPower_W', 0);
    h.advance(6000);
    h.measure(0, 5.9); h.ack('feedback', 6); h.put('power', 1.37);
    h.put('export', 785.4); h.grant([9, ...Array(count - 1).fill(6)]);
    h.writes.length = 0;
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 9}]);
    const commandAt = h.output.devices[0].response.at;
    h.advance(6000);
    h.put('feedback', 9, {ts: commandAt + 268});
    h.put('power', 1.35, {ts: commandAt + 578});
    h.put('i1', 5.8, {ts: commandAt + 438});
    h.put('import', 0, {ts: commandAt + 5370});
    h.put('export', 31.1, {ts: commandAt + 5372});
    h.grant([0, ...Array(count - 1).fill(6)], {budgetW: 0});
    const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    grant.allocations[0].authorized = true;
    h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
    h.writes.length = 0;
    return h;
}

test('recorded SMA/go-e timestamp skew retains the admitted 9 A until electrical response', async () => {
    const h = await asynchronousMeterIncrease();
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.output.devices[0].lastA, 9);
    const response = h.output.devices[0].response;
    const deadline = response.ackAt + h.output.responseSettleTimeoutMs();
    const diagnostic = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
    assert.equal(diagnostic.decision, 'await-asynchronous-meter-response');
    assert.equal(diagnostic.nextA, 9);
    assert.equal(diagnostic.responseDeadlineAt, deadline);
    assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val >= 2070);
    h.advance(1000); h.grant([9]); h.measure(0, 9); h.put('export', 31.1);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'confirmed');
});

test('asynchronous meter hold yields to real deficits, hard caps and new peer reservations', async t => {
    for (const fault of ['deficit', 'hard cap', 'house', 'stale', 'peer', 'heater', 'expired', 'aligned', 'no admission', 'no ACK', 'old grid']) {
        await t.test(fault, async () => {
            const h = await asynchronousMeterIncrease({count: fault === 'peer' ? 2 : 1});
            if (fault === 'deficit') { h.put('import', 400); h.put('export', 0); }
            if (fault === 'hard cap') h.grant([6], {hardBudgetW: 1380});
            if (fault === 'house') h.put('h1', 48);
            if (fault === 'stale') h.put('power', 1.35, {ts: 1});
            if (fault === 'peer') h.put('power1', 2.07);
            if (fault === 'heater') h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W', 1000);
            if (fault === 'no admission') h.output.meterReservations.delete(h.output.devices[0].response);
            if (fault === 'no ACK') h.put('feedback', 6);
            if (fault === 'old grid') {
                const at = h.output.devices[0].response.at;
                h.put('import', 0, {ts: at - 1}); h.put('export', 31.1, {ts: at - 1});
            }
            if (fault === 'expired') {
                await h.output.tick(); assert.deepEqual(h.writes, []);
                const deadline = h.output.devices[0].response.ackAt + h.output.responseSettleTimeoutMs();
                h.advance(46000); h.grant([0], {budgetW: 0});
                const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
                grant.allocations[0].authorized = true;
                h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
                assert.ok(h.output.now() > deadline);
                const now = h.output.now();
                h.put('power', 1.35, {ts: now - 5000});
                h.put('i1', 5.8, {ts: now - 5000});
                h.put('export', 31.1);
            }
            if (fault === 'aligned') { h.put('power', 1.35); h.put('i1', 5.8); }
            await h.output.tick();
            assert.ok(h.writes.some(w => w.id === 'allow' && w.val === 0
                || w.id === 'cmd' && w.val < 9), 'must stop/reduce instead of retaining 9 A');
        });
    }
});


test('SMA/go-e skew holds 3P without releasing the outstanding phase reservation', async () => {
    const h = await unansweredParallelIncrease({phases: 3});
    h.put('ems.0.Control.TargetGridPower_W', 0);
    const at = h.output.devices[0].response.at;
    h.put('power', 1.35 * 3, {ts: at + 578});
    for (const id of ['i1', 'i2', 'i3']) h.put(id, 5.8, {ts: at + 438});
    h.put('export', 31.1, {ts: at + 5372}); h.put('import', 0, {ts: at + 5370});
    h.grant([0], {budgetW: 0, phases: [3]});
    const grant = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    grant.allocations[0].authorized = true;
    h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(grant));
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.output.devices[0].lastA, 9);
    assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val >= 6210);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).decision,
        'await-asynchronous-meter-response');
});


// Live alpha.97 session 1792400166497, records 11768/11802 and 11859/11910.
// A fresh poll after ACK still describes the OLD electrical level; the old
// +/-3 A uptake rule must not certify this as the new command's response.
async function prematureElectricalReply({targetA = 13, phases = 1, initialA = null, initialW = null} = {}) {
    const h = await unansweredParallelIncrease({phases});
    h.put('ems.0.Control.TargetGridPower_W', 0);
    h.config.wallboxPVImportToleranceW = 100;
    const grant = h.grant;
    h.grant = (...args) => {
        grant(...args);
        const allocation = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
        allocation.pvStepOwner = 0; allocation.pvStepToleranceW = 100;
        h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(allocation));
    };
    // Begin at the independently established 12-A running state in the log.
    const d = h.output.devices[0];
    d.lastA = 12; d.lastAt = 0; d.pending = null; d.response = null;
    h.ack('feedback', 12);
    const beforeW = initialW ?? (targetA === 13 ? 2740 : 2940);
    const beforeA = initialA ?? (targetA === 13 ? 11.7 : 12.6);
    h.advance(1000); h.grant([targetA], {phases: [phases]});
    h.measure(0, beforeA, phases); h.ack('feedback', 12); h.put('power', beforeW * phases / 1000);
    h.put('export', targetA === 13 ? 462.9 * phases : 397.3 * phases);
    h.writes.length = 0; await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: targetA}], JSON.stringify({status:h.states.get('ems.0.Devices.Wallbox0.OutputStatus'),diag:h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON')}));
    const at = h.output.devices[0].response.at;
    h.advance(2000); h.grant([targetA + 1], {phases: [phases]});
    h.put('feedback', targetA, {ts: at + 200});
    h.put('power', (targetA === 13 ? 2710 : 2730) * phases / 1000, {ts: at + 400});
    for (const id of ['i1', ...(phases === 3 ? ['i2', 'i3'] : [])])
        h.put(id, targetA === 13 ? 11.6 : 11.7, {ts: at + 380});
    h.put('import', targetA === 13 ? 0 : 63.7, {ts: at + 1700});
    h.put('export', targetA === 13 ? 259.5 * phases : 0, {ts: at + 1702});
    h.writes.length = 0;
    return h;
}

test('live 12→13 and 12→14 A polls at the old current do not prematurely confirm uptake', async t => {
    for (const targetA of [13, 14]) await t.test(`${targetA} A`, async () => {
        const h = await prematureElectricalReply({targetA});
        await h.output.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.output.devices[0].lastA, targetA);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
        const response = h.output.devices[0].response;
        assert.ok(response);
        const deadline = response.ackAt + h.output.responseSettleTimeoutMs();
        assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).decision,
            'await-asynchronous-meter-response');
        h.advance(1000); h.grant([targetA]); h.measure(0, targetA); h.put('export', 0); h.put('import', 0);
        await h.output.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'confirmed');
        assert.ok(h.output.now() < deadline);
    });
});


test('3P increase needs power and every used phase to show progress; partial polls cannot unlock another step', async t => {
    for (const partial of ['unchanged', 'power-only', 'current-only', 'one-phase']) await t.test(partial, async () => {
        const h = await prematureElectricalReply({targetA: 14, phases: 3});
        if (partial === 'power-only') h.put('power', 14 * 690 / 1000);
        if (partial === 'current-only') for (const id of ['i1', 'i2', 'i3']) h.put(id, 14);
        if (partial === 'one-phase') { h.put('power', 14 * 690 / 1000); h.put('i1', 14); }
        await h.output.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
        const deadline = h.output.devices[0].response.ackAt + h.output.responseSettleTimeoutMs();
        h.advance(6000); h.grant([14], {phases: [3]}); h.measure(0, 14, 3); h.put('import', 0); h.put('export', 0);
        await h.output.tick();
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'confirmed');
        assert.deepEqual(h.writes, []);
        assert.ok(h.output.now() < deadline);
    });
});

test('old-level response wait does not hide deficits, hard caps, expiry or another increase', async t => {
    for (const fault of ['deficit', 'hard cap', 'expiry', 'more surplus']) await t.test(fault, async () => {
        const h = await prematureElectricalReply();
        await h.output.tick(); assert.deepEqual(h.writes, []);
        const response = h.output.devices[0].response;
        const deadline = response.ackAt + h.output.responseSettleTimeoutMs();
        const oldPower = {...h.states.get('power')}, oldCurrent = {...h.states.get('i1')};
        h.advance(fault === 'expiry' ? 46000 : 6000);
        h.grant([fault === 'hard cap' ? 12 : 16], {hardBudgetW: fault === 'hard cap' ? 2760 : null});
        if (fault === 'deficit') { h.put('import', 500); h.put('export', 0); }
        if (fault === 'more surplus') h.put('export', 3000);
        if (fault !== 'expiry') { h.states.set('power', oldPower); h.states.set('i1', oldCurrent); }
        else { h.put('power', 2.71); h.put('i1', 11.6); h.put('export', 3000); }
        await h.output.tick();
        if (fault !== 'expiry') assert.ok(!h.writes.some(w => w.id === 'cmd' && w.val > 13));
        if (fault === 'more surplus') {
            assert.deepEqual(h.writes, []);
            assert.equal(h.output.devices[0].response.ackAt + h.output.responseSettleTimeoutMs(), deadline);
        } else if (fault === 'expiry') {
            assert.deepEqual(h.writes, [{id:'cmd',val:14}], 'only one fully funded probe after the original deadline');
            assert.equal(h.output.devices[0].limitedProbeAttempts, 1);
            assert.ok(h.output.now() > deadline);
            h.advance(6000); h.grant([16]); h.measure(0, 14); h.put('export', 3000);
            h.writes.length = 0; await h.output.tick();
            h.advance(6000); h.grant([16]); h.measure(0, 14); await h.output.tick();
            assert.ok(h.writes.some(w => w.id === 'cmd' && w.val > 14),
                'genuine later uptake must unlock ordinary increases without restart');
        } else assert.ok(h.writes.some(w => w.id === 'cmd' && w.val < 13));
    });
});


test('a fresh measured commanded level may confirm without requiring an impossible extra half ampere', async () => {
    const h = await prematureElectricalReply({initialA: 12.6, initialW: 2940});
    h.put('power', 2.94); h.put('i1', 12.6); h.put('import', 0); h.put('export', 0);
    h.grant([13]); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'confirmed');
    assert.deepEqual(h.writes, []);
});


test('confirmed pending-current retention still yields to deficit, hard cap and withdrawn soft grant', async t => {
    for (const limit of ['deficit', 'hard cap', 'withdrawn grant']) await t.test(limit, async () => {
        const h = await prematureElectricalReply({initialA: 12.6, initialW: 2940});
        h.put('power', 2.94); h.put('i1', 12.6); h.put('export', 0); h.put('import', 0);
        if (limit === 'deficit') h.put('import', 400);
        if (limit === 'hard cap') h.grant([12], {hardBudgetW: 2760});
        if (limit === 'withdrawn grant') h.grant([12]);
        await h.output.tick();
        assert.ok(h.writes.some(w => w.id === 'cmd' && w.val < 13));
        assert.ok(!h.writes.some(w => w.id === 'cmd' && w.val > 13));
    });
});

test('inactive delayed peer does not stop an established car and cannot start itself', async () => {
    const h = parallelSetup(); await h.startParallel();
    h.grant([6, 0]); await h.output.tick();
    h.ack('allow1', 0); h.electricalOff(1); await h.output.tick();
    const old = 960000;
    h.put('allow1', 0, {ts: old, lc: old - 1000});
    for (const id of ['power1', 'i11', 'i12', 'i13']) h.put(id, 0, {ts: old});
    h.grant([6, 0]); h.writes.length = 0;
    await h.output.tick();
    assert.equal(h.output.parallelLoadReservations(h.mapping, 0).valid, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 0 || w.id === 'allow1' && w.val === 1));
    h.put('power1', 1);
    assert.equal(h.output.parallelLoadReservations(h.mapping, 0).valid, false);
});

async function freshResponseWithOldAllocation(count = 1) {
    const h = parallelSetup(count); await h.startParallel(); h.advance(10000);
    const d = h.output.devices[0];
    d.lastA = 14; d.lastAt = 1000000; d.pending = null; d.response = null;
    d.electricalCommandAt = 1000000;
    h.measure(0, 14); h.put('power', 3.2, {ts: 1010002}); h.put('i1', 13.7, {ts: 1010002});
    h.put('import', 0); h.put('export', 271.5);
    h.put('ems.0.Devices.Wallbox0.ResponseState', 'confirmed');
    h.put('ems.0.Devices.Wallbox0.ResponseCommand_A', 14);
    h.grant([11, ...Array(count-1).fill(6)]);
    const a = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    a.allocations[0].reservedW = 3220; a.heaterTargetW = 0;
    h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(a));
    h.put('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON', JSON.stringify({valid:true,timestamp:a.timestamp,measuredPowerAt:1009000}));
    h.writes.length = 0;
    return h;
}

test('13:01:14 confirmed 14 A does not drop to stale 11 A allocation while still exporting', async () => {
    const h = await freshResponseWithOldAllocation(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).basis, 'fresh-response-allocation-hold');
    assert.equal(h.output.devices[0].lastA, 14);
});

for (const [name, change] of [
    ['fresh allocation basis', h => h.put('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON', JSON.stringify({valid:true,timestamp:1010000,measuredPowerAt:1010002}))],
    ['real deficit', h => {h.put('import',500);h.put('export',0);}],
    ['hard cap', h => {h.config.wb0CommissioningMaxA=11;}],
    ['withdrawn grant', h => h.grant([0])],
    ['missing provenance', h => h.put('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON','{}')],
    ['new heater target', h => {const a=JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);a.heaterTargetW=1000;h.put('ems.0.Control.ParallelWallboxAllocation_JSON',JSON.stringify(a));}],
    ['reservation withdrawn', h => {const a=JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);a.allocations[0].reservedW=2530;h.put('ems.0.Control.ParallelWallboxAllocation_JSON',JSON.stringify(a));}]
]) test('fresh response allocation hold yields: '+name, async () => {
    const h=await freshResponseWithOldAllocation(); change(h); await h.output.tick();
    assert.ok(h.writes.some(w=>w.id==='cmd'&&w.val<14||w.id==='allow'&&w.val===0));
});


test('fresh response hold cannot retain capacity promised to a new peer increase', async () => {
    const h = await freshResponseWithOldAllocation(2);
    const a = JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);
    a.allocations[1].targetA = 12; a.allocations[1].reservedW = 2760; a.budgetW = 5290;
    h.put('ems.0.Control.Targets.Wallbox1_W', 2760); h.put('ems.0.Control.Targets.Wallbox1_A', 12);
    h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify(a));
    await h.output.tick();
    assert.ok(h.writes.some(w => w.id === 'cmd' && w.val < 14));
});

async function eqeLimitedReply(measuredStep = false) {
    const h=parallelSetup(1); await h.startParallel(); h.advance(10000);
    h.config.wallboxPVImportToleranceW=100;
    const grant=h.grant;
    h.grant=(...args)=>{grant(...args);const a=JSON.parse(h.states.get('ems.0.Control.ParallelWallboxAllocation_JSON').val);a.pvStepOwner=0;a.pvStepToleranceW=100;h.put('ems.0.Control.ParallelWallboxAllocation_JSON',JSON.stringify(a));};
    const d=h.output.devices[0];d.lastA=9;d.lastAt=0;d.pending=null;d.response=null;
    h.grant([10]);h.measure(0,7.8);h.ack('feedback',9);h.put('power',1.75);h.put('export',measuredStep?300:2200);
    h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:10}]);
    h.advance(2000);h.ack('feedback',10);h.measure(0,7.8);h.ack('feedback',10);h.put('power',1.75);
    await h.output.tick(); h.writes.length=0;
    return h;
}

test('EQE 7.8 A at acknowledged 10 A receives a bounded fully funded 11 A probe after timeout', async () => {
    const h=await eqeLimitedReply(); h.advance(46000);h.grant([16]);await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:11}]);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).decision,'limited-response-probe');
    h.ack('feedback',11);h.measure(0,8.8);h.ack('feedback',11);h.put('power',1.98);h.advance(2000);h.grant([16]);
    await h.output.tick();
    assert.equal(h.output.devices[0].limitedProbeAttempts,0,'measured progress restores the ordinary controller');
});

test('a truly capped car cannot wind up past two unanswered probes', async () => {
    const h=await eqeLimitedReply();
    for(const command of [11,12]) {
        h.advance(46000);h.grant([16]);h.writes.length=0;await h.output.tick();
        assert.deepEqual(h.writes,[{id:'cmd',val:command}]);
        h.advance(1000);h.measure(0,7.8);h.ack('feedback',command);h.put('power',1.75);await h.output.tick();
    }
    h.advance(46000);h.grant([16]);h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[]);assert.equal(h.output.devices[0].limitedProbeAttempts,2);
});

for(const [fault,change] of [
    ['before deadline',()=>{}],
    ['no measured funding',h=>h.put('export',100)],
    ['no electrical uptake',h=>{h.put('power',0);h.put('i1',0);}],
    ['old power',h=>h.put('power',1.75,{ts:1})],
    ['missing ACK',h=>h.put('feedback',10,{ack:false})],
    ['hard current limit',h=>{h.config.wb0CommissioningMaxA=10;}],
    ['withdrawn grant',h=>h.grant([0])]
]) test('limited response probe retains safety: '+fault, async()=>{
    const h=await eqeLimitedReply();h.advance(fault==='before deadline'?10000:46000);h.grant([16]);change(h);
    h.writes.length=0;await h.output.tick();assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>10));
});


test('fully nominal funded retry can replace the expired measured-step reservation',async()=>{
    const h=await eqeLimitedReply(true);
    assert.ok(h.output.devices[0].measuredBudgetStep);
    h.advance(46000);h.grant([16]);h.put('export',2200);h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:11}]);assert.equal(h.output.devices[0].measuredBudgetStep,null);
});

async function eqeStaleAllocation({amps=17, actualW=3720, actualA=16.7, targetA=14, exportW=56.1}={}) {
    const h=await freshResponseWithOldAllocation();
    h.config.wallboxPVImportToleranceW=100;
    const d=h.output.devices[0];d.lastA=amps;
    h.grant([targetA]);
    const key='ems.0.Control.ParallelWallboxAllocation_JSON';
    const a=JSON.parse(h.states.get(key).val);
    a.allocations[0].reservedW=amps*230;a.heaterTargetW=0;a.pvStepOwner=0;a.pvStepToleranceW=100;
    h.put(key,JSON.stringify(a));
    h.put('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON',JSON.stringify({valid:true,timestamp:a.timestamp,measuredPowerAt:1009000}));
    h.put('ems.0.Devices.Wallbox0.ResponseCommand_A',amps);
    h.ack('feedback',amps);h.put('power',actualW/1000,{ts:1010002});h.put('i1',actualA,{ts:1010002});
    h.put('export',exportW);h.writes.length=0;
    return h;
}

for(const f of [
    {amps:17,actualW:3720,actualA:16.7,targetA:14,exportW:56.1},
    {amps:15,actualW:3300,actualA:14.7,targetA:14,exportW:773.8}
]) test('live EQE confirmed uptake holds '+f.amps+' A across stale allocation without assuming 230 V uptake',async()=>{
    const h=await eqeStaleAllocation(f);await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).basis,'fresh-response-allocation-hold');
    h.put('import',500);h.put('export',0);await h.output.tick();
    assert.ok(h.writes.some(w=>w.id==='cmd'&&w.val<f.amps),'real deficit still reduces');
});

test('live EQE 139 W deficit makes one relative reduction rather than five nominal amps',async()=>{
    const h=await eqeStaleAllocation({amps:17,actualW:3100,actualA:13.9,targetA:16,exportW:0});
    const d=h.output.devices[0];
    d.response={amps:17,previousAmps:14,at:1005000,ackAt:1006000,start:false};
    d.electricalCommandAt=1005000;
    h.put('import',138.6);
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:16}]);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).basis,'measured-relative-reduction');
});

for(const [name,change] of [
    ['lower allocation',h=>h.grant([12])],
    ['hard current cap',h=>{h.config.wb0CommissioningMaxA=12;}],
    ['hard shared budget',h=>h.grant([16],{hardBudgetW:3000})],
    ['pre-command power',h=>h.put('power',3.1,{ts:1005000})],
    ['unacknowledged current',h=>h.ack('feedback',14)],
    ['missing electrical ACK',h=>{h.output.devices[0].response.ackAt=0;h.put('feedback',17,{ts:1004000});}]
]) test('relative deficit reduction retains protection: '+name,async()=>{
    const h=await eqeStaleAllocation({amps:17,actualW:3100,actualA:13.9,targetA:16,exportW:0});
    const d=h.output.devices[0];d.response={amps:17,previousAmps:14,at:1005000,ackAt:1006000,start:false};d.electricalCommandAt=1005000;
    h.put('import',138.6);change(h);await h.output.tick();
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>=16));
});

async function asynchronousMeasuredPVStep() {
    const h=await measuredHoldOutput();
    h.config.wallboxPVImportToleranceW=100;
    const d=h.output.devices[0];d.lastA=12;
    h.ack('feedback',12);h.put('power',2.66,{ts:1010002});h.put('i1',11.9,{ts:1010002});
    grantPVStep(h,13,100);h.put('export',197);
    h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:13}],JSON.stringify({status:h.states.get('ems.0.Devices.Wallbox0.OutputStatus'),diag:h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON')}));
    assert.ok(d.measuredBudgetStep);
    const at=d.response.at;
    h.advance(2000);grantPVStep(h,13,100);
    h.put('feedback',13,{ts:at+200});
    h.put('power',2.65,{ts:at+500});h.put('i1',11.9,{ts:at+480});
    h.put('import',0,{ts:at+1800});h.put('export',68,{ts:at+1802});
    h.writes.length=0;
    return h;
}

test('live EQE measured 12→13 A step survives 68 W export with SMA ahead of old wallbox uptake',async()=>{
    const h=await asynchronousMeasuredPVStep();await h.output.tick();
    assert.deepEqual(h.writes,[],'must not reverse the admitted step to 11 A');
    const d=h.output.devices[0],response=d.response,proof=d.measuredBudgetStep;
    assert.equal(d.lastA,13);assert.ok(proof);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).decision,'await-measured-step-response');
    const deadline=response.ackAt+h.output.responseSettleTimeoutMs();
    h.advance(1000);grantPVStep(h,13,100);h.put('power',2.65);h.put('i1',11.9);h.put('export',68);
    await h.output.tick();
    assert.deepEqual(h.writes,[],'a new old-level poll must not reverse a still bounded admitted step');
    h.advance(2000);grantPVStep(h,14,100);h.put('export',1000);
    await h.output.tick();
    assert.deepEqual(h.writes,[],'a held unproved step cannot earn a second increase');
    assert.equal(d.response,response);assert.equal(d.measuredBudgetStep,proof);
    assert.equal(response.ackAt+h.output.responseSettleTimeoutMs(),deadline);
    h.advance(2000);grantPVStep(h,13,100);h.put('power',2.89);h.put('i1',12.9);h.ack('feedback',13);h.put('export',68);
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val,'confirmed');
    assert.equal(d.measuredBudgetStep,null);assert.deepEqual(h.writes,[]);
});

for(const [name,change] of [
    ['real deficit',h=>{h.put('import',400);h.put('export',0);}],
    ['hard current cap',h=>{h.config.wb0CommissioningMaxA=11;}],
    ['shared hard cap',h=>h.grant([13],{hardBudgetW:2530})],
    ['expired response',h=>{h.advance(46000);grantPVStep(h,13,100);h.put('export',68);}],
    ['missing admission',h=>h.output.meterReservations.delete(h.output.devices[0].response)],
    ['missing ACK',h=>h.put('feedback',12)],
    ['growing heater reservation',h=>h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W',1000)],
    ['mismatched step',h=>{h.output.devices[0].measuredBudgetStep.amps=14;}]
]) test('asynchronous measured-step hold yields: '+name,async()=>{
    const h=await asynchronousMeasuredPVStep();change(h);await h.output.tick();
    if(name==='missing admission')
        assert.notEqual(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).decision,'await-measured-step-response');
    else assert.ok(h.writes.some(w=>w.id==='cmd'&&w.val<13||w.id==='allow'&&w.val===0));
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>13));
});

async function preAckDeficit(consumed=true){
    const h=await eqeStaleAllocation({amps:9,actualW:1730,actualA:7.9,targetA:8,exportW:0});
    const d=h.output.devices[0];
    d.lastA=consumed?9:8;d.pending=consumed?null:{stage:'current',amps:9,at:1005000,start:false};
    d.response={amps:9,previousAmps:8,at:1005000,ackAt:1007000,start:false};d.electricalCommandAt=1005000;
    h.output.meterReservations.set(d.response,{phases:1,powerW:1730,currentsA:[7.9,0,0],peerW:0,otherW:0,pendingPhasesW:[0,0,0]});
    h.put('feedback',9,{ts:1009000});h.put('power',1.73,{ts:1006000});h.put('i1',7.9,{ts:1006000});
    h.put('import',156.5);h.writes.length=0;
    return h;
}
for(const consumed of [true,false])test('9→8 A instead of 6 A at 156 W deficit before first post-ACK sample, consumed='+consumed,async()=>{
    const h=await preAckDeficit(consumed);await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:8}]);
});

for(const [name,change] of [
    ['withdrawn soft grant',h=>h.grant([6])],
    ['hard current cap',h=>{h.config.wb0CommissioningMaxA=6;}],
    ['hard shared cap',h=>h.grant([8],{hardBudgetW:1380})],
    ['pre-command sample',h=>h.put('power',1.73,{ts:1004000})],
    ['missing ACK',h=>{h.output.devices[0].response.ackAt=0;h.put('feedback',8,{ts:1004000});}],
    ['missing reservation',h=>h.output.meterReservations.delete(h.output.devices[0].response)],
    ['new heater reservation',h=>h.put('ems.0.Devices.MyPV_DHW.OutputReservedPower_W',1000)],
    ['expired reply',h=>{h.advance(46000);h.grant([8]);}]
])test('pre-ACK relative reduction does not bypass '+name,async()=>{
    const h=await preAckDeficit();change(h);await h.output.tick();
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>=8));
});

async function sameSampleConfirmation(consumed=true,count=1){
    const h=await freshResponseWithOldAllocation(count);
    const d=h.output.devices[0];d.lastA=consumed?11:10;d.lastAt=1000000;
    d.pending=consumed?null:{stage:'current',amps:11,at:1005000,start:false};
    d.electricalCommandAt=1005000;d.response=null;
    h.grant([10,...Array(count-1).fill(6)]);
    const key='ems.0.Control.ParallelWallboxAllocation_JSON',a=JSON.parse(h.states.get(key).val);
    a.allocations[0].reservedW=2530;a.heaterTargetW=0;a.pvStepOwner=0;a.pvStepToleranceW=100;
    h.put(key,JSON.stringify(a));h.config.wallboxPVImportToleranceW=100;
    h.put('ems.0.Control.TargetGridPower_W',0);
    h.put('power',2.43,{ts:1009000});h.put('i1',10.8,{ts:1009000});h.put('feedback',11,{ts:1008000});
    h.put('export',97);h.put('import',0);
    h.put('ems.0.Devices.Wallbox0.ResponseState','confirmed');
    h.put('ems.0.Devices.Wallbox0.ResponseCommand_A',11);
    h.put('ems.0.Devices.Wallbox0.ResponseConfirmedAt',1009999);
    a.timestamp=1009990;
    h.put(key,JSON.stringify(a));
    h.put('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON',JSON.stringify({valid:true,timestamp:a.timestamp,measuredPowerAt:1009000,responseState:'vehicle_response',previousA:d.lastA}));
    h.writes.length=0;return h;
}
for(const consumed of [true,false])test('same 2430 W poll confirms 11 A after allocation saw pending response; ACK consumed='+consumed,async()=>{
    const h=await sameSampleConfirmation(consumed);await h.output.tick();
    assert.deepEqual(h.writes,[],'97 W export must not cause a 11→10 A reversal at confirmation boundary');
    assert.equal(h.output.devices[0].lastA,11);
    assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val>=2530);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).basis,'fresh-response-allocation-hold');
    h.advance(6000);h.grant([11]);h.put('power',2.43);h.put('i1',10.8);h.ack('feedback',11);h.put('export',97);
    await h.output.tick();assert.deepEqual(h.writes,[],'next normal allocation retains the confirmed current');
});

for(const consumed of [true,false])for(const sameMillisecond of [false,true])test('real electrical confirmation and older allocation sharing one sample cannot reverse 10→11 A, ACK consumed='+consumed+', same millisecond='+sameMillisecond,async()=>{
    const h=await measuredHoldOutput(),d=h.output.devices[0];
    d.lastA=10;h.ack('feedback',10);h.put('power',2.17,{ts:1010002});h.put('i1',9.7,{ts:1010002});
    h.put('ems.0.Control.TargetGridPower_W',0);h.put('export',400);h.grant([11]);
    h.writes.length=0;await h.output.tick();assert.deepEqual(h.writes,[{id:'cmd',val:11}]);
    const at=d.response.at;
    if(consumed){d.lastA=11;d.pending=null;}
    h.advance(2000);h.grant([10]);
    const key='ems.0.Control.ParallelWallboxAllocation_JSON',a=JSON.parse(h.states.get(key).val);
    a.timestamp=at+(sameMillisecond?2000:1800);a.allocations[0].reservedW=2530;a.heaterTargetW=0;
    h.put(key,JSON.stringify(a));
    h.put('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON',JSON.stringify({valid:true,timestamp:a.timestamp,measuredPowerAt:at+1000,responseState:'vehicle_response'}));
    h.put('feedback',11,{ts:at+200});h.put('power',2.43,{ts:at+1000});h.put('i1',10.8,{ts:at+1000});
    h.put('import',0,{ts:at+1500});h.put('export',97,{ts:at+1502});h.writes.length=0;
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val,'confirmed');
    assert.equal(d.response,null);assert.equal(d.pending,null);assert.equal(d.lastA,11);
    assert.deepEqual(h.writes,[]);
});

for(const consumed of [true,false])for(const [name,change] of [
    ['allocator already knew confirmation',h=>{const id='ems.0.Control.Wallbox0.AllocationDiagnostics_JSON',a=JSON.parse(h.states.get(id).val);a.responseState='confirmed';h.put(id,JSON.stringify(a));}],
    ['confirmation predates allocation',h=>h.put('ems.0.Devices.Wallbox0.ResponseConfirmedAt',1009989)],
    ['newer allocation source',h=>{const id='ems.0.Control.Wallbox0.AllocationDiagnostics_JSON',a=JSON.parse(h.states.get(id).val);a.measuredPowerAt=1009001;h.put(id,JSON.stringify(a));}],
    ['actual deficit',h=>{h.put('export',0);h.put('import',500);}],
    ['hard current limit',h=>{h.config.wb0CommissioningMaxA=10;}],
    ['withdrawn reserve',h=>{const id='ems.0.Control.ParallelWallboxAllocation_JSON',a=JSON.parse(h.states.get(id).val);a.allocations[0].reservedW=2300;h.put(id,JSON.stringify(a));}],
    ['new heater target',h=>{const id='ems.0.Control.ParallelWallboxAllocation_JSON',a=JSON.parse(h.states.get(id).val);a.heaterTargetW=1000;h.put(id,JSON.stringify(a));}],
    ['insufficient current confirmation',h=>h.put('i1',10.2,{ts:1009000})]
])test('same-sample confirmation hold yields: '+name+', ACK consumed='+consumed,async()=>{
    const h=await sameSampleConfirmation(consumed);change(h);await h.output.tick();
    assert.ok(h.writes.some(w=>w.id==='cmd'&&w.val<=10||w.id==='allow'&&w.val===0));
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>11));
});

for (const gridPhase of [2, 3]) for (const consumed of [true, false]) {
    test(`confirmed 1P uptake on house phase ${gridPhase} retains its local L1 current, ACK consumed=${consumed}`, async () => {
        const h = await sameSampleConfirmation(consumed);
        h.config.wb0SinglePhaseGridPhase = gridPhase;
        const d = h.output.devices[0];
        d.measuredBudgetStep = {at: 1005000, amps: 11, phases: 1,
            powerW: 2170, currents: [9.7]};
        h.put('i2', 0, {ts: 1009000}); h.put('i3', 0, {ts: 1009000});
        await h.output.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(d.lastA, 11);
        assert.equal(d.measuredBudgetStep, null, 'the local power/current progress completes the admitted step');
        const diagnostic = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
        assert.equal(diagnostic.basis, 'fresh-response-allocation-hold');
        assert.equal(diagnostic.awaitingElectricalStep, false);
        assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val >= 2530);
    });
}

for (const gridPhase of [2, 3]) for (const invalid of ['pre-ACK local current', 'insufficient local current']) {
    test(`house phase ${gridPhase} cannot use idle local L2/L3 to repair ${invalid}`, async () => {
        const h = await sameSampleConfirmation();
        h.config.wb0SinglePhaseGridPhase = gridPhase;
        h.put('i2', 0, {ts: 1009000}); h.put('i3', 0, {ts: 1009000});
        h.put('i1', invalid === 'insufficient local current' ? 10.2 : 10.8,
            {ts: invalid === 'pre-ACK local current' ? 1007999 : 1009000});
        await h.output.tick();
        assert.ok(h.writes.some(write => write.id === 'cmd' && write.val <= 10));
        assert.ok(!h.writes.some(write => write.id === 'cmd' && write.val > 11));
    });
}

for (const gridPhase of [2, 3]) {
    test(`relative deficit reduction on house phase ${gridPhase} uses fresh local L1 despite older idle channels`, async () => {
        const h = await eqeStaleAllocation({amps: 17, actualW: 3100, actualA: 13.9, targetA: 16, exportW: 0});
        h.config.wb0SinglePhaseGridPhase = gridPhase;
        const d = h.output.devices[0];
        d.response = {amps: 17, previousAmps: 14, at: 1005000, ackAt: 1006000, start: false};
        d.electricalCommandAt = 1005000;
        h.put('i2', 0, {ts: 1004000}); h.put('i3', 0, {ts: 1004000});
        h.put('import', 138.6);
        await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'cmd', val: 16}]);
        assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).basis,
            'measured-relative-reduction');
    });

    test(`bounded funded response probe on house phase ${gridPhase} uses the charger's active local L1`, async () => {
        const h = await eqeLimitedReply();
        h.config.wb0SinglePhaseGridPhase = gridPhase;
        h.advance(46000); h.grant([16]);
        await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'cmd', val: 11}]);
        assert.equal(h.output.devices[0].limitedProbeAttempts, 1);
        assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).decision,
            'limited-response-probe');
    });
}

async function repeatedConfirmedAckOutput() {
    const h = await sameSampleConfirmation();
    h.grant([11]);
    h.put('ems.0.Devices.Wallbox0.OutputCommand_A', 11);
    h.put('ems.0.Devices.Wallbox0.ResponseSentAt', 1005000);
    h.put('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt', 1008000);
    h.ack('feedback', 11);
    h.writes.length = 0;
    return h;
}

for (const gridPhase of [1, 2, 3]) {
    test(`same-command ACK repoll on house phase ${gridPhase} retains its already confirmed electrical pair`, async () => {
        const h = await repeatedConfirmedAckOutput();
        h.config.wb0SinglePhaseGridPhase = gridPhase;
        await h.output.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.output.devices[0].lastA, 11);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt').val, 1008000);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseConfirmedAt').val, 1009999);
        assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val >= 2530);
    });
}

for (const [name, change] of [
    ['missing original ACK', h => h.put('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt', 0)],
    ['original ACK at command time', h => h.put('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt', 1005000)],
    ['late original ACK', h => h.put('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt', 1025001)],
    ['future original ACK', h => h.put('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt', 1010001)],
    ['confirmation before original ACK', h => h.put('ems.0.Devices.Wallbox0.ResponseConfirmedAt', 1007999)],
    ['future confirmation', h => h.put('ems.0.Devices.Wallbox0.ResponseConfirmedAt', 1010001)],
    ['different response command', h => h.put('ems.0.Devices.Wallbox0.ResponseCommand_A', 12)],
    ['different response write', h => h.put('ems.0.Devices.Wallbox0.ResponseSentAt', 1006000)],
    ['new command awaiting ACK', h => h.put('ems.0.Devices.Wallbox0.ResponseState', 'command_ack')],
    ['response still pending', h => h.put('ems.0.Devices.Wallbox0.ResponsePending', true)],
    ['new process without private command', h => { h.output.devices[0].electricalCommandAt = 0; }],
    ['latest ACK predates original', h => {
        h.put('feedback', 11, {ts: 1007999});
        h.put('power', 2.43, {ts: 1007998}); h.put('i1', 10.8, {ts: 1007998});
    }],
    ['stale latest ACK', h => h.put('feedback', 11, {ts: 970000})],
    ['future latest ACK', h => h.put('feedback', 11, {ts: 1011001})],
    ['unacknowledged latest feedback', h => h.put('feedback', 11, {ack: false})],
    ['bad latest feedback quality', h => h.put('feedback', 11, {q: 64})],
    ['stale electrical pair', h => { h.put('power', 2.43, {ts: 970000}); h.put('i1', 10.8, {ts: 970000}); }],
    ['electrical pair before original ACK', h => { h.put('power', 2.43, {ts: 1007999}); h.put('i1', 10.8, {ts: 1007999}); }]
]) {
    test(`retained confirmed ACK does not bypass ${name}`, async () => {
        const h = await repeatedConfirmedAckOutput();
        change(h);
        await h.output.tick();
        assert.ok(h.writes.some(write => write.id === 'cmd' && write.val <= 10
            || write.id === 'allow' && write.val === 0));
        assert.ok(!h.writes.some(write => write.id === 'cmd' && write.val > 11));
    });
}

test('a repeated ACK alone cannot increase current from an older confirmed electrical pair', async () => {
    const h = await repeatedConfirmedAckOutput();
    h.grant([12]); h.put('export', 400);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.output.devices[0].lastA, 11);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).decision,
        'await-new-electrical-sample');
    h.put('power', 2.43, {ts: 1010002}); h.put('i1', 10.8, {ts: 1010002});
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 12}]);
});

test('sequential current increases retain their existing same-value ACK polling behavior', async () => {
    let now = 1000000;
    const h = setup({now: () => now});
    await h.start();
    now += 2;
    h.put('power', 1.38); h.put('i1', 6);
    await h.output.tick();
    assert.equal(h.output.devices[0].response, null);
    const power = {...h.states.get('power')}, current = {...h.states.get('i1')};
    now += 6000; h.refresh();
    h.put('power', power.val, power); h.put('i1', current.val, current);
    h.ack('feedback', 6);
    h.writes.length = 0;
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 12}]);
});

async function measuredLimitedProbe() {
    const h=await eqeLimitedReply();h.advance(46000);h.grant([11]);
    h.put('export',400);h.writes.length=0;return h;
}
test('limited response can probe one measured amp without full nominal PV funding',async()=>{
    const h=await measuredLimitedProbe();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:11}]);
    assert.equal(h.output.devices[0].limitedProbeAttempts,1);
    assert.ok(h.output.devices[0].measuredBudgetStep,'retain the measured admission until electrical progress');
    const diag=JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
    assert.equal(diag.decision,'limited-response-probe');assert.equal(diag.requiredW,1980);
});
for(const [name,change] of [
    ['hard watts',h=>h.grant([11],{hardBudgetW:2200})],
    ['insufficient surplus',h=>h.put('export',100)],
    ['two failed attempts',h=>{h.output.devices[0].limitedProbeAttempts=2;}],
    ['missing ACK',h=>h.put('feedback',10,{ack:false})],
    ['old power',h=>h.put('power',1.75,{ts:1})],
    ['withdrawn allocation',h=>h.grant([0])],
    ['heater reservation',h=>{const k='ems.0.Control.ParallelWallboxAllocation_JSON';const a=JSON.parse(h.states.get(k).val);a.heaterTargetW=1000;h.put(k,JSON.stringify(a));}]
]) test('measured limited probe rejects '+name,async()=>{
    const h=await measuredLimitedProbe();change(h);await h.output.tick();
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>10));
});

test('live EQE 19→20 A at 4100 W plus 410 W export is admitted and cannot immediately wind up',async()=>{
    const h=await eqeLimitedReply();const d=h.output.devices[0];
    d.lastA=19;d.response.amps=19;d.response.previousAmps=18;
    h.output.meterReservations.set(d.response,{phases:1,powerW:4100,currentsA:[18.3,0,0],peerW:0,otherW:0,pendingPhasesW:[0,0,0]});
    h.advance(46000);h.grant([20]);h.ack('feedback',19);h.put('power',4.1);h.put('i1',18.3);h.put('export',410);
    h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:20}]);
    assert.equal(d.limitedProbeAttempts,1);
    h.advance(2000);h.grant([20]);h.ack('feedback',20);h.put('power',4.1);h.put('i1',18.3);h.put('export',410);
    h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[], 'do not undo the admitted step while its response is pending');
    assert.ok(d.measuredBudgetStep,'retain the unproved admission during the response window');
});


test('an unanswered measured probe cannot fund a second measured probe from unchanged uptake',async()=>{
    const h=await measuredLimitedProbe();const d=h.output.devices[0];
    await h.output.tick();assert.deepEqual(h.writes,[{id:'cmd',val:11}]);
    h.advance(1000);h.grant([13]);h.ack('feedback',11);h.put('power',1.75);h.put('i1',7.8);
    await h.output.tick();
    h.advance(46000);h.grant([13]);h.put('export',400);h.writes.length=0;await h.output.tick();
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>11));assert.equal(d.limitedProbeAttempts,1);
});

for (const phases of [1, 3]) test(`coherent old go-e poll settles without OFF or new current in ${phases}P`, async () => {
    const h = await correctionCandidate(phases);
    h.ack('cmd', 11);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /beruhigen/);
    assert.ok(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val >= 11 * phases * 230);
    const deadline = h.output.devices[0].feedbackSettle.until;
    h.advance(4000); h.grant([10], {phases: [phases]});
    await h.output.tick();
    assert.equal(h.output.devices[0].feedbackSettle.until, deadline);
    h.ack('cmd', 10); h.measure(0, 10, phases);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.output.devices[0].lastA, 10);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    // Matching polls cannot replenish the same command's observation window.
    h.advance(7000); h.grant([10], {phases: [phases]}); h.ack('cmd', 11); h.ack('feedback', 11);
    await h.output.tick();
    assert.deepEqual(h.writes.at(-1), {id: 'allow', val: 0});
});

for (const [name, change] of [
    ['stale SMA', h => h.put('import', 0, {ts: 1})],
    ['house overload', h => h.put('h1', 80)],
    ['hard shared cap', h => h.grant([10], {hardBudgetW: 2300})],
    ['device error', h => h.put('error', 5)],
    ['release withdrawn', h => h.put('userAllow', false)],
    ['lower target', h => { h.grant([8]); h.put('export', 0); }]
]) test(`go-e settling rechecks ${name} on every tick`, async () => {
    const h = await correctionCandidate(); h.ack('cmd', 11);
    await h.output.tick(); assert.deepEqual(h.writes, []);
    h.advance(2000); h.grant([10]); change(h);
    await h.output.tick();
    assert.deepEqual(h.writes.at(-1), {id: 'allow', val: 0});
});
