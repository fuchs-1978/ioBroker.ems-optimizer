'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ShadowController = require('../lib/shadow-controller');
const DebugRecorder = require('../lib/debug-recorder');
const {DecisionRecordDecoder} = require('../lib/decision-record-codec');
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
    const flush = async () => {for (let i = 0; i < 800; i++) await Promise.resolve();};
    const rawRecords = () => writes.filter(w => w.id.endsWith('.DecisionRecord')).map(w => JSON.parse(w.value));
    const records = () => {
        const decoder = new DecisionRecordDecoder();
        return rawRecords().map(record => decoder.decode(record));
    };
    return {shadow, adapter, put, own, states, device, writes, flush, records, rawRecords,
        advance: ms => {now += ms;}, now: () => now};
}

test('quiet polls reduce persisted full decisions while a dip restores exact prehistory and immediate response', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.put('power', 1.38); h.shadow.productionRecord(); await h.flush();
    for (let i = 0; i < 100; i++) {
        const previous = h.states.get('power'); h.advance(100); h.put('power', 1.38);
        h.shadow.captureProduction('power', h.states.get('power'), previous);
        h.shadow.productionRecord();
    }
    await h.flush(); assert.ok(h.records().length <= 11, '100 routine polls share one-second raw batches instead of 100 full frames');
    const before = h.states.get('power'); h.advance(1); h.put('power', 0);
    h.shadow.captureProduction('power', h.states.get('power'), before); await h.flush();
    const decoded = h.records();
    assert.ok(decoded.every(r => r.schema === 2 && !r.reconstruction));
    const samples = decoded.flatMap(r => r.event?.samples || []);
    assert.equal(samples.length, 101);
    assert.equal(new Set(samples.map(s => s.sampleSequence)).size, 101);
    assert.equal(samples[0].state.ts, 2000100);
    assert.equal(samples.at(-1).state.val, 0);
    assert.equal(decoded.at(-1).event.triggerReason, 'power-dip');
    assert.equal(decoded.at(-1).production.wallboxes[0].actual_W, 0);
    assert.equal(decoded.at(-1).sampling.postEventMs, 120000);
    const previous = h.states.get('power'); h.advance(1000); h.put('power', 1.38);
    h.shadow.captureProduction('power', h.states.get('power'), previous);
    h.advance(1000); h.shadow.productionRecord(); await h.flush();
    const restart = h.records().flatMap(r => r.event?.type === 'recording.sources' ? r.event.samples : [])
        .find(s => s.id === 'power' && s.state.val === 1.38 && s.state.ts === previous.ts + 1000);
    assert.ok(restart, 'real restart is preserved in the bounded dense source batch');
    assert.equal(restart.state.ts, previous.ts + 1000);
    assert.equal(restart.receivedAt, previous.ts + 1000);
});

test('quiet interval summary survives SQL codec with measured extrema and explicit resolution', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.shadow.productionRecord();
    for (let i = 0; i < 30; i++) {
        const previous = h.states.get('power'); h.advance(1000); h.put('power', i / 100);
        h.put('import', 500); h.put('export', 0);
        h.shadow.captureProduction('power', h.states.get('power'), previous);
        h.shadow.productionRecord();
    }
    h.advance(1000); h.shadow.productionRecord(); await h.flush();
    const summary = h.records().find(r => r.event?.type === 'recording.interval');
    assert.ok(summary); assert.equal(summary.event.summary.resolutionMs, 30000);
    const source = summary.event.summary.sources.find(s => s.id === 'power');
    assert.equal(source.count, 30); assert.equal(source.min, 0); assert.equal(source.max, 0.29);
    assert.equal(source.maxSourceGapMs, 1000);
    assert.match(summary.event.summary.validity, /freshness is not inferred/);
});

