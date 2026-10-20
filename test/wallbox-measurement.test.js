'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeWallboxPowerKW, WALLBOX_POWER_NOISE_TOLERANCE_W, WALLBOX_POWER_NEGATIVE_TOLERANCE_W} = require('../lib/wallbox-measurement');

test('wallbox active power tolerates only the explicit 30-W zero undershoot, preserving the positive idle threshold', () => {
    assert.equal(WALLBOX_POWER_NOISE_TOLERANCE_W, 20);
    assert.equal(WALLBOX_POWER_NEGATIVE_TOLERANCE_W, 30);
    for (const value of [-0.03, -0.02, -0.01, -Number.EPSILON, -0, 0])
        assert.equal(normalizeWallboxPowerKW(value), 0);
    for (const value of [0.01, 1.38, 22.08])
        assert.equal(normalizeWallboxPowerKW(value), value);
    for (const value of [-0.030001, -1, NaN, Infinity, -Infinity, null, undefined, '', '-0.01', false, true])
        assert.equal(normalizeWallboxPowerKW(value), null, String(value));
});
