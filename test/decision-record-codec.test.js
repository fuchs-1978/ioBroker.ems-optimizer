'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {DecisionRecordEncoder, DecisionRecordDecoder, decodeDecisionRecords} = require('../lib/decision-record-codec');

function fixture(seq = 1, extra = {}) {
    return {schema: 2, adapterVersion: 'test', timestamp: seq * 1000, cycleId: seq,
        recordSession: 'live-session', recordSequence: seq, masterEnabled: true, mode: 'PRODUCTION',
        recording: true, valid: false, modelPaused: true,
        reason: 'Model pause is not missing real telemetry', event: null,
        realFeedback: {Wallbox0: {power: {val: 1.61, ts: 0, lc: 0, ack: true, q: 0}, allow: {val: 1, ack: true}}},
        production: {ts: seq * 1000, timers: {start_s: 600, stop_s: 600},
            wallboxes: [{wb: 0, actual_W: 1610}, {wb: 1, actual_W: null}, {wb: 2, actual_W: 0}],
            description: 'diagnostic payload '.repeat(1000)}, ...extra};
}
function normalize(value) { return JSON.parse(JSON.stringify(value)); }

test('replay exactly restores clocks, real feedback, commands and JSON persistence semantics', () => {
    const encoder = new DecisionRecordEncoder();
    const decoder = new DecisionRecordDecoder();
    const original = fixture(1);
    const first = encoder.encode(original);
    assert.equal(first.schema, 3);
    assert.equal(first.frameType, 'snapshot');
    assert.deepEqual(decoder.decode(first), original);
    for (let i = 2; i <= 20; i++) {
        const record = fixture(i);
        record.production.source = {val: i, ts: i * 1000, lc: 1000, ack: i % 2 === 0, q: i % 3, optional: undefined};
        record.production.timers.remaining_s = 600 - i;
        record.production.deviceRuntime = {pending: i % 4 ? {issuedAt: 1000, commandId: `command-${i}`} : null};
        const frame = encoder.encode(record);
        assert.equal(frame.frameType, 'delta');
        assert.deepEqual(decoder.decode(frame), normalize(record));
    }
    assert.equal(original.schema, 2, 'encoding must not mutate the upstream record');
});

test('explicit null, deletion, type changes, array element changes and array shape are lossless', () => {
    const encoder = new DecisionRecordEncoder();
    const decoder = new DecisionRecordDecoder();
    const record = fixture();
    record.production.optional = {a: 1, b: 2};
    decoder.decode(encoder.encode(record));
    const next = fixture(2);
    next.production.optional = {a: null};
    next.production.wallboxes[0].actual_W = null;
    next.realFeedback.Wallbox0.power = {val: null, ts: 2000, ack: false, q: 0x40};
    const frame = encoder.encode(next);
    assert.ok(frame.ops.some(op => op.op === 'delete' && op.path.at(-1) === 'b'));
    assert.ok(frame.ops.some(op => op.op === 'set' && op.value === null));
    assert.deepEqual(decoder.decode(frame), next);
    const changed = fixture(3);
    changed.production.wallboxes = [{wb: 0, actual_W: null}];
    changed.production.optional = false;
    assert.deepEqual(decoder.decode(encoder.encode(changed)), changed);
});

test('every repeated command attempt and completion keeps its own event, ID and sequence', () => {
    const encoder = new DecisionRecordEncoder();
    const decoder = new DecisionRecordDecoder();
    const records = [];
    for (let seq = 1; seq <= 10; seq++) {
        records.push(fixture(seq, {event: {type: seq % 2 ? 'command.attempt' : 'command.complete',
            id: 'go-e.0.allow_charging', value: 0, commandId: `c-${Math.ceil(seq / 2)}`, at: seq * 1000, error: ''}}));
    }
    const frames = records.map(record => encoder.encode(record));
    assert.equal(frames.length, 10);
    assert.deepEqual(frames.map(frame => decoder.decode(frame)), records);
    assert.equal(new Set(frames.map(frame => frame.event.commandId)).size, 5);
});

