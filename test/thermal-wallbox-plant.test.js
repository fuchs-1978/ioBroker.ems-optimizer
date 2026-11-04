'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

async function running(options = {}) {
    const h = await plant({split: false, startDelayS: 0, minimumRuntimeS: 0,
        initialSurplusW: 3200, dhwDelayMs: 9000,
        nativeConfig: {wallboxParallelChargingEnabled: true, wallboxStopDelayS: 0}, ...options});
    h.own('Config.WallboxStartReserve_W', 150);
    h.own('Config.DHWMinTemperature_C', 40);
    h.put('DP_DHW_TEMP1',30); h.put('DP_DHW_TEMP4',67);
    h.own('Config.WallboxStartDelay_s', 300);
    // First charge must qualify normally, even though a heater is available.
    await h.advance(400);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    assert.equal(h.run('wallboxThermalResume[2].qualified'), true);
    return h;
}
async function interrupt(options = {}) {
    const h = await running(options);
    h.setSurplus(2100);
    h.put('DP_DHW_TEMP2', 37.6);
    await h.advance(options.dhwDelayMs >= 45000 ? 100 : 55);
    assert.equal(h.physical().allow, 0, h.diagnostic());
    assert.ok(h.physical().heaterW >= 900, h.diagnostic());
    assert.equal(h.run('wallboxThermalResume[2].qualified'), true);
    return h;
}
for (const validPlan of [true, false]) test(`mandatory heat and an established 1P minimum share real power without a stop; plan=${validPlan}`, async () => {
    const h = await running(); h.own('Plan.Valid', validPlan);
    const start = h.now(); h.put('DP_DHW_TEMP2', 39.5);
    await h.advance(170);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    assert.ok(h.physical().heaterW >= 900, h.diagnostic());
    assert.ok(!h.writes.some(w=>w.id==='goe.allow'&&w.val===0&&w.at>start), h.diagnostic());
    assert.ok(h.trace.filter(r=>r.at>start+40000).every(r=>r.wbW+r.heaterW<=3200+100), 'physical shared budget stays funded');
});
test('a thermal stop resumes after stable budget and physical heater reduction without another 300 seconds', async () => {
    const h = await interrupt(); const resumedAt = h.now();
    h.put('DP_DHW_TEMP2', 41);
    await h.advance(60);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    const on = h.writes.find(w=>w.id==='goe.allow'&&w.val===1&&w.at>=resumedAt);
    assert.ok(on&&on.at>=resumedAt+15000&&on.at<resumedAt+60000, h.diagnostic());
    const row=h.trace.find(r=>r.at===on.at);
    assert.ok(row.heaterW+1380<=2100, 'no start on a zero heater command alone');
});
for (const invalid of ['release','fault','unplug','reset','phase','price','budget','source','temperature','master','gap']) test(`${invalid} cancels the retained thermal restart qualification`, async () => {
    const h=await interrupt();
    if(invalid==='release')h.put('DP_WB2_ALLOW',false);
    if(invalid==='fault')h.put('goe.error',8);
    if(invalid==='unplug')h.put('DP_WB2_CAR',1);
    if(invalid==='reset')h.run('revokeWallboxThermalResume(2,"control-reset")');
    if(invalid==='phase')h.run('wallboxThermalResume[2].phases=3');
    if(invalid==='price')h.own('Config.Wallbox2PriceChargingEnabled',true);
    if(invalid==='source')h.setWallboxCurrentQuality(2,64);
    if(invalid==='master')h.own('Control.Enabled',false);
    if(invalid==='gap')h.run('wallboxThermalResume[2].lastObservationAt-=11000');
    h.put('DP_DHW_TEMP2',invalid==='temperature'?null:41);
    if(invalid==='budget')h.setSurplus(1200);
    await h.advance(10);
    assert.equal(h.run('wallboxThermalResume[2].qualified'),false,h.diagnostic());
    h.put('DP_WB2_ALLOW',true);h.put('goe.error',0);h.put('DP_WB2_CAR',2);
    h.own('Config.Wallbox2PriceChargingEnabled',false);h.setSurplus(2100);
    h.setWallboxCurrentQuality(2,0);h.put('DP_DHW_TEMP2',41);h.own('Control.Enabled',true);
    const since=h.now();await h.advance(60);
    assert.ok(!h.writes.some(w=>w.id==='goe.allow'&&w.val===1&&w.at>since),h.diagnostic());
});
test('a thermal pause has a fixed fifteen-minute deadline and expires into an ordinary start', async()=>{
    const h=await interrupt();const until=h.run('wallboxThermalResume[2].until');
    await h.advance(200);assert.equal(h.run('wallboxThermalResume[2].until'),until);
    await h.advance(710);h.put('DP_DHW_TEMP2',41);const since=h.now();await h.advance(50);
    assert.equal(h.run('wallboxThermalResume[2].qualified'),false);
    assert.ok(!h.writes.some(w=>w.id==='goe.allow'&&w.val===1&&w.at>since),h.diagnostic());
});
test('a genuine ordinary PV stop never earns a thermal restart shortcut', async()=>{
    const h=await running();h.setSurplus(500);await h.advance(40);
    assert.equal(h.physical().allow,0);h.setSurplus(2100);const since=h.now();await h.advance(70);
    assert.ok(!h.writes.some(w=>w.id==='goe.allow'&&w.val===1&&w.at>since));
});

