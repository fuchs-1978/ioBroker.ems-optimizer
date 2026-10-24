'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const e = require('../lib/daily-episodes');
const start = 1000000;
function frame() { return {from: start, to: start + 86400000, observedUntil: start + 86400000}; }
function tick(p, i, grid = -800, extra = {}) {
    const v = {grid, ...extra};
    e.observe(p, start + i * 5000, start + (i + 1) * 5000, v, v, Object.keys(v),
        {master: true, selectedWallbox: 1, targetGridW: 50}, 50);
}
test('short spikes do not create qualified windows; sustained export preserves time and magnitude', () => {
    const p = frame(); for (let i = 0; i < 11; i++) tick(p, i);
    assert.equal(e.windows(p).length, 0);
    tick(p, 11); const w = e.windows(p).find(x => x.type === 'export');
    assert.equal(w.from, start); assert.equal(w.to, start + 60000); assert.equal(w.durationMs, 60000);
    assert.equal(w.peakW, 800); assert.equal(w.meanMagnitudeW, 800);
    assert.equal(w.estimatedMagnitudeWh, 800 / 60); assert.equal(w.endReason, 'ongoing');
    tick(p, 12, 50); assert.equal(e.windows(p).find(x => x.type === 'export').endReason, 'threshold-ended');
});
test('deviation uses actual target; unknown target is never silently zero', () => {
    const p = frame(); for (let i = 0; i < 12; i++) tick(p, i, 550);
    assert.equal(e.windows(p).length, 0);
    for (let i = 12; i < 24; i++) tick(p, i, 551);
    assert.equal(e.windows(p)[0].type, 'deviation');
    const q = frame(); for (let i = 0; i < 12; i++) e.observe(q, start+i*5000, start+(i+1)*5000,
        {grid: 2000}, {grid:2000}, ['grid'], {}, null);
    assert.equal(e.windows(q).length, 0);
});
test('source gaps keep exact boundaries, do not invent watts and ignore unconfigured sources', () => {
    const p = frame(); for (let i = 0; i < 6; i++) tick(p, i, null);
    const w = e.windows(p)[0]; assert.equal(w.type, 'source-gap'); assert.equal(w.durationMs,30000);
    assert.equal(w.estimatedMagnitudeWh, null); assert.equal(w.meanMagnitudeW, null);
    assert.ok(!e.windows(p).some(x => x.source === 'bhkw'));
    tick(p, 6, 50); assert.equal(e.windows(p)[0].endReason, 'valid-again');
});
test('unknown gaps and restarts end episodes without joining unobserved intervals', () => {
    const p = frame(); for (let i = 0; i < 12; i++) tick(p,i);
    e.gap(p,start+60000,start+120000,{});
    assert.equal(p.investigation.closed.find(x=>x.type==='export').to,start+60000);
    assert.equal(e.windows(p).find(x=>x.type==='sampling-gap').durationMs,60000);
    for (let i = 24; i < 36; i++) tick(p,i);
    e.interrupt(p,'restart'); assert.equal(Object.keys(p.investigation.active).length,0);
    assert.equal(p.investigation.closed.filter(x=>x.type==='export').length,2);
});
test('long episode recommends bounded window around peak, not entire episode', () => {
    const p = frame(); for(let i=0;i<1000;i++) tick(p,i,i===500?-1500:-800);
    const w=e.windows(p).find(x=>x.type==='export');
    assert.equal(w.peakAt,start+2500000); assert.equal(w.suggestedTo-w.suggestedFrom,120000);
    assert.equal(w.durationMs,5000000);
});
test('closed episodes remain bounded with explicit overflow and checkpoint validation', () => {
    const p=frame(); for(let j=0;j<40;j++) {
        for(let i=0;i<12;i++) tick(p,j*13+i); tick(p,j*13+12,50);
    }
    assert.ok(p.investigation.closed.length<=24); assert.ok(p.investigation.overflow>0);
    assert.equal(e.valid(p.investigation,p),true);
    p.investigation.active={bad:{}}; assert.equal(e.valid(p.investigation,p),false);
});
function episode(p, type, i, watts=0) {
    const at=start+i*1000;
    e.ensure(p,at).closed.push({type,source:type.includes('gap')?'all':'grid',from:at,to:at+60000,
        durationMs:60000,minimumMs:30000,peakW:watts,peakAt:at,magnitudeWms:watts*60000});
    e.retain(p);
}
test('many strong import deviations cannot evict weaker export or quality-gap cases',()=>{
    const p=frame();episode(p,'export',0,250);episode(p,'source-gap',1);episode(p,'sampling-gap',2);
    for(let i=3;i<100;i++) episode(p,'deviation',i,7000);
    assert.ok(p.investigation.closed.some(x=>x.type==='export'));
    assert.ok(p.investigation.closed.some(x=>x.type==='source-gap'));
    assert.ok(p.investigation.closed.some(x=>x.type==='sampling-gap'));
    assert.ok(p.investigation.closed.length<=24);
    assert.ok(p.investigation.retention.droppedByType.deviation>0);
    assert.equal(p.investigation.retention.droppedByType.export,0);
});
test('all categories stay bounded, retain strongest in category, and account each discard',()=>{
    const p=frame();for(let i=0;i<40;i++) for(const type of Object.keys(e.RETENTION)) episode(p,type,i,i+1);
    assert.equal(p.investigation.closed.length,24);
    for(const [type,limit] of Object.entries(e.RETENTION)) {
        const items=p.investigation.closed.filter(x=>x.type===type);
        assert.equal(items.length,limit);assert.ok(items.some(x=>x.peakW===40));
        assert.equal(p.investigation.retention.droppedByType[type],40-limit);
    }
    assert.equal(p.investigation.overflow,160-24);
});
test('legacy checkpoint migration preserves unknown historical overflow and existing export',()=>{
    const p=frame();const d=e.ensure(p,start);delete d.retention;d.overflow=7;
    for(let i=0;i<23;i++) d.closed.push({type:'deviation',from:start,to:start+60000,durationMs:60000,magnitudeWms:10000000});
    d.closed.push({type:'export',from:start,to:start+60000,durationMs:60000,magnitudeWms:100});
    e.retain(p);
    assert.equal(d.retention.overflowBeforeRetention,7);
    assert.equal(d.retention.droppedByType.deviation,15);
    assert.equal(d.overflow,22);assert.ok(d.closed.some(x=>x.type==='export'));
});
test('byte-pressure trimming removes ordinary deviation before export across both periods',()=>{
    const prior=frame(),current=frame();episode(prior,'export',0,250);episode(current,'deviation',1,7000);
    assert.equal(e.dropForSize([prior,current]),true);
    assert.equal(prior.investigation.closed.length,1);assert.equal(current.investigation.closed.length,0);
    assert.equal(current.investigation.retention.droppedByType.deviation,1);
});