test('full checkpoints cover cadence, session, sequence gaps, backwards clock, mode and master changes', () => {
    const encoder = new DecisionRecordEncoder({checkpointMs: 30000});
    assert.equal(encoder.encode(fixture(1)).frameType, 'snapshot');
    assert.equal(encoder.encode(fixture(2)).frameType, 'delta');
    assert.equal(encoder.encode(fixture(3, {timestamp: 31000})).frameType, 'snapshot');
    assert.equal(encoder.encode(fixture(4, {timestamp: 32000, masterEnabled: false})).frameType, 'snapshot');
    assert.equal(encoder.encode(fixture(5, {timestamp: 33000, masterEnabled: false, mode: 'MASTER_OFF'})).frameType, 'snapshot');
    assert.equal(encoder.encode(fixture(6, {timestamp: 34000, recordSession: 'next'})).frameType, 'snapshot');
    assert.equal(encoder.encode(fixture(8, {timestamp: 35000, recordSession: 'next'})).frameType, 'snapshot');
    assert.equal(encoder.encode(fixture(9, {timestamp: 34999, recordSession: 'next'})).frameType, 'snapshot');
    encoder.reset();
    assert.equal(encoder.encode(fixture(10, {recordSession: 'next'})).frameType, 'snapshot');
});

test('missing delta rows become unknown until a self-contained recovery checkpoint', () => {
    const encoder = new DecisionRecordEncoder();
    const decoder = new DecisionRecordDecoder();
    const frames = [1, 2, 3, 4].map(seq => encoder.encode(fixture(seq)));
    assert.deepEqual(decoder.decode(frames[0]), fixture(1));
    const missing = decoder.decode(frames[2]);
    assert.equal(missing.reconstruction.valid, false);
    assert.ok(!Object.hasOwn(missing, 'production'), 'unknown record must not invent power');
    assert.equal(decoder.decode(frames[3]).reconstruction.valid, false);
    encoder.reset();
    assert.deepEqual(decoder.decode(encoder.encode(fixture(5))), fixture(5));
    assert.deepEqual(decoder.decode(encoder.encode(fixture(6))), fixture(6));
});

test('starting in the middle of a SQL window cannot reconstruct a delta without its checkpoint', () => {
    const encoder = new DecisionRecordEncoder();
    encoder.encode(fixture());
    const decoder = new DecisionRecordDecoder();
    const delta = encoder.encode(fixture(2));
    assert.equal(decoder.decode(delta).reconstruction.valid, false);
});

test('incorrect session, references, out-of-order deltas and timestamps invalidate the baseline', () => {
    for (const override of [{recordSession: 'foreign'}, {recordSequence: 1}, {baseSequence: 99},
        {checkpointSequence: 99}, {timestamp: 999}, {masterEnabled: false}, {mode: 'MASTER_OFF'}]) {
        const encoder = new DecisionRecordEncoder();
        const decoder = new DecisionRecordDecoder();
        decoder.decode(encoder.encode(fixture()));
        const frame = {...encoder.encode(fixture(2)), ...override};
        assert.equal(decoder.decode(frame).reconstruction.valid, false, JSON.stringify(override));
        assert.equal(decoder.decode(encoder.encode(fixture(3))).reconstruction.valid, false);
    }
});

test('malformed patch values and absent paths cannot create apparently valid reconstructed data', () => {
    for (const ops of [null, [{op: 'move', path: []}], [{op: 'delete', path: []}],
        [{op: 'set', path: ['production', 'missing', 'nested'], value: 0}],
        [{op: 'set', path: ['production', 'wallboxes', '0'], value: 0}],
        [{op: 'delete', path: ['production', 'wallboxes', 0]}],
        [{op: 'set', path: ['production', 'actual_W']}],
        [{op: 'set', path: ['schema'], value: 9}]]) {
        const encoder = new DecisionRecordEncoder();
        const decoder = new DecisionRecordDecoder();
        decoder.decode(encoder.encode(fixture()));
        assert.equal(decoder.decode({...encoder.encode(fixture(2)), ops}).reconstruction.valid, false);
    }
});