test('DHW unknown temperatures and full source diagnostics survive production delta replay', async () => {
    const h = fixture(5000000);
    const sources = [0, 1, 2, 3, 4].map(index => ({
        id: `source.${index}.` + 'long-name.'.repeat(14), name: `Temperature ${index}`,
        rawValue: index ? 45 : 39.9, valueC: index ? 45 : null, valid: Boolean(index),
        status: index ? 'valid' : 'stale', reason: index ? 'gueltig' : 'veraltet',
        ts: index ? 4999000 : 1, lc: 1, ageMs: index ? 1000 : 4999999,
        maxAgeMs: index === 4 ? 120000 : 3600000, ack: true, q: 0}));
    const diagnostics = {evaluatedAt: 5000000, sources};
    const json = JSON.stringify(diagnostics);
    assert.ok(json.length > 600, 'exercise the ordinary scalar text limit');
    h.own('Devices.MyPV_DHW.BottomTemperature_C', null);
    h.own('Devices.MyPV_DHW.TopTemperature_C', 45);
    h.own('Devices.MyPV_DHW.TemperatureValid', false);
    h.own('Devices.MyPV_DHW.TemperatureSources_JSON', json);
    h.shadow.productionRecord({type: 'decision'}); await h.flush();
    h.advance(1000);
    h.own('Devices.MyPV_DHW.TopTemperature_C', 46);
    h.shadow.productionRecord({type: 'decision'}); await h.flush();
    const record = h.records().at(-1);
    assert.equal(record.production.ehz.BottomTemperature_C, null);
    assert.equal(record.production.ehz.TopTemperature_C, 46);
    assert.equal(record.production.ehz.TemperatureValid, false);
    assert.deepEqual(record.production.ehz.temperatureSources, diagnostics);
    assert.equal(record.production.ehz.temperatureSources.sources[4].id, sources[4].id);
});

test('issue116 source diagnostic identity and late completion survive lossless production record replay', async () => {
    const h = fixture(2000000);
    const episode = {key: '0:2000000:1', checkedAt: 2000000, stopAt: 2000000,
        recordSession: h.shadow.recordSession, recordSequenceAtCheck: 0, reason: 'go-e error stale',
        sources: [{id: 'error', cached: {val: 0, ts: 1968000, lc: 1900000, ack: true, q: 0},
            receipt: {receivedAt: 2000000, via: 'stateChange'}, direct: {status: 'pending'}}]};
    h.own('Devices.Wallbox0.LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
    h.shadow.productionRecord({type: 'source_diagnostic.request', wb: 0, episode}); await h.flush();
    h.advance(1000); h.own('Devices.Wallbox0.LastStopReason', 'new stop');
    episode.sources[0].direct = {requestedAt: 2000000, completedAt: 2001000, status: 'read',
        snapshot: {val: 0, ts: 1968000, lc: 1900000, ack: false, q: 64}};
    h.shadow.productionRecord({type: 'source_diagnostic.complete', wb: 0, episode}); await h.flush();
    const r = h.records();
    assert.equal(r[0].event.episode.sources[0].direct.status, 'pending', 'queued event is immutable');
    assert.deepEqual(r[1].event.episode, episode);
    assert.equal(r[1].production.wallboxes[0].LastStopReason, 'new stop');
    assert.equal(r[1].event.episode.reason, 'go-e error stale');
    assert.equal(r[1].recordSession, episode.recordSession);
    assert.equal(r[1].recordSequence, r[0].recordSequence + 1);
});

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
    const allRecords = h.records();
    assert.deepEqual(allRecords.map(r => r.recordSequence), allRecords.map((_, i) => i + 1));
    const records = allRecords.filter(r => r.event?.type !== 'recording.pre_event');
    assert.equal(records.length, 6);
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
    assert.ok(h.records().some(r => r.event?.type === 'output.state' && r.event.id.endsWith('.OutputOwned')));
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
    assert.equal(h.rawRecords()[0].frameType, 'snapshot', 'queue gap starts with an independent full frame');
    h.adapter.setCompatState = id => id.endsWith('.DecisionRecord') ? Promise.reject(Error('test failure')) : Promise.resolve();
    h.shadow.commandEvent('attempt', 'cmd', 7); await h.flush();
    assert.ok(h.shadow.recordWriteErrors > 0);
    h.adapter.setCompatState = realWrite; h.shadow.commandEvent('attempt', 'cmd', 6); await h.flush();
    assert.ok(h.records().at(-1).recording.writeErrors > 0);
    assert.equal(h.rawRecords().at(-1).frameType, 'snapshot', 'failed publish invalidates the delta base');
});

