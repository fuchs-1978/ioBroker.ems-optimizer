'use strict';

const quarter = 900000;
const month = 30 * 86400000;
const reserveMarginPct = 5;
const berlinDate = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit'});

const berlinHour = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23'});

function completeForecast(data, now) {
    const start = Math.floor(now / quarter) * quarter;
    return data.pv?.length === 192 && data.house?.length === 192 && data.pv.every((p, i) =>
        p.timestamp === start + i * quarter && data.house[i].timestamp === p.timestamp
        && Number.isFinite(p.valueW) && p.valueW >= 0 && (p.source !== 'unavailable' || p.valueW === 0)
        && Number.isFinite(data.house[i].valueW) && data.house[i].valueW >= 0);
}

function safeSolarW(slot, safety, maxCharge, reschedule = false) {
    const loads = reschedule ? slot.mandatoryThermalW : slot.dhwW + slot.heatingW + slot.wallboxW;
    return Math.min(maxCharge, Math.max(0, slot.pvW * safety - slot.baseW - loads));
}

function hours(at, now, until = Infinity) {
    return Math.max(0, Math.min(until, at + quarter) - Math.max(at, now)) / 3600000;
}

// Start at no more than the proposed ceiling even when today's measured battery
// is fuller. A sunny transition day cannot borrow that extra energy every night.
function overnightReserve(slots, trajectory, options) {
    const {initialSoc, ceiling, minSoc, capacity, maxCharge, maxDischarge, efficiency, safety, now} = options;
    let soc = Math.min(initialSoc, ceiling), lowest = ceiling, reached = false;
    let darkHours = 0, refillPct = 0, nextSun = false;
    for (const [i, slot] of slots.entries()) {
        const dt = hours(slot.timestamp, now);
        const solar = safeSolarW(slot, safety, maxCharge);
        const discharge = Math.min(maxDischarge, Math.max(0, slot.baseW - slot.pvW * safety));
        const gain = solar * efficiency * dt / (capacity * 10);
        soc = Math.min(ceiling, soc + gain - discharge * dt / (capacity * 10 * efficiency));
        if (!reached && solar >= 200 && soc >= ceiling - 0.1) reached = true;
        if (!reached) continue;
        lowest = Math.min(lowest, soc, trajectory[i].soc);
        if (solar < 200) {
            if (refillPct > 0) darkHours = 0;
            darkHours += dt;
            refillPct = 0;
        } else {
            if (darkHours >= 4) {
                refillPct += gain;
                if (refillPct >= 5) nextSun = true;
            } else darkHours = 0;
        }
    }
    return {valid: reached && nextSun && lowest >= minSoc + reserveMarginPct,
        lowestPct: lowest, supportFloorPct: Math.ceil(minSoc + reserveMarginPct + ceiling - lowest - 1e-8)};
}

function service(slots, wallboxes, vehicles, now) {
    const delivered = (series, until) => series.reduce((sum, point) => {
        const beforeEnd = point.chargingUntil === until && Number.isFinite(point.beforeDepartureW);
        return sum + hours(point.timestamp, now, until) * (beforeEnd ? point.beforeDepartureW : point.valueW);
    }, 0);
    return [...wallboxes.map(series => delivered(series, Infinity)),
        ...wallboxes.map((series, i) => delivered(series, vehicles[i].departureTimestamp > now
            ? vehicles[i].departureTimestamp : Infinity)),
        slots.reduce((sum, slot) => sum + hours(slot.timestamp, now) * slot.mandatoryThermalW, 0)];
}

function comparable(reference, candidate, capacity, efficiency) {
    // A lower final inventory explains a one-time increase in export at the
    // transition. Repeated export or extra grid purchases do not earn that credit.
    const inventoryWh = Math.max(0, reference.endSoc - candidate.endSoc) * capacity * 10 / efficiency;
    return candidate.importWh <= reference.importWh + 10
        && candidate.exportWh <= reference.exportWh + inventoryWh + 10
        && candidate.service.every((wh, i) => wh + 10 >= reference.service[i]);
}

// Work backwards through each continuous run of usable PV. Keep the last
// feasible start per solar day, including one quarter for the end of charge.
function calibrationWindow(slots, trajectory, options, reschedule = false) {
    const {now, lastFull, initialSoc, capacity, maxCharge, efficiency, safety} = options;
    const due = lastFull > 0 ? lastFull + month : now;
    if (!slots.length || due > slots.at(-1).timestamp + quarter) return null;
    // Replanning inside the reserved final quarter must not cancel an almost
    // finished top charge just because there is no second taper quarter left.
    const active = options.active;
    if (active && Number.isSafeInteger(active.start) && Number.isSafeInteger(active.end)
        && active.start <= now && now < active.end && now - active.start < 24 * 3600000
        && active.end <= now + 24 * 3600000 && active.end >= due && lastFull < active.start) {
        const remainingWh = slots.filter(slot => slot.timestamp < active.end).reduce((sum, slot) =>
            sum + safeSolarW(slot, safety, maxCharge, reschedule) * hours(slot.timestamp, now, active.end) * efficiency, 0);
        if (remainingWh > 0 && remainingWh + 1e-6 >= (100 - initialSoc) * capacity * 10)
            return {start: active.start, end: active.end, day: berlinDate.format(active.end - 1)};
    }
    let firstDay = null, best = null, runStart = 0;
    for (let i = 0; i <= slots.length; i++) {
        const day = i < slots.length ? berlinDate.format(slots[i].timestamp) : null;
        const usable = i < slots.length && safeSolarW(slots[i], safety, maxCharge, reschedule) >= 200;
        if (usable && (i === runStart || day === berlinDate.format(slots[i - 1].timestamp))) continue;
        const last = i - 1;
        // A forecast cut off during sunshine cannot identify the end of the PV window.
        if (i < slots.length && last > runStart) {
            const end = slots[last].timestamp + quarter;
            const runDay = berlinDate.format(slots[last].timestamp);
            if (best && runDay !== firstDay) return best;
            let availableWh = 0;
            const lateEnough = Number(berlinHour.format(end)) >= 14 || berlinDate.format(end) !== runDay;
            for (let j = last - 1; j >= runStart && end >= due && lateEnough; j--) {
                availableWh += safeSolarW(slots[j], safety, maxCharge, reschedule) * hours(slots[j].timestamp, now) * efficiency;
                const start = Math.max(now, slots[j].timestamp);
                const soc = j > 0 ? trajectory[j - 1].soc : initialSoc;
                if (availableWh + 1e-6 < (100 - soc) * capacity * 10 || soc >= 100) continue;
                best = {start, end, day: runDay};
                firstDay = runDay;
                break;
            }
        }
        runStart = usable ? i : i + 1;
    }
    return best;
}

module.exports = {completeForecast, overnightReserve, service, comparable, calibrationWindow, month};
