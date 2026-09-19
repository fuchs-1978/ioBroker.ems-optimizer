'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function engine(config={}) {
    const states=new Map();
    const put=(id,val)=>states.set(id,{val,ts:Date.now(),ack:true});
    const ctx=vm.createContext({nativeConfig:config,Date,console,
        getState:id=>states.get(id),existsState:id=>states.has(id),
        createState:(id,val)=>{if(!states.has(id))put(id,val);},setState:put,
        log:()=>{},sendTo:()=>{}});
    for(const file of ['core','history','forecast','vehicles','dhw-controller','planner','realtime']) {
        let source=fs.readFileSync(path.join(__dirname,'../lib/engine',file+'.js'),'utf8');
        source=source.replaceAll('__ADAPTER_ROOT__','ems.0').replace(/__([A-Z0-9_]+)__/g,(_,k)=>k);
        vm.runInContext(source,ctx);
    }
    vm.runInContext('createStates()',ctx);
    // Supply the actual mapping overlay; avoids legacy fallback paths.
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../lib/engine/config-mapping.js'),'utf8')
        .replace(/__([A-Z0-9_]+)__/g,(_,k)=>k),ctx);
    for(let wb=0;wb<3;wb++) {
        put(`ems.0.Devices.Wallbox${wb}.Present`,true);
        put(`DP_WB${wb}_CAR`,2);put(`DP_WB${wb}_SOC`,50);
        put(`DP_WB${wb}_MIN_SOC`,20);put(`DP_WB${wb}_TARGET`,80);
        put(`DP_WB${wb}_ALLOW`,true);put(`DP_WB${wb}_RELEASE`,1);
        put(`ems.0.Vehicles.Wallbox${wb}.MaxCurrent1P_A`,32);
        put(`ems.0.Vehicles.Wallbox${wb}.MinCurrent1P_A`,6);
        put(`ems.0.Vehicles.Wallbox${wb}.MaxCurrent3P_A`,16);
        put(`ems.0.Vehicles.Wallbox${wb}.MinCurrent3P_A`,6);
        put(`ems.0.Config.Wallbox${wb}VehicleCapacity_kWh`,50);
        put(`ems.0.Config.Wallbox${wb}MaxPower_W`,7360);
    }
    const run=source=>vm.runInContext(source,ctx);
    return {put,states,run,ctx};
}

