'use strict';
const {SMA_GRID_MAX_AGE_MS} = require('./source-diagnostics');

// Publication timestamps need a bounded skew; a declared common telegram
// receipt timestamp instead requires exact equality. Neither proves atomicity.
class GridMeasurement {
    constructor() { this.previous = null; }
    read(...args) {
        const result = this.evaluate(...args);
        this.latest = result;
        return result;
    }
    evaluate(getState, importId, exportId, now, mode = 'publication') {
        const ids = [importId, exportId], states = ids.map(id => id ? getState(id) : null);
        const numbers = states.map(s => typeof s?.val === 'number' ? s.val
            : typeof s?.val === 'string' && s.val.trim() ? Number(s.val) : NaN);
        const invalid = [];
        states.forEach((s, i) => {
            if (!s || s.ack !== true || s.q && s.q !== 0 || !Number.isFinite(numbers[i]) || numbers[i] < 0
                || !Number.isFinite(s.ts) || s.ts <= 0 || s.ts > now + 1000 || now - s.ts > SMA_GRID_MAX_AGE_MS)
                invalid.push(`${ids[i]}: Netzquelle fehlt/ungueltig/veraltet`);
        });
        if (!['publication', 'shared-receipt'].includes(mode)) invalid.push('Netz-Zeitstempelvertrag ungueltig');
        const key = JSON.stringify([importId, exportId, mode]);
        const skewMs = states.every(s => Number.isFinite(s?.ts)) ? Math.abs(states[0].ts - states[1].ts) : null;
        const maxSkewMs = mode === 'shared-receipt' ? 0 : 5000;
        if (invalid.length) return {valid: false, gridW: null, importW: null, exportW: null, invalid, mode, skewMs, maxSkewMs, held: false};
        if (skewMs <= maxSkewMs) {
            const result = {valid: true, gridW: numbers[0] - numbers[1], importW: numbers[0], exportW: numbers[1],
                sourceTs: states.map(s => s.ts), invalid: [], mode, skewMs, maxSkewMs, held: false};
            this.previous = {key, ...result};
            return result;
        }
        const previous = this.previous;
        // A short split update may keep an already witnessed pair available,
        // with its ORIGINAL times and no export credit. No new command may
        // use this as fresh pair evidence. Invalid/old sources never get held.
        if (previous?.key === key && previous.sourceTs.every(ts => now >= ts - 1000 && now - ts <= SMA_GRID_MAX_AGE_MS)) {
            const importW = Math.max(previous.importW, numbers[0]);
            return {...previous, importW, exportW: 0, gridW: importW, held: true,
                skewMs, pendingSourceTs: states.map(s => s.ts), reason: 'Netzquellen zeitversetzt; konservativer Halt ohne Einspeisegutschrift'};
        }
        return {valid: false, gridW: null, importW: null, exportW: null, invalid: ['Netzbezug/Einspeisung zeitlich unpassend'],
            mode, skewMs, maxSkewMs, held: false};
    }
}
module.exports = {GridMeasurement};
