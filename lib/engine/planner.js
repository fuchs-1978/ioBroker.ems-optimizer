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

function recommendedPlanPhases(vehicle, remainingPvW, remainingGridKWh, timestamp) {
    if (!vehicle || !vehicle.phaseSwitchEnabled || vehicle.maximumPhases < 3) return 1;
    if (vehicle?.phaseControlMode === 'script')
        return vehicle.confirmedPhases === 3 ? 3 : 1;
    const hoursRemaining = vehicle.departureTimestamp > timestamp
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

function comparePlannedVehicles(a, b) {
    return Number(b.belowMinimum) - Number(a.belowMinimum)
        || Number(b.mustCharge) - Number(a.mustCharge)
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

function buildBatteryTargetPlan(data, capacity, maxCharge, efficiency, targets, reserveMin) {
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
        const usable = indices.filter(i =>
            (Number(data.pv[i]?.valueW) || 0) - (Number(data.house[i]?.valueW) || 0) >= 200);
        if (!usable.length) return;
        const peakIndex = usable.reduce((best, i) =>
            Number(data.pv[i].valueW) > Number(data.pv[best].valueW) ? i : best, usable[0]);
        const lastPvIndex = usable[usable.length - 1];
        const lateStartIndex = Math.max(peakIndex, lastPvIndex - reserveSlots - lateSlots + 1);
        const lateDeadlineIndex = Math.max(lateStartIndex, lastPvIndex - reserveSlots);

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
                result[i].deadlineIndex = peakIndex;
            } else {
                result[i].deadlineIndex = i;
            }
        });
    });
    return result;
}

// Price charging uses explicit import authorization. Ordinary positive PV
// budgets never become permission to buy energy from the grid.
function pricePlanHours(timestamp, now = Date.now()) {
    return Math.max(0, Math.min(0.25, (timestamp + 900000 - now) / 3600000));
}

function pricePlanSettings() {
    const root = `${CFG.root}.Config`;
    return {horizonMs: Math.max(6, Math.min(48, readNumber(`${root}.PriceChargingHorizon_h`, 24))) * 3600000,
        blockHours: Math.max(15, Math.min(240, readNumber(`${root}.PriceChargingMinBlock_min`, 30))) / 60};
}

