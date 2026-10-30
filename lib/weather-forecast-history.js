'use strict';

const {createHash} = require('node:crypto');
const {adapterTimers} = require('./adapter-timers');
const {buildNativeMapping} = require('./native-mapping');
const HOUR = 3600000;
const FIELDS = Object.freeze({
    temperature_2m: {min: -60, max: 70, units: ['°C']},
    wind_speed_10m: {min: 0, max: 400, units: ['km/h', 'm/s']},
    cloud_cover: {min: 0, max: 100, units: ['%']},
    relative_humidity_2m: {min: 0, max: 100, units: ['%']},
    precipitation: {min: 0, max: 500, units: ['mm']},
    sunshine_duration: {min: 0, max: 3600, units: ['s', 'h']},
    shortwave_radiation: {min: 0, max: 2000, units: ['W/m²', 'W/m2']}
});
const SQL_OPTIONS = Object.freeze({enabled: true, storageType: 'String', retention: 7776000,
    changesOnly: true, changesRelogInterval: 0, changesMinDelta: 0,
    blockTime: 0, debounce: 0, debounceTime: 0, disableSkippedValueLogging: true,
    ignoreZero: false, ignoreBelowZero: false, ignoreBelowNumber: '', ignoreAboveNumber: '', aliasId: ''});
