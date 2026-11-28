/*
 * Vehicle-Manager fuer drei Wallboxen.
 * Ladeentscheidungen verwenden ausschliesslich den qualifizierten EMS-SoC.
 * Externes socfrei bleibt ein optionaler Vergleichswert ohne Steuerwirkung.
 * Reiner Beobachter: keine Schreibzugriffe auf konfigurierte Geraeteobjekte.
 */

'use strict';

function vehicleSetting(wb, name, fallback) {
    return nativeConfig[`wb${wb}${name}`] ?? fallback;
}

function vehiclePriceActualState(id) {
    return typeof getActualState === 'function' ? getActualState(id) : getState(id);
}

function vehicleReportedSocSample(wb, now = Date.now()) {
    const state = vehiclePriceActualState(CFG.dp.wallboxSoc[wb]);
    return vehicleSocEstimator.reportedSocSample(state, now);
}

function vehicleSocSample(wb, now = Date.now()) {
    // Callers may carry the start time of a cycle which has since refreshed
    // another SoC ledger. Always evaluate current cache contents at current time.
    now = Math.max(now, Date.now());
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const capacityKWh = Number(vehicleSetting(wb, 'CapacityKWh', 0));
    const efficiencyPct = Number(vehicleSetting(wb, 'SocEfficiencyPct', 90));
    const signature = JSON.stringify([CFG.dp.wallboxSoc[wb], CFG.dp.wallboxSocEnergy[wb],
        CFG.dp.wallboxSocMeasuredAt[wb], capacityKWh, efficiencyPct]);
    const result = vehicleSocEstimator.estimateSoc({now, capacityKWh, efficiencyPct, signature,
        useStateTimestamp: true, estimationEnabled: vehicleSetting(wb, 'SocEstimationEnabled', false) === true,
        reported: vehiclePriceActualState(CFG.dp.wallboxSoc[wb]),
        counter: vehiclePriceActualState(CFG.dp.wallboxSocEnergy[wb]),
        car: vehiclePriceActualState(CFG.dp.wallboxCar[wb]),
        measurementTime: vehiclePriceActualState(CFG.dp.wallboxSocMeasuredAt[wb]),
        measurementTimeConfigured: Boolean(CFG.dp.wallboxSocMeasuredAt[wb]),
        ledgerText: getState(`${r}.SocEstimateLedger_JSON`)?.val || ''});
    write(`${r}.SocEstimateLedger_JSON`, JSON.stringify(result.ledger));
    if (vehicleSetting(wb, 'SocEstimationEnabled', false) !== true) {
        write(`${r}.ReportedSoC_pct`, result.reported);
        write(`${r}.EstimatedSoC_pct`, null);
        write(`${r}.SocEstimateStatus`, 'disabled');
        return result;
    }
    write(`${r}.SoCCorrectionActive`, Boolean(result.ledger.manual || result.ledger.pendingManual?.connectedAt));
    if (result.manualCleared && getState(`${r}.SoCCorrection_pct`)?.val !== -1) {
        write(`${r}.SoCCorrection_pct`, -1);
        write(`${r}.SoCCorrectionStatus`, result.correctionStatus || 'Manuelle SoC-Korrektur aufgehoben: Fahrzeug abgesteckt');
    }
    if (result.correctionStatus) write(`${r}.SoCCorrectionStatus`, result.correctionStatus);
    if (result.automaticRecovery) write(`${r}.SoCCorrectionStatus`,
        'Fahrzeugquelle automatisch uebernommen: geaenderter SoC passt zur manuellen Ladefortschreibung (max. 1 Prozentpunkt Abweichung)');
    if (result.socWarning && getState(`${r}.SoCWarning`)?.val !== true)
        log(`Wallbox ${wb}: ${result.socWarningText}`, 'warn');
    write(`${r}.SoCWarning`, result.socWarning === true);
    write(`${r}.SoCWarningText`, result.socWarningText || '');
    write(`${r}.ReportedSoC_pct`, result.reported);
    write(`${r}.EstimatedSoC_pct`, result.valid && result.estimated ? Math.round(result.value * 100) / 100 : null);
    write(`${r}.SocEstimateStatus`, result.reason);
    return result;
}

