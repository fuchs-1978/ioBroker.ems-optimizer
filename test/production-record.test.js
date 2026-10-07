'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ShadowController = require('../lib/shadow-controller');
const DebugRecorder = require('../lib/debug-recorder');
const WallboxOutput = require('../lib/wallbox-output');
const {WALLBOX_GRID_MAX_AGE_MS} = require('../lib/source-diagnostics');

function fixture(initialNow = Date.now()) {
    let now = initialNow;
    const states = new Map(), writes = [];
    const mapping = {DP_GRID_IMPORT: 'import', DP_GRID_EXPORT: 'export', DP_PV_POWER: 'pv',
        DP_WB0_POWER: 'power', DP_WB0_CAR: 'car', DP_WB0_L1_A: 'l1', DP_WB0_L2_A: 'l2', DP_WB0_L3_A: 'l3'};
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    const own = (id, value, extra) => put(`ems.0.${id}`, value, extra);
    const device = {wb: 0, ids: {allow: 'allow', command: 'cmd', feedback: 'amps', phaseMode: 'phase'},
        pending: null, response: null, stopRequest: null};
    const adapter = {namespace: 'ems.0', config: {globalWriteEnabled: true},
        readMapping: () => mapping, getCachedState: id => states.get(id), wallboxOutput: {devices: [device]},
        setCompatState: async (id, value) => {writes.push({id, value});}, log: {warn() {}}};
    adapter.debugRecorder = new DebugRecorder(adapter);
    const shadow = new ShadowController(adapter, {now: () => now}); shadow.initialized = true;
    own('System.RealOutputsEnabled', true); own('Control.Valid', true);
    own('Control.Targets.Wallbox0_W', 1380); own('Vehicles.Wallbox0.StartDelayRemaining_s', 600);
    own('Config.WallboxStartDelay_s', 600); own('Config.WallboxMinimumRunTime_s', 600); own('Config.WallboxStopDelay_s', 600);
    for (const [id, value] of Object.entries({import: 500, export: 0, pv: 6000, power: 0,
        car: 2, l1: 0, l2: 0, l3: 0, cmd: 6, amps: 6, allow: 0, phase: 1})) put(id, value);
    const flush = async () => {for (let i = 0; i < 80; i++) await Promise.resolve();};
    const records = () => writes.filter(w => w.id.endsWith('.DecisionRecord')).map(w => JSON.parse(w.value));
    return {shadow, adapter, put, own, states, device, writes, flush, records,
        advance: ms => {now += ms;}, now: () => now};
}

test('same persistent queue correlates trigger, command, raw ACK and electrical response without fabricating model validity', async () => {
    const h = fixture();
    h.shadow.productionRecord({type: 'decision'});
    const id = h.shadow.commandEvent('attempt', 'cmd', 6);
    h.put('cmd', 6, {ack: false});
    h.shadow.commandEvent('transport_complete', 'cmd', 6, id);
    const old = h.states.get('cmd'); h.advance(1); h.put('cmd', 6);
    h.shadow.captureProduction('cmd', h.states.get('cmd'), old);
    h.own('Devices.Wallbox0.ResponseState', 'vehicle_response');
    h.device.response = {at: h.now() - 1, ackAt: h.now(), amps: 6};
    h.shadow.productionRecord({type: 'decision'});
    h.advance(1); h.put('power', 1.38); h.put('l1', 6);
    h.own('Devices.Wallbox0.ResponseState', 'confirmed');
    h.own('Devices.Wallbox0.ResponseConfirmedAt', h.now());
    h.shadow.captureProduction('power', h.states.get('power'), null);
    await h.flush();
    const records = h.records();
    assert.equal(records.length, 6);
    assert.deepEqual(records.map(r => r.recordSequence), [1, 2, 3, 4, 5, 6]);
    assert.equal(new Set(records.map(r => r.recordSession)).size, 1);
    assert.ok(records.every(r => r.mode === 'PRODUCTION' && r.modelPaused && !r.valid));
    assert.equal(records[1].event.commandId, records[2].event.commandId);
    assert.equal(records[2].production.commands.cmd.source.ack, false);
    assert.equal(records[3].production.commands.cmd.source.ack, true);
    assert.ok(records[3].production.commands.cmd.source.ts > records[3].production.commands.cmd.issuedAt);
    assert.equal(records[2].production.wallboxes[0].actual_W, 0, 'prior frame is immutable');
    assert.equal(records[5].production.wallboxes[0].actual_W, 1380);
    assert.equal(records[5].production.wallboxes[0].ResponseState, 'confirmed');
    assert.equal(records[5].production.timers.WallboxStopDelay_s, 600);
    assert.equal(records[5].production.power.grid_W, 500);
    assert.equal(records[5].recording.dropped, 0);
});

