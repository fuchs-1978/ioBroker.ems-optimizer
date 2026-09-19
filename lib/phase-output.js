'use strict';

// Writes the forecast-based 1/3-phase recommendation to an existing object.
// The external script/go-e integration remains responsible for the physical switch.
class PhaseOutput {
    constructor(adapter) {
        this.adapter = adapter;
        this.ready = false;
        this.busy = false;
        this.devices = [];
    }

    own(id) { return this.adapter.getCachedState(`${this.adapter.namespace}.${id}`)?.val; }
    value(wb, key, fallback) { return this.adapter.config[`wb${wb}${key}`] ?? fallback; }
    publish(wb, key, value) {
        this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.${key}`, value, true);
    }

    async initialize() {
        const outputIds = [0, 1, 2].map(wb =>
            String(this.value(wb, 'PhaseOutputId', `javascript.0.ev.pha${wb}`)).trim());
        for (let wb = 0; wb < 3; wb++) {
            const id = outputIds[wb];
            const object = id ? await this.adapter.getForeignObjectAsync(id) : null;
            const valid = Boolean(id && object?.type === 'state' && object.common?.write === true
                && object.common?.type === 'number' && outputIds.filter(x => x === id).length === 1);
            const previousWrite = Number(this.own(`Devices.Wallbox${wb}.PhaseOutputLastWrite`) || 0);
            this.devices.push({wb, id, valid, lastWriteAt: previousWrite,
                pendingCommand: 0, pendingAt: 0});
            const definitions = {
                PhaseOutputActive: false,
                PhaseOutputCommand: 0,
                PhaseOutputStatus: 'Phasenausgabe gesperrt',
                PhaseOutputLastWrite: 0
            };
            for (const [key, initial] of Object.entries(definitions)) {
                await this.adapter.queueCompatState(`${this.adapter.namespace}.Devices.Wallbox${wb}.${key}`,
                    initial, {type: typeof initial, role: typeof initial === 'boolean' ? 'indicator' : 'value'});
            }
            if (id) {
                const state = await this.adapter.getForeignStateAsync(id);
                if (state) this.adapter.stateCache.set(id, state);
                await this.adapter.subscribeForeignStatesAsync(id);
                if (valid) this.adapter.allowedForeignWriteIds.add(id);
            }
        }
        this.ready = true;
    }

    gate(d) {
        const wb = d.wb;
        if (!this.adapter.config.globalWriteEnabled || this.own('System.RealOutputsEnabled') !== true)
            return 'Globale Schreibfreigabe aus';
        if (!this.value(wb, 'PhaseOutputEnabled', false)) return 'Phasenausgabe in Admin aus';
        if (!this.value(wb, 'Present', true) || this.own(`Devices.Wallbox${wb}.Present`) !== true)
            return 'Wallbox nicht vorhanden';
        if (!this.value(wb, 'PhaseSwitchEnabled', false)
            || this.own(`Vehicles.Wallbox${wb}.PhaseSwitchEnabled`) !== true)
            return '1-/3-Phasenumschaltung nicht freigegeben';
        if (!d.valid) return 'Phasenobjekt fehlt, ist nicht schreibbar oder doppelt belegt';
        if (this.own('Plan.Valid') !== true || this.own('Control.Valid') !== true)
            return 'Fahrplan oder Regelung ungueltig';
        if (Date.now() - Number(this.own('Plan.LastUpdate') || 0) > 20 * 60 * 1000
            || Date.now() - Number(this.own('Control.LastUpdate') || 0) > 15000)
            return 'Fahrplan oder Regelung veraltet';
        if (this.own(`Vehicles.Wallbox${wb}.Connected`) !== true
            || this.own(`Vehicles.Wallbox${wb}.Release`) !== true)
            return 'Fahrzeug nicht angeschlossen oder nicht freigegeben';
        return '';
    }

    urgentThreePhase(wb, now) {
        const energyKWh = Number(this.own(`Vehicles.Wallbox${wb}.GridEnergyRequired_kWh`));
        const departure = Number(this.own(`Vehicles.Wallbox${wb}.DepartureTimestamp`));
        const maxCurrentA = Number(this.value(wb, 'MaxCurrent1pA', 16));
        const hours = (departure - now) / 3600000;
        return Number.isFinite(energyKWh) && energyKWh > 0 && hours > 0
            && energyKWh / hours * 1000 > maxCurrentA * 230;
    }

    stableForecastPhase(wb, now) {
        const lookAheadMin = Math.max(15, Number(this.adapter.config.phaseSwitchLookAheadMin ?? 30));
        const end = now + lookAheadMin * 60000;
        let series;
        try {
            series = JSON.parse(String(this.own(`Plan.Wallbox${wb}_48h_JSON`) || '[]'));
        } catch (_) {
            return 0;
        }
        if (!Array.isArray(series)) return 0;
        const duration = {1: 0, 3: 0};
        for (const slot of series) {
            const start = Number(slot?.timestamp);
            const phase = Number(slot?.phases);
            if (!Number.isFinite(start) || ![1, 3].includes(phase) || Number(slot?.valueW) <= 0) continue;
            const overlapMin = Math.max(0, Math.min(start + 15 * 60000, end) - Math.max(start, now)) / 60000;
            const chargeShare = Math.max(0, Math.min(1, Number(slot?.chargingMinutes ?? 15) / 15));
            duration[phase] += overlapMin * chargeShare;
        }
        if (duration[3] >= lookAheadMin - 0.5 && duration[1] < 0.5) return 3;
        if (duration[1] >= lookAheadMin - 0.5 && duration[3] < 0.5) return 1;
        return 0;
    }

    async update(d) {
        const reason = this.gate(d);
        if (reason) {
            this.publish(d.wb, 'PhaseOutputActive', false);
            this.publish(d.wb, 'PhaseOutputStatus', reason);
            return;
        }
        const now = Date.now();
        const desired = this.urgentThreePhase(d.wb, now) ? 3 : this.stableForecastPhase(d.wb, now);
        if (![1, 3].includes(desired)) {
            this.publish(d.wb, 'PhaseOutputActive', false);
            this.publish(d.wb, 'PhaseOutputStatus', 'Noch kein ausreichend langes eindeutiges Phasenfenster');
            return;
        }
        const observed = Number(this.adapter.getCachedState(d.id)?.val);
        if (observed === d.pendingCommand) {
            d.pendingCommand = 0;
            d.pendingAt = 0;
        }
        const current = [1, 3].includes(d.pendingCommand) && now - d.pendingAt < 15000
            ? d.pendingCommand : observed;
        const holdMs = Math.max(0, Number(this.adapter.config.phaseSwitchMinHoldMin ?? 30)) * 60000;
        if ([1, 3].includes(current) && current !== desired && now - d.lastWriteAt < holdMs) {
            const remainingMin = Math.ceil((holdMs - (now - d.lastWriteAt)) / 60000);
            this.publish(d.wb, 'PhaseOutputActive', true);
            this.publish(d.wb, 'PhaseOutputCommand', current);
            this.publish(d.wb, 'PhaseOutputStatus', `Mindesthaltezeit aktiv (${remainingMin} min)`);
            return;
        }
        this.publish(d.wb, 'PhaseOutputActive', true);
        this.publish(d.wb, 'PhaseOutputCommand', desired);
        if (current === desired) {
            this.publish(d.wb, 'PhaseOutputStatus', `${desired}-Phasen-Sollwert steht an`);
            return;
        }
        if (!this.adapter.allowedForeignWriteIds.has(d.id)) {
            this.publish(d.wb, 'PhaseOutputActive', false);
            this.publish(d.wb, 'PhaseOutputStatus', 'Schreibschutz hat Phasenbefehl blockiert');
            return;
        }
        await this.adapter.setForeignStateAsync(d.id, desired, false);
        d.lastWriteAt = now;
        d.pendingCommand = desired;
        d.pendingAt = now;
        this.publish(d.wb, 'PhaseOutputLastWrite', now);
        this.publish(d.wb, 'PhaseOutputStatus', `${desired}-Phasen-Sollwert geschrieben`);
    }

    async tick() {
        if (!this.ready || this.busy) return;
        this.busy = true;
        try {
            for (const d of this.devices) {
                try { await this.update(d); }
                catch (error) {
                    this.publish(d.wb, 'PhaseOutputActive', false);
                    this.publish(d.wb, 'PhaseOutputStatus', `Phasenausgabe Fehler: ${error.message}`);
                    this.adapter.log.error(`Wallbox ${d.wb} phase output: ${error.message}`);
                }
            }
        } finally { this.busy = false; }
    }
}

module.exports = PhaseOutput;
