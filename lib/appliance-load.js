'use strict';

const {createHash} = require('node:crypto');
const SLOT = 900000;

function parse(value) {
    try { return JSON.parse(value); } catch { return null; }
}

function programIdentity(row) {
    return JSON.stringify([row.statusObject, row.programObject, row.activeProgramObject, row.powerObject,
        ...(!row.powerUnit || row.powerUnit === 'W' ? [] : [row.powerUnit])]);
}

function key(value) { return createHash('sha256').update(value).digest('hex').slice(0, 32); }
function programProfileId(identity, program) { return 'Devices.ProgramProfiles.' + key(JSON.stringify([identity, program])); }
function programHistoryId(identity) { return 'Devices.ProgramHistory.' + key(identity); }

// A profile is anchored to the start of the program, independently of the clock quarter.
function meanProgramWatts(run, from, until) {
    const first = Math.max(0, Math.floor((from - run.start) / SLOT));
    let wattMs = 0;
    for (let i = first; i < run.watts.length; i++) {
        const start = run.start + i * SLOT;
        if (start >= until) break;
        wattMs += run.watts[i] * Math.max(0, Math.min(until, start + SLOT) - Math.max(from, start));
    }
    return wattMs / (until - from);
}

function historySources(rows) {
    const sources = new Map();
    for (const row of rows || []) {
        if (!['observe', 'automatic'].includes(row?.mode) || !row.statusObject) continue;
        const identity = programIdentity(row);
        sources.set(identity, row.includedInSubmeters === true && sources.get(identity) !== false);
    }
    return [...sources].sort(([a], [b]) => a.localeCompare(b));
}

// Legacy profiles retain start/end and program-relative averages. Without the original
// clock-quarter integral, an off-grid watt value cannot be subtracted from a house meter.
function historyCorrections(rows, states, namespace, now) {
    const sources = historySources(rows);
    const corrections = new Map();
    if (!sources.length) return corrections;
    const programs = [], observed = new Map();
    for (const [id, state] of states) {
        if (!id.startsWith(namespace + '.Devices.Program') || state?.ack !== true || state.q) continue;
        if (id.startsWith(namespace + '.Devices.ProgramProfiles.')) {
            const value = parse(state.val);
            if (Array.isArray(value?.runs)) programs.push({id, value});
        } else if (/\.Programs\.\d+$/.test(id)) {
            const value = parse(state.val);
            if (value?.identity && state.ts >= (observed.get(value.identity)?.ts || 0))
                observed.set(value.identity, {run: value.run, ts: state.ts});
        }
    }
    for (const [identity, included] of sources) {
        const runs = new Map();
        for (const {id, value} of programs) {
            if (id !== namespace + '.' + programProfileId(identity, value.program)) continue;
            for (const run of value.runs) if (run) runs.set(run.start, run);
        }
        const last = observed.get(identity);
        if (last?.run) runs.set(last.run.start, {start: last.run.start, end: last.run.end || Math.min(last.ts, now)});
        const archive = states.get(namespace + '.' + programHistoryId(identity));
        const measured = archive?.ack === true && !archive.q ? parse(archive.val) : null;
        if (Array.isArray(measured)) for (const run of measured) if (run) runs.set(run.start, run);
        for (const run of runs.values()) {
            if (!Number.isSafeInteger(run.start) || !Number.isSafeInteger(run.end) || run.start <= 0
                || run.end <= run.start || run.end > now || run.end - run.start > 96 * SLOT) continue;
            const first = Math.floor(run.start / SLOT) * SLOT, count = Math.ceil((run.end - first) / SLOT);
            const watts = run.gridWatts ?? (first === run.start ? run.watts : null);
            const complete = included && Array.isArray(watts) && watts.length === count
                && watts.every(w => Number.isFinite(w) && w >= 0);
            for (let i = 0; i < count; i++) {
                const at = first + i * SLOT;
                const prior = corrections.get(at);
                corrections.set(at, complete && prior !== null ? (prior || 0) + watts[i] : null);
            }
        }
    }
    return corrections;
}

module.exports = {meanProgramWatts, programIdentity, programProfileId, programHistoryId, historySources, historyCorrections};