function vehiclePriceSocSample(wb, now = Date.now()) {
    const soc = vehicleSocSample(wb, now);
    // Price accounting adds its own metered charging progress. Use the same
    // winning observation, before that progress, rather than an older raw
    // cloud percentage or an estimate which would count the charge twice.
    return soc.observation ? {valid: soc.valid, ...soc.observation} : vehicleReportedSocSample(wb, now);
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
    deadlineEnabled = false, capacityKWh, efficiency, now = Date.now()} = {}) {
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const enabled = vehiclePriceSetting(wb, 'PriceChargingEnabled', 'PriceChargingEnabled', false) === true;
    const trip = datedWallboxTrip(wb);
    if (wallboxMorningEnabled(wb)) {
        departureTimestamp = wallboxDepartureAt(wb, now, trip);
        deadlineEnabled = departureTimestamp > 0;
    }
    const trackBooking = deadlineEnabled && trip?.at > now
        && (trip.allowGrid ?? vehicleSetting(wb, 'DeadlineTargetSocEnabled', false)) === true;
    let editableDeparture = deadlineEnabled && (wallboxReadinessEnabled(wb) || Boolean(trip));
    let departureTime = null;
    if (editableDeparture) {
        const configuredTime = String(getState(`${r}.DepartureTime`)?.val ?? '').trim().padStart(5, '0');
        // Use the input even before updateVehicles has published the new timestamp.
        departureTimestamp = wallboxDepartureAt(wb, now, trip);
        departureTime = trip ? trip.clock : departureTimestamp > 0 ? configuredTime : '';
    }
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
    const socSample = vehiclePriceSocSample(wb, now);
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
    let deadlineMode = String(retained('PriceDeadlineMode') || '');
    let fixedDepartureTime = typeof ledger?.departureTime === 'string' ? ledger.departureTime : null;
    if (!editableDeparture && deadlineEnabled && fixedDepartureTime?.includes('T')) {
        editableDeparture = true;
        departureTime = String(getState(`${r}.DepartureTime`)?.val ?? '').trim();
        departureTimestamp = wallboxDepartureAt(wb, now, trip);
    }
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
    if (!ledgerInvalid && (enabled || trackBooking) && present && connected && needsSession && horizonH !== null && horizonH >= 6 && horizonH <= 48
        && (socValid || powerValid)) {
        // A first opt-in on an already plugged vehicle starts one baseline.
        // Subsequent disable/enable cycles keep this same energy record.
        startedAt = Math.max(now, startedAt + 1);
        sessionId = `${wb}:${startedAt}`;
        deadlineMode = deadlineEnabled ? 'departure' : 'flexible';
        deadline = deadlineEnabled
            ? departureTimestamp > now ? departureTimestamp : 0
            : now + 48 * 3600000;
        fixedDepartureTime = departureTime;
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

    if (!ledgerInvalid && sessionId) {
        if (!deadlineEnabled) {
            // Without an explicit departure, future PV gets the complete 48h
            // forecast. This is a rolling planning boundary, never a new plug
            // session or energy allowance. It also migrates alpha.25's implicit
            // fixed horizon without altering charged energy or SoC references.
            deadline = now + 48 * 3600000;
            deadlineMode = 'flexible';
            fixedDepartureTime = null;
        } else {
            // Preserve the absolute deadline across clock rollover and restarts.
            // A different configured time is an explicit edit of this session.
            const departureEdited = editableDeparture && (fixedDepartureTime !== null
                ? fixedDepartureTime !== departureTime
                // Older ledgers contain only the absolute deadline. Resolve
                // the configured clock on that date to distinguish an edit.
                : deadline > 0 && nextDepartureTimestamp(departureTime, deadline - 1) !== deadline);
            if (deadlineMode === 'flexible' || deadline <= 0 || departureEdited)
                deadline = departureTimestamp > now ? departureTimestamp : 0;
            deadlineMode = 'departure';
            if (editableDeparture) fixedDepartureTime = departureTime;
        }
    }

    const metadataValid = !ledgerInvalid && Boolean(sessionId) && startedAt > 0 && startedAt <= now + 1000
        && (deadline > startedAt || editableDeparture && deadline === 0) && Number.isFinite(charged) && charged >= 0;
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
            // An unchanged app poll does not erase continuous metered progress.
            const reanchor = !editableDeparture || socSample.value !== socSamplePct || !trackingValid;
            if (reanchor && socSample.timestamp >= lastAt) {
                energyAtSoCSample = charged;
                // A genuinely fresh SoC sample accounts for energy during a
                // prior telemetry gap. It may re-establish a known-SoC ledger.
                if (powerValid) {
                    trackingValid = true;
                    lastAt = Math.max(startedAt, sampleTs);
                    lastPower = powerKW;
                }
            } else if (reanchor && trackingValid && previousMeasurementAt > 0
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

    const chargedSinceSocSample = Math.max(0, charged - energyAtSoCSample);
    const socAccounted = socValid && socSample.timestamp >= socSampleAt;
    const remaining = metadataValid && sessionConnected
        ? socValid && Number.isFinite(gridEnergyKWh)
            ? Math.max(0, gridEnergyKWh - chargedSinceSocSample)
            : !usesSoC && manualKWh !== null && manualKWh > 0 ? Math.max(0, manualKWh - charged) : 0
        : 0;
    const sessionTrackingValid = (enabled || trackBooking) && present && connected && metadataValid && sessionConnected
        && trackingValid && powerValid;
    let valid = enabled && sessionTrackingValid && deadline > now
        && horizonH !== null && horizonH >= 6 && horizonH <= 48
        && (socAccounted || !usesSoC && manualKWh !== null && manualKWh > 0);
    // The same measured energy that reduces the target budget also covers the
    // minimum. An active SoC estimator already accounts for charge and overrides.
    const readinessSocPct = editableDeparture && sessionTrackingValid && socAccounted
        && energyAtSoCSample >= 0 && energyAtSoCSample <= charged
        && vehicleSetting(wb, 'SocEstimationEnabled', false) !== true
        && Number.isFinite(capacityKWh) && capacityKWh > 0 && Number.isFinite(efficiency) && efficiency > 0
        ? Math.min(100, socSample.value + chargedSinceSocSample * efficiency / capacityKWh * 100) : null;
    if (!enabled) status = 'Preisladung deaktiviert; bestehende Sitzung bleibt erhalten';
    else if (!present) status = 'Wallbox deaktiviert';
    else if (!carValid) status = 'Fahrzeugstatus fehlt/ungueltig; keine Preisladung';
    else if (!connected) status = 'Fahrzeug abgesteckt; naechster Anschluss startet neue Sitzung';
    else if (horizonH === null || horizonH < 6 || horizonH > 48) status = 'Preis-Ladehorizont ungueltig (6 bis 48 Stunden)';
    else if (deadlineEnabled && deadline <= 0) status = 'Aktivierte Abfahrt fehlt/ungueltig; keine Preisladung';
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
        PriceDeadlineMode: deadlineMode,
        PriceLastMeasurementAt: lastAt, PriceLastPower_kW: lastPower, PriceEnergyTrackingValid: trackingValid,
        PriceSessionUsesSoC: usesSoC, PriceSoCSampleAt: socSampleAt, PriceSoCSample_pct: socSamplePct,
        PriceEnergyAtSoCSample_kWh: energyAtSoCSample,
        PriceSessionConnected: sessionConnected, PriceSessionValid: valid, PriceSessionStatus: status};
    if (!ledgerInvalid || carValid && !connected)
        write(`${r}.PriceSessionLedger_JSON`, JSON.stringify({version: 1, ...nextLedger,
            ...(fixedDepartureTime === null ? {} : {departureTime: fixedDepartureTime})}));
    for (const [suffix, value] of Object.entries(nextLedger)) write(`${r}.${suffix}`, value);
    return {priceChargingEnabled: enabled, priceSessionId: sessionId, priceSessionValid: Boolean(valid),
        priceRemainingKWh: valid ? remaining : 0, priceDeadlineTimestamp: deadline, priceDeadlineMode: deadlineMode,
        priceMaximumCt: maximumCt,
        priceChargedEnergyKWh: charged, priceStatus: status,
        ...(readinessSocPct === null ? {} : {readinessSocPct})};
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
    if (typeof phaseTestWallboxCurrent === 'function' && phaseTestWallboxCurrent(wb) !== null)
        return phaseTestWallboxCurrent(wb);
    const id = CFG.dp.wallboxManualMinCurrent[wb];
    if (!id || !existsState(id)) return 0;
    const value = Number(getState(id)?.val);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.max(6, Math.min(32, Math.floor(value)));
}

function lowSocMinimumCurrent(wb, soc, socStage) {
    if (socStage !== 2 || !vehicleSetting(wb, 'LowSocStepsEnabled', true)) return 0;
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

function wallboxReadinessEnabled(wb) {
    return !wallboxMorningEnabled(wb) && vehicleSetting(wb, 'MinimumSocByDepartureEnabled', false) === true
        && vehicleSetting(wb, 'DeadlineEnabled', false) === true;
}

function wallboxMobilityReserve(wb, minimumSocPct, now) {
    if (!wallboxReadinessEnabled(wb)) return null;
    const source = getState(`${CFG.root}.Vehicles.Wallbox${wb}.MobilityReserve_pct`);
    const reserve = numericValue(source?.val);
    if (typeof source?.ack !== 'boolean' || source.q || !(source.ts > 0 && source.ts <= now + 1000)
        || !Number.isFinite(minimumSocPct)
        || !(reserve > 0 && reserve < minimumSocPct && minimumSocPct <= 100)) return null;
    return reserve;
}

function wallboxReadinessSettings(wb, minimumSocPct, departureAt, priceSession, now) {
    if (priceSession?.priceSessionValid !== true || !priceSession.priceSessionId
        || priceSession.priceDeadlineTimestamp !== departureAt || !(departureAt > now)) return null;
    const reservePct = wallboxMobilityReserve(wb, minimumSocPct, now);
    return reservePct === null ? null : {reservePct, minimumSocPct, departureAt, sessionId: priceSession.priceSessionId};
}

function wallboxConnectionSince(wb) {
    const state = getState(`${CFG.root}.Vehicles.Wallbox${wb}.Connected`);
    const since = state?.lc ?? state?.ts;
    return state?.val === true && Number.isSafeInteger(since) && since > 0 ? since : null;
}

function wallboxReadinessPolicy(wb, minimumSocPct, now = Date.now(), session = null, departureAt = null,
    soc = readNumber(`${CFG.root}.Vehicles.Wallbox${wb}.SoC_pct`, NaN)) {
    if (wallboxMorningEnabled(wb) || datedWallboxTrip(wb) || !vehicleSetting(wb, 'DeadlineEnabled', false) || typeof freshPlanItem !== 'function') return null;
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const currentDeparture = departureAt ?? wallboxDepartureAt(wb, now);
    if (!(currentDeparture > now)) return null;
    const plan = freshPlanItem(`Wallbox${wb}`, null, now);
    if (!plan) return null;
    const pv = plan.departurePv;
    if (pv && getState(`${CFG.root}.Config.Wallbox${wb}PriceChargingEnabled`)?.val === false) {
        const capacity = readNumber(`${CFG.root}.Config.Wallbox${wb}VehicleCapacity_kWh`, 0);
        const efficiency = readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100;
        const mobility = readNumber(`${r}.MobilityReserve_pct`, 0);
        const available = pv.backupUntil ? pv.backupAcKWh
            : pv.futureAcKWh + plan.valueW * Math.max(0, plan.timestamp + 900000 - now) / 3600000000;
        if (pv.index !== wb || pv.departureAt !== currentDeparture || pv.minimumSocPct !== minimumSocPct
            || pv.minimumByDeparture && (!pv.backupUntil || vehicleSetting(wb, 'DeadlineTargetSocEnabled', false)
                || pv.reservePct !== wallboxMobilityReserve(wb, minimumSocPct, now) || soc < pv.reservePct)
            || pv.connectedSince !== undefined && pv.connectedSince !== wallboxConnectionSince(wb)
            || pv.backupUntil && !(pv.connectedSince > 0 && pv.backupUntil > pv.releaseAt
                && pv.backupUntil <= currentDeparture - departureFinishReserveMs)
            || pv.departureAt !== wallboxDepartureAt(wb, now)
            || configuredVehicleMinimumSoc(wb) !== minimumSocPct || configuredVehicleTargetSoc(wb, minimumSocPct) !== pv.targetSocPct
            || !(now < pv.releaseAt && pv.releaseAt < currentDeparture - departureFinishReserveMs)
            || !(pv.reservePct >= mobility && pv.reservePct >= 0 && pv.reservePct < minimumSocPct)
            || !(capacity > 0 && capacity === pv.capacityKWh && efficiency > 0 && efficiency === pv.efficiency)
            || !Number.isFinite(soc) || !(soc >= 0 && soc <= 100) || !Number.isFinite(available)
            || (minimumSocPct - soc) * capacity / (100 * efficiency) > available + 0.001
            || manualMinimumCurrent(wb) > 0 || lowSocMinimumCurrent(wb, soc, 2) > 0) return null;
        return pv;
    }
    if (!wallboxReadinessEnabled(wb) || typeof evaluatePriceAt !== 'function') return null;
    const priceSession = session ?? {priceSessionValid: getState(`${r}.PriceSessionValid`)?.val,
        priceSessionId: getState(`${r}.PriceSessionId`)?.val,
        priceDeadlineTimestamp: getState(`${r}.PriceDeadlineTimestamp`)?.val};
    // Recompute the actual departure from the user input. A late edit must
    // invalidate old permissions even before the next observer publishes it.
    const settings = wallboxReadinessSettings(wb, minimumSocPct, currentDeparture, priceSession, now);
    if (!settings || getState(`${CFG.root}.Config.Wallbox${wb}PriceChargingEnabled`)?.val !== true) return null;
    if (!plan?.readyBy || Object.keys(settings).some(key => plan.readyBy[key] !== settings[key])
        || !Number.isFinite(soc) || !Number.isFinite(plan.readyBy.confirmBy)
        || plan.readyBy.confirmBy > settings.departureAt
        || soc < minimumSocPct && now >= plan.readyBy.confirmBy) return null;
    const proof = plan.readyBy;
    if (soc < minimumSocPct && proof.futureAcKWh !== undefined) {
        const capacity = readNumber(`${r}.Capacity_kWh`, 0);
        const efficiency = Math.max(0.5, Math.min(1, readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
        const needed = (minimumSocPct - soc) * capacity / (100 * efficiency);
        const remaining = proof.futureAcKWh + proof.plannedW * Math.max(0, proof.until - now) / 3600000000;
        if (!(capacity > 0 && Number.isFinite(remaining) && remaining + 0.001 >= needed)) return null;
    }
    const price = evaluatePriceAt(now);
    if (!price.valid || !Number.isFinite(price.totalCt)
        || plan.readinessPurchase === true && (!(Number.isFinite(plan.priceLimitCt))
            || price.totalCt > plan.priceLimitCt + 0.001)) return null;
    return settings;
}

function configuredVehicleMinimumSoc(wb) {
    return Math.max(0, Math.min(100, vehicleSetting(wb, 'SocLimitsSource', 'external') === 'admin'
        ? Number(vehicleSetting(wb, 'MinSocPct', 20)) : readNumber(CFG.dp.wallboxMinSoc[wb], 0)));
}

function configuredVehicleTargetSoc(wb, minimumSoc) {
    return Math.max(minimumSoc, Math.min(100, vehicleSetting(wb, 'SocLimitsSource', 'external') === 'admin'
        ? Number(vehicleSetting(wb, 'TargetSocPct', 80)) : readNumber(CFG.dp.wallboxSocTarget[wb], 100)));
}

// AC power needed from now to departure. Reserve the time required by any
// slower taper stages before spreading the remaining energy over the window.
const departureFinishReserveMs = 15 * 60000;
const departureStepDownMarginMs = 5 * 60000;
const liveDepartureGrants = [null, null, null];
const qualifiedDepartureSoc = [null, null, null];
const wallboxDepartureZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function departurePowerForWindow(vehicle, now, voltage, phases, reserveMs) {
    const tripW = bookedDeparturePower(vehicle, now, voltage, phases, reserveMs);
    const morning = vehicle.datedTrip?.morning;
    if (!morning || !vehicle.socValid || !(vehicle.socPct < morning.target) || !morningChargeActive(morning, now)) return tripW;
    const maxA = phases === 3 ? vehicle.baseMaxCurrent3pA : vehicle.baseMaxCurrent1pA;
    const stepW = voltage * phases;
    const amps = Math.min(taperCurrentLimit(vehicle.index, vehicle.socPct, vehicle.targetSocPct, maxA),
        Math.floor(Math.min(morning.powerW, vehicle.maximumPowerW) / stepW));
    return Math.max(tripW, amps * stepW);
}

function bookedDeparturePower(vehicle, now, voltage, phases, reserveMs) {
    const {index, socPct, capacityKWh, departureTimestamp, efficiency} = vehicle;
    const plan = vehicle.datedTrip;
    if (plan?.tariffManaged || plan?.morning && !(plan.at > now && plan.latestStart > 0 && now >= plan.latestStart)) return 0;
    const minimumSocPct = plan?.morning ? plan.gridGoal : vehicle.minimumSocPct;
    if (!vehicle.deadlineEnabled || !vehicle.socValid || vehicle.readyBy
        || ![socPct, minimumSocPct, capacityKWh, departureTimestamp, efficiency, now, voltage].every(Number.isFinite)
        || socPct < 0 || minimumSocPct > 100 || socPct >= minimumSocPct || capacityKWh <= 0
        || efficiency <= 0 || voltage <= 0 || departureTimestamp <= now) return 0;
    const stepW = voltage * phases;
    const maxA = phases === 3 ? vehicle.baseMaxCurrent3pA : vehicle.baseMaxCurrent1pA;
    const capAt = pct => Math.min(vehicle.maximumPowerW,
        taperCurrentLimit(index, pct, vehicle.targetSocPct, maxA) * stepW);
    let hours = (departureTimestamp - now - reserveMs) / 3600000;
    if (hours <= 0) return Math.max(0, Math.floor(capAt(socPct) / stepW)) * stepW;
    const whPerPct = capacityKWh * 10 / efficiency;
    let energyWh = (minimumSocPct - socPct) * whPerPct;
    if (vehicleSetting(index, 'TaperEnabled', false)) {
        const stages = [1, 2].map(stage => vehicle.targetSocPct - Number(vehicleSetting(index,
            `Taper${stage}DeltaPct`, stage === 1 ? 5 : 2))).filter(pct => pct > socPct && pct < minimumSocPct);
        let end = minimumSocPct;
        for (const start of [...new Set(stages)].sort((a, b) => b - a)) {
            const cap = capAt(start);
            if (cap >= energyWh / hours) break;
            const wh = (end - start) * whPerPct;
            if (cap <= 0 || hours <= wh / cap) return Math.max(0, Math.floor(capAt(socPct) / stepW)) * stepW;
            hours -= wh / cap;
            energyWh -= wh;
            end = start;
        }
    }
    const amps = Math.min(Math.floor(capAt(socPct) / stepW), Math.ceil(energyWh / hours / stepW - 1e-9));
    return Number.isFinite(amps) ? Math.max(0, amps) * stepW : 0;
}

// Only a previously granted ampere from this vehicle's own departure demand
// may be held. Optional PV, price purchases and a peer's demand cannot latch.
function departureGrant(vehicle, personalW, grantedW, phases, voltage, now, validUntil) {
    if (!(personalW > 0 && grantedW > 0)) return null;
    const stepW = phases * voltage;
    const watts = Math.floor(Math.min(personalW, grantedW) / stepW + 1e-9) * stepW;
    return watts > 0 ? {watts, now, validUntil, phases, voltage, index: vehicle.index,
        departureTimestamp: vehicle.departureTimestamp, minimumSocPct: vehicle.minimumSocPct,
        targetSocPct: vehicle.targetSocPct} : null;
}

function rememberLiveDepartureGrant(vehicle, personalW, grantedW, phases, voltage, now) {
    const validUntil = now + Math.max(10000, readNumber(`${CFG.root}.Config.SlowControlCycle_s`, 5) * 2000);
    liveDepartureGrants[vehicle.index] = departureGrant(vehicle, personalW, grantedW, phases, voltage, now, validUntil);
}

function departureMinimumPower(vehicle, now, voltage, phases = 1, previous = null) {
    const requiredW = departurePowerForWindow(vehicle, now, voltage, phases, departureFinishReserveMs);
    if (!requiredW || !previous || previous.index !== vehicle.index || previous.phases !== phases
        || previous.voltage !== voltage || now < previous.now || now > previous.validUntil
        || previous.departureTimestamp !== vehicle.departureTimestamp || previous.minimumSocPct !== vehicle.minimumSocPct
        || previous.targetSocPct !== vehicle.targetSocPct
        || Math.abs(previous.watts - requiredW - phases * voltage) > 1e-6) return requiredW;
    // Increase immediately. Release a single step only when the lower current
    // also covers five extra minutes of headroom, including any slower taper.
    return Math.min(previous.watts, departurePowerForWindow(vehicle, now, voltage, phases,
        departureFinishReserveMs + departureStepDownMarginMs));
}

function departureReservation(vehicle, now, voltage, previous = null) {
    const fixedThree = vehicle.phaseControlMode === 'script' && vehicle.confirmedPhases === 3;
    const oneW = departureMinimumPower(vehicle, now, voltage, 1, previous);
    const threeW = (fixedThree || vehicle.phaseSwitchEnabled && vehicle.maximumPhases >= 3
        && vehicle.phaseControlMode === 'ems') ? departureMinimumPower(vehicle, now, voltage, 3, previous) : 0;
    const phases = fixedThree || threeW > vehicle.maxCurrent1pA * voltage && threeW > oneW ? 3 : 1;
    return {departureW: phases === 3 ? threeW : oneW, departurePhases: phases};
}

function departurePhasesWithinBudget(vehicle, watts, voltage) {
    return vehicle.departurePhases === 3 && (vehicle.phaseControlMode === 'script'
        || watts >= vehicle.minCurrent3pA * voltage * 3) ? 3 : 1;
}

function compareDepartureMinima(a, b) {
    const deadline = v => v.departureW > 0 ? Math.min(v.departureTimestamp || Infinity,
        v.datedTrip?.morning && v.socPct < v.datedTrip.morning.target ? v.datedTrip.morning.at : Infinity) : Infinity;
    return deadline(a) - deadline(b) || 0;
}

function untimedMinimum(vehicle) {
    if (vehicle.datedTrip?.morning) return vehicle.belowMinimum && vehicle.socPct < vehicle.datedTrip.reserve;
    return vehicle.belowMinimum && (!vehicle.deadlineEnabled || !vehicle.departureTimestamp);
}

// Final output uses the current user entry and qualified SoC even if the
// previous grouped grant or observer snapshot is still fresh.
function liveDepartureMinimumW(wb, soc, minimum, phases, voltage, now, requestedW = 0) {
    if (!(Number.isFinite(soc) && Number.isFinite(minimum))
        || !wallboxMorningEnabled(wb) && !vehicleSetting(wb, 'DeadlineEnabled', false)) return 0;
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const departureTimestamp = wallboxDepartureAt(wb, now);
    const trip = datedWallboxChargePlan(wb, now, soc);
    if ((!departureTimestamp && !trip?.morning) || departureTimestamp !== readNumber(`${r}.DepartureTimestamp`, 0)) return 0;
    minimum = Math.min(minimum, trip?.floor ?? configuredVehicleMinimumSoc(wb));
    if (soc >= minimum) return 0;
    const dutyW = departureMinimumPower({index: wb, deadlineEnabled: true, socValid: true, socPct: soc,
        minimumSocPct: minimum, targetSocPct: wallboxChargeTarget(wb, now), departureTimestamp, datedTrip: trip,
        capacityKWh: readNumber(`${r}.Capacity_kWh`, 0), maximumPowerW: readNumber(`${r}.MaximumPower_W`, 0),
        baseMaxCurrent1pA: readNumber(`${r}.MaxCurrent1P_A`, 0), baseMaxCurrent3pA: readNumber(`${r}.MaxCurrent3P_A`, 0),
        efficiency: Math.max(0.5, Math.min(1, readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100))
    }, now, voltage, phases, liveDepartureGrants[wb]);
    if (requestedW > dutyW && dutyW > 0 && [0, 1, 2].some(peer => {
        if (peer === wb || !wallboxMorningEnabled(peer) && !vehicleSetting(peer, 'DeadlineEnabled', false)) return false;
        const v = vehicleState(peer);
        return v.release && v.connected && v.departureW > 0 && v.departureTimestamp === wallboxDepartureAt(peer, now);
    })) return Math.min(requestedW, readNumber(`${r}.MaximumPower_W`, 0));
    return dutyW;
}

function plannedVehicleAtSoc(vehicle, remainingBatteryKWh, timestamp = Date.now(), previous = null) {
    const currentSoc = vehicle.datedTrip?.morning ? vehicle.socPct : vehicle.readinessSocPct ?? vehicle.departureSocPct ?? vehicle.socPct;
    const soc = Number.isFinite(remainingBatteryKWh)
        ? Math.max(currentSoc, vehicle.targetSocPct - remainingBatteryKWh / vehicle.capacityKWh * 100)
        : currentSoc;
    const pv = vehicle.departurePv && timestamp < vehicle.departurePv.releaseAt ? vehicle.departurePv : null;
    const readyBy = pv ?? vehicle.readyBy;
    const trip = vehicle.datedTrip;
    const minimumSocPct = trip ? scheduledWallboxFloor(trip, timestamp)
        : readyBy?.reservePct ?? vehicle.minimumSocPct;
    const belowMinimum = vehicle.socValid && soc + (pv ? 0.001 : 0) < minimumSocPct;
    const lowSocA = lowSocMinimumCurrent(vehicle.index, soc, belowMinimum ? 2 : 1);
    const requestedMinimumA = Math.max(vehicle.manualMinimumCurrentA, lowSocA);
    const maxCurrent1pA = taperCurrentLimit(vehicle.index, soc, vehicle.targetSocPct, vehicle.baseMaxCurrent1pA);
    const maxCurrent3pA = taperCurrentLimit(vehicle.index, soc, vehicle.targetSocPct, vehicle.baseMaxCurrent3pA);
    const manualMinimumActive = vehicle.socValid && soc < vehicle.targetSocPct
        && vehicle.manualMinimumCurrentA > 0;
    const targetDeadlineDue = vehicle.deadlineTargetSocEnabled === true && !readyBy
        && soc < vehicle.targetSocPct && timestamp >= vehicle.latestStartTimestamp && timestamp < vehicle.departureTimestamp;
    const planned = {...vehicle, readyBy, socPct: soc, minimumSocPct, targetDeadlineDue,
        ...(vehicle.bookedConnection ? {departureTimestamp: trip.at - departureFinishReserveMs} : {}),
        minimumDeferred: trip ? soc >= minimumSocPct && soc < Math.max(trip.gridGoal, trip.morning?.target ?? 0)
            : pv?.minimumByDeparture === true && soc < vehicle.minimumSocPct,
        belowMinimum, mustCharge: belowMinimum || manualMinimumActive || targetDeadlineDue,
        lowSocMinimumCurrentA: lowSocA, requestedMinimumCurrentA: requestedMinimumA,
        maxCurrent1pA, maxCurrent3pA,
        minCurrent1pA: appliedMinimumCurrent(vehicle.baseMinCurrent1pA, requestedMinimumA, maxCurrent1pA),
        minCurrent3pA: appliedMinimumCurrent(vehicle.baseMinCurrent3pA, requestedMinimumA, maxCurrent3pA)};
    return {...planned, ...departureReservation(planned, timestamp, vehicle.nominalVoltage, previous)};
}

// A dated booking owns its clock and permissions in a single writable state.
// Even an expired or invalid booking masks the recurring clock until cleared.
function datedWallboxTrip(wb) {
    const state = getState(`${CFG.root}.Vehicles.Wallbox${wb}.DepartureTrip_JSON`);
    if (state?.val == null || state.val === '') return null;
    try {
        const v = JSON.parse(state.val);
        if (!state.q && v && typeof v.date === 'string' && typeof v.time === 'string'
            && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)
            && (v.soc == null || Number.isInteger(v.soc) && v.soc >= 0 && v.soc <= 100)
            && (v.allowGrid == null || typeof v.allowGrid === 'boolean')) {
            const clock = v.date + 'T' + v.time;
            const at = new Date(clock);
            if (Number.isFinite(at.getTime()) && localDateKey(at) === v.date
                && at.toTimeString().slice(0, 5) === v.time)
                return {clock, at: at.getTime(), soc: v.soc ?? null, allowGrid: v.allowGrid ?? null};
        }
    } catch (_) { /* Invalid settings cannot authorize charging. */ }
    return {clock: '', at: 0, soc: null, allowGrid: false};
}

function wallboxDepartureAt(wb, now, trip = datedWallboxTrip(wb)) {
    if (wallboxMorningEnabled(wb))
        return vehicleSetting(wb, 'DeadlineEnabled', false) && trip?.soc != null && trip.at > now ? trip.at : 0;
    return trip ? (trip.at > now ? trip.at : 0)
        : nextDepartureTimestamp(getState(`${CFG.root}.Vehicles.Wallbox${wb}.DepartureTime`)?.val, now);
}

function wallboxChargeTarget(wb, now = Date.now(), trip = datedWallboxTrip(wb), minimum = configuredVehicleMinimumSoc(wb)) {
    if (trip?.at > now && trip.soc !== null && vehicleSetting(wb, 'DeadlineEnabled', false))
        return Math.max(minimum, trip.soc);
    return configuredVehicleTargetSoc(wb, minimum);
}

// Use confirmed/configured topology, commissioning and taper limits when
// reserving grid time. A fifth of the capacity stays available for delays.
function wallboxChargeWindow(wb, now, soc, gridGoal, deadline, target) {
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const capacity = readNumber(`${CFG.root}.Config.Wallbox${wb}VehicleCapacity_kWh`, 50);
    const efficiency = Math.max(0.5, Math.min(1, readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const voltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const fixedThree = vehicleSetting(wb, 'PhaseControlMode', '') === 'script'
        && vehiclePhaseControl(wb, now).confirmedPhases === 3;
    const phases = fixedThree ? 3 : 1;
    const maxA = Math.min(readNumber(`${r}.MaxCurrent${phases}P_A`, 16),
        Number(vehicleSetting(wb, 'CommissioningMaxA', 6)));
    const minA = readNumber(`${r}.MinCurrent${phases}P_A`, 6);
    const peers = [0, 1, 2].filter(index => {
        if (index === wb) return false;
        const peer = `${CFG.root}.Vehicles.Wallbox${index}`;
        if (getState(`${peer}.Connected`)?.val !== true || getState(`${peer}.SoCValid`)?.val !== true) return false;
        const base = configuredVehicleMinimumSoc(index);
        const peerSoc = readNumber(`${peer}.SoC_pct`, 0);
        if (wallboxMorningEnabled(index) && peerSoc < base && nextDepartureTimestamp('06:00', now) <= deadline) return true;
        if (!vehicleSetting(index, 'DeadlineEnabled', false)) return false;
        const booking = datedWallboxTrip(index);
        const at = wallboxDepartureAt(index, now, booking);
        if (!at || at > deadline) return false;
        const allowed = booking?.allowGrid ?? vehicleSetting(index, 'DeadlineTargetSocEnabled', false);
        const needed = allowed ? booking?.soc ?? configuredVehicleTargetSoc(index, base) : base;
        return readNumber(`${peer}.SoC_pct`, 0) < Math.max(base, needed);
    }).length + 1;
    const workingA = readNumber(`${CFG.root}.Config.HouseConnectionWorkingLimit_A`, 46);
    const fuseA = readNumber(`${CFG.root}.Config.HouseConnectionFuse_A`, 50);
    const budget = readNumber(`${CFG.root}.Control.GridOperatorBudget_W`, -1);
    const capW = Math.min(readNumber(`${CFG.root}.Config.Wallbox${wb}MaxPower_W`, 11000),
        Math.min(workingA, fuseA) * phases * voltage / peers,
        budget >= 0 && getState(`${CFG.root}.Control.GridOperatorLimitActive`)?.val === true ? budget / peers : Infinity);
    const sequential = peers > 1 && !parallelWallboxChargingEnabled() ? peers : 1;
    const known = Number.isFinite(soc) && soc >= 0 && soc <= 100;
    let hours = 0;
    if (known && soc < gridGoal) {
        // Split at each taper threshold, including fractional percentage SoCs.
        const thresholds = [1, 2].map(stage => target - Number(vehicleSetting(wb, `Taper${stage}DeltaPct`, stage === 1 ? 5 : 2)))
            .filter(x => x > soc && x < gridGoal).sort((a, b) => a - b);
        let from = soc;
        for (const to of [...new Set(thresholds), gridGoal]) {
            const amps = Math.floor(Math.min(taperCurrentLimit(wb, from, target, maxA), capW / (phases * voltage)));
            const watts = amps >= minA ? amps * voltage * phases : 0;
            hours += watts > 0 ? sequential * (to - from) * capacity * 10 / (0.8 * efficiency * watts) : Infinity;
            from = to;
        }
    }
    const startDelay = Math.max(0, readNumber(`${CFG.root}.Config.WallboxStartDelay_s`, 30)) * 1000;
    const latestStart = !known || soc >= gridGoal ? 0 : Number.isFinite(hours)
        ? Math.max(1, Math.floor((deadline - departureFinishReserveMs - startDelay - hours * 3600000) / 900000) * 900000) : now;
    return {hours, latestStart, startDelay, powerW: Math.max(0, Math.min(capW, maxA * voltage * phases))};
}

function wallboxMorningEnabled(wb) {
    return vehicleSetting(wb, 'MinimumSocByDepartureEnabled', false) === true
        && nativeConfig.wallboxMinimumSchedule !== 'departure';
}

function morningReserveSoc(wb, minimum) {
    const state = getState(`${CFG.root}.Vehicles.Wallbox${wb}.MobilityReserve_pct`);
    const reserve = numericValue(state?.val);
    return state && !state.q && reserve !== null && reserve >= 0 && reserve <= 100
        ? Math.min(reserve, minimum) : minimum;
}

// These quarters authorize only the daily minimum. Optional price charging
// and a booked trip keep their own energy and grid permissions.
let morningPriceCurve = null;

function morningTariffSlots(now, deadline, priceContext) {
    const minute = Math.floor(now / 60000);
    const key = JSON.stringify([priceContext.energyDynamic, priceContext.gridDynamic, priceContext.energySource,
        priceContext.gridSource, priceContext.fixedEnergy, priceContext.fixedGrid, priceContext.adders, priceContext.vatPct,
        priceContext.energyBasis, priceContext.energySeries?.sourceTs, priceContext.gridSeries?.sourceTs,
        priceContext.tariff?.year, priceContext.tariff?.values, nativeConfig.gridTariffRules, nativeConfig.gridTariffBasis]);
    const current = evaluatePriceAt(now, priceContext);
    if (!current.valid) return [];
    if (morningPriceCurve?.minute === minute && morningPriceCurve.deadline === deadline
        && morningPriceCurve.key === key && morningPriceCurve.currentCt === current.totalCt) return morningPriceCurve.slots;
    const end = deadline - departureFinishReserveMs;
    const slots = [];
    for (let at = Math.floor(now / 900000) * 900000; at < end; at += 900000) {
        const from = Math.max(now, at), until = Math.min(at + 900000, end);
        const price = evaluatePriceAt(from, priceContext, until - from);
        if (!price.valid || !Number.isFinite(price.totalCt)) return [];
        slots.push({from: at, until, ct: price.totalCt});
    }
    slots.sort((a, b) => a.ct - b.ct || b.from - a.from);
    morningPriceCurve = {minute, deadline, key, currentCt: current.totalCt, slots};
    return slots;
}

function morningTariffWindows(now, deadline, window, priceContext, running = null) {
    if (!(window.hours > 0 && Number.isFinite(window.hours))) return [];
    let slots = morningTariffSlots(now, deadline, priceContext);
    if (!slots.length || !running && slots[0].ct === slots.at(-1).ct) return [];
    if (running) {
        // Keep an already started, equally cheap contiguous window while the
        // SoC rises. A newly cheaper tariff can still displace its quarters.
        const inRun = s => s.ct === running.ct && s.from < running.until && s.until > now;
        slots = [...slots].sort((a, b) => a.ct - b.ct || Number(inRun(b)) - Number(inRun(a))
            || (inRun(a) ? a.from - b.from : b.from - a.from));
    }
    const needed = window.hours * 3600000;
    let usable = 0;
    const selected = [], starts = new Map(), ends = new Map();
    const available = (from, until) => Math.max(0, until - Math.max(now, from) - window.startDelay);
    for (const slot of slots) {
        // Adjacent quarters share one physical startup, even across tariff levels.
        const from = ends.get(slot.from) ?? slot.from, until = starts.get(slot.until) ?? slot.until;
        usable += available(from, until) - available(from, slot.from) - available(slot.until, until);
        ends.delete(slot.from);
        starts.delete(slot.until);
        starts.set(from, until);
        ends.set(until, from);
        selected.push(slot);
        if (usable >= needed) break;
    }
    if (usable < needed) return [];
    selected.sort((a, b) => a.from - b.from);
    const windows = [];
    for (const slot of selected) {
        const last = windows.at(-1);
        if (last && last.until === slot.from && last.ct === slot.ct) last.until = slot.until;
        else windows.push({...slot});
    }
    return windows;
}

function morningChargeActive(morning, now) {
    return morning && (morning.latestStart > 0 && now >= morning.latestStart
        || morning.windows.some(slot => slot.from <= now && now < slot.until));
}

function scheduledWallboxFloor(plan, now) {
    let floor = !plan.tariffManaged && plan.latestStart > 0 && now >= plan.latestStart ? Math.max(plan.reserve, plan.gridGoal) : plan.reserve;
    if (morningChargeActive(plan.morning, now)) floor = Math.max(floor, plan.morning.target);
    return floor;
}

function datedWallboxChargePlan(wb, now, soc, trip = datedWallboxTrip(wb)) {
    const daily = wallboxMorningEnabled(wb);
    const booked = trip?.at > now && vehicleSetting(wb, 'DeadlineEnabled', false) && (!daily || trip.soc != null);
    if (!daily && !booked) return null;
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    let previous;
    try { previous = JSON.parse(getState(`${r}.DeparturePlan_JSON`)?.val || '{}'); } catch (_) { /* First run. */ }
    const minimum = configuredVehicleMinimumSoc(wb);
    const target = wallboxChargeTarget(wb, now, trip, minimum);
    const allowGrid = !!booked && (trip.allowGrid ?? vehicleSetting(wb, 'DeadlineTargetSocEnabled', false));
    const gridGoal = allowGrid ? (daily ? trip.soc : target) : minimum;
    const key = booked ? JSON.stringify([trip.clock, trip.soc, allowGrid, gridGoal]) : '';
    const reserve = daily ? morningReserveSoc(wb, minimum) : wallboxMobilityReserve(wb, minimum, now) ?? minimum;
    let latestStart = booked && (!daily || allowGrid) ? wallboxChargeWindow(wb, now, soc, gridGoal, trip.at, target).latestStart : 0;
    if (latestStart && previous?.key === key && previous.latestStart > 0 && previous.latestStart <= now)
        latestStart = Math.min(latestStart, previous.latestStart);
    const plan = {key, clock: booked ? trip.clock : '', at: booked ? trip.at : 0,
        requestedSoc: booked ? trip.soc : null, target, gridGoal, reserve, allowGrid, latestStart};
    if (daily) {
        const connectedSince = wallboxConnectionSince(wb);
        const last = previous?.morning;
        // Keep an overdue minimum for the same plugged-in session until it
        // is reached. A car arriving after 06:00 gets the next local morning.
        const continued = connectedSince && last?.connectedSince === connectedSince && last.target === minimum
            && Number.isFinite(soc) && soc < minimum && last.latestStart > 0 && last.latestStart <= now;
        const at = continued && last.at <= now ? last.at : nextDepartureTimestamp('06:00', now);
        const window = wallboxChargeWindow(wb, now, soc, minimum, at, target);
        const due = continued && last.at === at ? Math.min(last.latestStart, window.latestStart) : window.latestStart;
        let windows = [];
        if (reserve < minimum && window.hours > 0 && due > now && typeof readPriceContext === 'function') {
            const prices = readPriceContext(now);
            if (prices.gridDynamic === true || prices.energyDynamic === true) {
                const running = connectedSince && last?.connectedSince === connectedSince && last.at === at
                    && last.windows?.find(slot => slot.from <= now && now < slot.until);
                windows = morningTariffWindows(now, at, window, prices, running);
            }
        }
        plan.morning = {at, target: minimum, latestStart: due, powerW: window.powerW, connectedSince, windows};
    }
    if (booked && allowGrid && Number.isFinite(soc) && typeof freshPlanItem === 'function') {
        const point = freshPlanItem(`Wallbox${wb}`, null, now);
        const tariff = point?.bookedTariff;
        // A booking edit, reconnect, tariff revision or missed charge must not
        // postpone the independent latest-start fallback.
        if (tariff && tariff.key === key && tariff.connectedSince === wallboxConnectionSince(wb)
            && now < tariff.finish && (now < latestStart || soc + 0.01 >= tariff.startSoc
                || point.bookedPurchase && now < point.priceChargeUntil)
            && tariff.capacityKWh === readNumber(`${CFG.root}.Config.Wallbox${wb}VehicleCapacity_kWh`, 0)
            && tariff.efficiency === readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100) {
            const price = evaluatePriceAt(now);
            if (price.valid && Number.isFinite(price.totalCt) && Math.abs(price.totalCt - tariff.ct) < 0.001)
                plan.tariffManaged = true;
        }
    }
    plan.floor = scheduledWallboxFloor(plan, now);
    return plan;
}

function nextDepartureTimestamp(timeText, now) {
    const text = String(timeText ?? '').trim();
    if (!text) return 0;
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match) return 0;
    const hour = Number(match[1]), minute = Number(match[2]);
    if (hour > 23 || minute > 59) return 0;
    const departure = new Date(now);
    departure.setHours(hour, minute, 0, 0);
    if (departure.getTime() <= now) departure.setDate(departure.getDate() + 1);
    return departure.getTime();
}

function vehicleState(wb) {
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const present = Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.Present`)?.val);
    const phaseControl = vehiclePhaseControl(wb);
    const now = Date.now();
    const booking = datedWallboxTrip(wb);
    const targetSoc = wallboxChargeTarget(wb, now, booking);
    const baseMinCurrent1pA = readNumber(`${r}.MinCurrent1P_A`, 6);
    const baseMinCurrent3pA = readNumber(`${r}.MinCurrent3P_A`, wb === 0 ? 0 : 6);
    const baseMaxCurrent1pA = readNumber(`${r}.MaxCurrent1P_A`, 32);
    const baseMaxCurrent3pA = readNumber(`${r}.MaxCurrent3P_A`, 16);
    const maximumPowerW = readNumber(`${r}.MaximumPower_W`, 11000);
    const requestedMinimumCurrentA = readNumber(`${r}.RequestedMinimumCurrent_A`, 0);
    const maxCurrent1pA = taperCurrentLimit(wb, readNumber(`${r}.SoC_pct`, 0),
        targetSoc, baseMaxCurrent1pA);
    const maxCurrent3pA = taperCurrentLimit(wb, readNumber(`${r}.SoC_pct`, 0),
        targetSoc, baseMaxCurrent3pA);
    const currentSoc = vehiclePriceSocSample(wb);
    const efficiency = Math.max(0.5, Math.min(1,
        readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const capacityKWh = readNumber(`${r}.Capacity_kWh`, 0);
    const deadlineEnabled = Boolean(vehicleSetting(wb, 'DeadlineEnabled', false));
    const priceSession = updateVehiclePriceSession(wb, {socValid: currentSoc.valid,
        gridEnergyKWh: Math.max(0, (targetSoc - currentSoc.value) / 100
            * capacityKWh / efficiency),
        departureTimestamp: readNumber(`${r}.DepartureTimestamp`, 0),
        deadlineEnabled, capacityKWh, efficiency});
    const nominalVoltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const trip = datedWallboxChargePlan(wb, now, getState(`${r}.SoCValid`)?.val === true
        ? (booking ? priceSession.readinessSocPct : null) ?? numericValue(getState(`${r}.SoC_pct`)?.val) : null, booking);
    const vehicle = {
        ...(trip ? {datedTrip: trip} : {}),
        index: wb, nominalVoltage, efficiency,
        connected: Boolean(getState(`${r}.Connected`)?.val),
        socValid: Boolean(getState(`${r}.SoCValid`)?.val),
        socPct: readNumber(`${r}.SoC_pct`, 0),
        minimumSocPct: trip?.floor ?? readNumber(`${r}.MinimumSoC_pct`, 0),
        targetSocPct: targetSoc,
        release: present && phaseControl.phaseControlValid && Boolean(getState(`${r}.Release`)?.val)
            && getState(`${CFG.root}.Devices.Wallbox${wb}.NoDrawPaused`)?.val !== true
            && !(currentSoc.valid && priceSession.priceChargingEnabled && priceSession.priceSessionValid
                && priceSession.priceRemainingKWh <= 0)
            && (Boolean(getState(`${r}.SoCValid`)?.val)
                || getState(`${CFG.root}.Config.WallboxPlanWithoutSoC`)?.val === true
                || priceSession.priceSessionValid && priceSession.priceRemainingKWh > 0),
        mustCharge: Boolean(getState(`${r}.MustCharge`)?.val),
        belowMinimum: Boolean(getState(`${r}.BelowMinimum`)?.val),
        deadlineEnabled,
        ...(!wallboxMorningEnabled(wb) && !booking && deadlineEnabled && vehicleSetting(wb, 'DeadlineTargetSocEnabled', false) === true
            ? {deadlineTargetSocEnabled: true} : {}),
        capacityKWh,
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
    const soc = (trip?.morning ? vehicle.socPct : vehicle.readinessSocPct)
        ?? (vehicle.deadlineEnabled && vehicle.departureTimestamp ? qualifiedDepartureSoc[wb] : null) ?? vehicle.socPct;
    const readiness = vehicle.deadlineEnabled && wallboxReadinessPolicy(wb, vehicle.minimumSocPct, now,
        priceSession, vehicle.departureTimestamp, soc);
    return {...vehicle, departureSocPct: soc, minimumDeferred: trip ? soc >= trip.floor && soc < Math.max(trip.gridGoal, trip.morning?.target ?? 0)
        : readiness?.minimumByDeparture === true && soc < vehicle.minimumSocPct,
        ...departureReservation({...vehicle, socPct: soc, readyBy: readiness}, now, nominalVoltage, liveDepartureGrants[wb])};
}

function wallboxMeasuredReadinessSoc(wb) {
    if (vehicleSetting(wb, 'SocEstimationEnabled', false) === true) return null;
    const trip = datedWallboxTrip(wb);
    const booked = trip?.at > Date.now() && vehicleSetting(wb, 'DeadlineEnabled', false)
        && (trip.allowGrid ?? vehicleSetting(wb, 'DeadlineTargetSocEnabled', false));
    if (!booked && (!wallboxReadinessEnabled(wb)
        || vehiclePriceSetting(wb, 'PriceChargingEnabled', 'PriceChargingEnabled', false) !== true)) return null;
    return vehicleState(wb).readinessSocPct ?? null;
}

// The parallel policy is explicitly configurable. Missing configuration keeps
// the previous sequence contract; installation supplies the new native default.
function parallelWallboxChargingEnabled() {
    const state = getState(`${CFG.root}.Config.WallboxParallelChargingEnabled`);
    return typeof state?.val === 'boolean' ? state.val
        : nativeConfig.wallboxParallelChargingEnabled === true;
}

function parallelWallboxVehicle(vehicle) {
    if (!vehicle?.belowMinimum) return vehicle;
    // Reserve each mandatory car's hardware or manual minimum first. The
    // single-phase WB0 SoC step can use remaining capacity afterwards.
    return {...vehicle,
        minCurrent1pA: Math.max(6, vehicle.baseMinCurrent1pA || 6,
            Math.min(vehicle.maxCurrent1pA, vehicle.manualMinimumCurrentA || 0)),
        minCurrent3pA: Math.max(6, vehicle.baseMinCurrent3pA || 6,
            Math.min(vehicle.maxCurrent3pA, vehicle.manualMinimumCurrentA || 0))};
}

function parallelLowSocTargetW(vehicle, voltage, availableW) {
    if (vehicle?.index !== 0 || vehicle.maximumPhases !== 1 || !vehicle.belowMinimum
        || !(vehicle.lowSocMinimumCurrentA > 0)) return 0;
    const availableA = Math.floor(Math.min(availableW, vehicle.maximumPowerW) / voltage);
    return Math.max(0, Math.min(vehicle.lowSocMinimumCurrentA, vehicle.maxCurrent1pA, availableA)) * voltage;
}

function allocateParallelWallboxWatts(candidates, budgetW, hardBudgetW = Infinity, phaseBudgetW = null) {
    const hard = Number.isFinite(hardBudgetW) ? Math.max(0, hardBudgetW) : Infinity;
    const watts = [0, 0, 0], admitted = [], waiting = [];
    const entries = candidates.filter(c => Number.isInteger(c.wb) && c.wb >= 0 && c.wb < 3)
        .filter((c, i, all) => all.findIndex(other => other.wb === c.wb) === i)
        .map(c => ({...c, capW: Math.max(0, Number(c.capW) || 0),
            minimumW: Math.max(0, Number(c.minimumW) || 0)}));
    let remaining = hard, minimumTotalW = 0;
    const phaseW = phaseBudgetW?.slice();
    // Admit the departure obligation before discretionary priority. A hard
    // ceiling can reduce a 9 A request to 8 A without dropping a usable car.
    const due = entries.filter(c => c.departureW > 0).sort(compareDepartureMinima);
    const room = c => {
        const phases = c.minimumPhases || 1;
        const phaseCap = !phaseW ? Infinity : phases === 3 ? Math.min(...phaseW) * 3 : phaseW[0];
        return Math.min(c.capW - watts[c.wb], remaining, phaseCap);
    };
    const add = (c, power) => {
        watts[c.wb] += power;
        minimumTotalW += power;
        remaining -= power;
        if (phaseW) {
            const phases = c.minimumPhases || 1;
            for (let phase = 0; phase < phases; phase++) phaseW[phase] -= power / phases;
        }
    };
    const admit = c => {
        if (c.minimumW <= 0) return;
        if (c.minimumW > room(c)) waiting.push(c.wb);
        else { admitted.push(c.wb); add(c, c.minimumW); }
    };
    due.forEach(admit);
    // If the hardware minima cannot run concurrently, finish the admitted
    // departure earlier so the waiting car can actually use the freed time.
    const sharingTime = waiting.length > 0;
    for (const c of due) {
        if (!watts[c.wb]) continue;
        const additional = Math.min(room(c), Math.max(0, (sharingTime ? c.capW : c.departureW) - watts[c.wb]));
        add(c, Math.floor(additional / c.stepW) * c.stepW);
    }
    entries.filter(c => !(c.departureW > 0)).forEach(admit);
    let extra = Math.max(0, Math.min(hard, Math.max(0, Number(budgetW) || 0),
        entries.reduce((sum, c) => sum + c.capW, 0)) - minimumTotalW);
    for (const c of entries) {
        if (waiting.includes(c.wb)) continue;
        const add = Math.min(extra, Math.max(0, c.capW - watts[c.wb]));
        watts[c.wb] += add;
        extra -= add;
    }
    return {watts, minimumTotalW, admitted, waiting};
}

function wallboxPriorityRequest(now = Date.now()) {
    const configured = numericValue(nativeConfig.wallboxPriority ?? -2);
    const source = String(nativeConfig.wallboxPrioritySource || 'auto');
    const external = source === 'external' || source === 'auto' && configured === -2;
    const state = external ? getState(CFG.dp.wallboxPriority) : null;
    const value = external ? numericValue(state?.val) : configured;
    const sourceLabel = external ? `extern: ${CFG.dp.wallboxPriority || 'nicht konfiguriert'}` : 'intern';
    // A preference is a retained user command, so ack=false is legitimate and
    // an unchanged timestamp does not expire it. It is not an actuator ACK.
    const sourceValid = ['auto', 'internal', 'external'].includes(source)
        && (!external || state && typeof state.ack === 'boolean' && !state.q
            && Number.isFinite(state.ts) && state.ts > 0 && state.ts <= now + 1000);
    const valid = Boolean(sourceValid && Number.isInteger(value) && [-2, -1, 0, 1, 2].includes(value));
    const explicit = valid && [0, 1, 2].includes(value);
    return {index: explicit ? value : -1, explicit, valid, source: sourceLabel,
        reason: !valid ? `Prioritaetsvorgabe ungueltig (${sourceLabel}); automatische Auswahl`
            : explicit ? `Manuelle Prioritaet Wallbox ${value} (${sourceLabel})`
                : `Automatische Auswahl (${sourceLabel}; keine manuelle Wallbox)`};
}

function wallboxPriorityVehicleUnplugged(priority, now) {
    if (!priority.explicit) return false;
    const car = vehiclePriceActualState(CFG.dp.wallboxCar[priority.index]);
    // The last acknowledged car state can remain unchanged while unplugged.
    return car?.ack === true && !car.q && Number.isFinite(car.ts)
        && car.ts > 0 && car.ts <= now + 1000 && numericValue(car.val) === 1;
}

function allWallboxesUnplugged(now) {
    const maximumAgeMs = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
    const confirmed = state => state?.ack === true && !state.q && Number.isFinite(state.ts)
        && state.ts > 0 && state.ts <= now + 1000;
    return [0, 1, 2].every(wb => {
        if (nativeConfig[`wb${wb}Present`] !== true
            && getState(`${CFG.root}.Devices.Wallbox${wb}.Present`)?.val !== true) return true;
        const car = vehiclePriceActualState(CFG.dp.wallboxCar[wb]);
        if (!confirmed(car) || now - car.ts > maximumAgeMs || numericValue(car.val) !== 1) return false;
        const connectionId = nativeConfig[`wb${wb}ConnectionId`];
        if (!connectionId) return true;
        const connection = vehiclePriceActualState(connectionId);
        return confirmed(connection) && [true, 1, '1'].includes(connection.val);
    });
}

function compareWallboxSocGap(a, b) {
    const gap = vehicle => vehicle.socValid ? Math.max(0, vehicle.targetSocPct - vehicle.socPct) : -1;
    return gap(b) - gap(a);
}

function updateVehicles() {
    const now = Date.now();
    const parallelCharging = parallelWallboxChargingEnabled();
    const parallelVoltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const planWithoutSoc = Boolean(getState(`${CFG.root}.Config.WallboxPlanWithoutSoC`)?.val);
    const efficiency = Math.max(0.5, Math.min(1,
        readNumber(`${CFG.root}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const priorityRequest = wallboxPriorityRequest(now);
    const selectedPriorityIndex = priorityRequest.index;
    write(`${CFG.root}.Control.WallboxPrioritySource`, priorityRequest.source);
    const legacyBasePriority = [0.02, 0.01, 0.03];

    for (let wb = 0; wb < 3; wb++) {
        const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
        const configuredPresent = Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.Present`)?.val);
        const carState = readNumber(CFG.dp.wallboxCar[wb], 1);
        const connected = configuredPresent && [2, 3, 4].includes(carState);
        const socSample = vehicleSocSample(wb, now);
        const socValid = socSample.valid;
        const soc = socSample.value;
        const baseMinimum = configuredVehicleMinimumSoc(wb);
        const baseTarget = configuredVehicleTargetSoc(wb, baseMinimum);
        const booking = datedWallboxTrip(wb);
        const targetSoc = booking ? wallboxChargeTarget(wb, now, booking, baseMinimum) : baseTarget;
        const departureTimestamp = wallboxDepartureAt(wb, now, booking);
        const deadlineEnabled = Boolean(vehicleSetting(wb, 'DeadlineEnabled', false));
        const deadlineTargetSocEnabled = !wallboxMorningEnabled(wb) && !booking && deadlineEnabled && vehicleSetting(wb, 'DeadlineTargetSocEnabled', false) === true;
        const legacyRelease = Math.max(0, Math.min(2,
            Math.round(readNumber(CFG.dp.wallboxSocRelease[wb], 0))));
        const userRelease = Boolean(readNumber(CFG.dp.wallboxAllow[wb], 1));
        const capacity = Math.max(0.1,
            readNumber(`${CFG.root}.Config.Wallbox${wb}VehicleCapacity_kWh`, 50));
        const maximumPower = Math.max(0,
            readNumber(`${CFG.root}.Config.Wallbox${wb}MaxPower_W`, 11000));
        const reportedSoc = vehiclePriceSocSample(wb, now);
        const priceSession = updateVehiclePriceSession(wb, {socValid: reportedSoc.valid,
            gridEnergyKWh: Math.max(0, (targetSoc - reportedSoc.value) / 100 * capacity / efficiency), departureTimestamp,
            deadlineEnabled, capacityKWh: capacity, efficiency, now});
        const chargeSoc = (booking ? priceSession.readinessSocPct : null) ?? soc;
        const trip = datedWallboxChargePlan(wb, now, socValid ? chargeSoc : null, booking);
        const minimumSoc = trip?.floor ?? baseMinimum;
        const readinessSoc = trip?.morning ? chargeSoc : priceSession.readinessSocPct ?? soc;
        const readiness = wallboxReadinessPolicy(wb, minimumSoc, now, priceSession, departureTimestamp, readinessSoc);
        const belowMinimum = socValid && readinessSoc < (readiness?.reservePct ?? minimumSoc);
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
        // Parallel service reserves one-phase minima for every below-minimum
        // car. The WB0 SoC boost uses capacity after these reservations.
        const parallelMinimum = parallelCharging && belowMinimum;
        const minimumPhases = parallelMinimum ? 1 : phases;
        const minimumVoltage = parallelMinimum ? parallelVoltage : 230;
        const baseMinimumA = Math.max(parallelMinimum ? 6 : 0,
            readNumber(`${r}.${minimumPhases === 3 ? 'MinCurrent3P_A' : 'MinCurrent1P_A'}`, 6));
        const requestedMinimumA = parallelMinimum ? Math.max(baseMinimumA, manualMinimumA)
            : Math.max(manualMinimumA, lowSocMinimumA);
        const configuredMaximumA = readNumber(`${r}.${minimumPhases === 3 ? 'MaxCurrent3P_A' : 'MaxCurrent1P_A'}`, 16);
        const taperedMaximumA = taperCurrentLimit(wb, soc, targetSoc, configuredMaximumA);
        const safeMaximumA = Math.max(0, Math.min(taperedMaximumA,
            Math.floor(maximumPower / (minimumVoltage * minimumPhases))));
        const effectiveMinimumA = appliedMinimumCurrent(baseMinimumA, requestedMinimumA, safeMaximumA);
        const minimumPower = effectiveMinimumA <= 0 ? 0 : parallelMinimum
            ? effectiveMinimumA * minimumVoltage : Math.max(
                readNumber(`${r}.DefaultMinimumPower_W`, 1380), effectiveMinimumA * 230 * phases);
        const missingBatteryKWh = socValid
            ? Math.max(0, (targetSoc - soc) / 100 * capacity)
            : 0;
        const gridEnergyKWh = missingBatteryKWh / efficiency;
        // An ordinary departure reserves only the minimum. Keep the upper
        // target for PV, price charging and the explicitly selected target deadline.
        const departureEnergyKWh = deadlineEnabled && !deadlineTargetSocEnabled
            ? Math.max(0, minimumSoc - readinessSoc) / 100 * capacity / efficiency : gridEnergyKWh;
        const chargingDurationMs = maximumPower > 0
            ? departureEnergyKWh / (maximumPower / 1000) * 60 * 60 * 1000
            : 0;
        const latestStartTimestamp = trip ? trip.latestStart : departureTimestamp > 0 && (!deadlineEnabled || socValid && chargingDurationMs > 0)
            ? departureTimestamp - chargingDurationMs : 0;
        const targetDeadlineDue = deadlineTargetSocEnabled && !readiness && latestStartTimestamp > 0
            && now >= latestStartTimestamp && !(priceSession.readinessSocPct !== undefined && readinessSoc >= minimumSoc);
        const socTargetReached = socValid && soc >= targetSoc;
        const manualPriceEligible = priceSession.priceSessionValid && priceSession.priceRemainingKWh > 0;
        const energyTargetReached = socValid && priceSession.priceChargingEnabled && priceSession.priceSessionValid
            && priceSession.priceRemainingKWh <= 0;
        const targetReached = socTargetReached || energyTargetReached;
        // socfrei is comparison telemetry only. A missing/stale legacy script
        // cannot veto a manual minimum or authorize import with invalid EMS SoC.
        // The same qualified (optionally energy-estimated) SoC and target gates
        // apply to ordinary charging and the explicit manual minimum.
        const manualMinimumActive = socValid && manualMinimumA > 0;
        const noDrawPaused = getState(`${CFG.root}.Devices.Wallbox${wb}.NoDrawPaused`)?.val === true;
        const mustCharge = configuredPresent && connected && userRelease && !targetReached && !noDrawPaused
            && phaseControl.phaseControlValid
            && (belowMinimum || manualMinimumActive || targetDeadlineDue);
        const release = configuredPresent && connected && userRelease && !targetReached && !noDrawPaused
            && phaseControl.phaseControlValid
            && (socValid || planWithoutSoc || manualPriceEligible);
        qualifiedDepartureSoc[wb] = socValid ? soc : null;
        if (!release || !socValid || readiness || readinessSoc >= minimumSoc
            || !trip?.morning && (!departureTimestamp || !deadlineEnabled)) liveDepartureGrants[wb] = null;
        const selectedPriority = selectedPriorityIndex === wb;
        // Keep the existing priority weights, using EMS minimum/must-charge
        // state and explicit user permission rather than external socfrei.
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
        else if (!socValid && !planWithoutSoc && !manualPriceEligible) status = 'SoC fehlt oder ist ungueltig';
        else if (noDrawPaused) status = wallboxAllocationPolicy.finishedPause(
            getState(`${CFG.root}.Devices.Wallbox${wb}.NoDrawPause_JSON`)?.val, now)
            ? 'Ladeende von Wallbox gemeldet; andere Fahrzeuge haben Vorrang; SoC und Fahrzeug-Ladelimit bitte pruefen'
            : '15 Minuten ohne Leistungsaufnahme; Ladeversuch pausiert, andere Fahrzeuge haben Vorrang';
        else if (socTargetReached) status = `Ziel-SoC erreicht (${soc} >= ${targetSoc} %)`;
        else if (energyTargetReached) status = 'Gemessene Ladeenergie deckt den Zielbedarf; warte auf naechsten SoC-Wert';
        else if (trip?.morning && socValid && soc < trip.reserve)
            status = `Sofortladung bis zur Mobilitaetsreserve von ${trip.reserve} %`;
        else if (trip?.morning && socValid && soc < minimumSoc && trip.latestStart > 0 && now >= trip.latestStart)
            status = `Nachladung zur gebuchten Abfahrt auf ${trip.gridGoal} %`;
        else if (trip?.morning && socValid && soc < baseMinimum)
            status = morningChargeActive(trip.morning, now)
                ? `Morgenladung auf ${baseMinimum} % bis 06:00 Uhr` : `PV nutzbar, Mindest-SoC ${baseMinimum} % bis 06:00 Uhr`;
        else if (readiness?.backupUntil && socValid && readinessSoc < minimumSoc)
            status = (readiness.minimumByDeparture ? 'PV-Ueberschuss freigegeben, ' : 'Warten auf PV; ')
                + 'abgesicherte Nachladung ab '
                + new Date(readiness.releaseAt).toTimeString().slice(0, 5) + `, Mindest-SoC ${minimumSoc} % bis Abfahrt`;
        else if (readiness?.releaseAt && socValid && readinessSoc < minimumSoc)
            status = (belowMinimum ? 'Laden bis ' + readiness.reservePct + ' %' : 'Warten auf PV')
                + `; PV-Fenster ab ${new Date(readiness.releaseAt).toTimeString().slice(0, 5)}, Mindest-SoC ${minimumSoc} % bis Abfahrt`;
        else if (mustCharge && belowMinimum && readiness)
            status = `Pflichtladung: unter Mobilitaetsreserve ${readiness.reservePct} %`;
        else if (mustCharge && belowMinimum)
            status = parallelMinimum
                ? effectiveMinimumA > 0
                    ? `Parallele Mindestladung: unter Mindest-SoC; mindestens ${effectiveMinimumA} A einphasig angefordert; Mehrleistung nach Prioritaet`
                    : 'Parallele Mindestladung wartet: wirksame Stromgrenze unter zulaessigem Mindeststrom'
                : `Pflichtladung: unter Mindest-SoC; mindestens ${effectiveMinimumA} A`;
        else if (manualMinimumActive) status = `Manueller Mindeststrom aktiv: ${effectiveMinimumA} A`;
        else if (mustCharge && targetDeadlineDue) status = `Netzladung bis zum Ziel-SoC zur Abfahrt freigegeben (${targetSoc} %)`;
        else if (readiness && socValid && readinessSoc < minimumSoc)
            status = `Mindest-SoC ${minimumSoc} % bis Abfahrt; Preisfahrplan aktiv`;
        else if (manualPriceEligible && !socValid && !planWithoutSoc) status = priceSession.priceStatus;
        else if (release) status = `PV-flexibel: ${missingBatteryKWh.toFixed(1)} kWh fehlen bis ${targetSoc} %`;
        else status = 'Keine EMS-Ladefreigabe';

        write(`${r}.Connected`, connected);
        write(`${r}.CarState`, carState);
        write(`${r}.SoC_pct`, socValid ? Math.round(soc * 10) / 10 : null);
        write(`${r}.SoCValid`, socValid);
        const reportedQuality = vehicleReportedSocSample(wb, now);
        write(`${r}.SoCStale`, reportedQuality.stale);
        write(`${r}.SoCAge_s`, reportedQuality.ageS);
        write(`${r}.SoCReportedAt`, reportedQuality.timestamp);
        write(`${r}.SoCStatus`, vehicleSocEstimator.socStatus({...socSample, valid: socValid}, reportedQuality));
        write(`${r}.SoCSource`, socSample.manual ? 'manual-correction' : socSample.estimated ? 'energy-estimate' : CFG.dp.wallboxSoc[wb]);
        write(`${r}.DeparturePlan_JSON`, JSON.stringify({controlEnabled: deadlineEnabled, zone: wallboxDepartureZone,
            gridDefault: vehicleSetting(wb, 'DeadlineTargetSocEnabled', false) === true,
            configuredMin: baseMinimum, configuredMax: baseTarget, ...trip}));
        write(`${r}.MinimumSoC_pct`, baseMinimum);
        write(`${r}.TargetSoC_pct`, targetSoc);
        write(`${r}.LegacySoCRelease`, legacyRelease);
        write(`${r}.UserRelease`, userRelease);
        write(`${r}.Release`, release);
        write(`${r}.MustCharge`, mustCharge);
        write(`${r}.BelowMinimum`, belowMinimum);
        write(`${r}.SocLimitsSource`, vehicleSetting(wb, 'SocLimitsSource', 'external') === 'admin' ? 'admin' : 'external');
        write(`${r}.TaperCurrentLimit_A`, taperCurrentLimit(wb, soc, targetSoc, 32));
        write(`${r}.ManualMinimumCurrent_A`, manualMinimumA);
        write(`${r}.LowSocMinimumCurrent_A`, lowSocMinimumA);
        write(`${r}.RequestedMinimumCurrent_A`, requestedMinimumA);
        const minimumConstraint = requestedMinimumA > safeMaximumA
            ? `Anforderung ${requestedMinimumA} A durch Fahrzeug-/Phasen-/Sicherheitsgrenze auf ${safeMaximumA} A begrenzt`
            : `Basis ${baseMinimumA} A; manuell ${manualMinimumA} A; ${parallelMinimum ? 'paralleles Minimum' : `niedriger SoC ${lowSocMinimumA} A`}; wirksam ${effectiveMinimumA} A`;
        const lowSocMode = lowSocMinimumA > 0 && wb === 0 && readNumber(`${r}.MaximumPhases`, 1) === 1
            ? 'bei freier Netzreserve nach den Mindeststroemen' : 'nur im sequenziellen Betrieb';
        write(`${r}.CurrentConstraintStatus`, minimumConstraint + (parallelMinimum
            ? `; niedriger-SoC-Boost ${lowSocMinimumA} A ${lowSocMode}; Mindestanforderung ${Math.round(minimumPower)} W einphasig` : ''));
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

// Invoked by a live ack=false command, never by replaying the retained value.
function applyVehicleSocCorrection(wb, state) {
    if (!state || state.ack !== false) return;
    const r = `${CFG.root}.Vehicles.Wallbox${wb}`;
    const now = Date.now();
    const capacityKWh = Number(vehicleSetting(wb, 'CapacityKWh', 0));
    const efficiencyPct = Number(vehicleSetting(wb, 'SocEfficiencyPct', 90));
    const signature = JSON.stringify([CFG.dp.wallboxSoc[wb], CFG.dp.wallboxSocEnergy[wb],
        CFG.dp.wallboxSocMeasuredAt[wb], capacityKWh, efficiencyPct]);
    const result = vehicleSetting(wb, 'SocEstimationEnabled', false) !== true
        ? {ok: false, reason: 'SoC-Schaetzung muss aktiviert sein'}
        : state.q || !Number.isFinite(state.ts) || state.ts > now + 1000 || now - state.ts > 60000
            ? {ok: false, reason: 'Ungueltiger oder veralteter Korrekturbefehl'}
            : vehicleSocEstimator.correctSoc({value: state.val, now, timestamp: state.ts, signature,
                reported: vehiclePriceActualState(CFG.dp.wallboxSoc[wb]),
                counter: vehiclePriceActualState(CFG.dp.wallboxSocEnergy[wb]),
                car: vehiclePriceActualState(CFG.dp.wallboxCar[wb]),
                ledgerText: getState(`${r}.SocEstimateLedger_JSON`)?.val || ''});
    if (result.ok) write(`${r}.SocEstimateLedger_JSON`, JSON.stringify(result.ledger));
    write(`${r}.SoCCorrectionStatus`, result.reason);
    // Always acknowledge, including same-value commands. write() suppresses
    // equal values and would otherwise leave a command pending.
    setState(`${r}.SoCCorrection_pct`, state.val, true);
    if (result.ok) {
        updateVehicles();
        requestForecastRebuild();
    }
}
