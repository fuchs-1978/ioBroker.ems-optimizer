/* One allocator, one fine regulator. Internal battery watts are +charge/-discharge.
 * The physical controllers follow these budgets; only the nominated EHZ may
 * additionally correct the grid meter. This module performs no foreign writes.
 */
'use strict';

function createEnergyCoordinationStates() {
    const values = {
        FineRegulator: 'none', HeaterBudgetMode: 'FINE', AllowHeaterGridImport: false,
        CoordinationActive: false, CoordinationStatus: 'Nicht aktiv',
        UncontrolledGridPower_W: 0, AvailablePVPower_W: 0, BatteryPVReserve_W: 0,
        HeaterPVAllocation_W: 0, HeaterCheapGridAllocation_W: 0,
        ProtectedGridImport_W: 0, GrossConsumptionTarget_W: 0
    };
    for (const [name, value] of Object.entries(values))
        stateDef(`${CFG.root}.Control.${name}`, value, typeof value,
            typeof value === 'boolean' ? 'indicator' : typeof value === 'number' ? 'value' : 'text', '', name);
}

function coordinatedEnergyEnabled() {
    return getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === true
        && (nativeConfig.batteryControlEnabled === true || nativeConfig.heatingControlEnabled === true);
}

function heaterUsesGridFeedback(deviceName) {
    if (!coordinatedEnergyEnabled()) return deviceName === 'MyPV_DHW';
    return getState(`${CFG.root}.Control.FineRegulator`)?.val === deviceName
        && getState(`${CFG.root}.Control.AllowHeaterGridImport`)?.val !== true;
}

function resetEnergyCoordination(reason) {
    const r = `${CFG.root}.Control`;
    write(`${r}.CoordinationActive`, false);
    write(`${r}.CoordinationStatus`, reason);
    write(`${r}.FineRegulator`, 'none');
    write(`${r}.HeaterBudgetMode`, 'BUDGET');
    write(`${r}.AllowHeaterGridImport`, false);
    for (const name of ['BatteryPVReserve_W', 'HeaterPVAllocation_W',
        'HeaterCheapGridAllocation_W', 'ProtectedGridImport_W', 'GrossConsumptionTarget_W'])
        write(`${r}.${name}`, 0);
}

function coordinatedPositiveNumber(value) {
    return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

// Positive power remains reserved until the actuator has actually reduced it.
// A discharge is never credited against the gross §14a/LPC consumption budget.
function coordinatedConsumptionLoads() {
    const r = CFG.root;
    let valid = true;
    const reservedW = name => coordinatedPositiveNumber(getState(`${r}.Devices.${name}.${name === 'Battery'
        ? 'OutputReservedCharge_W' : 'OutputReservedPower_W'}`)?.val);
    const phaseHighWaterW = name => [1, 2, 3].map(p => coordinatedPositiveNumber(
        getState(`${r}.Devices.${name}.OutputReservedPhase${p}_W`)?.val));
    const relevant = name => getState(`${r}.Devices.${name}.Present`)?.val === true
        || getState(`${r}.Devices.${name}.OutputOwned`)?.val === true || reservedW(name) > 0
        || phaseHighWaterW(name).some(watts => watts > 0);
    const commandW = name => getState(`${r}.Devices.${name}.OutputOwned`)?.val === true
        ? coordinatedPositiveNumber(getState(`${r}.Devices.${name}.${name === 'Battery'
            ? 'OutputCommandInternal_W' : 'OutputCommand_W'}`)?.val) : 0;
    const measuredBattery = typeof batteryMeasuredPowerW === 'function'
        ? batteryMeasuredPowerW() : readNumber(CFG.dp.batteryPower, 0);
    if (relevant('Battery') && !Number.isFinite(measuredBattery)) valid = false;
    const batteryW = Math.max(coordinatedPositiveNumber(measuredBattery), commandW('Battery'), reservedW('Battery'));
    const dhwPhases = (CFG.dp.myPvDhwOutputW || []).map(id => freshDhwNumber(id, 120000));
    const dhwValid = dhwPhases.length === 3 && dhwPhases.every(value => value !== null && value >= 0);
    if (relevant('MyPV_DHW') && !dhwValid) valid = false;
    const dhwW = Math.max(dhwValid ? dhwPhases.reduce((sum, watts) => sum + watts, 0) : 0,
        commandW('MyPV_DHW'), reservedW('MyPV_DHW'), phaseHighWaterW('MyPV_DHW').reduce((sum, watts) => sum + watts, 0));
    const measuredHeating = typeof heatingActualPower === 'function' ? heatingActualPower() : null;
    if (relevant('MyPV_Heating') && !measuredHeating?.valid) valid = false;
    const heatingW = Math.max(coordinatedPositiveNumber(measuredHeating?.valid
        ? measuredHeating.totalW : 0),
        commandW('MyPV_Heating'), reservedW('MyPV_Heating'),
        phaseHighWaterW('MyPV_Heating').reduce((sum, watts) => sum + watts, 0));
    const voltage = Math.max(200, readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230));
    const wallboxesW = CFG.dp.wallboxesKW.map((id, wb) => {
        const base = `${r}.Devices.Wallbox${wb}`;
        const actualKW = freshDhwNumber(id,
            Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000);
        if (relevant(`Wallbox${wb}`) && (actualKW === null || actualKW < 0)) valid = false;
        const phases = readNumber(`${base}.OutputPhases`, 1) >= 3 ? 3 : 1;
        const committedW = getState(`${base}.OutputOwned`)?.val === true
            && getState(`${base}.OutputActive`)?.val === true
            ? coordinatedPositiveNumber(readNumber(`${base}.OutputCommand_A`, 0)) * voltage * phases : 0;
        const pendingW = coordinatedPositiveNumber(getState(`${base}.OutputReservedPower_W`)?.val);
        return Math.max(coordinatedPositiveNumber(actualKW) * 1000, committedW, pendingW);
    });
    const wallboxW = wallboxesW.reduce((sum, watts) => sum + watts, 0);
    return {valid, batteryW, dhwW, heatingW, wallboxW, wallboxesW,
        totalW: batteryW + dhwW + heatingW + wallboxW};
}

