'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

// Values and command times reported in owner-authored issue211. The fixture
// supplies the unreported individual source times and the startup preceding
// that excerpt; this is a controlled integration reproduction, not raw SQL.
const FIRST = Date.parse('2026-10-19T14:51:30.179Z');
const SECOND = Date.parse('2026-10-19T14:51:36.163Z');
const LATER = Date.parse('2026-10-19T14:52:26.096Z');
const RECOVERY = Date.parse('2026-10-19T14:52:34.081Z');

function frame(at, {powerW = 1450, currentA = 6.6, exportW = 40.8, importW = 0,
    feedback = 7, ackAt = FIRST + 250, powerAt = at - 50, currentAt = at - 55,
    gridAt = at - 30, pvW = 1603, extra = []} = {}) {
    return [
        ['DP_WB2_POWER', powerW / 1000, {ts: powerAt}],
        ['DP_WB2_L1_A', currentA, {ts: currentAt}],
        ['DP_WB2_L2_A', 0, {ts: currentAt}], ['DP_WB2_L3_A', 0, {ts: currentAt}],
        ['goe.feedback', feedback, {ts: ackAt}],
        ['DP_GRID_IMPORT', importW, {ts: gridAt}], ['DP_GRID_EXPORT', exportW, {ts: gridAt + 1}],
        ['DP_PV_POWER', pvW, {ts: gridAt}], ...extra
    ];
}

async function replay(h, at, values = {}, allocationLeadMs = 1) {
    const samples = frame(at, values);
    await h.replayAt(at - allocationLeadMs, samples, {output: false});
    await h.replayAt(at, samples, {allocate: false});
}

const commands = h => h.writes.filter(write => write.id === 'goe.cmd');
const budget = h => JSON.parse(h.value('Devices.Wallbox2.IncreaseBudget_JSON'));
const allocation = h => JSON.parse(h.value('Control.Wallbox2.AllocationDiagnostics_JSON'));
const diagnostic = h => JSON.stringify({commands: commands(h), budget: budget(h), allocation: allocation(h),
    response: h.output.devices[2].response, pending: h.output.devices[2].pending,
    step: h.output.devices[2].measuredBudgetStep, status: h.value('Devices.Wallbox2.OutputStatus')});

async function runningSixAmps(gridPhase, options = {}) {
    const h = await plant({initialTime: Math.floor(FIRST / 1000) * 1000 - 120000,
        startDelayS: 0, minimumRuntimeS: 600, split: false,
        initialSurplusW: 1380, wb2InitialPhaseMode: 1, ...options});
    Object.assign(h.config, {wallboxParallelChargingEnabled: true,
        wallboxPVImportToleranceW: 100, wb2SinglePhaseGridPhase: gridPhase});
    h.own('Config.WallboxParallelChargingEnabled', true);
    h.own('Config.WallboxPVImportTolerance_W', 100);
    h.own('Config.WallboxStartReserve_W', 0);
    h.own('Control.TargetGridPower_W', 0);
    if (options.mii) h.put('DP_WB0_SOC', 100);
    // Run genuine startup, ACK and electrical response through the production
    // loader/controller. No allocation or pending/response object is fabricated.
    await h.advance(118);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.equal(h.output.devices[2].lastA, 6, h.diagnostic());
    assert.equal(h.output.devices[2].pending, null);
    assert.equal(h.output.devices[2].response, null);
    h.writes.length = 0;
    return h;
}

async function issueFirstStep(h, allocationLeadMs = 1) {
    const initial = {powerW: 1280, currentA: 5.9, exportW: 222.9,
        feedback: 6, ackAt: FIRST - 100};
    await replay(h, FIRST, initial, allocationLeadMs);
    assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
    assert.equal(budget(h).basis, 'measured-one-amp-step');
    assert.equal(budget(h).pvStepToleranceW, 100);
    assert.equal(budget(h).pvStepAdmissionW, 80);
    assert.ok(h.output.devices[2].measuredBudgetStep);
    // A timely ACK arrives before the first changed electrical sample.
    // Its timestamp alone cannot count as vehicle response or earn another amp.
    await h.replayAt(Math.max(FIRST + 251, h.now() + 1),
        frame(FIRST, {...initial, feedback: 7, ackAt: FIRST + 250}),
        {allocate: false});
    assert.equal(h.value('Devices.Wallbox2.ResponseState'), 'vehicle_response');
    assert.equal(h.output.devices[2].lastA, 7);
    assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}]);
}

