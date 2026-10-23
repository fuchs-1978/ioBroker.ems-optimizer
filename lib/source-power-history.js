'use strict';

const {buildNativeMapping} = require('./native-mapping');

// ioBroker.sql v4.2.1: changesRelogInterval is seconds; block/debounce are ms.
// enableHistory extends only the supplied custom fields. Keep retention,
// storage type/precision and the configuration of every other history instance.
const POLICY = Object.freeze({
    changesOnly: true, changesRelogInterval: 600, changesMinDelta: 0,
    blockTime: 0, debounceTime: 0, debounce: 0,
    disableSkippedValueLogging: true, ignoreZero: false, ignoreBelowZero: false,
    ignoreBelowNumber: '', ignoreAboveNumber: ''
});

function matches(settings) {
    return Object.entries(POLICY).every(([key, value]) => typeof value === 'number'
        ? settings?.[key] !== '' && settings?.[key] != null && Number(settings[key]) === value
        : settings?.[key] === value);
}

class SourcePowerHistory {
    constructor(adapter, {timeoutMs = 5000} = {}) {
        this.adapter = adapter;
        this.timeoutMs = Math.max(1, Number(timeoutMs) || 5000);
        this.pending = new Set();
        this.stopped = false;
        this.initializing = null;
    }

    get active() { return !this.stopped && !this.adapter.unloading; }

    request(start) {
        return new Promise(resolve => {
            if (!this.active) return resolve({ok: false, reason: 'stopped'});
            let done = false, timer;
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

    read(id) {
        return this.request(finish => Promise.resolve(this.adapter.getForeignObjectAsync(id))
            .then(object => finish({ok: true, object}), () => finish({ok: false, reason: 'read-error'})));
    }

    eligible(object, instance) {
        const common = object?.common, settings = common?.custom?.[instance];
        return object?.type === 'state' && common?.type === 'number'
            && common.read !== false && common.write !== true && !common.alias
            && ['W', 'kW'].includes(common.unit) && settings?.enabled === true
            && !settings.counter && !String(settings.aliasId || '').trim()
            && (!settings.storageType || settings.storageType === 'Number');
    }

    async publish(report) {
        if (!this.active) return;
        const id = `${this.adapter.namespace}.Debug.SourcePowerHistory`;
        await this.adapter.queueCompatState(id, '', {type: 'string', role: 'json',
            name: 'PV / wallbox scalar SQL history setup', read: true, write: false});
        if (this.active) this.adapter.setCompatState(id, JSON.stringify(report), true);
    }

    initialize() {
        if (!this.initializing) this.initializing = this.configure();
        return this.initializing;
    }

    async configure() {
        const config = this.adapter.config || {}, mapping = buildNativeMapping(config);
        const instance = String(mapping.DP_SQL_INSTANCE || '').trim();
        const report = {instance, relogSeconds: 600, status: 'pending', checkedAt: Date.now(), sources: []};
        if (config.sourcePowerHistoryEnabled === false) report.status = 'disabled';
        else if (!/^sql\.\d+$/.test(instance)) report.status = 'unsupported-instance';
        else {
            const ids = [...new Set(['DP_PV_POWER', 'DP_WB0_POWER', 'DP_WB1_POWER', 'DP_WB2_POWER']
                .map(key => mapping[key]).filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
            for (const id of ids) {
                if (!this.active) return;
                const source = {id, status: 'skipped'};
                report.sources.push(source);
                // Never accept wildcards, own derived/recorder states or adapter objects.
                if (/[\s*?]/.test(id) || id.startsWith(`${this.adapter.namespace}.`) || id.startsWith('system.')) continue;
                const before = await this.read(id);
                if (!before.ok) { source.status = before.reason; report.status = 'incomplete'; break; }
                if (!this.eligible(before.object, instance)) continue;
                if (matches(before.object.common.custom[instance])) { source.status = 'already-configured'; continue; }
                const result = await this.request(finish => this.adapter.compatSendTo(instance, 'enableHistory',
                    {id, options: {...POLICY}}, response => finish({ok: response?.success === true && !response.error,
                        reason: 'sql-rejected'})));
                if (!result.ok) { source.status = result.reason; report.status = 'incomplete'; break; }
                const after = await this.read(id);
                if (!after.ok || !this.eligible(after.object, instance) || !matches(after.object.common.custom[instance])) {
                    source.status = after.ok ? 'verification-failed' : after.reason;
                    report.status = 'incomplete';
                    break;
                }
                source.status = 'configured';
            }
            if (report.status === 'pending') report.status = 'complete';
        }
        // No retry after an uncertain callback, no history query and no output write.
        await this.publish(report);
        return report;
    }

    stop() {
        this.stopped = true;
        for (const cancel of [...this.pending]) cancel();
    }
}

module.exports = {SourcePowerHistory, POLICY};
