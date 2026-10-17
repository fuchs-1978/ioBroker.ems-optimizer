'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {HeaterWriteProof} = require('../lib/heater-write-proof');

// Load the real adapter and complete engine. Only ioBroker's database and
// physical Modbus transport are replaced; output checks, queues, callbacks,
// command observations and the VM receipt/status bridge all run unchanged.
async function fixture(holdS = 15) {
    let now = 2000000;
    const id = 'modbus.4.holdingRegisters.1000_Power';
    class Clock extends Date { static now() {return now;} }
    class Adapter {
        constructor() {
            this.namespace = 'ems.0';
            this.config = {globalWriteEnabled: true, dhwPresent: true, dhwControlEnabled: true,
                dhwSetpointId: id, dhwConnectionId: 'connection',
                dhwOutput1Id: 'o1', dhwOutput2Id: 'o2', dhwOutput3Id: 'o3',
                dhwHaL1CurrentId: 'h1', dhwHaL2CurrentId: 'h2', dhwHaL3CurrentId: 'h3',
                dhwTemp1Id: 't1', dhwTemp2Id: 't2', dhwTemp3Id: 't3', dhwTemp4Id: 't4',
                dhwOutletTempId: 'outlet', gridImportId: 'gridIn', gridExportId: 'gridOut'};
            this.log = Object.fromEntries(['warn', 'error', 'info', 'debug'].map(key => [key, () => {}]));
        }
        on() {}
    }
    const adapterModule = {exports: {}};
    const customRequire = name => name === '@iobroker/adapter-core' ? {Adapter}
        : name === 'node-schedule' ? {scheduleJob: () => ({cancel() {}})}
            : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'),
        {require: customRequire, module: adapterModule, __dirname: path.join(__dirname, '..'),
            Date: Clock, console, setTimeout, clearTimeout});
    const a = adapterModule.exports();
    a.setStateAsync = async () => {};
    a.setObjectNotExistsAsync = async () => {};
    a.getStateAsync = async () => null;
    a.heaterWriteProof = new HeaterWriteProof(a.namespace, () => now);
    a.heaterWriteProof.configure(id, {type: 'state', common: {type: 'number', read: false, write: true},
        native: {poll: false, regType: 'holdingRegs'}});
    a.allowedForeignWriteIds.add(id);
    const put = (key, val, extra = {}) => a.onStateChange(key, {val, ack: true, q: 0, ts: now, ...extra});
    const own = (key, val) => put(`ems.0.${key}`, val);
    for (const key of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid',
        'Devices.MyPV_DHW.Present', 'Devices.MyPV_DHW.ControlEnabled',
        'Devices.MyPV_DHW.DriverReady', 'Devices.MyPV_DHW.Release']) own(key, true);
    own('Control.Targets.MyPV_DHW_W', 9000);
    own('Config.DHWCommissioningMaxPower_W', 9000);
    own('Config.DHWSettleTimeout_s', holdS);
    const fresh = () => {
        for (const key of ['o1', 'o2', 'o3', 'h1', 'h2', 'h3', 'gridIn']) put(key, 0);
        for (const key of ['t1', 't2', 't3', 't4', 'outlet']) put(key, 50);
        put('connection', true);put('gridOut', 6100);
        own('System.LastUpdate', now);own('Control.LastUpdate', now);
    };
    fresh();
    await a.startEngine();
    const writes = [], inflight = [];
    a.setForeignStateAsync = (sink, watts, ack) => new Promise((resolve, reject) => {
        assert.equal(sink, id);assert.equal(ack, false);
        writes.push(watts);
        put(id, watts, {ack: false, from: 'system.adapter.ems.0'});
        inflight.push({resolve, reject});
    });
    const spinUntil = async predicate => {
        for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
        assert.ok(predicate(), 'queued actuator write reached the fake transport');
    };
    const tick = async (expectWrite = true) => {
        a.runEngine('updateDhwProductionOutput()');
        await a.flushOwnWrites();
        if (expectWrite) await spinUntil(() => inflight.length > 0);
        else for (let i = 0; i < 5; i++) await Promise.resolve();
        return inflight.length > 0;
    };
    const complete = async ({reset = true, error = null, from = 'system.adapter.modbus.4'} = {}) => {
        const write = inflight.shift();assert.ok(write);
        if (reset) {now++;put(id, null, {from});}
        if (error) write.reject(new Error(error));else write.resolve();
        await Promise.allSettled([...a.pendingForeignWrites]);
        await a.flushOwnWrites();
        for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const record = () => JSON.parse(a.getCachedState('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    const reserve = () => a.getCachedState('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val;
    const advance = (ms = 5000) => {now += ms;fresh();};
    const stop = async () => {
        await tick();await complete();
        assert.equal(writes[0], 3000, 'real productive guard accepted the initial heating command');
        own('Control.Targets.MyPV_DHW_W', 0);advance();
        await tick();await complete();
        assert.equal(reserve(), 3000, 'an unseen positive rise remains reserved after the stop receipt');
    };
    return {a, id, writes, put, own, fresh, advance, tick, complete, stop, record, reserve,
        refresh: () => a.runEngine("refreshHeaterReservation('MyPV_DHW', CFG.dp.myPvDhwOutputW, 3000)")};
}

test('productive 5-second tick/write/ACK path releases only a sustained correlated zero episode', async () => {
    const h = await fixture();await h.stop();
    for (let i = 0; i < 5; i++) {
        h.advance();await h.tick();
        if (i < 3) assert.equal(h.reserve(), 3000);
        await h.complete();
    }
    assert.equal(h.reserve(), 0);
    assert.deepEqual(h.writes, [3000, 0, 0, 0, 0, 0, 0], 'watchdog refresh writes continue every productive tick');
    const proof = h.record().lastReleaseProof;
    assert.equal(proof.kind, 'write-only-zero-receipt-and-electrical-plateau');
    assert.ok(proof.count >= 3);
    assert.ok(proof.lastSampleAt - proof.firstSampleAt >= 15000);
});

test('productive zero refreshes honor a longer reaction deadline without moving it on every write', async () => {
    const h = await fixture(60);await h.stop();
    for (let i = 0; i < 14; i++) {
        h.advance();await h.tick();await h.complete();
        if (i < 12) assert.equal(h.reserve(), 3000);
    }
    assert.equal(h.reserve(), 0);
    assert.ok(h.record().lastReleaseProof.lastSampleAt - h.record().lastReleaseProof.firstSampleAt >= 60000);
    assert.equal(h.writes.length, 16);
});

test('an open productive zero refresh suspends release until its own reset, transport and later measurements', async () => {
    const h = await fixture();await h.stop();
    for (let i = 0; i < 2; i++) {h.advance();await h.tick();await h.complete();}
    h.advance();await h.tick();
    const during = h.a.runEngine(`getHeaterWriteOnlyZeroStatus(${JSON.stringify(h.id)})`);
    assert.equal(during.status, 'pending');
    assert.ok(during.episode);
    h.advance(10000);h.refresh();
    assert.equal(h.reserve(), 3000, 'elapsed hold and new physical zeros cannot bypass the open transport');
    await h.complete();h.refresh();
    assert.equal(h.reserve(), 3000, 'pre-reset phase timestamps cannot finish the proof');
    h.advance();h.refresh();
    assert.equal(h.reserve(), 0, 'unambiguous same-zero suspension preserves the independently accrued plateau');
});

for (const fault of ['missing reset', 'foreign reset', 'transport error']) {
    test(`productive receipt integration retains the reserve after ${fault}`, async () => {
        const h = await fixture();await h.stop();
        h.advance();await h.tick();
        await h.complete(fault === 'missing reset' ? {reset: false}
            : fault === 'foreign reset' ? {from: 'system.adapter.javascript.0'} : {error: 'transport failed'});
        for (let i = 0; i < 5; i++) {h.advance();h.refresh();}
        assert.equal(h.reserve(), 3000);
        assert.equal(h.record().lastReleaseProof, undefined);
        const status = h.a.runEngine(`getHeaterWriteOnlyZeroStatus(${JSON.stringify(h.id)})`);
        assert.equal(status.status, fault === 'missing reset' ? 'pending' : 'blocked');
    });
}

for (const fault of ['delayed positive effect', 'NULL actual', 'bad phase quality', 'standing phase timestamp',
    'large sample gap', 'mapping changed', 'foreign numeric zero ACK']) {
    test(`productive repeated zero commands preserve uncertainty: ${fault}`, async () => {
        const h = await fixture();await h.stop();
        for (let i = 0; i < 2; i++) {h.advance();await h.tick();await h.complete();}
        const heldTs = h.a.getCachedState('o3').ts;
        if (fault === 'mapping changed') h.a.runEngine("CFG.dp.myPvDhwOutputW=['new1','new2','new3']");
        for (let i = 0; i < 5; i++) {
            h.advance(fault === 'large sample gap' ? 31000 : 5000);
            if (fault === 'delayed positive effect') h.put('o1', 1000);
            if (fault === 'NULL actual') h.put('o1', null);
            if (fault === 'bad phase quality') h.put('o2', 0, {q: 64});
            if (fault === 'standing phase timestamp') h.put('o3', 0, {ts: heldTs});
            if (fault === 'mapping changed') for (const key of ['new1', 'new2', 'new3']) h.put(key, 0);
            if (fault === 'foreign numeric zero ACK') {
                h.put(h.id, 0, {from: 'system.adapter.javascript.0'});h.refresh();
                assert.equal(h.reserve(), 3000, 'numeric ACK cannot bypass a blocked write-only receipt');
            }
            if (await h.tick(false)) await h.complete();
            assert.equal(h.reserve(), 3000);
        }
        assert.equal(h.record().lastReleaseProof, undefined);
    });
}

test('a positive intermediate productive command and its delayed physical effect restart the zero proof', async () => {
    const h = await fixture();await h.stop();
    for (let i = 0; i < 2; i++) {h.advance();await h.tick();await h.complete();}
    const initialEpisode = h.a.heaterWriteProof.zeroStatus(h.id, h.a.getCachedState(h.id)).episode.sequence;
    h.own('Control.Targets.MyPV_DHW_W', 1000);h.advance();await h.tick();await h.complete();
    assert.equal(h.writes.at(-1), 1000);
    h.own('Control.Targets.MyPV_DHW_W', 0);h.advance();await h.tick();await h.complete();
    for (let i = 0; i < 3; i++) {
        h.advance();if (i === 2) h.put('o1', 500);
        await h.tick();await h.complete();
        assert.equal(h.reserve(), 3000);
    }
    for (let i = 0; i < 3; i++) {
        h.advance();await h.tick();await h.complete();assert.equal(h.reserve(), 3000);
    }
    h.advance();await h.tick();await h.complete();
    assert.equal(h.reserve(), 0);
    assert.ok(h.record().lastReleaseProof.zeroEpisode.sequence > initialEpisode);
});

test('a new process cannot borrow its predecessor\'s partially collected electrical plateau', async () => {
    const h = await fixture();await h.stop();
    for (let i = 0; i < 2; i++) {h.advance();await h.tick();await h.complete();}
    const before = h.a.getCachedState('o1').ts;
    h.a.heaterWriteProof = new HeaterWriteProof(h.a.namespace, () => h.a.engineContext.Date.now());
    h.a.heaterWriteProof.configure(h.id, {type: 'state', common: {type: 'number', read: false, write: true},
        native: {poll: false, regType: 'holdingRegs'}});
    await h.a.startEngine();
    for (let i = 0; i < 4; i++) {
        h.advance();await h.tick();await h.complete();assert.equal(h.reserve(), 3000);
    }
    h.advance();await h.tick();await h.complete();
    assert.equal(h.reserve(), 0);
    assert.ok(h.record().lastReleaseProof.firstSampleAt > before);
});
