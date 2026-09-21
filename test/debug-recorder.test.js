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
