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

function evaluateConsumptionLimit({legacyConfigured = false, legacyActive = null,
    legacyLimitW = 4200, lpcConfigured = false, lpcState = null, lpcLimitW = null} = {}) {
    if (legacyConfigured && legacyActive === null) {
        return {valid: false, active: true, budgetW: 0, reason: "§14a-Signal fehlt/ungueltig"};
    }
    const activeLimits = [];
    const reasons = [];
    if (legacyActive === true) {
        const limit = validLimit(legacyLimitW);
        if (limit === null) {
            return {valid: false, active: true, budgetW: 0,
                reason: "Festes §14a-Binaerlimit fehlt/ungueltig"};
        }
        activeLimits.push(limit);
        reasons.push(`§14a-Binaerkontakt ${limit} W`);
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

module.exports = {evaluateConsumptionLimit, netImportCurrentA};