test('NULL, unacknowledged and q!=0 stay unknown; source time and timeout remain visible', async () => {
    const h = fixture(); h.shadow.commandEvent('attempt', 'cmd', 6);
    for (const extra of [{val: null}, {ack: false}, {q: 64}, {ts: 0}]) {
        h.put('power', 1.38, extra);
        h.own('Devices.Wallbox0.ResponseState', 'timeout');
        h.shadow.productionRecord({type: 'decision'}); await h.flush();
        const frame = h.records().at(-1).production;
        assert.equal(frame.wallboxes[0].actual_W, null);
        assert.equal(frame.wallboxes[0].ResponseState, 'timeout');
        assert.equal(frame.wallboxes[0].measurements.power.valid, false);
    }
    h.states.delete('power'); h.shadow.captureProduction('power', null, {val: 1.38}); await h.flush();
    assert.equal(h.records().at(-1).event.state, null);
    assert.equal(h.records().at(-1).production.wallboxes[0].actual_W, null);
});

test('Master OFF/ON and restart have distinct frame modes, sessions and command identities', async () => {
    const h = fixture(); const first = h.shadow.commandEvent('attempt', 'cmd', 6);
    const old = h.states.get('ems.0.System.RealOutputsEnabled');
    h.adapter.config.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false);
    h.shadow.captureProduction('ems.0.System.RealOutputsEnabled', h.states.get('ems.0.System.RealOutputsEnabled'), old);
    await h.flush(); assert.equal(h.records().at(-1).mode, 'MASTER_OFF');
    h.advance(1000); h.adapter.config.globalWriteEnabled = true; h.own('System.RealOutputsEnabled', true);
    h.shadow.productionRecord(); await h.flush(); assert.equal(h.records().at(-1).mode, 'PRODUCTION');
    const restarted = new ShadowController(h.adapter, {now: () => h.now()}); restarted.initialized = true;
    const next = restarted.commandEvent('attempt', 'cmd', 6); await h.flush();
    assert.notEqual(first, next); assert.equal(restarted.recordSequence, 1);
    assert.deepEqual([...restarted.productionCommands.keys()], ['cmd']);
});

test('Master OFF retains pending shutdown ACK and the final electrical-off edge', async () => {
    const h = fixture(); h.shadow.productionRecord();
    h.adapter.config.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false);
    h.device.owned = true; h.device.stopRequest = {lastAttempt: h.now(), confirmedAt: 0};
    h.shadow.commandEvent('attempt', 'allow', 0);
    const old = h.states.get('allow'); h.advance(1); h.put('allow', 0);
    h.shadow.captureProduction('allow', h.states.get('allow'), old); await h.flush();
    assert.equal(h.records().at(-1).mode, 'MASTER_OFF');
    assert.equal(h.records().at(-1).event.type, 'source.update');
    assert.equal(h.records().at(-1).production.commands.allow.source.ack, true);
    const previous = {val: true}; h.device.owned = false; h.device.stopRequest = null;
    h.own('Devices.Wallbox0.OutputOwned', false);
    h.shadow.captureProduction('ems.0.Devices.Wallbox0.OutputOwned',
        h.states.get('ems.0.Devices.Wallbox0.OutputOwned'), previous); await h.flush();
    assert.equal(h.records().at(-1).event.type, 'output.state');
    assert.equal(h.records().at(-1).production.wallboxes[0].OutputOwned, false);
});

