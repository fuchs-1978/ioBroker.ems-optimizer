'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

async function runningEqvWithMeterGap() {
    const h = await plant({wallboxIndex: 1, battery: true, mii: true, split: false,
        startDelayS: 0, initialSurplusW: 220, initialWallboxPhaseMode: 1,
        wallboxUptakeA: (_wb, amps) => amps - 0.4,
        nativeConfig: {wallboxParallelChargingEnabled: true, wb1CommissioningMaxA: 6,
            wb2Present: true, wb2AllowOutputId: 'goe2.allow'}});
    h.own('Devices.Wallbox2.Present', true);
    h.put('goe2.allow', 0);
    h.put('DP_WB0_CAR', 1);
    h.put('DP_WB0_SOC', 100);
    h.put('DP_WB1_SOC', 50.3);
    h.put('DP_WB1_MIN_SOC', 60);
    await h.advance(90);
    assert.equal(h.value('Devices.Wallbox1.ResponseState'), 'confirmed', h.diagnostic());
    assert.equal(h.value('Devices.Wallbox1.OutputCommand_A'), 6);
    const at = h.now() + 1000;
    // Three independent go-e polls at the ages recorded on 25 November at 15:34:24.
    const ages = [35576, 31704, 35111];
    const samples = [];
    for (const wb of [0, 1, 2]) {
        const ids = [`DP_WB${wb}_POWER`, ...[1, 2, 3].map(p => `DP_WB${wb}_L${p}_A`)];
        const prefix = ['goe0', 'goe', 'goe2'][wb];
        ids.push(prefix + '.allow');
        if (wb === 1) ids.push('goe.error', 'goe.feedback', 'DP_WB1_CAR');
        for (const id of ids) samples.push([id, h.states.get(id).val,
            {ack: true, q: 0, ts: at - ages[wb], lc: at - 70000}]);
    }
    h.writes.length = 0;
    return {h, at, samples};
}

test('25 November EQV minimum charge holds 6 A through a shared go-e poll gap and staggered recovery', async () => {
    const {h, at, samples} = await runningEqvWithMeterGap();
    await h.replayAt(at, samples);
    assert.equal(h.value('Control.Valid'), false, 'no new allocation may spend the missing load');
    assert.equal(h.value('Devices.Wallbox1.OutputActive'), true, h.value('Devices.Wallbox1.OutputStatus'));
    assert.match(h.value('Devices.Wallbox1.OutputStatus'), /TELEMETRIE/);
    assert.ok(h.value('Devices.Wallbox1.OutputReservedPower_W') >= 1380);
    assert.equal(h.states.get('DP_WB1_POWER').ts, at - 31704);
    await h.replayAt(at + 3000, samples.map(([id, val]) => [id, val]), {allocate: false});
    assert.equal(h.value('Devices.Wallbox1.OutputActive'), true, h.value('Devices.Wallbox1.OutputStatus'));
    await h.replayAt(at + 5000);
    assert.equal(h.value('Control.Valid'), true);
    assert.equal(h.value('Control.Targets.Wallbox1_A'), 6);
    assert.equal(h.physical().allow, 1);
    assert.ok(!h.writes.some(w => ['goe.allow', 'goe.cmd', 'goe0.allow', 'goe0.cmd'].includes(w.id)),
        'the held command needs neither OFF/ON nor a new current request');
});

test('the EQV output can run before the allocator and holds its original reserve while protection updates', async () => {
    const {h, at, samples} = await runningEqvWithMeterGap();
    await h.replayAt(at, samples, {allocate: false});
    await h.replayAt(at + 1000, samples);
    await h.replayAt(at + 65000, samples);
    assert.equal(h.value('Devices.Wallbox1.OutputActive'), true, h.value('Devices.Wallbox1.OutputStatus'));
    assert.equal(h.states.get('DP_WB1_POWER').ts, at - 31704);
    assert.ok(h.value('Devices.Wallbox1.OutputReservedPower_W') >= 1380);
    assert.ok(!h.writes.some(w => ['goe.allow', 'goe.cmd', 'goe0.allow', 'goe0.cmd'].includes(w.id)));
});

test('an EQV hold needs a live controller and a confirmed charging session', async () => {
    for (const lost of ['controller', 'session']) {
        const {h, at, samples} = await runningEqvWithMeterGap();
        await h.replayAt(at, samples);
        if (lost === 'session') h.output.telemetryBridgeProofs.delete(h.output.devices[1]);
        await h.replayAt(at + (lost === 'controller' ? 11000 : 1000), samples, {allocate: false});
        assert.ok(h.writes.some(w => w.id === 'goe.allow' && w.val === 0), lost);
        assert.equal(h.value('Devices.Wallbox1.OutputActive'), false, lost);
    }
});

