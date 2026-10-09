/* NVP allocation for observer mode and explicitly armed production outputs.
 * The configured slow cycle calculates budgets; output controllers own writes.
 */
'use strict';

function parsePlanSeries(id) {
    try {
        const raw = getState(id)?.val;
        const series = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(series) ? series : [];
    } catch (_) { return []; }
}

function currentPlanItem(name, now) {
    const series = parsePlanSeries(`${CFG.root}.Plan.${name}_48h_JSON`);
    let selected = null;
    for (const item of series) {
        const timestamp = Number(item?.timestamp);
        if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now
            || now >= timestamp + 15 * 60000) continue;
        if (!selected || timestamp > Number(selected.timestamp)) selected = item;
    }
    if (!selected) return null;
    if (name !== 'PVBoost') {
        const value = selected.valueW;
        if ((typeof value !== 'number' && !(typeof value === 'string' && value.trim()))
            || !Number.isFinite(Number(value))) return null;
    }
    return selected;
}

// A forecast is never a durable permission to import. Revalidate the current
// interval, tariff and the vehicle session immediately before using its watts.
function priceChargingAuthorization(device, plan = null, now = Date.now()) {
    const r = CFG.root;
    const enabled = getState(`${r}.Config.${device}PriceChargingEnabled`)?.val === true;
    const denied = reason => ({enabled, allowed: false, gridW: 0, reason});
    if (!enabled) return denied('Preisladung deaktiviert');
    const name = device === 'Battery' ? 'BatteryPower' : device;
    plan = plan || currentPlanItem(name, now);
    const source = getState(`${r}.Plan.${name}_48h_JSON`);
    const updated = numericValue(getState(`${r}.Plan.LastUpdate`)?.val);
    if (getState(`${r}.Plan.Valid`)?.val !== true || !source || source.ack !== true
        || source.q !== undefined && Number(source.q) !== 0
        || updated === null || updated <= 0 || updated > now + 1000 || now - updated > 20 * 60000
        || !plan || !Number.isFinite(Number(plan.timestamp)) || Number(plan.timestamp) > now
        || now >= Number(plan.timestamp) + 15 * 60000)
        return denied('Aktueller Preisfahrplan fehlt/veraltet');
    const watts = numericValue(plan.gridChargeW), limit = numericValue(plan.priceLimitCt);
    if (plan.priceOptimized !== true || watts === null || watts <= 0 || limit === null)
        return denied('Kein Netzladefenster');
    if (plan.priceChargeUntil !== undefined && (!Number.isFinite(Number(plan.priceChargeUntil))
        || now >= Number(plan.priceChargeUntil))) return denied('Ladezeit im Preisfenster beendet');
    const price = typeof evaluatePriceAt === 'function' ? evaluatePriceAt(now) : {valid: false};
    const maximum = numericValue(getState(`${r}.Config.${device}PriceMax_ct_kWh`)?.val);
    if (!price.valid || !Number.isFinite(price.totalCt) || price.totalCt > limit + 0.001
        || maximum === null || maximum !== 0 && price.totalCt > maximum + 0.001)
        return denied('Aktueller Gesamtpreis fehlt oder Preisfreigabe ueberschritten');
    if (device === 'Battery') {
        const measured = typeof batteryCoherentMeasurement === 'function'
            ? batteryCoherentMeasurement(CFG.dp.batterySoc, 5 * 60000) : getState(CFG.dp.batterySoc);
        const soc = measured?.ack === true && !measured.q ? numericValue(measured.val) : null;
        const target = numericValue(plan.targetSoCPct);
        const gridMaximum = readNumber(`${r}.Config.BatteryPriceMaxSoC_pct`, 100);
        if (!Number.isFinite(soc) || target === null || target <= 0 || target > 100
            || gridMaximum < 0 || gridMaximum > 100 || soc >= Math.min(target, gridMaximum))
            return denied('Speicher-Preisziel erreicht oder SoC/Preisziel ungueltig');
    } else {
        const wb = Number(device.slice(-1)), vehicle = vehicleState(wb);
        if (!vehicle.release || vehicle.priceSessionValid !== true || !vehicle.priceSessionId
            || plan.priceSessionId !== vehicle.priceSessionId
            || !Number.isFinite(vehicle.priceRemainingKWh) || vehicle.priceRemainingKWh <= 0)
            return denied('Fahrzeug-Preisbedarf/Stecksession nicht mehr gueltig');
    }
    return {enabled, allowed: true, gridW: watts, totalCt: price.totalCt, plan,
        reason: 'Aktueller Brutto-Gesamtpreis und Preisfahrplan freigegeben'};
}

function wallboxManualEnergyAuthorization(wb) {
    const enabled = getState(`${CFG.root}.Config.Wallbox${wb}PriceChargingEnabled`)?.val === true;
    const quota = numericValue(getState(`${CFG.root}.Config.Wallbox${wb}PriceEnergy_kWh`)?.val);
    if (!enabled || quota === null || quota <= 0) return false;
    const vehicle = vehicleState(wb);
    // The session tracker rejects a formerly known SoC becoming invalid.
    // A genuine no-SoC car can use its bounded quota with PV as well as with
    // an explicitly authorized purchase, without needing a price window.
    return !vehicle.socValid && vehicle.release && vehicle.priceSessionValid === true
        && Number.isFinite(vehicle.priceRemainingKWh) && vehicle.priceRemainingKWh > 0;
}

function batteryPriceDischargeFloor(now = Date.now()) {
    if (getState(`${CFG.root}.Config.BatteryPriceChargingEnabled`)?.val !== true) return 0;
    const plan = currentPlanItem('BatteryPower', now);
    const updated = numericValue(getState(`${CFG.root}.Plan.LastUpdate`)?.val);
    const floor = numericValue(plan?.dischargeFloorPct);
    // Do not spend reserved energy when its current schedule is unknown.
    if (getState(`${CFG.root}.Plan.Valid`)?.val !== true || updated === null
        || updated <= 0 || now - updated > 20 * 60000 || updated > now + 1000
        || floor === null || floor < 0 || floor > 100) return 100;
    return floor;
}

function batteryPriceSafeTarget(rawTarget, now = Date.now()) {
    if (!(rawTarget > 0)) return rawTarget;
    const allocated = Math.max(0, readNumber(`${CFG.root}.Control.BatteryPriceGridCharge_W`, 0));
    if (allocated <= 0) return rawTarget;
    const current = priceChargingAuthorization('Battery', null, now);
    return Math.max(0, rawTarget - allocated) + Math.min(allocated, current.gridW);
}

function priceProtectedPeerImportW() {
    if (typeof coordinatedEnergyEnabled !== 'function' || !coordinatedEnergyEnabled()) return 0;
    const r = CFG.root;
    const actualBattery = typeof batteryMeasuredPowerW === 'function' ? batteryMeasuredPowerW() : 0;
    const batteryW = Math.min(Math.max(0, actualBattery || 0),
        Math.max(0, readNumber(`${r}.Control.BatteryPriceGridCharge_W`, 0)));
    const loads = typeof coordinatedConsumptionLoads === 'function' ? coordinatedConsumptionLoads() : null;
    // Heater reservations include pending commands, so use the real AC
    // measurements here rather than the command/high-water values.
    const dhw = (CFG.dp.myPvDhwOutputW || []).map(id => freshDhwNumber(id, 120000));
    const heating = typeof heatingActualPower === 'function' ? heatingActualPower() : null;
    const actualHeatW = dhw.every(Number.isFinite) ? dhw.reduce((sum, w) => sum + w, 0)
        + (heating?.valid ? heating.totalW : 0) : 0;
    const heatW = loads?.valid ? Math.min(Math.max(0, readNumber(`${r}.Control.HeaterCheapGridAllocation_W`, 0)),
        Math.max(0, actualHeatW - readNumber(`${r}.Control.HeaterPVAllocation_W`, 0))) : 0;
    return batteryW + heatW;
}

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

function realtimeGridMeasurement() {
    // Actual.GridPower_W belongs to the slower observer. Reading it here would
    // repeat an old NVP value for up to refreshSeconds despite a 1-s battery
    // loop. Validate the configured source samples without running the full
    // observer/recommendation pipeline a second time.
    const invalid = [];
    const importW = readFreshNumber(CFG.dp.gridImport, invalid);
    const exportW = readFreshNumber(CFG.dp.gridExport, invalid);
    if (importW < 0) invalid.push(`${CFG.dp.gridImport}: negativer Netzbezug`);
    if (exportW < 0) invalid.push(`${CFG.dp.gridExport}: negative Einspeisung`);
    return {valid: invalid.length === 0, gridW: Math.round(importW - exportW), invalid};
}

function freshConstraintValue(id) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    if (!state || state.val === null || state.val === '' || state.ack === false
        || (state.q && state.q !== 0) || !Number.isFinite(state.ts) || state.ts <= 0
        || state.ts > Date.now() + 1000 || Date.now() - state.ts > CFG.dataMaxAgeMs) return null;
    return state.val;
}

function staticConstraintValue(id) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    if (!state || state.val === null || state.val === '' || state.ack === false
        || (state.q && state.q !== 0) || Number(state.ts || 0) > Date.now() + 1000) return null;
    return state.val;
}

function currentConsumptionLimit() {
    const legacyConfigured = Boolean(CFG.dp.par14a);
    const lpcConfigured = Boolean(CFG.dp.lpcState || CFG.dp.lpcLimit);
    const legacyValue = staticConstraintValue(CFG.dp.par14a);
    const legacyBoolean = [true, 1, '1'].includes(legacyValue) ? true
        : [false, 0, '0'].includes(legacyValue) ? false : null;
    const legacyActive = !legacyConfigured || legacyBoolean === null ? legacyBoolean
        : nativeConfig.par14aActiveHigh === false ? !legacyBoolean : legacyBoolean;
    const limitValue = freshConstraintValue(CFG.dp.lpcLimit);
    const result = gridConstraints.evaluateConsumptionLimit({
        legacyConfigured,
        legacyActive,
        legacyLimitW: Number(nativeConfig.par14aLimitW ?? 4200),
        lpcConfigured,
        lpcState: freshConstraintValue(CFG.dp.lpcState),
        lpcLimitW: limitValue === null ? null : Number(limitValue)
    });
    if (!result.valid || !result.active
        || !Boolean(getState(`${CFG.root}.Devices.HeatPump.Present`)?.val)) return result;
    const heatPumpW = freshConstraintValue(CFG.dp.heatPumpPower);
    const measuredW = Number(heatPumpW);
    if (heatPumpW === null || !Number.isFinite(measuredW) || measuredW < 0) {
        return {valid: false, active: true, budgetW: 0,
            reason: 'Wärmepumpenleistung für gemeinsames LPC-Budget fehlt/ungueltig'};
    }
    const remainingW = Math.max(0, result.budgetW - measuredW);
    return {...result, budgetW: Math.floor(remainingW),
        reason: `${result.reason}; Wärmepumpe ${Math.round(measuredW)} W; Wallbox-Rest ${Math.floor(remainingW)} W`};
}

function publishConsumptionLimit(limit) {
    write(`${CFG.root}.Control.GridOperatorLimitActive`, limit.active);
    write(`${CFG.root}.Control.GridOperatorBudget_W`, limit.budgetW === null ? -1 : limit.budgetW);
    write(`${CFG.root}.Control.GridOperatorStatus`, limit.reason);
}

let realtimeParallelActive = false;
let lastSlowUpdate = 0;
let lastConsumptionBudgetW = Infinity;
let stableWallboxPhases = [null, null, null];
let lastPhaseChangeAt = [0, 0, 0];
const lastRealPhaseChangeAt = [0, 0, 0];
const wallboxRealPhaseCandidate = [0, 1, 2].map(() => ({phase: 0, since: 0, lastObservationAt: 0}));
const wallboxRealPhaseEpisode = [false, false, false];
const wallboxPhaseDecision = [{}, {}, {}];
let wallboxStartCandidateSince = [0, 0, 0];
const wallboxStartHistory = [0, 1, 2].map(() => ({armedCount: 0, resetCount: 0,
    lastArmedAt: null, lastResetAt: null, lastResetReason: '', lastResetBudgetW: null}));
function resetWallboxStartCandidate(wb, reason, now = Date.now(), budgetW = null) {
    if (wallboxStartCandidateSince[wb] > 0) {
        Object.assign(wallboxStartHistory[wb], {resetCount: wallboxStartHistory[wb].resetCount + 1,
            lastResetAt: now, lastResetReason: reason, lastResetBudgetW: budgetW});
    }
    wallboxStartCandidateSince[wb] = 0;
}
let wallboxRunStartedAt = [0, 0, 0];
let wallboxOutputWasActive = [false, false, false];
let wallboxLastHandoffSince = [0, 0, 0];
let wallboxManualHandoff = null;
let lastSelectedRealtimeWallbox = -1;
// A vehicle change may reuse a running charge's start qualification, but only
// after this engine session saw the donor stopped and then genuinely active.
// Retained ownership/targets at process startup are deliberately insufficient.
const wallboxVehicleHandoffObservation = [0, 1, 2].map(() => ({inactiveObserved: false,
    inactiveAt: 0, wasActive: false, qualified: false, lastActiveAt: 0, lastObservationAt: 0}));
let wallboxVehicleHandoff = null;
let wallboxDisconnectedDonor = null;

function wallboxHandoffMaximumGapMs() {
    return Math.min(10000, Math.max(2,
        readNumber(`${CFG.root}.Config.SlowControlCycle_s`, 5)) * 1000 + 2000);
}

function wallboxHandoffShadowValid() {
    // The shadow controller supplies this private current-frame flag before
    // allocation; neither a published Debug state nor real foreign load is a
    // valid substitute for an unknown electrical model response.
    return typeof getActualState !== 'function'
        || typeof shadowElectricalResponseValid === 'boolean' && shadowElectricalResponseValid;
}

function wallboxHandoffSourceValid(wb, now, running = false, sessionInactiveAt = 0, disconnected = false) {
    const maxAgeMs = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
    const good = state => state?.ack === true && !state.q && Number.isFinite(state.ts)
        && state.ts > 0 && state.ts <= now + 1000;
    const freshNumber = id => {
        const state = id ? getState(id) : null;
        return good(state) && now - state.ts <= maxAgeMs ? numericValue(state.val) : null;
    };
    const base = `${CFG.root}.Devices.Wallbox${wb}`;
    const active = getState(`${base}.OutputActive`), owned = getState(`${base}.OutputOwned`);
    if (!good(active) || typeof active.val !== 'boolean' || !good(owned)
        || typeof owned.val !== 'boolean' || getState(`${base}.OutputFault`)?.val) return false;
    const power = freshNumber(CFG.dp.wallboxesKW[wb]);
    const currents = CFG.dp.wallboxPhaseCurrents[wb].map(freshNumber);
    const car = freshNumber(CFG.dp.wallboxCar[wb]);
    if (power === null || power < -0.02 || currents.some(value => value === null || value < 0)
        || !(disconnected && !running ? [1] : [2, 3, 4]).includes(car)) return false;
    for (const [key, expected] of [['ErrorId', 0], ['ConnectionId', true]]) {
        const id = nativeConfig[`wb${wb}${key}`];
        if (!id) continue;
        const state = getState(id);
        if (!good(state) || state.val !== expected
            || key === 'ErrorId' && now - state.ts > maxAgeMs) return false;
    }
    if (!running) return true;
    const command = getState(`${base}.OutputCommand_A`);
    const phases = numericValue(getState(`${base}.OutputPhases`)?.val);
    const feedbackId = nativeConfig[`wb${wb}AmpereFeedbackId`];
    const allowId = nativeConfig[`wb${wb}AllowOutputId`];
    return active.val === true && owned.val === true && good(command)
        && active.ts >= sessionInactiveAt && command.ts >= sessionInactiveAt
        && now - active.ts <= maxAgeMs && now - command.ts <= maxAgeMs
        && numericValue(command.val) > 0 && [1, 3].includes(phases)
        && power * 1000 > 20 && (typeof getActualState === 'function' || Math.max(...currents) > 0.5)
        && (!feedbackId || freshNumber(feedbackId) > 0)
        && (!allowId || freshNumber(allowId) === 1);
}

