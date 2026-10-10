'use strict';

const {readTopology} = require('./sunenergy-heads');
const SUN_SETPOINT = /^(sunenergyxt500\.\d+)\.heads\.([1-3])\.control\.GS$/;

function batteryHeadOwnership(adapter) {
    const value = adapter.getCachedState(`${adapter.namespace}.Devices.Battery.HeadOwnership_JSON`)?.val;
    if (value === undefined || value === null || value === '') return [];
    let parsed;
    try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
    catch { throw new Error('Speicherkopf-Besitzliste unlesbar; manuelle Rueckgabe erforderlich'); }
    // Up to three current plus three former claims can survive a mapping change.
    // This is an ownership ledger; the active topology still allows only 1–3.
    if (parsed?.version !== 1 || !Array.isArray(parsed.heads) || parsed.heads.length > 6)
        throw new Error('Speicherkopf-Besitzliste ungueltig; manuelle Rueckgabe erforderlich');
    const ids = new Set();
    for (const head of parsed.heads) {
        if (!Number.isInteger(head?.index) || head.index < 1 || head.index > 3
            || typeof head.setpointId !== 'string' || !SUN_SETPOINT.test(head.setpointId)
            || Number(head.setpointId.match(SUN_SETPOINT)[2]) !== head.index
            || ids.has(head.setpointId) || typeof head.owned !== 'boolean')
            throw new Error('Speicherkopf-Besitzliste ungueltig; manuelle Rueckgabe erforderlich');
        ids.add(head.setpointId);
    }
    const numeric = value => ['number', 'string'].includes(typeof value)
        && !(typeof value === 'string' && !value.trim()) && Number.isFinite(Number(value)) ? Number(value) : 0;
    // A partially persisted boolean cannot release an unresolved command or its
    // high-water reservation. Keep the exact former target available for zero.
    return parsed.heads.filter(head => head.owned || numeric(head.reservedChargeW) > 0
        || numeric(head.unobservedCommandW) !== 0 || numeric(head.commandW) !== 0);
}

function outputIds(config) {
    const keys = ['dhwSetpointId', 'dhwActualMirrorId', 'heatingSetpointId',
        ...[0, 1, 2].flatMap(wb => [`wb${wb}AmpereOutputId`, `wb${wb}AllowOutputId`])]
        .map(key => String(config[key] || '').trim()).filter(Boolean);
    if (config.batteryDispatchMode === 'sunenergy-heads') {
        const topology = readTopology(config);
        if (topology.valid) keys.push(...topology.heads.map(head => head.setpointId));
    } else {
        const id = String(config.batterySetpointId || '').trim();
        if (id) keys.push(id);
    }
    return keys;
}

async function numericWritable(adapter, id) {
    const object = await adapter.getForeignObjectAsync(id);
    return object?.type === 'state' && object.common?.type === 'number'
        && object.common.write === true
        && (!object.common.unit || object.common.unit === 'W');
}

// Verification is deliberately separate from the VM's synchronous controller.
// Only declared actuator targets can enter the foreign-write allowlist. Changes
// to relevant metadata revoke DriverReady before the asynchronous recheck.
class OutputMetadata {
    constructor(adapter) {
        this.adapter = adapter;
        this.watched = new Set();
        this.pending = null;
        this.refreshAgain = false;
    }