function priceBlocks(slots, powers, eligible, blockHours, now, alreadySelected = []) {
    const result = [];
    for (let start = 0; start < slots.length; start++) {
        let duration = 0, capacityKWh = 0, cost = 0;
        const indices = [];
        for (let i = start; i < slots.length && eligible(i); i++) {
            if (i > start && slots[i].timestamp !== slots[i - 1].timestamp + 900000) break;
            const hours = pricePlanHours(slots[i].timestamp, now);
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

function addPriceWallboxPlan(slots, wallboxes, allocations, vehicles, efficiency, now) {
    const {horizonMs, blockHours} = pricePlanSettings();
    const reports = [];
    for (const vehicle of vehicles.filter(v => v.eligible).sort(comparePlannedVehicles)) {
        const wb = vehicle.index;
        const enabled = getState(`${CFG.root}.Config.Wallbox${wb}PriceChargingEnabled`)?.val === true;
        const remaining = numericValue(vehicle.priceRemainingKWh);
        // The purchase window is not the time by which a flexible car must be
        // full. Account for usable PV throughout its complete forecast window,
        // including tomorrow afternoon after a 24-hour purchase window ends.
        const demandDeadline = Math.min(Number(vehicle.priceDeadlineTimestamp) || 0,
            vehicle.deadlineEnabled && vehicle.departureTimestamp > 0 ? vehicle.departureTimestamp : Infinity);
        const deadline = Math.min(now + horizonMs, demandDeadline);
        const deadlineMode = vehicle.priceDeadlineMode || (vehicle.deadlineEnabled ? 'departure' : 'flexible');
        if (!enabled || vehicle.priceSessionValid !== true || !(remaining > 0) || deadline <= now) {
            reports.push({wallbox: wb, enabled, gridKWh: 0, reason: !enabled ? 'disabled'
                : vehicle.priceSessionValid !== true ? 'session-invalid' : 'no-bounded-demand'});
            continue;
        }
        // Only energy missing after the PV/mandatory baseline needs a purchase.
        // An actual departure still bounds both the baseline and grid charging.
        const baselineKWh = slots.reduce((sum, slot) => sum + (slot.timestamp < demandDeadline
            ? slot.wbW[wb] * pricePlanHours(slot.timestamp, now) / 1000 : 0), 0);
        let neededKWh = Math.max(0, remaining - baselineKWh);
        const originalNeed = neededKWh, selected = [];
        const cap = readNumber(`${CFG.root}.Config.Wallbox${wb}PriceMax_ct_kWh`, 0);
        const powers = slots.map(slot => {
            const phases = recommendedPlanPhases({...vehicle, departureTimestamp: deadline}, 0, remaining, slot.timestamp);
            return quantizePlannedWallbox(vehicle.maximumPowerW, vehicle, phases);
        });
        const eligible = i => slots[i].timestamp < deadline && slots[i].timestamp + 900000 <= deadline
            && slots[i].timestamp < now + horizonMs && slots[i].priceValid
            && (cap === 0 || slots[i].price <= cap)
            && slots[i].wbW.every(watts => watts <= 0);
        while (neededKWh > 1e-8) {
            const block = priceBlocks(slots, powers, eligible, blockHours, now, selected)[0];
            if (!block) break;
            const fraction = Math.min(1, neededKWh / block.capacityKWh);
            for (const i of block.indices) {
                const slot = slots[i], hours = pricePlanHours(slot.timestamp, now);
                const phases = recommendedPlanPhases({...vehicle, departureTimestamp: deadline}, 0, remaining, slot.timestamp);
                const minimumA = phases === 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
                if (neededKWh <= 1e-8) break;
                const desiredAverageW = powers[i] * fraction;
                const currentA = Math.max(minimumA, Math.ceil(desiredAverageW / (230 * phases)));
                const commandW = Math.min(powers[i], currentA * 230 * phases);
                // Run across complete adjacent slots. Only the final stretch
                // may be shorter to meet the remaining energy exactly.
                const minutes = Math.min(hours * 60, neededKWh * 1000 / commandW * 60);
                const averageW = commandW * minutes / (hours * 60);
                const start = Math.max(now, slot.timestamp);
                // Existing heater/PV allocations retain their budgets. Only
                // unallocated PV can cover any of the added vehicle charging.
                const pvCommandW = Math.min(slot.residualPvW, commandW);
                const pvW = pvCommandW * minutes / (hours * 60);
                const gridCommandW = Math.max(0, commandW - pvCommandW);
                const gridAverageW = gridCommandW * minutes / (hours * 60);
                slot.wbW[wb] = averageW;
                slot.residualPvW = Math.max(0, slot.residualPvW - pvW);
                Object.assign(wallboxes[wb][i], {valueW: Math.round(averageW), phases, currentA,
                    chargingMinutes: minutes, gridChargeW: Math.ceil(gridCommandW),
                    plannedGridEnergyKWh: gridAverageW * hours / 1000,
                    priceLimitCt: slot.price, priceOptimized: true, priceSessionId: vehicle.priceSessionId,
                    priceChargeUntil: start + minutes * 60000,
                    priceReason: fraction < 1 ? 'cheapest-block-final-energy' : 'cheapest-feasible-block'});
                Object.assign(allocations[i], {activeWallbox: wb,
                    wallboxRequestedW: averageW, wallboxW: averageW, wallboxPvW: pvW,
                    wallboxGridW: gridAverageW, pvBeforeBatteryW: slot.residualPvW,
                    priceWallboxGridW: gridAverageW});
                neededKWh = Math.max(0, neededKWh - averageW * hours / 1000);
                selected.push(i);
            }
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

function priceBatterySimulation(slots, targetPlan, options, purchases = [], stopIndex = slots.length) {
    const {capacity, initialSoc, minSoc, maxSoc, reservePct, maxCharge, maxDischarge,
        efficiency, safety, selfConsumption, now} = options;
    const maxEnergy = capacity * maxSoc / 100;
    const gridMaxEnergy = capacity * Math.max(minSoc, Math.min(maxSoc, options.gridMaxSoc ?? maxSoc)) / 100;
    const reserveGoal = capacity * Math.min(maxSoc, minSoc + reservePct) / 100;
    let energy = Math.max(0, Math.min(maxEnergy, initialSoc * capacity / 100));
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
        const residualW = Math.max(0, slot.residualPvW * safety);
        const pvTargetEnergy = Math.min(maxEnergy, Math.max(reserveGoal,
            targetPlan[i].targetPct * capacity / 100));
        const pvChargeW = hours > 0 ? Math.min(maxCharge, residualW,
            Math.max(0, pvTargetEnergy - energy) * 1000 / (efficiency * hours)) : 0;
        const addedPvEnergy = pvChargeW * hours / 1000 * efficiency;
        energy += addedPvEnergy;
        reserveEnergy = Math.min(reserveGoal, reserveEnergy + addedPvEnergy);
        const orders = ordersBySlot[i];
        const requestedW = orders.reduce((sum, order) => sum + order.powerW, 0);
        const gridChargeW = hours > 0 ? Math.min(requestedW, Math.max(0, maxCharge - pvChargeW),
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
        const usefulDemandW = selfConsumption ? Math.min(maxDischarge, deficitW) : 0;
        const currentFloor = Math.min(maxEnergy, reserveEnergy + heldEnergy);
        const dischargeW = gridChargeW <= 1e-8 && hours > 0
            ? Math.min(usefulDemandW, Math.max(0, energy - currentFloor) * efficiency * 1000 / hours) : 0;
        energy -= dischargeW * hours / 1000 / efficiency;
        result.push({valueW: pvChargeW + gridChargeW - dischargeW, gridChargeW, pvChargeW, dischargeW,
            pvHeadroomKWh: Math.max(0, maxEnergy - energy),
            energyReason: gridChargeW > 0 ? (slot.gridLevel === 'low' ? 'NT-Netzladung' : 'Preis-Netzladung')
                : pvChargeW > 0 ? 'PV' : dischargeW > 0 ? (slot.gridLevel === 'high' ? 'HT-Vermeidung'
                    : slot.gridLevel === 'standard' ? 'ST-Vermeidung' : 'Preis-Vermeidung') : 'Halten',
            priceLimitCt: gridChargeW > 0 ? slot.price : null, priceOptimized: true,
            plannedGridEnergyKWh: gridChargeW * hours / 1000,
            dischargeFloorPct: currentFloor / capacity * 100,
            targetSoCPct: Math.min(maxSoc, Math.max(initialEnergy, initialEnergy + (pvChargeW + gridChargeW) * hours / 1000 * efficiency) / capacity * 100),
            socPct: energy / capacity * 100,
            unmetUsefulKWh: Math.max(0, usefulDemandW - dischargeW) * hours / 1000,
            gridImportW: Math.max(0, deficitW - dischargeW) + gridChargeW,
            initialEnergy, energy, floorEnergy: currentFloor, chargeHeadroomW: hours > 0 ? Math.min(maxCharge - pvChargeW,
                Math.max(0, gridMaxEnergy - initialEnergy) * 1000 / (efficiency * hours)) : 0,
            priceReason: gridChargeW > 0 ? 'cheapest-loss-adjusted-household-bridge'
                : protectedEnergy > 0 ? 'retain-for-future-household-demand' : 'pv-and-household-balance'});
    }
    return result;
}

function buildPriceBatteryPlan(slots, targetPlan, options) {
    const {horizonMs, blockHours} = pricePlanSettings();
    const horizonEnd = options.now + horizonMs;
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
            && noFreeEnergy[index].unmetUsefulKWh > 1e-9)
        .sort((a, b) => b.slot.price - a.slot.price || a.index - b.index);
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
    const purchaseDemandOrder = slots.map((slot, index) => ({slot, index}))
        .filter(({slot, index}) => index > 0 && slot.timestamp < horizonEnd && slot.priceValid)
        .sort((a, b) => b.slot.price - a.slot.price || a.index - b.index);
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
    const nextPv = slots.findIndex(slot => slot.timestamp + 900000 > options.now && slot.residualPvW >= 200);
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
    const report = {enabled: true,
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
    return {slots: simulation, report};
}

// Thermal forecast only: these assumptions never authorize a real output.
// Four equally weighted layers are an explicit approximation, not a tank simulation.
const DHW_PV_RESERVE_HORIZON_MIN = 60;

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
        gridRequest(index, pvW) {
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
            const request = (requestedKWh, reason, gridAllowed) => {
                const mandatoryPowerW = Math.min(maxW, requestedKWh * 1000 / hours);
                const priorityPvW = Math.min(Math.max(0, pvW), mandatoryPowerW);
                return {mandatoryPowerW, priorityPvW,
                    powerW: gridAllowed ? Math.max(0, mandatoryPowerW - priorityPvW) : 0,
                    reserveRefillPowerW: Math.max(0, Math.min(maxW, reserveNeedKWh * 1000 / hours)
                        - priorityPvW - (gridAllowed ? Math.max(0, mandatoryPowerW - priorityPvW) : 0)),
                    reserveTargetKWh, reserveCoveredMin: reserveHours * 60, reason};
            };
            // Unknown prices deny grid heat, not valid PV service heat. A cold
            // top and the current minimum reserve remain mandatory PV demands.
            if (!Number.isFinite(prices[index])) return request(emergencyKWh,
                emergencyKWh > 0 ? 'minimum-reserve' : 'thermal-price-unknown', false);
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
                if (solar >= (dailyDemand + dailyLoss) / 24 * 1000 + 200
                    || (Number.isFinite(prices[j]) && prices[j] < prices[index] - 1e-7)
                    || data.pv[j].timestamp - data.pv[index].timestamp >= 24 * 3600000) { nextSupply = j; break; }
            }
            const bridgeShortfall = Math.max(0, loads.slice(index, nextSupply).reduce((a, b) => a + b, 0) + safety - usable);
            const bridgeNeed = bridgeShortfall > 0 ? bridgeShortfall + coldDeficit : 0;
            const requestedKWh = Math.min(headroom, cheaperReachable ? emergencyKWh : Math.max(emergencyKWh, bridgeNeed));
            return request(requestedKWh,
                emergencyKWh > 0 ? 'minimum-reserve' : cheaperReachable ? 'wait-for-cheaper-window' : 'price-bridge', true);
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

function buildDevicePlan(data) {
    const r = CFG.root;
    const planningNow = Date.now();
    if (!historyReady || !data.pv.length || !data.house.length) {
        write(`${r}.Plan.Valid`, false);
        write(`${r}.Plan.Status`, 'Wartet auf gueltige Historie und Prognose');
        return;
    }

    const batteryPresent = Boolean(getState(`${r}.Devices.Battery.Present`)?.val);
    const dhwPresent = Boolean(getState(`${r}.Devices.MyPV_DHW.Present`)?.val);
    const heatingPresent = Boolean(getState(`${r}.Devices.MyPV_Heating.Present`)?.val);
    const capacity = Math.max(0.1, readNumber(`${r}.Config.BatteryCapacity_kWh`, 10));
    const maxCharge = batteryPresent
        ? Math.max(0, readNumber(`${r}.Config.BatteryMaxCharge_W`, 2400)) : 0;
    const maxDischarge = batteryPresent
        ? Math.max(0, readNumber(`${r}.Config.BatteryMaxDischarge_W`, 2400)) : 0;
    const minSoc = readNumber(`${r}.Config.BatteryMinSoC_pct`, 15);
    const maxSoc = Math.max(minSoc, Math.min(100, readNumber(`${r}.Config.BatteryMaxSoC_pct`, 100)));
    const morningTarget = Math.max(minSoc, Math.min(maxSoc,
        readNumber(`${r}.Config.BatteryMorningTargetSoC_pct`, 70)));
    const afternoonTarget = Math.max(morningTarget, Math.min(maxSoc,
        readNumber(`${r}.Config.BatteryAfternoonTargetSoC_pct`, 90)));
    const targets = {
        morning: morningTarget,
        afternoon: afternoonTarget,
        late: Math.max(afternoonTarget, Math.min(maxSoc,
            readNumber(`${r}.Config.BatteryLateTargetSoC_pct`, 100)))
    };
    const efficiency = batteryPlanningEfficiency();
    const targetPlan = buildBatteryTargetPlan(data, capacity, maxCharge, efficiency, targets,
        readNumber(`${r}.Config.BatteryFinalChargeReserve_min`, 45));
    const liveSoc = freshOptionalNumber(CFG.dp.batterySoc, 5 * 60 * 1000);
    let soc = Math.max(0, Math.min(100, liveSoc === null
        ? readNumber(`${r}.Config.BatteryManualSoC_pct`, 50) : liveSoc));
    const socSource = liveSoc === null ? 'Config.BatteryManualSoC_pct (Livewert fehlt/veraltet)' : CFG.dp.batterySoc;

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
        return {...vehicle, eligible: vehicle.release, reason: vehicle.status};
    });
    const connected = wallboxStatus.filter(x => x.connected).map(x => x.index);
    const eligibleWallboxes = wallboxStatus.filter(x => x.eligible)
        .sort(comparePlannedVehicles)
        .map(x => x.index);
    const vehicleEfficiency = Math.max(0.5, Math.min(1,
        readNumber(`${r}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const wallboxDemandKWh = wallboxStatus.map(x => {
        if (!x.eligible) return 0;
        const socDemand = x.socValid ? x.energyRequiredKWh : Infinity;
        // The session already subtracts measured charging since the last SoC
        // update. Do not recreate that energy in the future PV baseline.
        return x.priceChargingEnabled && x.priceSessionValid
            ? Math.min(socDemand, Math.max(0, x.priceRemainingKWh) * vehicleEfficiency) : socDemand;
    });
    const wallboxRemainingKWh = wallboxDemandKWh.slice();
    const parallelRelease = readBooleanInput(CFG.dp.dhwParallelRelease);
    const parallelEnabled = Boolean(getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val)
        && parallelRelease === true;
    const parallelSharePct = readNumber(`${r}.Config.DHWParallelShare_pct`, 50);
    const prices = data.prices.total.map(x => x.valid === false ? null : numericValue(x.value_ct_kWh));
    const thermal = createDhwForecastModel(data, prices, planningNow, dhwPresent);
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

    // Pass 1: Alle verschiebbaren Verbraucher ausser der Batterie planen.
    // So kennt die Batterie anschliessend den wirklich noch freien PV-Rest.
    for (let i = 0; i < data.pv.length; i++) {
        const timestamp = data.pv[i].timestamp;
        const pvW = Math.max(0, Number(data.pv[i].valueW) || 0);
        const baseW = Math.max(0, Number(data.house[i].valueW) || 0);
        const price = prices[i] ?? null;
        const priceValid = Number.isFinite(price);
        const slotVehicles = wallboxStatus.map((v, wb) => {
            const planned = v.socValid ? plannedVehicleAtSoc(v, wallboxRemainingKWh[wb], timestamp) : v;
            return {...planned, effectivePriorityScore: plannedVehiclePriorityScore(v, planned)};
        });
        const slotOrder = [...eligibleWallboxes].sort((a, b) =>
            comparePlannedVehicles(slotVehicles[a], slotVehicles[b]));
        const activeWallbox = slotOrder.find(wb => wallboxRemainingKWh[wb] > 1e-9
            && vehicleAvailableAt(wallboxStatus[wb], timestamp)
            && (!wallboxStatus[wb].priceChargingEnabled || !wallboxStatus[wb].priceSessionValid
                || timestamp < wallboxStatus[wb].priceDeadlineTimestamp)) ?? null;
        const activeVehicle = activeWallbox === null ? null : slotVehicles[activeWallbox];
        let activePhases = activeVehicle === null ? 1 : recommendedPlanPhases(activeVehicle,
            Math.max(0, pvW - baseW), wallboxRemainingKWh[activeWallbox], timestamp);
        const priceManagedVehicle = activeVehicle !== null
            && getState(`${r}.Config.Wallbox${activeVehicle.index}PriceChargingEnabled`)?.val === true
            && activeVehicle.priceSessionValid === true;
        const deadlineCharge = activeVehicle !== null && activeVehicle.mustCharge
            && (!priceManagedVehicle || activeVehicle.belowMinimum || activeVehicle.manualMinimumCurrentA > 0)
            && vehicleAvailableAt(activeVehicle, timestamp);
        const departureDeadlineReached = activeVehicle !== null && activeVehicle.deadlineEnabled
            && activeVehicle.departureTimestamp > timestamp
            && timestamp >= activeVehicle.latestStartTimestamp;
        let remainingPvW = Math.max(0, pvW - baseW);
        let dhwW = 0, heatW = 0;
        const wbW = [0, 0, 0];
        const wbPhases = [1, 1, 1];
        if (activeWallbox !== null) wbPhases[activeWallbox] = activePhases;

        dhwNeedKWh = thermal.need();
        const thermalRequest = thermal.gridRequest(i, remainingPvW);
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
        const energyLimitedW = activeWallbox !== null && Number.isFinite(wallboxRemainingKWh[activeWallbox])
            ? wallboxRemainingKWh[activeWallbox] / Math.max(1e-9, priceManagedVehicle
                ? pricePlanHours(timestamp, planningNow) : 0.25) / vehicleEfficiency * 1000
            : (activeVehicle?.maximumPowerW || 0);
        const wallboxCapW = activeVehicle === null ? 0
            : Math.min(activeVehicle.maximumPowerW, energyLimitedW);
        const activeMinimumA = activePhases === 3
            ? activeVehicle?.minCurrent3pA : activeVehicle?.minCurrent1pA;
        const activeMinimumPowerW = activeVehicle === null ? 0
            : Math.max(0, activeMinimumA * 230 * activePhases);
        const minNeedW = !deadlineCharge ? 0 : departureDeadlineReached ? wallboxCapW : activeVehicle.belowMinimum
            ? Math.min(wallboxCapW, (activeVehicle.minimumSocPct - activeVehicle.socPct) / 100
                * activeVehicle.capacityKWh / vehicleEfficiency * 4000)
            : activeMinimumPowerW;
        // Anticipatory reserve may shape the PV split, but never create import
        // or turn sufficient mandatory-heat-plus-WB-minimum PV into a WB stop.
        // Mandatory vehicle demand keeps its PV first as well; reserving more
        // optional heat must not manufacture additional deadline grid demand.
        // A short final charge still requires its full minimum instantaneous
        // power, even when its quarter-hour average is below that minimum.
        const protectedWallboxPvW = activeWallbox === null ? 0 : Math.min(remainingPvW,
            deadlineCharge ? Math.max(activeMinimumPowerW, minNeedW) : activeMinimumPowerW);
        const reserveRefillPvW = Math.min(Math.max(0, dhwCapW - dhwW),
            Math.max(0, thermalRequest.reserveRefillPowerW),
            Math.max(0, remainingPvW - protectedWallboxPvW));
        dhwW += reserveRefillPvW;
        remainingPvW = Math.max(0, remainingPvW - reserveRefillPvW);
        const wallboxPvAvailableW = remainingPvW;
        const thermalAllocation = {mandatoryThermalW, mandatoryThermalPvW, mandatoryThermalGridW,
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
        if (!parallelEnabled || activeVehicle === null || dhwCapW - dhwW <= 0) forecastParallelActive = false;
        else if (forecastParallelActive && remainingPvW < stopThresholdW) forecastParallelActive = false;
        else if (!forecastParallelActive && remainingPvW > startThresholdW) forecastParallelActive = true;

        if (deadlineCharge) {
            // latestStartTimestamp is calculated at maximum charging power;
            // falling back to 6 A here cannot meet that same departure target.
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
        const wallboxPvBudgetW = Math.max(0, pvAfterBaseW - dhwInitialPvW);
        const wallboxRequestedW = wbW.reduce((sum, power) => sum + power, 0);
        const requestedWallboxPvW = Math.min(wallboxPvBudgetW, wallboxRequestedW);
        const pvBeforeQuantizationW = remainingPvW;
        if (activeWallbox !== null && wallboxRequestedW > 0) {
            wbW[activeWallbox] = quantizePlannedWallbox(wallboxRequestedW, activeVehicle, activePhases,
                deadlineCharge || energyLimitedW <= remainingPvW + wallboxRequestedW);
        }
        const wallboxW = wbW.reduce((sum, power) => sum + power, 0);
        const wallboxPvW = Math.min(wallboxPvBudgetW, wallboxW);
        const wallboxGridW = Math.max(0, wallboxW - wallboxPvW);
        // Pflichtladung kann Netzleistung anfordern. Ihre Begrenzung gibt nur
        // tatsaechlich zuvor belegte PV frei, niemals verworfene Netzleistung.
        // Bereits eingeplantes Warmwasser bleibt auch im Parallelbetrieb belegt.
        remainingPvW = Math.max(0, pvW - baseW - dhwW - wallboxW);
        const pvAfterQuantizationW = remainingPvW;

        if (dhwNeedKWh > 0 && remainingPvW > 0) {
            const extraDhwW = Math.min(thermal.maxPowerW - dhwW,
                Math.max(0, dhwNeedKWh * 1000 / Math.max(1e-9, pricePlanHours(timestamp, planningNow)) - dhwW), remainingPvW);
            dhwW += extraDhwW;
            remainingPvW -= extraDhwW;
        }
        const thermalPvW = Math.min(pvAfterBaseW, dhwW);
        const dhwReason = dhwW <= 0 ? 'off' : forcedDhw ? thermalRequest.reason
            : reserveRefillPvW > 0 ? 'pv-reserve-refill'
                : dhwBeforeQuantizationW > 0 ? 'parallel-pv' : 'pv-surplus';
        thermal.advance(i, dhwW, thermalPvW, dhwW <= 0 ? thermalRequest.reason : dhwReason, thermalAllocation);
        dhwNeedKWh = thermal.need();
        if (activeWallbox !== null && Number.isFinite(wallboxRemainingKWh[activeWallbox])) {
            wallboxRemainingKWh[activeWallbox] = Math.max(0,
                wallboxRemainingKWh[activeWallbox] - wbW[activeWallbox]
                    * (priceManagedVehicle ? pricePlanHours(timestamp, planningNow) : 0.25) / 1000 * vehicleEfficiency);
            if (wallboxRemainingKWh[activeWallbox] <= 1e-9) wallboxRemainingKWh[activeWallbox] = 0;
        }

        // Wallboxen werden absichtlich nur nacheinander geplant. Auch bei
        // weiterem Ueberschuss bleibt pro Zeitscheibe genau eine Wallbox aktiv;
        // der naechste Kandidat folgt erst in einer spaeteren Zeitscheibe.

        const pvBeforeHeatingW = remainingPvW;
        if (heatNeedKWh > 0 && (remainingPvW > 0 || (heatTemp < heatMin && priceValid && price <= lowPrice))) {
            const needW = heatNeedKWh * 4000;
            const heatingMaxW = Math.max(0, readNumber(
                `${r}.Config.HeatingControllerMaxPower_W`, CFG.limits.myPvHeatingMaxW));
            heatW = Math.min(heatingMaxW, needW,
                remainingPvW > 0 ? remainingPvW : heatingMaxW);
            heatNeedKWh = Math.max(0, heatNeedKWh - heatW / 4000);
            remainingPvW = Math.max(0, remainingPvW - heatW);
        }

        flexPlan.push({timestamp, offsetMin: i * 15, pvW, baseW, price,
            priceValid, gridLevel: data.prices.grid?.[i]?.level ?? null,
            residualPvW: Math.max(0, remainingPvW), dhwW, heatW, wbW});
        const meta = {timestamp, offsetMin: i * 15};
        const dhwPvW = dhwInitialPvW + (dhwW - dhwBeforeQuantizationW);
        const heatingPvW = Math.min(pvBeforeHeatingW, heatW);
        allocations.push({...meta, price, priceValid, pvW, baseW, pvAfterBaseW, activeWallbox,
            ...thermalAllocation,
            wallboxRequestedW, wallboxW, wallboxPvW, wallboxGridW,
            pvBeforeQuantizationW, pvAfterQuantizationW,
            releasedPvW: Math.max(0, requestedWallboxPvW - wallboxPvW),
            discardedGridRequestW: Math.max(0, wallboxRequestedW - requestedWallboxPvW - wallboxGridW),
            dhwBeforeQuantizationW, dhwW, dhwPvW, dhwGridW: Math.max(0, dhwW - dhwPvW),
            dhwReason,
            heatingW: heatW, heatingPvW, heatingGridW: Math.max(0, heatW - heatingPvW),
            pvBeforeBatteryW: Math.max(0, remainingPvW)});
        dhw.push({...meta, valueW: Math.round(dhwW)});
        heating.push({...meta, valueW: Math.round(heatW)});
        wallboxes.forEach((series, wb) => {
            const minA = wbPhases[wb] === 3 ? slotVehicles[wb].minCurrent3pA : slotVehicles[wb].minCurrent1pA;
            const averageA = wbW[wb] / (230 * wbPhases[wb]);
            const currentA = wbW[wb] > 0 ? Math.max(minA, Math.ceil(averageA)) : 0;
            series.push({...meta, valueW: Math.round(wbW[wb]), phases: wbPhases[wb],
                currentA, chargingMinutes: currentA > 0 ? Math.min(15, 15 * averageA / currentA) : 0,
                conditional: eligibleWallboxes.includes(wb), gridChargeW: 0, priceLimitCt: null,
                priceOptimized: false, priceSessionId: slotVehicles[wb].priceSessionId || '',
                priceChargeUntil: 0, plannedGridEnergyKWh: 0});
        });
        parallel.push({...meta, value: forecastParallelActive ? 1 : 0,
            wallbox: activeWallbox, startW: startThresholdW, stopW: stopThresholdW});
    }

    const priceWallboxReports = addPriceWallboxPlan(flexPlan, wallboxes, allocations, wallboxStatus, vehicleEfficiency, planningNow);

    // Pass 2: Die Batterie so spaet wie moeglich in den verbleibenden
    // PV-Rest legen. Nur wenn die spaeteren sicheren Ladefenster bis zum
    // Stufenziel nicht reichen, wird bereits im aktuellen Slot geladen.
    const forecastSafety = Math.max(0.3, Math.min(1,
        readNumber(`${r}.Config.BatteryForecastSafetyFactor_pct`, 80) / 100));
    const batteryPriceEnabled = batteryPresent && liveSoc !== null
        && getState(`${r}.Config.BatteryPriceChargingEnabled`)?.val === true;
    const priceBattery = batteryPriceEnabled ? buildPriceBatteryPlan(flexPlan, targetPlan, {
        capacity, initialSoc: soc, minSoc, maxSoc,
        gridMaxSoc: Math.max(minSoc, Math.min(maxSoc, readNumber(`${r}.Config.BatteryPriceMaxSoC_pct`, 100))),
        reservePct: Math.max(0, readNumber(`${r}.Config.BatteryPriceReserve_pct`, 10)),
        maxCharge, maxDischarge, efficiency, safety: forecastSafety,
        selfConsumption: selfConsumptionEnabled, now: planningNow}) : null;
    for (let i = 0; i < flexPlan.length; i++) {
        const slot = flexPlan[i];
        const targetSoc = targetPlan[i].targetPct;
        const deadline = Math.min(flexPlan.length - 1,
            Math.max(i, Number(targetPlan[i].deadlineIndex) || i));
        const needStoredKWh = Math.max(0, (targetSoc - soc) / 100 * capacity);
        let safeFutureStoredKWh = 0;
        for (let j = i + 1; j <= deadline; j++) {
            safeFutureStoredKWh += Math.min(maxCharge,
                flexPlan[j].residualPvW * forecastSafety) * 0.25 / 1000 * efficiency;
        }

        let batteryW = 0;
        const shortfallStoredKWh = Math.max(0, needStoredKWh - safeFutureStoredKWh);
        if (shortfallStoredKWh > 0 && slot.residualPvW > 0) {
            const requiredNowW = shortfallStoredKWh / efficiency * 1000 / 0.25;
            batteryW = Math.min(maxCharge, slot.residualPvW, requiredNowW);
        } else if (slot.baseW > slot.pvW && soc > minSoc && (
            (selfConsumptionEnabled && (!spreadOk || !slot.priceValid)) || (slot.priceValid && spreadOk && slot.price >= highPrice)
        )) {
            const availableW = Math.max(0, (soc - minSoc) / 100 * capacity * 4000 * efficiency);
            batteryW = -Math.min(maxDischarge, slot.baseW - slot.pvW, availableW);
        }

        if (priceBattery) {
            batteryW = priceBattery.slots[i].valueW;
            soc = priceBattery.slots[i].socPct;
        } else {
            soc += batteryW >= 0
                ? batteryW * 0.25 / 1000 * efficiency / capacity * 100
                : batteryW * 0.25 / 1000 / efficiency / capacity * 100;
            soc = Math.max(minSoc, Math.min(maxSoc, soc));
        }

        const boostBudgetW = Math.max(0, slot.residualPvW - Math.max(0, batteryW));
        const rawGridW = slot.baseW + slot.dhwW + slot.heatW
            + slot.wbW.reduce((a, b) => a + b, 0) + batteryW - slot.pvW;
        // Der veroeffentlichte Netzplan bilanziert dieselben ganzzahligen Watt
        // wie die Geraeteplaene. Interne Geraeteenergie-/SoC-Rechnung bleibt ungerundet.
        const gridW = Math.round(slot.baseW) + Math.round(slot.dhwW) + Math.round(slot.heatW)
            + slot.wbW.reduce((sum, power) => sum + Math.round(power), 0)
            + Math.round(batteryW) - Math.round(slot.pvW);
        const batteryPvW = Math.min(Math.max(0, batteryW), slot.residualPvW);
        Object.assign(allocations[i], {batteryW, batteryPvW,
            batteryGridChargeW: Math.max(0, batteryW) - batteryPvW,
            remainingPvW: boostBudgetW, rawGridW, gridW});
        const accountingHours = pricePlanHours(slot.timestamp, planningNow);
        importWh += Math.max(0, gridW) * accountingHours;
        exportWh += Math.max(0, -gridW) * accountingHours;
        const meta = {timestamp: slot.timestamp, offsetMin: slot.offsetMin};
        const pricePoint = priceBattery?.slots[i];
        battery.push({...meta, valueW: Math.round(batteryW),
            gridChargeW: pricePoint?.gridChargeW || 0,
            priceLimitCt: pricePoint?.priceLimitCt ?? null,
            priceOptimized: Boolean(pricePoint),
            plannedGridEnergyKWh: pricePoint?.plannedGridEnergyKWh || 0,
            dischargeFloorPct: pricePoint?.dischargeFloorPct ?? minSoc,
            targetSoCPct: pricePoint?.targetSoCPct ?? maxSoc,
            energyReason: pricePoint?.energyReason ?? (batteryW > 0 ? 'PV' : batteryW < 0 ? 'Eigenverbrauch' : 'Halten'),
            pvHeadroomKWh: pricePoint?.pvHeadroomKWh ?? Math.max(0, (maxSoc - soc) / 100 * capacity),
            priceReason: pricePoint?.priceReason || 'price-charging-disabled'});
        batterySoc.push({...meta, value_pct: Math.round(soc * 10) / 10});
        batteryTarget.push({...meta, value_pct: targetSoc});
        batteryStage.push({...meta, stage: targetPlan[i].stage, target_pct: targetSoc});
        boost.push({...meta, release: boostBudgetW >= CFG.limits.pvBoostMinExpectedW,
            budgetW: Math.round(Math.max(0, boostBudgetW))});
        grid.push({...meta, valueW: gridW});
    }

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
        battery: priceBattery?.report || {enabled: false, reason: !batteryPresent ? 'not-present'
            : liveSoc === null ? 'live-soc-unavailable' : 'disabled'}}));
    write(`${r}.Plan.BatteryGridChargingEnergy_kWh`, priceBattery?.report.gridKWh ?? 0);
    write(`${r}.Plan.BatteryGridChargingTargetSoC_pct`, priceBattery?.report.chargeWindows.length
        ? Math.max(...priceBattery.report.chargeWindows.map(window => window.targetSoCPct)) : null);
    write(`${r}.Plan.BatteryPriceSavings_EUR`, priceBattery?.report.expectedSavingsEUR ?? null);
    write(`${r}.Plan.BatteryReservedPvCapacity_kWh`, priceBattery?.report.reservedPvCapacityKWh ?? null);
    write(`${r}.Plan.BatteryPriceChargingWindows_JSON`, JSON.stringify(priceBattery?.report.chargeWindows ?? []));
    write(`${r}.Plan.PriceChargingStatus`, `Preisladung: Batterie ${priceBattery ? priceBattery.report.gridKWh.toFixed(3) + ' kWh' : 'aus'}; Wallboxen ${priceWallboxReports.reduce((sum, x) => sum + x.gridKWh, 0).toFixed(3)} kWh; gueltige Preisbloecke erforderlich`);
    write(`${r}.Plan.Valid`, true);
    write(`${r}.Plan.Status`, `48 h berechnet; angeschlossen: ${connected.length ? connected.join(', ') : 'keine'}; Ladebedarf: ${eligibleWallboxes.length ? eligibleWallboxes.join(', ') : 'keiner'}; Preisintervalle gueltig: ${prices.filter(Number.isFinite).length}/${data.pv.length}`);
    write(`${r}.Plan.LastUpdate`, Date.now());

    const importKWh = importWh / 1000;
    const exportKWh = exportWh / 1000;
    const maxPlannedChargeW = battery.reduce((max, x) => Math.max(max, x.valueW), 0);
    const maxPlannedDischargeW = battery.reduce((max, x) => Math.max(max, -x.valueW), 0);
    const atMinHours = batterySoc.filter(x => x.value_pct <= minSoc + 0.1).length * 0.25;
    const atTargetHours = batterySoc.filter((x, i) => x.value_pct >= batteryTarget[i].value_pct - 0.1).length * 0.25;
    const additionalShiftKWh = Math.min(importKWh, exportKWh * efficiency);
    const capacityHint = atMinHours >= 1 && exportKWh > 0.5
        ? 'Kapazitaet koennte zu klein sein: Mindest-SoC erreicht und spaeter/zusätzlich PV-Export vorhanden.'
        : 'Im 48-h-Plan kein eindeutiger Hinweis auf zu geringe Kapazitaet.';
    const powerHint = maxPlannedChargeW >= maxCharge * 0.98 || maxPlannedDischargeW >= maxDischarge * 0.98
        ? ' Die Leistungsgrenze von 2,4 kW wird erreicht; hoehere Leistung separat pruefen.'
        : ' Die Leistungsgrenze wird im Plan nicht erreicht.';
    write(`${r}.Evaluation.BatteryMaxPlannedCharge_W`, maxPlannedChargeW);
    write(`${r}.Evaluation.BatteryMaxPlannedDischarge_W`, maxPlannedDischargeW);
    write(`${r}.Evaluation.BatteryAtMinSoC_h`, Math.round(atMinHours * 100) / 100);
    write(`${r}.Evaluation.BatteryAtTargetSoC_h`, Math.round(atTargetHours * 100) / 100);
    write(`${r}.Evaluation.RemainingGridImport_kWh`, Math.round(importKWh * 100) / 100);
    write(`${r}.Evaluation.RemainingPVExport_kWh`, Math.round(exportKWh * 100) / 100);
    write(`${r}.Evaluation.AdditionalShiftPotential_kWh`, Math.round(additionalShiftKWh * 100) / 100);
    write(`${r}.Evaluation.BatterySizingHint`, capacityHint + powerHint);
}