function coordinatedStagedPhases(powerW, stageW) {
    const watts = Math.max(0, Math.min(stageW * 3, powerW));
    if (watts <= stageW) return [watts, 0, 0];
    if (watts <= stageW * 2) return [watts - stageW, stageW, 0];
    return [watts - stageW * 2, stageW, stageW];
}

// Recheck the exact electrical value after the adapter's durable-write queue
// has drained. Allocation and output checks made before an await are not proof
// that a newly binding limit, cooling lock, or smaller budget still allows it.
// This function never issues a foreign write; zero always remains a safe stop.
function checkQueuedElectricalOutput(device, rawCommandW) {
    const fail = reason => ({allowed: false, reason});
    if (typeof rawCommandW !== 'number' || !Number.isFinite(rawCommandW))
        return fail('Elektrischer Stellwert ist keine endliche Zahl');
    if (!['Battery', 'MyPV_DHW', 'MyPV_Heating'].includes(device))
        return fail('Unbekannter elektrischer Ausgang');
    if (rawCommandW === 0) return {allowed: true, reason: 'Sicherer Nullbefehl'};
    if (device !== 'Battery' && rawCommandW < 0) return fail('Heizleistung darf nicht negativ sein');
    const r = CFG.root;
    const limit = currentConsumptionLimit();
    if (!limit.valid) return fail(limit.reason);
    const internalW = device === 'Battery' ? -rawCommandW : rawCommandW;
    const grossCommandW = Math.max(0, internalW);
    const targetState = getState(`${r}.Control.Targets.${device === 'Battery' ? 'Battery' : device}_W`);
    const targetW = typeof targetState?.val === 'number' ? targetState.val : NaN;
    if (!Number.isFinite(targetW) || (internalW > 0 && targetW < internalW)
        || (internalW < 0 && targetW > internalW))
        return fail('Aktuelles EMS-Leistungsbudget erlaubt den wartenden Stellwert nicht mehr');
    if (limit.budgetW !== null) {
        let otherW = 0;
        if (coordinatedEnergyEnabled()) {
            const loads = coordinatedConsumptionLoads();
            if (!loads.valid) return fail('Gemeinsame Verbrauchermessung fehlt/veraltet');
            const ownW = device === 'Battery' ? loads.batteryW : device === 'MyPV_DHW' ? loads.dhwW : loads.heatingW;
            otherW = Math.max(0, loads.totalW - ownW);
        } else {
            // Keep the legacy DHW-only/WB contract; inactive observer battery
            // and heating sensors cannot make an alpha16 output dependent on
            // new optional AC telemetry that has not been configured.
            for (const wb of realtimeProductionScope().wallboxes) {
                const actualKW = freshDhwNumber(CFG.dp.wallboxesKW[wb], 120000);
                if (actualKW === null || actualKW < 0) return fail('Wallbox-Leistung fuer LPC fehlt/veraltet');
                otherW += actualKW * 1000;
            }
        }
        if (grossCommandW > Math.max(0, limit.budgetW - otherW))
            return fail('Zwischenzeitlich bindendes gemeinsames LPC-Verbrauchsbudget');
    }
    if (device === 'Battery') {
        if (typeof batteryRegulationState !== 'function') return fail('Batteriemodul fehlt');
        const state = batteryRegulationState();
        if (!state.available || (internalW > 0 && !state.canCharge) || (internalW < 0 && !state.canDischarge))
            return fail(state.reason || 'Batterie-/SoC-Freigabe entzogen');
        if (internalW > state.maxChargeW || internalW < -state.maxDischargeW)
            return fail('Batterie-Leistungsgrenze unterschritten/ueberschritten');
        const capW = batteryHouseConnectionCapW(state.actualW);
        if (capW === null || internalW > capW) return fail('Hausanschluss begrenzt wartenden Batteriebefehl');
    } else if (device === 'MyPV_Heating') {
        const thermal = evaluateHeatingSimulation();
        const actual = heatingActualPower();
        if (!thermal.release || rawCommandW > thermal.thermalCapW)
            return fail(thermal.reason || 'Heizpuffer thermisch/Kuehlbetrieb gesperrt');
        if (!actual.valid || heatingPhaseLimitW(rawCommandW, actual.phases) < rawCommandW)
            return fail('Hausanschluss begrenzt wartenden Heizpufferbefehl');
    } else {
        const thermal = evaluateDhwSimulation();
        const capW = Math.min(thermal.temperaturePowerLimitW || 0,
            readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000));
        if (!thermal.release || rawCommandW > capW)
            return fail(thermal.reason || 'Trinkwasser thermisch gesperrt');
        if (phaseLimitedDhwPower(rawCommandW) < rawCommandW)
            return fail('Hausanschluss begrenzt wartenden Trinkwasserbefehl');
    }
    return {allowed: true, reason: 'Stellwert gegen aktuelle elektrische und thermische Grenzen geprueft'};
}

