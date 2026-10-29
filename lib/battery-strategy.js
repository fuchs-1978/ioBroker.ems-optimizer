'use strict';
// Preparation only. No actuator, state writes, timers or SQL access.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const quarterMs = 900000;
function vehicleMinimums(vehicles, inputs) {
    return (vehicles || []).slice(0, 3).map(w => {
        const p = inputs?.[w.wb];
        const known = w.SoCValid === true && finite(w.SoC_pct) && w.SoC_pct >= 0 && w.SoC_pct <= 100
            && finite(w.MinimumSoC_pct) && w.MinimumSoC_pct >= 0 && w.MinimumSoC_pct <= 100
            && finite(p?.capacityKWh) && p.capacityKWh > 0 && finite(p.efficiencyPct)
            && p.efficiencyPct >= 50 && p.efficiencyPct <= 100;
        const batteryKWh = known ? Math.max(0, w.MinimumSoC_pct - w.SoC_pct) * p.capacityKWh / 100 : null;
        return {wb: w.wb, targetSoc: finite(w.MinimumSoC_pct) ? w.MinimumSoC_pct : null,
            acKWh: batteryKWh === null ? null : batteryKWh / (p.efficiencyPct / 100),
            status: w.Present === false ? 'disabled' : !known ? 'unknown' : w.UserRelease !== true || w.Connected !== true ? 'blocked'
                : batteryKWh > 0 ? 'minimum-needed' : 'minimum-reached',
            nightGridKWh: null, automaticGridPermission: false};
    });
}
function integrate(series, now, end) {
    if (!Array.isArray(series) || series.length > 192 || !finite(end) || end <= now) return null;
    let energy = 0, covered = 0, last = -Infinity;
    for (const x of series) {
        if (!finite(x.timestamp) || x.timestamp < last + quarterMs || !finite(x.valueW) || x.valueW < 0) return null;
        last = x.timestamp;
        const dt = Math.max(0, Math.min(end, x.timestamp + quarterMs) - Math.max(now, x.timestamp));
        covered += dt; energy += x.valueW * dt / 3600000000;
    }
    return covered >= end - now ? energy : null;
}
function nightNeed({now, end, pv, house, soc, target, capacity, efficiency, vehicleKWh, pvFactor}) {
    const solar = integrate(pv, now, end), demand = integrate(house, now, end);
    if (solar === null || demand === null || vehicleKWh === null) return {status: 'unknown', acKWh: null};
    const replenish = Math.max(0, target - soc) * capacity / 100 / efficiency;
    return {status: 'energy-balance-preview', acKWh: Math.min((100 - soc) * capacity / 100 / efficiency,
        Math.max(0, replenish + demand + vehicleKWh - solar * pvFactor)),
    pvKWh: solar, usablePvKWh: solar * pvFactor, houseKWh: demand, vehicleMinimumKWh: vehicleKWh,
    note: 'Energiebilanz ist noch kein kaufbarer Nachtplan: Ladefenster, zeitliche Deckung und physische Speichergrenzen bleiben separat zu prüfen.'};
}
function strategy({now, snapshot, planning, targetPct, targetAt, planAt, pv, house, horizonEnd, efficiency, sourceAt}) {
    const minima = vehicleMinimums(snapshot.wallboxes, planning.vehicles);
    const base = {schema: 1, previewOnly: true, productionReady: false, at: now, vehicleNightTargets: minima,
        mode: 'unknown', reason: '', targetPct: null, floorPct: null, maximumPct: null,
        chargePriorityW: null, vehicleSupportW: null, fineChargeAvailableW: null, fineDischargeAvailableW: null,
        vehicleIncreaseMaxA: 1, workingBandPct: 1, supportLimitW: 500, nightBattery: {status: 'unknown', acKWh: null},
        note: 'Softwarevorbereitung ohne Freigabe: Batterie puffert fein, Fahrzeuge nur kleine Schritte. Gerätegrenzen/ACK/Leistungsantwort und sichere Rückgabe vor Aktivierung prüfen.'};
    const fail = (mode, reason) => ({...base, mode, reason});
    if (snapshot.battery?.Present === false || planning.config.batteryPresent !== true)
        return fail('not-configured', 'Batterie nicht eingerichtet; Strategie bleibt Vorschau');
    const p = snapshot.battery?.deviceProfile;
    if (p?.Valid !== true || p.CapacityValid !== true || !finite(sourceAt) || sourceAt <= 0 || sourceAt > now || now - sourceAt > 30000)
        return fail('unknown', 'Frisches Geräteprofil mit Min-/Max-SoC und Kapazität fehlt; keine Freigabe');
    const min = p.DeviceMinSoC_pct, max = p.DeviceMaxSoC_pct, soc = p.SoC_pct;
    if (![min, max, soc, p.Capacity_kWh, p.MaxCharge_W, p.MaxDischarge_W].every(finite)
        || min < 0 || min >= max || max > 100 || soc < 0 || soc > 100 || p.Capacity_kWh <= 0
        || p.MaxCharge_W < 0 || p.MaxDischarge_W < 0 || !finite(efficiency) || efficiency < 0.5 || efficiency > 1)
        return fail('unknown', 'Gerätegrenzen, Leistung, SoC oder Wirkungsgrad ungültig');
    if (!finite(targetPct) || !finite(targetAt) || !finite(planAt) || targetAt > now || now >= targetAt + quarterMs
        || planAt <= 0 || planAt > now || now - planAt > 1200000)
        return fail('unknown', 'Aktuelles gestuftes SoC-Ziel im Fahrplan nicht belegt');
    const operationalMin = snapshot.battery.minimumSoC_pct;
    const operationalMax = snapshot.battery.maximumSoC_pct;
    if (!finite(operationalMin) || !finite(operationalMax)) return fail('unknown', 'Operative Reserve oder Maximalgrenze unbekannt');
    const lower = Math.max(min, operationalMin), upper = Math.min(max, operationalMax);
    if (lower >= upper) return fail('unknown', 'Geräte- und Betriebsgrenzen haben keinen gemeinsamen Bereich');
    const target = clamp(targetPct, lower, upper), floor = Math.max(lower, target - base.workingBandPct);
    const mandatoryUnknown = minima.some(x => x.status === 'unknown');
    const mandatory = minima.some(x => x.status === 'minimum-needed');
    const pvW = finite(snapshot.power?.pv_W) ? snapshot.power.pv_W : null;
    const desiredCharge = Math.max(0, target - soc) * p.Capacity_kWh / 100 / efficiency * 4000;
    const excessW = Math.max(0, soc - target) * p.Capacity_kWh / 100 * efficiency * 4000;
    const result = {...base, targetPct: target, floorPct: floor, maximumPct: upper,
        mode: mandatoryUnknown ? 'unknown-vehicle-demand' : mandatory ? 'vehicle-minimum-first'
            : soc < floor ? 'battery-priority' : soc > target + base.workingBandPct ? 'bounded-vehicle-support' : 'hold-stage-and-buffer',
        chargePriorityW: mandatoryUnknown || mandatory ? 0 : Math.min(p.MaxCharge_W, desiredCharge),
        vehicleSupportW: mandatoryUnknown || mandatory || pvW === null || pvW <= 0 ? 0 : Math.min(p.MaxDischarge_W, base.supportLimitW, excessW),
        fineChargeAvailableW: soc < upper ? p.MaxCharge_W : 0,
        fineDischargeAvailableW: soc > floor ? p.MaxDischarge_W : 0,
        reason: mandatoryUnknown ? 'Fahrzeug-Mindestbedarf unbekannt; keine positive Unterstützungsfreigabe'
            : mandatory ? 'Fahrzeug unter Mindest-SoC hat Vorrang'
                : 'Geplantes Zwischenziel halten; Feinregelung bleibt vorgesehen, Überschuss nur begrenzt ans Fahrzeug'};
    const vehicleKWh = mandatoryUnknown ? null : minima.reduce((sum, x) => sum + (x.status === 'minimum-needed' ? x.acKWh : 0), 0);
    result.nightBattery = nightNeed({now, end: horizonEnd, pv, house, soc, target: upper,
        capacity: p.Capacity_kWh, efficiency, vehicleKWh, pvFactor: 0.9});
    if (finite(result.nightBattery.acKWh)) result.nightBattery.acKWh = Math.min(result.nightBattery.acKWh,
        Math.max(0, upper - soc) * p.Capacity_kWh / 100 / efficiency);
    result.nightBattery.pvFactor = 0.9;
    result.nightBattery.pvFactorSource = 'explizite vorsichtige Vorschauannahme, keine gemessene Prognosegenauigkeit';
    return result;
}
module.exports = {strategy, vehicleMinimums, integrate, nightNeed};
