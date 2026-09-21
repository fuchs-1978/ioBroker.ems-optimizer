'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(initial = {}) {
    const clock = {now: Date.parse('2026-09-21T10:00:00Z')};
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [clock.now])); }
        static now() { return clock.now; }
    }
    const exported = {exports: {}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/debug-recorder.js'), 'utf8'), {
        module: exported, Date: Clock, Buffer,
        require: id => id.startsWith('./') ? require(path.join(__dirname, '../lib', id)) : require(id)
    });
    const cache = new Map();
    const writes = [];
    const definitions = new Map();
    const mapping = {DP_GRID_IMPORT: 'grid.import', DP_GRID_EXPORT: 'grid.export', DP_PV_POWER: 'pv.power',
        DP_WB2_POWER: 'go-e.2.power', DP_WB2_SOC: 'soc.eqe', DP_WB2_ALLOW: 'release.eqe',
        DP_DHW_OUTPUT1: 'ehz.1', DP_DHW_OUTPUT2: 'ehz.2', DP_DHW_OUTPUT3: 'ehz.3',
        DP_DHW_TEMP1: 'temperature.bottom'};
    const adapter = {
        namespace: 'ems.0', config: {wb2ConnectionId: 'go-e.2.connection', secretPassword: 'NEVER-EXPORT'},
        readMapping: () => mapping, getCachedState: id => cache.get(id) || null,
        queueCompatState: async (id, initialValue, common) => {
            assert.ok(id.startsWith('ems.0.Debug.'));
            definitions.set(id, common);
            if (!cache.has(id)) cache.set(id, {val: initialValue, ts: clock.now, ack: true});
        },
        setCompatState: (id, val, ack) => {
            assert.ok(id.startsWith('ems.0.Debug.'), `Non-debug write: ${id}`);
            writes.push({id, val, ack});
            cache.set(id, {val, ack, ts: clock.now});
            return Promise.resolve();
        }, log: {warn() {}},
        writeForeignStateGuarded() { assert.fail('Diagnostic foreign actuator write'); }
    };
    const put = (id, val, extra = {}) => cache.set(id, {val, ts: clock.now, ack: true, q: 0, ...extra});
    for (const [id, val] of Object.entries({'grid.import': 0, 'grid.export': 700, 'pv.power': 6000,
        'go-e.2.power': 4.14, 'soc.eqe': 30, 'release.eqe': 1, 'go-e.2.connection': true,
        'ehz.1': 1500, 'ehz.2': 0, 'ehz.3': 0, 'temperature.bottom': 60,
        'ems.0.Control.SelectedWallbox': 2, 'ems.0.System.RealOutputsEnabled': true,
        'ems.0.Control.Status': 'Regelung aktiv', 'ems.0.Devices.Wallbox2.OutputStatus': 'PRODUKTIV: 6 A',
        'ems.0.Devices.MyPV_DHW.OutputStatus': 'PRODUKTIV: 1500 W',
        'ems.0.Devices.MyPV_DHW.OutputActive': true, ...initial})) put(id, val);
    const recorder = new exported.exports(adapter);
    const change = (relative, val, extra) => {
        const id = `ems.0.${relative}`;
        const previous = cache.get(id);
        put(id, val, extra);
        recorder.capture(id, cache.get(id), previous);
    };
    const command = (key, val) => {
        const id = `ems.0.Debug.${key}`;
        put(id, val, {ack: false});
        return recorder.handleCommand(id, cache.get(id));
    };
    const json = key => JSON.parse(cache.get(`ems.0.Debug.${key}`).val);
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    return {adapter, recorder, cache, writes, definitions, clock, put, change, command, json, settle};
}

test('creates only own diagnostic states and exposes current values without credentials', async () => {
    const f = fixture();
    await f.recorder.initialize();
    await f.settle();
    assert.equal(f.definitions.size, 13);
    assert.equal(f.definitions.get('ems.0.Debug.Enabled').write, true);
    assert.equal(f.definitions.get('ems.0.Debug.Clear').role, 'button');
    const s = f.json('Snapshot_JSON');
    assert.equal(s.power.grid_W, -700);
    assert.equal(s.power.pv_W, 6000);
    assert.equal(s.wallboxes[2].actual_W, 4140);
    assert.equal(s.wallboxes[2].measurements.power.val, 4.14);
    assert.equal(s.wallboxes[2].measurements.power.unit, 'kW');
    assert.equal(s.ehz.actual_W, 1500);
    assert.ok(!JSON.stringify(s).includes('NEVER-EXPORT'));
    assert.ok(!JSON.stringify(s).includes('secretPassword'));
    assert.equal(f.json('Events_JSON')[0].type, 'session.start');
});

