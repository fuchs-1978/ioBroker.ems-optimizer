'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {estimateSoc, correctSoc} = require('../lib/vehicle-soc-estimator');
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
    const retained=full.run({now:T+7201000,counter:state(11,T+7201000)});
    assert.equal(retained.valid,true);assert.equal(retained.value,100);
    assert.equal(retained.stale,true, 'expired interpolation retains known progress, not fabricated new kWh');
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

test('old authenticated cloud report remains usable through restart while its age stays explicit',()=>{
    const h=harness({now:T+10800000,reported:state(84),car:state(1,T+10800000)});
    const r=h.run();assert.equal(r.value,84);assert.equal(r.valid,true);
    assert.equal(r.stale,true);assert.equal(r.ageS,10800);assert.equal(r.estimated,false);
    assert.equal(estimateSoc(h.input()).value,84);
    const fresh=h.run({reported:state(63,T+10800000)});
    assert.equal(fresh.value,63);assert.equal(fresh.stale,false);
});

test('retained estimate cannot migrate to another source or override a newly reported lower SoC',()=>{
    const h=harness({reported:state(70)});h.run();h.run({now:T+60000,counter:state(10.5,T+60000)});
    const old=h.run({now:T+7201000,counter:state(11,T+7201000)});
    assert.equal(old.value,70.9);assert.equal(old.valid,true);
    const changed=estimateSoc({...h.input(),signature:'another-car'});
    assert.equal(changed.value,70);assert.equal(changed.estimated,false);
    const newReport=h.run({reported:state(60,T+7201000)});
    assert.equal(newReport.value,60);
});

