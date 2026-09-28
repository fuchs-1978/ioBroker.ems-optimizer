'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {analyzeShadow, analyzeEnergy} = require('../lib/shadow-analysis');

// All rows below are constructed unit-test inputs, not exported operating data.
const base = Date.parse('2025-01-01T12:00:00Z');
const window = (from = 0, to = 60000) => ({from: base + from, to: base + to});
function record(seconds, sequence, {power = 3000, actual = 3000, ...extra} = {}) {
    return {timestamp: base + seconds * 1000, valid: true, masterEnabled: false,
        recordSession: base - 100000, recordSequence: sequence,
        recording: {dropped: 0, writeErrors: 0, lastError: ''},
        modeled: {Wallbox0: {active: power > 0, powerW: power, status: power ? 'active' : 'stop'}},
        actuals: {Wallbox0: actual}, ...extra};
}
const energy = (values, opts = {}) => ({netPower: values.map(([seconds, val]) => ({ts: base + seconds * 1000, val})), ...opts});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('separates independently constructed model and measurement intervals', () => {
    const records = [record(0, 1), record(5, 2, {actual: 0}),
        record(10, 3, {actual: 0, power: 0}), record(15, 4, {power: 0}),
        record(20, 5, {power: 0}), record(30, 6)];
    const result = analyzeShadow({window: window(0, 30000), records});
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 1);
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionMs, 20000);
    assert.equal(result.wallboxes.Wallbox0.measured.interruptionCount, 1);
    assert.equal(result.wallboxes.Wallbox0.measured.interruptionMs, 10000);
    assert.equal(result.wallboxes.Wallbox0.modeled.coverage, 1);
    assert.match(result.wallboxes.Wallbox0.measured.meaning, /not inferred/);
    assert.equal(result.wallboxes.Wallbox1.modeled.coverage, 0);
});

test('SQL transport delay and unordered duplicated rows cannot create an extra interruption', () => {
    const records = [record(0, 1), record(10, 2, {power: 0}), record(20, 3)];
    const input = [records[2], records[0], records[1], records[1]].map(row => ({ts: row.timestamp + 84000, val: JSON.stringify(row)}));
    const result = analyzeShadow({window: window(0, 20000), records: input});
    assert.equal(result.diagnostics.outOfOrder, 1);
    assert.equal(result.diagnostics.duplicates, 1);
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 1);
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionMs, 10000);
});

test('null model/measurement data is unknown, never an inferred WB1 stop', () => {
    const records = [record(0, 1), record(10, 2, {power: null, actual: null}), record(20, 3)];
    for (const row of records) {
        row.modeled.Wallbox1 = row.modeled.Wallbox0;
        row.actuals.Wallbox1 = row.actuals.Wallbox0;
    }
    const result = analyzeShadow({window: window(0, 20000), records});
    for (const kind of ['modeled', 'measured']) {
        assert.equal(result.wallboxes.Wallbox1[kind].interruptionCount, 0);
        assert.equal(result.wallboxes.Wallbox1[kind].unknownMs, 20000);
    }
});

test('inactive alpha21 response breaks model continuity while retaining measured evidence', () => {
    const records = [record(0, 1), record(10, 2, {power: 0, actual: 0, response: {valid: false}}), record(20, 3)];
    const result = analyzeShadow({window: window(0, 20000), records});
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 0);
    assert.equal(result.wallboxes.Wallbox0.modeled.unknownMs, 20000);
    assert.equal(result.wallboxes.Wallbox0.measured.interruptionCount, 1);
});

test('bad quality or stale source feedback is unknown even with a numeric actual', () => {
    for (const feedback of [{q: 128}, {fresh: false}, {ack: false}]) {
        const records = [record(0, 1), record(10, 2, {actual: 0,
            realFeedback: {Wallbox0: {powerKW: feedback}}}), record(20, 3)];
        const result = analyzeShadow({window: window(0, 20000), records});
        assert.equal(result.wallboxes.Wallbox0.measured.interruptionCount, 0);
        assert.equal(result.wallboxes.Wallbox0.measured.unknownMs, 20000);
    }
});

