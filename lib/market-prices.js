'use strict';

const https = require('node:https');

const QUARTER_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 10000;
const API_URL = 'https://api.energy-charts.info/v2/price';
const SOURCE_LABEL = 'Energy-Charts.info / Fraunhofer ISE – DE-LU (netto)';

function marketPriceUrl(now) {
    const start = Math.floor(now / QUARTER_MS) * QUARTER_MS;
    const url = new URL(API_URL);
    url.searchParams.set('bzn', 'DE-LU');
    url.searchParams.set('start', String(start / 1000));
    url.searchParams.set('end', String((start + 48 * 60 * 60 * 1000) / 1000));
    return url;
}

// The explicit v2 interval describes the delivery product. Never split an
// hourly value into invented quarter-hour market prices, or bridge null gaps.
// Contract: https://api.energy-charts.info/openapi.json (/v2/price).
function parseEnergyCharts(payload) {
    if (!payload || payload.endpoint !== 'price' || payload.bidding_zone !== 'DE-LU'
        || payload.interval_minutes !== 15 || payload.resolution !== 'PT15M')
        throw new Error('Keine bestaetigte 15-Minuten-Preisreihe fuer DE-LU');
    const series = payload.series?.find?.(item => item.id === 'day_ahead_price');
    if (!series || String(series.unit || payload.unit).replace(/\s/g, '') !== 'EUR/MWh')
        throw new Error('Unbekannte Boersenpreisserie oder Einheit');
    if (!Array.isArray(payload.data) || !payload.data.length || payload.data.length > 512)
        throw new Error('Leere oder zu grosse Boersenpreisantwort');
    const entries = [];
    let previousTs = -Infinity;
    for (const row of payload.data) {
        const ts = typeof row?.timestamp === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(row.timestamp)
            ? Date.parse(row.timestamp) : NaN;
        if (!Number.isFinite(ts) || ts % QUARTER_MS !== 0 || ts <= previousTs)
            throw new Error('Ungueltige oder unsortierte Lieferzeitpunkte');
        previousTs = ts;
        const value = row.values?.day_ahead_price;
        if (value === null || value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value))
            throw new Error('Ungueltiger Boersenpreis');
        entries.push({ts, val: value / 10, endTs: ts + QUARTER_MS});
    }
    return {entries, license: String(payload.license || '').slice(0, 1000),
        deprecated: payload.deprecated === true};
}

function validCache(raw, now) {
    try {
        const entries = JSON.parse(raw);
        if (!Array.isArray(entries) || entries.length > 512) return [];
        let previousTs = -Infinity;
        for (const entry of entries) {
            if (!entry || typeof entry.ts !== 'number' || !Number.isFinite(entry.ts)
                || entry.ts % QUARTER_MS !== 0 || entry.ts <= previousTs
                || entry.endTs !== entry.ts + QUARTER_MS
                || typeof entry.val !== 'number' || !Number.isFinite(entry.val)) return [];
            previousTs = entry.ts;
        }
        return entries.filter(entry => entry.endTs > now && entry.ts < now + 49 * 60 * 60 * 1000);
    } catch { return []; }
}

// Fixed official HTTPS endpoint; redirects are deliberately not followed.
// An absolute deadline also bounds trickling responses and DNS/TLS delays.
function fetchEnergyCharts(url, {signal, get = https.get, timeoutMs = REQUEST_TIMEOUT_MS,
    maxBytes = MAX_BODY_BYTES} = {}) {
    if (url.origin !== 'https://api.energy-charts.info' || url.pathname !== '/v2/price')
        return Promise.reject(new Error('Unzulaessige Boersenpreisadresse'));
    return new Promise((resolve, reject) => {
        let settled = false;
        let request;
        let timer;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolve(value);
        };
        const abort = () => {
            const error = new Error('Boersenpreisabruf abgebrochen');
            finish(error);
            request?.destroy(error);
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener('abort', abort, {once: true});
        timer = setTimeout(() => {
            const error = new Error('Boersenpreisabruf: Zeitlimit erreicht');
            finish(error);
            request?.destroy(error);
        }, timeoutMs);
        try {
            request = get(url, {headers: {Accept: 'application/json',
                'User-Agent': 'ioBroker.ems-optimizer (Energy-Charts DE-LU price client)'}}, response => {
                if (response.statusCode !== 200) {
                    const error = new Error(`Boersenpreisabruf HTTP ${response.statusCode}`);
                    const retrySeconds = Number(response.headers?.['retry-after']);
                    if (Number.isFinite(retrySeconds) && retrySeconds > 0)
                        error.retryAfterMs = Math.min(retrySeconds * 1000, 24 * 60 * 60 * 1000);
                    finish(error);
                    response.destroy();
                    return;
                }
                const chunks = [];
                let bytes = 0;
                response.on('data', chunk => {
                    bytes += Buffer.byteLength(chunk);
                    if (bytes > maxBytes) {
                        const error = new Error('Boersenpreisantwort ueberschreitet Groessenlimit');
                        finish(error);
                        response.destroy();
                        request?.destroy(error);
                        return;
                    }
                    chunks.push(Buffer.from(chunk));
                });
                response.on('error', error => finish(error));
                response.on('aborted', () => finish(new Error('Boersenpreisantwort unterbrochen')));
                response.on('end', () => {
                    try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                    catch { finish(new Error('Boersenpreisantwort ist kein gueltiges JSON')); }
                });
            });
            request.on('error', error => finish(error));
        } catch (error) { finish(error); }
    });
}

