'use strict';

// Independent accounting policy. No ioBroker access, transport interpretation,
// actuator writes, reservation release or automatic activation lives here.
const MAX_ITEMS = 128;
const powerFields = ['netBudgetW', 'siteNetW', 'actualGroupGrossW', 'actualGroupNetW',
    'rawOwnAvailableW', 'eligibleOwnAvailableW', 'ownAvailableW', 'ownUsedW',
    'storageChargeW', 'storageDischargeW', 'participantPendingW',
    'nonparticipantPendingW', 'committedGroupW'];

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => number(value) && value >= 0;
const identifier = value => typeof value === 'string' && value.length > 0
    && value.length <= 512 && value.trim() === value;

function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}

function invalid(reason, mode = 'groupNet') {
    return freeze({schema: 1, mode: typeof mode === 'string' ? mode : 'unknown', valid: false, active: true, reason,
        ...Object.fromEntries(powerFields.map(field => [field, null])), grossBudgetW: 0,
        devices: Object.create(null)});
}

function inactive(mode) {
    return freeze({schema: 1, mode, valid: true, active: false,
        reason: mode === 'legacyGross' ? 'Accounting core inactive; legacy enforcement remains external'
            : 'No active group constraint', grossBudgetW: null, devices: Object.create(null)});
}

// Actual attribution and spendable policy credit are deliberately different.
// Storage discharge is observed but is not made available for discretionary
// consumption. Commands and high-water reservations are demand, never supply.
function derive(base, devices) {
    let participantPendingW = 0, nonparticipantPendingW = 0;
    for (const device of Object.values(devices)) {
        const pendingW = Math.max(device.actualW, device.commandW, device.reservedW) - device.actualW;
        if (device.member) participantPendingW += pendingW;
        else nonparticipantPendingW += pendingW;
    }
    const ownAvailableW = Math.max(0, base.eligibleOwnAvailableW - nonparticipantPendingW);
    const result = {...base, devices, participantPendingW, nonparticipantPendingW,
        ownAvailableW, grossBudgetW: base.netBudgetW + ownAvailableW,
        committedGroupW: base.actualGroupGrossW + participantPendingW};
    if (!powerFields.every(field => number(result[field])) || !number(result.grossBudgetW))
        return invalid('Accounting sum exceeds finite numeric bounds');
    return freeze(result);
}

/**
 * Evaluate one explicitly declared group and whole-site AC boundary.
 * q=0, ACK=true and original source timestamps are mandatory. Timestamp span
 * is a caller-declared coherence bound, not proof of simultaneous sampling.
 * Actual source coverage and high-water reservation validity remain caller
 * contracts; this function cannot establish physical topology or ACK release.
 */
