'use strict';
// Read-only explanations of the existing shared plan, never another allocator.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const names = ['Mii', 'EQV', 'EQE'];
function plannedEnergy(series, now, deadline) {
    if (!Array.isArray(series) || series.length > 192) return null;
    let energy = 0, previous = -Infinity;
    for (const x of series) {
        if (!finite(x.timestamp) || !finite(x.valueW) || x.valueW < 0 || x.timestamp < previous + 900000) return null;
        previous = x.timestamp;
        energy += x.valueW * Math.max(0, Math.min(deadline, x.timestamp + 900000) - Math.max(now, x.timestamp)) / 3600000000;
    }
    return energy;
}
function feasibility(w, input, now, current) {
    const result = {wb: w.wb, name: names[w.wb], status: 'unknown', reason: '',
        departureAt: null, batteryRequiredKWh: null, acRequiredKWh: null, plannedAcKWh: null,
        missingPlannedAcKWh: null, gridRequiredKWh: null, guaranteed: false};
    const done = (status, reason) => ({...result, status, reason});
    if (w.Present === false) return done('disabled', 'Fahrzeug nicht eingerichtet');
    if (w.Present !== true) return done('unknown', 'Gerätezuordnung nicht belegt');
    if (!current || w.SoCValid !== true || !finite(w.SoC_pct) || !finite(w.TargetSoC_pct) || w.SoC_pct < 0 || w.SoC_pct > 100 || w.TargetSoC_pct < 0 || w.TargetSoC_pct > 100
        || !finite(input?.capacityKWh) || input.capacityKWh <= 0
        || !finite(input.efficiencyPct) || input.efficiencyPct < 50 || input.efficiencyPct > 100)
        return done('unknown', 'Aktueller SoC, Kapazität oder Ladeverluste nicht belastbar');
    result.batteryRequiredKWh = Math.max(0, w.TargetSoC_pct - w.SoC_pct) * input.capacityKWh / 100;
    result.acRequiredKWh = result.batteryRequiredKWh / (input.efficiencyPct / 100);
    if (result.batteryRequiredKWh <= 0) return done('reached', 'Ziel-SoC bereits erreicht');
    if (input.deadlineEnabled !== true) return done('no-deadline', 'Keine aktive Abfahrtsfrist; keine fiktive Zusage');
    if (!finite(input.departureAt) || input.departureAt <= now) return done('unknown', 'Abfahrtszeit fehlt oder ist abgelaufen');
    result.departureAt = input.departureAt;
    if (w.Connected === false || w.UserRelease === false || w.ControlEnabled === false)
        return done('blocked', 'Aktuell nicht angeschlossen oder Freigabe/Regelung AUS; kein automatischer Eingriff');
    if (w.Connected !== true || w.UserRelease !== true || w.Release !== true)
        return done('unknown', 'Ladefreigabe oder Anschluss nicht eindeutig belegt');
    const upperKWh = finite(w.MaximumPower_W) && w.MaximumPower_W > 0
        ? w.MaximumPower_W * (input.departureAt - now) / 3600000000 : null;
    if (upperKWh === null) return done('unknown', 'Belastbare Leistungsgrenze fehlt');
    if (upperKWh + 0.001 < result.acRequiredKWh)
        return done('unreachable', 'Selbst mit nominaler Maximalleistung reicht die verbleibende Zeit nicht');
    if (input.planValid !== true) return done('unknown', 'Kein frischer gemeinsamer Fahrplan');
    result.plannedAcKWh = plannedEnergy(input.series, now, input.departureAt);
    if (result.plannedAcKWh === null) return done('unknown', 'Fahrplanreihe unvollständig oder ungültig');
    result.missingPlannedAcKWh = Math.max(0, result.acRequiredKWh - result.plannedAcKWh);
    return result.missingPlannedAcKWh <= 0.01
        ? done('expected-reachable', 'Im gemeinsamen Fahrplan bis Abfahrt gedeckt; Prognose, keine Garantie')
        : done('plan-shortfall', 'Im aktuellen gemeinsamen Fahrplan fehlt Ladeenergie; andere Ziele/Freigaben beachten');
}
function configuration(config, snapshot) {
    const findings = [];
    const add = (code, severity, keys, reason, action) => findings.push({code, severity, keys, reason, action});
    const pair = (keyA, keyB, scope) => {
        const a = config[keyA], b = config[keyB];
        if (!finite(a) || !finite(b)) add(`${scope}.unknown`, 'unknown', [keyA, keyB], 'Grenzwerte nicht vollständig bekannt', 'Zuordnung und Werte prüfen');
        else if (a > b) add(`${scope}.order`, 'error', [keyA, keyB], `${keyA} liegt über ${keyB}`, 'Grenzen in der Konfiguration konsistent festlegen');
    };
    for (let wb = 0; wb < 3; wb++) {
        if (config[`wb${wb}Present`] !== true) continue;
        if (config[`wb${wb}SocLimitsSource`] === 'admin') pair(`wb${wb}MinSocPct`, `wb${wb}TargetSocPct`, `wb${wb}.soc`);
        for (const p of ['1p', '3p']) {
            if (p === '3p' && config[`wb${wb}MinCurrent3pA`] === 0 && config[`wb${wb}MaxCurrent3pA`] === 0) continue;
            pair(`wb${wb}MinCurrent${p}A`, `wb${wb}MaxCurrent${p}A`, `wb${wb}.${p}`);
        }
        if (!finite(config[`wb${wb}CapacityKWh`]) || config[`wb${wb}CapacityKWh`] <= 0)
            add(`wb${wb}.capacity`, 'error', [`wb${wb}CapacityKWh`], 'Nutzbare Fahrzeugkapazität fehlt', 'Kapazität des Fahrzeugs eintragen');
        if (config[`wb${wb}ControlEnabled`] === true && !String(config[`wb${wb}PowerId`] || snapshot.wallboxes?.find(w => w.wb === wb)?.measurements?.power?.id || '').trim())
            add(`wb${wb}.mapping`, 'error', [`wb${wb}PowerId`], 'Leistungsquelle für aktiviertes Fahrzeug fehlt', 'Leistungsdatenpunkt zuordnen');
    }
    if (config.batteryPresent === true) pair('batteryMinSocPct', 'batteryMaxSocPct', 'battery.soc');
    if (config.dhwPresent === true) {
        pair('dhwMinTempC', 'dhwTargetTempC', 'dhw.target');
        pair('dhwResumeTempC', 'dhwStopTempC', 'dhw.hysteresis');
    }
    for (const w of snapshot.wallboxes || []) {
        if (w.Present !== true) continue;
        if (w.UserRelease === false) add(`wb${w.wb}.release`, 'hint', [], 'Nutzerfreigabe AUS; kann beabsichtigt sein', 'Nur bei gewünschter Ladung freigeben');
        if (w.SoCValid !== true) add(`wb${w.wb}.soc-source`, 'unknown', [], 'SoC unbekannt, kein bewiesener Konfigurationsfehler', 'SoC-Quelle und deren Qualitätsmeldung ansehen');
        if (w.OutputFault) add(`wb${w.wb}.output`, 'warning', [], String(w.OutputFault).slice(0, 250), 'Ausgangsdiagnose vor weiterem Ladeauftrag prüfen');
    }
    return {findings, status: findings.some(x => x.severity === 'error') ? 'conflict' : findings.length ? 'notes' : 'no-known-conflict',
        scope: 'Ergänzende Prüfung, keine vollständige Schutzvalidierung; keine automatische Korrektur'};
}
module.exports = {plannedEnergy, feasibility, configuration};