test('slow and failing persistence preserves command edges or reports losses explicitly', async () => {
    const h = fixture(); let release;
    const realWrite = h.adapter.setCompatState;
    h.adapter.setCompatState = (id, value) => {
        if (id.endsWith('.DecisionRecord') && !release) return new Promise(resolve => {release = resolve;});
        return realWrite(id, value);
    };
    for (let i = 0; i < 140; i++) h.shadow.commandEvent('attempt', 'cmd', 6);
    assert.equal(h.shadow.recordDropped, 11); release(); await h.flush();
    assert.equal(h.records()[0].recordSequence, 13); assert.equal(h.records()[0].recording.dropped, 11);
    h.adapter.setCompatState = id => id.endsWith('.DecisionRecord') ? Promise.reject(Error('test failure')) : Promise.resolve();
    h.shadow.commandEvent('attempt', 'cmd', 7); await h.flush();
    assert.ok(h.shadow.recordWriteErrors > 0);
    h.adapter.setCompatState = realWrite; h.shadow.commandEvent('attempt', 'cmd', 6); await h.flush();
    assert.ok(h.records().at(-1).recording.writeErrors > 0);
});

test('grid protection, snapshot and operative wallbox freshness agree while the DHW gate is explicit', async t => {
    const h = fixture(2000000);
    t.mock.method(Date, 'now', h.now);
    const output = new WallboxOutput(h.adapter, {now: h.now});
    for (const id of ['import', 'export']) for (const ageMs of [10000, 12000, 30000, 30001]) {
        h.put(id, 0, {ts: h.now() - ageMs, lc: h.now() - 50000});
        h.shadow.productionRecord({type: 'decision'}); await h.flush();
        const r = h.records().at(-1);
        const field = id === 'import' ? 'gridImport' : 'gridExport';
        const protection = r.protectionFeedback[field];
        assert.equal(protection.maxAgeMs, WALLBOX_GRID_MAX_AGE_MS);
        assert.equal(protection.valid, ageMs <= 30000);
        assert.equal(r.production.measurements[field].valid, protection.valid);
        assert.equal(output.number(id, WALLBOX_GRID_MAX_AGE_MS) !== null, protection.valid);
        assert.equal(protection.id, id);
        assert.equal(protection.lc, h.now() - 50000);
        assert.match(protection.contract, /wallbox-total-grid/);
        const dhw = r.protectionFeedback[id === 'import' ? 'dhwGridImport' : 'dhwGridExport'];
        assert.equal(dhw.maxAgeMs, 10000);
        assert.equal(dhw.valid, ageMs <= 10000);
        assert.match(dhw.contract, /dhw-direct-grid.*stops heater/);
    }
});

test('missing, NULL, unacknowledged and bad-quality grid sources cannot qualify either output contract', t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    const output = new WallboxOutput(h.adapter, {now: h.now});
    for (const id of ['import', 'export']) for (const invalid of ['missing', {val: null}, {ack: false}, {q: 64}]) {
        h.put(id, 0, invalid === 'missing' ? {} : invalid);
        if (invalid === 'missing') h.states.delete(id);
        const p = h.shadow.realProtectionFeedback();
        const field = id === 'import' ? 'gridImport' : 'gridExport';
        assert.equal(p[field].valid, false);
        assert.equal(p[id === 'import' ? 'dhwGridImport' : 'dhwGridExport'].valid, false);
        assert.equal(h.adapter.debugRecorder.snapshot().measurements[field].valid, false);
        assert.equal(output.number(id, WALLBOX_GRID_MAX_AGE_MS), null);
    }
    h.adapter.readMapping().DP_HA_L1_IMPORT_W = 'house';
    h.put('house', 0, {ts: h.now() - 15001});
    assert.equal(h.shadow.realProtectionFeedback().houseL1Import.maxAgeMs, 15000);
    assert.equal(h.shadow.realProtectionFeedback().houseL1Import.valid, false);
    assert.equal(output.number('house'), null);
    h.put('power', 0, {ts: h.now() - 30001});
    assert.equal(h.adapter.debugRecorder.snapshot().wallboxes[0].measurements.power.valid, false);
    assert.equal(output.number('power', output.measurementMaxAgeMs()), null);
});

