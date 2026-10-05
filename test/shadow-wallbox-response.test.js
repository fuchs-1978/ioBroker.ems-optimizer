'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {wallboxResponse} = require('../lib/shadow-wallbox-response');
const ShadowSampleBuffer = require('../lib/shadow-sample-buffer');
const ShadowWallboxModel = require('../lib/shadow-wallbox-model');

function fixture() {
    const now = 1000000, rawStates = new Map(), mapping = {}, config = {}, devices = [];
    const put = (id, val, extra = {}) => rawStates.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    mapping.DP_GRID_IMPORT = 'import'; mapping.DP_GRID_EXPORT = 'export';
    // Independently generated nominal scenario: 230 V, 16 A legacy WB,
    // 6 A modeled WB and 1 A equivalent net import.
    put('import', 230); put('export', 0);
    for (const wb of [0, 1, 2]) {
        devices.push({wb, valid: true}); config[`wb${wb}ProductionArmed`] = true;
        put(`ems.0.Devices.Wallbox${wb}.Present`, true);
        put(`ems.0.Devices.Wallbox${wb}.ControlEnabled`, true);
        mapping[`DP_WB${wb}_POWER`] = `power${wb}`; put(`power${wb}`, wb === 1 ? 16 * 230 / 1000 : 0);
        for (const p of [1, 2, 3]) {
            mapping[`DP_WB${wb}_L${p}_A`] = `current${wb}.${p}`; put(`current${wb}.${p}`, p === 1 ? 16 : 0);
        }
    }
    const run = sampleBuffer => {
        const states = structuredClone(rawStates);
        return {states, ...wallboxResponse({states, rawStates, devices, mapping, config,
            now, namespace: 'ems.0', sampleBuffer, decision: wb => ({powerW: wb === 1 ? 1380 : 0,
                amps: wb === 1 ? 6 : 0, phases: 1})})};
    };
    return {rawStates, config, put, run};
}

test('private load substitution preserves exogenous balance for all three wallboxes and raw metadata', () => {
    const h = fixture();
    h.put('power0', 1); h.put('power2', 2);
    const before = structuredClone(h.rawStates), r = h.run();
    assert.equal(r.response.valid, true);
    assert.equal(r.response.gridW, 230 + 6 * 230 - 16 * 230 - 1000 - 2000);
    assert.equal(r.states.get('import').val, 0);
    assert.equal(r.states.get('export').val, -r.response.gridW);
    assert.deepEqual([0, 1, 2].map(wb => r.states.get(`power${wb}`).val), [0, 1.38, 0]);
    assert.equal(r.states.get('power1').ts, h.rawStates.get('power1').ts);
    assert.deepEqual(h.rawStates, before);
    assert.equal(r.states.get('current1.1').val, 16, 'real current safety and phase inputs stay untouched');
    assert.equal(r.currents.get(1), 6, 'only the separate vehicle-response hook assumes modeled current');
});

function bufferedFixture(spread = 0.02) {
    const h = fixture(), buffer = new ShadowSampleBuffer();
    const ids = ['import', 'export', 'power0', 'power1', 'power2'];
    for (const id of ids) h.put(id, id === 'import' ? 230 : id === 'power1' ? 3.68 : 0, {ts: 990000});
    buffer.capture(h.rawStates, ids, 990000);
    h.put('import', 230, {ts: 992000}); h.put('export', 0, {ts: 992000});
    buffer.capture(h.rawStates, ids, 992000);
    h.put('import', 300); h.put('export', 0);
    h.put('power1', 3.68 + spread, {ts: 997000});
    h.put('power0', 0); h.put('power2', 0);
    buffer.capture(h.rawStates, ids, 1000000);
    return {h, buffer, ids};
}

test('bounded common historical baseline repairs poll skew, not current protection inputs', () => {
    const {h, buffer} = bufferedFixture(), before = structuredClone(h.rawStates);
    const r = h.run(buffer);
    assert.equal(r.response.valid, true);
    assert.equal(r.response.basis, 'bracketed-historical-input');
    assert.equal(r.response.inputTimestamp, 992000);
    assert.equal(r.response.inputAgeMs, 8000);
    assert.equal(r.response.currentRealGridW, 300);
    assert.equal(r.response.maximumObservedPowerSpreadW, 300);
    assert.ok(Math.abs(r.response.gridW - (230 + 1380 - (3680 + 20 * 2 / 7))) < 0.001);
    assert.equal(r.response.wallboxes.Wallbox1.alignment.beforeTs, 990000);
    assert.equal(r.response.wallboxes.Wallbox1.alignment.afterTs, 997000);
    assert.equal(r.states.get('import').ts, 992000, 'historical input never claims current timestamp');
    assert.deepEqual(h.rawStates, before);
    assert.equal(r.states.get('current1.1').val, 16);
});

