'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {LatestStateWriter, isDisplaySeries} = require('../lib/latest-state-writer');
const turn = () => new Promise(resolve => setImmediate(resolve));

test('a stalled display write retains only the newest replacement and one shared drain', async () => {
    const writes = []; let release;
    const writer = new LatestStateWriter(async (id, state) => {
        writes.push({id, state});
        if (writes.length === 1) await new Promise(resolve => {release = resolve;});
    });
    const drain = writer.enqueue('series', {val: 'initial', ts: 1});
    await turn();
    for (let i = 2; i <= 10002; i++)
        assert.equal(writer.enqueue('series', {val: 'x'.repeat(10000), ts: i}), drain);
    assert.equal(writer.entries.size, 1);
    assert.equal(writer.entries.get('series').latest.ts, 10002);
    assert.equal(writes.length, 1);
    release(); await drain;
    assert.deepEqual(writes.map(w => w.state.ts), [1, 10002]);
    assert.equal(writer.entries.size, 0);
});

test('failed display writes still drain the latest state, report failure and permit a new cycle', async () => {
    let reject; const writes = [];
    const writer = new LatestStateWriter(async (id, value) => {
        writes.push(value);
        if (writes.length === 1) await new Promise((_, fail) => {reject = fail;});
    });
    const first = writer.enqueue('a', {val: 1});
    const rejected = assert.rejects(first, /slow DB failed/);
    await turn(); writer.enqueue('a', {val: 2}); reject(Error('slow DB failed'));
    await rejected;
    assert.deepEqual(writes.map(w => w.val), [1, 2]);
    assert.equal(writer.entries.size, 0);
    await writer.enqueue('a', {val: 3});
    assert.equal(writes.at(-1).val, 3);
});

test('only acknowledged display JSON series qualify; safety, commands and records stay ordered', () => {
    for (const id of ['Forecast.PV_48h_JSON', 'Plan.Allocation_48h_JSON', 'Chart.Wallbox0_48h_json_chart'])
        assert.equal(isDisplaySeries(id, true), true, id);
    for (const id of ['Plan.Valid', 'Control.Targets.Wallbox0_W', 'System.RealOutputsEnabled',
        'Devices.MyPV_DHW.OutputReservationState_JSON', 'Debug.Shadow.DecisionRecord', 'Debug.Events_JSON',
        'Config.DataPointMap_JSON', 'Vehicles.Wallbox0.Release'])
        assert.equal(isDisplaySeries(id, true), false, id);
    assert.equal(isDisplaySeries('Plan.Allocation_48h_JSON', false), false);
});