test('missing/blank/quality/ack/future measurement inputs remain unknown, never implicit zero', async () => {
    const f = fixture();
    await f.recorder.initialize();
    for (const extra of [{val: null}, {val: ''}, {val: ' '}, {val: 0, q: 64},
        {val: 0, ack: false}, {val: 0, ts: f.clock.now + 500}, {val: 0, ts: f.clock.now - 10001}]) {
        f.put('grid.export', extra.val, extra);
        const s = f.recorder.snapshot();
        assert.equal(s.power.grid_W, null);
        assert.equal(s.measurements.gridExport.valid, false);
    }
    f.cache.delete('ehz.2');
    assert.equal(f.recorder.snapshot().ehz.actual_W, null);
});

test('quality policies match static connection, user command, two-hour SoC and configured temperatures', async () => {
    const f = fixture();
    f.put('go-e.2.connection', true, {ts: f.clock.now - 86400000});
    f.put('release.eqe', 1, {ack: false, ts: f.clock.now - 86400000});
    f.put('soc.eqe', 30, {ts: f.clock.now - 7200001});
    f.put('temperature.bottom', 60, {ts: f.clock.now - 3000000});
    f.put('ems.0.Config.DHWTemperatureMaxAge_min', 60);
    const s = f.recorder.snapshot();
    assert.equal(s.wallboxes[2].measurements.connection.valid, true);
    assert.equal(s.wallboxes[2].measurements.userRelease.valid, true);
    assert.equal(s.wallboxes[2].measurements.userRelease.ackRequired, false);
    assert.equal(s.wallboxes[2].measurements.soc.valid, false);
    assert.equal(s.measurements.ehzTemperatures[0].valid, true);
    f.put('go-e.2.connection', true, {ack: false});
    assert.equal(f.recorder.snapshot().wallboxes[2].measurements.connection.valid, false);
});

test('captures short discrete start-stop edges before the next sample without per-edge DB writes', async () => {
    const f = fixture();
    await f.recorder.initialize();
    await f.settle();
    const before = f.writes.length;
    f.change('Devices.Wallbox2.OutputActive', true);
    f.clock.now += 1000;
    f.change('Devices.Wallbox2.OutputActive', false);
    f.change('Devices.Wallbox2.LastStopReason', 'Fahrzeug-SoC unbestaetigt');
    f.change('Devices.Wallbox2.LastStopAt', f.clock.now);
    assert.equal(f.writes.length, before);
    f.recorder.sample();
    await f.settle();
    const events = f.json('Events_JSON');
    assert.equal(events.filter(e => e.source === 'Devices.Wallbox2.OutputActive').length, 2);
    const stop = events.find(e => e.type === 'output.stop');
    assert.equal(stop.to, 'Fahrzeug-SoC unbestaetigt');
    assert.equal(stop.context.selectedWallbox, 2);
    assert.equal(stop.context.wallboxes[2].actual_W, 4140);
});

test('EHZ stop reason survives a stop and restart between samples', async () => {
    const f = fixture();
    await f.recorder.initialize();
    f.change('Devices.MyPV_DHW.OutputActive', false);
    f.change('Devices.MyPV_DHW.OutputCommand_W', 0);
    f.change('Devices.MyPV_DHW.OutputStatus', 'Abschaltbefehl gesendet: Netzbezug');
    f.clock.now += 1000;
    f.change('Devices.MyPV_DHW.OutputActive', true);
    f.change('Devices.MyPV_DHW.OutputStatus', 'PRODUKTIV: 1600 W');
    f.recorder.sample();
    await f.settle();
    const stop = f.json('Events_JSON').find(e => e.type === 'output.stop');
    assert.equal(stop.to, 'Abschaltbefehl gesendet: Netzbezug');
    assert.equal(stop.context.ehz.status, stop.to);
    assert.equal(stop.context.ehz.command_W, 0);
});

