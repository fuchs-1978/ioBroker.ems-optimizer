'use strict';

const {createHash} = require('node:crypto');
const {adapterTimers} = require('./adapter-timers');
const SLOT = 15 * 60000;

function parse(value) {
    try { return JSON.parse(value); } catch { return null; }
}

function usableProfile(profile) {
    return Array.isArray(profile) && profile.length > 0 && profile.length <= 96
        && profile.every(w => Number.isFinite(w) && w >= 0) && profile.some(w => w > 0);
}

function programProfileId(identity, program) {
    const key = createHash('sha256').update(JSON.stringify([identity, program])).digest('hex').slice(0, 32);
    return `Devices.ProgramProfiles.${key}`;
}

function planProgram(profile, grid, prices, now, latest, reservations = []) {
    if (!usableProfile(profile)) return null;
    const gridByTime = new Map(grid.map(slot => [slot.timestamp, slot.valueW]));
    const priceByTime = new Map(prices.filter(slot => slot.valid).map(slot => [slot.timestamp, slot.value_ct_kWh]));
    function cost(start) {
        let euros = 0;
        for (let i = 0; i < profile.length; i++) {
            let at = start + i * SLOT;
            const end = at + SLOT;
            while (at < end) {
                const slot = Math.floor(at / SLOT) * SLOT;
                let until = Math.min(slot + SLOT, end);
                const baseline = gridByTime.get(slot), price = priceByTime.get(slot);
                if (!Number.isFinite(baseline) || !Number.isFinite(price)) return null;
                let gridW = baseline;
                for (const run of reservations) {
                    const index = Math.floor((at - run.start) / SLOT);
                    if (index < 0) until = Math.min(until, run.start);
                    else if (index < run.watts.length) {
                        gridW += run.watts[index];
                        until = Math.min(until, run.start + (index + 1) * SLOT);
                    }
                }
                const incremental = Math.max(0, gridW + profile[i]) - Math.max(0, gridW);
                euros += incremental * (until - at) * price / 360000000000;
                at = until;
            }
        }
        return euros;
    }
    const immediate = cost(now);
    const duration = profile.length * SLOT;
    let selected = null;
    const starts = new Set([now, ...gridByTime.keys()]);
    for (const run of reservations) {
        for (let i = 0; i <= run.watts.length; i++) starts.add(run.start + i * SLOT);
    }
    for (const start of [...starts].filter(at => at >= now).sort((a, b) => a - b)) {
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

function coordinatePrograms(entries, forecast) {
    if (!forecast) return;
    const reservations = [];
    const unknown = [];
    for (const {id, current} of entries) {
        if (current.reservation && current.reservation.start + current.reservation.watts.length * SLOT > forecast.now) {
            reservations.push(current.reservation);
        } else if (current.running) {
            unknown.push(current.name || id);
        }
    }
    // Real loads have priority. Waiting observation rows share the remaining capacity in a preview.
    const waiting = entries.filter(({current, release}) => current.ready && current.released && !current.running
        && !current.reservation && current.attemptedRelease !== release);
    for (const {current, watts} of waiting) {
        if (unknown.length) {
            current.waitingForRunningProfile = unknown;
            continue;
        }
        const plan = planProgram(watts, forecast.grid, forecast.prices, forecast.now, current.finishByAt, reservations);
        if (plan) {
            current.plan = {...plan, forecastUpdatedAt: forecast.updated};
            reservations.push({start: plan.plannedStartAt, watts});
        }
    }
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
    const signalsFor = row => Promise.all([row.remoteObject, row.statusObject, row.programObject, row.activeProgramObject].map(read));
    const forecastValues = () => Promise.all(['Plan.Valid', 'Plan.LastUpdate', 'Plan.GridPower_48h_JSON',
        'Forecast.TotalPrice_48h_JSON'].map(own));
    const writeEnabled = () => adapter.config.globalWriteEnabled === true && adapter.config.controlEnabled !== false;
    const deviceAverages = new Map();
    let firstTick = true;

    async function averageForDevice(identity) {
        if (deviceAverages.has(identity)) return deviceAverages.get(identity);
        const states = await adapter.getStatesAsync('Devices.ProgramProfiles.*');
        const totals = [];
        let programCount = 0;
        for (const [id, state] of Object.entries(states || {})) {
            const profile = parse(state?.val);
            if (typeof profile?.program !== 'string' || !profile.program || !usableProfile(profile.watts)
                || !Number.isInteger(profile.sampleCount) || profile.sampleCount < 1) continue;
            // Existing profiles identify their appliance through the state ID, even after a row is renamed or moved.
            const expected = programProfileId(identity, profile.program);
            if (id !== expected && id !== `${adapter.namespace}.${expected}`) continue;
            programCount++;
            for (const [slot, watts] of profile.watts.entries()) totals[slot] = (totals[slot] ?? 0) + watts;
        }
        // A shorter program draws zero after its last slot. Each program has one vote regardless of run count.
        const average = programCount ? {watts: totals.map(total => total / programCount), programCount} : null;
        deviceAverages.set(identity, average);
        return average;
    }

    async function savedPrograms() {
        const byIdentity = new Map();
        const states = await adapter.getStatesAsync('Devices.Programs.*');
        for (const [id, state] of Object.entries(states || {})) {
            if (!/\.Programs\.\d+$/.test(id)) continue;
            const status = parse(state?.val);
            if (status?.identity && (!byIdentity.has(status.identity) || state.ts > byIdentity.get(status.identity).ts)) {
                byIdentity.set(status.identity, {ts: state.ts, status});
            }
        }
        return byIdentity;
    }
    async function publish(id, value) {
        await adapter.setObjectNotExistsAsync(id, {
            type: 'state', common: {name: id.endsWith('.Announcement') ? 'Appliance program announcement' : 'Appliance program status', type: 'string', role: 'json', read: true, write: false},
            native: {}
        });
        await adapter.setStateAsync(id, JSON.stringify(value), true);
    }
    async function inspect(row, index, saved) {
        const id = `Devices.Programs.${index + 1}`;
        const announcementId = `${id}.Announcement`;
        if (!['observe', 'automatic'].includes(row.mode)) {
            if (!adapter.unloading && await own(announcementId) !== 'null') await publish(announcementId, null);
            return;
        }
        const [signals, power] = await Promise.all([signalsFor(row), read(row.powerObject)]);
        const [remote, operation, selected, active] = signals;
        if (adapter.unloading) return;
        const allowed = parse(row.remoteValue);
        const program = typeof selected?.val === 'string' && selected.val ? selected.val : null;
        const command = row.startFromSelection === true ? program : parse(row.startValue);
        const identity = JSON.stringify([row.statusObject, row.programObject, row.activeProgramObject, row.powerObject,
            ...(!row.powerUnit || row.powerUnit === "W" ? [] : [row.powerUnit])]);
        const prior = saved?.get(identity)?.status || parse(await own(id)) || {};
        const sameDevice = prior.identity === identity;
        const running = Boolean(row.runningValue && operation?.val === row.runningValue);
        const ready = Boolean(row.readyValue && operation?.val === row.readyValue);
        const releaseAt = remote?.lc || remote?.ts;
        const released = Boolean(Number.isFinite(releaseAt) && allowed !== null && remote.val === allowed);
        const release = released ? `${row.remoteObject}:${releaseAt}` : null;
        const current = {name: row.name, mode: row.mode, running, ready, released,
            powerW: powerInWatts(power?.val, row.powerUnit), plan: null,
            ...(adapter.appliancePhases?.resultFor(row.powerObject, row.powerUnit) || {}),
            attemptedRelease: prior.attemptedRelease ?? null, identity, program, release, reservation: null,
            run: sameDevice ? prior.run ?? null : null};
        const transitionAt = operation?.lc || operation?.ts;
        const runtime = Date.now();
        const previous = sameDevice && Number.isFinite(prior.reservation?.start) && usableProfile(prior.reservation.watts)
            ? prior.reservation : null;
        const issuedProgram = previous?.kind === 'sent' && transitionAt >= previous.start
            && transitionAt < previous.start + previous.watts.length * SLOT ? previous.program : null;
        // Some appliances clear the selection when starting and provide no separate active-program object.
        const activeProgram = row.activeProgramObject ? active?.val : current.run?.program || program || issuedProgram;
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
            const profileId = programProfileId(identity, uid);
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
                        deviceAverages.delete(identity);
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
        const uid = running ? activeProgram || current.run?.program : program;
        let watts = null;
        if (running || released && ready) {
            const hasProgram = row.programObject && typeof uid === 'string' && uid.length > 0;
            const learned = hasProgram ? parse(await own(programProfileId(identity, uid))) : null;
            watts = row.programObject ? learned?.watts : parse(row.profileJson);
            current.profileSamples = 0;
            if (usableProfile(watts)) {
                current.profileSamples = learned?.sampleCount ?? 0;
                current.profileSource = row.programObject ? 'program' : 'configured';
            } else if (hasProgram) {
                const average = await averageForDevice(identity);
                if (average) {
                    watts = average.watts;
                    current.profileSource = 'deviceAverage';
                    current.fallbackProgramCount = average.programCount;
                }
            }
        }

        if (running) {
            const start = operation.lc || current.run?.start || (prior.running && previous?.start) || operation.ts;
            if (!usableProfile(watts) && previous && previous.program === (uid ?? null)) watts = previous.watts;
            if (Number.isFinite(start) && start <= runtime && usableProfile(watts)) {
                current.reservation = {kind: 'running', start, watts, program: uid ?? null};
            }
        } else if (previous && previous.start + previous.watts.length * SLOT > runtime) {
            // A start can take a while to appear in the appliance adapter. Keep its expected load across ticks and restarts.
            const stopped = operation && transitionAt >= previous.start && (operation.val === row.finishedValue ||
                ready && (previous.kind === 'running' || transitionAt > previous.start) ||
                !ready && /(?:^|\.)(inactive|idle|aborted|cancelled|error)$/i.test(String(operation.val)));
            if (!stopped) current.reservation = previous;
        } else if (sameDevice && !Object.hasOwn(prior, 'reservation') && ready && release
            && prior.attemptedRelease === release && prior.program === program && usableProfile(watts)
            && Number.isFinite(prior.plan?.plannedStartAt) && prior.plan.plannedStartAt <= runtime
            && prior.plan.plannedStartAt + watts.length * SLOT > runtime) {
            // Older builds persisted the issued release and plan, without the separate reservation.
            current.reservation = {kind: 'sent', start: prior.plan.plannedStartAt, watts, program};
        }
        if (row.finishBy && sameDevice && prior.finishBySetting === row.finishBy && Number.isFinite(prior.finishByAt)) {
            current.finishBySetting = row.finishBy;
            current.deadlineRelease = prior.deadlineRelease;
            current.finishByAt = prior.finishByAt;
        }
        if (released && ready && !running && (!row.finishBy || current.deadlineRelease !== release)) {
            current.finishByAt = deadline(row.finishBy, runtime);
            if (row.finishBy) {
                current.finishBySetting = row.finishBy;
                current.deadlineRelease = release;
            }
        }
        const automatic = row.mode === 'automatic' && Boolean(row.startObject) && command !== null
            && (!row.programObject || typeof command !== 'string' || command === program)
            && rows.filter(other => other.mode === 'automatic' && other.startObject === row.startObject).length === 1;
        return {id, index, row, signals, release, releaseAt, current, watts, command, automatic};
    }

    async function canStillStart(entry, entries, forecast) {
        const readings = await Promise.all(entries.map(({row}) => signalsFor(row)));
        const latest = await forecastValues();
        const now = Date.now();
        if (adapter.unloading || !writeEnabled() || latest.some((value, i) => value !== forecast.values[i])
            || now < entry.current.plan.plannedStartAt || now < forecast.updated || now - forecast.updated >= 20 * 60000
            || Math.floor(now / SLOT) !== Math.floor(forecast.now / SLOT)
            || now + entry.watts.length * SLOT > entry.current.finishByAt) return false;
        return readings.every((signals, i) => signals.every((state, k) => {
            const old = entries[i].signals[k];
            // The release and operating-state edges identify the same release and run.
            return state?.val === old?.val && (k > 1 || (state?.lc || state?.ts) === (old?.lc || old?.ts));
        }));
    }

    async function publishAndStart(entry, entries, forecast) {
        const {id, row, release, current, watts, command, automatic} = entry;
        const announcementId = `${id}.Announcement`;
        const armed = automatic && writeEnabled();
        const announcement = armed && current.plan
            ? programAnnouncement(row.name, current.plan, release, current.program, forecast.now) : null;
        if (await own(announcementId) !== JSON.stringify(announcement) && !adapter.unloading) {
            await publish(announcementId, announcement);
        }
        if (adapter.unloading) return;
        if (armed && current.plan && current.plan.plannedStartAt <= forecast.now) {
            const object = await adapter.getForeignObjectAsync(row.startObject);
            if (!adapter.unloading && object?.common?.write === true && object.common.type === typeof command) {
                const previousAttempt = current.attemptedRelease;
                current.attemptedRelease = release;
                current.reservation = {kind: 'sent', start: Date.now(), watts, program: current.program};
                // Persist the intent before the external write so a restart cannot repeat the command.
                await publish(id, current);
                let verified = false;
                try {
                    verified = await canStillStart(entry, entries, forecast);
                } finally {
                    if (!verified) {
                        current.attemptedRelease = previousAttempt;
                        current.reservation = null;
                        current.plan = null;
                        await publish(id, current);
                        await publish(announcementId, null);
                    }
                }
                if (verified) await adapter.setForeignStateAsync(row.startObject, command, false);
                return;
            }
        }
        await publish(id, current);
    }

    async function tick() {
        try {
            if (adapter.unloading) return;
            const entries = [];
            const saved = firstTick && typeof adapter.getStatesAsync === 'function' ? await savedPrograms() : null;
            for (const [index, row] of rows.entries()) {
                const entry = await inspect(row, index, saved);
                if (adapter.unloading) return;
                if (entry) entries.push(entry);
            }
            firstTick = false;
            const values = await forecastValues();
            const [valid, updated, gridJson, pricesJson] = values;
            const now = Date.now(), grid = parse(gridJson), prices = parse(pricesJson);
            const forecast = valid === true && Number.isFinite(updated) && updated <= now
                && now - updated < 20 * 60000 && Array.isArray(grid) && Array.isArray(prices)
                ? {now, updated, grid, prices, values} : null;
            entries.sort((a, b) => Number(b.automatic) - Number(a.automatic)
                || (a.releaseAt ?? Infinity) - (b.releaseAt ?? Infinity) || a.index - b.index);
            coordinatePrograms(entries, forecast);
            for (const entry of entries) {
                if (adapter.unloading) return;
                await publishAndStart(entry, entries, forecast);
            }
        } catch (error) { adapter.log.warn(`Appliance programs: ${error.message}`); }
        finally { if (!adapter.unloading) timers.setTimeout(() => void tick(), 15000); }
    }
    void tick();
}

module.exports = {learnProfile, planProgram, powerInWatts, programAnnouncement, startDevicePrograms};
