'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

async function countdown(options = {}) {
    const h = await plant({mii: true, wallbox: false, split: false,
        startDelayS: 300, initialSurplusW: 1700, dhwDelayMs: 9000,
        nativeConfig: {wallboxParallelChargingEnabled: true}, ...options});
    h.put('DP_WB_PRIORITY', 0);
    h.own('Config.WallboxStartReserve_W', 150);
    h.put('DP_WB0_ALLOW', false);
    await h.advance(60);
    assert.ok(h.physical().heaterW >= 1400, 'establish a physically heating EHZ');
    h.put('DP_WB0_ALLOW', true);
    return h;
}

test('Mii waits five minutes while real EHZ keeps heating, then starts only after delayed reduction', async () => {
    const h = await countdown();
    const start = h.now();
    await h.advance(290);
    assert.equal(h.physical().miiAllow, 0);
    const waiting = h.trace.filter(x => x.at >= start + 10000);
    assert.ok(waiting.every(x => x.heaterW >= 1400), 'no five-minute consumption gap');
    assert.ok(waiting.every(x => Math.abs(x.gridW) <= 200), 'surplus is used during qualification');
    await h.advance(70);
    assert.ok(h.physical().miiPowerW >= 1380, h.value('Devices.Wallbox0.OutputStatus'));
    const on = h.writes.find(x => x.id === 'goe0.allow' && x.val === 1);
    assert.ok(on.at >= start + 300000, 'full ordinary countdown is required');
    assert.ok(on.at <= start + 350000, 'no renewed countdown after EHZ reduction');
    const physicalAtOn = h.trace.find(x => x.at === on.at);
    assert.ok(physicalAtOn.heaterW <= 320, 'ON waits for real released watts, not just a zero target');
    assert.equal(h.run('wallboxStartHistory[0].resetCount'), 0);
});

test('PV fluctuations inside reserve preserve countdown; a true deficit requires a fresh full delay', async () => {
    const h = await countdown();
    await h.advance(90);
    h.setSurplus(1550);
    await h.advance(90);
    assert.equal(h.run('wallboxStartHistory[0].resetCount'), 0);
    assert.ok(h.physical().heaterW >= 1300);
    h.setSurplus(600);
    await h.advance(25);
    assert.equal(h.run('wallboxStartCandidateSince[0]'), 0);
    h.setSurplus(1700);
    await h.advance(270);
    assert.equal(h.physical().miiAllow, 0, 'old elapsed qualification is discarded');
    assert.ok(h.physical().heaterW >= 1400);
    await h.advance(90);
    assert.ok(h.physical().miiPowerW >= 1380, h.value('Devices.Wallbox0.OutputStatus'));
});

test('manual six-amp request ends the countdown and withdraws the optional heater budget', async () => {
    const h = await countdown();
    await h.advance(60);
    const requestedAt = h.now();
    h.put('DP_WB0_AMIN', 6);
    await h.advance(60);
    assert.ok(h.physical().miiPowerW >= 1380, h.value('Devices.Wallbox0.OutputStatus'));
    const on = h.writes.find(x => x.id === 'goe0.allow' && x.val === 1);
    assert.ok(on.at < requestedAt + 60000);
    assert.ok(h.physical().heaterW <= 320, 'grid permission for manual charging is not donated to EHZ');
});

test('withdrawn release cancels the timer and leaves available PV with the EHZ', async () => {
    const h = await countdown();
    await h.advance(200);
    h.put('DP_WB0_ALLOW', false);
    await h.advance(160);
    assert.ok(!h.writes.some(x => x.id === 'goe0.allow' && x.val === 1));
    assert.ok(h.physical().heaterW >= 1400);
    assert.equal(h.run('wallboxStartCandidateSince[0]'), 0);
});

async function followerCountdown(options = {}) {
    const h = await plant({mii: true, startDelayS: 300, minimumRuntimeS: 600,
        split: false, initialSurplusW: 5700, dhwDelayMs: 9000, lpcLimitW: 5700,
        nativeConfig: {wallboxParallelChargingEnabled: true}, ...options});
    h.own('Config.WallboxStartReserve_W', 150);
    h.put('DP_WB_PRIORITY', 0); h.put('DP_WB0_AMIN', 6);
    h.put('DP_WB2_ALLOW', false);
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    await h.advance(80);
    h.own('Devices.MyPV_DHW.ControlEnabled', true);
    await h.advance(80);
    assert.equal(h.physical().miiAllow, 1);
    assert.ok(h.physical().miiPowerW >= 3450);
    assert.ok(h.physical().heaterW >= 1700, 'establish a live residual heater load');
    h.put('DP_WB2_ALLOW', true);
    return h;
}

