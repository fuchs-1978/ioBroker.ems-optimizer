'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

test('fixed Mii without psm reaches a measured 6-to-7 A PV step through the real allocator and output', async () => {
    const h = await plant({mii:true,wallbox:false,split:false,initialSurplusW:1380,
        startDelayS:5,minimumRuntimeS:0,nativeConfig:{wallboxParallelChargingEnabled:true,wallboxPVImportToleranceW:100,dhwControlEnabled:false}});
    h.put('DP_WB0_SOC',53); h.put('DP_WB0_MIN_SOC',50); h.put('DP_WB0_TARGET',100);
    h.own('Control.TargetGridPower_W',0);
    h.own('Devices.MyPV_DHW.ControlEnabled',false);
    h.put('DP_WB0_AMIN',6); h.put('DP_WB0_RELEASE',0);
    await h.advance(40);
    assert.equal(h.physical().miiAmps,6);
    assert.equal(h.value('Devices.Wallbox0.ResponseState'),'confirmed');
    assert.equal(h.states.has('DP_WB0_PHASE_MODE'),false,'the Mii has no psm feedback');
    const at=h.now()+10000;
    const samples=[['DP_WB0_POWER',1.31],['DP_WB0_L1_A',5.9],['DP_WB0_L2_A',0],['DP_WB0_L3_A',0],
        ['DP_GRID_IMPORT',0],['DP_GRID_EXPORT',258.5]];
    h.writes.length=0;
    await h.replayAt(at,samples);
    const d=JSON.parse(h.value('Control.Wallbox0.AllocationDiagnostics_JSON'));
    assert.equal(d.actualPowerW,1310);
    assert.equal(d.measuredPVStep,true,JSON.stringify(d));
    assert.equal(h.value('Control.Targets.Wallbox0_A'),7);
    assert.ok(h.writes.some(w=>w.id==='goe0.cmd'&&w.val===7),h.value('Devices.Wallbox0.OutputStatus'));
    assert.ok(h.value('Devices.Wallbox0.OutputReservedPower_W')>=1610);
    const frozen=samples.map(([id,value])=>[id,value,{...h.states.get(id)}]);
    await h.replayAt(at+2000,frozen);
    assert.ok(!h.writes.some(w=>w.id==='goe0.cmd'&&w.val>7),'one response cannot fund repeated increases');
    assert.ok(!h.writes.some(w=>w.id==='goe0.cmd'&&w.val===6),'pending PV step must not be reversed before ACK');
    // Supply the independently acknowledged 7 A and its actual electrical
    // response; the synthetic plant's nominal 230 V model cannot reproduce
    // this real car's lower measured uptake.
    const response=[['goe0.feedback',7],['DP_WB0_POWER',1.54],['DP_WB0_L1_A',6.7],
        ['DP_WB0_L2_A',0],['DP_WB0_L3_A',0],['DP_GRID_IMPORT',0],['DP_GRID_EXPORT',28.5]];
    await h.replayAt(at+4000,[...frozen,['goe0.feedback',7]]);
    await h.replayAt(at+6000,response);
    await h.replayAt(at+8000,response);
    assert.equal(h.value('Devices.Wallbox0.OutputCommand_A'),7,h.value('Devices.Wallbox0.OutputStatus'));
    assert.equal(h.value('Devices.Wallbox0.ResponseState'),'confirmed');
    assert.equal(h.value('Control.Targets.Wallbox0_Phases'),1);
    assert.ok(!h.writes.some(w=>w.id==='goe0.allow'&&w.val===0));
});
