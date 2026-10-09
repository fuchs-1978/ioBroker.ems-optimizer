/*
 * Simulierter Controller fuer my-PV Trinkwasser.
 * Die Grenzwerte entsprechen dem aktiven EHZ-Leistung-V2-Skript.
 * Es werden ausschliesslich EMS-Ziel- und Diagnosestates beschrieben.
 */

'use strict';

let dhwTemperatureLock = null;
let dhwLastSimulatedTargetW = 0;
let dhwTemperatureDiagnosticSnapshot = null;
let dhwTemperatureDiagnosticSignature = '';

function dhwTemperatureConfiguration() {
    const setting = (name, fallback) => {
        const state = getState(`${CFG.root}.Config.${name}`);
        if (!state) return fallback;
        const value = state.val;
        return ['number', 'string'].includes(typeof value)
            && !(typeof value === 'string' && !value.trim()) ? Number(value) : NaN;
    };
    const config = {
        stop: setting('DHWControllerStopTemperature_C', 76),
        resume: setting('DHWControllerResumeTemperature_C', 75.5),
        emergency: setting('DHWControllerTopEmergencyStop_C', 82),
        derating: setting('DHWControllerOutletDerating_C', 60),
        protection: setting('DHWControllerOutletProtection_C', 76),
        minimum: setting('DHWMinTemperature_C', 48)
    };
    config.valid = Object.values(config).every(value => Number.isFinite(value) && value >= 0 && value <= 100)
        && config.resume < config.stop && config.stop <= config.emergency
        && config.derating < config.protection;
    return config;
}

function freshDhwNumber(id, maxAgeMs = 60 * 60 * 1000) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    if (!state || state.val === null || state.val === undefined
        || !['number', 'string'].includes(typeof state.val)
        || (typeof state.val === 'string' && !state.val.trim())
        || state.ack === false || (state.q !== undefined && Number(state.q) !== 0)) return null;
    const value = Number(state?.val);
    const ageMs = Date.now() - Number(state.ts || 0);
    return Number.isFinite(value) && Number(state.ts) > 0 && ageMs >= 0 && ageMs <= maxAgeMs
        ? value : null;
}

// Keep this temperature-specific plausibility check separate from
// freshDhwNumber, which also reads electrical power and current measurements.
function dhwTemperatureSource(id, name, maxAgeMs, now) {
    const state = id && existsState(id) ? getState(id) : null;
    const finiteTimestamp = value => Number.isFinite(Number(value)) && Number(value) > 0
        ? Number(value) : null;
    const ts = finiteTimestamp(state?.ts);
    const rawValue = typeof state?.val === 'number' && Number.isFinite(state.val) ? state.val
        : typeof state?.val === 'string' ? state.val.slice(0, 120)
            : typeof state?.val === 'boolean' ? state.val : null;
    const source = {id: id || '', name, rawValue, valueC: null, valid: false,
        status: '', reason: '', ts, lc: finiteTimestamp(state?.lc),
        ageMs: ts === null ? null : now - ts, maxAgeMs,
        ack: typeof state?.ack === 'boolean' ? state.ack : null,
        q: state?.q === undefined ? null : Number.isFinite(Number(state.q)) ? Number(state.q) : null};
    const fail = (status, reason) => Object.assign(source, {status, reason});
    if (!id) return fail('unconfigured', 'nicht konfiguriert');
    if (!state) return fail('missing_state', 'Objekt oder Zustand fehlt');
    if (state.val === null || state.val === undefined) return fail('missing_value', 'Wert fehlt');
    if (!['number', 'string'].includes(typeof state.val)
        || (typeof state.val === 'string' && !state.val.trim())
        || !Number.isFinite(Number(state.val))) return fail('invalid_value', 'kein gueltiger Zahlenwert');
    if (state.ack === false) return fail('unconfirmed', 'nicht bestaetigt (ACK=false)');
    if (state.q !== undefined && Number(state.q) !== 0)
        return fail('bad_quality', `ungueltige Qualitaet (q=${String(state.q).slice(0, 30)})`);
    if (ts === null) return fail('invalid_timestamp', 'Zeitstempel fehlt oder ungueltig');
    if (source.ageMs < 0) return fail('future_timestamp', 'Zeitstempel liegt in der Zukunft');
    if (source.ageMs > maxAgeMs) return fail('stale', 'veraltet');
    const valueC = Number(state.val);
    if (valueC < 0 || valueC > 100) return fail('out_of_range', 'unplausibel (0–100 °C)');
    return Object.assign(source, {valueC, valid: true, status: 'valid', reason: 'gueltig'});
}

