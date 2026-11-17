'use strict';

const {createHash} = require('node:crypto');
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

function powerInWatts(value, unit) {
    if (!Number.isFinite(value)) return null;
    switch (unit) {
        case "mW": return value / 1000;
        case "kW": return value * 1000;
        case "W": case undefined: case "": return value;
        default: return null;
    }
}

function learnProfile(rows, start, end, unit) {
    const duration = end - start;
    if (!Array.isArray(rows) || rows.responseLength >= 10000 || duration <= 0 || duration > 96 * SLOT) return null;
    const points = new Map();
    for (const sample of rows) {
        if (!Number.isFinite(sample.ts) || sample.ts > end) continue;
        const value = Number.isFinite(sample.val) && sample.val >= 0 && !sample.q ? powerInWatts(sample.val, unit) : null;
        points.set(sample.ts, points.has(sample.ts) && points.get(sample.ts) !== value ? null : value);
    }
    const sorted = [...points].sort(([a], [b]) => a - b);
    const watts = Array(Math.ceil(duration / SLOT)).fill(0);
    let covered = 0, integral = 0;
    for (const [index, [ts, power]] of sorted.entries()) {
        if (power === null) continue;
        let at = Math.max(ts, start);
        const limit = Math.min(end, sorted[index + 1]?.[0] ?? end, ts + (rows.maxGapMs ?? 95000));
        while (at < limit) {
            const bucket = Math.floor((at - start) / SLOT);
            const stop = Math.min(limit, start + (bucket + 1) * SLOT);
            const elapsed = stop - at;
            covered += elapsed;
            integral += elapsed * power;
            watts[bucket] += elapsed * power / SLOT;
            at = stop;
        }
    }
    if (covered !== duration || integral <= 0) return null;
    return {watts, durationMs: duration, energyKWh: integral / 3600000000};
}

function typicalProfile(runs) {
    const middle = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const durationMs = middle(runs.map(run => run.durationMs));
    return {durationMs, energyKWh: middle(runs.map(run => run.energyKWh)),
        watts: Array.from({length: Math.ceil(durationMs / SLOT)}, (_, i) => middle(runs.map(run => run.watts[i] ?? 0)))};
}

