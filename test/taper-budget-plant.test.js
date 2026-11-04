'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

for (const withoutPlan of [false, true]) test(`sustained vehicle taper releases confirmed nominal capacity without a SoC correction; noPlan=${withoutPlan}`, async () => {
    let uptake = 32;
    const h = await plant({mii: true, startDelayS: 300, minimumRuntimeS: 600, split: false,
        initialSurplusW: 6000, nativeConfig: {wallboxParallelChargingEnabled: true,
            wb2MaxCurrent1pA: 32, wb2CommissioningMaxA: 32},
        wallboxUptakeA: (wb, amps) => wb === 2 ? Math.min(amps, uptake) : amps});
    if (withoutPlan) h.own('Plan.Valid', false);
    h.put('DP_WB_PRIORITY', 2); await h.advance(460);
    assert.equal(h.physical().allow, 1); assert.ok(h.physical().wbPowerW > 4500);
    const at = h.now(); uptake = 14;
    await h.advance(150);
    assert.equal(h.value('Vehicles.Wallbox2.SoC_pct'), 50, 'no full-SoC guess drives redistribution');
    assert.equal(h.physical().allow, 1, 'the tapering car keeps charging');
    assert.ok(!h.writes.some(w => w.id === 'goe.allow' && w.val === 0 && w.at > at),
        'sharing reduced uptake never stops and restarts the donor');
    assert.ok(h.physical().amps <= 16, h.diagnostic());
    assert.equal(h.physical().miiAllow, 1, h.diagnostic());
    assert.ok(h.physical().miiPowerW >= 1380);
    const reduction = h.writes.find(w => w.id === 'goe.cmd' && w.val <= 16 && w.at > at);
    const start = h.writes.find(w => w.id === 'goe0.allow' && w.val === 1 && w.at > at);
    assert.ok(reduction && start && start.at >= reduction.at + 4000,
        'recipient waits for independent acknowledgement of the lower donor command');
    assert.ok(start.at - at < 90000, 'the shared witnessed charge does not repeat the 300-second start delay');
    assert.ok(h.trace.at(-1).gridW >= -800, h.diagnostic());
    uptake = 32; h.setSurplus(8000); await h.advance(150);
    assert.ok(h.physical().amps > 16, 'fresh recovered uptake can lift the adaptive cap');
    h.setWallboxCurrentQuality(2, 64); await h.advance(2);
    assert.equal(h.run('wallboxUptakeObservation[2]'), null, 'bad electrical quality revokes the observation');
});

for (const temporary of [false, true]) test(`ordinary current offset and brief taper do not acquire an uptake ceiling; temporary=${temporary}`, async () => {
    let uptake = 32;
    const h = await plant({mii: true, startDelayS: 5, split: false, initialSurplusW: 6000,
        nativeConfig: {wallboxParallelChargingEnabled: true, wb2MaxCurrent1pA: 32, wb2CommissioningMaxA: 32},
        wallboxUptakeA: (wb, amps) => wb === 2 ? Math.min(Math.max(0, amps - 1.5), uptake) : amps});
    h.put('DP_WB_PRIORITY', 2); await h.advance(180);
    if (temporary) {uptake = 14; await h.advance(8); uptake = 32;}
    await h.advance(40);
    assert.equal(h.run('wallboxUptakeObservation[2]'), null);
    assert.equal(h.physical().miiAllow, 0);
});

test('a tapering donor keeps its old watts reserved until the lower current is independently acknowledged', async () => {
    let uptake = 32;
    const h = await plant({mii: true, startDelayS: 0, split: false, initialSurplusW: 6000,
        nativeConfig: {wallboxParallelChargingEnabled: true, wb2MaxCurrent1pA: 32, wb2CommissioningMaxA: 32},
        wallboxUptakeA: (wb, amps) => wb === 2 ? Math.min(amps, uptake) : amps});
    h.put('DP_WB_PRIORITY', 2); await h.advance(180);
    const at = h.now(), oldA = h.physical().amps;
    h.setWallboxCurrentAck(2, false); uptake = 14;
    let reduction;
    for (let i = 0; i < 40 && !reduction; i++) {
        await h.advance(1);
        reduction = h.writes.find(w => w.id === 'goe.cmd' && w.val <= 16 && w.at > at);
    }
    assert.ok(reduction, h.diagnostic()); await h.advance(8);
    assert.equal(h.physical().amps, oldA);
    assert.equal(h.physical().miiAllow, 0);
    assert.ok(h.value('Devices.Wallbox2.OutputReservedPower_W') >= oldA * 230);
    h.setWallboxCurrentAck(2, true); h.setWallboxPhysical(2, {allow: 1, amps: reduction.val});
    await h.advance(60); assert.equal(h.physical().miiAllow, 1, h.diagnostic());
});