// A start topology may be chosen without running-change delays only for a
// genuinely stopped target. Unknown feedback and an owned stop sequence do
// not qualify. The productive output guard independently checks it again.
function wallboxPreStartPhaseReady(wb, now) {
    const base = `${CFG.root}.Devices.Wallbox${wb}`;
    if (getState(`${base}.OutputActive`)?.val !== false
        || getState(`${base}.OutputOwned`)?.val !== false
        || !wallboxHandoffSourceValid(wb, now)) return false;
    const maxAgeMs = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
    const value = id => {
        const state = id ? getState(id) : null;
        return state?.ack === true && !state.q && state.ts > 0
            && state.ts <= now + 1000 && now - state.ts <= maxAgeMs
            ? numericValue(state.val) : null;
    };
    return value(nativeConfig[`wb${wb}AllowOutputId`]) === 0
        && value(CFG.dp.wallboxesKW[wb]) !== null
        && Math.abs(value(CFG.dp.wallboxesKW[wb])) <= 0.02
        && CFG.dp.wallboxPhaseCurrents[wb].every(id => {
            const amps = value(id); return amps !== null && amps >= 0 && amps <= 0.5;
        });
}

function observeWallboxVehicleHandoff(selectedWb, scope, now) {
    const valid = scope.production && getState(`${CFG.root}.Control.Enabled`)?.val === true
        && getState(`${CFG.root}.System.DataValid`)?.val === true
        && getState(`${CFG.root}.Plan.Valid`)?.val === true && wallboxHandoffShadowValid();
    for (let wb = 0; wb < 3; wb++) {
        const proof = wallboxVehicleHandoffObservation[wb];
        const base = `${CFG.root}.Devices.Wallbox${wb}`;
        const active = getState(`${base}.OutputActive`);
        const owned = getState(`${base}.OutputOwned`);
        const flagsValid = [active, owned].every(state => state?.ack === true && !state.q
            && typeof state.val === 'boolean' && Number.isFinite(state.ts)
            && state.ts > 0 && state.ts <= now + 1000);
        const running = flagsValid && active.val === true && owned.val === true;
        const gap = proof.lastObservationAt > 0 && (now < proof.lastObservationAt
            || now - proof.lastObservationAt > wallboxHandoffMaximumGapMs());
        if (!valid || !flagsValid || gap) {
            proof.qualified = false;
            proof.inactiveObserved = false;
        } else if (active.val === false) {
            if (!proof.inactiveObserved) proof.inactiveAt = now;
            proof.inactiveObserved = true;
        } else if (wb === selectedWb && scope.wallboxes.includes(wb)
            && wallboxHandoffSourceValid(wb, now, true, proof.inactiveAt)) {
            if (proof.inactiveObserved) {
                proof.qualified = true;
                proof.inactiveObserved = false;
            }
            if (proof.qualified) proof.lastActiveAt = now;
        } else {
            proof.qualified = false;
            if (!wallboxHandoffSourceValid(wb, now)) proof.inactiveObserved = false;
        }
        proof.wasActive = running;
        proof.lastObservationAt = now;
    }
}

function prepareWallboxVehicleHandoffSelection(previousWb, selected, scope, now) {
    if (wallboxVehicleHandoff && selected?.wb !== wallboxVehicleHandoff.to) {
        wallboxVehicleHandoff.qualified = false;
        wallboxVehicleHandoff.reason = 'selection-changed';
    }
    const disconnected = wallboxDisconnectedDonor;
    const disconnectedReady = disconnected && selected && selected.wb !== disconnected.from
        && now >= disconnected.at && now < disconnected.until
        && numericValue(getState(CFG.dp.wallboxCar[disconnected.from])?.val) === 1
        && wallboxHandoffSourceValid(disconnected.from, now, false, 0, true);
    if (disconnected && (now >= disconnected.until || selected)) wallboxDisconnectedDonor = null;
    if (disconnectedReady) previousWb = disconnected.from;
    if (!scope.production || previousWb < 0 || !selected || previousWb === selected.wb) return;
    const donor = wallboxVehicleHandoffObservation[previousWb];
    const qualified = disconnectedReady || donor.qualified && donor.lastActiveAt > 0
        && now >= donor.lastActiveAt && now - donor.lastActiveAt <= wallboxHandoffMaximumGapMs();
    // One selection edge consumes this donor episode even if the new budget
    // cannot qualify. Later ticks cannot replenish a rejected preparation.
    donor.qualified = false;
    const priority = wallboxPriorityRequest(now);
    const soc = vehicleSocSample(previousWb, now);
    const target = vehicleState(previousWb).targetSocPct;
    const manual = priority.explicit && priority.index === selected.wb;
    const targetReached = soc.valid && Number.isFinite(target) && soc.value >= target;
    const feedbackMs = Math.max(1, Number(nativeConfig[`wb${previousWb}FeedbackTimeoutS`]) || 20,
        Number(nativeConfig[`wb${selected.wb}FeedbackTimeoutS`]) || 20) * 1000;
    const responseMs = Math.max(5, Math.min(120,
        Number(nativeConfig.wallboxResponseSettleTimeoutS) || 45)) * 1000;
    const phaseMs = Math.max(30, Math.min(900,
        Number(nativeConfig.wallboxPhaseSwitchTimeoutS) || 180)) * 1000;
    wallboxVehicleHandoff = {from: previousWb, to: selected.wb,
        qualified: qualified && (manual || targetReached || disconnectedReady), pending: true,
        disconnected: Boolean(disconnectedReady),
        priorityIndex: priority.index,
        reason: !qualified ? 'active-donor-not-observed' : disconnectedReady ? 'donor-disconnected' : manual ? 'manual-selection'
            : targetReached ? 'donor-target-soc-reached' : 'selection-not-controlled-handoff',
        until: now + Math.min(5 * 60000, 2 * feedbackMs + responseMs + phaseMs + 10000),
        lastObservationAt: now, phases: null, priceBasis: null};
}

function preparedWallboxVehicleHandoff(wb, vehicle, requestedW, minimumW, reserveW,
    safeMaximumW, phases, priceStart, now, context) {
    const preparation = wallboxVehicleHandoff;
    const diagnostic = {eligible: false, qualified: false, reason: 'no-vehicle-handoff',
        from: null, to: wb, until: null, remainingS: 0};
    if (!preparation || preparation.to !== wb) return diagnostic;
    Object.assign(diagnostic, {from: preparation.from, until: preparation.until,
        remainingS: Math.max(0, Math.ceil((preparation.until - now) / 1000))});
    const priceBasis = `${priceStart ? 'authorized-grid' : 'pv'}:${
        getState(`${CFG.root}.Config.Wallbox${wb}PriceChargingEnabled`)?.val === true}:${
        vehicle.priceSessionId || ''}`;
    const soc = vehicleSocSample(wb, now);
    const releaseId = CFG.dp.wallboxAllow[wb];
    const release = releaseId ? getState(releaseId) : null;
    let failure = '';
    if (!preparation.qualified) failure = preparation.reason;
    else if (now >= preparation.until) failure = 'handoff-expired';
    else if (now < preparation.lastObservationAt
        || now - preparation.lastObservationAt > wallboxHandoffMaximumGapMs()) failure = 'observation-gap';
    else if (context?.selected !== true || context?.valid !== true || !wallboxHandoffShadowValid())
        failure = 'control-or-shadow-response-invalid';
    else if (!wallboxHandoffSourceValid(preparation.from, now, false, 0, preparation.disconnected))
        failure = 'donor-source-invalid';
    else if (vehicle.release !== true || vehicle.connected !== true || !vehicle.socValid
        || !soc.valid || !Number.isFinite(vehicle.targetSocPct) || soc.value >= vehicle.targetSocPct
        || vehicle.phaseControlValid === false || !wallboxHandoffSourceValid(wb, now)
        || releaseId && (!release || release.q || !Number.isFinite(release.ts)
            || release.ts <= 0 || release.ts > now + 1000 || readBooleanInput(releaseId) !== true))
        failure = 'target-vehicle-ineligible';
    else if (!Number.isFinite(requestedW) || !Number.isFinite(safeMaximumW)
        || !Number.isFinite(minimumW) || minimumW <= 0 || safeMaximumW < minimumW
        || Math.min(requestedW, safeMaximumW) < minimumW + (preparation.pending ? reserveW : 0))
        failure = 'budget-or-cap-below-handoff-threshold';
    else if (!preparation.pending && (preparation.phases !== phases || preparation.priceBasis !== priceBasis))
        failure = 'phase-or-price-basis-changed';
    if (failure) {
        preparation.qualified = false;
        preparation.pending = false;
        preparation.reason = failure;
    } else if (getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
        && getState(`${CFG.root}.Devices.Wallbox${wb}.OutputActive`)?.val === true) {
        preparation.qualified = false;
        preparation.pending = false;
        preparation.reason = 'handoff-completed';
    } else {
        preparation.pending = false;
        preparation.phases = phases;
        preparation.priceBasis = priceBasis;
        preparation.reason = 'prepared-vehicle-handoff';
        diagnostic.eligible = true;
    }
    preparation.lastObservationAt = now;
    return {...diagnostic, qualified: preparation.qualified, reason: preparation.reason};
}
// This qualification belongs to one continuously observed engine session.
// A persisted output target or resume token can never restore it on restart.
const wallboxSequenceResume = [0, 1, 2].map(() => ({qualified: false,
    wasActive: false, lastObservationAt: 0, phases: 0, priceBasis: '', until: 0,
    reason: 'active-output-not-observed'}));

function revokeWallboxSequenceResume(wb, reason) {
    Object.assign(wallboxSequenceResume[wb], {qualified: false, until: 0, reason});
}

function preparedWallboxSequenceResume(wb, vehicle, requestedW, minimumW,
    safeMaximumW, phases, priceStart, now, context) {
    const retained = wallboxSequenceResume[wb];
    const base = `${CFG.root}.Devices.Wallbox${wb}`;
    const goodState = state => state?.ack === true && !state.q
        && Number.isFinite(state.ts) && state.ts > 0 && state.ts <= now + 1000;
    const activeState = getState(`${base}.OutputActive`);
    const ownedState = getState(`${base}.OutputOwned`);
    const active = goodState(activeState) && activeState.val === true
        && goodState(ownedState) && ownedState.val === true;
    const token = getState(`${base}.SequenceResumePending`);
    const deadline = getState(`${base}.SequenceResumeUntil`);
    const pending = goodState(token) && token.val === true;
    const maxAgeMs = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
    const maximumGapMs = Math.min(10000, Math.max(2,
        readNumber(`${CFG.root}.Config.SlowControlCycle_s`, 5)) * 1000 + 2000);
    const priceBasis = `${priceStart ? 'authorized-grid' : 'pv'}:${
        getState(`${CFG.root}.Config.Wallbox${wb}PriceChargingEnabled`)?.val === true}:${
        vehicle.priceSessionId || ''}`;
    const car = vehiclePriceActualState(CFG.dp.wallboxCar[wb]);
    const carNumber = numericValue(car?.val);
    const soc = vehicleSocSample(wb, now);
    let failure = '';
    if (context?.selected !== true || context?.valid !== true)
        failure = 'control-or-data-invalid';
    else if (!goodState(activeState) || typeof activeState.val !== 'boolean'
        || !goodState(ownedState) || typeof ownedState.val !== 'boolean'
        || active && (now - activeState.ts > maxAgeMs || now - ownedState.ts > maxAgeMs))
        failure = 'output-evidence-invalid';
    else if (getState(`${base}.OutputFault`)?.val)
        failure = 'output-fault';
    else if (vehicle.release !== true || vehicle.connected !== true || vehicle.socValid !== true
        || !soc.valid || !Number.isFinite(vehicle.targetSocPct) || soc.value >= vehicle.targetSocPct
        || !goodState(car) || ![2, 3, 4].includes(carNumber) || now - car.ts > maxAgeMs
        || vehicle.phaseControlValid === false)
        failure = 'vehicle-ineligible';
    else if (!Number.isFinite(requestedW) || !Number.isFinite(safeMaximumW)
        || !Number.isFinite(minimumW) || minimumW <= 0
        || requestedW < minimumW || safeMaximumW < minimumW)
        failure = 'budget-or-cap-below-minimum';
    else if (retained.lastObservationAt > 0
        && (now < retained.lastObservationAt || now - retained.lastObservationAt > maximumGapMs))
        failure = 'observation-gap';
    else if (retained.qualified && (retained.phases !== phases || retained.priceBasis !== priceBasis))
        failure = 'phase-or-price-basis-changed';

    if (failure) revokeWallboxSequenceResume(wb, failure);
    else if (active && !retained.wasActive && !pending
        && now - activeState.ts <= maxAgeMs && now - ownedState.ts <= maxAgeMs) {
        Object.assign(retained, {qualified: true, phases, priceBasis, until: 0,
            reason: 'active-output-observed'});
    }
    retained.wasActive = active;
    retained.lastObservationAt = now;
    if (!failure && !active && pending && retained.qualified) {
        const until = goodState(deadline) ? numericValue(deadline.val) : null;
        if (until === null || until <= now || (token.ts < now - maxAgeMs && retained.until === 0)
            || (retained.until > 0 && until !== retained.until)) {
            revokeWallboxSequenceResume(wb, 'resume-token-invalid-or-expired');
        } else {
            // Latch the first deadline. Repeated publication cannot extend a
            // stop/resume sequence or replenish a revoked qualification.
            retained.until = until;
            retained.reason = 'prepared-sequence-resume';
            return {eligible: true, qualified: true, reason: retained.reason,
                until, remainingS: Math.ceil((until - now) / 1000)};
        }
    } else if (!failure && !active && !pending && retained.qualified) {
        revokeWallboxSequenceResume(wb, 'stop-without-resume-token');
    }
    return {eligible: false, qualified: retained.qualified, reason: retained.reason,
        until: retained.until || null,
        remainingS: retained.until > now ? Math.ceil((retained.until - now) / 1000) : 0};
}
let slowTargets = {dhwW: 0, heatingW: 0, wallboxW: [0, 0, 0], wallboxA: [0, 0, 0],
    wallboxExpectedW: [0, 0, 0], wallboxPhases: [1, 1, 1], wallboxRecommendedPhases: [1, 1, 1]};

function splitRealtimePair(availableW, dhwCapW, wallboxCapW, sharePct) {
    const share = clamp(sharePct / 100, 0, 1);
    let dhwW = Math.min(dhwCapW, availableW * share);
    let wallboxW = Math.min(wallboxCapW, availableW - dhwW);
    let remainderW = Math.max(0, availableW - dhwW - wallboxW);
    const extraDhwW = Math.min(remainderW, Math.max(0, dhwCapW - dhwW));
    dhwW += extraDhwW;
    remainderW -= extraDhwW;
    wallboxW += Math.min(remainderW, Math.max(0, wallboxCapW - wallboxW));
    return {dhwW, wallboxW};
}