test('invalid records, enabled master, sequence gaps/resets and session changes break stop counting', () => {
    for (const extra of [{valid: false}, {masterEnabled: true}, {recordSequence: 4},
        {recordSequence: 0}, {recordSession: base}, {recordSession: null}]) {
        const records = [record(0, 1), record(10, 2, {power: 0, ...extra}), record(20, 3)];
        const result = analyzeShadow({window: window(0, 20000), records});
        assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 0, JSON.stringify(extra));
        assert.equal(result.wallboxes.Wallbox0.modeled.unknownMs, 20000);
    }
});

test('a dropped record or failed write breaks continuity; historical cumulative errors are still reported', () => {
    const records = [record(0, 1), record(10, 2, {power: 0, recording: {dropped: 1, writeErrors: 1}}),
        record(20, 3, {recording: {dropped: 1, writeErrors: 1}})];
    const result = analyzeShadow({window: window(0, 20000), records});
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 0);
    assert.equal(result.diagnostics.recordingDrops, 1);
    assert.equal(result.diagnostics.recordingWriteErrors, 1);
    for (const row of records) row.recording = {dropped: 1, writeErrors: 1};
    assert.equal(analyzeShadow({window: window(0, 20000), records}).wallboxes.Wallbox0.modeled.interruptionCount, 1);
});

test('conflicting repeated identities and timestamp collisions are diagnosed and excluded', () => {
    const records = [record(0, 1), record(10, 2, {power: 0}), record(10, 2), record(20, 3)];
    const result = analyzeShadow({window: window(0, 20000), records});
    assert.equal(result.diagnostics.conflictingDuplicates, 1);
    assert.equal(result.diagnostics.timestampCollisions, 1);
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 0);
    assert.equal(result.wallboxes.Wallbox0.modeled.coverage, 0);
});

test('malformed JSON at a known SQL timestamp remains an unknown barrier', () => {
    const records = [record(0, 1), {ts: base + 5000, val: '{broken'}, record(10, 2, {power: 0}), record(20, 3)];
    const result = analyzeShadow({window: window(0, 20000), records});
    assert.equal(result.diagnostics.malformed, 1);
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 0);
    assert.equal(result.wallboxes.Wallbox0.modeled.coverage, 0.5);
});

test('a parsed object lacking decision time retains its SQL timestamp as an unknown barrier', () => {
    const missing = record(5, 9);
    delete missing.timestamp;
    const records = [record(0, 1), {ts: base + 5000, val: JSON.stringify(missing)},
        record(10, 2, {power: 0}), record(20, 3)];
    const result = analyzeShadow({window: window(0, 20000), records});
    assert.equal(result.diagnostics.malformed, 1);
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 0);
    assert.equal(result.wallboxes.Wallbox0.modeled.coverage, 0.5);
});

test('an eight-hour unplug/reconnect is a normal end, not a charging interruption', () => {
    const records = [record(0, 1, {realFeedback: {Wallbox0: {car: {value: 2}}}})];
    for (let minute = 1; minute <= 480; minute++) {
        records.push(record(minute * 60, minute + 1, {power: 0, actual: 0,
            realFeedback: {Wallbox0: {car: {value: 1}}}}));
    }
    records.push(record(481 * 60, 482, {realFeedback: {Wallbox0: {car: {value: 2}}}}));
    const result = analyzeShadow({window: window(0, 481 * 60000), records});
    for (const kind of ['modeled', 'measured']) {
        assert.equal(result.wallboxes.Wallbox0[kind].interruptionCount, 0);
        assert.equal(result.wallboxes.Wallbox0[kind].normalEndCount, 1);
        assert.equal(result.wallboxes.Wallbox0[kind].coverage, 1);
    }
});