test('large load steps, missing brackets and expired baselines stay unknown', () => {
    for (const change of [
        ({h, buffer, ids}) => { h.put('power1', 0, {ts: 997000}); buffer.clear(); buffer.capture(h.rawStates, ids, 1000000); },
        ({buffer}) => buffer.clear(),
        ({buffer}) => { for (const id of ['import', 'export']) buffer.samples.set(id,
            buffer.samples.get(id).filter(s => s.ts < 990000)); }
    ]) {
        const f = bufferedFixture(); change(f);
        const r = f.h.run(f.buffer);
        assert.equal(r.response.valid, false);
        assert.equal(r.response.applied, false);
        assert.deepEqual(r.states, f.h.rawStates);
    }
    const f = bufferedFixture(1);
    assert.equal(f.h.run(f.buffer).response.valid, false, '1-kW bracket is not interpolated');
});

test('history cannot repair invalid latest WB telemetry; affected correction is separately marked', () => {
    for (const extra of [{ack: false}, {q: 64}, {ts: 1}]) {
        const {h, buffer} = bufferedFixture(); h.put('power1', 3.7, extra);
        const r = h.run(buffer);
        assert.equal(r.response.valid, false);
        assert.equal(r.response.wallboxes.Wallbox1.telemetryValid, false);
        assert.equal(r.response.applied, false);
    }
    const {h} = bufferedFixture(); const r = h.run();
    assert.equal(r.response.wallboxes.Wallbox1.telemetryValid, true);
    assert.equal(r.response.wallboxes.Wallbox1.correctionValid, false);
    assert.equal(r.response.wallboxes.Wallbox0.correctionValid, true);
});

test('quality gaps are not interpolated and buffer memory is bounded', () => {
    const b = new ShadowSampleBuffer(), states = new Map();
    for (let i = 0; i < 500; i++) {
        states.set('p', {val: 3.68, ts: 100000 + i, ack: true, q: 0});
        b.capture(states, ['p'], 100000 + i);
    }
    assert.ok(b.samples.get('p').length <= 128);
    states.set('p', {val: 3.68, ts: 101000, ack: true, q: 64}); b.capture(states, ['p'], 101000);
    assert.equal(b.at('p', 100900, true), null);
    b.capture(states, ['p'], 200000);
    assert.equal(b.samples.get('p').length, 0);
});

test('an invalid real power source disables the response instead of repairing safety data', () => {
    for (const [value, extra, reason] of [[-0.021, {}, 'negative'], [null, {}, 'numeric'],
        [16 * 230 / 1000, {ts: 1}, 'stale'], [16 * 230 / 1000, {ts: 1001001}, 'future'],
        [16 * 230 / 1000, {ack: false}, 'unacknowledged'], [16 * 230 / 1000, {q: 64}, 'quality']]) {
        const h = fixture(); h.put('power1', value, extra);
        const r = h.run();
        assert.equal(r.response.valid, false, reason);
        assert.equal(r.response.applied, false);
        assert.match(r.response.reason, new RegExp(reason));
        assert.deepEqual(r.states, h.rawStates, 'no partial load/grid substitution');
        assert.equal(r.currents.size, 0);
    }
});

test('small fresh negative meter noise is normalized, while disconnected WB loads remain exogenous', () => {
    const h = fixture(); h.put('power1', -0.01);
    h.put('power2', 2); h.put('ems.0.Devices.Wallbox2.ControlEnabled', false);
    const r = h.run();
    assert.equal(r.response.valid, true);
    assert.equal(r.response.wallboxes.Wallbox1.rawPowerW, -10);
    assert.equal(r.response.wallboxes.Wallbox1.realPowerW, 0);
    assert.equal(r.response.gridW, 230 + 6 * 230);
    assert.equal(r.states.get('power2').val, 2);
    assert.equal(r.response.wallboxes.Wallbox2, undefined);
});