function continuousCharge(minutes = 180) {
    const h = harness({reported: state(27), capacityKWh: 32.3});
    let r = h.run();
    for (let seconds = 30; seconds <= minutes * 60; seconds += 30) {
        const at = T + seconds * 1000;
        r = h.run({now: at, counter: state(10 + 1.53 * seconds / 3600, at)});
    }
    return {h, r};
}
test('continuous metered Mii charging advances beyond two hours with a bounded persisted ledger', () => {
    const {h, r} = continuousCharge(300);
    assert.equal(r.reason, 'energy-estimate'); assert.equal(r.stale, true);
    assert.ok(Math.abs(r.value - (27 + 7.65 * 90 / 32.3)) < 1e-10);
    assert.ok(r.ledger.samples.length <= 256);
    assert.equal(r.ledger.basis.at, T, 'the original report time is not renewed');
    assert.equal(r.ledger.basis.kwh, 10, 'the original counter anchor is not renewed');
    assert.equal(r.ledger.basis.through, T + 18000000);
    const restarted = estimateSoc(h.input());
    assert.equal(restarted.value, r.value); assert.equal(restarted.reason, 'energy-estimate');
    const nextAt = h.input().now + 30000;
    const next = h.run({now: nextAt, counter: state(h.input().counter.val + 1.53 / 120, nextAt)});
    assert.ok(Math.abs(next.value - r.value - (1.53 / 120) * 90 / 32.3) < 1e-10);
});
test('long interpolation stops extending after an observation gap, invalid energy or an inconsistent frame', () => {
    for (const kind of ['gap', 'quality', 'stale', 'echo', 'same-timestamp-change']) {
        const {h, r} = continuousCharge(); const at = h.input().now + 30000;
        const priorKWh = h.input().counter.val;
        let invalid;
        if (kind === 'gap') invalid = h.run({now: at + 31000, counter: state(priorKWh + 0.02, at + 31000)});
        if (kind === 'quality') invalid = h.run({now: at, counter: {...state(priorKWh + 0.01, at), q: 64}});
        if (kind === 'stale') invalid = h.run({now: at + 31000});
        if (kind === 'echo') invalid = h.run({now: at, counter: {...state(priorKWh + 0.01, at), ack: false}});
        if (kind === 'same-timestamp-change') invalid = h.run({counter: state(priorKWh + 0.01, at - 30000)});
        assert.equal(invalid.value, r.value, kind);
        assert.equal(invalid.ledger.basis.continuous, false, kind);
        const freshAt = h.input().now + 30000;
        const held = h.run({now: freshAt, counter: state(priorKWh + 0.03, freshAt)});
        assert.equal(held.value, r.value, 'a fresh poll alone cannot repair missing continuity');
        const reportAt = freshAt + 30000;
        const corrected = h.run({now: reportAt, reported: state(30, reportAt), counter: state(priorKWh + 0.04, reportAt)});
        assert.equal(corrected.value, 30, 'new aligned lower report is authoritative');
        assert.equal(corrected.ledger.basis.continuous, true);
    }
});
test('expired legacy anchors and forged watermarks cannot retroactively create continuity', () => {
    const {h, r} = continuousCharge();
    for (const kind of ['legacy', 'mismatch']) {
        const ledger = JSON.parse(h.input().ledgerText);
        if (kind === 'legacy') { delete ledger.basis.continuous; delete ledger.basis.through; }
        else ledger.basis.through -= 1;
        const at = h.input().now + 30000;
        const held = estimateSoc({...h.input(), now: at, counter: state(h.input().counter.val + 0.01, at), ledgerText: JSON.stringify(ledger)});
        assert.equal(held.value, r.value); assert.match(held.reason, /retained-estimate/);
    }
});
test('long-session rounded reports preserve fractions and reset/disconnect never adds energy', () => {
    const {h, r} = continuousCharge(); const at = h.input().now + 30000;
    const kwh = h.input().counter.val + 0.01;
    const predicted = r.value + 0.01 * 90 / 32.3;
    const rounded = h.run({now: at, reported: state(Math.round(predicted), at), counter: state(kwh, at)});
    assert.ok(Math.abs(rounded.value - predicted) < 1e-10);
    const reset = h.run({now: at + 30000, counter: state(0, at + 30000)});
    assert.equal(reset.ledger.basis, null); assert.equal(reset.estimated, false);
    const next = h.run({now: at + 60000, counter: state(0.01, at + 60000)});
    assert.equal(next.estimated, false);
    const other = continuousCharge();
    const unplugged = other.h.run({car: state(1, other.h.input().now)});
    assert.equal(unplugged.ledger.basis, null); assert.equal(unplugged.value, other.r.value);
});
test('SoC status separates live energy interpolation from a held estimate and preserves cloud age', () => {
    const {socStatus} = require('../lib/vehicle-soc-estimator');
    assert.match(socStatus({valid: true, estimated: true, reason: 'energy-estimate'}, {stale: true}), /Ladeenergie fortgeschrieben; Fahrzeugbericht aelter/);
    assert.match(socStatus({valid: true, estimated: true, reason: 'retained-estimate:basis-invalid-or-stale'}, {stale: true}), /Letzter gueltiger SoC/);
    assert.equal(socStatus({valid: false}, {stale: true}), 'SoC unbekannt/ungueltig');
});


test('manual correction holds 94 against re-published 65 and counts only new charge across restart', () => {
    const h = harness({reported: state(65)});
    h.run();
    const correction = correctSoc({...h.input(), value: 94});
    assert.equal(correction.ok, true);
    const r = h.run({ledgerText: JSON.stringify(correction.ledger), now: T + 30000,
        counter: state(10.1, T + 30000), reported: state(65, T + 30000)});
    assert.equal(r.manual, true);
    assert.ok(Math.abs(r.value - 94.18) < 1e-10);
    assert.equal(estimateSoc(h.input()).value, r.value);
    assert.equal(h.run({reported: state(66, T + 30000)}).value, r.value,
        'even changed cloud values without measurement evidence cannot undo manual correction');
});

test('manual correction rejects invalid inputs and accepts zero and same-value corrections', () => {
    const input = harness().input();
    for (const value of [null, '', '94', -2, -0.1, 101, NaN, Infinity])
        assert.equal(correctSoc({...input, value}).ok, false, String(value));
    for (const value of [0, 94, 100]) {
        const a = correctSoc({...input, value});
        assert.equal(a.ok, true);
        assert.equal(correctSoc({...input, value, ledgerText: JSON.stringify(a.ledger)}).ok, true);
    }
    for (const update of [{car: state(1)}, {counter: state(10, T - 61000)},
        {counter: {...state(10), ack: false}}])
        assert.equal(correctSoc({...input, value: 94, ...update}).ok, false);
});

