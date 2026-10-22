'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

for (const groupNet of [false, true]) for (const parallel of [false, true]) for (const split of [false, true]) test(`real allocator retains running charger across telemetry gap, groupNet=${groupNet}, parallel=${parallel}, heater=${split}`, async () => {
    const h = await plant({startDelayS: 0, split, initialSurplusW: split ? 6000 : 3000,
        sourceQuality: groupNet ? 0 : undefined,
        nativeConfig: {wallboxParallelChargingEnabled: parallel, wb2CommissioningMaxA: 6,
            ...(groupNet ? {par14aAccountingMode: 'groupNet', par14aGroupId: 'group',
                par14aBoundaryId: 'site', par14aSiteScope: 'whole-site-ac',
                par14aId: 'group.contact', par14aAccountingMaxAgeS: 30,
                par14aAccountingMaxSkewMs: 0, par14aStorageCoverage: 'none', par14aStorageMeters: [],
                par14aParticipants: [0, 2].map(wb => ({name: `ev${wb}`, kind: 'wallbox',
                    connectionPowerW: 7360, deviceId: `Wallbox${wb}`, powerId: `DP_WB${wb}_POWER`,
                    powerUnit: 'kW', powerScope: 'total-ac'}))} : {})}});
    if (groupNet) h.put('group.contact', false);
    await h.advance(90);
    if (groupNet) {
        const limit = h.output.gridOperatorLimit(h.mapping);
        assert.equal(limit.valid, true, limit.reason);
        assert.equal(limit.groupNet, true);
        assert.equal(limit.active, false);
    }
    assert.equal(h.value('Devices.Wallbox2.OutputActive'), true);
    assert.equal(h.value('Devices.Wallbox2.ResponseState'), 'confirmed');
    const ids = ['goe.error', 'DP_WB2_CAR', 'goe.allow', 'goe.feedback', 'DP_WB2_POWER',
        ...[1, 2, 3].map(p => `DP_WB2_L${p}_A`)];
    const samples = ids.map(id => [id, h.states.get(id).val, {...h.states.get(id)}]);
    const at = h.now(); h.writes.length = 0;
    await h.replayAt(at + 31000, samples);
    assert.equal(h.value('Devices.Wallbox2.OutputActive'), true, JSON.stringify({status:h.value('Devices.Wallbox2.OutputStatus'),control:h.value('Control.Valid'),selected:h.value('Control.SelectedWallbox'),proof:h.output.telemetryBridgeProofs.get(h.output.devices[2])}));
    assert.match(h.value('Devices.Wallbox2.OutputStatus'), /TELEMETRIE/);
    assert.ok(!h.writes.some(w => ['goe.allow', 'goe.cmd'].includes(w.id)),
        'the bridge neither stops nor writes another charger setpoint');
    assert.ok(h.value('Devices.Wallbox2.OutputReservedPower_W') >= 1380);
    await h.replayAt(at + 61001, samples);
    assert.equal(h.value('Devices.Wallbox2.OutputActive'), false);
});
