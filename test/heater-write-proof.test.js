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
    return {p,command,ack,advance:(ms=1)=>now+=ms,now:()=>now};
}

test('write-only reset receipt requires a current own command and the correct adapter reset',()=>{
    const h=harness();const token=h.p.begin(id,0);h.p.observe(id,h.command);h.advance();h.p.observe(id,h.ack);
    h.p.transportCompleted(id,token);
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
        h.p.transportCompleted(id,token);
        if(scenario==='transport failure')h.p.transportFailed(id,token);
        if(scenario==='metadata change')h.p.invalidate(id);
        if(scenario==='restart'){h.p.invalidate(id);h.p.configure(id,object);}
        if(scenario==='unexplained later reset')h.p.observe(id,{...ack,ts:1000});
        assert.equal(h.p.zeroProof(id,ack),null);
    });
}

test('a positive command receipt is never a zero proof',()=>{
    const h=harness();const token=h.p.begin(id,3000);h.p.observe(id,{...h.command,val:3000});
    h.advance();h.p.observe(id,h.ack);h.p.transportCompleted(id,token);
    assert.equal(h.p.zeroProof(id,h.ack),null);
});

test('metadata revalidation cannot clear uncertainty from an unresolved command',()=>{
    const h=harness();h.p.begin(id,3000);h.p.observe(id,{...h.command,val:3000});
    h.p.invalidate(id);h.p.configure(id,object);
    const token=h.p.begin(id,0);h.p.observe(id,h.command);h.advance();h.p.observe(id,h.ack);
    h.p.transportCompleted(id,token);
    assert.equal(h.p.zeroProof(id,h.ack),null);
});

test('delayed positive ACK while a zero overlaps cannot masquerade as a zero receipt',()=>{
    const h=harness();h.p.begin(id,3000);h.p.observe(id,{...h.command,val:3000});
    const token=h.p.begin(id,0);h.p.observe(id,h.command);h.advance();h.p.observe(id,h.ack);
    h.p.transportCompleted(id,token);
    assert.equal(h.p.zeroProof(id,h.ack),null);
});

for(const change of [{common:{...object.common,read:true}},{native:{...object.native,poll:true}},
    {common:{...object.common,write:false}},{native:{...object.native,regType:'inputRegs'}}]) {
    test(`only verified write-only holding-register metadata enables receipts: ${JSON.stringify(change)}`,()=>{
        const h=harness();h.p.configure(id,{...object,...change});assert.equal(h.p.begin(id,0),null);
    });
}

function complete(h,watts=0) {
    const token=h.p.begin(id,watts);
    h.p.observe(id,{...h.command,val:watts,ts:h.now()});
    h.advance();
    const ack={...h.ack,ts:h.now()};
    h.p.observe(id,ack);h.p.transportCompleted(id,token);
    return ack;
}

for(const order of ['reset first','transport first']) {
    test(`a correlated zero requires both independent completions: ${order}`,()=>{
        const h=harness();const token=h.p.begin(id,0);h.p.observe(id,h.command);
        if(order==='reset first') {h.advance();h.p.observe(id,h.ack);}
        else h.p.transportCompleted(id,token);
        assert.equal(h.p.zeroStatus(id,h.ack).status,'pending');
        assert.equal(h.p.zeroStatus(id,h.ack).episode,null);
        assert.equal(h.p.zeroProof(id,h.ack),null);
        if(order==='reset first')h.p.transportCompleted(id,token);
        else {h.advance();h.p.observe(id,h.ack);}
        assert.equal(h.p.zeroStatus(id,h.ack).status,'ready');
        assert.equal(h.p.zeroProof(id,h.ack).sequence,token.sequence);
    });
}

test('sequential zero refreshes keep one episode while every write needs its own reset and transport',()=>{
    const h=harness();let ack=complete(h);const first=h.p.zeroStatus(id,ack);
    for(let n=0;n<5;n++) {
        h.advance(5000);const token=h.p.begin(id,0);
        h.p.observe(id,{...h.command,ts:h.now()});
        const pending=h.p.zeroStatus(id,{...h.command,ts:h.now()});
        assert.equal(pending.status,'pending');
        assert.deepEqual(pending.episode,first.episode);
        assert.equal(pending.receipt.sequence,token.sequence-1);
        assert.equal(h.p.zeroProof(id,ack),null);
        h.advance();ack={...h.ack,ts:h.now()};h.p.observe(id,ack);
        assert.equal(h.p.zeroStatus(id,ack).status,'pending','reset alone cannot complete this refresh');
        h.p.transportCompleted(id,token);
        const current=h.p.zeroStatus(id,ack);
        assert.equal(current.status,'ready');
        assert.deepEqual(current.episode,first.episode);
        assert.equal(current.receipt.sequence,token.sequence);
        assert.equal(current.receipt.ackTs,h.now());
    }
});

test('a positive intermediate command ends the zero episode even when its later reset is NULL',()=>{
    const h=harness();const before=h.p.zeroStatus(id,complete(h)).episode;
    h.advance(5000);const positive=h.p.begin(id,2300);
    assert.equal(h.p.zeroStatus(id,h.ack).episode,null);
    h.p.observe(id,{...h.command,val:2300,ts:h.now()});h.advance();
    const ack={...h.ack,ts:h.now()};h.p.observe(id,ack);h.p.transportCompleted(id,positive);
    assert.equal(h.p.zeroProof(id,ack),null);
    h.advance(5000);const after=h.p.zeroStatus(id,complete(h));
    assert.equal(after.status,'ready');
    assert.notEqual(after.episode.sequence,before.sequence);
});

for(const firstMissing of ['reset','transport']) {
    test(`a second zero cannot hide overlap while the first ${firstMissing} is open`,()=>{
        const h=harness();complete(h);h.advance(5000);
        const token=h.p.begin(id,0);h.p.observe(id,{...h.command,ts:h.now()});
        if(firstMissing==='reset')h.p.transportCompleted(id,token);
        else {h.advance();h.p.observe(id,{...h.ack,ts:h.now()});}
        h.advance(5000);const ack=complete(h);
        const status=h.p.zeroStatus(id,ack);
        assert.equal(status.status,'blocked');
        assert.equal(status.reason,'overlapping-write');
        assert.equal(status.episode,null);
        assert.equal(h.p.zeroProof(id,ack),null);
    });
}

for(const fault of ['transport error','foreign reset','invalid quality','metadata invalidation']) {
    test(`a zero episode cannot borrow its completed proof after ${fault}`,()=>{
        const h=harness();complete(h);h.advance(5000);
        const token=h.p.begin(id,0);h.p.observe(id,{...h.command,ts:h.now()});h.advance();
        const ack={...h.ack,ts:h.now()};
        if(fault==='transport error') {h.p.observe(id,ack);h.p.transportFailed(id,token);}
        if(fault==='foreign reset')h.p.observe(id,{...ack,from:'system.adapter.javascript.0'});
        if(fault==='invalid quality')h.p.observe(id,{...ack,q:64});
        if(fault==='metadata invalidation')h.p.invalidate(id);
        h.p.configure(id,object);h.advance(5000);const later=complete(h);
        assert.equal(h.p.zeroStatus(id,later).status,'blocked');
        assert.equal(h.p.zeroStatus(id,later).episode,null);
        assert.equal(h.p.zeroProof(id,later),null);
    });
}
