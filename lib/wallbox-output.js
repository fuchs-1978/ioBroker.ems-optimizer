'use strict';

const gridConstraints = require('./grid-constraints');

// First production stage: exactly one wallbox, fixed verified phase topology.
// No external phase contactor or automatic error reset is operated here.
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
        return this.own('Devices.MyPV_DHW.ControlEnabled') === true
            && this.own('Config.DHWParallelDistributionEnabled') === true
            && this.adapter.config.combinedProductionArmed === true
            && this.booleanInput(mapping.DP_DHW_PARALLEL_RELEASE) === true;
    }

    async initialize() {
        const mapping = this.adapter.readMapping();
        for (let wb = 0; wb < 3; wb++) {
            const ids = {};
            for (const [key, suffix] of Object.entries({command: 'AmpereOutputId', allow: 'AllowOutputId',
                feedback: 'AmpereFeedbackId', connection: 'ConnectionId', error: 'ErrorId', available: 'AvailableCurrentId'})) {
                ids[key] = String(this.value(wb, suffix, '')).trim();
            }
            const d = {wb, ids, owned: false, pending: null, lastA: 0, lastAt: 0, fault: '', valid: false};
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
            // Recover ownership after an unclean adapter restart, then establish a stopped baseline.
            d.owned = d.valid && this.own(`Devices.Wallbox${wb}.OutputOwned`) === true;
        }
        const outputIds = this.devices.flatMap(d => [d.ids.command, d.ids.allow]).filter(Boolean);
        for (const d of this.devices) {
            if ([d.ids.command, d.ids.allow].some(id => id && (outputIds.filter(x => x === id).length > 1
                || id === this.adapter.config.dhwSetpointId))) d.valid = false;
            this.publish(d.wb, 'OutputFault', '');
            if (d.owned && d.valid) await this.stop(d, 'Neustart: alten Auftrag stoppen');
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
        this.publish(d.wb, 'OutputActive', false);
        this.publish(d.wb, 'OutputCommand_A', 0);
        this.publish(d.wb, 'OutputStatus', reason);
        d.pending = null;
        d.lastA = 0;
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
        if (this.devices.filter(x => this.value(x.wb, 'ControlEnabled', false)
            && this.value(x.wb, 'Present', true)).length !== 1)
            return 'Genau eine produktive Wallbox muss ausgewaehlt sein';
        if (this.own('Devices.MyPV_DHW.ControlEnabled') && !this.combinedMode(mapping))
            return 'EHZ gleichzeitig freigegeben, gemeinsame Produktion aber nicht sicher bestaetigt';
        if (!this.own('Control.Enabled') || !this.own('System.DataValid') || !this.own('Control.Valid')
            || Date.now() - Number(this.own('System.LastUpdate') || 0) > 30000
            || Date.now() - Number(this.own('Control.LastUpdate') || 0) > 10000)
            return 'EMS-/Reglerdaten ungueltig oder veraltet';
        if (!this.state(d.ids.connection) || this.state(d.ids.connection).val !== true) return 'Wallbox offline';
        if (this.number(d.ids.error) !== 0) return 'Wallbox meldet Fehler oder Fehlerstatus fehlt';
        if (![2, 3, 4].includes(this.number(mapping[`DP_WB${wb}_CAR`]))) return 'Kein Fahrzeug / Status veraltet';
        if (!this.own(`Vehicles.Wallbox${wb}.SoCValid`) || !this.own(`Vehicles.Wallbox${wb}.Release`))
            return 'Keine Fahrzeug-/SoC-Freigabe';
        const soc = this.number(mapping[`DP_WB${wb}_SOC`], 7200000);
        if (soc === null || soc < 0 || soc >= Number(this.own(`Vehicles.Wallbox${wb}.TargetSoC_pct`)))
            return 'SoC ungueltig oder Ziel erreicht';
        const userAllow = mapping[`DP_WB${wb}_ALLOW`];
        if (userAllow && ![true, 1].includes(this.state(userAllow)?.val)) return 'Benutzerfreigabe fehlt';
        const critical = this.state(mapping.DP_HA_CRITICAL);
        if (!critical || ![false, 0].includes(critical.val)) return 'Hausanschlussschutz aktiv/fehlt';
        if (!consumptionLimit.valid) return consumptionLimit.reason;
        return '';
    }

    async update(d, mapping) {
        const consumptionLimit = this.gridOperatorLimit(mapping);
        const reason = this.gate(d, mapping, consumptionLimit);
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
        if ([...current, actualKW, importW, exportW, feedbackA, allow].some(v => v === null || v < 0)
            || house.some(v => v === null || (!directionalConfigured && v < 0)))
            return this.stop(d, 'Messwert/Rueckmeldung fehlt oder ist veraltet');
        if (phases === 1 && (current[1] > 1 || current[2] > 1))
            return this.stop(d, 'Gemessene Phasen passen nicht zur festen Einphasen-Konfiguration');
        if (![0, 1].includes(allow)) return this.stop(d, 'Ungueltige Ladefreigabe-Rueckmeldung');
        const available = d.ids.available ? this.number(d.ids.available) : 32;
        if (available === null || available < 0) return this.stop(d, 'Verfuegbarer go-e-Ladestrom fehlt');
        maxA = Math.min(maxA, available);
        if (consumptionLimit.active) maxA = Math.min(maxA,
            Number(consumptionLimit.budgetW) / (230 * phases));
        const haLimit = Number(this.adapter.config.wallboxHaLimitA ?? 50);
        const increaseLimit = Number(this.adapter.config.wallboxHaIncreaseLimitA ?? 46);
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
        if (!Number.isFinite(amps) || amps < minimumA) return this.stop(d, 'Budget/Begrenzung unter Mindeststrom');
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
            d.pending = null;
        }
        if (allow !== 1) return this.stop(d, 'Ladefreigabe extern entzogen');
        if (feedbackA !== d.lastA) return this.stop(d, 'Ladestrom extern veraendert; konkurrierenden Regler pruefen');
        this.publish(wb, 'OutputActive', true);
        this.publish(wb, 'OutputCommand_A', d.lastA);
        this.publish(wb, 'OutputStatus', `PRODUKTIV: ${d.lastA} A / ${phases} Phase(n), feste Topologie${combined ? '; EHZ-Feinregelung' : ''}`);
        const cycleMs = Math.max(2, Number(this.adapter.config.slowCycleS ?? 5)) * 1000;
        const ramp = Math.max(1, Number(this.adapter.config.wallboxMaxStepA ?? 6));
        amps = Math.min(amps, d.lastA + ramp);
        if (amps > d.lastA && Date.now() - d.lastAt < cycleMs) return;
        if (amps > d.lastA && !dhwReadyForWallboxIncrease) {
            this.publish(wb, 'OutputStatus',
                `Warten auf EHZ-Feinregler: Ist ${Math.round(dhwActualW)} W / Ziel ${Math.round(dhwTargetW)} W`);
            return;
        }
        // Never wind up commands when the car/device is not taking the requested current.
        if (amps > d.lastA && measuredA < d.lastA - 2) {
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
            this.adapter.setCompatState(`${this.adapter.namespace}.Control.Mode`, active && dhw
                ? 'WALLBOX_DHW_COMBINED' : active ? 'WALLBOX_SINGLE_TEST'
                    : dhw ? 'DHW_PRODUCTION' : 'SIMULATION', true);
        } finally { this.busy = false; }
    }

    async stopAll() {
        // Calls already in progress see stopping before any subsequent enabling write.
        for (const d of this.devices) if (d.owned) await this.send(d, 'allow', 0);
    }
}

module.exports = WallboxOutput;