test('productive dispatch retains every event in compact frames and checkpoints without touching inputs', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    const before = structuredClone([...h.states]);
    h.shadow.productionRecord(); await h.flush();
    for (let i = 0; i < 5; i++) {
        h.advance(1000);
        const command = h.shadow.commandEvent('attempt', 'cmd', 0);
        h.shadow.commandEvent('transport_complete', 'cmd', 0, command);
        await h.flush();
    }
    assert.deepEqual([...h.states], before, 'recording does not mutate cached inputs or control states');
    const frames = h.rawRecords();
    assert.equal(frames[0].frameType, 'snapshot');
    assert.ok(frames.slice(1).every(r => r.schema === 3 && r.frameType === 'delta'));
    assert.equal(h.records().filter(r => r.event?.type.startsWith('command.')).length, 10);
    const fullBytes = h.records().reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0);
    const compactBytes = frames.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0);
    assert.ok(compactBytes < fullBytes / 2, 'fixture bytes are substantially smaller without removing events');
    h.advance(25000); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.rawRecords().at(-1).frameType, 'snapshot', '30-second checkpoint is independent');
    const decoder = new DecisionRecordDecoder();
    const missing = decoder.decode(frames[1]);
    assert.equal(missing.reconstruction.valid, false);
    assert.equal(missing.production, undefined, 'a missing base supplies no synthetic real values');
    const recovered = decoder.decode(h.rawRecords().at(-1));
    assert.equal(recovered.production.timers.WallboxStopDelay_s, 600);
});

test('serialization failure is counted and cannot wedge the queue or reject command tracking', async () => {
    const h = fixture();
    const encode = h.shadow.recordEncoder.encode.bind(h.shadow.recordEncoder);
    h.shadow.recordEncoder.encode = () => {throw Error('simulated serialization failure');};
    assert.doesNotThrow(() => h.shadow.commandEvent('attempt', 'cmd', 0));
    await h.flush();
    assert.equal(h.shadow.recordWriteErrors, 1);
    assert.equal(h.shadow.recordWriting, false);
    assert.equal(h.shadow.recordQueue.length, 0);
    h.shadow.recordEncoder.encode = encode;
    h.shadow.commandEvent('attempt', 'cmd', 0); await h.flush();
    assert.equal(h.rawRecords().at(-1).frameType, 'snapshot');
    assert.equal(h.records().at(-1).recording.writeErrors, 1);
});

