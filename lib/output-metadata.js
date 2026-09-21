'use strict';

const SUN_SETPOINT = /^(sunenergyxt500\.\d+)\.heads\.\d+\.control\.GS$/;

function outputIds(config) {
    return ['dhwSetpointId', 'dhwActualMirrorId', 'heatingSetpointId', 'batterySetpointId',
        ...[0, 1, 2].flatMap(wb => [`wb${wb}AmpereOutputId`, `wb${wb}AllowOutputId`])]
        .map(key => String(config[key] || '').trim()).filter(Boolean);
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
        for (const [device, key] of [['Battery', 'batterySetpointId'],
            ['MyPV_Heating', 'heatingSetpointId'], ['MyPV_DHW', 'dhwSetpointId']]) {
            const id = String(config[key] || '').trim();
            let ready = false;
            let singleHeadVerified = false;
            let status = 'Kein Ausgang konfiguriert';
            let formerError = '';
            // Return the recorded former owner independently of validation of
            // its replacement. An invalid new mapping must not block old=0.
            const base = `${adapter.namespace}.Devices.${device}`;
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
                if (id) {
                    if (collisions.filter(value => value === id).length !== 1)
                        throw new Error('Ausgang mehrfach oder als Messwertspiegel konfiguriert');
                    const heldByOther = ['Battery', 'MyPV_Heating', 'MyPV_DHW'].some(other => other !== device
                        && adapter.getCachedState(`${adapter.namespace}.Devices.${other}.OutputOwned`)?.val === true
                        && adapter.getCachedState(`${adapter.namespace}.Devices.${other}.OutputSetpointId`)?.val === id);
                    if (heldByOther)
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
            await adapter.setCompatState(`${adapter.namespace}.Devices.${device}.DriverReady`, ready);
            await adapter.setCompatState(`${adapter.namespace}.Devices.${device}.DriverStatus`, status);
        }
    }
}

module.exports = {OutputMetadata, SUN_SETPOINT};
