'use strict';

const {randomUUID} = require('node:crypto');
const {houseConnectionSettings} = require('./native-mapping');

const MAX_EVENTS = 100;
const MAX_TRACE = 120;
const TRACE_INTERVAL_MS = 10000;
// Covers the worst case of our own bounded strings and 120 trace contexts.
const MAX_RESTORE_BYTES = 2 * 1024 * 1024;
const TEXT_LIMIT = 600;
const DISCRETE = [
    'System.Mode', 'System.RealOutputsEnabled', 'System.DataValid', 'Control.Enabled',
    'Control.Mode', 'Control.Valid', 'Control.SelectedWallbox', 'Control.RestartHandoffActive',
    'Control.ParallelDistributionActive', 'Control.ParallelDistributionReleased',
    'Control.GridOperatorLimitActive', 'Plan.Valid', 'History.Ready', 'History.Building',
    ...[0, 1, 2].flatMap(wb => [
        ...['Present', 'ControlEnabled', 'OutputActive', 'OutputOwned', 'OutputFault',
            'StopDelayActive', 'ConfirmedPhases', 'PhaseTransitionActive', 'LastStopAt']
            .map(key => `Devices.Wallbox${wb}.${key}`),
        ...['Connected', 'SoCValid', 'UserRelease', 'Release', 'MustCharge',
            'StartDelayActive', 'MinimumRunTimeActive', 'DetectedPhases']
            .map(key => `Vehicles.Wallbox${wb}.${key}`)
    ]),
    ...['Present', 'ControlEnabled', 'Release', 'OutputActive', 'OutputOwned', 'TemperatureLock']
        .map(key => `Devices.MyPV_DHW.${key}`)
];
const DISCRETE_SET = new Set(DISCRETE);
const REASONS = ['Control.Status', 'Control.GridOperatorStatus', 'History.Status',
    ...[0, 1, 2].map(wb => `Devices.Wallbox${wb}.OutputStatus`),
    'Devices.MyPV_DHW.OutputStatus', 'Devices.MyPV_DHW.ControlReason'];

