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

test('SunEnergy head diagnostics require every coherent source and never export private replies', () => {
    const f = fixture();
    Object.assign(f.adapter.config, {batteryDispatchMode: 'sunenergy-heads', batteryHeadCount: 2,
        batterySunEnergyInstance: 'sunenergyxt500.0', batterySocId: 'old.soc', batteryPowerId: 'old.dc'});
    f.adapter.readMapping = () => ({DP_BATTERY_SOC: 'sunenergyxt500.0.total.soc',
        DP_BATTERY_POWER: 'sunenergyxt500.0.total.batteryPower'});
    f.put('old.soc', 99); f.put('old.dc', 5000);
    f.put('sunenergyxt500.0.total.soc', 50); f.put('sunenergyxt500.0.total.batteryPower', 1001);
    const report = (index, GP, SC) => {
        const base = `sunenergyxt500.0.heads.${index}`;
        f.put(`${base}.info.online`, true);
        f.put(`${base}.info.rawResponse`, JSON.stringify({state: {reported: {
            GP, GS: GP, SC, ON: 1, MM: 0, LM: 1, MG: 800, IS: 2400,
            LP: 0, SI: 10, SA: 100, PK: 1, privateAddress: 'PRIVATE-HEAD-CONFIG'}}}));
    };
    report(1, -600, 30); report(2, -400, 70);
    f.put('ems.0.Devices.Battery.Profile.Capacity_kWh', 4.8);
    f.put('ems.0.Devices.Battery.Profile.CapacityValid', true);
    f.put('ems.0.Devices.Battery.Profile.OldestSourceAt', f.clock.now - 2000);
    let snapshot = f.recorder.snapshot();
    assert.equal(snapshot.battery.actual_W, 1000);
    assert.equal(snapshot.battery.soc_pct, 50);
    assert.equal(snapshot.battery.measurements.soc.id, 'sunenergyxt500.0.total.soc');
    assert.equal(snapshot.battery.measurements.dcPower.id, 'sunenergyxt500.0.total.batteryPower');
    assert.equal(snapshot.battery.deviceProfile.Capacity_kWh, 4.8);
    assert.equal(snapshot.battery.deviceProfile.CapacityValid, true);
    assert.equal(snapshot.battery.deviceProfile.OldestSourceAt, f.clock.now - 2000);
    assert.equal(snapshot.battery.headFeedback.heads[0].reportedGS_W, -600);
    assert.equal(snapshot.battery.headFeedback.heads[0].manualMode, 0);
    assert.equal(snapshot.battery.headFeedback.heads[0].localMode, 1);
    assert.equal(JSON.stringify(snapshot).includes('PRIVATE-HEAD-CONFIG'), false);
    const second = 'sunenergyxt500.0.heads.2.info.rawResponse';
    f.put(second, f.cache.get(second).val, {ts: f.clock.now - 30001});
    f.put('sunenergyxt500.0.info.lastUpdate', new Date(f.clock.now).toISOString());
    snapshot = f.recorder.snapshot();
    assert.equal(snapshot.battery.actual_W, null);
    assert.equal(snapshot.battery.soc_pct, null);
    assert.equal(snapshot.battery.headFeedback.heads[1].valid, false);
    assert.equal(snapshot.battery.headFeedback.heads[1].actual_W, null);
    assert.equal(snapshot.battery.headFeedback.heads[0].actual_W, 600);
});

test('creates only own diagnostic states and exposes current values without credentials', async () => {
    const f = fixture();
    await f.recorder.initialize();
    await f.settle();
    assert.equal(f.definitions.size, 17);
    for (const id of ['Battery', 'Heating', 'HeatPump', 'Coordination'])
        assert.ok(f.definitions.has(`ems.0.Debug.${id}.Summary`));
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
        {val: 0, ack: false}, {val: 0, ts: f.clock.now + 500}, {val: 0, ts: f.clock.now - 30001}]) {
        f.put('grid.export', extra.val, extra);
        const s = f.recorder.snapshot();
        assert.equal(s.power.grid_W, null);
        assert.equal(s.measurements.gridExport.valid, false);
    }
    f.cache.delete('ehz.2');
    assert.equal(f.recorder.snapshot().ehz.actual_W, null);
});

test('diagnostic snapshot preserves the complete heater reservation witness and original source state', () => {
    const f = fixture();
    const id = 'ems.0.Devices.MyPV_DHW.OutputReservationState_JSON';
    const witness = {highW: [3000, 0, 0], riseAt: [f.clock.now - 60000, 0, 0],
        seenAt: [0, 0, 0], commandW: [0, 0, 0], commandAt: f.clock.now - 20000,
        zeroWriteAt: f.clock.now - 19000, ids: ['ehz.1', 'ehz.2', 'ehz.3'], sinkId: 'ehz.setpoint'};
    f.put(id, JSON.stringify(witness), {ts: f.clock.now - 18000, lc: f.clock.now - 19000, ack: false, q: 64});
    const original = structuredClone(f.cache.get(id));
    const snapshot = f.recorder.snapshot();
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.ehz.reservationState)), witness);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.ehz.reservationSource)), {id, state: original});
    f.cache.get(id).val = null;
    assert.deepEqual(snapshot.ehz.reservationSource.state, original, 'snapshot must not share mutable cache objects');
    const unknown = f.recorder.snapshot();
    assert.equal(unknown.ehz.reservationState, null);
    assert.equal(unknown.ehz.reservationSource.state.val, null, 'observed NULL remains an observed NULL');
    f.cache.delete(id);
    assert.equal(f.recorder.snapshot().ehz.reservationSource.state, null, 'absent source is not a zero witness');
});

