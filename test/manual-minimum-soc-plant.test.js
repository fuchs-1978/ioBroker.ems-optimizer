'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

for (const parallel of [false, true]) test(`Mii really resumes below target after unplug/trip and cloud 100 -> 84; parallel=${parallel}`, async () => {
    const h = await plant({mii: true, wallbox: false, initialSurplusW: 3000,
        startDelayS: 5, minimumRuntimeS: 0, split: false,
        nativeConfig: {wallboxParallelChargingEnabled: parallel, wb0SocEstimationEnabled: true,
            wb0CapacityKWh: 32.3, wb0SocEfficiencyPct: 90, wb0SocEnergyId: 'DP_WB0_SOC_ENERGY'}});
    h.run("CFG.dp.wallboxSocMeasuredAt[0]=''"); h.mapping.DP_WB0_SOC_MEASURED_AT = '';
    h.put('DP_WB0_SOC', 100); h.put('DP_WB0_SOC_ENERGY', 10); h.put('DP_WB0_TARGET', 90);
    await h.advance(10); assert.equal(h.physical().miiAllow, 0);
    h.put('DP_WB0_CAR', 1); await h.advance(4);
    h.put('DP_WB0_CAR', 3); h.put('DP_WB0_SOC_ENERGY', 0); await h.advance(4);
    h.put('DP_WB0_SOC', 100); await h.advance(4);
    assert.equal(h.physical().miiAllow, 0, 'the stale cloud 100 is still visible until the real report arrives');
    h.put('DP_WB0_SOC', 84); await h.advance(40);
    assert.equal(h.value('Vehicles.Wallbox0.SoC_pct'), 84);
    assert.equal(h.value('Vehicles.Wallbox0.SoCSource'), 'DP_WB0_SOC');
    assert.equal(h.physical().miiAllow, 1, h.diagnostic());
    assert.ok(h.physical().miiPowerW >= 1380, h.diagnostic());
    assert.ok(h.value('Devices.Wallbox0.OutputCommand_A') >= 6, 'an independent current ACK was consumed');
    assert.equal(h.value('Devices.Wallbox0.OutputFault'), '');
    assert.ok(!h.writes.some(w => w.id === 'DP_WB0_SOC'), 'no foreign SoC write');
});

for (const parallel of [false, true]) for (const limitW of [null, 900]) {
    test(`Mii manual 6 A reaches actual output without legacy script; parallel=${parallel}, LPC=${limitW}`, async () => {
        const h = await plant({mii: true, wallbox: false, initialSurplusW: 0,
            startDelayS: 5, minimumRuntimeS: 0, split: false, lpcLimitW: limitW,
            nativeConfig: {wallboxParallelChargingEnabled: parallel}});
        h.put('DP_WB0_SOC', 51); h.put('DP_WB0_MIN_SOC', 50); h.put('DP_WB0_TARGET', 90);
        h.put('DP_WB0_AMIN', 6); h.put('DP_WB0_RELEASE', 0);
        h.put('alias.0.mii.soc', 94);
        await h.advance(40);
        if (limitW !== null) {
            assert.equal(h.physical().miiAllow, 0, h.diagnostic());
            assert.equal(h.physical().miiPowerW, 0);
            assert.ok(!h.writes.some(w => w.id === 'goe0.allow' && w.val === 1));
            return;
        }
        assert.equal(h.value('Vehicles.Wallbox0.MustCharge'), true, h.diagnostic());
        assert.equal(h.physical().miiAllow, 1, h.diagnostic());
        assert.equal(h.physical().miiAmps, 6);
        assert.equal(h.physical().miiPowerW, 1380);
        assert.equal(h.value('Devices.Wallbox0.ResponseState'), 'confirmed');
        h.put('DP_WB0_SOC', 90); h.put('DP_WB0_RELEASE', 2);
        h.run('updateVehicles()'); // production subscribes to this actual SoC change
        assert.equal(h.value('Vehicles.Wallbox0.Release'), false);
        assert.equal(h.value('Vehicles.Wallbox0.MustCharge'), false);
        // Output ticks every 2 s; the plant returns the real device ACK/zero
        // 4 s after dispatch. Wait for that response rather than a cache flag.
        await h.advance(10);
        assert.equal(h.physical().miiAllow, 0, 'target SoC ends the manual charge');
        assert.equal(h.physical().miiPowerW, 0);
        assert.equal(h.value('Vehicles.Wallbox0.MustCharge'), false);
    });
}
