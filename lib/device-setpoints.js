'use strict';

const {adapterTimers} = require('./adapter-timers');

function chooseSetpoint(row, state, power, score, now) {
    if (!Number.isFinite(power)) {
        state.coldSince = state.normalSince = null;
    } else {
        state.coldSince = power < row.enterW ? (state.coldSince ?? now) : null;
        state.normalSince = power >= row.exitW ? (state.normalSince ?? now) : null;
    }
    if (Number.isFinite(score) && score <= row.priceLimit && row.priceObject) return row.optimized;
    if (state.coldSince !== null && now - state.coldSince >= row.enterMinutes * 60000) return row.optimized;
    if (state.normalSince !== null && ((row.priceObject && Number.isFinite(score))
        || now - state.normalSince >= row.exitMinutes * 60000)) return row.normal;
    return null;
}

function startDeviceSetpoints(adapter) {
    const rows = Array.isArray(adapter.config.deviceSetpoints) ? adapter.config.deviceSetpoints : [];
    if (!rows.length) return;
    const timers = adapterTimers(adapter);
    const outputs = rows.map(row => row.writeObject).filter(Boolean);
    const devices = rows.map(row => ({row, state: {coldSince: null, normalSince: null}, sentAt: -Infinity}));
    const read = async id => {
        if (!id) return null;
        const state = await adapter.getForeignStateAsync(id);
        return state?.ack === true && (state.q === 0 || state.q === undefined)
            ? state : null;
    };
    const value = async id => (await read(id))?.val;
    async function update(device, index) {
        const {row, state} = device;
        if (row.mode === 'off') {
            state.coldSince = state.normalSince = null;
            return;
        }
        const inputs = [row.gridObject, row.heaterObject, row.wallbox1, row.wallbox2, row.wallbox3];
        const [actual, feedback, score, ...powers] = await Promise.all([
            value(row.actualObject), value(row.feedbackObject || row.writeObject),
            value(row.priceObject), ...inputs.map(id => id ? value(id) : 0)
        ]);
        const power = row.gridObject && powers.every(Number.isFinite)
            ? powers[0] - powers[1] - 1000 * (powers[2] + powers[3] + powers[4]) : NaN;
        const now = Date.now();
        const valid = [row.normal, row.optimized, row.enterW, row.exitW, row.enterMinutes, row.exitMinutes]
            .every(Number.isFinite) && row.enterW < row.exitW && row.enterMinutes >= 0 && row.exitMinutes >= 0
            && (!row.priceObject || Number.isFinite(row.priceLimit));
        const desired = valid ? chooseSetpoint(row, state, power, score, now) : null;
        const id = `Devices.Setpoints.${index + 1}`;
        const armed = row.mode === 'automatic' && adapter.config.globalWriteEnabled === true
            && adapter.config.controlEnabled !== false;
        let status = valid ? (armed ? 'automatic' : 'observe') : 'invalid configuration';
        if (armed && desired !== null && desired !== feedback && now - device.sentAt >= 120000) {
            const object = row.writeObject && await adapter.getForeignObjectAsync(row.writeObject);
            const common = object?.common;
            if (!Number.isFinite(feedback) || !Number.isFinite(actual)
                || outputs.filter(output => output === row.writeObject).length !== 1
                || common?.write !== true || common.type !== 'number'
                || !Number.isFinite(common.min) || !Number.isFinite(common.max)
                || [row.normal, row.optimized].some(limit => limit < common.min || limit > common.max)) {
                status = 'write blocked';
            } else if (!adapter.unloading) {
                device.sentAt = now;
                await adapter.setForeignStateAsync(row.writeObject, desired, false);
                status = 'awaiting setpoint feedback';
            }
        }
        if (adapter.unloading) return;
        await adapter.setObjectNotExistsAsync(id, {
            type: 'state', common: {name: 'Device setpoint status', type: 'string', role: 'json', read: true, write: false},
            native: {}
        });
        await adapter.setStateAsync(id, JSON.stringify({
            name: row.name, status, actual: actual ?? null, feedback: feedback ?? null,
            desired, virtualGridW: Number.isFinite(power) ? power : null
        }), true);
    }
    async function tick() {
        if (adapter.unloading) return;
        await Promise.allSettled(devices.map(async (device, index) => {
            try {
                await update(device, index);
            } catch (error) {
                adapter.log.warn(`Device setpoint row ${index + 1}: ${error.message}`);
            }
        }));
        if (!adapter.unloading) timers.setTimeout(() => void tick(), 30000);
    }
    void tick();
}

module.exports = {chooseSetpoint, startDeviceSetpoints};