function quantizeWallbox(requestedW, vehicle, previousA, requestedPhases = 1, actualPowerW = null,
    options = {}) {
    const phases = requestedPhases >= 3 && vehicle.phaseSwitchEnabled
        && vehicle.maximumPhases >= 3 ? 3 : 1;
    const voltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const vehicleMaximumA = phases === 3 ? vehicle.maxCurrent3pA : vehicle.maxCurrent1pA;
    const minimumA = phases === 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
    const maximumPowerW = Math.min(vehicle.maximumPowerW, options.maximumPowerW ?? Infinity);
    const maximumA = Math.min(vehicleMaximumA,
        Math.floor(maximumPowerW / (voltage * phases)));
    const diagnostics = {requestedW, previousA, actualPowerW, phases, voltage,
        minimumA, maximumA, responseBasis: 'nominal', deltaW: null, deltaA: null,
        requestedA: 0, targetA: 0, reason: ''};
    if (maximumA < minimumA || requestedW <= 0)
        return {amps: 0, powerW: 0, expectedPowerW: 0, phases,
            diagnostics: {...diagnostics, reason: maximumA < minimumA
                ? 'limit-below-minimum' : 'no-budget'}};
    const rampA = Math.max(1, Math.round(Number(options.rampA)
        || readNumber(`${CFG.root}.Config.WallboxMaxStep_A`, 6)));
    diagnostics.rampA = rampA;
    const unitPowerW = voltage * phases;
    const measuredPowerW = Number(actualPowerW);
    const useActualResponse = previousA > 0 && Number.isFinite(measuredPowerW)
        && measuredPowerW >= minimumA * unitPowerW * 0.5;
    let requestedA;
    if (useActualResponse) {
        const deltaW = requestedW - measuredPowerW;
        const deadbandW = Math.max(0, readNumber(`${CFG.root}.Control.Deadband_W`, 100));
        // A sub-amp deficit must still reduce current once it exceeds the
        // permitted noise band. Choose the smallest whole-amp reduction that
        // returns the expected response inside that band; rounding toward zero
        // would leave a persistent import below one ampere's power unchanged.
        const deltaA = deltaW >= 0 ? Math.floor(deltaW / unitPowerW)
            : deltaW < -deadbandW ? Math.floor((deltaW + deadbandW) / unitPowerW) : 0;
        requestedA = previousA + deltaA;
        Object.assign(diagnostics, {responseBasis: 'power-response', deltaW, deltaA, deadbandW});
    } else requestedA = options.nearestAmp === true
        ? Math.round(Math.max(0, requestedW) / unitPowerW)
        : Math.floor(Math.max(0, requestedW) / unitPowerW);
    diagnostics.requestedA = requestedA;
    if (requestedA < minimumA) requestedA = 0;
    requestedA = Math.min(maximumA, requestedA);
    let targetA = Math.min(requestedA, previousA + rampA);
    if (targetA > 0 && targetA < minimumA) targetA = requestedA >= minimumA ? minimumA : 0;
    const powerW = Math.round(targetA * unitPowerW);
    const expectedPowerW = useActualResponse
        ? Math.max(0, Math.round(measuredPowerW + (targetA - previousA) * unitPowerW)) : powerW;
    diagnostics.targetA = targetA;
    diagnostics.reason = targetA === 0 ? 'quantized-below-minimum'
        : diagnostics.requestedA > maximumA ? 'current-limit'
            : targetA < requestedA ? 'ramp-limit' : 'budget';
    return {amps: targetA, powerW, expectedPowerW, phases, diagnostics};
}

function publishWallboxAllocation(wb, details) {
    write(`${CFG.root}.Control.Wallbox${wb}.AllocationDiagnostics_JSON`,
        JSON.stringify({...details, phaseDecision: wallboxPhaseDecision[wb]}));
}

const wallboxStartDiagnostics = [{}, {}, {}];

function stabilizedWallboxPower(wb, requestedW, vehicle, previousA, requestedPhases, now,
    safetyCapW = Infinity, priceStart = false, resumeContext = null) {
    const phases = requestedPhases >= 3 && vehicle.phaseSwitchEnabled
        && vehicle.maximumPhases >= 3 ? 3 : 1;
    const voltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const minimumA = phases === 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
    const minimumW = Math.max(0, minimumA * voltage * phases);
    const mandatory = Boolean(vehicle.mustCharge);
    const reserveW = Math.max(0, readNumber(`${CFG.root}.Config.WallboxStartReserve_W`, 300));
    const startDelayMs = Math.max(0,
        readNumber(`${CFG.root}.Config.WallboxStartDelay_s`, 30)) * 1000;
    const minimumRunMs = Math.max(0,
        readNumber(`${CFG.root}.Config.WallboxMinimumRunTime_s`, 120)) * 1000;
    const safeMaximumW = Math.max(0, Math.min(vehicle.maximumPowerW, safetyCapW));
    const diagnostics = wallboxStartDiagnostics[wb] = {minimumW, reserveW,
        startThresholdW: wallboxStartCandidateSince[wb] > 0 || priceStart
            ? minimumW : minimumW + reserveW,
        requestedW, safetyMaximumW: Number.isFinite(safeMaximumW) ? safeMaximumW : null,
        priceStart, mandatory, startDelayRemainingS: 0, reason: 'running-budget',
        history: wallboxStartHistory[wb], candidateSince: wallboxStartCandidateSince[wb] || null,
        reserveShortfallW: Math.max(0, minimumW + reserveW - requestedW),
        minimumShortfallW: Math.max(0, minimumW - requestedW)};
    const productionControlEnabled = Boolean(
        getState(`${CFG.root}.Devices.Wallbox${wb}.ControlEnabled`)?.val);
    const outputState = getState(`${CFG.root}.Devices.Wallbox${wb}.OutputActive`);
    const outputActive = outputState?.val === true;
    diagnostics.vehicleHandoff = preparedWallboxVehicleHandoff(wb, vehicle,
        requestedW, minimumW, reserveW, safeMaximumW, phases, priceStart, now, resumeContext);
    diagnostics.sequenceResume = preparedWallboxSequenceResume(wb, vehicle,
        requestedW, minimumW, safeMaximumW, phases, priceStart, now, resumeContext);
    const handoffSince = Number(getState(`${CFG.root}.Control.RestartHandoffSince`)?.val || 0);
    const newRestartHandoff = outputActive && handoffSince > wallboxLastHandoffSince[wb]
        && handoffSince <= now && now - handoffSince < 10 * 60000;

    // In production the minimum run time starts with the real output, not with
    // an earlier simulated target. Otherwise it may already be expired when the
    // go-e start sequence has only just completed.
    if (productionControlEnabled) {
        if (newRestartHandoff) {
            // OutputActive remains true across the process restart, so no
            // boolean edge exists. The new handoff generation is the explicit
            // edge that starts a fresh productive minimum-run interval.
            wallboxRunStartedAt[wb] = now;
            wallboxLastHandoffSince[wb] = handoffSince;
        } else if (outputActive && !wallboxOutputWasActive[wb]) {
            // OutputActive is refreshed by the productive output after a safe
            // restart handoff. Its ts is therefore the reliable beginning of
            // the new minimum-run interval; lc may still belong to yesterday.
            const changedAt = Math.max(Number(outputState?.lc || 0), Number(outputState?.ts || 0));
            wallboxRunStartedAt[wb] = changedAt > 0 && changedAt <= now ? changedAt : now;
        } else if (!outputActive) wallboxRunStartedAt[wb] = 0;
        wallboxOutputWasActive[wb] = outputActive;
    }

    // Binding device, commissioning and grid-operator limits always override
    // start hysteresis and minimum run time.
    if (!Number.isFinite(requestedW) || !Number.isFinite(safeMaximumW)
        || !Number.isFinite(minimumW) || minimumW <= 0 || safeMaximumW < minimumW) {
        diagnostics.reason = safeMaximumW < minimumW ? 'safety-cap-below-minimum' : 'invalid-budget';
        resetWallboxStartCandidate(wb, diagnostics.reason, now, requestedW);
        diagnostics.candidateSince = null;
        wallboxRunStartedAt[wb] = 0;
        return 0;
    }
    requestedW = Math.min(requestedW, safeMaximumW);

    if (mandatory) {
        diagnostics.reason = 'mandatory-charge';
        wallboxStartCandidateSince[wb] = 0;
        if (!productionControlEnabled && (previousA <= 0 || wallboxRunStartedAt[wb] <= 0))
            wallboxRunStartedAt[wb] = now;
        return Math.min(safeMaximumW, Math.max(requestedW, minimumW));
    }
    // A confirmed productive output is authoritative. The simulated target may
    // briefly be zero while the direct output guard is holding minimum current.
    // Treating that as a stopped wallbox would incorrectly arm a second start
    // delay and erase the productive minimum-run timestamp.
    if (previousA > 0 || outputActive) {
        wallboxStartCandidateSince[wb] = 0;
        if (!productionControlEnabled && wallboxRunStartedAt[wb] <= 0)
            wallboxRunStartedAt[wb] = now;
        if (requestedW >= minimumW) return requestedW;
        diagnostics.reason = 'running-budget-shortfall';
        // Productive minimum-runtime and stop-delay guards belong to the
        // output controller. Passing a fabricated minimum-power target here
        // conceals the shortfall and starts the stop delay only *after* the
        // minimum runtime ends. Keep the real demand zero; reserve the held
        // physical load separately below when allocating the EHZ residual.
        if (productionControlEnabled
            && getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === true) return 0;
        if (getState(`${CFG.root}.Config.Wallbox${wb}PriceChargingEnabled`)?.val === true
            && !priceStart) return 0;
        if (wallboxRunStartedAt[wb] > 0
            && now - wallboxRunStartedAt[wb] < minimumRunMs)
            return Math.min(safeMaximumW, minimumW);
        wallboxRunStartedAt[wb] = 0;
        return 0;
    }

    wallboxRunStartedAt[wb] = 0;
    if (diagnostics.vehicleHandoff.eligible) {
        wallboxStartCandidateSince[wb] = 0;
        diagnostics.candidateSince = null;
        diagnostics.startThresholdW = minimumW;
        diagnostics.reason = 'prepared-vehicle-handoff';
        return requestedW;
    }
    if (diagnostics.sequenceResume.eligible) {
        // Only avoid a duplicate qualification delay for the same interrupted
        // charge. The output controller still owns OFF ACK, physical zero,
        // peer isolation, phase confirmation and every productive safety gate.
        wallboxStartCandidateSince[wb] = 0;
        diagnostics.candidateSince = null;
        diagnostics.startThresholdW = minimumW;
        diagnostics.reason = 'prepared-sequence-resume';
        return requestedW;
    }
    // The extra reserve is required to enter the countdown. Once armed, it
    // acts as hysteresis: the EHZ may continue using the surplus and normal
    // fluctuations inside the reserve do not restart the timer. A real drop
    // below the wallbox minimum still resets it.
    const startThresholdW = wallboxStartCandidateSince[wb] > 0 || priceStart
        ? minimumW : minimumW + reserveW;
    if (requestedW < startThresholdW) {
        diagnostics.reason = 'budget-below-start-threshold';
        resetWallboxStartCandidate(wb, wallboxStartCandidateSince[wb] > 0
            ? 'budget-below-minimum-during-countdown' : diagnostics.reason, now, requestedW);
        diagnostics.candidateSince = null;
        return 0;
    }
    if (startDelayMs > 0 && wallboxStartCandidateSince[wb] <= 0) {
        wallboxStartCandidateSince[wb] = now;
        wallboxStartHistory[wb].armedCount++;
        wallboxStartHistory[wb].lastArmedAt = now;
        diagnostics.candidateSince = now;
        diagnostics.reason = 'start-delay';
        diagnostics.startDelayRemainingS = Math.ceil(startDelayMs / 1000);
        return 0;
    }
    if (now - wallboxStartCandidateSince[wb] < startDelayMs) {
        diagnostics.reason = 'start-delay';
        diagnostics.startDelayRemainingS = Math.ceil((startDelayMs - (now - wallboxStartCandidateSince[wb])) / 1000);
        return 0;
    }
    diagnostics.reason = 'ready-to-start';
    // Keep the elapsed countdown latched until the physical start. The EHZ
    // may need several ticks to shed its existing load before the output can
    // claim the wallbox. Clearing here would re-arm a full delay next tick.
    if (!productionControlEnabled) wallboxRunStartedAt[wb] = now;
    return requestedW;
}

function forecastPhaseWindow(wb, now) {
    const lookAheadMin = Math.max(15, Number(nativeConfig.phaseSwitchLookAheadMin ?? 30));
    const end = now + lookAheadMin * 60000;
    const series = parsePlanSeries(`${CFG.root}.Plan.Wallbox${wb}_48h_JSON`);
    const duration = {1: 0, 3: 0};
    for (const slot of series) {
        const start = Number(slot?.timestamp);
        const phase = Number(slot?.phases);
        if (!Number.isFinite(start) || ![1, 3].includes(phase) || Number(slot?.valueW) <= 0) continue;
        const overlapMin = Math.max(0, Math.min(start + 15 * 60000, end) - Math.max(start, now)) / 60000;
        const chargeShare = clamp(Number(slot?.chargingMinutes ?? 15) / 15, 0, 1);
        duration[phase] += overlapMin * chargeShare;
    }
    if (duration[3] >= lookAheadMin - 0.5 && duration[1] < 0.5) return 3;
    if (duration[1] >= lookAheadMin - 0.5 && duration[3] < 0.5) return 1;
    return 0;
}

function publishWallboxPhaseDecision(wb, details) {
    wallboxPhaseDecision[wb] = details;
    const base = `${CFG.root}.Control.Wallbox${wb}`;
    write(`${base}.PhaseDecision_JSON`, JSON.stringify(details));
    write(`${base}.PhaseDecisionStatus`, details.reason);
    write(`${base}.PhaseDecisionRemaining_s`, details.remainingS || 0);
}

function resetWallboxRealPhaseCandidate(wb) {
    Object.assign(wallboxRealPhaseCandidate[wb], {phase: 0, since: 0, lastObservationAt: 0});
}

function wallboxPhaseBudgetSourcesValid(scope, now, coordination = null) {
    const fresh = (id, maximumAgeMs) => {
        const state = id ? getState(id) : null;
        const value = numericValue(state?.val);
        return state?.ack === true && !state.q && value !== null && value >= 0
            && Number.isFinite(state.ts) && state.ts > 0 && state.ts <= now + 1000
            && now - state.ts <= maximumAgeMs;
    };
    if (![CFG.dp.gridImport, CFG.dp.gridExport].every(id => fresh(id,
        SMA_GRID_MAX_AGE_MS))) return false;
    const wallboxAgeMs = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
    // Every productive load reclaimed by the NVP budget must be observed.
    // The selected car alone cannot vouch for stale watts from another device.
    if (scope.wallboxes.some(wb => !fresh(CFG.dp.wallboxesKW[wb], wallboxAgeMs))) return false;
    if (scope.dhw && ((CFG.dp.myPvDhwOutputW || []).length !== 3
        || CFG.dp.myPvDhwOutputW.some(id => !fresh(id, coordination ? 120000 : CFG.dataMaxAgeMs))))
        return false;
    if (coordination) {
        const heatingArmed = nativeConfig.globalWriteEnabled === true && nativeConfig.heatingPresent === true
            && nativeConfig.heatingControlEnabled === true && nativeConfig.heatingProductionArmed === true
            && getState(`${CFG.root}.Devices.MyPV_Heating.DriverReady`)?.val === true
            && getState(`${CFG.root}.Devices.MyPV_Heating.ControlEnabled`)?.val === true
            && getState(`${CFG.root}.Devices.MyPV_Heating.Present`)?.val === true;
        if (heatingArmed && (typeof heatingActualPower !== 'function' || !heatingActualPower().valid)) return false;
        // The battery helper already checks its identified driver's ACK,
        // quality and completed-poll heartbeat for unchanged AC measurements.
        const batteryPresent = getState(`${CFG.root}.Devices.Battery.Present`)?.val === true
            || getState(`${CFG.root}.Devices.Battery.OutputOwned`)?.val === true;
        if (batteryPresent && (typeof batteryMeasuredPowerW !== 'function'
            || !Number.isFinite(batteryMeasuredPowerW()))) return false;
    }
    return true;
}

