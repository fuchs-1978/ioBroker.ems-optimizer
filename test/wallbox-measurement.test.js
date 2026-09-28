'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeWallboxPowerKW, WALLBOX_POWER_NOISE_TOLERANCE_W} = require('../lib/wallbox-measurement');

test('wallbox active power tolerates only the explicit 20-W zero undershoot', () => {
    assert.equal(WALLBOX_POWER_NOISE_TOLERANCE_W, 20);
    for (const value of [-0.02, -0.01, -Number.EPSILON, -0, 0])
        assert.equal(normalizeWallboxPowerKW(value), 0);
    for (const value of [0.01, 1.38, 22.08])
        assert.equal(normalizeWallboxPowerKW(value), value);
    for (const value of [-0.020001, -1, NaN, Infinity, -Infinity, null, undefined, '', '-0.01', false, true])
        assert.equal(normalizeWallboxPowerKW(value), null, String(value));
});
