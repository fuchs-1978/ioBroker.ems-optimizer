'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function engine(extra = {}) {
    const context = vm.createContext({nativeConfig: {}, Date, ...extra});
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
    timeout();
    await assert.rejects(query, /keine Antwort innerhalb 30 s/);
    assert.doesNotThrow(() => response({result: [{val: 10, ts: 100}]}));
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

test('invalid history values cannot silently supply a zero submeter reading', () => {
    const run = engine();
    const result = run(`mergeSubmeterProfile([[{ts:900000,val:null}], [{ts:900000,val:1000}]], [])`);
    assert.equal(result.totalValues.length, 0);
    assert.equal(run('profile([{ts:900000,val:null}]).filter(Number.isFinite).length'), 0);
    assert.equal(run('profile([{ts:"invalid",val:1000}]).filter(Number.isFinite).length'), 0);
});