function stabilizedPhaseTarget(wb, vehicle, recommendedPhases, now, realContext = null) {
    const report = (phase, reason, details = {}) => {
        publishWallboxPhaseDecision(wb, {timestamp: now, phase, reason,
            basis: realContext ? 'real-budget' : 'forecast', remainingS: 0, ...details});
        return phase;
    };
    if (!vehicle.phaseSwitchEnabled) {
        resetWallboxRealPhaseCandidate(wb);
        wallboxRealPhaseEpisode[wb] = false;
        stableWallboxPhases[wb] = 1;
        return report(1, 'fixed-one-phase');
    }
    // When the existing phase script is the authority, its confirmed psm
    // determines both the ampere quantization and the EHZ split thresholds.
    // Forecast recommendations must not create an unfulfilled 3P request and
    // then drop a physically 1P car's budget below a fictitious 3P minimum.
    if (vehicle.phaseControlMode === 'script') {
        resetWallboxRealPhaseCandidate(wb);
        wallboxRealPhaseEpisode[wb] = false;
        stableWallboxPhases[wb] = vehicle.phaseFeedbackValid ? vehicle.confirmedPhases : 0;
        return report(stableWallboxPhases[wb], 'external-phase-authority');
    }
    if (vehicle.phaseControlValid === false) {
        resetWallboxRealPhaseCandidate(wb);
        wallboxRealPhaseEpisode[wb] = false;
        return report(0, 'invalid-phase-authority');
    }
    if (vehicle.maximumPhases < 3) {
        resetWallboxRealPhaseCandidate(wb);
        wallboxRealPhaseEpisode[wb] = false;
        stableWallboxPhases[wb] = 1;
        return report(1, 'vehicle-one-phase');
    }
    if (![1, 3].includes(stableWallboxPhases[wb])) {
        const existing = Number(getState(`${CFG.root}.Control.Targets.Wallbox${wb}_Phases`)?.val);
        // In a real episode initialize from acknowledged hardware rather than
        // an observer target retained from before the productive handover.
        stableWallboxPhases[wb] = realContext && vehicle.phaseFeedbackValid
            ? vehicle.confirmedPhases : [1, 3].includes(existing) ? existing
            : recommendedPhases >= 3 ? 3 : 1;
    }
    if (realContext) {
        if (realContext.active === false) wallboxRealPhaseEpisode[wb] = false;
        else if (!wallboxRealPhaseEpisode[wb]) {
            if (realContext.pending === true) {
                // A follower already in transition owns its bounded destination;
                // an old observer array must not cancel that target on entry.
                const target = getState(`${CFG.root}.Control.Targets.Wallbox${wb}_Phases`);
                const phases = numericValue(target?.val);
                if (target?.ack === true && !target.q && [1, 3].includes(phases))
                    stableWallboxPhases[wb] = phases;
            } else if (realContext.valid === true && vehicle.phaseFeedbackValid) {
                // A new productive selection/scope starts at observed hardware.
                // A forecast choice made before Master EIN is not a qualified
                // real request, even if the old target array happens to be valid.
                stableWallboxPhases[wb] = vehicle.confirmedPhases;
                wallboxRealPhaseEpisode[wb] = true;
                resetWallboxRealPhaseCandidate(wb);
            }
        }
    } else wallboxRealPhaseEpisode[wb] = false;
    const holdMs = Math.max(0, Number(nativeConfig.phaseSwitchMinHoldMin ?? 30)) * 60000;
    // Observer-only requests do not start a productive hold interval. Genuine
    // real requests retain theirs across temporary selection/control losses.
    const phaseChangedAt = realContext ? lastRealPhaseChangeAt[wb] : lastPhaseChangeAt[wb];
    const holdRemainingS = Math.max(0, Math.ceil((holdMs - (now - phaseChangedAt)) / 1000));
    if (realContext) {
        const proof = wallboxRealPhaseCandidate[wb];
        const gap = proof.lastObservationAt > 0 && (now < proof.lastObservationAt
            || now - proof.lastObservationAt > wallboxHandoffMaximumGapMs());
        const budgetW = numericValue(realContext.budgetW);
        const valid = realContext.active !== false && realContext.valid === true
            && vehicle.phaseFeedbackValid && budgetW !== null && budgetW >= 0;
        const baseDetails = {valid, budgetW, holdRemainingS,
            confirmedPhases: vehicle.phaseFeedbackValid ? vehicle.confirmedPhases : null,
            authorizedGridW: Number(realContext.authorizedGridW) || 0};
        // During the follower's bounded stop/change/restart handshake, retain
        // its requested destination. A command echo or zero vehicle response
        // is not a new phase decision and must never restart a qualification.
        if (!valid || realContext.pending === true || gap) {
            resetWallboxRealPhaseCandidate(wb);
            return report(stableWallboxPhases[wb], realContext.pending === true
                ? 'phase-transition-pending' : gap ? 'observation-gap'
                    : realContext.reason || 'real-budget-invalid', baseDetails);
        }
        const voltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
        const reserveW = Math.max(0, readNumber(`${CFG.root}.Config.WallboxStartReserve_W`, 300));
        const deadbandW = Math.max(0, readNumber(`${CFG.root}.Control.Deadband_W`, 100));
        const minimum1W = vehicle.minCurrent1pA * voltage;
        const minimum3W = vehicle.minCurrent3pA * voltage * 3;
        if (realContext.forceOnePhase === true && vehicle.phaseControlMode === 'ems') {
            // A shared mandatory floor has a 1P topology. It is a request,
            // not a fabricated go-e acknowledgement; the output/follower keeps
            // the old physical reservation until the real transition completes.
            stableWallboxPhases[wb] = 1;
            resetWallboxRealPhaseCandidate(wb);
            return report(1, 'parallel-minimum-one-phase', {...baseDetails, remainingS: 0});
        }
        const maximum1W = Math.min(vehicle.maximumPowerW, vehicle.maxCurrent1pA * voltage);
        const downBelowW = minimum3W - deadbandW;
        const downMinimumW = minimum1W + reserveW;
        const upAboveW = Math.max(maximum1W + reserveW, minimum3W + reserveW);
        const thresholdsValid = [minimum1W, minimum3W, maximum1W, downBelowW,
            downMinimumW, upAboveW].every(Number.isFinite) && minimum1W > 0
            && minimum3W > 0 && maximum1W >= minimum1W;
        // Cold start / stopped receiving vehicle: select the usable topology
        // before release instead of applying a running-car qualification/hold.
        // A pending follower retains its destination in the gate above.
        if (thresholdsValid && realContext.preStartReady === true && !vehicle.mustCharge
            && budgetW >= downMinimumW) {
            const startPhase = budgetW < minimum3W + reserveW ? 1
                : budgetW > upAboveW ? 3 : stableWallboxPhases[wb];
            if (startPhase !== stableWallboxPhases[wb]) {
                stableWallboxPhases[wb] = startPhase;
                lastPhaseChangeAt[wb] = now;
                lastRealPhaseChangeAt[wb] = now;
            }
            resetWallboxRealPhaseCandidate(wb);
            return report(startPhase, 'pre-start-budget-phase', {...baseDetails,
                downMinimumW, minimum3StartW: minimum3W + reserveW, upAboveW,
                preStartReady: true, remainingS: 0});
        }
        const desired = !thresholdsValid ? 0
            : !vehicle.mustCharge && budgetW < downBelowW && budgetW >= downMinimumW ? 1
                : budgetW > upAboveW ? 3 : 0;
        const details = {...baseDetails, downBelowW, downMinimumW, upAboveW,
            mustCharge: Boolean(vehicle.mustCharge), desiredPhase: desired || null};
        if (![1, 3].includes(desired) || desired === stableWallboxPhases[wb]) {
            resetWallboxRealPhaseCandidate(wb);
            return report(stableWallboxPhases[wb], !thresholdsValid ? 'invalid-phase-thresholds'
                : desired ? 'real-budget-matches-phase'
                    : vehicle.mustCharge ? 'mandatory-charge-keeps-phase' : 'real-budget-hysteresis', details);
        }
        if (proof.phase !== desired || proof.since <= 0) Object.assign(proof,
            {phase: desired, since: now, lastObservationAt: now});
        else proof.lastObservationAt = now;
        const setting = Number(nativeConfig[desired === 1
            ? 'phaseSwitchRealDownDelayS' : 'phaseSwitchRealUpDelayS']);
        const delayS = Number.isFinite(setting) ? Math.max(desired === 1 ? 15 : 30,
            Math.min(desired === 1 ? 900 : 1800, setting)) : desired === 1 ? 120 : 300;
        const qualificationRemainingS = Math.max(0,
            Math.ceil((delayS * 1000 - (now - proof.since)) / 1000));
        Object.assign(details, {candidateSince: proof.since, delayS, qualificationRemainingS,
            remainingS: Math.max(qualificationRemainingS, holdRemainingS)});
        if (qualificationRemainingS > 0 || holdRemainingS > 0)
            return report(stableWallboxPhases[wb], qualificationRemainingS > 0
                ? 'real-budget-qualification' : 'phase-minimum-hold', details);
        stableWallboxPhases[wb] = desired;
        lastPhaseChangeAt[wb] = now;
        lastRealPhaseChangeAt[wb] = now;
        resetWallboxRealPhaseCandidate(wb);
        return report(desired, 'real-budget-phase-request', {...details, remainingS: 0});
    }
    resetWallboxRealPhaseCandidate(wb);
    const hoursRemaining = (vehicle.departureTimestamp - now) / 3600000;
    const urgentThreePhase = vehicle.gridEnergyRequiredKWh > 0 && hoursRemaining > 0
        && vehicle.gridEnergyRequiredKWh / hoursRemaining * 1000 > vehicle.maxCurrent1pA * 230;
    const forecastPhase = forecastPhaseWindow(wb, now);
    const desired = urgentThreePhase ? 3 : forecastPhase;
    if (![1, 3].includes(desired) || desired === stableWallboxPhases[wb])
        return report(stableWallboxPhases[wb], 'forecast-keeps-phase');
    if (holdRemainingS > 0) return report(stableWallboxPhases[wb], 'phase-minimum-hold',
        {remainingS: holdRemainingS});
    stableWallboxPhases[wb] = desired;
    lastPhaseChangeAt[wb] = now;
    return report(desired, urgentThreePhase ? 'forecast-departure-demand' : 'forecast-phase-request');
}

function resetSlowTargets() {
    realtimeParallelActive = false;
    lastSlowUpdate = 0;
    lastConsumptionBudgetW = Infinity;
    [0, 1, 2].forEach(wb => resetWallboxRealPhaseCandidate(wb));
    wallboxRealPhaseEpisode.fill(false);
    [0, 1, 2].forEach(wb => resetWallboxStartCandidate(wb, 'control-reset'));
    wallboxRunStartedAt = [0, 0, 0];
    wallboxOutputWasActive = [false, false, false];
    wallboxLastHandoffSince = [0, 0, 0];
    wallboxManualHandoff = null;
    lastSelectedRealtimeWallbox = -1;
    wallboxVehicleHandoff = null;
    wallboxDisconnectedDonor = null;
    for (const proof of wallboxVehicleHandoffObservation) Object.assign(proof,
        {inactiveObserved: false, inactiveAt: 0, wasActive: false, qualified: false,
            lastActiveAt: 0, lastObservationAt: 0});
    [0, 1, 2].forEach(wb => {
        revokeWallboxSequenceResume(wb, 'control-reset');
        Object.assign(wallboxSequenceResume[wb], {wasActive: false, lastObservationAt: 0});
    });
    slowTargets = {dhwW: 0, heatingW: 0, wallboxW: [0, 0, 0], wallboxA: [0, 0, 0],
        wallboxExpectedW: [0, 0, 0], wallboxPhases: [1, 1, 1], wallboxRecommendedPhases: [1, 1, 1]};
}

function publishWallboxTimingDiagnostics(wb, now, targetA) {
    const startDelayMs = Math.max(0,
        readNumber(`${CFG.root}.Config.WallboxStartDelay_s`, 30)) * 1000;
    const minimumRunMs = Math.max(0,
        readNumber(`${CFG.root}.Config.WallboxMinimumRunTime_s`, 120)) * 1000;
    const startRemainingS = wallboxStartCandidateSince[wb] > 0
        ? Math.max(0, Math.ceil((startDelayMs - (now - wallboxStartCandidateSince[wb])) / 1000)) : 0;
    const runRemainingS = wallboxRunStartedAt[wb] > 0
        ? Math.max(0, Math.ceil((minimumRunMs - (now - wallboxRunStartedAt[wb])) / 1000)) : 0;
    write(`${CFG.root}.Vehicles.Wallbox${wb}.StartDelayActive`, startRemainingS > 0);
    write(`${CFG.root}.Vehicles.Wallbox${wb}.StartDelayRemaining_s`, startRemainingS);
    const running = targetA > 0
        || (getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
            && getState(`${CFG.root}.Devices.Wallbox${wb}.OutputActive`)?.val === true);
    write(`${CFG.root}.Vehicles.Wallbox${wb}.MinimumRunTimeActive`, running && runRemainingS > 0);
    write(`${CFG.root}.Vehicles.Wallbox${wb}.MinimumRunTimeRemaining_s`,
        running ? runRemainingS : 0);
}

function zeroRealtimeTargets(status) {
    const r = CFG.root;
    resetSlowTargets();
    write(`${r}.Control.ParallelWallboxAllocation_JSON`, JSON.stringify({schema: 1,
        timestamp: Date.now(), valid: false, order: [], budgetW: 0, hardBudgetW: 0, allocations: [], waiting: []}));
    write(`${r}.Control.ActiveWallboxes_JSON`, '[]');
    write(`${r}.Control.ParallelWallboxStatus`, status);
    write(`${r}.Control.Valid`, false);
    write(`${r}.Control.Status`, status);
    write(`${r}.Control.Targets.Battery_W`, 0);
    write(`${r}.Control.Targets.MyPV_DHW_W`, 0);
    write(`${r}.Control.Targets.MyPV_Heating_W`, 0);
    [0, 1, 2].forEach(wb => {
        publishWallboxPhaseDecision(wb, {timestamp: Date.now(), valid: false,
            phase: null, basis: 'unavailable', reason: status, remainingS: 0});
        publishWallboxAllocation(wb, {timestamp: Date.now(), valid: false,
            selected: false, targetA: 0, reason: status});
        write(`${r}.Control.Targets.Wallbox${wb}_W`, 0);
        write(`${r}.Control.Targets.Wallbox${wb}_A`, 0);
        write(`${r}.Control.Targets.Wallbox${wb}_Phases`, 1);
        write(`${r}.Vehicles.Wallbox${wb}.StartDelayActive`, false);
        write(`${r}.Vehicles.Wallbox${wb}.StartDelayRemaining_s`, 0);
        write(`${r}.Vehicles.Wallbox${wb}.MinimumRunTimeActive`, false);
        write(`${r}.Vehicles.Wallbox${wb}.MinimumRunTimeRemaining_s`, 0);
    });
    write(`${r}.Control.Targets.PVBoostRelease`, false);
    write(`${r}.Control.ParallelDistributionActive`, false);
    write(`${r}.Control.ParallelDistributionReleased`, false);
    write(`${r}.Control.SelectedWallbox`, -1);
    write(`${r}.Control.WallboxSelectionReason`, `Keine Wallbox ausgewaehlt: ${status}`);
    if (typeof resetEnergyCoordination === 'function') resetEnergyCoordination(status);
    write(`${r}.Control.LastUpdate`, Date.now());
}

