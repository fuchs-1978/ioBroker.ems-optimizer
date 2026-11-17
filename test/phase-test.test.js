'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

async function fixture({kind = 'battery', index = 1, phase = 1, interference = false} = {}) {
    const wb = kind === 'wallbox' ? index : 2;
    const h = await plant({battery: true, batteryHeadType: 2, batteryHeadMaxSoc: 100,
        wallbox: kind === 'wallbox' && wb !== 0, mii: kind === 'wallbox' && wb === 0,
        wallboxIndex: wb === 0 ? 2 : wb, initialSurplusW: -500, startDelayS: 0, split: false,
        nativeConfig: {batteryDispatchMode: 'sunenergy-heads', batteryHeadCount: 1,
            batteryHead1MaxChargeW: 2400, batteryHead1MaxDischargeW: 2400, dhwControlEnabled: false,
            [`wb${wb}CommissioningMaxA`]: 32, [`wb${wb}TaperEnabled`]: false}});
    h.own('Devices.MyPV_DHW.Present', false);
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    h.run("CFG.dp.bhkwPower='';CFG.dp.haPhaseImportW=['meter.1.import','meter.2.import','meter.3.import'];"
        + "CFG.dp.haPhaseExportW=['meter.1.export','meter.2.export','meter.3.export'];");
    for (let p = 1; p <= 3; p++) {
        h.config[`haL${p}ImportPowerId`] = `meter.${p}.import`;
        h.config[`haL${p}ExportPowerId`] = `meter.${p}.export`;
        h.mapping[`DP_HA_L${p}_IMPORT_W`] = `meter.${p}.import`;
        h.mapping[`DP_HA_L${p}_EXPORT_W`] = `meter.${p}.export`;
    }
    h.put(`DP_WB${wb}_SOC`, 55);
    h.put(`DP_WB${wb}_MIN_SOC`, 60);
    const meter = () => {
        const trace = h.trace.at(-1) || {};
        const deviceW = kind === 'battery' ? trace.batteryW || 0 : wb === 0 ? trace.miiW || 0 : trace.wbW || 0;
        const active = h.run('phaseTest?.stage === "measure"');
        for (let p = 1; p <= 3; p++) {
            const watts = 500 + (p === phase ? deviceW : 0)
                + (interference && active && p === (phase % 3) + 1 ? 700 : 0);
            h.put(`meter.${p}.import`, watts);
            h.put(`meter.${p}.export`, 0);
            h.put(`DP_DHW_HA_L${p}_CURRENT_A`, watts / 230);
        }
    };
    const advance = async seconds => {
        for (let n = 0; n < seconds; n++) {
            meter();
            await h.advance(1);
        }
    };
    await advance(50);
    meter();
    return {h, advance, meter};
}

for (const phase of [1, 2, 3]) test(`battery phase test measures L${phase} and confirms zero through the normal output path`, async () => {
    const {h, advance} = await fixture({phase});
    h.own('Config.BatteryFineStep_W', 1000);
    const result = h.run('beginPhaseTest({kind:"battery",index:1})');
    assert.ok(!result.error, result.error);
    assert.ok(h.run('beginPhaseTest({kind:"battery",index:1}).error'), 'one active test at a time');
    await advance(85);
    const report = JSON.parse(h.value('Control.PhaseTest_JSON'));
    assert.equal(report.stage, 'complete', JSON.stringify(report));
    assert.equal(report.phase, phase);
    assert.ok(Math.abs(report.deviceDeltaW - 1000) < 20);
    assert.ok(report.after.every(row => row.watts === 0), 'actual return is observed before success');
    assert.ok(h.writes.some(w => w.id.endsWith('.control.GS') && w.val === -1000));
    assert.equal(h.config.batteryHead1GridPhase, undefined, 'message handler persists only a completed result');
});

for (const wb of [0, 1, 2]) test(`wallbox ${wb} phase test reaches 16 A and restores its original current`, async () => {
    const {h, advance} = await fixture({kind: 'wallbox', index: wb, phase: wb + 1});
    const original = h.value(`Devices.Wallbox${wb}.OutputCommand_A`);
    assert.ok(original >= 6 && original < 16, JSON.stringify({original,
        status: h.value(`Vehicles.Wallbox${wb}.Status`), output: h.value(`Devices.Wallbox${wb}.OutputStatus`),
        soc: h.value(`Vehicles.Wallbox${wb}.SoC_pct`), min: h.value(`Vehicles.Wallbox${wb}.MinimumSoC_pct`)}));
    const result = h.run(`beginPhaseTest({kind:"wallbox",index:${wb}})`);
    assert.ok(!result.error, result.error);
    await advance(85);
    const report = JSON.parse(h.value('Control.PhaseTest_JSON'));
    assert.equal(report.stage, 'complete', JSON.stringify(report));
    assert.equal(report.phase, wb + 1);
    assert.ok(report.during.some(row => row.watts >= 3500));
    assert.ok(h.trace.filter(row => row.at >= report.startedAt && row.at <= report.finishedAt)
        .every(row => row.batteryW === 0), 'storage stays stopped throughout the wallbox measurement');
    assert.equal(h.value(`Devices.Wallbox${wb}.OutputCommand_A`), original);
    assert.ok(h.trace.every(row => !row.physicalPhases || row.physicalPhases === 1));
});

