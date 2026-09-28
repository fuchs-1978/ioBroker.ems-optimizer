'use strict';

// go-e reports active power in kW and may briefly undershoot zero by one
// 10-W measurement step. Permit at most two such steps. This is deliberately
// not a generic clamp: invalid/missing values and larger negative readings
// must continue to fail closed. Callers validate ack, quality and freshness
// BEFORE normalization and retain the original state for diagnostics.
const WALLBOX_POWER_NOISE_TOLERANCE_W = 20;

function normalizeWallboxPowerKW(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)
        || value < -WALLBOX_POWER_NOISE_TOLERANCE_W / 1000) return null;
    return Math.max(0, value);
}

module.exports = {normalizeWallboxPowerKW, WALLBOX_POWER_NOISE_TOLERANCE_W};
