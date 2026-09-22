'use strict';

const vm = require('node:vm');
const gridConstraints = require('./grid-constraints');
const WallboxOutput = require('./wallbox-output');

const POWER_TARGETS = ['Battery', 'MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2'];
const CONSUMERS = [...POWER_TARGETS, 'HeatPump'];
const NOTE = 'Entscheidungsvorschau mit echten Messwerten; keine simulierte Geraetereaktion und keine Stellbefehle.';
const MAX_SYSTEM_AGE_MS = 30000;
const MAX_PLAN_AGE_MS = 20 * 60000;

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function finite(value) {
    return ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
        && Number.isFinite(Number(value)) ? Number(value) : null;
}

/** A second instance of the actual decision engine, with no output capabilities.
 * It follows real feedback, never an invented response to its own proposals.
 * Consequently start delays can elapse, but a proposed start cannot establish
 * ownership, acknowledge a command, or start a productive minimum-run timer.
 */
class ShadowController {
    constructor(adapter, {createContext, now = () => Date.now()} = {}) {
        this.adapter = adapter;
        this.createContext = createContext;
        this.now = now;
        this.enabled = true;
        this.initialized = false;
        this.stopped = false;
        this.context = null;
        this.contextKey = '';
        this.states = new Map();
        this.derived = new Map();
        this.violation = '';
        this.pending = new Map();
        this.replacements = new Map();
        this.historyIds = [];
    }

    id(key) { return `${this.adapter.namespace}.Debug.Shadow.${key}`; }
    own(key) { return this.states.get(`${this.adapter.namespace}.${key}`)?.val; }
    live(key) { return this.adapter.getCachedState(`${this.adapter.namespace}.${key}`); }

    publish(key, value) {
        if (this.stopped || this.adapter.unloading) return;
        // Bounded asynchronous writes: one in flight and one latest replacement.
        if (this.pending.has(key)) { this.replacements.set(key, value); return; }
        let promise;
        try { promise = Promise.resolve(this.adapter.setCompatState(this.id(key), value, true)); }
        catch { return; }
        this.pending.set(key, promise);
        void promise.catch(() => {}).then(() => {
            this.pending.delete(key);
            if (this.replacements.has(key)) {
                const latest = this.replacements.get(key);
                this.replacements.delete(key);
                this.publish(key, latest);
            }
        });
    }

    async initialize() {
        const definitions = {
            Enabled: [true, 'boolean', 'switch.enable', 'Schattenregler aktivieren', true],
            Valid: [false, 'boolean', 'indicator', 'Schattenentscheidung gueltig'],
            LastUpdate: [0, 'number', 'value.time', 'Zeitpunkt der Schattenentscheidung'],
            Summary: ['', 'string', 'text', 'Was der EMS-Regler jetzt entscheiden wuerde'],
            Snapshot_JSON: ['{}', 'string', 'json', 'Schattenentscheidung mit Gruenden und Messwerten'],
            SelectedWallbox: [-1, 'number', 'value', 'Ausgewaehlte Wallbox, -1 = keine'],
            FineRegulator: ['none', 'string', 'text', 'Verbraucher fuer die Feinregelung'],
            'Targets.HeatPumpMode': ['NORMAL', 'string', 'text', 'Hypothetische WP-Empfehlung'],
            'Targets.HeatPumpModeValue': [1, 'number', 'value', 'WP: 0 reduziert, 1 normal, 2 Boost'],
            'HeatPump.Valid': [false, 'boolean', 'indicator', 'WP-Empfehlung gueltig']
        };
        for (const name of POWER_TARGETS) definitions[`Targets.${name}_W`] = [0, 'number', 'value.power',
            `${name}: hypothetisches Leistungsbudget; Batterie positiv = Laden`, false, 'W'];
        for (const name of ['Grid', 'PV', ...CONSUMERS]) definitions[`Actuals.${name}_W`] = [null, 'number',
            'value.power', `${name}: gemessene Leistung; null = fehlt/veraltet`, false, 'W'];
        for (const name of CONSUMERS) definitions[`${name}.Summary`] = ['', 'string', 'text', `${name}: Entscheidungsgrund`];
        for (const name of POWER_TARGETS) definitions[`${name}.OutputBlockReason`] = ['', 'string', 'text',
            `${name}: bekannte Sperre vor einer echten Ausgabe; Budget ist kein Stellbefehl`];
        for (const wb of [0, 1, 2]) {
            definitions[`Targets.Wallbox${wb}_A`] = [0, 'number', 'value.current', `WB${wb}: hypothetischer Ladestrom`, false, 'A'];
            definitions[`Targets.Wallbox${wb}_Phases`] = [1, 'number', 'value', `WB${wb}: hypothetische Phasenanzahl`];
            definitions[`Wallbox${wb}.StartDelayRemaining_s`] = [0, 'number', 'value.interval', `WB${wb}: eigene Schatten-Startverzoegerung`, false, 's'];
            definitions[`Wallbox${wb}.MinimumRunTimeRemaining_s`] = [0, 'number', 'value.interval', `WB${wb}: nur mit real bestaetigtem Start`, false, 's'];
        }
        this.historyIds = Object.keys(definitions).filter(key => !['Enabled', 'LastUpdate', 'Snapshot_JSON'].includes(key))
            .map(key => this.id(key));
        for (const [key, [value, type, role, name, write, unit]] of Object.entries(definitions)) {
            await this.adapter.queueCompatState(this.id(key), value,
                {type, role, name, read: true, write: write === true, ...(unit ? {unit} : {})});
            if (this.stopped || this.adapter.unloading) return;
        }
        this.enabled = this.adapter.getCachedState(this.id('Enabled'))?.val !== false;
        this.initialized = true;
        this.invalidate('Schattenregler wartet auf frische Messwerte und Fahrplan');
    }

