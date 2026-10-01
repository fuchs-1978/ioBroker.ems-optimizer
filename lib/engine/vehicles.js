/*
 * Vehicle-Manager fuer drei Wallboxen.
 * Uebernimmt die Semantik der vorhandenen EV-Skripte:
 * socfrei 0 = gesperrt, 1 = PV-flexibel, 2 = unter Mindest-SoC/Pflichtladung.
 * Reiner Beobachter: keine Schreibzugriffe auf konfigurierte Geraeteobjekte.
 */

'use strict';

function vehicleSetting(wb, name, fallback) {
    return nativeConfig[`wb${wb}${name}`] ?? fallback;
}

function vehiclePriceActualState(id) {
    return typeof getActualState === 'function' ? getActualState(id) : getState(id);
}

function vehicleSocSample(wb, now = Date.now()) {
    const state = vehiclePriceActualState(CFG.dp.wallboxSoc[wb]);
    const value = numericValue(state?.val), timestamp = numericValue(state?.ts);
    const valid = value !== null && value >= 0 && value <= 100 && state?.ack === true
        && !state.q && timestamp !== null && timestamp > 0 && timestamp <= now + 1000
        && now - timestamp <= 2 * 60 * 60 * 1000;
    return {valid, value: valid ? value : 0, timestamp: valid ? timestamp : 0};
}

function vehiclePriceSetting(wb, suffix, nativeSuffix, fallback) {
    const state = getState(`${CFG.root}.Config.Wallbox${wb}${suffix}`);
    return state ? state.val : vehicleSetting(wb, nativeSuffix, fallback);
}

