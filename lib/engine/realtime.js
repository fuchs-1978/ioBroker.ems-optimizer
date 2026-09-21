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

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

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
let wallboxStartCandidateSince = [0, 0, 0];
let wallboxRunStartedAt = [0, 0, 0];
let wallboxOutputWasActive = [false, false, false];
let wallboxLastHandoffSince = [0, 0, 0];
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
    if (maximumA < minimumA || requestedW <= 0)
        return {amps: 0, powerW: 0, expectedPowerW: 0, phases};
    const rampA = Math.max(1, Math.round(Number(options.rampA)
        || readNumber(`${CFG.root}.Config.WallboxMaxStep_A`, 6)));
    const unitPowerW = voltage * phases;
    const measuredPowerW = Number(actualPowerW);
    const useActualResponse = previousA > 0 && Number.isFinite(measuredPowerW)
        && measuredPowerW >= minimumA * unitPowerW * 0.5;
    let requestedA;
    if (useActualResponse) {
        const deltaW = requestedW - measuredPowerW;
        const deltaA = deltaW >= 0 ? Math.floor(deltaW / unitPowerW) : Math.ceil(deltaW / unitPowerW);
        requestedA = previousA + deltaA;
    } else requestedA = options.nearestAmp === true
        ? Math.round(Math.max(0, requestedW) / unitPowerW)
        : Math.floor(Math.max(0, requestedW) / unitPowerW);
    if (requestedA < minimumA) requestedA = 0;
    requestedA = Math.min(maximumA, requestedA);
    let targetA = Math.min(requestedA, previousA + rampA);
    if (targetA > 0 && targetA < minimumA) targetA = requestedA >= minimumA ? minimumA : 0;
    const powerW = Math.round(targetA * unitPowerW);
    const expectedPowerW = useActualResponse
        ? Math.max(0, Math.round(measuredPowerW + (targetA - previousA) * unitPowerW)) : powerW;
    return {amps: targetA, powerW, expectedPowerW, phases};
}