test('SMA total-grid protection, snapshot, wallbox and DHW freshness share the thirty-second contract', async t => {
    const h = fixture(2000000);
    t.mock.method(Date, 'now', h.now);
    const output = new WallboxOutput(h.adapter, {now: h.now});
    for (const id of ['import', 'export']) for (const ageMs of [10000, 16000, 29999, 30000, 30001]) {
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
        assert.equal(dhw.maxAgeMs, 30000);
        assert.equal(dhw.valid, ageMs <= 30000);
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
    h.put('house', 0, {ts: h.now() - 30001});
    assert.equal(h.shadow.realProtectionFeedback().houseL1Import.maxAgeMs, 30000);
    assert.equal(h.shadow.realProtectionFeedback().houseL1Import.valid, false);
    assert.equal(output.number('house', WALLBOX_GRID_MAX_AGE_MS), null);
    h.put('power', 0, {ts: h.now() - 30001});
    assert.equal(h.adapter.debugRecorder.snapshot().wallboxes[0].measurements.power.valid, false);
    assert.equal(output.number('power', output.measurementMaxAgeMs()), null);
});

test('all SMA phase protection fields and recorded snapshots cross the thirty-second boundary together', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    const mapping = h.adapter.readMapping();
    const fields = [];
    for (const phase of [1, 2, 3]) {
        for (const direction of ['Import', 'Export']) {
            const id = `house.${phase}.${direction.toLowerCase()}`;
            mapping[`DP_HA_L${phase}_${direction.toUpperCase()}_W`] = id;
            fields.push({id, phase, direction: direction.toLowerCase(), field: `houseL${phase}${direction}`});
        }
        const id = `house.${phase}.current`;
        h.adapter.config[`dhwHaL${phase}CurrentId`] = id;
        fields.push({id, phase, direction: 'current', field: `houseL${phase}Current`});
    }
    for (const {id} of fields) h.put(id, 0);
    for (const {id, phase, direction, field} of fields) {
        for (const ageMs of [16000, 29999, 30000, 30001]) {
            h.put(id, 0, {ts: h.now() - ageMs, lc: h.now() - 60000, ack: true, q: 0});
            h.shadow.productionRecord({type: 'decision'}); await h.flush();
            const record = h.records().at(-1);
            const protection = record.protectionFeedback[field];
            const snapshot = record.production.measurements.haPhases[phase - 1][direction];
            assert.equal(protection.id, id);
            assert.equal(protection.maxAgeMs, 30000);
            assert.equal(protection.valid, ageMs <= 30000, `${field}: ${ageMs}`);
            assert.equal(snapshot.id, id, `${field}: snapshot preserves the actual configured source`);
            assert.equal(snapshot.maxAgeMs, 30000);
            assert.equal(snapshot.valid, protection.valid, `${field}: ${ageMs}`);
            assert.equal(protection.issue, ageMs > 30000 ? 'stale' : '');
        }
        h.put(id, 0);
    }
});

test('snapshot clock and derived ages do not create extra subsecond frames; timer and freshness edges do', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.shadow.productionRecord();
    h.advance(100); h.shadow.productionRecord();
    h.advance(899); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().length, 1);
    assert.equal(h.records()[0].production.measurements.gridImport.ageMs, 0);
    h.advance(1); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().length, 1, 'quiet observations wait for the thirty-second interval');
    h.own('Vehicles.Wallbox0.StartDelayRemaining_s', 0);
    h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().at(-1).production.wallboxes[0].StartDelayRemaining_s, 0, 'timer expiry is immediate');
    h.put('import', 0, {ts: h.now() - 30000});
    h.shadow.productionRecord(); await h.flush();
    h.advance(1); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().at(-1).production.measurements.gridImport.valid, false,
        'a stale-validity edge is meaningful even before the next heartbeat');
    h.adapter.readMapping().DP_HA_L1_IMPORT_W = 'house';
    h.put('house', 0, {ts: h.now() - 30000});
    h.shadow.productionRecord(); await h.flush();
    const count = h.records().length;
    h.advance(1); h.shadow.productionRecord(); await h.flush();
    assert.equal(h.records().length, count + 1, 'independent house protection freshness must not wait for the heartbeat');
    assert.equal(h.records().at(-1).protectionFeedback.houseL1Import.valid, false);
    assert.equal(h.records().at(-1).production.measurements.haPhases[0].import.valid, false,
        'phase snapshot and operative protection reject the same stale source');
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
    const all = h.records();
    assert.deepEqual(all.map(x => x.recordSequence), all.map((_, i) => i + 1));
    const r = all.filter(x => !['recording.pre_event', 'recording.sources'].includes(x.event?.type));
    assert.equal(r.length, 10, 'quality edges and commands survive alongside additional quiet raw batches');
    assert.ok(all.some(x => x.event?.type === 'recording.sources'));
    assert.ok(all.some(x => x.event?.samples?.some(s => s.state?.ts === 2000001)));
    assert.equal(r[1].event.state.ack, false);
    assert.equal(r[3].event.state.q, 64);
    assert.equal(r[4].production.wallboxes[0].actual_W, null);
    assert.equal(r[5].production.wallboxes[0].actual_W, 0);
    assert.equal(r[6].event.commandId, r[7].event.commandId);
    assert.equal(r[8].event.commandId, r[9].event.commandId);
    assert.notEqual(r[6].event.commandId, r[8].event.commandId);
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