    handleCommand(id, state) {
        if (id !== this.id('Enabled') || !state || state.ack !== false) return false;
        if (typeof state.val === 'boolean') this.enabled = state.val;
        this.publish('Enabled', this.enabled);
        this.context = null;
        this.invalidate(this.enabled ? 'Schattenregler neu aktiviert; naechster Messzyklus folgt' : 'Schattenregler deaktiviert');
        return true;
    }

    invalidate(reason) {
        this.context = null;
        this.derived.clear();
        this.publish('Valid', false);
        this.publish('SelectedWallbox', -1);
        this.publish('FineRegulator', 'none');
        this.publish('HeatPump.Valid', false);
        this.publish('Targets.HeatPumpMode', 'NORMAL');
        this.publish('Targets.HeatPumpModeValue', 1);
        for (const name of POWER_TARGETS) this.publish(`Targets.${name}_W`, 0);
        for (const name of CONSUMERS) this.publish(`${name}.Summary`, reason);
        for (const name of POWER_TARGETS) this.publish(`${name}.OutputBlockReason`, reason);
        for (const wb of [0, 1, 2]) {
            this.publish(`Targets.Wallbox${wb}_A`, 0);
            this.publish(`Targets.Wallbox${wb}_Phases`, 1);
            this.publish(`Wallbox${wb}.StartDelayRemaining_s`, 0);
            this.publish(`Wallbox${wb}.MinimumRunTimeRemaining_s`, 0);
        }
        for (const name of ['Grid', 'PV', ...CONSUMERS]) this.publish(`Actuals.${name}_W`, null);
        this.publish('Summary', reason);
        this.publish('Snapshot_JSON', JSON.stringify({timestamp: this.now(), valid: false, reason, note: NOTE}));
        this.publish('LastUpdate', this.now());
    }

    fresh(state, maxAgeMs) {
        const age = this.now() - Number(state?.ts);
        return Boolean(state && state.ack === true && (!state.q || Number(state.q) === 0)
            && Number(state.ts) > 0 && age >= -1000 && age <= maxAgeMs);
    }

