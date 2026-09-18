/*
 * Vehicle-Manager fuer drei Wallboxen.
 * Uebernimmt die Semantik der vorhandenen EV-Skripte:
 * socfrei 0 = gesperrt, 1 = PV-flexibel, 2 = unter Mindest-SoC/Pflichtladung.
 * Reiner Beobachter: keine Schreibzugriffe auf konfigurierte Geraeteobjekte.
 */

'use strict';

function nextDepartureTimestamp(timeText, now) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeText || ''));
    const hour = match ? Math.max(0, Math.min(23, Number(match[1]))) : 6;
    const minute = match ? Math.max(0, Math.min(59, Number(match[2]))) : 0;
    const departure = new Date(now);
    departure.setHours(hour, minute, 0, 0);
    if (departure.getTime() <= now) departure.setDate(departure.getDate() + 1);
    return departure.getTime();
}

function vehicleState(wb) {
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    return {
        index: wb,
        connected: Boolean(getState(`${r}.Connected`)?.val),
        socValid: Boolean(getState(`${r}.SoCValid`)?.val),
        socPct: readNumber(`${r}.SoC_pct`, 0),
        minimumSocPct: readNumber(`${r}.MinimumSoC_pct`, 0),
        targetSocPct: readNumber(`${r}.TargetSoC_pct`, 100),
        release: Boolean(getState(`${r}.Release`)?.val),
        mustCharge: Boolean(getState(`${r}.MustCharge`)?.val),
        capacityKWh: readNumber(`${r}.Capacity_kWh`, 0),
        energyRequiredKWh: readNumber(`${r}.EnergyRequired_kWh`, 0),
        gridEnergyRequiredKWh: readNumber(`${r}.GridEnergyRequired_kWh`, 0),
        minimumPowerW: readNumber(`${r}.MinimumPower_W`, 1380),
        maximumPowerW: readNumber(`${r}.MaximumPower_W`, 11000),
        departureTimestamp: readNumber(`${r}.DepartureTimestamp`, 0),
        latestStartTimestamp: readNumber(`${r}.LatestStartTimestamp`, 0),
        priority: readNumber(`${r}.Priority`, 0),
        detectedPhases: readNumber(`${r}.DetectedPhases`, 1),
        selectedPriority: Boolean(getState(`${r}.SelectedPriority`)?.val),
        effectivePriorityScore: readNumber(`${r}.EffectivePriorityScore`, 0),
        maximumPhases: readNumber(`${r}.MaximumPhases`, wb === 0 ? 1 : 3),
        phaseSwitchEnabled: Boolean(getState(`${r}.PhaseSwitchEnabled`)?.val),
        minCurrent1pA: readNumber(`${r}.MinCurrent1P_A`, 6),
        maxCurrent1pA: readNumber(`${r}.MaxCurrent1P_A`, 32),
        minCurrent3pA: readNumber(`${r}.MinCurrent3P_A`, wb === 0 ? 0 : 6),
        maxCurrent3pA: readNumber(`${r}.MaxCurrent3P_A`, wb === 0 ? 0 : 16),
        status: String(getState(`${r}.Status`)?.val || '')
    };
}

function updateVehicles() {
    const now = Date.now();
    const planWithoutSoc = Boolean(getState(`${CFG.root}.Config.WallboxPlanWithoutSoC`)?.val);
    const efficiency = Math.max(0.5, Math.min(1,
        readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const selectedPriorityIndex = Math.round(readNumber(CFG.dp.wallboxPriority, -1));
    const legacyBasePriority = [0.02, 0.01, 0.03];

    for (let wb = 0; wb < 3; wb++) {
        const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
        const carState = readNumber(CFG.dp.wallboxCar[wb], 1);
        const connected = [2, 3, 4].includes(carState);
        const socState = existsState(CFG.dp.wallboxSoc[wb]) ? getState(CFG.dp.wallboxSoc[wb]) : null;
        const socNumber = Number(socState?.val);
        const socValid = Number.isFinite(socNumber) && socNumber >= 0 && socNumber <= 100
            && now - Number(socState?.ts || 0) <= 2 * 60 * 60 * 1000;
        const soc = socValid ? socNumber : 0;
        const minimumSoc = Math.max(0, Math.min(100, readNumber(CFG.dp.wallboxMinSoc[wb], 0)));
        const targetSoc = Math.max(minimumSoc,
            Math.min(100, readNumber(CFG.dp.wallboxSocTarget[wb], 100)));
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
        const minimumPower = Math.max(1380,
            readNumber(`${r}.DefaultMinimumPower_W`, 1380), 6 * 230 * phases);
        const missingBatteryKWh = socValid
            ? Math.max(0, (targetSoc - soc) / 100 * capacity)
            : 0;
        const gridEnergyKWh = missingBatteryKWh / efficiency;
        const departureTimestamp = nextDepartureTimestamp(
            getState(`${r}.DepartureTime`)?.val, now);
        const chargingDurationMs = maximumPower > 0
            ? gridEnergyKWh / (maximumPower / 1000) * 60 * 60 * 1000
            : 0;
        const latestStartTimestamp = departureTimestamp - chargingDurationMs;
        const belowMinimum = socValid && soc < minimumSoc;
        const deadlineReached = missingBatteryKWh > 0 && now >= latestStartTimestamp;
        const targetReached = socValid && soc >= targetSoc;
        // socfrei wird zur Vergleichbarkeit gespiegelt. Die EMS-Entscheidung
        // wird aber aus den gemappten SoC-/Min-/Max-Werten neu gebildet, weil
        // das alte Skript Wallbox 0/2 noch teilweise anderen Fahrzeugen zuordnet.
        const mustCharge = connected && userRelease && !targetReached
            && (belowMinimum || deadlineReached);
        const release = connected && userRelease && !targetReached
            && (socValid || planWithoutSoc);
        const selectedPriority = selectedPriorityIndex === wb;
        // Exakte Bewertungslogik aus dem aktiven PV_Ueberschuss_Verteilung:
        // Grundwert + socfrei==2 + manuelle prio - Sperren/kein Auto/socfrei==0.
        let effectivePriorityScore = legacyBasePriority[wb];
        if (legacyRelease === 2) effectivePriorityScore += 2;
        if (selectedPriority) effectivePriorityScore += 1;
        if (!userRelease) effectivePriorityScore -= 5;
        if (!connected) effectivePriorityScore -= 5;
        if (legacyRelease === 0) effectivePriorityScore -= 3;

        let status;
        if (!connected) status = 'Kein Fahrzeug angeschlossen';
        else if (!userRelease) status = 'Wallbox durch alw-Freigabe gesperrt';
        else if (!socValid && !planWithoutSoc) status = 'SoC fehlt oder ist aelter als 2 Stunden';
        else if (targetReached) status = `Ziel-SoC erreicht (${soc} >= ${targetSoc} %)`;
        else if (mustCharge && belowMinimum) status = `Pflichtladung: unter Mindest-SoC (${soc} < ${minimumSoc} %)`;
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
        write(`${r}.HoursRemaining`, Math.round((departureTimestamp - now) / 36000) / 100);
        write(`${r}.Status`, status);
    }
}
