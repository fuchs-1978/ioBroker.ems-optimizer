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

function plannedVehicleAtSoc(vehicle, remainingBatteryKWh) {
    const soc = Number.isFinite(remainingBatteryKWh)
        ? Math.max(vehicle.socPct, vehicle.targetSocPct - remainingBatteryKWh / vehicle.capacityKWh * 100)
        : vehicle.socPct;
    const plannedLegacyRelease = vehicle.legacyRelease === 2 && soc >= vehicle.minimumSocPct
        ? 1 : vehicle.legacyRelease;
    const lowSocA = lowSocMinimumCurrent(vehicle.index, soc, plannedLegacyRelease);
    const requestedMinimumA = Math.max(vehicle.manualMinimumCurrentA, lowSocA);
    const maxCurrent1pA = taperCurrentLimit(vehicle.index, soc, vehicle.targetSocPct, vehicle.baseMaxCurrent1pA);
    const maxCurrent3pA = taperCurrentLimit(vehicle.index, soc, vehicle.targetSocPct, vehicle.baseMaxCurrent3pA);
    const belowMinimum = vehicle.socValid && soc < vehicle.minimumSocPct;
    const manualMinimumActive = plannedLegacyRelease > 0 && vehicle.manualMinimumCurrentA > 0;
    const deadlineReached = vehicle.deadlineEnabled && vehicle.departureTimestamp > 0
        && Date.now() >= vehicle.latestStartTimestamp;
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
    return {
        index: wb,
        connected: Boolean(getState(`${r}.Connected`)?.val),
        socValid: Boolean(getState(`${r}.SoCValid`)?.val),
        socPct: readNumber(`${r}.SoC_pct`, 0),
        minimumSocPct: readNumber(`${r}.MinimumSoC_pct`, 0),
        targetSocPct: readNumber(`${r}.TargetSoC_pct`, 100),
        release: present && Boolean(getState(`${r}.Release`)?.val),
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
        const socState = existsState(CFG.dp.wallboxSoc[wb]) ? getState(CFG.dp.wallboxSoc[wb]) : null;
        const socNumber = Number(socState?.val);
        const socValid = socState?.val !== null && socState?.val !== '' && socState?.val !== undefined
            && Number.isFinite(socNumber) && socNumber >= 0 && socNumber <= 100
            && now - Number(socState?.ts || 0) <= 2 * 60 * 60 * 1000;
        const soc = socValid ? socNumber : 0;
        const adminSoc = vehicleSetting(wb, 'SocLimitsSource', 'external') === 'admin';
        const minimumSoc = Math.max(0, Math.min(100, adminSoc
            ? Number(vehicleSetting(wb, 'MinSocPct', 20)) : readNumber(CFG.dp.wallboxMinSoc[wb], 0)));
        const targetSoc = Math.max(minimumSoc,
            Math.min(100, adminSoc ? Number(vehicleSetting(wb, 'TargetSocPct', 80))
                : readNumber(CFG.dp.wallboxSocTarget[wb], 100)));
        const legacyRelease = Math.max(0, Math.min(2,
            Math.round(readNumber(CFG.dp.wallboxSocRelease[wb], 0))));
        const userRelease = Boolean(readNumber(CFG.dp.wallboxAllow[wb], 1));
        const capacity = Math.max(0.1,
            readNumber(`${CFG.root}.Config.Wallbox${wb}VehicleCapacity_kWh`, 50));
        const maximumPower = Math.max(0,
            readNumber(`${CFG.root}.Config.Wallbox${wb}MaxPower_W`, 11000));
        const measuredPhaseCount = CFG.dp.wallboxPhaseCurrents[wb]
            .map(id => readNumber(id, 0))
            .filter(currentA => currentA > 5).length;
        const phases = measuredPhaseCount > 0 ? measuredPhaseCount
            : Math.max(1, Math.min(3, Math.round(readNumber(CFG.dp.wallboxPhases[wb], 1))));
        const manualMinimumA = manualMinimumCurrent(wb);
        const lowSocMinimumA = lowSocMinimumCurrent(wb, soc, legacyRelease);
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
        const belowMinimum = socValid && soc < minimumSoc;
        const deadlineReached = departureTimestamp > 0
            && Boolean(vehicleSetting(wb, 'DeadlineEnabled', false))
            && missingBatteryKWh > 0 && now >= latestStartTimestamp;
        const targetReached = socValid && soc >= targetSoc;
        // socfrei wird zur Vergleichbarkeit gespiegelt. Die EMS-Entscheidung
        // wird aber aus den gemappten SoC-/Min-/Max-Werten neu gebildet, weil
        // das alte Skript Wallbox 0/2 noch teilweise anderen Fahrzeugen zuordnet.
        const manualMinimumActive = legacyRelease > 0 && manualMinimumA > 0;
        const mustCharge = configuredPresent && connected && userRelease && !targetReached
            && (belowMinimum || legacyRelease === 2 || deadlineReached || manualMinimumActive);
        const release = configuredPresent && connected && userRelease && !targetReached
            && (socValid || planWithoutSoc);
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
        else if (!socValid && !planWithoutSoc) status = 'SoC fehlt oder ist aelter als 2 Stunden';
        else if (targetReached) status = `Ziel-SoC erreicht (${soc} >= ${targetSoc} %)`;
        else if (mustCharge && (belowMinimum || legacyRelease === 2))
            status = `Pflichtladung: unter Mindest-SoC; mindestens ${effectiveMinimumA} A`;
        else if (manualMinimumActive) status = `Manueller Mindeststrom aktiv: ${effectiveMinimumA} A`;
        else if (mustCharge) status = 'Pflichtladung: spaetester sicherer Ladebeginn erreicht';
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
        write(`${r}.DetectedPhases`, phases);
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