// A manually entered no-SoC quota belongs to one observed plug session.
// Integrate unique *measured* AC-power samples, including PV charging. Neither
// a forecast rebuild nor an adapter restart may refill that quota. A long
// unobserved interval invalidates its accounting instead of guessing energy.
function updateVehiclePriceSession(wb, {socValid, gridEnergyKWh, departureTimestamp = 0,
    deadlineEnabled = false, now = Date.now()} = {}) {
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const enabled = vehiclePriceSetting(wb, 'PriceChargingEnabled', 'PriceChargingEnabled', false) === true;
    const manualKWh = numericValue(vehiclePriceSetting(wb, 'PriceEnergy_kWh', 'PriceEnergyKWh', 0));
    const maximumCt = numericValue(vehiclePriceSetting(wb, 'PriceMax_ct_kWh', 'PriceMaxCt', 0));
    const horizonState = getState(`${CFG.root}.Config.PriceChargingHorizon_h`);
    const horizonH = numericValue(horizonState ? horizonState.val : nativeConfig.priceChargingHorizonH ?? 24);
    const present = getState(`${CFG.root}.Devices.Wallbox${wb}.Present`)?.val === true;
    const car = vehiclePriceActualState(CFG.dp.wallboxCar[wb]);
    const carValue = numericValue(car?.val), carTs = numericValue(car?.ts);
    // The car status is retained until it changes; an old timestamp alone is
    // no disconnect. Missing/invalid status must not renew a previous quota.
    const carValid = car?.ack === true && !car.q && [1, 2, 3, 4].includes(carValue)
        && carTs !== null && carTs > 0 && carTs <= now + 1000;
    const connected = carValid && [2, 3, 4].includes(carValue);
    const maxAgeMs = Math.max(5, Math.min(120,
        Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30)) * 1000;
    const maxGapMs = maxAgeMs * 2;
    const sample = vehiclePriceActualState(CFG.dp.wallboxesKW[wb]);
    const rawPower = numericValue(sample?.val), sampleTs = numericValue(sample?.ts);
    const powerValid = sample?.ack === true && !sample.q && rawPower !== null && rawPower >= -0.02
        && sampleTs !== null && sampleTs > 0 && sampleTs <= now + 1000 && now - sampleTs <= maxAgeMs;
    const powerKW = powerValid ? Math.max(0, rawPower) : null;
    const socSample = vehicleSocSample(wb, now);
    socValid = socValid === true && socSample.valid;
    // One persisted record is authoritative; separate diagnostics may be
    // written at different times and are never combined after a restart.
    const ledgerText = getState(`${r}.PriceSessionLedger_JSON`)?.val;
    let ledger = null, ledgerInvalid = false;
    if (ledgerText) {
        try {
            ledger = JSON.parse(ledgerText);
            if (!ledger || ledger.version !== 1) { ledger = null; ledgerInvalid = true; }
        } catch (_) { ledgerInvalid = true; }
    }
    const retained = suffix => ledger ? ledger[suffix] : getState(`${r}.${suffix}`)?.val;
    let sessionId = String(retained('PriceSessionId') || '');
    let startedAt = numericValue(retained('PriceSessionStartedAt')) ?? 0;
    let deadline = numericValue(retained('PriceDeadlineTimestamp')) ?? 0;
    let charged = numericValue(retained('PriceChargedEnergy_kWh')) ?? 0;
    let lastAt = numericValue(retained('PriceLastMeasurementAt')) ?? 0;
    let lastPower = numericValue(retained('PriceLastPower_kW')) ?? 0;
    let trackingValid = retained('PriceEnergyTrackingValid') !== false;
    let sessionConnected = retained('PriceSessionConnected') === true;
    let usesSoC = retained('PriceSessionUsesSoC') === true;
    let socSampleAt = numericValue(retained('PriceSoCSampleAt')) ?? 0;
    let socSamplePct = numericValue(retained('PriceSoCSample_pct')) ?? -1;
    let energyAtSoCSample = numericValue(retained('PriceEnergyAtSoCSample_kWh')) ?? 0;
    let status = '';

    if (carValid && !connected) sessionConnected = false;
    const needsSession = !sessionId || !sessionConnected;
    if (!ledgerInvalid && enabled && present && connected && needsSession && horizonH !== null && horizonH >= 6 && horizonH <= 48
        && (socValid || powerValid)) {
        // A first opt-in on an already plugged vehicle starts one baseline.
        // Subsequent disable/enable cycles keep this same record and deadline.
        startedAt = Math.max(now, startedAt + 1);
        sessionId = `${wb}:${startedAt}`;
        deadline = deadlineEnabled && departureTimestamp > now
            ? departureTimestamp : startedAt + horizonH * 3600000;
        charged = 0;
        lastAt = powerValid ? Math.max(startedAt, sampleTs) : 0;
        lastPower = powerValid ? powerKW : 0;
        trackingValid = powerValid;
        sessionConnected = true;
        usesSoC = false;
        socSampleAt = 0;
        socSamplePct = -1;
        energyAtSoCSample = 0;
    }

    const metadataValid = !ledgerInvalid && Boolean(sessionId) && startedAt > 0 && startedAt <= now + 1000
        && deadline > startedAt && Number.isFinite(charged) && charged >= 0;
    const previousMeasurementAt = lastAt, previousPower = lastPower, previousCharged = charged;
    if (metadataValid && sessionConnected) {
        if (powerValid && sampleTs > lastAt) {
            const elapsedMs = sampleTs - lastAt;
            if (lastAt > 0 && elapsedMs <= maxGapMs && trackingValid) {
                const energy = (lastPower + powerKW) / 2 * elapsedMs / 3600000;
                if (Number.isFinite(energy) && energy >= 0 && Number.isFinite(charged + energy)) charged += energy;
                else trackingValid = false;
            } else trackingValid = false;
            lastAt = sampleTs;
            lastPower = powerKW;
        } else if (lastAt > 0 && now - lastAt > maxGapMs) trackingValid = false;
    }

    if (metadataValid && sessionConnected && socValid) {
        usesSoC = true;
        const newSample = socSample.timestamp > socSampleAt
            || socSample.timestamp === socSampleAt && socSample.value !== socSamplePct;
        if (newSample) {
            if (socSample.timestamp >= lastAt) {
                energyAtSoCSample = charged;
                // A genuinely fresh SoC sample accounts for energy during a
                // prior telemetry gap. It may re-establish a known-SoC ledger.
                if (powerValid) {
                    trackingValid = true;
                    lastAt = Math.max(startedAt, sampleTs);
                    lastPower = powerKW;
                }
            } else if (trackingValid && previousMeasurementAt > 0
                && socSample.timestamp >= previousMeasurementAt && lastAt > previousMeasurementAt) {
                const fraction = (socSample.timestamp - previousMeasurementAt) / (lastAt - previousMeasurementAt);
                const powerAtSoc = previousPower + (lastPower - previousPower) * fraction;
                energyAtSoCSample = previousCharged + (previousPower + powerAtSoc) / 2
                    * (socSample.timestamp - previousMeasurementAt) / 3600000;
            }
            // A late SoC message older than the previous power sample cannot
            // erase already observed charging; retain the conservative reference.
            socSampleAt = socSample.timestamp;
            socSamplePct = socSample.value;
        }
    }

    const remaining = metadataValid && sessionConnected
        ? socValid && Number.isFinite(gridEnergyKWh)
            ? Math.max(0, gridEnergyKWh - Math.max(0, charged - energyAtSoCSample))
            : !usesSoC && manualKWh !== null && manualKWh > 0 ? Math.max(0, manualKWh - charged) : 0
        : 0;
    let valid = enabled && present && connected && metadataValid && sessionConnected && deadline > now
        && horizonH !== null && horizonH >= 6 && horizonH <= 48
        && trackingValid && powerValid
        && (socValid && socSample.timestamp >= socSampleAt || !usesSoC && manualKWh !== null && manualKWh > 0);
    if (!enabled) status = 'Preisladung deaktiviert; bestehende Sitzung bleibt erhalten';
    else if (!present) status = 'Wallbox deaktiviert';
    else if (!carValid) status = 'Fahrzeugstatus fehlt/ungueltig; keine Preisladung';
    else if (!connected) status = 'Fahrzeug abgesteckt; naechster Anschluss startet neue Sitzung';
    else if (horizonH === null || horizonH < 6 || horizonH > 48) status = 'Preis-Ladehorizont ungueltig (6 bis 48 Stunden)';
    else if (!metadataValid) status = !socValid && !powerValid
        ? 'Warte auf frische Leistungsmessung fuer neue Preisladesitzung'
        : 'Preisladesitzung fehlt/ungueltig';
    else if (deadline <= now) status = `Preisladefrist abgelaufen; ${remaining.toFixed(3)} kWh offen`;
    else if (usesSoC && !socValid) status = 'SoC dieser Sitzung fehlt/veraltet; kein Wechsel auf manuelles Energiebudget';
    else if (socValid && socSample.timestamp < socSampleAt) status = 'SoC-Rueckmeldung ist aelter als der bestaetigte Sitzungsstand';
    else if (!socValid && !(manualKWh > 0)) status = 'Kein SoC und kein manuelles AC-Energiebudget';
    else if (!trackingValid) status = usesSoC
        ? 'Energieaufzeichnung hat eine Luecke; warte auf frischen SoC und Leistung'
        : 'Energieaufzeichnung hat eine Luecke; Preisladung bis erneutem Anstecken gesperrt';
    else if (!powerValid) status = 'Leistungsmessung fehlt/veraltet; keine Preisladung';
    else if (remaining <= 0) status = socValid ? 'Ziel-SoC erreicht' : 'Manuelles AC-Energiebudget dieser Sitzung verbraucht';
    else status = `${socValid ? 'SoC-Ziel' : 'Manuelles AC-Budget'}: ${remaining.toFixed(3)} kWh fuer Preisplanung offen`;
    if (maximumCt === null) { valid = false; status = 'Preisgrenze ungueltig'; }
    const nextLedger = {PriceSessionId: sessionId, PriceSessionStartedAt: startedAt,
        PriceChargedEnergy_kWh: charged, PriceRemainingEnergy_kWh: remaining, PriceDeadlineTimestamp: deadline,
        PriceLastMeasurementAt: lastAt, PriceLastPower_kW: lastPower, PriceEnergyTrackingValid: trackingValid,
        PriceSessionUsesSoC: usesSoC, PriceSoCSampleAt: socSampleAt, PriceSoCSample_pct: socSamplePct,
        PriceEnergyAtSoCSample_kWh: energyAtSoCSample,
        PriceSessionConnected: sessionConnected, PriceSessionValid: valid, PriceSessionStatus: status};
    if (!ledgerInvalid || carValid && !connected)
        write(`${r}.PriceSessionLedger_JSON`, JSON.stringify({version: 1, ...nextLedger}));
    for (const [suffix, value] of Object.entries(nextLedger)) write(`${r}.${suffix}`, value);
    return {priceChargingEnabled: enabled, priceSessionId: sessionId, priceSessionValid: Boolean(valid),
        priceRemainingKWh: valid ? remaining : 0, priceDeadlineTimestamp: deadline, priceMaximumCt: maximumCt,
        priceChargedEnergyKWh: charged, priceStatus: status};
}