function goodState(state, now, maxAge) {
    return state?.ack === true && (state.q === undefined || state.q === 0) && Number.isFinite(state.ts)
        && state.ts > 0 && state.ts <= now + 1000 && now - state.ts <= maxAge;
}
function cell(state, field, unit, now, dateTs = null, metadataTs = null) {
    const spec = FIELDS[field];
    let reason = null;
    if (!spec.units.includes(unit)) reason = 'unit-unavailable-or-unsupported';
    else if (!goodState(state, now, 6 * HOUR)) reason = 'source-missing-stale-or-invalid';
    else if (Number.isFinite(metadataTs) && metadataTs > state.ts) reason = 'unit-metadata-newer-than-value';
    else if (!Number.isFinite(state.val) || state.val < spec.min || state.val > spec.max
        || field === 'sunshine_duration' && unit === 'h' && state.val > 1) reason = 'value-invalid';
    else if (dateTs !== null && Math.abs(dateTs - state.ts) > 120000) reason = 'publication-skew';
    return {value: reason ? null : state.val, sourceTs: Number.isFinite(state?.ts) ? state.ts : null, reason};
}
function buildSnapshot({base, currentBase, states, units, now}) {
    const hours = [], seen = new Set(), ambiguous = new Set();
    for (let i = 0; i < 48; i++) {
        const prefix = `${base}.hour${i}`, date = states[`${prefix}.date`];
        if (!goodState(date, now, 6 * HOUR) || !Number.isFinite(date.val) || date.val % HOUR
            || date.val < now - 2 * HOUR || date.val > now + 50 * HOUR) continue;
        if (seen.has(date.val)) {ambiguous.add(date.val); continue;}
        seen.add(date.val);
        hours.push({validAt: date.val, dateSourceTs: date.ts,
            values: Object.fromEntries(Object.keys(FIELDS).map(field => [field,
                cell(states[`${prefix}.${field}`], field, units[field]?.forecast, now, date.ts, units[field]?.forecastMetadataTs)]))});
    }
    const uniqueHours = hours.filter(row => !ambiguous.has(row.validAt)).sort((a, b) => a.validAt - b.validAt);
    const current = currentBase ? {kind: 'provider-current-estimate-not-local-measurement',
        reportedTimeSourceTs: goodState(states[`${currentBase}.time`], now, HOUR)
            ? states[`${currentBase}.time`].ts : null,
        reportedTime: goodState(states[`${currentBase}.time`], now, HOUR)
            ? String(states[`${currentBase}.time`].val) : null,
        values: Object.fromEntries(Object.keys(FIELDS).map(field => [field,
            cell(states[`${currentBase}.${field}`], field, units[field]?.current, now, null, units[field]?.currentMetadataTs)]))} : null;
    const payload = {schema: 1, providerBase: base, currentBase, units,
        semantics: 'as-available-at-capture; hourly validAt is provider delivery label; per-cell publication timestamps; no retrospective issue-time inference',
        hours: uniqueHours, current};
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const publications = uniqueHours.flatMap(row => [row.dateSourceTs,
        ...Object.values(row.values).filter(value => value.reason === null).map(value => value.sourceTs)]);
    if (current?.reportedTimeSourceTs) publications.push(current.reportedTimeSourceTs);
    if (current) publications.push(...Object.values(current.values).filter(value => value.reason === null).map(value => value.sourceTs));
    return {...payload, fingerprint, capturedAt: now,
        latestSourceTs: publications.length ? Math.max(...publications) : null};
}
class WeatherForecastHistory {
    constructor(adapter, {timeoutMs = 5000, now = () => Date.now()} = {}) {
        this.adapter = adapter; this.timers = adapterTimers(adapter); this.timeoutMs = timeoutMs;
        this.now = now; this.pending = new Set(); this.stopped = false; this.timer = null;
        this.busy = false; this.configured = false; this.id = `${adapter.namespace}.Debug.WeatherArchive.Snapshot_JSON`;
    }
    get active() {return !this.stopped && !this.adapter.unloading;}
    request(start) {
        return new Promise(resolve => {
            if (!this.active) return resolve({ok: false, reason: 'stopped'});
            let done = false, timer;
            const finish = result => {
                if (done) return; done = true; this.timers.clearTimeout(timer); this.pending.delete(cancel);
                resolve(this.active ? result : {ok: false, reason: 'stopped'});
            };
            const cancel = () => finish({ok: false, reason: 'stopped'});
            this.pending.add(cancel);
            timer = this.timers.setTimeout(() => finish({ok: false, reason: 'timeout'}), this.timeoutMs);
            try {start(finish);} catch {finish({ok: false, reason: 'error'});}
        });
    }
    async readObject(id) {
        return this.request(finish => Promise.resolve(this.adapter.getForeignObjectAsync(id))
            .then(object => finish({ok: true, object}), () => finish({ok: false, reason: 'object-read-failed'})));
    }
    async status(text) {
        if (this.active) await this.adapter.setCompatState(`${this.adapter.namespace}.Debug.WeatherArchive.Status`, text, true);
    }
    async initialize() {
        const config = this.adapter.config || {};
        if (config.loadComparisonEnabled !== true || config.weatherArchiveEnabled === false) {
            if (this.adapter.getCachedState?.(`${this.adapter.namespace}.Debug.WeatherArchive.Status`)) await this.status('Deaktiviert; vorhandene SQL-Daten bleiben bis zur Aufbewahrungsgrenze erhalten');
            return;
        }
        const mapping = buildNativeMapping(config);
        this.base = String(mapping.DP_WEATHER_HOURLY_BASE || '').trim();
        this.instance = String(mapping.DP_SQL_INSTANCE || '').trim();
        await this.adapter.queueCompatState(`${this.adapter.namespace}.Debug.WeatherArchive.Status`, '',
            {type: 'string', role: 'text', read: true, write: false, name: 'Wetterarchiv: Aufzeichnung und Datenstatus'});
        if (!this.active) return;
        if (!/^sql\.\d+$/.test(this.instance) || !this.base || /[\s*?]/.test(this.base)
            || this.base.startsWith(`${this.adapter.namespace}.`) || this.base.startsWith('system.')) {
            await this.status('Nicht verfuegbar: SQL-Instanz oder Wetterbasis ungueltig'); return;
        }
        this.currentBase = this.base.includes('.forecast.hourly.') ? `${this.base.split('.forecast.hourly.')[0]}.current` : null;
        await this.adapter.queueCompatState(this.id, '',
            {type: 'string', role: 'json', read: true, write: false, name: 'Vorab verfuegbare Wetterstunden; SQL-Archiv 90 Tage'});
        if (!this.active) return;
        const enabled = await this.request(finish => this.adapter.compatSendTo(this.instance, 'enableHistory',
            {id: this.id, options: {...SQL_OPTIONS}}, response => finish({ok: response?.success === true && !response.error})));
        if (!enabled.ok || !this.active) {await this.status('SQL-Aktivierung fehlgeschlagen; keine bestaetigte Wetteraufzeichnung'); return;}
        const metadata = await this.readObject(this.id);
        const settings = metadata.object?.common?.custom?.[this.instance];
        if (!metadata.ok || !Object.entries(SQL_OPTIONS).every(([key, value]) =>
            typeof value === 'number' ? settings?.[key] !== '' && Number(settings?.[key]) === value : settings?.[key] === value)) {
            await this.status('SQL-Konfiguration nicht bestaetigt; keine bestaetigte Wetteraufzeichnung'); return;
        }
        this.configured = true;
        await this.tick();
    }
    async readUnits() {
        const units = {};
        for (const field of Object.keys(FIELDS)) {
            const forecast = await this.readObject(`${this.base}.hour0.${field}`);
            const current = this.currentBase ? await this.readObject(`${this.currentBase}.${field}`) : null;
            if (!this.active) return null;
            units[field] = {forecast: forecast.object?.common?.unit ?? null, current: current?.object?.common?.unit ?? null,
                forecastMetadataTs: forecast.object?.ts ?? null, currentMetadataTs: current?.object?.ts ?? null};
        }
        return units;
    }
    schedule() {
        if (this.active && this.configured) this.timer = this.timers.setTimeout(() => {
            this.timer = null; void this.tick().catch(error => this.adapter.warnDebug?.(error));
        }, 60000);
    }
    async tick() {
        if (!this.active || !this.configured || this.busy) return;
        this.timers.clearTimeout(this.timer); this.timer = null;
        this.busy = true;
        try {
            this.units = await this.readUnits();
            if (!this.active) return;
            const patterns = [`${this.base}.*`, ...(this.currentBase ? [`${this.currentBase}.*`] : [])];
            const states = {};
            for (const pattern of patterns) {
                const read = await this.request(finish => Promise.resolve(this.adapter.getForeignStatesAsync(pattern))
                    .then(data => finish({ok: true, data}), () => finish({ok: false})));
                if (!this.active) return;
                if (!read.ok) {await this.status('Wetterabruf fehlgeschlagen; keine alten Daten als neu gespeichert'); return;}
                Object.assign(states, read.data);
            }
            const snapshot = buildSnapshot({base: this.base, currentBase: this.currentBase, states, units: this.units, now: this.now()});
            const usable = snapshot.hours.filter(row => Object.values(row.values).some(value => value.reason === null)).length;
            if (!usable) {await this.status('Warte auf frische gueltige Wetterstunden; keine Nullauffuellung'); return;}
            // Let a provider's sequential state update finish before capture.
            if (this.now() - snapshot.latestSourceTs < 30000) {await this.status('Warte auf Abschluss der Meteo-Aktualisierung'); return;}
            let previous;
            try {previous = JSON.parse(this.adapter.getCachedState?.(this.id)?.val || 'null');} catch {previous = null;}
            if (previous?.providerBase === snapshot.providerBase && (previous.latestSourceTs > snapshot.latestSourceTs
                || previous.capturedAt > snapshot.capturedAt)) {
                await this.status('Aelterer Wetterstand verworfen; keine kuenstliche Auffrischung'); return;
            }
            if (previous?.fingerprint === snapshot.fingerprint) {await this.status(`SQL aktiviert; Wetterstand unveraendert seit ${new Date(previous.capturedAt).toLocaleString('de-DE')}`); return;}
            // One immutable sample per new settled provider state. A restart
            // cannot relabel the persisted old snapshot with a new capture time.
            const serialized = JSON.stringify(snapshot);
            if (Buffer.byteLength(serialized, 'utf8') > 60000) {await this.status('Wetterpaket zu gross; nicht gespeichert'); return;}
            if (!this.active) return;
            await this.adapter.setCompatState(this.id, serialized, true);
            if (this.active) await this.status(`Wetterstand gespeichert: ${usable}/48 Stunden mit Daten; SQL aktiviert, 90 Tage; Strahlung ${this.units.shortwave_radiation.forecast || 'nicht verfuegbar'}`);
        } finally {this.busy = false; this.schedule();}
    }
    stop() {
        this.stopped = true; this.timers.clearTimeout(this.timer); this.timer = null;
        for (const cancel of [...this.pending]) cancel();
    }
}
module.exports = {WeatherForecastHistory, buildSnapshot, SQL_OPTIONS, FIELDS};