test('source witnesses clone in an isolated VM without a global structuredClone and retain undefined metadata', () => {
    const f = fixture();
    const id = 'heater.original';
    f.put(id, null, {lc: f.clock.now - 1000, ack: false, q: undefined,
        metadata: {origin: ['driver', 'bus']}});
    const original = structuredClone(f.cache.get(id));
    const witness = f.recorder.sourceState(id);
    assert.deepEqual(witness.state, original);
    assert.equal(Object.hasOwn(witness.state, 'q'), true);
    assert.equal(witness.state.q, undefined);
    f.cache.get(id).metadata.origin[0] = 'changed';
    assert.deepEqual(witness.state, original);
    assert.equal(witness.state.val, null);
});

test('snapshot exposes version, manual priority provenance and retained vehicle inputs without rewriting source metadata', () => {
    const f = fixture();
    const mapping = {...f.adapter.readMapping(), DP_WB_PRIORITY: 'priority.request',
        DP_WB2_TARGET: 'target.eqe', DP_WB2_MIN_SOC: 'minimum.eqe', DP_WB2_PHASES: 'phase.eqe',
        DP_WB2_RELEASE: 'release.derived', DP_WB2_AMIN: 'minimum.current'};
    f.adapter.readMapping = () => mapping;
    Object.assign(f.adapter.config, {wallboxPriority: -2, wallboxPrioritySource: 'external'});
    f.put('ems.0.System.Version', '0.17.0-alpha.71', {lc: f.clock.now - 30000});
    f.put('priority.request', 2, {ack: false, lc: f.clock.now - 20000});
    f.put('ems.0.Control.WallboxPrioritySource', 'extern: priority.request');
    f.put('target.eqe', 80, {ack: false, lc: f.clock.now - 10000});
    f.put('minimum.eqe', 20, {ack: true, lc: f.clock.now - 9000});
    f.put('phase.eqe', 3, {ack: true, lc: f.clock.now - 8000});
    f.put('release.derived', null, {ack: false, q: 64, lc: f.clock.now - 7000});
    f.put('minimum.current', 6, {ack: false, lc: f.clock.now - 6000});
    const snapshot = JSON.parse(JSON.stringify(f.recorder.snapshot()));
    assert.equal(snapshot.system.Version, '0.17.0-alpha.71');
    assert.deepEqual(snapshot.safetyConfig, {fuseA: 50, reserveA: 4, increaseLimitA: 46,
        par14aLimitW: 4200, par14aActiveHigh: true});
    assert.deepEqual(snapshot.system.versionSource.state, f.cache.get('ems.0.System.Version'));
    assert.deepEqual(snapshot.control.priorityRequest, {configuredValue: -2, configuredSource: 'external',
        effectiveSource: 'extern: priority.request', external: {id: 'priority.request', state: f.cache.get('priority.request')}});
    const inputs = snapshot.wallboxes[2].inputSources;
    for (const [key, id] of Object.entries({userRelease: 'release.eqe', soc: 'soc.eqe', targetSoc: 'target.eqe',
        minimumSoc: 'minimum.eqe', release: 'release.derived', configuredPhases: 'phase.eqe', manualMinimumCurrent: 'minimum.current'}))
        assert.deepEqual(inputs[key], {id, state: f.cache.get(id)});
    assert.equal(snapshot.wallboxes[2].measurements.soc.lc, null, 'missing lc must remain missing');
    assert.equal(snapshot.wallboxes[2].measurements.userRelease.ack, true);
    assert.equal(JSON.stringify(snapshot).includes('NEVER-EXPORT'), false);
});

