'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {HeaterWriteProof} = require('../lib/heater-write-proof');
const id = 'modbus.4.holdingRegisters.1000_Power';
const object = {type:'state',common:{type:'number',write:true,read:false},native:{poll:false,regType:'holdingRegs'}};

function harness() {
    let now=1000;
    const p=new HeaterWriteProof('ems.0',()=>now);p.configure(id,object);
    const command={val:0,ack:false,q:0,ts:1000,from:'system.adapter.ems.0'};
    const ack={val:null,ack:true,q:0,ts:1001,from:'system.adapter.modbus.4'};
    return {p,command,ack,advance:()=>now=1001};
}

test('write-only reset receipt requires a current own command and the correct adapter reset',()=>{
    const h=harness();h.p.begin(id,0);h.p.observe(id,h.command);h.advance();h.p.observe(id,h.ack);
    assert.equal(h.p.zeroProof(id,h.ack).kind,'write-only-modbus-reset');
    assert.equal(h.p.zeroProof(id,{...h.ack,ts:1002}),null);
});

for(const scenario of ['no command event','foreign writer','wrong value','wrong ACK origin','undefined','bad q','no ACK','old ACK','future ACK','overlap','transport failure','metadata change','restart','unexplained later reset']) {
    test(`ambiguous write-only receipt never proves zero: ${scenario}`,()=>{
        const h=harness();const token=h.p.begin(id,0);
        if(scenario!=='no command event')h.p.observe(id,{...h.command,
            ...(scenario==='foreign writer'?{from:'system.adapter.javascript.0'}:{}),
            ...(scenario==='wrong value'?{val:3000}:{})});
        if(scenario==='overlap')h.p.begin(id,0);
        h.advance();
        const ack={...h.ack,...(scenario==='wrong ACK origin'?{from:'system.adapter.other.0'}:{}),
            ...(scenario==='undefined'?{val:undefined}:{}),...(scenario==='bad q'?{q:64}:{}),
            ...(scenario==='no ACK'?{ack:false}:{}),...(scenario==='old ACK'?{ts:1000}:{}),
            ...(scenario==='future ACK'?{ts:1002}:{})};
        h.p.observe(id,ack);
        if(scenario==='transport failure')h.p.transportFailed(id,token);
        if(scenario==='metadata change')h.p.invalidate(id);
        if(scenario==='restart'){h.p.invalidate(id);h.p.configure(id,object);}
        if(scenario==='unexplained later reset')h.p.observe(id,{...ack,ts:1000});
        assert.equal(h.p.zeroProof(id,ack),null);
    });
}

test('a positive command receipt is never a zero proof',()=>{
    const h=harness();h.p.begin(id,3000);h.p.observe(id,{...h.command,val:3000});
    h.advance();h.p.observe(id,h.ack);assert.equal(h.p.zeroProof(id,h.ack),null);
});

test('metadata revalidation cannot clear uncertainty from an unresolved command',()=>{
    const h=harness();h.p.begin(id,3000);h.p.observe(id,{...h.command,val:3000});
    h.p.invalidate(id);h.p.configure(id,object);
    h.p.begin(id,0);h.p.observe(id,h.command);h.advance();h.p.observe(id,h.ack);
    assert.equal(h.p.zeroProof(id,h.ack),null);
});

test('delayed positive ACK while a zero overlaps cannot masquerade as a zero receipt',()=>{
    const h=harness();h.p.begin(id,3000);h.p.observe(id,{...h.command,val:3000});
    h.p.begin(id,0);h.p.observe(id,h.command);h.advance();h.p.observe(id,h.ack);
    assert.equal(h.p.zeroProof(id,h.ack),null);
});

for(const change of [{common:{...object.common,read:true}},{native:{...object.native,poll:true}},
    {common:{...object.common,write:false}},{native:{...object.native,regType:'inputRegs'}}]) {
    test(`only verified write-only holding-register metadata enables receipts: ${JSON.stringify(change)}`,()=>{
        const h=harness();h.p.configure(id,{...object,...change});assert.equal(h.p.begin(id,0),null);
    });
}
