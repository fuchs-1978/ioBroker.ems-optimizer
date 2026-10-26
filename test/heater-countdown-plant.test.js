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