function realtimeProductionScope() {
    const r = CFG.root;
    const production = getState(`${r}.System.RealOutputsEnabled`)?.val === true;
    if (!production) return {production: false, wallboxes: [0, 1, 2], dhw: true};
    // This is deliberately narrower than the forecast: a simulated/unarmed
    // consumer cannot reserve watts that a real controller would never deliver.
    const enabled = [0, 1, 2].filter(wb => nativeConfig[`wb${wb}ControlEnabled`] === true
        && getState(`${r}.Devices.Wallbox${wb}.ControlEnabled`)?.val === true
        && getState(`${r}.Devices.Wallbox${wb}.Present`)?.val === true);
    const scopeConfirmed = enabled.length <= 1 || nativeConfig.multiWallboxAlphaArmed === true;
    const allArmed = enabled.every(wb => nativeConfig[`wb${wb}ProductionArmed`] === true);
    const dhwEnabled = nativeConfig.dhwControlEnabled === true
        && getState(`${r}.Devices.MyPV_DHW.ControlEnabled`)?.val === true;
    const combinedConfirmed = !dhwEnabled || !enabled.length
        || (nativeConfig.combinedProductionArmed === true
            && getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val === true);
    const allowed = nativeConfig.globalWriteEnabled === true
        && scopeConfirmed && allArmed && combinedConfirmed;
    return {production: true, wallboxes: allowed ? enabled : [],
        dhw: allowed && dhwEnabled && getState(`${r}.Devices.MyPV_DHW.Present`)?.val === true};
}

function selectRealtimeWallboxes(wallboxPlans, scope = realtimeProductionScope()) {
    // A fresh priority command must not use a previous observer cycle's
    // release/connection/SoC mirror. This only refreshes derived diagnostics
    // and timestamp-bounded physical price accounting, never actuator writes.
    updateVehicles();
    const now = Date.now();
    const priority = wallboxPriorityRequest(now);
    const manualTargetEligible = candidate => {
        if (!candidate) return false;
        const car = vehiclePriceActualState(CFG.dp.wallboxCar[candidate.wb]);
        const userReleaseId = CFG.dp.wallboxAllow[candidate.wb];
        const userRelease = userReleaseId ? getState(userReleaseId) : null;
        const released = !userReleaseId || userRelease
            && (!userRelease.q || Number(userRelease.q) === 0)
            && Number.isFinite(userRelease.ts) && userRelease.ts > 0 && userRelease.ts <= now + 1000
            && readBooleanInput(userReleaseId) === true;
        // A retained car status need not change while plugged in. Missing,
        // unconfirmed or bad-quality evidence must nevertheless never make a
        // new manual request displace a healthy currently charging vehicle.
        return Boolean(released) && car?.ack === true && (!car.q || Number(car.q) === 0)
            && Number.isFinite(car.ts) && car.ts > 0 && car.ts <= now + 1000
            && [2, 3, 4].includes(numericValue(car.val));
    };
    const candidates = [0, 1, 2].map(wb => ({
        wb, vehicle: vehicleState(wb),
        outputActive: getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
            && getState(`${CFG.root}.Devices.Wallbox${wb}.OutputActive`)?.val === true,
        outputOwned: Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val),
        priceDue: priceChargingAuthorization(`Wallbox${wb}`, wallboxPlans[wb]).allowed,
        plannedW: Math.max(0, Number(wallboxPlans[wb]?.valueW) || 0),
        plannedPhases: Number(wallboxPlans[wb]?.phases) >= 3 ? 3 : 1
    })).filter(x => x.vehicle.release && scope.wallboxes.includes(x.wb));
    const preferred = priority.explicit
        ? candidates.find(candidate => candidate.wb === priority.index && manualTargetEligible(candidate)) : null;
    const publishSelection = reason => {
        write(`${CFG.root}.Control.WallboxSelectionReason`, reason);
        for (const candidate of candidates) candidate.selectionReason = reason;
        lastSelectedRealtimeWallbox = candidates[0]?.wb ?? -1;
        return candidates;
    };
    if (typeof parallelWallboxChargingEnabled === 'function' && parallelWallboxChargingEnabled()) {
        wallboxManualHandoff = null;
        wallboxVehicleHandoff = null;
        for (let index = candidates.length - 1; index >= 0; index--) {
            if (scope.production && !manualTargetEligible(candidates[index])) candidates.splice(index, 1);
        }
        candidates.forEach(candidate => { candidate.vehicle = parallelWallboxVehicle(candidate.vehicle); });
        candidates.sort((a, b) => Number(b.wb === preferred?.wb) - Number(a.wb === preferred?.wb)
            || Number(b.vehicle.belowMinimum) - Number(a.vehicle.belowMinimum)
            || Number(b.vehicle.mustCharge) - Number(a.vehicle.mustCharge)
            || b.vehicle.effectivePriorityScore - a.vehicle.effectivePriorityScore
            || a.vehicle.latestStartTimestamp - b.vehicle.latestStartTimestamp
            || b.vehicle.priority - a.vehicle.priority || a.wb - b.wb);
        return publishSelection(`${priority.reason}; parallele Mindestladung, Mehrleistung nach Prioritaet; `
            + `Reihenfolge ${candidates.map(candidate => candidate.wb).join(', ') || 'keine'}`);
    }
    let transitionReason = '';
    if (wallboxManualHandoff && priority.explicit && priority.index !== wallboxManualHandoff.target) {
        // A newer user choice cancels the previous intent even when its car
        // cannot currently start. Never complete a superseded preparation.
        transitionReason = 'Vorbereitete manuelle Uebergabe durch neue Prioritaetswahl ersetzt';
        wallboxManualHandoff = null;
    }
    if (wallboxManualHandoff) {
        const target = candidates.find(candidate => candidate.wb === wallboxManualHandoff.target
            && manualTargetEligible(candidate));
        if (!target || now >= wallboxManualHandoff.until) {
            transitionReason = !target ? 'Vorbereitete manuelle Uebergabe verworfen: Fahrzeug nicht mehr zulaessig'
                : 'Vorbereitete manuelle Uebergabe abgelaufen';
            wallboxManualHandoff = null;
        } else if (target.outputActive && target.outputOwned) wallboxManualHandoff = null;
    }
    const retained = wallboxManualHandoff
        ? candidates.find(candidate => candidate.wb === wallboxManualHandoff.target) : null;
    if (wallboxVehicleHandoff?.qualified && priority.explicit
        && priority.index !== wallboxVehicleHandoff.priorityIndex && priority.index !== wallboxVehicleHandoff.to) {
        wallboxVehicleHandoff.qualified = false;
        wallboxVehicleHandoff.reason = 'priority-selection-changed';
    }
    const preparedVehicle = wallboxVehicleHandoff?.qualified && now < wallboxVehicleHandoff.until
        ? candidates.find(candidate => candidate.wb === wallboxVehicleHandoff.to
            && manualTargetEligible(candidate)) : null;
    const requested = preferred || retained || preparedVehicle;
    const completedDonor = scope.production && scope.wallboxes.some(wb => {
        const proof = wallboxVehicleHandoffObservation[wb];
        const soc = vehicleSocSample(wb, now);
        const target = vehicleState(wb).targetSocPct;
        return proof.qualified && proof.lastActiveAt > 0 && now >= proof.lastActiveAt
            && now - proof.lastActiveAt <= wallboxHandoffMaximumGapMs()
            && getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
            && !candidates.some(candidate => candidate.wb === wb)
            && soc.valid && Number.isFinite(target) && soc.value >= target;
    });
    if (!requested && scope.production && scope.wallboxes.some(wb =>
        getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
        && !candidates.some(candidate => candidate.wb === wb)) && !completedDonor) {
        candidates.length = 0;
        return publishSelection('Keine neue Wallbox: bisheriger Ausgang wird sicher beendet');
    }
    // A scheduled purchase may hand over from a PV-only car. Physical OFF
    // acknowledgement remains the output controller's interlock, so selecting
    // the next car never authorizes simultaneous charging. Mandatory needs
    // retain the existing precedence over discretionary price plans.
    const priceHandoff = !candidates.some(candidate => candidate.vehicle.mustCharge);
    candidates.sort((a, b) => (requested ? Number(b.wb === requested.wb) - Number(a.wb === requested.wb) : 0)
        || (priceHandoff ? Number(b.priceDue) - Number(a.priceDue) : 0)
        || Number(b.outputActive) - Number(a.outputActive)
        || Number(b.outputOwned) - Number(a.outputOwned)
        || Number(b.vehicle.belowMinimum) - Number(a.vehicle.belowMinimum)
        || Number(b.vehicle.mustCharge) - Number(a.vehicle.mustCharge)
        || Number(b.priceDue) - Number(a.priceDue)
        // Remove a possibly older observer's manual boost. The current
        // request above is authoritative, including neutral/invalid changes.
        || (b.vehicle.effectivePriorityScore - Number(b.vehicle.selectedPriority))
            - (a.vehicle.effectivePriorityScore - Number(a.vehicle.selectedPriority))
        || Number(b.plannedW > 0) - Number(a.plannedW > 0)
        || a.vehicle.latestStartTimestamp - b.vehicle.latestStartTimestamp);
    const selected = candidates[0];
    if (!selected) {
        wallboxManualHandoff = null;
        return publishSelection(`${priority.reason}; keine zulaessige Wallbox`);
    }
    if (preferred) {
        const previous = candidates.find(candidate => candidate.wb !== preferred.wb
            && (candidate.outputActive || candidate.outputOwned))?.wb
            ?? (lastSelectedRealtimeWallbox !== preferred.wb ? lastSelectedRealtimeWallbox : -1);
        if (!(preferred.outputActive && preferred.outputOwned) && previous >= 0
            && (!wallboxManualHandoff || wallboxManualHandoff.target !== preferred.wb)) {
            const startMs = Math.max(0, readNumber(`${CFG.root}.Config.WallboxStartDelay_s`, 30)) * 1000;
            const feedbackMs = Math.max(1, ...[0, 1, 2].map(wb =>
                Number(nativeConfig[`wb${wb}FeedbackTimeoutS`]) || 20)) * 1000;
            const responseMs = Math.max(5, Math.min(120,
                Number(nativeConfig.wallboxResponseSettleTimeoutS) || 45)) * 1000;
            const phaseMs = Math.max(30, Math.min(900,
                Number(nativeConfig.wallboxPhaseSwitchTimeoutS) || 180)) * 1000;
            wallboxManualHandoff = {target: preferred.wb, previous,
                until: now + Math.min(10 * 60000, Math.max(60000,
                    startMs + 2 * feedbackMs + responseMs + phaseMs + 10000))};
        }
        return publishSelection(`${priority.reason}; ${previous >= 0 && !preferred.outputActive
            ? `Uebergabe von Wallbox ${previous}: bestaetigtes AUS und elektrische Ruhe erforderlich`
            : 'ausgewaehlt; Ausgangsschutz bleibt erforderlich'}`);
    }
    if (retained) return publishSelection(`Manuelle Uebergabe zu Wallbox ${retained.wb} bleibt vorbereitet; `
        + 'keine Rueckwahl des noch abschaltenden bisherigen Ausgangs');
    if (preparedVehicle) return publishSelection(`Qualifizierte Fahrzeuguebergabe von Wallbox ${
        wallboxVehicleHandoff.from} zu Wallbox ${preparedVehicle.wb} bleibt vorbereitet; `
        + 'bestaetigtes AUS und elektrische Ruhe bleiben erforderlich');
    const unavailable = priority.explicit ? `${priority.reason} derzeit nicht zulaessig; ` : '';
    const selectedReason = selected.outputActive ? `laufender eigener Auftrag Wallbox ${selected.wb} bleibt ausgewaehlt`
        : selected.outputOwned ? `eigener Auftrag Wallbox ${selected.wb} wird abgeschlossen`
            : `Wallbox ${selected.wb} nach Ladebedarf, Preisfreigabe und automatischer Reihenfolge ausgewaehlt`;
    return publishSelection(`${unavailable || priority.reason + '; '}${transitionReason ? transitionReason + '; ' : ''}${selectedReason}`);
}

function parallelWallboxCommitment(wb, voltage) {
    const base = `${CFG.root}.Devices.Wallbox${wb}`;
    const raw = getState(CFG.dp.wallboxesKW[wb]);
    const measured = numericValue(raw?.val);
    const owned = getState(`${base}.OutputOwned`)?.val === true;
    const active = getState(`${base}.OutputActive`)?.val === true;
    const phases = readNumber(`${base}.OutputPhases`, 1) >= 3 ? 3 : 1;
    const command = owned && active ? Math.max(0, readNumber(`${base}.OutputCommand_A`, 0)) : 0;
    const reservedW = Math.max(0, readNumber(`${base}.OutputReservedPower_W`, 0));
    return {owned, active, phases, commandA: command,
        measuredW: measured === null ? null : Math.max(0, measured * 1000),
        reservedW: Math.max(measured === null ? 0 : Math.max(0, measured * 1000),
            command * voltage * phases, reservedW)};
}

