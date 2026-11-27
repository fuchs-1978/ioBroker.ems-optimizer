function percentile(values, fraction) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function freshOptionalNumber(id, maxAgeMs) {
    try {
        if (!existsState(id)) return null;
        const s = getState(id);
        const n = numericValue(s?.val);
        const timestamp = numericValue(s?.ts);
        const ageMs = timestamp === null ? Infinity : Date.now() - timestamp;
        return n !== null && timestamp > 0 && ageMs >= -5000 && ageMs <= maxAgeMs
            && (s.q === undefined || s.q === 0) ? n : null;
    } catch (_) {
        return null;
    }
}

function distributeDhwAndWallbox(availableW, dhwCapW, wallboxCapW, sharePct) {
    const share = Math.max(0, Math.min(1, sharePct / 100));
    let dhwW = Math.min(dhwCapW, availableW * share);
    let wallboxW = Math.min(wallboxCapW, availableW - dhwW);
    let remainingW = Math.max(0, availableW - dhwW - wallboxW);
    const extraDhwW = Math.min(remainingW, Math.max(0, dhwCapW - dhwW));
    dhwW += extraDhwW;
    remainingW -= extraDhwW;
    wallboxW += Math.min(remainingW, Math.max(0, wallboxCapW - wallboxW));
    return {dhwW, wallboxW};
}

function recommendedPlanPhases(vehicle, remainingPvW, remainingGridKWh, timestamp, pricePurchase = false) {
    if (!vehicle || !vehicle.phaseSwitchEnabled || vehicle.maximumPhases < 3) return 1;
    if (vehicle?.phaseControlMode === 'script')
        return vehicle.confirmedPhases === 3 ? 3 : 1;
    const hasDepartureDemand = pricePurchase || !vehicle.deadlineEnabled || vehicle.deadlineTargetSocEnabled
        || vehicle.belowMinimum || vehicle.manualMinimumCurrentA > 0;
    const hoursRemaining = hasDepartureDemand && vehicle.departureTimestamp > timestamp
        ? Math.max(0.25, (vehicle.departureTimestamp - timestamp) / 3600000) : Infinity;
    const averageRequiredW = Number.isFinite(hoursRemaining)
        ? remainingGridKWh / hoursRemaining * 1000 : 0;
    const maximumOnePhaseW = vehicle.maxCurrent1pA * 230;
    // Dreiphasig bei grossem aktuellem PV-Fenster oder wenn 1-phasig bis zur
    // Abfahrt rechnerisch nicht mehr genuegt. Sonst netz- und schaltsparend 1p.
    return remainingPvW >= 9000 || averageRequiredW > maximumOnePhaseW ? 3 : 1;
}

function vehicleAvailableAt(vehicle, timestamp) {
    return !vehicle.deadlineEnabled || !vehicle.departureTimestamp || timestamp < vehicle.departureTimestamp;
}

function plannedVehiclePriorityScore(initialVehicle, plannedVehicle) {
    // The SoC/minimum/deadline components change as the forecast charges a car.
    // Keep the existing priority model, but do not retain yesterday's mandatory
    // bonus after a simulated minimum has already been reached.
    const initialMandatory = initialVehicle.belowMinimum ? 10 : initialVehicle.mustCharge ? 2 : 0;
    const plannedMandatory = plannedVehicle.belowMinimum ? 10 : plannedVehicle.mustCharge ? 2 : 0;
    return initialVehicle.effectivePriorityScore - initialMandatory + plannedMandatory;
}

function comparePlannedVehicles(a, b, socFallback = false, continuing = null, honourDeparture = true) {
    // Earliest outstanding departure first, then the normal vehicle preference.
    return (honourDeparture ? compareDepartureMinima(a, b) : 0) || Number(b.selectedPriority === true) - Number(a.selectedPriority === true)
        || Number(b.belowMinimum) - Number(a.belowMinimum)
        || Number(b.mustCharge) - Number(a.mustCharge)
        || (socFallback ? Number(b.index === continuing) - Number(a.index === continuing)
            || compareWallboxSocGap(a, b) : 0)
        || b.effectivePriorityScore - a.effectivePriorityScore
        || a.latestStartTimestamp - b.latestStartTimestamp
        || b.priority - a.priority
        || a.index - b.index;
}

function quantizePlannedWallbox(requestedW, vehicle, phases = 1, partialSlot = false) {
    if (!vehicle || requestedW <= 0) return 0;
    phases = Math.max(1, Math.min(vehicle.maximumPhases || 3, Math.round(phases || 1)));
    const voltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const vehicleMaximumA = phases === 3 ? vehicle.maxCurrent3pA : vehicle.maxCurrent1pA;
    const minimumA = phases === 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
    const maximumA = Math.min(vehicleMaximumA,
        Math.floor(vehicle.maximumPowerW / (voltage * phases)));
    // Final/mandatory short charge: valueW is the quarter-hour average.
    // Actual output uses whole amps for a shorter duration. This also applies
    // above minimumA; flooring the final average can miss the departure target.
    if (partialSlot && maximumA >= minimumA)
        return Math.min(requestedW, maximumA * voltage * phases);
    // Energy subtraction can leave e.g. 3679.999999999999 W for a 16 A
    // slot. Do not lose an entire ampere due to floating-point roundoff.
    const amps = Math.min(maximumA, Math.floor(requestedW / (voltage * phases) + 1e-9));
    return amps >= minimumA ? amps * voltage * phases : 0;
}

// This is a forecast boundary, not a substitute for fresh real protection
// feedback. Conservatively charge the whole modeled house/heat load to each
// phase; credit forecast PV equally. Real outputs use measured phase currents.
function parallelForecastLimits(pvW, baseW, dhwW = 0, heatW = 0, batteryW = 0, consumptionLimit = null) {
    const r = CFG.root;
    const rawA = getState(`${r}.Config.HouseConnectionWorkingLimit_A`)?.val;
    const rawFuseA = getState(`${r}.Config.HouseConnectionFuse_A`)?.val;
    const fuseA = rawFuseA === undefined ? 50 : numericValue(rawFuseA);
    const limitA = rawA === undefined ? 46 : numericValue(rawA);
    const valid = limitA !== null && limitA >= 1 && fuseA !== null && fuseA >= 1 && limitA <= fuseA;
    const perPhaseW = valid ? Math.max(0, limitA * 230 - Math.max(0, baseW)
        - Math.max(0, dhwW) - Math.max(0, heatW) - batteryW + Math.max(0, pvW) / 3) : 0;
    let consumptionW = Infinity, constraintReason = 'No configured consumption limit';
    const limit = consumptionLimit ?? (typeof currentConsumptionLimit === 'function' ? currentConsumptionLimit() : null);
    if (limit) {
        consumptionW = !limit.valid ? 0 : limit.budgetW === null ? Infinity : limit.budgetW;
        constraintReason = limit.reason;
    } else {
        const retained = (id, maximumAgeMs = Infinity) => {
            if (!id || !existsState(id)) return null;
            const state = getState(id);
            return state?.ack === true && !state.q && Number(state.ts) > 0
                && Number(state.ts) <= Date.now() + 1000
                && Date.now() - Number(state.ts) <= maximumAgeMs ? state.val : null;
        };
        const legacyConfigured = Boolean(CFG.dp.par14a);
        const lpcConfigured = Boolean(CFG.dp.lpcState || CFG.dp.lpcLimit);
        if (legacyConfigured) {
            const value = retained(CFG.dp.par14a);
            const active = [true, 1, '1'].includes(value) ? true
                : [false, 0, '0'].includes(value) ? false : null;
            if (active === null) consumptionW = 0;
            else if (nativeConfig.par14aActiveHigh === false ? !active : active) {
                const cap = numericValue(nativeConfig.par14aLimitW ?? 4200);
                consumptionW = cap === null || cap < 0 ? 0 : cap;
            }
        }
        if (lpcConfigured) {
            const state = String(retained(CFG.dp.lpcState, 120000) || '').replace(/[^a-z]/gi, '').toLowerCase();
            const cap = numericValue(retained(CFG.dp.lpcLimit, 120000));
            if (state === 'limited') consumptionW = Math.min(consumptionW, cap === null || cap < 0 ? 0 : cap);
            else if (!['unlimitedautonomous', 'unlimitedcontrolled'].includes(state)) consumptionW = 0;
        }
        if (getState(`${r}.Devices.HeatPump.Present`)?.val === true && Number.isFinite(consumptionW)) {
            const power = numericValue(retained(CFG.dp.heatPumpPower, 120000));
            consumptionW = power === null || power < 0 ? 0 : Math.max(0, consumptionW - power);
        }
        constraintReason = Number.isFinite(consumptionW) ? 'Configured consumption constraint' : constraintReason;
    }
    return {phaseW: [perPhaseW, perPhaseW, perPhaseW], consumptionW: Math.max(0, consumptionW - batteryW),
        valid, reason: valid ? constraintReason : 'Invalid house connection limit',
        assumption: 'Whole forecast house/heat load on each phase; equal forecast PV credit; real feedback remains binding'};
}

function parallelForecastVehicle(vehicle) {
    return parallelWallboxVehicle(vehicle);
}

function allocateParallelForecastVehicles(order, vehicles, remainingKWh, timestamp, now,
    efficiency, budgetW, limits, handoffPhases = null) {
    const voltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const phaseW = limits.phaseW.slice();
    const watts = [0, 0, 0], phases = [1, 1, 1], commands = [0, 0, 0];
    const candidates = order.map(wb => {
        const vehicle = parallelForecastVehicle(vehicles[wb]);
        const end = vehicle.deadlineEnabled && vehicle.departureTimestamp > 0
            ? Math.min(timestamp + 900000, vehicle.departureTimestamp) : timestamp + 900000;
        const hours = pricePlanHours(timestamp, now, end);
        const energyCapW = Number.isFinite(remainingKWh[wb])
            ? remainingKWh[wb] / Math.max(1e-9, hours) / efficiency * 1000 : vehicle.maximumPowerW;
        const mandatory = vehicle.belowMinimum || vehicle.manualMinimumCurrentA > 0 || vehicle.mustCharge;
        const minimumPhases = vehicle.departureW > 0
            ? departurePhasesWithinBudget(vehicle, Math.min(limits.consumptionW, Math.min(...phaseW) * 3), voltage)
            : vehicle.phaseControlMode === 'script' && vehicle.confirmedPhases === 3 ? 3 : 1;
        const minimumW = mandatory ? (minimumPhases === 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA)
            * voltage * minimumPhases : 0;
        return {wb, vehicle, hours, energyCapW, minimumW, minimumPhases, departureW: vehicle.departureW,
            departureTimestamp: vehicle.departureTimestamp, stepW: voltage * minimumPhases,
            capW: Math.min(vehicle.maximumPowerW,
                (minimumPhases === 3 ? vehicle.maxCurrent3pA : vehicle.maxCurrent1pA) * voltage * minimumPhases),
            physicalMinimumW: vehicle.minCurrent1pA * voltage};
    });
    const reserved = allocateParallelWallboxWatts(candidates, 0, limits.consumptionW, phaseW);
    let spentCommandW = reserved.watts.reduce((sum, power) => sum + power, 0);
    let availableW = Math.min(limits.consumptionW, Math.max(budgetW, spentCommandW));
    const reservedPhaseW = [0, 0, 0];
    for (const candidate of candidates) {
        const power = reserved.watts[candidate.wb];
        reservedPhaseW[0] += power / candidate.minimumPhases;
        if (candidate.minimumPhases === 3) {
            reservedPhaseW[1] += power / 3;
            reservedPhaseW[2] += power / 3;
        }
    }
    const waiting = reserved.waiting.slice();
    for (const c of candidates) {
        if (c.minimumW > 0 && !reserved.admitted.includes(c.wb)) continue;
        const ownMinimumW = reserved.watts[c.wb];
        const ownReservedPhaseW = [ownMinimumW / c.minimumPhases,
            c.minimumPhases === 3 ? ownMinimumW / 3 : 0, c.minimumPhases === 3 ? ownMinimumW / 3 : 0];
        const otherReservedPhaseW = reservedPhaseW.map((power, index) => Math.max(0, power - ownReservedPhaseW[index]));
        const ownBudgetW = Math.max(0, availableW - spentCommandW + ownMinimumW);
        const preferredPhases = c.wb === order[0] ? handoffPhases : null;
        let ownPhases = c.vehicle.departureW > 0 ? c.minimumPhases : preferredPhases ?? (c.vehicle.belowMinimum && c.wb !== order[0] && c.vehicle.phaseControlMode !== 'script' ? 1
            : recommendedPlanPhases(c.vehicle.deadlineEnabled ? c.vehicle : {...c.vehicle, departureTimestamp: 0},
                ownBudgetW, remainingKWh[c.wb], timestamp));
        // A minimum reservation is 1P. A 3P wish is admitted only if it can
        // actually run above its own 3P floor alongside the other reservations.
        const phaseCap = count => count === 3
            ? Math.max(0, Math.min(...phaseW.map((power, index) => power - otherReservedPhaseW[index]))) * 3
            : Math.max(0, phaseW[0] - otherReservedPhaseW[0]);
        const phaseMinimum = count => (count === 3 ? c.vehicle.minCurrent3pA : c.vehicle.minCurrent1pA) * voltage * count;
        const electricalCap = count => Math.min(c.vehicle.maximumPowerW, ownBudgetW, phaseCap(count),
            (count === 3 ? c.vehicle.maxCurrent3pA : c.vehicle.maxCurrent1pA) * voltage * count);
        if (ownPhases === 3 && c.vehicle.phaseControlMode !== 'script'
            && electricalCap(3) < phaseMinimum(3)) ownPhases = 1;
        const electricalCapW = electricalCap(ownPhases);
        const physicalMinimumW = phaseMinimum(ownPhases);
        const requestW = Math.min(electricalCapW, c.energyCapW);
        // A short final charge still reserves its instantaneous whole-amp
        // command. Its average energy can be smaller without creating power.
        const stepW = voltage * ownPhases;
        const finalPartial = electricalCapW >= Math.max(physicalMinimumW, Math.ceil(c.energyCapW / stepW - 1e-9) * stepW);
        const valueW = quantizePlannedWallbox(requestW, c.vehicle, ownPhases, finalPartial);
        const commandW = valueW > 0 ? Math.max(physicalMinimumW,
            Math.ceil(valueW / (voltage * ownPhases) - 1e-9) * voltage * ownPhases) : 0;
        watts[c.wb] = valueW;
        phases[c.wb] = ownPhases;
        commands[c.wb] = commandW;
        spentCommandW += commandW - ownMinimumW;
        reservedPhaseW.forEach((power, index) => { reservedPhaseW[index] = Math.max(0, power - ownReservedPhaseW[index]); });
        phaseW[0] = Math.max(0, phaseW[0] - commandW / ownPhases);
        if (ownPhases === 3) {
            phaseW[1] = Math.max(0, phaseW[1] - commandW / 3);
            phaseW[2] = Math.max(0, phaseW[2] - commandW / 3);
        }
        if (!valueW && !waiting.includes(c.wb)) waiting.push(c.wb);
    }
    const mii = candidates.find(candidate => candidate.wb === 0);
    if (mii && reserved.waiting.length === 0 && phases[0] === 1 && commands[0] > 0) {
        const spareW = Math.max(0, Math.min(limits.consumptionW - spentCommandW, phaseW[0]));
        const targetW = parallelLowSocTargetW(mii.vehicle, voltage, commands[0] + spareW);
        const powerW = quantizePlannedWallbox(Math.min(targetW, mii.energyCapW), mii.vehicle);
        if (powerW > commands[0]) {
            availableW = Math.max(availableW, spentCommandW + powerW - commands[0]);
            watts[0] = commands[0] = powerW;
        }
    }
    return {watts, phases, commands, minimumTotalW: reserved.minimumTotalW,
        waiting, limits, budgetW: availableW};
}

function buildBatteryTargetPlan(data, capacity, maxCharge, efficiency, targets, reserveMin, solarStoredKWh = null) {
    const result = data.pv.map(x => ({
        timestamp: x.timestamp,
        targetPct: targets.morning,
        stage: 'MORNING_70',
        deadlineIndex: 0
    }));
    const byDay = new Map();
    data.pv.forEach((x, index) => {
        const key = localDateKey(new Date(x.timestamp));
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(index);
    });
    const reserveSlots = Math.max(0, Math.ceil(reserveMin / 15));
    const lateEnergyKWh = Math.max(0, targets.late - targets.afternoon) / 100 * capacity;
    const lateSlots = maxCharge > 0
        ? Math.ceil(lateEnergyKWh / (maxCharge / 1000 * efficiency) * 4)
        : 0;

    byDay.forEach(indices => {
        const usable = indices.filter(i => (Number(data.pv[i]?.valueW) || 0)
            - (Number(data.house[i]?.valueW) || 0) >= 200);
        if (!usable.length) return;
        const peakIndex = usable.reduce((best, i) =>
            Number(data.pv[i].valueW) > Number(data.pv[best].valueW) ? i : best, usable[0]);
        const lastPvIndex = usable[usable.length - 1];
        const nominalStart = Math.max(peakIndex, lastPvIndex - reserveSlots - lateSlots + 1);
        const lateDeadlineIndex = Math.max(solarStoredKWh ? peakIndex : nominalStart, lastPvIndex - reserveSlots);
        let lateStartIndex = nominalStart;
        if (solarStoredKWh) {
            lateStartIndex = lateDeadlineIndex;
            let remainingKWh = lateEnergyKWh;
            // Work back from the finish deadline using the PV that can actually
            // be stored in each quarter-hour, including a weak afternoon tail.
            while (lateStartIndex > peakIndex && remainingKWh > solarStoredKWh[lateStartIndex] + 1e-9) {
                remainingKWh -= solarStoredKWh[lateStartIndex];
                lateStartIndex--;
            }
        }

        indices.forEach(i => {
            if (i >= lateStartIndex && i <= lastPvIndex) {
                result[i].targetPct = targets.late;
                result[i].stage = 'LATE_100';
                result[i].deadlineIndex = Math.max(i, lateDeadlineIndex);
            } else if (i >= peakIndex && i < lateStartIndex) {
                result[i].targetPct = targets.afternoon;
                result[i].stage = 'AFTERNOON_90';
                result[i].deadlineIndex = Math.max(i, lateStartIndex - 1);
            } else if (i < peakIndex) {
                result[i].deadlineIndex = solarStoredKWh ? peakIndex - 1 : peakIndex;
            } else {
                result[i].deadlineIndex = i;
            }
        });
    });
    return result;
}

function forecastBatteryHandoff(vehicle, phases, surplusW, reservedW, ceilingW, requiredW, phaseW, thermalShareW,
    flexible = false) {
    if (!vehicle || reservedW < ceilingW || surplusW <= ceilingW || ![1, 3].includes(phases)) return 0;
    const r = CFG.root;
    const voltage = Math.max(200, readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230));
    const minimumA = phases === 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
    const maximumA = phases === 3 ? vehicle.maxCurrent3pA : vehicle.maxCurrent1pA;
    const minimumW = minimumA * voltage * phases;
    const remainingW = surplusW - reservedW;
    if (remainingW >= minimumW && !flexible) return 0;
    // When the qualified storage is already at its AC ceiling, round the
    // car's residual budget up to the next whole ampere. The battery gives
    // back only the difference, never energy from an actual discharge.
    const desiredW = flexible ? Math.max(minimumW,
        Math.ceil(remainingW / (voltage * phases) - 1e-9) * voltage * phases) : minimumW;
    if (desiredW <= remainingW + 1e-7 || desiredW > maximumA * voltage * phases) return 0;
    const startReserveW = Math.max(0, readNumber(`${r}.Config.WallboxStartReserve_W`, 300));
    const requestW = desiredW + startReserveW;
    const phaseCapW = Math.min(...phaseW.slice(0, phases)) - (surplusW - desiredW);
    if (maximumA < minimumA || vehicle.maximumPowerW < requestW
        || requestW / phases > phaseCapW || Math.max(remainingW, requestW) >= thermalShareW
        || !wallboxAllocationPolicy.splitBatteryWallboxStart(surplusW, ceilingW, desiredW, startReserveW, requiredW)) return 0;
    return desiredW - remainingW;
}

// Price charging uses explicit import authorization. Ordinary positive PV
// budgets never become permission to buy energy from the grid.
function pricePlanHours(timestamp, now = Date.now(), until = Infinity) {
    return Math.max(0, (Math.min(timestamp + 900000, until) - Math.max(timestamp, now)) / 3600000);
}

function pricePlanSettings() {
    const root = `${CFG.root}.Config`;
    return {horizonMs: Math.max(6, Math.min(48, readNumber(`${root}.PriceChargingHorizon_h`, 24))) * 3600000,
        blockHours: Math.max(15, Math.min(240, readNumber(`${root}.PriceChargingMinBlock_min`, 30))) / 60};
}

function priceBlocks(slots, powers, eligible, blockHours, now, alreadySelected = [], until = Infinity) {
    const result = [];
    for (let start = 0; start < slots.length; start++) {
        let duration = 0, capacityKWh = 0, cost = 0;
        const indices = [];
        for (let i = start; i < slots.length && eligible(i); i++) {
            if (i > start && slots[i].timestamp !== slots[i - 1].timestamp + 900000) break;
            const hours = pricePlanHours(slots[i].timestamp, now, until);
            if (!(powers[i] > 0) || hours <= 0) break;
            indices.push(i); duration += hours;
            const energy = powers[i] * hours / 1000;
            capacityKWh += energy; cost += energy * slots[i].price;
            if (duration + 1e-9 >= blockHours) {
                result.push({indices, capacityKWh, cost: cost / capacityKWh,
                    adjacent: alreadySelected.includes(start - 1) || alreadySelected.includes(i + 1)});
                break;
            }
        }
    }
    return result.sort((a, b) => a.cost - b.cost || Number(b.adjacent) - Number(a.adjacent)
        || a.indices[0] - b.indices[0]);
}

