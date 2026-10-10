'use strict';

// Standard SunEnergy 0.3.4: rawResponse contains the complete /read body.
// GP/GS are +discharge/-charge; the EMS uses +charge/-discharge.
// No I/O and no inferred heartbeat: each configured head needs its own fresh proof.
const DEVICE_CHARGE_MAX_W = 2400;
const MAX_RAW_BYTES = 512 * 1024;

function number(value) {
    if (!['number', 'string'].includes(typeof value)
        || typeof value === 'string' && !value.trim()) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readTopology(config = {}) {
    const instance = typeof config.batterySunEnergyInstance === 'string'
        ? config.batterySunEnergyInstance.trim() : 'sunenergyxt500.0';
    const count = number(config.batteryHeadCount === undefined ? 1 : config.batteryHeadCount);
    if (!/^sunenergyxt500\.\d+$/.test(instance) || !Number.isInteger(count) || count < 1 || count > 3)
        return {valid: false, reason: 'invalid-sunenergy-topology', instance, count, heads: []};
    const heads = [];
    for (let index = 1; index <= count; index++) {
        const maxChargeW = number(config[`batteryHead${index}MaxChargeW`] === undefined
            ? 2400 : config[`batteryHead${index}MaxChargeW`]);
        const maxDischargeW = number(config[`batteryHead${index}MaxDischargeW`] === undefined
            ? 800 : config[`batteryHead${index}MaxDischargeW`]);
        if (maxChargeW === null || maxDischargeW === null || maxChargeW < 0
            || maxChargeW > 2400 || maxDischargeW < 0 || maxDischargeW > 2400)
            return {valid: false, reason: `invalid-head-${index}-limits`, instance, count, heads: []};
        const baseId = `${instance}.heads.${index}`;
        heads.push({index, baseId, setpointId: `${baseId}.control.GS`,
            rawResponseId: `${baseId}.info.rawResponse`, onlineId: `${baseId}.info.online`,
            manualModeId: `${baseId}.control.MM`, localModeId: `${baseId}.control.LM`,
            maxChargeW, maxDischargeW});
    }
    return {valid: true, reason: 'configured', instance, count, heads};
}

function modelMaximum(data) {
    const pk = number(data.PK);
    if (pk === 1) return 800;
    if (pk === 2) return 2400;
    // Newer firmware supplies DevType instead of PK. Unknown products are not a PRO.
    if (typeof data.DevType !== 'string') return null;
    const model = data.DevType.trim().replace(/[\s_-]+/g, '').toLowerCase();
    if (/^(sunenergyxt|xt)500pro$/.test(model)) return 2400;
    if (/^(sunenergyxt|xt)500$/.test(model)) return 800;
    return null;
}

function parseHeadSnapshot(state, {now, maxAgeMs, index = 1, onlineState} = {}) {
    const sourceTs = state ? number(state.ts) : null;
    const sourceAgeMs = sourceTs === null || number(now) === null ? null : now - sourceTs;
    const fail = reason => ({valid: false, reason, index, sourceTs, sourceAgeMs});
    if (!Number.isInteger(index) || index < 1 || index > 3) return fail('invalid-head-index');
    if (!state || state.ack !== true || state.q !== undefined && number(state.q) !== 0)
        return fail('head-source-unacknowledged-or-invalid-quality');
    if (number(now) === null || number(maxAgeMs) === null || maxAgeMs <= 0
        || sourceTs === null || sourceTs <= 0 || sourceAgeMs < 0 || sourceAgeMs > maxAgeMs)
        return fail('head-source-stale-or-invalid-time');
    if (onlineState !== undefined && (!onlineState || onlineState.ack !== true
        || onlineState.q !== undefined && number(onlineState.q) !== 0 || onlineState.val !== true))
        return fail('head-offline-or-online-feedback-invalid');
    if (typeof state.val !== 'string' || !state.val.trim() || state.val.length > MAX_RAW_BYTES)
        return fail('head-snapshot-missing-or-too-large');
    let body;
    try { body = JSON.parse(state.val); } catch { return fail('head-snapshot-invalid-json'); }
    if (!object(body)) return fail('head-snapshot-invalid-envelope');
    const data = Object.hasOwn(body, 'state')
        ? object(body.state) && object(body.state.reported) ? body.state.reported : null : body;
    if (!object(data)) return fail('head-snapshot-invalid-envelope');
    const soc = number(data.SC), packs = number(data.ON), gsW = number(data.GS), gp = number(data.GP);
    const mm = number(data.MM), lm = number(data.LM), mg = number(data.MG), is = number(data.IS);
    const minSoc = number(data.SI) === null ? number(data.SO) : number(data.SI);
    const maxSoc = number(data.SA), modelMaxDischargeW = modelMaximum(data);
    if (soc === null || soc < 0 || soc > 100 || !Number.isInteger(packs) || packs < 1 || packs > 6
        || gsW === null || Math.abs(gsW) > 2400 || gp === null || Math.abs(gp) > 3000
        || minSoc === null || maxSoc === null || minSoc < 0 || maxSoc > 100 || minSoc >= maxSoc
        || mg === null || mg < 0 || mg > 2400 || is === null || is < 0 || is > 2400
        || modelMaxDischargeW === null) return fail('head-snapshot-missing-or-invalid-fields');
    if (mm !== 0 || lm !== 1) return fail('head-not-local-manual-mode');
    let minPackSoc = soc, maxPackSoc = soc;
    for (let i = 0; i < packs; i++) {
        if (!Object.hasOwn(data, `SC${i}`)) continue;
        const packSoc = number(data[`SC${i}`]);
        if (packSoc === null || packSoc < 0 || packSoc > 100) return fail('head-pack-soc-invalid');
        minPackSoc = Math.min(minPackSoc, packSoc);
        maxPackSoc = Math.max(maxPackSoc, packSoc);
    }
    const hysteresisDischarge = data.SI1 === undefined ? 0 : number(data.SI1);
    const hysteresisCharge = data.SA1 === undefined ? 0 : number(data.SA1);
    if (hysteresisDischarge === null || hysteresisCharge === null || hysteresisDischarge < 0
        || hysteresisDischarge > 100 || hysteresisCharge < 0 || hysteresisCharge > 100)
        return fail('head-soc-hysteresis-invalid');
    // IS limits the inverter's load port and grid port together. A missing LP must
    // not become zero and grant its whole rating for grid discharge. Charging is
    // independent of this output limit and remains available with valid inputs.
    const reportedLoadPowerW = number(data.LP);
    const loadPowerW = reportedLoadPowerW !== null && reportedLoadPowerW >= 0
        && reportedLoadPowerW <= 3000 ? reportedLoadPowerW : null;
    return {valid: true, reason: 'fresh-local-manual-head', index, sourceTs, sourceAgeMs,
        soc, packs, gsW, acPowerW: gp === 0 ? 0 : -gp, mm, lm, online: true,
        minSoc, maxSoc, minPackSoc, maxPackSoc,
        hysteresisDischarge, hysteresisCharge, modelMaxDischargeW, loadPowerW,
        dischargeReason: loadPowerW === null ? 'load-port-power-unknown' : 'load-port-budget-proved',
        maxChargeW: DEVICE_CHARGE_MAX_W,
        maxDischargeW: loadPowerW === null ? 0 : Math.min(mg, modelMaxDischargeW, Math.max(0, is - loadPowerW))};
}

function isResuming(value, index) {
    return value instanceof Set ? value.has(index) : Array.isArray(value) && value.includes(index);
}

// Planning uses the same per-head /read snapshots as real dispatch. In
// particular, a shared adapter heartbeat or a total from only online heads is
// not evidence for a missing configured head. ON is the online pack count;
// converting it to kWh requires an explicitly configured pack size.
function deviceProfile(heads, options = {}) {
    const capacitySource = options.capacitySource === undefined ? 'manual' : options.capacitySource;
    const fail = reason => ({valid: false, reason, status: reason,
        soc: null, actualW: null, packs: null, deviceMinSoc: null, deviceMaxSoc: null,
        minSoc: null, maxSoc: null, deviceMaxChargeW: null, deviceMaxDischargeW: null,
        maxChargeW: null, maxDischargeW: null, sourceTs: null, oldestSourceTs: null,
        newestSourceTs: null, sourceTsMin: null, sourceTsMax: null, sourceAgeMsMax: null,
        sourceSkewMs: null, headLimits: [], capacitySource,
        capacityValid: false, capacityKWh: null, capacityReason: reason});
    if (!Array.isArray(heads) || heads.length < 1 || heads.length > 3)
        return fail('configured-head-profile-missing');
    const topology = options.topology;
    if (topology !== undefined && (!topology || topology.valid !== true
        || !Number.isInteger(topology.count) || topology.count < 1 || topology.count > 3
        || !Array.isArray(topology.heads) || topology.heads.length !== topology.count
        || heads.length !== topology.count)) return fail('configured-head-profile-topology-invalid');
    const descriptors = new Map();
    if (topology !== undefined) {
        for (const descriptor of topology.heads) {
            if (!descriptor || !Number.isInteger(descriptor.index) || descriptor.index < 1
                || descriptor.index > topology.count || descriptors.has(descriptor.index)
                || number(descriptor.maxChargeW) === null || number(descriptor.maxDischargeW) === null
                || descriptor.maxChargeW < 0 || descriptor.maxChargeW > 2400
                || descriptor.maxDischargeW < 0 || descriptor.maxDischargeW > 2400)
                return fail('configured-head-profile-topology-invalid');
            descriptors.set(descriptor.index, descriptor);
        }
    }
    const indexes = new Set();
    const limits = [];
    for (const head of heads) {
        if (!head || head.valid !== true || head.online !== true || !Number.isInteger(head.index)
            || head.index < 1 || head.index > 3 || indexes.has(head.index)
            || topology !== undefined && !descriptors.has(head.index)
            || ['soc', 'acPowerW', 'minSoc', 'maxSoc', 'hysteresisCharge', 'hysteresisDischarge',
                'maxChargeW', 'maxDischargeW', 'sourceTs', 'sourceAgeMs'].some(key => typeof head[key] !== 'number')
            || number(head.soc) === null || head.soc < 0 || head.soc > 100
            || !Number.isInteger(head.packs) || head.packs < 1 || head.packs > 6
            || number(head.acPowerW) === null || Math.abs(head.acPowerW) > 3000
            || number(head.minSoc) === null || number(head.maxSoc) === null
            || head.minSoc < 0 || head.maxSoc > 100 || head.minSoc >= head.maxSoc
            || number(head.hysteresisCharge) === null || number(head.hysteresisDischarge) === null
            || head.hysteresisCharge < 0 || head.hysteresisCharge > 100
            || head.hysteresisDischarge < 0 || head.hysteresisDischarge > 100
            || number(head.maxChargeW) === null || number(head.maxDischargeW) === null
            || head.maxChargeW < 0 || head.maxChargeW > 2400
            || head.maxDischargeW < 0 || head.maxDischargeW > 2400
            || number(head.sourceTs) === null || head.sourceTs <= 0
            || number(head.sourceAgeMs) === null || head.sourceAgeMs < 0)
            return fail('configured-head-profile-unknown-or-invalid');
        indexes.add(head.index);
        const descriptor = descriptors.get(head.index);
        limits.push({index: head.index, minSoc: head.minSoc, maxSoc: head.maxSoc,
            hysteresisCharge: head.hysteresisCharge, hysteresisDischarge: head.hysteresisDischarge,
            maxChargeW: Math.min(head.maxChargeW, descriptor ? descriptor.maxChargeW : head.maxChargeW),
            maxDischargeW: Math.min(head.maxDischargeW, descriptor ? descriptor.maxDischargeW : head.maxDischargeW)});
    }
    const deviceMinSoc = Math.max(...heads.map(head => head.minSoc));
    const deviceMaxSoc = Math.min(...heads.map(head => head.maxSoc));
    const operatorMinSoc = number(options.minSoc === undefined ? 0 : options.minSoc);
    const operatorMaxSoc = number(options.maxSoc === undefined ? 100 : options.maxSoc);
    if (operatorMinSoc === null || operatorMaxSoc === null || operatorMinSoc < 0
        || operatorMaxSoc > 100 || operatorMinSoc >= operatorMaxSoc)
        return fail('head-profile-soc-limits-invalid');
    const minSoc = Math.max(deviceMinSoc, operatorMinSoc);
    const maxSoc = Math.min(deviceMaxSoc, operatorMaxSoc);
    if (minSoc >= maxSoc) return fail('head-profile-no-shared-soc-interval');
    const sourceTsMin = Math.min(...heads.map(head => head.sourceTs));
    const sourceTsMax = Math.max(...heads.map(head => head.sourceTs));
    const sourceSkewMs = sourceTsMax - sourceTsMin;
    if (options.maxSourceSkewMs !== undefined && (number(options.maxSourceSkewMs) === null
        || options.maxSourceSkewMs < 0 || sourceSkewMs > options.maxSourceSkewMs))
        return fail('head-profile-source-skew-invalid');
    const deviceMaxChargeW = limits.reduce((sum, head) => sum + head.maxChargeW, 0);
    const deviceMaxDischargeW = limits.reduce((sum, head) => sum + head.maxDischargeW, 0);
    const operatorChargeW = number(options.maxChargeW === undefined ? deviceMaxChargeW : options.maxChargeW);
    const operatorDischargeW = number(options.maxDischargeW === undefined ? deviceMaxDischargeW : options.maxDischargeW);
    if (operatorChargeW === null || operatorDischargeW === null || operatorChargeW < 0 || operatorDischargeW < 0)
        return fail('head-profile-power-limits-invalid');
    const packs = heads.reduce((sum, head) => sum + head.packs, 0);
    let capacityKWh = null;
    let capacityReason;
    if (capacitySource === 'sunenergy-packs') {
        const packCapacityKWh = number(options.packCapacityKWh);
        if (packCapacityKWh !== null && packCapacityKWh > 0
            && Number.isFinite(packs * packCapacityKWh)) {
            capacityKWh = packs * packCapacityKWh;
            capacityReason = 'online-packs-times-explicit-pack-capacity';
        } else capacityReason = 'online-pack-capacity-unknown';
    } else if (capacitySource === 'manual') {
        const manualCapacityKWh = number(options.manualCapacityKWh);
        if (manualCapacityKWh !== null && manualCapacityKWh > 0) {
            capacityKWh = manualCapacityKWh;
            capacityReason = 'manual-system-capacity';
        } else capacityReason = 'manual-system-capacity-unknown';
    } else capacityReason = 'head-profile-capacity-source-invalid';
    const reason = capacityKWh === null ? 'fresh-head-profile-capacity-unknown' : 'fresh-head-profile';
    return {valid: true, reason, status: reason,
        soc: heads.reduce((sum, head) => sum + head.packs * head.soc, 0) / packs,
        actualW: heads.reduce((sum, head) => sum + head.acPowerW, 0), packs,
        deviceMinSoc, deviceMaxSoc, minSoc, maxSoc, deviceMaxChargeW, deviceMaxDischargeW,
        maxChargeW: Math.min(deviceMaxChargeW, operatorChargeW),
        maxDischargeW: Math.min(deviceMaxDischargeW, operatorDischargeW),
        sourceTs: sourceTsMin, oldestSourceTs: sourceTsMin, newestSourceTs: sourceTsMax,
        sourceTsMin, sourceTsMax, sourceAgeMsMax: Math.max(...heads.map(head => head.sourceAgeMs)),
        sourceSkewMs, headLimits: limits.sort((a, b) => a.index - b.index), capacitySource,
        capacityValid: capacityKWh !== null, capacityKWh, capacityReason};
}

function allocate(totalInternalW, heads, options = {}) {
    const requestedW = number(totalInternalW);
    const minSoc = number(options.minSoc === undefined ? 0 : options.minSoc);
    const maxSoc = number(options.maxSoc === undefined ? 100 : options.maxSoc);
    const priceFloor = number(options.priceFloor === undefined ? minSoc : options.priceFloor);
    const maxChargeW = number(options.maxChargeW === undefined ? 7200 : options.maxChargeW);
    const maxDischargeW = number(options.maxDischargeW === undefined ? 7200 : options.maxDischargeW);
    const fail = reason => ({valid: false, reason, targetW: requestedW, acceptedW: 0,
        unallocatedW: requestedW, commands: [], capacitySoc: null});
    if (requestedW === null || !Array.isArray(heads) || heads.length < 1 || heads.length > 3
        || minSoc === null || maxSoc === null || priceFloor === null || minSoc < 0
        || maxSoc > 100 || minSoc >= maxSoc || priceFloor < minSoc || priceFloor > 100
        || maxChargeW === null || maxDischargeW === null || maxChargeW < 0 || maxDischargeW < 0)
        return fail('invalid-allocation-request');
    const indexes = new Set();
    for (const head of heads) {
        if (!head || head.valid !== true || !Number.isInteger(head.index) || head.index < 1
            || head.index > 3 || indexes.has(head.index) || number(head.soc) === null
            || head.soc < 0 || head.soc > 100 || !Number.isInteger(head.packs) || head.packs < 1
            || head.packs > 6 || number(head.minSoc) === null || number(head.maxSoc) === null
            || head.minSoc < 0 || head.minSoc >= head.maxSoc || head.maxSoc > 100
            || number(head.maxChargeW) === null || number(head.maxDischargeW) === null
            || head.maxChargeW < 0 || head.maxDischargeW < 0 || head.maxChargeW > 2400
            || head.maxDischargeW > 2400) return fail('configured-head-unknown-or-invalid');
        indexes.add(head.index);
    }
    const capacity = heads.reduce((sum, head) => sum + head.packs, 0);
    const capacitySoc = heads.reduce((sum, head) => sum + head.packs * head.soc, 0) / capacity;
    const charging = requestedW > 0;
    const sign = charging ? 1 : requestedW < 0 ? -1 : 0;
    const budget = Math.floor(Math.min(Math.abs(requestedW), charging ? maxChargeW : maxDischargeW));
    const commands = heads.map(head => {
        const floor = Math.max(minSoc, head.minSoc, priceFloor);
        const ceiling = Math.min(maxSoc, head.maxSoc);
        const lower = number(head.minPackSoc) === null ? head.soc : head.minPackSoc;
        const upper = number(head.maxPackSoc) === null ? head.soc : head.maxPackSoc;
        const headroom = charging ? ceiling - upper : lower - floor;
        const hysteresis = charging ? number(head.hysteresisCharge) || 0 : number(head.hysteresisDischarge) || 0;
        const resuming = isResuming(charging ? options.resumingCharge : options.resumingDischarge, head.index);
        const socLimited = headroom <= 0 || resuming && headroom <= hysteresis;
        return {index: head.index, internalW: 0, gsW: 0,
            limitW: socLimited ? 0 : Math.floor(charging ? head.maxChargeW : head.maxDischargeW),
            weight: socLimited ? 0 : head.packs * Math.max(0, charging ? ceiling - head.soc : head.soc - floor),
            socLimited, minSoc: floor, maxSoc: ceiling, exactW: 0};
    });
    // Weighted water filling: saturate limited heads, then redistribute only the
    // remaining budget. Capacity weighting equalises the SoC rate at equal SoC;
    // distance weighting brings lower/higher SoC heads toward their neighbours.
    let remaining = budget;
    let eligible = commands.filter(head => head.limitW > 0 && head.weight > 0);
    while (remaining > 0 && eligible.length) {
        const weight = eligible.reduce((sum, head) => sum + head.weight, 0);
        const saturated = eligible.filter(head => remaining * head.weight / weight >= head.limitW);
        if (!saturated.length) {
            for (const head of eligible) head.exactW = remaining * head.weight / weight;
            remaining = 0;
        } else {
            for (const head of saturated) { head.exactW = head.limitW; remaining -= head.limitW; }
            eligible = eligible.filter(head => !saturated.includes(head));
        }
    }
    let allocated = 0;
    for (const head of commands) { head.internalW = Math.floor(head.exactW); allocated += head.internalW; }
    // Largest remainders, deterministic index tie break; never round over the request.
    let rest = Math.floor(budget - remaining) - allocated;
    for (const head of [...commands].sort((a, b) => b.exactW % 1 - a.exactW % 1 || a.index - b.index)) {
        if (rest <= 0) break;
        if (head.internalW < head.limitW && head.weight > 0) { head.internalW++; rest--; }
    }
    for (const head of commands) {
        head.internalW = head.internalW === 0 ? 0 : head.internalW * sign;
        head.gsW = head.internalW === 0 ? 0 : -head.internalW;
        delete head.exactW;
    }
    const acceptedW = commands.reduce((sum, head) => sum + head.internalW, 0);
    return {valid: true, reason: acceptedW === requestedW ? 'allocated' : 'bounded-allocation',
        targetW: requestedW, acceptedW, unallocatedW: requestedW - acceptedW, commands, capacitySoc};
}

module.exports = {readTopology, parseHeadSnapshot, deviceProfile, allocate};
