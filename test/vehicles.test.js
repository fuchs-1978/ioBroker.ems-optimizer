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
    for(const file of ['core', 'prices','history','forecast','vehicles','dhw-controller','planner','realtime']) {
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

function productionEngine(config={}) {
    const native={globalWriteEnabled:true,wb2ControlEnabled:true,wb2ProductionArmed:true,
        dhwControlEnabled:true,combinedProductionArmed:true,...config};
    const h=engine(native);
    h.put('ems.0.System.RealOutputsEnabled',true);
    for(let wb=0;wb<3;wb++)h.put(`ems.0.Devices.Wallbox${wb}.ControlEnabled`,native[`wb${wb}ControlEnabled`]===true);
    h.put('ems.0.Devices.MyPV_DHW.Present',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',native.dhwControlEnabled===true);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.DHWCommissioningMaxPower_W',9000);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.put('ems.0.Config.WallboxStartReserve_W',0);
    h.run('simulateDhwTarget=valueW=>valueW;updateVehicles()');
    return h;
}

test('realtime plan selection rejects future, expired and malformed active slots',()=>{
    const h=engine();const now=Date.now();
    for(const slots of [[{timestamp:now+1,valueW:1000}],
        [{timestamp:now-900000,valueW:1000}],
        [{timestamp:now,valueW:null}],[{timestamp:now,valueW:false}],
        [{timestamp:now,valueW:' '}],[{timestamp:now,valueW:'broken'}]]) {
        h.put('ems.0.Plan.MyPV_DHW_48h_JSON',JSON.stringify(slots));
        assert.equal(h.run(`currentPlanItem('MyPV_DHW',${now})`),null,JSON.stringify(slots));
    }
    h.put('ems.0.Plan.MyPV_DHW_48h_JSON',JSON.stringify([
        {timestamp:now+900000,valueW:2000},{timestamp:now-899999,valueW:1000}]));
    assert.equal(h.run(`currentPlanItem('MyPV_DHW',${now}).valueW`),1000);
});
test('future timestamps cannot make a grid-operator constraint look fresh',()=>{
    const h=engine();h.states.set('limit',{val:4200,ack:true,ts:Date.now()+60000});
    assert.equal(h.run("freshConstraintValue('limit')"),null);
});

test('admin min/target override mapped values only when selected',()=>{
    const h=engine({wb0SocLimitsSource:'admin',wb0MinSocPct:60,wb0TargetSocPct:90});
    h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).minimumSocPct'),60);
    assert.equal(h.run('vehicleState(0).mustCharge'),true);
    assert.equal(h.run('vehicleState(1).targetSocPct'),80);
});
test('automatic choice gives below-minimum need precedence over a previous plan slot',()=>{
    const h=engine({wallboxPriority:-1});h.put('DP_WB0_SOC',10);
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
    assert.match(result.mode,/Energie=ungueltig/);
    assert.equal(result.total[0].value_ct_kWh,null);
    assert.match(h.states.get('ems.0.Config.DynamicEnergyPriceSourceStatus').val,/keine Preisfreigabe/);
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
test('invalid SoC quality, command echoes and timestamps never become mandatory zero-percent readings',()=>{
    const now=Date.now();
    const invalid=[{val:false},{val:' '},{val:0,ack:false},{val:0,q:64},
        {val:0,ts:now+60000},{val:0,ts:0},{val:0,ts:now-7200001}];
    for(const overrides of invalid) {
        const h=engine();h.states.set('DP_WB0_SOC',{val:0,ack:true,ts:now,...overrides});
        h.run('updateVehicles()');
        assert.equal(h.run('vehicleState(0).socValid'),false,JSON.stringify(overrides));
        assert.equal(h.run('vehicleState(0).release'),false,JSON.stringify(overrides));
    }
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
test('allocation diagnostics explain a mismatched command and response without changing quantization',()=>{
    const h=engine();h.run('updateVehicles()');
    // Independently constructed nominal powers: 12 A budget, 16 A real load,
    // but a previous virtual command of only 6 A.
    const result=h.run('quantizeWallbox(12*230,vehicleState(0),6,1,16*230)');
    assert.equal(result.amps,0);
    assert.equal(result.diagnostics.requestedW,2760);
    assert.equal(result.diagnostics.previousA,6);
    assert.equal(result.diagnostics.actualPowerW,3680);
    assert.equal(result.diagnostics.deltaA,-4);
    assert.equal(result.diagnostics.requestedA,2);
    assert.equal(result.diagnostics.reason,'quantized-below-minimum');
    const coherent=h.run('quantizeWallbox(12*230,vehicleState(0),6,1,6*230)');
    assert.equal(coherent.amps,12);
    assert.equal(coherent.diagnostics.responseBasis,'power-response');
});
test('allocator publishes pre-stabilization budget and clears diagnostics on invalidation',()=>{
    const h=engine({wallboxPrioritySource:'internal',wallboxPriority:0});h.run('updateVehicles()');
    h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.put('ems.0.Config.WallboxStartReserve_W',0);
    h.run('updateSlowTargets(4000,[{valueW:4000},{valueW:0},{valueW:0}],{valueW:0})');
    const diag=JSON.parse(h.states.get('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON').val);
    assert.equal(diag.valid,true);
    assert.equal(diag.selected,true);
    assert.ok(diag.requestedBeforeStabilizationW>0);
    assert.equal(diag.targetA,h.run('slowTargets.wallboxA[0]'));
    const idle=JSON.parse(h.states.get('ems.0.Control.Wallbox1.AllocationDiagnostics_JSON').val);
    assert.equal(idle.selected,false);
    h.run("zeroRealtimeTargets('test-invalid')");
    const cleared=JSON.parse(h.states.get('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON').val);
    assert.equal(cleared.valid,false);
    assert.equal(cleared.reason,'test-invalid');
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
test('automatic mode retains the running productive wallbox until it is released',()=>{
    const h=engine({wallboxPriority:-1});h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);h.run('updateVehicles()');
    assert.equal(h.run('selectRealtimeWallboxes([{valueW:0},{valueW:7000},{valueW:0}])[0].wb'),0);
});

function manualHandoffEngine() {
    const h=productionEngine({dhwControlEnabled:false,wb0ControlEnabled:true,wb0ProductionArmed:true,
        multiWallboxAlphaArmed:true,wallboxPrioritySource:'external',wallboxPriority:-2});
    h.put('DP_WB_PRIORITY',-1);
    h.put('ems.0.Devices.Wallbox2.OutputActive',true);
    h.put('ems.0.Devices.Wallbox2.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox2.OutputCommand_A',13);
    h.put('ems.0.Devices.Wallbox2.OutputPhases',1);
    h.put('DP_WB2_POWER',2.99);
    h.put('ems.0.Config.WallboxMinimumRunTime_s',600);
    h.run('updateVehicles()');
    const choose=()=>h.run('selectRealtimeWallboxes([{valueW:0},{valueW:0},{valueW:7000}])[0]?.wb ?? -1');
    return {...h,choose};
}

test('manual Mii zero preempts an active owned EQE even during minimum runtime',()=>{
    const h=manualHandoffEngine();assert.equal(h.choose(),2);
    // Commands intentionally use ack=false; this preference is not actuator
    // feedback. The realtime path reads it before the next observer refresh.
    h.states.set('DP_WB_PRIORITY',{val:0,ts:Date.now(),ack:false});
    assert.equal(h.choose(),0);
    assert.match(h.states.get('ems.0.Control.WallboxSelectionReason').val,/Manuelle Prioritaet Wallbox 0/);
    h.run('updateSlowTargets(6000,[{valueW:0},{valueW:0},{valueW:7000}],{valueW:0})');
    assert.equal(h.states.get('ems.0.Control.SelectedWallbox').val,0);
    assert.equal(h.run('slowTargets.wallboxA[2]'),0,'old target must relinquish selection');
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
    assert.ok(h.run('slowTargets.wallboxA.filter(amps=>amps>0).length')<=1);
    assert.ok(h.run('slowTargets.wallboxExpectedW[2]')>=2990,'physical old load remains reserved until OFF');
    const diag=JSON.parse(h.states.get('ems.0.Control.Wallbox0.AllocationDiagnostics_JSON').val);
    assert.match(diag.selectionReason,/Manuelle Prioritaet Wallbox 0/);
});

test('manual choice overrides old minimum-SoC, mandatory deadline and manual-current policy',()=>{
    for(const cause of ['minimum','deadline','amin']) {
        const h=manualHandoffEngine();
        if(cause==='minimum')h.put('DP_WB2_SOC',10);
        if(cause==='deadline'){
            h.run('nativeConfig.wb2DeadlineEnabled=true');
            const departure=new Date(Date.now()+5*60000);
            h.put('ems.0.Vehicles.Wallbox2.DepartureTime',
                `${String(departure.getHours()).padStart(2,'0')}:${String(departure.getMinutes()).padStart(2,'0')}`);
        }
        if(cause==='amin')h.put('DP_WB2_AMIN',10);
        h.run('updateVehicles()');
        assert.equal(h.run('vehicleState(2).mustCharge'),true,cause);
        h.put('DP_WB_PRIORITY',0);
        assert.equal(h.choose(),0,cause);
    }
});

test('ineligible manual target never displaces a running eligible owner',()=>{
    for(const cause of ['disabled','disconnect','release','soc','target','unarmed','phase']) {
        const h=manualHandoffEngine();
        if(cause==='disabled')h.put('ems.0.Devices.Wallbox0.Present',false);
        if(cause==='disconnect')h.put('DP_WB0_CAR',1);
        if(cause==='release')h.put('DP_WB0_ALLOW',false);
        if(cause==='soc')h.put('DP_WB0_SOC',null);
        if(cause==='target')h.put('DP_WB0_SOC',80);
        if(cause==='unarmed')h.put('ems.0.Devices.Wallbox0.ControlEnabled',false);
        if(cause==='phase'){
            h.run("nativeConfig.wb0PhaseControlMode='script';nativeConfig.wb0PhaseModeId='missing.phase'");
            h.put('ems.0.Vehicles.Wallbox0.PhaseSwitchEnabled',true);
        }
        h.put('DP_WB_PRIORITY',0);h.run('updateVehicles()');
        assert.equal(h.choose(),2,cause);
        assert.match(h.states.get('ems.0.Control.WallboxSelectionReason').val,/derzeit nicht zulaessig/,cause);
    }
});

test('fresh manual priority never uses stale observer eligibility for a disconnected or blocked target',()=>{
    for(const cause of ['disconnect','release','soc','target']) {
        const h=manualHandoffEngine();assert.equal(h.choose(),2);
        assert.equal(h.run('vehicleState(0).release'),true);
        if(cause==='disconnect')h.put('DP_WB0_CAR',1);
        if(cause==='release')h.put('DP_WB0_ALLOW',false);
        if(cause==='soc')h.put('DP_WB0_SOC',null);
        if(cause==='target')h.put('DP_WB0_SOC',80);
        h.put('DP_WB_PRIORITY',0);
        // No updateVehicles call here: selection is itself the coherent
        // boundary for a new command and the current raw input snapshots.
        assert.equal(h.choose(),2,cause);
        assert.equal(h.run('wallboxManualHandoff'),null,cause);
    }
});

test('invalid current car evidence cannot start or retain a manual handoff',()=>{
    const now=Date.now();
    for(const sample of [{val:2,q:64},{val:2,ack:false},{val:2,ts:now+60000},
        {val:2,ts:0},{val:null},{val:false}]) {
        for(const pending of [false,true]) {
            const h=manualHandoffEngine();assert.equal(h.choose(),2);
            if(pending){h.put('DP_WB_PRIORITY',0);assert.equal(h.choose(),0);}
            h.states.set('DP_WB0_CAR',{val:2,ts:now,ack:true,...sample});
            h.put('DP_WB_PRIORITY',0);
            assert.equal(h.choose(),2,JSON.stringify({sample,pending}));
            assert.equal(h.run('wallboxManualHandoff'),null);
        }
    }
    const h=manualHandoffEngine();
    h.states.set('DP_WB0_CAR',{val:2,ack:true,ts:now-24*3600000,q:0});
    h.put('DP_WB_PRIORITY',0);
    assert.equal(h.choose(),0,'an unchanged confirmed plug status is retained; productive freshness gates still apply');
});

test('missing or invalid mapped user release cannot interrupt the healthy owner for manual priority',()=>{
    const now=Date.now();
    for(const sample of [null,{val:null},{val:''},{val:false},{val:0},{val:'0'},
        {val:true,q:64},{val:true,ts:now+60000},{val:true,ts:0}]) {
        for(const pending of [false,true]) {
            const h=manualHandoffEngine();assert.equal(h.choose(),2);
            if(pending){h.put('DP_WB_PRIORITY',0);assert.equal(h.choose(),0);}
            if(sample===null)h.states.delete('DP_WB0_ALLOW');
            else h.states.set('DP_WB0_ALLOW',{ts:now,ack:false,...sample});
            h.put('DP_WB_PRIORITY',0);
            assert.equal(h.choose(),2,JSON.stringify({sample,pending}));
            assert.equal(h.run('wallboxManualHandoff'),null);
        }
    }
    for(const value of [true,1,'1']) {
        const h=manualHandoffEngine();
        h.states.set('DP_WB0_ALLOW',{val:value,ack:false,q:0,ts:now-24*3600000});
        h.put('DP_WB_PRIORITY',0);
        assert.equal(h.choose(),0,'valid retained user commands need no actuator acknowledgement');
    }
});

test('invalid and neutral priorities never create a false Mii choice or round a fractional index',()=>{
    const now=Date.now();
    for(const sample of [{val:null},{val:''},{val:false},{val:true},{val:0.4},{val:3},{val:-1},{val:-2},
        {val:0,q:64},{val:0,ts:0},{val:0,ts:now+60000}]) {
        const h=manualHandoffEngine();
        h.states.set('DP_WB_PRIORITY',{ts:now,ack:false,...sample});
        h.run('updateVehicles()');
        assert.equal(h.run('vehicleState(0).selectedPriority'),false,JSON.stringify(sample));
        assert.equal(h.choose(),2,JSON.stringify(sample));
    }
});

test('neutral priority during manual handoff does not reselect the old stopping owned vehicle',()=>{
    const h=manualHandoffEngine();assert.equal(h.choose(),2);
    h.put('DP_WB_PRIORITY',0);assert.equal(h.choose(),0);
    h.put('ems.0.Devices.Wallbox2.OutputActive',false);
    h.put('DP_WB_PRIORITY',-1);h.run('updateVehicles()');
    assert.equal(h.choose(),0);
    h.put('DP_WB2_SOC',80);h.run('updateVehicles()');
    assert.equal(h.choose(),0,'old owner awaiting OFF does not force selection back to old or -1');
    h.put('ems.0.Devices.Wallbox2.OutputOwned',false);
    assert.equal(h.choose(),0,'retain preparation through the normal initial start delay');
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    assert.equal(h.choose(),0);
    assert.equal(h.run('wallboxManualHandoff'),null,'new active ownership completes the manual transition');
    assert.equal(h.choose(),0,'automatic mode now retains the new active owner');
});

test('manual preparation cancels on target ineligibility, timeout or control reset',()=>{
    for(const cause of ['ineligible','timeout','reset']) {
        const h=manualHandoffEngine();h.choose();
        h.put('DP_WB_PRIORITY',0);assert.equal(h.choose(),0);
        h.put('DP_WB_PRIORITY',-1);
        if(cause==='ineligible')h.put('DP_WB0_ALLOW',false);
        if(cause==='timeout')h.run('wallboxManualHandoff.until=Date.now()-1');
        if(cause==='reset')h.run('resetSlowTargets()');
        h.run('updateVehicles()');
        assert.equal(h.choose(),2,cause);
        assert.equal(h.run('wallboxManualHandoff'),null,cause);
    }
});

test('a newer ineligible manual request cancels the superseded prepared vehicle',()=>{
    const h=manualHandoffEngine();assert.equal(h.choose(),2);
    h.put('DP_WB_PRIORITY',0);assert.equal(h.choose(),0);
    assert.equal(h.run('wallboxManualHandoff.target'),0);
    h.put('DP_WB_PRIORITY',1);
    assert.equal(h.choose(),2,'ineligible EQV request must not finish the superseded Mii request');
    assert.equal(h.run('wallboxManualHandoff'),null);
    assert.match(h.states.get('ems.0.Control.WallboxSelectionReason').val,/Wallbox 1.*derzeit nicht zulaessig/);
    h.put('ems.0.Devices.Wallbox2.OutputActive',false);
    assert.equal(h.choose(),2,'the already stopping owner remains protected until its own OFF handshake completes');
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
test('low-SoC stages follow authoritative minimum even when legacy socfrei is stale',()=>{
    const h=engine();h.put('DP_WB0_SOC',25);h.put('DP_WB0_MIN_SOC',30);
    h.put('DP_WB0_RELEASE',1);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).lowSocMinimumCurrentA'),10);
    assert.equal(h.run('vehicleState(0).minCurrent1pA'),10);
    h.put('DP_WB0_RELEASE',2);h.put('DP_WB0_MIN_SOC',20);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).lowSocMinimumCurrentA'),0);
    assert.equal(h.run('vehicleState(0).minCurrent1pA'),6);
    assert.equal(h.run('vehicleState(0).mustCharge'),false);
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
    const h=engine({wb1PhaseControlMode:'ems',phaseSwitchLookAheadMin:30,phaseSwitchMinHoldMin:30});
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
    const h=engine({wb1PhaseControlMode:'ems',phaseSwitchLookAheadMin:30,phaseSwitchMinHoldMin:30});
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled',true);
    // Isolate phase holding from deadline urgency. The default 06:00 departure
    // requires three phases near that time, irrespective of the forecast.
    h.put('ems.0.Vehicles.Wallbox1.DepartureTime','');
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases',3);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(1).departureTimestamp'),0);
    const now=Date.now();
    const plan=Array.from({length:3},(_,i)=>({timestamp:now+i*900000,valueW:2300,phases:1,chargingMinutes:15}));
    h.put('ems.0.Plan.Wallbox1_48h_JSON',JSON.stringify(plan));
    h.run(`stableWallboxPhases[1]=3;lastPhaseChangeAt[1]=${now}`);
    assert.equal(h.run(`stabilizedPhaseTarget(1,vehicleState(1),1,${now+60000})`),3);
    h.run(`lastPhaseChangeAt[1]=${now-31*60000}`);
    assert.equal(h.run(`stabilizedPhaseTarget(1,vehicleState(1),1,${now})`),1);
});
test('missing energy that no longer fits one-phase selects three phases',()=>{
    const h=engine({wb1PhaseControlMode:'ems',phaseSwitchLookAheadMin:30,phaseSwitchMinHoldMin:30});
    h.put('ems.0.Vehicles.Wallbox1.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox1.MaximumPhases',3);h.run('updateVehicles()');
    const now=Date.now();
    h.put('ems.0.Vehicles.Wallbox1.GridEnergyRequired_kWh',10);
    h.put('ems.0.Vehicles.Wallbox1.DepartureTimestamp',now+3600000);
    h.put('ems.0.Plan.Wallbox1_48h_JSON','[]');
    h.put('ems.0.Control.Targets.Wallbox1_Phases',1);
    assert.equal(h.run(`stabilizedPhaseTarget(1,vehicleState(1),1,${now})`),3);
});
test('script phase authority keeps a confirmed 1P car charging despite a 3P forecast',()=>{
    const h=productionEngine({wb2PhaseControlMode:'script',wb2PhaseModeId:'phase2'});
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox2.MaximumPhases',3);
    h.put('phase2',1);h.put('DP_DHW_PARALLEL_RELEASE',true);
    h.put('ems.0.Control.Targets.Wallbox2_Phases',3);
    const now=Date.now();
    h.put('ems.0.Plan.Wallbox2_48h_JSON',JSON.stringify(Array.from({length:3},(_,i)=>({
        timestamp:now+i*900000,valueW:6210,phases:3,chargingMinutes:15}))));
    h.run('updateVehicles();updateSlowTargets(5000,[{valueW:0},{valueW:0},{valueW:6210,phases:3}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxPhases[2]'),1);
    assert.equal(h.run('slowTargets.wallboxW[2]'),1380);
    assert.equal(h.run('realtimeParallelActive'),true,'1P start threshold applies to the actual phase');
    assert.equal(h.run('slowTargets.dhwW'),3620,'heater receives the unused physical 1P budget');
    assert.equal(h.states.get('phase2').val,1,'external script remains the phase authority');
    h.put('phase2',2);
    h.run('updateVehicles();updateSlowTargets(5000,[{valueW:0},{valueW:0},{valueW:1380,phases:1}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxPhases[2]'),3,'confirmed script switch applies immediately');
    assert.equal(h.run('slowTargets.wallboxW[2]'),4140);
    assert.equal(h.run('realtimeParallelActive'),false,'3P stop threshold follows the confirmed switch');
});
test('script phase allocation rejects unknown or unconfirmed modes without guessing 1P',()=>{
    const now=Date.now();
    const cases=[null,{val:0},{val:3},{val:true},{val:null},{val:' '},
        {val:1,ack:false},{val:1,q:64},{val:1,ts:0},{val:1,ts:now+60000}];
    for(const invalid of cases) {
        const h=productionEngine({wb2PhaseControlMode:'script',wb2PhaseModeId:'phase2'});
        h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled',true);
        h.put('ems.0.Vehicles.Wallbox2.MaximumPhases',3);
        if(invalid)h.states.set('phase2',{val:1,ack:true,ts:now,...invalid});
        h.run('updateVehicles();updateSlowTargets(5000,[{valueW:0},{valueW:0},{valueW:5000,phases:1}],{valueW:0})');
        assert.equal(h.run('vehicleState(2).release'),false,JSON.stringify(invalid));
        assert.equal(h.run('slowTargets.wallboxPhases[2]'),0,JSON.stringify(invalid));
        assert.equal(h.run('slowTargets.wallboxW[2]'),0,JSON.stringify(invalid));
        assert.equal(h.run('slowTargets.dhwW'),5000,JSON.stringify(invalid));
        assert.match(h.states.get('ems.0.Vehicles.Wallbox2.Status').val,/Phasenmodus/);
    }
});
test('retained confirmed script mode stays valid and loss of confirmation gates before the next observer cycle',()=>{
    const h=productionEngine({wb2PhaseControlMode:'script',wb2PhaseModeId:'phase2'});
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox2.MaximumPhases',3);
    h.states.set('phase2',{val:'1',ack:true,ts:Date.now()-86400000});
    h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(2).release'),true);
    h.states.set('phase2',{val:1,ack:false,ts:Date.now()});
    assert.equal(h.run('vehicleState(2).release'),false);
    assert.equal(h.run('selectRealtimeWallboxes([{},{},{}]).length'),0);
});
test('phase control defaults to the script and accepts the mapped source when the native ID is blank',()=>{
    const h=productionEngine({wb2PhaseModeId:'   '});
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox2.MaximumPhases',3);
    h.put('DP_WB2_PHASE_MODE',1);
    h.put('ems.0.Control.Targets.Wallbox2_Phases',3);
    h.run('updateVehicles();updateSlowTargets(5000,[{},{},{valueW:5000,phases:3}],{valueW:0})');
    assert.equal(h.run('vehicleState(2).phaseControlMode'),'script');
    assert.equal(h.run('vehicleState(2).release'),true);
    assert.equal(h.run('slowTargets.wallboxPhases[2]'),1);
    assert.equal(h.run('slowTargets.wallboxW[2]'),1380);
});
test('script mode does not change fixed-phase installations with phase switching disabled',()=>{
    const h=productionEngine({wb2PhaseControlMode:'script'});
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled',false);
    h.run('updateVehicles();updateSlowTargets(5000,[{},{},{valueW:5000,phases:3}],{valueW:0})');
    assert.equal(h.run('vehicleState(2).release'),true);
    assert.equal(h.run('slowTargets.wallboxPhases[2]'),1);
    assert.equal(h.run('slowTargets.wallboxW[2]'),1380);
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
test('restart handoff restarts productive minimum runtime without OutputActive edge',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.Wallbox0.ControlEnabled',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('ems.0.Config.WallboxMinimumRunTime_s',600);
    h.put('ems.0.Control.RestartHandoffSince',Date.now());
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('wallboxOutputWasActive[0]=true;wallboxRunStartedAt[0]=Date.now()-700000');
    h.run('updateSlowTargets(500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[0]'),6);
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
test('50/50 hysteresis starts at 4 kW, stays active down to 3 kW and stops below 3 kW',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Config.WallboxStartReserve_W',0);h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    h.run('updateSlowTargets(4000,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),true);
    h.run('updateSlowTargets(3500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),true);
    assert.ok(h.run('slowTargets.dhwW')>0);
    h.run('updateSlowTargets(2900,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),false);
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
    assert.ok(h.run('slowTargets.dhwW')<230);
});
test('50/50 allocation settles within one wallbox ampere while DHW closes the residual',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Devices.Wallbox0.ControlEnabled',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Config.WallboxStartDelay_s',0);
    h.put('ems.0.Config.WallboxCombinedMaxStep_A',1);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.run('simulateDhwTarget = valueW => valueW');h.run('updateVehicles()');
    for(let cycle=0;cycle<12;cycle++) {
        h.run('updateSlowTargets(6000,[{valueW:6000},{valueW:0},{valueW:0}],{valueW:0})');
        h.put('DP_WB0_POWER',h.run('slowTargets.wallboxW[0]')/1000);
    }
    assert.equal(h.run('realtimeParallelActive'),true);
    assert.ok(Math.abs(h.run('slowTargets.wallboxExpectedW[0]')-3000)<=230);
    assert.ok(Math.abs(h.run('slowTargets.dhwW')-3000)<=230);
    assert.equal(h.run('slowTargets.wallboxExpectedW[0]+slowTargets.dhwW'),6000);
});
test('minimum SoC changes keep a released running wallbox selected',()=>{
    const h=engine();h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.put('ems.0.Devices.Wallbox1.Present',false);h.put('ems.0.Devices.Wallbox2.Present',false);
    h.put('ems.0.Config.WallboxStartDelay_s',0);h.run('updateVehicles()');
    h.run('updateSlowTargets(2900,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
    h.put('DP_WB0_MIN_SOC',40);h.run('updateVehicles()');
    h.run('updateSlowTargets(2900,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
    h.put('DP_WB0_MIN_SOC',60);h.run('updateVehicles()');
    h.run('updateSlowTargets(2900,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.ok(h.run('slowTargets.wallboxA[0]')>=6);
});
test('higher target SoC keeps charging; only an already reached target revokes release',()=>{
    const h=engine();h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).release'),true);
    h.put('DP_WB0_TARGET',90);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).release'),true);
    h.put('DP_WB0_TARGET',50);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(0).release'),false);
});

test('production excludes priority WB0 with only an observer release; WB2 and EHZ retain budget',()=>{
    const h=productionEngine({wallboxPriority:0});
    h.run('updateSlowTargets(6000,[{valueW:6000},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.states.get('ems.0.Control.SelectedWallbox').val,2);
    assert.equal(h.run('slowTargets.wallboxW[0]'),0);
    assert.equal(h.run('slowTargets.wallboxA[2]'),6);
    assert.equal(h.run('slowTargets.dhwW'),4620);
    assert.equal(h.run('vehicleState(0).release'),true,'forecast still sees observer vehicle');
});
test('observer realtime retains all configured vehicles when master is off',()=>{
    const h=productionEngine({wallboxPriority:0});
    h.put('ems.0.System.RealOutputsEnabled',false);
    assert.equal(h.run('selectRealtimeWallboxes([{valueW:0},{valueW:0},{valueW:0}])[0].wb'),0);
});
test('EHZ-only production cannot lose surplus to unarmed forecast wallboxes or heating',()=>{
    const h=productionEngine({wb2ControlEnabled:false});
    h.run('updateSlowTargets(4000,[{valueW:4000},{valueW:4000},{valueW:4000}],{valueW:4000})');
    assert.equal(h.states.get('ems.0.Control.SelectedWallbox').val,-1);
    assert.equal(h.run('slowTargets.heatingW'),0);
    assert.equal(h.run('slowTargets.dhwW'),4000);
    assert.equal(h.run('slowTargets.wallboxW.reduce((sum,w)=>sum+w,0)'),0);
});
test('production scope fails closed without single/combined/multi commissioning',()=>{
    const cases=[
        {wb2ProductionArmed:false},
        {combinedProductionArmed:false},
        {wb0ControlEnabled:true,wb0ProductionArmed:true,multiWallboxAlphaArmed:false},
        {wb0ControlEnabled:true,wb0ProductionArmed:false,multiWallboxAlphaArmed:true},
        {globalWriteEnabled:false}
    ];
    for(const config of cases) {
        const h=productionEngine(config);
        h.run('updateSlowTargets(6000,[{valueW:6000},{valueW:6000},{valueW:6000}],{valueW:0})');
        assert.equal(h.run('slowTargets.wallboxW.reduce((sum,w)=>sum+w,0)'),0,JSON.stringify(config));
        assert.equal(h.run('slowTargets.dhwW'),0,JSON.stringify(config));
    }
});
test('disabled productive EHZ does not steal a priority wallbox budget',()=>{
    const h=productionEngine({dhwControlEnabled:false});
    h.put('ems.0.Devices.MyPV_DHW.MustHeat',true);
    h.run('updateSlowTargets(4000,[{valueW:0},{valueW:0},{valueW:4000}],{valueW:0})');
    assert.equal(h.run('slowTargets.dhwW'),0);
    assert.equal(h.run('slowTargets.wallboxA[2]'),6);
});
test('unowned stale active flag cannot override the configured priority',()=>{
    const h=engine({wallboxPriority:1});
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('ems.0.Devices.Wallbox0.OutputOwned',false);h.run('updateVehicles()');
    assert.equal(h.run('selectRealtimeWallboxes([{valueW:0},{valueW:0},{valueW:0}])[0].wb'),1);
});
test('production ramp uses confirmed current and cannot wind up while feedback is delayed',()=>{
    const h=productionEngine({dhwControlEnabled:false});
    h.put('ems.0.Devices.Wallbox2.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox2.OutputActive',true);
    h.put('ems.0.Devices.Wallbox2.OutputCommand_A',6);
    h.put('DP_WB2_POWER',1.38);
    for(let cycle=0;cycle<5;cycle++) {
        h.run('updateSlowTargets(7000,[{valueW:0},{valueW:0},{valueW:7000}],{valueW:0})');
        assert.equal(h.run('slowTargets.wallboxA[2]'),12);
    }
});
test('elapsed productive start countdown stays latched while EHZ handoff is still pending',()=>{
    const h=productionEngine();h.put('ems.0.Config.WallboxStartDelay_s',120);
    h.run('wallboxStartCandidateSince[2]=Date.now()-121000');
    for(let cycle=0;cycle<5;cycle++) {
        h.run('updateSlowTargets(6000,[{valueW:0},{valueW:0},{valueW:6000}],{valueW:0})');
        assert.equal(h.run('slowTargets.wallboxA[2]'),6);
        assert.equal(h.states.get('ems.0.Vehicles.Wallbox2.StartDelayActive').val,false);
    }
    h.run('updateSlowTargets(500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('wallboxStartCandidateSince[2]'),0,'real shortage must reset the ready latch');
});

function sequenceResumeFixture() {
    const h=productionEngine({dhwControlEnabled:false});
    const startedAt=Date.now();
    h.ctx.resumeNow=startedAt;
    const state=(suffix,value)=>h.states.set(suffix,{val:value,ts:h.ctx.resumeNow,ack:true});
    const advance=milliseconds=>{
        h.ctx.resumeNow+=milliseconds;
        state('DP_WB2_CAR',2);state('DP_WB2_SOC',50);
    };
    h.put('ems.0.Control.Enabled',true);
    h.put('ems.0.System.DataValid',true);h.put('ems.0.Plan.Valid',true);
    h.put('ems.0.Config.WallboxStartDelay_s',120);
    h.put('ems.0.Config.WallboxStartReserve_W',300);
    state('ems.0.Devices.Wallbox2.OutputOwned',true);
    state('ems.0.Devices.Wallbox2.OutputActive',true);
    state('ems.0.Devices.Wallbox2.OutputCommand_A',6);
    state('ems.0.Devices.Wallbox2.SequenceResumePending',false);
    state('ems.0.Devices.Wallbox2.SequenceResumeUntil',0);
    h.run('resumeVehicle=vehicleState(2)');
    const cycle=(watts=2000,cap=7360,price=false,phases=1,valid=true,selected=true)=>h.run(
        `stabilizedWallboxPower(2,${watts},resumeVehicle,0,${phases},resumeNow,${cap},${price},`+
        `{selected:${selected},valid:${valid}})`);
    const stop=()=>{
        state('ems.0.Devices.Wallbox2.OutputActive',false);
        state('ems.0.Devices.Wallbox2.SequenceResumePending',true);
        state('ems.0.Devices.Wallbox2.SequenceResumeUntil',h.ctx.resumeNow+65000);
    };
    const diagnostic=()=>h.run('wallboxStartDiagnostics[2]');
    return {...h,state,advance,cycle,stop,diagnostic};
}

test('same selected owned charge resumes without another start delay after a bounded peer interlock',()=>{
    const h=sequenceResumeFixture();
    assert.equal(h.cycle(),2000,'the engine must first observe the active owned output');
    h.advance(5000);h.stop();
    assert.equal(h.cycle(1400),1400,'prepared continuation needs the real minimum, not a new start reserve');
    assert.equal(h.diagnostic().reason,'prepared-sequence-resume');
    assert.equal(h.diagnostic().sequenceResume.eligible,true);
    assert.equal(h.run('wallboxStartCandidateSince[2]'),0);
    h.advance(5000);
    assert.equal(h.cycle(1600),1600);
    assert.equal(h.diagnostic().sequenceResume.remainingS,60);
    assert.equal(h.states.get('ems.0.Devices.Wallbox2.OutputActive').val,false,
        'a prepared target does not claim a physical start or acknowledge OFF');
});

test('a resume token without prior owned active evidence never skips initial qualification',()=>{
    for(const cause of ['unobserved','not-owned','virtual-only']) {
        const h=sequenceResumeFixture();
        if(cause==='not-owned')h.state('ems.0.Devices.Wallbox2.OutputOwned',false);
        if(cause==='virtual-only')h.state('ems.0.Devices.Wallbox2.OutputActive',false);
        if(cause!=='unobserved')h.cycle();
        h.advance(5000);h.stop();
        assert.equal(h.cycle(),0,cause);
        assert.equal(h.diagnostic().sequenceResume.eligible,false,cause);
        assert.equal(h.diagnostic().reason,'start-delay',cause);
    }
});

test('budget or hard cap loss revokes resume until a new observed active edge',()=>{
    for(const capLoss of [false,true]) {
        const h=sequenceResumeFixture();h.cycle();h.advance(5000);h.stop();
        assert.ok(h.cycle()>0);
        h.advance(5000);
        assert.equal(capLoss?h.cycle(2000,1000):h.cycle(1000),0);
        assert.equal(h.diagnostic().sequenceResume.qualified,false);
        h.advance(5000);
        assert.equal(h.cycle(),0,'a still-true token cannot replenish revoked readiness');
        assert.equal(h.diagnostic().reason,'start-delay');
        h.state('ems.0.Devices.Wallbox2.SequenceResumePending',false);
        h.state('ems.0.Devices.Wallbox2.OutputActive',true);
        h.state('ems.0.Devices.Wallbox2.OutputOwned',true);
        assert.ok(h.cycle()>0);
        h.advance(5000);h.stop();
        assert.ok(h.cycle()>0,'a newly observed active sequence can qualify a later continuation');
    }
});

test('ineligible vehicle, invalid data, phase or price changes cannot retain resume qualification',()=>{
    for(const cause of ['selection','release','disconnect','soc','target','car-quality',
        'output-quality','fault','data','phase','price','price-session']) {
        const h=sequenceResumeFixture();h.cycle(2000,7360,cause==='price');
        h.advance(5000);h.stop();
        if(cause==='release')h.ctx.resumeVehicle.release=false;
        if(cause==='disconnect')h.ctx.resumeVehicle.connected=false;
        if(cause==='soc')h.ctx.resumeVehicle.socValid=false;
        if(cause==='target')h.state('DP_WB2_SOC',80);
        if(cause==='car-quality')h.states.get('DP_WB2_CAR').q=64;
        if(cause==='output-quality')h.states.get('ems.0.Devices.Wallbox2.OutputActive').ack=false;
        if(cause==='fault')h.state('ems.0.Devices.Wallbox2.OutputFault','Kommunikationsfehler');
        if(cause==='price-session')h.ctx.resumeVehicle.priceSessionId='new-plug-session';
        if(cause==='phase'){
            h.ctx.resumeVehicle.phaseSwitchEnabled=true;h.ctx.resumeVehicle.maximumPhases=3;
        }
        const result=h.cycle(cause==='phase'?5000:2000,7360,false,cause==='phase'?3:1,
            cause!=='data',cause!=='selection');
        assert.equal(result,0,cause);
        assert.equal(h.diagnostic().sequenceResume.eligible,false,cause);
        assert.equal(h.diagnostic().sequenceResume.qualified,false,cause);
    }
});

test('resume expires on a missed observation, fixed deadline or restart and cannot be extended',()=>{
    for(const cause of ['gap','expiry','extension','reset']) {
        const h=sequenceResumeFixture();h.cycle();h.advance(5000);h.stop();
        assert.ok(h.cycle()>0);
        if(cause==='gap')h.advance(10000);
        if(cause==='expiry') {
            for(let tick=0;tick<12;tick++){h.advance(5000);assert.ok(h.cycle()>0);}
            h.advance(5000);
        }
        if(cause==='extension') {
            h.advance(5000);
            h.state('ems.0.Devices.Wallbox2.SequenceResumeUntil',h.ctx.resumeNow+65000);
        }
        if(cause==='reset')h.run('resetSlowTargets()');
        assert.equal(h.cycle(),0,cause);
        assert.equal(h.diagnostic().sequenceResume.eligible,false,cause);
        assert.equal(h.diagnostic().sequenceResume.qualified,false,cause);
    }
});

test('allocator does not mistake a stopped peer-interlocked virtual target for running output',()=>{
    for(const token of ['unqualified','expired','cleared']) {
        const h=productionEngine({dhwControlEnabled:false});
        h.put('ems.0.Config.WallboxStartDelay_s',120);
        h.put('ems.0.Devices.Wallbox2.OutputOwned',true);
        h.put('ems.0.Devices.Wallbox2.OutputActive',false);
        h.put('ems.0.Devices.Wallbox2.SequenceResumePending',token!=='cleared');
        h.put('ems.0.Devices.Wallbox2.SequenceResumeUntil',token==='expired'?Date.now()-1:Date.now()+65000);
        h.run('slowTargets.wallboxA[2]=6');
        h.run('updateSlowTargets(4000,[{valueW:0},{valueW:0},{valueW:4000}],{valueW:0})');
        assert.equal(h.run('slowTargets.wallboxA[2]'),0,token);
        const diag=JSON.parse(h.states.get('ems.0.Control.Wallbox2.AllocationDiagnostics_JSON').val);
        assert.equal(diag.start.sequenceResume.eligible,false,token);
        assert.equal(diag.start.reason,'start-delay',token);
    }
});

test('feedback compensation cannot exceed binding nominal LPC wattage',()=>{
    const h=productionEngine({dhwControlEnabled:false});
    h.put('ems.0.Devices.Wallbox2.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox2.OutputActive',true);
    h.put('ems.0.Devices.Wallbox2.OutputCommand_A',20);
    h.put('DP_WB2_POWER',2.3);
    h.run('updateSlowTargets(7000,[{valueW:0},{valueW:0},{valueW:7000}],{valueW:0},4200)');
    assert.ok(h.run('slowTargets.wallboxW[2]')<=4200);
    assert.equal(h.run('slowTargets.wallboxA[2]'),18);
});
test('productive common LPC cap includes EHZ and the next WB current command',()=>{
    const h=productionEngine();h.put('DP_DHW_PARALLEL_RELEASE',true);
    h.put('ems.0.Devices.Wallbox2.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox2.OutputActive',true);
    h.put('ems.0.Devices.Wallbox2.OutputCommand_A',6);
    h.put('DP_WB2_POWER',1.38);
    h.run('updateSlowTargets(9000,[{valueW:0},{valueW:0},{valueW:9000}],{valueW:0},4200)');
    assert.ok(h.run('slowTargets.wallboxW[2]+slowTargets.dhwW')<=4200);
    assert.ok(h.run('slowTargets.wallboxExpectedW[2]+slowTargets.dhwW')<=4200);
    assert.equal(h.run('slowTargets.wallboxA[2]'),7);
    assert.equal(h.run('slowTargets.dhwW'),2590);
});
test('productive soft shortfall remains visible to stop timer and reserves held current for EHZ',()=>{
    const h=productionEngine();
    h.put('ems.0.Config.WallboxMinimumRunTime_s',600);
    h.put('ems.0.Devices.Wallbox2.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox2.OutputActive',true);
    h.put('ems.0.Devices.Wallbox2.OutputCommand_A',6);
    h.put('ems.0.Devices.Wallbox2.OutputPhases',1);
    h.put('DP_WB2_POWER',1.38);
    h.run('updateSlowTargets(500,[{valueW:0},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.run('slowTargets.wallboxA[2]'),0,'output controller owns actual 6 A hold');
    assert.equal(h.run('slowTargets.wallboxExpectedW[2]'),1380);
    assert.equal(h.run('slowTargets.dhwW'),0);
    assert.equal(h.states.get('ems.0.Vehicles.Wallbox2.MinimumRunTimeActive').val,true);
    assert.equal(h.states.get('ems.0.Control.SelectedWallbox').val,2);
});
test('next car waits for owned stopping car and EHZ only receives unused residual',()=>{
    const h=productionEngine({wb0ControlEnabled:true,wb0ProductionArmed:true,multiWallboxAlphaArmed:true});
    h.put('ems.0.Devices.Wallbox2.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox2.OutputActive',false);
    h.put('DP_WB2_POWER',1.38);h.put('DP_WB2_SOC',80);h.run('updateVehicles()');
    h.run('updateSlowTargets(4000,[{valueW:4000},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.states.get('ems.0.Control.SelectedWallbox').val,-1);
    assert.equal(h.run('slowTargets.wallboxExpectedW[2]'),1380);
    assert.equal(h.run('slowTargets.dhwW'),2620);
    h.put('ems.0.Devices.Wallbox2.OutputOwned',false);h.put('DP_WB2_POWER',0);
    h.run('updateSlowTargets(4000,[{valueW:4000},{valueW:0},{valueW:0}],{valueW:0})');
    assert.equal(h.states.get('ems.0.Control.SelectedWallbox').val,0);
    assert.equal(h.run('slowTargets.wallboxA[0]'),6);
});
test('parallel thresholds use stable requested phase mode, not unadopted plan recommendation',()=>{
    const h=engine({wb2PhaseControlMode:'ems',phaseSwitchMinHoldMin:30});
    h.put('ems.0.Devices.Wallbox0.Present',false);h.put('ems.0.Devices.Wallbox1.Present',false);
    h.put('ems.0.Vehicles.Wallbox2.PhaseSwitchEnabled',true);
    h.put('ems.0.Vehicles.Wallbox2.MaximumPhases',3);
    h.put('ems.0.Devices.MyPV_DHW.Release',true);
    h.put('ems.0.Devices.MyPV_DHW.TemperaturePowerLimit_W',9000);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);h.put('DP_DHW_PARALLEL_RELEASE',1);
    h.run('simulateDhwTarget=valueW=>valueW;updateVehicles();stableWallboxPhases[2]=3;lastPhaseChangeAt[2]=Date.now()');
    h.run('updateSlowTargets(6000,[{valueW:0},{valueW:0},{valueW:6000,phases:1}],{valueW:0})');
    assert.equal(h.run('realtimeParallelActive'),false);
    assert.match(h.states.get('ems.0.Control.ParallelDistributionThresholds').val,/3-phasig/);
});
test('productive uncontrolled loads are not reconstructed as reclaimable PV surplus',()=>{
    const h=productionEngine({wb2ControlEnabled:false});
    h.run("CFG.dp.par14a='';CFG.dp.lpcState='';CFG.dp.lpcLimit='';CFG.dp.haCritical='' ");
    h.put('ems.0.System.DataValid',true);h.put('ems.0.Plan.Valid',true);
    h.put('ems.0.Actual.GridPower_W',-2000);
    h.put('DP_GRID_IMPORT',0);h.put('DP_GRID_EXPORT',2000);
    h.put('ems.0.Actual.MyPV_DHW_W',0);h.put('ems.0.Actual.MyPV_Heating_W',1000);
    for(const phase of [1,2,3])h.put(`DP_DHW_OUTPUT${phase}`,0);
    h.put('DP_WB0_POWER',3);h.put('DP_BATTERY_POWER',2400);
    const slot=JSON.stringify([{timestamp:Date.now()-1000,valueW:3000}]);
    for(const name of ['BatteryPower','MyPV_DHW','MyPV_Heating','Wallbox0','Wallbox1','Wallbox2'])
        h.put(`ems.0.Plan.${name}_48h_JSON`,slot);
    h.run('realtimeControl()');
    assert.equal(h.states.get('ems.0.Control.Targets.MyPV_DHW_W').val,1900);
    assert.equal(h.states.get('ems.0.Control.Targets.Battery_W').val,0);
    assert.equal(h.states.get('ems.0.Control.Targets.MyPV_Heating_W').val,0);
});
test('reaching minimum SoC ends mandatory import despite retained legacy socfrei two',()=>{
    const h=engine();h.put('DP_WB2_RELEASE',2);h.put('DP_WB2_MIN_SOC',30);
    h.put('DP_WB2_SOC',29);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(2).mustCharge'),true);
    assert.equal(h.run('vehicleState(2).minCurrent1pA'),16);
    h.put('DP_WB2_SOC',30);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(2).mustCharge'),false);
    assert.equal(h.run('vehicleState(2).release'),true);
    assert.equal(h.run('vehicleState(2).minCurrent1pA'),6);
    assert.match(h.run('vehicleState(2).status'),/PV-flexibel/);
    h.put('DP_WB2_AMIN',12);h.run('updateVehicles()');
    assert.equal(h.run('vehicleState(2).mustCharge'),true,'explicit manual minimum is still authoritative');
});