// Reserve positive per-phase changes already sent to another actuator. A
// reduction is not spendable until its real phase power has fallen. This also
// covers an EHZ stage crossing: +1 W total may switch a whole 3 kW stage on.
// The battery's grid phase is not verified, so reserve its whole positive
// increment conservatively on EACH phase instead of guessing a topology.
function coordinatedPhaseReservations(excludeDevice = '') {
    const r = CFG.root;
    const gross = coordinatedConsumptionLoads();
    let valid = gross.valid;
    const ownedCommand = name => getState(`${r}.Devices.${name}.OutputOwned`)?.val === true
        ? Math.max(0, readNumber(`${r}.Devices.${name}.OutputCommand_W`, 0)) : 0;
    const positiveDelta = (command, actual) => command.map((watts, p) => Math.max(0, watts - (actual[p] || 0)));
    const dhwActual = (CFG.dp.myPvDhwOutputW || []).map(id => freshDhwNumber(id, 120000));
    const heatingActual = typeof heatingActualPower === 'function' ? heatingActualPower() : null;
    const phaseHighWater = (name, phases) => phases.map((watts, p) => Math.max(watts,
        readNumber(`${r}.Devices.${name}.OutputReservedPhase${p + 1}_W`, 0)));
    const dhwW = positiveDelta(phaseHighWater('MyPV_DHW',
        coordinatedStagedPhases(ownedCommand('MyPV_DHW'), 3000)), dhwActual);
    const heatingW = positiveDelta(phaseHighWater('MyPV_Heating',
        coordinatedStagedPhases(ownedCommand('MyPV_Heating'), 2000)),
        heatingActual?.phases || [0, 0, 0]);
    const batteryActual = typeof batteryMeasuredPowerW === 'function' ? batteryMeasuredPowerW() : null;
    const batteryCommand = getState(`${r}.Devices.Battery.OutputOwned`)?.val === true
        ? readNumber(`${r}.Devices.Battery.OutputCommandInternal_W`, 0) : 0;
    const batteryIncrementW = Math.max(0, Math.max(batteryCommand,
        readNumber(`${r}.Devices.Battery.OutputReservedCharge_W`, 0)) - (batteryActual || 0));
    const batteryW = [batteryIncrementW, batteryIncrementW, batteryIncrementW];
    const wallboxesW = [0, 1, 2].map(wb => {
        const base = `${r}.Devices.Wallbox${wb}`;
        const present = getState(`${base}.Present`)?.val === true
            || getState(`${base}.OutputOwned`)?.val === true;
        if (!present) return [0, 0, 0];
        const currents = (CFG.dp.wallboxPhaseCurrents[wb] || []).map(id => freshDhwNumber(id,
            Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000));
        if (currents.length !== 3 || currents.some(amps => amps === null || amps < 0)) valid = false;
        const phases = readNumber(`${base}.OutputPhases`, 1) >= 3 ? 3 : 1;
        const configuredPhase = Number(nativeConfig[`wb${wb}SinglePhaseGridPhase`] ?? 1);
        if (![1, 2, 3].includes(configuredPhase)) valid = false;
        const phase = clamp(configuredPhase - 1, 0, 2);
        const pendingW = Math.max(readNumber(`${base}.OutputReservedPower_W`, 0),
            getState(`${base}.OutputOwned`)?.val === true
                ? readNumber(`${base}.OutputCommand_A`, 0) * 230 * phases : 0);
        const actualPhases = phases === 3 ? currents.map(amps => (amps || 0) * 230)
            : [0, 1, 2].map(p => p === phase ? Math.max(...currents.map(amps => amps || 0)) * 230 : 0);
        const commandedPhases = [0, 1, 2].map(p => phases === 3 ? pendingW / 3 : p === phase ? pendingW : 0);
        return positiveDelta(commandedPhases, actualPhases);
    });
    const totalsW = [0, 1, 2].map(p => dhwW[p] + heatingW[p] + batteryW[p]
        + wallboxesW.reduce((sum, watts) => sum + watts[p], 0));
    const excludedW = excludeDevice === 'Battery' ? batteryW : excludeDevice === 'MyPV_DHW' ? dhwW
        : excludeDevice === 'MyPV_Heating' ? heatingW
            : /^Wallbox[012]$/.test(excludeDevice) ? wallboxesW[Number(excludeDevice.slice(-1))] : [0, 0, 0];
    return {valid, totalsW, batteryW, dhwW, heatingW, wallboxesW,
        otherW: totalsW.map((watts, p) => Math.max(0, watts - excludedW[p]))};
}

