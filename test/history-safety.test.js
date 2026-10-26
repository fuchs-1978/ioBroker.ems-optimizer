'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function engine(extra = {}) {
    const context = vm.createContext({nativeConfig: {}, Date, historySourceEnabled: async () => true, ...extra});
    for (const file of ['core', 'history']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8'), context);
    }
    return source => vm.runInContext(source, context);
}

test('history only accepts quarter-hours with every configured submeter present', () => {
    const run = engine();
    for (let missing = 0; missing < 4; missing++) {
        const result = run(`mergeSubmeterProfile(Array.from({length:4}, (_, i) =>
            i === ${missing} ? [] : [{ts:900000, val:1000}]), [])`);
        assert.equal(result.totalValues.length, 0, `accepted missing meter ${missing}`);
        assert.equal(result.baseloadValues.length, 0);
    }
    const result = run('mergeSubmeterProfile(Array.from({length:4}, () => [{ts:900000, val:1000}]), [])');
    assert.equal(result.totalValues[0].val, 4000);
    assert.equal(result.baseloadValues[0].val, 4000);
});

test('unresponsive SQL history query has a bounded timeout and ignores a late response', async () => {
    let timeout, response;
    const run = engine({setTimeout: callback => { timeout = callback; return 1; },
        clearTimeout: () => {}, sendTo: (instance, command, options, callback) => { response = callback; }});
    const query = run("getHistory('meter', 0, 1000)");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    timeout();
    await assert.rejects(query, /keine Antwort innerhalb 30 s/);
    assert.doesNotThrow(() => response({result: [{val: 10, ts: 100}]}));
});

test('confirmed startup SQL error permits only three paced history retries and never fabricates readiness', async () => {
    let now = 1000;
    class Clock extends Date {static now() {return now;}}
    const run = engine({Date: Clock, setState() {}, log() {}, historyRetryAllowed: () => true});
    run("CFG.dp.pvPower='pv'; CFG.dp.houseMetersW=[]; CFG.dp.wallboxesKW=[]; CFG.dp.myPvDhwHistoryW=''; CFG.dp.myPvHeatingHistoryW=''; pause=async()=>{};");
    run("getHistoryChunked=async()=>{const e=new Error('No database connection'); e.backendCompletionObserved=true; throw e;}");
    await run('buildHistory()');
    assert.equal(run('historyReady'), false);
    run('retryStartupHistory()'); assert.equal(run('historyRetryAttempts'), 0);
    for (let n = 0; n < 5; n++) {now += 60000; run('retryStartupHistory()'); for (let j = 0; j < 10; j++) await Promise.resolve();}
    assert.equal(run('historyRetryAttempts'), 3); assert.equal(run('historyReady'), false);
});

test('unknown startup SQL completion forbids automatic retry even when connection returns', async () => {
    const run = engine({setState() {}, log() {}, historyRetryAllowed: () => true});
    run("CFG.dp.pvPower='pv'; getHistoryChunked=async()=>{const e=new Error('deadline');e.backendCompletionObserved=false;throw e;};");
    await run('buildHistory()');
    assert.equal(run('historyRetryAt'), null); assert.equal(run('historyReady'), false);
});

test('SQL query failure is reported, not silently treated as empty history', async () => {
    const run = engine({setTimeout: () => 1, clearTimeout: () => {},
        sendTo: (instance, command, options, callback) => callback({error: 'connection lost'})});
    await assert.rejects(run("getHistory('meter', 0, 1000)"), /connection lost/);
});

test('duplicate SQL boundary readings subtract a flexible load only once per slot', () => {
    const run = engine();
    const result = run(`mergeSubmeterProfile([[{ts:900000,val:5000}]], [
        {series:[{ts:900000,val:2},{ts:900000,val:2}],multiplier:1000},
        {series:[{ts:900000,val:1000}],multiplier:1}])`);
    assert.equal(result.totalValues[0].val, 5000);
    assert.equal(result.baseloadValues[0].val, 2000);
});

test('missing flexible histories preserve total load but never fabricate a cleaned baseload', () => {
    const run = engine();
    for (const missing of ['[]', '[{ts:900000,val:null}]', '[{ts:1800000,val:0}]']) {
        for (const index of [0, 1]) {
            const flexible = [
                '{series:[{ts:900000,val:0}],multiplier:1000}',
                '{series:[{ts:900000,val:1000}],multiplier:1}'
            ];
            flexible[index] = `{series:${missing},multiplier:1}`;
            const result = run(`mergeSubmeterProfile([[{ts:900000,val:5000}]], [${flexible}])`);
            assert.equal(result.totalValues[0].val, 5000);
            assert.equal(result.baseloadValues.length, 0);
        }
    }
});

test('only matching complete flexible slots enter the baseload profile; confirmed zero remains usable', () => {
    const run = engine();
    const result = run(`mergeSubmeterProfile([[{ts:900000,val:5000},{ts:1800000,val:4000}]], [
        {series:[{ts:900000,val:0},{ts:1800000,val:1}],multiplier:1000},
        {series:[{ts:900000,val:1000}],multiplier:1}])`);
    assert.equal(result.totalValues.length, 2);
    assert.equal(result.baseloadValues.length, 1);
    assert.equal(result.baseloadValues[0].val, 4000);
    assert.equal(run(`profile(${JSON.stringify(result.baseloadValues)}).filter(Number.isFinite).length`), 1);
});