function updateParallelSlowTargets(requiredControlledW, wallboxPlans, heatingPlan, consumptionBudgetW, coordination) {
    const r = CFG.root, now = Date.now(), scope = realtimeProductionScope();
    const voltage = Math.max(200, readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230));
    const sourcesValid = !scope.production || wallboxPhaseBudgetSourcesValid(scope, now, coordination);
    const allCandidates = selectRealtimeWallboxes(wallboxPlans, scope);
    const candidates = allCandidates.filter(candidate => !scope.production
        || sourcesValid && wallboxHandoffSourceValid(candidate.wb, now));
    const order = candidates.map(candidate => candidate.wb), eligible = new Set(order);
    const commitments = [0, 1, 2].map(wb => parallelWallboxCommitment(wb, voltage));
    const inactiveReservationW = commitments.reduce((sum, value, wb) => sum
        + (scope.production && !eligible.has(wb) ? value.reservedW : 0), 0);
    const dhwReleased = scope.dhw && getState(`${r}.Devices.MyPV_DHW.Release`)?.val === true;
    const dhwCapW = coordination ? Math.max(0, coordination.heaterCapW) : dhwReleased
        ? Math.max(0, Math.min(readNumber(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0),
            scope.production ? readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000) : Infinity)) : 0;
    const heatingCapW = scope.production ? 0 : Math.max(0, Number(heatingPlan?.valueW) || 0);
    const heaterReservedW = scope.production ? ['MyPV_DHW', 'MyPV_Heating'].reduce((sum, name) => sum
        + Math.max(0, readNumber(`${r}.Devices.${name}.OutputReservedPower_W`, 0)), 0) : 0;
    const hardW = Number.isFinite(consumptionBudgetW) ? Math.max(0, consumptionBudgetW
        - inactiveReservationW - heaterReservedW) : Infinity;
    const grossHardW = Number.isFinite(consumptionBudgetW) ? Math.max(0, consumptionBudgetW
        - inactiveReservationW) : Infinity;
    const pvPoolW = Math.max(0, Number(requiredControlledW) || 0);
    const minimumEntries = candidates.map(candidate => ({wb: candidate.wb,
        minimumW: candidate.vehicle.mustCharge ? candidate.vehicle.minCurrent1pA * voltage : 0,
        capW: Math.min(candidate.vehicle.maximumPowerW, candidate.vehicle.maxCurrent1pA * voltage)}));
    const floors = allocateParallelWallboxWatts(minimumEntries, 0, grossHardW);
    const mandatoryW = floors.minimumTotalW;
    const availableW = Math.min(grossHardW, Math.max(Math.max(0, pvPoolW - inactiveReservationW), mandatoryW));
    const afterFloorsW = Math.max(0, availableW - mandatoryW);
    const mustHeat = getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val === true;
    const parallelRelease = readBooleanInput(CFG.dp.dhwParallelRelease);
    const sharing = parallelRelease === true && dhwCapW > 0 && candidates.length > 0
        && getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val === true;
    const startThresholdW = readNumber(`${r}.Config.DHWParallelStartPower1P_W`, 4000);
    const stopThresholdW = readNumber(`${r}.Config.DHWParallelStopPower1P_W`, 3000);
    if (!sharing || availableW < stopThresholdW) realtimeParallelActive = false;
    else if (availableW >= startThresholdW) realtimeParallelActive = true;
    const heatW = Math.min(heatingCapW, afterFloorsW);
    const vehicleMaximumW = candidates.reduce((sum, candidate) => sum + candidate.vehicle.maximumPowerW, 0);
    let requestedDhwW = mustHeat ? Math.min(dhwCapW, Math.max(0, afterFloorsW - heatW))
        : realtimeParallelActive ? splitRealtimePair(Math.max(0, afterFloorsW - heatW),
            dhwCapW, vehicleMaximumW, readNumber(`${r}.Config.DHWParallelShare_pct`, 50)).dhwW : 0;
    const carPoolW = Math.max(mandatoryW, availableW - heatW - requestedDhwW);
    const requests = candidates.map(candidate => ({...candidate,
        price: priceChargingAuthorization(`Wallbox${candidate.wb}`, wallboxPlans[candidate.wb], now)}));
    const plannedCarHardW = Math.max(0, grossHardW - heatW - requestedDhwW);
    const initial = allocateParallelWallboxWatts(minimumEntries, carPoolW, plannedCarHardW);
    const phases = [0, 1, 2].map(wb => readNumber(`${r}.Control.Targets.Wallbox${wb}_Phases`, 1) >= 3 ? 3 : 1);
    const phasePreparationA = [null, null, null], phasePreparationW = [0, 0, 0];
    const capacities = [];
    for (const candidate of requests) {
        const wb = candidate.wb, vehicle = candidate.vehicle, base = `${r}.Devices.Wallbox${wb}`;
        const otherFloorsW = Math.max(0, mandatoryW - (floors.watts[wb] || 0));
        const precedingCapacityW = capacities.reduce((sum, item) => sum + item.capW - item.minimumW, 0);
        const ownBudgetW = Math.max(initial.watts[wb], carPoolW - otherFloorsW - precedingCapacityW,
            candidate.price.allowed ? candidate.price.gridW : 0);
        const pending = getState(`${base}.PhaseSwitchPending`)?.val === true
            || getState(`${base}.PhaseTransitionActive`)?.val === true;
        const previousPhaseState = {realChangedAt: lastRealPhaseChangeAt[wb],
            changedAt: lastPhaseChangeAt[wb], proof: {...wallboxRealPhaseCandidate[wb]}};
        let desired = stabilizedPhaseTarget(wb, vehicle, Number(wallboxPlans[wb]?.phases) >= 3 ? 3 : 1, now,
            scope.production ? {budgetW: ownBudgetW, valid: sourcesValid && vehicle.phaseFeedbackValid,
                active: true, pending, authorizedGridW: candidate.price.gridW,
                forceOnePhase: vehicle.mustCharge && ownBudgetW < vehicle.minCurrent3pA * voltage * 3 + 300,
                preStartReady: wallboxPreStartPhaseReady(wb, now)} : null);
        // A follower can change topology before the next ampere write. Do not
        // request 3P until the current acknowledged ampere value fits along
        // with the other cars' outstanding physical/command reservations.
        const otherCommittedW = commitments.reduce((sum, value, index) => sum
            + (index !== wb ? value.reservedW : 0), 0);
        if (scope.production && desired === 3 && vehicle.confirmedPhases === 1) {
            let safeThreePhaseA = Math.min(vehicle.maxCurrent3pA,
                Math.floor(Math.max(0, Math.min(ownBudgetW,
                    consumptionBudgetW - otherCommittedW - heaterReservedW)) / (voltage * 3)));
            const workingA = readNumber(`${r}.Config.HouseConnectionWorkingLimit_A`, 46);
            const imports = CFG.dp.haPhaseImportW || [], exports = CFG.dp.haPhaseExportW || [];
            if (imports.length === 3 && exports.length === 3) {
                for (let phase = 0; phase < 3; phase++) {
                    const imported = getState(imports[phase]), exported = getState(exports[phase]);
                    const fresh = state => state?.ack === true && !state.q && numericValue(state.val) !== null
                        && state.val >= 0 && state.ts > 0 && state.ts <= now + 1000
                        && now - state.ts <= SMA_GRID_MAX_AGE_MS;
                    if (!fresh(imported) || !fresh(exported)) { safeThreePhaseA = 0; break; }
                    const ownA = readNumber(CFG.dp.wallboxPhaseCurrents?.[wb]?.[phase], 0);
                    const netA = (Number(imported.val) - Number(exported.val)) / voltage;
                    safeThreePhaseA = Math.min(safeThreePhaseA, Math.floor(workingA - netA + ownA));
                }
            }
            const measuredA = Math.max(...(CFG.dp.wallboxPhaseCurrents?.[wb] || []).map(id => readNumber(id, 0)));
            if (safeThreePhaseA < vehicle.minCurrent3pA
                || commitments[wb].commandA > safeThreePhaseA || measuredA > safeThreePhaseA + 0.5) {
                if (safeThreePhaseA >= vehicle.minCurrent3pA) {
                    phasePreparationA[wb] = safeThreePhaseA;
                    phasePreparationW[wb] = safeThreePhaseA * voltage * 3;
                }
                desired = 1;
                stableWallboxPhases[wb] = 1;
                // No 3P request has left this allocator yet. Keep the qualified
                // intent while the car sheds current; starting the phase hold
                // here would cancel preparation and allow a new 1P ramp.
                lastRealPhaseChangeAt[wb] = previousPhaseState.realChangedAt;
                lastPhaseChangeAt[wb] = previousPhaseState.changedAt;
                Object.assign(wallboxRealPhaseCandidate[wb], previousPhaseState.proof);
                publishWallboxPhaseDecision(wb, {timestamp: now, valid: true, phase: 1,
                    basis: 'parallel-reservation', reason: 'shared-budget-before-phase-upshift',
                    preparationCurrentA: phasePreparationA[wb], remainingS: 0});
            }
        }
        phases[wb] = desired === 3 ? 3 : 1;
        const minimumW = vehicle.mustCharge ? vehicle.minCurrent1pA * voltage : 0;
        capacities.push({wb, minimumW,
            capW: Math.min(vehicle.maximumPowerW, (phases[wb] === 3
                ? vehicle.maxCurrent3pA * 3 : vehicle.maxCurrent1pA) * voltage)});
    }
    const allocation = allocateParallelWallboxWatts(capacities, carPoolW, plannedCarHardW);
    // Independently identify the PV-funded shares. The ordinary allocation
    // can contain mandatory grid floors and tariff permissions; neither is
    // evidence that a completed minimum charge may continue on PV.
    // This provenance does not change targets, reservations or hard ceilings.
    const pvCarPoolW = Math.min(plannedCarHardW,
        Math.max(0, pvPoolW - inactiveReservationW - heatW - requestedDhwW));
    const pvAllocation = allocateParallelWallboxWatts(capacities, pvCarPoolW, pvCarPoolW);
    const nextW = [0, 0, 0], nextA = [0, 0, 0], expectedW = [0, 0, 0];
    const records = [], waiting = [], reserved = commitments.map(value => scope.production ? value.reservedW : 0);
    let grantedNominalW = 0;
    for (const candidate of requests) {
        const wb = candidate.wb, vehicle = candidate.vehicle, base = `${r}.Devices.Wallbox${wb}`;
        const commitment = commitments[wb], ownFloorW = floors.watts[wb] || 0;
        const futureFloorsW = requests.slice(requests.indexOf(candidate) + 1)
            .reduce((sum, item) => sum + (floors.watts[item.wb] || 0), 0);
        const otherReservedW = reserved.reduce((sum, value, index) => sum + (index !== wb ? value : 0), 0);
        const priceW = candidate.price.allowed ? Math.max(0, candidate.price.gridW) : 0;
        const eligibleOtherReservedW = reserved.reduce((sum, value, index) => sum
            + (index !== wb && eligible.has(index) ? value : 0), 0);
        const ownHardW = Number.isFinite(hardW) ? Math.max(0, hardW - eligibleOtherReservedW) : Infinity;
        // Awaiting an old car's reduction is not available power for the new
        // priority car. The floor reservation is also protected before its
        // asynchronous start has produced any measured watts.
        const otherFloorsW = Math.max(0, mandatoryW - ownFloorW);
        const normalSoftMaximumW = Math.max(0, carPoolW + priceW
            - Math.max(eligibleOtherReservedW, otherFloorsW));
        // A peer reaching its minimum SoC can shrink the soft pool while its
        // stop delay still reserves the old draw. Retain only an already
        // confirmed, running 1P minimum; do not spend that reservation on a
        // new start, an increase or a phase transition. The hard ceilings
        // below continue to account for every peer and heater reservation.
        const runningMinimumW = scope.production && ownFloorW > 0
            && commitment.owned && commitment.active
            && commitment.commandA >= vehicle.minCurrent1pA
            && commitment.phases === 1 && phases[wb] === 1
            && vehicle.phaseFeedbackValid && vehicle.confirmedPhases === 1
            && getState(`${base}.PhaseSwitchPending`)?.val !== true
            && getState(`${base}.PhaseTransitionActive`)?.val !== true
            && wallboxHandoffSourceValid(wb, now, true) ? ownFloorW : 0;
        const softMaximumW = Math.max(normalSoftMaximumW, runningMinimumW);
        const safetyW = Math.min(ownHardW, softMaximumW,
            Math.max(0, hardW - grantedNominalW - futureFloorsW));
        let requestedW = Math.min(allocation.watts[wb] + priceW, safetyW);
        const previousA = scope.production ? commitment.active ? commitment.commandA : 0
            : slowTargets.wallboxA[wb] || 0;
        requestedW = stabilizedWallboxPower(wb, requestedW, vehicle, previousA, phases[wb], now,
            safetyW, priceW > 0, {selected: true, valid: sourcesValid});
        const transitioning = scope.production && (vehicle.confirmedPhases !== phases[wb]
            || getState(`${base}.PhaseSwitchPending`)?.val === true
            || getState(`${base}.PhaseTransitionActive`)?.val === true);
        const quantized = quantizeWallbox(requestedW, vehicle, previousA, phases[wb],
            priceW > 0 || vehicle.mustCharge || transitioning ? null : commitment.measuredW,
            {maximumPowerW: Math.min(safetyW, phasePreparationA[wb] === null ? Infinity
                : phasePreparationA[wb] * voltage), rampA: realtimeParallelActive
                ? readNumber(`${r}.Config.WallboxCombinedMaxStep_A`, 1) : undefined});
        nextW[wb] = quantized.powerW; nextA[wb] = quantized.amps;
        grantedNominalW += quantized.powerW;
        expectedW[wb] = Math.max(quantized.expectedPowerW, scope.production ? commitment.reservedW : 0,
            quantized.powerW, phasePreparationW[wb]);
        reserved[wb] = expectedW[wb];
        if (allocation.waiting.includes(wb) || ownFloorW > 0 && quantized.amps === 0)
            waiting.push({wb, reason: 'Mindestladung wartet auf gemeinsames Budget oder bestaetigte Leistungsreduktion'});
        const pvBudgetW = Math.min(quantized.powerW, pvAllocation.watts[wb] || 0);
        records.push({wb, authorized: true, targetA: quantized.amps, phases: phases[wb],
            reservedW: expectedW[wb], minimumW: ownFloorW, pvBudgetW});
        publishWallboxAllocation(wb, {timestamp: now, valid: sourcesValid, selected: true,
            preferred: wb === order[0], order: order.indexOf(wb), targetA: quantized.amps,
            minimumW: ownFloorW, runningMinimumW, pvBudgetW,
            safetyBudgetW: Number.isFinite(safetyW) ? safetyW : null,
            requestedW: allocation.watts[wb], reservedW: expectedW[wb],
            distributionReason: vehicle.belowMinimum ? 'parallel-minimum-soc' : 'parallel-priority-surplus',
            start: {...wallboxStartDiagnostics[wb]}, ...quantized.diagnostics});
        write(`${r}.Control.Wallbox${wb}PriceGridCharge_W`, Math.round(Math.min(priceW,
            Math.max(0, expectedW[wb] - allocation.watts[wb]))));
    }
    for (const wb of [0, 1, 2]) {
        if (eligible.has(wb)) continue;
        resetWallboxStartCandidate(wb, 'parallel-ineligible');
        resetWallboxRealPhaseCandidate(wb);
        expectedW[wb] = scope.production ? commitments[wb].reservedW : 0;
        records.push({wb, authorized: false, targetA: 0, phases: phases[wb],
            reservedW: expectedW[wb], minimumW: 0, pvBudgetW: 0});
        write(`${r}.Control.Wallbox${wb}PriceGridCharge_W`, 0);
        publishWallboxAllocation(wb, {timestamp: now, valid: sourcesValid, selected: false, targetA: 0,
            reason: sourcesValid ? 'not-eligible' : 'parallel-sources-invalid', reservedW: expectedW[wb]});
    }
    const assignedW = expectedW.reduce((sum, watts, wb) => sum + (eligible.has(wb) ? watts : 0), 0);
    const priceGridW = requests.reduce((sum, candidate) => sum
        + readNumber(`${r}.Control.Wallbox${candidate.wb}PriceGridCharge_W`, 0), 0);
    requestedDhwW = Math.min(dhwCapW, Math.max(0, availableW - heatW
        - Math.max(mandatoryW, Math.max(0, assignedW - priceGridW))));
    slowTargets = {dhwW: coordination ? Math.round(requestedDhwW) : simulateDhwTarget(Math.round(requestedDhwW)),
        heatingW: Math.round(heatW), wallboxW: nextW, wallboxA: nextA,
        wallboxExpectedW: expectedW, wallboxPhases: phases,
        wallboxRecommendedPhases: wallboxPlans.map(plan => Number(plan?.phases) >= 3 ? 3 : 1)};
    [0, 1, 2].forEach(wb => publishWallboxTimingDiagnostics(wb, now, nextA[wb]));
    const status = !sourcesValid ? 'Parallelverteilung: Quellen ungueltig; keine neue Ladefreigabe'
        : `Parallelverteilung: Mindestladung ${Math.round(mandatoryW)} W; Mehrleistung nach ${order.join(', ') || 'keine'}; `
            + `geplante Ladung ${nextA.map((amps, wb) => amps > 0 ? `${wb}:${amps}A` : '').filter(Boolean).join(', ') || 'keine'}`;
    write(`${r}.Control.ParallelWallboxStatus`, status);
    write(`${r}.Control.ActiveWallboxes_JSON`, JSON.stringify(order.filter(wb => nextA[wb] > 0)));
    // The slow-device budget already excludes the coordinated battery. Output
    // validation combines all real consumers, so its hard ceiling must retain
    // the gross household limit rather than subtract the battery twice.
    const grossConsumptionBudgetW = coordination ? coordination.consumptionBudgetW : consumptionBudgetW;
    write(`${r}.Control.ParallelWallboxAllocation_JSON`, JSON.stringify({schema: 1, timestamp: now,
        valid: sourcesValid, order, budgetW: grantedNominalW, voltage,
        hardBudgetW: Number.isFinite(grossConsumptionBudgetW) ? Math.max(0, grossConsumptionBudgetW) : null,
        slowBudgetW: Number.isFinite(consumptionBudgetW) ? Math.max(0, consumptionBudgetW) : null,
        minimumTotalW: mandatoryW, mandatoryGridW: Math.max(0, mandatoryW - pvPoolW),
        allocations: records, waiting}));
    write(`${r}.Control.ParallelDistributionActive`, realtimeParallelActive);
    write(`${r}.Control.ParallelDistributionReleased`, parallelRelease === true);
    write(`${r}.Control.SelectedWallbox`, order[0] ?? -1);
    write(`${r}.Control.SlowLastUpdate`, now);
}