test('admin min/target override mapped values only when selected',()=>{
    const h=engine({wb0SocLimitsSource:'admin',wb0MinSocPct:60,wb0TargetSocPct:90});
    h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).minimumSocPct'),60);
    assert.equal(h.run('vehicleState(0).mustCharge'),true);
    assert.equal(h.run('vehicleState(1).targetSocPct'),80);
});
test('below minimum outranks selected wallbox and previously planned slot',()=>{
    const h=engine({wallboxPriority:1});h.put('DP_WB0_SOC',10);
    h.run('updateVehicles()');
    assert.equal(h.run('selectRealtimeWallboxes([{valueW:0},{valueW:6000},{valueW:0}])[0].wb'),0);
});
test('disabled wallbox has no release or candidate even if car is attached',()=>{
    const h=engine();h.put('ems.0.Devices.Wallbox0.Present',false);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).release'),false);
    assert.equal(h.run('vehicleState(0).connected'),false);
});
test('null SoC is not a valid 0 percent reading',()=>{
    const h=engine();h.put('DP_WB0_SOC',null);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).socValid'),false);
});
test('taper follows simulated SoC in later slots and affects quantization',()=>{
    const h=engine({wb0TaperEnabled:true});h.run('updateVehicles()');
    assert.equal(h.run('plannedVehicleAtSoc(vehicleState(0), 2).maxCurrent1pA'),13);
    assert.equal(h.run('plannedVehicleAtSoc(vehicleState(0), 0.5).maxCurrent1pA'),8);
    assert.equal(h.run('quantizePlannedWallbox(7000, plannedVehicleAtSoc(vehicleState(0),0.5),1)'),1840);
});
test('realtime taper uses current SoC and cannot be exceeded by downward ramp',()=>{
    const h=engine({wb0TaperEnabled:true});h.put('DP_WB0_SOC',79);h.run('updateVehicles()');
    assert.equal(h.run('quantizeWallbox(7000,vehicleState(0),32,1).amps'),8);
    assert.equal(h.run('quantizeWallbox(0,vehicleState(0),32,1).amps'),0);
});
test('ceiling below minimum never gets lifted to six amps',()=>{
    const h=engine();h.run('updateVehicles()');
    assert.equal(h.run('quantizeWallbox(7000,{...vehicleState(0),maximumPowerW:1000},32,1).amps'),0);
    assert.equal(h.run('quantizePlannedWallbox(7000,{...vehicleState(0),maximumPowerW:1000},1)'),0);
});
test('mandatory minimum charging receives realtime budget without PV',()=>{
    const h=engine();h.put('DP_WB0_SOC',10);h.run('updateVehicles()');
    h.run('updateSlowTargets(0,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
});
test('default PV-only above minimum does not force charging at departure deadline',()=>{
    const h=engine();h.put('ems.0.Config.Wallbox0VehicleCapacity_kWh',100000);
    h.run('updateVehicles()');assert.equal(h.run('vehicleState(0).mustCharge'),false);
});
test('48-hour planner imports only to minimum, then waits for PV',()=>{
    const h=engine({wb0SocLimitsSource:'admin',wb0MinSocPct:20,wb0TargetSocPct:80});
    h.put('DP_WB0_SOC',19);h.put('ems.0.Devices.Wallbox1.Present',false);
    h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Forecast.Valid',true);h.put('ems.0.Devices.MyPV_DHW.Present',false);
    h.run('historyReady=true');
    h.run(`buildDevicePlan({pv:Array.from({length:8},(_,i)=>({timestamp:Date.now()+i*900000,valueW:0})),
        house:Array.from({length:8},()=>({valueW:600})),prices:{total:Array.from({length:8},()=>({value_ct_kWh:28.89}))}})`);
    const plan=JSON.parse(h.states.get('ems.0.Plan.Wallbox0_48h_JSON').val);
    assert.ok(plan[0].valueW>0);
    const kwh=plan.reduce((s,x)=>s+x.valueW/4000*0.9,0);
    assert.ok(Math.abs(kwh-0.5)<0.001,`charged ${kwh} instead of 0.5 kWh to minimum`);
});
test('legacy low-SoC stages apply only while socfrei equals two',()=>{
    const h=engine();h.put('DP_WB0_SOC',25);h.put('DP_WB0_RELEASE',2);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).lowSocMinimumCurrentA'),10);
    assert.equal(h.run('vehicleState(0).minCurrent1pA'),10);
    h.put('DP_WB0_RELEASE',1);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).lowSocMinimumCurrentA'),0);
    assert.equal(h.run('vehicleState(0).minCurrent1pA'),6);
});
test('EQV low-SoC 25 A request is clipped by phase and vehicle maximum',()=>{
    const h=engine();h.put('DP_WB1_SOC',8);h.put('DP_WB1_RELEASE',2);
    h.put('ems.0.Config.Wallbox1MaxPower_W',11040);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(1).requestedMinimumCurrentA'),25);
    assert.equal(h.run('vehicleState(1).minCurrent1pA'),25);
    assert.equal(h.run('vehicleState(1).minCurrent3pA'),16);
});
test('manual amin forces its configured minimum while socfrei is positive',()=>{
    const h=engine();h.put('DP_WB0_AMIN',12);h.put('DP_WB0_RELEASE',1);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).manualMinimumCurrentA'),12);
    assert.equal(h.run('vehicleState(0).mustCharge'),true);
    h.run('updateSlowTargets(0,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[0]'),12);
});
test('upper taper safety limit wins over a higher manual minimum',()=>{
    const h=engine({wb0TaperEnabled:true});h.put('DP_WB0_SOC',79);h.put('DP_WB0_AMIN',16);
    h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).requestedMinimumCurrentA'),16);
    assert.equal(h.run('vehicleState(0).minCurrent1pA'),8);
    assert.equal(h.run('quantizeWallbox(7000,vehicleState(0),0,1).amps'),8);
});
test('50/50 allocator requires existing external switch and gives rounding remainder to DHW',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.run('simulateDhwTarget = valueW => valueW');
    h.run('updateVehicles()');h.run('updateSlowTargets(6000,[{valueW:6000},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),true);
    assert.equal(h.run('slowTargets.wallboxW[0]'),1380);
    assert.equal(h.run('slowTargets.dhwW'),4620);
    h.put('DP_DHW_PARALLEL_RELEASE',0);h.run('resetSlowTargets()');
    h.run('updateSlowTargets(6000,[{valueW:6000},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),false);
});