for (const gridPhase of [1, 2, 3]) {
    test(`issue211 integration: 6.6A/1450W confirms7A on house phase${gridPhase}`, async () => {
        const h = await runningSixAmps(gridPhase);
        await issueFirstStep(h);
        await replay(h, SECOND);
        assert.equal(allocation(h).responseState, 'vehicle_response');
        assert.equal(h.value('Devices.Wallbox2.ResponseState'), 'confirmed', diagnostic(h));
        assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
        assert.equal(h.output.devices[2].lastA, 7);
        assert.equal(h.output.devices[2].pending, null);
        assert.equal(h.output.devices[2].response, null);
        assert.equal(h.output.devices[2].measuredBudgetStep, null, diagnostic(h));
        assert.equal(budget(h).awaitingElectricalStep, false);
        assert.equal(budget(h).basis, 'fresh-response-allocation-hold');
    });
}

test('issue211 integration: allocator and real electrical confirmation may share one millisecond', async () => {
    const h = await runningSixAmps(1);
    await issueFirstStep(h, 0);
    await replay(h, SECOND, {}, 0);
    assert.equal(allocation(h).timestamp, SECOND);
    assert.equal(allocation(h).responseState, 'vehicle_response');
    assert.equal(h.value('Devices.Wallbox2.ResponseConfirmedAt'), SECOND);
    assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
    assert.equal(h.value('Devices.Wallbox2.ResponseState'), 'confirmed');
    assert.equal(h.output.devices[2].measuredBudgetStep, null);
});

test('issue211 later1460W/6.6A and130.4W export do not recreate the6A/7A cycle', async () => {
    const h = await runningSixAmps(3);
    await issueFirstStep(h);
    await replay(h, SECOND);
    for (let at = SECOND + 6000; at < LATER; at += 6000) {
        await replay(h, at, {ackAt: at - 100});
    }
    await replay(h, LATER, {powerW: 1460, exportW: 130.4, pvW: 1616, ackAt: LATER - 100});
    await replay(h, RECOVERY, {powerW: 1460, exportW: 130.4, pvW: 1620, ackAt: RECOVERY - 100});
    assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
    assert.equal(h.output.devices[2].lastA, 7);
    assert.equal(h.output.devices[2].response, null);
    assert.equal(h.output.devices[2].measuredBudgetStep, null);
    assert.ok(!h.writes.some(write => write.id === 'goe.allow'));
});

