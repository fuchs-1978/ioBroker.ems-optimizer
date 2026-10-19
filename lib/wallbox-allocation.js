'use strict';

// Stateless allocation arithmetic. Callers supply settings lazily so branch-specific
// reads, rounding and diagnostic construction remain in their original order.
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

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
    options = {}, {readSetting, pvImportAdmissionW}) {
    const phases = requestedPhases >= 3 && vehicle.phaseSwitchEnabled
        && vehicle.maximumPhases >= 3 ? 3 : 1;
    const voltage = Math.max(200, readSetting('Config.WallboxNominalVoltage_V', 230));
    const vehicleMaximumA = phases === 3 ? vehicle.maxCurrent3pA : vehicle.maxCurrent1pA;
    const minimumA = phases === 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
    const maximumPowerW = Math.min(vehicle.maximumPowerW, options.maximumPowerW ?? Infinity);
    let maximumA = Math.min(vehicleMaximumA,
        Math.floor(maximumPowerW / (voltage * phases)));
    const nominalMaximumA = maximumA;
    const diagnostics = {requestedW, previousA, actualPowerW, phases, voltage,
        minimumA, maximumA, responseBasis: 'nominal', deltaW: null, deltaA: null,
        requestedA: 0, targetA: 0, reason: ''};
    if (maximumA < minimumA || requestedW <= 0)
        return {amps: 0, powerW: 0, expectedPowerW: 0, phases,
            diagnostics: {...diagnostics, reason: maximumA < minimumA
                ? 'limit-below-minimum' : 'no-budget'}};
    const rampA = Math.max(1, Math.round(Number(options.rampA)
        || readSetting('Config.WallboxMaxStep_A', 6)));
    diagnostics.rampA = rampA;
    const unitPowerW = voltage * phases;
    const measuredPowerW = Number(actualPowerW);
    const useActualResponse = previousA > 0 && Number.isFinite(measuredPowerW)
        && measuredPowerW >= minimumA * unitPowerW * 0.5;
    // Holding an already electrically confirmed current is not a new
    // admission. Only the soft PV ceiling may use the measured response;
    // physical/operator/peer ceilings still reserve full nominal watts.
    const pvStepToleranceW = Math.max(0, Math.min(200, Number(options.pvStepToleranceW) || 0));
    const measuredHold = options.holdMeasuredCurrent === true && useActualResponse
        && previousA >= minimumA && previousA <= nominalMaximumA + 1 && previousA <= vehicleMaximumA
        && previousA * unitPowerW <= options.holdMaximumPowerW
        && measuredPowerW <= requestedW + pvStepToleranceW;
    const pvStepAdmissionW = pvImportAdmissionW(pvStepToleranceW);
    const measuredNextA = previousA + 1;
    const measuredStep = measuredHold && pvStepToleranceW > 0
        && measuredNextA <= nominalMaximumA + 1 && measuredNextA <= vehicleMaximumA
        && measuredNextA * unitPowerW <= options.holdMaximumPowerW
        && measuredPowerW + unitPowerW <= requestedW + pvStepAdmissionW
        && measuredPowerW + unitPowerW <= (options.pvStepMaximumPowerW ?? requestedW) + pvStepAdmissionW;
    if (measuredHold) maximumA = Math.max(maximumA, measuredStep ? measuredNextA : previousA);
    Object.assign(diagnostics, {maximumA, nominalMaximumA, measuredCurrentHeld: false});
    let requestedA;
    if (useActualResponse) {
        const deltaW = requestedW - measuredPowerW;
        const deadbandW = Math.max(0, readSetting('Control.Deadband_W', 100));
        // A sub-amp deficit must still reduce current once it exceeds the
        // permitted noise band. Choose the smallest whole-amp reduction that
        // returns the expected response inside that band; rounding toward zero
        // would leave a persistent import below one ampere's power unchanged.
        const deltaA = deltaW >= 0 ? Math.floor((deltaW + (measuredStep ? pvStepAdmissionW : 0)) / unitPowerW)
            : deltaW < -deadbandW ? Math.floor((deltaW + deadbandW) / unitPowerW) : 0;
        requestedA = previousA + deltaA;
        Object.assign(diagnostics, {responseBasis: 'power-response', deltaW, deltaA, deadbandW});
    } else requestedA = options.nearestAmp === true
        ? Math.round(Math.max(0, requestedW) / unitPowerW)
        : Math.floor(Math.max(0, requestedW) / unitPowerW);
    diagnostics.requestedA = requestedA;
    if (requestedA < minimumA) requestedA = options.preserveMinimum === true ? minimumA : 0;
    requestedA = Math.min(maximumA, requestedA);
    let targetA = Math.min(requestedA, previousA + rampA);
    if (targetA > 0 && targetA < minimumA) targetA = requestedA >= minimumA ? minimumA : 0;
    if (measuredHold && measuredPowerW <= requestedW + pvStepToleranceW && targetA < previousA)
        targetA = Math.min(previousA, maximumA);
    const powerW = Math.round(targetA * unitPowerW);
    const expectedPowerW = useActualResponse
        ? Math.max(0, Math.round(measuredPowerW + (targetA - previousA) * unitPowerW)) : powerW;
    diagnostics.targetA = targetA;
    diagnostics.pvStepToleranceW = pvStepToleranceW;
    diagnostics.pvStepAdmissionW = pvStepAdmissionW;
    diagnostics.measuredPVStep = measuredStep && targetA === measuredNextA;
    diagnostics.measuredCurrentHeld = measuredHold && targetA === previousA && targetA > nominalMaximumA;
    diagnostics.reason = targetA === 0 ? 'quantized-below-minimum'
        : diagnostics.measuredPVStep ? 'measured-pv-step'
            : diagnostics.measuredCurrentHeld ? 'measured-current-held'
            : diagnostics.requestedA > maximumA ? 'current-limit'
                : targetA < requestedA ? 'ramp-limit' : 'budget';
    return {amps: targetA, powerW, expectedPowerW, phases, diagnostics};
}

// An idle peer's delayed polling is not reclaimable load. Its last genuine
// OFF/zero samples may isolate it while fresh NVP/phase guards protect peers.
// Never manufacture zero from missing/bad evidence or release a pending load.
function isolatedIdleTelemetry({now, maximumAgeMs, allow, power, currents, busy}) {
    const valid = state => state?.ack === true && !state.q
        && Number.isFinite(state.val) && Number.isFinite(state.ts)
        && state.ts > 0 && state.ts <= now + 1000;
    if (busy || !valid(allow) || allow.val !== 0 || !valid(power)
        || power.val < -0.02 || power.val > 0.02
        || currents.length !== 3 || currents.some(s => !valid(s) || s.val < 0 || s.val > 0.5)) return false;
    const offAt = Number.isFinite(allow.lc) ? allow.lc : allow.ts;
    if ([power, ...currents].some(s => s.ts < offAt)) return false;
    return [allow, power, ...currents].some(s => now - s.ts > maximumAgeMs);
}

// Runtime migration also covers installed configurations retaining 180 s.
function restartHandoffTimeoutMs(seconds) {
    const value = Number(seconds ?? 900);
    return Math.max(900, Math.min(3600, Number.isFinite(value) ? value : 900)) * 1000;
}

module.exports = {splitRealtimePair, quantizeWallbox, isolatedIdleTelemetry, restartHandoffTimeoutMs};