test('delayed physical heater reduction remains binding after the shorter qualification', async()=>{
    const h=await interrupt({dhwDelayMs:45000});const since=h.now();h.put('DP_DHW_TEMP2',41);
    await h.advance(100);
    const on=h.writes.find(w=>w.id==='goe.allow'&&w.val===1&&w.at>=since);
    assert.ok(on&&on.at>=since+45000&&on.at<since+100000,h.diagnostic());
    const row=h.trace.find(r=>r.at===on.at);assert.ok(row.heaterW+1380<=2100,h.diagnostic());
});
test('returning heat priority cancels the partial fifteen-second budget observation',async()=>{
    const h=await interrupt();h.put('DP_DHW_TEMP2',41);await h.advance(10);
    h.put('DP_DHW_TEMP2',37.6);await h.advance(10);
    const since=h.now();h.put('DP_DHW_TEMP2',41);await h.advance(10);
    assert.equal(h.physical().allow,0);await h.advance(50);
    const on=h.writes.find(w=>w.id==='goe.allow'&&w.val===1&&w.at>=since);
    assert.ok(on&&on.at>=since+15000,h.diagnostic());
});
test('a second thermal pause needs a newly observed real charging episode',async()=>{
    const h=await interrupt();const first=h.run('wallboxThermalResume[2].until');
    h.put('DP_DHW_TEMP2',41);await h.advance(100);
    assert.ok(h.physical().wbPowerW>=1380);assert.equal(h.run('wallboxThermalResume[2].qualified'),true);
    h.put('DP_DHW_TEMP2',37.6);await h.advance(60);
    assert.equal(h.physical().allow,0);
    assert.ok(h.run('wallboxThermalResume[2].until')>first);
});
test('a cold vehicle cannot borrow a running minimum or bypass the ordinary heat priority',async()=>{
    const h=await plant({split:false,startDelayS:300,initialSurplusW:3200,
        nativeConfig:{wallboxParallelChargingEnabled:true}});
    h.own('Config.DHWMinTemperature_C',40);h.put('DP_DHW_TEMP2',37.6);await h.advance(350);
    assert.equal(h.physical().allow,0);assert.ok(h.physical().heaterW>=900);
    assert.equal(h.run('wallboxThermalResume[2].qualified'),false);
});
test('the shared thermal running minimum stays below an active hard group limit',async()=>{
    const h=await running({lpcLimitW:2500});h.put('DP_DHW_TEMP2',39.5);const since=h.now();await h.advance(160);
    assert.ok(h.physical().wbPowerW>=1380,h.diagnostic());assert.ok(h.physical().heaterW>=900,h.diagnostic());
    assert.ok(h.trace.filter(r=>r.at>since+40000).every(r=>r.wbW+r.heaterW<=2500),h.diagnostic());
});


test('a cold upper tank keeps full heat priority instead of retaining the flexible running minimum',async()=>{
    const h=await running();h.put('DP_DHW_TEMP2',25);h.put('DP_DHW_TEMP3',30);h.put('DP_DHW_OUTLET_TEMP',30);
    await h.advance(60);
    assert.equal(h.physical().allow,0,h.diagnostic());
    assert.ok(h.physical().heaterW>=2500,h.diagnostic());
});


test('a newly checked restart adoption can qualify a real charge without trusting old response timestamps',async()=>{
    const h=await plant({mii:true,wallbox:false,adoptRunningMii:true,split:false,startDelayS:300,
        minimumRuntimeS:0,initialSurplusW:2100,dhwDelayMs:9000,
        nativeConfig:{wallboxParallelChargingEnabled:true,wallboxStopDelayS:0}});
    h.own('Config.DHWMinTemperature_C',40);h.own('Config.WallboxStartReserve_W',150);
    h.put('DP_DHW_TEMP1',30);h.put('DP_DHW_TEMP4',67);await h.advance(60);
    assert.ok(h.physical().miiPowerW>=1380,h.diagnostic());
    assert.equal(h.run('wallboxThermalResume[0].qualified'),true,h.diagnostic());
    h.put('DP_DHW_TEMP2',37.6);await h.advance(60);
    assert.equal(h.physical().miiAllow,0,h.diagnostic());
    assert.equal(h.run('wallboxThermalResume[0].qualified'),true,h.diagnostic());
    const since=h.now();h.put('DP_DHW_TEMP2',41);await h.advance(70);
    assert.ok(h.physical().miiPowerW>=1380,h.diagnostic());
    assert.ok(h.writes.some(w=>w.id==='goe0.allow'&&w.val===1&&w.at>=since+15000&&w.at<since+70000));
});