for (const [name, modify, values, options] of [
    ['actual400W net import', () => {}, {importW: 400, exportW: 0}],
    ['device6A cap', h => {h.config.wb2CommissioningMaxA = 6;}],
    ['device1380W cap', h => {h.config.wb2MaxPowerW = 1380;}],
    ['configured house phase reaches70A', () => {}, {extra: [['DP_DHW_HA_L3_CURRENT_A', 70]]}],
    ['LPC1380W cap', () => {}, {extra: [['lpc.state', 'limited'], ['lpc.limit', 1380]]}, {lpcLimitW: 11040}],
    ['measured1000W EHZ load step', () => {}, {importW: 959.2, exportW: 0,
        extra: [['DP_DHW_OUTPUT1', 1000], ['DP_DHW_OUTPUT2', 0], ['DP_DHW_OUTPUT3', 0]]}],
    ['measured1380W peer load step', () => {}, {importW: 1339.2, exportW: 0,
        extra: [['DP_WB0_POWER', 1.38], ['DP_WB0_L1_A', 6], ['DP_WB0_L2_A', 0],
            ['DP_WB0_L3_A', 0], ['goe0.allow', 1], ['goe0.feedback', 6]]}, {mii: true}],
    ['bad wallbox power quality', () => {}, {extra: [['DP_WB2_POWER', 1.45, {q: 64}]]}],
    ['missing wallbox power', () => {}, {extra: [['DP_WB2_POWER', null]]}],
    ['electrical samples before the original command ACK', () => {},
        {powerAt: FIRST + 100, currentAt: FIRST + 99}],
    ['future grid timestamp', () => {}, {gridAt: SECOND + 9000}],
    ['unacknowledged grid sample', () => {}, {extra: [['DP_GRID_EXPORT', 40.8, {ack: false}]]}],
    ['unacknowledged current feedback', () => {}, {extra: [['goe.feedback', 7, {ack: false}]]}]
]) {
    test(`issue211 confirmed partial response yields to ${name}`, async () => {
        const h = await runningSixAmps(3, options);
        await issueFirstStep(h);
        await replay(h, SECOND);
        assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
        h.writes.length = 0;
        modify(h);
        await replay(h, SECOND + 6000, values);
        assert.ok(h.writes.some(write => write.id === 'goe.cmd' && write.val <= 6
            || write.id === 'goe.allow' && write.val === 0), diagnostic(h));
        assert.ok(!h.writes.some(write => write.id === 'goe.cmd' && write.val > 7), diagnostic(h));
    });
}

test('issue211 integration: repeating the confirmed7A ACK cannot erase an unchanged fresh electrical response', async () => {
    const h = await runningSixAmps(1);
    await issueFirstStep(h);
    await replay(h, SECOND);
    assert.equal(h.output.devices[2].lastA, 7);
    assert.equal(h.output.devices[2].response, null);
    assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}]);
    const next = SECOND + 6000;
    // The same valid electrical pair remains younger than30s and after the
    // original7A command/ACK. Only the same-value ACK is republished later.
    await replay(h, next, {ackAt: next - 10, powerAt: SECOND - 50, currentAt: SECOND - 55});
    assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
    assert.equal(h.value('Devices.Wallbox2.ResponseState'), 'confirmed');
    assert.equal(h.output.devices[2].lastA, 7);
});

for (const gridPhase of [1, 3]) {
    test(`issue211 first electrical confirmation accepts a repeated same-command ACK after its samples on house phase${gridPhase}`, async () => {
        const h = await runningSixAmps(gridPhase);
        await issueFirstStep(h);
        const ackAt = h.output.devices[2].response.ackAt;
        assert.equal(ackAt, FIRST + 250);
        await replay(h, SECOND, {ackAt: SECOND - 10});
        assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
        assert.equal(h.value('Devices.Wallbox2.ResponseState'), 'confirmed');
        assert.equal(h.value('Devices.Wallbox2.ResponseAcknowledgedAt'), ackAt);
        assert.equal(h.output.devices[2].measuredBudgetStep, null);
        assert.equal(budget(h).awaitingElectricalStep, false);
    });
}

test('issue211 a repeated ACK alone does not confirm electrical response or replenish an admitted step', async () => {
    const h = await runningSixAmps(3);
    await issueFirstStep(h);
    const originalAckAt = h.output.devices[2].response.ackAt;
    const reservation = h.output.devices[2].measuredBudgetStep;
    const reservedObservation = JSON.stringify(reservation);
    for (const elapsed of [2000, 4000]) {
        await h.replayAt(FIRST + elapsed, frame(FIRST, {powerW: 1280, currentA: 5.9,
            exportW: 222.9, feedback: 7, ackAt: FIRST + elapsed - 10}), {allocate: false});
        assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
        assert.equal(h.value('Devices.Wallbox2.ResponseState'), 'vehicle_response');
        assert.equal(h.output.devices[2].response.ackAt, originalAckAt);
        assert.equal(h.output.devices[2].measuredBudgetStep, reservation);
        assert.equal(JSON.stringify(h.output.devices[2].measuredBudgetStep), reservedObservation);
        assert.equal(budget(h).awaitingElectricalStep, true);
    }
});