function addPriceWallboxPlan(slots, wallboxes, allocations, vehicles, efficiency, now, socFallback = false) {
    const {horizonMs, blockHours} = pricePlanSettings();
    const reports = [];
    const parallelVehicles = parallelWallboxChargingEnabled();
    const ordered = vehicles.filter(v => v.eligible).sort((a, b) => comparePlannedVehicles(a, b, socFallback));
    // Respect an explicit vehicle choice. Otherwise an earlier departure
    // gets the shared windows first and equal deadlines retain their order.
    const readinessOrder = ordered.filter(v => v.readyBy)
        .sort((a, b) => Number(b.selectedPriority === true) - Number(a.selectedPriority === true)
            || a.readyBy.departureAt - b.readyBy.departureAt);
    const tasks = readinessOrder.map(vehicle => ({vehicle, readiness: true}))
        .concat(ordered.map(vehicle => ({vehicle, readiness: false})));
    for (const {vehicle: initialVehicle, readiness} of tasks) {
        const vehicle = parallelVehicles ? parallelForecastVehicle(initialVehicle) : initialVehicle;
        const wb = vehicle.index;
        const enabled = getState(`${CFG.root}.Config.Wallbox${wb}PriceChargingEnabled`)?.val === true;
        const bindDeparture = Boolean(vehicle.datedTrip?.at) || wallboxReadinessEnabled(wb);
        const currentSoc = vehicle.readinessSocPct ?? vehicle.socPct;
        let remaining = readiness ? Math.max(0, (vehicle.minimumSocPct - currentSoc) / 100
            * vehicle.capacityKWh / efficiency) : numericValue(vehicle.priceRemainingKWh);
        if (vehicle.datedTrip?.at) remaining = Math.min(remaining, Math.max(0,
            (vehicle.datedTrip.gridGoal - currentSoc) * vehicle.capacityKWh / (100 * efficiency)));
        // The purchase window is not the time by which a flexible car must be
        // full. Account for usable PV throughout its complete forecast window,
        // including tomorrow afternoon after a 24-hour purchase window ends.
        const demandDeadline = Math.min(Number(vehicle.priceDeadlineTimestamp) || 0,
            vehicle.deadlineEnabled && vehicle.departureTimestamp > 0 ? vehicle.departureTimestamp : Infinity);
        const deadline = readiness ? vehicle.readyBy.departureAt : Math.min(now + horizonMs, demandDeadline);
        const until = readiness ? deadline : Infinity;
        const deadlineMode = vehicle.priceDeadlineMode || (vehicle.deadlineEnabled ? 'departure' : 'flexible');
        if (!readiness && (!enabled || vehicle.priceSessionValid !== true || !(remaining > 0) || deadline <= now)) {
            reports.push({wallbox: wb, enabled, gridKWh: 0, reason: !enabled ? 'disabled'
                : vehicle.priceSessionValid !== true ? 'session-invalid' : 'no-bounded-demand'});
            continue;
        }
        // Only energy missing after the PV/mandatory baseline needs a purchase.
        // An actual departure still bounds both the baseline and grid charging.
        const baselineKWh = slots.reduce((sum, slot) => sum + (slot.timestamp < demandDeadline
            ? (readiness ? slot.wbW[wb] * pricePlanHours(slot.timestamp, now, until) / 1000
                : slot.wbW[wb] * pricePlanHours(slot.timestamp, now) / 1000)
            : 0), 0);
        let neededKWh = Math.max(0, remaining - baselineKWh);
        const originalNeed = neededKWh, selected = [];
        const cap = readNumber(`${CFG.root}.Config.Wallbox${wb}PriceMax_ct_kWh`, 0);
        const slotCapacity = (slot, i) => {
            const phases = recommendedPlanPhases({...vehicle, departureTimestamp: deadline}, 0, remaining, slot.timestamp, true);
            const deviceCapW = readiness ? Math.min(vehicle.maximumPowerW,
                Math.max(0, Number(vehicleSetting(wb, 'CommissioningMaxA', 6)) || 0) * 230 * phases)
                : vehicle.maximumPowerW;
            if (!parallelVehicles && !readiness)
                return {phases, watts: quantizePlannedWallbox(deviceCapW, vehicle, phases)};
            const limits = parallelForecastLimits(slot.pvW, slot.baseW, slot.dhwW, slot.heatW,
                slot.batteryReservedPvW ?? 0);
            const occupied = [0, 1, 2].map(index => {
                const point = wallboxes[index]?.[i];
                const count = point?.phases === 3 ? 3 : 1;
                const command = point?.currentA > 0 ? point.currentA * 230 * count : Math.max(0, slot.wbW[index] || 0);
                return {command, phases: count};
            });
            const phaseRemaining = limits.phaseW.map((power, phase) => Math.max(0, power
                - occupied.reduce((sum, entry) => sum + (entry.phases === 3 ? entry.command / 3 : phase === 0 ? entry.command : 0), 0)));
            const consumptionRemaining = Math.max(0, limits.consumptionW - occupied.reduce((sum, entry) => sum + entry.command, 0));
            const phaseCap = phases === 3 ? Math.min(...phaseRemaining) * 3 : phaseRemaining[0];
            const watts = quantizePlannedWallbox(Math.min(deviceCapW, phaseCap, consumptionRemaining), vehicle, phases);
            return {phases, watts};
        };
        const powers = slots.map((slot, i) => slotCapacity(slot, i).watts);
        const eligible = i => slots[i].timestamp < deadline
            && (readiness || slots[i].timestamp + 900000 <= deadline)
            && slots[i].priceValid && (readiness || cap === 0 || slots[i].price <= cap)
            && (parallelVehicles ? slots[i].wbW[wb] <= 0 && powers[i] > 0
                : slots[i].wbW.every(watts => watts <= 0));
        while (neededKWh > 1e-8) {
            // Readiness may use an isolated cheap quarter before any
            // dearer interval. Prefer adjacent slots at the same price.
            const block = priceBlocks(slots, powers, eligible, readiness ? 1e-6 : blockHours,
                now, selected, until)[0];
            if (!block) break;
            const fraction = Math.min(1, neededKWh / block.capacityKWh);
            for (const i of block.indices) {
                const slot = slots[i], hours = pricePlanHours(slot.timestamp, now, until);
                const slotHours = pricePlanHours(slot.timestamp, now);
                const phases = slotCapacity(slot, i).phases;
                const minimumA = phases === 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
                if (neededKWh <= 1e-8) break;
                const desiredAverageW = powers[i] * fraction;
                const currentA = Math.max(minimumA, Math.ceil(desiredAverageW / (230 * phases)));
                const commandW = Math.min(powers[i], currentA * 230 * phases);
                // Run across complete adjacent slots. Only the final stretch
                // may be shorter to meet the remaining energy exactly.
                const minutes = Math.min(hours * 60, neededKWh * 1000 / commandW * 60);
                const averageW = commandW * minutes / (slotHours * 60);
                const start = Math.max(now, slot.timestamp);
                // Existing heater/PV allocations retain their budgets. Only
                // unallocated PV can cover any of the added vehicle charging.
                const pvCommandW = Math.min(slot.residualPvW, commandW);
                const pvW = pvCommandW * minutes / (slotHours * 60);
                const gridCommandW = Math.max(0, commandW - pvCommandW);
                const gridAverageW = gridCommandW * minutes / (slotHours * 60);
                slot.wbW[wb] = averageW;
                slot.residualPvW = Math.max(0, slot.residualPvW - pvW);
                Object.assign(wallboxes[wb][i], {valueW: Math.round(averageW), phases, currentA,
                    chargingMinutes: minutes, gridChargeW: Math.ceil(gridCommandW),
                    plannedGridEnergyKWh: gridAverageW * slotHours / 1000,
                    priceLimitCt: slot.price, priceOptimized: true, priceSessionId: vehicle.priceSessionId,
                    priceChargeUntil: Math.min(until, start + minutes * 60000),
                    ...(bindDeparture ? {priceDepartureAt: vehicle.priceDeadlineTimestamp} : {}),
                    ...(readiness ? {readinessPurchase: true} : {}),
                    priceReason: readiness ? 'minimum-soc-by-departure'
                        : fraction < 1 ? 'cheapest-block-final-energy' : 'cheapest-feasible-block'});
                const previous = allocations[i];
                Object.assign(previous, {activeWallbox: parallelVehicles ? previous.activeWallbox ?? wb : wb,
                    ...(parallelVehicles ? {parallelWallboxCharging: true,
                        activeWallboxes: slot.wbW.map((power, index) => power > 0 ? index : null).filter(index => index !== null)} : {}),
                    wallboxRequestedW: averageW + (parallelVehicles ? previous.wallboxRequestedW || 0 : 0),
                    wallboxW: averageW + (parallelVehicles ? previous.wallboxW || 0 : 0),
                    wallboxPvW: pvW + (parallelVehicles ? previous.wallboxPvW || 0 : 0),
                    wallboxGridW: gridAverageW + (parallelVehicles ? previous.wallboxGridW || 0 : 0),
                    pvBeforeBatteryW: slot.residualPvW + (slot.batteryReservedPvW ?? 0),
                    priceWallboxGridW: gridAverageW + (parallelVehicles ? previous.priceWallboxGridW || 0 : 0)});
                neededKWh = Math.max(0, neededKWh - averageW * slotHours / 1000);
                selected.push(i);
            }
        }
        if (readiness) {
            if (neededKWh > 1e-8) return {retryWithoutReadiness: wb};
            // If planned charging finishes below minimum, restore immediate
            // readiness without waiting for the next forecast rebuild.
            const confirmBy = wallboxes[wb].reduce((last, point) => point.valueW > 0 && point.timestamp < deadline
                ? Math.max(last, Math.min(deadline, point.readinessPurchase ? point.priceChargeUntil : point.timestamp + 900000))
                : last, now);
            let futureAcKWh = 0;
            for (let i = wallboxes[wb].length - 1; i >= 0; i--) {
                const point = wallboxes[wb][i];
                if (point.timestamp >= deadline) continue;
                const until = point.readinessPurchase ? point.priceChargeUntil : Math.min(deadline, point.timestamp + 900000);
                const hours = pricePlanHours(point.timestamp, now, until);
                const acKWh = slots[i].wbW[wb] * pricePlanHours(point.timestamp, now) / 1000;
                // Keep only the proven schedule's remaining energy. A late or
                // failed charge invalidates its permission to postpone the minimum.
                point.readyBy = {...vehicle.readyBy, confirmBy, futureAcKWh, until,
                    plannedW: hours > 0 ? acKWh / hours * 1000 : 0};
                futureAcKWh += acKWh;
            }
            continue;
        }
        reports.push({wallbox: wb, enabled: true,
            gridKWh: wallboxes[wb].reduce((sum, point) => sum + (point.plannedGridEnergyKWh || 0), 0),
            unmetKWh: neededKWh, baselineKWh, deadlineMode,
            pvDemandUntil: demandDeadline, gridPurchaseUntil: deadline,
            reason: originalNeed <= 1e-8 ? 'covered-by-pv-or-mandatory-plan'
                : neededKWh > 1e-8 ? 'insufficient-valid-price-blocks' : 'cheapest-feasible-blocks'});
    }
    return reports;
}

function batteryPlanningEfficiency() {
    const roundTrip = readNumber(`${CFG.root}.Config.BatteryRoundTripEfficiency_pct`, 0);
    // 0 preserves the established per-leg setting; an explicit round-trip
    // value uses symmetrical charge/discharge losses, never squares it twice.
    return roundTrip > 0 && roundTrip <= 100
        ? Math.sqrt(Math.max(1, roundTrip) / 100)
        : Math.max(0.5, Math.min(1, readNumber(`${CFG.root}.Config.BatteryEfficiency_pct`, 92) / 100));
}

function plannedBatteryHouseDischargeW(slot, soc, options) {
    const {minSoc, maxDischarge, capacity, efficiency, hours, selfConsumptionEnabled, spreadOk, highPrice} = options;
    if (slot.pauseBattery || hours <= 0 || slot.baseW <= slot.pvW || soc <= minSoc
        || !(selfConsumptionEnabled && (!spreadOk || !slot.priceValid)
            || slot.priceValid && spreadOk && slot.price >= highPrice)) return 0;
    const availableW = (soc - minSoc) / 100 * capacity * 1000 / hours * efficiency;
    return Math.min(maxDischarge, slot.baseW - slot.pvW, availableW);
}

function forecastBatteryLowSocWindow(trajectory, initialSoc, now) {
    let previousAt = now, previousSoc = initialSoc, lowFrom = null, longest = null;
    for (const {timestamp, soc} of trajectory) {
        const start = Math.max(timestamp, now), end = timestamp + 900000;
        if (end <= start) continue;
        if (start !== previousAt || !Number.isFinite(previousSoc) || !Number.isFinite(soc)) lowFrom = null;
        else {
            const startBelow = previousSoc < BATTERY_FORECAST_RESERVE_SOC - 1e-8;
            const endBelow = soc < BATTERY_FORECAST_RESERVE_SOC - 1e-8;
            if (startBelow || endBelow) {
                const crossing = startBelow === endBelow ? null : start + (end - start)
                    * Math.max(0, Math.min(1, (BATTERY_FORECAST_RESERVE_SOC - previousSoc) / (soc - previousSoc)));
                lowFrom ??= startBelow ? start : crossing;
                const lowUntil = endBelow ? end : crossing;
                if (lowUntil - lowFrom > Math.max(BATTERY_FORECAST_LOW_SOC_MS, longest?.durationMs ?? 0))
                    longest = {lowFrom, lowUntil, durationMs: lowUntil - lowFrom};
            }
            if (!endBelow) lowFrom = null;
        }
        previousAt = end;
        previousSoc = soc;
    }
    return longest;
}

function forecastBatteryReservePowerW(slot, consumptionLimit, maximumW) {
    const wallboxW = slot.wbW.reduce((sum, watts) => sum + watts, 0);
    const limit = parallelForecastLimits(slot.pvW, slot.baseW + wallboxW,
        slot.dhwW, slot.heatW, 0, consumptionLimit);
    return Math.max(0, Math.min(maximumW, ...limit.phaseW,
        limit.consumptionW - slot.dhwW - slot.heatW - wallboxW));
}

function forecastBatteryReserveSchedule(slots, needKWh, now, deadlineAt, powerW) {
    if (!(needKWh > 0) || !(deadlineAt > now)) return null;
    let best = null;
    for (let start = 0; start < slots.length; start++) {
        let remainingKWh = needKWh, costCt = 0;
        for (let i = start; i < slots.length && remainingKWh > 1e-8; i++) {
            const slot = slots[i], hours = pricePlanHours(slot.timestamp, now, deadlineAt);
            if (!slot.priceValid || hours <= 0 || powerW[i] <= 0
                || i > start && slot.timestamp !== slots[i - 1].timestamp + 900000) break;
            const energyKWh = Math.min(remainingKWh, powerW[i] * hours / 1000);
            costCt += energyKWh * slot.price;
            remainingKWh -= energyKWh;
        }
        if (remainingKWh <= 1e-8 && (!best || costCt < best.costCt - 1e-8))
            best = {chargeAt: Math.max(now, slots[start].timestamp), costCt};
    }
    return best;
}

function forecastReserveRecoveryPowerW(maximumW) {
    const gridLimitW = typeof BATTERY_RESERVE_RECOVERY_W === 'number' ? BATTERY_RESERVE_RECOVERY_W : 1000;
    return Math.min(maximumW, gridLimitW);
}

function plannedForecastReserveCharge(reserve, slot, soc, options) {
    const {hours, capacity, efficiency, maxSoc, pvChargeW} = options;
    const target = Math.min(maxSoc, BATTERY_FORECAST_RESERVE_SOC);
    if (!reserve || hours <= 0 || soc >= target) return {pvChargeW, reserveGridChargeW: 0};
    const needW = (target - soc) / 100 * capacity * 1000 / (hours * efficiency);
    const allowedW = Math.min(slot.forecastReserveCapW, needW);
    const pvW = Math.max(pvChargeW, Math.min(allowedW, slot.residualPvW + (slot.batteryReservedPvW ?? 0)));
    const reserveGridChargeW = slot.timestamp + 900000 > reserve.chargeAt
        ? Math.max(0, forecastReserveRecoveryPowerW(allowedW) - pvW) : 0;
    return {pvChargeW: pvW, reserveGridChargeW};
}

function priceBatterySimulation(slots, targetPlan, options, purchases = [], stopIndex = slots.length) {
    const {capacity, initialSoc, minSoc, maxSoc, reservePct, maxCharge, maxDischarge,
        efficiency, safety, selfConsumption, now} = options;
    const maxEnergy = capacity * maxSoc / 100;
    const gridMaxEnergy = capacity * Math.max(minSoc, Math.min(maxSoc, options.gridMaxSoc ?? maxSoc)) / 100;
    const reserveGoal = capacity * Math.min(maxSoc, minSoc + reservePct) / 100;
    // A device/operator ceiling limits new charging. A proved initial SoC
    // above that ceiling is still real energy, not an immediate virtual drain.
    let energy = Math.max(0, Math.min(options.preserveInitialSoc ? capacity : maxEnergy,
        initialSoc * capacity / 100));
    // Extra reserve is retained from existing/PV energy. Never buy a stranded
    // reserve just to make a small arbitrage transaction appear profitable.
    let reserveEnergy = Math.min(reserveGoal, energy);
    const result = [];
    const releaseEnergy = Array(slots.length).fill(0);
    let heldEnergy = 0;
    for (const lot of options.initialHolds || []) {
        releaseEnergy[lot.releaseIndex] += lot.energy;
        heldEnergy += lot.energy;
    }
    const ordersBySlot = Array.from({length: slots.length}, () => []);
    for (const order of purchases) ordersBySlot[order.index].push(order);
    for (let i = 0; i < Math.min(slots.length, stopIndex); i++) {
        const slot = slots[i], hours = pricePlanHours(slot.timestamp, now);
        const initialEnergy = energy;
        heldEnergy = Math.max(0, heldEnergy - releaseEnergy[i]);
        const protectedEnergy = heldEnergy;
        const solarW = slot.batteryReservedPvW ?? Math.max(0, slot.residualPvW * safety);
        const pvTargetEnergy = Math.min((targetPlan[i].ceilingPct ?? maxSoc) * capacity / 100, Math.max(reserveGoal,
            (slot.batteryPvTargetPct ?? targetPlan[i].targetPct) * capacity / 100));
        const ordinaryPvW = hours > 0 && !slot.pauseBattery ? Math.min(maxCharge, solarW,
            Math.max(0, pvTargetEnergy - energy) * 1000 / (efficiency * hours)) : 0;
        const {pvChargeW, reserveGridChargeW} = plannedForecastReserveCharge(options.forecastReserve, slot,
            initialEnergy / capacity * 100, {hours, capacity, efficiency, maxSoc, pvChargeW: ordinaryPvW});
        const addedReserveAndPvEnergy = (pvChargeW + reserveGridChargeW) * hours / 1000 * efficiency;
        energy += addedReserveAndPvEnergy;
        reserveEnergy = Math.min(reserveGoal, reserveEnergy + addedReserveAndPvEnergy);
        const belowForecastReserve = options.forecastReserve && initialEnergy < capacity
            * Math.min(maxSoc, BATTERY_FORECAST_RESERVE_SOC) / 100 - 1e-8;
        const orders = ordersBySlot[i];
        const requestedW = orders.reduce((sum, order) => sum + order.powerW, 0);
        const gridChargeW = hours > 0 && !slot.pauseBattery && !belowForecastReserve
            ? Math.min(requestedW, Math.max(0, maxCharge - pvChargeW),
            Math.max(0, gridMaxEnergy - energy) * 1000 / (efficiency * hours)) : 0;
        const addedEnergy = gridChargeW * hours / 1000 * efficiency;
        energy += addedEnergy;
        if (requestedW > 0) for (const order of orders) {
            const retained = addedEnergy * order.powerW / requestedW;
            if (order.releaseIndex > i) {
                releaseEnergy[order.releaseIndex] += retained;
                heldEnergy += retained;
            }
        }
        const deficitW = Math.max(0, slot.baseW - slot.pvW);
        const usefulDemandW = selfConsumption && !slot.pauseBattery ? Math.min(maxDischarge, deficitW) : 0;
        const currentFloor = Math.min(maxEnergy, reserveEnergy + heldEnergy);
        const dischargeW = !slot.pauseBattery && gridChargeW + reserveGridChargeW <= 1e-8 && hours > 0
            ? Math.min(usefulDemandW, Math.max(0, energy - currentFloor) * efficiency * 1000 / hours) : 0;
        energy -= dischargeW * hours / 1000 / efficiency;
        result.push({valueW: pvChargeW + gridChargeW + reserveGridChargeW - dischargeW,
            gridChargeW, reserveGridChargeW, pvChargeW, dischargeW,
            pvHeadroomKWh: Math.max(0, maxEnergy - energy),
            energyReason: reserveGridChargeW > 0 ? 'Prognose-SoC-Reserve'
                : gridChargeW > 0 ? (slot.gridLevel === 'low' ? 'NT-Netzladung' : 'Preis-Netzladung')
                : pvChargeW > 0 ? 'PV' : dischargeW > 0 ? (slot.gridLevel === 'high' ? 'HT-Vermeidung'
                    : slot.gridLevel === 'standard' ? 'ST-Vermeidung' : 'Preis-Vermeidung') : 'Halten',
            priceLimitCt: gridChargeW > 0 ? slot.price : null, priceOptimized: true,
            plannedGridEnergyKWh: gridChargeW * hours / 1000,
            dischargeFloorPct: currentFloor / capacity * 100,
            targetSoCPct: Math.min(maxSoc, Math.max(initialEnergy, energy + dischargeW * hours / 1000 / efficiency) / capacity * 100),
            socPct: energy / capacity * 100,
            unmetUsefulKWh: Math.max(0, usefulDemandW - dischargeW) * hours / 1000,
            gridImportW: Math.max(0, deficitW - dischargeW) + gridChargeW + reserveGridChargeW,
            initialEnergy, energy, floorEnergy: currentFloor,
            chargeHeadroomW: hours > 0 && !slot.pauseBattery && !belowForecastReserve ? Math.min(maxCharge - pvChargeW,
                Math.max(0, gridMaxEnergy - initialEnergy) * 1000 / (efficiency * hours)) : 0,
            priceReason: gridChargeW > 0 ? 'cheapest-loss-adjusted-household-bridge'
                : protectedEnergy > 0 ? 'retain-for-future-household-demand' : 'pv-and-household-balance'});
    }
    return result;
}

function nextBatteryHighTariffWindow(slots, now) {
    const first = slots.findIndex(slot => slot.gridLevel === 'high' && pricePlanHours(slot.timestamp, now) > 0);
    if (first < 0 || slots[first].timestamp >= now + pricePlanSettings().horizonMs) return null;
    const end = slots.findIndex((slot, index) => index > first && slot.gridLevel !== 'high');
    if (end < 0 || !slots[end].gridLevel || slots[end].timestamp !== slots[end - 1].timestamp + 900000
        || slots.slice(0, end).some((slot, index) =>
        !slot.priceValid || !Number.isFinite(slot.price)
        || index > 0 && slot.timestamp !== slots[index - 1].timestamp + 900000)) return null;
    return {first, end, startTimestamp: slots[first].timestamp, endTimestamp: slots[end].timestamp};
}