class MarketPrices {
    constructor(adapter, {fetch = fetchEnergyCharts, now = Date.now, onUpdate = () => {}} = {}) {
        this.adapter = adapter;
        this.fetch = fetch;
        this.now = now;
        this.onUpdate = onUpdate;
        this.entries = [];
        this.stopped = false;
        this.pending = null;
        this.abortController = null;
        this.retryAt = 0;
    }

    get enabled() { return this.adapter.config.energyPriceSource === 'energy-charts'; }
    id(suffix) { return `${this.adapter.namespace}.Market.${suffix}`; }
    write(suffix, val) { return this.adapter.setCompatState(this.id(suffix), val, true); }

    async initialize() {
        const definitions = [
            ['EnergyPrice_JSON', '[]', 'string', 'json', '', 'Boersenpreise netto ct/kWh mit gueltigem Lieferintervall'],
            ['Source', '', 'string', 'text', '', 'Quelle der Boersenpreise'],
            ['Status', '', 'string', 'text', '', 'Status des Boersenpreisabrufs'],
            ['Resolution_min', 0, 'number', 'value.interval', 'min', 'Bestaetigte Aufloesung der Boersenpreise'],
            ['LastUpdate', 0, 'number', 'value.time', '', 'Letzter erfolgreicher Boersenpreisabruf'],
            ['ValidUntil', 0, 'number', 'value.time', '', 'Ende des letzten verfuegbaren Lieferintervalls (Luecken moeglich)'],
            ['Valid', false, 'boolean', 'indicator', '', 'Boersenpreis fuer das aktuelle Intervall vorhanden'],
            ['License', '', 'string', 'text', '', 'Lizenz und Quellenangabe der Boersenpreisdaten']
        ];
        await Promise.all(definitions.map(([suffix, initial, type, role, unit, name]) =>
            this.adapter.queueCompatState(this.id(suffix), initial, {type, role, unit, name, read: true, write: false})));
        if (this.stopped || this.adapter.unloading) return;
        this.entries = this.enabled ? validCache(this.adapter.getCachedState(this.id('EnergyPrice_JSON'))?.val, this.now()) : [];
        await this.write('Source', this.enabled ? SOURCE_LABEL : 'Externer ioBroker-Datenpunkt');
        await this.write('Resolution_min', this.entries.length ? 15 : 0);
        await this.publish(this.enabled ? 'Warte auf Preisabruf' : 'Externe Preisquelle ausgewaehlt');
    }

    async publish(status) {
        if (this.stopped || this.adapter.unloading) return;
        const now = this.now();
        this.entries = this.entries.filter(entry => entry.endTs > now);
        const current = this.entries.some(entry => entry.ts <= now && now < entry.endTs);
        const json = JSON.stringify(this.entries);
        const changed = this.adapter.getCachedState(this.id('EnergyPrice_JSON'))?.val !== json;
        await Promise.all([
            this.write('Valid', current),
            this.write('ValidUntil', this.entries.at(-1)?.endTs || 0),
            this.write('Status', status),
            ...(changed ? [this.write('EnergyPrice_JSON', json)] : [])
        ]);
        if (changed && this.enabled && !this.stopped && !this.adapter.unloading) this.onUpdate();
    }

    refresh() {
        if (!this.enabled || this.stopped || this.adapter.unloading) return Promise.resolve(false);
        if (this.pending) return this.pending;
        this.pending = this.refreshOnce().finally(() => { this.pending = null; });
        return this.pending;
    }

    async refreshOnce() {
        if (this.now() < this.retryAt) {
            await this.publish('Abrufpause nach Anbieterlimit; nur gueltige gespeicherte Intervalle');
            return false;
        }
        this.abortController = new AbortController();
        try {
            const payload = await this.fetch(marketPriceUrl(this.now()), {signal: this.abortController.signal});
            if (this.stopped || this.adapter.unloading) return false;
            const result = parseEnergyCharts(payload);
            this.entries = result.entries.filter(entry => entry.endTs > this.now()
                && entry.ts < this.now() + 49 * 60 * 60 * 1000);
            await this.write('Resolution_min', 15);
            await this.write('License', result.license ? `${SOURCE_LABEL}; ${result.license}` : SOURCE_LABEL);
            await this.write('LastUpdate', this.now());
            const current = this.entries.some(entry => entry.ts <= this.now() && this.now() < entry.endTs);
            await this.publish(`${current ? 'OK: echte 15-Minuten-Boersenpreise' : 'Preis fehlt im aktuellen Lieferintervall'}${result.deprecated ? '; Anbieter kuendigt API-Abloesung an' : ''}`);
            return true;
        } catch (error) {
            if (this.stopped || this.adapter.unloading) return false;
            if (Number.isFinite(error.retryAfterMs)) this.retryAt = this.now() + error.retryAfterMs;
            const hasRemaining = this.entries.some(entry => entry.endTs > this.now());
            await this.publish(`${hasRemaining ? 'Abruffehler; gueltige gespeicherte Intervalle bleiben' : 'Keine gueltigen Boersenpreise'}: ${error.message}`);
            this.adapter.log.warn(`Energy-Charts: ${error.message}`);
            return false;
        } finally { this.abortController = null; }
    }

    stop() {
        this.stopped = true;
        this.abortController?.abort();
    }
}

module.exports = {MarketPrices, parseEnergyCharts, validCache, marketPriceUrl, fetchEnergyCharts,
    QUARTER_MS, SOURCE_LABEL};