test('issue211 output restart discards the old electrical-step observation and cannot spend it again', async () => {
    const h = await runningSixAmps(3);
    await issueFirstStep(h);
    const previous = h.output.devices[2];
    assert.ok(previous.measuredBudgetStep);
    const generation = h.now();
    h.own('Control.RestartHandoffActive', true);
    h.own('Control.RestartHandoffSince', generation);
    await h.restartOutput();
    const current = h.output.devices[2];
    assert.notEqual(current, previous);
    assert.equal(current.pending, null);
    assert.equal(current.response, null);
    assert.equal(current.measuredBudgetStep, undefined);
    await replay(h, SECOND, {feedback: 7});
    assert.ok(!commands(h).some(write => write.val > 7), diagnostic(h));
    assert.ok(!h.writes.some(write => write.id === 'goe.allow' && write.val === 1));
});

test('issue211 retained confirmation can hold7A but cannot spend a new PV budget before post-poll electrical samples', async () => {
    const h = await runningSixAmps(3);
    await issueFirstStep(h);
    await replay(h, SECOND);
    const next = SECOND + 6000;
    await replay(h, next, {ackAt: next - 10, powerAt: SECOND - 50, currentAt: SECOND - 55,
        exportW: 450, pvW: 2200});
    assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
    assert.ok(allocation(h).targetA <= 7, 'a repeated ACK cannot turn the old electrical pair into a new grant');
    await replay(h, next + 6000, {ackAt: next - 10, exportW: 450, pvW: 2200});
    assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST},
        {id: 'goe.cmd', val: 8, at: next + 6000}], diagnostic(h));
});

for (const writeDelayMs of [5, 400]) {
    test(`issue211 a${writeDelayMs}ms transport completion cannot detach the original command ACK from its confirmed electrical pair`, async () => {
        const h = await runningSixAmps(3);
        h.setWallboxWriteDelay(writeDelayMs);
        await issueFirstStep(h);
        assert.equal(h.value('Devices.Wallbox2.ResponseSentAt'), FIRST);
        assert.equal(h.value('Devices.Wallbox2.OutputLastWrite'), FIRST + writeDelayMs);
        assert.equal(h.output.devices[2].response.ackAt, FIRST + 250);
        if (writeDelayMs > 250) {
            assert.ok(h.value('Devices.Wallbox2.OutputLastWrite') > h.output.devices[2].response.ackAt,
                'the source ACK may precede the awaited transport callback');
        }
        await replay(h, SECOND);
        const next = SECOND + 6000;
        await replay(h, next, {ackAt: next - 10, powerAt: SECOND - 50, currentAt: SECOND - 55});
        assert.deepEqual(commands(h), [{id: 'goe.cmd', val: 7, at: FIRST}], diagnostic(h));
        assert.equal(h.output.devices[2].lastA, 7);
    });
}


// Age alone is a no-write hold with fresh independent SMA protection (alpha.157).
// Missing/bad-quality samples above remain stop/reduction conditions.
test('issue211 confirmed partial response holds through age-only power gap without another current command', async () => {
    const h = await runningSixAmps(3);
    await issueFirstStep(h);
    await replay(h, SECOND);
    h.writes.length = 0;
    await replay(h, SECOND + 6000, {powerAt: SECOND - 31001});
    assert.equal(h.value('Devices.Wallbox2.OutputActive'), true, diagnostic(h));
    assert.match(h.value('Devices.Wallbox2.OutputStatus'), /TELEMETRIE/);
    assert.equal(h.output.devices[2].lastA, 7);
    assert.ok(h.value('Devices.Wallbox2.OutputReservedPower_W') >= 1610);
    assert.ok(!h.writes.some(write => ['goe.cmd', 'goe.allow'].includes(write.id)), diagnostic(h));
});