test('a newer grid measurement cannot be combined with an old large WB correction', () => {
    const h = fixture();
    h.put('import', 0); h.put('export', 3541);
    h.put('power1', 5.11, {ts: 1000000 - 3661});
    const r = h.run();
    assert.equal(r.response.valid, false);
    assert.equal(r.response.applied, false);
    assert.match(r.response.reason, /grid-power-asynchronous \(3661 ms/);
    assert.equal(r.response.wallboxes.Wallbox1.gridPowerSkewMs, 3661);
    assert.deepEqual(r.states, h.rawStates);
    h.put('power1', 5.11, {ts: 1000000 - 500});
    assert.equal(h.run().response.valid, true);
});

test('small substitutions tolerate ordinary meter and wallbox poll skew', () => {
    const h = fixture();
    h.put('power1', 1.3, {ts: 1000000 - 3661});
    assert.equal(h.run().response.valid, true);
});

function slowPollingFixture() {
    const h = fixture(), buffer = new ShadowSampleBuffer();
    const ids = ['import', 'export', 'power0', 'power1', 'power2'];
    for (const id of ids) h.put(id, id === 'import' ? 230 : id === 'power1' ? 3.68 : 0, {ts: 970000});
    buffer.capture(h.rawStates, ids, 970000);
    h.put('import', 230, {ts: 984000}); h.put('export', 0, {ts: 984000});
    buffer.capture(h.rawStates, ids, 984000);
    for (const wb of [0, 1, 2]) h.put(`power${wb}`, wb === 1 ? 3.7 : 0, {ts: 985000});
    h.put('import', 300); h.put('export', 0);
    buffer.capture(h.rawStates, ids, 1000000);
    return {h, buffer, ids};
}

test('15-second polling allows only a bounded complete historical frame beyond ten seconds', () => {
    const {h, buffer} = slowPollingFixture(), original = structuredClone(h.rawStates);
    const r = h.run(buffer);
    assert.equal(r.response.valid, true);
    assert.equal(r.response.inputAgeMs, 16000);
    assert.equal(r.response.inputTimestamp, 984000);
    assert.equal(r.response.alignment.maxAgeMs, 20000);
    assert.equal(r.response.alignment.status, 'aligned');
    assert.equal(r.response.powerUncertaintyBoundW, 300);
    assert.ok(Math.abs(r.response.observedPowerSpreadW - 20) < 0.001);
    assert.equal(r.states.get('import').ts, 984000);
    assert.equal(r.states.get('power1').alignment.afterTs, 985000);
    assert.deepEqual(h.rawStates, original, 'current real safety inputs are never rewritten');
});

test('slow-poll alignment rejects load steps, grid drift and gaps instead of extrapolating', () => {
    for (const change of [
        ({h, buffer, ids}) => { h.put('power1', 3.9, {ts: 985000}); buffer.capture(h.rawStates, ids, 1000000); },
        ({h}) => h.put('import', 731),
        ({buffer}) => { buffer.samples.get('power1').splice(1, 0, {val: 3.68, ts: 980000, ack: true, q: 64}); },
        ({buffer}) => { buffer.samples.set('power1', buffer.samples.get('power1').slice(1)); },
        ({buffer}) => { for (const id of ['import', 'export']) buffer.samples.set(id,
            buffer.samples.get(id).filter(s => s.ts < 980000)); }
    ]) {
        const f = slowPollingFixture(); change(f);
        const r = f.h.run(f.buffer);
        assert.equal(r.response.valid, false);
        assert.equal(r.response.applied, false);
        assert.equal(r.response.timingState, 'waiting-for-common-measurements');
        assert.equal(r.response.alignment.status, 'waiting');
        assert.ok(r.response.alignment.reasons.length > 0);
        assert.deepEqual(r.states, f.h.rawStates);
    }
});

test('historical frames never repair stale current grid or latest telemetry quality', () => {
    for (const [id, extra] of [['import', {ts: 989999}], ['export', {ack: false}],
        ['power1', {q: 64}], ['power1', {ts: 1001001}], ['power1', {val: null}]]) {
        const {h, buffer} = slowPollingFixture();
        h.put(id, h.rawStates.get(id).val, extra);
        const r = h.run(buffer);
        assert.equal(r.response.valid, false, id);
        assert.equal(r.response.timingState, 'invalid-source');
        assert.equal(r.response.applied, false);
        assert.deepEqual(r.states, h.rawStates);
    }
    const {h, buffer} = slowPollingFixture();
    h.config.wallboxMeasurementMaxAgeS = 10;
    assert.equal(h.run(buffer).response.valid, false, 'a smaller configured source age remains binding');
});

test('power interpolation never spans more than twenty seconds', () => {
    const b = new ShadowSampleBuffer();
    b.samples.set('power', [{val: 3.68, ts: 970000, ack: true, q: 0},
        {val: 3.68, ts: 991000, ack: true, q: 0}]);
    assert.equal(b.at('power', 984000, true), null);
});

test('the export half of a historical grid pair must also respect its age limit', () => {
    const {h, buffer} = slowPollingFixture();
    buffer.samples.set('import', [{val: 230, ts: 980000, ack: true, q: 0}]);
    buffer.samples.set('export', [{val: 0, ts: 978000, ack: true, q: 0}]);
    const r = h.run(buffer);
    assert.equal(r.response.valid, false);
    assert.equal(r.response.applied, false);
    assert.ok(r.response.alignment.reasons.includes('grid-pair-missing'));
});

function peerHandoffFixture() {
    let now = 1000000000000;
    const rawStates = new Map(), devices = [], mapping = {}, violations = [];
    const put = (id, val, extra = {}) => rawStates.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    const config = {globalWriteEnabled: false, multiWallboxAlphaArmed: true,
        wallboxMinimumRunTimeS: 600, wallboxMeasurementMaxAgeS: 30,
        wallboxResponseSettleTimeoutS: 45, slowCycleS: 5,
        dhwHaL1CurrentId: 'h1', dhwHaL2CurrentId: 'h2', dhwHaL3CurrentId: 'h3'};
    Object.assign(mapping, {DP_GRID_IMPORT: 'import', DP_GRID_EXPORT: 'export', DP_HA_CRITICAL: 'critical'});
    for (const [id, val] of Object.entries({import: 0, export: 128, critical: false, h1: 10, h2: 10, h3: 10})) put(id, val);
    for (const key of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Enabled', 'Control.Valid'])
        put(`ems.0.${key}`, true);
    put('ems.0.Control.SelectedWallbox', 2); put('ems.0.Control.TargetGridPower_W', -100);
    put('ems.0.System.LastUpdate', now); put('ems.0.Control.LastUpdate', now);
    for (const wb of [0, 1, 2]) {
        const ids = {command: `cmd${wb}`, feedback: `feedback${wb}`, allow: `allow${wb}`,
            connection: `connection${wb}`, error: `error${wb}`};
        devices.push({wb, ids, valid: true});
        Object.assign(config, {[`wb${wb}Present`]: true, [`wb${wb}ControlEnabled`]: true,
            [`wb${wb}ProductionArmed`]: true, [`wb${wb}ProductionPhases`]: 1,
            [`wb${wb}SinglePhaseGridPhase`]: wb + 1, [`wb${wb}CommissioningMaxA`]: 32,
            [`wb${wb}MinCurrent1pA`]: 6, [`wb${wb}MaxCurrent1pA`]: 32, [`wb${wb}MaxPowerW`]: 7360});
        for (const [suffix, id] of Object.entries({CAR: `car${wb}`, SOC: `soc${wb}`,
            ALLOW: `userAllow${wb}`, POWER: `power${wb}`, L1_A: `i${wb}1`, L2_A: `i${wb}2`, L3_A: `i${wb}3`}))
            mapping[`DP_WB${wb}_${suffix}`] = id;
        put(`ems.0.Devices.Wallbox${wb}.Present`, true);
        put(`ems.0.Devices.Wallbox${wb}.ControlEnabled`, true);
        put(`ems.0.Vehicles.Wallbox${wb}.SoCValid`, true);
        put(`ems.0.Vehicles.Wallbox${wb}.Release`, wb === 2);
        put(`ems.0.Vehicles.Wallbox${wb}.TargetSoC_pct`, wb === 0 ? 80 : 95);
        put(`ems.0.Vehicles.Wallbox${wb}.MinimumSoC_pct`, 20);
        put(`ems.0.Control.Targets.Wallbox${wb}_W`, wb === 2 ? 3578 : 0);
        put(`ems.0.Control.Targets.Wallbox${wb}_Phases`, 1);
        for (const [id, val] of Object.entries({[`car${wb}`]: wb === 2 ? 2 : 1,
            [`soc${wb}`]: wb === 0 ? 80 : 78, [`userAllow${wb}`]: true,
            [`power${wb}`]: wb === 2 ? 3.97 : 0, [`i${wb}1`]: wb === 2 ? 17.2 : 0,
            [`i${wb}2`]: 0, [`i${wb}3`]: 0, [`cmd${wb}`]: wb === 2 ? 15 : 6,
            [`feedback${wb}`]: wb === 2 ? 15 : 6, [`allow${wb}`]: wb === 2 ? 1 : 0,
            [`connection${wb}`]: true, [`error${wb}`]: 0})) put(id, val);
    }
    const model = new ShadowWallboxModel({namespace: 'ems.0', config, devices, mapping,
        states: structuredClone(rawStates), context: {}, now: () => now,
        violation: reason => violations.push(reason)});
    const eqe = model.output.devices.find(d => d.wb === 2), activeSince = now - 577000;
    Object.assign(eqe, {owned: true, activeSince, lastA: 15, lastAt: now, confirmedPhases: 1});
    for (const [key, value] of Object.entries({OutputOwned: true, OutputActive: true,
        OutputCommand_A: 15, OutputReservedPower_W: 3450, OutputPhases: 1})) model.output.publish(2, key, value);
    model.feedback.set('allow2', {val: 1, ack: true, ts: now, q: 0});
    const poll = milliseconds => {
        now += milliseconds;
        for (const [id, state] of rawStates) rawStates.set(id, {...state, ts: now});
        put('ems.0.System.LastUpdate', now); put('ems.0.Control.LastUpdate', now);
    };
    const tick = async () => {
        model.prepare(structuredClone(rawStates), {});
        model.prepareResponse();
        await model.tick();
    };
    return {rawStates, model, put, poll, tick, violations, activeSince};
}

test('instant private OFF acknowledgement of an unplugged Mii peer preserves the selected EQE and its minimum run', async () => {
    const h = peerHandoffFixture();
    await h.tick();
    assert.equal(h.model.decision(2).active, true);
    assert.equal(h.model.decision(2).minimumRunRemainingS, 23);
    h.poll(15000); h.put('allow0', 1);
    const original = structuredClone(h.rawStates);
    await h.tick();
    assert.equal(h.model.response.valid, true);
    assert.equal(h.model.feedback.get('allow0').val, 0, 'the isolated model closes the foreign permission');
    assert.equal(h.model.output.devices[0].owned, false, 'its immediate private OFF/zero proof completes the stop');
    assert.equal(h.model.output.devices[0].stopRequest, null);
    const eqe = h.model.decision(2);
    assert.equal(eqe.active, true);
    assert.equal(eqe.owned, true);
    assert.equal(eqe.powerW, 3450);
    assert.equal(eqe.stage, 'running');
    assert.equal(eqe.minimumRunRemainingS, 8, 'the peer pulse neither clears nor restarts minimum runtime');
    assert.equal(h.model.output.devices[2].activeSince, h.activeSince);
    assert.equal(h.model.feedback.get('allow2').val, 1, 'no EQE stop command is modeled');
    assert.equal(h.rawStates.get('allow0').val, 1, 'real permission is untouched');
    assert.deepEqual(h.rawStates, original, 'no original source or actuator state is changed');
    assert.deepEqual(h.violations, []);
});

test('an invalid assumed response cannot infer electrical stop proof from an idle real peer', async () => {
    const h = peerHandoffFixture(); await h.tick();
    h.poll(15000); h.put('allow0', 1); h.put('power1', 0, {q: 64});
    const original = structuredClone(h.rawStates);
    await h.tick();
    assert.equal(h.model.response.valid, false);
    assert.equal(h.model.feedback.get('allow0').val, 0, 'the private OFF ACK alone still exists');
    assert.equal(h.rawStates.get('power0').val, 0);
    assert.equal(h.model.output.devices[0].owned, true, 'unknown modeled response is not physical zero-load proof');
    assert.notEqual(h.model.output.devices[0].stopRequest, null);
    assert.equal(h.model.decision(2).active, false, 'the existing interlock fails closed while peer stop remains unknown');
    assert.deepEqual(h.rawStates, original);
    assert.deepEqual(h.violations, []);
    h.poll(60000);
    await h.tick();
    assert.equal(h.model.response.valid, false);
    assert.equal(h.model.output.devices[0].owned, true);
    assert.notEqual(h.model.output.devices[0].stopRequest, null);
    assert.equal(h.model.output.devices[0].fault, '', 'a prolonged unavailable model is not a physical OFF failure');
    assert.equal(h.model.decision(2).active, false);
    h.poll(15000); h.put('power1', 0, {q: 0});
    await h.tick();
    assert.equal(h.model.response.valid, true);
    assert.equal(h.model.output.devices[0].owned, false, 'a later valid assumed zero response can complete the private stop');
    assert.equal(h.model.output.devices[0].fault, '');
});