test('prototype paths and dangerous objects are rejected without prototype pollution', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
        const encoder = new DecisionRecordEncoder();
        const decoder = new DecisionRecordDecoder();
        decoder.decode(encoder.encode(fixture()));
        const delta = encoder.encode(fixture(2));
        delta.ops = [{op: 'set', path: ['production', key, 'polluted'], value: true}];
        assert.equal(decoder.decode(delta).reconstruction.valid, false);
        const dangerous = JSON.parse(`{"${key}":{"polluted":true}}`);
        const full = {...encoder.encode(fixture(3)), frameType: 'snapshot', checkpointSequence: 3, data: dangerous};
        assert.equal(decoder.decode(full).reconstruction.valid, false);
    }
    assert.equal({}.polluted, undefined);
});

test('legacy schema1/2 records pass through and break any productive delta baseline', () => {
    const encoder = new DecisionRecordEncoder();
    const decoder = new DecisionRecordDecoder();
    decoder.decode(encoder.encode(fixture()));
    const legacy = {schema: 1, timestamp: 1500, valid: true, targets: {Wallbox0: 1610}};
    assert.deepEqual(decoder.decode(legacy), legacy);
    assert.equal(decoder.decode(encoder.encode(fixture(2))).reconstruction.valid, false);
    assert.deepEqual(encoder.encode(legacy), legacy);
    assert.equal(encoder.encode(fixture(3)).frameType, 'snapshot');
    assert.deepEqual(decoder.decode(fixture(4)), fixture(4));
});

test('large changes choose a full record rather than an inflated delta', () => {
    const encoder = new DecisionRecordEncoder();
    encoder.encode(fixture());
    const record = fixture(2);
    record.production = {changed: 'x'};
    record.realFeedback = {changed: 'y'};
    const frame = encoder.encode(record);
    assert.equal(frame.frameType, 'snapshot');
    assert.deepEqual(new DecisionRecordDecoder().decode(frame), record);
});

test('invalid formats cannot be encoded or decoded into valid telemetry', () => {
    const encoder = new DecisionRecordEncoder();
    assert.throws(() => encoder.encode(fixture(0)), /metadaten/);
    assert.throws(() => new DecisionRecordEncoder({checkpointMs: 0}), /positiv/);
    const decoder = new DecisionRecordDecoder();
    for (const record of [null, false, {schema: 4}, {schema: 3, frameType: 'snapshot'}, undefined])
        assert.equal(decoder.decode(record).reconstruction.valid, false);
});

test('SQL wrappers preserve SQL time separately and unparseable JSON breaks the chain', () => {
    const encoder = new DecisionRecordEncoder();
    const rows = [1, 2, 3].map(seq => ({ts: 200000 + seq, val: JSON.stringify(encoder.encode(fixture(seq)))}));
    assert.deepEqual(decodeDecisionRecords(rows), [1, 2, 3].map(seq => ({ts: 200000 + seq, val: fixture(seq)})));
    rows[1].val = '{broken';
    const decoded = decodeDecisionRecords(rows);
    assert.equal(decoded[1].val.reconstruction.valid, false);
    assert.equal(decoded[2].val.reconstruction.valid, false);
});