test('confirmed disconnect clears the manual basis; reconnect starts with the vehicle source', () => {
    const h = harness({reported: state(65)});
    const correction = correctSoc({...h.input(), value: 94});
    let r = h.run({ledgerText: JSON.stringify(correction.ledger), now: T + 1000, car: state(1, T + 1000)});
    assert.equal(r.manualCleared, true); assert.equal(r.ledger.manual, undefined);
    r = h.run({now: T + 2000, car: state(2, T + 2000), counter: state(10, T + 2000),
        reported: state(65, T + 2000)});
    assert.equal(r.manual, undefined); assert.equal(r.value, 65);
});

test('invalid or unknown connection suspends manual correction without pretending an unplug', () => {
    for (const car of [undefined, {...state(1), ack: false}, {...state(1), q: 64}]) {
        const h = harness();
        const correction = correctSoc({...h.input(), value: 94});
        const r = h.run({ledgerText: JSON.stringify(correction.ledger), now: T + 1000, car});
        assert.equal(r.manual, true); assert.equal(r.valid, false);
        assert.notEqual(r.manualCleared, true); assert.equal(r.ledger.manual.soc, 94);
    }
});

test('counter reset, jump and long gap suspend manual estimation; normal charging transition does not', () => {
    for (const update of [{now: T + 1000, counter: state(0, T + 1000)},
        {now: T + 1000, counter: state(20, T + 1000)},
        {now: T + 61000, counter: state(10.1, T + 61000)}]) {
        const h = harness();
        const correction = correctSoc({...h.input(), value: 94});
        const r = h.run({ledgerText: JSON.stringify(correction.ledger), ...update});
        assert.equal(r.valid, false);
    }
    const h = harness();
    const correction = correctSoc({...h.input(), value: 94});
    const r = h.run({ledgerText: JSON.stringify(correction.ledger), now: T + 1000,
        car: {...state(3, T + 1000), lc: T + 1000}, counter: state(10, T + 1000)});
    assert.equal(r.valid, true);
});

test('only a genuinely newer aligned vehicle measurement releases manual protection', () => {
    const h = harness({measurementTimeConfigured: true, measurementTime: state(T)});
    const correction = correctSoc({...h.input(), value: 94});
    let r = h.run({ledgerText: JSON.stringify(correction.ledger), now: T + 30000,
        reported: state(40, T + 30000), counter: state(10, T + 30000)});
    assert.equal(r.value, 94);
    r = h.run({now: T + 60000, measurementTime: state(T + 60000, T + 60000),
        reported: state(95, T + 60000), counter: state(10.5, T + 60000)});
    assert.equal(r.value, 95); assert.equal(r.manual, undefined);
    assert.equal(r.ledger.manual, undefined);
});


test('repeated cloud SoC warns on a measured three-point deficit, but rounding does not', () => {
    const h = harness({reported: state(65)}); h.run();
    h.run({now: T + 30000, counter: state(10.5, T + 30000)});
    let r = h.run({now: T + 60000, counter: state(11, T + 60000), reported: state(65, T + 60000)});
    assert.equal(r.socWarning, false);
    for (let i = 3; i <= 5; i++) h.run({now: T + i * 30000, counter: state(10 + i * 0.5, T + i * 30000)});
    r = h.run({now: T + 180000, counter: state(13, T + 180000), reported: state(65, T + 180000)});
    assert.equal(r.socWarning, true);
    assert.match(r.socWarningText, /SoCCorrection_pct/);
    assert.equal(h.run().socWarning, true);
    const correction = correctSoc({...h.input(), value: 94});
    r = h.run({ledgerText: JSON.stringify(correction.ledger)});
    assert.equal(r.socWarning, false); assert.equal(r.value, 94);
});

function correctedHarness({soc = 94, reported = 65, ...extra} = {}) {
    const h = harness({reported: state(reported), ...extra});
    h.run();
    const correction = correctSoc({...h.input(), value: soc});
    h.run({ledgerText: JSON.stringify(correction.ledger)});
    return h;
}

