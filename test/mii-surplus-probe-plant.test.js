'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

async function miiPlant(uptake) {
    const h = await plant({mii: true, wallbox: false, split: false, startDelayS: 0, minimumRuntimeS: 0,
        initialSurplusW: 4187, wallboxUptakeA: (wb, amps) => wb === 0 ? uptake(amps) : amps,
        nativeConfig: {wallboxParallelChargingEnabled: true, wallboxPVImportToleranceW: 100,
            wb0CommissioningMaxA: 32, wb0MaxCurrent1pA: 32, wb0MaxPowerW: 7360}});
    h.put('DP_WB_PRIORITY', 0);
    h.own('Control.TargetGridPower_W', 0);
    h.own('Vehicles.Wallbox0.MaxCurrent1P_A', 32); h.own('Config.Wallbox0MaxPower_W', 7360);
    return h;
}
test('real allocator and output resolve Mii 18 A/16.9 A plus 300 W export with one early 19 A probe', async () => {
    const h = await miiPlant(a => a < 17 ? a : a <= 18 ? 16.9 : a - 1.1);
    await h.advance(150);
    const writes = h.writes.filter(w => w.id === 'goe0.cmd');
    const eighteen = writes.find(w => w.val === 18), nineteen = writes.find(w => w.val === 19);
    assert.ok(eighteen && nineteen, JSON.stringify({writes, status: h.value('Devices.Wallbox0.OutputStatus'),
        response: h.value('Devices.Wallbox0.ResponseStatus'), proof: h.value('Devices.Wallbox0.ResponseProbe_JSON'),
        budget: h.value('Devices.Wallbox0.IncreaseBudget_JSON'), allocation: h.value('Control.Wallbox0.AllocationDiagnostics_JSON'),
        privateResponse: h.output.devices[0].response}, null, 2));
    assert.ok(nineteen.at - eighteen.at < 45000, 'the probe does not wait for the full response timeout');
    assert.ok(writes.every(w => w.val <= 19), JSON.stringify(writes));
    assert.equal(h.value('Devices.Wallbox0.ResponseState'), 'confirmed', h.diagnostic());
    assert.equal(h.output.devices[0].limitedProbeAttempts || 0, 0);
    assert.ok(Math.abs(h.trace.at(-1).gridW + 70) < 1e-6, h.diagnostic());
    assert.equal(h.value('Devices.Wallbox0.OutputFault'), '');
});

test('a truly capped Mii never winds up past two unanswered one-amp probes', async () => {
    const h = await miiPlant(a => Math.min(a, 16.9));
    await h.advance(400);
    const commands = h.writes.filter(w => w.id === 'goe0.cmd').map(w => w.val);
    assert.ok(commands.includes(19) && commands.includes(20), JSON.stringify(commands));
    assert.ok(commands.every(a => a <= 20), JSON.stringify(commands));
    assert.equal(h.output.devices[0].limitedProbeAttempts, 2);
    assert.deepEqual(JSON.parse(h.value('Devices.Wallbox0.ResponseProbe_JSON')), {});
    assert.equal(h.value('Devices.Wallbox0.OutputFault'), '');
});
test('the early surplus probe cannot exceed the real commissioning current cap', async () => {
    const h = await miiPlant(a => a < 17 ? a : a <= 18 ? 16.9 : a - 1.1);
    h.config.wb0CommissioningMaxA = 18;
    await h.advance(180);
    assert.ok(h.writes.filter(w => w.id === 'goe0.cmd').every(w => w.val <= 18));
    assert.equal(h.value('Devices.Wallbox0.OutputFault'), '');
});
