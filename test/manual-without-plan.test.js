'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {plant}=require('./control-plant');
for(const parallel of [false,true]) test(`manual 6 A starts without any valid plan or surplus; parallel=${parallel}`,async()=>{
 const h=await plant({mii:true,wallbox:false,initialSurplusW:0,split:false,startDelayS:0,
  nativeConfig:{wallboxParallelChargingEnabled:parallel}});
 h.put('DP_WB0_AMIN',6);h.own('Plan.Valid',false);
 await h.advance(60);
 assert.equal(h.physical().miiAllow,1,h.value('Devices.Wallbox0.OutputStatus'));
 assert.ok(h.value('Devices.Wallbox0.OutputCommand_A')>=6);
 assert.equal(h.value('Plan.Valid'),false,'no fabricated forecast validity');
 assert.equal(h.physical().heaterW,0);
 h.put('DP_WB0_SOC',100);await h.advance(10);
 assert.equal(h.physical().miiAllow,0,'target SOC still stops manual charging');
});
for(const parallel of [false,true]) for(const scenario of ['no-manual','master-off','user-off','house','SMA','device','hard-limit'])
test(`manual no-plan path preserves ${scenario}; parallel=${parallel}`,async()=>{
 const h=await plant({mii:true,wallbox:false,initialSurplusW:0,split:false,startDelayS:0,
  nativeConfig:{wallboxParallelChargingEnabled:parallel},...(scenario==='hard-limit'?{lpcLimitW:1000}:{})});
 h.put('DP_WB0_AMIN',scenario==='no-manual'?0:6);h.own('Plan.Valid',false);
 if(scenario==='master-off') h.own('System.RealOutputsEnabled',false);
 if(scenario==='user-off') h.put('DP_WB0_ALLOW',false);
 if(scenario==='device') h.put('goe0.error',1);
 if(scenario==='house') h.put('DP_HA_CRITICAL',true);
 if(scenario==='SMA') {
  await h.replayAt(h.now()+1000,[['DP_GRID_IMPORT',0,{q:64}]]);
 } else await h.advance(60);
 assert.equal(h.physical().miiAllow,0,h.value('Devices.Wallbox0.OutputStatus'));
});
for(const parallel of [false,true]) test(`manual minimum works with missing current slot; parallel=${parallel}`,async()=>{
 const h=await plant({mii:true,wallbox:false,initialSurplusW:0,split:false,startDelayS:0,
  nativeConfig:{wallboxParallelChargingEnabled:parallel}});
 h.put('DP_WB0_AMIN',6);h.own('Plan.MyPV_DHW_48h_JSON','[]');
 await h.advance(60);assert.equal(h.physical().miiAllow,1,h.value('Devices.Wallbox0.OutputStatus'));
 assert.equal(h.value('Plan.Valid'),true);
 h.put('DP_WB0_AMIN',0);await h.advance(10);assert.equal(h.physical().miiAllow,0);
});