for (const [name, id, value, invalid] of [
    ['stale grid meter', 'DP_GRID_IMPORT', 1000, {ts: 1}],
    ['phase overload', 'DP_DHW_HA_L1_CURRENT_A', 100],
    ['house connection trip', 'DP_HA_CRITICAL', true],
    ['new grid operator limit', 'lpc.limit', 1000],
    ['loss of user release', 'DP_WB1_ALLOW', false],
    ['go-e fault', 'goe.error', 1],
    ['bad own phase current', 'DP_WB1_L1_A', 5.5, {q: 64}],
    ['unconfirmed own power', 'DP_WB1_POWER', 1.29, {ack: false}],
    ['contradictory idle peer current', 'DP_WB2_L1_A', 3, {ts: 1}],
    ['invalid water-heater meter', 'DP_DHW_OUTPUT1', 0, {q: 64}],
]) test(`coordinated EQV poll gap stops for ${name}`, async () => {
    const {h, at, samples} = await runningEqvWithMeterGap();
    await h.replayAt(at, samples);
    assert.equal(h.value('Devices.Wallbox1.OutputActive'), true);
    if (id === 'lpc.limit') {
        h.mapping.DP_LPC_STATE = 'lpc.state';
        h.mapping.DP_LPC_LIMIT = id;
        h.run("CFG.dp.lpcState='lpc.state';CFG.dp.lpcLimit='lpc.limit'");
        h.put('lpc.state', 'limited');
    }
    await h.replayAt(at + 1000, [...samples, [id, value, invalid]]);
    assert.equal(h.value('Devices.Wallbox1.OutputActive'), false, h.value('Devices.Wallbox1.OutputStatus'));
    assert.ok(h.writes.some(w => w.id === 'goe.allow' && w.val === 0));
    assert.ok(!h.writes.some(w => w.id === 'goe.allow' && w.val === 1));
});

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

for (const split of [false,true]) test(`real parallel allocator retains acknowledged Mii step before uptake during telemetry outage, heater=${split}`,async()=>{
    const h=await plant({mii:true,wallbox:false,startDelayS:0,split,initialSurplusW:split?6000:3000,
        nativeConfig:{wallboxParallelChargingEnabled:true,wb0CommissioningMaxA:8}});
    await h.advance(90);
    assert.equal(h.value('Devices.Wallbox0.ResponseState'),'confirmed');
    const d=h.output.devices[0];
    h.config.wb0CommissioningMaxA=16;
    h.setSurplus(split?7000:3500);
    const at=h.now()+1000;
    await h.replayAt(at);
    assert.equal(d.pending?.stage,'current',h.value('Devices.Wallbox0.OutputStatus'));
    const amps=d.pending.amps;
    await h.replayAt(at+1000,[['goe0.feedback',amps],
        ['DP_WB0_POWER',1.76,{ts:at}],['DP_WB0_L1_A',7.9,{ts:at}]]);
    assert.equal(h.value('Devices.Wallbox0.ResponseState'),'vehicle_response');
    await h.replayAt(at+2000,[['goe0.feedback',amps],
        ['DP_WB0_POWER',1.76,{ts:at}],['DP_WB0_L1_A',7.9,{ts:at}]]);
    const ids=['goe0.error','DP_WB0_CAR','goe0.allow','goe0.feedback','DP_WB0_POWER',
        ...[1,2,3].map(p=>`DP_WB0_L${p}_A`)];
    const frozen=ids.map(id=>[id,h.states.get(id).val,{...h.states.get(id)}]);
    h.writes.length=0;
    for(const offset of [33000,63000,603000]) {
        await h.replayAt(at+offset,frozen);
        assert.equal(h.value('Devices.Wallbox0.OutputActive'),true,h.value('Devices.Wallbox0.OutputStatus'));
        assert.match(h.value('Devices.Wallbox0.OutputStatus'),/TELEMETRIE/);
        assert.ok(h.value('Devices.Wallbox0.OutputReservedPower_W')>=amps*230);
        assert.ok(!h.writes.some(w=>['goe0.allow','goe0.cmd'].includes(w.id)),JSON.stringify(h.writes));
    }
});