test('derived PV accepts fresh ack=false only for its measurement contract; grid ACK and PV quality remain binding', () => {
    const f = fixture(); f.put('pv.power', 6000, {ack: false});
    let s = f.recorder.snapshot();
    assert.equal(s.power.pv_W, 6000); assert.equal(s.measurements.pv.ack, false);
    assert.equal(s.measurements.pv.ackRequired, false);
    f.put('grid.import', 0, {ack: false});
    assert.equal(f.recorder.snapshot().power.grid_W, null);
    for (const extra of [{q: 64}, {ts: f.clock.now - 120001}, {val: null}, {val: ''}]) {
        f.put('pv.power', 6000, {ack: false, ...extra}); s = f.recorder.snapshot();
        assert.equal(s.power.pv_W, null); assert.equal(s.measurements.pv.valid, false);
    }
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
    assert.ok(f.recorder.writing.size <= 17);
    assert.ok(f.recorder.latest.size <= 17);
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

function configureBattery(f) {
    const instance = 'sunenergyxt500.0';
    Object.assign(f.adapter.config, {
        batterySetpointId: `${instance}.heads.0.control.GS`,
        batteryHeartbeatId: `${instance}.info.lastUpdate`,
        batteryOnlineId: `${instance}.heads.0.online`,
        batteryManualModeId: `${instance}.heads.0.control.MM`,
        batteryLocalModeId: `${instance}.heads.0.control.LM`,
        batteryPowerId: `${instance}.total.batteryPower`,
        batteryAcPowerId: `${instance}.total.gridPower`,
        batterySocId: `${instance}.total.soc`, batteryPowerSign: 1
    });
    f.put(f.adapter.config.batteryHeartbeatId, f.clock.now);
    f.put(f.adapter.config.batteryOnlineId, true);
    f.put(f.adapter.config.batteryManualModeId, false);
    f.put(f.adapter.config.batteryLocalModeId, true);
    f.put(f.adapter.config.batteryPowerId, 243);
    f.put(f.adapter.config.batteryAcPowerId, -250);
    f.put(f.adapter.config.batterySocId, 70);
    f.put('ems.0.Devices.Battery.SingleHeadVerified', true);
    f.put('ems.0.Devices.Battery.OutputCommand_W', -200);
    f.put('ems.0.Devices.Battery.OutputCommandInternal_W', 200);
    f.put('ems.0.Control.Targets.Battery_W', 300);
}

test('battery snapshot and trace distinguish internal charging watts from the GS discharge convention', async () => {
    const f = fixture();
    configureBattery(f);
    await f.recorder.initialize();
    await f.settle();
    const s = f.json('Snapshot_JSON');
    assert.equal(s.schemaVersion, 2);
    assert.equal(s.battery.actual_W, 250);
    assert.equal(s.battery.measurements.power.val, -250);
    assert.equal(s.battery.measurements.dcPower.val, 243);
    assert.equal(s.battery.signConvention.measuredACPowerMultiplier, -1);
    assert.equal(s.battery.OutputCommand_W, -200);
    assert.equal(s.battery.OutputCommandInternal_W, 200);
    assert.equal(s.battery.target_W, 300);
    assert.equal(s.battery.soc_pct, 70);
    assert.match(s.battery.signConvention.actualAndInternal, /positive = charge/);
    assert.match(s.battery.signConvention.requestedAndGS, /positive = discharge/);
    const trace = f.json('PowerTrace_JSON')[0];
    assert.equal(trace.battery.actual_W, 250);
    assert.equal(trace.battery.commandGS_W, -200);
    assert.equal(trace.battery.commandInternal_W, 200);
    f.adapter.config.batteryPowerSign = -1;
    assert.equal(f.recorder.snapshot().battery.actual_W, 250);
    f.adapter.config.batteryPowerSign = 0;
    assert.equal(f.recorder.snapshot().battery.actual_W, 250);
});

test('only a verified matching battery driver heartbeat can validate old unchanged total measurements', () => {
    const f = fixture();
    configureBattery(f);
    f.put(f.adapter.config.batteryAcPowerId, -250, {ts: f.clock.now - 86400000});
    f.put(f.adapter.config.batterySocId, 70, {ts: f.clock.now - 86400000});
    f.put(f.adapter.config.batteryHeartbeatId, new Date(f.clock.now).toISOString());
    let battery = f.recorder.snapshot().battery;
    assert.equal(battery.actual_W, 250);
    assert.equal(battery.measurements.heartbeat.valid, true);
    assert.equal(battery.measurements.power.validatedByHeartbeat, true);
    assert.equal(battery.measurements.power.ageMs, 86400000);
    f.put('ems.0.Devices.Battery.SingleHeadVerified', false);
    battery = f.recorder.snapshot().battery;
    assert.equal(battery.actual_W, null);
    assert.equal(battery.measurements.power.driverBound, false);
    f.put('ems.0.Devices.Battery.SingleHeadVerified', true);
    f.adapter.config.batteryManualModeId = 'sunenergyxt500.0.heads.1.control.MM';
    assert.equal(f.recorder.snapshot().battery.actual_W, null);
    f.adapter.config.batteryManualModeId = 'sunenergyxt500.0.heads.0.control.MM';
    f.put(f.adapter.config.batteryHeartbeatId, f.clock.now - 31000);
    assert.equal(f.recorder.snapshot().battery.actual_W, null);
});

test('heating and heat-pump quality show shared cooling heartbeat proof and independent thermal sensors', async () => {
    const f = fixture();
    Object.assign(f.adapter.config, {heatingCoolingActiveId: 'isg.cooling',
        heatingCoolingHeartbeatId: 'isg.lastUpdate', heatingTempId: 'tank.heating',
        heatingConnectionId: 'modbus.heating.connected', heatingOutput1Id: 'heating.l1',
        heatingOutput2Id: 'heating.l2', heatingOutput3Id: 'heating.l3'});
    f.put('isg.cooling', false, {ts: f.clock.now - 86400000});
    f.put('isg.lastUpdate', f.clock.now);
    f.put('tank.heating', 45, {ts: f.clock.now - 3500000});
    f.put('modbus.heating.connected', true, {ts: f.clock.now - 86400000});
    f.put('heating.l1', 1500);
    f.put('heating.l2', 500);
    f.put('heating.l3', 0);
    await f.recorder.initialize();
    let s = f.recorder.snapshot();
    assert.equal(s.heating.actual_W, 2000);
    assert.equal(s.heating.measurements.cooling.validatedByHeartbeat, true);
    assert.equal(s.heating.measurements.temperature.valid, true);
    assert.equal(s.heating.measurements.connection.valid, true);
    assert.equal(s.heatPump.measurements.bufferTemperature.id, 'tank.heating');
    assert.equal(s.heatPump.measurements.dhwTemperature.id, null);
    assert.equal(s.heatPump.adviceOnly, true);
    f.put('isg.lastUpdate', f.clock.now - 121000);
    f.put('isg.cooling', false);
    s = f.recorder.snapshot();
    assert.equal(s.heating.measurements.cooling.valid, false);
    assert.equal(s.heatPump.measurements.cooling.valid, false);
    f.put('heating.l3', '', {ack: false});
    assert.equal(f.recorder.snapshot().heating.actual_W, null);
});

test('battery and heating stop causes survive rapid restart without additional recorder actuation', async () => {
    const f = fixture();
    configureBattery(f);
    f.put('ems.0.Devices.Battery.OutputActive', true);
    await f.recorder.initialize();
    f.change('Devices.Battery.OutputActive', false);
    f.change('Devices.Battery.OutputStatus', 'Speicher-Heartbeat veraltet');
    f.change('Devices.Battery.OutputActive', true);
    f.change('Devices.Battery.OutputStatus', 'PRODUKTIV: 100 W');
    f.change('Devices.MyPV_Heating.LastStopReason', 'Kuehlbetrieb aktiv');
    f.change('Devices.MyPV_Heating.LastStopAt', f.clock.now);
    f.change('Devices.MyPV_Heating.OutputActive', false);
    f.change('Devices.MyPV_Heating.OutputStatus', 'Abschaltbefehl gesendet');
    f.change('Devices.MyPV_Heating.OutputActive', true);
    f.change('Devices.MyPV_Heating.OutputStatus', 'PRODUKTIV: 500 W');
    f.recorder.sample();
    await f.settle();
    const stops = f.json('Events_JSON').filter(event => event.type === 'output.stop');
    assert.ok(stops.some(event => event.source === 'Devices.Battery.OutputActive'
        && event.to === 'Speicher-Heartbeat veraltet'));
    assert.ok(stops.some(event => event.source === 'Devices.MyPV_Heating.LastStopAt'
        && event.to === 'Kuehlbetrieb aktiv'));
    assert.ok(f.writes.every(write => write.id.startsWith('ems.0.Debug.')));
});

test('WP holding countdown does not flood events; coordination changes remain identifiable', async () => {
    const f = fixture();
    await f.recorder.initialize();
    f.change('Devices.HeatPump.RequestedMode', 'BOOST');
    f.change('Devices.HeatPump.AdviceReason', 'Haltezeit noch 300 s; nur Empfehlung');
    f.change('Control.FineRegulator', 'Battery');
    f.change('Control.CoordinationStatus', 'Batterie 200 W; EHZ 1800 W');
    f.recorder.sample();
    const count = f.recorder.eventCount;
    for (let i = 0; i < 10; i++) {
        f.change('Devices.HeatPump.HoldRemaining_s', 300 - i);
        f.change('Devices.HeatPump.AdviceLastUpdate', f.clock.now);
        f.change('Devices.HeatPump.AdviceReason', `Haltezeit noch ${300 - i} s; nur Empfehlung`);
        f.change('Control.CoordinationStatus', `Batterie ${200 + i} W; EHZ ${1800 - i} W`);
        f.recorder.sample();
    }
    assert.equal(f.recorder.eventCount, count);
    f.change('Control.FineRegulator', 'MyPV_DHW');
    f.recorder.sample();
    await f.settle();
    assert.equal(f.recorder.eventCount, count + 1);
    const event = f.json('Events_JSON').at(-1);
    assert.equal(event.source, 'Control.FineRegulator');
    assert.equal(event.to, 'MyPV_DHW');
    assert.equal(event.context.heatPump.mode, 'BOOST');
});

test('missing price is not exported as zero-price authorization', () => {
    const f = fixture();
    f.put('ems.0.Control.CurrentTotalPrice_ct_kWh', 0);
    f.put('ems.0.Control.ThermalPriceValid', false);
    assert.equal(f.recorder.snapshot().coordination.CurrentTotalPrice_ct_kWh, null);
    f.put('ems.0.Control.ThermalPriceValid', true);
    assert.equal(f.recorder.snapshot().coordination.CurrentTotalPrice_ct_kWh, 0);
});

test('alpha16 history restores unchanged while missing extension context remains explicitly unknown', async () => {
    const ts = Date.parse('2026-09-21T09:59:55Z');
    const context = {selectedWallbox: 2, grid_W: -500, pv_W: 5000,
        wallboxes: [{wb: 2, actual_W: 4140}], ehz: {actual_W: 300}};
    const f = fixture({
        'ems.0.Debug.Events_JSON': JSON.stringify([{ts, session: 'alpha16', type: 'output.stop',
            source: 'Devices.Wallbox2.LastStopAt', to: 'Alte Begruendung', context}]),
        'ems.0.Debug.PowerTrace_JSON': JSON.stringify([{ts, session: 'alpha16', ...context}])
    });
    await f.recorder.initialize();
    await f.settle();
    const old = f.json('Events_JSON')[0];
    assert.equal(old.session, 'alpha16');
    assert.equal(old.to, 'Alte Begruendung');
    assert.equal(old.context.ehz.actual_W, 300);
    assert.equal(old.context.battery.actual_W, null);
    assert.equal(old.context.coordination.FineRegulator, null);
    const oldTrace = f.json('PowerTrace_JSON')[0];
    assert.equal(oldTrace.grid_W, -500);
    assert.equal(oldTrace.heatPump.mode, null);
});

test('large UTF-8 extension histories stay within the restart byte budget and preserve the latest events', async () => {
    const f = fixture();
    await f.recorder.initialize();
    await f.settle();
    for (const id of ['Devices.Wallbox0.OutputStatus', 'Devices.Wallbox0.OutputFault',
        'Devices.Wallbox1.OutputStatus', 'Devices.Wallbox1.OutputFault',
        'Devices.Wallbox2.OutputStatus', 'Devices.Wallbox2.OutputFault',
        'Devices.MyPV_DHW.OutputStatus', 'Devices.Battery.OutputStatus', 'Devices.Battery.Fault',
        'Devices.MyPV_Heating.OutputStatus', 'Devices.MyPV_Heating.OutputFault',
        'Devices.HeatPump.AdviceReason', 'Control.CoordinationStatus',
        'Control.ThermalPriceSource', 'Control.ThermalPricePolicyStatus'])
        f.put(`ems.0.${id}`, '漢'.repeat(600));
    const s = f.recorder.snapshot();
    for (let i = 0; i < 100; i++) f.recorder.record('reason.change', `test.${i}`, '漢'.repeat(600), '漢'.repeat(600), s);
    f.recorder.trace = Array.from({length: 120}, () => ({ts: s.ts, timestamp: s.timestamp,
        session: f.recorder.session, ...f.recorder.context(s)}));
    f.recorder.publishHistory();
    await f.settle();
    const eventRaw = f.cache.get('ems.0.Debug.Events_JSON').val;
    const traceRaw = f.cache.get('ems.0.Debug.PowerTrace_JSON').val;
    assert.ok(Buffer.byteLength(eventRaw) <= 2 * 1024 * 1024);
    assert.ok(Buffer.byteLength(traceRaw) <= 2 * 1024 * 1024);
    assert.ok(f.recorder.events.length > 0 && f.recorder.events.length < 100);
    assert.equal(f.json('Events_JSON').at(-1).source, 'test.99');
    const next = fixture({'ems.0.Debug.Events_JSON': eventRaw, 'ems.0.Debug.PowerTrace_JSON': traceRaw});
    await next.recorder.initialize();
    assert.ok(next.recorder.events.some(event => event.source === 'test.99'));
    assert.ok(next.recorder.trace.some(item => item.session === f.recorder.session));
});

test('DC battery telemetry cannot substitute for mandatory selected-head GP feedback', () => {
    const f = fixture();
    configureBattery(f);
    f.put(f.adapter.config.batteryAcPowerId, 100);
    f.put(f.adapter.config.batteryPowerId, -90);
    assert.equal(f.recorder.snapshot().battery.actual_W, -100);
    f.adapter.config.batteryAcPowerId = f.adapter.config.batteryPowerId;
    let battery = f.recorder.snapshot().battery;
    assert.equal(battery.actual_W, null);
    assert.equal(battery.measurements.power.acceptedAsGSFeedback, false);
    f.adapter.config.batteryAcPowerId = '';
    assert.equal(f.recorder.snapshot().battery.actual_W, null);
    f.adapter.config.batteryAcPowerId = 'sunenergyxt500.0.heads.0.grid.GP';
    f.put(f.adapter.config.batteryAcPowerId, -200);
    f.put('ems.0.Devices.Battery.SingleHeadVerified', false);
    battery = f.recorder.snapshot().battery;
    assert.equal(battery.actual_W, 200);
    assert.equal(battery.measurements.power.acceptedAsGSFeedback, true);
});

test('unobserved-command power reservations stay visible at zero target without numeric event floods', async () => {
    const f = fixture();
    configureBattery(f);
    f.put(f.adapter.config.batteryAcPowerId, 0);
    for (const id of ['ehz.1', 'ehz.2', 'ehz.3']) f.put(id, 0);
    f.put('ems.0.Devices.Battery.OutputCommand_W', 0);
    f.put('ems.0.Devices.Battery.OutputCommandInternal_W', 0);
    f.put('ems.0.Devices.MyPV_DHW.OutputCommand_W', 0);
    f.put('ems.0.Devices.MyPV_Heating.OutputCommand_W', 0);
    await f.recorder.initialize();
    f.change('Devices.MyPV_DHW.OutputReservationPending', true);
    f.change('Devices.MyPV_Heating.OutputReservationPending', true);
    const events = f.recorder.eventCount;
    f.change('Devices.Battery.OutputReservedCharge_W', 2000);
    f.change('Devices.Battery.OutputUnobservedCommand_W', 2000);
    f.change('Devices.Battery.OutputUnobservedCommandSince', f.clock.now);
    for (const device of ['MyPV_DHW', 'MyPV_Heating']) {
        f.change(`Devices.${device}.OutputReservedPower_W`, 3000);
        f.change(`Devices.${device}.OutputReservedPhase1_W`, 3000);
        f.change(`Devices.${device}.OutputReservedPhase2_W`, 0);
        f.change(`Devices.${device}.OutputReservedPhase3_W`, 0);
    }
    f.clock.now += 10000;
    f.recorder.sample();
    await f.settle();
    const s = f.json('Snapshot_JSON');
    assert.equal(s.battery.actual_W, 0);
    assert.equal(s.battery.OutputCommandInternal_W, 0);
    assert.equal(s.battery.OutputReservedCharge_W, 2000);
    assert.equal(s.battery.OutputUnobservedCommand_W, 2000);
    assert.equal(s.ehz.actual_W, 0);
    assert.equal(s.ehz.OutputReservedPower_W, 3000);
    assert.equal(s.heating.OutputReservedPhase1_W, 3000);
    assert.equal(f.recorder.eventCount, events);
    const trace = f.json('PowerTrace_JSON').at(-1);
    assert.equal(trace.battery.reservedCharge_W, 2000);
    assert.equal(trace.ehz.reservedPower_W, 3000);
    assert.equal(trace.heating.reservedPhase1_W, 3000);
    assert.ok(f.cache.get('ems.0.Debug.Battery.Summary').val.includes('reservierte Ladung 2000 W'));
});


test('grid diagnostic accepts SMA age up to 30 seconds and rejects older readings', async () => {
    const f = fixture(); await f.recorder.initialize();
    for (const ageMs of [12000, 30000, 30001]) {
        for (const id of ['grid.import', 'grid.export']) f.put(id, 0, {ts: f.clock.now - ageMs});
        const s = f.recorder.snapshot();
        for (const key of ['gridImport', 'gridExport']) {
            assert.equal(s.measurements[key].maxAgeMs, 30000);
            assert.equal(s.measurements[key].valid, ageMs <= 30000);
        }
        assert.equal(s.power.grid_W, ageMs <= 30000 ? 0 : null);
    }
});

test('parallel planned allocations retain floors and limits independently from real outputs', async () => {
    const allocation = {schema: 1, timestamp: 12345, valid: true, order: [0, 1, 2], budgetW: 10000, hardBudgetW: 12000,
        slowBudgetW: 11000, voltage: 240,
        allocations: [{wb: 0, authorized: true, targetA: 32, phases: 1, reservedW: 7360, minimumW: 1380},
            {wb: 1, authorized: true, targetA: 11, phases: 1, reservedW: 2530, minimumW: 1380}],
        waiting: [{wb: 2, reason: 'Kein Fahrzeug angeschlossen'}], secret: 'NEVER-EXPORT'};
    const f = fixture({'ems.0.Config.WallboxParallelChargingEnabled': true,
        'ems.0.Control.ActiveWallboxes_JSON': '[0,1]',
        'ems.0.Control.ParallelWallboxAllocation_JSON': JSON.stringify(allocation),
        'ems.0.Control.ParallelWallboxStatus': 'Mindestladung reserviert; restliche Leistung nach Prioritaet',
        'ems.0.Devices.Wallbox0.OutputActive': true, 'ems.0.Devices.Wallbox1.OutputActive': false,
        'ems.0.Vehicles.Wallbox1.SoC_pct': 79, 'ems.0.Vehicles.Wallbox1.SoCValid': true,
        'ems.0.Vehicles.Wallbox1.MinimumSoC_pct': 80, 'ems.0.Vehicles.Wallbox1.TargetSoC_pct': 90,
        'ems.0.Vehicles.Wallbox1.BelowMinimum': true, 'ems.0.Vehicles.Wallbox1.TaperCurrentLimit_A': 16,
        'ems.0.Vehicles.Wallbox1.MaximumPower_W': 11000,
        'ems.0.Vehicles.Wallbox1.CurrentConstraintStatus': 'Geraetegrenze'});
    await f.recorder.initialize();
    const snapshot = f.recorder.snapshot();
    const planned = snapshot.control.parallelWallboxes;
    assert.deepEqual(Array.from(planned.active), [0, 1]);
    assert.equal(planned.allocation.allocations[1].minimumW, 1380);
    assert.equal(planned.allocation.hardBudgetW, 12000);
    assert.equal(planned.allocation.slowBudgetW, 11000, 'battery-reduced budget is distinct from gross protection');
    assert.equal(planned.allocation.voltage, 240);
    assert.equal(snapshot.wallboxes[1].OutputActive, false, 'planned participant is not measured charging');
    assert.equal(snapshot.wallboxes[1].SoC_pct, 79);
    assert.equal(snapshot.wallboxes[1].MaximumPower_W, 11000);
    assert.ok(!JSON.stringify(snapshot).includes('NEVER-EXPORT'));
    const restored = f.recorder.copyContext(f.recorder.context(snapshot));
    assert.equal(restored.parallelWallboxes.allocation.allocations[0].targetA, 32);
    assert.equal(restored.wallboxes[1].soc_pct, 79);
    assert.equal(restored.wallboxes[1].constraintStatus, 'Geraetegrenze');
    const count = f.recorder.eventCount;
    f.change('Control.ActiveWallboxes_JSON', '[0]');
    assert.ok(f.recorder.eventCount > count);
});

test('missing or malformed parallel diagnosis stays unknown and is bounded', async () => {
    const f = fixture(); await f.recorder.initialize();
    assert.equal(f.recorder.snapshot().control.parallelWallboxes.allocation, null);
    assert.equal(f.recorder.snapshot().control.parallelWallboxes.active, null);
    f.put('ems.0.Control.ActiveWallboxes_JSON', '{invalid');
    f.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify({schema: 2, valid: true}));
    assert.equal(f.recorder.snapshot().control.parallelWallboxes.active, null);
    assert.equal(f.recorder.snapshot().control.parallelWallboxes.allocation, null);
    f.put('ems.0.Control.ActiveWallboxes_JSON', '[0,0,1,2,3]');
    f.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify({schema: 1, valid: false,
        allocations: Array.from({length: 10}, (_, i) => ({wb: i % 3, targetA: null, phases: 2})),
        waiting: [{wb: 1, reason: 'x'.repeat(1000)}]}));
    const diagnosed = f.recorder.snapshot().control.parallelWallboxes;
    assert.deepEqual(Array.from(diagnosed.active), [0, 1, 2]);
    assert.equal(diagnosed.allocation.allocations.length, 3);
    assert.equal(diagnosed.allocation.allocations[0].targetA, null);
    assert.equal(diagnosed.allocation.allocations[0].phases, null);
    assert.equal(diagnosed.allocation.waiting[0].reason.length, 600);
});