test('history readiness requires enough cleaned samples and never skips an empty included heating source', async () => {
    const meterRows = Array.from({length: 21 * 96}, (_, i) => ({
        ts: Date.UTC(2026, 8, 21) + i * 900000, val: 5000
    }));
    for (const flexibleRows of [[], meterRows.slice(0, 7 * 96), meterRows]) {
        const states = new Map(), logs = [];
        const run = engine({meterRows, flexibleRows,
            setState: (id, val) => states.set(id, {val}),
            getState: id => ({val: id.endsWith('MyPV_Heating_IncludedInSubmeters')}),
            buildForecast() {}, log: (message, level) => logs.push({message, level}), setTimeout, clearTimeout});
        run("CFG.dp.pvPower='pv'; CFG.dp.houseMetersW=['meter']; CFG.dp.wallboxesKW=[]; "
            + "CFG.dp.myPvDhwHistoryW=''; CFG.dp.myPvHeatingHistoryW='heating'; "
            + "getHistoryChunked=async id => id==='meter' ? meterRows : id==='heating' ? flexibleRows : []; pause=async () => {}; ");
        await run('buildHistory()');
        assert.equal(run('historyReady'), flexibleRows.length >= 1344);
        assert.equal(logs.filter(entry => entry.message.includes('SQL-Historie: lese Quelle')).length, 3);
        const completed = logs.filter(entry => entry.message.includes('SQL-Historie: abgeschlossen'));
        assert.equal(completed.length, 1);
        assert.equal(completed[0].level, run('historyReady') ? 'info' : 'warn');
        assert.equal(completed[0].message.includes('unvollstaendig'), !run('historyReady'));
        assert.match([...states.values()].find(state => typeof state.val === 'string'
            && state.val.includes('Grundlastwerte')).val, /Grundlastwerte/);
    }
});

test('invalid history values cannot silently supply a zero submeter reading', () => {
    const run = engine();
    const result = run(`mergeSubmeterProfile([[{ts:900000,val:null}], [{ts:900000,val:1000}]], [])`);
    assert.equal(result.totalValues.length, 0);
    assert.equal(run('profile([{ts:900000,val:null}]).filter(Number.isFinite).length'), 0);
    assert.equal(run('profile([{ts:"invalid",val:1000}]).filter(Number.isFinite).length'), 0);
});

test('unrecorded SQL sources are rejected before sending any getHistory request', async () => {
    const run = engine({setTimeout: () => 1, clearTimeout: () => {},
        historySourceEnabled: async () => false,
        sendTo: () => assert.fail('unrecorded source reached SQL')});
    await assert.rejects(run("getHistory('unrecorded', 0, 1000)"), /Aufzeichnung nicht aktiviert/);
});

test('metadata failure or unavailable verification cannot masquerade as empty history', async () => {
    for (const verify of [undefined, async () => { throw new Error('metadata unavailable'); }]) {
        const run = engine({setTimeout: () => 1, clearTimeout: () => {}, historySourceEnabled: verify,
            sendTo: () => assert.fail('SQL queried without verified logging')});
        await assert.rejects(run("getHistory('meter', 0, 1000)"), /geprueft|metadata unavailable/);
    }
});

test('late metadata approval after the timeout cannot start a SQL request', async () => {
    let timeout, approve;
    const run = engine({setTimeout: fn => { timeout = fn; return 1; }, clearTimeout: () => {},
        historySourceEnabled: () => new Promise(resolve => { approve = resolve; }),
        sendTo: () => assert.fail('SQL queried after timeout')});
    const query = run("getHistory('meter', 0, 1000)");
    await Promise.resolve();
    timeout();
    await assert.rejects(query, /keine Antwort/);
    approve(true);
    for (let i = 0; i < 5; i++) await Promise.resolve();
});

test('history refresh only reads the new tail and replaces overlap without duplicates', async () => {
    const calls = [];
    const run = engine({calls});
    run(`pause=async()=>{}; getHistory=async(id,start,end)=>{
        calls.push({start,end}); return [{ts:start,val:calls.length},{ts:end,val:999}];
    };`);
    await run("getHistoryChunked('pv', 0, 3*86400000)");
    assert.equal(calls.length, 3);
    assert.ok(calls.every(c => c.end - c.start <= 86400000));
    const rows = await run("getHistoryChunked('pv', 86400000, 4*86400000)");
    assert.equal(calls[3].start, 3*86400000 - 1800000);
    assert.ok(rows.every(row => row.ts >= 86400000 && row.ts < 4*86400000));
    assert.equal(new Set(rows.map(row => row.ts)).size, rows.length);
});

test('failed chunk resumes from completed work and unresolved SQL blocks a new build', async () => {
    const calls = [];
    const run = engine({calls, setState() {}, log() {}});
    run(`pause=async()=>{}; getHistory=async(id,start,end)=>{
        calls.push(start); if(calls.length===2) throw new Error('failed chunk');
        return [{ts:start,val:10}];
    };`);
    await assert.rejects(run("getHistoryChunked('pv',0,3*86400000)"), /failed chunk/);
    await run("getHistoryChunked('pv',0,3*86400000)");
    assert.equal(calls[2], 86400000 - 1800000);
    run('historyUnresolvedQueries=1');
    await run('buildHistory()');
    assert.equal(run('historyBuilding'), false);
});

test('background refresh failure preserves completed profiles and schedules paced recovery', async () => {
    const run = engine({setState() {}, log() {}});
    run(`historyReady=true; historyProfiles.pv[0]=123;
        getHistoryChunked=async()=>{const e=new Error('SQL busy');e.backendCompletionObserved=true;throw e;};`);
    await run('buildHistory()');
    assert.equal(run('historyReady'), true);
    assert.equal(run('historyProfiles.pv[0]'), 123);
    assert.ok(run('historyRetryAt') > Date.now());
});