test('changed cloud 65 -> 94 automatically releases manual 94 while not charging', () => {
    const h = correctedHarness();
    const r = h.run({now: T + 30000, reported: state(94, T + 30000), counter: state(10, T + 30000)});
    assert.equal(r.automaticRecovery, true); assert.equal(r.value, 94);
    assert.equal(r.ledger.manual, undefined);
    assert.equal(h.run().manual, undefined);
});

test('recovery compares charged manual SoC with inclusive one percentage-point tolerance', () => {
    for (const [cloud, accepted] of [[94, false], [95, true], [96, true], [97, true], [98, false]]) {
        const h = correctedHarness();
        h.run({now: T + 30000, counter: state(10.5, T + 30000)});
        h.run({now: T + 60000, counter: state(11, T + 60000)});
        const r = h.run({now: T + 90000, counter: state(10 + 2 / 1.8, T + 90000),
            reported: state(cloud, T + 90000)});
        assert.equal(r.automaticRecovery === true, accepted, String(cloud));
        if (!accepted) assert.equal(r.manual, true);
    }
});

test('repeated matching cloud percentages and old timestamps do not release a correction', () => {
    const same = correctedHarness({reported: 94});
    assert.equal(same.run({now: T + 30000, counter: state(10, T + 30000),
        reported: state(94, T + 30000)}).manual, true);
    const old = correctedHarness();
    assert.equal(old.run({now: T + 30000, counter: state(10, T + 30000),
        reported: state(94, T)}).manual, true);
    const unchanged = correctedHarness({soc: 65});
    assert.equal(unchanged.run({now: T + 30000, counter: state(10, T + 30000),
        reported: state(65, T + 30000)}).manual, true);
});

test('recovery waits for the counter poll and survives a restart while aligning the report', () => {
    const h = correctedHarness();
    let r = h.run({now: T + 30000, reported: state(94, T + 30000)});
    assert.equal(r.manual, true);
    assert.equal(estimateSoc(h.input()).manual, true);
    r = h.run({now: T + 35000, counter: state(10, T + 35000)});
    assert.equal(r.automaticRecovery, true); assert.equal(r.value, 94);
});

test('bad reports, gaps, resets and suspended sessions cannot trigger plausible cloud recovery', () => {
    for (const update of [
        {reported: {...state(94, T + 30000), ack: false}},
        {reported: {...state(94, T + 30000), q: 64}},
        {reported: state(94, T + 40000)},
        {counter: state(0, T + 30000)},
        {counter: state(20, T + 30000)},
        {now: T + 70000, counter: state(10, T + 70000), reported: state(94, T + 70000)},
        {car: {...state(1, T + 30000), q: 64}}
    ]) {
        const h = correctedHarness();
        const r = h.run({now: T + 30000, counter: state(10, T + 30000),
            reported: state(94, T + 30000), ...update});
        assert.notEqual(r.automaticRecovery, true, JSON.stringify(update));
        assert.equal(r.manual, true);
    }
    const h = correctedHarness();
    h.run({now: T + 10000, car: {...state(1, T + 10000), q: 64}});
    const r = h.run({now: T + 30000, car: state(2, T + 30000),
        counter: state(10, T + 30000), reported: state(94, T + 30000)});
    assert.equal(r.valid, false); assert.equal(r.manual, true);
});

test('a mismatching report does not become a new candidate just by re-publishing it', () => {
    const h = correctedHarness();
    assert.equal(h.run({now: T + 30000, reported: state(90, T + 30000),
        counter: state(10, T + 30000)}).manual, true);
    const r = h.run({now: T + 60000, reported: state(90, T + 60000), counter: state(10, T + 60000)});
    assert.equal(r.manual, true); assert.equal(r.ledger.manual.recoveryCandidate, null);
});

test('alpha.171 manual ledgers migrate using the previously observed cloud value', () => {
    const h = correctedHarness();
    const ledger = JSON.parse(h.input().ledgerText);
    delete ledger.manual.cloudValue; delete ledger.manual.cloudTs; delete ledger.manual.recoveryCandidate;
    const r = h.run({now: T + 30000, ledgerText: JSON.stringify(ledger),
        reported: state(94, T + 30000), counter: state(10, T + 30000)});
    assert.equal(r.automaticRecovery, true);
});