test('per-vehicle allocation and increase-budget JSON retain diagnostic detail beyond text truncation', async () => {
    const f = fixture(); await f.recorder.initialize();
    const detail = {timestamp: 12345, valid: true, minimumW: 1380, preferred: false, order: 1,
        safetyBudgetW: 2760, reservedW: 1380, phasePreparationCurrentA: 6,
        phasePreparationReason: 'awaiting-confirmed-1p', reason: 'x'.repeat(800)};
    for (const id of ['Control.Wallbox1.AllocationDiagnostics_JSON', 'Devices.Wallbox1.IncreaseBudget_JSON'])
        f.put(`ems.0.${id}`, JSON.stringify(detail));
    const snapshot = f.recorder.snapshot();
    assert.equal(snapshot.wallboxes[1].allocation.minimumW, 1380);
    assert.equal(snapshot.wallboxes[1].allocation.reason.length, 800);
    assert.equal(snapshot.wallboxes[1].increaseBudget.phasePreparationReason, 'awaiting-confirmed-1p');
    f.put('ems.0.Control.Wallbox1.AllocationDiagnostics_JSON', 'x'.repeat(20001));
    assert.equal(f.recorder.snapshot().wallboxes[1].allocation, null);
});

test('pending-start proof survives productive record replay without inventing electrical charging', async () => {
    const {DecisionRecordEncoder, DecisionRecordDecoder} = require('../lib/decision-record-codec');
    const f = fixture(); await f.recorder.initialize();
    const proof = {schema: 1, pending: true, stage: 'allow', amps: 6, phases: 1,
        stageAt: f.clock.now, validUntil: f.clock.now + 20000};
    f.put('ems.0.Devices.Wallbox1.OutputStartReservation_JSON', JSON.stringify(proof));
    f.put('ems.0.Devices.Wallbox1.OutputActive', false);
    const encoder = new DecisionRecordEncoder();
    const decoder = new DecisionRecordDecoder();
    const record = {schema: 2, timestamp: f.clock.now, recordSession: 'start-proof', recordSequence: 1,
        masterEnabled: true, production: f.recorder.snapshot()};
    const restored = decoder.decode(encoder.encode(record));
    assert.deepEqual(restored.production.wallboxes[1].startReservation, proof);
    assert.equal(restored.production.wallboxes[1].OutputActive, false);
    assert.equal(restored.production.wallboxes[1].actual_W, null);
    const deadline = proof.validUntil;
    f.clock.now += 2000;
    const next = {...record, timestamp: f.clock.now, recordSequence: 2, production: f.recorder.snapshot()};
    const delta = decoder.decode(encoder.encode(next));
    assert.equal(delta.production.wallboxes[1].startReservation.validUntil, deadline,
        'snapshot clocks cannot extend the original command deadline');
    f.put('ems.0.Devices.Wallbox1.OutputStartReservation_JSON', '{"schema":1,"pending":false}');
    const cleared = decoder.decode(encoder.encode({...next, recordSequence: 3, production: f.recorder.snapshot()}));
    assert.equal(cleared.production.wallboxes[1].startReservation.pending, false);
});