    changed(id) {
        if (!this.watched.has(id) || this.adapter.unloading) return;
        for (const device of ['Battery', 'MyPV_Heating', 'MyPV_DHW'])
            this.adapter.setCompatState(`${this.adapter.namespace}.Devices.${device}.DriverReady`, false);
        this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Battery.SingleHeadVerified`, false);
        this.adapter.setCompatState(`${this.adapter.namespace}.Devices.Battery.HeadsVerified`, false);
        void this.refresh().catch(error => this.adapter.log.warn(`Output metadata recheck failed: ${error.message}`));
    }

    async watch(id) {
        if (this.watched.has(id)) return;
        if (typeof this.adapter.subscribeForeignObjectsAsync !== 'function')
            throw new Error('Objektueberwachung fuer den Ausgang nicht verfuegbar');
        await this.adapter.subscribeForeignObjectsAsync(id);
        this.watched.add(id);
    }

    refresh() {
        if (this.pending) { this.refreshAgain = true; return this.pending; }
        this.pending = (async () => {
            do {
                this.refreshAgain = false;
                await this.check();
            } while (this.refreshAgain && !this.adapter.unloading);
        })().finally(() => { this.pending = null; });
        return this.pending;
    }

    async check() {
        const adapter = this.adapter;
        const config = adapter.config;
        const collisions = outputIds(config);
        let headOwnership = [];
        let headOwnershipError = '';
        try { headOwnership = batteryHeadOwnership(adapter); }
        catch (error) { headOwnershipError = error.message; }
        for (const [device, key] of [['Battery', 'batterySetpointId'],
            ['MyPV_Heating', 'heatingSetpointId'], ['MyPV_DHW', 'dhwSetpointId']]) {
            if (device === 'Battery' && config.batteryDispatchMode === 'sunenergy-heads') {
                await this.checkHeads(collisions, headOwnership, headOwnershipError);
                continue;
            }
            const id = String(config[key] || '').trim();
            let ready = false;
            let singleHeadVerified = false;
            let status = 'Kein Ausgang konfiguriert';
            let formerError = '';
            // Return the recorded former owner independently of validation of
            // its replacement. An invalid new mapping must not block old=0.
            const base = `${adapter.namespace}.Devices.${device}`;
            if (device === 'Battery') {
                for (const former of headOwnership) {
                    if (former.setpointId === id) continue;
                    try { await this.allowFormerBatteryHead(former.setpointId, collisions); }
                    catch (error) { formerError = error.message; }
                }
                if (headOwnershipError) formerError = headOwnershipError;
            }
            const oldId = adapter.getCachedState(`${base}.OutputSetpointId`)?.val;
            if (adapter.getCachedState(`${base}.OutputOwned`)?.val === true
                && typeof oldId === 'string' && oldId && oldId !== id) {
                try {
                    if (oldId.startsWith(`${adapter.namespace}.`)
                        || (device === 'Battery' && !SUN_SETPOINT.test(oldId))
                        || !await numericWritable(adapter, oldId))
                        throw new Error('Frueherer Ausgang nicht sicher pruefbar; manuelle Rueckgabe erforderlich');
                    if (collisions.includes(oldId))
                        throw new Error('Frueherer Ausgang inzwischen einem anderen Verbraucher zugeordnet; manuelle Rueckgabe erforderlich');
                    adapter.allowedForeignWriteIds.add(oldId);
                    adapter.zeroOnlyForeignWriteIds.add(oldId);
                } catch (error) {
                    formerError = error.message;
                }
            }
            try {
                if (device === 'Battery' && !['single-head', 'single', 'sunenergy-heads'].includes(config.batteryDispatchMode || 'single-head'))
                    throw new Error('Unbekannter Speicher-Ausgabemodus; keine produktive Ausgabe');
                if (id) {
                    if (collisions.filter(value => value === id).length !== 1)
                        throw new Error('Ausgang mehrfach oder als Messwertspiegel konfiguriert');
                    const heldByOther = ['Battery', 'MyPV_Heating', 'MyPV_DHW'].some(other => other !== device
                        && adapter.getCachedState(`${adapter.namespace}.Devices.${other}.OutputOwned`)?.val === true
                        && adapter.getCachedState(`${adapter.namespace}.Devices.${other}.OutputSetpointId`)?.val === id);
                    if (heldByOther || (device !== 'Battery' && headOwnership.some(head => head.setpointId === id)))
                        throw new Error('Ausgang noch einem anderen EMS-Geraet zugeordnet; zuerst dessen sichere Rueckgabe pruefen');
                    if (id.startsWith(`${adapter.namespace}.`))
                        throw new Error('Eigene EMS-Objekte sind keine Aktorausgaenge');
                    if (device !== 'Battery' && SUN_SETPOINT.test(id))
                        throw new Error('Sun-Energy-GS ist kein my-PV-Heizausgang');
                    if (!await numericWritable(adapter, id))
                        throw new Error('Ausgang muss ein schreibbarer numerischer Watt-Datenpunkt sein');
                    await this.watch(id);
                    if (device === 'Battery') {
                        const match = id.match(SUN_SETPOINT);
                        if (!match) throw new Error('Direktanbindung erwartet Sun-Energy heads.N.control.GS');
                        const instanceId = `system.adapter.${match[1]}`;
                        await this.watch(instanceId);
                        const instance = await adapter.getForeignObjectAsync(instanceId);
                        if (instance?.common?.enabled !== true || instance?.native?.controlMode !== 'off')
                            throw new Error('Sun-Energy-Adapter muss aktiviert sein und controlMode=off verwenden; kein zweiter Regler');
                        const configuredHeads = [1, 2, 3].filter(head =>
                            typeof instance.native[`head${head}Host`] === 'string'
                            && instance.native[`head${head}Host`].trim());
                        const selectedHead = Number(id.match(/\.heads\.(\d+)\./)[1]);
                        if (!configuredHeads.includes(selectedHead))
                            throw new Error('Sun-Energy-Ausgang gehoert zu keinem konfigurierten Speicher-Kopf');
                        singleHeadVerified = configuredHeads.length === 1;
                    }
                    adapter.allowedForeignWriteIds.add(id);
                    ready = true;
                    status = 'Ausgangsmetadaten geprueft; Live-Freigaben und Messwerte werden separat geprueft';
                }
                if (formerError) throw new Error(formerError);
            } catch (error) {
                ready = false;
                status = error.message;
            }
            if (adapter.unloading) return;
            if (device === 'Battery')
                await adapter.setCompatState(`${base}.SingleHeadVerified`, ready && singleHeadVerified);
            if (device === 'Battery')
                await adapter.setCompatState(`${base}.HeadsVerified`, false);
            await adapter.setCompatState(`${adapter.namespace}.Devices.${device}.DriverReady`, ready);
            await adapter.setCompatState(`${adapter.namespace}.Devices.${device}.DriverStatus`, status);
        }
    }

    async allowFormerBatteryHead(id, collisions) {
        const adapter = this.adapter;
        if (!SUN_SETPOINT.test(id) || !await numericWritable(adapter, id))
            throw new Error('Frueherer Speicher-Kopf nicht sicher pruefbar; manuelle Rueckgabe erforderlich');
        if (collisions.includes(id))
            throw new Error('Frueherer Speicher-Kopf inzwischen einem anderen Verbraucher zugeordnet; manuelle Rueckgabe erforderlich');
        await this.watch(id);
        adapter.allowedForeignWriteIds.add(id);
        adapter.zeroOnlyForeignWriteIds.add(id);
    }

    async checkHeads(collisions, ownership, ownershipError) {
        const adapter = this.adapter;
        const config = adapter.config;
        const base = `${adapter.namespace}.Devices.Battery`;
        const topology = readTopology(config);
        const currentIds = topology.valid ? topology.heads.map(head => head.setpointId) : [];
        let ready = false;
        let status = topology.reason || 'Speicherkopf-Konfiguration ungueltig';
        let formerError = ownershipError;
        // Ownership survives a topology or driver change. Validate zero targets
        // independently of the new topology so that an invalid replacement does
        // not strand an already commanded head.
        const formerIds = new Set(ownership.map(head => head.setpointId));
        const oldId = adapter.getCachedState(`${base}.OutputSetpointId`)?.val;
        if (adapter.getCachedState(`${base}.OutputOwned`)?.val === true
            && typeof oldId === 'string' && oldId) formerIds.add(oldId);
        for (const formerId of formerIds) {
            if (currentIds.includes(formerId)) continue;
            try { await this.allowFormerBatteryHead(formerId, collisions); }
            catch (error) { formerError = error.message; }
        }
        try {
            if (!topology.valid) throw new Error(status);
            if (formerError) throw new Error(formerError);
            const instanceId = `system.adapter.${topology.instance}`;
            await this.watch(instanceId);
            const instance = await adapter.getForeignObjectAsync(instanceId);
            if (instance?.common?.enabled !== true || instance?.native?.controlMode !== 'off')
                throw new Error('Sun-Energy-Adapter muss aktiviert sein und controlMode=off verwenden; kein zweiter Regler');
            const configuredHeads = [1, 2, 3].filter(index =>
                typeof instance.native[`head${index}Host`] === 'string' && instance.native[`head${index}Host`].trim());
            if (configuredHeads.length !== topology.count
                || configuredHeads.some((index, position) => index !== topology.heads[position].index))
                throw new Error('EMS-Kopfzahl muss alle konfigurierten Sun-Energy-Koepfe 1 bis N exakt abdecken');
            for (const head of topology.heads) {
                const id = head.setpointId;
                if (collisions.filter(value => value === id).length !== 1)
                    throw new Error('Speicherkopf-Ausgang mehrfach oder als Messwertspiegel konfiguriert');
                if (['MyPV_Heating', 'MyPV_DHW'].some(other =>
                    adapter.getCachedState(`${adapter.namespace}.Devices.${other}.OutputOwned`)?.val === true
                    && adapter.getCachedState(`${adapter.namespace}.Devices.${other}.OutputSetpointId`)?.val === id))
                    throw new Error('Speicherkopf noch einem anderen EMS-Geraet zugeordnet; zuerst dessen sichere Rueckgabe pruefen');
                if (!await numericWritable(adapter, id))
                    throw new Error('Jeder Speicherkopf-Ausgang muss ein schreibbarer numerischer Watt-Datenpunkt sein');
                await this.watch(id);
            }
            // Publish the complete allowlist only after all declared heads pass.
            for (const id of currentIds) {
                adapter.allowedForeignWriteIds.add(id);
                adapter.zeroOnlyForeignWriteIds.delete(id);
            }
            ready = true;
            status = `${topology.count} Sun-Energy-Kopf/Köpfe: Ausgangsmetadaten geprueft; frische Einzelkopf-Rueckmeldungen werden separat geprueft`;
        } catch (error) { status = error.message; }
        // If metadata is invalid, only already owned heads may still receive a
        // zero command. No readiness proof is manufactured from monitoring.
        if (!ready) {
            const nonBatteryIds = outputIds({...config, batteryDispatchMode: 'single', batterySetpointId: ''});
            for (const head of ownership) {
                if (!currentIds.includes(head.setpointId)) continue;
                try { await this.allowFormerBatteryHead(head.setpointId, nonBatteryIds); }
                catch (error) { status = error.message; }
            }
        }
        if (adapter.unloading) return;
        await adapter.setCompatState(`${base}.SingleHeadVerified`, ready && topology.count === 1);
        await adapter.setCompatState(`${base}.HeadsVerified`, ready);
        await adapter.setCompatState(`${base}.DriverReady`, ready);
        await adapter.setCompatState(`${base}.DriverStatus`, status);
    }
}

module.exports = {OutputMetadata, SUN_SETPOINT, batteryHeadOwnership};
