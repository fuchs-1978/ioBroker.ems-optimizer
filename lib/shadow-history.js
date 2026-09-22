'use strict';

const RETENTION_SECONDS = 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 5000;
const CONCURRENCY = 4;

/** SQL setup is deliberately limited to the shadow recorder's own scalar states.
 * ioBroker.sql 4.1.5 uses seconds for retention and milliseconds for blockTime.
 * It adds a day internally to short retentions and cleans up every six hours:
 * this requests the 24-hour setting, not an exact physical deletion deadline.
 * Source: ioBroker/ioBroker.sql v4.1.5, src/main.ts normalizeCustomConfig/checkRetention.
 */
class ShadowHistory {
    constructor(adapter, {timeoutMs = REQUEST_TIMEOUT_MS} = {}) {
        this.adapter = adapter;
        this.timeoutMs = Math.max(1, Number(timeoutMs) || REQUEST_TIMEOUT_MS);
        this.stopped = false;
        this.initializing = null;
        this.pending = new Set();
    }

    get active() { return !this.stopped && !this.adapter.unloading; }

    async publish(key, value) {
        if (!this.active) return;
        try {
            await this.adapter.setCompatState(`${this.adapter.namespace}.Debug.Shadow.SQL.${key}`, value, true);
        } catch { /* SQL diagnostics never hold up or change the controller. */ }
    }