test('adoption evidence and bounded allocation source faults survive productive record replay', async () => {
    const {DecisionRecordEncoder, DecisionRecordDecoder} = require('../lib/decision-record-codec');
    const f = fixture(); await f.recorder.initialize();
    const proof = {schema: 1, valid: true, generation: f.clock.now - 1000,
        adoptedAt: f.clock.now, wb: 1, amps: 6, phases: 1};
    f.put('ems.0.Devices.Wallbox1.OutputAdoptionProof_JSON', JSON.stringify(proof));
    f.put('ems.0.Control.Wallbox1.AllocationDiagnostics_JSON', JSON.stringify({
        start: {vehicleHandoff: {qualified: true, phaseConfirmationPending: true}}}));
    const fault = {id: 'go-e.1.power', reason: 'negative', rawValue: -0.03, ack: true, q: 0,
        ts: f.clock.now - 2000, ageMs: 2000, maximumAgeMs: 30000};
    f.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify({schema: 1, valid: false,
        sourceDiagnostics: Array.from({length: 20}, () => ({...fault, privatePayload: 'ignored'}))}));
    const encoder = new DecisionRecordEncoder(); const decoder = new DecisionRecordDecoder();
    const record = {schema: 2, timestamp: f.clock.now, recordSession: 'adoption-proof', recordSequence: 1,
        masterEnabled: true, production: f.recorder.snapshot()};
    const restored = decoder.decode(encoder.encode(record));
    assert.deepEqual(restored.production.wallboxes[1].adoptionProof, proof);
    assert.equal(restored.production.wallboxes[1].allocation.start.vehicleHandoff.phaseConfirmationPending, true);
    const diagnostics = restored.production.control.parallelWallboxes.allocation.sourceDiagnostics;
    assert.equal(diagnostics.length, 12);
    assert.deepEqual(diagnostics[0], fault);
    f.put('ems.0.Devices.Wallbox1.OutputAdoptionProof_JSON', '{"schema":1,"valid":false}');
    const cleared = decoder.decode(encoder.encode({...record, recordSequence: 2,
        production: f.recorder.snapshot()}));
    assert.equal(cleared.production.wallboxes[1].adoptionProof.valid, false,
        'delta replay must not retain an invalidated adoption proof');
});