test('decode CLI accepts exported rows on stdin and preserves metadata', () => {
    const encoder = new DecisionRecordEncoder();
    const input = {source: 'sql.0', records: [1, 2].map(seq => ({ts: seq, val: JSON.stringify(encoder.encode(fixture(seq)))}))};
    const result = spawnSync(process.execPath, [path.join(__dirname, '../tools/decode-decision-records.js'), '-'],
        {input: JSON.stringify(input), encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {source: 'sql.0', records: [1, 2].map(seq => ({ts: seq, val: fixture(seq)}))});
});

test('batch preflight sorts equal SQL times by sequence and deduplicates overlapping windows', () => {
    const encoder = new DecisionRecordEncoder();
    const frames = [1, 2, 3].map(seq => encoder.encode(fixture(seq)));
    const rows = [frames[2], frames[0], frames[1], frames[0], frames[1]].map(frame => ({ts: 2000, val: JSON.stringify(frame)}));
    assert.deepEqual(decodeDecisionRecords(rows), [1, 2, 3].map(seq => ({ts: 2000, val: fixture(seq)})));
});

test('conflicting full checkpoint identities never supply a plausible wrong delta baseline', () => {
    const encoder = new DecisionRecordEncoder();
    const first = fixture(1);
    first.production.x = 1;
    const full = encoder.encode(first);
    const next = {...normalize(first), recordSequence: 2, timestamp: 2000, cycleId: 2};
    next.production.y = 2;
    const delta = encoder.encode(next);
    const conflict = normalize(full);
    conflict.data.production.x = 999;
    encoder.reset();
    const recovery = encoder.encode(fixture(3));
    const result = decodeDecisionRecords([delta, conflict, recovery, full]);
    assert.equal(result.length, 3);
    assert.equal(result[0].reconstruction.valid, false);
    assert.match(result[0].reconstruction.reason, /Duplikate/);
    assert.equal(result[1].reconstruction.valid, false);
    assert.deepEqual(result[2], fixture(3));
});

test('direct decoder rejects duplicate or older full snapshots and clears the delta baseline', () => {
    const encoder = new DecisionRecordEncoder();
    const decoder = new DecisionRecordDecoder();
    const first = encoder.encode(fixture());
    assert.deepEqual(decoder.decode(first), fixture());
    const conflict = normalize(first);
    conflict.data.production.fake = 999;
    assert.equal(decoder.decode(conflict).reconstruction.valid, false);
    assert.equal(decoder.decode(encoder.encode(fixture(2))).reconstruction.valid, false);
    encoder.reset();
    assert.deepEqual(decoder.decode(encoder.encode(fixture(3))), fixture(3));
    assert.equal(decoder.decode(first).reconstruction.valid, false);
});

test('sequence ordering preserves newer self-contained checkpoints after a clock jump', () => {
    const encoder = new DecisionRecordEncoder();
    const records = [fixture(1, {timestamp: 5000}), fixture(2, {timestamp: 1000}), fixture(3, {timestamp: 2000})];
    const frames = records.map(record => encoder.encode(record));
    assert.equal(frames[1].frameType, 'snapshot');
    assert.deepEqual(decodeDecisionRecords([frames[2], frames[0], frames[1]]), records);
});

test('synthetic 30 kB diagnosis replay quantifies byte reduction without a SQL load claim', t => {
    const encoder = new DecisionRecordEncoder();
    const decoder = new DecisionRecordDecoder();
    let fullBytes = 0;
    let encodedBytes = 0;
    let snapshots = 0;
    const records = 301;
    for (let seq = 1; seq <= records; seq++) {
        const record = fixture(seq, {timestamp: seq * 200});
        record.production.description = 'stable diagnostic metadata; '.repeat(1150);
        record.production.source = {val: seq % 3, ts: seq * 200, lc: 1000, ack: true, q: 0};
        record.production.commands = {allow: {id: 'allow', value: 0, commandId: `command-${seq}`, at: seq * 200}};
        record.event = {type: 'command.attempt', id: 'allow', value: 0, commandId: `command-${seq}`, at: seq * 200};
        const frame = encoder.encode(record);
        fullBytes += Buffer.byteLength(JSON.stringify(record));
        encodedBytes += Buffer.byteLength(JSON.stringify(frame));
        snapshots += frame.frameType === 'snapshot' ? 1 : 0;
        assert.deepEqual(decoder.decode(frame), record);
    }
    assert.equal(snapshots, 3);
    assert.ok(encodedBytes < fullBytes * 0.1);
    t.diagnostic(`${records} synthetic records: ${fullBytes} full bytes, ${encodedBytes} compact bytes, ${snapshots} checkpoints; reduction ${(100 * (1 - encodedBytes / fullBytes)).toFixed(1)}%. Not a measured SQL benchmark.`);
});