function splitCoordinatedHeaters(totalW, dhwCapW, heatingCapW) {
    const availableW = Math.max(0, Math.min(totalW, dhwCapW + heatingCapW));
    // A cold DHW tank retains its established priority. Otherwise independent
    // tanks with headroom run together, proportional to their usable powers.
    const mustHeat = getState(`${CFG.root}.Devices.MyPV_DHW.MustHeat`)?.val === true;
    let dhwW = mustHeat ? Math.min(dhwCapW, availableW)
        : dhwCapW + heatingCapW > 0 ? availableW * dhwCapW / (dhwCapW + heatingCapW) : 0;
    let heatingW = Math.min(heatingCapW, availableW - dhwW);
    // DHW's stratification and minimum-power rules are authoritative. Reassign
    // unusable small remainders to HK, not to a phantom DHW target.
    dhwW = dhwCapW > 0 ? simulateDhwTarget(Math.min(dhwCapW, Math.floor(dhwW))) : 0;
    heatingW = Math.min(heatingCapW, Math.max(0, availableW - dhwW));
    return {dhwW, heatingW: Math.floor(heatingW)};
}

function coordinatedFineRegulator(battery, actualBatteryW, batteryTargetW,
    gridErrorW, dischargeLimitW, dhwCapW, heatingCapW, deadbandW) {
    const toleranceW = Math.max(20, deadbandW);
    let batteryHasRoom = false;
    if (battery.available) {
        if (gridErrorW < -toleranceW) batteryHasRoom = battery.canCharge
            && actualBatteryW < battery.maxChargeW - toleranceW;
        else if (gridErrorW > toleranceW) batteryHasRoom = actualBatteryW > toleranceW
            || (battery.canDischarge && dischargeLimitW > toleranceW
                && actualBatteryW > -dischargeLimitW + toleranceW);
        else batteryHasRoom = (battery.canCharge && batteryTargetW >= 0
            && batteryTargetW < battery.maxChargeW - toleranceW)
            || (battery.canDischarge && batteryTargetW < 0
                && batteryTargetW > -dischargeLimitW + toleranceW);
    }
    if (batteryHasRoom) return 'Battery';
    return dhwCapW > 0 ? 'MyPV_DHW' : heatingCapW > 0 ? 'MyPV_Heating' : 'none';
}

