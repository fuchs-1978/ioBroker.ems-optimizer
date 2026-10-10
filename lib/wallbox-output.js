'use strict';

const gridConstraints = require('./grid-constraints');
const {sourceSnapshot, probeSource, SMA_GRID_MAX_AGE_MS} = require('./source-diagnostics');
const {houseConnectionSettings} = require('./native-mapping');
const {normalizeWallboxPowerKW, WALLBOX_POWER_NOISE_TOLERANCE_W} = require('./wallbox-measurement');
const {evaluateHeatPumpPower} = require('./heatpump-telemetry');

// Productive wallbox control with a fixed or externally confirmed phase topology.
// Legacy alpha operation keeps a hard single-wallbox interlock. Parallel
// operation requires a fresh centralized allocation and reserves pending power.
// No external phase contactor or automatic
// error reset is operated here.
class WallboxOutput {
    constructor(adapter, {now = () => Date.now(), responseCurrentA = null,
        responseEvidence = null, measurementSource = null} = {}) {
        this.adapter = adapter;
        this.now = now;
        this.responseCurrentA = responseCurrentA;
        this.responseEvidence = responseEvidence;
        this.measurementSource = measurementSource;
        this.ready = false;
        this.busy = false;
        this.stopping = false;
        this.devices = [];
        this.idleWaiters = [];
        this.diagnosticSequence = 0;
    }

    measurementFaultDiagnostic(d, sources, reason) {
        if (d.sourceFaultEpisode) return `${reason}; ${d.sourceFaultEpisode.summary}`;
        const at = this.now();
        const key = `${d.wb}:${at}:${++this.diagnosticSequence}`;
        const episode = {key, checkedAt: at, reason,
            recordSession: this.adapter.shadowController?.recordSession ?? null,
            recordSequenceAtCheck: this.adapter.shadowController?.recordSequence ?? null,
            stopGeneration: d.stopGeneration || 0, sources: sources.map(({id, maxAgeMs}) => ({
            id, maxAgeMs, cached: sourceSnapshot(this.measurementState(id), at),
            receipt: this.adapter.getCachedStateReceipt?.(id) || null,
            direct: {status: 'pending'}}))};
        episode.summary = `[diag ${key}] ` + episode.sources.map(s =>
            `${s.id}: Wert=${JSON.stringify(s.cached.val)}, ts=${s.cached.ts}, lc=${s.cached.lc}, `
            + `ACK=${s.cached.ack}, q=${s.cached.q}, Alter=${s.cached.ageMs} ms, `
            + `EMS-Empfang=${s.receipt?.receivedAt ?? 'unbekannt'} (${s.receipt?.via ?? 'unbekannt'}); Direktlesung ausstehend`).join('; ');
        d.sourceFaultEpisode = episode;
        this.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
        this.recordSourceDiagnostic('request', d, episode);
        // Diagnostic read only: never await it in the control/stop path and
        // never populate the operative cache with its result.
        Promise.all(episode.sources.map(async s => {
            s.direct = await probeSource(() => this.adapter.getForeignStateAsync(s.id), this.now, 5000);
            s.cacheAtCompletion = sourceSnapshot(this.measurementState(s.id), this.now());
            s.receiptAtCompletion = this.adapter.getCachedStateReceipt?.(s.id) || null;
        })).then(() => {
            if (this.stopping) return;
            // Keep completion evidence in the existing bounded recorder even
            // when a subsequent stop has replaced the latest diagnostic state.
            this.recordSourceDiagnostic('complete', d, episode);
            let retained;
            try { retained = JSON.parse(this.own(`Devices.Wallbox${d.wb}.LastStopSourceDiagnostics_JSON`) || '{}'); }
            catch { return; }
            if (retained.key !== key || d.sourceFaultEpisode && d.sourceFaultEpisode !== episode) return;
            const directSummary = episode.sources.map(s => `${s.id}: Direktlesung=${s.direct.status}, `
                + `Dauer=${s.direct.durationMs} ms, ts=${s.direct.snapshot?.ts ?? 'unbekannt'}, `
                + `Alter=${s.direct.snapshot?.ageMs ?? 'unbekannt'} ms, `
                + `Wert=${JSON.stringify(s.direct.snapshot?.val ?? null)}, lc=${s.direct.snapshot?.lc ?? 'unbekannt'}, `
                + `ACK=${s.direct.snapshot?.ack ?? 'unbekannt'}, q=${s.direct.snapshot?.q ?? 'unbekannt'}`).join('; ');
            episode.summary += `; ${directSummary}`;
            this.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
            const previous = String(this.own(`Devices.Wallbox${d.wb}.LastStopReason`) || '');
            if (previous.includes(`[diag ${key}]`))
                this.publish(d.wb, 'LastStopReason', `${previous}; ${directSummary}`);
            this.adapter.log.warn?.(`Wallbox ${d.wb}: Quellendiagnose [diag ${key}] ${directSummary}; `
                + 'Direktlesung prueft ioBroker, nicht das Geraet; keine Steuerungsfreigabe');
        }).catch(error => this.adapter.log.error?.(`Quellendiagnose fehlgeschlagen: ${error.message}`));
        return `${reason}; ${episode.summary}`;
    }

    recordSourceDiagnostic(stage, d, episode) {
        try {
            this.adapter.shadowController?.productionRecord?.({type: `source_diagnostic.${stage}`, wb: d.wb, episode});
        } catch (error) {
            // A diagnostic recorder failure must not interrupt an OFF command.
            try {this.adapter.log.error?.(`Quellendiagnose-Recorder fehlgeschlagen: ${error.message}`);}
            catch (_) { /* Logging is not a safety prerequisite either. */ }
        }
    }

    deviceFaultDiagnostic(d, sources, reason) {
        if (this.measurementSource || !d.owned) return reason;
        const mapping = this.adapter.readMapping();
        // Fixed, bounded stop evidence; electrical/allow reads do not prove
        // why a device stopped or whether unplugging caused the zero load.
        const ids = [...sources.map(s => s.id), d.ids.allow, mapping[`DP_WB${d.wb}_POWER`],
            ...[1, 2, 3].map(p => mapping[`DP_WB${d.wb}_L${p}_A`])];
        return this.measurementFaultDiagnostic(d, [...new Set(ids.filter(Boolean))]
            .map(id => ({id, maxAgeMs: sources.find(s => s.id === id)?.maxAgeMs
                ?? this.measurementMaxAgeMs()})), reason);
    }

    stopTimeoutDiagnostic(d) {
        if (this.measurementSource) return;
        this.deviceFaultDiagnostic(d, [{id: d.ids.allow, maxAgeMs: this.measurementMaxAgeMs()}],
            d.stopRequest.reason);
        const episode = d.sourceFaultEpisode;
        if (!episode || episode.offTimeout) return;
        const at = this.now();
        episode.offTimeout = {checkedAt: at, firstStopAt: this.own(`Devices.Wallbox${d.wb}.LastStopAt`) ?? null,
            lastAttempt: d.stopRequest.lastAttempt, id: d.ids.allow,
            cached: sourceSnapshot(this.state(d.ids.allow), at),
            receipt: this.adapter.getCachedStateReceipt?.(d.ids.allow) || null, direct: {status: 'pending'}};
        this.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
        this.recordSourceDiagnostic('off_timeout', d, episode);
        probeSource(() => this.adapter.getForeignStateAsync(d.ids.allow), this.now, 5000).then(direct => {
            episode.offTimeout.direct = direct;
            if (this.stopping) return;
            this.recordSourceDiagnostic('off_timeout_complete', d, episode);
            let retained;
            try {retained = JSON.parse(this.own(`Devices.Wallbox${d.wb}.LastStopSourceDiagnostics_JSON`) || '{}');}
            catch {return;}
            if (retained.key === episode.key && (!d.sourceFaultEpisode || d.sourceFaultEpisode === episode))
                this.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
        }).catch(error => this.adapter.log.error?.(`AUS-Quellendiagnose fehlgeschlagen: ${error.message}`));
    }

