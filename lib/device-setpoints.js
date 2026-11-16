'use strict';

const {adapterTimers} = require('./adapter-timers');

const SWITCH_DELAY_MS = 5 * 60000;

function chooseSetpoint(row, state, signals, now) {
    const {gridW, batteryW, cheap} = signals;
    const surplus = Number.isFinite(gridW) && gridW <= 0
        && Number.isFinite(batteryW) && batteryW >= -25
        && -gridW + Math.max(0, batteryW) >= 150;
    const desired = cheap || surplus ? row.min : row.max;
    if (state.desired !== desired) {
        state.desired = desired;
        state.since = now;
    }
    return now - state.since >= SWITCH_DELAY_MS ? desired : null;
}

function startDeviceSetpoints(adapter) {
    const rows = Array.isArray(adapter.config.deviceSetpoints) ? adapter.config.deviceSetpoints : [];
    if (!rows.length) return;
    const timers = adapterTimers(adapter);
    const outputs = rows.map(row => row.writeObject).filter(Boolean);
    const devices = rows.map(row => ({row, state: {}, sentAt: -Infinity}));
    const read = async id => {
        if (!id) return null;
        const state = await adapter.getForeignStateAsync(id);
        return state?.ack === true && (state.q === 0 || state.q === undefined)
            ? state : null;
    };
    const value = async id => (await read(id))?.val;
    async function update(device, index, signals) {
        const {row, state} = device;
        if (!row.actualObject || !row.writeObject) return;
        const [actual, feedback] = await Promise.all([value(row.actualObject), value(row.writeObject)]);
        const bounds = {min: row.minTemperature, max: row.maxTemperature};
        const valid = Number.isFinite(bounds.min) && Number.isFinite(bounds.max) && bounds.min <= bounds.max;
        const now = Date.now();
        const desired = valid ? chooseSetpoint(bounds, state, signals, now) : null;
        const id = `Devices.Setpoints.${index + 1}`;
        const armed = adapter.config.globalWriteEnabled === true
            && adapter.config.controlEnabled !== false;
        let status = valid ? (armed ? 'automatic' : 'observe') : 'invalid configuration';
        if (armed && desired !== null && desired !== feedback && now - device.sentAt >= 120000) {
            const object = row.writeObject && await adapter.getForeignObjectAsync(row.writeObject);
            const common = object?.common;
            if (!Number.isFinite(feedback) || !Number.isFinite(actual)
                || outputs.filter(output => output === row.writeObject).length !== 1
                || common?.write !== true || common.type !== 'number'
                || !Number.isFinite(common.min) || !Number.isFinite(common.max)
                || [bounds.min, bounds.max].some(limit => limit < common.min || limit > common.max)) {
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
            name: String(row.name ?? "").trim() || row.actualObject, status, actual: actual ?? null, feedback: feedback ?? null,
            desired, ...signals
        }), true);
    }
    async function tick() {
        if (adapter.unloading) return;
        let signals;
        try {
            signals = adapter.runEngine("deviceSetpointSignals()");
        } catch (error) {
            adapter.log.warn(`Device setpoints: ${error.message}`);
            signals = {gridW: null, batteryW: null, cheap: false};
        }
        await Promise.allSettled(devices.map(async (device, index) => {
            try {
                await update(device, index, signals);
            } catch (error) {
                adapter.log.warn(`Device setpoint row ${index + 1}: ${error.message}`);
            }
        }));
        if (!adapter.unloading) timers.setTimeout(() => void tick(), 30000);
    }
    void tick();
}

module.exports = {chooseSetpoint, startDeviceSetpoints};