test('target reached and user release withdrawn are regular ends; temporary allow=0 remains a counted dip', () => {
    for (const feedback of [{soc: {value: 95}, targetSoc: {value: 95}}, {userRelease: {value: false}}]) {
        const result = analyzeShadow({window: window(0, 20000), records: [record(0, 1),
            record(10, 2, {power: 0, actual: 0, realFeedback: {Wallbox0: feedback}}), record(20, 3)]});
        assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 0);
        assert.equal(result.wallboxes.Wallbox0.modeled.normalEndCount, 1);
    }
    const records = [record(0, 1, {realFeedback: {Wallbox0: {car: {value: 2}, allow: {value: 1}}}}),
        record(10, 2, {power: 0, actual: 0, realFeedback: {Wallbox0: {car: {value: 2}, allow: {value: 0}}}}),
        record(20, 3, {realFeedback: {Wallbox0: {car: {value: 2}, allow: {value: 1}}}})];
    const result = analyzeShadow({window: window(0, 20000), records});
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 1);
    assert.equal(result.wallboxes.Wallbox0.measured.interruptionMs, 10000);
    assert.equal(result.wallboxes.Wallbox0.measured.normalEndCount, 0);
});

test('old unacknowledged user settings remain usable while unacknowledged telemetry cannot close a session', () => {
    const analyzeFeedback = feedback => analyzeShadow({window: window(0, 20000), records: [record(0, 1),
        record(10, 2, {power: 0, actual: 0, realFeedback: {Wallbox0: feedback}}), record(20, 3)]})
        .wallboxes.Wallbox0.modeled;
    const soc = {value: 95, ts: base + 10000, ack: true, fresh: true, q: 0};
    const targetSoc = {value: 95, ts: base - 86400000, ack: false, fresh: false, q: 0};
    const reached = analyzeFeedback({soc, targetSoc});
    assert.equal(reached.normalEndCount, 1);
    assert.equal(reached.normalEnds[0].reason, 'target SoC reached');
    assert.equal(reached.interruptionCount, 0);
    const withdrawn = analyzeFeedback({userRelease: {...targetSoc, value: false}});
    assert.equal(withdrawn.normalEndCount, 1);
    assert.equal(withdrawn.normalEnds[0].reason, 'user release withdrawn');
    for (const feedback of [
        {car: {value: 1, ts: base + 10000, ack: false, fresh: true, q: 0}},
        {soc: {...soc, ack: false}, targetSoc},
        {soc, targetSoc: {...targetSoc, q: 128}},
        {soc, targetSoc: {...targetSoc, ts: base + 11000}},
        {soc, targetSoc: {...targetSoc, value: null}},
        {soc, targetSoc: {...targetSoc, value: '95'}},
        {userRelease: {...targetSoc, value: false, ts: base + 11000}},
        {userRelease: {...targetSoc, value: false, q: 128}},
        {userRelease: {...targetSoc, value: 'false'}}
    ]) {
        const result = analyzeFeedback(feedback);
        assert.equal(result.normalEndCount, 0, JSON.stringify(feedback));
        assert.equal(result.interruptionCount, 1);
    }
});

test('a long heartbeat gap is unknown; open stops and window boundaries are not completed interruptions', () => {
    const records = [record(10, 1), record(80, 2, {power: 0}), record(90, 3)];
    const result = analyzeShadow({window: window(0, 100000), records});
    assert.equal(result.wallboxes.Wallbox0.modeled.interruptionCount, 0);
    assert.equal(result.wallboxes.Wallbox0.modeled.unknownMs, 90000);
    const open = analyzeShadow({window: window(0, 30000), records: [record(0, 1), record(10, 2, {power: 0}), record(20, 3, {power: 0})]});
    assert.equal(open.wallboxes.Wallbox0.modeled.interruptionCount, 0);
    assert.equal(open.wallboxes.Wallbox0.modeled.openInterruption.from, base + 10000);
    assert.equal(open.wallboxes.Wallbox0.modeled.unknownMs, 10000);
});

test('paired import/export counters take precedence and preserve signed net energy', () => {
    const result = analyzeEnergy({counterUnit: 'Wh',
        importCounter: [{ts: base, val: 10000}, {ts: base + 60000, val: 11000}],
        exportCounter: [{ts: base, val: 20000}, {ts: base + 60000, val: 22000}],
        netPower: [{ts: base, val: 999999}, {ts: base + 60000, val: 0}]}, window());
    assert.equal(result.source, 'pairedCounters');
    assert.equal(result.importKWh, 1);
    assert.equal(result.exportKWh, 2);
    assert.equal(result.netKWh, -1);
    assert.equal(result.complete, true);
    assert.equal(result.estimated, false);
});