    own(id) { return this.adapter.getCachedState(`${this.adapter.namespace}.${id}`)?.val; }
    state(id) { return id ? this.adapter.getCachedState(id) : null; }
    measurementState(id) {
        const source = this.measurementSource?.(id);
        return source === undefined ? this.state(id) : source;
    }
    number(id, maxAge = 15000) {
        // An isolated response can supply a modeled value while validating
        // protection against the current real source. Production has no hook.
        const source = this.measurementSource?.(id);
        const s = source === undefined ? this.state(id) : source;
        if (!s || !['number', 'string'].includes(typeof s.val)
            || (typeof s.val === 'string' && s.val.trim() === '')
            || !Number.isFinite(Number(s.val))
            || !Number.isFinite(s.ts) || s.ack !== true || (s.q && s.q !== 0)
            || this.now() - s.ts > maxAge || s.ts > this.now() + 1000) return null;
        const modeled = this.state(id);
        if (source !== undefined && Number(s.val) < 0) return null;
        if (!modeled || !['number', 'string'].includes(typeof modeled.val)
            || String(modeled.val).trim() === '') return null;
        const value = Number(modeled.val);
        return Number.isFinite(value) ? value : null;
    }
    // Explain the exact rejected input without changing any safety gate.
    // Static connection switches intentionally have no age limit: adapters
    // may publish them only when their value changes.
    measurementProblem(id, maxAge = 15000, numeric = true) {
        if (!id) return 'Datenpunkt nicht konfiguriert';
        const state = this.measurementState(id);
        if (!state) return 'Datenpunkt fehlt';
        if (state.val === null || state.val === undefined
            || (typeof state.val === 'string' && state.val.trim() === '')) return 'Messwert fehlt';
        if (state.ack !== true) return `unbestaetigt (ack=${String(state.ack)})`;
        if (state.q && state.q !== 0) return `ungueltige Datenqualitaet (q=${String(state.q)})`;
        if (!Number.isFinite(state.ts)) return 'Zeitstempel fehlt oder ist ungueltig';
        const ageMs = this.now() - state.ts;
        if (ageMs < -1000) return `Zeitstempel in der Zukunft (${Math.ceil(-ageMs / 1000)} s)`;
        if (Number.isFinite(maxAge) && ageMs > maxAge)
            return `veraltet (Alter ${Math.ceil(ageMs / 1000)} s; maximal ${maxAge / 1000} s)`;
        if (numeric && (!['number', 'string'].includes(typeof state.val)
            || !Number.isFinite(Number(state.val)))) return 'Messwert nicht numerisch oder nicht endlich';
        if (numeric && this.measurementSource?.(id) !== undefined && Number(state.val) < 0)
            return `negativer Schutzmesswert ${state.val}`;
        return '';
    }
    value(wb, key, fallback) { return this.adapter.config[`wb${wb}${key}`] ?? fallback; }
    publish(wb, key, value) {
        this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.${key}`, value, true);
    }

    alphaEnabled() { return this.adapter.config.multiWallboxAlphaArmed === true; }

    parallelEnabled() {
        const configured = this.own('Config.WallboxParallelChargingEnabled');
        return typeof configured === 'boolean' ? configured : this.adapter.config.wallboxParallelChargingEnabled === true;
    }

    parallelNominalVoltage() {
        const raw = this.own('Config.WallboxNominalVoltage_V')
            ?? this.adapter.config.wallboxNominalVoltageV ?? 230;
        if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === ''
            || !Number.isFinite(Number(raw))) return NaN;
        return Math.max(200, Number(raw));
    }

    nominalVoltage() { return this.parallelEnabled() ? this.parallelNominalVoltage() : 230; }

    parallelAllocation(wb) {
        const fail = reason => ({valid: false, reason: `Parallelbetrieb: ${reason}`});
        const voltage = this.parallelNominalVoltage();
        if (!Number.isFinite(voltage)) return fail('Nennspannung ungueltig');
        const ttl = Math.max(10000, Number(this.adapter.config.slowCycleS || 5) * 2000);
        const state = this.state(`${this.adapter.namespace}.Control.ParallelWallboxAllocation_JSON`);
        if (!state || state.ack !== true || state.q || !Number.isFinite(state.ts)
            || state.ts > this.now() + 1000 || this.now() - state.ts > ttl)
            return fail('frische bestaetigte gemeinsame Zuteilung fehlt');
        let allocation;
        try { allocation = JSON.parse(state.val); } catch (_) { return fail('gemeinsame Zuteilung ungueltig'); }
        if (allocation.schema !== 1 || allocation.valid !== true
            || (allocation.voltage !== undefined && allocation.voltage !== voltage)
            || !Number.isFinite(allocation.timestamp) || allocation.timestamp > this.now() + 1000
            || this.now() - allocation.timestamp > ttl || !Number.isFinite(allocation.budgetW)
            || allocation.budgetW < 0 || !Array.isArray(allocation.allocations)
            || !Array.isArray(allocation.order)
            || (allocation.hardBudgetW !== null && (!Number.isFinite(allocation.hardBudgetW)
                || allocation.hardBudgetW < 0))) return fail('gemeinsame Zuteilung ungueltig oder abgelaufen');
        const seen = new Set();
        let totalW = 0;
        for (const entry of allocation.allocations) {
            if (![0, 1, 2].includes(entry.wb) || seen.has(entry.wb)
                || typeof entry.authorized !== 'boolean' || !Number.isFinite(entry.targetA)
                || ![1, 3].includes(entry.phases) || !Number.isFinite(entry.reservedW) || entry.reservedW < 0
                || !Number.isFinite(entry.minimumW) || entry.minimumW < 0)
                return fail('unvollstaendige oder doppelte Fahrzeugzuteilung');
            seen.add(entry.wb);
            if (entry.authorized) {
                if (!Number.isInteger(entry.targetA) || (entry.targetA !== 0 && entry.targetA < 6) || entry.targetA > 32
                    || entry.reservedW + 0.001 < Math.round(entry.targetA * entry.phases * voltage)
                    || (entry.targetA > 0 && entry.minimumW > entry.reservedW + 0.001)
                    || (entry.pvBudgetW !== undefined && (!Number.isFinite(entry.pvBudgetW)
                        || entry.pvBudgetW < 0
                        || entry.pvBudgetW > Math.round(entry.targetA * entry.phases * voltage) + 0.001)))
                    return fail('Fahrzeugzuteilung ausserhalb des reservierten Budgets');
                totalW += Math.round(entry.targetA * entry.phases * voltage);
            } else if (entry.targetA !== 0) return fail('gesperrte Fahrzeugzuteilung ist nicht null');
        }
        if (totalW > allocation.budgetW + 0.001 || allocation.order.some(id => ![0, 1, 2].includes(id))
            || new Set(allocation.order).size !== allocation.order.length)
            return fail('Zuteilung ueberschreitet gemeinsames Budget');
        const entry = allocation.allocations.find(item => item.wb === wb);
        if (!entry?.authorized) {
            const handoff = allocation.priorityHandoff;
            return fail(handoff?.from === wb && [0, 1, 2].includes(handoff.to) && handoff.to !== wb
                ? `kontrollierte Prioritaetsuebergabe von Wallbox ${wb} zu Wallbox ${handoff.to}`
                : `Wallbox ${wb} ohne gemeinsame Ladezuteilung`);
        }
        const targetW = this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${wb}_W`);
        const targetPhases = this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${wb}_Phases`);
        const targetA = this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${wb}_A`);
        const targetValid = target => target?.ack === true && !target.q && Number.isFinite(target.ts)
            && target.ts > 0 && target.ts <= this.now() + 1000;
        if (!targetValid(targetW) || !targetValid(targetPhases)
            || Number(targetW.val) !== Math.round(entry.targetA * entry.phases * voltage)
            || Number(targetPhases.val) !== entry.phases
            || (targetA && (!targetValid(targetA) || Number(targetA.val) !== entry.targetA)))
            return fail('gemeinsame Zuteilung und aktuelle Stellziele widersprechen sich');
        for (const peer of allocation.allocations.filter(item => item.authorized)) {
            const watts = this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${peer.wb}_W`);
            const topology = this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${peer.wb}_Phases`);
            const amperes = this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${peer.wb}_A`);
            if (!targetValid(watts) || !targetValid(topology)
                || Number(watts.val) !== Math.round(peer.targetA * peer.phases * voltage)
                || Number(topology.val) !== peer.phases
                || (amperes && (!targetValid(amperes) || Number(amperes.val) !== peer.targetA)))
                return fail('gemeinsame Fahrzeugziele widersprechen sich');
        }
        return {valid: true, ...allocation, entry, voltage,
            roundingToleranceW: allocation.allocations.filter(item => item.authorized).length * 0.5};
    }

    // Command reductions and mode changes free capacity only after physical
    // post-ACK current/power samples. ACK alone cannot spend the old power twice.
    parallelLoadReservations(mapping, excludeWb) {
        const voltage = this.parallelNominalVoltage();
        let valid = Number.isFinite(voltage);
        const wallboxesW = [0, 0, 0], pendingPhasesW = [0, 0, 0];
        for (const d of this.devices) {
            const saved = Math.max(0, Number(this.own(`Devices.Wallbox${d.wb}.OutputReservedPower_W`)) || 0);
            if (!this.productionEnabled(d) && !d.owned && saved === 0) continue;
            const currentIds = [1, 2, 3].map(p => mapping[`DP_WB${d.wb}_L${p}_A`]);
            const current = currentIds.map(id => this.number(id, this.measurementMaxAgeMs()));
            const powerId = mapping[`DP_WB${d.wb}_POWER`];
            const powerKW = normalizeWallboxPowerKW(this.number(powerId, this.measurementMaxAgeMs()));
            // An explicitly empty, unowned charger with fresh OFF/car/power
            // evidence has no future command reserve. Old unused current polls
            // must not interrupt another established charging session. This
            // narrow exception never repairs unknown power/allow or hides a
            // fresh positive current contradicting the idle evidence.
            const confirmedIdle = powerKW !== null && powerKW * 1000 <= WALLBOX_POWER_NOISE_TOLERANCE_W
                && !d.owned && !d.recovering && !d.pending && !d.stopRequest && !d.response
                && !d.phaseRequest && saved === 0 && !(d.parallelReservationW > 0)
                && this.own(`Devices.Wallbox${d.wb}.OutputOwned`) !== true
                && this.own(`Devices.Wallbox${d.wb}.OutputActive`) !== true
                && this.number(d.ids.allow, this.measurementMaxAgeMs()) === 0
                && this.number(mapping[`DP_WB${d.wb}_CAR`], this.measurementMaxAgeMs()) === 1
                && current.every(amps => amps === null || (amps >= 0 && amps <= 0.5));
            if (confirmedIdle) {
                wallboxesW[d.wb] = Math.max(0, powerKW * 1000);
                continue;
            }
            if (powerKW === null || current.some(amps => amps === null || amps < 0)) { valid = false; continue; }
            const confirmed = d.confirmedPhases || Number(this.own(`Devices.Wallbox${d.wb}.ConfirmedPhases`)) || 1;
            const target = Number(this.own(`Control.Targets.Wallbox${d.wb}_Phases`));
            const transition = Boolean(d.phaseRequest || d.response?.phaseChange
                || this.own(`Devices.Wallbox${d.wb}.PhaseSwitchPending`) === true);
            const phases = Math.max(confirmed, transition && [1, 3].includes(target) ? target : 1,
                transition ? d.phasePreviousPhases || 1 : 1, current[1] > 1 || current[2] > 1 ? 3 : 1);
            const singlePhase = Number(this.value(d.wb, 'SinglePhaseGridPhase', 1)) - 1;
            if (![1, 3].includes(phases) || ![0, 1, 2].includes(singlePhase)) { valid = false; continue; }
            const commandA = Math.max(d.pending?.amps || 0, d.lastA || 0,
                d.owned ? Number(this.own(`Devices.Wallbox${d.wb}.OutputCommand_A`)) || 0 : 0);
            const measuredCurrentW = (phases === 3 ? current.reduce((sum, amps) => sum + amps, 0)
                : Math.max(...current)) * voltage;
            let reservationW = Math.max(saved, d.parallelReservationW || 0, Math.round(commandA * phases * voltage),
                powerKW * 1000, measuredCurrentW);
            const ackA = this.number(d.ids.feedback, this.measurementMaxAgeMs());
            const ackState = this.state(d.ids.feedback);
            const since = d.parallelCommandAt || Number(this.own(`Devices.Wallbox${d.wb}.OutputLastWrite`)) || 0;
            const expectedA = d.pending?.amps || d.lastA;
            const freshReduction = !d.stopRequest && d.owned && expectedA >= 6 && ackA === expectedA
                && ackState?.ts > since && !transition
                && [powerId, ...currentIds].every(id => this.measurementState(id)?.ts >= ackState.ts
                    && this.measurementState(id)?.ts > since)
                && Math.max(...current) <= expectedA + this.responseCurrentToleranceA()
                && powerKW * 1000 <= Math.round(expectedA * phases * voltage) + WALLBOX_POWER_NOISE_TOLERANCE_W;
            if (freshReduction) reservationW = Math.max(Math.round(expectedA * phases * voltage), powerKW * 1000, measuredCurrentW);
            d.parallelReservationW = reservationW;
            wallboxesW[d.wb] = reservationW;
            if (d.wb !== excludeWb) {
                const reservedPhaseW = [0, 1, 2].map(p => phases === 3 ? reservationW / 3
                    : p === singlePhase ? reservationW : 0);
                const actualPhaseW = phases === 3 ? current.map(amps => amps * voltage)
                    : [0, 1, 2].map(p => p === singlePhase ? Math.max(...current) * voltage : 0);
                reservedPhaseW.forEach((watts, p) => { pendingPhasesW[p] += Math.max(0, watts - actualPhaseW[p]); });
            }
        }
        let otherW = 0;
        const heaterPhaseReserveW = [1, 2, 3].reduce((sum, p) => sum
            + Math.max(0, Number(this.own(`Devices.MyPV_DHW.OutputReservedPhase${p}_W`)) || 0), 0);
        const heaterRelevant = Number(this.own('Devices.MyPV_DHW.OutputReservedPower_W')) > 0
            || heaterPhaseReserveW > 0 || this.own('Devices.MyPV_DHW.Present') === true
            || this.own('Devices.MyPV_DHW.ControlEnabled') === true
            || this.own('Devices.MyPV_DHW.OutputOwned') === true;
        if (heaterRelevant) {
            const actualW = this.dhwActualPower(mapping);
            if (!Number.isFinite(actualW) || actualW < 0) valid = false;
            otherW += Math.max(Number.isFinite(actualW) ? actualW : 0, heaterPhaseReserveW,
                Number(this.own('Devices.MyPV_DHW.OutputReservedPower_W')) || 0,
                this.own('Devices.MyPV_DHW.OutputOwned') === true
                    ? Number(this.own('Devices.MyPV_DHW.OutputCommand_W')) || 0 : 0);
            const ids = [1, 2, 3].map(p => this.adapter.config[`dhwOutput${p}Id`] || mapping[`DP_DHW_OUTPUT${p}`]);
            if (ids.every(Boolean)) {
                const actualPhases = ids.map(id => this.number(id, 120000));
                const heaterCommandW = Math.max(0, Number(this.own('Devices.MyPV_DHW.OutputReservedPower_W')) || 0,
                    this.own('Devices.MyPV_DHW.OutputOwned') === true
                        ? Number(this.own('Devices.MyPV_DHW.OutputCommand_W')) || 0 : 0);
                const staged = heaterCommandW <= 3000 ? [heaterCommandW, 0, 0]
                    : heaterCommandW <= 6000 ? [heaterCommandW - 3000, 3000, 0]
                        : [heaterCommandW - 6000, 3000, 3000];
                actualPhases.forEach((actual, p) => {
                    if (actual === null || actual < 0) valid = false;
                    pendingPhasesW[p] += Math.max(0, staged[p],
                        Number(this.own(`Devices.MyPV_DHW.OutputReservedPhase${p + 1}_W`)) || 0) - Math.min(
                        Math.max(0, actual || 0), Math.max(0, staged[p],
                            Number(this.own(`Devices.MyPV_DHW.OutputReservedPhase${p + 1}_W`)) || 0));
                });
            } else if (otherW > 0) {
                // Unknown heater topology: reserve any unobserved increment on
                // each house phase; never invent a balanced 3P response.
                pendingPhasesW.forEach((_, p) => { pendingPhasesW[p] += Math.max(0, otherW - (actualW || 0)); });
            }
        }
        const context = this.adapter.engineContext;
        if (typeof context?.coordinatedEnergyEnabled === 'function' && context.coordinatedEnergyEnabled()) {
            const gross = typeof context.coordinatedConsumptionLoads === 'function' ? context.coordinatedConsumptionLoads() : null;
            const phase = typeof context.coordinatedPhaseReservations === 'function'
                ? context.coordinatedPhaseReservations(`Wallbox${excludeWb}`) : null;
            if (!gross?.valid || !Number.isFinite(gross.totalW) || !Number.isFinite(gross.wallboxW)
                || !phase?.valid || !Array.isArray(phase.otherW) || phase.otherW.length !== 3
                || phase.otherW.some(watts => !Number.isFinite(watts) || watts < 0)) valid = false;
            else {
                otherW = Math.max(otherW, gross.totalW - gross.wallboxW);
                pendingPhasesW.forEach((watts, p) => { pendingPhasesW[p] = Math.max(watts, phase.otherW[p]); });
            }
        }
        return {valid, wallboxesW, otherW, pendingPhasesW,
            peerW: wallboxesW.reduce((sum, watts, wb) => sum + (wb === excludeWb ? 0 : watts), 0)};
    }

    parallelWriteProblem(d, key, value, mapping) {
        if (!this.parallelEnabled() || (key === 'allow' && value === 0)) return '';
        const allocation = this.parallelAllocation(d.wb);
        if (!allocation.valid) return allocation.reason;
        const requestedA = key === 'command' ? value : d.pending?.amps || d.lastA;
        const holdingSoftMinimum = allocation.entry.targetA === 0 && d.owned && d.activeSince > 0
            && key === 'command' && value <= Math.max(6, Number(this.value(d.wb, 'MinCurrent1pA', 6)))
            && (this.own(`Devices.Wallbox${d.wb}.StopDelayActive`) === true
                || this.now() - d.activeSince < Math.max(0, Number(this.adapter.config.wallboxMinimumRunTimeS ?? 120)) * 1000);
        if (requestedA > allocation.entry.targetA && !holdingSoftMinimum)
            return 'Parallelbetrieb: Stellwert ueberschreitet aktuelle Fahrzeugzuteilung';
        const increasing = key === 'allow' || value > (d.lastA || 0);
        const loads = this.parallelLoadReservations(mapping, d.wb);
        if (!loads.valid) return 'Parallelbetrieb: aktuelle gemeinsame Last-/Phasenreserve fehlt';
        const confirmed = d.confirmedPhases || allocation.entry.phases;
        const phases = Math.max(confirmed, allocation.entry.phases,
            d.phaseRequest?.phases || 1, d.response?.phaseChange ? d.phasePreviousPhases || 1 : 1);
        const requiredW = Math.round(requestedA * phases * allocation.voltage);
        if (increasing && loads.peerW + requiredW > allocation.budgetW + allocation.roundingToleranceW + 0.001)
            return 'Parallelbetrieb: andere Fahrzeugantwort/Leistungsreduktion noch ausstehend';
        const consumptionLimit = this.gridOperatorLimit(mapping);
        if (!consumptionLimit.valid) return consumptionLimit.reason;
        const hardBudgetW = consumptionLimit.active ? Math.min(consumptionLimit.budgetW,
            allocation.hardBudgetW ?? Infinity) : allocation.hardBudgetW;
        if (hardBudgetW !== null && loads.peerW + loads.otherW + requiredW > hardBudgetW + 0.001)
            return 'Parallelbetrieb: aktuelles gemeinsames Schutzbudget reicht nicht';
        const maxAge = SMA_GRID_MAX_AGE_MS;
        const connection = houseConnectionSettings(this.adapter.config);
        const phaseIndex = Number(this.value(d.wb, 'SinglePhaseGridPhase', 1)) - 1;
        const currents = [1, 2, 3].map(p => this.number(mapping[`DP_WB${d.wb}_L${p}_A`], this.measurementMaxAgeMs()));
        if (currents.some(current => current === null || current < 0)) return 'Parallelbetrieb: aktuelle Fahrzeugstrommessung fehlt';
        const directional = [1, 2, 3].some(p => mapping[`DP_HA_L${p}_IMPORT_W`] || mapping[`DP_HA_L${p}_EXPORT_W`]);
        const house = [1, 2, 3].map(p => directional
            ? gridConstraints.netImportCurrentA(this.number(mapping[`DP_HA_L${p}_IMPORT_W`], maxAge),
                this.number(mapping[`DP_HA_L${p}_EXPORT_W`], maxAge))
            : this.number(this.adapter.config[`dhwHaL${p}CurrentId`] || mapping[`DP_DHW_HA_L${p}_CURRENT_A`], maxAge));
        if (house.some(current => current === null) || ![0, 1, 2].includes(phaseIndex))
            return 'Parallelbetrieb: aktuelle Hausanschlussmessung fehlt';
        const used = phases === 3 ? [0, 1, 2] : [phaseIndex];
        for (const p of used) {
            const ownA = phases === 3 ? currents[p] : Math.max(...currents);
            const grossA = house[p] + loads.pendingPhasesW[p] / Math.min(230, allocation.voltage);
            if (grossA - ownA + requestedA > connection.fuseA + 0.001
                || (grossA > connection.increaseLimitA && requestedA > ownA))
                return `Parallelbetrieb: aktuelle Hausanschlussreserve L${p + 1} reicht nicht`;
        }
        return '';
    }

    publishReservedPower(d, watts) {
        this.publish(d.wb, 'OutputReservedPower_W', this.parallelEnabled()
            ? Math.max(Math.round(watts), d.parallelReservationW || 0) : watts);
    }

    // This is evidence of a real, already authorized startup write, not a
    // cached allocation or permission to initiate an unowned charger. Each
    // stage has one fixed communication/vehicle deadline; ordinary ticks must
    // neither refresh that deadline nor generate a new SQL snapshot.
    publishStartReservation(d, stage = null, stageAt = 0) {
        const pending = d.pending;
        const response = d.response;
        const amps = stage === 'vehicle_response' ? response?.amps : pending?.amps;
        const phases = Math.max(d.confirmedPhases || 1, d.phaseRequest?.phases || 1,
            response?.phaseChange ? d.phasePreviousPhases || 1 : 1);
        const valid = d.owned && !d.recovering && !d.stopRequest && !d.fault
            && ['current', 'allow', 'vehicle_response'].includes(stage)
            && Number.isInteger(amps) && amps >= 6 && amps <= 32
            && [1, 3].includes(phases) && Number.isFinite(stageAt) && stageAt > 0;
        const proof = valid ? {schema: 1, pending: true, stage, amps, phases, stageAt,
            validUntil: stageAt + (stage === 'vehicle_response'
                ? this.responseSettleTimeoutMs() : this.feedbackTimeoutMs(d))} : {schema: 1, pending: false};
        d.startReservation = valid ? proof : null;
        const json = JSON.stringify(proof);
        if (this.own(`Devices.Wallbox${d.wb}.OutputStartReservation_JSON`) !== json)
            this.publish(d.wb, 'OutputStartReservation_JSON', json);
    }

    hasStartReservation(d) {
        const proof = d.startReservation;
        if (!proof || !d.owned || d.recovering || d.stopRequest || d.fault
            || proof.stageAt > this.now() + 1000 || proof.validUntil < this.now()) return false;
        if (proof.stage === 'vehicle_response') return d.response?.start === true
            && d.response.ackId === d.ids.allow && d.response.ackValue === 1
            && d.response.ackAt === proof.stageAt;
        return d.pending?.start === true && d.pending.stage === proof.stage
            && d.pending.at === proof.stageAt && d.pending.amps === proof.amps;
    }

    measurementMaxAgeMs() {
        const seconds = Number(this.adapter.config.wallboxMeasurementMaxAgeS ?? 30);
        return (Number.isFinite(seconds) ? Math.max(5, seconds) : 30) * 1000;
    }

    feedbackTimeoutMs(d) {
        const seconds = Number(this.value(d.wb, 'FeedbackTimeoutS', 20));
        return (Number.isFinite(seconds) ? Math.max(1, seconds) : 20) * 1000;
    }

    responseSettleTimeoutMs() {
        const seconds = Number(this.adapter.config.wallboxResponseSettleTimeoutS ?? 45);
        return (Number.isFinite(seconds) ? Math.max(5, Math.min(120, seconds)) : 45) * 1000;
    }

    responseCurrentToleranceA() {
        const value = Number(this.adapter.config.wallboxResponseCurrentToleranceA ?? 1.5);
        return Number.isFinite(value) ? Math.max(0.5, Math.min(3, value)) : 1.5;
    }

    publishResponse(d, state, remainingS, status) {
        this.publish(d.wb, 'ResponseState', state);
        this.publish(d.wb, 'ResponsePending', ['command_ack', 'vehicle_response', 'phase_transition', 'unavailable'].includes(state));
        this.publish(d.wb, 'ResponseRemaining_s', remainingS);
        this.publish(d.wb, 'ResponseStatus', status);
    }

    electricalResponse(d, mapping, current, actualKW, phasePending = false) {
        const response = d.response;
        const evidence = this.responseEvidence?.(d.wb);
        const modeledA = evidence?.currentA;
        const modeled = evidence?.valid === true && evidence?.assumed === true
            && Number.isFinite(modeledA) && modeledA >= 0;
        const unavailableModelResponse = () => {
            const status = 'Elektrische Schattenantwort nicht bewertbar; keine virtuelle Fahrzeugbestaetigung';
            this.publishResponse(d, 'unavailable', 0, status);
            return {waiting: true, status};
        };
        if (!response) return evidence?.assumed === true && !modeled
            ? unavailableModelResponse() : {waiting: false};
        // In shadow, power is privately substituted while physical current
        // remains real. They are not a measured pair for our virtual command.
        this.publish(d.wb, 'ResponseMeasuredCurrent_A', evidence?.assumed === true ? null : Math.max(...current));
        this.publish(d.wb, 'ResponseMeasuredPower_W', evidence?.assumed === true ? null : actualKW * 1000);
        const feedbackId = response.ackId || d.ids.feedback;
        const expected = response.ackValue ?? response.amps;
        if (!response.ackAt && this.number(feedbackId, this.measurementMaxAgeMs()) === expected
            && this.state(feedbackId)?.ts > response.at) {
            response.ackAt = this.state(feedbackId).ts;
            this.publish(d.wb, 'ResponseAcknowledgedAt', response.ackAt);
            if (response.start === true && feedbackId === d.ids.allow && expected === 1)
                this.publishStartReservation(d, 'vehicle_response', response.ackAt);
        }
        if (!response.ackAt) {
            const remainingS = Math.max(0, Math.ceil((this.feedbackTimeoutMs(d)
                - (this.now() - response.at)) / 1000));
            if (remainingS <= 0) {
                const fault = `Befehlsbestaetigung fuer ${response.amps} A fehlt; Antwortzeit abgelaufen`;
                this.publishResponse(d, 'timeout', 0, fault);
                return {waiting: false, fault};
            }
            const status = `Stromvorgabe ${response.amps} A gesendet; Befehlsbestaetigung ausstehend (${remainingS} s)`;
            this.publishResponse(d, 'command_ack', remainingS, status);
            return {waiting: true, status};
        }
        // A device ACK confirms the configured current, not its electrical
        // uptake. For production require a new power/current poll after the
        // write. The isolated shadow hook is an explicitly ideal response;
        // all real measurement/error/phase/house gates run before this method.
        // A missing/invalid assumed response cannot fall back to another
        // controller's real load. Its draw is not our virtual vehicle uptake
        // and must not become a simulated over-current fault after the timer.
        if (evidence?.assumed === true && !modeled) return unavailableModelResponse();
        const usedCurrentIds = (phasePending || response.phaseChange || d.confirmedPhases === 3 ? [1, 2, 3] : [1])
            .map(phase => mapping[`DP_WB${d.wb}_L${phase}_A`]);
        const sourceIds = [mapping[`DP_WB${d.wb}_POWER`], ...usedCurrentIds];
        const postCommandMeasurement = modeled || sourceIds.every(id => {
            const state = this.measurementState(id);
            return state?.ack === true && !state.q && Number.isFinite(state.ts)
                && state.ts > response.at && state.ts >= response.ackAt
                && state.ts <= this.now() + 1000;
        });
        const measuredA = modeled ? modeledA : Math.max(...current);
        const tooHigh = measuredA > response.amps + this.responseCurrentToleranceA();
        if (phasePending && !tooHigh) {
            // The current-command ACK deadline above remains independent. An
            // expected native go-e phase pause is not a failed vehicle response.
            const remainingS = Math.max(0, Math.ceil((this.phaseSwitchTimeoutMs()
                - (this.now() - d.phaseRequest.since)) / 1000));
            const status = `EMS-Phasenwechsel laeuft; elektrische Pause/Wiederanlauf erwartet (${remainingS} s)`;
            this.publishResponse(d, 'phase_transition', remainingS, status);
            return {waiting: true, status};
        }
        // Existing anti-windup permits limited vehicle tapering, but a charger
        // drawing substantially less must not earn another current increase.
        const phaseTopologyMatches = !response.phaseChange || (actualKW > 0
            && (response.phases === 3
                ? current.every(value => value >= Math.max(0, response.amps - 3))
                : current[1] <= 1 && current[2] <= 1));
        const takingCommand = measuredA >= Math.max(0, response.amps - 3) && phaseTopologyMatches;
        if (postCommandMeasurement && !tooHigh && takingCommand) {
            d.response = null;
            if (response.start === true) this.publishStartReservation(d);
            this.publish(d.wb, 'ResponseConfirmedAt', this.now());
            this.publishResponse(d, modeled ? 'modeled' : 'confirmed', 0, modeled
                ? `Ideale elektrische Modellantwort ${measuredA} A angenommen; keine reale Fahrzeugbestaetigung`
                : `Neue elektrische Messung bestaetigt ${measuredA} A bei Vorgabe ${response.amps} A`);
            return {waiting: false};
        }
        const elapsed = Math.max(0, this.now() - response.ackAt);
        const remainingS = Math.max(0, Math.ceil((this.responseSettleTimeoutMs() - elapsed) / 1000));
        if (remainingS > 0) {
            const detail = postCommandMeasurement ? `Ist ${measuredA} A / Soll ${response.amps} A`
                : 'noch keine neue Leistung-/Strommessung nach dem Befehl';
            const status = `Befehl bestaetigt; Fahrzeugantwort abwarten: ${detail}; noch ${remainingS} s`;
            this.publishResponse(d, 'vehicle_response', remainingS, status);
            return {waiting: true, status};
        }
        if (!postCommandMeasurement || tooHigh) {
            const fault = !postCommandMeasurement
                ? 'Neue elektrische Fahrzeugmessung nach bestaetigtem Befehl fehlt; Antwortzeit abgelaufen'
                : `Fahrzeugstrom ${measuredA} A bleibt ueber bestaetigter Vorgabe ${response.amps} A; Antwortzeit abgelaufen`;
            this.publishResponse(d, 'timeout', 0, fault);
            return {waiting: false, fault};
        }
        const status = response.phaseChange && !phaseTopologyMatches
            ? `Elektrische Phasenantwort fuer ${response.phases}P noch nicht belegt; Antwortzeit abgelaufen, keine weitere Erhoehung`
            : `Fahrzeug nimmt nur ${measuredA} A bei Vorgabe ${response.amps} A ab; Antwortzeit abgelaufen, keine weitere Erhoehung`;
        this.publishResponse(d, 'limited', 0, status);
        if (response.start === true) this.publishStartReservation(d);
        return {waiting: response.phaseChange === true, status};
    }

    phaseControlMode(d) {
        if (this.value(d.wb, 'PhaseSwitchEnabled', false) !== true) return 'fixed';
        // Existing independent scripts remain the phase authority after an
        // upgrade. Following an EMS request requires an explicit contract.
        return this.value(d.wb, 'PhaseControlMode', 'script');
    }

    phaseSwitchTimeoutMs() {
        const seconds = Number(this.adapter.config.wallboxPhaseSwitchTimeoutS ?? 180);
        return (Number.isFinite(seconds) ? Math.max(30, Math.min(900, seconds)) : 180) * 1000;
    }

    phaseRequestState(d, mode, desiredPhases, confirmedPhases) {
        const pending = mode === 'ems' && desiredPhases !== confirmedPhases;
        if (!pending) d.phaseRequest = null;
        else if (!d.phaseRequest || d.phaseRequest.phases !== desiredPhases)
            d.phaseRequest = {phases: desiredPhases, since: this.now(), timedOut: false,
                targetAt: this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${d.wb}_Phases`)?.lc
                    ?? this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${d.wb}_Phases`)?.ts};
        const elapsedMs = pending ? Math.max(0, this.now() - d.phaseRequest.since) : 0;
        const timeoutMs = this.phaseSwitchTimeoutMs();
        if (pending && elapsedMs >= timeoutMs) d.phaseRequest.timedOut = true;
        const timedOut = pending && d.phaseRequest.timedOut;
        const remainingS = pending && !timedOut ? Math.ceil((timeoutMs - elapsedMs) / 1000) : 0;
        const status = timedOut
            ? `Phasenumschaltung nicht bestaetigt: Soll ${desiredPhases}P / bestaetigt ${confirmedPhases}P; Zeitlimit erreicht, Ausgang gesperrt bis Bestaetigung oder Ruecknahme der Phasenvorgabe`
            : pending
                ? `Warten auf go-e-Phasenumschaltung: Soll ${desiredPhases}P / bestaetigt ${confirmedPhases}P; noch ${remainingS} s`
                : mode === 'script' ? `Skript-Phasenfuehrung: bestaetigt ${confirmedPhases}P`
                    : mode === 'ems' ? `EMS-Phasenvorgabe bestaetigt: ${confirmedPhases}P`
                        : `Feste Phasenkonfiguration: ${confirmedPhases}P`;
        this.publish(d.wb, 'PhaseControlMode', mode);
        this.publish(d.wb, 'PhaseSwitchPending', pending);
        this.publish(d.wb, 'PhaseSwitchElapsed_s', Math.floor(elapsedMs / 1000));
        this.publish(d.wb, 'PhaseSwitchRemaining_s', remainingS);
        this.publish(d.wb, 'PhaseSwitchTimedOut', timedOut);
        this.publish(d.wb, 'PhaseSwitchStatus', status);
        return {pending, timedOut, status};
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
            && state.ts <= this.now() + 1000 && Number(state.val) === expected.value
            && this.now() - expected.at <= this.feedbackTimeoutMs(d)) {
            const confirmed = d.confirmedFeedback[key];
            return confirmed && this.now() - confirmed.ts <= maxAge
                && confirmed.ts <= this.now() + 1000 ? confirmed.value : null;
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
            && handoffSince > 0 && handoffSince <= this.now() + 1000
            && this.now() - handoffSince <= handoffTimeoutMs;
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
                    && timestamp <= this.now() + 1000);
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
            || !Number.isFinite(state.ts) || (state.q && state.q !== 0) || this.now() - state.ts > maxAge
            || state.ts > this.now() + 1000) return null;
        return state.val;
    }

    staticValue(id) {
        if (!id) return null;
        const state = this.state(id);
        if (!state || state.val === null || state.val === '' || state.ack !== true
            || !Number.isFinite(state.ts) || (state.q && state.q !== 0)
            || state.ts > this.now() + 1000) return null;
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
        const id = this.adapter.config.heatPumpPowerId || mapping.DP_HEAT_PUMP_POWER;
        const ageState = this.state(`${this.adapter.namespace}.Config.HeatPumpPowerMaxAge_s`);
        const ageS = ageState ? ageState.val : this.adapter.config.heatPumpPowerMaxAgeS ?? 30;
        const power = evaluateHeatPumpPower({id, state: this.measurementState(id), now: this.now(),
            unit: this.adapter.config.heatPumpPowerUnit ?? 'W',
            scope: this.adapter.config.heatPumpPowerScope ?? 'total',
            maxAgeMs: typeof ageS === 'boolean' || ageS === null || ageS === '' ? NaN : Number(ageS) * 1000});
        if (!power.valid || power.scope !== 'total') {
            return {valid: false, active: true, budgetW: 0,
                reason: 'Wärmepumpenleistung für gemeinsames LPC-Budget fehlt/ungueltig: '
                    + (power.scope === 'inverter' ? 'Inverter-Teilleistung ist keine Gesamtleistung' : power.reason)};
        }
        const heatPumpW = power.watts;
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

    currentPriceAuthorization(wb) {
        const context = this.adapter.engineContext;
        const enabled = this.own(`Config.Wallbox${wb}PriceChargingEnabled`) === true;
        const revoked = {enabled, allowed: false, gridW: 0};
        if (typeof context?.priceChargingAuthorization !== 'function') return revoked;
        try { return context.priceChargingAuthorization(`Wallbox${wb}`, null, this.now()); }
        catch (_) { return revoked; }
    }

    manualEnergyAuthorization(wb) {
        const context = this.adapter.engineContext;
        if (typeof context?.wallboxManualEnergyAuthorization !== 'function') return false;
        try { return context.wallboxManualEnergyAuthorization(wb) === true; }
        catch (_) { return false; }
    }

    establishedSelectedOwner(d) {
        return d.owned && d.valid && !d.recovering && !d.stopRequest && !d.fault
            && !d.pending?.start && d.activeSince > 0
            && this.own(`Devices.Wallbox${d.wb}.OutputActive`) === true
            && Number(this.own('Control.SelectedWallbox')) === d.wb
            && this.responseEvidence?.(d.wb)?.assumed !== true;
    }

    peerIdleReleaseConfirmed(d, mapping) {
        // Only physical post-release evidence can distinguish an empty
        // charger's allow=1 from a second car enabled to draw. Never infer
        // absence from NULL, a shadow response or an unfinished operation.
        if (!d.valid || d.owned || d.recovering || d.pending || d.stopRequest
            || d.response || d.phaseRequest || d.phaseTransitionUntil > this.now()
            || d.activeSince > 0 || d.fault
            || this.own(`Devices.Wallbox${d.wb}.OutputActive`) === true
            || this.own(`Devices.Wallbox${d.wb}.OutputOwned`) === true
            || this.own(`Devices.Wallbox${d.wb}.StopPowerPending`) === true
            || this.own(`Devices.Wallbox${d.wb}.ResponsePending`) === true
            || this.own(`Devices.Wallbox${d.wb}.PhaseSwitchPending`) === true
            || this.responseEvidence?.(d.wb)?.assumed === true) return false;
        const maxAgeMs = this.measurementMaxAgeMs();
        const physicalNumber = id => this.measurementProblem(id, maxAgeMs) ? null
            : Number(this.measurementState(id).val);
        if (physicalNumber(d.ids.allow) !== 1 || physicalNumber(d.ids.error) !== 0
            || this.measurementProblem(d.ids.connection, maxAgeMs, false)
            || this.measurementState(d.ids.connection)?.val !== true) return false;
        const allow = this.measurementState(d.ids.allow);
        // Repeated allow polls advance ts but not the actual ON edge. A
        // malformed explicit lc is not permission to use an older sample.
        const edge = allow.lc === undefined ? allow.ts : allow.lc;
        if (!Number.isFinite(edge) || edge <= 0 || edge > allow.ts) return false;
        const carId = mapping[`DP_WB${d.wb}_CAR`];
        if (physicalNumber(carId) !== 1 || this.measurementState(carId).ts < edge) return false;
        const ids = [mapping[`DP_WB${d.wb}_POWER`],
            ...[1, 2, 3].map(p => mapping[`DP_WB${d.wb}_L${p}_A`])];
        const values = ids.map(physicalNumber);
        const powerKW = normalizeWallboxPowerKW(values[0]);
        return powerKW !== null && powerKW * 1000 <= WALLBOX_POWER_NOISE_TOLERANCE_W
            && values.slice(1).every(value => value !== null && value >= 0 && value <= 0.5)
            && ids.every(id => this.measurementState(id)?.ts >= edge);
    }

    idlePeerCanRemainReleased(owner, peer, mapping) {
        return this.establishedSelectedOwner(owner) && this.peerIdleReleaseConfirmed(peer, mapping);
    }

    async enforceAlphaAuthority(d, mapping) {
        if (!this.alphaEnabled() || d.recovering || d.owned || !d.valid
            || !this.productionEnabled(d) || !this.value(d.wb, 'ProductionArmed', false)
            || !this.adapter.config.globalWriteEnabled
            || this.own('System.RealOutputsEnabled') !== true) return false;
        const allow = this.number(d.ids.allow, this.measurementMaxAgeMs());
        if (allow !== 1) return false;
        // Claiming an OFF operation would itself create an owned-peer
        // interlock and interrupt the running car on the following tick.
        // Leave only a positively proven empty peer untouched while that
        // selected EMS-owned charging session continues. A new start, replug
        // or lost evidence still follows the normal confirmed-OFF takeover.
        if (this.devices.some(owner => owner.wb !== d.wb
            && this.idlePeerCanRemainReleased(owner, d, mapping))) return false;
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
            if (!ids.phaseMode) ids.phaseMode = String(mapping[`DP_WB${wb}_PHASE_MODE`] || '').trim();
            const d = {wb, ids, owned: false, recovering: false, wasOwned: false, wasActive: false,
                recoveredAt: 0, handoffReadySince: 0, activeSince: 0, pending: null, lastA: 0, lastAt: 0,
                startReservation: null,
                shortfallSince: 0, minimumChargeState: null, minimumChargeCompletedAt: 0, stopRequest: null,
                confirmedFeedback: {}, expectedFeedback: {},
                confirmedPhases: 0, phaseTransitionUntil: 0, phaseRequest: null, response: null,
                fault: '', valid: false};
            this.devices.push(d);
            this.setSequenceResume(d, false);
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
                OutputStartReservation_JSON: '{"schema":1,"pending":false}',
                OutputPhases: 1, OutputStatus: 'Simulation; Ausgang gesperrt', OutputLastWrite: 0,
                OutputFault: '', IncreaseBudget_JSON: '{}', LastStopSourceDiagnostics_JSON: '{}', LastStopReason: '', LastStopAt: 0,
                StopDelayActive: false, StopDelayRemaining_s: 0,
                FeedbackCurrent_A: 0, AvailableCurrent_A: 0,
                ConfirmedPhases: 1, PhaseTransitionActive: false, PhaseControlMode: 'fixed',
                PhaseSwitchPending: false, PhaseSwitchElapsed_s: 0, PhaseSwitchRemaining_s: 0,
                PhaseSwitchTimedOut: false, PhaseSwitchStatus: ''};
            Object.assign(definitions, {ResponseState: 'idle', ResponsePending: false,
                ResponseRemaining_s: 0, ResponseStatus: '', ResponseConfirmedAt: 0,
                ResponseCommand_A: 0, ResponsePreviousCommand_A: 0, ResponseSentAt: 0,
                ResponseAcknowledgedAt: 0, ResponseMeasuredCurrent_A: null, ResponseMeasuredPower_W: null});
            for (const [key, initial] of Object.entries(definitions)) {
                await this.adapter.queueCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.${key}`,
                    initial, {type: initial === null ? 'number' : typeof initial,
                        role: key.endsWith('_JSON') ? 'json' : typeof initial === 'boolean' ? 'indicator' : 'value'});
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
            this.publishStartReservation(d);
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
        const writeAt = this.now();
        const phaseObservation = d.response?.phaseChange
            ? {phaseChange: true, phases: d.response.phases} : {};
        const feedbackKey = key === 'allow' ? 'allow' : d.ids.command === d.ids.feedback ? 'current' : null;
        if (key === 'command') {
            if (this.parallelEnabled()) d.parallelCommandAt = writeAt;
            const phases = Math.max(d.confirmedPhases || 1,
                d.phaseRequest?.phases || 1, phaseObservation.phases || 1,
                phaseObservation.phaseChange ? d.phasePreviousPhases || 1 : 1);
            this.publish(d.wb, 'OutputReservedPower_W', Math.max(
                Number(this.own(`Devices.Wallbox${d.wb}.OutputReservedPower_W`)) || 0,
                Math.round(Math.max(value, d.lastA || 0) * phases * (this.nominalVoltage() || 230))));
        }
        if (feedbackKey) {
            const previous = this.number(d.ids[key], this.measurementMaxAgeMs());
            if (previous !== null)
                d.confirmedFeedback[feedbackKey] = {value: previous, ts: this.state(d.ids[key]).ts};
            d.expectedFeedback[feedbackKey] = {value, at: writeAt};
        }
        const parallelProblem = this.parallelWriteProblem(d, key, value, this.adapter.readMapping());
        if (parallelProblem) {
            const error = new Error(parallelProblem);
            error.code = 'WALLBOX_PARALLEL_GRANT_CHANGED';
            throw error;
        }
        if (typeof this.adapter.writeRecordedForeignState === 'function')
            await this.adapter.writeRecordedForeignState(d.ids[key], value);
        else await this.adapter.setForeignStateAsync(d.ids[key], value, false);
        if (key === 'command') d.response = {...phaseObservation, amps: value, at: writeAt, ackAt: 0,
            start: d.pending?.start === true,
            ackId: d.ids.feedback, ackValue: value,
            previousAmps: d.response?.amps ?? d.lastA};
        else if (value === 1) {
            // Electrical start is possible only after allow=1, so the previous
            // current ACK must not begin/finish the vehicle response timer.
            d.response = {...phaseObservation, amps: d.pending?.amps || d.lastA, at: writeAt, ackAt: 0,
                start: d.pending?.start === true,
                ackId: d.ids.allow, ackValue: 1,
                previousAmps: d.response?.previousAmps ?? d.lastA};
        }
        if (key === 'command' || value === 1) d.electricalCommandAt = writeAt;
        if (d.pending?.start === true && (key === 'command' || (key === 'allow' && value === 1))) {
            d.pending.at = writeAt;
            this.publishStartReservation(d, d.pending.stage, writeAt);
        } else if (key === 'command' || (key === 'allow' && value === 0)) this.publishStartReservation(d);
        if (key === 'command' || value === 1) {
            this.publish(d.wb, 'ResponseCommand_A', d.response.amps);
            this.publish(d.wb, 'ResponsePreviousCommand_A', d.response.previousAmps);
            this.publish(d.wb, 'ResponseSentAt', writeAt);
            this.publish(d.wb, 'ResponseAcknowledgedAt', 0);
            this.publish(d.wb, 'ResponseMeasuredCurrent_A', null);
            this.publish(d.wb, 'ResponseMeasuredPower_W', null);
            this.publishResponse(d, 'command_ack', Math.ceil(this.feedbackTimeoutMs(d) / 1000),
                `Vorgabe ${d.response.previousAmps} -> ${d.response.amps} A gesendet; Befehlsbestaetigung ausstehend`);
        }
        this.publish(d.wb, 'OutputLastWrite', this.now());
    }

    setSequenceResume(d, pending) {
        d.sequenceResumePending = pending;
        if (!pending) d.sequenceResumeUntil = 0;
        this.publish(d.wb, 'SequenceResumePending', pending);
        this.publish(d.wb, 'SequenceResumeUntil', d.sequenceResumeUntil || 0);
    }

    sequenceResumeEligible(d, mapping) {
        const car = this.number(mapping[`DP_WB${d.wb}_CAR`], this.measurementMaxAgeMs());
        const soc = this.number(mapping[`DP_WB${d.wb}_SOC`], 7200000);
        const target = Number(this.own(`Vehicles.Wallbox${d.wb}.TargetSoC_pct`));
        return !d.fault && d.sequenceResumeUntil > this.now()
            && this.adapter.config.globalWriteEnabled && this.own('System.RealOutputsEnabled') === true
            && this.own('System.DataValid') === true && this.own('Control.Valid') === true
            && Number(this.own('Control.SelectedWallbox')) === d.wb
            && this.own(`Vehicles.Wallbox${d.wb}.Release`) === true
            && [2, 3, 4].includes(car) && soc !== null && Number.isFinite(target) && soc < target;
    }

    electricalStopConfirmed(d, mapping, after = 0) {
        const evidence = this.responseEvidence?.(d.wb);
        // Private model feedback is explicitly assumed, never a physical
        // confirmation of the legacy controller's car or a missing model.
        if (evidence?.assumed === true)
            return evidence.valid === true && evidence.currentA === 0;
        const ids = [mapping[`DP_WB${d.wb}_POWER`],
            ...[1, 2, 3].map(p => mapping[`DP_WB${d.wb}_L${p}_A`])];
        const values = ids.map(id => this.number(id, this.measurementMaxAgeMs()));
        const powerKW = normalizeWallboxPowerKW(values[0]);
        return powerKW !== null && powerKW * 1000 <= WALLBOX_POWER_NOISE_TOLERANCE_W
            && values.slice(1).every(value => value !== null && value >= 0 && value <= 0.5)
            && ids.every(id => this.measurementState(id)?.ts >= after);
    }

    completeStopIfConfirmed(d, mapping) {
        const request = d.stopRequest;
        const off = this.state(d.ids.allow);
        if (!request || this.number(d.ids.allow, this.measurementMaxAgeMs()) !== 0
            || off?.ts < request.lastAttempt) return false;
        if (!request.confirmedAt) request.confirmedAt = off.ts;
        this.publish(d.wb, 'StopConfirmedAt', request.confirmedAt);
        if (!this.electricalStopConfirmed(d, mapping,
            request.wasControlled || request.lastAttempt > 0 ? request.confirmedAt : 0)) {
            this.publish(d.wb, 'StopPowerPending', true);
            const evidence = this.responseEvidence?.(d.wb);
            const unavailableModel = evidence?.assumed === true && evidence.valid !== true;
            this.publish(d.wb, 'OutputStatus', `${request.reason}; AUS bestaetigt, ${unavailableModel
                ? 'elektrische Schattenantwort unbekannt' : 'elektrische Abschaltung abwarten'}`);
            if (unavailableModel) return false;
            if (this.now() - request.confirmedAt > this.responseSettleTimeoutMs()) {
                d.fault = 'AUS bestaetigt, aber frische elektrische Abschaltung fehlt; Ausgang bleibt gesperrt';
                this.publish(d.wb, 'OutputFault', d.fault);
                this.setSequenceResume(d, false);
            }
            return false;
        }
        d.lastStopConfirmedAt = request.confirmedAt;
        d.owned = false;
        d.stopRequest = null;
        d.expectedFeedback = {};
        this.publish(d.wb, 'StopPowerPending', false);
        this.publish(d.wb, 'OutputOwned', false);
        d.parallelReservationW = 0;
        d.parallelCommandAt = 0;
        this.publish(d.wb, 'OutputReservedPower_W', 0);
        d.sourceFaultEpisode = null;
        if (d.fault) this.publish(d.wb, 'OutputStatus',
            'AUS inzwischen bestaetigt, elektrisch ruhig, Wiederfreigabe gesperrt; ' + d.fault);
        return true;
    }

    async stop(d, reason) {
        const wasRecovering = d.recovering;
        this.publishStartReservation(d);
        // OutputOwned remains true until allow=0 is acknowledged. Recording it
        // here would therefore emit the same stop once per 2-s tick. The
        // productive transition itself is represented by OutputActive or the
        // recovering flag and is recorded exactly once.
        const wasControlled = !d.stopRequest && (d.recovering
            || this.own(`Devices.Wallbox${d.wb}.OutputActive`) === true
            || (d.owned && d.pending?.start === true && d.pending.stage === 'allow'));
        const peerInterlock = /^Sequenzbetrieb: (Wallbox \d wird zuerst beendet|Ladefreigabe Wallbox \d noch aktiv)$/.test(reason);
        if (peerInterlock && !d.stopRequest && d.owned
            && this.own(`Devices.Wallbox${d.wb}.OutputActive`) === true
            && Number(this.own('Control.SelectedWallbox')) === d.wb && !d.fault) {
            d.sequenceResumeUntil = this.now() + this.feedbackTimeoutMs(d) + this.responseSettleTimeoutMs();
            this.setSequenceResume(d, true);
        } else if (!peerInterlock) this.setSequenceResume(d, false);
        if (wasControlled) {
            d.stopGeneration = (d.stopGeneration || 0) + 1;
            if (d.sourceFaultEpisode && reason.includes(`[diag ${d.sourceFaultEpisode.key}]`))
                d.sourceFaultEpisode.stopGeneration = d.stopGeneration;
            else d.sourceFaultEpisode = null;
            this.publish(d.wb, 'LastStopReason', reason);
            this.publish(d.wb, 'LastStopAt', this.now());
            if (d.sourceFaultEpisode) {
                d.sourceFaultEpisode.stopAt = this.now();
                this.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(d.sourceFaultEpisode));
            }
            this.adapter.log.warn?.(`Wallbox ${d.wb}: Ausgang AUS – ${reason}`);
        }
        this.publish(d.wb, 'OutputActive', false);
        this.publish(d.wb, 'OutputCommand_A', 0);
        this.publish(d.wb, 'StopDelayActive', false);
        this.publish(d.wb, 'StopDelayRemaining_s', 0);
        if (d.owned && !d.stopRequest) {
            const powerKW = normalizeWallboxPowerKW(this.number(
                this.adapter.readMapping()[`DP_WB${d.wb}_POWER`], this.measurementMaxAgeMs()));
            d.stopRequest = {reason, lastAttempt: 0, confirmedAt: 0, wasControlled};
            this.publish(d.wb, 'StopConfirmedAt', 0);
            this.publish(d.wb, 'OutputReservedPower_W', Math.max(
                Number(this.own(`Devices.Wallbox${d.wb}.OutputReservedPower_W`)) || 0,
                powerKW === null ? 0 : powerKW * 1000,
                Math.round((Number(d.lastA) || 0) * (this.nominalVoltage() || 230) * (d.confirmedPhases || 1))));
        }
        this.publish(d.wb, 'OutputStatus', d.stopRequest?.reason || reason);
        d.pending = null;
        d.response = null;
        d.measuredBudgetStep = null;
        if (this.own(`Devices.Wallbox${d.wb}.ResponseState`) !== 'timeout')
            this.publishResponse(d, 'idle', 0, 'Ausgang gestoppt; keine Fahrzeugantwort ausstehend');
        d.recovering = false;
        d.activeSince = 0;
        d.priceCharging = false;
        d.minimumChargeState = null;
        d.minimumChargeCompletedAt = 0;
        d.shortfallSince = 0;
        d.lastA = 0;
        if (wasRecovering) this.finishRestartHandoff();
        if (!d.owned) {
            if (d.fault && d.lastStopConfirmedAt > 0) {
                const mapping = this.adapter.readMapping();
                const off = this.number(d.ids.allow, this.measurementMaxAgeMs()) === 0
                    && this.state(d.ids.allow)?.ts >= d.lastStopConfirmedAt;
                const quiet = off && this.electricalStopConfirmed(d, mapping, d.lastStopConfirmedAt);
                this.publish(d.wb, 'OutputStatus', quiet
                    ? `AUS inzwischen bestaetigt, elektrisch ruhig, Wiederfreigabe gesperrt; ${d.fault}`
                    : `Wiederfreigabe gesperrt; aktuelle AUS-/Ruhebestaetigung fehlt; ${d.fault}`);
            }
            return;
        }
        const mapping = this.adapter.readMapping();
        if (this.completeStopIfConfirmed(d, mapping)) return;
        // Acknowledged OFF with residual/unknown draw is a vehicle-response
        // wait, not another command retry. Its reservation/interlock stays.
        if (this.number(d.ids.allow, this.measurementMaxAgeMs()) === 0
            && d.stopRequest.confirmedAt > 0) return;
        d.stopRequest.confirmedAt = 0;
        this.publish(d.wb, 'StopConfirmedAt', 0);
        this.publish(d.wb, 'StopPowerPending', false);
        if (d.stopRequest.lastAttempt <= 0
            || this.now() - d.stopRequest.lastAttempt >= this.feedbackTimeoutMs(d)) {
            // Keep ownership/interlock until OFF is really acknowledged. A
            // retry must not reset ack=false every two seconds while go-e polls.
            if (d.stopRequest.lastAttempt > 0) {
                d.fault = 'AUS-Rueckmeldung fehlt; Ausgang gesperrt bis Adapter-Neustart';
                this.publish(d.wb, 'OutputFault', d.fault);
                this.stopTimeoutDiagnostic(d);
            }
            d.stopRequest.lastAttempt = this.now();
            await this.send(d, 'allow', 0);
            this.completeStopIfConfirmed(d, mapping);
        }
    }

    gate(d, mapping, consumptionLimit) {
        const wb = d.wb;
        let parallelHandoffWait = false;
        let parallelStartPeerWait = false;
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
        if (!this.parallelEnabled() && this.alphaEnabled() && enabled.length > 1
            && Number(this.own('Control.SelectedWallbox')) !== wb
            && !(d.owned && this.restartHandoffWaiting(d)))
            return `Sequenzbetrieb: Wallbox ${Number(this.own('Control.SelectedWallbox'))} ausgewaehlt`;
        if (this.parallelEnabled()) {
            const allocation = this.parallelAllocation(wb);
            if (!allocation.valid) {
                if (!d.recovering || !this.restartHandoffWaiting(d)) return allocation.reason;
                parallelHandoffWait = true;
            }
            const reservedStart = this.hasStartReservation(d);
            const starting = reservedStart || !d.owned || (d.activeSince <= 0 && !d.recovering);
            for (const peer of enabled.filter(x => x.wb !== wb)) {
                const admitted = allocation.allocations?.some(entry => entry.wb === peer.wb && entry.authorized);
                const released = this.number(peer.ids.allow, this.measurementMaxAgeMs());
                if (admitted && peer.owned && !peer.stopRequest && !peer.fault) continue;
                // A central grant does not adopt somebody else's live command.
                // Start/increase waits for takeover to obtain physical OFF.
                if (starting && (released !== 0 || !this.electricalStopConfirmed(peer, mapping,
                    peer.lastStopConfirmedAt || 0))) {
                    if (!reservedStart)
                        return `Parallelbetrieb: bestaetigte AUS-/elektrische Rueckmeldung Wallbox ${peer.wb} fehlt`;
                    parallelStartPeerWait = true;
                }
            }
        }
        const otherOwned = !this.parallelEnabled() && this.devices.find(x => x.wb !== wb && x.owned);
        if (otherOwned) return `Sequenzbetrieb: Wallbox ${otherOwned.wb} wird zuerst beendet`;
        if (!this.parallelEnabled() && this.alphaEnabled()) {
            const maxAgeMs = this.measurementMaxAgeMs();
            const otherReleased = this.devices.find(x => x.wb !== wb && x.valid
                && this.number(x.ids.allow, maxAgeMs) === 1
                && !this.idlePeerCanRemainReleased(d, x, mapping));
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
                const drawingPeer = this.devices.find(x => x.wb !== wb && x.valid
                    && this.productionEnabled(x)
                    && !this.electricalStopConfirmed(x, mapping, x.lastStopConfirmedAt || 0));
                if (drawingPeer) {
                    const evidence = this.responseEvidence?.(drawingPeer.wb);
                    // A global invalid shadow response may also leave an idle
                    // peer unprovable. Describe the missing model evidence;
                    // never imply a missing physical OFF acknowledgement.
                    if (evidence?.assumed === true) {
                        if (evidence.valid !== true || !Number.isFinite(evidence.currentA) || evidence.currentA < 0)
                            return `Sequenzbetrieb: elektrische Schattenantwort Wallbox ${drawingPeer.wb} unbekannt; Modell-AUS-Bestaetigung fehlt`;
                        return `Sequenzbetrieb: elektrische Modell-AUS-Bestaetigung Wallbox ${drawingPeer.wb} fehlt`;
                    }
                    return `Sequenzbetrieb: elektrische AUS-Bestaetigung Wallbox ${drawingPeer.wb} fehlt`;
                }
            }
        }
        if (this.own('Devices.MyPV_DHW.ControlEnabled') && !this.combinedMode(mapping))
            return 'EHZ gleichzeitig freigegeben, gemeinsame Produktion aber nicht sicher bestaetigt';
        if (this.staticValue(d.ids.connection) !== true) {
            const problem = this.measurementProblem(d.ids.connection, Infinity, false);
            return problem ? this.deviceFaultDiagnostic(d, [{id: d.ids.connection, maxAgeMs: Infinity}],
                `Wallbox-Verbindungsstatus: ${problem}`)
                : this.state(d.ids.connection)?.val === false
                    ? 'Wallbox offline (Verbindungsstatus=false)'
                    : 'Wallbox-Verbindungsstatus ungueltig (Boolean erwartet)';
        }
        const deviceMaxAgeMs = this.measurementMaxAgeMs();
        const errorCode = this.number(d.ids.error, deviceMaxAgeMs);
        if (errorCode === null)
            return this.deviceFaultDiagnostic(d, [{id: d.ids.error, maxAgeMs: deviceMaxAgeMs}],
                `Wallbox-Fehlerstatus: ${this.measurementProblem(d.ids.error, deviceMaxAgeMs)}`);
        if (errorCode !== 0) return Number.isInteger(errorCode) && errorCode > 0
            ? `Wallbox meldet Geraetefehler (Code ${errorCode})`
            : `Wallbox-Fehlerstatus ungueltig (Code ${errorCode})`;
        const carState = this.number(mapping[`DP_WB${wb}_CAR`], deviceMaxAgeMs);
        if (carState === null)
            return this.deviceFaultDiagnostic(d, [{id: mapping[`DP_WB${wb}_CAR`], maxAgeMs: deviceMaxAgeMs}],
                `Fahrzeugstatus: ${this.measurementProblem(mapping[`DP_WB${wb}_CAR`], deviceMaxAgeMs)}`);
        if (![2, 3, 4].includes(carState)) return 'Kein Fahrzeug angeschlossen';
        const noSocPrice = this.own(`Vehicles.Wallbox${wb}.SoCValid`) !== true
            && this.manualEnergyAuthorization(wb);
        if (!this.own(`Vehicles.Wallbox${wb}.SoCValid`) && !noSocPrice)
            return 'Fahrzeug-SoC fehlt; keine gueltige begrenzte Preisladung ohne SoC';
        const socState = this.state(mapping[`DP_WB${wb}_SOC`]);
        if (!noSocPrice && socState?.ack !== true) return 'SoC-Datenpunkt unbestaetigt (ack=false)';
        const soc = this.number(mapping[`DP_WB${wb}_SOC`], 7200000);
        if (!noSocPrice && (soc === null || soc < 0 || soc > 100)) return 'SoC ungueltig oder veraltet';
        const targetSoc = Number(this.own(`Vehicles.Wallbox${wb}.TargetSoC_pct`));
        if (!noSocPrice && (!Number.isFinite(targetSoc) || targetSoc <= 0 || targetSoc > 100))
            return 'Ziel-SoC fehlt oder ist ungueltig';
        if (!noSocPrice && soc >= targetSoc) return `Ziel-SoC erreicht (${soc} >= ${targetSoc} %)`;
        if (!noSocPrice && this.own(`Config.Wallbox${wb}PriceChargingEnabled`) === true) {
            // The fast session ledger can already have delivered the energy
            // missing from an unchanged SoC report. Do not wait for the slow
            // Vehicles.Release mirror, or minimum runtime could continue PV
            // charging beyond that target with an old positive allocation.
            const context = this.adapter.engineContext;
            if (typeof context?.vehicleState !== 'function') return 'Aktuelle Fahrzeug-Preisfreigabe fehlt';
            try {
                if (context.vehicleState(wb).release !== true)
                    return 'Aktueller Fahrzeugbedarf beendet oder Fahrzeugfreigabe entzogen';
            } catch (_) { return 'Aktuelle Fahrzeug-Preisfreigabe ungueltig'; }
        }
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
            || this.now() - Number(this.own('System.LastUpdate') || 0) > 30000
            || this.now() - Number(this.own('Control.LastUpdate') || 0) > 10000
            || [this.own('System.LastUpdate'), this.own('Control.LastUpdate')]
                .some(value => !Number.isFinite(Number(value)) || Number(value) > this.now() + 1000)) {
            if (this.restartHandoffWaiting(d))
                return 'WAIT_RESTART_HANDOFF';
            return 'EMS-/Reglerdaten ungueltig oder veraltet';
        }
        return parallelHandoffWait ? 'WAIT_RESTART_HANDOFF'
            : parallelStartPeerWait ? 'WAIT_START_PEER' : '';
    }

    async update(d, mapping) {
        if (d.sequenceResumePending && !this.sequenceResumeEligible(d, mapping))
            this.setSequenceResume(d, false);
        if (d.stopRequest) return this.stop(d, d.stopRequest.reason);
        if (await this.enforceAlphaAuthority(d, mapping)) return;
        if (d.pending && this.now() - d.pending.at > this.feedbackTimeoutMs(d)) {
            const pending = d.pending;
            const ackId = pending.stage === 'allow' ? d.ids.allow : d.ids.feedback;
            const ackValue = pending.stage === 'allow' ? 1 : pending.amps;
            const ack = this.state(ackId);
            const observedAckAt = d.response?.ackId === ackId && d.response.ackAt > pending.at
                ? d.response.ackAt : ack?.ts;
            const timelyAck = pending.start === true && ['current', 'allow'].includes(pending.stage)
                && this.number(ackId, this.measurementMaxAgeMs()) === ackValue
                && observedAckAt > pending.at && observedAckAt <= pending.at + this.feedbackTimeoutMs(d);
            if (timelyAck && pending.stage === 'allow' && d.response?.start === true) {
                // A delayed controller tick does not invalidate an ON ACK
                // whose source timestamp met the original command deadline.
                // Vehicle time begins at that actual ACK, never at this tick.
                d.response.ackAt = observedAckAt;
                this.publish(d.wb, 'ResponseAcknowledgedAt', observedAckAt);
                this.publishStartReservation(d, 'vehicle_response', observedAckAt);
            } else if (timelyAck) {
                const reason = 'Start-Uebergabe-Frist abgelaufen trotz bestaetigtem Strombefehl; keine neue Ladefreigabe';
                this.publishResponse(d, 'timeout', 0, reason);
                return this.stop(d, reason);
            } else {
                d.fault = 'Keine passende go-e-Rueckmeldung; Ausgang gesperrt bis Adapter-Neustart';
                this.publishResponse(d, 'timeout', 0, d.fault);
                this.publish(d.wb, 'OutputFault', d.fault);
                return this.stop(d, d.fault);
            }
        }
        if (d.startReservation && (!d.owned || d.recovering
            || d.startReservation.validUntil < this.now())) this.publishStartReservation(d);
        const consumptionLimit = this.gridOperatorLimit(mapping);
        const reason = this.gate(d, mapping, consumptionLimit);
        if ((reason && !['WAIT_RESTART_HANDOFF', 'WAIT_START_PEER'].includes(reason)) || d.fault)
            return this.stop(d, d.fault || reason);
        const wb = d.wb;
        const voltage = this.nominalVoltage();
        if (!Number.isFinite(voltage)) return this.stop(d, 'Parallelbetrieb: Nennspannung ungueltig');
        const combined = this.combinedMode(mapping);
        const dhwActualW = combined ? this.dhwActualPower(mapping) : 0;
        const phaseControlMode = this.phaseControlMode(d);
        if (!['fixed', 'ems', 'script'].includes(phaseControlMode))
            return this.stop(d, 'Phasenfuehrung ungueltig: fixed, ems oder script erwartet');
        const phaseSwitchEnabled = phaseControlMode !== 'fixed';
        const desiredPhases = Number(this.own(`Control.Targets.Wallbox${wb}_Phases`));
        const rawPhaseMode = phaseSwitchEnabled ? this.staticValue(d.ids.phaseMode) : null;
        const phaseMode = !['number', 'string'].includes(typeof rawPhaseMode)
            || !(this.state(d.ids.phaseMode)?.ts > 0)
            ? null : Number(rawPhaseMode);
        let confirmedPhases = phaseSwitchEnabled
            ? phaseMode === 1 ? 1 : phaseMode === 2 ? 3 : 0
            : Number(this.value(wb, 'ProductionPhases', 1));
        if (phaseSwitchEnabled && !d.ids.phaseMode)
            return this.stop(d, 'Phasenumschaltung aktiv, aber go-e-Phasenmodus-Rueckmeldung fehlt');
        if (phaseControlMode === 'ems' && ![1, 3].includes(desiredPhases))
            return this.stop(d, 'EMS-Phasenvorgabe fehlt oder ist ungueltig');
        const phaseState = this.state(d.ids.phaseMode);
        const phaseTargetState = this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${wb}_Phases`);
        const phaseTargetAt = phaseTargetState?.lc ?? phaseTargetState?.ts;
        if (d.phaseRequest?.phases === confirmedPhases && confirmedPhases === desiredPhases
            && phaseState?.ts < d.phaseRequest.targetAt) confirmedPhases = d.confirmedPhases;
        // The external EMS follower writes ack=false into the same mode state.
        // Retain only a genuinely confirmed prior topology for this exact
        // requested transition. Never promote the command to a mode ACK.
        const expectedUnacknowledgedMode = phaseControlMode === 'ems'
            && [1, 3].includes(d.confirmedPhases) && desiredPhases !== d.confirmedPhases
            && phaseState?.ack === false && !phaseState.q
            && ['number', 'string'].includes(typeof phaseState.val)
            && Number(phaseState.val) === (desiredPhases === 3 ? 2 : 1)
            && Number.isFinite(phaseState.ts) && phaseState.ts > 0
            && phaseState.ts >= Number(d.phaseRequest?.phases === desiredPhases ? d.phaseRequest.targetAt
                : this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${wb}_Phases`)?.lc
                    ?? this.state(`${this.adapter.namespace}.Control.Targets.Wallbox${wb}_Phases`)?.ts)
            && phaseState.ts <= this.now() + 1000;
        if (confirmedPhases === 0 && expectedUnacknowledgedMode) confirmedPhases = d.confirmedPhases;
        if (phaseSwitchEnabled && confirmedPhases === 0)
            return this.stop(d, 'go-e-Phasenmodus fehlt oder ist unbestaetigt/ungueltig');
        const previousPhases = d.confirmedPhases;
        const changedPhases = previousPhases > 0 && confirmedPhases !== previousPhases;
        if (changedPhases) {
            d.phaseTransitionUntil = this.now() + Math.max(30,
                Number(this.adapter.config.phaseSwitchTransitionS ?? 90)) * 1000;
            if (d.owned && phaseControlMode === 'ems' && confirmedPhases === desiredPhases
                && phaseState.ts >= phaseTargetAt
                && (d.phaseRequest?.phases === confirmedPhases || phaseTargetAt >= (d.confirmedPhaseAt || 0))) {
                // Observe fresh current ACK and electrical response after the
                // real mode ACK. This is a new observation, not a fabricated
                // successful response or a new charging session.
                const amps = d.pending?.amps || d.lastA;
                if (amps > 0) {
                    d.phasePreviousPhases = previousPhases;
                    d.response = {amps, at: phaseState.ts, ackAt: 0, phaseChange: true, phases: confirmedPhases};
                }
            }
        }
        d.confirmedPhases = confirmedPhases;
        if (phaseState?.ack === true && phaseMode !== null
            && confirmedPhases === (phaseMode === 1 ? 1 : phaseMode === 2 ? 3 : 0))
            d.confirmedPhaseAt = phaseState.ts;
        const phaseRequest = this.phaseRequestState(d, phaseControlMode, desiredPhases, confirmedPhases);
        const phaseSwitchPending = phaseRequest.pending;
        const phaseTransitionActive = phaseSwitchPending || this.now() < d.phaseTransitionUntil;
        this.publish(wb, 'ConfirmedPhases', confirmedPhases);
        this.publish(wb, 'PhaseTransitionActive', phaseTransitionActive);
        if (phaseRequest.timedOut) return this.stop(d, phaseRequest.status);
        // Until ACK, the device may already use either topology. Reserve and
        // cap the union of its old/new phases, including the stricter amp limit.
        const conservativePhaseTransition = phaseSwitchPending || d.response?.phaseChange === true;
        const phases = conservativePhaseTransition
            ? Math.max(confirmedPhases, desiredPhases, d.phasePreviousPhases || confirmedPhases) : confirmedPhases;
        if (d.startReservation && d.startReservation.phases !== phases) this.publishStartReservation(d);
        const phaseIndex = Number(this.value(wb, 'SinglePhaseGridPhase', 1)) - 1;
        if (![1, 3].includes(phases) || ![0, 1, 2].includes(phaseIndex)
            || (phases === 3 && !this.value(wb, 'PhaseSwitchEnabled', false)))
            return this.stop(d, 'Feste Phasenkonfiguration ungueltig');
        const baseMinimumA = Math.ceil(Math.max(6,
            Number(this.value(wb, phases === 3 ? 'MinCurrent3pA' : 'MinCurrent1pA', 6))));
        let maxA = Math.min(32, Number(this.value(wb, phases === 3 ? 'MaxCurrent3pA' : 'MaxCurrent1pA', 16)),
            Number(this.value(wb, 'CommissioningMaxA', 6)),
            Number(this.value(wb, 'MaxPowerW', 11000)) / (voltage * phases));
        if (conservativePhaseTransition) maxA = Math.min(maxA,
            Number(this.value(wb, 'MaxCurrent1pA', 16)), Number(this.value(wb, 'MaxCurrent3pA', 16)));
        const soc = this.number(mapping[`DP_WB${wb}_SOC`], 7200000);
        const targetSoc = Number(this.own(`Vehicles.Wallbox${wb}.TargetSoC_pct`));
        if (soc !== null && this.value(wb, 'TaperEnabled', false)) for (const stage of [1, 2]) {
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
        const houseCurrentIds = [1, 2, 3].map(p => this.adapter.config[`dhwHaL${p}CurrentId`]
            || mapping[`DP_DHW_HA_L${p}_CURRENT_A`]);
        const house = directionalConfigured ? [0, 1, 2].map(p =>
            gridConstraints.netImportCurrentA(this.number(importIds[p], SMA_GRID_MAX_AGE_MS),
                this.number(exportIds[p], SMA_GRID_MAX_AGE_MS)))
            : houseCurrentIds.map(id => this.number(id, SMA_GRID_MAX_AGE_MS));
        const powerId = mapping[`DP_WB${wb}_POWER`];
        const actualRawKW = this.number(powerId, deviceMaxAgeMs);
        const actualKW = normalizeWallboxPowerKW(actualRawKW);
        const importW = this.number(mapping.DP_GRID_IMPORT, SMA_GRID_MAX_AGE_MS);
        const exportW = this.number(mapping.DP_GRID_EXPORT, SMA_GRID_MAX_AGE_MS);
        const feedbackA = this.feedbackValue(d, 'current', deviceMaxAgeMs);
        const allow = this.feedbackValue(d, 'allow', deviceMaxAgeMs);
        const measurementNames = ['L1-Strom', 'L2-Strom', 'L3-Strom', 'Wallbox-Leistung',
            'Netzbezug', 'Netzeinspeisung', 'Ampere-Rueckmeldung', 'Ladefreigabe-Rueckmeldung'];
        const measurementIds = [1, 2, 3].map(p => mapping[`DP_WB${wb}_L${p}_A`])
            .concat([powerId, mapping.DP_GRID_IMPORT, mapping.DP_GRID_EXPORT, d.ids.feedback, d.ids.allow]);
        const invalidMeasurements = [...current, actualKW, importW, exportW, feedbackA, allow]
            .map((value, index) => {
                if (value !== null && value >= 0) return null;
                const problem = this.measurementProblem(measurementIds[index],
                    index === 4 || index === 5 ? SMA_GRID_MAX_AGE_MS : deviceMaxAgeMs);
                const detail = problem || (index === 3
                    ? `negativer Messwert ${actualRawKW * 1000} W ausserhalb der Nulltoleranz (-${WALLBOX_POWER_NOISE_TOLERANCE_W} bis 0 W)`
                    : `negativer Messwert ${value}`);
                return `${measurementNames[index]}: ${detail}`;
            })
            .filter(Boolean);
        house.forEach((value, index) => {
            if (value === null || (!directionalConfigured && value < 0)) {
                const ids = directionalConfigured ? [importIds[index], exportIds[index]]
                    : [houseCurrentIds[index]];
                const details = ids.map((id, direction) => {
                    const issue = this.measurementProblem(id, SMA_GRID_MAX_AGE_MS);
                    const label = directionalConfigured ? (direction === 0 ? 'Bezug' : 'Einspeisung') : 'Strom';
                    return issue ? `${label}: ${issue}` : '';
                }).filter(Boolean);
                invalidMeasurements.push(`Hausanschluss L${index + 1}: ${details.join(', ') || 'Messwertbereich ungueltig'}`);
            }
        });
        if (invalidMeasurements.length) {
            const houseSources = directionalConfigured ? [...importIds, ...exportIds] : houseCurrentIds;
            const smaSources = [...new Set([mapping.DP_GRID_IMPORT, mapping.DP_GRID_EXPORT, ...houseSources])]
                .filter(Boolean)
                .filter(id => this.measurementProblem(id, SMA_GRID_MAX_AGE_MS)
                    || this.number(id, SMA_GRID_MAX_AGE_MS) < 0)
                .map(id => ({id, maxAgeMs: SMA_GRID_MAX_AGE_MS}));
            const reason = `Messwert/Rueckmeldung ungueltig: ${invalidMeasurements.join('; ')}`;
            const deviceSources = measurementIds.filter((id, i) => i !== 4 && i !== 5 && id
                && this.measurementProblem(id, deviceMaxAgeMs))
                .map(id => ({id, maxAgeMs: deviceMaxAgeMs}));
            return this.stop(d, smaSources.length && !this.measurementSource
                ? this.measurementFaultDiagnostic(d, smaSources, reason)
                : deviceSources.length ? this.deviceFaultDiagnostic(d, deviceSources, reason) : reason);
        }
        d.sourceFaultEpisode = null;
        if (phases === 1 && !phaseTransitionActive && (current[1] > 1 || current[2] > 1))
            return this.stop(d, 'Gemessene Phasen passen nicht zur festen Einphasen-Konfiguration');
        if (![0, 1].includes(allow)) return this.stop(d, 'Ungueltige Ladefreigabe-Rueckmeldung');
        const available = d.ids.available ? this.number(d.ids.available, deviceMaxAgeMs) : 32;
        if (available === null || available < 0) return this.stop(d, 'Verfuegbarer go-e-Ladestrom fehlt');
        maxA = Math.min(maxA, available);
        const parallel = this.parallelEnabled() ? this.parallelAllocation(wb) : null;
        const parallelHandoffWait = parallel && !parallel.valid && reason === 'WAIT_RESTART_HANDOFF'
            && d.recovering && this.restartHandoffWaiting(d);
        if (parallel && !parallel.valid && !parallelHandoffWait) return this.stop(d, parallel.reason);
        const parallelLoads = parallel ? this.parallelLoadReservations(mapping, wb) : null;
        if (parallelLoads && !parallelLoads.valid)
            return this.stop(d, 'Parallelbetrieb: gemeinsame reale Last-/Phasenreserve ungueltig');
        if (parallel) {
            if (parallel.valid && parallel.entry.targetA <= 0
                && (!d.owned || (d.activeSince <= 0 && !d.recovering)))
                return this.stop(d, 'Parallelbetrieb: kein Startbudget zugeteilt');
            const hardBudgetW = consumptionLimit.active ? Math.min(consumptionLimit.budgetW,
                parallel.valid ? parallel.hardBudgetW ?? Infinity : Infinity)
                : parallel.valid ? parallel.hardBudgetW : null;
            if (hardBudgetW !== null) maxA = Math.min(maxA,
                Math.max(0, hardBudgetW - parallelLoads.peerW - parallelLoads.otherW) / (voltage * phases));
        }
        if (consumptionLimit.active) {
            const coordinated = this.coordinatedLoadReservation(wb);
            if (coordinated && !coordinated.valid)
                return this.stop(d, 'Gemeinsame Verbrauchermessung fuer LPC-Budget fehlt/ungueltig');
            if (!coordinated && (!Number.isFinite(dhwActualW) || dhwActualW < 0))
                return this.stop(d, 'EHZ-Leistung fuer gemeinsames LPC-Budget fehlt/ungueltig');
            maxA = Math.min(maxA,
                Math.max(0, Number(consumptionLimit.budgetW) - (coordinated ? coordinated.otherW : dhwActualW)) / (voltage * phases));
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
        if (parallelLoads) otherPendingW = otherPendingW.map((watts, p) =>
            Math.max(watts, parallelLoads.pendingPhasesW[p]));
        const used = phases === 3 ? [0, 1, 2] : [phaseIndex];
        const measuredA = Math.max(...current);
        for (const p of used) {
            // Three-phase currents need not be balanced. Each phase can only
            // reclaim its own measured load, never the largest other phase.
            const ownPhaseA = phases === 3 ? current[p] : measuredA;
            const reservedHouseA = house[p] + otherPendingW[p] / (parallel ? Math.min(230, voltage) : 230);
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
            if (d.handoffReadySince <= 0) d.handoffReadySince = this.now();
            if (this.now() - d.handoffReadySince < settleMs) {
                const remainingS = Math.max(1,
                    Math.ceil((settleMs - (this.now() - d.handoffReadySince)) / 1000));
                this.publish(wb, 'OutputStatus',
                    `Neustart-Uebergabe: EMS-Daten noch ${remainingS} s stabilisieren`);
                return;
            }
            d.recovering = false;
            d.lastA = feedbackA;
            d.lastAt = this.now();
            d.activeSince = this.now();
            d.recoveredAt = this.now();
            d.pending = null;
            this.publish(wb, 'OutputActive', true);
            this.publish(wb, 'OutputOwned', true);
            this.publish(wb, 'OutputCommand_A', feedbackA);
            this.publishReservedPower(d, feedbackA * phases * voltage);
            this.finishRestartHandoff();
            this.adapter.log.info?.(`Wallbox ${wb}: laufenden Auftrag mit ${feedbackA} A nach Neustart uebernommen`);
        }
        // maxA contains physical/device/operator limits only. The fresh soft
        // allocation below chooses the target; it must not masquerade as a
        // hard cap and reverse a still-unanswered command on every PV poll.
        const electricalResponse = this.electricalResponse(d, mapping, current, actualKW, phaseSwitchPending);
        if (electricalResponse.fault) {
            d.fault = electricalResponse.fault;
            this.publish(wb, 'OutputFault', d.fault);
            return this.stop(d, d.fault);
        }
        const targetGridW = Number(this.own('Control.TargetGridPower_W') ?? -100);
        const belowMin = soc !== null && soc < Number(this.own(`Vehicles.Wallbox${wb}.MinimumSoC_pct`));
        const mandatory = belowMin || (this.value(wb, 'DeadlineEnabled', false)
            && this.own(`Vehicles.Wallbox${wb}.MustCharge`))
            || Number(this.own(`Vehicles.Wallbox${wb}.ManualMinimumCurrent_A`) || 0) > 0;
        const requestedMinimumA = Number(this.own(`Vehicles.Wallbox${wb}.RequestedMinimumCurrent_A`) || 0);
        if (!Number.isFinite(requestedMinimumA)) return this.stop(d, 'Mindestladestrom ungueltig');
        const minimumA = parallel
            ? Math.min(maxA, Math.max(baseMinimumA, Math.ceil(parallel.entry.minimumW / (voltage * phases))))
            : mandatory ? Math.min(maxA, Math.max(baseMinimumA, Math.ceil(requestedMinimumA))) : baseMinimumA;
        const planW = Number(this.own(`Control.Targets.Wallbox${wb}_W`));
        if (!Number.isFinite(planW) || planW < 0 || !Number.isFinite(targetGridW))
            return this.stop(d, 'EMS-Leistungs-/Netzvorgabe fehlt oder ungueltig');
        const peerImportW = typeof this.adapter.engineContext?.priceProtectedPeerImportW === 'function'
            ? this.adapter.engineContext.priceProtectedPeerImportW() : 0;
        const nvpW = Math.max(0, actualKW * 1000 + targetGridW - (importW - exportW) + peerImportW);
        const price = this.currentPriceAuthorization(wb);
        const previousPriceW = Math.max(0, Number(this.own(`Control.Wallbox${wb}PriceGridCharge_W`)) || 0);
        // A tariff revision can occur after allocation and before this output
        // tick. Strip the old permission immediately, including during a
        // minimum-runtime, restart-grace or asynchronous start sequence.
        // Enabling the price option is not a grid-charge session. A PV-only
        // charger must retain ordinary minimum-runtime/stop-delay protection.
        const priceSession = price.gridW > 0 || previousPriceW > 0 || d.priceCharging === true;
        const allocatedPvW = Math.max(0, planW - previousPriceW);
        const priceSafeW = priceSession ? Math.min(planW,
            allocatedPvW + price.gridW, parallel ? Infinity : nvpW + price.gridW) : planW;
        // A still-fresh joint grant can precede the newest SMA poll. Mandatory
        // charging authorizes its explicit floor, not surplus amps from an
        // older allocation; price authorization contributes only its live W.
        const authorizedMinimumW = mandatory ? minimumA * phases * voltage : 0;
        const liveBudgetW = Math.max(nvpW + price.gridW, authorizedMinimumW);
        const requestedW = parallel ? Math.min(priceSafeW, parallel.entry.targetA * phases * voltage)
            : mandatory ? Math.max(planW, minimumA * phases * voltage)
                : combined ? priceSafeW : Math.min(priceSafeW, nvpW + price.gridW);
        // Completing an observed minimum-SoC charge ends that grid obligation;
        // it is not a passing PV dip. Never reconstruct this edge after a
        // restart already above minimum, or from missing/unqualified SoC.
        const minimumSocId = `${this.adapter.namespace}.Vehicles.Wallbox${wb}.MinimumSoC_pct`;
        // This retained threshold is written only when it changes. Its age
        // does not expire it; the original SoC still has its own freshness gate.
        const minimumSoc = this.number(minimumSocId, Infinity);
        const minimumKnown = soc !== null && soc >= 0 && soc <= 100
            && minimumSoc !== null && minimumSoc >= 0 && minimumSoc <= 100
            && this.state(minimumSocId)?.ts > 0;
        if (minimumKnown && d.owned && allow === 1 && d.lastA >= baseMinimumA) {
            if (soc < minimumSoc) {
                d.minimumChargeState = 'below';
                d.minimumChargeCompletedAt = 0;
            } else if (d.minimumChargeState === 'below') {
                d.minimumChargeState = 'completed';
                d.minimumChargeCompletedAt = this.now();
            }
        }
        if (minimumKnown && d.minimumChargeState === 'completed' && !mandatory) {
            const minimumW = baseMinimumA * phases * voltage;
            // A parallel allocation can include a peer's forced grid floor.
            // Use its explicit PV share, not positive targets or own NVP alone.
            // Older allocations without that share can prove a zero target
            // plus physical shortfall, or sufficient physical PV; otherwise
            // keep the edge pending rather than inventing a zero PV share.
            // A still-fresh allocation from before the observed SoC edge may
            // precede a real PV change. Await the next ordinary budget cycle,
            // not the configured 600-s stop delay, before classifying it.
            const pvW = !parallel ? nvpW : parallel.timestamp < d.minimumChargeCompletedAt ? null
                : parallel.entry.pvBudgetW !== undefined ? parallel.entry.pvBudgetW
                    : parallel.entry.targetA === 0 || nvpW >= minimumW ? nvpW : null;
            if (pvW !== null && pvW + price.gridW < minimumW)
                return this.stop(d, 'Mindest-SoC erreicht; kein weiteres PV-/Preisbudget oder Pflichtladebedarf');
            // Once ordinary charging can continue, a later PV dip receives
            // the normal minimum-runtime and stop-delay policy again.
            if (pvW !== null && pvW + price.gridW >= minimumW && requestedW >= minimumW)
                d.minimumChargeState = null;
        }
        let amps = Math.floor(Math.min(maxA, (requestedW + (parallel ? 0.5 : 0)) / (voltage * phases)));
        // Reconcile the latest physical budget after the independently proven
        // minimum-SoC completion/PV provenance edge above. Unknown peer grid
        // attribution cannot manufacture more current; existing soft minimum
        // runtime/stop-delay policy below still preserves an admitted floor.
        if (parallel && amps > minimumA) amps = Math.min(amps,
            Math.max(minimumA, Math.floor((liveBudgetW + 0.5) / (voltage * phases))));
        // Reclaim the observed running load once, then reserve only one new
        // ampere step. Cold starts, tariffs, phase transitions and hard caps
        // retain their nominal-power contracts. A transport ACK alone cannot
        // replenish this measured-step permission.
        const stepProof = d.measuredBudgetStep;
        if (stepProof && (conservativePhaseTransition || allow !== 1 || phases !== stepProof.phases))
            d.measuredBudgetStep = null;
        else if (stepProof) {
            const sampleIds = [powerId, ...used.map(p => mapping[`DP_WB${wb}_L${p + 1}_A`])];
            const postStep = feedbackA === stepProof.amps
                && this.state(d.ids.feedback)?.ts > stepProof.at
                && sampleIds.every(id => this.measurementState(id)?.ts > stepProof.at
                    && this.measurementState(id)?.ts >= this.state(d.ids.feedback)?.ts);
            if (postStep && actualKW * 1000 >= stepProof.powerW + 0.5 * phases * voltage
                && used.every((p, index) => current[p] >= stepProof.currents[index] + 0.5))
                d.measuredBudgetStep = null;
        }
        const nominalTargetA = Math.floor((planW + (parallel ? 0.5 : 0)) / (voltage * phases));
        const measuredStepEligible = !parallel && d.owned && allow === 1 && d.lastA >= minimumA
            && feedbackA === d.lastA && !d.pending && !d.response
            && !conservativePhaseTransition && !priceSession && !mandatory
            && !this.responseEvidence?.(wb)?.assumed
            && actualKW * 1000 > 20 && measuredA >= d.lastA - 3;
        const measuredStepA = Math.min(maxA, nominalTargetA, d.lastA + 1);
        const measuredStepRequiredW = actualKW * 1000 + (measuredStepA - d.lastA) * phases * voltage;
        const measuredStepAllowed = measuredStepEligible && amps * phases * voltage > nvpW
            && !d.measuredBudgetStep
            && measuredStepA > d.lastA && nvpW >= measuredStepRequiredW;
        if (measuredStepAllowed) amps = measuredStepA;
        const measuredBudgetIncrease = measuredStepAllowed && amps > d.lastA;
        const budgetSources = [mapping.DP_GRID_IMPORT, mapping.DP_GRID_EXPORT].map(id => ({id,
            valueW: this.number(id, SMA_GRID_MAX_AGE_MS), ts: this.measurementState(id)?.ts ?? null}));
        const electricalSources = [powerId, ...(phases === 3 ? [0, 1, 2] : [0])
            .map(p => mapping[`DP_WB${wb}_L${p + 1}_A`])]
            .map(id => ({id, value: this.measurementState(id)?.val ?? null,
                unit: id === powerId ? 'kW' : 'A', ts: this.measurementState(id)?.ts ?? null}));
        const electricalCommandAt = d.response?.at || d.electricalCommandAt || d.recoveredAt || 0;
        const freshIncreaseBudget = !parallel || (budgetSources.every(source => source.ts > electricalCommandAt)
            && parallel.timestamp > electricalCommandAt);
        const freshIncreaseResponse = this.responseEvidence?.(wb)?.assumed === true
            || electricalSources.every(source => source.ts > electricalCommandAt);
        const responseDeadlineAt = d.response ? (d.response.ackAt
            ? d.response.ackAt + this.responseSettleTimeoutMs()
            : d.response.at + this.feedbackTimeoutMs(d)) : null;
        const budgetDiagnostic = {timestamp: this.now(),
            basis: measuredBudgetIncrease ? 'measured-one-amp-step' : 'nominal',
            availableW: nvpW + price.gridW,
            authorizedMinimumW, liveBudgetW,
            requiredW: measuredBudgetIncrease ? measuredStepRequiredW : amps * phases * voltage,
            previousA: d.lastA, nextA: measuredBudgetIncrease ? measuredStepA : amps,
            pendingCommandA: d.pending?.amps ?? null,
            awaitingElectricalStep: Boolean(d.measuredBudgetStep) || electricalResponse.waiting === true,
            allocationAt: parallel?.timestamp ?? null, budgetSources, electricalSources,
            electricalCommandAt: electricalCommandAt || null,
            responseAcknowledgedAt: d.response?.ackAt || null, responseDeadlineAt,
            responseState: this.own(`Devices.Wallbox${wb}.ResponseState`) ?? null,
            freshIncreaseBudget, freshIncreaseResponse, hardMaximumA: maxA,
            liveMaximumA: Math.floor((liveBudgetW + 0.5) / (voltage * phases)),
            softTargetA: parallel?.entry.targetA ?? null, decision: 'target'};
        this.publish(wb, 'IncreaseBudget_JSON', JSON.stringify(budgetDiagnostic));
        const minimumRunSeconds = Number(this.adapter.config.wallboxMinimumRunTimeS ?? 120);
        const minimumRunMs = (Number.isFinite(minimumRunSeconds) ? Math.max(0, minimumRunSeconds) : 120) * 1000;
        const minimumRunActive = d.owned && allow === 1 && d.activeSince > 0
            && this.now() - d.activeSince < minimumRunMs;
        const startSequenceActive = d.owned && d.pending?.start === true
            && ['current', 'allow'].includes(d.pending.stage);
        const restartGraceSeconds = Number(this.adapter.config.wallboxRestartHandoffGraceS ?? 30);
        const restartGraceMs = (Number.isFinite(restartGraceSeconds) ? Math.max(10, restartGraceSeconds) : 30) * 1000;
        const restartGraceActive = d.owned && allow === 1 && d.recoveredAt > 0
            && this.now() - d.recoveredAt < restartGraceMs;
        const minimumRunRemainingS = minimumRunActive
            ? Math.max(0, Math.ceil((minimumRunMs - (this.now() - d.activeSince)) / 1000)) : 0;
        const softShortfall = !Number.isFinite(amps) || amps < minimumA;
        const stopDelaySeconds = Number(this.adapter.config.wallboxStopDelayS ?? 120);
        const stopDelayMs = (Number.isFinite(stopDelaySeconds) ? Math.max(0, stopDelaySeconds) : 120) * 1000;
        if (softShortfall && d.owned && allow === 1 && d.shortfallSince <= 0)
            d.shortfallSince = this.now();
        if (!softShortfall) d.shortfallSince = 0;
        const stopDelayActive = softShortfall && d.shortfallSince > 0
            && this.now() - d.shortfallSince < stopDelayMs;
        const stopDelayRemainingS = stopDelayActive
            ? Math.max(0, Math.ceil((stopDelayMs - (this.now() - d.shortfallSince)) / 1000)) : 0;
        this.publish(wb, 'StopDelayActive', stopDelayActive);
        this.publish(wb, 'StopDelayRemaining_s', stopDelayRemainingS);
        if (softShortfall) {
            if (!mandatory && priceSession && nvpW + price.gridW < minimumA * phases * voltage)
                return this.stop(d, 'Preisfenster beendet/ungueltig; keine Freigabe fuer Mindestlaufzeit-Netzbezug');
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
        const heldCommandA = d.pending?.amps || d.lastA;
        if (electricalResponse.waiting && d.owned && allow === 1 && heldCommandA >= minimumA) {
            // Keep ordinary regulation from reversing/winding up a command
            // while its observed electrical effect is still unknown. A new
            // hard capacity limit, withdrawn tariff permission and every
            // stop gate remain effective; this is not permission to borrow
            // additional grid power or extend the existing stop timer.
            // A falling nominal surplus is not a measured shortfall while the
            // vehicle still responds to the previous command. Preserve only
            // that bounded command (never write above a new grant). A real
            // net deficit, hard cap or tariff withdrawal reduces immediately.
            const physicalBudgetW = nvpW;
            const softResponseHold = !priceSession && (!parallel || (physicalBudgetW >= actualKW * 1000
                && parallelLoads.peerW + actualKW * 1000 <= parallel.budgetW + parallel.roundingToleranceW));
            if (amps > heldCommandA || (amps < heldCommandA && softResponseHold)) {
                amps = Math.min(maxA, heldCommandA);
                if (amps < heldCommandA && parallel)
                    amps = Math.min(amps, Math.max(minimumA, parallel.entry.targetA));
                budgetDiagnostic.decision = amps < heldCommandA ? 'hard-reduction' : 'await-electrical-response';
                budgetDiagnostic.nextA = amps;
                this.publish(wb, 'IncreaseBudget_JSON', JSON.stringify(budgetDiagnostic));
            }
        }
        // Remember actual price authorization for this run. Expiry followed
        // by a brief PV recovery must not renew permission for grid-backed
        // minimum runtime on the next dip. Clear only when the run stops.
        d.priceCharging = d.priceCharging === true || (!mandatory && price.gridW > 0);
        // Phase waiting must never manufacture a positive budget: first apply
        // the real minimum-runtime/stop-delay logic above, then suppress only
        // increases until the external controller confirms the new topology.
        // Reductions and all hard stops remain effective throughout the wait.
        if (phaseSwitchPending) {
            if (!d.owned) {
                this.publish(wb, 'OutputStatus', phaseRequest.status);
                return;
            }
            amps = Math.min(amps, Math.max(baseMinimumA, d.lastA || feedbackA));
        }
        this.publish(wb, 'FeedbackCurrent_A', feedbackA);
        this.publish(wb, 'AvailableCurrent_A', available);
        this.publish(wb, 'OutputPhases', phases);
        if (reason === 'WAIT_START_PEER') {
            // A peer can lose its minimum-SoC demand between our real startup
            // write and its ACK. Keep that bounded existing command, but do
            // not send a new ON/current increase until donor OFF and physical
            // quiet are both proved. Source, device, house and shared operator
            // caps above remain immediate stop gates. Consuming an ACK for an
            // ON already sent does not create a second start or a new timer.
            const pending = d.pending;
            if (pending?.stage === 'allow'
                && this.number(d.ids.allow, deviceMaxAgeMs) === 1
                && this.state(d.ids.allow).ts >= pending.at) {
                d.lastA = pending.amps;
                d.lastAt = this.now();
                if (d.activeSince <= 0) d.activeSince = this.now();
                d.pending = null;
                this.publishReservedPower(d, d.lastA * phases * voltage);
                this.publish(wb, 'OutputActive', true);
                this.publish(wb, 'OutputCommand_A', d.lastA);
            }
            this.publish(wb, 'OutputStatus',
                'Startauftrag erhalten; auf bestaetigtes AUS und elektrische Ruhe der abgebenden Wallbox warten');
            return;
        }
        // The net meter already includes actual heater consumption. A nominal
        // heater command mismatch alone must not block a charger. Start and
        // increase only with valid heater feedback and measured residual power
        // (or explicitly authorized mandatory/price charging). Physical phase
        // reservations and shared operator caps were checked above.
        const dhwReadyForWallboxIncrease = requiredA => (!parallel || (parallelLoads.peerW
            + Math.round(requiredA * phases * voltage) <= parallel.budgetW + parallel.roundingToleranceW + 0.001
            && (requiredA <= d.lastA || requiredA * phases * voltage <= liveBudgetW + 0.5)))
            && (!combined
            || (Number.isFinite(dhwActualW) && dhwActualW >= 0
                && (mandatory
                    // A coordinated fine regulator may already absorb all
                    // surplus and yields it to the allocated charger. Its
                    // validated reservations/caps above remain authoritative.
                    || (typeof coordination?.coordinatedEnergyEnabled === 'function'
                        && coordination.coordinatedEnergyEnabled())
                    || parallel
                    || (measuredBudgetIncrease && requiredA <= measuredStepA
                        && nvpW >= actualKW * 1000 + (requiredA - d.lastA) * phases * voltage)
                    || nvpW + price.gridW >= requiredA * phases * voltage)));
        const dhwWaitStatus = Number.isFinite(dhwActualW) && dhwActualW >= 0
            ? `Warten auf gemessenes Netzbudget: verfuegbar ${Math.round(nvpW + price.gridW)} W`
            : 'Warten auf gueltige EHZ-Leistungsmessung';
        // Start from a confirmed stopped charger. Persist ownership before first write.
        if (!d.owned) {
            if (!dhwReadyForWallboxIncrease(minimumA)) {
                this.publish(wb, 'OutputStatus',
                    dhwWaitStatus);
                return;
            }
            d.owned = true;
            await this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.OutputOwned`, true, true);
            d.pending = {stage: 'stop', at: this.now()};
            await this.send(d, 'allow', 0);
            this.publish(wb, 'OutputStatus', 'Start: Ladefreigabe aus, Rueckmeldung abwarten');
            return;
        }
        if (d.pending) {
            const pending = d.pending;
            if (pending.start === true || pending.stage === 'stop') {
                if (!dhwReadyForWallboxIncrease(pending.amps || minimumA)) {
                    this.publish(wb, 'OutputStatus', dhwWaitStatus);
                    return;
                }
            }
            if (pending.stage === 'stop') {
                if (this.number(d.ids.allow, deviceMaxAgeMs) !== 0
                    || this.state(d.ids.allow).ts < pending.at) return;
                d.pending = {stage: 'current', amps: minimumA, at: this.now(), start: true};
                await this.send(d, 'command', minimumA);
                return;
            }
            // A lower still-valid current target supersedes an outstanding
            // increase. Stopping the charger here used to turn an ordinary
            // WB/EHZ reallocation into allow=0 and a new start delay. Hard
            // gates and caps have already returned above; therefore replace
            // the command and wait for its acknowledgement instead.
            // A replaced command no longer owns an electrical step proof.
            // Clear it here as well as in the ordinary reduction path: lastA
            // may still equal the replacement while the higher ACK is pending.
            if (amps < pending.amps) {
                d.measuredBudgetStep = null;
                const resumeStart = pending.start === true || pending.stage === 'allow';
                d.pending = {stage: 'current', amps, at: this.now(), start: resumeStart};
                await this.send(d, 'command', amps);
                this.publish(wb, 'OutputStatus',
                    `Sinkendes Soll: offenen Befehl durch ${amps} A ersetzt; Rueckmeldung abwarten`);
                return;
            }
            if (pending.stage === 'current') {
                if (this.number(d.ids.feedback, deviceMaxAgeMs) !== pending.amps
                    || this.state(d.ids.feedback).ts < pending.at) return;
                if (pending.start) {
                    d.pending = {stage: 'allow', amps: pending.amps, at: this.now(), start: true};
                    await this.send(d, 'allow', 1);
                    return;
                }
            } else if (this.number(d.ids.allow, deviceMaxAgeMs) !== 1
                || this.state(d.ids.allow).ts < pending.at) return;
            d.lastA = pending.amps;
            this.publishReservedPower(d, d.lastA * phases * voltage);
            d.lastAt = this.now();
            if (pending.stage === 'allow' && d.activeSince <= 0) d.activeSince = this.now();
            d.pending = null;
        }
        if (allow !== 1) return this.stop(d, 'Ladefreigabe extern entzogen');
        if (feedbackA !== d.lastA) return this.stop(d, 'Ladestrom extern veraendert; konkurrierenden Regler pruefen');
        // A confirmed phase change may keep the same ampere command. Its
        // reservation must then follow the new topology even without a write.
        this.publishReservedPower(d, d.lastA * phases * voltage);
        this.publish(wb, 'OutputActive', true);
        this.setSequenceResume(d, false);
        this.publish(wb, 'OutputCommand_A', d.lastA);
        if (d.activeSince <= 0) d.activeSince = this.now();
        const recoveryStatus = this.now() - d.recoveredAt < 60000 ? '; nach Neustart uebernommen' : '';
        const runStatus = minimumRunActive
            ? `; Mindestlaufzeit noch ${minimumRunRemainingS} s` : '';
        const stopDelayStatus = stopDelayActive
            ? `; Leistungsdelle: ${minimumA} A, Abschaltung fruehestens in ${stopDelayRemainingS} s` : '';
        const graceStatus = restartGraceActive ? '; Neustart-Sollwertschutz aktiv' : '';
        const phaseStatus = phaseSwitchPending
            ? `; Phasenreserve ${phases}P; warte auf ${desiredPhases}P (Modus bestaetigt ${confirmedPhases}P)`
            : phaseControlMode === 'script' ? '; bestaetigte Skript-Phasen'
                : phaseSwitchEnabled ? '; EMS-Phasen bestaetigt' : '; feste Topologie';
        this.publish(wb, 'OutputStatus', `PRODUKTIV: ${d.lastA} A / ${phases} Phase(n)${phaseStatus}${combined ? '; EHZ-Feinregelung' : ''}${runStatus}${stopDelayStatus}${graceStatus}${recoveryStatus}`);
        if (electricalResponse.waiting && amps === d.lastA) {
            this.publish(wb, 'OutputStatus',
                `PRODUKTIV: ${d.lastA} A / ${phases} Phase(n)${phaseStatus}; ${electricalResponse.status}${runStatus}${stopDelayStatus}${graceStatus}`);
            return;
        }
        const cycleMs = Math.max(2, Number(this.adapter.config.slowCycleS ?? 5)) * 1000;
        const ramp = Math.max(1, Number(combined
            ? this.adapter.config.wallboxCombinedMaxStepA ?? 1
            : this.adapter.config.wallboxMaxStepA ?? 6));
        amps = Math.min(amps, d.lastA + ramp);
        if (amps > d.lastA && this.now() - d.lastAt < cycleMs) return;
        if (amps > d.lastA && (!freshIncreaseBudget || !freshIncreaseResponse)) {
            budgetDiagnostic.decision = !freshIncreaseBudget ? 'await-new-budget' : 'await-new-electrical-sample';
            budgetDiagnostic.nextA = d.lastA;
            this.publish(wb, 'IncreaseBudget_JSON', JSON.stringify(budgetDiagnostic));
            this.publish(wb, 'OutputStatus', !freshIncreaseBudget
                ? 'Warten auf neues Netzbudget nach dem letzten Befehl; keine Erhoehung'
                : 'Warten auf neue elektrische Messung nach dem letzten Befehl; keine Erhoehung');
            return;
        }
        if (amps > d.lastA && d.measuredBudgetStep) {
            this.publish(wb, 'OutputStatus', 'Warten auf neue elektrische Antwort des letzten 1-A-Budgetschritts; keine weitere Erhoehung');
            return;
        }
        if (amps > d.lastA && !dhwReadyForWallboxIncrease(amps)) {
            this.publish(wb, 'OutputStatus',
                dhwWaitStatus);
            return;
        }
        // Never wind up commands when the car/device is not taking the requested current.
        // The shadow controller may supply its simulated response to its own
        // previous command. Physical phase/house protection above always uses
        // the real measured currents, including in shadow operation.
        const simulatedResponseA = this.responseCurrentA?.(wb);
        const responseA = Number.isFinite(simulatedResponseA) && simulatedResponseA >= 0
            ? simulatedResponseA : measuredA;
        if (amps > d.lastA && responseA < d.lastA - 3) {
            this.publish(wb, 'OutputStatus', 'Warten: Fahrzeug/go-e nimmt vorgegebenen Ladestrom noch nicht ab');
            return;
        }
        if (amps !== d.lastA) {
            if (amps < d.lastA) d.measuredBudgetStep = null;
            else if (measuredBudgetIncrease) d.measuredBudgetStep = {at: this.now(),
                amps, phases, powerW: actualKW * 1000, currents: used.map(p => current[p])};
            budgetDiagnostic.nextA = amps;
            budgetDiagnostic.requiredW = measuredBudgetIncrease
                ? actualKW * 1000 + (amps - d.lastA) * phases * voltage : amps * phases * voltage;
            budgetDiagnostic.decision = amps < d.lastA ? 'reduce-current' : 'increase-current';
            this.publish(wb, 'IncreaseBudget_JSON', JSON.stringify(budgetDiagnostic));
            d.pending = {stage: 'current', amps, at: this.now(), start: false};
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
                    if (error.code === 'WALLBOX_PARALLEL_GRANT_CHANGED') {
                        await this.stop(d, error.message);
                        continue;
                    }
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