test('a one-millisecond older cycle clock cannot erase manual 94 or return cloud 65', () => {
    const h = correctedHarness();
    const current = h.run({now: T + 30000, counter: state(10, T + 30000)});
    const older = h.run({now: T + 29999});
    assert.equal(current.value, 94); assert.equal(older.value, 94);
    assert.equal(older.manual, true); assert.deepEqual(older.ledger, current.ledger);
    const fresh = h.run({now: T + 31000, counter: state(10.01, T + 31000)});
    assert.ok(fresh.value > 94); assert.equal(fresh.manual, true);
});

test('an older evaluation immediately after correction retains the correction basis', () => {
    const h = correctedHarness();
    const r = h.run({now: T - 1});
    assert.equal(r.value, 94); assert.equal(r.manual, true);
});

test('invalid persisted manual chronology fails closed and retains evidence instead of cloud 65', () => {
    for (const change of [{lastAt: T + 10000}, {lastValue: null}, {lastKwh: -1}]) {
        const h = correctedHarness();
        const ledger = JSON.parse(h.input().ledgerText);
        Object.assign(ledger.manual, change);
        const r = h.run({ledgerText: JSON.stringify(ledger)});
        assert.equal(r.valid, false); assert.equal(r.value, null);
        assert.equal(r.manual, true); assert.ok(r.ledger.manual);
    }
});

test('observed go-e sub-Wh negative jitter preserves the manual 99.3% estimate', () => {
    const h = correctedHarness({soc: 98, counter: state(14.542366666666666)});
    let r;
    for (let i = 1; i <= 10; i++) r = h.run({now: T + i * 30000,
        counter: state(14.542366666666666 + i * (15.007747222222223 - 14.542366666666666) / 10, T + i * 30000)});
    const before = r.value;
    r = h.run({now: T + 330000, counter: state(15.007702777777777, T + 330000)});
    assert.equal(r.valid, true); assert.equal(r.manual, true); assert.equal(r.value, before);
    assert.equal(r.ledger.manual.suspended, false);
    assert.equal(r.ledger.manual.lastKwh, 15.007747222222223);
    assert.equal(estimateSoc(h.input()).value, before, 'restart holds the same high-water mark');
});

test('small counter dips and their rebound count no energy twice for manual and reported estimates', () => {
    for (const manual of [false, true]) {
        const h = manual ? correctedHarness() : harness(); h.run();
        const advanced = h.run({now: T + 30000, counter: state(10.1, T + 30000)}).value;
        assert.equal(h.run({now: T + 60000, counter: state(10.0995, T + 60000)}).value, advanced);
        assert.equal(h.run({now: T + 90000, counter: state(10.1, T + 90000)}).value, advanced);
        const next = h.run({now: T + 120000, counter: state(10.2, T + 120000)});
        assert.ok(Math.abs(next.value - (advanced + 0.18)) < 1e-10);
    }
});

test('counter rounding tolerance is bounded to the fixed high-water mark and cannot accumulate', () => {
    const h = correctedHarness();
    assert.equal(h.run({now: T + 30000, counter: state(9.9994, T + 30000)}).valid, true);
    const r = h.run({now: T + 60000, counter: state(9.9988, T + 60000)});
    assert.equal(r.valid, false); assert.equal(r.reason, 'manual-suspended');
    const reset = correctedHarness();
    assert.equal(reset.run({now: T + 30000, counter: state(0, T + 30000)}).valid, false);
});

test('counter rounding hold never refreshes stale or invalid readings or admits a power spike', () => {
    for (const counter of [state(9.9995, T - 61000), {...state(9.9995), ack:false},
        {...state(9.9995), q:64}]) {
        const h = correctedHarness();
        const r = h.run({now: T + 30000, counter});
        assert.equal(r.reason, 'manual-retained-energy-unavailable');
        assert.equal(r.ledger.manual.lastTs, T);
    }
    const h = correctedHarness();
    assert.equal(h.run({now:T+1000,counter:state(20,T+1000)}).valid,false);
});