test('counter resets, nulls and missing endpoints force fallback to explicitly bounded net-power integration', () => {
    for (const counter of [
        [{ts: base, val: 100}, {ts: base + 30000, val: 0}, {ts: base + 60000, val: 110}],
        [{ts: base, val: 100}, {ts: base + 30000, val: null}, {ts: base + 60000, val: 110}],
        [{ts: base + 1000, val: 100}, {ts: base + 60000, val: 110}]
    ]) {
        const result = analyzeEnergy(energy([[0, 3600], [30, -1800], [60, 0]], {
            importCounter: counter, exportCounter: [{ts: base, val: 1}, {ts: base + 60000, val: 1}]
        }), window());
        assert.equal(result.source, 'netPower');
        assert.equal(result.complete, true);
        assert.equal(result.estimated, true);
        near(result.importKWh, 0.03);
        near(result.exportKWh, 0.015);
        near(result.netKWh, 0.015);
    }
});

test('a sparse SMA-style 143 min gap cannot become a plausible complete energy balance', () => {
    const duration = 143 * 60000;
    const result = analyzeEnergy(energy([[0, -147.4], [duration / 1000, 5129.5]]), window(0, duration));
    assert.equal(result.complete, false);
    assert.equal(result.coveredMs, 65000);
    assert.equal(result.unknownMs, duration - 65000);
    assert.ok(result.coverage < 0.008);
    near(result.exportKWh, 147.4 * 65 / 3600000);
    assert.equal(result.importKWh, 0, 'last sample must not be extrapolated');
});

test('nulls, quality failures and contradictory same-time samples never become zero-power coverage', () => {
    const result = analyzeEnergy(energy([[0, 1000], [10, null], [20, 1000], [20, -1000], [30, 1000], [40, 0]]), window(0, 40000));
    assert.equal(result.coveredMs, 20000);
    assert.equal(result.unknownMs, 20000);
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics.netPower.conflictingDuplicates, 1);
    near(result.importKWh, 1000 * 20 / 3600000);
    const badQuality = analyzeEnergy({netPower: [{ts: base, val: 1000, q: 128}, {ts: base + 60000, val: 0}]}, window());
    assert.equal(badQuality.source, 'unavailable');
    assert.equal(badQuality.importKWh, null);
});

test('integration clips to window and maximum age of a pre-window seed', () => {
    const result = analyzeEnergy(energy([[-60, 3600], [10, 7200], [20, 0]]), window(0, 30000));
    assert.equal(result.coveredMs, 15000);
    near(result.importKWh, (3600 * 5 + 7200 * 10) / 3600000);
    assert.equal(result.unknownMs, 15000);
});

test('explicit timezone windows and numeric data are required; analysis does not mutate its input', () => {
    const input = {window: {from: '2025-01-01T12:00:00Z', to: '2025-01-01T12:01:00Z'}, records: [record(0, 1), record(60, 2)]};
    const before = JSON.stringify(input);
    assert.equal(analyzeShadow(input).window.from, base);
    assert.equal(JSON.stringify(input), before);
    assert.throws(() => analyzeShadow({window: {from: '2025-01-01T12:00:00', to: '2025-01-01T12:01:00'}, records: []}), /timezone/);
    assert.throws(() => analyzeShadow({window: window(), maxRecordGapMs: -1}), /positive/);
    assert.throws(() => analyzeEnergy({counterUnit: 'kW'}, window()), /counterUnit/);
    const unknown = analyzeEnergy(energy([[0, '1000'], [60, 0]]), window());
    assert.equal(unknown.coverage, 0, 'numeric strings are not silently converted into measured values');
});

test('CLI reads stdin, emits machine JSON, and rejects invalid input without writing files', () => {
    const cli = path.join(__dirname, '../tools/analyze-shadow.js');
    const run = spawnSync(process.execPath, [cli], {input: JSON.stringify({window: window(), records: [record(0, 1), record(60, 2)]}), encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).wallboxes.Wallbox0.modeled.coverage, 1);
    const invalid = spawnSync(process.execPath, [cli, '-'], {input: '{}', encoding: 'utf8'});
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, '');
    assert.match(JSON.parse(invalid.stderr).error, /window/);
});