function stabilizedWallboxPower(wb, requestedW, vehicle, previousA, requestedPhases, now,
    safetyCapW = Infinity) {
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
    const productionControlEnabled = Boolean(
        getState(`${CFG.root}.Devices.Wallbox${wb}.ControlEnabled`)?.val);
    const outputState = getState(`${CFG.root}.Devices.Wallbox${wb}.OutputActive`);
    const outputActive = outputState?.val === true;
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
    if (safeMaximumW < minimumW) {
        wallboxStartCandidateSince[wb] = 0;
        wallboxRunStartedAt[wb] = 0;
        return 0;
    }
    requestedW = Math.min(requestedW, safeMaximumW);

    if (mandatory) {
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
        // Productive minimum-runtime and stop-delay guards belong to the
        // output controller. Passing a fabricated minimum-power target here
        // conceals the shortfall and starts the stop delay only *after* the
        // minimum runtime ends. Keep the real demand zero; reserve the held
        // physical load separately below when allocating the EHZ residual.
        if (productionControlEnabled
            && getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === true) return 0;
        if (wallboxRunStartedAt[wb] > 0
            && now - wallboxRunStartedAt[wb] < minimumRunMs)
            return Math.min(safeMaximumW, minimumW);
        wallboxRunStartedAt[wb] = 0;
        return 0;
    }

    wallboxRunStartedAt[wb] = 0;
    // The extra reserve is required to enter the countdown. Once armed, it
    // acts as hysteresis: the EHZ may continue using the surplus and normal
    // fluctuations inside the reserve do not restart the timer. A real drop
    // below the wallbox minimum still resets it.
    const startThresholdW = wallboxStartCandidateSince[wb] > 0
        ? minimumW : minimumW + reserveW;
    if (requestedW < startThresholdW) {
        wallboxStartCandidateSince[wb] = 0;
        return 0;
    }
    if (startDelayMs > 0 && wallboxStartCandidateSince[wb] <= 0) {
        wallboxStartCandidateSince[wb] = now;
        return 0;
    }
    if (now - wallboxStartCandidateSince[wb] < startDelayMs) return 0;
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

function stabilizedPhaseTarget(wb, vehicle, recommendedPhases, now) {
    if (!vehicle.phaseSwitchEnabled || vehicle.maximumPhases < 3) {
        stableWallboxPhases[wb] = 1;
        return 1;
    }
    if (![1, 3].includes(stableWallboxPhases[wb])) {
        const existing = Number(getState(`${CFG.root}.Control.Targets.Wallbox${wb}_Phases`)?.val);
        stableWallboxPhases[wb] = [1, 3].includes(existing) ? existing
            : recommendedPhases >= 3 ? 3 : 1;
    }
    const hoursRemaining = (vehicle.departureTimestamp - now) / 3600000;
    const urgentThreePhase = vehicle.gridEnergyRequiredKWh > 0 && hoursRemaining > 0
        && vehicle.gridEnergyRequiredKWh / hoursRemaining * 1000 > vehicle.maxCurrent1pA * 230;
    const forecastPhase = forecastPhaseWindow(wb, now);
    const desired = urgentThreePhase ? 3 : forecastPhase;
    if (![1, 3].includes(desired) || desired === stableWallboxPhases[wb]) return stableWallboxPhases[wb];
    const holdMs = Math.max(0, Number(nativeConfig.phaseSwitchMinHoldMin ?? 30)) * 60000;
    if (now - lastPhaseChangeAt[wb] < holdMs) return stableWallboxPhases[wb];
    stableWallboxPhases[wb] = desired;
    lastPhaseChangeAt[wb] = now;
    return desired;
}

function resetSlowTargets() {
    realtimeParallelActive = false;
    lastSlowUpdate = 0;
    lastConsumptionBudgetW = Infinity;
    wallboxStartCandidateSince = [0, 0, 0];
    wallboxRunStartedAt = [0, 0, 0];
    wallboxOutputWasActive = [false, false, false];
    wallboxLastHandoffSince = [0, 0, 0];
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
    write(`${r}.Control.Valid`, false);
    write(`${r}.Control.Status`, status);
    write(`${r}.Control.Targets.Battery_W`, 0);
    write(`${r}.Control.Targets.MyPV_DHW_W`, 0);
    write(`${r}.Control.Targets.MyPV_Heating_W`, 0);
    [0, 1, 2].forEach(wb => {
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
    const candidates = [0, 1, 2].map(wb => ({
        wb, vehicle: vehicleState(wb),
        outputActive: getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
            && getState(`${CFG.root}.Devices.Wallbox${wb}.OutputActive`)?.val === true,
        outputOwned: Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val),
        plannedW: Math.max(0, Number(wallboxPlans[wb]?.valueW) || 0),
        plannedPhases: Number(wallboxPlans[wb]?.phases) >= 3 ? 3 : 1
    })).filter(x => x.vehicle.release && scope.wallboxes.includes(x.wb));
    if (scope.production && scope.wallboxes.some(wb =>
        getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
        && !candidates.some(candidate => candidate.wb === wb))) return [];
    // A running EMS-owned wallbox remains selected until its release ends.
    // This makes the multi-wallbox alpha mode strictly sequential and also
    // preserves the configured minimum run time without starting a second car.
    candidates.sort((a, b) => Number(b.outputActive) - Number(a.outputActive)
        || Number(b.outputOwned) - Number(a.outputOwned)
        || Number(b.vehicle.belowMinimum) - Number(a.vehicle.belowMinimum)
        || Number(b.vehicle.mustCharge) - Number(a.vehicle.mustCharge)
        || b.vehicle.effectivePriorityScore - a.vehicle.effectivePriorityScore
        || Number(b.plannedW > 0) - Number(a.plannedW > 0)
        || a.vehicle.latestStartTimestamp - b.vehicle.latestStartTimestamp);
    return candidates;
}

function updateSlowTargets(requiredControlledW, wallboxPlans, heatingPlan, consumptionBudgetW = Infinity) {
    const r = CFG.root;
    const scope = realtimeProductionScope();
    const candidates = selectRealtimeWallboxes(wallboxPlans, scope);
    const selected = candidates[0] || null;
    const selectedWallbox = selected?.wb ?? null;
    const activeVehicle = selected?.vehicle || null;
    const candidateWallboxes = new Set(selected ? [selected.wb] : []);
    [0, 1, 2].forEach(wb => {
        if (candidateWallboxes.has(wb)) return;
        wallboxStartCandidateSince[wb] = 0;
        wallboxRunStartedAt[wb] = 0;
    });
    const dhwReleased = scope.dhw && Boolean(getState(`${r}.Devices.MyPV_DHW.Release`)?.val);
    const dhwCapW = dhwReleased
        ? Math.max(0, Math.min(readNumber(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0),
            scope.production ? readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000) : Infinity)) : 0;
    // Heating/battery outputs are not implemented yet. Keep their forecast in
    // observer mode, but never starve the productive WB/EHZ with phantom loads.
    const heatingCapW = scope.production ? 0 : Math.max(0, Number(heatingPlan.valueW) || 0);
    const wallboxCapW = activeVehicle
        ? Math.min(activeVehicle.maximumPowerW, Math.max(0, consumptionBudgetW)) : 0;
    const wallboxCapacityTotalW = wallboxCapW;
    const recommendedWallboxPhases = wallboxPlans.map(item => Number(item?.phases) >= 3 ? 3 : 1);
    const now = Date.now();
    const nextWallboxPhases = [0, 1, 2].map(wb => stabilizedPhaseTarget(wb,
        vehicleState(wb), recommendedWallboxPhases[wb], now));
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
    const mustHeat = Boolean(getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val);
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

    const nextWallboxW = [0, 0, 0];
    const nextWallboxA = [0, 0, 0];
    const nextWallboxExpectedW = [0, 0, 0];
    let wallboxBudgetW = Math.min(Math.max(0, consumptionBudgetW),
        Math.max(0, pairAvailableW - requestedDhwW));
    let remainingSafetyBudgetW = Math.max(0, consumptionBudgetW);
    if (selected) {
        const candidate = selected;
        const outputBase = `${r}.Devices.Wallbox${candidate.wb}`;
        const productiveOutputOwned = getState(`${outputBase}.OutputOwned`)?.val === true;
        const productiveOutputActive = getState(`${outputBase}.OutputActive`)?.val === true;
        const confirmedA = readNumber(`${outputBase}.OutputCommand_A`, 0);
        const previousA = scope.production
            ? productiveOutputOwned
                ? productiveOutputActive ? Math.max(0, confirmedA) : slowTargets.wallboxA[candidate.wb] || 0
                : 0
            : slowTargets.wallboxA[candidate.wb] || 0;
        let requestedW = Math.min(requestedWallboxW, wallboxBudgetW);
        requestedW = stabilizedWallboxPower(candidate.wb, requestedW, candidate.vehicle,
            previousA, nextWallboxPhases[candidate.wb], now,
            remainingSafetyBudgetW);
        const actualPowerKW = readNumber(CFG.dp.wallboxesKW[candidate.wb], Number.NaN);
        const actualPowerW = Number.isFinite(actualPowerKW) ? Math.max(0, actualPowerKW * 1000) : null;
        const combinedRampA = realtimeParallelActive
            ? Math.max(1, readNumber(`${r}.Config.WallboxCombinedMaxStep_A`, 1)) : null;
        const quantized = quantizeWallbox(requestedW, candidate.vehicle,
            previousA, nextWallboxPhases[candidate.wb], actualPowerW,
            {rampA: combinedRampA, nearestAmp: realtimeParallelActive,
                maximumPowerW: remainingSafetyBudgetW});
        // In combined operation the eHZ must fill the residual against the
        // *measured* wallbox power. A go-e current command can precede the
        // vehicle's real response by several seconds; reserving that expected
        // power caused avoidable export and destroyed the visible 50/50 split.
        let allocationWallboxW = realtimeParallelActive && productiveOutputActive
            && actualPowerW !== null ? actualPowerW : quantized.expectedPowerW;
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
    // The EHZ is the stepless residual controller. It must receive every watt
    // that the selected wallbox cannot use because of its whole-ampere minimum,
    // start delay or current ramp, even below the 50/50 threshold. The stable
    // start timer evaluates the total controllable surplus, so the EHZ can use
    // this energy during the countdown without wasting it as grid export.
    requestedDhwW = Math.min(dhwCapW, Math.max(0, pairAvailableW - assignedWallboxW));
    slowTargets = {
        dhwW: simulateDhwTarget(Math.min(dhwCapW, Math.round(requestedDhwW))),
        heatingW: Math.round(heatingTargetW), wallboxW: nextWallboxW,
        wallboxA: nextWallboxA, wallboxExpectedW: nextWallboxExpectedW, wallboxPhases: nextWallboxPhases,
        wallboxRecommendedPhases: recommendedWallboxPhases
    };
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
    const gridW = readNumber(`${r}.Actual.GridPower_W`, 0);
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

    const actualBatteryW = readNumber(CFG.dp.batteryPower, 0);
    const actualDhwW = readNumber(`${r}.Actual.MyPV_DHW_W`, 0);
    const actualHeatingW = readNumber(`${r}.Actual.MyPV_Heating_W`, 0);
    const actualWallboxW = CFG.dp.wallboxesKW.map(id => Math.max(0, readNumber(id, 0) * 1000));
    const scope = realtimeProductionScope();
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
    const batteryTargetW = batteryPresent ? Math.round(clamp(requiredControlledW - allocatedSlowW,
        soc > minSoc ? -maxDischargeW : 0, soc < maxSoc ? maxChargeW : 0)) : 0;
    const predictedGridW = Math.round(uncontrolledGridW + allocatedSlowW + batteryTargetW);
    const remainingErrorW = predictedGridW - targetGridW;

    write(`${r}.Control.ActualGridPower_W`, Math.round(gridW));
    write(`${r}.Control.PredictedGridPower_W`, predictedGridW);
    write(`${r}.Control.Error_W`, Math.round(errorW));
    write(`${r}.Control.RemainingError_W`, Math.round(remainingErrorW));
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
    write(`${r}.Control.Status`, Math.abs(remainingErrorW) <= deadbandW
        ? `SIMULATION: Batterie 2 s / langsame Verbraucher ${slowCycleMs / 1000} s; NVP-Ziel erreichbar`
        : `SIMULATION: Stellgrenzen erreicht, Restabweichung ${Math.round(remainingErrorW)} W`);
    write(`${r}.Control.LastUpdate`, now);
    if (desiredChangeW === 0) write(`${r}.Control.Status`, `SIMULATION: innerhalb Totband (${Math.round(gridW)} W)`);
}
