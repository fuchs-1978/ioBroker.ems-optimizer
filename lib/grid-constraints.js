"use strict";

const UNLIMITED_STATES = new Set(["unlimitedautonomous", "unlimitedcontrolled"]);

function normalizedState(value) {
    return typeof value === "string" ? value.replace(/[^a-z]/gi, "").toLowerCase() : "";
}

function validLimit(value) {
    if (value === null || value === '') return null;
    const limit = Number(value);
    return Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : null;
}

const GZF_DEFAULTS = Object.freeze([0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45]
    .map((factor, index) => Object.freeze({count: index + 2, factor})));

const numericInput = value => (typeof value === 'number'
    || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;

// BK6-22-300 Anlage 1, 4.5.2. VDE FNN 2f, April 2025, retains these values.
// Pure configured population: never infer participation from plugs or charge state.
function calculateEmsMinimum({participants = [], customFactors = null} = {}) {
    const invalid = reason => ({valid: false, budgetW: null, reason});
    if (!Array.isArray(participants) || !participants.length || participants.length > 128)
        return invalid('EMS-Teilnehmertabelle fehlt oder ist zu gross');
    const ids = new Set(), counted = [], excluded = [], groups = {heatPump: 0, cooling: 0};
    for (const item of participants) {
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        const watts = numericInput(item?.connectionPowerW);
        if (!name || name.length > 100 || ids.has(name)
            || !['wallbox', 'heatPump', 'cooling', 'storage'].includes(item?.kind)
            || watts === null || watts <= 0 || watts > 1000000)
            return invalid('Teilnehmername, Typ oder elektrische Anschlussleistung fehlt/ungueltig/doppelt');
        ids.add(name);
        // Omitted flags preserve the existing configured population. A false
        // flag affects the formula only, never the runtime participant inventory.
        if (item.budgetIncluded !== undefined && typeof item.budgetIncluded !== 'boolean')
            return invalid('Budgetauswahl muss boolesch sein');
        if (item.budgetIncluded === false) {
            excluded.push({name, kind: item.kind, reason: 'Nur Budgetverteilung; nicht zur Berechnung ausgewaehlt'});
            continue;
        }
        if (Object.hasOwn(groups, item.kind)) groups[item.kind] += watts;
        else if (watts > 4200) counted.push({name, kind: item.kind, connectionPowerW: watts});
        else excluded.push({name, kind: item.kind, reason: 'Netzanschlussleistung nicht ueber 4,2 kW'});
    }
    for (const [kind, watts] of Object.entries(groups)) {
        if (watts > 4200) counted.push({name: kind === 'heatPump' ? 'WP-Gruppe inkl. Zusatzheizung' : 'Klima-Gruppe',
            kind, connectionPowerW: watts});
        else if (watts > 0) excluded.push({kind, reason: 'Gruppensumme nicht ueber 4,2 kW'});
    }
    const count = counted.length;
    if (!count) return invalid('Keine zaehlbare steuerbare Verbrauchseinrichtung konfiguriert');
    let table = GZF_DEFAULTS;
    if (customFactors !== null) {
        if (!Array.isArray(customFactors) || customFactors.length !== 8)
            return invalid('Abweichende GZF-Tabelle muss genau n=2 bis n>=9 enthalten');
        table = [];
        for (let at = 0; at < 8; at++) {
            const row = customFactors.find(item => numericInput(item?.count) === at + 2);
            const factor = numericInput(row?.factor);
            if (!row || factor === null || factor <= 0 || factor > 1
                || at > 0 && factor > table[at - 1].factor)
                return invalid('Abweichende GZF-Tabelle unvollstaendig, doppelt oder ungueltig');
            table.push({count: at + 2, factor});
        }
    }
    const factor = count === 1 ? 1 : table[Math.min(count, 9) - 2].factor;
    const largeThermal = Math.max(groups.heatPump, groups.cooling) > 11000;
    const baseW = largeThermal ? 0.4 * Math.max(groups.heatPump, groups.cooling) : 4200;
    const budgetW = Math.floor(baseW + (count - 1) * factor * 4200 + 1e-8);
    return {valid: true, budgetW, count, factor, baseW,
        heatPumpConnectionW: groups.heatPump, coolingConnectionW: groups.cooling,
        counted, excluded, factorSource: customFactors === null ? 'BK6-22-300 / VDE-FNN-2025-04' : 'custom-deviation',
        formula: largeThermal ? 'max(0.4*P_WP, 0.4*P_Klima) + (n-1)*GZF*4200 W'
            : '4200 W + (n-1)*GZF*4200 W', reason: 'Konfigurierte EMS-Mindestleistung berechnet'};
}

function binaryContactBudget(config = {}, externalValue = null) {
    const mode = config.par14aBudgetMode ?? 'fixed';
    if (mode === 'ems') return {...calculateEmsMinimum({participants: config.par14aParticipants ?? [],
        customFactors: config.par14aGzfOverrideEnabled === true ? config.par14aGzfFactors ?? [] : null}), mode};
    let budgetW;
    if (mode === 'fixed') budgetW = numericInput(config.par14aLimitW ?? 4200);
    else if (mode === 'external') {
        if (!['W', 'kW'].includes(config.par14aLimitUnit ?? 'W'))
            return {valid: false, budgetW: null, mode, reason: 'Externe Binaerlimit-Einheit ungueltig'};
        const value = numericInput(externalValue);
        budgetW = value === null ? null : value * (config.par14aLimitUnit === 'kW' ? 1000 : 1);
    } else return {valid: false, budgetW: null, mode, reason: 'Binaerbudgetquelle ungueltig'};
    return {valid: budgetW !== null && budgetW >= 0 && Number.isSafeInteger(Math.floor(budgetW)),
        budgetW: budgetW === null || budgetW < 0 ? null : Math.floor(budgetW), mode,
        reason: mode === 'fixed' ? 'Konfiguriertes Festbudget' : 'Frisches externes Gesamtbudget ohne GZF-Hochrechnung'};
}

function evaluateConsumptionLimit({legacyConfigured = false, legacyActive = null,
    legacyLimitW = 4200, legacyBudget = null, lpcConfigured = false, lpcState = null, lpcLimitW = null} = {}) {
    if (legacyConfigured && legacyActive === null) {
        return {valid: false, active: true, budgetW: 0, reason: "§14a-Signal fehlt/ungueltig"};
    }
    const activeLimits = [];
    const reasons = [];
    if (legacyActive === true) {
        if (legacyBudget && !legacyBudget.valid) return {valid: false, active: true, budgetW: 0,
            reason: `§14a-Binaerbudget ungueltig: ${legacyBudget.reason}`};
        const limit = validLimit(legacyBudget ? legacyBudget.budgetW : legacyLimitW);
        if (limit === null) {
            return {valid: false, active: true, budgetW: 0,
                reason: "Festes §14a-Binaerlimit fehlt/ungueltig"};
        }
        activeLimits.push(limit);
        reasons.push(`§14a-Binaerkontakt ${limit} W${legacyBudget?.mode === 'ems'
            ? ` (EMS n=${legacyBudget.count}, GZF=${legacyBudget.factor}${legacyBudget.factorSource === 'custom-deviation' ? ', ABWEICHUNG' : ''})`
            : legacyBudget?.mode === 'external' ? ' (extern, ohne GZF)' : ''}`);
    }

    if (lpcConfigured) {
        const state = normalizedState(lpcState);
        if (state === "limited") {
            const limit = validLimit(lpcLimitW);
            if (limit === null) {
                return {valid: false, active: true, budgetW: 0, reason: "LPC-Limit fehlt/ungueltig"};
            }
            activeLimits.push(limit);
            reasons.push(`LPC ${limit} W`);
        } else if (!UNLIMITED_STATES.has(state)) {
            return {valid: false, active: true, budgetW: 0,
                reason: state === "failsafe" ? "LPC-Failsafe – kein belastbares Leistungsbudget"
                    : "LPC-Zustand fehlt/ungueltig"};
        }
    }

    if (!activeLimits.length) {
        return {valid: true, active: false, budgetW: null, reason: "Keine Netzbetreiberbegrenzung"};
    }
    const budgetW = Math.min(...activeLimits);
    return {valid: true, active: true, budgetW,
        reason: reasons.length > 1 ? `${reasons.join("; ")}; wirksam ${budgetW} W`
            : `${reasons[0]} begrenzt`};
}

function netImportCurrentA(importW, exportW, voltageV = 230) {
    if (importW === null || importW === '' || exportW === null || exportW === '') return null;
    const voltage = Number(voltageV);
    const imported = Number(importW);
    const exported = Number(exportW);
    if (![voltage, imported, exported].every(Number.isFinite) || voltage <= 0
        || imported < 0 || exported < 0) return null;
    return (imported - exported) / voltage;
}

// One setting is the maximum hold allowance; admission keeps a fixed 20 W
// margin below it so changing current does not immediately reverse on noise.
function pvImportAdmissionW(toleranceW) {
    return Number.isFinite(toleranceW) && toleranceW >= 0 && toleranceW <= 200
        ? Math.max(0, toleranceW - 20) : 0;
}

module.exports = {pvImportAdmissionW, evaluateConsumptionLimit, netImportCurrentA, GZF_DEFAULTS, calculateEmsMinimum, binaryContactBudget};
