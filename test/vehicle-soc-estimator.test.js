'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {estimateSoc} = require('../lib/vehicle-soc-estimator');
const T = 1800000000000;
const state = (val, ts = T) => ({val, ts, ack: true, q: 0});
function harness(extra = {}) {
    let input = {now: T, reported: state(40), counter: state(10), car: state(2),
        capacityKWh: 50, efficiencyPct: 90, signature: 'vehicle-0', ...extra};
    return {run(update = {}) { input = {...input, ...update}; const result = estimateSoc(input);
        input.ledgerText = JSON.stringify(result.ledger); return result; }, input: () => input};
}
test('AC counter adds energy once, is idempotent and survives restart with the same basis', () => {
    const h = harness(); assert.equal(h.run().value, 40);
    const result = h.run({now:T+60000,counter:state(10.5,T+60000)});
    assert.equal(result.value, 40.9); assert.equal(result.estimated,true);
    assert.equal(h.run().value, 40.9);
    assert.equal(estimateSoc(h.input()).value, 40.9);
});
test('new report aligns to retained energy, including an explicitly delayed measurement', () => {
    const h = harness({measurementTimeConfigured:true,measurementTime:state(T)}); h.run();
    h.run({now:T+60000,counter:state(10.5,T+60000)});
    h.run({now:T+120000,counter:state(11,T+120000)});
    const r = h.run({now:T+180000,counter:state(11.5,T+180000),
        reported:state(41,T+180000),measurementTime:state(T+60000,T+180000)});
    assert.ok(Math.abs(r.value-42.7)<1e-10); // 40.9 agrees with reported 41; keep fractional progress
    assert.ok(Math.abs(h.run().value-42.7)<1e-10);
});
test('old cached startup report is not anchored to current energy or used to restore an estimate', () => {
    const h = harness({reported:state(40,T-300000)});
    const r = h.run();assert.equal(r.estimated,false);assert.equal(r.value,40);
    assert.equal(r.reason,'waiting-for-aligned-report');
    assert.equal(h.run({reported:state(41,T+1000),now:T+1000,counter:state(10,T+1000)}).estimated,true);
});
test('counter reset blocks the old basis until a new time-aligned vehicle report', () => {
    const h = harness();h.run();h.run({now:T+60000,counter:state(10.5,T+60000)});
    const r=h.run({now:T+120000,counter:state(0,T+120000)});
    assert.equal(r.estimated,false);assert.equal(r.ledger.basis,null);
    assert.equal(h.run({now:T+180000,counter:state(.5,T+180000)}).estimated,false);
    assert.equal(h.run({now:T+240000,counter:state(1,T+240000),reported:state(42,T+240000)}).value,42);
});
test('disconnect, reconnection during an unseen interval and source/config changes require a new basis', () => {
    for(const update of [{car:state(1,T+60000)},
        {car:{...state(2,T+60000),lc:T+60000}}, {signature:'different-car'}]) {
        const h=harness();h.run();
        const r=h.run({now:T+120000,counter:state(11,T+120000),...update});
        assert.equal(r.estimated,false,JSON.stringify(update));
    }
});
test('invalid settings, qualities, missing telemetry and malformed ledgers do not fabricate charge', () => {
    for(const update of [{capacityKWh:0},{efficiencyPct:99.4},{counter:state(null)},
        {counter:{...state(11),ack:false}},{counter:{...state(11),q:64}},
        {counter:state(11,T-61000)},{counter:state(11,T+2000)},
        {reported:state(null)},{reported:state(101)},{reported:{...state(40),ack:false}},
        {measurementTimeConfigured:true,measurementTime:state(null)}]) {
        const r=harness(update).run(); assert.equal(r.estimated,false,JSON.stringify(update));
    }
    const r=harness({ledgerText:'{"version":1,"basis":{}}',reported:state(40,T-300000)}).run();
    assert.equal(r.estimated,false);
});
test('counter spikes cannot become SoC, stale anchors expire and values stay bounded at 100', () => {
    const h=harness();h.run();assert.equal(h.run({now:T+1000,counter:state(15,T+1000)}).reason,'energy-jump');
    const full=harness({reported:state(99.9)});full.run();
    assert.equal(full.run({now:T+60000,counter:state(10.5,T+60000)}).value,100);
    assert.equal(full.run({now:T+7201000,counter:state(11,T+7201000)}).valid,false);
});


