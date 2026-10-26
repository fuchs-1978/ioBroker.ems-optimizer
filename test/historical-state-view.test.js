'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {historicalStateView}=require('../tools/historical-state-view');

test('historical projection keeps all existing control, reservation, source and command evidence',()=>{
    const command={kind:'command',id:'go-e.2.allow_charging',val:0,at:123};
    const reservation={kind:'state',id:'ems.0.Devices.Wallbox2.OutputReservedPower_W',state:{val:1380,ack:true,ts:123}};
    const report={kind:'state',id:'ems.0.Vehicles.Wallbox0.SoC_pct',state:{val:84,ack:true,ts:123}};
    const quality={kind:'state',id:'ems.0.Vehicles.Wallbox0.SoCValid',state:{val:true,ack:true,ts:123}};
    const trace=[command,reservation,report,quality,{kind:'checkpoint',device:{owned:true,pending:null},
        states:[[reservation.id,reservation.state],[report.id,report.state]]},Buffer.from([0,255,3])];
    assert.deepEqual(historicalStateView(trace),trace);
    assert.notDeepEqual(historicalStateView([{...command,val:1}]),[command]);
    assert.notDeepEqual(historicalStateView([{...reservation,state:{...reservation.state,val:0}}]),[reservation]);
});

test('historical projection omits only enumerated new diagnostic states and private observation fields',()=>{
    const old=['ems.0.Devices.Wallbox2.OutputActive',{val:false}];
    const added=['ems.0.Devices.Wallbox2.NoDrawElapsed_s',{val:899}];
    const sample={kind:'checkpoint',states:[old,added],device:{owned:true,noDrawObservation:{since:1},noDrawPauseLoaded:true}};
    assert.deepEqual(historicalStateView(sample),{kind:'checkpoint',states:[old],device:{owned:true}});
    assert.equal(historicalStateView({kind:'state',id:added[0],state:added[1]}),undefined);
    const foreign={kind:'state',id:'go-e.2.NoDrawElapsed_s',state:{val:123}};
    assert.deepEqual(historicalStateView(foreign),foreign);
});
