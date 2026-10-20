'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {plant}=require('./control-plant');

test('real engine invalidation and output restart retain 3P beyond the phase timeout during history warmup',async()=>{
    const h=await plant({split:false,wb2InitialPhaseMode:2,minimumRuntimeS:600});
    h.own('Control.RestartHandoffActive',true);h.own('Control.RestartHandoffSince',h.now()-100);
    for(const [key,val] of Object.entries({OutputOwned:true,OutputActive:true,OutputPhases:3,OutputCommand_A:6}))
        h.own(`Devices.Wallbox2.${key}`,val);
    h.own('Control.Targets.Wallbox2_Phases',3);
    h.put('goe.allow',1);h.put('goe.feedback',6);
    h.run('updateVehicles()');
    await h.restartOutput();
    h.run("zeroRealtimeTargets('Kein gueltiger 48-h-Fahrplan')");
    const frame=()=>[['goe.phase',2],['goe.allow',1],['goe.feedback',6],['DP_WB2_POWER',4.1],
        ['DP_WB2_L1_A',5.9],['DP_WB2_L2_A',5.9],['DP_WB2_L3_A',5.9],['ems.0.Plan.LastUpdate',0],['DP_WB2_SOC',50]];
    h.writes.length=0;
    await h.replayAt(h.now()+1000,frame(),{allocate:false});
    assert.equal(h.value('Control.Targets.Wallbox2_Phases'),3);
    assert.equal(h.value('Devices.Wallbox2.PhaseSwitchPending'),false);
    await h.replayAt(h.now()+181000,frame(),{allocate:false});
    assert.equal(h.value('Devices.Wallbox2.PhaseSwitchTimedOut'),false);
    assert.ok(!h.writes.some(w=>w.id==='goe.allow'&&w.val===0),JSON.stringify({writes:h.writes,status:h.value('Devices.Wallbox2.OutputStatus'),fault:h.value('Devices.Wallbox2.OutputFault'),reason:h.value('Devices.Wallbox2.LastStopReason')}));
});
