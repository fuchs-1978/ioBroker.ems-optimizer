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
    }

    own(id) { return this.adapter.getCachedState(`${this.adapter.namespace}.${id}`)?.val; }
    state(id) { return id ? this.adapter.getCachedState(id) : null; }
    number(id, maxAge = 15000) {
        const s = this.state(id);
        if (!s || s.val === null || s.val === '' || s.ack !== true || (s.q && s.q !== 0)
            || Date.now() - s.ts > maxAge || s.ts > Date.now() + 1000) return null;
        const value = Number(s.val);
        return Number.isFinite(value) ? value : null;
    }
    value(wb, key, fallback) { return this.adapter.config[`wb${wb}${key}`] ?? fallback; }
    publish(wb, key, value) {
        this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.${key}`, value, true);
    }

    alphaEnabled() { return this.adapter.config.multiWallboxAlphaArmed === true; }

    hasActiveOwnedOutput() {
        return this.devices.some(d => d.owned
            && this.own(`Devices.Wallbox${d.wb}.OutputActive`) === true);
    }

    finishRestartHandoff() {
        this.adapter.setCompatState(`${this.adapter.namespace}.Control.RestartHandoffActive`, false, true);
    }

    restartHandoffWaiting(d) {
        const handoffSince = Number(this.own('Control.RestartHandoffSince') || 0);
        const handoffTimeoutMs = Math.max(30,
            Number(this.adapter.config.wallboxRestartHandoffTimeoutS ?? 180)) * 1000;
        return d.recovering && this.own('Control.RestartHandoffActive') === true
            && handoffSince > 0 && Date.now() - handoffSince <= handoffTimeoutMs;
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
        const value = this.state(id)?.val;
        if (value === true || value === 1 || value === '1') return true;
        if (value === false || value === 0 || value === '0') return false;
        return null;
    }

    freshValue(id, maxAge = 15000) {
        if (!id) return null;
        const state = this.state(id);
        if (!state || state.val === null || state.val === '' || state.ack !== true
            || (state.q && state.q !== 0) || Date.now() - state.ts > maxAge
            || state.ts > Date.now() + 1000) return null;
        return state.val;
    }

    staticValue(id) {
        if (!id) return null;
        const state = this.state(id);
        if (!state || state.val === null || state.val === '' || state.ack !== true
            || (state.q && state.q !== 0) || state.ts > Date.now() + 1000) return null;
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
        const rawHeatPumpW = this.freshValue(mapping.DP_HEAT_PUMP_POWER);
        const heatPumpW = Number(rawHeatPumpW);
        if (rawHeatPumpW === null || !Number.isFinite(heatPumpW) || heatPumpW < 0) {
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
            && this.adapter.config.combinedProductionArmed === true
            && this.booleanInput(mapping.DP_DHW_PARALLEL_RELEASE) === true;
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
        await this.adapter.setStateAsync(`Devices.Wallbox${d.wb}.OutputOwned`, true, true);
        this.publish(d.wb, 'OutputOwned', true);
        this.publish(d.wb, 'OutputActive', false);
        this.publish(d.wb, 'OutputCommand_A', 0);
        this.publish(d.wb, 'OutputStatus', 'ALPHA-Uebernahme: fremde Ladefreigabe sicher ausschalten');
        await this.send(d, 'allow', 0);
        return true;
    }

    async initialize() {
        const mapping = this.adapter.readMapping();
        for (let wb = 0; wb < 3; wb++) {
            const ids = {};
            for (const [key, suffix] of Object.entries({command: 'AmpereOutputId', allow: 'AllowOutputId',
                feedback: 'AmpereFeedbackId', connection: 'ConnectionId', error: 'ErrorId', available: 'AvailableCurrentId'})) {
                ids[key] = String(this.value(wb, suffix, '')).trim();
            }
            const d = {wb, ids, owned: false, recovering: false, wasOwned: false, wasActive: false,
                recoveredAt: 0, activeSince: 0, pending: null, lastA: 0, lastAt: 0,
                fault: '', valid: false};
            this.devices.push(d);
            const definitions = {OutputActive: false, OutputOwned: false, OutputCommand_A: 0,
                OutputPhases: 1, OutputStatus: 'Simulation; Ausgang gesperrt', OutputLastWrite: 0,
                OutputFault: '', FeedbackCurrent_A: 0, AvailableCurrent_A: 0};
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
            if (ids.command && ids.allow && ids.command !== ids.allow && ids.feedback
                && ids.connection && ids.error && mapping[`DP_WB${wb}_CAR`] && mapping[`DP_WB${wb}_SOC`]) {
                const objects = await Promise.all([ids.command, ids.allow].map(id => this.adapter.getForeignObjectAsync(id)));
                d.valid = objects.every(o => o?.type === 'state' && o.common?.write === true && o.common?.type === 'number');
            }
            d.wasOwned = this.own(`Devices.Wallbox${wb}.OutputOwned`) === true;
            d.wasActive = this.own(`Devices.Wallbox${wb}.OutputActive`) === true;
        }
        const outputIds = this.devices.flatMap(d => [d.ids.command, d.ids.allow]).filter(Boolean);
        for (const d of this.devices) {
            if ([d.ids.command, d.ids.allow].some(id => id && (outputIds.filter(x => x === id).length > 1
                || id === this.adapter.config.dhwSetpointId))) d.valid = false;
            this.publish(d.wb, 'OutputFault', '');
            d.owned = d.valid && d.wasOwned;
            d.recovering = d.owned && d.wasActive;
            if (d.recovering) {
                this.publish(d.wb, 'OutputStatus', 'Neustart: sichere Wiederuebernahme wird geprueft');
            } else if (d.owned) await this.stop(d, 'Neustart: unvollstaendigen Auftrag stoppen');
            else {
                this.publish(d.wb, 'OutputActive', false);
                this.publish(d.wb, 'OutputOwned', false);
                this.publish(d.wb, 'OutputCommand_A', 0);
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
        await this.adapter.setForeignStateAsync(d.ids[key], value, false);
        this.publish(d.wb, 'OutputLastWrite', Date.now());
    }

    async stop(d, reason) {
        const wasRecovering = d.recovering;
        this.publish(d.wb, 'OutputActive', false);
        this.publish(d.wb, 'OutputCommand_A', 0);
        this.publish(d.wb, 'OutputStatus', reason);
        d.pending = null;
        d.recovering = false;
        d.activeSince = 0;
        d.lastA = 0;
        if (wasRecovering) this.finishRestartHandoff();
        if (!d.owned) return;
        if (this.number(d.ids.allow) === 0) {
            d.owned = false;
            this.publish(d.wb, 'OutputOwned', false);
        } else await this.send(d, 'allow', 0);
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
            && Number(this.own('Control.SelectedWallbox')) !== wb)
            return `Sequenzbetrieb: Wallbox ${Number(this.own('Control.SelectedWallbox'))} ausgewaehlt`;
        const otherOwned = this.devices.find(x => x.wb !== wb && x.owned);
        if (otherOwned) return `Sequenzbetrieb: Wallbox ${otherOwned.wb} wird zuerst beendet`;
        if (this.alphaEnabled()) {
            const otherReleased = this.devices.find(x => x.wb !== wb && x.valid
                && this.number(x.ids.allow) === 1);
            if (otherReleased) return `Sequenzbetrieb: Ladefreigabe Wallbox ${otherReleased.wb} noch aktiv`;
        }
        if (this.own('Devices.MyPV_DHW.ControlEnabled') && !this.combinedMode(mapping))
            return 'EHZ gleichzeitig freigegeben, gemeinsame Produktion aber nicht sicher bestaetigt';
        if (!this.state(d.ids.connection) || this.state(d.ids.connection).val !== true) return 'Wallbox offline';
        const errorCode = this.number(d.ids.error);
        if (errorCode === null && this.restartHandoffWaiting(d)) return 'WAIT_RESTART_HANDOFF';
        if (errorCode !== 0) return 'Wallbox meldet Fehler oder Fehlerstatus fehlt';
        const carState = this.number(mapping[`DP_WB${wb}_CAR`]);
        if (carState === null && this.restartHandoffWaiting(d)) return 'WAIT_RESTART_HANDOFF';
        if (carState === null) return 'Fahrzeugstatus fehlt oder ist veraltet';
        if (![2, 3, 4].includes(carState)) return 'Kein Fahrzeug angeschlossen';
        if (!this.own(`Vehicles.Wallbox${wb}.SoCValid`))
            return 'Fahrzeug-SoC fehlt oder ist aelter als 2 Stunden';
        const socState = this.state(mapping[`DP_WB${wb}_SOC`]);
        if (socState?.ack !== true) return 'SoC-Datenpunkt unbestaetigt (ack=false)';
        const soc = this.number(mapping[`DP_WB${wb}_SOC`], 7200000);
        if (soc === null || soc < 0) return 'SoC ungueltig oder veraltet';
        const targetSoc = Number(this.own(`Vehicles.Wallbox${wb}.TargetSoC_pct`));
        if (soc >= targetSoc) return `Ziel-SoC erreicht (${soc} >= ${targetSoc} %)`;
        if (!this.own(`Vehicles.Wallbox${wb}.Release`)) return 'Keine Fahrzeugfreigabe';
        const userAllow = mapping[`DP_WB${wb}_ALLOW`];
        if (userAllow && ![true, 1].includes(this.state(userAllow)?.val)) return 'Benutzerfreigabe fehlt';
        const critical = this.state(mapping.DP_HA_CRITICAL);
        if ((!critical || critical.val === null) && this.restartHandoffWaiting(d))
            return 'WAIT_RESTART_HANDOFF';
        if (!critical || ![false, 0].includes(critical.val)) return 'Hausanschlussschutz aktiv/fehlt';
        if (!consumptionLimit.valid && this.restartHandoffWaiting(d)
            && /fehlt|ungueltig/.test(consumptionLimit.reason)) return 'WAIT_RESTART_HANDOFF';
        if (!consumptionLimit.valid) return consumptionLimit.reason;
        if (!this.own('Control.Enabled') || !this.own('System.DataValid') || !this.own('Control.Valid')
            || Date.now() - Number(this.own('System.LastUpdate') || 0) > 30000
            || Date.now() - Number(this.own('Control.LastUpdate') || 0) > 10000) {
            if (this.restartHandoffWaiting(d))
                return 'WAIT_RESTART_HANDOFF';
            return 'EMS-/Reglerdaten ungueltig oder veraltet';
        }
        return '';
    }

    async update(d, mapping) {
        if (await this.enforceAlphaAuthority(d)) return;
        const consumptionLimit = this.gridOperatorLimit(mapping);
        const reason = this.gate(d, mapping, consumptionLimit);
        if (reason === 'WAIT_RESTART_HANDOFF') {
            this.publish(d.wb, 'OutputStatus',
                'Neustart-Uebergabe: Wallbox laeuft weiter; warte auf frische EMS-/Reglerdaten');
            return;
        }
        if (reason || d.fault) return this.stop(d, d.fault || reason);
        const wb = d.wb;
        const phases = Number(this.value(wb, 'ProductionPhases', 1));
        const phaseIndex = Number(this.value(wb, 'SinglePhaseGridPhase', 1)) - 1;
        if (![1, 3].includes(phases) || ![0, 1, 2].includes(phaseIndex)
            || (phases === 3 && !this.value(wb, 'PhaseSwitchEnabled', false)))
            return this.stop(d, 'Feste Phasenkonfiguration ungueltig');
        const baseMinimumA = Math.max(6,
            Number(this.value(wb, phases === 3 ? 'MinCurrent3pA' : 'MinCurrent1pA', 6)));
        let maxA = Math.min(32, Number(this.value(wb, phases === 3 ? 'MaxCurrent3pA' : 'MaxCurrent1pA', 16)),
            Number(this.value(wb, 'CommissioningMaxA', 6)),
            Number(this.value(wb, 'MaxPowerW', 11000)) / (230 * phases));
        const soc = this.number(mapping[`DP_WB${wb}_SOC`], 7200000);
        const targetSoc = Number(this.own(`Vehicles.Wallbox${wb}.TargetSoC_pct`));
        if (this.value(wb, 'TaperEnabled', false)) for (const stage of [1, 2]) {
            if (soc >= targetSoc - Number(this.value(wb, `Taper${stage}DeltaPct`, stage === 1 ? 5 : 2)))
                maxA = Math.min(maxA, Number(this.value(wb, `Taper${stage}MaxA`, stage === 1 ? 13 : 8)));
        }
        const current = [1, 2, 3].map(p => this.number(mapping[`DP_WB${wb}_L${p}_A`]));
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
        const actualKW = this.number(mapping[`DP_WB${wb}_POWER`]);
        const importW = this.number(mapping.DP_GRID_IMPORT, 10000);
        const exportW = this.number(mapping.DP_GRID_EXPORT, 10000);
        const feedbackA = this.number(d.ids.feedback);
        const allow = this.number(d.ids.allow);
        const measured = [...current, actualKW, importW, exportW, feedbackA, allow, ...house];
        if (measured.some(v => v === null) && this.restartHandoffWaiting(d)) {
            this.publish(d.wb, 'OutputStatus',
                'Neustart-Uebergabe: Wallbox laeuft weiter; warte auf frische Messwerte');
            return;
        }
        if ([...current, actualKW, importW, exportW, feedbackA, allow].some(v => v === null || v < 0)
            || house.some(v => v === null || (!directionalConfigured && v < 0)))
            return this.stop(d, 'Messwert/Rueckmeldung fehlt oder ist veraltet');
        if (phases === 1 && (current[1] > 1 || current[2] > 1))
            return this.stop(d, 'Gemessene Phasen passen nicht zur festen Einphasen-Konfiguration');
        if (![0, 1].includes(allow)) return this.stop(d, 'Ungueltige Ladefreigabe-Rueckmeldung');
        const available = d.ids.available ? this.number(d.ids.available) : 32;
        if (available === null && this.restartHandoffWaiting(d)) {
            this.publish(d.wb, 'OutputStatus',
                'Neustart-Uebergabe: Wallbox laeuft weiter; warte auf verfuegbaren Ladestrom');
            return;
        }
        if (available === null || available < 0) return this.stop(d, 'Verfuegbarer go-e-Ladestrom fehlt');
        maxA = Math.min(maxA, available);
        if (consumptionLimit.active) maxA = Math.min(maxA,
            Number(consumptionLimit.budgetW) / (230 * phases));
        const houseConnection = houseConnectionSettings(this.adapter.config);
        const haLimit = houseConnection.fuseA;
        const increaseLimit = houseConnection.increaseLimitA;
        const used = phases === 3 ? [0, 1, 2] : [phaseIndex];
        const measuredA = Math.max(...current);
        for (const p of used) {
            maxA = Math.min(maxA, measuredA + haLimit - house[p]);
            if (house[p] > increaseLimit) maxA = Math.min(maxA, measuredA);
        }
        if (maxA < baseMinimumA) return this.stop(d, 'Sicherheitsgrenze liegt unter Hardware-Mindeststrom');
        const minimumA = Math.min(maxA, Math.max(baseMinimumA,
            Number(this.own(`Vehicles.Wallbox${wb}.RequestedMinimumCurrent_A`) || 0)));
        const targetGridW = Number(this.own('Control.TargetGridPower_W') ?? -100);
        const belowMin = soc < Number(this.own(`Vehicles.Wallbox${wb}.MinimumSoC_pct`));
        const mandatory = belowMin || (this.value(wb, 'DeadlineEnabled', false)
            && this.own(`Vehicles.Wallbox${wb}.MustCharge`))
            || Number(this.own(`Vehicles.Wallbox${wb}.ManualMinimumCurrent_A`) || 0) > 0;
        const planW = Number(this.own(`Control.Targets.Wallbox${wb}_W`));
        const nvpW = Math.max(0, actualKW * 1000 + targetGridW - (importW - exportW));
        const combined = this.combinedMode(mapping);
        const requestedW = mandatory ? Math.max(planW, minimumA * phases * 230)
            : combined ? planW : Math.min(planW, nvpW);
        let amps = Math.floor(Math.min(maxA, requestedW / (230 * phases)));
        const minimumRunMs = Math.max(0,
            Number(this.adapter.config.wallboxMinimumRunTimeS ?? 120)) * 1000;
        const minimumRunActive = d.owned && allow === 1 && d.activeSince > 0
            && Date.now() - d.activeSince < minimumRunMs;
        const minimumRunRemainingS = minimumRunActive
            ? Math.max(0, Math.ceil((minimumRunMs - (Date.now() - d.activeSince)) / 1000)) : 0;
        if (!Number.isFinite(amps) || amps < minimumA) {
            if (!minimumRunActive) {
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
        const dhwActualW = Number(this.own('Actual.MyPV_DHW_W') || 0);
        const dhwSettleToleranceW = Math.max(50,
            Number(this.own('Config.DHWSettleTolerance_W') || 300));
        const dhwReadyForWallboxIncrease = !combined
            || (Math.abs(dhwActualW - dhwTargetW) <= dhwSettleToleranceW
                && (dhwTargetW <= 0 || this.own('Devices.MyPV_DHW.OutputActive') === true));
        // After an unclean restart, adopt only an output that was both owned and
        // active before the restart and still passes every current safety check.
        // A clean stop/disable leaves allow=0 and therefore cannot be adopted.
        if (d.recovering) {
            d.recovering = false;
            if (allow !== 1) return this.stop(d, 'Neustart: vorherige Ladefreigabe nicht mehr aktiv');
            if (!Number.isInteger(feedbackA) || feedbackA < minimumA || feedbackA > maxA)
                return this.stop(d, 'Neustart: bestaetigter Ladestrom ausserhalb der sicheren Grenzen');
            d.lastA = feedbackA;
            d.lastAt = Date.now();
            const previousOutput = this.state(`${this.adapter.namespace}.Devices.Wallbox${wb}.OutputActive`);
            const previousStart = Number(previousOutput?.lc || previousOutput?.ts || 0);
            d.activeSince = previousStart > 0 && previousStart <= Date.now()
                ? previousStart : Date.now();
            d.recoveredAt = Date.now();
            d.pending = null;
            this.publish(wb, 'OutputActive', true);
            this.publish(wb, 'OutputOwned', true);
            this.publish(wb, 'OutputCommand_A', feedbackA);
            this.publish(wb, 'OutputStatus',
                `Neustart: laufenden Auftrag sicher uebernommen (${feedbackA} A)`);
            this.finishRestartHandoff();
            this.adapter.log.info?.(`Wallbox ${wb}: laufenden Auftrag mit ${feedbackA} A nach Neustart uebernommen`);
        }
        // Start from a confirmed stopped charger. Persist ownership before first write.
        if (!d.owned) {
            if (!dhwReadyForWallboxIncrease) {
                this.publish(wb, 'OutputStatus',
                    `Warten auf EHZ-Feinregler: Ist ${Math.round(dhwActualW)} W / Ziel ${Math.round(dhwTargetW)} W`);
                return;
            }
            d.owned = true;
            await this.adapter.setStateAsync(`Devices.Wallbox${wb}.OutputOwned`, true, true);
            this.publish(wb, 'OutputOwned', true);
            d.pending = {stage: 'stop', at: Date.now()};
            await this.send(d, 'allow', 0);
            this.publish(wb, 'OutputStatus', 'Start: Ladefreigabe aus, Rueckmeldung abwarten');
            return;
        }
        const timeout = Number(this.value(wb, 'FeedbackTimeoutS', 20)) * 1000;
        if (d.pending) {
            const pending = d.pending;
            if (Date.now() - pending.at > timeout) {
                d.fault = 'Keine passende go-e-Rueckmeldung; Ausgang gesperrt bis Adapter-Neustart';
                this.publish(wb, 'OutputFault', d.fault);
                return this.stop(d, d.fault);
            }
            if (pending.stage === 'stop') {
                if (allow !== 0 || this.state(d.ids.allow).ts < pending.at) return;
                d.pending = {stage: 'current', amps: minimumA, at: Date.now(), start: true};
                await this.send(d, 'command', minimumA);
                return;
            }
            // A newly lower safety limit always wins over an outstanding command.
            if (amps < pending.amps) return this.stop(d, 'Budget/Schutzgrenze waehrend Rueckmeldung gesunken');
            if (pending.stage === 'current') {
                if (feedbackA !== pending.amps || this.state(d.ids.feedback).ts < pending.at) return;
                if (pending.start) {
                    d.pending = {stage: 'allow', amps: pending.amps, at: Date.now()};
                    await this.send(d, 'allow', 1);
                    return;
                }
            } else if (allow !== 1 || this.state(d.ids.allow).ts < pending.at) return;
            d.lastA = pending.amps;
            d.lastAt = Date.now();
            if (pending.stage === 'allow' && d.activeSince <= 0) d.activeSince = Date.now();
            d.pending = null;
        }
        if (allow !== 1) return this.stop(d, 'Ladefreigabe extern entzogen');
        if (feedbackA !== d.lastA) return this.stop(d, 'Ladestrom extern veraendert; konkurrierenden Regler pruefen');
        this.publish(wb, 'OutputActive', true);
        this.publish(wb, 'OutputCommand_A', d.lastA);
        if (d.activeSince <= 0) d.activeSince = Date.now();
        const recoveryStatus = Date.now() - d.recoveredAt < 60000 ? '; nach Neustart uebernommen' : '';
        const runStatus = minimumRunActive
            ? `; Mindestlaufzeit noch ${minimumRunRemainingS} s` : '';
        this.publish(wb, 'OutputStatus', `PRODUKTIV: ${d.lastA} A / ${phases} Phase(n), feste Topologie${combined ? '; EHZ-Feinregelung' : ''}${runStatus}${recoveryStatus}`);
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
            const dhw = this.own('Devices.MyPV_DHW.OutputActive') === true;
            const active = this.devices.some(d => d.owned);
            this.adapter.setCompatState(`${this.adapter.namespace}.System.NoActuation`, !dhw && !active, true);
            this.adapter.setCompatState(`${this.adapter.namespace}.Control.Mode`,
                this.mode(active, dhw), true);
        } finally { this.busy = false; }
    }

    async stopAll() {
        // Calls already in progress see stopping before any subsequent enabling write.
        for (const d of this.devices) if (d.owned) await this.send(d, 'allow', 0);
    }
}

module.exports = WallboxOutput;