function buildPriceBatteryPlan(slots, targetPlan, options) {
    const {horizonMs, blockHours} = pricePlanSettings();
    const window = options.highTariffWindow;
    const allowGridCharging = options.allowGridCharging !== false;
    const horizonEnd = !allowGridCharging && window ? window.endTimestamp : options.now + horizonMs;
    const inHighTariffWindow = index => window && index >= window.first && index < window.end;
    const usefulPower = slot => Math.max(0, Math.min(options.maxDischarge, slot.baseW - slot.pvW));
    const byPriceAndLoad = (a, b) => b.slot.price - a.slot.price
        || (inHighTariffWindow(a.index) && inHighTariffWindow(b.index)
            ? usefulPower(b.slot) - usefulPower(a.slot) : 0)
        || a.index - b.index;
    const cap = readNumber(`${CFG.root}.Config.BatteryPriceMax_ct_kWh`, 0);
    const savings = Math.max(0, readNumber(`${CFG.root}.Config.BatteryPriceMinSavings_ct_kWh`, 2));
    const purchases = [];
    const reserveSoc = Math.min(options.initialSoc, options.maxSoc, options.minSoc + options.reservePct);
    const noFreeEnergy = priceBatterySimulation(slots, targetPlan, {...options,
        initialSoc: reserveSoc, initialHolds: []}, []);
    let freeStoredKWh = Math.max(0, (options.initialSoc - reserveSoc) / 100 * options.capacity);
    const initialHolds = [];
    // On every rebuild, retain existing energy for the most expensive demand
    // that PV cannot cover. Otherwise a freshly bought kWh would immediately
    // be spent in a cheap slot and purchased again in the next forecast.
    const demandOrder = slots.map((slot, index) => ({slot, index}))
        .filter(({slot, index}) => slot.timestamp < horizonEnd && slot.priceValid
            && (allowGridCharging || inHighTariffWindow(index))
            && noFreeEnergy[index].unmetUsefulKWh > 1e-9)
        .sort(byPriceAndLoad);
    for (const {index} of demandOrder) {
        const energy = Math.min(freeStoredKWh, noFreeEnergy[index].unmetUsefulKWh / options.efficiency);
        if (energy > 1e-9) initialHolds.push({releaseIndex: index, energy});
        freeStoredKWh -= energy;
    }
    options = {...options, initialHolds};
    let simulation = priceBatterySimulation(slots, targetPlan, options, purchases);
    const baseline = simulation;
    // Reserve limited cheap-window charging for the most expensive useful
    // demand first. Eligibility still requires purchase BEFORE that demand.
    // This gives HT priority over ST without borrowing energy from the future.
    const purchaseDemandOrder = !allowGridCharging ? [] : slots.map((slot, index) => ({slot, index}))
        .filter(({slot, index}) => index > 0 && slot.timestamp < horizonEnd && slot.priceValid)
        .sort(byPriceAndLoad);
    for (const {index: demand} of purchaseDemandOrder) {
        if (!slots[demand].priceValid || options.initialSoc < options.minSoc) continue;
        let attempts = 0;
        while (simulation[demand].unmetUsefulKWh > 1e-7 && attempts++ < slots.length) {
            const purchasedWatts = Array(slots.length).fill(0);
            for (const order of purchases) purchasedWatts[order.index] += order.powerW;
            const powers = simulation.map((point, i) => Math.max(0, Math.min(options.maxCharge,
                point.chargeHeadroomW) - purchasedWatts[i]));
            // New energy must remain stored until this demand. A full battery
            // at any intervening slot makes earlier added charging useless:
            // it would merely displace already planned/PV charging. Exclude
            // those blocks before expensive simulation/cost verification.
            let pathHeadroomKWh = options.capacity * options.maxSoc / 100;
            for (let i = demand - 1; i >= 0; i--) {
                pathHeadroomKWh = Math.min(pathHeadroomKWh, Math.max(0,
                    (options.maxSoc - simulation[i].targetSoCPct) * options.capacity / 100));
                const hours = pricePlanHours(slots[i].timestamp, options.now);
                powers[i] = hours > 0 ? Math.min(powers[i], pathHeadroomKWh * 1000 / (hours * options.efficiency)) : 0;
                if (powers[i] < 0.01) powers[i] = 0;
            }
            const eligible = i => i < demand && slots[i].timestamp < horizonEnd && slots[i].priceValid
                && (cap === 0 || slots[i].price <= cap)
                && slots[demand].price - slots[i].price / (options.efficiency * options.efficiency) >= savings;
            const blocks = priceBlocks(slots, powers, eligible, blockHours, options.now,
                purchases.map(order => order.index)).sort((a, b) => a.cost - b.cost
                    || Number(b.adjacent) - Number(a.adjacent) || b.indices[0] - a.indices[0]);
            let accepted = false;
            for (const block of blocks) {
                const added = fraction => block.indices.map(index => ({index, releaseIndex: demand,
                    powerW: powers[index] * fraction}));
                const before = simulation[demand].unmetUsefulKWh;
                const trial = priceBatterySimulation(slots, targetPlan, options, [...purchases, ...added(1)], demand + 1);
                if (trial[demand].unmetUsefulKWh >= before - 1e-8) continue;
                let fraction = 1;
                if (trial[demand].unmetUsefulKWh <= 1e-7) {
                    // In an unconstrained block the energy equation is
                    // linear; try its exact solution once. Storage clipping
                    // uses a bounded search instead (at most 1/4096 block).
                    const balance = point => point.unmetUsefulKWh / options.efficiency
                        - Math.max(0, point.energy - point.floorEnergy);
                    const exact = Math.min(1, before / (block.capacityKWh * options.efficiency * options.efficiency));
                    const exactCheck = priceBatterySimulation(slots, targetPlan, options,
                        [...purchases, ...added(exact)], demand + 1);
                    if (Math.abs(balance(exactCheck[demand])) <= 1e-8) fraction = exact;
                    else {
                        let low = 0, high = 1;
                        for (let step = 0; step < 12; step++) {
                            const mid = (low + high) / 2;
                            const check = priceBatterySimulation(slots, targetPlan, options,
                                [...purchases, ...added(mid)], demand + 1);
                            if (check[demand].unmetUsefulKWh <= 1e-8) high = mid;
                            else low = mid;
                        }
                        fraction = high;
                    }
                }
                const proposed = priceBatterySimulation(slots, targetPlan, options, [...purchases, ...added(fraction)]);
                // Grid arbitrage must not displace PV already accepted by the
                // forecast. Reject instead of inventing export revenue.
                if (proposed.some((point, i) => point.pvChargeW < simulation[i].pvChargeW - 1e-7)) continue;
                let incrementalCost = 0;
                for (let i = 0; i < slots.length; i++) {
                    const changedKWh = (proposed[i].gridImportW - simulation[i].gridImportW)
                        * pricePlanHours(slots[i].timestamp, options.now) / 1000;
                    if (Math.abs(changedKWh) < 1e-9) continue;
                    if (!slots[i].priceValid) { incrementalCost = Infinity; break; }
                    incrementalCost += changedKWh * slots[i].price;
                }
                const avoidedKWh = before - proposed[demand].unmetUsefulKWh;
                if (incrementalCost > -savings * avoidedKWh + 1e-7) continue;
                purchases.push(...added(fraction));
                simulation = proposed;
                accepted = true;
                break;
            }
            if (!accepted) break;
        }
    }
    const nextPv = slots.findIndex(slot => slot.timestamp + 900000 > options.now
        && (slot.batteryReservedPvW ?? slot.residualPvW) >= 200);
    const horizonSlots = slots.filter(slot => slot.timestamp < horizonEnd).length;
    const untilPv = nextPv === -1 ? horizonSlots : Math.min(nextPv, horizonSlots);
    const chargeWindows = [];
    for (let i = 0; i < simulation.length; i++) {
        const point = simulation[i];
        if (point.gridChargeW <= 1e-8) continue;
        const start = Math.max(options.now, slots[i].timestamp), end = slots[i].timestamp + 900000;
        let window = chargeWindows.at(-1);
        if (!window || window.endTimestamp !== start) {
            window = {startTimestamp: start, endTimestamp: end, gridKWh: 0, targetSoCPct: 0};
            chargeWindows.push(window);
        }
        window.endTimestamp = end;
        window.gridKWh += point.plannedGridEnergyKWh;
        window.targetSoCPct = Math.max(window.targetSoCPct, point.targetSoCPct);
    }
    const expectedSavingsCt = simulation.reduce((sum, point, i) => sum + (slots[i].priceValid
        ? (baseline[i].gridImportW - point.gridImportW) * pricePlanHours(slots[i].timestamp, options.now) / 1000 * slots[i].price : 0), 0);
    const report = {enabled: allowGridCharging,
        roundTripEfficiencyPct: options.efficiency * options.efficiency * 100,
        maximumGridChargeSoCPct: options.gridMaxSoc ?? options.maxSoc,
        chargeWindows,
        expectedSavingsEUR: Math.max(0, expectedSavingsCt / 100),
        savingsBasis: 'forecast-grid-cost-versus-same-PV-plan-without-additional-grid-purchases; excludes-wear-and-export-remuneration',
        pvHeadroomAtNextPvKWh: nextPv < 0 ? null : Math.max(0, options.capacity * options.maxSoc / 100 - simulation[nextPv].initialEnergy),
        reservedPvCapacityKWh: nextPv < 0 ? 0 : Math.min(Math.max(0, options.capacity * options.maxSoc / 100 - simulation[nextPv].initialEnergy),
            baseline.slice(nextPv).reduce((sum, point, i) => sum + point.pvChargeW * pricePlanHours(slots[nextPv + i].timestamp, options.now) / 1000 * options.efficiency, 0)),
        retainedInitialKWh: initialHolds.reduce((sum, lot) => sum + lot.energy, 0),
        bridgeNeedKWh: baseline.slice(0, untilPv).reduce((sum, x) => sum + x.unmetUsefulKWh, 0),
        targetShortfallKWh: Math.max(0, ...baseline.slice(0, horizonSlots).map((point, i) =>
            Math.min(options.maxSoc, targetPlan[i].targetPct) * options.capacity / 100 - point.energy)),
        gridKWh: simulation.reduce((sum, point) => sum + point.plannedGridEnergyKWh, 0),
        unmetHouseholdKWh: simulation.slice(0, horizonSlots).reduce((sum, point) => sum + point.unmetUsefulKWh, 0),
        reason: purchases.length ? 'needed-household-energy-in-cheapest-profitable-blocks'
            : 'pv-storage-sufficient-or-no-profitable-valid-block'};
    if (window) {
        const dischargeKWh = simulation.slice(window.first, window.end).reduce((sum, point, j) =>
            sum + point.dischargeW * pricePlanHours(slots[window.first + j].timestamp, options.now) / 1000, 0);
        const demandKWh = slots.slice(window.first, window.end).reduce((sum, slot) =>
            sum + Math.max(0, slot.baseW - slot.pvW) * pricePlanHours(slot.timestamp, options.now) / 1000, 0);
        report.highTariffReserve = {
            startTimestamp: window.startTimestamp,
            endTimestamp: window.endTimestamp,
            projectedStartSoCPct: simulation[window.first].initialEnergy / options.capacity * 100,
            retainedForHighTariffKWh: initialHolds.filter(lot => inHighTariffWindow(lot.releaseIndex))
                .reduce((sum, lot) => sum + lot.energy, 0),
            householdDemandKWh: demandKWh,
            plannedDischargeKWh: dischargeKWh,
            remainingHouseholdImportKWh: Math.max(0, demandKWh - dischargeKWh)
        };
    }
    return {slots: simulation, report};
}

// Thermal forecast only: these assumptions never authorize a real output.
// Four equally weighted layers are an explicit approximation, not a tank simulation.
const DHW_PV_RESERVE_HORIZON_MIN = 60;
// Forecast spreading uses the largest minimum from the live layering rule.
const DHW_BRIDGE_MIN_SPREAD_W = 900;

// Latest feasible refill before a strictly dearer block. A single sunny slot
// is not a new supply horizon: carry its bounded heat through the whole block.
// This remains a forecast request, never a production/grid-heating permission.
function dhwPriceRiseNeed(data, prices, loads, index, now, maxW, capacity, safety, usable, coldDeficit, spreadUntil = null) {
    const price = prices[index];
    let rise = index + 1;
    const horizon = data.pv[index].timestamp + 24 * 3600000;
    while (rise < loads.length && data.pv[rise].timestamp < horizon) {
        if (!Number.isFinite(prices[rise]) || prices[rise] < price - 1e-7) return 0;
        if (prices[rise] > price + 1e-7) break;
        rise++;
    }
    if (rise >= loads.length || data.pv[rise].timestamp >= horizon) return 0;
    let end = rise;
    while (end < loads.length && data.pv[end].timestamp < horizon
        && Number.isFinite(prices[end]) && prices[end] > price + 1e-7) end++;
    let required = Math.min(capacity, safety);
    for (let j = end - 1; j >= rise; j--) {
        const solarW = Math.max(0, Number(data.pv[j].valueW) - Number(data.house[j]?.valueW || 0));
        const solarKWh = Math.min(maxW, solarW) * pricePlanHours(data.pv[j].timestamp, now) / 1000;
        required = Math.min(capacity, Math.max(safety, required + loads[j] - solarKWh));
    }
    if (rise === spreadUntil) {
        const windowDemand = loads.slice(index, rise).reduce((sum, load) => sum + load, 0);
        return Math.max(0, required + windowDemand + coldDeficit - usable);
    }
    // Equal-price slots can still refill later, including from the grid. Start
    // early only when their remaining heater capacity cannot cover the bridge.
    for (let j = rise - 1; j > index; j--) {
        const heatKWh = maxW * pricePlanHours(data.pv[j].timestamp, now) / 1000;
        required = Math.min(capacity, Math.max(safety, required + loads[j] - heatKWh));
    }
    return Math.max(0, required + loads[index] + coldDeficit - usable);
}

function createDhwForecastModel(data, prices, now, present) {
    const r = CFG.root;
    const maxAge = Math.max(5, readNumber(`${r}.Config.DHWTemperatureMaxAge_min`, 60)) * 60000;
    const sources = CFG.dp.dhwTemps.map(id => {
        const state = id && existsState(id) ? getState(id) : null;
        const value = numericValue(state?.val), timestamp = numericValue(state?.ts);
        const ageMs = timestamp === null ? null : now - timestamp;
        const valid = value !== null && timestamp > 0 && ageMs >= 0 && ageMs <= maxAge
            && state?.ack === true && (state.q === undefined || state.q === 0);
        return {id, valueC: valid ? value : null, timestamp, ageMs, ack: state?.ack ?? null,
            quality: state?.q ?? null, valid};
    });
    const temperatures = sources.map(source => source.valueC);
    const valid = present && temperatures.length === 4 && temperatures.every(t => Number.isFinite(t) && t >= 0 && t <= 100);
    const coefficient = Math.max(0, readNumber(`${r}.Config.DHWVolume_l`, 500)) * 1.163 / 1000;
    const target = Math.max(0, readNumber(`${r}.Config.DHWTargetTemperature_C`, 60));
    const minimum = Math.min(target, Math.max(0, readNumber(`${r}.Config.DHWMinTemperature_C`, 48)));
    const dailyDemand = Math.max(0, readNumber(`${r}.Config.DHWDailyDemand_kWh`, 20));
    const dailyLoss = Math.max(0, readNumber(`${r}.Config.DHWStandingLoss_kWh_day`, 2));
    const safety = Math.max(0, readNumber(`${r}.Config.DHWForecastReserve_kWh`, 0.5));
    const maxW = Math.max(0, Math.min(CFG.limits.myPvDhwMaxW,
        readNumber(`${r}.Config.DHWControllerMaxPower_W`, 9000)));
    let headroom = valid ? temperatures.reduce((sum, t) => sum + Math.max(0, target - t), 0) / 4 * coefficient : 0;
    let usable = valid ? temperatures.reduce((sum, t) => sum + Math.max(0, t - minimum), 0) / 4 * coefficient : 0;
    // Heating a genuinely cold top first restores service; a cold bottom alone does not.
    let coldDeficit = valid ? temperatures.reduce((sum, t) => sum + Math.max(0, minimum - t), 0) / 4 * coefficient : 0;
    let coldTopNeed = valid && temperatures[3] < minimum ? coldDeficit : 0;
    const loads = data.pv.map(slot => (dailyDemand + dailyLoss) / 24 * pricePlanHours(slot.timestamp, now));
    const solarSupplyThresholdW = (dailyDemand + dailyLoss) / 24 * 1000 + 200;
    const report = {valid, reason: !present ? 'not-present' : !valid ? 'four-valid-temperature-sources-required' : 'forecast-only',
        sources, temperaturesC: temperatures, averageTemperatureC: valid ? temperatures.reduce((a, b) => a + b, 0) / 4 : null,
        initialUsableAboveMinimumKWh: valid ? usable : null, initialColdLayerDeficitKWh: valid ? coldDeficit : null, initialHeadroomKWh: valid ? headroom : null,
        dailyDemandKWh: dailyDemand, standingLossKWhDay: dailyLoss, reserveKWh: safety,
        pvReserveRefillHorizonMin: DHW_PV_RESERVE_HORIZON_MIN,
        assumption: 'four-equal-layers; uniform-configured-demand-and-losses; no-boiler/CHP/HP-heat-credit',
        gridAuthorization: false, gridAuthorizationReason: 'forecast-does-not-enable-thermal-price-or-production-releases',
        expectedDemandKWh: 0, expectedLossKWh: 0, gridHeatingKWh: 0, pvHeatingKWh: 0,
        unmetReserveKWh: 0, minimumProjectedUsableKWh: valid ? usable : null, slots: []};
    return {valid, report, maxPowerW: maxW, need: () => valid ? headroom : 0,
        gridRequest(index, pvW, gridLimitW) {
            const empty = reason => ({powerW: 0, priorityPvW: 0, mandatoryPowerW: 0,
                reserveRefillPowerW: 0, reserveTargetKWh: null, reserveCoveredMin: 0, reason});
            if (!valid) return empty('thermal-data-unknown');
            const hours = pricePlanHours(data.pv[index].timestamp, now);
            if (hours <= 0) return empty('elapsed-slot');
            const currentPvKWh = Math.min(headroom, maxW * hours / 1000, Math.max(0, pvW) * hours / 1000);
            const reserveShortfall = Math.max(0, loads[index] + safety - usable);
            const emergencyKWh = Math.min(headroom, Math.max(coldTopNeed, reserveShortfall > 0 ? reserveShortfall + coldDeficit : 0));
            // Refill only from genuine PV, over the next hour including the
            // remaining current slot. Clip overlaps to the actual plan: neither
            // elapsed minutes nor demand beyond its end create reserve energy.
            const horizonStart = Math.max(now, data.pv[index].timestamp);
            const horizonEnd = horizonStart + DHW_PV_RESERVE_HORIZON_MIN * 60000;
            let reserveHours = 0;
            for (let j = index; j < data.pv.length && data.pv[j].timestamp < horizonEnd; j++) {
                const start = Math.max(horizonStart, data.pv[j].timestamp);
                const end = Math.min(horizonEnd, data.pv[j].timestamp + 900000);
                reserveHours += Math.max(0, end - start) / 3600000;
            }
            const reserveTargetKWh = safety + (dailyDemand + dailyLoss) / 24 * reserveHours;
            const reserveShortfallKWh = Math.max(0, reserveTargetKWh - usable);
            const reserveNeedKWh = Math.min(headroom,
                reserveShortfallKWh > 0 ? reserveShortfallKWh + coldDeficit : 0);
            const request = (requestedKWh, reason) => {
                const mandatoryPowerW = Math.min(maxW, requestedKWh * 1000 / hours);
                const priorityPvW = Math.min(Math.max(0, pvW), mandatoryPowerW);
                const powerW = Math.min(gridLimitW, mandatoryPowerW - priorityPvW);
                return {mandatoryPowerW, priorityPvW, powerW,
                    reserveRefillPowerW: Math.max(0, Math.min(maxW, reserveNeedKWh * 1000 / hours)
                        - priorityPvW - powerW),
                    reserveTargetKWh, reserveCoveredMin: reserveHours * 60, reason};
            };
            // Unknown prices deny grid heat, not valid PV service heat. A cold
            // top and the current minimum reserve remain mandatory PV demands.
            if (!Number.isFinite(prices[index])) return request(emergencyKWh,
                emergencyKWh > 0 ? 'minimum-reserve' : 'thermal-price-unknown');
            let depletion = index, consumption = 0;
            while (depletion < loads.length && consumption + loads[depletion] <= usable + Math.max(0, currentPvKWh - coldDeficit) - safety) {
                consumption += loads[depletion++];
            }
            const deadline = Math.min(depletion, loads.length - 1);
            // Wait only when the next cheaper slot can be reached with the existing reserve.
            const cheaperReachable = prices.some((price, j) => j > index && j <= deadline
                && Number.isFinite(price) && price < prices[index] - 1e-7);
            let nextSupply = loads.length;
            for (let j = index + 1; j < loads.length; j++) {
                const solar = Math.max(0, Number(data.pv[j].valueW) - Number(data.house[j]?.valueW || 0));
                if (solar >= solarSupplyThresholdW
                    || (Number.isFinite(prices[j]) && prices[j] < prices[index] - 1e-7)
                    || data.pv[j].timestamp - data.pv[index].timestamp >= 24 * 3600000) { nextSupply = j; break; }
            }
            const bridgeShortfall = Math.max(0, loads.slice(index, nextSupply).reduce((a, b) => a + b, 0) + safety - usable);
            const bridgeNeed = bridgeShortfall > 0 ? bridgeShortfall + coldDeficit : 0;
            let plannedBridgeKWh = bridgeNeed;
            // Spread a grid-only bridge within one price block. Finish by the
            // rise when later PV or the end of the known forecast bounds it.
            if (!cheaperReachable && pvW <= 0 && usable >= safety - 1e-7
                && nextSupply > index + 1) {
                let spreadEnd = index + 1;
                while (spreadEnd < nextSupply
                    && data.pv[spreadEnd].timestamp === data.pv[spreadEnd - 1].timestamp + 900000
                    && Number.isFinite(prices[spreadEnd])
                    && Math.abs(prices[spreadEnd] - prices[index]) <= 1e-7
                    && data.pv[spreadEnd].valueW <= data.house[spreadEnd]?.valueW) spreadEnd++;
                const beforeCheaper = spreadEnd === nextSupply && coldDeficit === 0 && Number.isFinite(prices[nextSupply])
                    && prices[nextSupply] < prices[index] - 1e-7;
                // If tomorrow's same-price block spans the rolling bridge horizon,
                // anchor the demand at the horizon of today's last equal-price slot.
                const lastBlockHorizon = spreadEnd - 1 + 96;
                const repeatedBlock = spreadEnd < nextSupply && coldDeficit === 0
                    && nextSupply === index + 96 && lastBlockHorizon < loads.length
                    && data.pv[nextSupply].timestamp - data.pv[index].timestamp === 24 * 3600000
                    && data.pv.slice(nextSupply, lastBlockHorizon + 1).every((slot, offset) => {
                        const j = nextSupply + offset;
                        return slot.timestamp === data.pv[j - 1].timestamp + 900000
                            && Math.abs(prices[j] - prices[index]) <= 1e-7 && Number.isFinite(prices[j])
                            && slot.valueW - data.house[j]?.valueW < solarSupplyThresholdW;
                    });
                const beforeRise = spreadEnd < nextSupply && coldTopNeed === 0
                    && prices[spreadEnd] > prices[index] + 1e-7
                    && (nextSupply === loads.length
                        || data.pv[nextSupply].valueW - data.house[nextSupply]?.valueW >= solarSupplyThresholdW
                        || repeatedBlock)
                    && data.pv.slice(spreadEnd, nextSupply + 1).every((slot, offset) => {
                        const j = spreadEnd + offset;
                        return slot.timestamp === data.pv[j - 1].timestamp + 900000 && Number.isFinite(prices[j]);
                    });
                if (spreadEnd > index + 1 && (beforeCheaper || beforeRise)
                    && data.pv[spreadEnd].timestamp === data.pv[spreadEnd - 1].timestamp + 900000) {
                    const windowHours = hours + (spreadEnd - index - 1) * 0.25;
                    const riseNeed = beforeRise ? dhwPriceRiseNeed(data, prices, loads, index, now, maxW,
                        coefficient * (target - minimum), safety, usable, coldDeficit, spreadEnd) : 0;
                    const blockBridgeNeed = repeatedBlock && beforeRise
                        ? Math.max(0, loads.slice(index, lastBlockHorizon).reduce((sum, load) => sum + load, 0) + safety - usable)
                        : bridgeNeed;
                    const spreadW = Math.max(blockBridgeNeed, riseNeed) * 1000 / windowHours;
                    const slotHeatKWh = spreadW * hours / 1000;
                    if (spreadW >= DHW_BRIDGE_MIN_SPREAD_W && spreadW <= maxW && slotHeatKWh <= headroom) {
                        let remainingUsable = usable, remainingCold = coldDeficit, remainingRoom = headroom;
                        const reserveCovered = beforeCheaper || loads.slice(index, spreadEnd).every((used, offset) => {
                            const heat = offset === 0 ? slotHeatKWh : spreadW / 4000;
                            if (heat > remainingRoom || remainingUsable - used * Math.min(1, remainingCold / heat) < safety - 1e-7)
                                return false;
                            remainingUsable += Math.max(0, heat - remainingCold) - used;
                            remainingCold = Math.max(0, remainingCold - heat);
                            remainingRoom += used - heat;
                            return remainingUsable >= safety - 1e-7;
                        });
                        if (reserveCovered) plannedBridgeKWh = slotHeatKWh;
                    }
                }
            }
            const preheatNeed = cheaperReachable ? 0 : dhwPriceRiseNeed(data, prices, loads, index, now,
                maxW, coefficient * (target - minimum), safety, usable, coldDeficit);
            const requestedKWh = Math.min(headroom, cheaperReachable ? emergencyKWh
                : Math.max(emergencyKWh, plannedBridgeKWh, preheatNeed));
            return request(requestedKWh,
                emergencyKWh > 0 ? 'minimum-reserve' : cheaperReachable ? 'wait-for-cheaper-window'
                    : preheatNeed > bridgeNeed + 1e-7 ? 'price-preheat' : 'price-bridge');
        },
        advance(index, totalW, pvW, reason, allocation = {}) {
            if (!valid) return;
            const hours = pricePlanHours(data.pv[index].timestamp, now);
            const heated = Math.min(headroom, Math.max(0, totalW) * hours / 1000);
            const solar = Math.min(heated, Math.max(0, pvW) * hours / 1000);
            const used = loads[index];
            usable += Math.max(0, heated - coldDeficit) - used;
            coldDeficit = Math.max(0, coldDeficit - heated);
            coldTopNeed = Math.max(0, coldTopNeed - heated);
            headroom = Math.min(coefficient * target, Math.max(0, headroom - heated + used));
            // Unknown unmet demand is reported, never silently regenerated as stored heat.
            report.unmetReserveKWh += Math.max(0, -usable);
            usable = Math.max(0, usable);
            report.minimumProjectedUsableKWh = Math.min(report.minimumProjectedUsableKWh, usable);
            report.expectedDemandKWh += dailyDemand / 24 * hours;
            report.expectedLossKWh += dailyLoss / 24 * hours;
            report.gridHeatingKWh += heated - solar; report.pvHeatingKWh += solar;
            report.slots.push({timestamp: data.pv[index].timestamp, usableKWh: usable, headroomKWh: headroom,
                consumptionKWh: used, gridKWh: heated - solar, pvKWh: solar, reason, ...allocation});
        }};
}

