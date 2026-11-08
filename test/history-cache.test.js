'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {readHistoryCache, writeHistoryCache} = require('../lib/history-cache');

test('forecast history snapshot is replaced atomically and rejects a corrupted payload', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-history-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    assert.equal(await readHistoryCache(directory), null);
    const original = {signature: 'original', entries: [['pv', {values: [{ts: 900000, val: 42}]}]]};
    await writeHistoryCache(directory, original);
    assert.deepEqual(await readHistoryCache(directory), original);
    await writeHistoryCache(directory, {...original, signature: 'replacement'});
    assert.deepEqual(await fs.readdir(directory), ['forecast-history.json']);
    assert.equal((await readHistoryCache(directory)).signature, 'replacement');
    await fs.appendFile(path.join(directory, 'forecast-history.json'), ' ');
    assert.equal(await readHistoryCache(directory), null);
});