test('unexpected storage power aborts a running wallbox phase measurement', async () => {
    const {h, advance} = await fixture({kind: 'wallbox', index: 2});
    assert.ok(!h.run('beginPhaseTest({kind:"wallbox",index:2})').error);
    await advance(12);
    h.setBatteryPower(200);
    await advance(1);
    const report = JSON.parse(h.value('Control.PhaseTest_JSON'));
    assert.equal(report.stage, 'restore');
    assert.match(report.error, /Speicherleistung/);
    assert.equal(report.phase, undefined);
});

test('the wallbox button automatically stops an owned charging battery before raising the current', async () => {
    const {h, advance, meter} = await fixture({kind: 'wallbox', index: 2, phase: 3});
    h.run(`const testDescriptor = batteryHeadsSnapshot().topology.heads[0];
        const testOwner = {...testDescriptor, owned:false, commandW:0, commandAt:0,
            reservedChargeW:0, unobservedCommandW:0, unobservedSince:0, pending:null};
        batteryHeadOwners.push(testOwner);
        sendBatteryHeadCommand(testOwner, 1000, "Prior running charge");`);
    h.setBatteryPower(1000);
    await h.replayAt(h.now() + 1000, [], {allocate: false, output: false});
    meter();
    assert.equal(h.physical().batteryW, 1000);
    assert.ok(!h.run('beginPhaseTest({kind:"wallbox",index:2})').error);
    let saw16 = false;
    for (let i = 0; i < 85; i++) {
        await advance(1);
        if (h.value('Devices.Wallbox2.OutputCommand_A') === 16) {
            saw16 = true;
            assert.equal(h.physical().batteryW, 0, 'actual battery zero precedes the 16 A command');
            assert.equal(h.value('Devices.Battery.OutputOwned'), false, 'all battery claims have returned');
        }
    }
    const report = JSON.parse(h.value('Control.PhaseTest_JSON'));
    assert.equal(saw16, true);
    assert.equal(report.stage, 'complete', JSON.stringify(report));
    assert.equal(h.config.batteryControlEnabled, true);
});

test('interfering phase changes do not create a phase assignment', async () => {
    const {h, advance} = await fixture({phase: 1, interference: true});
    assert.ok(!h.run('beginPhaseTest({kind:"battery",index:1})').error);
    await advance(85);
    const report = JSON.parse(h.value('Control.PhaseTest_JSON'));
    assert.equal(report.stage, 'failed', JSON.stringify(report));
    assert.equal(report.phase, undefined);
});

test('cancellation returns the test output and reports the incomplete measurement', async () => {
    const {h, advance} = await fixture();
    assert.ok(!h.run('beginPhaseTest({kind:"battery",index:1})').error);
    await advance(12);
    h.run('cancelPhaseTest()');
    await advance(35);
    const report = JSON.parse(h.value('Control.PhaseTest_JSON'));
    assert.equal(report.stage, 'failed', JSON.stringify(report));
    assert.equal(report.phase, undefined);
    assert.match(report.status, /abgebrochen/);
});

test('a stale phase or disabled master rejects a phase test before any new command', async () => {
    for (const fault of ['stale', 'master']) {
        const {h} = await fixture();
        if (fault === 'stale') h.put('meter.2.import', 500, {ts: h.now() - 60000});
        else h.own('System.RealOutputsEnabled', false);
        const count = h.writes.length;
        assert.ok(h.run('beginPhaseTest({kind:"battery",index:1})').error);
        assert.equal(h.writes.length, count);
    }
});

test('a retained active test returns its battery command after an engine restart', async () => {
    const {h, advance} = await fixture();
    assert.ok(!h.run('beginPhaseTest({kind:"battery",index:1})').error);
    await advance(30);
    assert.ok(h.run('phaseTestActive()'));
    h.run('phaseTestLoaded=false;phaseTest=null;');
    await advance(35);
    const report = JSON.parse(h.value('Control.PhaseTest_JSON'));
    assert.equal(report.stage, 'failed', JSON.stringify(report));
    assert.match(report.error, /Neustart/);
    assert.equal(report.phase, undefined);
    assert.ok(report.after.every(row => row.watts === 0));
});

test('losing an SMA source during a test requests zero and keeps the phase unknown', async () => {
    const {h, advance} = await fixture();
    assert.ok(!h.run('beginPhaseTest({kind:"battery",index:1})').error);
    await advance(30);
    h.put('meter.2.import', 500, {ts: h.now() - 60000});
    h.run('phaseTestTick()');
    await advance(35);
    const report = JSON.parse(h.value('Control.PhaseTest_JSON'));
    assert.equal(report.stage, 'failed', JSON.stringify(report));
    assert.equal(report.phase, undefined);
    assert.match(report.error, /Messquelle/);
});