test('multi-source dense telemetry retains raw observations without flooding a slower record writer', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    const mapping = h.adapter.readMapping();
    const pollSources = ['import', 'export', 'pv'];
    for (const p of [1, 2, 3]) {
        for (const [suffix, key] of [['import', 'IMPORT_W'], ['export', 'EXPORT_W'], ['amps', 'A']]) {
            const id = `house${p}.${suffix}`; mapping[`DP_HA_L${p}_${key}`] = id;
            h.put(id, suffix === 'import' ? 100 : 0); pollSources.push(id);
        }
    }
    for (const wb of [0, 1, 2]) {
        const power = wb ? `power${wb}` : 'power';
        mapping[`DP_WB${wb}_POWER`] = power; h.put(power, 1.38); pollSources.push(power);
        for (const p of [1, 2, 3]) {
            const id = wb ? `wb${wb}.l${p}` : `l${p}`;
            mapping[`DP_WB${wb}_L${p}_A`] = id; h.put(id, p === 1 ? 6 : 0); pollSources.push(id);
        }
        if (wb) {
            mapping[`DP_WB${wb}_CAR`] = `car${wb}`; h.put(`car${wb}`, 2);
            const ids = {allow: `allow${wb}`, command: `cmd${wb}`, feedback: `amps${wb}`, phaseMode: `phase${wb}`};
            for (const [key, id] of Object.entries(ids)) h.put(id, key === 'phaseMode' ? 1 : key === 'allow' ? 0 : 6);
            h.adapter.wallboxOutput.devices.push({wb, ids, pending: null, response: null, stopRequest: null});
        }
    }
    const pendingWrites = [], expected = new Map();
    h.adapter.setCompatState = (id, value) => id.endsWith('.DecisionRecord')
        ? new Promise(resolve => pendingWrites.push(() => {h.writes.push({id, value}); resolve();}))
        : Promise.resolve();
    const deliver = async capacity => {
        for (let i = 0; i < capacity && pendingWrites.length; i++) {
            pendingWrites.shift()(); await h.flush();
        }
    };
    h.shadow.productionRecord(); h.shadow.commandEvent('attempt', 'cmd', 6);
    let peakQueue = 0;
    for (let second = 1; second <= 120; second++) {
        h.advance(1000);
        // The real adapter cache also receives unchanged discrete feedback.
        for (const device of h.adapter.wallboxOutput.devices) {
            for (const id of Object.values(device.ids)) h.put(id, h.states.get(id).val);
            const car = mapping[`DP_WB${device.wb}_CAR`]; h.put(car, 2);
        }
        for (const id of pollSources) {
            const previous = h.states.get(id);
            h.put(id, previous.val, {lc: 1900000});
            h.shadow.captureProduction(id, h.states.get(id), previous);
            expected.set(h.shadow.diagnosticSampler.sequence, {id, receivedAt: h.now(), state: structuredClone(h.states.get(id))});
        }
        h.shadow.productionRecord(); peakQueue = Math.max(peakQueue, h.shadow.recordQueue.length);
        // Three confirmed writes per second is slower than 24 raw callbacks
        // per second; it must still keep up with bounded source batching.
        await deliver(3);
    }
    h.advance(1000); h.shadow.productionRecord();
    while (pendingWrites.length) await deliver(1);
    assert.equal(h.shadow.recordDropped, 0, 'routine dense polls do not discard decision or command records');
    assert.ok(peakQueue < 128, 'normal poll load stays below the existing decision queue capacity');
    const records = h.records();
    assert.ok(records.every(r => r.schema === 2 && !r.reconstruction), 'every surviving codec frame is independently replayable');
    assert.deepEqual(records.map(r => r.recordSequence), records.map((_, i) => i + 1));
    const observed = new Map();
    for (const record of records) for (const sample of record.event?.samples || []) {
        assert.ok(!observed.has(sample.sampleSequence), 'sent source batches are not repeated in later pre-event history');
        observed.set(sample.sampleSequence, {id: sample.id, receivedAt: sample.receivedAt, state: sample.state});
    }
    assert.equal(expected.size, 2880);
    assert.deepEqual(observed, expected, 'all raw source values, receipt times, source timestamps, lc, ACK and q survive');
    assert.ok(records.length < expected.size / 5, 'dense callbacks share substantially fewer full production contexts');
    assert.equal(records.filter(r => r.event?.type === 'command.attempt').length, 1);
});

