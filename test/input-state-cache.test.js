'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {InputStateCache} = require('../lib/input-state-cache');
const {GridMeasurement} = require('../lib/grid-measurement');
const sample = (val, ts, extra = {}) => ({val, ts, ack: true, q: 0, lc: 1, ...extra});
function fixture() {
    let now = 100000;
    const cache = new Map(), receipts = new Map(), logs = [];
    const input = new InputStateCache(cache, receipts, {now: () => now, log: s => logs.push(s)});
    return {cache, receipts, logs, input, advance: ms => {now += ms;}};
}
test('foreign cache rejects reversed source time without dispatch evidence or receipt renewal', () => {
    const h = fixture();
    h.input.accept('meter', sample(20, 90000));
    const receipt = h.receipts.get('meter'); h.advance(1000);
    assert.equal(h.input.accept('meter', sample(10, 80000, {lc: 99999})), false);
    assert.equal(h.cache.get('meter').val, 20);
    assert.equal(h.receipts.get('meter'), receipt);
    for (let i = 0; i < 100; i++) h.input.accept('meter', sample(10, 80000));
    assert.equal(h.logs.length, 1);
    assert.equal(h.input.report().rejected, 101);
});
test('late initial read cannot replace a subsequent event, including equal timestamp and deletion', () => {
    for (const state of [sample(2, 90000), null]) {
        const h = fixture(), read = h.input.beginRead();
        h.input.accept('meter', state);
        assert.equal(h.input.accept('meter', sample(1, 90000), 'initial-read', read), false);
        assert.equal(h.cache.get('meter')?.val, state?.val);
    }
});
test('equal source times allow legitimate value, ACK and quality changes; new ts refreshes unchanged values', () => {
    const h = fixture();
    for (const s of [sample(1, 90000), sample(2, 90000), sample(2, 90000, {ack: false}),
        sample(2, 90000, {q: 64}), sample(2, 91000)]) assert.equal(h.input.accept('meter', s), true);
    assert.equal(h.cache.get('meter').ts, 91000);
    assert.equal(h.cache.get('meter').lc, 1);
});
test('missing, invalid and far future ts invalidate cache without poisoning its valid watermark', () => {
    for (const ts of [undefined, null, 0, -1, NaN, Infinity, '99999', 102000]) {
        const h = fixture(); h.input.accept('meter', sample(1, 90000));
        assert.equal(h.input.accept('meter', sample(2, ts)), true);
        assert.equal(h.input.accept('meter', sample(3, 89000)), false);
        assert.equal(h.input.accept('meter', sample(4, 91000)), true);
        assert.equal(h.cache.get('meter').val, 4);
    }
});
test('deletion cannot be undone by an older event and rereading an old state never changes its ts', () => {
    const h = fixture(); h.input.accept('meter', sample(1, 90000)); h.input.accept('meter', null);
    assert.equal(h.input.accept('meter', sample(2, 89000)), false);
    h.input.accept('meter', sample(1, 90000)); h.advance(60000);
    h.input.accept('meter', sample(1, 90000), 'initial-read', h.input.beginRead());
    assert.equal(h.cache.get('meter').ts, 90000);
});
function gridFixture(mode = 'publication') {
    let now = 100000;
    const states = new Map([['import', sample(0, now)], ['export', sample(2000, now)]]);
    const reader = new GridMeasurement();
    return {states, reader, advance: ms => {now += ms;},
        read: () => reader.read(id => states.get(id), 'import', 'export', now, mode)};
}
test('publication-time pair reports bounded skew, shared receipt requires matching telegram ts', () => {
    for (const mode of ['publication', 'shared-receipt']) {
        const h = gridFixture(mode); h.states.set('import', sample(100, 99000));
        const r = h.read(); assert.equal(r.valid, mode === 'publication');
        assert.equal(r.skewMs, 1000); assert.equal(r.maxSkewMs, mode === 'publication' ? 5000 : 0);
    }
});
test('3.2 second split telegram publication holds original pair with no export credit, then recovers', () => {
    const h = gridFixture('shared-receipt'); const first = h.read();
    h.advance(3200); h.states.set('import', sample(1000, 103200));
    const held = h.read(); assert.equal(held.valid, true); assert.equal(held.held, true);
    assert.equal(held.gridW, 1000); assert.equal(held.exportW, 0);
    assert.deepEqual(held.sourceTs, first.sourceTs);
    h.states.set('export', sample(0, 103200));
    assert.equal(h.read().held, false); assert.equal(h.read().gridW, 1000);
});
test('held pair expires on original source time and invalid sources cannot use the hold', () => {
    for (const failure of ['age', 'quality', 'ack', 'missing', 'future']) {
        const h = gridFixture('shared-receipt'); h.read();
        h.advance(3200); h.states.set('import', sample(500, 103200));
        if (failure === 'age') h.advance(30000);
        if (failure === 'quality') h.states.set('import', sample(500, 103200, {q: 64}));
        if (failure === 'ack') h.states.set('import', sample(500, 103200, {ack: false}));
        if (failure === 'missing') h.states.delete('import');
        if (failure === 'future') h.states.set('import', sample(500, 200000));
        assert.equal(h.read().valid, false, failure);
    }
});
test('reading identical old grid samples does not keep them fresh', () => {
    const h = gridFixture(); assert.equal(h.read().valid, true);
    for (let i = 0; i < 31; i++) { h.advance(1000); h.read(); }
    assert.equal(h.read().valid, false);
});

test('a rejected future timestamp cannot become a watermark merely as wall time catches up', () => {
    const h = fixture(); h.input.accept('meter', sample(1, 90000));
    h.input.accept('meter', sample(2, 102000)); h.advance(3000);
    assert.equal(h.input.accept('meter', sample(3, 101000)), true);
    assert.equal(h.cache.get('meter').ts, 101000);
});

test('real VM queue guard rejects split-pair positive commands but always permits a safety zero', () => {
    const vm = require('node:vm');
    const {createEngineContext} = require('../lib/engine-loader');
    let now = 100000;
    const states = new Map([['import', sample(0, now)], ['export', sample(2000, now)],
        ['ems.0.Control.Targets.MyPV_DHW_W', sample(3000, now)]]);
    const ctx = createEngineContext('ems.0', {DP_GRID_IMPORT: 'import', DP_GRID_EXPORT: 'export'}, {
        nativeConfig: {gridPairTimestampMode: 'shared-receipt'},
        Date: class extends Date {static now() {return now;}},
        getState: id => states.get(id), existsState: id => states.has(id)
    });
    vm.runInContext('currentConsumptionLimit=()=>({valid:true,active:false,budgetW:null}); realtimeGridMeasurement()', ctx);
    now += 3200; states.set('import', sample(500, now));
    const result = vm.runInContext('checkQueuedElectricalOutput("MyPV_DHW",3000)', ctx);
    assert.equal(result.allowed, false); assert.match(result.reason, /Zeitbezug/);
    assert.equal(vm.runInContext('checkQueuedElectricalOutput("MyPV_DHW",0).allowed', ctx), true);
    assert.equal(vm.runInContext('realtimeGridMeasurement().exportW', ctx), 0);
});