function vehiclePhaseControl(wb, now = Date.now()) {
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const phaseSwitchEnabled = getState(`${r}.PhaseSwitchEnabled`)?.val === true;
    const phaseControlMode = vehicleSetting(wb, 'PhaseControlMode', 'script');
    const id = String(vehicleSetting(wb, 'PhaseModeId', '')).trim()
        || CFG.dp.wallboxPhaseModes?.[wb];
    const state = id ? getState(id) : null;
    // go-e psm is a retained mode, not a periodically sampled measurement.
    // Its old timestamp is legitimate, but command echoes, bad quality and
    // unknown/automatic modes must never be guessed as one-phase charging.
    const validState = state && state.ack === true && !state.q
        && Number.isFinite(state.ts) && state.ts > 0 && state.ts <= now + 1000;
    const rawMode = validState ? state.val : null;
    const confirmedPhases = rawMode === 1 || rawMode === '1' ? 1
        : rawMode === 2 || rawMode === '2' ? 3 : 0;
    const maximumPhases = readNumber(`${r}.MaximumPhases`, wb === 0 ? 1 : 3);
    const phaseFeedbackValid = confirmedPhases > 0 && confirmedPhases <= maximumPhases;
    const phaseControlValid = !phaseSwitchEnabled || phaseControlMode === 'ems'
        || (phaseControlMode === 'script' && phaseFeedbackValid);
    return {phaseControlMode, confirmedPhases, phaseFeedbackValid, phaseControlValid};
}