function evaluateGroupAccounting(input = {}) {
    if (!record(input)) return invalid('Accounting input is not an object');
    const mode = input.mode === undefined ? 'legacyGross' : input.mode;
    if (mode === 'legacyGross') return inactive(mode);
    if (mode !== 'groupNet') return invalid('Unknown accounting mode', mode);
    const limit = input.limit;
    if (!record(limit) || limit.valid !== true || typeof limit.active !== 'boolean')
        return invalid('A prevalidated numeric network constraint is required');
    if (!limit.active) return inactive(mode);
    const {now, group, site, storage} = input;
    const maxAgeMs = input.maxAgeMs === undefined ? 30000 : input.maxAgeMs;
    const maxSkewMs = input.maxSkewMs === undefined ? 0 : input.maxSkewMs;
    if (!number(now) || now <= 0 || !number(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > 30000
        || !nonnegative(maxSkewMs) || maxSkewMs > 1000 || maxSkewMs > maxAgeMs)
        return invalid('Invalid observation time, maximum age or coherence bound');
    if (!record(group) || !identifier(group.id) || !identifier(group.boundaryId)
        || group.id !== limit.groupId || group.boundaryId !== limit.boundaryId)
        return invalid('Network constraint group or measurement boundary does not match');
    if (!nonnegative(limit.budgetW) || !Number.isSafeInteger(limit.budgetW))
        return invalid('Network budget must be a nonnegative safe integer in watts');
    const list = value => Array.isArray(value) && value.length <= MAX_ITEMS;
    if (!list(group.participants) || !group.participants.length || !list(input.participantMeters)
        || !list(input.devices)) return invalid('Participant, meter or device list is missing or too large');

    // Source aliases are permitted only when they reproduce exactly the same
    // observation (e.g. a dedicated member meter also used as its device meter).
    const sources = new Map();
    const source = value => {
        if (!record(value) || !identifier(value.id) || value.boundaryId !== group.boundaryId
            || value.scope !== 'total-ac' || !['W', 'kW'].includes(value.unit))
            throw new Error('Source identity, complete AC scope, boundary or unit is invalid');
        const state = value.state;
        if (!record(state) || !number(state.val) || state.ack !== true || state.q !== 0
            || !number(state.ts) || state.ts <= 0 || state.ts > now || now - state.ts > maxAgeMs)
            throw new Error(`Source ${value.id} is missing, unacknowledged, bad-quality, stale or future`);
        const watts = state.val * (value.unit === 'kW' ? 1000 : 1);
        if (!number(watts)) throw new Error(`Source ${value.id} power is not finite`);
        const observed = {id: value.id, watts, val: state.val, ts: state.ts, unit: value.unit};
        const previous = sources.get(value.id);
        if (previous && (previous.val !== observed.val || previous.ts !== observed.ts
            || previous.unit !== observed.unit))
            throw new Error(`Conflicting observations alias source ${value.id}`);
        sources.set(value.id, observed);
        return observed;
    };

    try {
        if (!record(site)) throw new Error('Whole-site import/export measurements are missing');
        const imported = source(site.import), exported = source(site.export);
        if (imported.id === exported.id || imported.watts < 0 || exported.watts < 0)
            throw new Error('Site import/export must be separate nonnegative AC measurements');
        const siteIds = new Set([imported.id, exported.id]);
        if (!record(storage) || !['none', 'complete-ac'].includes(storage.coverage)
            || !list(storage.meters) || (storage.coverage === 'none' ? storage.meters.length !== 0
                : storage.meters.length === 0))
            throw new Error('Storage coverage must explicitly declare none or a complete signed AC list');
        const storageSources = new Map();
        let storageChargeW = 0, storageDischargeW = 0;
        for (const meter of storage.meters) {
            const measured = source(meter);
            if (siteIds.has(measured.id) || storageSources.has(measured.id)
                || !['charge-positive', 'discharge-positive'].includes(meter.direction))
                throw new Error('Storage source is duplicated, overlaps site metering or lacks its sign convention');
            const watts = measured.watts * (meter.direction === 'charge-positive' ? 1 : -1);
            storageSources.set(measured.id, {...measured, chargeW: Math.max(0, watts)});
            storageChargeW += Math.max(0, watts);
            storageDischargeW += Math.max(0, -watts);
        }

        const participants = new Map(), memberDevices = new Map();
        for (const item of group.participants) {
            if (!record(item) || !identifier(item.id) || participants.has(item.id)
                || !(item.deviceId === null || identifier(item.deviceId))
                || !['load', 'storage'].includes(item.kind === undefined ? 'load' : item.kind))
                throw new Error('Participant identity, device binding or kind is missing or duplicated');
            if (item.deviceId !== null && memberDevices.has(item.deviceId))
                throw new Error('A controlled device cannot be bound to multiple participants');
            const participant = {...item, kind: item.kind === undefined ? 'load' : item.kind};
            participants.set(item.id, participant);
            if (item.deviceId !== null) memberDevices.set(item.deviceId, item.id);
        }
        const coverage = new Map(), participantSourceIds = new Set();
        let actualGroupGrossW = 0;
        for (const meter of input.participantMeters) {
            const measured = source(meter);
            if (siteIds.has(measured.id) || participantSourceIds.has(measured.id)
                || !list(meter.participantIds) || !meter.participantIds.length)
                throw new Error('Participant meter source or coverage is missing, duplicated or overlaps site metering');
            const covered = meter.participantIds.map(id => participants.get(id));
            if (covered.some(item => !item) || new Set(meter.participantIds).size !== covered.length
                || covered.some(item => coverage.has(item.id)))
                throw new Error('Participant meter coverage overlaps or names an unknown participant');
            if (covered.length > 1 && covered.some(item => item.deviceId !== null))
                throw new Error('A controlled participant requires its own complete AC meter; aggregate partition is unknown');
            const stored = storageSources.get(measured.id);
            if (stored ? covered.length !== 1 || covered[0].kind !== 'storage'
                : covered.some(item => item.kind === 'storage') || measured.watts < 0)
                throw new Error('Storage and other participant consumption require separate complete AC meters');
            const watts = stored ? stored.chargeW : measured.watts;
            actualGroupGrossW += watts;
            participantSourceIds.add(measured.id);
            for (const item of covered) coverage.set(item.id, {sourceId: measured.id, watts});
        }
        if (coverage.size !== participants.size) throw new Error('Participant meter coverage is incomplete');

        const devices = Object.create(null), deviceSources = new Set();
        for (const item of input.devices) {
            if (!record(item) || !identifier(item.id) || Object.hasOwn(devices, item.id)
                || !nonnegative(item.commandW) || !nonnegative(item.reservedW))
                throw new Error('Device identity, current command or high-water reservation is missing or invalid');
            const member = item.participantId !== null;
            if (member ? !participants.has(item.participantId)
                || memberDevices.get(item.id) !== item.participantId : memberDevices.has(item.id))
                throw new Error('Device participant binding does not match the configured group');
            const measured = source(item.measurement);
            if (siteIds.has(measured.id) || deviceSources.has(measured.id))
                throw new Error('Device actual measurements overlap or duplicate another device/site meter');
            const stored = storageSources.get(measured.id);
            if (member ? coverage.get(item.participantId).sourceId !== measured.id
                : participantSourceIds.has(measured.id))
                throw new Error('Device actual source does not match its dedicated participant boundary');
            if (!stored && measured.watts < 0)
                throw new Error('Signed device power requires an explicitly covered AC storage meter');
            const actualW = stored ? stored.chargeW : measured.watts;
            devices[item.id] = {id: item.id, participantId: item.participantId, member,
                actualW, commandW: item.commandW, reservedW: item.reservedW};
            deviceSources.add(measured.id);
        }
        if ([...memberDevices.keys()].some(id => !Object.hasOwn(devices, id)))
            throw new Error('A controlled participant has no actual measurement and commitment input');
        const times = [...sources.values()].map(item => item.ts);
        const firstAt = Math.min(...times), lastAt = Math.max(...times);
        if (lastAt - firstAt > maxSkewMs)
            throw new Error('Source timestamp span exceeds the declared coherence bound');
        const siteNetW = imported.watts - exported.watts;
        const rawOwnAvailableW = Math.max(0, actualGroupGrossW - siteNetW);
        const base = {schema: 1, mode, valid: true, active: true,
            groupId: group.id, boundaryId: group.boundaryId,
            netBudgetW: limit.budgetW, siteNetW, actualGroupGrossW,
            actualGroupNetW: Math.max(0, actualGroupGrossW - rawOwnAvailableW),
            rawOwnAvailableW, ownUsedW: Math.min(actualGroupGrossW, rawOwnAvailableW),
            eligibleOwnAvailableW: Math.max(0, rawOwnAvailableW - storageDischargeW),
            storageChargeW, storageDischargeW,
            observation: {now, firstAt, lastAt, maxAgeMs, maxSkewMs},
            reason: 'Observed attribution separated from one shared non-storage supply allowance'};
        return derive(base, devices);
    } catch (error) {
        return invalid(error.message);
    }
}

function proposalEntries(proposals) {
    if (!record(proposals) || Object.keys(proposals).length > MAX_ITEMS
        || Reflect.ownKeys(proposals).length !== Object.keys(proposals).length) return null;
    const entries = Object.entries(proposals);
    return entries.every(([id, watts]) => identifier(id) && nonnegative(watts)) ? entries : null;
}

function validSnapshot(snapshot) {
    if (!record(snapshot) || snapshot.schema !== 1 || snapshot.valid !== true
        || typeof snapshot.active !== 'boolean'
        || !['legacyGross', 'groupNet'].includes(snapshot.mode)) return false;
    if (!snapshot.active) return true;
    return snapshot.mode === 'groupNet' && identifier(snapshot.groupId) && identifier(snapshot.boundaryId)
        && record(snapshot.devices) && powerFields.every(field => field === 'siteNetW'
            ? number(snapshot[field]) : nonnegative(snapshot[field]))
        && nonnegative(snapshot.grossBudgetW) && nonnegative(snapshot.netBudgetW)
        && Object.entries(snapshot.devices).every(([id, device]) => record(device) && device.id === id
            && identifier(id) && typeof device.member === 'boolean'
            && (device.member ? identifier(device.participantId) : device.participantId === null)
            && nonnegative(device.actualW) && nonnegative(device.commandW) && nonnegative(device.reservedW));
}

/**
 * Pure immutable joint reservation preview. It performs no physical write.
 * Chain the returned next state or reevaluate fresh, complete commitments
 * before another grant; independent commandBudget previews reserve nothing.
 * A lower command never releases the previous high-water reservation here.
 */
function reserveGroupCommands(snapshot, proposals) {
    const denied = reason => ({valid: false, allowed: false, withinBudget: false,
        safeReduction: false, reason, next: null});
    const entries = proposalEntries(proposals);
    if (!entries) return denied('Commands must be a bounded map of finite nonnegative consumption watts');
    if (!validSnapshot(snapshot))
        return entries.length > 0 && entries.every(([, watts]) => watts === 0)
            ? {valid: false, allowed: true, withinBudget: false, safeReduction: true,
                reason: 'Safe zero commands; accounting proof remains invalid', next: null}
            : denied('A valid accounting snapshot is required');
    if (!snapshot.active) return {valid: true, allowed: true, withinBudget: true,
        safeReduction: false, reason: 'Accounting core has no active constraint', next: snapshot};
    if (entries.some(([id, watts]) => watts !== 0 && !Object.hasOwn(snapshot.devices, id)))
        return denied('Command names an unknown measured device');
    const devices = Object.create(null);
    for (const [id, value] of Object.entries(snapshot.devices)) devices[id] = {...value};
    let hasIncrease = false, hasReduction = false;
    for (const [id, watts] of entries) {
        // OFF is always a safe proposal, even for an unknown old actuator.
        // It grants no capacity and cannot release an unknown reservation.
        if (!Object.hasOwn(devices, id)) continue;
        const device = devices[id];
        hasIncrease ||= watts > device.commandW;
        hasReduction ||= watts < device.commandW;
        device.commandW = watts;
        device.reservedW = Math.max(device.reservedW, snapshot.devices[id].commandW, watts);
    }
    const next = derive(snapshot, devices);
    if (!next.valid) return denied(next.reason);
    const withinBudget = next.committedGroupW <= next.grossBudgetW;
    const safeReduction = !hasIncrease && hasReduction;
    const zeroOnly = entries.length > 0 && entries.every(([, watts]) => watts === 0);
    const allowed = withinBudget || safeReduction || zeroOnly;
    return {valid: true, allowed, withinBudget, safeReduction,
        reason: withinBudget ? 'Joint command commitments fit the shared group allowance'
            : allowed ? 'Only safe reductions; old physical demand remains reserved and above the current ceiling'
                : 'Joint command commitments exceed the shared group allowance',
        next: allowed ? next : null};
}

// A per-device ceiling preview, explicitly not a grant or mutation of state.
function commandBudget(snapshot, deviceId, requestedW) {
    if (!identifier(deviceId)) return {valid: false, allowed: requestedW === 0,
        withinBudget: false, safeReduction: requestedW === 0, maximumW: 0,
        member: null, reason: 'Device identity is missing or invalid'};
    const result = reserveGroupCommands(snapshot, {[deviceId]: requestedW});
    const proved = validSnapshot(snapshot);
    const device = proved && snapshot.active && Object.hasOwn(snapshot.devices, deviceId)
        ? snapshot.devices[deviceId] : null;
    let maximumW = proved && !snapshot.active ? null : 0;
    if (device) {
        const committedW = Math.max(device.actualW, device.commandW, device.reservedW);
        maximumW = device.member
            ? Math.max(0, snapshot.grossBudgetW - snapshot.committedGroupW + committedW)
            : snapshot.committedGroupW <= snapshot.netBudgetW ? null
                : committedW + Math.max(0, snapshot.grossBudgetW - snapshot.committedGroupW);
    }
    // The caller must use reserveGroupCommands with the entire command set or
    // its returned immutable state to establish joint feasibility.
    const {next, ...preview} = result;
    return {...preview, maximumW, member: device ? device.member : null};
}

module.exports = {evaluateGroupAccounting, commandBudget, reserveGroupCommands};
