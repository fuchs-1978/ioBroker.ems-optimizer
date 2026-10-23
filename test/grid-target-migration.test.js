'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {migratedGridTarget} = require('../lib/grid-target-migration');
test('neutral legacy target migrates to small import only once', () => {
    assert.equal(migratedGridTarget('0.17.0-alpha.128', 0), 50);
    assert.equal(migratedGridTarget('0.17.0-alpha.129', 0), 50);
    for (const version of ['0.17.0-alpha.130', '0.17.0-alpha.131', '', '0.17.0', 'unknown'])
        assert.equal(migratedGridTarget(version, 0), null);
    for (const target of [-100, 50, 100, undefined, null, '0', NaN])
        assert.equal(migratedGridTarget('0.17.0-alpha.129', target), null);
});