    checkInputs() {
        if (this.adapter.config.globalWriteEnabled === true || this.live('System.RealOutputsEnabled')?.val === true)
            return 'Schattenregler pausiert: Master EIN; echte Reglerentscheidung unter Debug/Control';
        for (const [prefix, maxAge] of [['System', MAX_SYSTEM_AGE_MS], ['Plan', MAX_PLAN_AGE_MS]]) {
            const state = this.live(`${prefix}.${prefix === 'System' ? 'DataValid' : 'Valid'}`);
            const update = this.live(`${prefix}.LastUpdate`);
            const stamp = finite(update?.val);
            if (state?.val !== true || state.ack !== true || (state.q && Number(state.q) !== 0)
                || !this.fresh(update, maxAge) || stamp === null || stamp <= 0
                || stamp > this.now() + 1000 || this.now() - stamp > maxAge)
                return `${prefix === 'System' ? 'Messwerte' : 'Fahrplan'} fehlen, sind ungueltig oder veraltet`;
        }
        // An unfinished real output handoff must not become shadow ownership.
        // Wait until the actual output controllers have safely relinquished it.
        for (const name of POWER_TARGETS) {
            const base = `Devices.${name}.`;
            if (this.live(`${base}OutputOwned`)?.val === true
                || this.live(`${base}OutputActive`)?.val === true
                || ['OutputReservedPower_W', 'OutputReservedCharge_W', 'OutputUnobservedCommand_W',
                    'OutputReservedPhase1_W', 'OutputReservedPhase2_W', 'OutputReservedPhase3_W']
                    .some(key => Math.abs(finite(this.live(base + key)?.val) || 0) > 0)
                || this.live(`${base}OutputReservationPending`)?.val === true)
                return `${name}: reale Ausgangsuebergabe/Reservierung noch offen; Schattenregler pausiert`;
        }
        return '';
    }

    prepareContext() {
        const key = JSON.stringify([this.adapter.config, this.adapter.readMapping()]);
        if (!this.context || this.contextKey !== key) this.derived.clear();
        this.states = new Map();
        for (const [id, state] of this.adapter.stateCache) {
            if (!id.startsWith(`${this.adapter.namespace}.Debug.`)) this.states.set(id, clone(state));
        }
        const root = `${this.adapter.namespace}.`;
        const local = (key, value) => this.states.set(root + key, {val: value, ack: true, ts: this.now(), q: 0});
        // Reset all generated targets/selection; no live controller targets or
        // countdown diagnostics can seed a new shadow decision.
        for (const key of [...this.states.keys()]) {
            if (key.startsWith(root + 'Control.Targets.') || key === root + 'Control.Valid'
                || key === root + 'Control.LastUpdate' || key === root + 'Control.SelectedWallbox'
                || key === root + 'Control.FineRegulator'
                || /\.Vehicles\.Wallbox[012]\.(StartDelay|MinimumRunTime)/.test(key)) this.states.delete(key);
        }
        // Slow-cycle results belong to this VM, including countdowns and
        // selection between slow updates; none are borrowed from live Control.
        for (const [id, state] of this.derived) this.states.set(id, clone(state));
        this.states.delete(root + 'Control.Valid');
        local('System.RealOutputsEnabled', true);
        this.blocked = {};
        for (const name of POWER_TARGETS) {
            const fault = this.own(`Devices.${name}.OutputFault`) || this.own(`Devices.${name}.Fault`);
            const metadataRequired = ['Battery', 'MyPV_Heating'].includes(name);
            const driverInvalid = metadataRequired && this.own(`Devices.${name}.DriverReady`) !== true;
            if (fault || driverInvalid) {
                this.blocked[name] = fault ? `Ausgangsstoerung: ${String(fault)}` : 'Ausgangsmetadaten/Treiber nicht freigegeben';
            }
        }
        if (this.context && this.contextKey === key) return;
        const self = this;
        const forbidden = capability => () => {
            self.violation = `Nicht erlaubte Schattenfunktion: ${capability}`;
            throw new Error(self.violation);
        };
        const VirtualDate = class extends Date {
            constructor(...args) { super(...(args.length ? args : [self.now()])); }
            static now() { return self.now(); }
        };
        const sandbox = {
            Date: VirtualDate, JSON, Math, Number, String, Boolean, Array, Object, Map, Set, Promise,
            Infinity, NaN, parseInt, parseFloat, isNaN, gridConstraints,
            nativeConfig: Object.freeze({...clone(this.adapter.config), globalWriteEnabled: true}),
            getState: id => clone(this.states.get(id)),
            existsState: id => this.states.has(id),
            setState: (id, value, ack) => {
                if (!id.startsWith(root)) return forbidden('Fremd-State-Schreiben')();
                const state = typeof value === 'object' && value !== null && 'val' in value
                    ? clone(value) : {val: clone(value), ack: ack === true};
                const written = {...state, ts: this.now(), q: 0};
                this.states.set(id, written);
                if (id.startsWith(root + 'Control.') || id.startsWith(root + 'Vehicles.')
                    || id.startsWith(root + 'Devices.') && !/\.(Output|Driver|Fault|Present|ControlEnabled)/.test(id))
                    this.derived.set(id, clone(written));
            },
            createState: forbidden('Objektanlage'), writeForeignState: forbidden('Aktorausgang'),
            updateWallboxProductionOutput: forbidden('Wallboxausgang'), sendTo: forbidden('Adapterkommando/SQL'),
            schedule: forbidden('Zeitplan'), on: forbidden('Ereignisabo'), setTimeout: forbidden('Timer'),
            clearTimeout: forbidden('Timer'), log: () => {}
        };
        this.context = this.createContext(sandbox);
        this.contextKey = key;
    }