test('a complete pre-event ring and immediate command fit the bounded queue while persistence is blocked', async () => {
    const h = fixture(2000000); let release;
    const realWrite = h.adapter.setCompatState;
    h.adapter.setCompatState = (id, value) => {
        if (id.endsWith('.DecisionRecord') && !release)
            return new Promise(resolve => {release = () => {void realWrite(id, value).then(resolve);};});
        return realWrite(id, value);
    };
    h.shadow.productionRecord();
    const samples = [];
    for (let i = 0; i < 4096; i++) {
        const at = h.now() - 60000 + i;
        const state = {val: 100, ts: at, lc: at - 100, ack: true, q: 0};
        samples.push(h.shadow.diagnosticSampler.observe('import', state, {...state, ts: at - 1}, at).sample);
    }
    assert.equal(h.shadow.diagnosticSampler.ring.length, 4096);
    const command = h.shadow.commandEvent('attempt', 'cmd', 7);
    assert.equal(h.shadow.recordDropped, 0, 'a valid prebuffer cannot itself overflow the record queue');
    assert.ok(h.shadow.recordQueue.length <= 128);
    release(); await h.flush();
    const records = h.records();
    assert.ok(records.every(r => r.schema === 2 && !r.reconstruction));
    assert.deepEqual(records.map(r => r.recordSequence), records.map((_, i) => i + 1));
    const before = records.filter(r => r.event?.type === 'recording.pre_event');
    assert.deepEqual(before.flatMap(r => r.event.samples), samples, 'the complete raw ring survives, in source receipt order');
    assert.ok(before.every(r => r.event.samples.length <= 128));
    assert.ok(before.every(r => Buffer.byteLength(JSON.stringify(r.event.samples)) <= 32768));
    const event = records.find(r => r.event?.type === 'command.attempt');
    assert.equal(event.event.commandId, command);
    assert.ok(event.recordSequence > before.at(-1).recordSequence, 'all pre-event batches precede the actual command event');
});