test('an out-of-order older vehicle measurement cannot replace a newer anchored SoC', () => {
    const h=harness({measurementTimeConfigured:true,measurementTime:state(T)});h.run();
    h.run({now:T+60000,counter:state(10.5,T+60000),reported:state(41,T+60000),
        measurementTime:state(T+60000,T+60000)});
    const r=h.run({now:T+120000,counter:state(11,T+120000),reported:state(39,T+120000),
        measurementTime:state(T,T+120000)});
    assert.ok(Math.abs(r.value-41.8)<1e-10);
    assert.equal(r.ledger.basis.soc,40.9);
});

test('rounded-consistent reports preserve fractional energy progress across polls and restart', () => {
    const h=harness({reported:state(35)});h.run();
    let r=h.run({now:T+600000,counter:state(10.2,T+600000),reported:state(35,T+600000)});
    assert.equal(r.value,35.36);
    assert.equal(h.run().value,35.36, 'repeated frame is idempotent');
    assert.equal(estimateSoc(h.input()).value,35.36, 'restart retains the fractional basis');
    r=h.run({now:T+1200000,counter:state(10.4,T+1200000),reported:state(36,T+1200000)});
    assert.ok(Math.abs(r.value-35.72)<1e-10, 'changed integer report also preserves a matching estimate');
});
test('a disagreeing report remains authoritative rather than keeping an inconsistent estimate', () => {
    const h=harness({reported:state(35)});h.run();
    const r=h.run({now:T+600000,counter:state(10.4,T+600000),reported:state(35,T+600000)});
    assert.equal(r.value,35, '35.72 rounds to 36, so a new 35 is a correction');
});
test('delayed rounded match is compared at measurement time, not current energy', () => {
    const h=harness({reported:state(35),measurementTimeConfigured:true,measurementTime:state(T)});h.run();
    h.run({now:T+600000,counter:state(10.2,T+600000)});
    const r=h.run({now:T+1200000,counter:state(10.4,T+1200000),reported:state(35,T+1200000),
        measurementTime:state(T+600000,T+1200000)});
    assert.ok(Math.abs(r.value-35.72)<1e-10);
});
test('rounding exception cannot revive a reset, expired basis or imprecise decimal report', () => {
    const reset=harness({reported:state(35)});reset.run();
    reset.run({now:T+600000,counter:state(10.2,T+600000)});
    reset.run({now:T+1200000,counter:state(0,T+1200000)});
    const fresh=reset.run({now:T+1800000,counter:state(.1,T+1800000),reported:state(35,T+1800000)});
    assert.equal(fresh.value,35);
    const old=harness({reported:state(35)});old.run();
    assert.equal(old.run({now:T+7201000,counter:state(10.2,T+7201000),reported:state(35,T+7201000)}).value,35);
    const decimal=harness({reported:state(35)});decimal.run();
    assert.equal(decimal.run({now:T+600000,counter:state(10.2,T+600000),reported:state(35.3,T+600000)}).value,35.3);
});


test('late lower arrival SoC corrects charging estimate downward and subsequent kWh count once', () => {
    const h=harness({reported:state(45)});h.run();
    assert.ok(h.run({now:T+600000,counter:state(10.5,T+600000)}).value>45);
    const corrected=h.run({now:T+1200000,counter:state(11,T+1200000),reported:state(38,T+1200000)});
    assert.equal(corrected.value,38);
    const next=h.run({now:T+1800000,counter:state(11.2,T+1800000)});
    assert.ok(Math.abs(next.value-38.36)<1e-10);
});


test('half-percent boundary follows nearest-integer rounding, not an arbitrary hold tolerance', () => {
    for(const reported of [35,36]) {
        const h=harness({reported:state(35),efficiencyPct:50});h.run();
        const r=h.run({now:T+600000,counter:state(10.5,T+600000),reported:state(reported,T+600000)});
        assert.equal(r.value,reported===36?35.5:35);
    }
});


test('a compatible report ahead of the counter poll retains progress without refreshing the anchor', () => {
    const h=harness({reported:state(35)});h.run();
    h.run({now:T+600000,counter:state(10.2,T+600000)});
    let r=h.run({now:T+605000,reported:state(35,T+605000)});
    assert.equal(r.value,35.36);assert.equal(r.estimated,true);
    assert.equal(r.ledger.basis.at,T, 'awaiting a counter does not renew the basis');
    r=h.run({now:T+615000,counter:state(10.205,T+615000)});
    assert.ok(Math.abs(r.value-35.369)<1e-10);
    assert.equal(r.ledger.basis.at,T+605000);
});
test('a lower disagreeing report ahead of its counter poll takes effect immediately', () => {
    const h=harness({reported:state(45)});h.run();
    h.run({now:T+600000,counter:state(10.2,T+600000)});
    const r=h.run({now:T+605000,reported:state(38,T+605000)});
    assert.equal(r.value,38);assert.equal(r.estimated,false);
});