for (const failure of [null, 'SMA', 'house', 'master', 'device'])
test(`simultaneous Mii and EQE telemetry age keeps reserves with safe SMA; failure=${failure}`, async () => {
    const h = await plant({mii: true, startDelayS: 0, split: false, initialSurplusW: 6000,
        nativeConfig: {wallboxParallelChargingEnabled: true, wb0CommissioningMaxA: 6, wb2CommissioningMaxA: 6}});
    h.put('DP_WB0_AMIN', 6); h.put('DP_WB2_AMIN', 6);
    await h.advance(90);
    for (const wb of [0, 2]) assert.equal(h.value(`Devices.Wallbox${wb}.ResponseState`), 'confirmed');
    const ids = [0, 2].flatMap(wb => [wb === 0 ? 'goe0.error' : 'goe.error', `DP_WB${wb}_CAR`,
        wb === 0 ? 'goe0.allow' : 'goe.allow', wb === 0 ? 'goe0.feedback' : 'goe.feedback',
        `DP_WB${wb}_POWER`, ...[1, 2, 3].map(p => `DP_WB${wb}_L${p}_A`)]);
    const frozen = ids.map(id => [id, h.states.get(id).val, {...h.states.get(id)}]);
    const faults = {SMA: [['DP_GRID_IMPORT', 0, {q: 64}]], house: [['DP_HA_CRITICAL', true]],
        master: [['ems.0.System.RealOutputsEnabled', false]], device: [['goe.error', 1]]};
    h.writes.length = 0;
    await h.replayAt(h.now() + 31000, [...frozen, ...(faults[failure] || [])]);
    if (failure) {
        assert.equal(h.value('Devices.Wallbox2.OutputActive'), false, h.value('Devices.Wallbox2.OutputStatus'));
        assert.ok(!h.writes.some(w => ['goe.allow', 'goe0.allow'].includes(w.id) && w.val === 1));
        return;
    }
    for (const wb of [0, 2]) {
        assert.equal(h.value(`Devices.Wallbox${wb}.OutputActive`), true, h.value(`Devices.Wallbox${wb}.OutputStatus`));
        assert.match(h.value(`Devices.Wallbox${wb}.OutputStatus`), /TELEMETRIE/);
        assert.ok(h.value(`Devices.Wallbox${wb}.OutputReservedPower_W`) >= 1380);
    }
    assert.ok(!h.writes.some(w => ['goe.allow', 'goe0.allow', 'goe.cmd', 'goe0.cmd'].includes(w.id)));
});

for (const split of [false,true]) for (const offline of [false,true])
    test(`real parallel allocator retains unacknowledged Mii step during telemetry outage, heater=${split}, offline=${offline}`,async()=>{
    const h=await plant({mii:true,wallbox:false,startDelayS:0,split,initialSurplusW:split?6000:3000,
        nativeConfig:{wallboxParallelChargingEnabled:true,wb0CommissioningMaxA:8}});
    await h.advance(90);
    assert.equal(h.value('Devices.Wallbox0.ResponseState'),'confirmed');
    const d=h.output.devices[0];
    h.config.wb0CommissioningMaxA=16;
    h.setSurplus(split?7000:3500);
    const at=h.now()+1000;
    await h.replayAt(at);
    assert.equal(d.pending?.stage,'current',h.value('Devices.Wallbox0.OutputStatus'));
    const amps=d.pending.amps;
    await h.replayAt(at+1000,[['goe0.feedback',8],
        ['DP_WB0_POWER',1.76,{ts:at}],['DP_WB0_L1_A',7.9,{ts:at}]]);
    assert.equal(d.response.ackAt,0);
    const connection = offline ? [['goe0.connection',false]] : [];
    await h.replayAt(at+2000,[['goe0.feedback',8],
        ['DP_WB0_POWER',1.76,{ts:at}],['DP_WB0_L1_A',7.9,{ts:at}],...connection]);
    if (offline) {
        const grant = JSON.parse(h.value('Control.ParallelWallboxAllocation_JSON')).allocations.find(x=>x.wb===0);
        assert.equal(grant.authorized,false);
        assert.equal(grant.telemetryHold,true);
        assert.equal(h.value('Devices.Wallbox0.OutputActive'),true);
    }
    const ids=['goe0.error','DP_WB0_CAR','goe0.allow','goe0.feedback','DP_WB0_POWER',
        ...[1,2,3].map(p=>`DP_WB0_L${p}_A`)];
    const frozen=ids.map(id=>[id,h.states.get(id).val,{...h.states.get(id)}]);
    h.writes.length=0;
    for(const offset of [33000,63000,603000]) {
        await h.replayAt(at+offset,[...frozen,...connection]);
        assert.equal(h.value('Devices.Wallbox0.OutputActive'),true,h.value('Devices.Wallbox0.OutputStatus'));
        assert.match(h.value('Devices.Wallbox0.OutputStatus'),/ACK-WARNUNG/);
        assert.ok(h.value('Devices.Wallbox0.OutputReservedPower_W')>=amps*230);
        assert.ok(!h.writes.some(w=>['goe0.allow','goe0.cmd'].includes(w.id)),JSON.stringify(h.writes));
    }
});
