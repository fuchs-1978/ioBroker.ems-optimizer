'use strict';

// Normalize only explicitly assigned electrical power. Inverter-only power
// remains a valid partial observation, never a whole-plant consumption budget.
function evaluateHeatPumpPower({state, id, unit = 'W', scope = 'total', maxAgeMs = 30000,
    now = Date.now()} = {}) {
    const result = {valid: false, watts: null, scope, ageS: null, reason: ''};
    const fail = reason => ({...result, reason});
    if (typeof id !== 'string' || !id.trim()) return fail('WP-Leistungsquelle nicht zugeordnet');
    if (!['W', 'kW'].includes(unit)) return fail('WP-Leistungseinheit ungueltig: W oder kW erforderlich');
    if (!['total', 'inverter'].includes(scope)) return fail('WP-Leistungsumfang ungueltig: total oder inverter erforderlich');
    if (!Number.isFinite(now) || now <= 0 || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
        return fail('WP-Leistungsfrist oder Pruefzeit ungueltig');
    if (!state || state.ack !== true || (state.q !== undefined && state.q !== 0))
        return fail('WP-Leistung fehlt oder ist unbestaetigt/qualitaetsungueltig');
    if (!Number.isFinite(state.ts) || state.ts <= 0 || state.ts > now + 1000)
        return fail('WP-Leistungszeitstempel fehlt oder ist ungueltig');
    result.ageS = Math.max(0, now - state.ts) / 1000;
    if (now - state.ts > maxAgeMs) return fail('WP-Leistung veraltet');
    if (!(typeof state.val === 'number' || typeof state.val === 'string' && state.val.trim()))
        return fail('WP-Leistung ist kein numerischer Messwert');
    const raw = Number(state.val);
    if (!Number.isFinite(raw) || raw < 0) return fail('WP-Leistung ist ungueltig oder negativ');
    // ISG's documented unavailable marker in the configured kW source must
    // not become 32.768 MW. 32768 W is not universally an unavailable marker.
    if (unit === 'kW' && raw === 32768) return fail('WP-Leistung meldet nicht verfuegbar (32768)');
    const watts = raw * (unit === 'kW' ? 1000 : 1);
    if (!Number.isFinite(watts)) return fail('WP-Leistung kann nicht in Watt umgerechnet werden');
    return {...result, valid: true, watts,
        reason: scope === 'total' ? 'Gueltige elektrische WP-Gesamtleistung'
            : 'Gueltige Inverter-Teilleistung; keine vollstaendige WP-Gesamtleistung'};
}

module.exports = {evaluateHeatPumpPower};