    run(source) { return vm.runInContext(source, this.context, {timeout: 1000}); }

    copyThermalLatches() {
        // These latches describe measured thermal history, not actuator
        // ownership or an imagined device response. Copying the live lock
        // avoids releasing a tank when shadow starts inside its hysteresis
        // band. Never call a live controller or write into its context.
        if (!this.adapter.engineContext || !vm.isContext(this.adapter.engineContext)) return;
        const thermal = vm.runInContext(
            '({dhw: dhwTemperatureLock, heating: heatingOutput.temperatureLock})',
            this.adapter.engineContext, {timeout: 100});
        const snapshot = {};
        if (typeof thermal.dhw === 'boolean') snapshot.dhw = thermal.dhw;
        if (typeof thermal.heating === 'boolean') snapshot.heating = thermal.heating;
        this.context.shadowThermalSnapshot = snapshot;
        this.run('if (typeof shadowThermalSnapshot.dhw === "boolean") dhwTemperatureLock = shadowThermalSnapshot.dhw; if (typeof shadowThermalSnapshot.heating === "boolean") heatingOutput.temperatureLock = shadowThermalSnapshot.heating;');
        delete this.context.shadowThermalSnapshot;
    }

    tick() {
        if (!this.initialized || this.stopped || this.adapter.unloading) return;
        if (!this.enabled) return;
        try {
            const problem = this.checkInputs();
            if (problem) return this.invalidate(problem);
            this.violation = '';
            this.prepareContext();
            this.copyThermalLatches();
            // Existing latched faults are real constraints, not hypothetical
            // output state. In particular the allocator queries the battery's
            // private fault latch to decide whether the EHZ must take over.
            this.run('batteryOutputFault = String(getState(`${CFG.root}.Devices.Battery.Fault`)?.val || ""); heatingOutput.fault = String(getState(`${CFG.root}.Devices.MyPV_Heating.OutputFault`)?.val || ""); updateVehicles(); updateDhwSimulation(); updateHeatingSimulation(); realtimeControl(); if (!coordinatedEnergyEnabled()) updateHeatPumpAdvice();');
            if (this.violation) throw new Error(this.violation);
            if (this.own('Control.Valid') !== true) return this.invalidate(
                String(this.own('Control.Status') || 'Keine gueltige Schattenentscheidung'));
            this.publishDecision();
        } catch (error) {
            this.invalidate(`Schattenregler ungueltig: ${String(error?.message || error).slice(0, 300)}`);
        }
    }