test('history serialization reuses unchanged rings but preserves enriched stop reasons and new trace samples', async () => {
    const h = fixture(); await h.recorder.initialize(); await h.settle();
    let serializations = 0;
    const serialize = h.recorder.serializeRing.bind(h.recorder);
    h.recorder.serializeRing = ring => {serializations++; return serialize(ring);};
    h.recorder.publishHistory(); await h.settle();
    const initial = serializations;
    h.recorder.publishHistory(); h.recorder.publishHistory(); await h.settle();
    assert.equal(serializations, initial, 'unchanged exports do not allocate another whole JSON string');
    h.change('Devices.MyPV_DHW.OutputActive', false);
    h.recorder.publishHistory(); await h.settle();
    const beforeReason = serializations;
    h.change('Devices.MyPV_DHW.OutputStatus', 'confirmed thermal stop');
    h.recorder.publishHistory(); await h.settle();
    assert.equal(serializations, beforeReason + 1);
    assert.equal(h.json('Events_JSON').at(-1).to, 'confirmed thermal stop');
    h.clock.now += 10000;
    h.recorder.sample(); await h.settle();
    assert.ok(h.json('PowerTrace_JSON').some(row => row.ts === h.clock.now));
    h.command('Clear', true); await h.settle();
    assert.deepEqual(h.json('PowerTrace_JSON'), []);
});