test('snapshot clock and derived ages do not create extra subsecond frames; timer and freshness edges do', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.shadow.productionRecord();
    h.advance(100); h.shadow.productionRecord();
    h.advance(899); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().length, 1);
    assert.equal(h.records()[0].production.measurements.gridImport.ageMs, 0);
    h.advance(1); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().length, 2, 'the one-second heartbeat remains');
    assert.equal(h.records()[1].production.measurements.gridImport.ageMs, 1000);
    h.own('Vehicles.Wallbox0.StartDelayRemaining_s', 599);
    h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().at(-1).production.wallboxes[0].StartDelayRemaining_s, 599);
    h.put('import', 0, {ts: h.now() - 30000});
    h.shadow.productionRecord(); await h.flush();
    h.advance(1); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().at(-1).production.measurements.gridImport.valid, false,
        'a stale-validity edge is meaningful even before the next heartbeat');
    h.adapter.readMapping().DP_HA_L1_IMPORT_W = 'house';
    h.put('house', 0, {ts: h.now() - 15000});
    h.shadow.productionRecord(); await h.flush();
    const count = h.records().length;
    h.advance(1); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().length, count + 1, 'independent house protection freshness must not wait for the heartbeat');
    assert.equal(h.records().at(-1).protectionFeedback.houseL1Import.valid, false);
    assert.equal(h.records().at(-1).production.measurements.haPhases[0].import.valid, true,
        'generic snapshot freshness is broader than the operative phase gate');
});

test('unchanged source polls retain new timestamps, real ACK/q/NULL edges and every cyclic zero command completion', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.shadow.productionRecord();
    let previous = h.states.get('power');
    h.shadow.captureProduction('power', previous, previous);
    for (const extra of [{}, {ack: false}, {ack: true}, {q: 64}, {val: null}, {val: 0}]) {
        previous = h.states.get('power'); h.advance(1); h.put('power', 0, extra);
        h.shadow.captureProduction('power', h.states.get('power'), previous);
    }
    for (let i = 0; i < 2; i++) {
        const token = h.shadow.commandEvent('attempt', 'cmd', 0);
        h.shadow.commandEvent('transport_complete', 'cmd', 0, token);
    }
    await h.flush();
    const r = h.records();
    assert.equal(r.length, 11);
    assert.deepEqual(r.map(x => x.recordSequence), Array.from({length: 11}, (_, i) => i + 1));
    assert.equal(r[1].event.state.ts, 2000001);
    assert.equal(r[2].event.state.ack, false);
    assert.equal(r[4].event.state.q, 64);
    assert.equal(r[5].production.wallboxes[0].actual_W, null);
    assert.equal(r[6].production.wallboxes[0].actual_W, 0);
    assert.equal(r[7].event.commandId, r[8].event.commandId);
    assert.equal(r[9].event.commandId, r[10].event.commandId);
    assert.notEqual(r[7].event.commandId, r[9].event.commandId);
});

test('deterministic full-record replay preserves events, timers and source ages under extra unchanged sampling', async t => {
    let current;
    t.mock.method(Date, 'now', () => current.now());
    const replay = async dense => {
        const h = fixture(2000000); current = h;
        h.adapter.debugRecorder.session = 'deterministic-fixture';
        h.shadow.productionRecord();
        if (dense) {h.advance(100); h.shadow.productionRecord(); h.advance(100); h.shadow.productionRecord();}
        h.advance(dense ? 50 : 250);
        const token = h.shadow.commandEvent('attempt', 'cmd', 0);
        h.advance(10); h.shadow.commandEvent('transport_complete', 'cmd', 0, token);
        const previous = h.states.get('allow');
        h.advance(10); h.put('allow', 0, {lc: h.now() - 100});
        h.shadow.captureProduction('allow', h.states.get('allow'), previous);
        h.advance(10); h.own('Vehicles.Wallbox0.StartDelayRemaining_s', 599);
        h.shadow.productionRecord();
        h.advance(1000); h.shadow.productionRecord(); await h.flush();
        return h.records();
    };
    const sparse = await replay(false), dense = await replay(true);
    assert.deepEqual(dense, sparse);
    assert.equal(dense.at(-1).production.measurements.gridImport.ageMs, 1280);
    assert.equal(dense.at(-1).production.wallboxes[0].StartDelayRemaining_s, 599);
    assert.ok(dense.every(r => r.schema === 2 && r.production && r.realFeedback));
});