// Reconcile the price bridge against the finished, exclusive PV allocation.
// Only move already planned grid heat; keep battery/EV/PV trajectories intact.
// This is deliberately a forecast-only, bounded redistribution, not a second
// priority policy or a permission to heat from the grid.
function reconcileDhwPriceBridge(allocations, report, now, maxW, limitsFor, limitToCompetingPv = true) {
    const eps = 1e-7;
    if (!report.valid || report.initialColdLayerDeficitKWh > eps || report.unmetReserveKWh > eps
        || report.minimumProjectedUsableKWh < report.reserveKWh - eps
        || report.slots.length !== allocations.length) return false;
    const hours = allocations.map(slot => pricePlanHours(slot.timestamp, now));
    if (!allocations.every((slot, i) => report.slots[i].timestamp === slot.timestamp
        && Number.isFinite(report.slots[i].headroomKWh) && Number.isFinite(report.slots[i].usableKWh)
        && Math.abs(report.slots[i].gridKWh - slot.dhwGridW * hours[i] / 1000) < eps
        && Math.abs(report.slots[i].pvKWh - slot.dhwPvW * hours[i] / 1000) < eps)) return false;
    const valid = i => allocations[i]?.priceValid === true && Number.isFinite(allocations[i].price)
        && hours[i] > 0 && (i === 0 || allocations[i].timestamp === allocations[i - 1].timestamp + 900000);
    const bridge = slot => ['price-bridge', 'price-preheat'].includes(slot.dhwReason);
    // The initial request can combine emergency reserve and forward heating.
    // Its minimum-reserve label survives the exclusive PV allocation. Allow
    // that already planned grid heat as a donor only: the transfer below
    // increases stored heat until delivery and leaves the ending reserve,
    // PV, minimum heater power and all receiver limits unchanged.
    const donor = slot => bridge(slot) || slot.dhwReason === 'minimum-reserve';
    let movedKWh = 0, savedCt = 0;
    for (let start = 0; start < allocations.length;) {
        if (!valid(start)) { start++; continue; }
        const price = allocations[start].price;
        let rise = start + 1;
        while (valid(rise) && Math.abs(allocations[rise].price - price) <= eps) rise++;
        const cheapStart = start;
        start = rise;
        if (!valid(rise) || allocations[rise].price <= price + eps) continue;
        let end = rise;
        while (valid(end) && allocations[end].price > price + eps
            && allocations[end].timestamp < allocations[rise].timestamp + 24 * 3600000) end++;
        if (end < allocations.length && !valid(end)) continue;
        // First restore the heat displaced by earlier PV allocations. The
        // follow-up pass may also advance the remaining planned site import.
        let availableKWh = limitToCompetingPv ? 0 : Infinity;
        const donors = [];
        for (let i = rise; i < end; i++) {
            const slot = allocations[i];
            if (donor(slot) && availableKWh > eps) {
                const power = Math.max(0, Math.min(slot.mandatoryThermalGridW, slot.dhwGridW,
                    slot.dhwW - Math.max(DHW_BRIDGE_MIN_SPREAD_W, slot.dhwPvW), slot.rawGridW,
                    availableKWh * 1000 / hours[i]));
                const energy = power * hours[i] / 1000;
                if (energy > eps) {
                    donors.push({i, energy});
                    availableKWh -= energy;
                }
            }
            if (limitToCompetingPv)
                availableKWh += Math.max(0, slot.batteryPvW + slot.wallboxPvW + slot.heatingPvW) * hours[i] / 1000;
        }
        if (!donors.length) continue;
        // Existing, grid-only heater slots avoid creating new switching or
        // taking PV / reserve from another device. Require a known unrestricted
        // group budget and use the conservative full-phase limit calculation.
        const receivers = [];
        for (let i = cheapStart; i < rise; i++) {
            const slot = allocations[i];
            if (!bridge(slot) || slot.dhwW < DHW_BRIDGE_MIN_SPREAD_W || slot.pvAfterBaseW > eps
                || slot.rawGridW < 0 || Math.abs(slot.dhwW - slot.dhwGridW) > eps) continue;
            const limits = limitsFor(slot, i);
            if (!limits.valid || limits.consumptionW !== Infinity) continue;
            const remainingGridW = (slot.thermalGridLimitW ?? 0) - slot.dhwGridW - slot.heatingGridW;
            const power = Math.max(0, Math.min(maxW - slot.dhwW, remainingGridW, ...limits.phaseW));
            if (power > eps) receivers.push({i, power});
        }
        if (!receivers.length) continue;
        // Every transfer increases stored heat only between its purchase and
        // original delivery. Bound the whole interval by the smallest free
        // storage capacity; the ending heat content and losses stay identical.
        const headroom = Math.min(...report.slots.slice(cheapStart, donors.at(-1).i + 1).map(s => s.headroomKWh));
        const peak = Math.max(...allocations.slice(cheapStart, end).map(s => s.rawGridW));
        const energyAt = cap => receivers.reduce((sum, r) => sum + Math.max(0,
            Math.min(r.power, cap - allocations[r.i].rawGridW)) * hours[r.i] / 1000, 0);
        const energy = Math.min(headroom, energyAt(peak), donors.reduce((sum, d) => sum + d.energy, 0));
        if (!(energy > eps)) continue;
        // Water-fill the existing cheap slots by total net power, including
        // other planned consumers. Never exceed the original block peak.
        let low = 0, high = peak;
        for (let iteration = 0; iteration < 50; iteration++) {
            const middle = (low + high) / 2;
            if (energyAt(middle) < energy) low = middle; else high = middle;
        }
        const delta = new Map();
        let remaining = energy;
        for (const r of receivers) {
            const power = Math.min(r.power, Math.max(0, high - allocations[r.i].rawGridW), remaining * 1000 / hours[r.i]);
            delta.set(r.i, power);
            remaining -= power * hours[r.i] / 1000;
        }
        remaining = energy - remaining;
        donors.sort((a, b) => allocations[b.i].rawGridW - allocations[a.i].rawGridW || a.i - b.i);
        for (const d of donors) {
            const take = Math.min(d.energy, remaining);
            delta.set(d.i, -take * 1000 / hours[d.i]);
            remaining -= take;
            savedCt += take * (allocations[d.i].price - price);
            movedKWh += take;
        }
        let stored = 0;
        for (let i = cheapStart; i < end; i++) {
            const slot = allocations[i], thermal = report.slots[i], change = delta.get(i) || 0;
            stored += change * hours[i] / 1000;
            thermal.usableKWh += stored;
            thermal.headroomKWh -= stored;
            if (Math.abs(change) <= eps) continue;
            const previousW = slot.dhwW;
            slot.dhwW += change;
            slot.dhwGridW += change;
            slot.dhwBeforeQuantizationW += change;
            for (const key of ['mandatoryThermalW', 'mandatoryThermalGridW', 'mandatoryThermalRequestedW']) {
                slot[key] += change;
                thermal[key] += change;
            }
            slot.rawGridW += change;
            slot.gridW += Math.round(slot.dhwW) - Math.round(previousW);
            if (change > 0 && slot.wallboxForecastLimits)
                slot.wallboxForecastLimits.phaseW = slot.wallboxForecastLimits.phaseW.map(w => Math.max(0, w - change));
            slot.dhwGridShiftW = (slot.dhwGridShiftW || 0) + change;
            thermal.gridKWh += change * hours[i] / 1000;
            thermal.dhwGridShiftW = (thermal.dhwGridShiftW || 0) + change;
        }
    }
    if (movedKWh <= eps) return false;
    report.minimumProjectedUsableKWh = Math.min(report.initialUsableAboveMinimumKWh, ...report.slots.map(s => s.usableKWh));
    const advancedKWh = allocations.reduce((sum, slot, i) =>
        sum + Math.max(0, slot.dhwGridShiftW || 0) * hours[i] / 1000, 0);
    report.gridHeatShift = {energyKWh: advancedKWh, savingsEUR: (report.gridHeatShift?.savingsEUR || 0) + savedCt / 100,
        basis: 'same-heat-energy-and-exclusive-pv-allocation; forecast-only'};
    return true;
}

// A single expensive bridge pulse can leave the rest of its cheap block idle.
// Admit ONE contiguous new grid-only heating window, preserving the complete
// thermal trajectory and the finished exclusive PV/EV/battery allocation.
// Do not rearrange a block that already has a distributed heating schedule.
function reconcileDhwIdleBridge(allocations, report, now, maxW, limitsFor) {
    const eps = 1e-7;
    if (!report.valid || ![report.initialColdLayerDeficitKWh, report.unmetReserveKWh,
        report.initialUsableAboveMinimumKWh, report.minimumProjectedUsableKWh, report.reserveKWh, maxW]
        .every(n => Number.isFinite(n) && n >= 0)
        || report.initialColdLayerDeficitKWh > eps || report.unmetReserveKWh > eps
        || report.initialUsableAboveMinimumKWh < report.reserveKWh - eps
        || report.minimumProjectedUsableKWh < report.reserveKWh - eps
        || report.slots.length !== allocations.length) return false;
    const hours = allocations.map(slot => pricePlanHours(slot.timestamp, now));
    const keys = ['mandatoryThermalW', 'mandatoryThermalGridW', 'mandatoryThermalRequestedW'];
    if (!allocations.every((slot, i) => {
        const t = report.slots[i];
        return t.timestamp === slot.timestamp && Number.isFinite(t.usableKWh) && Number.isFinite(t.headroomKWh)
            && t.usableKWh >= report.reserveKWh - eps && t.headroomKWh >= -eps
            && Number.isFinite(slot.rawGridW) && Number.isFinite(slot.gridW)
            && Math.abs(t.gridKWh - slot.dhwGridW * hours[i] / 1000) < eps
            && Math.abs(t.pvKWh - slot.dhwPvW * hours[i] / 1000) < eps;
    })) return false;
    const full = i => hours[i] === 0.25 && allocations[i]?.priceValid === true
        && Number.isFinite(allocations[i].price)
        && (i === 0 || allocations[i].timestamp === allocations[i - 1].timestamp + 900000);
    const bridge = s => ['price-bridge', 'price-preheat'].includes(s.dhwReason);
    const movable = i => {
        const s = allocations[i], t = report.slots[i], power = s.dhwGridW;
        return Number.isFinite(power) && power > eps && s.rawGridW + eps >= power
            && Math.abs(s.dhwW - s.dhwPvW - power) < eps
            && (s.dhwPvW <= eps || s.dhwPvW >= DHW_BRIDGE_MIN_SPREAD_W)
            && keys.every(k => Number.isFinite(s[k]) && Number.isFinite(t[k])
                && s[k] + eps >= power && t[k] + eps >= power)
            && Number.isFinite(s.dhwBeforeQuantizationW) && s.dhwBeforeQuantizationW + eps >= power;
    };
    const idleCapacity = i => {
        const s = allocations[i], t = report.slots[i];
        // A new block cannot steal any PV or battery/EV/heating capacity, or
        // override an earlier suppressed request. Unknown inputs fail closed.
        if (s.dhwReason !== 'off' || ![s.dhwW, s.dhwGridW, s.dhwPvW, s.dhwBeforeQuantizationW,
            s.pvW, s.pvAfterBaseW, s.wallboxW, s.wallboxPvW, s.wallboxGridW, s.batteryW,
            s.batteryPvW, s.batteryGridChargeW, s.heatingW, s.heatingPvW, s.heatingGridW,
            ...keys.map(k => s[k]), ...keys.map(k => t[k])].every(w => Number.isFinite(w) && Math.abs(w) <= eps)
            || !Number.isFinite(s.rawGridW) || s.rawGridW < 0) return 0;
        const limits = limitsFor(s, i);
        return limits.valid && limits.consumptionW === Infinity && limits.phaseW?.length
            && limits.phaseW.every(w => Number.isFinite(w) && w >= 0)
            ? Math.min(maxW, s.thermalGridLimitW ?? 0, ...limits.phaseW) : 0;
    };
    let changed = false, savedCt = 0;
    for (let start = 0; start < allocations.length;) {
        if (!full(start)) { start++; continue; }
        const cheapStart = start, price = allocations[start].price;
        let rise = start + 1;
        while (full(rise) && Math.abs(allocations[rise].price - price) <= eps) rise++;
        start = rise;
        // An unknown predecessor cannot establish the beginning of a complete
        // cheap price block; do not reinterpret its suffix as a new block.
        if (cheapStart > 0 && (!allocations[cheapStart - 1].priceValid
            || !Number.isFinite(allocations[cheapStart - 1].price)
            || allocations[cheapStart].timestamp !== allocations[cheapStart - 1].timestamp + 900000)) continue;
        if (!full(rise) || allocations[rise].price <= price + eps) continue;
        let end = rise;
        while (full(end) && allocations[end].price > price + eps
            && allocations[end].timestamp < allocations[rise].timestamp + 86400000) end++;
        if (end < allocations.length && !full(end)) continue;
        const cheapActive = [];
        for (let i = cheapStart; i < rise; i++) if (allocations[i].dhwW > eps) cheapActive.push(i);
        if (cheapActive.length > 1 || cheapActive.some(i => !bridge(allocations[i])
            || allocations[i].dhwPvW > eps || !movable(i))) continue;
        const donors = cheapActive.slice();
        // Only existing, fully accounted heat is movable. Keep any sub-minimum
        // PV-only remainder and any other mandatory or optional heat unchanged.
        for (let i = rise; i < end; i++) {
            const s = allocations[i];
            if ((bridge(s) || s.dhwReason === 'minimum-reserve') && movable(i)) donors.push(i);
        }
        if (!donors.length) continue;
        const energy = donors.reduce((sum, i) => sum + allocations[i].dhwGridW * hours[i] / 1000, 0);
        if (!(energy > eps)) continue;
        const originalPeak = Math.max(...allocations.slice(cheapStart, end).map(s => s.rawGridW));
        let best = null;
        for (let from = cheapStart; from < rise;) {
            if (idleCapacity(from) < DHW_BRIDGE_MIN_SPREAD_W) { from++; continue; }
            let to = from + 1;
            while (to < rise && idleCapacity(to) >= DHW_BRIDGE_MIN_SPREAD_W) to++;
            const blockFrom = from;
            from = to;
            // One continuous block and no new single-quarter pulse.
            if (to - blockFrom < 2) continue;
            const power = energy * 4000 / (to - blockFrom);
            if (power < DHW_BRIDGE_MIN_SPREAD_W - eps) continue;
            const delta = new Map(donors.map(i => [i, -allocations[i].dhwGridW]));
            let admissible = true;
            for (let i = blockFrom; i < to; i++) {
                if (power > idleCapacity(i) + eps) { admissible = false; break; }
                delta.set(i, power);
            }
            if (!admissible) continue;
            let stored = 0, peak = 0;
            for (let i = cheapStart; i < end; i++) {
                const t = report.slots[i], change = delta.get(i) || 0;
                stored += change * hours[i] / 1000;
                // A delayed cheap pulse needs sufficient reserve before each
                // delivery; never reduce the existing rolling reserve target.
                const floor = stored < -eps
                    ? Math.max(report.reserveKWh, Number.isFinite(t.thermalReserveTargetKWh)
                        ? t.thermalReserveTargetKWh : Infinity) : report.reserveKWh;
                if (t.usableKWh + stored < floor - eps || t.headroomKWh - stored < -eps) {
                    admissible = false; break;
                }
                peak = Math.max(peak, allocations[i].rawGridW + change);
            }
            if (!admissible || Math.abs(stored) > eps || peak >= originalPeak - eps) continue;
            if (!best || peak < best.peak - eps) best = {delta, peak};
        }
        if (!best) continue;
        let stored = 0;
        for (let i = cheapStart; i < end; i++) {
            const s = allocations[i], t = report.slots[i], change = best.delta.get(i) || 0;
            stored += change * hours[i] / 1000;
            t.usableKWh += stored;
            t.headroomKWh -= stored;
            if (Math.abs(change) <= eps) continue;
            const previousW = s.dhwW;
            s.dhwW += change;
            s.dhwGridW += change;
            s.dhwBeforeQuantizationW += change;
            for (const key of keys) { s[key] += change; t[key] += change; }
            if (change > 0) { s.dhwReason = 'price-bridge'; t.reason = 'price-bridge'; }
            else if (s.dhwW <= eps) { s.dhwReason = 'off'; t.reason = 'price-bridge-shifted'; }
            s.rawGridW += change;
            s.gridW += Math.round(s.dhwW) - Math.round(previousW);
            if (change > 0 && s.wallboxForecastLimits)
                s.wallboxForecastLimits.phaseW = s.wallboxForecastLimits.phaseW.map(w => Math.max(0, w - change));
            s.dhwGridShiftW = (s.dhwGridShiftW || 0) + change;
            t.gridKWh += change * hours[i] / 1000;
            t.dhwGridShiftW = (t.dhwGridShiftW || 0) + change;
            if (change < 0) savedCt -= change * hours[i] / 1000 * (s.price - price);
        }
        changed = true;
    }
    if (!changed) return false;
    report.minimumProjectedUsableKWh = Math.min(report.initialUsableAboveMinimumKWh, ...report.slots.map(s => s.usableKWh));
    report.gridHeatShift = {
        energyKWh: allocations.reduce((sum, s, i) => sum + Math.max(0, s.dhwGridShiftW || 0) * hours[i] / 1000, 0),
        savingsEUR: (report.gridHeatShift?.savingsEUR || 0) + savedCt / 100,
        basis: 'same-heat-energy-and-exclusive-pv-allocation; forecast-only', idleBridge: true};
    return true;
}

// The reserve plan has already selected its refill time and simulated every
// battery slot. Moving grid heat must not change that simulation or consume
// capacity needed by its deadline. Verify each pass separately so a rejected
// extra purchase cannot undo the already verified shared-PV adjustment.
function reconcileDhwPriceBridgeWithReserve(allocations, report, now, maxW, limitsFor, reserve, reserveFits) {
    if (!report.valid) return false;
    let changed = false;
    for (const pass of [true, false, 'idle']) {
        const candidate = reserve ? allocations.map(slot => ({...slot,
            ...(slot.wallboxForecastLimits ? {wallboxForecastLimits: {...slot.wallboxForecastLimits}} : {})})) : allocations;
        const candidateReport = reserve ? {...report, slots: report.slots.map(slot => ({...slot}))} : report;
        if (!(pass === 'idle' ? reconcileDhwIdleBridge(candidate, candidateReport, now, maxW, limitsFor)
            : reconcileDhwPriceBridge(candidate, candidateReport, now, maxW, limitsFor, pass))) continue;
        if (reserve) {
            if (!candidate.every((slot, i) => slot.dhwW === allocations[i].dhwW || reserveFits(slot, i))) continue;
            candidateReport.gridHeatShift.batteryReservePreserved = true;
            allocations.splice(0, allocations.length, ...candidate);
            Object.assign(report, candidateReport);
        }
        changed = true;
    }
    return changed;
}

function forecastReserveHeatFits(reserve, slot, original, proof, consumptionLimit, options) {
    if (!proof) return false;
    const {now, maxCharge, capacity, efficiency, maxSoc} = options;
    const changed = {...original, dhwW: slot.dhwW};
    changed.forecastReserveCapW = forecastBatteryReservePowerW(changed, consumptionLimit, maxCharge);
    const eps = 1e-7;
    if (!Number.isFinite(changed.forecastReserveCapW)) return false;
    // Keep the capacity used when searching for a refill before the deadline,
    // even if a particular slot currently needs no charge.
    const recoveryW = forecastReserveRecoveryPowerW(maxCharge);
    if (pricePlanHours(slot.timestamp, now, reserve.deadlineAt) > 0
        && Math.min(recoveryW, changed.forecastReserveCapW) + eps
            < Math.min(recoveryW, original.forecastReserveCapW)) return false;
    const replay = plannedForecastReserveCharge(reserve, changed, proof.soc, {
        hours: proof.reserveHours, capacity, efficiency, maxSoc, pvChargeW: proof.ordinaryPvW});
    return Math.abs(replay.pvChargeW - proof.pvChargeW) <= eps
        && Math.abs(replay.reserveGridChargeW - proof.reserveGridChargeW) <= eps;
}

function departureSlotLimits(vehicle, phases, slot, wallboxes, i, consumptionLimit) {
    const otherW = wallboxes.reduce((sum, series, wb) => wb === vehicle.index ? sum : sum
        + series[i].currentA * series[i].phases * vehicle.nominalVoltage, 0);
    const limits = parallelForecastLimits(0, slot.baseW + otherW, slot.dhwW,
        slot.heatingW, slot.batteryGridChargeW, consumptionLimit);
    return {otherW, gridW: Math.min(Math.min(...limits.phaseW) * phases, limits.consumptionW - otherW)};
}

// Latest continuous block at minimum current, even with no sun. Include
// startup delay and the delivery margin. The last slot ends before departure.
function departureBackupWindow(basis, slots, soc, mobility, minimumW, phases, safety, delayMs, now) {
    if (!(basis.connectedSince > 0 && basis.connectedSince <= now) || !(minimumW > 0) || soc < mobility) return null;
    const needKWh = (basis.minimumSocPct - soc) * basis.capacityKWh / (100 * basis.efficiency);
    const reliableW = minimumW * safety;
    let until = slots.at(-1).end;
    for (let i = slots.length - 1; i >= 0; i--) {
        const slot = slots[i];
        if (slot.backupW < minimumW) { until = slot.timestamp; continue; }
        if (slot.timestamp <= now) break;
        const backupAcKWh = reliableW * Math.max(0, until - slot.timestamp - delayMs) / 3600000000;
        if (backupAcKWh >= needKWh) return {...basis, reservePct: mobility, releaseAt: slot.timestamp,
            backupAcKWh, backupUntil: until, backupMinimumW: minimumW, backupPhases: phases};
    }
    return null;
}

function departurePvWindows(vehicle, data, allocations, wallboxes, battery, trajectory, options) {
    const {index: wb, departureTimestamp: departureAt, minimumSocPct, targetSocPct, capacityKWh, efficiency} = vehicle;
    const {now, consumptionLimit, initialSoc, storageCapacity, storageEfficiency, safety} = options;
    const soc = vehicle.departureSocPct;
    if (vehicle.datedTrip || !vehicle.eligible || !vehicle.connected || !vehicle.socValid || !vehicle.deadlineEnabled || !Number.isFinite(soc)
        || !(soc < minimumSocPct && minimumSocPct <= targetSocPct && capacityKWh > 0) || vehicle.priceChargingEnabled
        || vehicle.manualMinimumCurrentA > 0 || lowSocMinimumCurrent(wb, soc, 2) > 0) return [];
    const finish = departureAt - departureFinishReserveMs;
    const first = Math.floor(now / 900000) * 900000;
    const count = Math.ceil((finish - first) / 900000);
    if (count < 2 || count > allocations.length || allocations[0].timestamp !== first) return [];
    const fixed = vehicle.phaseControlMode === 'script' && vehicle.phaseSwitchEnabled;
    if (fixed && !vehicle.phaseFeedbackValid) return [];
    const phases = fixed && vehicle.confirmedPhases === 3 ? 3 : 1;
    const stepW = vehicle.nominalVoltage * phases;
    const commissioningA = Number(vehicleSetting(wb, 'CommissioningMaxA', 6));
    const maximumA = Math.min(commissioningA, taperCurrentLimit(wb, minimumSocPct, targetSocPct,
        phases === 3 ? vehicle.baseMaxCurrent3pA : vehicle.baseMaxCurrent1pA));
    const minimumA = phases === 3 ? vehicle.baseMinCurrent3pA : vehicle.baseMinCurrent1pA;
    const quantized = watts => {
        const amps = Math.floor(Math.min(watts / stepW, vehicle.maximumPowerW / stepW, maximumA) + 1e-9);
        return amps >= minimumA ? amps * stepW : 0;
    };
    const delayMs = Math.max(0, readNumber(`${CFG.root}.Config.WallboxStartDelay_s`, 30)) * 1000;
    const slots = [];
    for (let i = 0; i < count; i++) {
        const slot = allocations[i], timestamp = slot.timestamp;
        if (timestamp !== first + i * 900000 || !Number.isFinite(data.house[i]?.valueW)
            || data.house[i].timestamp !== undefined && data.house[i].timestamp !== timestamp) return [];
        const {otherW, gridW} = departureSlotLimits(vehicle, phases, slot, wallboxes, i, consumptionLimit);
        const storage = battery[i];
        const priorSoc = i === 0 ? initialSoc : trajectory[i - 1].soc;
        const floorChargeW = Math.max(0, storage.dischargeFloorPct - priorSoc)
            * storageCapacity * 10 / (storageEfficiency * 0.25);
        const flexibleStorageW = storage.forecastValid && !storage.highTariffReserve
            ? Math.max(0, slot.batteryPvW - floorChargeW) : 0;
        const ownPvW = Math.max(0, wallboxes[wb][i].valueW - slot.wallboxGridW);
        const availablePvW = Math.min(slot.remainingPvW + flexibleStorageW + ownPvW,
            slot.pvW - slot.baseW - slot.dhwW - slot.heatingW - otherW);
        const backupW = quantized(gridW);
        slots.push({timestamp, end: Math.min(timestamp + 900000, finish), backupW,
            solarW: Math.min(quantized(availablePvW), backupW)});
    }
    const mobility = readNumber(`${CFG.root}.Vehicles.Wallbox${wb}.MobilityReserve_pct`, 0);
    const basis = {index: wb, departureAt, minimumSocPct, targetSocPct, capacityKWh, efficiency,
        connectedSince: wallboxConnectionSince(wb)};
    const previous = typeof freshPlanItem === 'function' && freshPlanItem(`Wallbox${wb}`, null, now)?.departurePv;
    const sameBooking = previous && Object.keys(basis).every(key => previous[key] === basis[key]);
    const reserve = wallboxMobilityReserve(wb, minimumSocPct, now);
    if (reserve !== null && !vehicle.deadlineTargetSocEnabled) {
        if (soc < reserve) return [];
        // Once the booked charge is due, a rising SoC is progress on that
        // charge. Do not interpret it as permission to stop and start again.
        if (sameBooking && previous.minimumByDeparture && previous.reservePct === reserve
            && previous.releaseAt <= now) return [previous];
        const window = departureBackupWindow(basis, slots, soc, reserve, minimumA * stepW,
            phases, safety, delayMs, now);
        return window ? [{...window, minimumByDeparture: true}] : [];
    }
    const earned = sameBooking && !previous.minimumByDeparture && previous.releaseAt > now && previous.releaseAt < finish
        && previous.reservePct >= 0 && previous.reservePct < minimumSocPct && soc >= previous.reservePct;
    const fallback = earned ? departureBackupWindow(basis, slots, soc, mobility, minimumA * stepW,
        phases, safety, delayMs, now) : null;
    // A missing PV sample contributes zero. It can split a solar window,
    // but a dark quarter overnight cannot erase a separate morning window.
    let releaseAt = 0, solarAcKWh = 0, backupAcKWh = 0;
    for (const {timestamp, end, backupW, solarW} of slots) {
        if (!(solarW > 0)) {
            if (releaseAt) break;
            continue;
        }
        if (!releaseAt) releaseAt = timestamp;
        solarAcKWh += solarW * (end - timestamp) / 3600000000;
        backupAcKWh += backupW * Math.max(0, end - Math.max(timestamp, releaseAt + delayMs)) / 3600000000;
    }
    const credit = Math.min(safety * solarAcKWh, backupAcKWh);
    const reservePct = Math.max(mobility, 0, Math.ceil((minimumSocPct - credit * efficiency * 100 / capacityKWh) * 10) / 10);
    const solar = releaseAt > now && reservePct < minimumSocPct
        ? {...basis, releaseAt, reservePct, backupAcKWh} : null;
    if (releaseAt && releaseAt <= now) return fallback ? [fallback] : [];
    return (solar && soc >= reservePct ? [solar, fallback] : [fallback, solar]).filter(Boolean);
}