function publishDhwTemperatureDiagnostics(sources, now) {
    // Age alone must not create a new JSON SQL row on every regulator tick.
    // A real source report or quality/validity transition remains immediate.
    const signature = JSON.stringify(sources.map(({ageMs, ...source}) => source));
    if (!dhwTemperatureDiagnosticSnapshot || signature !== dhwTemperatureDiagnosticSignature
        || now - dhwTemperatureDiagnosticSnapshot.evaluatedAt >= 60000
        || now < dhwTemperatureDiagnosticSnapshot.evaluatedAt) {
        dhwTemperatureDiagnosticSignature = signature;
        dhwTemperatureDiagnosticSnapshot = {evaluatedAt: now, sources};
        write(`${CFG.root}.Devices.MyPV_DHW.TemperatureSources_JSON`,
            JSON.stringify(dhwTemperatureDiagnosticSnapshot));
    }
    return dhwTemperatureDiagnosticSnapshot;
}

function evaluateDhwSimulation() {
    const r = `${CFG.root}.Devices.MyPV_DHW`;
    const now = Date.now();
    const tankMaxAgeMs = Math.max(5, readNumber(
        `${CFG.root}.Config.DHWTemperatureMaxAge_min`, 60)) * 60 * 1000;
    const tankNames = ['Speicher unten', 'Speicher Mitte unten', 'Speicher Mitte oben', 'Speicher oben'];
    const tankSources = tankNames.map((name, index) =>
        dhwTemperatureSource(CFG.dp.dhwTemps[index], name, tankMaxAgeMs, now));
    const outletSource = dhwTemperatureSource(CFG.dp.myPvDhwOutletTemp,
        'AC-THOR Ausgang', 2 * 60 * 1000, now);
    const diagnosticSnapshot = publishDhwTemperatureDiagnostics([...tankSources, outletSource], now);
    const temperatures = tankSources.map(source => source.valueC);
    const outletTemperature = outletSource.valueC;
    const connectionState = CFG.dp.myPvDhwConnection && existsState(CFG.dp.myPvDhwConnection)
        ? getState(CFG.dp.myPvDhwConnection) : null;
    const available = Boolean(getState(`${CFG.root}.Devices.MyPV_DHW.Present`)?.val)
        && [true, 1, '1'].includes(connectionState?.val)
        && connectionState.ack !== false
        && (connectionState.q === undefined || Number(connectionState.q) === 0);
    const existingRelease = Boolean(getState(CFG.dp.myPvDhwRelease)?.val);
    const tankValid = CFG.dp.dhwTemps.length === 4 && tankSources.every(source => source.valid);
    const valid = tankValid && outletSource.valid;
    const [bottom, middleLower, middleUpper, top] = temperatures;
    const average = tankValid ? temperatures.reduce((sumC, valueC) => sumC + valueC, 0) / 4 : null;
    const maxPower = Math.max(0, Math.min(CFG.limits.myPvDhwMaxW,
        readNumber(`${CFG.root}.Config.DHWControllerMaxPower_W`, 9000)));
    const temperatureConfig = dhwTemperatureConfiguration();
    const {stop: stopTemperature, resume: resumeTemperature, emergency: topEmergencyStop,
        derating: outletDerating, protection: outletProtection, minimum: minimumTemperature} = temperatureConfig;

    if (dhwTemperatureLock === null) {
        dhwTemperatureLock = Boolean(getState(CFG.dp.myPvDhwHysteresis)?.val);
    }
    const hottestTemperature = valid ? Math.max(...temperatures) : Infinity;
    if (!temperatureConfig.valid || !valid
        || bottom >= stopTemperature || hottestTemperature >= topEmergencyStop) dhwTemperatureLock = true;
    else if (bottom <= resumeTemperature) dhwTemperatureLock = false;

    let temperaturePowerLimitW = maxPower;
    let reason = 'Bis 9 kW temperaturseitig verfuegbar';
    if (!available) {
        temperaturePowerLimitW = 0;
        reason = 'my-PV-Verbindung nicht verfuegbar';
    } else if (!valid) {
        temperaturePowerLimitW = 0;
        const failures = diagnosticSnapshot.sources.filter(source => !source.valid).map(source => {
            const age = source.status === 'stale'
                ? ` (Alter ${Math.floor(source.ageMs / 1000)} s; maximal ${Math.floor(source.maxAgeMs / 1000)} s)` : '';
            return `${source.name} [${source.id || 'keine Quelle'}]: ${source.reason}${age}`;
        });
        reason = `Temperaturwert ungueltig: ${failures.join('; ') || 'genau vier Speichertemperaturen erforderlich'}`;
    } else if (!temperatureConfig.valid) {
        temperaturePowerLimitW = 0;
        reason = 'Temperaturkonfiguration ungueltig: Wiederanlauf < Abschaltung <= Notabschaltung; Kennlinienbeginn < Leitungsschutz; 0–100 °C';
    } else if (dhwTemperatureLock) {
        temperaturePowerLimitW = 0;
        reason = `Temperatur-Hysterese aktiv (unten ${bottom.toFixed(1)} °C, oben ${top.toFixed(1)} °C)`;
    } else if (outletTemperature >= outletProtection) {
        temperaturePowerLimitW = Math.min(3000, maxPower);
        reason = `Leitungsschutz: Ausgang ${outletTemperature.toFixed(1)} °C`;
    } else if (outletTemperature > outletDerating) {
        const t1 = readNumber(`${CFG.root}.Config.DHWCurve1Temperature_C`, 70);
        const t2 = readNumber(`${CFG.root}.Config.DHWCurve2Temperature_C`, 71);
        const t3 = readNumber(`${CFG.root}.Config.DHWCurve3Temperature_C`, 73);
        const t4 = readNumber(`${CFG.root}.Config.DHWCurve4Temperature_C`, 74);
        if (bottom >= t4) temperaturePowerLimitW = Math.min(
            readNumber(`${CFG.root}.Config.DHWCurve74Power_W`, 3000), maxPower);
        else if (bottom >= t3) temperaturePowerLimitW = Math.min(
            readNumber(`${CFG.root}.Config.DHWCurve73Power_W`, 4000), maxPower);
        else if (bottom >= t2) temperaturePowerLimitW = Math.min(
            readNumber(`${CFG.root}.Config.DHWCurve71Power_W`, 6000), maxPower);
        else if (bottom >= t1) temperaturePowerLimitW = Math.min(
            readNumber(`${CFG.root}.Config.DHWCurve70Power_W`, 7500), maxPower);
        if (temperaturePowerLimitW < maxPower) {
            reason = `Temperaturkennlinie: unten ${bottom.toFixed(1)} °C, Ausgang ${outletTemperature.toFixed(1)} °C`;
        }
    }

    const mustHeat = valid && temperatureConfig.valid && middleLower < minimumTemperature;
    const release = available && valid && temperaturePowerLimitW > 0;
    const remainingCapacityKWh = valid && temperatureConfig.valid
        ? Math.max(0, readNumber(`${CFG.root}.Config.DHWVolume_l`, 500)
            * 1.163 * (stopTemperature - average) / 1000)
        : null;
    const actualPowerW = readNumber(`${CFG.root}.Actual.MyPV_DHW_W`, 0);
    const planItem = typeof currentPlanItem === 'function'
        ? currentPlanItem('MyPV_DHW', Date.now()) : null;
    const plannedPowerW = Math.max(0, Number(planItem?.valueW) || 0);

    write(`${r}.Available`, available);
    write(`${r}.ExistingRelease`, existingRelease);
    write(`${r}.Release`, release);
    write(`${r}.MustHeat`, mustHeat);
    write(`${r}.TemperatureValid`, valid);
    const roundKnown = (value, factor) => value === null ? null : Math.round(value * factor) / factor;
    write(`${r}.BottomTemperature_C`, roundKnown(bottom, 10));
    write(`${r}.MiddleLowerTemperature_C`, roundKnown(middleLower, 10));
    write(`${r}.MiddleUpperTemperature_C`, roundKnown(middleUpper, 10));
    write(`${r}.TopTemperature_C`, roundKnown(top, 10));
    write(`${r}.AverageTemperature_C`, roundKnown(average, 10));
    write(`${r}.OutletTemperature_C`, roundKnown(outletTemperature, 10));
    write(`${r}.RemainingCapacity_kWh`, roundKnown(remainingCapacityKWh, 100));
    write(`${r}.ActualPower_W`, Math.round(actualPowerW));
    write(`${r}.PlannedPower_W`, Math.round(plannedPowerW));
    write(`${r}.TemperaturePowerLimit_W`, Math.round(temperaturePowerLimitW));
    write(`${r}.TemperatureLock`, Boolean(dhwTemperatureLock));
    const outputMode = nativeConfig.globalWriteEnabled === true
        && getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === true
        ? 'Produktivfreigabe EIN; Ausgangsstatus separat pruefen' : 'nur Simulation';
    write(`${r}.Status`, `${mustHeat ? 'Pflichtwaermebedarf; ' : ''}${reason}; ${outputMode}`);

    return {available, valid, release, mustHeat, bottom, top, outletTemperature,
        temperaturePowerLimitW, remainingCapacityKWh, reason};
}