function updateSlowTargets(requiredControlledW, wallboxPlans, heatingPlan, consumptionBudgetW = Infinity,
    coordination = null) {
    if (typeof parallelWallboxChargingEnabled === 'function' && parallelWallboxChargingEnabled())
        return updateParallelSlowTargets(requiredControlledW, wallboxPlans, heatingPlan, consumptionBudgetW, coordination);
    const r = CFG.root;
    const scope = realtimeProductionScope();
    const previousSelected = lastSelectedRealtimeWallbox;
    const selectionAt = Date.now();
    if (wallboxDisconnectedDonor) {
        const donor = wallboxDisconnectedDonor;
        if (!scope.production || selectionAt >= donor.until
            || selectionAt < donor.lastObservationAt
            || selectionAt - donor.lastObservationAt > wallboxHandoffMaximumGapMs()
            || getState(`${r}.Control.Enabled`)?.val !== true
            || getState(`${r}.System.DataValid`)?.val !== true
            || getState(`${r}.Plan.Valid`)?.val !== true
            || !wallboxHandoffShadowValid()
            || !wallboxHandoffSourceValid(donor.from, selectionAt, false, 0, true))
            wallboxDisconnectedDonor = null;
        else donor.lastObservationAt = selectionAt;
    }
    // Keep a recent, genuinely observed donor episode across the short empty
    // selection between unplugging and the next eligible car. This is not a
    // persisted resume token and cannot be manufactured by a car=1 snapshot.
    if (previousSelected >= 0) {
        const proof = wallboxVehicleHandoffObservation[previousSelected];
        if (scope.production && proof.qualified && proof.lastActiveAt > 0
            && selectionAt >= proof.lastActiveAt
            && selectionAt - proof.lastActiveAt <= wallboxHandoffMaximumGapMs()
            && getState(`${r}.Control.Enabled`)?.val === true
            && getState(`${r}.System.DataValid`)?.val === true
            && getState(`${r}.Plan.Valid`)?.val === true && wallboxHandoffShadowValid()
            && numericValue(getState(CFG.dp.wallboxCar[previousSelected])?.val) === 1
            && wallboxHandoffSourceValid(previousSelected, selectionAt, false, 0, true)) {
            const feedbackMs = Math.max(1, Number(nativeConfig[`wb${previousSelected}FeedbackTimeoutS`]) || 20) * 1000;
            const responseMs = Math.max(5, Math.min(120,
                Number(nativeConfig.wallboxResponseSettleTimeoutS) || 45)) * 1000;
            wallboxDisconnectedDonor = {from: previousSelected, at: selectionAt,
                lastObservationAt: selectionAt,
                until: selectionAt + Math.min(5 * 60000, 2 * feedbackMs + responseMs + 10000)};
        }
    }
    observeWallboxVehicleHandoff(previousSelected, scope, selectionAt);
    const candidates = selectRealtimeWallboxes(wallboxPlans, scope);
    const selected = candidates[0] || null;
    prepareWallboxVehicleHandoffSelection(previousSelected, selected, scope, selectionAt);
    const selectedWallbox = selected?.wb ?? null;
    const activeVehicle = selected?.vehicle || null;
    const priceAuthorization = selected
        ? priceChargingAuthorization(`Wallbox${selected.wb}`, wallboxPlans[selected.wb]) : {gridW: 0};
    const authorizedGridW = Math.min(priceAuthorization.gridW, Math.max(0, consumptionBudgetW));
    const candidateWallboxes = new Set(selected ? [selected.wb] : []);
    [0, 1, 2].forEach(wb => {
        if (candidateWallboxes.has(wb)) return;
        resetWallboxStartCandidate(wb, 'selection-lost');
        revokeWallboxSequenceResume(wb, 'selection-lost');
        wallboxSequenceResume[wb].wasActive = false;
        wallboxSequenceResume[wb].lastObservationAt = 0;
        resetWallboxRealPhaseCandidate(wb);
        publishWallboxAllocation(wb, {timestamp: Date.now(), valid: true,
            selected: false, targetA: 0, reason: 'not-selected',
            selectionReason: getState(`${r}.Control.WallboxSelectionReason`)?.val || '',
            startHistory: wallboxStartHistory[wb]});
        wallboxRunStartedAt[wb] = 0;
    });
    const dhwReleased = scope.dhw && Boolean(getState(`${r}.Devices.MyPV_DHW.Release`)?.val);
    const dhwCapW = coordination ? Math.max(0, coordination.heaterCapW) : dhwReleased
        ? Math.max(0, Math.min(readNumber(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0),
            scope.production ? readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000) : Infinity)) : 0;
    // The coordinated branch passes the two real heaters as one shared cap.
    // Observer-only consumers must never reserve productive watts.
    const heatingCapW = scope.production ? 0 : Math.max(0, Number(heatingPlan.valueW) || 0);
    const wallboxCapW = activeVehicle
        ? Math.min(activeVehicle.maximumPowerW, Math.max(0, consumptionBudgetW)) : 0;
    const wallboxCapacityTotalW = wallboxCapW;
    const recommendedWallboxPhases = wallboxPlans.map(item => Number(item?.phases) >= 3 ? 3 : 1);
    const now = Date.now();
    const mustHeat = Boolean(getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val);
    const phaseBudgetSourcesValid = !scope.production || wallboxPhaseBudgetSourcesValid(scope, now, coordination);
    const nextWallboxPhases = [0, 1, 2].map(wb => {
        const vehicle = vehicleState(wb);
        let realContext = null;
        if (scope.production) {
            const outputBase = `${r}.Devices.Wallbox${wb}`;
            const pending = getState(`${outputBase}.PhaseSwitchPending`)?.val === true
                || getState(`${outputBase}.PhaseTransitionActive`)?.val === true;
            // Reconstruct the controllable pool from fresh grid + existing
            // controlled load. Export alone omits the car's current draw.
            // Only the policy-authorized import belongs to this particular car;
            // mandatory heating has precedence over its discretionary PV pool.
            const pvPoolW = Math.max(0, requiredControlledW);
            const heaterPriorityW = mustHeat && !vehicle.belowMinimum
                ? Math.min(dhwCapW, pvPoolW) : 0;
            const budgetW = wb === selectedWallbox ? Math.max(0, Math.min(wallboxCapW,
                consumptionBudgetW, pvPoolW - heaterPriorityW + authorizedGridW)) : null;
            const valid = wb === selectedWallbox && vehicle.connected && vehicle.release
                && scope.wallboxes.includes(wb)
                && getState(`${r}.Control.Enabled`)?.val === true
                && getState(`${r}.System.DataValid`)?.val === true
                && getState(`${r}.Plan.Valid`)?.val === true
                && vehicle.phaseFeedbackValid && wallboxHandoffShadowValid()
                && phaseBudgetSourcesValid
                && wallboxHandoffSourceValid(wb, now);
            realContext = {budgetW, valid, pending, authorizedGridW,
                preStartReady: valid && !pending && wallboxPreStartPhaseReady(wb, now),
                active: wb === selectedWallbox && vehicle.connected && vehicle.release && scope.wallboxes.includes(wb),
                reason: wb !== selectedWallbox ? 'not-selected'
                    : !phaseBudgetSourcesValid ? 'phase-budget-sources-invalid' : 'real-sources-invalid'};
        }
        return stabilizedPhaseTarget(wb, vehicle, recommendedWallboxPhases[wb], now, realContext);
    });
    const mandatoryPhases = selected ? nextWallboxPhases[selected.wb] : 1;
    const voltage = Math.max(200, readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230));
    const mandatoryW = activeVehicle?.mustCharge ? Math.min(wallboxCapW,
        (mandatoryPhases === 3 ? activeVehicle.minCurrent3pA : activeVehicle.minCurrent1pA)
            * voltage * mandatoryPhases) : 0;
    const availableSlowW = clamp(Math.max(requiredControlledW, mandatoryW), 0,
        Math.min(dhwCapW + heatingCapW + wallboxCapacityTotalW,
            scope.production ? Math.max(0, consumptionBudgetW) : Infinity));
    const heatingTargetW = Math.min(heatingCapW, availableSlowW);
    const pairAvailableW = Math.max(0, availableSlowW - heatingTargetW);
    const threePhase = mandatoryPhases === 3;
    const startThresholdW = threePhase
        ? readNumber(`${r}.Config.DHWParallelStartPower3P_W`, 9000)
        : readNumber(`${r}.Config.DHWParallelStartPower1P_W`, 4000);
    const stopThresholdW = threePhase
        ? readNumber(`${r}.Config.DHWParallelStopPower3P_W`, 8000)
        : readNumber(`${r}.Config.DHWParallelStopPower1P_W`, 3000);
    const parallelRelease = readBooleanInput(CFG.dp.dhwParallelRelease);
    const parallelEnabled = Boolean(getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val)
        && parallelRelease === true && dhwCapW > 0 && wallboxCapW > 0;
    if (!parallelEnabled) realtimeParallelActive = false;
    else if (realtimeParallelActive && pairAvailableW < stopThresholdW) realtimeParallelActive = false;
    else if (!realtimeParallelActive && pairAvailableW >= startThresholdW) realtimeParallelActive = true;

    let requestedDhwW = 0;
    let requestedWallboxW = 0;
    if (activeVehicle?.belowMinimum) {
        requestedWallboxW = Math.min(wallboxCapW, pairAvailableW);
        requestedDhwW = Math.min(dhwCapW, Math.max(0, pairAvailableW - requestedWallboxW));
    } else if (mustHeat) {
        requestedDhwW = Math.min(dhwCapW, pairAvailableW);
        requestedWallboxW = Math.min(wallboxCapW, Math.max(0, pairAvailableW - requestedDhwW));
    } else if (activeVehicle?.mustCharge) {
        requestedWallboxW = Math.min(wallboxCapW, pairAvailableW);
        requestedDhwW = Math.min(dhwCapW, Math.max(0, pairAvailableW - requestedWallboxW));
    } else if (realtimeParallelActive) {
        const pair = splitRealtimePair(pairAvailableW, dhwCapW, wallboxCapW,
            readNumber(`${r}.Config.DHWParallelShare_pct`, 50));
        requestedDhwW = pair.dhwW;
        requestedWallboxW = pair.wallboxW;
    } else if (activeVehicle) {
        requestedWallboxW = Math.min(wallboxCapW, pairAvailableW);
        requestedDhwW = Math.min(dhwCapW, Math.max(0, pairAvailableW - requestedWallboxW));
    } else requestedDhwW = Math.min(dhwCapW, pairAvailableW);

    // Import belongs exclusively to this car. It must not enter the PV pool
    // or be handed to a heater while the charger waits/ramps.
    const wallboxPvBudgetW = requestedWallboxW;
    requestedWallboxW = Math.min(wallboxCapW, requestedWallboxW + authorizedGridW);

    const nextWallboxW = [0, 0, 0];
    const nextWallboxA = [0, 0, 0];
    const nextWallboxExpectedW = [0, 0, 0];
    let wallboxBudgetW = Math.min(Math.max(0, consumptionBudgetW),
        Math.max(0, pairAvailableW - requestedDhwW) + authorizedGridW);
    let remainingSafetyBudgetW = Math.max(0, consumptionBudgetW);
    if (selected) {
        const candidate = selected;
        const outputBase = `${r}.Devices.Wallbox${candidate.wb}`;
        const productiveOutputOwned = getState(`${outputBase}.OutputOwned`)?.val === true;
        const productiveOutputActive = getState(`${outputBase}.OutputActive`)?.val === true;
        const confirmedA = readNumber(`${outputBase}.OutputCommand_A`, 0);
        const previousA = scope.production
            ? productiveOutputOwned
                ? productiveOutputActive ? Math.max(0, confirmedA) : 0
                : 0
            : slowTargets.wallboxA[candidate.wb] || 0;
        let requestedW = Math.min(requestedWallboxW, wallboxBudgetW);
        const requestedBeforeStabilizationW = requestedW;
        requestedW = stabilizedWallboxPower(candidate.wb, requestedW, candidate.vehicle,
            previousA, nextWallboxPhases[candidate.wb], now,
            remainingSafetyBudgetW, authorizedGridW > 0, {selected: true,
                valid: scope.production && getState(`${r}.Control.Enabled`)?.val === true
                    && getState(`${r}.System.DataValid`)?.val === true
                    && getState(`${r}.Plan.Valid`)?.val === true});
        const actualPowerKW = readNumber(CFG.dp.wallboxesKW[candidate.wb], Number.NaN);
        const actualPowerW = Number.isFinite(actualPowerKW) ? Math.max(0, actualPowerKW * 1000) : null;
        const physicalPhases = candidate.vehicle.phaseSwitchEnabled
            ? readNumber(`${outputBase}.OutputPhases`, 0) : 1;
        const phaseTransition = scope.production && (getState(`${outputBase}.PhaseSwitchPending`)?.val === true
            || getState(`${outputBase}.PhaseTransitionActive`)?.val === true
            || physicalPhases !== nextWallboxPhases[candidate.wb]
            || candidate.vehicle.phaseSwitchEnabled && (!candidate.vehicle.phaseFeedbackValid
                || candidate.vehicle.confirmedPhases !== nextWallboxPhases[candidate.wb]));
        const combinedRampA = realtimeParallelActive
            ? Math.max(1, readNumber(`${r}.Config.WallboxCombinedMaxStep_A`, 1)) : null;
        const quantized = quantizeWallbox(requestedW, candidate.vehicle,
            previousA, nextWallboxPhases[candidate.wb],
            authorizedGridW > 0 || phaseTransition ? null : actualPowerW,
            {rampA: combinedRampA, nearestAmp: realtimeParallelActive,
                maximumPowerW: remainingSafetyBudgetW});
        const measuredIncrease = scope.production && productiveOutputOwned && productiveOutputActive
            && !phaseTransition && authorizedGridW === 0 && !activeVehicle.mustCharge
            && actualPowerW !== null && quantized.amps > confirmedA;
        const nextOutputA = Math.min(quantized.amps, confirmedA + (measuredIncrease ? 1 : Math.max(1,
            readNumber(`${r}.Config.WallboxCombinedMaxStep_A`, 1))));
        const wallboxIncreaseReserveW = scope.production && productiveOutputOwned
            && productiveOutputActive && quantized.amps > confirmedA
            ? measuredIncrease
                ? actualPowerW + (nextOutputA - confirmedA) * voltage * quantized.phases
                : Math.max(nextOutputA * voltage * quantized.phases,
                    (actualPowerW || 0) + (nextOutputA - confirmedA) * voltage * quantized.phases) : 0;
        publishWallboxAllocation(candidate.wb, {timestamp: now, valid: true,
            selected: true, selectionReason: candidate.selectionReason,
            requiredControlledW, pairAvailableW, requestedBeforeStabilizationW,
            start: {...wallboxStartDiagnostics[candidate.wb]},
            distributionReason: activeVehicle?.belowMinimum ? 'vehicle-below-minimum'
                : mustHeat ? 'dhw-must-heat' : activeVehicle?.mustCharge ? 'vehicle-must-charge'
                    : realtimeParallelActive ? 'parallel-share' : 'wallbox-priority',
            pvBudgetW: wallboxPvBudgetW, dhwRequestedW: requestedDhwW,
            parallelActive: realtimeParallelActive, increaseReserveW: wallboxIncreaseReserveW,
            increaseBasis: measuredIncrease ? 'measured-one-amp-step' : 'nominal',
            increaseNextA: wallboxIncreaseReserveW > 0 ? nextOutputA : null,
            outputOwned: productiveOutputOwned,
            outputActive: productiveOutputActive,
            phaseTransition, physicalPhases: [1, 3].includes(physicalPhases) ? physicalPhases : null,
            priceGridW: authorizedGridW, priceStatus: priceAuthorization.reason,
            safetyBudgetW: Number.isFinite(remainingSafetyBudgetW) ? remainingSafetyBudgetW : null,
            ...quantized.diagnostics});
        // In combined operation the eHZ must fill the residual against the
        // *measured* wallbox power. A go-e current command can precede the
        // vehicle's real response by several seconds; reserving that expected
        // power caused avoidable export and destroyed the visible 50/50 split.
        let allocationWallboxW = realtimeParallelActive && productiveOutputActive
            && actualPowerW !== null ? actualPowerW : quantized.expectedPowerW;
        // Yield only the next allocated charge step before its output guard
        // can issue it. Measured-only residuals let the heater absorb all PV
        // and made both consumers wait forever for the other to release it.
        // Reductions still reserve real draw until the vehicle responds.
        allocationWallboxW = Math.max(allocationWallboxW, wallboxIncreaseReserveW);
        if (phaseTransition && productiveOutputOwned) {
            // Ampere reductions can still increase watts when changing 1P/3P.
            // Reserve the old electrical topology until the follower and car
            // confirm the new one, even outside the parallel/heater branch.
            allocationWallboxW = Math.max(allocationWallboxW, actualPowerW || 0,
                quantized.powerW, productiveOutputActive && [1, 3].includes(physicalPhases)
                    ? confirmedA * voltage * physicalPhases : 0);
        }
        if (scope.production && Number.isFinite(consumptionBudgetW)) {
            // Under a binding shared limit, reserve the larger of physical
            // draw and the next command before letting the EHZ use the rest.
            // Measured-only residuals are appropriate for soft PV balancing,
            // not for simultaneous commands constrained by a hard common cap.
            allocationWallboxW = Math.max(allocationWallboxW,
                actualPowerW || 0, quantized.powerW);
        }
        // Output stop delay intentionally holds physical charging even when
        // the requested target is zero. Preserve that real load in the EHZ
        // residual without raising the target (which would reset the timer).
        if (scope.production && productiveOutputOwned && quantized.amps === 0) {
            const outputPhases = readNumber(`${outputBase}.OutputPhases`, mandatoryPhases) >= 3 ? 3 : 1;
            allocationWallboxW = Math.max(allocationWallboxW, actualPowerW || 0,
                productiveOutputActive ? confirmedA * voltage * outputPhases : 0);
        }
        nextWallboxW[candidate.wb] = quantized.powerW;
        nextWallboxA[candidate.wb] = quantized.amps;
        nextWallboxExpectedW[candidate.wb] = allocationWallboxW;
        nextWallboxPhases[candidate.wb] = quantized.phases;
        wallboxBudgetW = Math.max(0, wallboxBudgetW - quantized.powerW);
        remainingSafetyBudgetW = Math.max(0, remainingSafetyBudgetW - quantized.powerW);
    }
    // Entzogene Freigaben sofort auf null, keine Rampe ueber Sicherheitsgrenzen.
    [0, 1, 2].forEach(wb => {
        if (wb === selectedWallbox) return;
        // A released/finished car may still draw current until allow=0 has
        // physically been acknowledged. Do not offer those watts to the EHZ
        // or another car during this stop handshake.
        if (scope.production && scope.wallboxes.includes(wb)
            && getState(`${r}.Devices.Wallbox${wb}.OutputOwned`)?.val === true) {
            const measuredW = Math.max(0, readNumber(CFG.dp.wallboxesKW[wb], 0) * 1000);
            const outputPhases = readNumber(`${r}.Devices.Wallbox${wb}.OutputPhases`, 1) >= 3 ? 3 : 1;
            const commandW = getState(`${r}.Devices.Wallbox${wb}.OutputActive`)?.val === true
                ? Math.max(0, readNumber(`${r}.Devices.Wallbox${wb}.OutputCommand_A`, 0))
                    * voltage * outputPhases : 0;
            nextWallboxExpectedW[wb] = Math.max(measuredW, commandW);
        }
    });
    const assignedWallboxW = nextWallboxExpectedW.reduce((sumW, valueW) => sumW + valueW, 0);
    const priceGridW = selected ? Math.min(authorizedGridW,
        Math.max(0, nextWallboxExpectedW[selected.wb] - wallboxPvBudgetW)) : 0;
    // The EHZ is the stepless residual controller. It must receive every watt
    // that the selected wallbox cannot use because of its whole-ampere minimum,
    // start delay or current ramp, even below the 50/50 threshold. The stable
    // start timer evaluates the total controllable surplus, so the EHZ can use
    // this energy during the countdown without wasting it as grid export.
    requestedDhwW = Math.min(dhwCapW, Math.max(0, pairAvailableW - Math.max(0, assignedWallboxW - priceGridW)));
    slowTargets = {
        dhwW: coordination ? Math.min(dhwCapW, Math.round(requestedDhwW))
            : simulateDhwTarget(Math.min(dhwCapW, Math.round(requestedDhwW))),
        heatingW: Math.round(heatingTargetW), wallboxW: nextWallboxW,
        wallboxA: nextWallboxA, wallboxExpectedW: nextWallboxExpectedW, wallboxPhases: nextWallboxPhases,
        wallboxRecommendedPhases: recommendedWallboxPhases
    };
    for (const wb of [0, 1, 2]) write(`${r}.Control.Wallbox${wb}PriceGridCharge_W`,
        wb === selectedWallbox ? Math.round(priceGridW) : 0);
    [0, 1, 2].forEach(wb => publishWallboxTimingDiagnostics(wb, now, nextWallboxA[wb]));
    write(`${r}.Control.ParallelDistributionActive`, realtimeParallelActive);
    write(`${r}.Control.ParallelDistributionReleased`, parallelRelease === true);
    write(`${r}.Control.ParallelDistributionReleaseStatus`, parallelRelease === null
        ? `Ungueltig/fehlt: ${CFG.dp.dhwParallelRelease}`
        : `${CFG.dp.dhwParallelRelease}: ${parallelRelease ? 'ein' : 'aus'}`);
    write(`${r}.Control.ParallelDistributionThresholds`,
        `${threePhase ? '3-phasig' : '1-phasig'}: EIN > ${startThresholdW} W, AUS < ${stopThresholdW} W`);
    write(`${r}.Control.SelectedWallbox`, selectedWallbox === null ? -1 : selectedWallbox);
    write(`${r}.Control.SlowLastUpdate`, Date.now());
}