function taperCurrentLimit(wb, soc, target, maximumA) {
    if (!vehicleSetting(wb, 'TaperEnabled', false)) return maximumA;
    for (const stage of [1, 2]) {
        const distance = Number(vehicleSetting(wb, `Taper${stage}DeltaPct`, stage === 1 ? 5 : 2));
        const cap = Number(vehicleSetting(wb, `Taper${stage}MaxA`, stage === 1 ? 13 : 8));
        if (Number.isFinite(distance) && distance >= 0 && Number.isFinite(cap) && soc >= target - distance)
            maximumA = Math.min(maximumA, Math.max(0, Math.floor(cap)));
    }
    return maximumA;
}

function manualMinimumCurrent(wb) {
    const id = CFG.dp.wallboxManualMinCurrent[wb];
    if (!id || !existsState(id)) return 0;
    const value = Number(getState(id)?.val);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.max(6, Math.min(32, Math.floor(value)));
}

function lowSocMinimumCurrent(wb, soc, legacyRelease) {
    if (legacyRelease !== 2 || !vehicleSetting(wb, 'LowSocStepsEnabled', true)) return 0;
    const defaults = wb === 0
        ? [[30, 10], [10, 16], [0, 0]]
        : [[50, 10], [30, 16], [10, 25]];
    let result = 0;
    for (let stage = 1; stage <= 3; stage++) {
        const [defaultThreshold, defaultCurrent] = defaults[stage - 1];
        const threshold = Number(vehicleSetting(wb, `LowSoc${stage}ThresholdPct`, defaultThreshold));
        const current = Number(vehicleSetting(wb, `LowSoc${stage}MinA`, defaultCurrent));
        if (Number.isFinite(threshold) && Number.isFinite(current) && current > 0 && soc <= threshold)
            result = Math.max(result, Math.max(6, Math.min(32, Math.floor(current))));
    }
    return result;
}

function appliedMinimumCurrent(baseMinimumA, requestedMinimumA, maximumA) {
    if (maximumA < baseMinimumA) return 0;
    return Math.min(maximumA, Math.max(baseMinimumA, requestedMinimumA));
}

function plannedVehicleAtSoc(vehicle, remainingBatteryKWh, timestamp = Date.now()) {
    const soc = Number.isFinite(remainingBatteryKWh)
        ? Math.max(vehicle.socPct, vehicle.targetSocPct - remainingBatteryKWh / vehicle.capacityKWh * 100)
        : vehicle.socPct;
    const plannedLegacyRelease = soc < vehicle.minimumSocPct ? 2
        : vehicle.legacyRelease === 2 ? 1 : vehicle.legacyRelease;
    const lowSocA = lowSocMinimumCurrent(vehicle.index, soc, plannedLegacyRelease);
    const requestedMinimumA = Math.max(vehicle.manualMinimumCurrentA, lowSocA);
    const maxCurrent1pA = taperCurrentLimit(vehicle.index, soc, vehicle.targetSocPct, vehicle.baseMaxCurrent1pA);
    const maxCurrent3pA = taperCurrentLimit(vehicle.index, soc, vehicle.targetSocPct, vehicle.baseMaxCurrent3pA);
    const belowMinimum = vehicle.socValid && soc < vehicle.minimumSocPct;
    const manualMinimumActive = plannedLegacyRelease > 0 && vehicle.manualMinimumCurrentA > 0;
    const deadlineReached = vehicle.deadlineEnabled && vehicle.departureTimestamp > 0
        && timestamp >= vehicle.latestStartTimestamp;
    return {...vehicle, socPct: soc,
        belowMinimum, mustCharge: belowMinimum || manualMinimumActive || deadlineReached,
        lowSocMinimumCurrentA: lowSocA, requestedMinimumCurrentA: requestedMinimumA,
        maxCurrent1pA, maxCurrent3pA,
        minCurrent1pA: appliedMinimumCurrent(vehicle.baseMinCurrent1pA, requestedMinimumA, maxCurrent1pA),
        minCurrent3pA: appliedMinimumCurrent(vehicle.baseMinCurrent3pA, requestedMinimumA, maxCurrent3pA)};
}

