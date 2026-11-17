'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(report = {kind: 'battery', index: 2, phase: 3, stage: 'complete', status: 'L3 erkannt'}) {
    const exported = {exports: {}};
    class Adapter {
        constructor() { this.namespace = 'ems.0'; this.config = {batteryHeadCount: 3}; }
        on() {}
    }
    const customRequire = name => name === '@iobroker/adapter-core' ? {Adapter}
        : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
        require: customRequire, module: exported, __dirname: path.join(__dirname, '..'), console, setTimeout, clearTimeout
    });
    const a = exported.exports(), writes = [], responses = [];
    a.engineContext = {};
    a.runEngine = source => source.startsWith('beginPhaseTest(') ? {result: 'started'} : report;
    a.flushOwnWrites = async () => {};
    const stored = {native: {...a.config}};
    a.getForeignObjectAsync = async () => stored;
    a.extendForeignObjectAsync = async (id, value) => writes.push({id, value});
    a.sendTo = (from, command, value) => responses.push({from, command, value});
    const message = {from: 'admin.0', command: 'phaseTest', message: {kind: report.kind, index: report.index}, callback: {}};
    return {a, writes, responses, stored, message};
}

test('an Admin phase test persists the detected head phase and returns the changed native configuration', async () => {
    const h = fixture();
    await h.a.onMessage(h.message);
    assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [{id: 'system.adapter.ems.0', value: {native: {batteryHead2GridPhase: 3}}}]);
    assert.equal(h.a.config.batteryHead2GridPhase, 3);
    assert.equal(h.responses[0].value.native.batteryHead2GridPhase, 3);
    assert.equal(h.a.phaseTestBusy, false);
});

test('an Admin wallbox phase test updates only its detected grid-phase field', async () => {
    const h = fixture({kind: 'wallbox', index: 1, phase: 2, stage: 'complete', status: 'L2 erkannt'});
    await h.a.onMessage(h.message);
    assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [{id: 'system.adapter.ems.0', value: {native: {wb1SinglePhaseGridPhase: 2}}}]);
});

test('an ambiguous measurement or changed configuration never saves a phase', async () => {
    for (const reason of ['measurement', 'config']) {
        const h = fixture(reason === 'measurement' ? {kind: 'battery', index: 1, stage: 'failed', status: 'nicht eindeutig'} : undefined);
        if (reason === 'config') h.stored.native.haL1ImportPowerId = 'other.source';
        await h.a.onMessage(h.message);
        assert.equal(h.writes.length, 0);
        assert.ok(h.responses[0].value.error);
    }
});

test('a second button request retains the active test lock', async () => {
    const h = fixture();
    h.a.phaseTestBusy = true;
    await h.a.onMessage(h.message);
    assert.equal(h.a.phaseTestBusy, true);
    assert.equal(h.writes.length, 0);
    assert.match(h.responses[0].value.error, /bereits/);
});
