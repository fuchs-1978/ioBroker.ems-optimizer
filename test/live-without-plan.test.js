'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

for (const parallel of [false, true]) for (const missing of ['invalid', 'slot']) {
    test(`real surplus charges vehicles and EHZ without a plan; parallel=${parallel}, missing=${missing}`, async () => {
        const h = await plant({mii: true, initialSurplusW: 9000, split: false, startDelayS: 0,
            nativeConfig: {wallboxParallelChargingEnabled: parallel}});
        if (missing === 'invalid') h.own('Plan.Valid', false);
        else h.own('Plan.MyPV_DHW_48h_JSON', '[]');
        await h.advance(100);
        assert.equal(h.value('Control.PlanFallbackActive'), true);
        assert.equal(h.value('Plan.Valid'), missing !== 'invalid', 'never manufacture a valid plan');
        assert.equal(h.value('Control.Valid'), true);
        assert.equal(h.value('Control.PlanSlotTimestamp'), 0);
        assert.ok(h.physical().miiAllow || h.physical().allow, JSON.stringify(h.physical()));
        assert.ok(h.physical().heaterW > 0, 'remaining measured surplus goes to EHZ');
        assert.equal(h.value('Control.ProtectedGridImport_W'), 0);
        assert.equal(h.value('Control.Targets.PVBoostRelease'), false);
        if (missing === 'invalid') {
            h.own('Plan.Valid', true); await h.advance(10);
            assert.equal(h.value('Control.PlanFallbackActive'), false, 'return to real plan automatically');
            assert.ok(h.value('Control.PlanSlotTimestamp') > 0);
        }
    });
}
for (const parallel of [false, true]) for (const fault of ['master', 'house', 'grid', 'device', 'limit']) {
    test(`surplus fallback retains ${fault} protection; parallel=${parallel}`, async () => {
        const h = await plant({mii: true, wallbox: false, initialSurplusW: 6000,
            startDelayS: 0, split: false, ...(fault === 'limit' ? {lpcLimitW: 1000} : {}),
            nativeConfig: {wallboxParallelChargingEnabled: parallel}});
        h.own('Plan.Valid', false);
        if (fault === 'master') h.own('System.RealOutputsEnabled', false);
        if (fault === 'house') h.put('DP_HA_CRITICAL', true);
        if (fault === 'device') h.put('goe0.error', 1);
        if (fault === 'grid') await h.replayAt(h.now() + 1000, [['DP_GRID_IMPORT', 0, {q: 64}]]);
        else await h.advance(80);
        assert.equal(h.physical().miiAllow, 0, h.value('Devices.Wallbox0.OutputStatus'));
    });
}

for (const missing of ['invalid', 'slot', 'stale']) test(`fallback cannot inherit price/boost import permissions; ${missing}`, async () => {
    const h = await plant({mii: true, battery: true, heating: true, cheap: true,
        initialSurplusW: 0, split: false, startDelayS: 0});
    const slot = Math.floor(h.now() / 900000) * 900000;
    h.own('Config.BatteryPriceChargingEnabled', true);
    h.own('Plan.BatteryPower_48h_JSON', JSON.stringify([{timestamp: slot, valueW: 0, dischargeFloorPct: 0}]));
    h.own('Config.Wallbox0PriceChargingEnabled', true);
    h.own('Config.Wallbox0PriceMax_ct_kWh', 30);
    h.own('Plan.Wallbox0_48h_JSON', JSON.stringify([{timestamp: slot, valueW: 3680,
        phases: 1, gridChargeW: 3680, priceOptimized: true, priceLimitCt: 30}]));
    h.own('Plan.PVBoost_48h_JSON', JSON.stringify([{timestamp: slot, release: true}]));
    if (missing === 'invalid') h.own('Plan.Valid', false);
    if (missing === 'slot') h.own('Plan.MyPV_DHW_48h_JSON', '[]');
    if (missing === 'stale') h.own('Plan.LastUpdate', h.now() - 21 * 60000);
    h.run('realtimeControl()');
    assert.equal(h.value('Control.PlanFallbackActive'), true);
    assert.equal(h.run('priceChargingAuthorization("Wallbox0").gridW'), 0);
    assert.equal(h.run('batteryPriceDischargeFloor()'), 100, 'unknown schedule cannot spend price-reserved energy');
    assert.equal(h.value('Control.BatteryPriceGridCharge_W'), 0);
    assert.equal(h.value('Control.Targets.PVBoostRelease'), false);
    assert.equal(h.value('Control.Targets.MyPV_DHW_W'), 0);
    assert.equal(h.value('Control.Targets.MyPV_Heating_W'), 0);
    assert.equal(h.value('Control.Targets.Wallbox0_A'), 0);
});

test('a new process reconfirms a persisted fallback flag before restart adoption', async () => {
    const h = await plant({mii: true, initialSurplusW: 6000, startDelayS: 0});
    h.put('ems.0.Control.PlanFallbackActive', true, {ts: h.now() - 60000});
    h.own('Plan.Valid', false);
    h.run('realtimeControl()');
    assert.equal(h.value('Control.PlanFallbackActive'), true);
    assert.ok(h.states.get('ems.0.Control.PlanFallbackActive').ts >= h.now());
    h.own('Control.RestartHandoffSince', h.now());
    assert.equal(h.output.restartDataFresh(), true, 'fresh real controller proof can qualify adoption');
});