function programAnnouncement(name, plan, release, program, now) {
    const {plannedStartAt, estimatedSavings_EUR} = plan;
    const clock = new Intl.DateTimeFormat('de-DE', {timeZone: 'Europe/Berlin', hour: 'numeric', minute: '2-digit'});
    const date = new Intl.DateTimeFormat('de-DE', {timeZone: 'Europe/Berlin', dateStyle: 'short'});
    const start = plannedStartAt <= now ? 'jetzt' :
        `${date.format(plannedStartAt) === date.format(now) ? 'heute' : 'am ' + date.format(plannedStartAt)} um ${clock.format(plannedStartAt)} Uhr`;
    let text = `Optimierter Start für ${name || 'das Haushaltsgerät'}. Geplanter Start: ${start}.`;
    if (Number.isFinite(estimatedSavings_EUR)) {
        const cents = Math.round(estimatedSavings_EUR * 100);
        const amount = Math.abs(cents);
        text += cents > 0 ? ` Gegenüber einem Sofortstart sparst du voraussichtlich ${amount} Cent.`
            : cents < 0 ? ` Gegenüber einem Sofortstart kostet der Lauf voraussichtlich ${amount} Cent mehr.`
                : ' Die geschätzten Stromkosten sind ungefähr gleich.';
    }
    return {
        id: createHash('sha256').update(JSON.stringify([release, program])).digest('hex'),
        text
    };
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
            type: 'state', common: {name: id.endsWith('.Announcement') ? 'Appliance program announcement' : 'Appliance program status', type: 'string', role: 'json', read: true, write: false},
            native: {}
        });
        await adapter.setStateAsync(id, JSON.stringify(value), true);
    }
    async function update(row, index, forecast) {
        const id = `Devices.Programs.${index + 1}`;
        const announcementId = `${id}.Announcement`;
        if (!['observe', 'automatic'].includes(row.mode)) {
            if (!adapter.unloading && await own(announcementId) !== 'null') await publish(announcementId, null);
            return;
        }
        const prior = parse(await own(id)) || {};
        const [remote, operation, power, selected, active] = await Promise.all([
            read(row.remoteObject), read(row.statusObject), read(row.powerObject),
            read(row.programObject), read(row.activeProgramObject)
        ]);
        if (adapter.unloading) return;
        const allowed = parse(row.remoteValue);
        const program = typeof selected?.val === 'string' && selected.val ? selected.val : null;
        const command = row.startFromSelection === true ? program : parse(row.startValue);
        const identity = JSON.stringify([row.statusObject, row.programObject, row.activeProgramObject, row.powerObject,
            ...(!row.powerUnit || row.powerUnit === "W" ? [] : [row.powerUnit])]);
        const keyFor = uid => createHash('sha256').update(JSON.stringify([identity, uid])).digest('hex').slice(0, 32);
        const sameDevice = prior.identity === identity;
        const running = Boolean(row.runningValue && operation?.val === row.runningValue);
        const ready = Boolean(row.readyValue && operation?.val === row.readyValue);
        const released = remote !== null && allowed !== null && remote.val === allowed;
        const release = released ? `${row.remoteObject}:${remote.lc || remote.ts}` : null;
        const current = {name: row.name, mode: row.mode, running, ready, released,
            powerW: powerInWatts(power?.val, row.powerUnit), plan: null,
            ...(adapter.appliancePhases?.resultFor(row.powerObject, row.powerUnit) || {}),
            attemptedRelease: prior.attemptedRelease ?? null, identity, program,
            run: sameDevice ? prior.run ?? null : null};
        const transitionAt = operation?.lc || operation?.ts;
        const runtime = Date.now();
        const activeProgram = row.activeProgramObject ? active?.val : program;
        if (running && !current.run && typeof activeProgram === 'string' && activeProgram
            && Number.isFinite(transitionAt) && transitionAt > 0 && transitionAt <= runtime
            && runtime - transitionAt < 96 * SLOT) {
            current.run = {program: activeProgram, start: transitionAt};
        }
        if (current.run && !running && operation && transitionAt > current.run.start) {
            if (row.finishedValue && operation.val === row.finishedValue && transitionAt <= runtime) {
                current.run.end ??= transitionAt;
            } else if (ready || /(?:^|\.)(inactive|idle|aborted|cancelled|error)$/i.test(String(operation.val))) {
                if (!current.run.end) current.run = null;
            }
        }
        if (current.run?.end && row.powerObject && runtime - current.run.end >= 30000) {
            const {start, end, program: uid} = current.run;
            const profileId = `Devices.ProgramProfiles.${keyFor(uid)}`;
            const previous = parse(await own(profileId));
            if (Array.isArray(previous?.runs) && previous.runs.some(run => run.start === start)) {
                current.run = null;
            } else {
                try {
                    const measurements = await adapter.runEngine(`getHistory(${JSON.stringify(row.powerObject)}, ${start}, ${end}, true)`);
                    if (adapter.unloading) return;
                    const measured = learnProfile(measurements, start, end, row.powerUnit);
                    if (measured) {
                        const runs = [...(previous?.runs ?? []), {...measured, start, end}].slice(-9);
                        await publish(profileId, {name: row.name, program: uid, sampleCount: runs.length,
                            gridPhase: current.gridPhase ?? 0,
                            ...typicalProfile(runs), runs});
                        current.run = null;
                        current.learning = 'learned';
                    } else {
                        current.learning = 'incomplete power history';
                        current.run = null;
                    }
                } catch (error) {
                    current.learning = error.message;
                    current.run = null;
                }
            }
        }
        if (released && ready && forecast && (!row.programObject || program)) {
            const learned = program && parse(await own(`Devices.ProgramProfiles.${keyFor(program)}`));
            const profile = row.programObject ? learned?.watts : parse(row.profileJson);
            current.profileSamples = learned?.sampleCount ?? 0;
            current.plan = planProgram(profile, forecast.grid, forecast.prices,
                forecast.now, deadline(row.finishBy, forecast.now));
        }
        const armed = row.mode === 'automatic' && adapter.config.globalWriteEnabled === true
            && adapter.config.controlEnabled !== false;
        const rawAnnouncement = await own(announcementId);
        const previousAnnouncement = parse(rawAnnouncement);
        const announcement = armed && release && release !== current.attemptedRelease && current.plan
            ? programAnnouncement(row.name, current.plan, release, program, forecast.now) : null;
        if (!adapter.unloading && (announcement?.id !== previousAnnouncement?.id
            || rawAnnouncement == null)) {
            await publish(announcementId, announcement);
        }
        if (armed && release && release !== current.attemptedRelease && current.plan
            && current.plan.plannedStartAt <= forecast.now && command !== null && row.startObject
            && (!row.programObject || typeof command !== 'string' || command === program)
            && rows.filter(other => other.mode === 'automatic' && other.startObject === row.startObject).length === 1) {
            const object = await adapter.getForeignObjectAsync(row.startObject);
            const type = object?.common?.type;
            const compatible = type === typeof command || type === 'boolean' && command === true;
            if (!adapter.unloading && object?.common?.write === true && compatible) {
                current.attemptedRelease = release;
                await publish(id, current);
                const [latestRemote, latestStatus, latestProgram] = await Promise.all([
                    read(row.remoteObject), read(row.statusObject), read(row.programObject)
                ]);
                if (!adapter.unloading && latestRemote?.val === allowed && (latestRemote.lc || latestRemote.ts) === (remote.lc || remote.ts)
                    && latestStatus?.val === row.readyValue
                    && (!row.programObject || latestProgram?.val === program)) {
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

module.exports = {learnProfile, planProgram, powerInWatts, programAnnouncement, startDevicePrograms};