for (const validPlan of [true, false]) for (const hardLimit of [5700, null])
test(`second vehicle lends its countdown floor and waits for measured heater reduction; plan=${validPlan}, hard=${hardLimit}`, async () => {
    const h = await followerCountdown({lpcLimitW: hardLimit}), at = h.now();
    h.own('Plan.Valid', validPlan);
    await h.advance(285);
    assert.equal(h.physical().allow, 0, 'ordinary start delay is retained');
    assert.ok(h.trace.filter(row => row.at > at + 20000).every(row => row.heaterW >= 1700),
        'the follower must not strand its minimum budget during the countdown');
    const before = h.run('wallboxStartCandidateSince[2]');
    await h.advance(70);
    assert.equal(h.physical().allow, 1, h.value('Devices.Wallbox2.OutputStatus'));
    const on = h.writes.find(w => w.id === 'goe.allow' && w.val === 1 && w.at > at);
    assert.ok(on.at >= at + 300000 && on.at < at + 350000, 'heater cannot restart the five-minute timer');
    const physical = h.trace.find(row => row.at === on.at);
    assert.ok(physical.heaterW + physical.miiW + 1380 <= 5700,
        'the ON command waits for actual freed power under the hard total limit');
    assert.ok(before > 0);
    assert.equal(h.physical().miiAllow, 1, 'preferred running car retains its load');
    assert.equal(h.run('wallboxStartHistory[2].resetCount'), 0);
});

test('a real residual deficit resets a follower countdown; heater cannot manufacture qualification', async () => {
    const h = await followerCountdown();
    await h.advance(100); h.setSurplus(4200); await h.advance(30);
    assert.equal(h.run('wallboxStartCandidateSince[2]'), 0);
    h.setSurplus(5700); const recoveredAt = h.now(); await h.advance(280);
    assert.equal(h.physical().allow, 0, 'a new full delay is required after real PV loss');
    assert.ok(h.physical().heaterW >= 1700);
    await h.advance(90);
    const on = h.writes.find(w => w.id === 'goe.allow' && w.val === 1 && w.at > recoveredAt);
    assert.ok(on && on.at >= recoveredAt + 300000);
});

test('a saturated 1P vehicle leaves residual heat during 3P qualification and reclaims it before switching', async () => {
    const h = await plant({split: false, startDelayS: 0, initialSurplusW: 4500,
        dhwDelayMs: 9000, lpcLimitW: 6500, phaseResponseDelayMs: 4000, wb2InitialPhaseMode: 1,
        nativeConfig: {wallboxParallelChargingEnabled: true, wb2MaxCurrent1pA: 20,
            phaseSwitchRealUpDelayS: 60, phaseSwitchMinHoldMin: 0}});
    h.own('Vehicles.Wallbox2.MaxCurrent1P_A', 20);
    await h.advance(120);
    assert.equal(h.physical().allow, 1);
    h.setSurplus(6200); const at = h.now(); await h.advance(50);
    assert.equal(h.value('Control.Targets.Wallbox2_Phases'), 1);
    assert.ok(h.physical().heaterW >= 900, 'residual power heats while topology remains 1P');
    await h.advance(100);
    assert.equal(h.value('Devices.Wallbox2.ConfirmedPhases'), 3, h.diagnostic());
    const change = h.trace.find(row => row.at > at && row.requestedPhases === 3);
    assert.ok(change && change.at >= at + 60000);
    assert.ok(change.heaterW + change.wbW * (change.physicalPhases === 1 ? 3 : 1) <= 6500,
        'topology request must retain the hard shared consumption ceiling');
    assert.ok(h.trace.filter(row => row.at > at).every(row => row.gridW <= 350), h.diagnostic());
});

test('expired follower countdown never treats a zero heater command as released physical power', async () => {
    const h = await followerCountdown(), at = h.now();
    await h.advance(285);
    // Replay real controller/output frames without dispatching the plant's
    // scheduled AC THOR responses: command writes complete but power stays up.
    for (let n = 0; n < 45; n++) await h.replayAt(h.now() + 2000);
    assert.ok(h.now() > at + 300000);
    assert.equal(h.value('Devices.MyPV_DHW.OutputCommand_W'), 0);
    assert.ok(h.physical().heaterW >= 1700);
    assert.ok(h.value('Devices.MyPV_DHW.OutputReservedPower_W') >= 1700);
    assert.equal(h.physical().allow, 0);
    assert.ok(!h.writes.some(w => w.id === 'goe.allow' && w.val === 1 && w.at > at));
    await h.advance(40);
    assert.equal(h.physical().allow, 1, 'independent measured reduction can release the waiting start');
});

test('cancelled follower release leaves the optional heat available without a later automatic start', async () => {
    const h = await followerCountdown();
    await h.advance(180); h.put('DP_WB2_ALLOW', false); await h.advance(160);
    assert.equal(h.run('wallboxStartCandidateSince[2]'), 0);
    assert.equal(h.physical().allow, 0);
    assert.ok(h.physical().heaterW >= 1700);
    assert.equal(h.physical().miiAllow, 1);
});
