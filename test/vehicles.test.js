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
        gridConstraints:require('../lib/grid-constraints'),
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
test('priority source selects admin or external object explicitly',()=>{
    const internal=engine({wallboxPrioritySource:'internal',wallboxPriority:1});
    internal.put('DP_WB_PRIORITY',2);internal.run('updateVehicles()');
    assert.equal(internal.run('vehicleState(1).selectedPriority'),true);
    assert.equal(internal.run('vehicleState(2).selectedPriority'),false);
    const external=engine({wallboxPrioritySource:'external',wallboxPriority:1});
    external.put('DP_WB_PRIORITY',2);external.run('updateVehicles()');
    assert.equal(external.run('vehicleState(1).selectedPriority'),false);
    assert.equal(external.run('vehicleState(2).selectedPriority'),true);
});
test('external dynamic price switch overrides the internal switch and fails safe',()=>{
    const h=engine();h.put('ems.0.Config.DynamicEnergyPriceEnabled',true);
    h.put('DP_DYNAMIC_ENERGY_ENABLED',false);
    let result=h.run('buildPriceForecast(Date.now())');
    assert.match(result.mode,/Energie=fest/);
    assert.match(h.states.get('ems.0.Config.DynamicEnergyPriceSourceStatus').val,/extern/);
    h.put('DP_DYNAMIC_ENERGY_ENABLED','invalid');
    result=h.run('buildPriceForecast(Date.now())');
    assert.match(result.mode,/Energie=fest/);
    assert.match(h.states.get('ems.0.Config.DynamicEnergyPriceSourceStatus').val,/sicher AUS/);
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
test('running wallbox follows actual power response instead of nominal command power',()=>{
    const h=engine();h.run('updateVehicles()');h.put('DP_WB0_POWER',1.72);
    const result=h.run('quantizeWallbox(2256,vehicleState(0),10,1,1720)');
    assert.equal(result.amps,12);
    assert.equal(result.powerW,2760);
    assert.equal(result.expectedPowerW,2180);
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
test('LPC budget caps the combined simulated wallbox targets',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',0);h.run('updateVehicles()');
    h.run('updateSlowTargets(12000,[{valueW:7000},{valueW:7000},{valueW:7000}],{valueW:0},4200)');
    assert.ok(h.run('slowTargets.wallboxW.reduce((sum,value)=>sum+value,0)')<=4200);
});
test('realtime allocator never targets two wallboxes at once',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',0);h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.run('updateVehicles()');
    h.run('updateSlowTargets(20000,[{valueW:7000},{valueW:7000},{valueW:6000}],{valueW:0},20000)');
    assert.equal(h.run('slowTargets.wallboxA.filter(value=>value>0).length'),1);
});
test('running productive wallbox remains selected until it is released',()=>{
    const h=engine({wallboxPriority:1});h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);h.run('updateVehicles()');
    assert.equal(h.run('selectRealtimeWallboxes([{valueW:0},{valueW:7000},{valueW:0}])[0].wb'),0);
});
test('default PV-only above minimum does not force charging at departure deadline',()=>{
    const h=engine();h.put('ems.0.Config.Wallbox0VehicleCapacity_kWh',100000);
    h.run('updateVehicles()');assert.equal(h.run('vehicleState(0).mustCharge'),false);
});
test('empty departure keeps the vehicle available for the full forecast horizon',()=>{
    const h=engine({wb0DeadlineEnabled:true});
    h.put('ems.0.Vehicles.Wallbox0.DepartureTime','');
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Forecast.Valid',true);h.put('ems.0.Devices.MyPV_DHW.Present',false);
    h.run('historyReady=true; updateVehicles()');
    assert.equal(h.run('vehicleState(0).departureTimestamp'),0);
    assert.equal(h.run('vehicleState(0).latestStartTimestamp'),0);
    assert.equal(h.run('vehicleState(0).mustCharge'),false);
    const start=Date.now()+24*60*60*1000;
    h.run(`buildDevicePlan({pv:Array.from({length:4},(_,i)=>({timestamp:${start}+i*900000,valueW:3000})),
        house:Array.from({length:4},()=>({valueW:500})),prices:{total:Array.from({length:4},()=>({value_ct_kWh:28.89}))}})`);
    const plan=JSON.parse(h.states.get('ems.0.Plan.Wallbox0_48h_JSON').val);
    assert.ok(plan.some(slot=>slot.valueW>0));
});
test('forecast schedules wallboxes sequentially, never in the same slot',()=>{
    const h=engine();h.put('ems.0.Forecast.Valid',true);h.put('ems.0.Devices.MyPV_DHW.Present',false);
    h.run('historyReady=true');
    h.run(`buildDevicePlan({pv:Array.from({length:8},(_,i)=>({timestamp:Date.now()+i*900000,valueW:16000})),
        house:Array.from({length:8},()=>({valueW:500})),prices:{total:Array.from({length:8},()=>({value_ct_kWh:28.89}))}})`);
    const plans=[0,1,2].map(wb=>JSON.parse(h.states.get(`ems.0.Plan.Wallbox${wb}_48h_JSON`).val));
    for(let slot=0;slot<plans[0].length;slot++)
        assert.ok(plans.filter(plan=>plan[slot].valueW>0).length<=1,`parallel slot ${slot}`);
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
test('phase target uses a continuous forecast window and leaves the detected phase input untouched',()=>{
    const h=engine({phaseSwitchLookAheadMin:30,phaseSwitchMinHoldMin:30});
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases',3);h.run('updateVehicles()');
    const now=Date.now();
    const plan=Array.from({length:3},(_,i)=>({timestamp:now+i*900000,valueW:6210,phases:3,chargingMinutes:15}));
    h.put('ems.0.Plan.Wallbox1_48h_JSON',JSON.stringify(plan));
    h.put('ems.0.Control.Targets.Wallbox1_Phases',1);h.put('DP_WB1_PHASES',1);
    assert.equal(h.run(`stabilizedPhaseTarget(1,vehicleState(1),3,${now})`),3);
    assert.equal(h.states.get('DP_WB1_PHASES').val,1);
});
test('phase minimum hold time prevents rapid switching of the existing EMS target',()=>{
    const h=engine({phaseSwitchLookAheadMin:30,phaseSwitchMinHoldMin:30});
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases',3);h.run('updateVehicles()');
    const now=Date.now();
    const plan=Array.from({length:3},(_,i)=>({timestamp:now+i*900000,valueW:2300,phases:1,chargingMinutes:15}));
    h.put('ems.0.Plan.Wallbox1_48h_JSON',JSON.stringify(plan));
    h.run(`stableWallboxPhases[1]=3;lastPhaseChangeAt[1]=${now}`);
    assert.equal(h.run(`stabilizedPhaseTarget(1,vehicleState(1),1,${now+60000})`),3);
    h.run(`lastPhaseChangeAt[1]=${now-31*60000}`);
    assert.equal(h.run(`stabilizedPhaseTarget(1,vehicleState(1),1,${now})`),1);
});
test('missing energy that no longer fits one-phase selects three phases',()=>{
    const h=engine({phaseSwitchLookAheadMin:30,phaseSwitchMinHoldMin:30});
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases',3);h.run('updateVehicles()');
    const now=Date.now();
    h.put('ems.0.Vehicles.Wallbox1.GridEnergyRequired_kWh',10);
    h.put('ems.0.Vehicles.Wallbox1.DepartureTimestamp',now+3600000);
    h.put('ems.0.Plan.Wallbox1_48h_JSON','[]');
    h.put('ems.0.Control.Targets.Wallbox1_Phases',1);
    assert.equal(h.run(`stabilizedPhaseTarget(1,vehicleState(1),1,${now})`),3);
});
test('50/50 allocator requires existing external switch and gives rounding remainder to DHW',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Config.WallboxStartDelay_s',0);
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
test('combined allocator uses measured wallbox feedback for the EHZ residual',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.Wallbox0.ControlEnabled',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.put('ems.0.Config.WallboxCombinedMaxStep_A',1);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('DP_WB0_POWER',2.6);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('slowTargets.wallboxA[0]=10');
    h.run('updateSlowTargets(6000,[{valueW:6000},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),true);
    assert.equal(h.run('slowTargets.wallboxA[0]'),11);
    assert.equal(h.run('slowTargets.wallboxExpectedW[0]'),2600);
    assert.equal(h.run('slowTargets.dhwW'),3400);
    assert.equal(h.run('slowTargets.wallboxExpectedW[0]+slowTargets.dhwW'),6000);
});
test('combined wallbox ramp advances by only one ampere per slow cycle',()=>{
    const h=engine();h.run('updateVehicles()');
    const result=h.run('quantizeWallbox(5000,vehicleState(0),10,1,2300,{rampA:1,nearestAmp:true})');
    assert.equal(result.amps,11);
});
test('small surplus below wallbox minimum falls back completely to DHW',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('updateSlowTargets(700,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[0]'),0);
    assert.equal(h.run('slowTargets.dhwW'),700);
});
test('PV-only wallbox requires stable surplus before it starts',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.WallboxStartReserve_W',300);h.put('ems.0.Config.WallboxStartDelay_s',30);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('updateSlowTargets(2000,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[0]'),0);
    assert.equal(h.run('slowTargets.dhwW'),2000);
    h.run('wallboxStartCandidateSince[0]=Date.now()-10000');
    h.run('updateSlowTargets(1500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.ok(h.run('wallboxStartCandidateSince[0]')>0);
    h.run('wallboxStartCandidateSince[0]=Date.now()-31000');
    h.run('updateSlowTargets(2000,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
});
test('started wallbox keeps minimum current for configured minimum run time',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.WallboxStartReserve_W',0);h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.put('ems.0.Config.WallboxMinimumRunTime_s',120);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('updateSlowTargets(2000,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
    h.run('updateSlowTargets(500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[0]'),6);
    assert.equal(h.run('slowTargets.dhwW'),0);
    h.run('wallboxRunStartedAt[0]=Date.now()-121000');
    h.run('updateSlowTargets(500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[0]'),0);
    assert.equal(h.run('slowTargets.dhwW'),500);
});
test('productive minimum run time starts with the real wallbox output',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.Wallbox0.ControlEnabled',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',false);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.WallboxStartReserve_W',0);h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.put('ems.0.Config.WallboxMinimumRunTime_s',600);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('updateSlowTargets(2000,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('wallboxRunStartedAt[0]'),0);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.run('updateSlowTargets(500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[0]'),6);
    assert.equal(h.states.get('ems.0.Vehicles.Wallbox0.MinimumRunTimeActive').val,true);
    assert.ok(h.states.get('ems.0.Vehicles.Wallbox0.MinimumRunTimeRemaining_s').val>=599);
});
test('productive wallbox never rearms start delay while minimum runtime is active',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.Wallbox0.ControlEnabled',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.WallboxStartReserve_W',300);
    h.put('ems.0.Config.WallboxStartDelay_s',120);
    h.put('ems.0.Config.WallboxMinimumRunTime_s',600);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('updateSlowTargets(500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[0]'),6);
    assert.equal(h.run('wallboxStartCandidateSince[0]'),0);
    assert.equal(h.states.get('ems.0.Vehicles.Wallbox0.StartDelayActive').val,false);
    assert.equal(h.states.get('ems.0.Vehicles.Wallbox0.StartDelayRemaining_s').val,0);
    assert.equal(h.states.get('ems.0.Vehicles.Wallbox0.MinimumRunTimeActive').val,true);
    assert.ok(h.states.get('ems.0.Vehicles.Wallbox0.MinimumRunTimeRemaining_s').val>=599);
});
test('binding grid-operator budget overrides wallbox minimum run time',()=>{
    const h=engine();h.put('ems.0.Devices.Wallbox1.Present',false);
    h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Config.WallboxStartReserve_W',0);h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.put('ems.0.Config.WallboxMinimumRunTime_s',120);h.run('updateVehicles()');
    h.run('updateSlowTargets(2000,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
    h.run('updateSlowTargets(500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0},1000)');
    assert.equal(h.run('slowTargets.wallboxA[0]'),0);
});
test('fresh allocation below 4 kW keeps 50/50 off and gives DHW only the ampere remainder',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Config.WallboxStartReserve_W',0);h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    for(let i=0;i<3;i++)h.run('updateSlowTargets(3500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),false);
    assert.equal(h.run('slowTargets.wallboxA[0]'),15);
    assert.equal(h.run('slowTargets.wallboxW[0]'),3450);
    assert.equal(h.run('slowTargets.dhwW'),50);
});
test('50/50 hysteresis stays active from 4 kW down to 3 kW and stops below 3 kW',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Config.WallboxStartReserve_W',0);h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('updateSlowTargets(4500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),true);
    h.run('updateSlowTargets(3500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),true);
    assert.ok(h.run('slowTargets.dhwW')>0);
    h.run('updateSlowTargets(2900,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),false);
});