test('important source edges flush preceding dense samples before commands and preserve raw ACK response order', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.shadow.productionRecord(); await h.flush();
    h.shadow.recordEventWindow();
    let previous = h.states.get('power'); h.advance(10); h.put('power', 0.1, {lc: 1900000});
    h.shadow.captureProduction('power', h.states.get('power'), previous);
    const sourceSequence = h.shadow.diagnosticSampler.sequence;
    h.advance(10); const token = h.shadow.commandEvent('attempt', 'cmd', 7);
    h.advance(10); h.shadow.commandEvent('transport_complete', 'cmd', 7, token);
    for (const extra of [{ack: false}, {ack: true}, {q: 64}, {q: 0}, {val: null}, {val: 7}]) {
        previous = h.states.get('cmd'); h.advance(10); h.put('cmd', 7, {lc: 1900000, ...extra});
        h.shadow.captureProduction('cmd', h.states.get('cmd'), previous);
    }
    previous = h.states.get('power'); h.advance(10); h.put('power', 1.61, {lc: 1900000});
    h.shadow.captureProduction('power', h.states.get('power'), previous);
    const responseSequence = h.shadow.diagnosticSampler.sequence;
    h.advance(1000); h.shadow.productionRecord(); await h.flush();
    const records = h.records();
    assert.deepEqual(records.map(r => r.recordSequence), records.map((_, i) => i + 1));
    assert.ok(records.every(r => r.schema === 2 && !r.reconstruction));
    const preceding = records.find(r => r.event?.samples?.some(s => s.sampleSequence === sourceSequence));
    const attempt = records.find(r => r.event?.type === 'command.attempt');
    const completion = records.find(r => r.event?.type === 'command.transport_complete');
    assert.ok(preceding.recordSequence < attempt.recordSequence);
    assert.ok(attempt.recordSequence < completion.recordSequence);
    assert.equal(attempt.event.commandId, completion.event.commandId);
    const feedback = records.filter(r => r.event?.type === 'source.update' && r.event.id === 'cmd');
    assert.deepEqual(feedback.map(r => [r.event.state.val, r.event.state.ack, r.event.state.q]),
        [[7, false, 0], [7, true, 0], [7, true, 64], [7, true, 0], [null, true, 0], [7, true, 0]]);
    assert.ok(feedback.every(r => r.recordSequence > completion.recordSequence));
    assert.ok(feedback.every(r => r.event.state.ts === r.event.receivedAt && r.event.state.lc === 1900000));
    const response = records.find(r => r.event?.samples?.some(s => s.sampleSequence === responseSequence));
    assert.ok(response.recordSequence > feedback.at(-1).recordSequence);
    assert.equal(response.production.wallboxes[0].actual_W, 1610);
    assert.ok(records.every(r => r.valid === false && r.modelPaused), 'raw real observations do not fabricate shadow validity');
});

test('numeric-only stop-reason ages do not renew dense windows, while changed fault category does', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.own('Devices.Wallbox0.LastStopReason', 'Hausanschluss L3: veraltet (Alter 31 s; maximal 30 s)');
    h.shadow.productionRecord(); h.shadow.recordEventWindow(); await h.flush();
    const deadline = h.shadow.diagnosticSampler.denseUntil;
    h.advance(1000); h.own('Devices.Wallbox0.LastStopReason', 'Hausanschluss L3: veraltet (Alter 32 s; maximal 30 s)');
    h.shadow.productionRecord(); await h.flush();
    assert.equal(h.shadow.diagnosticSampler.denseUntil, deadline, 'a changing age in the same reason is not a new fault');
    assert.equal(h.records().at(-1).production.wallboxes[0].LastStopReason,
        'Hausanschluss L3: veraltet (Alter 32 s; maximal 30 s)', 'emitted context still retains the exact raw reason');
    h.advance(1000); h.own('Devices.Wallbox0.LastStopReason', 'Hausanschluss L3: ungueltig (Alter 32 s; maximal 30 s)');
    h.shadow.productionRecord(); await h.flush();
    assert.ok(h.shadow.diagnosticSampler.denseUntil > deadline, 'a changed fault category opens a real event window');
    const categoryDeadline = h.shadow.diagnosticSampler.denseUntil;
    h.advance(1000); h.own('Devices.Wallbox0.LastStopReason', 'Hausanschluss L2: ungueltig (Alter 33 s; maximal 30 s)');
    h.shadow.productionRecord(); await h.flush();
    assert.ok(h.shadow.diagnosticSampler.denseUntil > categoryDeadline, 'L2 and L3 identities must not be normalized away');
});

