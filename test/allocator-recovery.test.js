'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recoveringOwnPowerAllocation}=require('../lib/wallbox-telemetry-bridge');
function fixture() {
    const now=100000, a={schema:1,valid:false,timestamp:99000,
        sourceDiagnostics:[{id:'power0',reason:'source-stale',ack:true,q:0,ts:65000,maximumAgeMs:30000}]};
    const state={ack:true,q:0,ts:99000,val:''};
    const o={parallelEnabled:()=>true,adapter:{namespace:'ems.0',config:{slowCycleS:5}},state:()=>state};
    return {now,a,state,o,run(){state.val=JSON.stringify(a);return recoveringOwnPowerAllocation(o,{wb:0},{DP_WB0_POWER:'power0'},now);}};
}
test('only recent own-power age rejection qualifies as allocator recovery',()=>{
    const h=fixture();assert.equal(h.run(),true);
});
for(const [name,change] of [
    ['expired grant',h=>h.a.timestamp=80000],['future grant',h=>h.a.timestamp=100001],
    ['missing diagnostics',h=>h.a.sourceDiagnostics=[]],['different source',h=>h.a.sourceDiagnostics[0].id='peerPower'],
    ['bad quality',h=>h.a.sourceDiagnostics[0].q=64],['unacknowledged',h=>h.a.sourceDiagnostics[0].ack=false],
    ['not stale',h=>h.a.sourceDiagnostics[0].ts=90000],['non-age failure',h=>h.a.sourceDiagnostics[0].reason='source-quality'],
    ['mixed failure',h=>h.a.sourceDiagnostics.push({id:'grid',reason:'source-stale'})],
    ['invalid state',h=>h.state.ack=false]
]) test(`allocator recovery rejects ${name}`,()=>{const h=fixture();change(h);assert.equal(h.run(),false);});
