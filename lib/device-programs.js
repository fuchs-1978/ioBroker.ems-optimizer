'use strict';

const {adapterTimers} = require('./adapter-timers');
const SLOT = 15 * 60000;

function parse(value) {
    try { return JSON.parse(value); } catch { return null; }
}

function planProgram(profile, grid, prices, now, latest) {
    if (!Array.isArray(profile) || !profile.length || profile.length > 96
        || !profile.every(w => Number.isFinite(w) && w >= 0) || !profile.some(w => w > 0)) return null;
    const gridByTime = new Map(grid.map(slot => [slot.timestamp, slot.valueW]));
    const priceByTime = new Map(prices.filter(slot => slot.valid).map(slot => [slot.timestamp, slot.value_ct_kWh]));
    function cost(start) {
        let euros = 0;
        for (let i = 0; i < profile.length; i++) {
            let at = start + i * SLOT;
            const end = at + SLOT;
            while (at < end) {
                const slot = Math.floor(at / SLOT) * SLOT;
                const until = Math.min(slot + SLOT, end);
                const baseline = gridByTime.get(slot), price = priceByTime.get(slot);
                if (!Number.isFinite(baseline) || !Number.isFinite(price)) return null;
                const incremental = Math.max(0, baseline + profile[i]) - Math.max(0, baseline);
                euros += incremental * (until - at) * price / 360000000000;
                at = until;
            }
        }
        return euros;
    }
    const immediate = cost(now);
    const duration = profile.length * SLOT;
    let selected = null;
    for (const start of [now, ...[...gridByTime.keys()].filter(at => at > now).sort((a, b) => a - b)]) {
        if (start + duration > latest) continue;
        const euros = cost(start);
        if (euros !== null && (!selected || euros < selected.estimatedGridCost_EUR - 0.000001)) {
            selected = {plannedStartAt: start, expectedEndAt: start + duration, estimatedGridCost_EUR: euros};
        }
    }
    return selected && {...selected, estimatedImmediateGridCost_EUR: immediate,
        estimatedSavings_EUR: immediate === null ? null : immediate - selected.estimatedGridCost_EUR};
}

function deadline(value, now) {
    if (!value) return now + 48 * 60 * 60000;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return 0;
    const next = new Date(now);
    const [hours, minutes] = value.split(':').map(Number);
    next.setHours(hours, minutes, 0, 0);
    if (+next <= now) next.setDate(next.getDate() + 1);
    return +next;
}

function startDevicePrograms(adapter) {
    const rows = Array.isArray(adapter.config.devicePrograms) ? adapter.config.devicePrograms : [];
    if (!rows.some(row => row.mode === 'observe' || row.mode === 'automatic')) return;
    const timers = adapterTimers(adapter);
    const own = async id => (await adapter.getStateAsync(id))?.val;
    const read = async id => {
        if (!id) return null;
        const state = await adapter.getForeignStateAsync(id);
        return state?.ack === true && !state.q ? state : null;
    };
    async function publish(id, value) {
        await adapter.setObjectNotExistsAsync(id, {
            type: 'state', common: {name: 'Appliance program status', type: 'string', role: 'json', read: true, write: false},
            native: {}
        });
        await adapter.setStateAsync(id, JSON.stringify(value), true);
    }
    async function update(row, index, forecast) {
        if (!['observe', 'automatic'].includes(row.mode)) return;
        const id = `Devices.Programs.${index + 1}`;
        const prior = parse(await own(id)) || {};
        const [remote, operation, power] = await Promise.all([
            read(row.remoteObject), read(row.statusObject), read(row.powerObject)
        ]);
        if (adapter.unloading) return;
        const allowed = parse(row.remoteValue), command = parse(row.startValue);
        const running = Boolean(row.runningValue && operation?.val === row.runningValue);
        const ready = Boolean(row.readyValue && operation?.val === row.readyValue);
        const released = remote !== null && allowed !== null && remote.val === allowed;
        const release = released ? `${row.remoteObject}:${remote.lc || remote.ts}` : null;
        const current = {name: row.name, mode: row.mode, running, ready, released,
            powerW: Number.isFinite(power?.val) ? power.val : null, plan: null,
            attemptedRelease: prior.attemptedRelease ?? null};
        if (released && ready && forecast) {
            current.plan = planProgram(parse(row.profileJson), forecast.grid, forecast.prices,
                forecast.now, deadline(row.finishBy, forecast.now));
        }
        const armed = row.mode === 'automatic' && adapter.config.globalWriteEnabled === true
            && adapter.config.controlEnabled !== false;
        if (armed && release && release !== current.attemptedRelease && current.plan
            && current.plan.plannedStartAt <= forecast.now && command !== null && row.startObject
            && rows.filter(other => other.mode === 'automatic' && other.startObject === row.startObject).length === 1) {
            const object = await adapter.getForeignObjectAsync(row.startObject);
            const type = object?.common?.type;
            const compatible = type === typeof command || type === 'boolean' && command === true;
            if (!adapter.unloading && object?.common?.write === true && compatible) {
                current.attemptedRelease = release;
                await publish(id, current);
                const [latestRemote, latestStatus] = await Promise.all([read(row.remoteObject), read(row.statusObject)]);
                if (!adapter.unloading && latestRemote?.val === allowed && (latestRemote.lc || latestRemote.ts) === (remote.lc || remote.ts)
                    && latestStatus?.val === row.readyValue) {
                    await adapter.setForeignStateAsync(row.startObject, command, false);
                }
                return;
            }
        }
        await publish(id, current);
    }
    async function tick() {
        try {
            if (adapter.unloading) return;
            const [valid, updated, grid, prices] = await Promise.all(['Plan.Valid', 'Plan.LastUpdate',
                'Plan.GridPower_48h_JSON', 'Forecast.TotalPrice_48h_JSON'].map(own));
            const now = Date.now(), gridSlots = parse(grid), priceSlots = parse(prices);
            const forecast = valid === true && Number.isFinite(updated) && updated <= now
                && now - updated < 20 * 60000 && Array.isArray(gridSlots) && Array.isArray(priceSlots)
                ? {now, grid: gridSlots, prices: priceSlots} : null;
            for (const [index, row] of rows.entries()) {
                try { await update(row, index, forecast); }
                catch (error) { adapter.log.warn(`Appliance program row ${index + 1}: ${error.message}`); }
            }
        } catch (error) { adapter.log.warn(`Appliance programs: ${error.message}`); }
        finally { if (!adapter.unloading) timers.setTimeout(() => void tick(), 15000); }
    }
    void tick();
}

module.exports = {planProgram, startDevicePrograms};
