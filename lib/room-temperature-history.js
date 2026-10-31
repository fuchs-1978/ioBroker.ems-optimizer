'use strict';

const {WeatherForecastHistory} = require('./weather-forecast-history');
const {buildNativeMapping} = require('./native-mapping');
const DAY = 86400;

function roomSources(raw, namespace) {
    const rooms = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(rooms) || rooms.length > 20) throw new Error('expected at most 20 rooms');
    const seen = new Set(), names = new Set();
    return rooms.map(room => {
        if (!room || typeof room.name !== 'string' || !room.name.trim() || room.name.length > 64
            || names.has(room.name.trim()) || !['hydronic', 'electric', 'unknown'].includes(room.heatingType))
            throw new Error('invalid or duplicate room name/heating type');
        names.add(room.name.trim());
        const result = {name: room.name.trim(), heatingType: room.heatingType};
        for (const key of ['actualId', 'setpointId']) {
            const id = room[key];
            if (typeof id !== 'string' || !id.trim() || id.length > 512 || /[\s*?]/.test(id)
                || id.startsWith('system.') || id.startsWith(`${namespace}.`) || seen.has(id))
                throw new Error('invalid or duplicate temperature source');
            seen.add(id); result[key] = id;
        }
        return result;
    });
}

// Reuse bounded metadata requests and shutdown cancellation. This manager never
// reads/copies temperature samples and never writes any foreign source state.
class RoomTemperatureHistory extends WeatherForecastHistory {
    constructor(adapter, options = {}) {
        super(adapter, options);
        this.id = `${adapter.namespace}.Debug.RoomHistory.Status_JSON`;
        this.configId = `${adapter.namespace}.Config.RoomHistory.Rooms_JSON`;
        this.applied = null;
    }
    async status(text) {
        if (this.active) await this.adapter.setCompatState(`${this.adapter.namespace}.Debug.RoomHistory.Status`, text, true);
    }
    async initialize() {
        if (this.adapter.config?.roomHistoryEnabled !== true) return;
        await this.adapter.queueCompatState(this.configId, '', {type: 'string', role: 'json', read: true, write: true,
            name: 'Raumhistorie: optionale Quellenliste; leer verwendet Admin-Zuordnung'});
        await this.adapter.queueCompatState(`${this.adapter.namespace}.Debug.RoomHistory.Status`, '',
            {type: 'string', role: 'text', read: true, write: false, name: 'Bestehende Raumtemperatur-SQL-Historien'});
        await this.adapter.queueCompatState(this.id, '', {type: 'string', role: 'json', read: true, write: false,
            name: 'Raumhistorie: Quellenzuordnung und gepruefte SQL-Aufbewahrung; keine Temperaturkopien'});
        if (!this.active) return;
        this.instance = String(buildNativeMapping(this.adapter.config).DP_SQL_INSTANCE || '');
        const days = this.adapter.config.roomHistoryRetentionDays ?? 90;
        if (!/^sql\.\d+$/.test(this.instance) || !Number.isInteger(days) || days < 14 || days > 365) {
            await this.status('Ungueltige SQL-Instanz oder Aufbewahrung (14–365 Tage)'); return;
        }
        this.retention = days * DAY; this.configured = true;
        await this.tick();
    }
    async ensureSource(id) {
        const before = await this.readObject(id);
        if (!this.active) return {id, status: 'stopped'};
        const object = before.object, settings = object?.common?.custom?.[this.instance];
        if (!before.ok || object?.type !== 'state' || object.common?.type !== 'number'
            || object.common?.unit !== '°C') return {id, status: 'invalid-temperature-object'};
        if (settings?.enabled !== true) return {id, status: 'not-already-recorded'};
        const retention = settings.retention;
        if (retention === '' || retention === null || retention === undefined
            || !Number.isFinite(Number(retention)) || Number(retention) < 0)
            return {id, status: 'unknown-retention'};
        // Zero means unlimited. Never shorten longer existing histories.
        if (Number(retention) === 0 || Number(retention) >= this.retention)
            return {id, status: 'verified-existing', retentionSeconds: Number(retention)};
        const options = {...settings, retention: this.retention};
        const result = await this.request(finish => this.adapter.compatSendTo(this.instance, 'enableHistory',
            {id, options}, response => finish({ok: response?.success === true && !response.error})));
        if (!result.ok || !this.active) return {id, status: 'update-unconfirmed'};
        const after = await this.readObject(id);
        const actual = after.object?.common?.custom?.[this.instance];
        if (!after.ok || !actual || Number(actual.retention) !== this.retention
            || Object.entries(settings).some(([key, value]) => key !== 'retention'
                && JSON.stringify(actual[key]) !== JSON.stringify(value)))
            return {id, status: 'settings-unconfirmed'};
        return {id, status: 'verified-extended', retentionSeconds: this.retention};
    }
    async tick() {
        if (!this.active || !this.configured || this.busy) return;
        this.timers.clearTimeout(this.timer); this.timer = null; this.busy = true;
        try {
            let rooms;
            try {
                const override = this.adapter.getCachedState?.(this.configId)?.val;
                rooms = roomSources(typeof override === 'string' && override.trim()
                    ? override : this.adapter.config.roomHistoryRooms || [], this.adapter.namespace);
            } catch {
                this.applied = null;
                await this.status('Ungueltige Raumzuordnung; keine SQL-Aenderung'); return;
            }
            const signature = JSON.stringify({rooms, instance: this.instance, retention: this.retention});
            if (signature === this.applied) return;
            if (!rooms.length) {
                this.applied = signature;
                await this.status('Warte auf Raumzuordnung; keine neuen Temperaturreihen'); return;
            }
            // Latch before external metadata requests: failed status publication
            // must not silently retry a mutation whose completion is unknown.
            this.applied = signature;
            const sources = [];
            for (const room of rooms) for (const kind of ['actualId', 'setpointId']) {
                if (!this.active) return;
                sources.push({room: room.name, heatingType: room.heatingType, kind,
                    ...await this.ensureSource(room[kind])});
            }
            if (!this.active) return;
            const verified = sources.filter(source => source.status.startsWith('verified-')).length;
            await this.adapter.setCompatState(this.id, JSON.stringify({schema: 1, checkedAt: this.now(),
                sqlInstance: this.instance, requestedRetentionDays: this.retention / DAY, rooms, sources,
                note: 'Original numeric SQL sources only; metadata verification is not proof of complete delivery. No Lasso input or actuator effect.'}), true);
            await this.status(`${verified}/${sources.length} bestehende SQL-Quellen geprueft; mindestens ${this.retention / DAY} Tage oder unbegrenzt. Keine Temperaturkopien; Datenzustellung nicht geprueft.`);
            // A timeout does not prove backend completion. Do not automatically
            // repeat an uncertain metadata mutation in the same process.
            this.applied = signature;
        } finally {this.busy = false; this.schedule();}
    }
    schedule() {
        if (this.active && this.configured) this.timer = this.timers.setTimeout(() => {
            this.timer = null; void this.tick().catch(error => this.adapter.warnDebug?.(error));
        }, 60000);
    }
}
module.exports = {RoomTemperatureHistory, roomSources};
