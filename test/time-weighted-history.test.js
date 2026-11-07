'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const STEP = 900000, DAY = 86400000;
function harness(extra = {}) {
    const context = vm.createContext({nativeConfig: {}, historySourceEnabled: async () => true,
        setTimeout, clearTimeout, ...extra});
    for (const file of ['core', 'history']) vm.runInContext(fs.readFileSync(require.resolve(`../lib/engine/${file}`), 'utf8'), context);
    vm.runInContext('pause=async()=>{}', context);
    return {context, run: source => vm.runInContext(source, context)};
}
function aggregate(rows, start = 0, end = STEP, maxGapMs = STEP, estimateLags = false) {
    const h = harness({rows, start, end, maxGapMs, estimateLags});
    return JSON.parse(JSON.stringify(h.run('timeWeightedPower(rows,start,end,maxGapMs,estimateLags)')));
}
function heartbeats(start, end, val = 0, step = 60000) {
    return Array.from({length: Math.floor((end - start) / step) + 1}, (_, i) => ({ts: start + i * step, val}));
}

test('irregular samples weight three active minutes by duration, not six of eight points', () => {
    const rows = [0, 30000, 60000, 90000, 120000, 150000].map(ts => ({ts, val: 1000}));
    rows.push({ts: 180000, val: 0}, {ts: 600000, val: 0});
    assert.equal(rows.reduce((sum, row) => sum + row.val, 0) / rows.length, 750);
    assert.deepEqual(aggregate(rows), [{ts: 0, val: 200}]);
    assert.equal(aggregate(rows)[0].val / 4000, 0.05);
});
test('additional identical samples and unsorted input cannot change the integral', () => {
    const sparse = [{ts: -60000, val: 200}, {ts: 180000, val: 0}];
    const dense = [...sparse, ...heartbeats(0, 120000, 200, 1000), ...heartbeats(200000, 890000, 0, 1000)].reverse();
    assert.deepEqual(aggregate(sparse), aggregate(dense));
});
test('bounded predecessor covers the start and a boundary change belongs only to the next quarter', () => {
    const result = aggregate([{ts: -1000, val: 400}, {ts: STEP, val: 800}], 0, 2 * STEP, STEP + 1000);
    assert.deepEqual(result, [{ts: 0, val: 400}, {ts: STEP, val: 800}]);
});
test('a missing predecessor or an expired last point leaves the quarter unknown', () => {
    assert.deepEqual(aggregate([{ts: 1, val: 100}]), []);
    assert.deepEqual(aggregate([{ts: -1, val: 100}]), []);
    assert.deepEqual(aggregate([{ts: 0, val: 100}], 0, STEP, 95000), []);
});
test('real zero heartbeats remain a fully observed zero quarter', () => {
    assert.deepEqual(aggregate(heartbeats(0, STEP, 0), 0, STEP, 95000), [{ts: 0, val: 0}]);
});
for (const marker of [{val: null}, {val: 0, q: 64}, {val: 200, q: 'bad'}, {val: 'bad'}]) {
    test(`invalid raw marker ${JSON.stringify(marker)} breaks the hold until a new valid point`, () => {
        const rows = heartbeats(0, 2 * STEP, 200);
        rows.find(row => row.ts === 120000).val = marker.val;
        Object.assign(rows.find(row => row.ts === 120000), marker);
        assert.deepEqual(aggregate(rows, 0, 2 * STEP, 95000), [{ts: STEP, val: 200}]);
    });
}
test('a real logger outage is not bridged even when the values before and after agree', () => {
    const rows = heartbeats(0, 2 * STEP, 200).filter(row => row.ts < 120000 || row.ts >= 360000);
    assert.deepEqual(aggregate(rows, 0, 2 * STEP, 95000), [{ts: STEP, val: 200}]);
});
test('short raw gaps interpolate only the unobserved duration and retain measured holds', () => {
    const rows = [...heartbeats(0, 240000, 400), {ts: 300000, val: null}, ...heartbeats(312000, STEP, 800)];
    assert.deepEqual(aggregate(rows, 0, STEP, 95000), []);
    assert.deepEqual(aggregate(rows, 0, STEP, 95000, true), [{
        ts: 0, val: (300000 * 400 + 12000 * 600 + 588000 * 800) / STEP,
        estimatedGaps: [[300000, 312000]]
    }]);
    for (const resume of [330001, null]) {
        const resumed = resume === null ? [] : heartbeats(resume, STEP, 800);
        assert.deepEqual(aggregate([...rows.slice(0, 6), ...resumed], 0, STEP, 95000, true), []);
    }
});
test('interpolated time is counted once across sources and capped at thirty seconds per lag', () => {
    const meter = [{ts: 0, val: 1200, estimatedGaps: [[10000, 30000]]}];
    const shared = [{ts: 0, val: 400, estimatedGaps: [[20000, 40000]]}];
    const separate = [{ts: 0, val: 400, estimatedGaps: [[40000, 60000]]}];
    const h = harness({meter, shared, separate});
    const result = name => JSON.parse(JSON.stringify(h.run(`mergeSubmeterProfile([meter],[{series:${name},multiplier:1}])`)));
    assert.deepEqual(result('shared'), {totalValues: [], baseloadValues: [], estimatedBaseloadValues: [{ts: 0, val: 800}]});
    assert.deepEqual(result('separate'), {totalValues: [], baseloadValues: [], estimatedBaseloadValues: []});
});
test('Lasso uses a bounded chunk lookahead and never reads past the completed history', async () => {
    const calls = [], rows = [...heartbeats(-60000, DAY - 60000, 400),
        {ts: DAY - 10000, val: null}, ...heartbeats(DAY + 10000, DAY + STEP, 800)];
    const h = harness({sendTo: (instance, command, {options}, callback) => {
        calls.push(options);
        callback({result: rows.filter(row => row.ts >= options.start && row.ts <= options.end)});
    }});
    const result = await h.run("getHistoryChunked('meter',0,86400000+900000,'power',true)");
    assert.equal(calls[0].end, DAY + 30000);
    assert.equal(calls[1].end, DAY + STEP);
    assert.deepEqual(JSON.parse(JSON.stringify(result.slice(-2).map(row => row.estimatedGaps))),
        [[[DAY - 10000, DAY]], [[DAY, DAY + 10000]]]);
});
test('future and synthetic boundary points cannot invent a missing first measurement', () => {
    assert.deepEqual(aggregate([{ts: 0, val: 200, i: true}, {ts: STEP, val: 200}]), []);
    assert.deepEqual(aggregate([{ts: STEP, val: 200}]), []);
});
test('identical duplicates are harmless; conflicting duplicates invalidate the affected quarter', () => {
    const rows = heartbeats(0, STEP, 100);
    assert.deepEqual(aggregate([...rows, {ts: 60000, val: 100}]), [{ts: 0, val: 100}]);
    for (const duplicate of [{ts: 60000, val: 200}, {ts: 60000, val: null}]) {
        assert.deepEqual(aggregate([...rows, duplicate, {ts: 60000, val: 100}]), []);
    }
});
test('house and flexible power use the same interval while retaining W and kW conversion', () => {
    const h = harness({meters: Array.from({length: 4}, () => aggregate(heartbeats(0, STEP, 1000))),
        car: aggregate([{ts: 0, val: 2}, {ts: 450000, val: 0}]),
        heater: aggregate([{ts: 0, val: 0}, {ts: 180000, val: 500}])});
    const result = h.run('mergeSubmeterProfile(meters,[{series:car,multiplier:1000},{series:heater,multiplier:1}])');
    assert.equal(result.totalValues[0].val, 4000);
    assert.equal(result.baseloadValues[0].val, 2600);
});
test('missing included flexible power cannot become a valid cleaned zero load', () => {
    const h = harness({meters: [aggregate(heartbeats(0, STEP, 4000))],
        heater: aggregate([{ts: 60000, val: 0}])});
    const result = h.run('mergeSubmeterProfile(meters,[{series:heater,multiplier:1}])');
    assert.equal(result.totalValues.length, 1); assert.equal(result.baseloadValues.length, 0);
});
test('absolute quarters retain both real occurrences of the autumn clock hour', () => {
    const start = Date.parse('2026-10-25T00:00:00Z'), end = start + 7200000;
    const result = aggregate(heartbeats(start, end, 400), start, end, 95000);
    assert.equal(result.length, 8); assert.equal(new Set(result.map(row => row.ts)).size, 8);
    assert.ok(Math.abs(result.reduce((sum, row) => sum + row.val / 4000, 0) - 0.8) < 1e-12);
});
test('raw SQL requests retain null/quality markers and use bounded metadata-based lookback', async () => {
    for (const [relog, maxGap] of [[60, 95000], ['600', 900000], [undefined, 95000], [0, 95000], [3600, 900000]]) {
        let request;
        const h = harness({historySourceSettings: async () => ({enabled: true, changesRelogInterval: relog}),
            sendTo: (instance, command, message, callback) => {request = message; callback({result: heartbeats(-60000, STEP, 400)});}});
        const result = await h.run("getTimeWeightedHistory('meter',0,900000)");
        assert.equal(result[0].val, 400); assert.equal(request.options.start, -maxGap);
        assert.equal(request.options.aggregate, 'none'); assert.equal(request.options.ignoreNull, false);
        assert.equal(request.options.q, true); assert.equal(request.options.removeBorderValues, true);
        assert.equal(request.options.count, 10000); assert.equal(request.options.returnNewestEntries, false);
    }
});
test('raw metadata failure and disabled sources cannot reach SQL', async () => {
    for (const settings of [async () => ({enabled: false}), async () => {throw new Error('metadata failed');}]) {
        const h = harness({historySourceSettings: settings, sendTo: () => assert.fail('SQL queried')});
        await assert.rejects(h.run("getTimeWeightedHistory('meter',0,900000)"), /nicht aktiviert|metadata failed/);
    }
});
test('raw NULL markers survive retrieval and invalidate the measured interval', async () => {
    const rows = heartbeats(0, STEP, 400); rows[3].val = null;
    const h = harness({sendTo: (instance, command, message, callback) => callback({result: rows})});
    assert.equal((await h.run("getTimeWeightedHistory('meter',0,900000)")).length, 0);
});
test('a full raw response is discarded and split before integrating; overlap is counted once', async () => {
    const calls = [];
    const h = harness({calls});
    h.run(`getHistory=async(id,start,end,power)=>{
        calls.push({start,end,power});
        const rows = end-start>900000 ? Array.from({length:10000},()=>({ts:0,val:9999}))
            : Array.from({length:17},(_,i)=>({ts:start-60000+i*60000,val:400}));
        rows.maxGapMs=95000; return rows;
    };`);
    const result = await h.run("getTimeWeightedHistory('dense',0,1800000)");
    assert.equal(calls.length, 3); assert.ok(calls.every(call => call.power));
    assert.equal(result.length, 2); assert.ok(result.every(row => row.val === 400));
});
test('an unprovably complete raw quarter fails explicitly rather than caching a biased average', async () => {
    const h = harness();
    h.run('getHistory=async()=>{const rows=Array.from({length:10000},()=>({ts:0,val:9999}));rows.maxGapMs=95000;return rows;};');
    await assert.rejects(h.run("getHistoryChunked('dense',0,900000)"), /Abfragelimit/);
    assert.equal(h.run("historySourceCache.get(CFG.sqlInstance+':dense:power').values.length"), 0);
});
test('daily raw chunks cover boundaries and a cached refresh reads only the overlapping tail', async () => {
    const calls = [], rows = heartbeats(-60000, 3 * DAY, 400);
    const h = harness({historySourceSettings: async () => ({enabled: true, changesRelogInterval: 60}),
        sendTo: (instance, command, message, callback) => {calls.push(message.options);
            callback({result: rows.filter(row => row.ts >= message.options.start && row.ts <= message.options.end)});}});
    const first = await h.run("getHistoryChunked('meter',0,2*86400000)");
    assert.equal(first.length, 192); assert.ok(first.every(row => row.val === 400)); assert.equal(calls.length, 2);
    const second = await h.run("getHistoryChunked('meter',86400000,3*86400000)");
    assert.equal(second.length, 192); assert.equal(new Set(second.map(row => row.ts)).size, 192);
    assert.equal(calls[2].start, 2 * DAY - 2 * STEP - 95000);
});
test('temperature keeps the average API and a separate cache from power at the same ID', async () => {
    const calls = [];
    const h = harness({sendTo: (instance, command, message, callback) => {calls.push(message.options);
        callback({result: message.options.aggregate === 'average' ? [{ts:450000,val:8.5}] : heartbeats(0, STEP, 400)});}});
    const temp = await h.run("getHistoryChunked('source',0,900000,'average')");
    const power = await h.run("getHistoryChunked('source',0,900000)");
    assert.equal(temp[0].val, 8.5); assert.equal(power[0].val, 400);
    assert.deepEqual(calls.map(call => call.aggregate), ['average', 'none']);
    assert.equal(calls[0].step, STEP); assert.equal(calls[0].start, 0);
});