function coordinatedRealtimeControl(input) {
    const {now, gridW, targetGridW, deadbandW, errorW, batteryPlan, dhwPlan,
        heatingPlan, boostPlan, wallboxPlans, consumptionLimit} = input;
    const r = CFG.root;
    const scope = realtimeProductionScope();
    const battery = typeof batteryRegulationState === 'function' ? {...batteryRegulationState()}
        : {available: false, reason: 'Batteriemodul nicht verfuegbar', actualW: 0,
            canCharge: false, canDischarge: false, maxChargeW: 0, maxDischargeW: 0};
    const heating = typeof evaluateHeatingSimulation === 'function' ? evaluateHeatingSimulation()
        : {available: false, release: false, thermalCapW: 0, actualW: 0};
    const liveLoads = coordinatedConsumptionLoads();
    if (!liveLoads.valid)
        return zeroRealtimeTargets('Gemeinsame Verbrauchermessung fehlt/veraltet; keine belastbare Leistungsverteilung');
    // Do not nominate the storage for absorption when its physical phase
    // headroom is already exhausted. The EHZ must get the fast fallback then.
    if (battery.available && typeof batteryHouseConnectionCapW === 'function') {
        const houseCapW = batteryHouseConnectionCapW(battery.actualW);
        if (houseCapW === null) {
            battery.available = false;
            battery.canCharge = false;
            battery.canDischarge = false;
        } else {
            battery.maxChargeW = Math.max(0, Math.min(battery.maxChargeW, houseCapW));
            battery.canCharge = battery.canCharge && battery.maxChargeW > Math.max(0, battery.deadbandW || 0);
        }
    }
    const heatingArmed = nativeConfig.globalWriteEnabled === true
        && nativeConfig.heatingPresent === true && nativeConfig.heatingControlEnabled === true
        && nativeConfig.heatingProductionArmed === true
        && getState(`${r}.Devices.MyPV_Heating.DriverReady`)?.val === true
        && getState(`${r}.Devices.MyPV_Heating.ControlEnabled`)?.val === true
        && getState(`${r}.Devices.MyPV_Heating.Present`)?.val === true;
    const heatingCapW = heatingArmed && heating.available && heating.release
        ? Math.max(0, Number(heating.thermalCapW) || 0) : 0;
    const dhwCapW = scope.dhw && getState(`${r}.Devices.MyPV_DHW.Release`)?.val === true
        ? Math.max(0, Math.min(readNumber(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0),
            readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000))) : 0;
    const heaterCapW = dhwCapW + heatingCapW;
    const dhwMeasurements = (CFG.dp.myPvDhwOutputW || []).map(id => freshDhwNumber(id, 120000));
    const actualDhwW = dhwMeasurements.length === 3 && dhwMeasurements.every(Number.isFinite)
        ? Math.max(0, dhwMeasurements.reduce((sum, watts) => sum + watts, 0)) : 0;
    const actualHeatingW = Number.isFinite(heating.actualW) ? Math.max(0, heating.actualW) : 0;
    const measuredBattery = typeof batteryMeasuredPowerW === 'function' ? batteryMeasuredPowerW()
        : readNumber(CFG.dp.batteryPower, 0);
    const actualBatteryW = Number.isFinite(measuredBattery) ? measuredBattery : 0;
    const actualWallboxesW = CFG.dp.wallboxesKW.map(id => Math.max(0,
        (freshDhwNumber(id, Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000) || 0) * 1000));
    const controlledWallboxesW = actualWallboxesW.reduce((sumW, watts, wb) => sumW
        + (scope.wallboxes.includes(wb) ? watts : 0), 0);
    // Remove the REAL battery measurement as well as the real flexible loads.
    // Otherwise its previous charge is mistaken for house load and its previous
    // discharge can create fictitious surplus for EVs/heaters.
    const controlledDhwW = scope.dhw ? actualDhwW : 0;
    const controlledHeatingW = heatingArmed ? actualHeatingW : 0;
    const actualFlexibleW = controlledDhwW + controlledHeatingW + controlledWallboxesW;
    // External/disabled battery charging is not ours to reclaim. Conversely
    // external discharge must always be removed, or it would look like PV.
    const reclaimableBatteryW = actualBatteryW < 0 || battery.available
        || getState(`${r}.Devices.Battery.OutputOwned`)?.val === true ? actualBatteryW : 0;
    const baseGridW = gridW - actualFlexibleW - reclaimableBatteryW;
    const pvAvailableW = Math.max(0, targetGridW - baseGridW);
    if (typeof updateHeatPumpAdvice === 'function') updateHeatPumpAdvice(now, pvAvailableW);
    const consumptionBudgetW = consumptionLimit.budgetW === null ? Infinity
        : Math.max(0, consumptionLimit.budgetW);
    const plannedChargeW = Math.max(0, Number(batteryPlan.valueW) || 0);
    const fineReserveW = Math.max(0, readNumber(`${r}.Config.BatteryFineReserve_W`, 200));
    const batteryReserveW = battery.available && battery.canCharge
        ? Math.min(battery.maxChargeW, pvAvailableW, consumptionBudgetW,
            Math.max(plannedChargeW, fineReserveW)) : 0;
    const slowBudgetW = Math.max(0, consumptionBudgetW - batteryReserveW);
    // Reuse the physical WB ownership, start-delay and quantization logic.
    // Recompute caps each fast tick so a cooling lock/cloud cannot wait for a
    // slower device cycle. Actuator ramps, not budgets, implement the cadence.
    updateSlowTargets(Math.max(0, pvAvailableW - batteryReserveW), wallboxPlans,
        heatingPlan, slowBudgetW, {heaterCapW});
    const wallboxAllocationW = slowTargets.wallboxExpectedW.reduce((sum, watts) => sum + watts, 0);
    const pvHeatW = Math.min(heaterCapW, Math.max(0, slowTargets.dhwW));
    const price = typeof evaluateThermalPricePolicy === 'function'
        ? evaluateThermalPricePolicy(now) : {cheapAllowed: false};
    const cheapLimitW = price.valid && price.cheapAllowed
        ? Math.max(0, readNumber(`${r}.Config.ThermalCheapGridMax_W`, 0)) : 0;
    const cheapHeatW = Math.min(cheapLimitW, Math.max(0, heaterCapW - pvHeatW),
        Math.max(0, consumptionBudgetW - batteryReserveW - wallboxAllocationW - pvHeatW));
    const heaters = splitCoordinatedHeaters(pvHeatW + cheapHeatW, dhwCapW, heatingCapW);
    slowTargets.dhwW = heaters.dhwW;
    slowTargets.heatingW = heaters.heatingW;
    const allocatedHeatW = heaters.dhwW + heaters.heatingW;
    const protectedHeatW = Math.min(cheapHeatW, allocatedHeatW);
    const pvHeatAllocatedW = Math.max(0, allocatedHeatW - protectedHeatW);
    // Only actually present cheap heat is protected. A pending heat command
    // must not make the battery start charging from the grid while it ramps.
    const actualCheapHeatW = Math.min(protectedHeatW,
        Math.max(0, controlledDhwW + controlledHeatingW - pvHeatAllocatedW));
    const desiredBatteryW = targetGridW - baseGridW - actualFlexibleW + actualCheapHeatW;
    // Discharge may supply the uncontrolled HOUSE only, never a discretionary
    // EV/heater and never a mandatory or intentional cheap-import load.
    const dischargeLimitW = battery.available && battery.canDischarge
        ? Math.min(battery.maxDischargeW, Math.max(0, baseGridW)) : 0;
    const reservations = coordinatedConsumptionLoads();
    if (consumptionBudgetW !== Infinity && !reservations.valid)
        return zeroRealtimeTargets('Gemeinsame Verbrauchermessung fuer LPC-Budget fehlt/ungueltig');
    const chargeLimitW = battery.available && battery.canCharge
        && (consumptionBudgetW === Infinity || reservations.valid)
        ? Math.min(battery.maxChargeW,
            Math.max(0, consumptionBudgetW - Math.max(reservations.dhwW, heaters.dhwW)
                - Math.max(reservations.heatingW, heaters.heatingW)
                - Math.max(reservations.wallboxW, wallboxAllocationW))) : 0;
    const batteryTargetW = battery.available
        ? Math.round(clamp(desiredBatteryW, -dischargeLimitW, chargeLimitW)) : 0;
    const fineRegulator = coordinatedFineRegulator(battery, actualBatteryW, batteryTargetW,
        gridW - targetGridW - actualCheapHeatW, dischargeLimitW, dhwCapW, heatingCapW, deadbandW);
    const heaterBudgetMode = fineRegulator === 'Battery' || protectedHeatW > 0 ? 'BUDGET' : 'FINE';
    const predictedGridW = Math.round(baseGridW + wallboxAllocationW + allocatedHeatW + batteryTargetW);
    const protectedMandatoryW = Math.max(0, wallboxAllocationW - pvAvailableW);
    write(`${r}.Control.CoordinationActive`, true);
    write(`${r}.Control.FineRegulator`, fineRegulator);
    write(`${r}.Control.HeaterBudgetMode`, heaterBudgetMode);
    write(`${r}.Control.AllowHeaterGridImport`, protectedHeatW > 0);
    write(`${r}.Control.UncontrolledGridPower_W`, Math.round(baseGridW));
    write(`${r}.Control.AvailablePVPower_W`, Math.round(pvAvailableW));
    write(`${r}.Control.BatteryPVReserve_W`, Math.round(batteryReserveW));
    write(`${r}.Control.HeaterPVAllocation_W`, Math.round(pvHeatAllocatedW));
    write(`${r}.Control.HeaterCheapGridAllocation_W`, Math.round(protectedHeatW));
    write(`${r}.Control.ProtectedGridImport_W`, Math.round(protectedHeatW + protectedMandatoryW));
    write(`${r}.Control.GrossConsumptionTarget_W`, Math.round(Math.max(0, batteryTargetW)
        + allocatedHeatW + wallboxAllocationW));
    write(`${r}.Control.ActualGridPower_W`, Math.round(gridW));
    write(`${r}.Control.PredictedGridPower_W`, predictedGridW);
    write(`${r}.Control.Error_W`, Math.round(errorW));
    write(`${r}.Control.RemainingError_W`, predictedGridW - targetGridW - Math.round(protectedHeatW));
    write(`${r}.Control.PlanSlotTimestamp`, Math.max(Number(batteryPlan.timestamp), Number(dhwPlan.timestamp)));
    write(`${r}.Control.Targets.Battery_W`, batteryTargetW);
    write(`${r}.Control.Targets.MyPV_DHW_W`, slowTargets.dhwW);
    write(`${r}.Control.Targets.MyPV_Heating_W`, slowTargets.heatingW);
    for (const wb of [0, 1, 2]) {
        write(`${r}.Control.Targets.Wallbox${wb}_W`, slowTargets.wallboxW[wb]);
        write(`${r}.Control.Targets.Wallbox${wb}_A`, slowTargets.wallboxA[wb]);
        write(`${r}.Control.Targets.Wallbox${wb}_Phases`, slowTargets.wallboxPhases[wb]);
        write(`${r}.Vehicles.Wallbox${wb}.RecommendedPhases`, slowTargets.wallboxRecommendedPhases[wb]);
    }
    write(`${r}.Control.Targets.PVBoostRelease`, Boolean(boostPlan?.release) && predictedGridW <= deadbandW);
    write(`${r}.Control.SlowCycleSeconds`, Math.max(2, readNumber(`${r}.Config.SlowControlCycle_s`, 5)));
    write(`${r}.Control.CoordinationStatus`, `Feinregler ${fineRegulator}; WW ${heaters.dhwW} W / HK ${heaters.heatingW} W; Batterie ${batteryTargetW} W (+Laden); erlaubter Waermenetzbezug ${Math.round(protectedHeatW)} W`);
    write(`${r}.Control.Status`, `KOORDINIERT: ${fineRegulator} fein / EHZ mittel / Wallbox grob`);
    write(`${r}.Control.Valid`, true);
    write(`${r}.Control.LastUpdate`, now);
}