function simulateDhwTarget(requestedPowerW) {
    const r = `${CFG.root}.Devices.MyPV_DHW`;
    const status = evaluateDhwSimulation();
    let targetW = status.release
        ? Math.max(0, Math.min(Number(requestedPowerW) || 0, status.temperaturePowerLimitW))
        : 0;

    // Schichtungslogik aus dem Bestandsskript: sehr kleine Leistung bei stark
    // geschichtetem Speicher vermeiden.
    if (status.valid && status.top - status.bottom > 15 && targetW < 900) targetW = 0;
    else if (status.valid && status.top > 35 && targetW < 500) targetW = 0;

    // The productive output owns the physical ramp and waits for the measured
    // AC THOR response. Ramping its allocation too would introduce a second
    // slow ramp and keep power reserved after a wallbox needs it. The observer
    // may still illustrate a gradual increase, but reductions are always caps.
    const maximumIncreaseStepW = Math.max(100,
        readNumber(`${CFG.root}.Config.DHWMaxStep_W`, 1000),
        readNumber(`${CFG.root}.Config.DHWFastIncreaseMaxStep_W`, 3000));
    if (!Boolean(getState(`${CFG.root}.System.RealOutputsEnabled`)?.val)) {
        targetW = Math.min(dhwLastSimulatedTargetW + maximumIncreaseStepW, targetW);
    }
    targetW = Math.max(0, Math.min(status.temperaturePowerLimitW,
        Math.floor(targetW / 100) * 100));
    dhwLastSimulatedTargetW = targetW;
    write(`${r}.SimulatedTargetPower_W`, targetW);
    return targetW;
}

function updateDhwSimulation() {
    evaluateDhwSimulation();
}