    publishDecision() {
        const measured = (id, multiplier = 1, age = 120000) => {
            const state = this.states.get(id), value = finite(state?.val);
            return value !== null && this.fresh(state, age) ? value * multiplier : null;
        };
        const sumMeasured = ids => {
            const values = ids.map(id => measured(id));
            return values.length && values.every(value => value !== null) ? values.reduce((a, b) => a + b, 0) : null;
        };
        const dp = this.run('CFG.dp');
        const imported = measured(dp.gridImport), exported = measured(dp.gridExport);
        const actuals = {
            Grid: imported === null || exported === null ? null : imported - exported,
            PV: measured(dp.pvPower), Battery: this.run('batteryMeasuredPowerW()'),
            MyPV_DHW: sumMeasured(dp.myPvDhwOutputW || []),
            MyPV_Heating: sumMeasured([1, 2, 3].map(p => this.adapter.config[`heatingOutput${p}Id`])),
            HeatPump: measured(dp.heatPumpPower)
        };
        const targets = {}, consumers = {};
        for (const name of POWER_TARGETS) targets[name] = finite(this.own(`Control.Targets.${name}_W`)) ?? 0;
        const selectedWallbox = finite(this.own('Control.SelectedWallbox')) ?? -1;
        const fineRegulator = this.run('coordinatedEnergyEnabled()')
            ? this.own('Control.FineRegulator') || 'none' : targets.MyPV_DHW > 0 ? 'MyPV_DHW' : 'none';
        for (const wb of [0, 1, 2]) {
            const name = `Wallbox${wb}`;
            actuals[name] = measured(dp.wallboxesKW[wb], 1000,
                Math.max(5, Number(this.adapter.config.wallboxMeasurementMaxAgeS) || 30) * 1000);
            const amps = finite(this.own(`Control.Targets.${name}_A`)) ?? 0;
            const phases = finite(this.own(`Control.Targets.${name}_Phases`)) === 3 ? 3 : 1;
            const startDelay = finite(this.own(`Vehicles.${name}.StartDelayRemaining_s`)) ?? 0;
            const minimumRun = finite(this.own(`Vehicles.${name}.MinimumRunTimeRemaining_s`)) ?? 0;
            const outputBlockReason = this.wallboxOutputBlockReason(wb);
            const reason = (startDelay > 0 ? `Startverzoegerung noch ${startDelay} s`
                    : targets[name] > 0 ? `Budget ${amps} A / ${phases} Phase(n)`
                        : selectedWallbox !== wb ? 'nicht ausgewaehlt/freigegeben' : 'kein nutzbares Ladebudget')
                + `; ${outputBlockReason || 'Vorpruefung frei; physische Ausgabe/Antwort nicht simuliert'}; ${this.own(`Vehicles.${name}.Status`) || ''}`;
            consumers[name] = {powerW: targets[name], amps, phases, startDelayRemainingS: startDelay,
                minimumRunRemainingS: minimumRun, reason, outputBlockReason};
            this.publish(`Targets.${name}_A`, amps);
            this.publish(`Targets.${name}_Phases`, phases);
            this.publish(`${name}.StartDelayRemaining_s`, startDelay);
            this.publish(`${name}.MinimumRunTimeRemaining_s`, minimumRun);
        }
        const battery = this.run('batteryRegulationState()');
        consumers.Battery = {powerW: targets.Battery, reason: this.deviceRestriction('Battery') || this.blocked.Battery || battery.reason,
            outputBlockReason: this.deviceRestriction('Battery') || this.blocked.Battery || (!battery.available ? battery.reason : '')};
        for (const name of ['MyPV_DHW', 'MyPV_Heating']) consumers[name] = {powerW: targets[name],
            reason: this.own(`Devices.${name}.Status`) || 'kein Heizbudget',
            outputBlockReason: this.deviceRestriction(name) || this.blocked[name]
                || (this.own(`Devices.${name}.Release`) !== true ? this.own(`Devices.${name}.Status`) || 'Temperaturfreigabe aus' : '')};
        const advice = this.run('getHeatPumpAdvice()');
        consumers.HeatPump = {mode: advice.mode, valid: advice.valid, reason: advice.reason};
        this.publish('Targets.HeatPumpMode', advice.mode);
        this.publish('Targets.HeatPumpModeValue', advice.value);
        this.publish('HeatPump.Valid', advice.valid);
        for (const [name, watts] of Object.entries(actuals)) this.publish(`Actuals.${name}_W`, finite(watts));
        for (const [name, watts] of Object.entries(targets)) this.publish(`Targets.${name}_W`, watts);
        for (const [name, decision] of Object.entries(consumers)) {
            this.publish(`${name}.Summary`, `${name}: ${name === 'HeatPump' ? decision.mode : `${decision.powerW} W Budget`}; ${decision.reason}${decision.outputBlockReason ? `; Ausgabe gesperrt: ${decision.outputBlockReason}` : ''}`);
            if (name !== 'HeatPump') this.publish(`${name}.OutputBlockReason`, decision.outputBlockReason || '');
        }
        const blockedBudgets = POWER_TARGETS.filter(name => targets[name] !== 0 && consumers[name].outputBlockReason);
        const summary = `SCHATTEN-BUDGET: ${selectedWallbox >= 0 ? `WB${selectedWallbox} ${targets[`Wallbox${selectedWallbox}`]} W` : 'keine Wallbox'}; WW ${targets.MyPV_DHW} W; HK ${targets.MyPV_Heating} W; Speicher ${targets.Battery} W (+Laden); Feinregler ${fineRegulator}; WP ${advice.mode}${blockedBudgets.length ? `; Ausgabe gesperrt fuer ${blockedBudgets.join(', ')} (Details siehe Summary)` : ''}`;
        this.publish('SelectedWallbox', selectedWallbox);
        this.publish('FineRegulator', fineRegulator);
        this.publish('Summary', summary);
        this.publish('Snapshot_JSON', JSON.stringify({timestamp: this.now(), valid: true, note: NOTE,
            masterAssumedEnabled: true, selectedWallbox, fineRegulator, targets, actuals, consumers,
            controlReason: this.own('Control.Status'), coordinationReason: this.run('coordinatedEnergyEnabled()')
                ? this.own('Control.CoordinationStatus') || '' : 'WB/WW-Regelung; keine Speicher-/Heizpufferkoordination'}));
        this.publish('LastUpdate', this.now());
        this.publish('Valid', true);
    }