function realtimeControl() {
    const r = CFG.root;
    if (!Boolean(getState(`${r}.Control.Enabled`)?.val)) return zeroRealtimeTargets('Simulation deaktiviert');
    const consumptionLimit = currentConsumptionLimit();
    publishConsumptionLimit(consumptionLimit);
    if (!consumptionLimit.valid) return zeroRealtimeTargets(`${consumptionLimit.reason} – §14a-Verbraucher auf null`);
    if (!Boolean(getState(`${r}.System.DataValid`)?.val)) return zeroRealtimeTargets('Eingangsdaten ungueltig oder veraltet');
    if (!Boolean(getState(`${r}.Plan.Valid`)?.val)) return zeroRealtimeTargets('Kein gueltiger 48-h-Fahrplan');
    if (CFG.dp.haCritical && Boolean(getState(CFG.dp.haCritical)?.val)) {
        return zeroRealtimeTargets('Hausanschluss-Schutz aktiv – Simulation auf null');
    }
    const now = Date.now();
    const gridMeasurement = realtimeGridMeasurement();
    if (!gridMeasurement.valid)
        return zeroRealtimeTargets(`Aktuelle Netzleistungsmessung ungueltig: ${gridMeasurement.invalid.join(', ')}`);
    const gridW = gridMeasurement.gridW;
    const targetGridW = readNumber(`${r}.Control.TargetGridPower_W`, -100);
    const deadbandW = Math.max(0, readNumber(`${r}.Control.Deadband_W`, 100));
    const errorW = gridW - targetGridW;
    const desiredChangeW = Math.abs(errorW) <= deadbandW ? 0 : -errorW;
    const batteryPlan = currentPlanItem('BatteryPower', now);
    const dhwPlan = currentPlanItem('MyPV_DHW', now);
    const heatingPlan = currentPlanItem('MyPV_Heating', now);
    const boostPlan = currentPlanItem('PVBoost', now);
    const wallboxPlans = [0, 1, 2].map(wb => currentPlanItem(`Wallbox${wb}`, now));
    if (!batteryPlan || !dhwPlan || !heatingPlan || wallboxPlans.some(item => !item)) {
        return zeroRealtimeTargets('Aktueller Fahrplan-Slot fehlt');
    }

    if (typeof coordinatedEnergyEnabled === 'function' && coordinatedEnergyEnabled()) {
        return coordinatedRealtimeControl({now, gridW, targetGridW, deadbandW, errorW,
            desiredChangeW, batteryPlan, dhwPlan, heatingPlan, boostPlan, wallboxPlans,
            consumptionLimit});
    }

    const scope = realtimeProductionScope();
    const actualBatteryW = readNumber(CFG.dp.batteryPower, 0);
    let actualDhwW = readNumber(`${r}.Actual.MyPV_DHW_W`, 0);
    if (scope.production && scope.dhw) {
        // The productive NVP and its reclaimable heater load must use current
        // source samples together. Combining a fresh grid value with the slow
        // observer mirror mistakes a recent EHZ ramp for uncontrolled house
        // consumption and can erase both heater and waiting wallbox budgets.
        const outputIds = CFG.dp.myPvDhwOutputW || [];
        const outputsW = outputIds.map(id => freshDhwNumber(id, CFG.dataMaxAgeMs));
        if (outputIds.length !== 3 || outputIds.some(id => !id)
            || outputsW.some(watts => watts === null || !Number.isFinite(watts) || watts < 0))
            return zeroRealtimeTargets('Aktuelle EHZ-Phasenleistung fehlt, ist veraltet oder ungueltig');
        actualDhwW = Math.round(outputsW.reduce((sumW, watts) => sumW + watts, 0));
    }
    const actualHeatingW = readNumber(`${r}.Actual.MyPV_Heating_W`, 0);
    const actualWallboxW = CFG.dp.wallboxesKW.map(id => Math.max(0, readNumber(id, 0) * 1000));
    const actualControlledW = scope.production
        ? (scope.dhw ? actualDhwW : 0)
            + actualWallboxW.reduce((sumW, valueW, wb) => sumW
                + (scope.wallboxes.includes(wb) ? valueW : 0), 0)
        : actualBatteryW + actualDhwW + actualHeatingW
            + actualWallboxW.reduce((sumW, valueW) => sumW + valueW, 0);
    const uncontrolledGridW = gridW - actualControlledW;
    const requiredControlledW = desiredChangeW === 0 ? actualControlledW : targetGridW - uncontrolledGridW;

    const slowCycleMs = Math.max(2, readNumber(`${r}.Config.SlowControlCycle_s`, 5)) * 1000;
    const consumptionBudgetW = consumptionLimit.budgetW === null ? Infinity : consumptionLimit.budgetW;
    write(`${r}.Control.SlowCycleSeconds`, slowCycleMs / 1000);
    if (lastSlowUpdate === 0 || now - lastSlowUpdate >= slowCycleMs
        || [0, 1, 2].some(wb => getState(`${r}.Config.Wallbox${wb}PriceChargingEnabled`)?.val === true)
        || consumptionBudgetW !== lastConsumptionBudgetW) {
        updateSlowTargets(requiredControlledW, wallboxPlans, heatingPlan, consumptionBudgetW);
        lastSlowUpdate = now;
        lastConsumptionBudgetW = consumptionBudgetW;
    }
    const allocatedSlowW = slowTargets.dhwW + slowTargets.heatingW
        + slowTargets.wallboxExpectedW.reduce((sumW, valueW) => sumW + valueW, 0);
    const soc = readNumber(CFG.dp.batterySoc, readNumber(`${r}.Config.BatteryManualSoC_pct`, 50));
    const minSoc = readNumber(`${r}.Config.BatteryMinSoC_pct`, 0);
    const maxSoc = readNumber(`${r}.Config.BatteryMaxSoC_pct`, 100);
    const maxChargeW = Math.max(0, readNumber(`${r}.Config.BatteryMaxCharge_W`, 2400));
    const maxDischargeW = Math.max(0, readNumber(`${r}.Config.BatteryMaxDischarge_W`, 2400));
    const batteryPresent = !scope.production && Boolean(getState(`${r}.Devices.Battery.Present`)?.val);
    const evImportW = [0, 1, 2].reduce((sum, wb) => sum
        + readNumber(`${r}.Control.Wallbox${wb}PriceGridCharge_W`, 0), 0);
    const batteryPriceW = batteryPresent ? priceChargingAuthorization('Battery', batteryPlan, now).gridW : 0;
    const residualBatteryW = requiredControlledW - allocatedSlowW + evImportW;
    const batteryTargetW = batteryPresent ? Math.round(clamp(batteryPriceW > 0
        ? batteryPriceW + Math.max(0, residualBatteryW) : residualBatteryW,
        soc > Math.max(minSoc, batteryPriceDischargeFloor(now)) ? -maxDischargeW : 0,
        soc < maxSoc ? maxChargeW : 0)) : 0;
    const predictedGridW = Math.round(uncontrolledGridW + allocatedSlowW + batteryTargetW);
    const remainingErrorW = predictedGridW - targetGridW;

    write(`${r}.Control.ActualGridPower_W`, Math.round(gridW));
    write(`${r}.Control.PredictedGridPower_W`, predictedGridW);
    write(`${r}.Control.Error_W`, Math.round(errorW));
    write(`${r}.Control.RemainingError_W`, Math.round(remainingErrorW));
    write(`${r}.Control.ProtectedGridImport_W`, Math.round(evImportW + batteryPriceW));
    write(`${r}.Control.BatteryPriceGridCharge_W`, Math.round(Math.min(batteryPriceW, Math.max(0, batteryTargetW))));
    write(`${r}.Control.PlanSlotTimestamp`, Math.max(Number(batteryPlan.timestamp) || 0, Number(dhwPlan.timestamp) || 0));
    write(`${r}.Control.Targets.Battery_W`, batteryTargetW);
    write(`${r}.Control.Targets.MyPV_DHW_W`, slowTargets.dhwW);
    write(`${r}.Control.Targets.MyPV_Heating_W`, slowTargets.heatingW);
    [0, 1, 2].forEach(wb => {
        write(`${r}.Control.Targets.Wallbox${wb}_W`, slowTargets.wallboxW[wb]);
        write(`${r}.Control.Targets.Wallbox${wb}_A`, slowTargets.wallboxA[wb]);
        write(`${r}.Control.Targets.Wallbox${wb}_Phases`, slowTargets.wallboxPhases[wb]);
        write(`${r}.Vehicles.Wallbox${wb}.RecommendedPhases`, slowTargets.wallboxRecommendedPhases[wb]);
    });
    write(`${r}.Control.Targets.PVBoostRelease`, Boolean(boostPlan?.release) && predictedGridW <= deadbandW);
    write(`${r}.Control.Valid`, true);
    const diagnosticMode = nativeConfig.globalWriteEnabled === true
        && getState(`${r}.System.RealOutputsEnabled`)?.val === true ? 'PRODUKTIVFREIGABE' : 'SIMULATION';
    write(`${r}.Control.Mode`, diagnosticMode);
    write(`${r}.Control.Status`, Math.abs(remainingErrorW) <= deadbandW
        ? `${diagnosticMode}: Batterie 1 s / langsame Verbraucher ${slowCycleMs / 1000} s; NVP-Ziel erreichbar`
        : `${diagnosticMode}: Stellgrenzen erreicht, Restabweichung ${Math.round(remainingErrorW)} W`);
    write(`${r}.Control.LastUpdate`, now);
    if (desiredChangeW === 0) write(`${r}.Control.Status`, `${diagnosticMode}: innerhalb Totband (${Math.round(gridW)} W)`);
}
