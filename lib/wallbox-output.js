'use strict';

const gridConstraints = require('./grid-constraints');
const {houseConnectionSettings} = require('./native-mapping');

// Productive wallbox control with fixed, verified phase topology.
// The alpha multi-device mode can arm all three wallboxes, but the EMS keeps
// a hard single-wallbox interlock. No external phase contactor or automatic
// error reset is operated here.
class WallboxOutput {
    constructor(adapter) {
        this.adapter = adapter;
        this.ready = false;
        this.busy = false;
        this.stopping = false;
        this.devices = [];
        this.idleWaiters = [];
    }

    own(id) { return this.adapter.getCachedState(`${this.adapter.namespace}.${id}`)?.val; }
    state(id) { return id ? this.adapter.getCachedState(id) : null; }
    number(id, maxAge = 15000) {
        const s = this.state(id);
        if (!s || !['number', 'string'].includes(typeof s.val)
            || (typeof s.val === 'string' && s.val.trim() === '')
            || !Number.isFinite(s.ts) || s.ack !== true || (s.q && s.q !== 0)
            || Date.now() - s.ts > maxAge || s.ts > Date.now() + 1000) return null;
        const value = Number(s.val);
        return Number.isFinite(value) ? value : null;
    }
    value(wb, key, fallback) { return this.adapter.config[`wb${wb}${key}`] ?? fallback; }
    publish(wb, key, value) {
        this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.${key}`, value, true);
    }

    alphaEnabled() { return this.adapter.config.multiWallboxAlphaArmed === true; }

    measurementMaxAgeMs() {
        const seconds = Number(this.adapter.config.wallboxMeasurementMaxAgeS ?? 30);
        return (Number.isFinite(seconds) ? Math.max(5, seconds) : 30) * 1000;
    }

    feedbackTimeoutMs(d) {
        const seconds = Number(this.value(d.wb, 'FeedbackTimeoutS', 20));
        return (Number.isFinite(seconds) ? Math.max(1, seconds) : 20) * 1000;
    }

    // ioBroker puts ack=false on a writable state while the device responds.
    // Only our exact, bounded in-flight write may use the last confirmed value
    // for safety calculations. It is never accepted as a device acknowledgement.
    feedbackValue(d, key, maxAge) {
        const id = key === 'allow' ? d.ids.allow : d.ids.feedback;
        const value = this.number(id, maxAge);
        if (value !== null) {
            d.confirmedFeedback[key] = {value, ts: this.state(id).ts};
            return value;
        }
        const state = this.state(id);
        const expected = d.expectedFeedback[key];
        if (d.owned && expected && state?.ack === false && !state.q
            && Number.isFinite(state.ts) && state.ts >= expected.at
            && state.ts <= Date.now() + 1000 && Number(state.val) === expected.value
            && Date.now() - expected.at <= this.feedbackTimeoutMs(d)) {
            const confirmed = d.confirmedFeedback[key];
            return confirmed && Date.now() - confirmed.ts <= maxAge
                && confirmed.ts <= Date.now() + 1000 ? confirmed.value : null;
        }
        return null;
    }

    waitForIdle() {
        if (!this.busy) return Promise.resolve();
        return new Promise(resolve => this.idleWaiters.push(resolve));
    }

    hasActiveOwnedOutput() {
        return this.devices.some(d => d.owned
            && this.own(`Devices.Wallbox${d.wb}.OutputActive`) === true);
    }

    finishRestartHandoff() {
        this.adapter.setCompatState(`${this.adapter.namespace}.Control.RestartHandoffActive`, false, true);
    }

    restartHandoffWaiting(d) {
        const handoffSince = Number(this.own('Control.RestartHandoffSince') || 0);
        const seconds = Number(this.adapter.config.wallboxRestartHandoffTimeoutS ?? 180);
        const handoffTimeoutMs = (Number.isFinite(seconds) ? Math.max(30, seconds) : 180) * 1000;
        return d.recovering && this.own('Control.RestartHandoffActive') === true
            && handoffSince > 0 && handoffSince <= Date.now() + 1000
            && Date.now() - handoffSince <= handoffTimeoutMs;
    }

    restartDataFresh() {
        const handoffSince = Number(this.own('Control.RestartHandoffSince') || 0);
        if (handoffSince <= 0) return false;
        const plan = this.state(`${this.adapter.namespace}.Plan.Valid`);
        const planLastUpdate = Number(this.own('Plan.LastUpdate') || 0);
        const systemLastUpdate = Number(this.own('System.LastUpdate') || 0);
        const controlLastUpdate = Number(this.own('Control.LastUpdate') || 0);
        return plan?.val === true && plan.ack === true && !plan.q
            && [planLastUpdate, systemLastUpdate, controlLastUpdate]
                .every(timestamp => Number.isFinite(timestamp) && timestamp >= handoffSince
                    && timestamp <= Date.now() + 1000);
    }

    productionEnabled(d) {
        return this.value(d.wb, 'Present', true)
            && this.own(`Devices.Wallbox${d.wb}.Present`) === true
            && this.value(d.wb, 'ControlEnabled', false)
            && this.own(`Devices.Wallbox${d.wb}.ControlEnabled`) === true;
    }

    enabledDevices() { return this.devices.filter(d => this.productionEnabled(d)); }

    mode(active, dhw) {
        if (this.alphaEnabled()) return active && dhw ? 'ALPHA_WALLBOX_DHW'
            : active ? 'ALPHA_WALLBOX' : dhw ? 'ALPHA_DHW' : 'ALPHA_READY';
        return active && dhw ? 'WALLBOX_DHW_COMBINED'
            : active ? 'WALLBOX_SINGLE_TEST' : dhw ? 'DHW_PRODUCTION' : 'SIMULATION';
    }

    booleanInput(id) {
        const state = this.state(id);
        if (!state || state.q) return null;
        const value = state.val;
        if (value === true || value === 1 || value === '1') return true;
        if (value === false || value === 0 || value === '0') return false;
        return null;
    }

    freshValue(id, maxAge = 15000) {
        if (!id) return null;
        const state = this.state(id);
        if (!state || state.val === null || state.val === '' || state.ack !== true
            || !Number.isFinite(state.ts) || (state.q && state.q !== 0) || Date.now() - state.ts > maxAge
            || state.ts > Date.now() + 1000) return null;
        return state.val;
    }

    staticValue(id) {
        if (!id) return null;
        const state = this.state(id);
        if (!state || state.val === null || state.val === '' || state.ack !== true
            || !Number.isFinite(state.ts) || (state.q && state.q !== 0)
            || state.ts > Date.now() + 1000) return null;
        return state.val;
    }

    gridOperatorLimit(mapping) {
        const legacyConfigured = Boolean(mapping.DP_PAR14A);
        const lpcConfigured = Boolean(mapping.DP_LPC_STATE || mapping.DP_LPC_LIMIT);
        const legacyValue = this.staticValue(mapping.DP_PAR14A);
        const legacyBoolean = [true, 1, '1'].includes(legacyValue) ? true
            : [false, 0, '0'].includes(legacyValue) ? false : null;
        const legacyActive = !legacyConfigured || legacyBoolean === null ? legacyBoolean
            : this.adapter.config.par14aActiveHigh === false ? !legacyBoolean : legacyBoolean;
        const rawLimit = this.freshValue(mapping.DP_LPC_LIMIT);
        const result = gridConstraints.evaluateConsumptionLimit({
            legacyConfigured,
            legacyActive,
            legacyLimitW: Number(this.adapter.config.par14aLimitW ?? 4200),
            lpcConfigured,
            lpcState: this.freshValue(mapping.DP_LPC_STATE),
            lpcLimitW: rawLimit === null ? null : Number(rawLimit)
        });
        if (!result.valid || !result.active
            || this.own('Devices.HeatPump.Present') !== true) return result;
        const heatPumpW = this.number(mapping.DP_HEAT_PUMP_POWER);
        if (heatPumpW === null || heatPumpW < 0) {
            return {valid: false, active: true, budgetW: 0,
                reason: 'Wärmepumpenleistung für gemeinsames LPC-Budget fehlt/ungueltig'};
        }
        const remainingW = Math.max(0, result.budgetW - heatPumpW);
        return {...result, budgetW: Math.floor(remainingW),
            reason: `${result.reason}; Wärmepumpe ${Math.round(heatPumpW)} W; Wallbox-Rest ${Math.floor(remainingW)} W`};
    }

    combinedMode(mapping) {
        const enabled = this.enabledDevices();
        const scopeConfirmed = enabled.length === 1
            || (this.alphaEnabled() && enabled.length > 1);
        const allArmed = enabled.length > 0
            && enabled.every(d => this.value(d.wb, 'ProductionArmed', false));
        return scopeConfirmed && allArmed
            && this.own('Devices.MyPV_DHW.ControlEnabled') === true
            && this.own('Config.DHWParallelDistributionEnabled') === true
            && this.adapter.config.combinedProductionArmed === true;
    }

    dhwActualPower(mapping) {
        // Match the EHZ output controller's CFG.dataMaxAgeMs. Its Modbus
        // measurements are not subject to the go-e or 10-s grid-meter timeout.
        const maxAgeMs = 120000;
        const ids = [1, 2, 3].map(phase =>
            this.adapter.config[`dhwOutput${phase}Id`] || mapping[`DP_DHW_OUTPUT${phase}`]);
        if (ids.some(Boolean)) {
            const values = ids.map(id => this.number(id, maxAgeMs));
            return ids.every(Boolean) && values.every(value => value !== null && value >= 0)
                ? values.reduce((total, value) => total + value, 0) : NaN;
        }
        return this.number(`${this.adapter.namespace}.Actual.MyPV_DHW_W`, maxAgeMs) ?? NaN;
    }

    coordinatedLoadReservation(wb) {
        const context = this.adapter.engineContext;
        if (typeof context?.coordinatedEnergyEnabled !== 'function' || !context.coordinatedEnergyEnabled()) return null;
        if (typeof context.coordinatedConsumptionLoads !== 'function') return {valid: false, otherW: 0};
        try {
            const loads = context.coordinatedConsumptionLoads();
            const ownW = loads.wallboxesW?.[wb];
            return loads.valid && Number.isFinite(ownW) && Number.isFinite(loads.totalW)
                ? {valid: true, otherW: Math.max(0, loads.totalW - ownW)} : {valid: false, otherW: 0};
        } catch (_) { return {valid: false, otherW: 0}; }
    }

    async enforceAlphaAuthority(d) {
        if (!this.alphaEnabled() || d.recovering || d.owned || !d.valid
            || !this.productionEnabled(d) || !this.value(d.wb, 'ProductionArmed', false)
            || !this.adapter.config.globalWriteEnabled
            || this.own('System.RealOutputsEnabled') !== true) return false;
        const allow = this.number(d.ids.allow);
        if (allow !== 1) return false;
        // Alpha takeover never adopts an unknown running command. It first
        // claims only the stop operation, obtains a confirmed OFF state and
        // then lets the normal EMS start sequence create a new owned command.
        d.owned = true;
        await this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Wallbox${d.wb}.OutputOwned`, true, true);
        this.publish(d.wb, 'OutputActive', false);
        this.publish(d.wb, 'OutputCommand_A', 0);
        await this.stop(d, 'ALPHA-Uebernahme: fremde Ladefreigabe sicher ausschalten');
        return true;
    }

    async initialize() {
        this.busy = true;
        try { await this.initializeDevices(); }
        finally {
            this.busy = false;
            for (const resolve of this.idleWaiters.splice(0)) resolve();
        }
    }

    async initializeDevices() {
        const mapping = this.adapter.readMapping();
        for (let wb = 0; wb < 3; wb++) {
            const ids = {};
            for (const [key, suffix] of Object.entries({command: 'AmpereOutputId', allow: 'AllowOutputId',
                feedback: 'AmpereFeedbackId', connection: 'ConnectionId', error: 'ErrorId',
                available: 'AvailableCurrentId', phaseMode: 'PhaseModeId'})) {
                ids[key] = String(this.value(wb, suffix, '')).trim();
            }
            const d = {wb, ids, owned: false, recovering: false, wasOwned: false, wasActive: false,
                recoveredAt: 0, handoffReadySince: 0, activeSince: 0, pending: null, lastA: 0, lastAt: 0,
                shortfallSince: 0, stopRequest: null, confirmedFeedback: {}, expectedFeedback: {},
                confirmedPhases: 0, phaseTransitionUntil: 0, fault: '', valid: false};
            this.devices.push(d);
            d.wasOwned = this.own(`Devices.Wallbox${wb}.OutputOwned`) === true;
            d.wasActive = this.own(`Devices.Wallbox${wb}.OutputActive`) === true;
        }
        const outputIds = this.devices.flatMap(d => [d.ids.command, d.ids.allow]).filter(Boolean);
        // Validate every target before reading live feedback. If a foreign read
        // fails during startup, shutdown still knows every validated old owner.
        const validations = await Promise.allSettled(this.devices.map(async d => {
            const {wb, ids} = d;
            if (ids.command && ids.allow && ids.command !== ids.allow && ids.feedback
                && ids.connection && ids.error && mapping[`DP_WB${wb}_CAR`] && mapping[`DP_WB${wb}_SOC`]
                && ![ids.command, ids.allow].some(id => outputIds.filter(other => other === id).length > 1
                    || id === this.adapter.config.dhwSetpointId)) {
                const objects = await Promise.all([ids.command, ids.allow]
                    .map(id => this.adapter.getForeignObjectAsync(id)));
                d.valid = objects.every(o => o?.type === 'state'
                    && o.common?.write === true && o.common?.type === 'number');
            }
            d.owned = d.valid && d.wasOwned;
        }));
        const validationErrors = validations.filter(result => result.status === 'rejected');
        if (validationErrors.length) throw new AggregateError(validationErrors.map(result => result.reason),
            'Wallbox-Ausgangsmetadaten konnten nicht sicher geprueft werden');
        for (const d of this.devices) {
            const {wb, ids} = d;
            const definitions = {OutputActive: false, OutputOwned: false, OutputCommand_A: 0, OutputReservedPower_W: 0,
                OutputPhases: 1, OutputStatus: 'Simulation; Ausgang gesperrt', OutputLastWrite: 0,
                OutputFault: '', LastStopReason: '', LastStopAt: 0,
                StopDelayActive: false, StopDelayRemaining_s: 0,
                FeedbackCurrent_A: 0, AvailableCurrent_A: 0,
                ConfirmedPhases: 1, PhaseTransitionActive: false};
            for (const [key, initial] of Object.entries(definitions)) {
                await this.adapter.queueCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.${key}`,
                    initial, {type: typeof initial, role: typeof initial === 'boolean' ? 'indicator' : 'value'});
            }
            const subscribe = [...Object.values(ids), ...['CAR', 'SOC', 'ALLOW', 'POWER', 'L1_A', 'L2_A', 'L3_A']
                .map(key => mapping[`DP_WB${wb}_${key}`])].filter(Boolean);
            for (const id of new Set(subscribe)) {
                const s = await this.adapter.getForeignStateAsync(id);
                if (s) this.adapter.stateCache.set(id, s);
                await this.adapter.subscribeForeignStatesAsync(id);
            }
        }
        for (const d of this.devices) {
            this.publish(d.wb, 'OutputFault', '');
            this.publish(d.wb, 'StopDelayActive', false);
            this.publish(d.wb, 'StopDelayRemaining_s', 0);
            d.owned = d.valid && d.wasOwned;
            d.recovering = d.owned && d.wasActive;
            if (d.recovering) {
                this.publish(d.wb, 'OutputStatus', 'Neustart: sichere Wiederuebernahme wird geprueft');
            } else if (d.owned) await this.stop(d, 'Neustart: unvollstaendigen Auftrag stoppen');
            else {
                this.publish(d.wb, 'OutputActive', false);
                this.publish(d.wb, 'OutputOwned', false);
                this.publish(d.wb, 'OutputCommand_A', 0);
                this.publish(d.wb, 'OutputReservedPower_W', 0);
                if (d.wasOwned && !d.valid) {
                    d.fault = 'Neustart: vorheriger Auftrag wegen ungueltiger Ausgangskonfiguration nicht uebernehmbar';
                    this.publish(d.wb, 'OutputFault', d.fault);
                    this.publish(d.wb, 'OutputStatus', d.fault);
                }
            }
        }
        this.ready = true;
    }

    async send(d, key, value) {
        if (!d.valid || !['command', 'allow'].includes(key)) throw new Error('Ausgang nicht freigegeben/konfiguriert');
        if (key === 'command' && (!Number.isInteger(value) || value < 6 || value > 32))
            throw new Error('Ungueltiger Ladestrom');
        if (key === 'allow' && ![0, 1].includes(value)) throw new Error('Ungueltige Ladefreigabe');
        if (this.stopping && (key !== 'allow' || value !== 0)) throw new Error('Adapter wird beendet');
        if ((key === 'command' || value === 1) && (!this.adapter.config.globalWriteEnabled
            || this.own('System.RealOutputsEnabled') !== true || !this.productionEnabled(d)
            || !this.value(d.wb, 'ProductionArmed', false))) {
            throw new Error('Schreibfreigabe waehrend der Ausgangssequenz entzogen');
        }
        const feedbackKey = key === 'allow' ? 'allow' : d.ids.command === d.ids.feedback ? 'current' : null;
        if (key === 'command') {
            const phases = d.confirmedPhases === 3 ? 3 : 1;
            this.publish(d.wb, 'OutputReservedPower_W', Math.max(
                Number(this.own(`Devices.Wallbox${d.wb}.OutputReservedPower_W`)) || 0,
                Math.max(value, d.lastA || 0) * phases * 230));
        }
        if (feedbackKey) {
            const previous = this.number(d.ids[key], this.measurementMaxAgeMs());
            if (previous !== null)
                d.confirmedFeedback[feedbackKey] = {value: previous, ts: this.state(d.ids[key]).ts};
            d.expectedFeedback[feedbackKey] = {value, at: Date.now()};
        }
        await this.adapter.setForeignStateAsync(d.ids[key], value, false);
        this.publish(d.wb, 'OutputLastWrite', Date.now());
    }

    async stop(d, reason) {
        const wasRecovering = d.recovering;
        // OutputOwned remains true until allow=0 is acknowledged. Recording it
        // here would therefore emit the same stop once per 2-s tick. The
        // productive transition itself is represented by OutputActive or the
        // recovering flag and is recorded exactly once.
        const wasControlled = !d.stopRequest && (d.recovering
            || this.own(`Devices.Wallbox${d.wb}.OutputActive`) === true
            || (d.owned && d.pending?.start === true && d.pending.stage === 'allow'));
        if (wasControlled) {
            this.publish(d.wb, 'LastStopReason', reason);
            this.publish(d.wb, 'LastStopAt', Date.now());
            this.adapter.log.warn?.(`Wallbox ${d.wb}: Ausgang AUS – ${reason}`);
        }
        this.publish(d.wb, 'OutputActive', false);
        this.publish(d.wb, 'OutputCommand_A', 0);
        this.publish(d.wb, 'StopDelayActive', false);
        this.publish(d.wb, 'StopDelayRemaining_s', 0);
        if (d.owned && !d.stopRequest) d.stopRequest = {reason, lastAttempt: 0};
        this.publish(d.wb, 'OutputStatus', d.stopRequest?.reason || reason);
        d.pending = null;
        d.recovering = false;
        d.activeSince = 0;
        d.shortfallSince = 0;
        d.lastA = 0;
        if (wasRecovering) this.finishRestartHandoff();
        if (!d.owned) return;
        if (this.number(d.ids.allow, this.measurementMaxAgeMs()) === 0) {
            d.owned = false;
            d.stopRequest = null;
            d.expectedFeedback = {};
            this.publish(d.wb, 'OutputOwned', false);
            this.publish(d.wb, 'OutputReservedPower_W', 0);
        } else if (d.stopRequest.lastAttempt <= 0
            || Date.now() - d.stopRequest.lastAttempt >= this.feedbackTimeoutMs(d)) {
            // Keep ownership/interlock until OFF is really acknowledged. A
            // retry must not reset ack=false every two seconds while go-e polls.
            if (d.stopRequest.lastAttempt > 0) {
                d.fault = 'AUS-Rueckmeldung fehlt; Ausgang gesperrt bis Adapter-Neustart';
                this.publish(d.wb, 'OutputFault', d.fault);
            }
            d.stopRequest.lastAttempt = Date.now();
            await this.send(d, 'allow', 0);
        }
    }

    gate(d, mapping, consumptionLimit) {
        const wb = d.wb;
        if (!this.own('System.RealOutputsEnabled') || !this.adapter.config.globalWriteEnabled)
            return 'Globale Schreibfreigabe aus';
        if (!this.value(wb, 'Present', true) || !this.own(`Devices.Wallbox${wb}.Present`)) return 'Wallbox nicht vorhanden';
        if (!this.value(wb, 'ControlEnabled', false) || !this.own(`Devices.Wallbox${wb}.ControlEnabled`)) return 'Wallbox-Steuerfreigabe aus';
        if (!this.value(wb, 'ProductionArmed', false)) return 'Einzeltest nicht bestaetigt';
        if (!d.valid) return 'Ausgangs-/Rueckmeldekonfiguration fehlt oder ungueltig';
        const enabled = this.enabledDevices();
        if (enabled.length > 1 && !this.alphaEnabled())
            return 'Mehrere Wallboxen erfordern die ALPHA-Mehrgeraetefreigabe';
        if (this.alphaEnabled() && enabled.some(x => !this.value(x.wb, 'ProductionArmed', false)))
            return 'ALPHA gesperrt: nicht alle freigegebenen Wallboxen sind bestaetigt';
        if (this.alphaEnabled() && enabled.length > 1
            && Number(this.own('Control.SelectedWallbox')) !== wb
            && !(d.owned && this.restartHandoffWaiting(d)))
            return `Sequenzbetrieb: Wallbox ${Number(this.own('Control.SelectedWallbox'))} ausgewaehlt`;
        const otherOwned = this.devices.find(x => x.wb !== wb && x.owned);
        if (otherOwned) return `Sequenzbetrieb: Wallbox ${otherOwned.wb} wird zuerst beendet`;
        if (this.alphaEnabled()) {
            const maxAgeMs = this.measurementMaxAgeMs();
            const otherReleased = this.devices.find(x => x.wb !== wb && x.valid
                && this.number(x.ids.allow, maxAgeMs) === 1);
            if (otherReleased) return `Sequenzbetrieb: Ladefreigabe Wallbox ${otherReleased.wb} noch aktiv`;
            const starting = !d.recovering && (!d.owned
                || (d.activeSince <= 0 && this.own(`Devices.Wallbox${wb}.OutputActive`) !== true));
            if (starting) {
                // An unknown peer is not a confirmed OFF peer. Check this
                // through every startup step, including before allow=1, but
                // do not interrupt established charging for an idle peer's
                // transient telemetry gap. Unknown/unowned peers are not ours
                // to write to just to obtain a convenient OFF acknowledgement.
                const unknownPeer = this.devices.find(x => x.wb !== wb
                    && this.productionEnabled(x) && this.number(x.ids.allow, maxAgeMs) !== 0);
                if (unknownPeer) return `Sequenzbetrieb: bestaetigte AUS-Rueckmeldung Wallbox ${unknownPeer.wb} fehlt`;
            }
        }
        if (this.own('Devices.MyPV_DHW.ControlEnabled') && !this.combinedMode(mapping))
            return 'EHZ gleichzeitig freigegeben, gemeinsame Produktion aber nicht sicher bestaetigt';
        if (this.staticValue(d.ids.connection) !== true) return 'Wallbox offline';
        const deviceMaxAgeMs = this.measurementMaxAgeMs();
        const errorCode = this.number(d.ids.error, deviceMaxAgeMs);
        if (errorCode !== 0) return 'Wallbox meldet Fehler oder Fehlerstatus fehlt';
        const carState = this.number(mapping[`DP_WB${wb}_CAR`], deviceMaxAgeMs);
        if (carState === null) return 'Fahrzeugstatus fehlt oder ist veraltet';
        if (![2, 3, 4].includes(carState)) return 'Kein Fahrzeug angeschlossen';
        if (!this.own(`Vehicles.Wallbox${wb}.SoCValid`))
            return 'Fahrzeug-SoC fehlt oder ist aelter als 2 Stunden';
        const socState = this.state(mapping[`DP_WB${wb}_SOC`]);
        if (socState?.ack !== true) return 'SoC-Datenpunkt unbestaetigt (ack=false)';
        const soc = this.number(mapping[`DP_WB${wb}_SOC`], 7200000);
        if (soc === null || soc < 0 || soc > 100) return 'SoC ungueltig oder veraltet';
        const targetSoc = Number(this.own(`Vehicles.Wallbox${wb}.TargetSoC_pct`));
        if (!Number.isFinite(targetSoc) || targetSoc <= 0 || targetSoc > 100)
            return 'Ziel-SoC fehlt oder ist ungueltig';
        if (soc >= targetSoc) return `Ziel-SoC erreicht (${soc} >= ${targetSoc} %)`;
        if (!this.own(`Vehicles.Wallbox${wb}.Release`)) return 'Keine Fahrzeugfreigabe';
        const userAllow = mapping[`DP_WB${wb}_ALLOW`];
        // User-owned switches are commands, not device acknowledgements. An
        // intentional ack=false switch value still grants/withdraws release.
        if (userAllow && this.booleanInput(userAllow) !== true) return 'Benutzerfreigabe fehlt';
        const critical = this.staticValue(mapping.DP_HA_CRITICAL);
        if (![false, 0].includes(critical)) return 'Hausanschlussschutz aktiv/fehlt';
        if (!consumptionLimit.valid) return consumptionLimit.reason;
        if (this.own('Control.Enabled') !== true) return 'EMS-Reglerfreigabe aus';
        if (!this.own('System.DataValid') || !this.own('Control.Valid')
            || Date.now() - Number(this.own('System.LastUpdate') || 0) > 30000
            || Date.now() - Number(this.own('Control.LastUpdate') || 0) > 10000
            || [this.own('System.LastUpdate'), this.own('Control.LastUpdate')]
                .some(value => !Number.isFinite(Number(value)) || Number(value) > Date.now() + 1000)) {
            if (this.restartHandoffWaiting(d))
                return 'WAIT_RESTART_HANDOFF';
            return 'EMS-/Reglerdaten ungueltig oder veraltet';
        }
        return '';
    }

    async update(d, mapping) {
        if (d.stopRequest) return this.stop(d, d.stopRequest.reason);
        if (await this.enforceAlphaAuthority(d)) return;
        const consumptionLimit = this.gridOperatorLimit(mapping);
        const reason = this.gate(d, mapping, consumptionLimit);
        if ((reason && reason !== 'WAIT_RESTART_HANDOFF') || d.fault)
            return this.stop(d, d.fault || reason);
        if (d.pending && Date.now() - d.pending.at > this.feedbackTimeoutMs(d)) {
            d.fault = 'Keine passende go-e-Rueckmeldung; Ausgang gesperrt bis Adapter-Neustart';
            this.publish(d.wb, 'OutputFault', d.fault);
            return this.stop(d, d.fault);
        }
        const wb = d.wb;
        const combined = this.combinedMode(mapping);
        const dhwActualW = combined ? this.dhwActualPower(mapping) : 0;
        const phaseSwitchEnabled = this.value(wb, 'PhaseSwitchEnabled', false) === true;
        const desiredPhases = Number(this.own(`Control.Targets.Wallbox${wb}_Phases`));
        const rawPhaseMode = phaseSwitchEnabled ? this.staticValue(d.ids.phaseMode) : null;
        const phaseMode = rawPhaseMode === null ? null : Number(rawPhaseMode);
        const confirmedPhases = phaseSwitchEnabled
            ? phaseMode === 1 ? 1 : phaseMode === 2 ? 3 : 0
            : Number(this.value(wb, 'ProductionPhases', 1));
        if (phaseSwitchEnabled && !d.ids.phaseMode)
            return this.stop(d, 'Phasenumschaltung aktiv, aber go-e-Phasenmodus-Rueckmeldung fehlt');
        if (phaseSwitchEnabled && confirmedPhases === 0)
            return this.stop(d, 'go-e-Phasenmodus fehlt, ist veraltet oder ungueltig');
        if (phaseSwitchEnabled && ![1, 3].includes(desiredPhases))
            return this.stop(d, 'EMS-Phasenvorgabe fehlt oder ist ungueltig');
        if (d.confirmedPhases > 0 && confirmedPhases !== d.confirmedPhases) {
            d.phaseTransitionUntil = Date.now() + Math.max(30,
                Number(this.adapter.config.phaseSwitchTransitionS ?? 90)) * 1000;
        }
        d.confirmedPhases = confirmedPhases;
        const phaseTransitionActive = Date.now() < d.phaseTransitionUntil;
        const phaseSwitchPending = phaseSwitchEnabled && desiredPhases !== confirmedPhases;
        this.publish(wb, 'ConfirmedPhases', confirmedPhases);
        this.publish(wb, 'PhaseTransitionActive', phaseTransitionActive);
        const phases = confirmedPhases;
        const phaseIndex = Number(this.value(wb, 'SinglePhaseGridPhase', 1)) - 1;
        if (![1, 3].includes(phases) || ![0, 1, 2].includes(phaseIndex)
            || (phases === 3 && !this.value(wb, 'PhaseSwitchEnabled', false)))
            return this.stop(d, 'Feste Phasenkonfiguration ungueltig');
        const baseMinimumA = Math.ceil(Math.max(6,
            Number(this.value(wb, phases === 3 ? 'MinCurrent3pA' : 'MinCurrent1pA', 6))));
        let maxA = Math.min(32, Number(this.value(wb, phases === 3 ? 'MaxCurrent3pA' : 'MaxCurrent1pA', 16)),
            Number(this.value(wb, 'CommissioningMaxA', 6)),
            Number(this.value(wb, 'MaxPowerW', 11000)) / (230 * phases));
        const soc = this.number(mapping[`DP_WB${wb}_SOC`], 7200000);
        const targetSoc = Number(this.own(`Vehicles.Wallbox${wb}.TargetSoC_pct`));
        if (this.value(wb, 'TaperEnabled', false)) for (const stage of [1, 2]) {
            if (soc >= targetSoc - Number(this.value(wb, `Taper${stage}DeltaPct`, stage === 1 ? 5 : 2)))
                maxA = Math.min(maxA, Number(this.value(wb, `Taper${stage}MaxA`, stage === 1 ? 13 : 8)));
        }
        const deviceMaxAgeMs = this.measurementMaxAgeMs();
        const current = [1, 2, 3].map(p =>
            this.number(mapping[`DP_WB${wb}_L${p}_A`], deviceMaxAgeMs));
        const importIds = [1, 2, 3].map(p => mapping[`DP_HA_L${p}_IMPORT_W`]);
        const exportIds = [1, 2, 3].map(p => mapping[`DP_HA_L${p}_EXPORT_W`]);
        const directionalIds = [...importIds, ...exportIds];
        const directionalConfigured = directionalIds.some(Boolean);
        if (directionalConfigured && !directionalIds.every(Boolean))
            return this.stop(d, 'Phasenrichtungs-Messung nur teilweise konfiguriert');
        const house = directionalConfigured ? [0, 1, 2].map(p =>
            gridConstraints.netImportCurrentA(this.number(importIds[p]), this.number(exportIds[p])))
            : [1, 2, 3].map(p => this.number(this.adapter.config[`dhwHaL${p}CurrentId`]
                || mapping[`DP_DHW_HA_L${p}_CURRENT_A`]));
        const actualKW = this.number(mapping[`DP_WB${wb}_POWER`], deviceMaxAgeMs);
        const importW = this.number(mapping.DP_GRID_IMPORT, 10000);
        const exportW = this.number(mapping.DP_GRID_EXPORT, 10000);
        const feedbackA = this.feedbackValue(d, 'current', deviceMaxAgeMs);
        const allow = this.feedbackValue(d, 'allow', deviceMaxAgeMs);
        const measurementNames = ['L1-Strom', 'L2-Strom', 'L3-Strom', 'Wallbox-Leistung',
            'Netzbezug', 'Netzeinspeisung', 'Ampere-Rueckmeldung', 'Ladefreigabe-Rueckmeldung'];
        const invalidMeasurements = [...current, actualKW, importW, exportW, feedbackA, allow]
            .map((value, index) => value === null || value < 0 ? measurementNames[index] : null)
            .filter(Boolean);
        house.forEach((value, index) => {
            if (value === null || (!directionalConfigured && value < 0))
                invalidMeasurements.push(`Hausanschluss L${index + 1}`);
        });
        if (invalidMeasurements.length)
            return this.stop(d,
                `Messwert/Rueckmeldung fehlt oder ist veraltet: ${invalidMeasurements.join(', ')}`);
        if (phases === 1 && !phaseTransitionActive && (current[1] > 1 || current[2] > 1))
            return this.stop(d, 'Gemessene Phasen passen nicht zur festen Einphasen-Konfiguration');
        if (![0, 1].includes(allow)) return this.stop(d, 'Ungueltige Ladefreigabe-Rueckmeldung');
        const available = d.ids.available ? this.number(d.ids.available, deviceMaxAgeMs) : 32;
        if (available === null || available < 0) return this.stop(d, 'Verfuegbarer go-e-Ladestrom fehlt');
        maxA = Math.min(maxA, available);
        if (consumptionLimit.active) {
            const coordinated = this.coordinatedLoadReservation(wb);
            if (coordinated && !coordinated.valid)
                return this.stop(d, 'Gemeinsame Verbrauchermessung fuer LPC-Budget fehlt/ungueltig');
            if (!coordinated && (!Number.isFinite(dhwActualW) || dhwActualW < 0))
                return this.stop(d, 'EHZ-Leistung fuer gemeinsames LPC-Budget fehlt/ungueltig');
            maxA = Math.min(maxA,
                Math.max(0, Number(consumptionLimit.budgetW) - (coordinated ? coordinated.otherW : dhwActualW)) / (230 * phases));
        }
        const houseConnection = houseConnectionSettings(this.adapter.config);
        const haLimit = houseConnection.fuseA;
        const increaseLimit = houseConnection.increaseLimitA;
        let otherPendingW = [0, 0, 0];
        const coordination = this.adapter.engineContext;
        if (typeof coordination?.coordinatedEnergyEnabled === 'function' && coordination.coordinatedEnergyEnabled()) {
            if (typeof coordination.coordinatedPhaseReservations !== 'function')
                return this.stop(d, 'Gemeinsame Phasenreserve fehlt');
            const reservation = coordination.coordinatedPhaseReservations(`Wallbox${wb}`);
            if (!reservation.valid) return this.stop(d, 'Gemeinsame Phasenreserve ungueltig');
            otherPendingW = reservation.otherW;
        }
        const used = phases === 3 ? [0, 1, 2] : [phaseIndex];
        const measuredA = Math.max(...current);
        for (const p of used) {
            // Three-phase currents need not be balanced. Each phase can only
            // reclaim its own measured load, never the largest other phase.
            const ownPhaseA = phases === 3 ? current[p] : measuredA;
            const reservedHouseA = house[p] + otherPendingW[p] / 230;
            maxA = Math.min(maxA, ownPhaseA + haLimit - reservedHouseA);
            if (reservedHouseA > increaseLimit) maxA = Math.min(maxA, ownPhaseA);
        }
        maxA = Math.floor(maxA);
        if (!Number.isFinite(maxA) || !Number.isFinite(baseMinimumA)
            || baseMinimumA > 32 || !Number.isFinite(haLimit) || !Number.isFinite(increaseLimit))
            return this.stop(d, 'Ladestrom-/Hausanschlusskonfiguration ungueltig');
        if (maxA < baseMinimumA) return this.stop(d, 'Sicherheitsgrenze liegt unter Hardware-Mindeststrom');
        // No initialization wait may bypass physical protection or expiry.
        if (d.recovering) {
            if (this.own('Control.RestartHandoffActive') === true && !this.restartHandoffWaiting(d))
                return this.stop(d, 'Neustart-Uebergabe abgelaufen oder Zeitstempel ungueltig');
            if (allow !== 1) return this.stop(d, 'Neustart: vorherige Ladefreigabe nicht mehr aktiv');
            if (!Number.isInteger(feedbackA) || feedbackA < baseMinimumA || feedbackA > maxA)
                return this.stop(d, 'Neustart: bestaetigter Ladestrom ausserhalb der sicheren Grenzen');
            if (reason === 'WAIT_RESTART_HANDOFF'
                || (this.restartHandoffWaiting(d) && !this.restartDataFresh())) {
                d.handoffReadySince = 0;
                this.publish(wb, 'OutputStatus',
                    'Neustart-Uebergabe: Wallbox laeuft weiter; warte auf frisch berechneten Fahrplan/Regler');
                return;
            }
            const settleSeconds = Number(this.adapter.config.wallboxRestartHandoffSettleS ?? 10);
            const settleMs = (Number.isFinite(settleSeconds) ? Math.max(0, settleSeconds) : 10) * 1000;
            if (d.handoffReadySince <= 0) d.handoffReadySince = Date.now();
            if (Date.now() - d.handoffReadySince < settleMs) {
                const remainingS = Math.max(1,
                    Math.ceil((settleMs - (Date.now() - d.handoffReadySince)) / 1000));
                this.publish(wb, 'OutputStatus',
                    `Neustart-Uebergabe: EMS-Daten noch ${remainingS} s stabilisieren`);
                return;
            }
            d.recovering = false;
            d.lastA = feedbackA;
            d.lastAt = Date.now();
            d.activeSince = Date.now();
            d.recoveredAt = Date.now();
            d.pending = null;
            this.publish(wb, 'OutputActive', true);
            this.publish(wb, 'OutputOwned', true);
            this.publish(wb, 'OutputCommand_A', feedbackA);
            this.publish(wb, 'OutputReservedPower_W', feedbackA * phases * 230);
            this.finishRestartHandoff();
            this.adapter.log.info?.(`Wallbox ${wb}: laufenden Auftrag mit ${feedbackA} A nach Neustart uebernommen`);
        }
        const targetGridW = Number(this.own('Control.TargetGridPower_W') ?? -100);
        const belowMin = soc < Number(this.own(`Vehicles.Wallbox${wb}.MinimumSoC_pct`));
        const mandatory = belowMin || (this.value(wb, 'DeadlineEnabled', false)
            && this.own(`Vehicles.Wallbox${wb}.MustCharge`))
            || Number(this.own(`Vehicles.Wallbox${wb}.ManualMinimumCurrent_A`) || 0) > 0;
        const requestedMinimumA = Number(this.own(`Vehicles.Wallbox${wb}.RequestedMinimumCurrent_A`) || 0);
        if (!Number.isFinite(requestedMinimumA)) return this.stop(d, 'Mindestladestrom ungueltig');
        const minimumA = mandatory
            ? Math.min(maxA, Math.max(baseMinimumA, Math.ceil(requestedMinimumA))) : baseMinimumA;
        const planW = Number(this.own(`Control.Targets.Wallbox${wb}_W`));
        if (!Number.isFinite(planW) || planW < 0 || !Number.isFinite(targetGridW))
            return this.stop(d, 'EMS-Leistungs-/Netzvorgabe fehlt oder ungueltig');
        const nvpW = Math.max(0, actualKW * 1000 + targetGridW - (importW - exportW));
        let requestedW = mandatory ? Math.max(planW, minimumA * phases * 230)
            : combined ? planW : Math.min(planW, nvpW);
        // While the external script changes the go-e mode, keep an already
        // running output at its confirmed current and phase topology. All hard
        // caps above still apply, and no current increase is allowed before the
        // new mode is acknowledged.
        if (phaseSwitchPending) {
            if (!d.owned) {
                this.publish(wb, 'OutputStatus',
                    `Warten auf go-e-Phasenumschaltung: Soll ${desiredPhases}P / bestaetigt ${confirmedPhases}P`);
                return;
            }
            const holdA = Math.min(maxA, Math.max(minimumA, d.lastA || feedbackA));
            requestedW = holdA * phases * 230;
        }
        let amps = Math.floor(Math.min(maxA, requestedW / (230 * phases)));
        const minimumRunSeconds = Number(this.adapter.config.wallboxMinimumRunTimeS ?? 120);
        const minimumRunMs = (Number.isFinite(minimumRunSeconds) ? Math.max(0, minimumRunSeconds) : 120) * 1000;
        const minimumRunActive = d.owned && allow === 1 && d.activeSince > 0
            && Date.now() - d.activeSince < minimumRunMs;
        const startSequenceActive = d.owned && d.pending?.start === true
            && ['current', 'allow'].includes(d.pending.stage);
        const restartGraceSeconds = Number(this.adapter.config.wallboxRestartHandoffGraceS ?? 30);
        const restartGraceMs = (Number.isFinite(restartGraceSeconds) ? Math.max(10, restartGraceSeconds) : 30) * 1000;
        const restartGraceActive = d.owned && allow === 1 && d.recoveredAt > 0
            && Date.now() - d.recoveredAt < restartGraceMs;
        const minimumRunRemainingS = minimumRunActive
            ? Math.max(0, Math.ceil((minimumRunMs - (Date.now() - d.activeSince)) / 1000)) : 0;
        const softShortfall = !Number.isFinite(amps) || amps < minimumA;
        const stopDelaySeconds = Number(this.adapter.config.wallboxStopDelayS ?? 120);
        const stopDelayMs = (Number.isFinite(stopDelaySeconds) ? Math.max(0, stopDelaySeconds) : 120) * 1000;
        if (softShortfall && d.owned && allow === 1 && d.shortfallSince <= 0)
            d.shortfallSince = Date.now();
        if (!softShortfall) d.shortfallSince = 0;
        const stopDelayActive = softShortfall && d.shortfallSince > 0
            && Date.now() - d.shortfallSince < stopDelayMs;
        const stopDelayRemainingS = stopDelayActive
            ? Math.max(0, Math.ceil((stopDelayMs - (Date.now() - d.shortfallSince)) / 1000)) : 0;
        this.publish(wb, 'StopDelayActive', stopDelayActive);
        this.publish(wb, 'StopDelayRemaining_s', stopDelayRemainingS);
        if (softShortfall) {
            if (!minimumRunActive && !restartGraceActive && !startSequenceActive && !stopDelayActive) {
                const startDelayActive = this.own(`Vehicles.Wallbox${wb}.StartDelayActive`) === true;
                const remainingS = Number(this.own(`Vehicles.Wallbox${wb}.StartDelayRemaining_s`) || 0);
                return this.stop(d, startDelayActive
                    ? `Einschaltverzoegerung: noch ${Math.max(0, Math.ceil(remainingS))} s`
                    : 'Budget/Begrenzung unter Mindeststrom');
            }
            // All hard gates and current/§14a/house-connection caps have already
            // passed. Only a soft surplus shortfall is overridden here.
            amps = Math.ceil(minimumA);
        }
        this.publish(wb, 'FeedbackCurrent_A', feedbackA);
        this.publish(wb, 'AvailableCurrent_A', available);
        this.publish(wb, 'OutputPhases', phases);
        const dhwTargetW = Number(this.own('Control.Targets.MyPV_DHW_W') || 0);
        const dhwSettleToleranceW = Math.max(50,
            Number(this.own('Config.DHWSettleTolerance_W') || 300));
        const dhwReadyForWallboxIncrease = !combined
            || (Number.isFinite(dhwActualW) && dhwActualW >= 0 && Number.isFinite(dhwTargetW)
                && dhwActualW <= dhwTargetW + dhwSettleToleranceW);
        // Only residual EHZ power needs to fall before a WB increase. Waiting
        // for EHZ ramp-UP creates a deadlock when its thermal/release gate is off.
        // Start from a confirmed stopped charger. Persist ownership before first write.
        if (!d.owned) {
            if (!dhwReadyForWallboxIncrease) {
                this.publish(wb, 'OutputStatus',
                    `Warten auf EHZ-Feinregler: Ist ${Math.round(dhwActualW)} W / Ziel ${Math.round(dhwTargetW)} W`);
                return;
            }
            d.owned = true;
            await this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.OutputOwned`, true, true);
            d.pending = {stage: 'stop', at: Date.now()};
            await this.send(d, 'allow', 0);
            this.publish(wb, 'OutputStatus', 'Start: Ladefreigabe aus, Rueckmeldung abwarten');
            return;
        }
        if (d.pending) {
            const pending = d.pending;
            if (pending.stage === 'stop') {
                if (this.number(d.ids.allow, deviceMaxAgeMs) !== 0
                    || this.state(d.ids.allow).ts < pending.at) return;
                d.pending = {stage: 'current', amps: minimumA, at: Date.now(), start: true};
                await this.send(d, 'command', minimumA);
                return;
            }
            // A lower still-valid current target supersedes an outstanding
            // increase. Stopping the charger here used to turn an ordinary
            // WB/EHZ reallocation into allow=0 and a new start delay. Hard
            // gates and caps have already returned above; therefore replace
            // the command and wait for its acknowledgement instead.
            if (amps < pending.amps) {
                const resumeStart = pending.start === true || pending.stage === 'allow';
                d.pending = {stage: 'current', amps, at: Date.now(), start: resumeStart};
                await this.send(d, 'command', amps);
                this.publish(wb, 'OutputStatus',
                    `Sinkendes Soll: offenen Befehl durch ${amps} A ersetzt; Rueckmeldung abwarten`);
                return;
            }
            if (pending.stage === 'current') {
                if (this.number(d.ids.feedback, deviceMaxAgeMs) !== pending.amps
                    || this.state(d.ids.feedback).ts < pending.at) return;
                if (pending.start) {
                    d.pending = {stage: 'allow', amps: pending.amps, at: Date.now(), start: true};
                    await this.send(d, 'allow', 1);
                    return;
                }
            } else if (this.number(d.ids.allow, deviceMaxAgeMs) !== 1
                || this.state(d.ids.allow).ts < pending.at) return;
            d.lastA = pending.amps;
            this.publish(wb, 'OutputReservedPower_W', d.lastA * phases * 230);
            d.lastAt = Date.now();
            if (pending.stage === 'allow' && d.activeSince <= 0) d.activeSince = Date.now();
            d.pending = null;
        }
        if (allow !== 1) return this.stop(d, 'Ladefreigabe extern entzogen');
        if (feedbackA !== d.lastA) return this.stop(d, 'Ladestrom extern veraendert; konkurrierenden Regler pruefen');
        // A confirmed phase change may keep the same ampere command. Its
        // reservation must then follow the new topology even without a write.
        this.publish(wb, 'OutputReservedPower_W', d.lastA * phases * 230);
        this.publish(wb, 'OutputActive', true);
        this.publish(wb, 'OutputCommand_A', d.lastA);
        if (d.activeSince <= 0) d.activeSince = Date.now();
        const recoveryStatus = Date.now() - d.recoveredAt < 60000 ? '; nach Neustart uebernommen' : '';
        const runStatus = minimumRunActive
            ? `; Mindestlaufzeit noch ${minimumRunRemainingS} s` : '';
        const stopDelayStatus = stopDelayActive
            ? `; Leistungsdelle: ${minimumA} A, Abschaltung fruehestens in ${stopDelayRemainingS} s` : '';
        const graceStatus = restartGraceActive ? '; Neustart-Sollwertschutz aktiv' : '';
        const phaseStatus = phaseSwitchPending
            ? `; warte auf ${desiredPhases}P (bestaetigt ${confirmedPhases}P)`
            : phaseSwitchEnabled ? '; dynamische Phasen bestaetigt' : '; feste Topologie';
        this.publish(wb, 'OutputStatus', `PRODUKTIV: ${d.lastA} A / ${phases} Phase(n)${phaseStatus}${combined ? '; EHZ-Feinregelung' : ''}${runStatus}${stopDelayStatus}${graceStatus}${recoveryStatus}`);
        const cycleMs = Math.max(2, Number(this.adapter.config.slowCycleS ?? 5)) * 1000;
        const ramp = Math.max(1, Number(combined
            ? this.adapter.config.wallboxCombinedMaxStepA ?? 1
            : this.adapter.config.wallboxMaxStepA ?? 6));
        amps = Math.min(amps, d.lastA + ramp);
        if (amps > d.lastA && Date.now() - d.lastAt < cycleMs) return;
        if (amps > d.lastA && !dhwReadyForWallboxIncrease) {
            this.publish(wb, 'OutputStatus',
                `Warten auf EHZ-Feinregler: Ist ${Math.round(dhwActualW)} W / Ziel ${Math.round(dhwTargetW)} W`);
            return;
        }
        // Never wind up commands when the car/device is not taking the requested current.
        if (amps > d.lastA && measuredA < d.lastA - 3) {
            this.publish(wb, 'OutputStatus', 'Warten: Fahrzeug/go-e nimmt vorgegebenen Ladestrom noch nicht ab');
            return;
        }
        if (amps !== d.lastA) {
            d.pending = {stage: 'current', amps, at: Date.now(), start: false};
            await this.send(d, 'command', amps);
            this.publish(wb, 'OutputStatus', `Befehl ${amps} A gesendet; bestaetigte Rueckmeldung abwarten`);
        }
    }

    async tick() {
        if (!this.ready || this.busy || this.stopping) return;
        this.busy = true;
        try {
            const mapping = this.adapter.readMapping();
            for (const d of this.devices) {
                try { await this.update(d, mapping); }
                catch (error) {
                    d.fault = `Schreib-/Regelfehler: ${error.message}`;
                    this.publish(d.wb, 'OutputFault', d.fault);
                    this.adapter.log.error(d.fault);
                    try { await this.stop(d, d.fault); } catch (stopError) { this.adapter.log.error(stopError.message); }
                }
            }
            const dhw = this.own('Devices.MyPV_DHW.OutputActive') === true
                || this.own('Devices.MyPV_DHW.OutputOwned') === true;
            const active = this.devices.some(d => d.owned);
            const extensions = ['Battery', 'MyPV_Heating'].some(name =>
                this.own(`Devices.${name}.OutputOwned`) === true || this.own(`Devices.${name}.OutputActive`) === true);
            this.adapter.setCompatState(`${this.adapter.namespace}.System.NoActuation`, !dhw && !active && !extensions, true);
            this.adapter.setCompatState(`${this.adapter.namespace}.Control.Mode`,
                extensions ? 'ALPHA_ENERGY_COORDINATED' : this.mode(active, dhw), true);
        } finally {
            this.busy = false;
            for (const resolve of this.idleWaiters.splice(0)) resolve();
        }
    }

    async stopAll() {
        // Calls already in progress see stopping before any subsequent enabling write.
        const results = await Promise.allSettled(this.devices.filter(d => d.owned)
            .map(d => this.stop(d, 'Adapter wird beendet')));
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map(result => result.reason),
            'Nicht alle Wallbox-Ausgaenge konnten gestoppt werden');
    }
}

module.exports = WallboxOutput;