function departurePvEnergy(series, allocations, now, releaseAt, finish) {
    let earlyGrid = 0, solar = 0, delivered = 0;
    for (let i = 0; i < series.length && series[i].timestamp < finish; i++) {
        const point = series[i], hours = pricePlanHours(point.timestamp, now, finish);
        const energy = point.valueW * hours / 1000;
        const grid = Math.min(point.valueW, allocations[i].wallboxGridW) * hours / 1000;
        delivered += energy;
        if (point.timestamp < releaseAt) earlyGrid += grid;
        else solar += energy - grid;
    }
    return {earlyGrid, solar, delivered};
}

function repayBatteryCharge(recipients, flex, allocations, wattHours) {
    while (wattHours > 1e-9 && recipients.length) {
        const dest = recipients[recipients.length - 1];
        const used = Math.min(dest.leftWh, wattHours);
        const recoveredW = used / dest.hours;
        flex[dest.i].batteryReservedPvW += recoveredW;
        flex[dest.i].residualPvW = Math.max(0, flex[dest.i].residualPvW - recoveredW);
        const later = allocations[dest.i];
        later.pvHeadroomBatteryW = (later.pvHeadroomBatteryW || 0) + recoveredW;
        wattHours -= used;
        dest.leftWh -= used;
        if (dest.leftWh <= 1e-9) recipients.pop();
    }
}

function continuingSinglePhasePvCharge(wb, series, i, now) {
    if (i > 0) {
        const previous = series[i - 1];
        return previous.timestamp + 900000 === series[i].timestamp && previous.phases === 1
            && previous.valueW > 0 && !previous.priceOptimized && !previous.chargingUntil
            && previous.chargingMinutes >= 60 * pricePlanHours(previous.timestamp, now) - 1e-7;
    }
    const maxAgeMs = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
    return getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
        && typeof coordinatedWallboxPowerKW === 'function'
        && coordinatedWallboxPowerKW(CFG.dp.wallboxesKW[wb], maxAgeMs) > 0.1;
}

// The ordinary pass exchanges AC watt-hours against full-battery export.
// Continuations may also use export at a staged target, within that stage's deadline.
function shiftWallboxBatteryHeadroom(flex, allocations, wallboxes, vehicles, budgetWh, options, stages, allowIncreases) {
    const {now, maxCharge, maxSoc, minSoc, consumptionLimit} = options;
    const recipients = [];
    let shifted = false;
    for (let i = flex.length - 1; i >= 0; i--) {
        const slot = flex[i], trace = allocations[i], next = flex[i + 1];
        const hours = pricePlanHours(slot.timestamp, now);
        const stage = stages?.[i];
        if (next && (next.timestamp !== slot.timestamp + 900000
            || localDateKey(new Date(next.timestamp)) !== localDateKey(new Date(slot.timestamp))
            || stage && (stage.stage !== stages[i + 1].stage
                || stage.deadlineIndex !== stages[i + 1].deadlineIndex))) recipients.length = 0;
        const netPvW = slot.pvW - slot.baseW - slot.dhwW - slot.heatW - trace.wallboxW;
        if (!hours || slot.pauseBattery || slot.pvW <= 0 || netPvW < -1e-7
            || trace.wallboxGridW > 1e-7 || !(slot.prioritySocBefore > minSoc + 1e-8)) {
            recipients.length = 0;
            continue;
        }
        const limits = trace.wallboxForecastLimits;
        if (!limits?.valid || limits.consumptionW !== Infinity || trace.activeWallboxes.some(index => wallboxes[index][i].priceOptimized)) {
            recipients.length = 0;
            continue;
        }
        // Use current PV for the entire minimum and keep the instantaneous
        // margin. Only the charge displaced from storage has to be repaid.
        const idleWb = trace.activeWallbox;
        const idleVehicle = vehicles[idleWb];
        const idlePoint = wallboxes[idleWb]?.[i];
        if (recipients.length && idleVehicle && idlePoint && trace.activeWallboxes.length === 0
            && idlePoint.conditional && slot.residualPvW > 0
            && slot.batteryReservedPvW > 0 && trace.dhwGridW <= 1e-7 && trace.heatingGridW <= 1e-7
            && nativeConfig[`wb${idleWb}ControlEnabled`] === true && idleVehicle.connected && idleVehicle.socValid && idleVehicle.eligible
            && !idleVehicle.priceChargingEnabled && !idleVehicle.readyBy
            && !idleVehicle.mustCharge && !idleVehicle.belowMinimum && !idleVehicle.manualMinimumCurrentA
            && !idlePoint.priceOptimized && !idlePoint.chargingUntil
            && (stage ? !(idleVehicle.deadlineEnabled && idleVehicle.departureTimestamp > 0)
                    && continuingSinglePhasePvCharge(idleWb, wallboxes[idleWb], i, now)
                : hours === 0.25 && !idleVehicle.deadlineEnabled
                    && wallboxes[idleWb].slice(i + 1).every(point => point.valueW === 0))
            && (!idleVehicle.phaseSwitchEnabled || idleVehicle.phaseFeedbackValid && idleVehicle.confirmedPhases === 1)) {
            const voltage = idleVehicle.nominalVoltage;
            const minimumA = idleVehicle.minCurrent1pA;
            const minimumW = minimumA * voltage;
            const startReserveW = Math.max(0, readNumber(`${CFG.root}.Config.WallboxStartReserve_W`, 300));
            const displacedW = minimumW - slot.residualPvW;
            const repayWh = displacedW * hours;
            const recoverableWh = recipients.reduce((sum, dest) => sum + dest.leftWh, 0);
            const remainingChargeW = slot.batteryReservedPvW - displacedW;
            const caps = parallelForecastLimits(slot.pvW, slot.baseW, slot.dhwW, slot.heatW,
                remainingChargeW, consumptionLimit);
            if (minimumA > 0 && minimumA <= Math.min(idleVehicle.maxCurrent1pA,
                Math.floor(Number(nativeConfig[`wb${idleWb}CommissioningMaxA`] ?? 6)))
                && minimumW <= idleVehicle.maximumPowerW && minimumW * hours <= budgetWh[idleWb]
                && displacedW > 0 && remainingChargeW >= startReserveW
                && (!stage || remainingChargeW >= Math.max(slot.requiredPvChargeW || 0, trace.pvHeadroomBatteryW || 0))
                && caps.valid && caps.consumptionW === Infinity && caps.phaseW[0] >= minimumW + startReserveW
                && repayWh <= recoverableWh + 1e-9) {
                shifted = true;
                idlePoint.currentA = minimumA;
                idlePoint.phases = 1;
                idlePoint.valueW = minimumW;
                idlePoint.chargingMinutes = 60 * hours;
                slot.wbW[idleWb] = minimumW;
                slot.batteryReservedPvW = remainingChargeW;
                slot.residualPvW = 0;
                budgetWh[idleWb] -= minimumW * hours;
                trace.activeWallboxes.push(idleWb);
                trace.waitingWallboxes = trace.waitingWallboxes.filter(index => index !== idleWb);
                trace.wallboxCommandW[idleWb] = minimumW;
                trace.wallboxRequestedW += minimumW;
                trace.wallboxW += minimumW;
                trace.wallboxPvW += minimumW;
                trace.wallboxPvAvailableW += displacedW;
                trace.pvBeforeBatteryW = remainingChargeW;
                trace.pvHeadroomWallboxW = displacedW;
                trace.pvHeadroomStartW = minimumW;
                repayBatteryCharge(recipients, flex, allocations, repayWh);
            }
        }
        const wb = allowIncreases && recipients.length ? trace.activeWallboxes.find(index => {
            const vehicle = vehicles[index], point = wallboxes[index][i];
            return nativeConfig[`wb${index}ControlEnabled`] === true && vehicle.socValid && vehicle.eligible
                && !vehicle.priceChargingEnabled && !vehicle.readyBy && !vehicle.mustCharge && !vehicle.belowMinimum
                && !vehicle.manualMinimumCurrentA && !point.chargingUntil && !point.priceOptimized
                && (!stage || !trace.pvHeadroomStartW && !(vehicle.deadlineEnabled && vehicle.departureTimestamp > 0)
                    && slot.batteryReservedPvW - point.phases * vehicle.nominalVoltage >= slot.requiredPvChargeW)
                && budgetWh[index] > 0 && Number.isFinite(budgetWh[index])
                && (!vehicle.phaseSwitchEnabled || vehicle.phaseFeedbackValid && vehicle.confirmedPhases === point.phases)
                && point.currentA < Math.min(point.phases === 3 ? vehicle.maxCurrent3pA : vehicle.maxCurrent1pA,
                    Math.floor(Number(nativeConfig[`wb${index}CommissioningMaxA`] ?? 6)))
                && (point.currentA + 1) * point.phases * vehicle.nominalVoltage <= vehicle.maximumPowerW
                && Math.abs(slot.wbW[index] - point.currentA * point.phases * vehicle.nominalVoltage) < 1e-7
                && slot.batteryReservedPvW - (trace.pvHeadroomBatteryW || 0) - point.phases * vehicle.nominalVoltage >= maxCharge / 2;
        }) : undefined;
        if (wb !== undefined) {
            const point = wallboxes[wb][i], stepW = point.phases * vehicles[wb].nominalVoltage;
            const recoverableWh = recipients.reduce((sum, dest) => sum + dest.leftWh, 0);
            const moveWh = Math.min(stepW * hours, budgetWh[wb], recoverableWh);
            // Only the highest ampere step may start partway through a slot.
            // The earlier steps then cover its entire remaining duration.
            if (moveWh * 3600000 / stepW >= 1000) {
                shifted = true;
                const extraW = moveWh / hours, end = slot.timestamp + 900000;
                point.pvHeadroom = {baseA: point.pvHeadroom?.baseA ?? point.currentA,
                    stepW, from: Math.round(end - moveWh * 3600000 / stepW)};
                point.currentA++;
                slot.wbW[wb] += extraW;
                point.valueW = Math.round(slot.wbW[wb]);
                slot.batteryReservedPvW -= extraW;
                budgetWh[wb] -= moveWh;
                trace.wallboxCommandW[wb] += stepW;
                trace.wallboxRequestedW += extraW;
                trace.wallboxW += extraW;
                trace.wallboxPvW += extraW;
                trace.wallboxPvAvailableW += extraW;
                trace.pvBeforeBatteryW -= extraW;
                trace.pvHeadroomWallboxW = (trace.pvHeadroomWallboxW || 0) + extraW;
                repayBatteryCharge(recipients, flex, allocations, moveWh);
            }
        }
        const spillTarget = stage ? slot.batteryPvTargetPct : maxSoc;
        if (slot.residualPvW > 0 && slot.prioritySocAfter >= spillTarget - 1e-8 && slot.batteryPvTargetPct >= spillTarget) {
            const caps = parallelForecastLimits(slot.pvW, slot.baseW, slot.dhwW, slot.heatW, slot.batteryReservedPvW, consumptionLimit);
            const phaseDrawW = trace.wallboxCommandW.reduce((sum, power, index) => sum + power / wallboxes[index][i].phases, 0);
            const carW = trace.wallboxCommandW.reduce((sum, watts) => sum + watts, 0);
            const canStoreW = Math.min(slot.residualPvW, maxCharge - slot.batteryReservedPvW,
                slot.pvW - slot.baseW - slot.dhwW - slot.heatW - carW - slot.batteryReservedPvW,
                Math.min(...caps.phaseW) - phaseDrawW);
            if (canStoreW > 0) recipients.push({i, hours, leftWh: canStoreW * hours});
        }
    }
    return shifted;
}

function planWallboxBatteryHeadroom(flex, allocations, wallboxes, vehicles, remainingKWh, options, targetPlan) {
    const budgetWh = remainingKWh.map(energy => energy * 1000 / options.efficiency);
    function allocate(stages, allowIncreases) {
        let shifted;
        do {
            shifted = shiftWallboxBatteryHeadroom(flex, allocations, wallboxes, vehicles, budgetWh,
                options, stages, allowIncreases);
        } while (shifted);
    }
    allocate(null, true);
    // Full-battery exchanges can cross an intermediate target. Use the actual
    // resulting SoC when identifying export at that target in the next passes.
    let adjustedWh = 0;
    for (let i = 0; i < flex.length; i++) {
        const trace = allocations[i], slot = flex[i];
        slot.prioritySocBefore += adjustedWh * options.storedPctPerWh;
        adjustedWh += ((trace.pvHeadroomBatteryW || 0) - (trace.pvHeadroomWallboxW || 0)) * pricePlanHours(slot.timestamp, options.now);
        slot.prioritySocAfter += adjustedWh * options.storedPctPerWh;
    }
    allocate(targetPlan, false); // Fund a continuing vehicle's whole minimum before spending spare Wh on extra amperes.
    allocate(targetPlan, true);
    for (let i = 0; i < flex.length; i++) {
        const trace = allocations[i], slot = flex[i];
        if (trace.pvHeadroomBatteryW || trace.pvHeadroomWallboxW)
            trace.wallboxForecastLimits = parallelForecastLimits(slot.pvW, slot.baseW, slot.dhwW,
                slot.heatW, slot.batteryReservedPvW, options.consumptionLimit);
    }
}

// Once a PV stage is covered, live coordination leaves unclaimed surplus
// available to storage. Reserve the full EV commands, including short charges.
function residualStageChargeW(slot, allocation, wallboxes, i, reservedW, maxCharge, consumptionLimit) {
    const voltage = readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230);
    const fullCarW = wallboxes.reduce((sum, series) => {
        const point = series[i];
        return sum + Math.max(point.valueW, point.currentA * point.phases * voltage);
    }, 0);
    const spareW = slot.pvW - slot.baseW - slot.dhwW - slot.heatW - fullCarW - reservedW;
    if (spareW <= 0 || allocation.wallboxGridW > 0 || allocation.dhwGridW > 0 || allocation.heatingGridW > 0) return 0;
    const limits = parallelForecastLimits(slot.pvW, slot.baseW + fullCarW, slot.dhwW, slot.heatW, reservedW, consumptionLimit);
    return limits.valid && limits.consumptionW === Infinity
        ? Math.max(0, Math.min(slot.residualPvW, spareW, maxCharge - reservedW, ...limits.phaseW)) : 0;
}

function plannedBatteryStageReached(stage, timestamp, targetSoc, projectedSoc) {
    const day = localDateKey(new Date(timestamp));
    if (day !== stage.day) {
        stage.day = day;
        stage.reachedPct = typeof reachedBatteryPvTarget === 'function' ? reachedBatteryPvTarget(day) : -1;
    }
    if (projectedSoc + 1e-8 >= targetSoc) stage.reachedPct = Math.max(stage.reachedPct, targetSoc);
    return stage.reachedPct >= targetSoc;
}

// Fill a bounded hole between two solar charging periods. Only the missing
// AC power comes from storage. The next real solar slot must already exist.
function planEqvPvGap(i, flex, allocations, series, stages, vehicle, options) {
    const {now, soc, floor, capacity, efficiency, maxDischarge, remainingWh} = options;
    const first = flex[i], stage = stages[i], minW = vehicle.nominalVoltage * 6;
    if (!vehicle.eligible || !vehicle.connected || !vehicle.socValid || vehicle.mustCharge
        || vehicle.manualMinimumCurrentA || vehicle.priceChargingEnabled || vehicle.minCurrent1pA !== 6
        || vehicle.maxCurrent1pA < 6 || vehicle.maximumPowerW < minW
        || !(Number(nativeConfig.wb1CommissioningMaxA ?? 6) >= 6)
        || vehicle.phaseSwitchEnabled && (!vehicle.phaseFeedbackValid || vehicle.confirmedPhases !== 1)
        || !continuingSinglePhasePvCharge(1, series, i, now) || !(soc > floor)) return null;
    const needs = [];
    let carWh = 0, dischargeWh = 0;
    for (let j = i; j < flex.length; j++) {
        const slot = flex[j], a = allocations[j], point = series[j];
        const hour = Number(tariffClock.formatToParts(slot.timestamp).find(part => part.type === 'hour').value);
        if (slot.timestamp !== first.timestamp + needs.length * 900000
            || hour < 6 || hour >= 20
            || localDateKey(new Date(slot.timestamp)) !== localDateKey(new Date(first.timestamp))
            || stages[j].stage !== stage.stage || stages[j].deadlineIndex !== stage.deadlineIndex
            || slot.pauseBattery || slot.batteryReservedPvW > 0 || slot.requiredPvChargeW > 0
            || a.activeWallbox !== 1 || !point.conditional || point.priceOptimized || point.chargingUntil
            || a.dhwW > 0 || a.heatingW > 0 || a.wallboxGridW > 0 || a.activeWallboxes.some(wb => wb !== 1)
            || !a.wallboxForecastLimits?.valid || a.wallboxForecastLimits.consumptionW !== Infinity
            || a.wallboxForecastLimits.phaseW[0] < minW) return null;
        if (point.valueW > 0) {
            if (!needs.length || point.phases !== 1 || point.valueW < minW || point.chargingMinutes < 15 - 1e-7) return null;
            // Book full aligned quarters for the live limit, even on a mid-slot
            // rebuild. The SoC and vehicle plans use only the remaining minutes.
            const plan = {from: first.timestamp, capsW: needs.map(Math.ceil)};
            const extraW = Math.floor((EQV_PV_GAP_WH * 4 - plan.capsW.reduce((sum, w) => sum + w, 0)) / needs.length);
            if (extraW < 0) return null;
            plan.capsW = plan.capsW.map(w => Math.min(EQV_STORAGE_MAX_W, maxDischarge, w + extraW));
            const saved = i === 0 ? getState(`${CFG.root}.Control.EqvPvGap_JSON`) : null;
            if (saved && saved.val !== '{}') {
                if (saved.ack !== true || saved.q) return null;
                let original;
                try { original = JSON.parse(saved.val); } catch { return null; }
                plan.capsW = plan.capsW.map((w, k) => Math.min(w, eqvGapCapW(original, first.timestamp + k * 900000)));
                if (needs.some((w, k) => w > plan.capsW[k])) return null;
            }
            return {needs, plan, carWh};
        }
        const needW = minW - slot.residualPvW;
        if (!(needW > 0 && needW <= Math.min(maxDischarge, EQV_STORAGE_MAX_W))) return null;
        const hours = pricePlanHours(slot.timestamp, now);
        carWh += minW * hours;
        dischargeWh += needW * hours;
        if (carWh > remainingWh + 1e-7 || dischargeWh > EQV_PV_GAP_WH
            || dischargeWh > (soc - floor) * capacity * 10 * efficiency) return null;
        needs.push(needW);
    }
    return null;
}