test('temperature minimum, held reserve and raw forecast evidence survive productive snapshot delta replay', async () => {
    const {DecisionRecordEncoder, DecisionRecordDecoder} = require('../lib/decision-record-codec');
    const f = fixture();
    const sourceId = 'weather.0.forecast.minimum';
    const sourceTs = f.clock.now - 3600000;
    f.adapter.config.batteryTemperatureForecastId = sourceId;
    f.adapter.config.batteryTemperatureMinSocEnabled = true;
    f.put('ems.0.Config.BatteryMinSoC_pct', 10);
    f.put('ems.0.Config.BatteryTemperatureMinSoCEnabled', true);
    f.put('ems.0.Config.BatteryTemperatureForecastId', sourceId);
    f.put('ems.0.Config.BatteryTemperatureForecastMaxAge_h', 24);
    const selection = {schema: 1, sourceId, minSoc: 30, temperatureC: -5,
        sourceTs, sourceAck: true, sourceQ: 0, selectedAt: f.clock.now - 1000, periodKey: '2026-09-20',
        privateConfig: 'MUST-NOT-PUBLISH'};
    f.put(sourceId, -5, {ts: sourceTs, ack: true, q: 0});
    f.put('ems.0.Devices.Battery.EffectiveMinimumSoC_pct', 30);
    f.put('ems.0.Devices.Battery.TemperatureReserveValid', true);
    f.put('ems.0.Devices.Battery.TemperatureReserveHeld', false);
    f.put('ems.0.Devices.Battery.TemperatureReserveStatus', 'temperature-selection-applied');
    f.put('ems.0.Devices.Battery.TemperatureReserveLastSelectionAt', selection.selectedAt);
    f.put('ems.0.Devices.Battery.TemperatureReservePeriod', selection.periodKey);
    f.put('ems.0.Devices.Battery.TemperatureReserveSelection_JSON', JSON.stringify(selection));
    await f.recorder.initialize();
    const encoder = new DecisionRecordEncoder(), decoder = new DecisionRecordDecoder();
    const record = sequence => ({schema: 2, timestamp: f.clock.now,
        recordSession: 'temperature-reserve-proof', recordSequence: sequence,
        masterEnabled: true, production: f.recorder.snapshot()});
    const first = decoder.decode(encoder.encode(record(1))).production.battery;
    assert.equal(first.minimumSoC_pct, 30);
    assert.equal(first.fixedMinimumSoC_pct, 10);
    assert.equal(first.temperatureReserve.valid, true);
    assert.equal(first.temperatureReserve.held, false);
    assert.equal(first.temperatureReserve.selection.sourceTs, sourceTs);
    assert.equal(first.temperatureReserve.selection.sourceAck, true);
    assert.equal(first.temperatureReserve.selection.sourceQ, 0);
    assert.equal(first.temperatureReserve.selection.privateConfig, undefined);
    assert.equal(first.measurements.forecastTemperature.val, -5);
    assert.equal(first.measurements.forecastTemperature.ts, sourceTs);
    assert.equal(first.measurements.forecastTemperature.ack, true);
    assert.equal(first.measurements.forecastTemperature.q, 0);
    f.clock.now += 10000;
    f.put(sourceId, -5, {ts: sourceTs, ack: false, q: 64});
    f.put('ems.0.Devices.Battery.TemperatureReserveHeld', true);
    f.put('ems.0.Devices.Battery.TemperatureReserveStatus', 'source-unknown-held-selection');
    const held = decoder.decode(encoder.encode(record(2))).production.battery;
    assert.equal(held.minimumSoC_pct, 30);
    assert.equal(held.temperatureReserve.held, true);
    assert.equal(held.temperatureReserve.selectedAt, selection.selectedAt);
    assert.equal(held.temperatureReserve.selection.sourceAck, true);
    assert.equal(held.temperatureReserve.selection.sourceQ, 0);
    assert.equal(held.measurements.forecastTemperature.valid, false);
    assert.equal(held.measurements.forecastTemperature.ack, false);
    assert.equal(held.measurements.forecastTemperature.q, 64);
    assert.equal(held.measurements.forecastTemperature.ts, sourceTs);
    f.put('ems.0.Devices.Battery.EffectiveMinimumSoC_pct', null);
    f.put('ems.0.Devices.Battery.TemperatureReserveValid', false);
    f.put('ems.0.Devices.Battery.TemperatureReserveStatus', 'invalid-temperature-reserve-settings');
    const invalid = decoder.decode(encoder.encode(record(3))).production.battery;
    assert.equal(invalid.minimumSoC_pct, null, 'invalid effective min must not replay as the old 30% or static 10%');
    assert.equal(invalid.fixedMinimumSoC_pct, 10);
    assert.equal(invalid.temperatureReserve.valid, false);
});