test('same-cycle output status overwrites and changing countdown numbers do not flood events', async () => {
    const f = fixture();
    await f.recorder.initialize();
    f.change('Devices.Wallbox2.OutputStatus', 'Warten auf EHZ: 3000 W');
    f.recorder.sample();
    const count = f.recorder.eventCount;
    for (let i = 0; i < 20; i++) {
        f.change('Devices.Wallbox2.OutputStatus', `PRODUKTIV: ${i + 6} A`);
        f.change('Devices.Wallbox2.OutputStatus', `Warten auf EHZ: ${3000 - i * 10} W`);
        f.change('Vehicles.Wallbox2.StartDelayRemaining_s', 120 - i);
        f.clock.now += 2000;
        f.recorder.sample();
    }
    assert.equal(f.recorder.eventCount, count);
    f.change('Devices.Wallbox2.OutputStatus', 'Warten auf WB1');
    f.recorder.sample();
    f.change('Devices.Wallbox2.OutputStatus', 'Warten auf WB0');
    f.recorder.sample();
    assert.equal(f.recorder.eventCount, count + 2);
});

test('rings are bounded and power samples are separate from important stop events', async () => {
    const f = fixture();
    await f.recorder.initialize();
    for (let i = 0; i < 300; i++) {
        f.clock.now += 5000;
        f.change('Control.SelectedWallbox', i % 3);
        f.recorder.sample();
    }
    await f.settle();
    const events = f.json('Events_JSON');
    const trace = f.json('PowerTrace_JSON');
    assert.equal(events.length, 100);
    assert.equal(trace.length, 120);
    assert.ok(f.recorder.eventCount > 100);
    assert.equal(trace[1].ts - trace[0].ts, 10000);
    assert.equal(events[0].timestamp, new Date(events[0].ts).toISOString());
});

test('restore retains event sessions, restores total count, and bounds loaded rings', async () => {
    const entries = Array.from({length: 130}, (_, i) => ({ts: Date.parse('2026-09-21T09:59:00Z') + i,
        session: 'older-session', type: 'state.change', source: 'Control.SelectedWallbox', from: 1, to: 2,
        context: {selectedWallbox: 2, unexpected: 'should not be restored'}}));
    const f = fixture({'ems.0.Debug.Events_JSON': JSON.stringify(entries), 'ems.0.Debug.EventCount': 500});
    await f.recorder.initialize();
    await f.settle();
    const events = f.json('Events_JSON');
    assert.equal(events.length, 100);
    assert.equal(events[0].session, 'older-session');
    assert.notEqual(events.at(-1).session, 'older-session');
    assert.ok(!JSON.stringify(events).includes('should not be restored'));
    assert.equal(f.recorder.eventCount, 501);
});

test('malformed and oversized persisted payloads are rejected without failing initialization', async () => {
    for (const raw of ['{', '{}', '[null,3,"bad"]', ' '.repeat(2 * 1024 * 1024 + 1)]) {
        const f = fixture({'ems.0.Debug.Events_JSON': raw});
        await f.recorder.initialize();
        assert.equal(f.recorder.initialized, true);
        assert.equal(f.recorder.events.length, 1);
        assert.equal(f.recorder.events[0].type, 'session.start');
    }
});

test('largest generated ring contexts can be restored after restart', async () => {
    const f = fixture();
    await f.recorder.initialize();
    for (let wb = 0; wb < 3; wb++) {
        f.put(`ems.0.Devices.Wallbox${wb}.OutputStatus`, 'x'.repeat(600));
        f.put(`ems.0.Devices.Wallbox${wb}.OutputFault`, 'x'.repeat(600));
    }
    f.put('ems.0.Devices.MyPV_DHW.OutputStatus', 'x'.repeat(600));
    const s = f.recorder.snapshot();
    for (let i = 0; i < 110; i++) f.recorder.record('reason.change', 'x'.repeat(600), 'a'.repeat(600), 'b'.repeat(600), s);
    const raw = JSON.stringify(f.recorder.events);
    assert.ok(Buffer.byteLength(raw) > 512000);
    const next = fixture({'ems.0.Debug.Events_JSON': raw});
    await next.recorder.initialize();
    assert.equal(next.recorder.events.length, 100);
    assert.equal(next.recorder.events[0].session, f.recorder.session);
});

test('disable freezes recording; reenable starts a fresh baseline without changing controls', async () => {
    const f = fixture();
    await f.recorder.initialize();
    await f.settle();
    f.command('Enabled', false);
    await f.settle();
    const count = f.recorder.eventCount;
    const writes = f.writes.length;
    f.change('Control.SelectedWallbox', 0);
    f.recorder.sample();
    await f.settle();
    assert.equal(f.recorder.eventCount, count);
    assert.equal(f.writes.length, writes);
    f.command('Enabled', true);
    await f.settle();
    assert.equal(f.recorder.events.at(-1).type, 'recording.enabled');
    assert.equal(f.json('Snapshot_JSON').control.SelectedWallbox, 0);
});