function buildDevicePlan(data, withoutReadiness = [], planningNow = Date.now(), forecastReserve = null, pvTrial = null, operating = null) {
    const r = CFG.root;
    if (!historyReady || !data.pv.length || !data.house.length) {
        write(`${r}.Plan.Valid`, false);
        write(`${r}.Plan.BatteryForecastValid`, false);
        write(`${r}.Plan.BatteryForecastReserve_JSON`, '{}');
        write(`${r}.Plan.BatteryOperatingWindow_JSON`, '{}');
        write(`${r}.Plan.BatteryForecastStatus`, 'Wartet auf gueltige Historie und Prognose');
        write(`${r}.Plan.Status`, 'Wartet auf gueltige Historie und Prognose');
        return;
    }
    // Never spend or credit a stale/non-finite watt value on a missing PV row.
    if (data.pv.some(point => !Number.isFinite(point.valueW) || point.source === 'unavailable' && point.valueW !== 0))
        data = {...data, pv: data.pv.map(point => !Number.isFinite(point.valueW) || point.source === 'unavailable'
            ? {...point, valueW: 0} : point)};

    const batteryConfigured = Boolean(getState(`${r}.Devices.Battery.Present`)?.val);
    const batteryHeadMode = typeof batteryHeadsMode === 'function' && batteryHeadsMode();
    const batteryProfile = batteryHeadMode && typeof batteryPlanningProfile === 'function'
        ? batteryPlanningProfile() : null;
    const batteryProfileReady = !batteryHeadMode || batteryProfile?.valid === true
        && batteryProfile.capacityValid === true;
    const batteryPresent = batteryConfigured && batteryProfileReady;
    const dhwPresent = nativeConfig.dhwEmergencyOnly !== true && Boolean(getState(`${r}.Devices.MyPV_DHW.Present`)?.val);
    const heatingPresent = nativeConfig.heatingEmergencyOnly !== true && Boolean(getState(`${r}.Devices.MyPV_Heating.Present`)?.val);
    // The numerical placeholder is used only by the disabled model. It is
    // never published as a measured/derived capacity or SoC when proof is absent.
    const capacity = batteryHeadMode ? batteryProfileReady ? batteryProfile.capacityKWh : 0.1
        : Math.max(0.1, readNumber(`${r}.Config.BatteryCapacity_kWh`, 10));
    const policyMinimum = typeof batteryEffectiveMinimumSoc === 'function'
        ? batteryEffectiveMinimumSoc(planningNow, false) : readNumber(`${r}.Config.BatteryMinSoC_pct`, 15);
    const policyMaximum = readNumber(`${r}.Config.BatteryMaxSoC_pct`, 100);
    const effectiveMinimum = batteryHeadMode && batteryProfile?.valid
        && Number.isFinite(policyMinimum) ? Math.max(policyMinimum, batteryProfile.deviceMinSoc) : policyMinimum;
    const configuredMaximum = batteryHeadMode && batteryProfile?.valid
        && Number.isFinite(policyMaximum) ? Math.min(policyMaximum, batteryProfile.deviceMaxSoc) : policyMaximum;
    const batteryBoundsValid = Number.isFinite(effectiveMinimum) && effectiveMinimum >= 0
        && effectiveMinimum < 100 && Number.isFinite(configuredMaximum)
        && configuredMaximum > effectiveMinimum && configuredMaximum <= 100;
    const maxCharge = batteryPresent && batteryBoundsValid
        ? batteryHeadMode ? batteryProfile.maxChargeW : Math.max(0, readNumber(`${r}.Config.BatteryMaxCharge_W`, 2400)) : 0;
    const maxDischarge = batteryPresent && batteryBoundsValid && effectiveMinimum > 0
        ? batteryHeadMode ? batteryProfile.maxDischargeW : Math.max(0, readNumber(`${r}.Config.BatteryMaxDischarge_W`, 2400)) : 0;
    const minSoc = batteryBoundsValid ? Math.max(effectiveMinimum,
        forecastReserve ? Math.min(configuredMaximum, BATTERY_FORECAST_RESERVE_SOC) : 0) : 0;
    // An invalid reserve disables battery power, never raises the user's max.
    const hardMaximum = Number.isFinite(configuredMaximum) && configuredMaximum > 0
        && configuredMaximum <= 100 ? configuredMaximum : 100;
    const offset = operating?.offset ?? 0;
    const lateTarget = Math.min(hardMaximum, readNumber(`${r}.Config.BatteryLateTargetSoC_pct`, 100));
    const regularCeiling = offset ? lateTarget - offset : hardMaximum;
    if (operating && regularCeiling <= minSoc) return false;
    const maxSoc = operating?.calibration ? hardMaximum : regularCeiling;
    const morningTarget = Math.max(minSoc, Math.min(regularCeiling,
        Math.min(hardMaximum, readNumber(`${r}.Config.BatteryMorningTargetSoC_pct`, 70)) - offset));
    const afternoonTarget = Math.max(morningTarget, Math.min(regularCeiling,
        Math.min(hardMaximum, readNumber(`${r}.Config.BatteryAfternoonTargetSoC_pct`, 90)) - offset));
    const targets = {
        morning: morningTarget,
        afternoon: afternoonTarget,
        late: Math.max(afternoonTarget, lateTarget - offset)
    };
    const efficiency = batteryPlanningEfficiency();
    const wallboxParallel = parallelWallboxChargingEnabled();
    const socCoordination = wallboxParallel && nativeConfig.batteryWallboxHalfStepEnabled === true;
    const priorityPv = maxCharge > 0 && (socCoordination || nativeConfig.batteryPvPriorityEnabled === true);
    const forecastSafety = Math.max(0.3, Math.min(1,
        readNumber(`${r}.Config.BatteryForecastSafetyFactor_pct`, 80) / 100));
    const batteryPriceEnabled = batteryPresent && batteryBoundsValid
        && getState(`${r}.Config.BatteryPriceChargingEnabled`)?.val === true;
    const highTariffReserveEnabled = getState(`${r}.Config.BatteryHighTariffReserveEnabled`)?.val === true;
    const solarStoredKWh = priorityPv ? data.pv.map((slot, i) => Math.min(maxCharge,
        Math.max(0, (Number(slot.valueW) || 0) - (Number(data.house[i].valueW) || 0)) * forecastSafety)
        * pricePlanHours(slot.timestamp, planningNow) / 1000 * efficiency) : null;
    const targetPlan = buildBatteryTargetPlan(data, capacity, maxCharge, efficiency, targets,
        readNumber(`${r}.Config.BatteryFinalChargeReserve_min`, 45), solarStoredKWh);
    if (operating) for (const slot of targetPlan) slot.ceilingPct = regularCeiling;
    const calibration = operating?.calibration;
    if (calibration) for (let i = 0; i < targetPlan.length; i++) {
        const at = targetPlan[i].timestamp;
        if (at + 900000 <= calibration.start || at >= calibration.end) continue;
        targetPlan[i] = {...targetPlan[i], targetPct: 100, ceilingPct: 100, stage: 'LATE_100', calibration: true,
            deadlineIndex: Math.min(targetPlan.length - 1, i + Math.ceil((calibration.end - at) / 900000) - 1)};
    }
    const liveSoc = batteryHeadMode ? batteryProfileReady ? batteryProfile.soc : null
        : freshOptionalNumber(CFG.dp.batterySoc, 5 * 60 * 1000);
    let soc = Math.max(0, Math.min(100, liveSoc === null
        ? batteryHeadMode ? 0 : readNumber(`${r}.Config.BatteryManualSoC_pct`, 50) : liveSoc));
    const initialSoc = soc;
    let prioritySoc = soc;
    const socSource = batteryHeadMode ? batteryProfileReady
        ? `${nativeConfig.batterySunEnergyInstance || 'sunenergyxt500.0'}.heads.*.info.rawResponse (ON-gewichtet)`
        : `Nicht bewertbar: ${batteryProfile?.valid ? batteryProfile.capacityReason : batteryProfile?.reason || 'Kopfprofil fehlt'}`
        : liveSoc === null ? 'Config.BatteryManualSoC_pct (Livewert fehlt/veraltet)' : CFG.dp.batterySoc;
    const batteryForecastValid = batteryConfigured && batteryProfileReady && batteryBoundsValid;
    const batteryForecastStatus = !batteryConfigured ? 'Nicht vorhanden'
        : !batteryProfileReady ? socSource
        : !batteryBoundsValid ? 'Nicht bewertbar: EMS- und Geraete-SoC-Grenzen widersprechen sich'
        : batteryHeadMode ? 'Kopfprofil und Kapazitaet geprueft; EMS-Ziele und effektive Geraetegrenzen'
        : 'Manuelle Kapazitaet und bestehende SoC-Quelle';

    // The model is created after total prices have been assembled below.
    let dhwNeedKWh = 0;
    const heatTemp = readNumber(CFG.dp.myPvHeatingTemp,
        readNumber(`${r}.Config.HeatingBufferTemperature_C`, 40));
    const heatMin = readNumber(`${r}.Config.HeatingBufferMinTemperature_C`, 35);
    const heatTarget = readNumber(`${r}.Config.HeatingBufferTargetTemperature_C`, 50);
    let heatNeedKWh = heatingPresent
        ? Math.max(0, readNumber(`${r}.Config.HeatingBufferVolume_l`, 400) * 1.163 * (heatTarget - heatTemp) / 1000) : 0;

    updateVehicles();
    const wallboxStatus = [0, 1, 2].map(index => {
        const vehicle = vehicleState(index);
        return {...vehicle, eligible: vehicle.release, reason: vehicle.status,
            ...(pvTrial?.proof.index === index ? {departurePv: pvTrial.proof} : {})};
    });
    const connected = wallboxStatus.filter(x => x.connected).map(x => x.index);
    const socFallback = wallboxStatus.filter(x => x.eligible).length > 1
        && wallboxPriorityVehicleUnplugged(wallboxPriorityRequest(planningNow), planningNow);
    const running = socFallback ? wallboxStatus.filter(x => x.eligible
        && getState(`${r}.Devices.Wallbox${x.index}.OutputOwned`)?.val === true) : [];
    const selected = getState(`${r}.Control.SelectedWallbox`)?.val;
    let continuing = running.find(x => x.index === selected)?.index ?? running[0]?.index ?? null;
    const eligibleWallboxes = wallboxStatus.filter(x => x.eligible)
        .sort((a, b) => comparePlannedVehicles(a, b, socFallback, continuing))
        .map(x => x.index);
    const vehicleEfficiency = Math.max(0.5, Math.min(1,
        readNumber(`${r}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const wallboxDemandKWh = wallboxStatus.map(x => {
        if (!x.eligible) return 0;
        // The display rounds energy to 0.01 kWh. Keep the true remaining
        // demand on rolling departures, including the final fraction of a slot.
        if (x.socValid && x.deadlineEnabled && x.departureTimestamp > planningNow && !x.priceChargingEnabled
            && x.departureSocPct < x.minimumSocPct)
            return Math.max(0, x.targetSocPct - x.departureSocPct) * x.capacityKWh / 100;
        const socDemand = x.socValid ? x.energyRequiredKWh : Infinity;
        // The session already subtracts measured charging since the last SoC
        // update. Do not recreate that energy in the future PV baseline.
        return x.priceChargingEnabled && x.priceSessionValid
            ? Math.min(socDemand, Math.max(0, x.priceRemainingKWh) * vehicleEfficiency) : socDemand;
    });
    const wallboxRemainingKWh = wallboxDemandKWh.slice();
    const plannedDepartureGrants = liveDepartureGrants.slice();
    const parallelRelease = readBooleanInput(CFG.dp.dhwParallelRelease);
    const parallelEnabled = Boolean(getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val)
        && parallelRelease === true;
    const parallelSharePct = readNumber(`${r}.Config.DHWParallelShare_pct`, 50);
    const prices = data.prices.total.map(x => x.valid === false ? null : numericValue(x.value_ct_kWh));
    const consumptionLimit = typeof currentConsumptionLimit === 'function' ? currentConsumptionLimit() : null;
    const productionScope = typeof realtimeProductionScope === 'function' ? realtimeProductionScope() : null;
    const productionWallboxes = productionScope?.production ? productionScope.wallboxes : [];
    for (const vehicle of wallboxStatus) {
        if (vehicle.datedTrip || !vehicle.eligible || !vehicle.socValid || !vehicle.priceChargingEnabled
            || withoutReadiness.includes(vehicle.index)) continue;
        const settings = wallboxReadinessSettings(vehicle.index, vehicle.minimumSocPct,
            vehicle.departureTimestamp, vehicle, planningNow);
        if (!settings || !Number.isFinite(vehicle.capacityKWh) || vehicle.capacityKWh <= 0) continue;
        // A gap or invalid tariff anywhere before departure invalidates the
        // promise. Use the same quarter-hour grid as the rest of the planner.
        const first = Math.floor(planningNow / 900000) * 900000;
        const slots = Math.ceil((settings.departureAt - first) / 900000);
        const start = data.pv.findIndex(point => point.timestamp === first);
        if (start < 0 || start + slots > data.pv.length
            || !data.pv.slice(start, start + slots).every((point, i) => point.timestamp === first + i * 900000
                && data.prices.total[start + i]?.timestamp === point.timestamp
                && Number.isFinite(prices[start + i]))) continue;
        vehicle.readyBy = settings;
    }
    const thermal = createDhwForecastModel(data, prices, planningNow, dhwPresent);
    const idleDhwFromStorageOverflow = batteryHeadMode && thermal.valid && allWallboxesUnplugged(planningNow);
    dhwNeedKWh = thermal.need();
    const lowPrice = percentile(prices, 0.30);
    const highPrice = percentile(prices, 0.70);
    const spreadOk = prices.some(Number.isFinite) && highPrice - lowPrice >= readNumber(`${r}.Config.MinArbitrageSpread_ct_kWh`, 4);
    const selfConsumptionEnabled = Boolean(getState(`${r}.Config.BatterySelfConsumptionEnabled`)?.val);

    const battery = [], batterySoc = [], batteryTarget = [], batteryStage = [], dhw = [], heating = [], boost = [], parallel = [];
    const wallboxes = [[], [], []], grid = [];
    const flexPlan = [], allocations = [];
    let importWh = 0, exportWh = 0;
    let forecastParallelActive = false;
    const reservationStage = {reachedPct: -1};

    // Reserve the active battery stage before allocating optional PV loads.
    // Without the priority policy, storage still uses the residual PV plan.
    for (let i = 0; i < data.pv.length; i++) {
        const timestamp = data.pv[i].timestamp;
        const pvW = Math.max(0, Number(data.pv[i].valueW) || 0);
        const baseW = Math.max(0, Number(data.house[i].valueW) || 0);
        const price = prices[i] ?? null;
        const priceValid = Number.isFinite(price);
        const priceSlot = data.prices.total[i];
        const thermalGridLimitW = priceValid && priceSlot.timestamp === timestamp
            ? Math.max(0, numericValue(priceSlot.thermalGridLimitW) ?? 0) : 0;
        const hours = pricePlanHours(timestamp, planningNow);
        const slotStart = Math.max(timestamp, planningNow);
        const slotVehicles = wallboxStatus.map((v, wb) => {
            const planned = v.socValid ? plannedVehicleAtSoc(v, wallboxRemainingKWh[wb], slotStart, plannedDepartureGrants[wb]) : v;
            return {...planned, effectivePriorityScore: plannedVehiclePriorityScore(v, planned)};
        });
        const immediate = slotVehicles.some(v => v.minimumDeferred) && eligibleWallboxes.some(wb => untimedMinimum(slotVehicles[wb]));
        const slotOrder = [...eligibleWallboxes].sort((a, b) =>
            (immediate ? Number(slotVehicles[a].minimumDeferred === true) - Number(slotVehicles[b].minimumDeferred === true) : 0)
            || comparePlannedVehicles(slotVehicles[a], slotVehicles[b], socFallback, continuing, !wallboxParallel));
        const availableWallboxes = slotOrder.filter(wb => wallboxRemainingKWh[wb] > 1e-9
            && vehicleAvailableAt(wallboxStatus[wb], timestamp)
            && (!wallboxStatus[wb].priceChargingEnabled || !wallboxStatus[wb].priceSessionValid
                || timestamp < wallboxStatus[wb].priceDeadlineTimestamp));
        const pauseBattery = availableWallboxes.some(wb => (productionWallboxes.includes(wb)
            || slotVehicles[wb].departurePv && slotStart >= slotVehicles[wb].departurePv.releaseAt)
            && slotVehicles[wb].mustCharge && slotVehicles[wb].belowMinimum);
        const activeWallbox = availableWallboxes[0] ?? null;
        const activeVehicle = activeWallbox === null ? null : wallboxParallel
            ? parallelForecastVehicle(slotVehicles[activeWallbox]) : slotVehicles[activeWallbox];
        const targetSoc = targetPlan[i].targetPct;
        const stageReached = socCoordination && hours > 0
            && plannedBatteryStageReached(reservationStage, timestamp, targetSoc, prioritySoc);
        const optionalHeatSuppressed = typeof batteryWallboxOptionalPvHeatSuppressed === 'function'
            && batteryWallboxOptionalPvHeatSuppressed(maxCharge > 0 && prioritySoc < maxSoc,
                availableWallboxes.some(wb => nativeConfig[`wb${wb}ControlEnabled`] === true));
        let activePhases = activeVehicle === null ? 1 : recommendedPlanPhases(activeVehicle,
            Math.max(0, pvW - baseW), wallboxRemainingKWh[activeWallbox], timestamp);
        const priceManagedVehicle = activeVehicle !== null
            && getState(`${r}.Config.Wallbox${activeVehicle.index}PriceChargingEnabled`)?.val === true
            && activeVehicle.priceSessionValid === true;
        const deadlineCharge = activeVehicle !== null && activeVehicle.mustCharge
            && (!priceManagedVehicle || activeVehicle.belowMinimum || activeVehicle.manualMinimumCurrentA > 0)
            && vehicleAvailableAt(activeVehicle, timestamp);
        let remainingPvW = Math.max(0, pvW - baseW);
        let dhwW = 0, heatW = 0;
        const wbW = [0, 0, 0];
        const wbPhases = [1, 1, 1];
        if (activeWallbox !== null) wbPhases[activeWallbox] = activePhases;

        dhwNeedKWh = thermal.need();
        const thermalRequest = thermal.gridRequest(i, remainingPvW, thermalGridLimitW);
        const dhwCapW = Math.min(thermal.maxPowerW, dhwNeedKWh * 1000 / Math.max(1e-9, pricePlanHours(timestamp, planningNow)));
        // Mandatory service/reserve and price bridging take only their modeled
        // demand. They do not exclude an otherwise usable WB for the full slot.
        const mandatoryThermalW = Math.min(dhwCapW, thermalRequest.priorityPvW + thermalRequest.powerW);
        const mandatoryThermalPvW = Math.min(remainingPvW, mandatoryThermalW);
        const mandatoryThermalGridW = Math.max(0, mandatoryThermalW - mandatoryThermalPvW);
        const forcedDhw = mandatoryThermalW > 0;
        dhwW = mandatoryThermalW;
        remainingPvW = Math.max(0, remainingPvW - mandatoryThermalPvW);
        // Only EMS-owned phase wishes may follow the remaining PV. Script
        // feedback remains binding, and departure need can still require 3p.
        activePhases = activeVehicle === null ? 1 : recommendedPlanPhases(activeVehicle,
            remainingPvW, wallboxRemainingKWh[activeWallbox], timestamp);
        if (activeWallbox !== null) wbPhases[activeWallbox] = activePhases;
        if (activeVehicle?.departureW > 0) {
            const limits = parallelForecastLimits(pvW, baseW, dhwW, 0, 0, consumptionLimit);
            activePhases = departurePhasesWithinBudget(activeVehicle, Math.min(limits.consumptionW,
                Math.min(...limits.phaseW) * 3), activeVehicle.nominalVoltage);
            wbPhases[activeWallbox] = activePhases;
        }
        const activeHours = pricePlanHours(timestamp, planningNow, activeVehicle?.deadlineEnabled && activeVehicle.departureTimestamp > 0
            ? activeVehicle.departureTimestamp : Infinity);
        const energyLimitedW = activeWallbox !== null && Number.isFinite(wallboxRemainingKWh[activeWallbox])
            ? wallboxRemainingKWh[activeWallbox] / Math.max(1e-9, activeVehicle.departureW > 0 ? activeHours : priceManagedVehicle ? hours : 0.25) / vehicleEfficiency * 1000
            : (activeVehicle?.maximumPowerW || 0);
        const wallboxCapW = activeVehicle === null ? 0
            : Math.min(activeVehicle.maximumPowerW, energyLimitedW);
        const activeMinimumA = activePhases === 3
            ? activeVehicle?.minCurrent3pA : activeVehicle?.minCurrent1pA;
        const activeMinimumPowerW = activeVehicle === null ? 0
            : Math.max(0, activeMinimumA * 230 * activePhases);
        const simultaneousDepartures = availableWallboxes.filter(wb => slotVehicles[wb].departureW > 0).length > 1;
        const minNeedW = !deadlineCharge ? 0 : activeVehicle.departureW > 0
            ? Math.min(wallboxCapW, simultaneousDepartures && !wallboxParallel ? wallboxCapW
                : Math.max(activeMinimumPowerW, activeVehicle.departureW)) : activeVehicle.targetDeadlineDue ? wallboxCapW : activeVehicle.belowMinimum
            ? Math.min(wallboxCapW, (activeVehicle.minimumSocPct - activeVehicle.socPct) / 100
                * activeVehicle.capacityKWh / vehicleEfficiency * 4000)
            : activeMinimumPowerW;
        // Anticipatory reserve may shape the PV split, but never create import
        // or turn sufficient mandatory-heat-plus-WB-minimum PV into a WB stop.
        // Mandatory vehicle demand keeps its PV first as well; reserving more
        // optional heat must not manufacture additional deadline grid demand.
        // A short final charge still requires its full minimum instantaneous
        // power, even when its quarter-hour average is below that minimum.
        const parallelMinimumW = wallboxParallel ? availableWallboxes.reduce((sum, wb) => {
            const vehicle = parallelForecastVehicle(slotVehicles[wb]);
            return sum + (vehicle.belowMinimum || vehicle.manualMinimumCurrentA > 0 || vehicle.mustCharge
                ? Math.max(vehicle.departureW || 0, vehicle.phaseControlMode === 'script' && vehicle.confirmedPhases === 3
                    ? vehicle.minCurrent3pA * 690 : vehicle.minCurrent1pA * 230) : 0);
        }, 0) : 0;
        const protectedWallboxPvW = wallboxParallel ? Math.min(remainingPvW, Math.max(parallelMinimumW, activeMinimumPowerW))
            : activeWallbox === null ? 0 : Math.min(remainingPvW,
            deadlineCharge ? Math.max(activeMinimumPowerW, minNeedW) : activeMinimumPowerW);
        const chargingTargetSoc = socCoordination || operating ? targetSoc : maxSoc;
        let batteryReservedPvW = 0, batteryExtraPvCapW = 0, requiredPvChargeW = 0, handoffPhases = null;
        if (!pauseBattery && priorityPv && prioritySoc < chargingTargetSoc && (!stageReached || targetPlan[i].calibration) && hours > 0) {
            const limits = parallelForecastLimits(pvW, baseW, dhwW, 0, 0, consumptionLimit);
            // Keep PV already needed by mandatory vehicle/thermal service.
            const mandatoryCarW = wallboxParallel ? parallelMinimumW : deadlineCharge ? minNeedW : 0;
            const surplusW = Math.max(0, remainingPvW - mandatoryCarW);
            const ceilingW = Math.min(maxCharge, Math.min(...limits.phaseW),
                Math.max(0, limits.consumptionW - mandatoryCarW - dhwW));
            const energyToTargetKWh = (chargingTargetSoc - prioritySoc) / 100 * capacity;
            const wattsPerStoredKWh = 1000 / (hours * efficiency);
            const batteryPvCapW = Math.min(ceilingW, energyToTargetKWh * wattsPerStoredKWh);
            batteryReservedPvW = Math.min(batteryPvCapW, surplusW);
            const futureStoredKWh = solarStoredKWh.slice(i + 1, targetPlan[i].deadlineIndex + 1)
                .reduce((sum, kWh) => sum + kWh, 0);
            requiredPvChargeW = Math.min(batteryReservedPvW,
                Math.max(0, energyToTargetKWh - futureStoredKWh) * wattsPerStoredKWh);
            // The staged PV target is a preference, not a hard SoC floor.
            // With the explicitly enabled SunEnergy half-step policy, accept
            // missed soft targets to avoid export; never borrow from reserve
            // recovery, a full-charge calibration or price-charging contracts.
            const flexible = batteryHeadMode && batteryForecastValid && socCoordination
                && nativeConfig.batteryPvPriorityEnabled === true && !forecastReserve
                && !calibration && !batteryPriceEnabled;
            if (socCoordination && prioritySoc > minSoc && mandatoryCarW === 0
                && (!forcedDhw || flexible && mandatoryThermalGridW <= 1e-7)
                && limits.consumptionW === Infinity && activeVehicle) {
                const phases = !activeVehicle.phaseSwitchEnabled ? 1
                    : activeVehicle.phaseFeedbackValid ? activeVehicle.confirmedPhases : null;
                const thermalShareW = parallelEnabled && !optionalHeatSuppressed && dhwCapW > dhwW
                    ? readNumber(`${r}.Config.DHWParallel${forecastParallelActive ? 'Stop' : 'Start'}Power1P_W`,
                        forecastParallelActive ? 3000 : 4000) : Infinity;
                const yieldedW = forecastBatteryHandoff(activeVehicle, phases, surplusW, batteryReservedPvW,
                    ceilingW, flexible ? 0 : requiredPvChargeW, limits.phaseW, thermalShareW, flexible);
                if (yieldedW > 0) {
                    handoffPhases = phases;
                    batteryExtraPvCapW = batteryReservedPvW;
                    batteryReservedPvW -= yieldedW;
                }
            }
            remainingPvW = Math.max(0, remainingPvW - batteryReservedPvW);
        }
        const reserveRefillPvW = optionalHeatSuppressed ? 0 : Math.min(Math.max(0, dhwCapW - dhwW),
            Math.max(0, thermalRequest.reserveRefillPowerW),
            Math.max(0, remainingPvW - protectedWallboxPvW));
        dhwW += reserveRefillPvW;
        remainingPvW = Math.max(0, remainingPvW - reserveRefillPvW);
        const wallboxPvAvailableW = remainingPvW;
        const thermalAllocation = {thermalGridLimitW, mandatoryThermalW, mandatoryThermalPvW, mandatoryThermalGridW,
            mandatoryThermalRequestedW: thermalRequest.mandatoryPowerW,
            reserveRefillPvW, thermalReserveTargetKWh: thermalRequest.reserveTargetKWh,
            thermalReserveHorizonMin: DHW_PV_RESERVE_HORIZON_MIN,
            thermalReserveCoveredMin: thermalRequest.reserveCoveredMin, wallboxPvAvailableW};
        const startThresholdW = activePhases >= 3
            ? readNumber(`${r}.Config.DHWParallelStartPower3P_W`, 9000)
            : readNumber(`${r}.Config.DHWParallelStartPower1P_W`, 4000);
        const stopThresholdW = activePhases >= 3
            ? readNumber(`${r}.Config.DHWParallelStopPower3P_W`, 8000)
            : readNumber(`${r}.Config.DHWParallelStopPower1P_W`, 3000);
        if (!parallelEnabled || optionalHeatSuppressed || activeVehicle === null || dhwCapW - dhwW <= 0) forecastParallelActive = false;
        else if (forecastParallelActive && remainingPvW < stopThresholdW) forecastParallelActive = false;
        else if (!forecastParallelActive && remainingPvW > startThresholdW) forecastParallelActive = true;

        let parallelForecast = null;
        if (wallboxParallel) {
            let vehicleBudgetW = remainingPvW;
            if (forecastParallelActive) {
                const aggregateCapW = availableWallboxes.reduce((sum, wb) => sum + slotVehicles[wb].maximumPowerW, 0);
                const split = distributeDhwAndWallbox(remainingPvW, Math.max(0, dhwCapW - dhwW), aggregateCapW, parallelSharePct);
                // Protected minima consume available PV before optional heat.
                split.wallboxW = Math.min(remainingPvW, Math.max(split.wallboxW, parallelMinimumW));
                split.dhwW = Math.min(split.dhwW, Math.max(0, remainingPvW - split.wallboxW));
                dhwW += split.dhwW;
                vehicleBudgetW = Math.max(0, remainingPvW - split.dhwW);
            }
            parallelForecast = allocateParallelForecastVehicles(availableWallboxes, slotVehicles,
                wallboxRemainingKWh, timestamp, planningNow, vehicleEfficiency, vehicleBudgetW,
                parallelForecastLimits(pvW, baseW, dhwW, 0, batteryReservedPvW, consumptionLimit), handoffPhases);
            wbW.splice(0, 3, ...parallelForecast.watts);
            wbPhases.splice(0, 3, ...parallelForecast.phases);
            remainingPvW = Math.max(0, pvW - baseW - dhwW - batteryReservedPvW
                - wbW.reduce((sum, power) => sum + power, 0));
        } else if (deadlineCharge) {
            wbW[activeWallbox] = Math.min(wallboxCapW, Math.max(remainingPvW, minNeedW));
            remainingPvW = Math.max(0, remainingPvW - wbW[activeWallbox]);
        } else if (forecastParallelActive) {
            const allocation = distributeDhwAndWallbox(remainingPvW, Math.max(0, dhwCapW - dhwW), wallboxCapW, parallelSharePct);
            // User-configured parallel thresholds may be below the vehicle's
            // minimum. Even a tiny final energy target cannot start there.
            if (remainingPvW < activeMinimumPowerW) {
                allocation.wallboxW = 0;
                allocation.dhwW = Math.min(Math.max(0, dhwCapW - dhwW), remainingPvW);
            } else if (wallboxCapW >= activeMinimumPowerW
                && allocation.wallboxW < activeMinimumPowerW) {
                allocation.wallboxW = activeMinimumPowerW;
                allocation.dhwW = Math.min(allocation.dhwW, Math.max(0, remainingPvW - activeMinimumPowerW));
            }
            dhwW += allocation.dhwW;
            if (activeWallbox !== null) wbW[activeWallbox] = allocation.wallboxW;
            remainingPvW = Math.max(0, remainingPvW - allocation.dhwW - allocation.wallboxW);
        } else if (activeWallbox !== null && (remainingPvW >= activeMinimumPowerW || deadlineCharge)) {
            wbW[activeWallbox] = Math.min(wallboxCapW,
                deadlineCharge ? activeVehicle.maximumPowerW : remainingPvW);
            // Enough instantaneous PV is available for minimum current. A
            // smaller remaining demand therefore needs a shorter final charge,
            // not another full slot. Zeroing this average would leave the first
            // car unfinished forever and starve every subsequent wallbox.
            remainingPvW = Math.max(0, remainingPvW - wbW[activeWallbox]);
        }

        const pvAfterBaseW = Math.max(0, pvW - baseW);
        const dhwBeforeQuantizationW = dhwW;
        const dhwInitialPvW = Math.min(pvAfterBaseW, dhwW);
        const wallboxPvBudgetW = Math.max(0, pvAfterBaseW - dhwInitialPvW - batteryReservedPvW);
        const wallboxRequestedW = wbW.reduce((sum, power) => sum + power, 0);
        const requestedWallboxPvW = Math.min(wallboxPvBudgetW, wallboxRequestedW);
        const pvBeforeQuantizationW = remainingPvW;
        if (!wallboxParallel && activeWallbox !== null && wallboxRequestedW > 0) {
            let safeW = wallboxRequestedW;
            if (activeVehicle.departureW > 0) {
                const limits = parallelForecastLimits(pvW, baseW, dhwW, 0, batteryReservedPvW, consumptionLimit);
                const phaseW = activePhases === 3 ? Math.min(...limits.phaseW) * 3 : limits.phaseW[0];
                const stepW = activeVehicle.nominalVoltage * activePhases;
                const capW = Math.floor(Math.min(limits.consumptionW, phaseW) / stepW) * stepW;
                safeW = capW >= activeMinimumA * stepW ? Math.min(safeW, capW) : 0;
            }
            wbW[activeWallbox] = quantizePlannedWallbox(safeW, activeVehicle, activePhases,
                deadlineCharge || energyLimitedW <= remainingPvW + wallboxRequestedW);
        }
        // Stop the grid-funded part inside the slot that reaches the departure
        // minimum (or the interim PV reserve). Other cars keep their allocation.
        let assignedW = wbW.reduce((sum, watts) => sum + watts, 0);
        for (const wb of availableWallboxes) {
            const v = slotVehicles[wb], watts = wbW[wb];
            if ((!v.datedTrip?.morning && (!v.deadlineEnabled || !(v.departureTimestamp > slotStart)))
                || hours <= 0 || !v.belowMinimum || v.targetDeadlineDue
                || v.manualMinimumCurrentA > 0 || !(v.minimumSocPct < v.targetSocPct)
                || watts <= 0 || assignedW <= wallboxPvBudgetW) continue;
            const chargeHours = pricePlanHours(timestamp, planningNow, v.departureTimestamp || Infinity);
            const deficitKWh = (v.minimumSocPct - v.socPct) * v.capacityKWh / 100;
            const ownPvW = Math.max(0, wallboxPvBudgetW - (assignedW - watts));
            const sustainableW = quantizePlannedWallbox(ownPvW, v, wbPhases[wb]);
            wbW[wb] = Math.min(watts, Math.max(sustainableW, deficitKWh * 1000 / vehicleEfficiency / chargeHours));
            assignedW -= watts - wbW[wb];
        }
        // Keep grid and SoC energy on the same slot basis, including a
        // departure part-way through the current or final quarter hour.
        const beforeDepartureW = wbW.slice();
        const slotEnd = timestamp + 900000;
        for (const wb of availableWallboxes) {
            const v = slotVehicles[wb];
            if (v.deadlineEnabled && v.departureTimestamp > slotStart && v.departureTimestamp < slotEnd)
                wbW[wb] *= (v.departureTimestamp - slotStart) / (slotEnd - slotStart);
        }
        const wallboxW = wbW.reduce((sum, power) => sum + power, 0);
        if (socFallback) continuing = availableWallboxes.find(wb => wbW[wb] > 0) ?? null;
        const wallboxPvW = Math.min(wallboxPvBudgetW, wallboxW);
        const wallboxGridW = Math.max(0, wallboxW - wallboxPvW);
        // Pflichtladung kann Netzleistung anfordern. Ihre Begrenzung gibt nur
        // tatsaechlich zuvor belegte PV frei, niemals verworfene Netzleistung.
        // Bereits eingeplantes Warmwasser bleibt auch im Parallelbetrieb belegt.
        remainingPvW = Math.max(0, pvW - baseW - dhwW - wallboxW - batteryReservedPvW);
        const pvAfterQuantizationW = remainingPvW;

        // A short final departure charge releases the battery as soon as
        // the last mandatory car finishes, even in the middle of a slot.
        if (priorityPv && pauseBattery && !batteryPriceEnabled && hours > 0 && remainingPvW > 0
            && prioritySoc < chargingTargetSoc) {
            const wb = availableWallboxes.find(index => wbW[index] > 0 && slotVehicles[index].departureW > 0);
            const onlyCar = wb !== undefined && availableWallboxes.every(peer => peer === wb
                || !slotVehicles[peer].belowMinimum && wbW[peer] === 0);
            if (onlyCar && wbW[wb] * hours * vehicleEfficiency / 1000 + 1e-9 >= wallboxRemainingKWh[wb]) {
                const v = slotVehicles[wb];
                const stepW = v.nominalVoltage * wbPhases[wb];
                const commandW = Math.max(wbPhases[wb] === 3 ? v.minCurrent3pA : v.minCurrent1pA,
                    Math.ceil(beforeDepartureW[wb] / stepW - 1e-9)) * stepW;
                const freeFraction = Math.max(0, 1 - wbW[wb] / commandW);
                const limits = parallelForecastLimits(pvW, baseW, dhwW, 0, 0, consumptionLimit);
                const headroomW = (chargingTargetSoc - prioritySoc) * capacity * 10 / (hours * efficiency);
                batteryExtraPvCapW = Math.min(headroomW, freeFraction * Math.max(0, Math.min(maxCharge,
                    pvW - baseW - dhwW, limits.consumptionW, ...limits.phaseW)));
            }
        }

        if (batteryExtraPvCapW > batteryReservedPvW) {
            // Consume released PV after a short final EV charge, up to the
            // stage's original battery allocation and energy headroom.
            const extraChargeW = Math.min(remainingPvW, batteryExtraPvCapW - batteryReservedPvW);
            batteryReservedPvW += extraChargeW;
            remainingPvW -= extraChargeW;
        }
        let trimCapW = 0;
        if (optionalHeatSuppressed && (dhwW > 0 && socCoordination || idleDhwFromStorageOverflow)
            && remainingPvW > 0 && batteryHeadMode && batteryForecastValid
            && !pauseBattery && !calibration && !forecastReserve && !batteryPriceEnabled
            && batteryReservedPvW >= maxCharge - 1e-7 && maxCharge > 0) {
            const caps = parallelForecastLimits(pvW, baseW, dhwW, 0, batteryReservedPvW, consumptionLimit);
            const commands = parallelForecast?.commands ?? wbW;
            const phaseDrawW = commands.reduce((sum, power, wb) => sum + power / wbPhases[wb], 0);
            const fullCarW = commands.reduce((sum, watts) => sum + watts, 0);
            if (caps.valid && caps.consumptionW === Infinity) trimCapW = Math.max(0, Math.min(
                Math.min(...caps.phaseW) - phaseDrawW, pvW - baseW - dhwW - batteryReservedPvW - fullCarW,
                readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000) - dhwW));
        }
        let dhwPvTrimW = 0;
        let storageOverflowDhwW = 0;
        if ((!optionalHeatSuppressed || trimCapW > 0) && dhwNeedKWh > 0 && remainingPvW > 0) {
            let extraDhwW = Math.min(Math.max(0, dhwCapW - dhwW), remainingPvW, optionalHeatSuppressed ? trimCapW : Infinity);
            if (optionalHeatSuppressed && dhwW === 0) {
                const temps = thermal.report.temperaturesC;
                extraDhwW = dhwLayeringTarget(Math.floor(extraDhwW / 100) * 100,
                    {valid: thermal.valid, bottom: temps[0], top: temps[3]});
                storageOverflowDhwW = extraDhwW;
            } else if (optionalHeatSuppressed) dhwPvTrimW = extraDhwW;
            dhwW += extraDhwW;
            remainingPvW -= extraDhwW;
        }
        const thermalPvW = Math.min(pvAfterBaseW, dhwW);
        const dhwReason = dhwW <= 0 ? 'off' : forcedDhw ? thermalRequest.reason
            : storageOverflowDhwW > 0 ? 'pv-storage-overflow' : reserveRefillPvW > 0 ? 'pv-reserve-refill'
                : dhwBeforeQuantizationW > 0 ? 'parallel-pv' : 'pv-surplus';
        thermal.advance(i, dhwW, thermalPvW, dhwW <= 0 ? thermalRequest.reason : dhwReason, thermalAllocation);
        dhwNeedKWh = thermal.need();
        const chargedWallboxes = wallboxParallel ? availableWallboxes : activeWallbox === null ? [] : [activeWallbox];
        for (const wb of chargedWallboxes) {
            if (!Number.isFinite(wallboxRemainingKWh[wb])) continue;
            const hours = wallboxParallel || priceManagedVehicle || slotVehicles[wb].departureW > 0 || slotVehicles[wb].departurePv
                ? pricePlanHours(timestamp, planningNow) : 0.25;
            wallboxRemainingKWh[wb] = Math.max(0,
                wallboxRemainingKWh[wb] - wbW[wb] * hours / 1000 * vehicleEfficiency);
            if (wallboxRemainingKWh[wb] <= 1e-9) wallboxRemainingKWh[wb] = 0;
        }

        const pvBeforeHeatingW = optionalHeatSuppressed ? 0 : remainingPvW;
        if (heatNeedKWh > 0 && (pvBeforeHeatingW > 0 || (heatTemp < heatMin && priceValid && price <= lowPrice))) {
            const needW = heatNeedKWh * 4000;
            const heatingMaxW = Math.max(0, readNumber(
                `${r}.Config.HeatingControllerMaxPower_W`, CFG.limits.myPvHeatingMaxW));
            heatW = Math.min(heatingMaxW, needW,
                pvBeforeHeatingW > 0 ? pvBeforeHeatingW : Math.max(0, thermalGridLimitW - mandatoryThermalGridW));
            heatNeedKWh = Math.max(0, heatNeedKWh - heatW / 4000);
            remainingPvW -= Math.min(pvBeforeHeatingW, heatW);
        }

        flexPlan.push({timestamp, offsetMin: i * 15, pvW, baseW, price, pauseBattery,
            priceValid, gridLevel: data.prices.grid?.[i]?.level ?? null,
            residualPvW: Math.max(0, remainingPvW), dhwW, heatW, wbW,
            ...(priorityPv ? {batteryReservedPvW, requiredPvChargeW, batteryPvTargetPct: chargingTargetSoc} : {})});
        const meta = {timestamp, offsetMin: i * 15};
        const dhwPvW = dhwInitialPvW + (dhwW - dhwBeforeQuantizationW);
        const heatingPvW = Math.min(pvBeforeHeatingW, heatW);
        allocations.push({...meta, price, priceValid, pvW, baseW, pvAfterBaseW, activeWallbox,
            ...(data.house[i].applianceW > 0 ? {applianceW: data.house[i].applianceW} : {}),
            ...thermalAllocation,
            ...(parallelForecast ? {parallelWallboxCharging: true, activeWallboxes: availableWallboxes.filter(wb => wbW[wb] > 0),
                wallboxMinimumTotalW: parallelForecast.minimumTotalW, waitingWallboxes: parallelForecast.waiting,
                wallboxForecastLimits: dhwPvTrimW + storageOverflowDhwW > 0 ? parallelForecastLimits(pvW, baseW, dhwW, heatW, batteryReservedPvW, consumptionLimit)
                    : parallelForecast.limits, wallboxCommandW: parallelForecast.commands} : {}),
            wallboxRequestedW, wallboxW, wallboxPvW, wallboxGridW,
            pvBeforeQuantizationW, pvAfterQuantizationW,
            releasedPvW: Math.max(0, requestedWallboxPvW - wallboxPvW),
            discardedGridRequestW: Math.max(0, wallboxRequestedW - requestedWallboxPvW - wallboxGridW),
            dhwBeforeQuantizationW, dhwW, dhwPvW, dhwGridW: Math.max(0, dhwW - dhwPvW),
            dhwReason, ...(dhwPvTrimW > 0 ? {dhwPvTrimW} : {}),
            heatingW: heatW, heatingPvW, heatingGridW: Math.max(0, heatW - heatingPvW),
            pvBeforeBatteryW: Math.max(0, remainingPvW) + batteryReservedPvW});
        if (priorityPv) {
            const dischargeW = plannedBatteryHouseDischargeW(flexPlan[i], prioritySoc, {
                minSoc, maxDischarge, capacity, efficiency, hours, selfConsumptionEnabled, spreadOk, highPrice});
            const chargePct = batteryReservedPvW * efficiency * hours / 1000 / capacity * 100;
            if (socCoordination && hours > 0 && prioritySoc + chargePct + 1e-8 >= targetSoc)
                reservationStage.reachedPct = Math.max(reservationStage.reachedPct, targetSoc);
            flexPlan[i].prioritySocBefore = prioritySoc;
            prioritySoc += chargePct - dischargeW / efficiency * hours / 1000 / capacity * 100;
            flexPlan[i].prioritySocAfter = prioritySoc;
        }
        dhw.push({...meta, valueW: Math.round(dhwW), ...(dhwPvTrimW > 0 ? {pvTrimW: dhwPvTrimW} : {})});
        heating.push({...meta, valueW: Math.round(heatW)});
        wallboxes.forEach((series, wb) => {
            const plannedVehicle = wallboxParallel ? parallelForecastVehicle(slotVehicles[wb]) : slotVehicles[wb];
            const minA = wbPhases[wb] === 3 ? plannedVehicle.minCurrent3pA : plannedVehicle.minCurrent1pA;
            const averageA = beforeDepartureW[wb] / (plannedVehicle.nominalVoltage * wbPhases[wb]);
            const currentA = wbW[wb] > 0 ? Math.max(minA, Math.ceil(averageA - 1e-9)) : 0;
            const personalW = plannedVehicle.departureW > 0 && currentA > 0
                ? departureMinimumPower(plannedVehicle, slotStart, plannedVehicle.nominalVoltage, wbPhases[wb], plannedDepartureGrants[wb]) : 0;
            plannedDepartureGrants[wb] = departureGrant(plannedVehicle, personalW,
                currentA * plannedVehicle.nominalVoltage * wbPhases[wb], wbPhases[wb], plannedVehicle.nominalVoltage,
                slotStart, timestamp + 900000);
            series.push({...meta, valueW: Math.round(wbW[wb]), phases: wbPhases[wb],
                ...(beforeDepartureW[wb] !== wbW[wb] ? {chargingUntil: plannedVehicle.departureTimestamp,
                    beforeDepartureW: Math.round(beforeDepartureW[wb])} : {}),
                currentA, chargingMinutes: currentA > 0 ? Math.min(15, hours * 60 * wbW[wb]
                    / (plannedVehicle.nominalVoltage * wbPhases[wb] * currentA)) : 0,
                conditional: eligibleWallboxes.includes(wb), gridChargeW: 0, priceLimitCt: null,
                priceOptimized: false, priceSessionId: slotVehicles[wb].priceSessionId || '',
                priceChargeUntil: 0, plannedGridEnergyKWh: 0});
        });
        parallel.push({...meta, value: forecastParallelActive ? 1 : 0,
            wallbox: activeWallbox, startW: startThresholdW, stopW: stopThresholdW});
    }

    const priceWallboxReports = addPriceWallboxPlan(flexPlan, wallboxes, allocations, wallboxStatus,
        vehicleEfficiency, planningNow, socFallback);
    if (priceWallboxReports.retryWithoutReadiness !== undefined)
        return buildDevicePlan(data, [...withoutReadiness, priceWallboxReports.retryWithoutReadiness], planningNow, forecastReserve, pvTrial, operating);

    // Price charging and the residual-PV strategy use the finished load plan.
    if (forecastReserve) {
        for (const slot of flexPlan)
            slot.forecastReserveCapW = forecastBatteryReservePowerW(slot, consumptionLimit, maxCharge);
    }
    const highTariffWindow = highTariffReserveEnabled && batteryForecastValid
        && selfConsumptionEnabled && maxDischarge > 0 && liveSoc !== null
        ? nextBatteryHighTariffWindow(flexPlan, planningNow) : null;
    if (batteryHeadMode && batteryForecastValid && socCoordination && nativeConfig.batteryPvPriorityEnabled === true
        && !calibration && !forecastReserve && !pvTrial && !batteryPriceEnabled && !highTariffWindow) {
        planWallboxBatteryHeadroom(flexPlan, allocations, wallboxes, wallboxStatus, wallboxRemainingKWh,
            {now: planningNow, maxCharge, maxSoc, minSoc, efficiency: vehicleEfficiency, consumptionLimit,
                storedPctPerWh: efficiency / (10 * capacity)}, targetPlan);
    }
    const priceBattery = (batteryPriceEnabled || highTariffWindow) && liveSoc !== null ? buildPriceBatteryPlan(flexPlan, targetPlan, {
        capacity, initialSoc: soc, minSoc, maxSoc,
        gridMaxSoc: Math.max(minSoc, Math.min(maxSoc, readNumber(`${r}.Config.BatteryPriceMaxSoC_pct`, 100), regularCeiling)),
        reservePct: batteryPriceEnabled ? Math.max(0, readNumber(`${r}.Config.BatteryPriceReserve_pct`, 10)) : 0,
        maxCharge, maxDischarge, efficiency, safety: forecastSafety,
        selfConsumption: selfConsumptionEnabled, preserveInitialSoc: batteryHeadMode || Boolean(operating), now: planningNow,
        forecastReserve, highTariffWindow, allowGridCharging: batteryPriceEnabled}) : null;
    const trajectory = [], reserveProof = [];
    const stageSurplus = batteryHeadMode && batteryForecastValid && socCoordination && nativeConfig.batteryPvPriorityEnabled === true
        && !priceBattery && !calibration && !forecastReserve;
    // EV scheduling may have moved charge between slots. Track stage completion
    // again on the final SoC trajectory, starting from the same measured daily mark.
    const residualStage = {reachedPct: -1};
    const allowEqvGap = stageSurplus && !pvTrial && selfConsumptionEnabled && maxDischarge > 0
        && nativeConfig.wb1ControlEnabled === true && Number(nativeConfig.batteryHeadCount ?? 1) === 1
        && typeof daytimeStorageAssistanceEnabled === 'function' && daytimeStorageAssistanceEnabled();
    let eqvRemainingWh = allowEqvGap ? wallboxDemandKWh[1] * 1000 / vehicleEfficiency
        - flexPlan.reduce((sum, s) => sum + s.wbW[1] * pricePlanHours(s.timestamp, planningNow), 0) : 0;
    let eqvGap = null;
    for (let i = 0; i < flexPlan.length; i++) {
        const slot = flexPlan[i];
        const hours = priorityPv ? pricePlanHours(slot.timestamp, planningNow) : 0.25;
        const targetSoc = targetPlan[i].targetPct;
        let batteryW = slot.batteryReservedPvW ?? 0;
        if (stageSurplus && hours > 0) {
            const wattsPerPct = capacity * 10 / (efficiency * hours);
            const roomW = Math.max(0, (Math.min(maxSoc, targets.late) - soc) * wattsPerPct);
            // Earlier residual charging can leave less room for a later reservation.
            if (!slot.pauseBattery && batteryW > roomW + 1e-7) batteryW = roomW;
            const reached = plannedBatteryStageReached(residualStage, slot.timestamp, targetSoc, soc + batteryW / wattsPerPct);
            if (allowEqvGap && reached && !eqvGap && !batteryW && !slot.wbW[1] && slot.residualPvW > 0 && eqvRemainingWh > 0) {
                eqvGap = planEqvPvGap(i, flexPlan, allocations, wallboxes[1], targetPlan, wallboxStatus[1], {
                    now: planningNow, soc, floor: minSoc, capacity, efficiency, maxDischarge, remainingWh: eqvRemainingWh});
                if (eqvGap) eqvRemainingWh -= eqvGap.carWh;
            }
            if (eqvGap) {
                const index = (slot.timestamp - eqvGap.plan.from) / 900000;
                const needW = eqvGap.needs[index], point = wallboxes[1][i], a = allocations[i];
                const minW = wallboxStatus[1].nominalVoltage * 6;
                batteryW = -needW;
                slot.wbW[1] = minW;
                Object.assign(point, {phases: 1, currentA: 6, valueW: minW, chargingMinutes: hours * 60, pvGap: eqvGap.plan});
                a.wallboxCommandW[1] = minW;
                Object.assign(a, {activeWallboxes: [1], waitingWallboxes: a.waitingWallboxes.filter(wb => wb !== 1),
                    wallboxRequestedW: minW, wallboxW: minW, wallboxPvW: slot.residualPvW,
                    wallboxBatteryW: needW, pvBeforeBatteryW: 0, pvBeforeQuantizationW: 0, pvAfterQuantizationW: 0});
                slot.residualPvW = 0;
                if (index + 1 === eqvGap.needs.length) eqvGap = null;
            }
            if (!slot.pauseBattery && reached && slot.residualPvW > 0 && roomW > batteryW + 1e-7) {
                const extraW = Math.min(roomW - batteryW, residualStageChargeW(slot, allocations[i], wallboxes, i,
                    batteryW, maxCharge, consumptionLimit));
                batteryW += extraW;
                if (extraW > 0) allocations[i].batteryStageSurplusPvW = extraW;
            }
        }
        if (!slot.pauseBattery && !priorityPv && slot.residualPvW > 0 && soc < targetSoc) {
            const deadline = targetPlan[i].deadlineIndex;
            const needStoredKWh = (targetSoc - soc) / 100 * capacity;
            const safeFutureStoredKWh = flexPlan.slice(i + 1, deadline + 1).reduce((sum, future) =>
                sum + Math.min(maxCharge, future.residualPvW * forecastSafety) * 0.25 / 1000 * efficiency, 0);
            const shortfallStoredKWh = Math.max(0, needStoredKWh - safeFutureStoredKWh);
            const requiredNowW = shortfallStoredKWh / efficiency * 1000 / 0.25;
            batteryW = Math.min(maxCharge, slot.residualPvW, requiredNowW);
        } else if (batteryW === 0) batteryW = -plannedBatteryHouseDischargeW(slot, soc, {
            minSoc, maxDischarge, capacity, efficiency, hours, selfConsumptionEnabled, spreadOk, highPrice});

        let reserveGridChargeW = 0;
        if (priceBattery) {
            batteryW = priceBattery.slots[i].valueW;
            soc = priceBattery.slots[i].socPct;
            reserveGridChargeW = priceBattery.slots[i].reserveGridChargeW;
        } else {
            const reserveHours = pricePlanHours(slot.timestamp, planningNow);
            const ordinaryPvW = Math.max(0, batteryW);
            const forecastCharge = plannedForecastReserveCharge(forecastReserve, slot, soc, {
                hours: reserveHours, capacity, efficiency, maxSoc, pvChargeW: ordinaryPvW});
            if (forecastReserve) reserveProof[i] = {soc, reserveHours, ordinaryPvW, ...forecastCharge};
            reserveGridChargeW = forecastCharge.reserveGridChargeW;
            const additionalChargeW = forecastCharge.pvChargeW - ordinaryPvW + reserveGridChargeW;
            soc += batteryW >= 0
                ? batteryW * hours / 1000 * efficiency / capacity * 100
                : batteryW * hours / 1000 / efficiency / capacity * 100;
            soc += additionalChargeW * reserveHours / 1000 * efficiency / capacity * 100;
            batteryW += additionalChargeW;
            // A reserve is a discharge floor, not energy. A live SoC below a
            // newly raised reserve remains below it until real modeled charge.
            soc = Math.max(0, Math.min(batteryHeadMode || operating ? 100 : maxSoc, soc));
        }

        const pvBeforeBatteryW = slot.residualPvW + (slot.batteryReservedPvW ?? 0);
        const batteryPvW = priceBattery?.slots[i].pvChargeW
            ?? Math.min(Math.max(0, batteryW - reserveGridChargeW), pvBeforeBatteryW);
        const boostBudgetW = Math.max(0, pvBeforeBatteryW - batteryPvW);
        const rawGridW = slot.baseW + slot.dhwW + slot.heatW
            + slot.wbW.reduce((a, b) => a + b, 0) + batteryW - slot.pvW;
        // Der veroeffentlichte Netzplan bilanziert dieselben ganzzahligen Watt
        // wie die Geraeteplaene. Interne Geraeteenergie-/SoC-Rechnung bleibt ungerundet.
        const gridW = Math.round(slot.baseW) + Math.round(slot.dhwW) + Math.round(slot.heatW)
            + slot.wbW.reduce((sum, power) => sum + Math.round(power), 0)
            + Math.round(batteryW) - Math.round(slot.pvW);
        Object.assign(allocations[i], {batteryW, batteryPvW,
            batteryGridChargeW: Math.max(0, batteryW) - batteryPvW,
            remainingPvW: boostBudgetW, rawGridW, gridW});
        const accountingHours = pricePlanHours(slot.timestamp, planningNow);
        importWh += Math.max(0, gridW) * accountingHours;
        exportWh += Math.max(0, -gridW) * accountingHours;
        const meta = {timestamp: slot.timestamp, offsetMin: slot.offsetMin};
        const pricePoint = priceBattery?.slots[i];
        battery.push({...meta, valueW: Math.round(batteryW),
            ...(priorityPv ? {requiredPvChargeW: Math.round(Math.min(slot.requiredPvChargeW, batteryPvW))} : {}),
            gridChargeW: pricePoint?.gridChargeW || 0,
            ...(forecastReserve ? {reserveGridChargeW: Math.round(reserveGridChargeW)} : {}),
            priceLimitCt: pricePoint?.priceLimitCt ?? null,
            priceOptimized: Boolean(pricePoint),
            plannedGridEnergyKWh: pricePoint?.plannedGridEnergyKWh || 0,
            ...(highTariffWindow && slot.timestamp < highTariffWindow.endTimestamp ? {highTariffReserve: true} : {}),
            dischargeFloorPct: batteryHeadMode && !batteryForecastValid ? null : pricePoint?.dischargeFloorPct ?? minSoc,
            targetSoCPct: batteryHeadMode && !batteryForecastValid ? null : pricePoint?.targetSoCPct ?? maxSoc,
            energyReason: pricePoint?.energyReason ?? (reserveGridChargeW > 0 ? 'Prognose-SoC-Reserve'
                : allocations[i].wallboxBatteryW > 0 ? 'EQV-PV-Lücke'
                    : batteryW > 0 ? 'PV' : batteryW < 0 ? 'Eigenverbrauch' : 'Halten'),
            pvHeadroomKWh: batteryHeadMode && !batteryForecastValid ? null
                : pricePoint?.pvHeadroomKWh ?? Math.max(0, (maxSoc - soc) / 100 * capacity),
            forecastValid: batteryForecastValid,
            priceReason: pricePoint?.priceReason || 'price-charging-disabled'});
        batterySoc.push({...meta, value_pct: batteryHeadMode && !batteryForecastValid ? null : Math.round(soc * 10) / 10});
        trajectory.push({timestamp: slot.timestamp, soc});
        batteryTarget.push({...meta, value_pct: batteryHeadMode && !batteryForecastValid ? null : targetSoc});
        batteryStage.push({...meta, stage: batteryHeadMode && !batteryForecastValid ? 'unavailable' : targetPlan[i].stage,
            target_pct: batteryHeadMode && !batteryForecastValid ? null : targetSoc});
        boost.push({...meta, release: boostBudgetW >= CFG.limits.pvBoostMinExpectedW,
            budgetW: Math.round(Math.max(0, boostBudgetW))});
        const applianceW = allocations[i].applianceW;
        grid.push({...meta, valueW: gridW, ...(applianceW > 0
            ? {applianceW: Math.round(slot.baseW) - Math.round(slot.baseW - applianceW)} : {})});
    }

    const forecastSocVerified = batteryHeadMode || getState(CFG.dp.batterySoc)?.ack === true;
    if (!forecastReserve && batteryForecastValid && forecastSocVerified && liveSoc !== null && liveSoc >= 0 && liveSoc <= 100) {
        const low = forecastBatteryLowSocWindow(trajectory, initialSoc, planningNow);
        if (low) {
            const observedSince = typeof batteryForecastReserveBelowSince === 'function'
                ? batteryForecastReserveBelowSince(planningNow) : 0;
            const deadlineAt = observedSince > 0 ? observedSince + BATTERY_FORECAST_LOW_SOC_MS : 0;
            const needKWh = Math.max(0, (Math.min(maxSoc, BATTERY_FORECAST_RESERVE_SOC) - initialSoc) / 100)
                * capacity / efficiency;
            const maximumReserveW = forecastReserveRecoveryPowerW(maxCharge);
            const powerW = flexPlan.map(slot => forecastBatteryReservePowerW(slot, consumptionLimit, maximumReserveW));
            const schedule = forecastBatteryReserveSchedule(flexPlan, needKWh, planningNow, deadlineAt, powerW);
            return buildDevicePlan(data, withoutReadiness, planningNow, {...low, plannedAt: planningNow,
                chargeAt: schedule?.chargeAt ?? planningNow, deadlineAt}, pvTrial, operating);
        }
    }
    // Price-optimized battery purchases/holds still need a separate proof.
    // For the low-SoC reserve, replay its actual charge decision at each
    // changed slot with the new thermal load and the original pre-slot SoC.
    if (!priceBattery && reconcileDhwPriceBridgeWithReserve(allocations, thermal.report,
        planningNow, thermal.maxPowerW, (slot, i) => {
            const vehicleW = wallboxes.reduce((sum, series) => sum + Math.max(series[i].valueW,
                series[i].currentA * series[i].phases * 230), 0);
            const limits = parallelForecastLimits(slot.pvW, slot.baseW + vehicleW, slot.dhwW,
                slot.heatingW, Math.max(0, slot.batteryW), consumptionLimit);
            return limits;
        }, forecastReserve, (slot, i) => forecastReserveHeatFits(forecastReserve, slot,
            flexPlan[i], reserveProof[i], consumptionLimit, {now: planningNow, maxCharge, capacity, efficiency, maxSoc}))) {
        importWh = 0;
        exportWh = 0;
        allocations.forEach((slot, i) => {
            flexPlan[i].dhwW = slot.dhwW;
            dhw[i].valueW = Math.round(slot.dhwW);
            grid[i].valueW = slot.gridW;
            const hours = pricePlanHours(slot.timestamp, planningNow);
            importWh += Math.max(0, slot.gridW) * hours;
            exportWh += Math.max(0, -slot.gridW) * hours;
        });
    }
    if (pvTrial) {
        const {proof, baseline} = pvTrial, wb = proof.index;
        const finish = proof.departureAt - departureFinishReserveMs;
        const actual = departurePvEnergy(wallboxes[wb], allocations, planningNow, proof.releaseAt, finish);
        const need = (proof.minimumSocPct - wallboxStatus[wb].departureSocPct) * proof.capacityKWh / (100 * proof.efficiency);
        // Check the final allocation, including loads that changed in the trial.
        const storageDeficitWh = batteryForecastValid ? Math.max(0, baseline.endSoc - soc) * capacity * 10 * efficiency : 0;
        if (actual.delivered + 0.003 < need) return false;
        if (proof.backupUntil) {
            // Check heat and peer schedules over the promised zero-PV block.
            if (actual.earlyGrid > 0.01 || allocations.some((slot, i) => slot.timestamp >= proof.releaseAt
                && slot.timestamp < proof.backupUntil && !(departureSlotLimits(wallboxStatus[wb], proof.backupPhases,
                    slot, wallboxes, i, consumptionLimit).gridW >= proof.backupMinimumW))) return false;
        } else if (importWh + exportWh + storageDeficitWh > baseline.gridExchangeWh + 10
            || actual.earlyGrid + 0.01 >= baseline.earlyGrid || actual.solar <= baseline.solar + 0.01) return false;
        let futureAcKWh = proof.backupAcKWh;
        for (let i = wallboxes[wb].length - 1; i >= 0; i--) {
            const point = wallboxes[wb][i];
            if (point.timestamp >= proof.releaseAt) {
                if (proof.minimumByDeparture && point.timestamp < proof.departureAt)
                    point.departurePv = proof;
                continue;
            }
            point.departurePv = {...proof, futureAcKWh};
            if (!proof.backupUntil) futureAcKWh += point.valueW * pricePlanHours(point.timestamp, planningNow) / 1000;
        }
    } else {
        const outstanding = wallboxStatus.filter(v => v.eligible && v.deadlineEnabled
            && v.departureTimestamp > planningNow && v.socValid && v.departureSocPct < v.minimumSocPct);
        // Overlapping outstanding departures keep their jointly paced grid reserve.
        if (outstanding.length === 1 && (!productionScope?.production || productionWallboxes.includes(outstanding[0].index))) {
            const windows = departurePvWindows(outstanding[0], data, allocations, wallboxes, battery, trajectory, {
                now: planningNow, consumptionLimit, initialSoc, storageCapacity: capacity, storageEfficiency: efficiency,
                safety: Math.min(0.8, forecastSafety)});
            for (const proof of windows) {
                const baseline = departurePvEnergy(wallboxes[proof.index], allocations, planningNow, proof.releaseAt,
                    proof.departureAt - departureFinishReserveMs);
                baseline.gridExchangeWh = importWh + exportWh;
                baseline.endSoc = soc;
                if ((proof.backupUntil || baseline.earlyGrid > 0.01) && buildDevicePlan(data, withoutReadiness, planningNow, forecastReserve,
                    {proof, baseline}, operating)) return true;
            }
        }
    }
    const assess = nativeConfig.batteryAdaptiveTargetsEnabled !== false && typeof batteryOperatingWindow !== 'undefined'
        && batteryForecastValid && forecastSocVerified && liveSoc !== null && liveSoc >= 0 && liveSoc <= 100
        && selfConsumptionEnabled && maxCharge > 0 && maxDischarge > 0 && batteryOperatingWindow.completeForecast(data, planningNow);
    let supportFloorPct = 0, lowestPct = null;
    const lastFull = measuredBatteryFullAt(planningNow);
    if (assess) {
        const options = {now: planningNow, initialSoc, capacity, minSoc, maxCharge, maxDischarge,
            ceiling: regularCeiling, efficiency, safety: forecastSafety, lastFull};
        const score = {importWh, exportWh, endSoc: soc, lowReserve: Boolean(forecastReserve),
            service: batteryOperatingWindow.service(allocations, wallboxes, wallboxStatus, planningNow)};
        if (operating?.reference && (score.lowReserve && !operating.reference.lowReserve
            || !batteryOperatingWindow.comparable(operating.reference, score, capacity, efficiency))) return false;
        if (offset) {
            const proof = batteryOperatingWindow.overnightReserve(allocations, trajectory, options);
            if (!proof.valid || !trajectory.some((p, i) => p.soc >= regularCeiling - 1 && allocations[i].batteryPvW > 0)
                && initialSoc < regularCeiling) return false;
            supportFloorPct = proof.supportFloorPct;
            if (trajectory.some((p, i) => allocations[i].wallboxBatteryW > 0 && p.soc < supportFloorPct)) return false;
            lowestPct = Math.round(proof.lowestPct * 10) / 10;
        } else if (!operating && !forecastReserve) {
            for (const reduction of [20, 10]) {
                const ceiling = lateTarget - reduction;
                if (ceiling <= minSoc + 5 || !trajectory.some(p => p.soc >= ceiling - 1)) continue;
                if (buildDevicePlan(data, withoutReadiness, planningNow, null, null, {offset: reduction, reference: score}))
                    return true;
            }
        }
        if (calibration) {
            if (!trajectory.some((p, i) => p.timestamp + 900000 > calibration.start && p.timestamp < calibration.end
                && p.soc >= 99.95 && (allocations[i].batteryPvW > 0 || initialSoc >= 99.95))) return false;
        } else if (hardMaximum === 100 && lateTarget === 100) {
            const previous = getState(`${r}.Plan.BatteryOperatingWindow_JSON`);
            const updated = getState(`${r}.Plan.LastUpdate`);
            let active = null;
            if (previous?.ack === true && !previous.q && previous.ts <= planningNow
                && getState(`${r}.Plan.Valid`)?.val === true && updated?.ack === true && !updated.q
                && Number.isSafeInteger(updated.val) && updated.val <= planningNow && planningNow - updated.val <= 20 * 60000) {
                try { active = JSON.parse(previous.val)?.calibration; } catch { /* Recompute from available PV. */ }
            }
            let triedStart = null;
            // Prefer energy left after every load. Flexible loads may move only
            // if the finished joint plan still proves their energy and deadlines.
            for (const reschedule of [false, true]) {
                const window = batteryOperatingWindow.calibrationWindow(allocations, trajectory, {...options, active}, reschedule);
                if (!window || window.start === triedStart) continue;
                if (buildDevicePlan(data, withoutReadiness, planningNow, forecastReserve, null,
                    {offset, reference: score, calibration: window})) return true;
                triedStart = window.start;
            }
        }
    } else if (operating) return false;
    if (operating) for (let i = 0; i < batteryStage.length; i++) {
        batteryStage[i].operatingWindow = {offsetPct: offset, ceilingPct: regularCeiling, supportFloorPct,
            ...(battery[i].gridChargeW > 0 ? {gridTargetPct: Math.min(regularCeiling, battery[i].targetSoCPct)} : {}),
            ...(targetPlan[i].calibration ? {calibrationStart: calibration.start} : {})};
        if (!targetPlan[i].calibration) battery[i].targetSoCPct = Math.min(battery[i].targetSoCPct, regularCeiling);
    }
    const windowStatus = {offsetPct: offset, targets, ceilingPct: regularCeiling, lowestForecastPct: lowestPct,
        supportFloorPct, lastFullAt: lastFull, calibration: calibration ?? null,
        calibrationDue: lateTarget === 100 && (!lastFull || planningNow - lastFull >= 30 * 86400000),
        reason: !assess ? 'standard-no-qualified-forecast' : offset ? 'verified-lower-targets' : 'standard-energy-demand'};
    write(`${r}.Plan.BatteryOperatingWindow_JSON`, JSON.stringify(windowStatus));
    write(`${r}.Plan.BatteryForecastValid`, batteryForecastValid);
    write(`${r}.Plan.BatteryForecastStatus`, batteryForecastStatus);
    write(`${r}.Plan.BatteryForecastReserve_JSON`, JSON.stringify(batteryForecastValid && forecastReserve || {}));
    write(`${r}.Plan.BatteryPower_48h_JSON`, JSON.stringify(battery));
    write(`${r}.Plan.BatterySoC_48h_JSON`, JSON.stringify(batterySoc));
    write(`${r}.Plan.BatteryTargetSoC_48h_JSON`, JSON.stringify(batteryTarget));
    write(`${r}.Plan.BatteryStage_48h_JSON`, JSON.stringify(batteryStage));
    write(`${r}.Plan.DHWForecastValid`, thermal.valid);
    write(`${r}.Plan.DHWForecastStatus`, !dhwPresent ? 'Nicht vorhanden' : !thermal.valid
        ? 'Nicht bewertbar: vier gueltige Speichersensoren erforderlich'
        : `Waermeprognose mit Annahmen: Netz ${thermal.report.gridHeatingKWh.toFixed(2)} kWh, PV ${thermal.report.pvHeatingKWh.toFixed(2)} kWh; ungedeckt ${thermal.report.unmetReserveKWh.toFixed(2)} kWh; keine Ausgangsfreigabe`);
    write(`${r}.Plan.DHWThermalDiagnostics_JSON`, JSON.stringify(thermal.report));
    write(`${r}.Plan.MyPV_DHW_48h_JSON`, JSON.stringify(dhw));
    write(`${r}.Plan.MyPV_Heating_48h_JSON`, JSON.stringify(heating));
    write(`${r}.Plan.PVBoost_48h_JSON`, JSON.stringify(boost));
    write(`${r}.Plan.ParallelDistribution_48h_JSON`, JSON.stringify(parallel));
    wallboxes.forEach((series, wb) => write(`${r}.Plan.Wallbox${wb}_48h_JSON`, JSON.stringify(series)));
    write(`${r}.Plan.GridPower_48h_JSON`, JSON.stringify(grid));
    write(`${r}.Chart.BatteryPower_48h_json_chart`, chartJson(battery, x => x.valueW));
    write(`${r}.Chart.BatterySoC_48h_json_chart`, chartJson(batterySoc, x => x.value_pct));
    write(`${r}.Chart.BatteryTargetSoC_48h_json_chart`, chartJson(batteryTarget, x => x.value_pct));
    write(`${r}.Chart.MyPV_DHW_48h_json_chart`, chartJson(dhw, x => x.valueW));
    write(`${r}.Chart.MyPV_Heating_48h_json_chart`, chartJson(heating, x => x.valueW));
    write(`${r}.Chart.PVBoostBudget_48h_json_chart`, chartJson(boost, x => x.budgetW));
    write(`${r}.Chart.ParallelDistribution_48h_json_chart`, chartJson(parallel, x => x.value));
    wallboxes.forEach((series, wb) => write(`${r}.Chart.Wallbox${wb}_48h_json_chart`, chartJson(series, x => x.valueW)));
    write(`${r}.Chart.GridPower_48h_json_chart`, chartJson(grid, x => x.valueW));
    write(`${r}.Plan.ExpectedImport_kWh`, Math.round(importWh / 10) / 100);
    write(`${r}.Plan.ExpectedExport_kWh`, Math.round(exportWh / 10) / 100);
    write(`${r}.Plan.ConnectedWallboxes_JSON`, JSON.stringify(connected));
    const wallboxPlanStatus = wallboxStatus.map((vehicle, wb) => {
        const assigned = flexPlan.filter(slot => slot.wbW[wb] > 0);
        const plannedEnergyKWh = assigned.reduce((sum, slot) =>
            sum + slot.wbW[wb] * pricePlanHours(slot.timestamp, planningNow) / 1000 * vehicleEfficiency, 0);
        const remainingEnergyKWh = vehicle.socValid
            ? Math.max(0, (vehicle.eligible ? wallboxDemandKWh[wb] : vehicle.energyRequiredKWh) - plannedEnergyKWh)
            : vehicle.priceChargingEnabled && vehicle.priceSessionValid
                ? Math.max(0, vehicle.priceRemainingKWh - plannedEnergyKWh / vehicleEfficiency) : null;
        const planningStatus = !vehicle.eligible ? 'ineligible' : remainingEnergyKWh === null ? 'unknown-demand'
            : remainingEnergyKWh <= 1e-9 ? 'complete' : assigned.length ? 'partial' : 'no-window';
        const planningReason = planningStatus === 'ineligible' ? vehicle.reason
            : planningStatus === 'unknown-demand' ? 'SoC unbekannt; Ladebedarf und Abschluss nicht berechenbar'
            : planningStatus === 'complete' ? 'Ladebedarf im Fahrplan vollstaendig gedeckt'
            : planningStatus === 'partial' ? 'Ladebedarf nur teilweise in passende Zeitfenster einplanbar'
            : 'Kein passendes Ladefenster nach den hoeher priorisierten Bedarfen';
        return {...vehicle, planningStatus, planningReason,
            plannedEnergyKWh: Math.round(plannedEnergyKWh * 10000) / 10000,
            remainingEnergyKWh: remainingEnergyKWh === null ? null : Math.round(remainingEnergyKWh * 10000) / 10000,
            firstPlannedTimestamp: assigned[0]?.timestamp || 0,
            lastPlannedTimestamp: assigned[assigned.length - 1]?.timestamp || 0};
    });
    write(`${r}.Plan.WallboxStatus_JSON`, JSON.stringify(wallboxPlanStatus));
    write(`${r}.Plan.Allocation_48h_JSON`, JSON.stringify(allocations));
    write(`${r}.Plan.AllocationSource`, data.houseSource || 'data.house');
    write(`${r}.Plan.BatterySoCSource`, socSource);
    write(`${r}.Plan.PriceChargingDiagnostics_JSON`, JSON.stringify({wallboxes: priceWallboxReports,
        battery: priceBattery?.report || {enabled: false, reason: !batteryConfigured ? 'not-present'
            : !batteryForecastValid ? batteryForecastStatus
            : liveSoc === null ? 'live-soc-unavailable'
            : highTariffReserveEnabled ? 'no-qualified-high-tariff-window' : 'disabled'}}));
    write(`${r}.Plan.BatteryGridChargingEnergy_kWh`, priceBattery?.report.gridKWh ?? 0);
    write(`${r}.Plan.BatteryGridChargingTargetSoC_pct`, priceBattery?.report.chargeWindows.length
        ? Math.max(...priceBattery.report.chargeWindows.map(window => window.targetSoCPct)) : null);
    write(`${r}.Plan.BatteryPriceSavings_EUR`, priceBattery?.report.enabled ? priceBattery.report.expectedSavingsEUR : null);
    write(`${r}.Plan.BatteryReservedPvCapacity_kWh`, priceBattery?.report.reservedPvCapacityKWh ?? null);
    write(`${r}.Plan.BatteryPriceChargingWindows_JSON`, JSON.stringify(priceBattery?.report.chargeWindows ?? []));
    write(`${r}.Plan.PriceChargingStatus`, `Preisladung: Batterie ${priceBattery?.report.enabled ? priceBattery.report.gridKWh.toFixed(3) + ' kWh' : 'aus'}; Wallboxen ${priceWallboxReports.reduce((sum, x) => sum + x.gridKWh, 0).toFixed(3)} kWh; gueltige Preisbloecke erforderlich${highTariffWindow ? '; Speicherreserve fuer Hochfenster geplant' : ''}`);
    write(`${r}.Plan.Valid`, true);
    write(`${r}.Plan.Status`, `48 h berechnet; angeschlossen: ${connected.length ? connected.join(', ') : 'keine'}; Ladebedarf: ${eligibleWallboxes.length ? eligibleWallboxes.join(', ') : 'keiner'}; Preisintervalle gueltig: ${prices.filter(Number.isFinite).length}/${data.pv.length}${batteryConfigured && !batteryForecastValid ? '; Batterie: ' + batteryForecastStatus : ''}`);
    write(`${r}.Plan.LastUpdate`, Date.now());

    const importKWh = importWh / 1000;
    const exportKWh = exportWh / 1000;
    const maxPlannedChargeW = battery.reduce((max, x) => Math.max(max, x.valueW), 0);
    const maxPlannedDischargeW = battery.reduce((max, x) => Math.max(max, -x.valueW), 0);
    const atMinHours = batterySoc.filter(x => Number.isFinite(x.value_pct) && x.value_pct <= minSoc + 0.1).length * 0.25;
    const atTargetHours = batterySoc.filter((x, i) => Number.isFinite(x.value_pct)
        && Number.isFinite(batteryTarget[i].value_pct) && x.value_pct >= batteryTarget[i].value_pct - 0.1).length * 0.25;
    const additionalShiftKWh = Math.min(importKWh, exportKWh * efficiency);
    const capacityHint = atMinHours >= 1 && exportKWh > 0.5
        ? 'Kapazitaet koennte zu klein sein: Mindest-SoC erreicht und spaeter/zusätzlich PV-Export vorhanden.'
        : 'Im 48-h-Plan kein eindeutiger Hinweis auf zu geringe Kapazitaet.';
    const powerHint = maxCharge > 0 && maxPlannedChargeW >= maxCharge * 0.98
        || maxDischarge > 0 && maxPlannedDischargeW >= maxDischarge * 0.98
        ? ` Die effektive Leistungsgrenze wird erreicht (Laden ${Math.round(maxCharge)} W, Entladen ${Math.round(maxDischarge)} W); hoehere Leistung separat pruefen.`
        : ' Die Leistungsgrenze wird im Plan nicht erreicht.';
    const batteryEvaluationAvailable = !batteryHeadMode || batteryForecastValid;
    write(`${r}.Evaluation.BatteryMaxPlannedCharge_W`, batteryEvaluationAvailable ? maxPlannedChargeW : null);
    write(`${r}.Evaluation.BatteryMaxPlannedDischarge_W`, batteryEvaluationAvailable ? maxPlannedDischargeW : null);
    write(`${r}.Evaluation.BatteryAtMinSoC_h`, batteryEvaluationAvailable ? Math.round(atMinHours * 100) / 100 : null);
    write(`${r}.Evaluation.BatteryAtTargetSoC_h`, batteryEvaluationAvailable ? Math.round(atTargetHours * 100) / 100 : null);
    write(`${r}.Evaluation.RemainingGridImport_kWh`, Math.round(importKWh * 100) / 100);
    write(`${r}.Evaluation.RemainingPVExport_kWh`, Math.round(exportKWh * 100) / 100);
    write(`${r}.Evaluation.AdditionalShiftPotential_kWh`, batteryEvaluationAvailable ? Math.round(additionalShiftKWh * 100) / 100 : null);
    write(`${r}.Evaluation.BatterySizingHint`, batteryHeadMode && !batteryForecastValid
        ? batteryForecastStatus : capacityHint + powerHint);
    return true;
}