test('shutdown explicitly counts unsent dense samples rather than claiming a complete event window', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.shadow.productionRecord(); h.shadow.recordEventWindow(); await h.flush();
    const previous = h.states.get('power'); h.advance(10); h.put('power', 0.1);
    h.shadow.captureProduction('power', h.states.get('power'), previous);
    const sequence = h.shadow.diagnosticSampler.sequence;
    const recordsBeforeStop = h.rawRecords().length, lostBefore = h.shadow.diagnosticSampler.lost;
    h.shadow.stop(); await h.flush();
    assert.equal(h.rawRecords().length, recordsBeforeStop, 'shutdown does not fabricate confirmation of an unpersisted raw batch');
    assert.equal(h.shadow.diagnosticSampler.lost, lostBefore + 1);
    assert.equal(h.shadow.diagnosticSampler.ring.length, 0);
    assert.equal(h.shadow.diagnosticSampler.bytes, 0);
    assert.ok(!h.records().some(r => r.event?.samples?.some(s => s.sampleSequence === sequence)));
});

test('an event after a stalled dense flush retains pending raw samples older than the pre-event ring', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.shadow.productionRecord(); h.shadow.recordEventWindow(); await h.flush();
    const previous = h.states.get('pv'); h.advance(100); h.put('pv', 6000, {lc: 1900000});
    h.shadow.captureProduction('pv', h.states.get('pv'), previous);
    const expected = {id: 'pv', receivedAt: h.now(), state: structuredClone(h.states.get('pv'))};
    const sequence = h.shadow.diagnosticSampler.sequence;
    h.advance(70000); h.shadow.recordEventWindow(); await h.flush();
    const samples = h.records().flatMap(r => r.event?.samples || []).filter(s => s.sampleSequence === sequence);
    assert.equal(samples.length, 1, 'a stalled unsent batch is flushed before the ring expires, rather than silently cleared');
    assert.deepEqual({id: samples[0].id, receivedAt: samples[0].receivedAt, state: samples[0].state}, expected);
    assert.equal(h.shadow.diagnosticSampler.lost, 0);
});

test('the first matching post-command ACK observation is immediate and later unchanged polls remain batched', async t => {
    const h = fixture(2000000); t.mock.method(Date, 'now', h.now);
    h.shadow.productionRecord(); const command = h.shadow.commandEvent('attempt', 'cmd', 6);
    let previous = h.states.get('cmd'); h.advance(1); h.put('cmd', 6, {lc: 1900000});
    h.shadow.captureProduction('cmd', h.states.get('cmd'), previous); await h.flush();
    let observations = h.records().filter(r => r.event?.type === 'source.update' && r.event.id === 'cmd');
    assert.equal(observations.length, 1);
    assert.equal(observations[0].event.triggerReason, 'post-command-observation');
    assert.equal(observations[0].event.state.ts, 2000001);
    assert.equal(observations[0].event.state.lc, 1900000);
    assert.equal(observations[0].production.commands.cmd.commandId, command);
    h.advance(1); h.shadow.commandEvent('transport_complete', 'cmd', 6, command);
    previous = h.states.get('cmd'); h.advance(1); h.put('cmd', 6, {lc: 1900000});
    h.shadow.captureProduction('cmd', h.states.get('cmd'), previous); await h.flush();
    observations = h.records().filter(r => r.event?.type === 'source.update' && r.event.id === 'cmd');
    assert.equal(observations.length, 1, 'transport completion does not reopen the same command observation');
    const nextCommand = h.shadow.commandEvent('attempt', 'cmd', 6);
    assert.notEqual(nextCommand, command);
    previous = h.states.get('cmd'); h.advance(1); h.put('cmd', 6, {lc: 1900000});
    h.shadow.captureProduction('cmd', h.states.get('cmd'), previous); await h.flush();
    observations = h.records().filter(r => r.event?.type === 'source.update' && r.event.id === 'cmd');
    assert.equal(observations.length, 2, 'a new token retains its own first matching observation even with the same commanded value');
    assert.equal(observations[1].production.commands.cmd.commandId, nextCommand);
    assert.ok(h.records().some(r => r.event?.samples?.some(s => s.id === 'cmd' && s.state.ts === 2000003)),
        'the subsequent routine ACK poll remains available in the flushed raw source batch');
});



