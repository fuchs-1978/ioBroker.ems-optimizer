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
    assert.equal(h.value('Devices.Wallbox2.OutputActive'), true);
    await h.replayAt(at + 601001, samples);
    assert.equal(h.value('Devices.Wallbox2.OutputActive'), true);
    assert.ok(!h.writes.some(w => ['goe.allow', 'goe.cmd'].includes(w.id)));
    assert.ok(h.value('Devices.Wallbox2.OutputReservedPower_W') >= 1380);
});

for (const parallel of [false,true]) test(`real Mii manual minimum survives offline beyond 60 s with taper; parallel=${parallel}`, async () => {
    const h = await plant({mii:true, wallbox:false, startDelayS:5, minimumRuntimeS:0,
        initialSurplusW:1000, split:false,
        nativeConfig:{wallboxParallelChargingEnabled:parallel, wb0TaperEnabled:true,
            wb0SocEstimationEnabled:true, wb0CapacityKWh:32.3, wb0SocEfficiencyPct:90,
            wb0SocEnergyId:'DP_WB0_SOC_ENERGY'}});
    h.run("CFG.dp.wallboxSocMeasuredAt[0]=''");
    h.mapping.DP_WB0_SOC_MEASURED_AT='';
    h.put('DP_WB0_SOC',53); h.put('DP_WB0_MIN_SOC',50); h.put('DP_WB0_TARGET',100);
    h.put('DP_WB0_AMIN',6); h.put('DP_WB0_RELEASE',0);
    h.put('DP_WB0_SOC_ENERGY',10);
    await h.advance(40);
    assert.equal(h.physical().miiAllow,1,h.value('Devices.Wallbox0.OutputStatus'));
    assert.equal(h.value('Devices.Wallbox0.ResponseState'),'confirmed');
    const ids=['goe0.error','DP_WB0_CAR','goe0.allow','goe0.feedback','DP_WB0_POWER',
        ...[1,2,3].map(p=>`DP_WB0_L${p}_A`)];
    const frozen=ids.map(id=>[id,h.states.get(id).val,{...h.states.get(id)}]);
    const at=h.now(); h.writes.length=0;
    for(const offset of [1000,31000,61000,601000]) {
        await h.replayAt(at+offset,[...frozen,['goe0.connection',false]]);
        assert.equal(h.physical().miiAllow,1,h.value('Devices.Wallbox0.OutputStatus'));
        assert.match(h.value('Devices.Wallbox0.OutputStatus'),/TELEMETRIE/);
        assert.ok(h.value('Devices.Wallbox0.OutputReservedPower_W')>=1380);
        assert.ok(!h.writes.some(w=>['goe0.allow','goe0.cmd'].includes(w.id)));
        assert.equal(h.value('Control.Targets.Wallbox0_Phases'),1);
        assert.equal(h.physical().heaterW,0,'the missing Mii load is not given to the heater');
    }
    await h.advance(10); // fresh device polls and normal allocator/output path
    assert.equal(h.physical().miiAllow,1);
    assert.equal(h.value('Devices.Wallbox0.ResponseState'),'confirmed');
    assert.ok(!h.writes.some(w=>w.id==='goe0.allow'&&w.val===0),'no queued age-only OFF after recovery');
});

for (const groupNet of [false,true]) for (const failure of [null, 'master', 'device', 'house', 'SMA', 'external-off'])
test(`fresh Mii feedback before allocator recovery; groupNet=${groupNet}; failure=${failure}`, async () => {
    const h=await plant({mii:true,wallbox:false,startDelayS:0,split:false,initialSurplusW:3000,sourceQuality:groupNet?0:undefined,
        nativeConfig:{wallboxParallelChargingEnabled:true,
            ...(groupNet?{par14aAccountingMode:'groupNet',par14aGroupId:'group',par14aBoundaryId:'site',
                par14aSiteScope:'whole-site-ac',par14aId:'group.contact',par14aAccountingMaxAgeS:30,
                par14aAccountingMaxSkewMs:0,par14aStorageCoverage:'none',par14aStorageMeters:[],
                par14aParticipants:[{name:'mii',kind:'wallbox',connectionPowerW:3680,deviceId:'Wallbox0',
                    powerId:'DP_WB0_POWER',powerUnit:'kW',powerScope:'total-ac'}]}:{})}});
    if(groupNet) h.put('group.contact',false);
    h.put('DP_WB0_AMIN',6);await h.advance(90);
    assert.equal(h.value('Devices.Wallbox0.ResponseState'),'confirmed');
    const ids=['goe0.error','DP_WB0_CAR','goe0.allow','goe0.feedback','DP_WB0_POWER',
        ...[1,2,3].map(p=>`DP_WB0_L${p}_A`)];
    const frozen=ids.map(id=>[id,h.states.get(id).val,{...h.states.get(id)}]);
    const at=h.now();h.writes.length=0;
    await h.replayAt(at+31000,frozen);
    assert.match(h.value('Devices.Wallbox0.OutputStatus'),/TELEMETRIE/);
    assert.equal(JSON.parse(h.value('Control.ParallelWallboxAllocation_JSON')).valid,false);
    // Fresh device poll arrives AFTER the allocator's rejection, BEFORE its next cycle.
    const faults={master:[['ems.0.System.RealOutputsEnabled',false]],device:[['goe0.error',1]],
        house:[['DP_HA_CRITICAL',true]],SMA:[['DP_GRID_IMPORT',0,{q:64}]],
        'external-off':[['goe0.allow',0]]};
    await h.replayAt(at+32000,failure?faults[failure]:[],{allocate:false});
    if(failure) {
        assert.equal(h.value('Devices.Wallbox0.OutputActive'),false,h.value('Devices.Wallbox0.OutputStatus'));
        if(failure!=='external-off') assert.ok(h.writes.some(w=>w.id==='goe0.allow'&&w.val===0),'real safety/release loss still stops');
        assert.ok(!h.writes.some(w=>w.id==='goe0.allow'&&w.val===1),'never re-enable after withdrawn release');
        return;
    }
    assert.equal(h.value('Devices.Wallbox0.OutputActive'),true,h.value('Devices.Wallbox0.OutputStatus'));
    assert.ok(!h.writes.some(w=>['goe0.allow','goe0.cmd'].includes(w.id)),'no stale-allocation OFF or new command');
    assert.ok(h.value('Devices.Wallbox0.OutputReservedPower_W')>=1380);
    await h.replayAt(at+33000);
    assert.equal(h.value('Devices.Wallbox0.OutputActive'),true,h.value('Devices.Wallbox0.OutputStatus'));
});
