"use strict";

const UNLIMITED_STATES = new Set(["unlimitedautonomous", "unlimitedcontrolled"]);

function normalizedState(value) {
    return typeof value === "string" ? value.replace(/[^a-z]/gi, "").toLowerCase() : "";
}

function evaluateConsumptionLimit({legacyConfigured = false, legacyActive = null,
    lpcConfigured = false, lpcState = null, lpcLimitW = null} = {}) {
    if (legacyConfigured && legacyActive === null) {
        return {valid: false, active: true, budgetW: 0, reason: "§14a-Signal fehlt/ungueltig"};
    }
    if (!lpcConfigured) {
        if (legacyActive === true) {
            return {valid: false, active: true, budgetW: 0,
                reason: "§14a aktiv, aber kein LPC-Leistungsbudget konfiguriert"};
        }
        return {valid: true, active: false, budgetW: null, reason: "Keine Netzbetreiberbegrenzung"};
    }

    const state = normalizedState(lpcState);
    if (state === "limited") {
        if (lpcLimitW === null || lpcLimitW === '') {
            return {valid: false, active: true, budgetW: 0, reason: "LPC-Limit fehlt/ungueltig"};
        }
        const limitW = Number(lpcLimitW);
        if (!Number.isFinite(limitW) || limitW < 0) {
            return {valid: false, active: true, budgetW: 0, reason: "LPC-Limit fehlt/ungueltig"};
        }
        return {valid: true, active: true, budgetW: Math.floor(limitW),
            reason: `LPC begrenzt auf ${Math.floor(limitW)} W`};
    }
    if (UNLIMITED_STATES.has(state)) {
        if (legacyActive === true) {
            return {valid: false, active: true, budgetW: 0,
                reason: "§14a aktiv, LPC meldet aber kein aktives Limit"};
        }
        return {valid: true, active: false, budgetW: null,
            reason: state === "unlimitedcontrolled" ? "LPC unbegrenzt/gesteuert" : "LPC unbegrenzt/autonom"};
    }
    return {valid: false, active: true, budgetW: 0,
        reason: state === "failsafe" ? "LPC-Failsafe – kein belastbares Leistungsbudget"
            : "LPC-Zustand fehlt/ungueltig"};
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

module.exports = {evaluateConsumptionLimit, netImportCurrentA};
