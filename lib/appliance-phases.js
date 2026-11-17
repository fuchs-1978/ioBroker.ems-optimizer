'use strict';

const {createHash} = require('node:crypto');
const {adapterTimers} = require('./adapter-timers');
const {powerInWatts} = require('./device-programs');
const {parseHeadSnapshot} = require('./sunenergy-heads');

const MIN_STEP_W = 120;
const MAX_AGE_MS = 45000;
const SETTLE_MS = 5000;
const WINDOW_MS = 8000;
const MAX_EVENT_MS = 120000;
const EVIDENCE_AGE_MS = 30 * 86400000;

function applianceRows(config) {
    return [...(Array.isArray(config.devicePrograms) ? config.devicePrograms : []),
        ...(Array.isArray(config.deviceSetpoints) ? config.deviceSetpoints : [])];
}

function appliancePowerSourceIds(config) {
    if (config.appliancePhaseLearningEnabled === false) return [];
    return [...new Set(applianceRows(config).map(row => String(row.powerObject || '').trim()).filter(Boolean))];
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function spread(values) { return Math.max(...values) - Math.min(...values); }

function plateau(rows) {
    return rows.length >= 3 && rows.at(-1).at - rows[0].at >= WINDOW_MS
        && new Set(rows.map(row => row.deviceAt)).size >= 3;
}

function trimWindow(rows) {
    while (rows.length > 3 && rows.at(-1).at - rows[1].at >= WINDOW_MS) rows.shift();
    return rows.slice(-64);
}

// Only measured changes count. Matching plateaus must bracket a settled load
// change, with an unchanged set of separately metered generators and consumers.
function evaluateTransition(before, after, trace) {
    const fail = reason => ({reason});
    if (!plateau(before) || !plateau(after)) return fail('Zu wenige unabhängige Messungen');
    const deviceDeltaW = median(after.map(r => r.deviceW)) - median(before.map(r => r.deviceW));
    const size = Math.abs(deviceDeltaW);
    if (size < MIN_STEP_W) return fail('Leistungsänderung zu klein');
    const tolerance = Math.max(35, size * 0.12), otherTolerance = Math.max(35, Math.min(100, size * 0.08));
    const stable = rows => spread(rows.map(r => r.deviceW)) <= Math.max(20, size * 0.06)
        && [0, 1, 2].every(p => spread(rows.map(r => r.phasesW[p])) <= tolerance);
    if (!stable(before) || !stable(after)) return fail('Last oder Netzphase im Messfenster unruhig');
    const all = [...before, ...trace, ...after];
    const startW = median(before.map(r => r.deviceW));
    const transitionAt = trace.find(r => Math.abs(r.deviceW - startW) >= MIN_STEP_W)?.at ?? trace[0].at;
    const guards = before[0].guards;
    for (let i = 0; i < guards.length; i++) {
        if (all.some(row => row.guards.length !== guards.length || row.guards[i]?.id !== guards[i].id)
            || spread(all.map(row => row.guards[i].watts)) > 30)
            return fail('Speicher, Erzeugung oder anderer gemessener Verbraucher verändert');
        if (!after.some(row => row.guards[i].at >= transitionAt + SETTLE_MS))
            return fail('Rückmeldung anderer Messquellen noch nicht erneuert');
    }
    const deltasW = [0, 1, 2].map(p => median(after.map(r => r.phasesW[p])) - median(before.map(r => r.phasesW[p])));
    const matches = deltasW.map((value, p) => Math.abs(value - deviceDeltaW) <= tolerance
        && deltasW.every((other, q) => p === q || Math.abs(other) <= otherTolerance));
    if (matches.filter(Boolean).length !== 1) return fail('Keine eindeutige Netzphase; Messung verworfen');
    const phase = matches.indexOf(true);
    // Transient changes on the other phases also invalidate an apparently clean
    // endpoint comparison. The candidate phase may move only between its plateaus.
    for (let p = 0; p < 3; p++) {
        const low = median(before.map(r => r.phasesW[p])), high = low + deltasW[p];
        if (trace.some(row => row.phasesW[p] < Math.min(low, high) - otherTolerance
            || row.phasesW[p] > Math.max(low, high) + otherTolerance))
            return fail('Zusätzlicher Lastwechsel während der Messung');
    }
    return {phase: phase + 1, deviceDeltaW, deltasW, at: after.at(-1).at};
}

class PhaseLearner {
    constructor(saved = {}, now = Date.now()) {
        this.votes = (Array.isArray(saved.votes) ? saved.votes : []).filter(v =>
            [1, 2, 3].includes(v.phase) && Number.isFinite(v.deviceDeltaW) && Math.abs(v.deviceDeltaW) >= MIN_STEP_W
            && Array.isArray(v.deltasW) && v.deltasW.length === 3 && v.deltasW.every(Number.isFinite)
            && Number.isFinite(v.at) && v.at <= now && now - v.at <= EVIDENCE_AGE_MS).slice(-9);
        this.phase = this.confirmedPhase();
        this.status = 'Warte auf einen ausreichend großen Lastwechsel';
        this.before = [];
        this.pending = null;
        this.recent = [];
        this.lastDeviceAt = 0;
        this.lastGridAt = 0;
        this.lastObservedAt = 0;
    }

    confirmedPhase() {
        const latest = this.votes.at(-1);
        if (!latest) return 0;
        const streak = [];
        for (const vote of [...this.votes].reverse()) {
            if (vote.phase !== latest.phase) break;
            streak.push(vote);
        }
        return streak.length >= 3 && streak.some(v => v.deviceDeltaW > 0) && streak.some(v => v.deviceDeltaW < 0)
            ? latest.phase : 0;
    }

    interrupt(reason) {
        this.before = [];
        this.pending = null;
        this.recent = [];
        this.status = reason;
    }

    observe(frame) {
        if (frame.at < this.lastObservedAt || frame.gridAt < this.lastGridAt || frame.deviceAt < this.lastDeviceAt) {
            this.interrupt('Zeitstempel rückläufig; neue Ausgangsmessung erforderlich');
            return;
        }
        this.lastObservedAt = frame.at;
        if (frame.gridAt === this.lastGridAt) return;
        this.lastGridAt = frame.gridAt;
        this.recent.push(frame);
        this.recent = this.recent.filter(r => frame.at - r.at <= MAX_EVENT_MS).slice(-240);
        if (this.pending) this.pending.trace.push(frame);
        // A held Tapo value is not another independent measurement. The grid
        // continues to be observed between Tapo publications to catch interference.
        if (frame.deviceAt === this.lastDeviceAt || !frame.aligned) return;
        this.lastDeviceAt = frame.deviceAt;
        if (this.before.length && frame.at - this.before.at(-1).at > MAX_AGE_MS) this.before = [];
        if (this.pending) {
            const pending = this.pending;
            if (frame.at - pending.at > MAX_EVENT_MS) {
                this.interrupt('Lastwechsel nicht rechtzeitig stabil messbar');
            } else if (Math.abs(frame.deviceW - pending.targetW) > Math.max(20, Math.abs(pending.deltaW) * 0.06)) {
                this.interrupt('Geräteleistung während des Lastwechsels verändert');
            } else if (frame.at >= pending.at + SETTLE_MS) {
                pending.after.push(frame);
                pending.after = trimWindow(pending.after);
                if (plateau(pending.after)) {
                    const result = evaluateTransition(pending.before, pending.after, pending.trace);
                    if (result.phase) {
                        const previous = this.phase;
                        this.votes = [...this.votes, result].slice(-9);
                        this.phase = this.confirmedPhase();
                        this.status = previous && !this.phase ? 'Widersprüchlicher Lastwechsel; Zuordnung aufgehoben'
                            : this.phase ? `L${this.phase} aus wiederholten Lastwechseln erkannt`
                                : `Hinweis auf L${result.phase}; weitere Ein- und Ausschaltvorgänge erforderlich`;
                    } else this.status = result.reason;
                    this.before = pending.after;
                    this.pending = null;
                    this.recent = [...this.before];
                }
            }
            return;
        }
        const baseline = this.before.length ? median(this.before.map(r => r.deviceW)) : frame.deviceW;
        const deltaW = frame.deviceW - baseline;
        if (plateau(this.before) && Math.abs(deltaW) >= MIN_STEP_W) {
            this.pending = {at: frame.at, targetW: frame.deviceW, deltaW,
                before: this.before, after: [], trace: this.recent.filter(r => r.at >= this.before.at(-1).at)};
            this.status = 'Lastwechsel erkannt; Messfenster wird geprüft';
        } else {
            if (Math.abs(deltaW) > Math.max(20, Math.abs(baseline) * 0.03)) this.before = [];
            this.before.push(frame);
            this.before = trimWindow(this.before);
        }
    }

    result() { return {phase: this.phase, status: this.status, observations: this.votes.length, votes: this.votes}; }
}

function guardSources(config, mapping) {
    const sources = [];
    const add = (key, id, unit = 'W') => sources.push({key, id: String(id || '').trim(), unit});
    if (mapping.DP_PV_POWER) add('PV', mapping.DP_PV_POWER);
    if (config.bhkwPresent !== false && mapping.DP_BHKW_POWER) add('BHKW', mapping.DP_BHKW_POWER);
    if (config.batteryPresent === true) {
        if (config.batteryDispatchMode === 'sunenergy-heads') {
            const instance = String(config.batterySunEnergyInstance || 'sunenergyxt500.0');
            const count = Number(config.batteryHeadCount ?? 1);
            if (!/^sunenergyxt500\.\d+$/.test(instance) || !Number.isInteger(count) || count < 1 || count > 3)
                add('Speichertopologie ungültig', '');
            else for (let i = 1; i <= count; i++) sources.push({key: `Speicher ${i}`,
                id: `${instance}.heads.${i}.info.rawResponse`, headIndex: i,
                onlineId: `${instance}.heads.${i}.info.online`});
        } else add('Speicher', mapping.DP_BATTERY_AC_POWER || mapping.DP_BATTERY_POWER);
    }
    for (let wb = 0; wb < 3; wb++) if (config[`wb${wb}Present`] === true)
        add(`Wallbox ${wb}`, mapping[`DP_WB${wb}_POWER`], 'kW');
    for (const [present, prefix, fallback] of [[config.dhwPresent, 'DP_DHW', 'DP_DHW_POWER1'],
        [config.heatingPresent, 'DP_HEAT', 'DP_HEAT_POWER1']]) {
        if (present !== true) continue;
        const outputs = [1, 2, 3].map(p => mapping[`${prefix}_OUTPUT${p}`]);
        if (outputs.every(Boolean)) outputs.forEach((id, p) => add(`${prefix} ${p + 1}`, id));
        else add(prefix, mapping[fallback]);
    }
    if (config.heatPumpPresent === true) add('Wärmepumpe', mapping.DP_HEAT_PUMP_POWER, config.heatPumpPowerUnit || 'kW');
    return sources;
}

function numericState(state, now, ageMs, unit = 'W', nonnegative = false, allowCalculated = false) {
    const watts = powerInWatts(state?.val, unit);
    return (state?.ack === true || allowCalculated && state?.ack === false) && !state.q
        && watts !== null && (!nonnegative || watts >= 0)
        && Number.isFinite(state.ts) && state.ts > 0 && state.ts <= now && now - state.ts <= ageMs
        ? {watts, at: state.ts} : null;
}

class AppliancePhases {
    constructor(adapter, {now = () => Date.now()} = {}) {
        this.adapter = adapter;
        this.now = now;
        this.devices = [];
        this.lastPublished = new Map();
        this.enabled = adapter.config.appliancePhaseLearningEnabled !== false;
    }

    async initialize() {
        const {adapter} = this;
        this.enabled = adapter.config.appliancePhaseLearningEnabled !== false;
        const mapping = adapter.readMapping();
        this.boundary = [1, 2, 3].flatMap(p => [mapping[`DP_HA_L${p}_IMPORT_W`], mapping[`DP_HA_L${p}_EXPORT_W`]]);
        this.guards = guardSources(adapter.config, mapping);
        const bhkw = this.guards.find(source => source.key === 'BHKW');
        if (bhkw) bhkw.unit = adapter.bhkwSourceUnits?.get(bhkw.id) || bhkw.unit;
        const pv = this.guards.find(source => source.key === 'PV');
        if (pv) {
            // Script-produced sums may publish ack=false. Accept that only as
            // interference telemetry for a declared read-only numeric PV value,
            // never as appliance power proof or a writable output acknowledgement.
            try {
                const object = await adapter.getForeignObjectAsync?.(pv.id);
                const common = object?.common;
                pv.allowCalculated = common?.type === 'number' && common.write !== true
                    && common.read !== false && /^value(?:\.|$)/.test(common.role || '')
                    && common.unit === 'W';
            } catch { pv.allowCalculated = false; }
        }
        const byMeter = new Map();
        for (const row of applianceRows(adapter.config)) {
            const powerObject = String(row.powerObject || '').trim(), powerUnit = row.powerUnit || 'W';
            if (!powerObject) continue;
            const identity = JSON.stringify([powerObject, powerUnit, this.boundary]);
            const existing = byMeter.get(identity);
            if (existing) { existing.names.push(row.name || powerObject); continue; }
            const key = createHash('sha256').update(identity).digest('hex').slice(0, 24);
            const device = {key, identity, powerObject, powerUnit, names: [row.name || powerObject]};
            const saved = await adapter.getStateAsync(`Devices.Phases.${key}.Evidence_JSON`);
            let evidence;
            try { evidence = JSON.parse(saved?.val); } catch { /* A missing or invalid record starts without evidence. */ }
            device.learner = new PhaseLearner(evidence?.identity === identity ? evidence : {}, this.now());
            byMeter.set(identity, device);
        }
        this.devices = [...byMeter.values()];
        const unitsByMeter = new Map();
        for (const device of this.devices) {
            const units = unitsByMeter.get(device.powerObject) || new Set();
            units.add(device.powerUnit); unitsByMeter.set(device.powerObject, units);
        }
        for (const device of this.devices) device.unitConflict = unitsByMeter.get(device.powerObject).size > 1;
        await adapter.setObjectNotExistsAsync('Devices.Phases', {type: 'channel', common: {name: 'Appliance grid phases'}, native: {}});
        for (const device of this.devices) {
            await adapter.setObjectNotExistsAsync(`Devices.Phases.${device.key}`, {
                type: 'channel', common: {name: device.names.join(' / ')}, native: {powerObject: device.powerObject, powerUnit: device.powerUnit}
            });
        }
        await this.tick();
    }

    resultFor(powerObject, powerUnit = 'W') {
        const device = this.devices.find(d => d.powerObject === powerObject && d.powerUnit === (powerUnit || 'W'));
        const result = device?.learner.result();
        return result ? {gridPhase: this.enabled && !device.unitConflict ? result.phase : 0,
            phaseStatus: result.status, phaseEvidenceId: `Devices.Phases.${device.key}.Evidence_JSON`} : {gridPhase: 0};
    }

    readFrame(device, now) {
        const read = (id, age, unit = 'W', positive = false, allowCalculated = false) => id
            ? numericState(this.adapter.getCachedState(id), now, age, unit, positive, allowCalculated) : null;
        if (device.unitConflict) return {reason: 'Widersprüchliche Einheiten für denselben Leistungsmesspunkt'};
        if (this.boundary.some(id => !id) || new Set(this.boundary).size !== 6)
            return {reason: 'Sechs eindeutige Bezugs-/Einspeisemesspunkte für L1–L3 erforderlich'};
        if (this.boundary.includes(device.powerObject) || this.guards.some(g => g.id === device.powerObject))
            return {reason: 'Gerätemesspunkt darf kein Netz- oder Anlagenmesspunkt sein'};
        const phaseReads = this.boundary.map(id => read(id, 15000, 'W', true));
        if (phaseReads.some(r => !r)) return {reason: 'Netzphasenwerte fehlen oder sind veraltet'};
        const gridAt = Math.min(...phaseReads.map(r => r.at));
        if (Math.max(...phaseReads.map(r => r.at)) - gridAt > 2000)
            return {reason: 'Netzphasenwerte zeitlich nicht synchron'};
        const own = read(device.powerObject, MAX_AGE_MS, device.powerUnit, true);
        if (!own) return {reason: 'Geräteleistung fehlt, ist ungültig oder veraltet'};
        const guards = [];
        const peers = this.devices.filter(d => d.powerObject !== device.powerObject)
            .map(d => ({key: d.names.join(' / '), id: d.powerObject, unit: d.powerUnit}));
        for (const source of [...this.guards, ...peers]) {
            let value;
            if (source.headIndex) {
                const snapshot = parseHeadSnapshot(this.adapter.getCachedState(source.id), {
                    now, maxAgeMs: MAX_AGE_MS, index: source.headIndex,
                    onlineState: this.adapter.getCachedState(source.onlineId) || null
                });
                value = snapshot.valid ? {watts: snapshot.acPowerW, at: snapshot.sourceTs} : null;
            } else value = read(source.id, MAX_AGE_MS, source.unit, false, source.allowCalculated);
            if (!value) return {reason: `Frischer Messwert fehlt: ${source.key}`};
            guards.push({id: `${source.key}:${source.id}`, ...value});
        }
        const test = this.adapter.getCachedState(`${this.adapter.namespace}.Control.PhaseTest_JSON`);
        let active;
        try { active = JSON.parse(test?.val); } catch { /* No active test. */ }
        if (active?.stage && !['idle', 'complete', 'failed'].includes(active.stage))
            return {reason: 'Aktiver Phasentest; passive Messung pausiert'};
        return {at: now, gridAt, deviceAt: own.at, deviceW: own.watts,
            aligned: Math.abs(gridAt - own.at) <= SETTLE_MS,
            phasesW: [0, 1, 2].map(p => phaseReads[p * 2].watts - phaseReads[p * 2 + 1].watts), guards};
    }

    async publish(id, value, type = 'string', role = 'text') {
        if (this.adapter.unloading || this.lastPublished.get(id) === value) return;
        await this.adapter.setObjectNotExistsAsync(id, {
            type: 'state', common: {name: id.split('.').at(-1), type, role, read: true, write: false}, native: {}
        });
        if (this.adapter.unloading) return;
        await this.adapter.setStateAsync(id, value, true);
        this.lastPublished.set(id, value);
    }

    async tick() {
        const {adapter} = this;
        if (adapter.unloading) return;
        try {
            const now = this.now(), lines = [];
            for (const device of this.devices) {
                if (!this.enabled) device.learner.interrupt('Automatische Phasenerkennung ausgeschaltet');
                else {
                    const frame = this.readFrame(device, now);
                    if (frame.reason) device.learner.interrupt(frame.reason);
                    else device.learner.observe(frame);
                }
                const result = this.resultFor(device.powerObject, device.powerUnit);
                const evidence = {...device.learner.result(), identity: device.identity,
                    name: device.names.join(' / '), powerObject: device.powerObject, powerUnit: device.powerUnit,
                    boundary: this.boundary};
                const base = `Devices.Phases.${device.key}`;
                await this.publish(`${base}.GridPhase`, result.gridPhase, 'number', 'value');
                await this.publish(`${base}.Status`, result.phaseStatus);
                await this.publish(`${base}.Evidence_JSON`, JSON.stringify(evidence), 'string', 'json');
                lines.push(`${device.names.join(' / ')}: ${result.gridPhase ? `L${result.gridPhase}` : 'unbekannt'} – ${result.phaseStatus}`);
            }
            for (const row of applianceRows(adapter.config).filter(r => !String(r.powerObject || '').trim()))
                lines.push(`${row.name || 'Gerät'}: unbekannt – Leistungsmesspunkt fehlt`);
            await this.publish('Devices.Phases.Summary', lines.join('\n') || 'Keine gemessenen Hausgeräte eingerichtet');
        } catch (error) { adapter.log.warn(`Appliance phase learning: ${error.message}`); }
        finally {
            if (!adapter.unloading && this.enabled && this.devices.length)
                adapterTimers(adapter).setTimeout(() => void this.tick(), 1000);
        }
    }
}

module.exports = {AppliancePhases, PhaseLearner, appliancePowerSourceIds, evaluateTransition, numericState};