function scalar(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    return typeof value === 'string' ? value.slice(0, TEXT_LIMIT) : null;
}
function number(value) {
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function stamp(ts) { return {ts, timestamp: new Date(ts).toISOString()}; }
function stableReason(value) {
    // Preserve identities such as WB2, Wallbox1 and phase1, while ignoring
    // continuously changing watts, amps and countdowns in the same reason.
    return typeof value === 'string' ? value.replace(/(?<![\p{L}\d_])[+-]?\d+(?:[.,]\d+)?/gu, '#') : value;
}
function selected(value) { return [-1, 0, 1, 2].includes(value) ? value : null; }
function copyFields(source, keys) {
    return Object.fromEntries(keys.map(key => [key, scalar(source?.[key])]));
}

/** A read-only flight recorder. Scheduling and actuator ownership stay outside. */
class DebugRecorder {
    constructor(adapter) {
        this.adapter = adapter;
        this.session = randomUUID();
        this.initialized = false;
        this.enabled = true;
        this.stopped = false;
        this.events = [];
        this.trace = [];
        this.eventCount = 0;
        this.lastTraceAt = null;
        this.observed = new Map();
        this.writing = new Map();
        this.latest = new Map();
        this.lastPublished = new Map();
        this.warningAt = null;
        this.pendingEHZStop = null;
    }

    warn() {
        const now = Date.now();
        if (this.warningAt !== null && now - this.warningAt < 60000) return;
        this.warningAt = now;
        try { this.adapter.log?.warn('EMS-Debug: Diagnose konnte nicht vollstaendig aktualisiert werden; Regelung bleibt unabhaengig.'); }
        catch { /* Diagnostics must not affect control, including a failing logger. */ }
    }

    guard(callback, fallback = undefined) {
        try { return callback(); } catch { this.warn(); return fallback; }
    }

    state(id) { return this.adapter.getCachedState(id) || null; }
    own(id) { return scalar(this.state(`${this.adapter.namespace}.${id}`)?.val); }

    publish(key, value) {
        // At most one running write plus one replacement per state. A slow DB
        // cannot create an unbounded chain of snapshots in the control process.
        if (this.writing.has(key)) { this.latest.set(key, value); return; }
        // The user may have issued another ack=false command while a previous
        // equal-valued acknowledgement was still in flight. Compare the live
        // cache as well, including ACK, before discarding that queued reply.
        if (this.lastPublished.get(key) === value && this.guard(() => {
            const current = this.state(`${this.adapter.namespace}.Debug.${key}`);
            return current?.val === value && current.ack === true;
        }, false)) return;
        this.guard(() => {
            const pending = Promise.resolve(this.adapter.setCompatState(
                `${this.adapter.namespace}.Debug.${key}`, value, true));
            this.writing.set(key, pending);
            void pending.then(() => this.lastPublished.set(key, value), () => this.warn())
                .then(() => {
                    this.writing.delete(key);
                    if (this.latest.has(key)) {
                        const latest = this.latest.get(key);
                        this.latest.delete(key);
                        this.publish(key, latest);
                    }
                }).catch(() => this.warn());
        });
    }

    async initialize() {
        try {
            const definitions = {
                Enabled: [true, 'switch.enable', 'Debug-Aufzeichnung aktivieren', true],
                Clear: [false, 'button', 'Nur Debug-Ereignisse und Leistungsverlauf loeschen', true],
                Summary: ['', 'text', 'Aktuelle EMS-Kurzdiagnose'],
                Snapshot_JSON: ['{}', 'json', 'Aktueller Diagnosezustand mit Messwertqualitaet'],
                Events_JSON: ['[]', 'json', 'Letzte 100 Zustandswechsel, aelteste zuerst'],
                PowerTrace_JSON: ['[]', 'json', 'Bis zu 20 Minuten Leistungsverlauf im 10-s-Raster'],
                LastEvent: ['', 'text', 'Letzter aufgezeichneter Zustandswechsel'],
                LastUpdate: [0, 'value.time', 'Zeitpunkt des letzten Diagnose-Snapshots'],
                EventCount: [0, 'value', 'Ereignisse seit letztem Loeschen, inklusive Ringueberlauf'],
                ...Object.fromEntries([0, 1, 2].map(wb => [`Wallbox${wb}.Summary`, ['', 'text', `Kurzdiagnose WB${wb}`]])),
                'EHZ.Summary': ['', 'text', 'Kurzdiagnose Trinkwasser-EHZ']
            };
            await Promise.all(Object.entries(definitions).map(([id, [initial, role, name, write]]) =>
                this.adapter.queueCompatState(`${this.adapter.namespace}.Debug.${id}`, initial,
                    {type: typeof initial, role, name, write: write === true})));
            if (this.adapter.unloading || this.stopped) return;
            this.events = this.restore('Events_JSON', MAX_EVENTS, event => {
                if (!event || !Number.isFinite(event.ts) || event.ts <= 0
                    || typeof event.session !== 'string' || typeof event.type !== 'string') return null;
                return {...stamp(event.ts), session: event.session.slice(0, 80),
                    type: event.type.slice(0, 80), source: scalar(event.source),
                    from: scalar(event.from), to: scalar(event.to),
                    context: this.copyContext(event.context)};
            });
            this.trace = this.restore('PowerTrace_JSON', MAX_TRACE, item => {
                if (!item || !Number.isFinite(item.ts) || item.ts <= 0 || typeof item.session !== 'string') return null;
                return {...stamp(item.ts), session: item.session.slice(0, 80), ...this.copyContext(item)};
            });
            const count = number(this.own('Debug.EventCount'));
            this.eventCount = Math.max(this.events.length, Number.isSafeInteger(count) && count >= 0 ? count : 0);
            this.enabled = this.own('Debug.Enabled') !== false;
            this.initialized = true;
            this.publish('Clear', false);
            if (this.enabled) {
                const snapshot = this.snapshot();
                this.seedObserved();
                this.record('session.start', 'Debug', null, 'Aufzeichnung gestartet', snapshot);
                this.sample();
            } else this.publish('Summary', 'Debug-Aufzeichnung deaktiviert; vorhandene Daten bleiben erhalten.');
        } catch { this.warn(); }
    }

    restore(key, limit, transform) {
        // own() intentionally truncates diagnostic text, so read only these two
        // explicit persisted JSON states without that ordinary text limit.
        const text = this.state(`${this.adapter.namespace}.Debug.${key}`)?.val;
        if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_RESTORE_BYTES) return [];
        return this.guard(() => {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed) || parsed.length > 10000) return [];
            return parsed.slice(-limit).filter(item => JSON.stringify(item).length <= 12000)
                .map(transform).filter(Boolean).sort((a, b) => a.ts - b.ts).slice(-limit);
        }, []);
    }

    measurement(id, now, maxAgeMs = 120000, command = false, allowBoolean = false) {
        if (typeof id !== 'string' || !id.trim()) return {id: null, val: null, valid: false, reason: 'nicht konfiguriert', ack: null, q: null, ts: null, ageMs: null};
        const state = this.state(id);
        const ts = Number.isFinite(state?.ts) ? state.ts : null;
        const ageMs = ts === null ? null : now - ts;
        const val = scalar(state?.val);
        const validValue = command ? [true, false, 0, 1, '0', '1'].includes(val)
            : number(val) !== null || (allowBoolean && typeof val === 'boolean');
        const valid = Boolean(state && validValue && !state.q && ts !== null && ts > 0 && ageMs >= 0
            && (command || (state.ack === true && ageMs <= maxAgeMs)));
        return {id: id.slice(0, 512), val, valid,
            reason: !state ? 'fehlt' : !validValue ? 'Wert ungueltig' : state.q ? 'Qualitaet ungueltig'
                : ts === null || ts <= 0 || ageMs < 0 ? 'Zeitstempel ungueltig'
                    : !command && state.ack !== true ? 'nicht bestaetigt'
                        : !command && ageMs > maxAgeMs ? 'veraltet' : 'OK',
            ack: typeof state?.ack === 'boolean' ? state.ack : null, q: scalar(state?.q), ts, ageMs,
            maxAgeMs: Number.isFinite(maxAgeMs) ? maxAgeMs : null, ackRequired: !command};
    }

    snapshot() {
        const now = Date.now();
        const mapping = this.adapter.readMapping?.() || {};
        const config = this.adapter.config || {};
        const tankMaxAgeMs = Math.max(5, number(this.own('Config.DHWTemperatureMaxAge_min')) ?? 60) * 60000;
        const measurements = {
            gridImport: this.measurement(mapping.DP_GRID_IMPORT, now, 10000),
            gridExport: this.measurement(mapping.DP_GRID_EXPORT, now, 10000),
            pv: this.measurement(mapping.DP_PV_POWER, now),
            ehzOutputs: [1, 2, 3].map(i => this.measurement(config[`dhwOutput${i}Id`] || mapping[`DP_DHW_OUTPUT${i}`], now)),
            ehzTemperatures: [1, 2, 3, 4].map(i => this.measurement(mapping[`DP_DHW_TEMP${i}`], now, tankMaxAgeMs)),
            haCritical: this.measurement(mapping.DP_HA_CRITICAL, now, Infinity, false, true),
            haPhases: [1, 2, 3].map(i => ({
                import: this.measurement(mapping[`DP_HA_L${i}_IMPORT_W`], now),
                export: this.measurement(mapping[`DP_HA_L${i}_EXPORT_W`], now),
                current: this.measurement(mapping[`DP_DHW_HA_L${i}_CURRENT_A`], now)
            }))
        };
        const invalidRaw = this.state(`${this.adapter.namespace}.System.InvalidInputs_JSON`)?.val;
        const invalidInputs = typeof invalidRaw === 'string' && invalidRaw.length <= 16000
            ? this.guard(() => { const parsed = JSON.parse(invalidRaw);
                return Array.isArray(parsed) ? parsed.slice(0, 50).map(scalar) : []; }, []) : [];
        const fields = (prefix, keys) => Object.fromEntries(keys.map(key => [key, this.own(`${prefix}.${key}`)]));
        const age = id => { const ts = number(this.own(id)); return {ts, ageMs: ts !== null && ts > 0 ? now - ts : null}; };
        const wallboxes = [0, 1, 2].map(wb => {
            const d = this.adapter.wallboxOutput?.devices?.find(device => device.wb === wb);
            const deviceMaxAge = Math.max(5, number(config.wallboxMeasurementMaxAgeS) ?? 30) * 1000;
            const feedback = Object.fromEntries(['allow', 'feedback', 'connection', 'error', 'available', 'phaseMode']
                .map(key => [key, this.measurement(d?.ids?.[key] || config[`wb${wb}${{
                    allow: 'AllowOutputId', feedback: 'AmpereFeedbackId', connection: 'ConnectionId',
                    error: 'ErrorId', available: 'AvailableCurrentId', phaseMode: 'PhaseModeId'}[key]}`], now,
                ['phaseMode', 'connection'].includes(key) ? Infinity : deviceMaxAge, false, key === 'connection')]));
            const raw = {
                power: this.measurement(mapping[`DP_WB${wb}_POWER`], now, deviceMaxAge),
                soc: this.measurement(mapping[`DP_WB${wb}_SOC`], now, 7200000),
                userRelease: this.measurement(mapping[`DP_WB${wb}_ALLOW`], now, Infinity, true),
                phaseCurrents: [1, 2, 3].map(i => this.measurement(mapping[`DP_WB${wb}_L${i}_A`], now, deviceMaxAge)),
                ...feedback
            };
            raw.power.unit = 'kW';
            const vehicle = fields(`Vehicles.Wallbox${wb}`, ['Connected', 'SoC_pct', 'SoCValid', 'MinimumSoC_pct',
                'TargetSoC_pct', 'UserRelease', 'Release', 'MustCharge', 'StartDelayActive',
                'StartDelayRemaining_s', 'MinimumRunTimeActive', 'MinimumRunTimeRemaining_s',
                'DetectedPhases', 'RequestedMinimumCurrent_A', 'CurrentConstraintStatus', 'Status']);
            return {wb, selected: this.own('Control.SelectedWallbox') === wb,
                productionArmed: config[`wb${wb}ProductionArmed`] === true, ...vehicle,
                ...fields(`Devices.Wallbox${wb}`, ['Present', 'ControlEnabled', 'OutputActive', 'OutputOwned',
                    'OutputStatus', 'OutputFault', 'OutputCommand_A', 'OutputPhases', 'ConfirmedPhases',
                    'PhaseTransitionActive', 'StopDelayActive', 'StopDelayRemaining_s', 'LastStopReason', 'LastStopAt']),
                target_W: this.own(`Control.Targets.Wallbox${wb}_W`),
                target_A: this.own(`Control.Targets.Wallbox${wb}_A`),
                actual_W: raw.power.valid ? number(raw.power.val) * 1000 : null,
                pending: d?.pending ? {...copyFields(d.pending, ['stage', 'amps', 'start', 'at']),
                    ageMs: Number.isFinite(d.pending.at) ? now - d.pending.at : null} : null,
                stopPending: Boolean(d?.stopRequest), recovering: d?.recovering === true, measurements: raw};
        });
        const ehz = {...fields('Devices.MyPV_DHW', ['Present', 'ControlEnabled', 'Release', 'OutputActive',
            'OutputOwned', 'OutputCommand_W', 'OutputStatus', 'ControlReason', 'ActuatorSettled',
            'ActuatorDifference_W', 'CommandAge_s', 'EffectiveStep_W', 'TemperatureLock',
            'TemperaturePowerLimit_W', 'BottomTemperature_C', 'TopTemperature_C', 'ActualPower_W']),
        target_W: this.own('Control.Targets.MyPV_DHW_W'),
        actual_W: measurements.ehzOutputs.every(m => m.valid)
            ? measurements.ehzOutputs.reduce((sum, m) => sum + number(m.val), 0) : null};
        const grid_W = measurements.gridImport.valid && measurements.gridExport.valid
            ? number(measurements.gridImport.val) - number(measurements.gridExport.val) : null;
        return {schemaVersion: 1, ...stamp(now), session: this.session,
            note: 'Cache-Snapshot zum Aufnahmezeitpunkt; asynchrone Quellen koennen unterschiedliche Zeitstempel haben.',
            system: {...fields('System', ['Mode', 'RealOutputsEnabled', 'DataValid']), invalidInputs,
                nativeGlobalWriteEnabled: config.globalWriteEnabled === true},
            control: fields('Control', ['Enabled', 'Mode', 'Valid', 'Status', 'SelectedWallbox',
                'RestartHandoffActive', 'ParallelDistributionActive', 'ParallelDistributionReleased',
                'GridOperatorLimitActive', 'GridOperatorBudget_W', 'GridOperatorStatus', 'TargetGridPower_W']),
            plan: {...fields('Plan', ['Valid']), ...age('Plan.LastUpdate')},
            history: {...fields('History', ['Ready', 'Building', 'Status']), ...age('History.LastBuild')},
            freshness: {system: age('System.LastUpdate'), control: age('Control.LastUpdate')},
            power: {grid_W, pv_W: measurements.pv.valid ? number(measurements.pv.val) : null,
                observerGrid_W: this.own('Actual.GridPower_W'), observerEHZ_W: this.own('Actual.MyPV_DHW_W')},
            wallboxes, ehz, measurements, houseConnection: houseConnectionSettings(config)};
    }

    context(snapshot) {
        return {selectedWallbox: selected(snapshot.control.SelectedWallbox),
            realOutputsEnabled: snapshot.system.RealOutputsEnabled, dataValid: snapshot.system.DataValid,
            planValid: snapshot.plan.Valid, grid_W: snapshot.power.grid_W, pv_W: snapshot.power.pv_W,
            wallboxes: snapshot.wallboxes.map(w => ({wb: w.wb, actual_W: w.actual_W, target_W: w.target_W,
                command_A: w.OutputCommand_A, active: w.OutputActive, owned: w.OutputOwned,
                status: w.OutputStatus, fault: w.OutputFault, startDelay_s: w.StartDelayRemaining_s,
                minimumRun_s: w.MinimumRunTimeRemaining_s, stopDelay_s: w.StopDelayRemaining_s})),
            ehz: {actual_W: snapshot.ehz.actual_W, target_W: snapshot.ehz.target_W,
                command_W: snapshot.ehz.OutputCommand_W, active: snapshot.ehz.OutputActive,
                owned: snapshot.ehz.OutputOwned, status: snapshot.ehz.OutputStatus}};
    }

    copyContext(value) {
        return {...copyFields(value, ['selectedWallbox', 'realOutputsEnabled', 'dataValid', 'planValid', 'grid_W', 'pv_W']),
            wallboxes: Array.isArray(value?.wallboxes) ? value.wallboxes.slice(0, 3).map(w => copyFields(w,
                ['wb', 'actual_W', 'target_W', 'command_A', 'active', 'owned', 'status', 'fault', 'startDelay_s', 'minimumRun_s', 'stopDelay_s'])) : [],
            ehz: copyFields(value?.ehz, ['actual_W', 'target_W', 'command_W', 'active', 'owned', 'status'])};
    }

    seedObserved() {
        for (const id of DISCRETE) this.observed.set(id, this.own(id));
        for (const id of REASONS) this.observed.set(id, stableReason(this.own(id)));
    }

    record(type, source, from, to, snapshot) {
        this.events.push({...stamp(snapshot.ts), session: this.session, type,
            source: scalar(source), from: scalar(from), to: scalar(to), context: this.context(snapshot)});
        if (this.events.length > MAX_EVENTS) this.events.shift();
        this.eventCount = Math.min(Number.MAX_SAFE_INTEGER, this.eventCount + 1);
    }

    capture(id, state, previous) {
        if (!this.initialized || !this.enabled || this.stopped || typeof id !== 'string') return;
        const prefix = `${this.adapter.namespace}.`;
        if (!id.startsWith(prefix)) return;
        const relative = id.slice(prefix.length);
        // EHZ publishes Active -> Command -> Status. Enrich that one stop edge
        // from its following reason, even when a restart happens before sample.
        // Ordinary repeated output statuses still never create hook events.
        if (relative === 'Devices.MyPV_DHW.OutputStatus' && this.pendingEHZStop) {
            this.guard(() => {
                const pending = this.pendingEHZStop;
                this.pendingEHZStop = null;
                if (Date.now() - pending.at > 2000 || !this.events.includes(pending.event)) return;
                pending.event.type = 'output.stop';
                pending.event.to = scalar(state?.val);
                pending.event.context.ehz = this.context(this.snapshot()).ehz;
            });
            return;
        }
        if (!DISCRETE_SET.has(relative)) return;
        this.guard(() => {
            const next = scalar(state?.val);
            const old = this.observed.has(relative) ? this.observed.get(relative) : scalar(previous?.val);
            if (old === next) return;
            this.observed.set(relative, next);
            const snapshot = this.snapshot();
            const stop = relative.endsWith('.LastStopAt') && number(next) > 0;
            const to = stop ? this.own(relative.replace(/LastStopAt$/, 'LastStopReason')) : next;
            this.record(stop ? 'output.stop' : 'state.change', relative, old, to, snapshot);
            if (relative === 'Devices.MyPV_DHW.OutputActive' && old === true && next === false)
                this.pendingEHZStop = {event: this.events.at(-1), at: snapshot.ts};
            // Keep every short edge in memory; persist as a batch at sample().
        });
    }

    sample() {
        if (!this.initialized || !this.enabled || this.stopped || this.adapter.unloading) return;
        this.guard(() => this.takeSample());
    }

    takeSample(finalReason) {
        const snapshot = this.snapshot();
        for (const id of DISCRETE) this.capture(`${this.adapter.namespace}.${id}`,
            {val: this.own(id)}, {val: this.observed.get(id)});
        for (const id of REASONS) {
            const next = stableReason(this.own(id));
            const old = this.observed.get(id);
            if (old !== next) this.record('reason.change', id, old, this.own(id), snapshot);
            this.observed.set(id, next);
        }
        if (finalReason) this.record('session.stop', 'Debug', null, finalReason, snapshot);
        if (this.lastTraceAt === null || snapshot.ts - this.lastTraceAt >= TRACE_INTERVAL_MS
            || snapshot.ts < this.lastTraceAt) {
            this.trace.push({...stamp(snapshot.ts), session: this.session, ...this.context(snapshot)});
            this.trace = this.trace.filter(item => item.ts >= snapshot.ts - MAX_TRACE * TRACE_INTERVAL_MS
                && item.ts <= snapshot.ts + 1000).slice(-MAX_TRACE);
            this.lastTraceAt = snapshot.ts;
        }
        const watts = value => value === null ? '?' : `${Math.round(value)} W`;
        const mode = snapshot.system.RealOutputsEnabled === true ? 'Produktivfreigabe AN' : 'Produktivfreigabe AUS';
        const status = snapshot.control.Status || snapshot.control.Mode || 'Status unbekannt';
        this.publish('Summary', `${mode}; Auswahl ${[0, 1, 2].includes(snapshot.control.SelectedWallbox) ? `WB${snapshot.control.SelectedWallbox}` : 'keine'}; Netz ${watts(snapshot.power.grid_W)}; PV ${watts(snapshot.power.pv_W)}; ${status}`);
        for (const w of snapshot.wallboxes) this.publish(`Wallbox${w.wb}.Summary`,
            `WB${w.wb}${w.selected ? ' ausgewaehlt' : ''}: ${w.OutputStatus || 'Status unbekannt'}; Soll ${watts(number(w.target_W))}, Ist ${watts(w.actual_W)}; Start ${w.StartDelayRemaining_s ?? '?'} s; Mindestlauf ${w.MinimumRunTimeRemaining_s ?? '?'} s; Stopp ${w.StopDelayRemaining_s ?? '?'} s${w.OutputFault ? `; FEHLER: ${w.OutputFault}` : ''}`);
        this.publish('EHZ.Summary', `${snapshot.ehz.OutputStatus || 'Status unbekannt'}; Soll ${watts(number(snapshot.ehz.target_W))}, Befehl ${watts(number(snapshot.ehz.OutputCommand_W))}, Ist ${watts(snapshot.ehz.actual_W)}; ${snapshot.ehz.ControlReason || ''}`);
        this.publish('Snapshot_JSON', JSON.stringify(snapshot));
        this.publish('LastUpdate', snapshot.ts);
        this.publishHistory();
    }

    publishHistory() {
        this.publish('Events_JSON', JSON.stringify(this.events));
        this.publish('PowerTrace_JSON', JSON.stringify(this.trace));
        this.publish('EventCount', this.eventCount);
        const event = this.events.at(-1);
        this.publish('LastEvent', event ? `${event.timestamp} | ${event.source} | ${String(event.to)}` : '');
    }

    handleCommand(id, state) {
        const prefix = `${this.adapter.namespace}.Debug.`;
        if (typeof id !== 'string' || !id.startsWith(prefix)
            || !['Enabled', 'Clear'].includes(id.slice(prefix.length))) return false;
        if (!state || state.ack !== false || !this.initialized || this.stopped) return true;
        return this.guard(() => {
            const key = id.slice(prefix.length);
            // A button/switch command must be acknowledged even when its value
            // equals our last publication (e.g. Clear=false a second time).
            this.lastPublished.delete(key);
            if (key === 'Enabled') {
                const valid = typeof state.val === 'boolean';
                const changed = valid && this.enabled !== state.val;
                if (valid) this.enabled = state.val;
                this.publish('Enabled', this.enabled);
                if (!this.enabled) {
                    this.pendingEHZStop = null;
                    for (const pendingKey of this.latest.keys()) if (pendingKey !== 'Enabled') this.latest.delete(pendingKey);
                    this.publish('Summary', 'Debug-Aufzeichnung deaktiviert; vorhandene Daten bleiben erhalten.');
                } else if (changed) {
                    this.seedObserved();
                    this.lastTraceAt = null;
                    this.record('recording.enabled', 'Debug.Enabled', false, true, this.snapshot());
                    this.sample();
                }
            } else {
                if (state.val === true) {
                    this.events = [];
                    this.trace = [];
                    this.eventCount = 0;
                    this.pendingEHZStop = null;
                    this.lastTraceAt = null;
                    this.seedObserved();
                    this.publishHistory();
                }
                this.publish('Clear', false);
            }
            return true;
        }, true);
    }

    stop(reason = 'Adapter beendet') {
        if (this.stopped) return;
        if (this.initialized && this.enabled) this.guard(() => this.takeSample(scalar(reason)));
        this.stopped = true;
    }
}

module.exports = DebugRecorder;