    // Cancellation resolves pending setup calls, and late SQL replies cannot
    // mark an unloaded/stopped recorder as enabled.
    request(start) {
        return new Promise(resolve => {
            if (!this.active) return resolve({ok: false, reason: 'stopped'});
            let timer;
            let done = false;
            const finish = result => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                this.pending.delete(cancel);
                resolve(this.active ? result : {ok: false, reason: 'stopped'});
            };
            const cancel = () => finish({ok: false, reason: 'stopped'});
            this.pending.add(cancel);
            timer = setTimeout(() => finish({ok: false, reason: 'timeout'}), this.timeoutMs);
            try { start(finish); }
            catch { finish({ok: false, reason: 'error'}); }
        });
    }

    safeId(id) {
        const prefix = `${this.adapter.namespace}.Debug.Shadow.`;
        if (typeof id !== 'string' || !id.startsWith(prefix)) return false;
        const relative = id.slice(prefix.length);
        return Boolean(relative) && !relative.startsWith('SQL.') &&
            !/(?:JSON|Snapshot|PowerTrace|Events|Ring)/i.test(relative);
    }

    async stateType(id) {
        // Read actual metadata rather than inferring a string/boolean from its
        // name: short status edges must not inherit numeric power throttling.
        const result = await this.request(finish => {
            const read = typeof this.adapter.getForeignObjectAsync === 'function'
                ? this.adapter.getForeignObjectAsync(id)
                : this.adapter.getObjectAsync(id.slice(this.adapter.namespace.length + 1));
            Promise.resolve(read).then(object => {
                const type = object?.common?.type;
                finish({ok: object?.type === 'state' && ['number', 'string', 'boolean'].includes(type)
                    && object?.common?.role !== 'json', type, custom: object?.common?.custom});
            }, () => finish({ok: false, reason: 'error'}));
        });
        return result;
    }

    async enable(instance, id, type) {
        const options = {
            enabled: true,
            retention: RETENTION_SECONDS,
            changesOnly: true,
            debounce: 0,
            debounceTime: 0,
            // Numerical power/target series need a bounded sample rate;
            // modes, reasons and validity changes retain every transition.
            blockTime: type === 'number' && /(?:_W|_A|_s|_pct)$/.test(id) ? 10000 : 0,
            changesRelogInterval: 60,
            changesMinDelta: 0,
            disableSkippedValueLogging: true,
            ignoreZero: false,
            ignoreBelowZero: false,
            ignoreBelowNumber: '',
            ignoreAboveNumber: '',
            aliasId: ''
        };
        const response = await this.request(finish => {
            const send = typeof this.adapter.compatSendTo === 'function'
                ? this.adapter.compatSendTo.bind(this.adapter) : this.adapter.sendTo.bind(this.adapter);
            send(instance, 'enableHistory', {id, options}, response => finish(response?.success === true && !response.error
                ? {ok: true} : {ok: false, reason: 'error'}));
        });
        if (!response.ok || !this.active) return response;
        const metadata = await this.stateType(id);
        if (!metadata.ok) return metadata;
        const configured = metadata.custom?.[instance];
        const matches = configured && Object.entries(options).every(([key, value]) =>
            typeof value === 'number' ? Number(configured[key]) === value : configured[key] === value);
        return matches ? {ok: true} : {ok: false, reason: 'verification'};
    }

    initialize(seriesIds) {
        if (!this.initializing) this.initializing = this.configure(seriesIds);
        return this.initializing;
    }

    async configure(seriesIds) {
        if (!this.active) return false;
        const instance = String(this.adapter.config?.historyInstance || '').trim();
        const definitions = [
            ['Instance', instance, 'string', 'text'],
            ['Retention_s', RETENTION_SECONDS, 'number', 'value.interval'],
            ['Enabled', false, 'boolean', 'indicator'],
            ['ConfiguredCount', 0, 'number', 'value'],
            ['Status', 'SQL-Aufzeichnung wird eingerichtet', 'string', 'text'],
            ['LastConfigured', 0, 'number', 'value.time']
        ];
        try {
            await Promise.all(definitions.map(([key, value, type, role]) => this.adapter.queueCompatState(
                `${this.adapter.namespace}.Debug.Shadow.SQL.${key}`, value,
                {name: `Shadow SQL ${key}`, type, role, read: true, write: false,
                    ...(key === 'Retention_s' ? {unit: 's'} : {})})));
        } catch { return false; }
        if (!this.active) return false;
        for (const [key, value] of definitions) await this.publish(key, value);
        if (!/^sql\.\d+$/.test(instance)) {
            await this.publish('Status', 'Keine SQL-Instanz konfiguriert; Schattenbetrieb bleibt aktiv');
            return false;
        }
        const requested = Array.isArray(seriesIds) ? seriesIds : [];
        const uniqueIds = [...new Set(requested)];
        const ids = uniqueIds.filter(id => this.safeId(id));
        let failed = uniqueIds.length - ids.length;
        let configured = 0;
        let timedOut = false;
        let index = 0;
        const worker = async () => {
            while (this.active && index < ids.length) {
                const id = ids[index++];
                // Objects may still be in the adapter's creation queue if a
                // caller starts this independently of the shadow initializer.
                const ready = this.adapter.objectPromises?.get(id);
                if (ready) {
                    const result = await this.request(finish => Promise.resolve(ready).then(
                        () => finish({ok: true}), () => finish({ok: false, reason: 'error'})));
                    if (!result.ok) { failed++; timedOut ||= result.reason === 'timeout'; continue; }
                }
                const metadata = await this.stateType(id);
                const result = metadata.ok && this.active ? await this.enable(instance, id, metadata.type) : metadata;
                if (result.ok) configured++;
                else { failed++; timedOut ||= result.reason === 'timeout'; }
            }
        };
        await Promise.all(Array.from({length: Math.min(CONCURRENCY, ids.length)}, worker));
        if (!this.active) return false;
        const success = ids.length > 0 && failed === 0 && configured === ids.length;
        await this.publish('ConfiguredCount', configured);
        await this.publish('Enabled', success);
        await this.publish('Status', success
            ? `${instance}: ${configured} Schatten-Zeitreihen bestaetigt, Aufbewahrung 24 h (SQL-Loeschpuffer zusaetzlich)`
            : `${instance}: ${configured}/${uniqueIds.length} Schatten-Zeitreihen bestaetigt; ${timedOut ? 'SQL-Antwort fehlt' : 'Einrichtung unvollstaendig'}`);
        if (success) await this.publish('LastConfigured', Date.now());
        return success;
    }

    stop() {
        this.stopped = true;
        for (const cancel of [...this.pending]) cancel();
    }
}

module.exports = ShadowHistory;
