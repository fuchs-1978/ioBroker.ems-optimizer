'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

for (const parallel of [false, true]) test(`charger-finished preferred car yields to its peer with stale SoC; parallel=${parallel}`, async () => {
    const h = await plant({mii: true, startDelayS: 300, minimumRuntimeS: 600, split: false,
        initialSurplusW: 1800, nativeConfig: {wallboxParallelChargingEnabled: parallel}});
    h.put('DP_WB_PRIORITY', 2);
    await h.advance(340);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.ok(h.physical().wbPowerW >= 1380);
    const finishedAt = h.now();
    h.setWallboxPowerAcceptance(false); h.put('DP_WB2_CAR', 4);
    await h.advance(45);
    assert.equal(h.value('Devices.Wallbox2.NoDrawPaused'), true, h.diagnostic());
    assert.equal(JSON.parse(h.value('Devices.Wallbox2.NoDrawPause_JSON')).kind, 'charger-finished');
    assert.equal(h.value('Vehicles.Wallbox2.SoC_pct'), 50);
    assert.equal(h.physical().allow, 0);
    assert.equal(h.physical().miiAllow, 1, h.diagnostic());
    const start = h.writes.find(w => w.id === 'goe0.allow' && w.val === 1 && w.at >= finishedAt);
    const stop = h.writes.find(w => w.id === 'goe.allow' && w.val === 0 && w.at >= finishedAt);
    assert.ok(start && stop && start.at >= stop.at + 4000, 'peer waits for independently acknowledged OFF');
    assert.ok(start.at - finishedAt < 45000, 'witnessed completion does not repeat the 300-second countdown');
});

for (const parallel of [false, true]) test(`charger-finished handoff retains reservation without donor OFF ack; parallel=${parallel}`, async () => {
    const h = await plant({mii: true, startDelayS: 300, minimumRuntimeS: 600, split: false,
        initialSurplusW: 1800, nativeConfig: {wallboxParallelChargingEnabled: parallel}});
    h.put('DP_WB_PRIORITY', 2); await h.advance(340);
    h.setWallboxStopAck(2, false); h.setWallboxPowerAcceptance(false); h.put('DP_WB2_CAR', 4);
    await h.advance(45);
    assert.equal(h.value('Devices.Wallbox2.NoDrawPaused'), true);
    assert.equal(h.value('Devices.Wallbox2.OutputOwned'), true);
    assert.ok(h.value('Devices.Wallbox2.OutputReservedPower_W') >= 1380);
    assert.equal(h.physical().miiAllow, 0);
    assert.ok(!h.writes.some(w => w.id === 'goe0.allow' && w.val === 1));
});

for (const parallel of [false, true]) test(`initial zero-load Finish cannot inherit an unwitnessed start; parallel=${parallel}`, async () => {
    const h = await plant({mii: true, startDelayS: 300, minimumRuntimeS: 600, split: false,
        initialSurplusW: 1800, nativeConfig: {wallboxParallelChargingEnabled: parallel}});
    h.setWallboxPowerAcceptance(false); h.put('DP_WB2_CAR', 4); h.put('DP_WB_PRIORITY', 2);
    await h.advance(340);
    assert.equal(h.value('Devices.Wallbox2.NoDrawPaused'), true);
    assert.equal(h.physical().miiAllow, 0, 'no witnessed real charge supplies a start-delay shortcut');
    await h.advance(320);
    assert.equal(h.physical().miiAllow, 1, 'ordinary start qualification still allows the peer');
});

for (const parallel of [false, true]) test(`idle preferred EQE releases real reservation and Mii charges; parallel=${parallel}`, async () => {
    const h = await plant({mii: true, startDelayS: 5, minimumRuntimeS: 0, split: false,
        initialSurplusW: 1800, nativeConfig: {wallboxParallelChargingEnabled: parallel}});
    h.put('DP_WB_PRIORITY', 2);
    for (const name of ['BatteryPower','MyPV_DHW','MyPV_Heating','Wallbox0','Wallbox1','Wallbox2'])
        h.own(`Plan.${name}_48h_JSON`, JSON.stringify(Array.from({length:8}, (_, i) =>
            ({timestamp:h.now()-1000+i*900000,valueW:6000,phases:1}))));
    h.put('DP_WB0_MIN_SOC', 10); h.put('DP_WB2_MIN_SOC', 10);
    h.setWallboxPowerAcceptance(false);
    await h.advance(40);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.equal(h.physical().wbPowerW, 0);
    assert.equal(h.physical().miiAllow, 0, 'only one minimum fits the available PV');
    await h.advance(870);
    assert.equal(h.value('Devices.Wallbox2.NoDrawPaused'), false, h.diagnostic());
    await h.advance(70);
    assert.equal(h.value('Devices.Wallbox2.NoDrawPaused'), true, h.diagnostic());
    assert.equal(h.physical().allow, 0);
    assert.equal(h.value('Devices.Wallbox2.OutputReservedPower_W'), 0);
    assert.equal(h.physical().miiAllow, 1, h.diagnostic());
    assert.ok(h.physical().miiPowerW >= 1380);
    const stop = h.writes.find(w => w.id === 'goe.allow' && w.val === 0
        && w.at >= h.now() - 80000);
    const peerStart = h.writes.find(w => w.id === 'goe0.allow' && w.val === 1);
    assert.ok(stop && peerStart && peerStart.at >= stop.at + 4000,
        'Mii starts only after the physical OFF acknowledgement');
    await h.advance(900);
    assert.equal(h.value('Devices.Wallbox2.NoDrawPaused'), true, 'periodic retry does not steal a charging peer');
    assert.equal(h.physical().miiAllow, 1);
    h.put('DP_WB0_SOC', 100);
    h.setWallboxPowerAcceptance(true);
    await h.advance(60);
    assert.equal(h.value('Devices.Wallbox2.NoDrawPaused'), false, h.diagnostic());
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.ok(h.physical().wbPowerW >= 1380);
});
