'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

async function lifecycle(initialSurplusW, initialMode = 1, phaseDelayMs = 18000) {
    const h = await plant({mii: true, adoptRunningMii: true, split: false,
        startDelayS: 300, minimumRuntimeS: 120, initialSurplusW,
        wb2InitialPhaseMode: initialMode, phaseResponseDelayMs: phaseDelayMs, dhwDelayMs: 9000,
        nativeConfig: {wallboxParallelChargingEnabled: true, wb2MaxCurrent1pA: 20,
            wb2MaxCurrent3pA: 16, wb2MaxPowerW: 11040, wallboxCombinedMaxStepA: 3,
            phaseSwitchRealUpDelayS: 300, phaseSwitchMinHoldMin: 0}});
    h.own('Vehicles.Wallbox2.MaxCurrent1P_A', 20);
    h.own('Vehicles.Wallbox2.MaxCurrent3P_A', 16);
    h.own('Config.Wallbox2MaxPower_W', 11040);
    // The optional donor is already running. Exercise ordinary preferred
    // startup after the bounded selection-edge handoff has been consumed.
    const series = JSON.stringify(Array.from({length: 8}, (_, i) =>
        ({timestamp: h.now() - 1000 + i * 900000, valueW: 6000, phases: 1})));
    for (const name of ['BatteryPower', 'Wallbox0', 'Wallbox1', 'Wallbox2', 'MyPV_DHW', 'MyPV_Heating'])
        h.own(`Plan.${name}_48h_JSON`, series);
    h.put('DP_WB_PRIORITY', 2);
    h.run('wallboxParallelPriorityRequest={index:2,pending:false,validObserved:true,until:Date.now()+300000}');
    return h;
}

test('real allocator and output complete stable 1P start through fluctuating PV without phase/start resets', async () => {
    const h = await lifecycle(3400);
    await h.advance(30);
    for (let i = 0; i < 10; i++) {h.setSurplus(i % 2 ? 5200 : 3900); await h.advance(30);}
    await h.advance(90);
    assert.ok(h.physical().wbPowerW > 1000, JSON.stringify({diag:h.diagnostic(),donor:h.value("Devices.Wallbox0.OutputStatus"),writes:h.writes.filter(x=>x.id.startsWith("goe")).slice(-20),alloc:h.value("Control.ParallelWallboxAllocation_JSON")}));
    assert.equal(h.trace.at(-1).physicalPhases, 1);
    const history = h.run('wallboxStartHistory[2]');
    assert.equal(history.resetCount, 0, JSON.stringify(history));
    const phases = new Set(h.trace.map(x => x.requestedPhases));
    assert.deepEqual([...phases], [1], 'startup must not reselect 3P halfway through its countdown');
    const prepared = h.trace.filter(x => x.at > h.trace[0].at + 30000 && !x.physicalAllow);
    assert.ok(prepared.length > 100);
    assert.ok(prepared.every(x => x.heaterTargetW <= Math.max(0, x.heaterW + x.wbW + x.miiW - x.gridW - 4600) + 100), 'heater sees only the quantized rest during preparation');
});

test('real 3P preparation retains budget through delayed phase ACK and returns from optional donor', async () => {
    const h = await lifecycle(6200);
    await h.advance(450);
    assert.ok(h.physical().wbPowerW >= 4140, h.diagnostic());
    assert.equal(h.trace.at(-1).physicalPhases, 3);
    assert.equal(h.run('wallboxStartHistory[2].resetCount'), 0,JSON.stringify(h.run('wallboxStartHistory[2]')));
    const pending = h.trace.filter(x => x.requestedPhases === 3 && x.physicalPhases === 1);
    assert.ok(pending.length > 5, 'exercise a real delayed mode echo');
    assert.ok(pending.every(x => x.heaterTargetW <= 100), 'mode echo cannot donate the start allocation to EHZ');
    assert.ok(!h.writes.some(x => x.id === 'goe.allow' && x.val === 1
        && x.at < h.trace.find(y => y.physicalPhases === 3).at), 'no ON before genuine 3P ACK');
});