function nextDepartureTimestamp(timeText, now) {
    const text = String(timeText ?? '').trim();
    if (!text) return 0;
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    const hour = match ? Math.max(0, Math.min(23, Number(match[1]))) : 6;
    const minute = match ? Math.max(0, Math.min(59, Number(match[2]))) : 0;
    const departure = new Date(now);
    departure.setHours(hour, minute, 0, 0);
    if (departure.getTime() <= now) departure.setDate(departure.getDate() + 1);
    return departure.getTime();
}

function vehicleState(wb) {
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const present = Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.Present`)?.val);
    const phaseControl = vehiclePhaseControl(wb);
    const baseMinCurrent1pA = readNumber(`${r}.MinCurrent1P_A`, 6);
    const baseMinCurrent3pA = readNumber(`${r}.MinCurrent3P_A`, wb === 0 ? 0 : 6);
    const baseMaxCurrent1pA = readNumber(`${r}.MaxCurrent1P_A`, 32);
    const baseMaxCurrent3pA = readNumber(`${r}.MaxCurrent3P_A`, 16);
    const maximumPowerW = readNumber(`${r}.MaximumPower_W`, 11000);
    const requestedMinimumCurrentA = readNumber(`${r}.RequestedMinimumCurrent_A`, 0);
    const maxCurrent1pA = taperCurrentLimit(wb, readNumber(`${r}.SoC_pct`, 0),
        readNumber(`${r}.TargetSoC_pct`, 100), baseMaxCurrent1pA);
    const maxCurrent3pA = taperCurrentLimit(wb, readNumber(`${r}.SoC_pct`, 0),
        readNumber(`${r}.TargetSoC_pct`, 100), baseMaxCurrent3pA);
    const currentSoc = vehicleSocSample(wb);
    const efficiency = Math.max(0.5, Math.min(1,
        readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const priceSession = updateVehiclePriceSession(wb, {socValid: currentSoc.valid,
        gridEnergyKWh: Math.max(0, (readNumber(`${r}.TargetSoC_pct`, 100) - currentSoc.value) / 100
            * readNumber(`${r}.Capacity_kWh`, 0) / efficiency),
        departureTimestamp: readNumber(`${r}.DepartureTimestamp`, 0),
        deadlineEnabled: Boolean(vehicleSetting(wb, 'DeadlineEnabled', false))});
    return {
        index: wb,
        connected: Boolean(getState(`${r}.Connected`)?.val),
        socValid: Boolean(getState(`${r}.SoCValid`)?.val),
        socPct: readNumber(`${r}.SoC_pct`, 0),
        minimumSocPct: readNumber(`${r}.MinimumSoC_pct`, 0),
        targetSocPct: readNumber(`${r}.TargetSoC_pct`, 100),
        release: present && phaseControl.phaseControlValid && Boolean(getState(`${r}.Release`)?.val)
            && !(currentSoc.valid && priceSession.priceChargingEnabled && priceSession.priceSessionValid
                && priceSession.priceRemainingKWh <= 0)
            && (Boolean(getState(`${r}.SoCValid`)?.val)
                || getState(`${CFG.root}.Config.WallboxPlanWithoutSoC`)?.val === true
                || priceSession.priceSessionValid && priceSession.priceRemainingKWh > 0),
        mustCharge: Boolean(getState(`${r}.MustCharge`)?.val),
        belowMinimum: Boolean(getState(`${r}.BelowMinimum`)?.val),
        deadlineEnabled: Boolean(vehicleSetting(wb, 'DeadlineEnabled', false)),
        capacityKWh: readNumber(`${r}.Capacity_kWh`, 0),
        energyRequiredKWh: readNumber(`${r}.EnergyRequired_kWh`, 0),
        gridEnergyRequiredKWh: readNumber(`${r}.GridEnergyRequired_kWh`, 0),
        minimumPowerW: readNumber(`${r}.MinimumPower_W`, 1380),
        maximumPowerW,
        departureTimestamp: readNumber(`${r}.DepartureTimestamp`, 0),
        latestStartTimestamp: readNumber(`${r}.LatestStartTimestamp`, 0),
        priority: readNumber(`${r}.Priority`, 0),
        detectedPhases: readNumber(`${r}.DetectedPhases`, 1),
        selectedPriority: Boolean(getState(`${r}.SelectedPriority`)?.val),
        effectivePriorityScore: readNumber(`${r}.EffectivePriorityScore`, 0),
        maximumPhases: readNumber(`${r}.MaximumPhases`, wb === 0 ? 1 : 3),
        phaseSwitchEnabled: Boolean(getState(`${r}.PhaseSwitchEnabled`)?.val),
        ...priceSession,
        ...phaseControl,
        baseMinCurrent1pA, baseMaxCurrent1pA, maxCurrent1pA,
        minCurrent1pA: appliedMinimumCurrent(baseMinCurrent1pA, requestedMinimumCurrentA,
            Math.min(maxCurrent1pA, Math.floor(maximumPowerW / 230))),
        baseMinCurrent3pA, baseMaxCurrent3pA, maxCurrent3pA,
        minCurrent3pA: appliedMinimumCurrent(baseMinCurrent3pA, requestedMinimumCurrentA,
            Math.min(maxCurrent3pA, Math.floor(maximumPowerW / (230 * 3)))),
        manualMinimumCurrentA: readNumber(`${r}.ManualMinimumCurrent_A`, 0),
        lowSocMinimumCurrentA: readNumber(`${r}.LowSocMinimumCurrent_A`, 0),
        requestedMinimumCurrentA,
        legacyRelease: readNumber(`${r}.LegacySoCRelease`, 0),
        status: String(getState(`${r}.Status`)?.val || '')
    };
}

function updateVehicles() {
    const now = Date.now();
    const planWithoutSoc = Boolean(getState(`${CFG.root}.Config.WallboxPlanWithoutSoC`)?.val);
    const efficiency = Math.max(0.5, Math.min(1,
        readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const configuredPriority = Number(nativeConfig.wallboxPriority ?? -2);
    const prioritySource = String(nativeConfig.wallboxPrioritySource || 'auto');
    const useExternalPriority = prioritySource === 'external'
        || (prioritySource === 'auto' && configuredPriority === -2);
    const selectedPriorityIndex = useExternalPriority
        ? Math.round(readNumber(CFG.dp.wallboxPriority, -1)) : configuredPriority;
    write(`${CFG.root}.Control.WallboxPrioritySource`, useExternalPriority
        ? `extern: ${CFG.dp.wallboxPriority || 'nicht konfiguriert'}` : 'intern');
    const legacyBasePriority = [0.02, 0.01, 0.03];

    for (let wb = 0; wb < 3; wb++) {
        const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
        const configuredPresent = Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.Present`)?.val);
        const carState = readNumber(CFG.dp.wallboxCar[wb], 1);
        const connected = configuredPresent && [2, 3, 4].includes(carState);
        const socSample = vehicleSocSample(wb, now);
        const socValid = socSample.valid;
        const soc = socSample.value;
        const adminSoc = vehicleSetting(wb, 'SocLimitsSource', 'external') === 'admin';
        const minimumSoc = Math.max(0, Math.min(100, adminSoc
            ? Number(vehicleSetting(wb, 'MinSocPct', 20)) : readNumber(CFG.dp.wallboxMinSoc[wb], 0)));
        const targetSoc = Math.max(minimumSoc,
            Math.min(100, adminSoc ? Number(vehicleSetting(wb, 'TargetSocPct', 80))
                : readNumber(CFG.dp.wallboxSocTarget[wb], 100)));
        const belowMinimum = socValid && soc < minimumSoc;
        const legacyRelease = Math.max(0, Math.min(2,
            Math.round(readNumber(CFG.dp.wallboxSocRelease[wb], 0))));
        const userRelease = Boolean(readNumber(CFG.dp.wallboxAllow[wb], 1));
        const capacity = Math.max(0.1,
            readNumber(`${CFG.root}.Config.Wallbox${wb}VehicleCapacity_kWh`, 50));
        const maximumPower = Math.max(0,
            readNumber(`${CFG.root}.Config.Wallbox${wb}MaxPower_W`, 11000));
        const phaseControl = vehiclePhaseControl(wb, now);
        const scriptPhases = getState(`${r}.PhaseSwitchEnabled`)?.val === true
            && phaseControl.phaseControlMode === 'script' && phaseControl.phaseFeedbackValid
            ? phaseControl.confirmedPhases : 0;
        const measuredPhaseCount = CFG.dp.wallboxPhaseCurrents[wb]
            .map(id => readNumber(id, 0))
            .filter(currentA => currentA > 5).length;
        const detectedPhases = measuredPhaseCount > 0 ? measuredPhaseCount
            : Math.max(1, Math.min(3, Math.round(readNumber(CFG.dp.wallboxPhases[wb], 1))));
        const phases = scriptPhases || detectedPhases;
        const manualMinimumA = manualMinimumCurrent(wb);
        // Legacy scripts may be stopped during EMS production. Their retained
        // socfrei=2 must not force grid charging all the way to target SoC.
        // The live, configured minimum is authoritative for low-SoC stages.
        const lowSocMinimumA = lowSocMinimumCurrent(wb, soc, belowMinimum ? 2 : 1);
        const requestedMinimumA = Math.max(manualMinimumA, lowSocMinimumA);
        const baseMinimumA = readNumber(`${r}.${phases === 3 ? 'MinCurrent3P_A' : 'MinCurrent1P_A'}`, 6);
        const configuredMaximumA = readNumber(`${r}.${phases === 3 ? 'MaxCurrent3P_A' : 'MaxCurrent1P_A'}`, 16);
        const taperedMaximumA = taperCurrentLimit(wb, soc, targetSoc, configuredMaximumA);
        const safeMaximumA = Math.max(0, Math.min(taperedMaximumA,
            Math.floor(maximumPower / (230 * phases))));
        const effectiveMinimumA = appliedMinimumCurrent(baseMinimumA, requestedMinimumA, safeMaximumA);
        const minimumPower = effectiveMinimumA > 0 ? Math.max(
            readNumber(`${r}.DefaultMinimumPower_W`, 1380), effectiveMinimumA * 230 * phases) : 0;
        const missingBatteryKWh = socValid
            ? Math.max(0, (targetSoc - soc) / 100 * capacity)
            : 0;
        const gridEnergyKWh = missingBatteryKWh / efficiency;
        const departureTimestamp = nextDepartureTimestamp(
            getState(`${r}.DepartureTime`)?.val, now);
        const chargingDurationMs = maximumPower > 0
            ? gridEnergyKWh / (maximumPower / 1000) * 60 * 60 * 1000
            : 0;
        const latestStartTimestamp = departureTimestamp > 0
            ? departureTimestamp - chargingDurationMs : 0;
        const deadlineReached = departureTimestamp > 0
            && Boolean(vehicleSetting(wb, 'DeadlineEnabled', false))
            && missingBatteryKWh > 0 && now >= latestStartTimestamp;
        const socTargetReached = socValid && soc >= targetSoc;
        const priceSession = updateVehiclePriceSession(wb, {socValid, gridEnergyKWh, departureTimestamp,
            deadlineEnabled: Boolean(vehicleSetting(wb, 'DeadlineEnabled', false)), now});
        const manualPriceEligible = priceSession.priceSessionValid && priceSession.priceRemainingKWh > 0;
        const energyTargetReached = socValid && priceSession.priceChargingEnabled && priceSession.priceSessionValid
            && priceSession.priceRemainingKWh <= 0;
        const targetReached = socTargetReached || energyTargetReached;
        // socfrei wird zur Vergleichbarkeit gespiegelt. Die EMS-Entscheidung
        // wird aber aus den gemappten SoC-/Min-/Max-Werten neu gebildet, weil
        // das alte Skript Wallbox 0/2 noch teilweise anderen Fahrzeugen zuordnet.
        const manualMinimumActive = legacyRelease > 0 && manualMinimumA > 0;
        const mustCharge = configuredPresent && connected && userRelease && !targetReached
            && phaseControl.phaseControlValid
            && (belowMinimum || deadlineReached || manualMinimumActive);
        const release = configuredPresent && connected && userRelease && !targetReached
            && phaseControl.phaseControlValid
            && (socValid || planWithoutSoc || manualPriceEligible);
        const selectedPriority = selectedPriorityIndex === wb;
        // Exakte Bewertungslogik aus dem aktiven PV_Ueberschuss_Verteilung:
        // Grundwert + socfrei==2 + manuelle prio - Sperren/kein Auto/socfrei==0.
        let effectivePriorityScore = legacyBasePriority[wb];
        if (belowMinimum) effectivePriorityScore += 10;
        else if (mustCharge) effectivePriorityScore += 2;
        if (selectedPriority) effectivePriorityScore += 1;
        if (!userRelease) effectivePriorityScore -= 5;
        if (!connected) effectivePriorityScore -= 5;

        let status;
        if (!configuredPresent) status = 'Wallbox in Adapterkonfiguration deaktiviert';
        else if (!connected) status = 'Kein Fahrzeug angeschlossen';
        else if (!userRelease) status = 'Wallbox durch alw-Freigabe gesperrt';
        else if (!phaseControl.phaseControlValid) status = phaseControl.phaseControlMode === 'script'
            ? 'Skript-Phasensteuerung: bestaetigter go-e-Phasenmodus fehlt oder ist ungueltig'
            : 'Phasensteuerungsmodus ungueltig';
        else if (!socValid && !planWithoutSoc && !manualPriceEligible) status = 'SoC fehlt oder ist aelter als 2 Stunden';
        else if (socTargetReached) status = `Ziel-SoC erreicht (${soc} >= ${targetSoc} %)`;
        else if (energyTargetReached) status = 'Gemessene Ladeenergie deckt den Zielbedarf; warte auf naechsten SoC-Wert';
        else if (mustCharge && belowMinimum)
            status = `Pflichtladung: unter Mindest-SoC; mindestens ${effectiveMinimumA} A`;
        else if (manualMinimumActive) status = `Manueller Mindeststrom aktiv: ${effectiveMinimumA} A`;
        else if (mustCharge) status = 'Pflichtladung: spaetester sicherer Ladebeginn erreicht';
        else if (manualPriceEligible && !socValid && !planWithoutSoc) status = priceSession.priceStatus;
        else if (release) status = `PV-flexibel: ${missingBatteryKWh.toFixed(1)} kWh fehlen bis ${targetSoc} %`;
        else status = 'Keine EMS-Ladefreigabe';

        write(`${r}.Connected`, connected);
        write(`${r}.CarState`, carState);
        write(`${r}.SoC_pct`, Math.round(soc * 10) / 10);
        write(`${r}.SoCValid`, socValid);
        write(`${r}.SoCSource`, CFG.dp.wallboxSoc[wb]);
        write(`${r}.MinimumSoC_pct`, minimumSoc);
        write(`${r}.TargetSoC_pct`, targetSoc);
        write(`${r}.LegacySoCRelease`, legacyRelease);
        write(`${r}.UserRelease`, userRelease);
        write(`${r}.Release`, release);
        write(`${r}.MustCharge`, mustCharge);
        write(`${r}.BelowMinimum`, belowMinimum);
        write(`${r}.SocLimitsSource`, adminSoc ? 'admin' : 'external');
        write(`${r}.TaperCurrentLimit_A`, taperCurrentLimit(wb, soc, targetSoc, 32));
        write(`${r}.ManualMinimumCurrent_A`, manualMinimumA);
        write(`${r}.LowSocMinimumCurrent_A`, lowSocMinimumA);
        write(`${r}.RequestedMinimumCurrent_A`, requestedMinimumA);
        write(`${r}.CurrentConstraintStatus`, requestedMinimumA > safeMaximumA
            ? `Anforderung ${requestedMinimumA} A durch Fahrzeug-/Phasen-/Sicherheitsgrenze auf ${safeMaximumA} A begrenzt`
            : `Basis ${baseMinimumA} A; manuell ${manualMinimumA} A; niedriger SoC ${lowSocMinimumA} A; wirksam ${effectiveMinimumA} A`);
        write(`${r}.Capacity_kWh`, capacity);
        write(`${r}.EnergyRequired_kWh`, Math.round(missingBatteryKWh * 100) / 100);
        write(`${r}.GridEnergyRequired_kWh`, Math.round(gridEnergyKWh * 100) / 100);
        write(`${r}.MinimumPower_W`, Math.round(minimumPower));
        write(`${r}.DetectedPhases`, detectedPhases);
        write(`${r}.SelectedPriority`, selectedPriority);
        write(`${r}.EffectivePriorityScore`, Math.round(effectivePriorityScore * 100) / 100);
        write(`${r}.MaximumPower_W`, Math.round(maximumPower));
        write(`${r}.DepartureTimestamp`, departureTimestamp);
        write(`${r}.LatestStartTimestamp`, Math.round(latestStartTimestamp));
        write(`${r}.HoursRemaining`, departureTimestamp > 0
            ? Math.round((departureTimestamp - now) / 36000) / 100 : 0);
        write(`${r}.Status`, status);
    }
}
