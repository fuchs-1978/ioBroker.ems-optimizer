'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {estimateSoc, correctSoc} = require('../lib/vehicle-soc-estimator');
const T = 1800000000000;
const state = (val, ts = T) => ({val, ts, ack: true, q: 0});
function harness(extra = {}) {
    let input = {now: T, reported: state(40), counter: state(10), car: state(2),
        capacityKWh: 50, efficiencyPct: 90, signature: 'vehicle-0', useStateTimestamp: true, ...extra};
    return {run(update = {}) {
        input = {...input, ...update};
        const result = estimateSoc(input);
        input.ledgerText = JSON.stringify(result.ledger);
        return result;
    }, correct(value) {
        const result = correctSoc({...input, value});
        assert.equal(result.ok, true);
        input.ledgerText = JSON.stringify(result.ledger);
        return result;
    }, input: () => input};
}

test('native ts protects a manual observation and measured charge from a 40-hour-old import', () => {
    const old = T - 40 * 3600000;
    const h = harness({reported: state(91, old)});
    h.run(); h.correct(23);
    const charged = h.run({now: T + 30000, counter: state(10.5, T + 30000),
        reported: {...state(82, old - 1000), lc: T + 30000}});
    assert.equal(charged.value, 23.9);
    assert.equal(charged.sourceTimestamp, T);
    assert.equal(charged.manual, true);
    assert.equal(charged.reported, 82, 'raw diagnostics remain visible');
    const restarted = estimateSoc({...h.input(), ledgerText: JSON.stringify(charged.ledger)});
    assert.equal(restarted.value, 23.9);
    assert.equal(restarted.ledger.latestReport.ts, old);
});

test('a newer vehicle measurement replaces even a higher manual correction without counter alignment', () => {
    const h = harness(); h.run(); h.correct(94);
    const fresh = h.run({now: T + 120000, reported: state(12, T + 90000)});
    assert.equal(fresh.value, 12);
    assert.equal(fresh.sourceTimestamp, T + 90000);
    assert.equal(fresh.manualCleared, true);
    assert.equal(fresh.ledger.manual, undefined);
    assert.match(fresh.correctionStatus, /Neuere Fahrzeugmessung/);
    assert.equal(h.run({reported: state(99, T + 1000)}).value, 12);
});

test('vehicle authority is the observation time, not the last energy-counter time', () => {
    const h = harness(); h.run(); h.correct(60);
    assert.equal(h.run({now: T + 30000, counter: state(10.5, T + 30000)}).value, 60.9);
    const fresh = h.run({now: T + 60000, counter: state(11, T + 60000), reported: state(50, T + 30000)});
    assert.equal(fresh.value, 50.9, 'only energy measured after the new report is added');
    assert.equal(fresh.sourceTimestamp, T + 30000);
    assert.equal(fresh.manual, undefined);
    assert.equal(h.run().value, 50.9, 'replaying the frame never counts the charge twice');
});

for (const estimationEnabled of [false, true]) test(`newest vehicle report survives replay and restart; estimation=${estimationEnabled}`, () => {
    const h = harness({estimationEnabled, reported: state(72)});
    h.run();
    const delayed = h.run({now: T + 10000, reported: {...state(91, T - 1000), lc: T + 10000}});
    assert.equal(delayed.value, 72);
    assert.equal(delayed.sourceTimestamp, T);
    assert.equal(estimateSoc(h.input()).value, 72);
    assert.equal(h.run({now: T + 20000, reported: state(35, T + 20000)}).value, 35,
        'the newest percentage wins, not the largest one');
});

for (const invalid of [state(90, 0), {...state(90), ack: false}, {...state(90), q: 1},
    state(90, T + 5000), state(-1), state(101), undefined]) test(`invalid source cannot replace a valid observation: ${JSON.stringify(invalid)}`, () => {
    const h = harness({reported: state(72)}); h.run();
    const retained = h.run({reported: invalid});
    assert.equal(retained.value, 72);
    assert.equal(retained.sourceTimestamp, T);
    assert.equal(retained.ledger.latestReport.value, 72);
});

test('manual correction wins an equal measurement timestamp and operator reset remains explicit', () => {
    const h = harness(); h.run(); h.correct(23);
    assert.equal(h.run({reported: state(91)}).value, 23);
    assert.equal(h.run({now: T + 1000, reported: {...state(91), lc: T + 1000}}).value, 23);
    h.correct(-1);
    assert.equal(h.run().value, 91);
});

test('an explicit measurement clock takes priority over the publication clock', () => {
    const h = harness({measurementTimeConfigured: true, measurementTime: state(T - 3600000)});
    h.run(); h.correct(23);
    assert.equal(h.run({now: T + 2000, reported: state(91, T + 2000)}).value, 23);
    const latest = h.run({measurementTime: state(T + 1500, T + 2000)});
    assert.equal(latest.value, 91);
    assert.equal(latest.sourceTimestamp, T + 1500);
});

test('upgrade discards old publication-clock authority while retaining manual charge progress', () => {
    const legacy = harness({useStateTimestamp: false}); legacy.run(); legacy.correct(23);
    const charged = legacy.run({now: T + 30000, counter: state(10.5, T + 30000)});
    charged.ledger.lastKnownReport = {value: 91, ts: T + 20000};
    const upgraded = estimateSoc({...legacy.input(), useStateTimestamp: true,
        reported: state(91, T - 40 * 3600000), ledgerText: JSON.stringify(charged.ledger)});
    assert.equal(upgraded.value, 23.9);
    assert.equal(upgraded.sourceTimestamp, T);
    assert.equal(upgraded.ledger.latestReport.ts, T - 40 * 3600000);
    assert.equal(upgraded.ledger.manual.kwh, 10);
});

test('unplug ends charging accounting without allowing an older report to undo the manual observation', () => {
    const h = harness(); h.run(); h.correct(23);
    assert.equal(h.run({now: T + 30000, counter: state(10.5, T + 30000)}).value, 23.9);
    const unplugged = h.run({now: T + 31000, car: state(1, T + 31000)});
    assert.equal(unplugged.value, 23.9);
    assert.equal(unplugged.ledger.manual, undefined);
    const reconnected = h.run({now: T + 32000, car: state(2, T + 32000), counter: state(0, T + 32000)});
    assert.equal(reconnected.value, 23.9);
    assert.equal(h.run({now: T + 33000, reported: state(18, T + 33000), counter: state(0, T + 33000)}).value, 18);
});

test('manual authority uses the command timestamp rather than its later processing time', () => {
    const h = harness({now: T + 10000, reported: state(72, T + 5000)});
    h.run();
    const correction = correctSoc({...h.input(), value: 23, timestamp: T});
    assert.equal(correction.ok, true);
    assert.equal(correction.ledger.manual.at, T);
    const result = h.run({ledgerText: JSON.stringify(correction.ledger)});
    assert.equal(result.value, 72);
    assert.equal(result.sourceTimestamp, T + 5000);
});

test('a queued manual correction keeps its original observation time when the cable is connected', () => {
    const h = harness({car: state(1), reported: state(49, T - 1000)});
    h.run(); h.correct(65);
    const connected = h.run({now: T + 30000, car: state(2, T + 30000), counter: state(0, T + 30000)});
    assert.equal(connected.value, 65);
    assert.equal(connected.sourceTimestamp, T);
    assert.equal(connected.ledger.manual.at, T);
    const fresh = h.run({now: T + 31000, reported: state(60, T + 10000), counter: state(0, T + 31000)});
    assert.equal(fresh.value, 60);
    assert.equal(fresh.ledger.manual, undefined);
});
