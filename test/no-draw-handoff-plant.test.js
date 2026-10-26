'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

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