test('repeated clear and unchanged enabled commands are acknowledged every time', async () => {
    const f = fixture();
    await f.recorder.initialize();
    await f.settle();
    for (let i = 0; i < 2; i++) {
        f.command('Clear', true);
        await f.settle();
        assert.equal(f.cache.get('ems.0.Debug.Clear').val, false);
        assert.equal(f.cache.get('ems.0.Debug.Clear').ack, true);
        assert.deepEqual(f.json('Events_JSON'), []);
        assert.deepEqual(f.json('PowerTrace_JSON'), []);
        assert.equal(f.recorder.eventCount, 0);
        f.command('Enabled', true);
        await f.settle();
        assert.equal(f.cache.get('ems.0.Debug.Enabled').ack, true);
    }
    assert.equal(f.recorder.handleCommand('ems.0.Control.Enabled', {val: false, ack: false}), false);
});

test('persisted disabled setting neither samples nor rewrites old history during initialization', async () => {
    const f = fixture({'ems.0.Debug.Enabled': false, 'ems.0.Debug.Events_JSON': '[]'});
    await f.recorder.initialize();
    assert.equal(f.recorder.enabled, false);
    assert.equal(f.recorder.events.length, 0);
    assert.ok(!f.writes.some(w => w.id.endsWith('Snapshot_JSON') || w.id.endsWith('Events_JSON')));
});

test('slow persistence coalesces to one running write and one latest snapshot per state', async () => {
    const f = fixture();
    const blocked = new Map();
    const calls = [];
    f.adapter.setCompatState = (id, val) => {
        calls.push({id, val});
        return new Promise(resolve => blocked.set(id, resolve));
    };
    await f.recorder.initialize();
    const initial = calls.length;
    for (let i = 0; i < 200; i++) { f.clock.now += 5000; f.recorder.sample(); }
    assert.equal(calls.length, initial);
    assert.ok(f.recorder.writing.size <= 13);
    assert.ok(f.recorder.latest.size <= 13);
    const key = 'ems.0.Debug.Snapshot_JSON';
    blocked.get(key)();
    await f.settle();
    assert.equal(calls.filter(c => c.id === key).length, 2);
    assert.equal(JSON.parse(calls.filter(c => c.id === key).at(-1).val).ts, f.clock.now);
});

test('read, synchronous write and asynchronous DB failures are isolated', async () => {
    const f = fixture();
    await f.recorder.initialize();
    await f.settle();
    f.adapter.setCompatState = () => { throw new Error('DB down'); };
    assert.doesNotThrow(() => f.recorder.sample());
    f.adapter.setCompatState = () => Promise.reject(new Error('DB offline'));
    f.clock.now += 10000;
    f.recorder.sample();
    await f.settle();
    f.adapter.getCachedState = () => { throw new Error('Cache down'); };
    assert.doesNotThrow(() => f.recorder.sample());
    assert.doesNotThrow(() => f.recorder.capture('ems.0.Control.SelectedWallbox', {val: 0}));
    assert.doesNotThrow(() => f.recorder.stop());
});

test('unload during initialization prevents late recording and stop is idempotent', async () => {
    const f = fixture();
    f.adapter.unloading = true;
    await f.recorder.initialize();
    assert.equal(f.recorder.initialized, false);
    assert.equal(f.writes.length, 0);
    const active = fixture();
    await active.recorder.initialize();
    active.adapter.unloading = true;
    active.recorder.sample();
    active.recorder.stop('Test beendet');
    const count = active.recorder.eventCount;
    active.recorder.stop('Doppelt');
    active.recorder.sample();
    assert.equal(active.recorder.eventCount, count);
    assert.equal(active.recorder.events.at(-1).type, 'session.stop');
});

test('unknown selection is not labelled WBnull and invalid source list is bounded', async () => {
    const f = fixture();
    f.cache.delete('ems.0.Control.SelectedWallbox');
    f.put('ems.0.System.InvalidInputs_JSON', JSON.stringify(['grid.import fehlt']));
    await f.recorder.initialize();
    assert.ok(f.cache.get('ems.0.Debug.Summary').val.includes('Auswahl keine'));
    assert.deepEqual(f.json('Snapshot_JSON').system.invalidInputs, ['grid.import fehlt']);
});