test('a real loss of 3P funding permits one 1P fallback without bouncing back during countdown', async () => {
    const h = await lifecycle(6200);
    await h.advance(10);
    h.setSurplus(3500);
    await h.advance(90);
    h.setSurplus(5400);
    await h.advance(420);
    assert.ok(h.physical().wbPowerW >= 1380, JSON.stringify({diag:h.diagnostic(),control:h.value('Control.Status'),output:h.value('Devices.Wallbox2.OutputFault'),phase:h.value('Control.Wallbox2.PhaseDecision_JSON')}));
    assert.equal(h.trace.at(-1).physicalPhases, 1);
    const destinations = h.trace.map(x => x.requestedPhases)
        .filter((value, index, values) => index === 0 || value !== values[index - 1]);
    assert.deepEqual(destinations, [3, 1]);
    assert.ok(h.run('wallboxStartHistory[2].resetCount') <= 2,
        'genuine funding/topology loss may reset, rising PV must not keep resetting');
});

test('withdrawn user release during a phase echo never starts the recipient', async () => {
    const h = await lifecycle(6200);
    await h.advance(8);
    h.put('DP_WB2_ALLOW', false);
    await h.advance(420);
    assert.equal(h.physical().allow, 0);
    assert.ok(!h.writes.some(x => x.id === 'goe.allow' && x.val === 1));
    assert.equal(h.run('wallboxStartPreparation[2]'), null);
});

test('ramp demand cannot be reclaimed by the optional heater before a funded car reaches its allocation', async () => {
    const h = await lifecycle(4200);
    await h.advance(440);
    const on = h.trace.findIndex(x => x.physicalAllow === 1);
    assert.ok(on >= 0, h.diagnostic());
    const ramp = h.trace.slice(on, on + 45);
    assert.ok(ramp.length >= 40);
    assert.ok(ramp.every(x => x.heaterTargetW <= 100), JSON.stringify(ramp.slice(-5)));
    assert.ok(h.physical().wbPowerW >= 3680, h.diagnostic());
});

test('unconfirmed phase timeout cannot produce a start even after the start delay expires', async () => {
    const h = await lifecycle(6200, 1, 500000);
    await h.advance(420);
    assert.equal(h.physical().allow, 0);
    assert.ok(!h.writes.some(x => x.id === 'goe.allow' && x.val === 1));
});

test('a genuine PV deficit cancels qualification and recovery requires a new full start delay', async () => {
    const h = await lifecycle(3400);
    await h.advance(140);
    h.setSurplus(600);
    await h.advance(30);
    h.setSurplus(3400);
    await h.advance(200);
    assert.equal(h.physical().allow, 0, 'old 140 seconds must not survive a true deficit');
    await h.advance(180);
    assert.equal(h.physical().allow, 1, h.diagnostic());
});

test('started car upshifts and downshifts on qualified real budgets without cold-start oscillation', async () => {
    const h = await lifecycle(3400);
    await h.advance(420);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    h.setSurplus(8000);
    await h.advance(470);
    assert.equal(h.trace.at(-1).physicalPhases, 3, JSON.stringify({diag:h.diagnostic(),phase:h.value('Control.Wallbox2.PhaseDecision_JSON'),allocation:h.value('Control.Wallbox2.AllocationDiagnostics_JSON')}));
    assert.ok(h.physical().wbPowerW >= 4140, h.diagnostic());
    h.setSurplus(3500);
    await h.advance(350);
    assert.equal(h.trace.at(-1).physicalPhases, 1, h.diagnostic());
    assert.ok(h.physical().wbPowerW >= 1380, JSON.stringify({diag:h.diagnostic(),control:h.value('Control.Status'),output:h.value('Devices.Wallbox2.OutputFault'),phase:h.value('Control.Wallbox2.PhaseDecision_JSON')}));
    const firstOn = h.trace.findIndex(x => x.physicalAllow === 1);
    const destinations = h.trace.slice(firstOn).map(x => x.requestedPhases)
        .filter((value, index, values) => index === 0 || value !== values[index - 1]);
    assert.deepEqual(destinations, [1, 3, 1]);
});

test('house critical gate overrides an imminent downshift and its short stop grace', async () => {
    const h = await lifecycle(6200);
    await h.advance(420);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    h.setSurplus(3500);
    await h.advance(105);
    const at = h.now();
    h.put('DP_HA_CRITICAL', true);
    await h.advance(20);
    assert.equal(h.physical().allow, 0);
    assert.ok(!h.writes.some(x => x.id === 'goe.allow' && x.val === 1 && x.at >= at));
});