    deviceRestriction(name) {
        if (this.own(`Devices.${name}.Present`) !== true) return 'Geraet nicht vorhanden';
        if (this.own(`Devices.${name}.ControlEnabled`) !== true) return 'Steuerfreigabe aus';
        const nativeKey = /^Wallbox/.test(name) ? `wb${name.slice(-1)}ProductionArmed`
            : name === 'MyPV_Heating' ? 'heatingProductionArmed' : null;
        return nativeKey && this.adapter.config[nativeKey] !== true ? 'Produktionsfreigabe nicht bestaetigt' : '';
    }

    wallboxOutputBlockReason(wb) {
        const reason = this.deviceRestriction(`Wallbox${wb}`) || this.blocked[`Wallbox${wb}`];
        if (reason) return reason;
        // Only the read-only production gate is called. No output initialize,
        // tick, stop, callback, acknowledgement or ownership transition occurs.
        const source = this.adapter.wallboxOutput?.devices;
        if (!Array.isArray(source)) return 'Ausgangsmetadaten fuer Vorpruefung fehlen';
        const facade = {namespace: this.adapter.namespace,
            config: {...clone(this.adapter.config), globalWriteEnabled: true},
            getCachedState: id => clone(this.states.get(id)), engineContext: this.context};
        const output = new WallboxOutput(facade);
        output.devices = clone(source);
        const device = output.devices.find(item => item.wb === wb);
        if (!device) return 'Wallbox-Ausgangsmetadaten fehlen';
        // Gate uses wall-clock Date; production receives these same current
        // measurement timestamps. Shadow timers themselves stay in the VM.
        return output.gate(device, clone(this.adapter.readMapping()),
            clone(this.run('currentConsumptionLimit()'))) || '';
    }

    stop() {
        this.stopped = true;
        this.context = null;
        this.states.clear();
        this.derived.clear();
        this.replacements.clear();
    }
}

module.exports = ShadowController;