test('recorded EHZ quarter removes sample-frequency bias without changing measured energy', () => {
    const evidence = require('../docs/evidence/time-weighted-ehz-2026-11-04.json');
    const result = aggregate(evidence.rows, evidence.from, evidence.to, 95000);
    assert.equal(result.length, 1);
    assert.ok(Math.abs(result[0].val - 54.95757777777778) < 1e-9);
    assert.ok(Math.abs(evidence.expectedPointMeanW - 282.42857142857144) < 1e-9);
    assert.ok(Math.abs(result[0].val / 4000 - 0.013739395) < 1e-9);
});


test('signed meter power is integrated before the existing total-load clamp', () => {
    const h = harness({meters: [aggregate(heartbeats(0, STEP, -1000)),
        aggregate(heartbeats(0, STEP, 3000))]});
    assert.equal(h.run('mergeSubmeterProfile(meters,[]).totalValues[0].val'), 2000);
});
test('invalid timestamps in a limit-sized reply cannot hide raw response truncation', async () => {
    let calls = 0;
    const h = harness({sendTo: (instance, command, message, callback) => {
        calls++;
        callback({result: message.options.end - message.options.start > 1000000
            ? Array.from({length:10000}, () => ({ts:'bad',val:10000}))
            : heartbeats(message.options.start + 95000, message.options.end, 400)});
    }});
    const result = await h.run("getTimeWeightedHistory('meter',0,1800000)");
    assert.equal(calls, 3); assert.equal(result.length, 2);
    assert.ok(result.every(row => row.val === 400));
});
