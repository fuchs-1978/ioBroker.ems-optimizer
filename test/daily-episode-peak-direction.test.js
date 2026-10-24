'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const e=require('../lib/daily-episodes');
const start=1000000;
function period(){return {from:start,to:start+86400000,observedUntil:start+86400000};}
function observe(p,i,grid,target=50){e.observe(p,start+i*5000,start+(i+1)*5000,
    {grid},{grid},['grid'],{targetGridW:target},target);}
function sustained(grid,target=50){const p=period();for(let i=0;i<12;i++)observe(p,i,grid,target);return p;}
test('positive grid deviation preserves real grid, target and signed deviation at its peak',()=>{
    const p=sustained(1200),w=e.windows(p).find(x=>x.type==='deviation');
    assert.equal(w.peakW,1150);assert.equal(w.gridAtPeakW,1200);
    assert.equal(w.targetAtPeakW,50);assert.equal(w.signedDeviationAtPeakW,1150);
    assert.equal(w.estimatedMagnitudeWh,1150/60);
});
test('export and deviation do not turn negative grid power into positive import',()=>{
    const p=sustained(-800);for(const w of e.windows(p)){
        assert.equal(w.gridAtPeakW,-800);assert.equal(w.targetAtPeakW,50);
        assert.equal(w.signedDeviationAtPeakW,-850);
    }
});
test('new largest peak carries its own signed grid and target; equal peaks keep first provenance',()=>{
    const p=sustained(700);observe(p,12,-1000,-50);observe(p,13,900,-50);
    const w=e.windows(p).find(x=>x.type==='deviation');
    assert.equal(w.gridAtPeakW,-1000);assert.equal(w.targetAtPeakW,-50);
    assert.equal(w.signedDeviationAtPeakW,-950);assert.equal(w.peakAt,start+60000);
});
test('old checkpoint peaks remain unknown without changing old records or inventing a sign',()=>{
    const p=sustained(1200);e.interrupt(p,'restart');
    for(const x of p.investigation.closed)for(const k of ['gridAtPeakW','targetAtPeakW','signedDeviationAtPeakW'])delete x[k];
    const before=JSON.stringify(p.investigation);
    assert.equal(e.valid(p.investigation,p),true);
    const w=e.windows(p).find(x=>x.type==='deviation');
    assert.equal(w.gridAtPeakW,null);assert.equal(w.targetAtPeakW,null);
    assert.equal(w.signedDeviationAtPeakW,null);assert.equal(JSON.stringify(p.investigation),before);
});
test('persisted optional peak provenance rejects nonfinite, partial and inconsistent data',()=>{
    for(const bad of [{gridAtPeakW:NaN},{gridAtPeakW:1200},
        {gridAtPeakW:1200,targetAtPeakW:50,signedDeviationAtPeakW:-1150}]){
        const p=sustained(1200);e.interrupt(p,'restart');
        const x=p.investigation.closed.find(x=>x.type==='deviation');
        for(const k of ['gridAtPeakW','targetAtPeakW','signedDeviationAtPeakW'])delete x[k];
        Object.assign(x,bad);assert.equal(e.valid(p.investigation,p),false);
    }
});
