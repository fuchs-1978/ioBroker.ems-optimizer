'use strict';

let phaseTest = null;
let phaseTestLoaded = false;

function phaseTestActive() {
    return phaseTest && !['complete', 'failed'].includes(phaseTest.stage);
}

function phaseTestBatteryTarget() {
    if (!phaseTestActive()) return null;
    return phaseTest.kind === 'battery' && ['ramp', 'measure'].includes(phaseTest.stage) ? 1000 : 0;
}

function phaseTestWallboxCurrent(wb) {
    if (!phaseTestActive() || phaseTest.kind !== 'wallbox' || phaseTest.index !== wb) return null;
    return ['ramp', 'measure'].includes(phaseTest.stage) ? 16 : phaseTest.previousCurrentA;
}

function phaseTestBase(test = phaseTest) {
    return test.kind === 'battery' ? `${CFG.root}.Devices.Battery.Heads.${test.index}`
        : `${CFG.root}.Devices.Wallbox${test.index}`;
}

function publishPhaseTest() {
    const report = phaseTest || {stage: 'idle', status: 'Kein Phasentest gestartet'};
    write(`${CFG.root}.Control.PhaseTest_JSON`, JSON.stringify(report));
    write(`${CFG.root}.Control.PhaseTestStatus`, report.status);
    if (phaseTest) {
        write(`${phaseTestBase()}.PhaseTest_JSON`, JSON.stringify(report));
        write(`${phaseTestBase()}.PhaseTestStatus`, report.status);
    }
}

function phaseTestReadings() {
    const now = Date.now(), reads = [];
    for (let p = 0; p < 3; p++) {
        if (!CFG.dp.haPhaseImportW?.[p] || !CFG.dp.haPhaseExportW?.[p]) return null;
        const imp = getState(CFG.dp.haPhaseImportW?.[p]);
        const exp = getState(CFG.dp.haPhaseExportW?.[p]);
        for (const state of [imp, exp]) {
            if (!state || state.ack !== true || state.q || typeof state.val !== 'number'
                || !Number.isFinite(state.val) || state.val < 0 || !(state.ts > 0)
                || now < state.ts || now - state.ts > SMA_GRID_MAX_AGE_MS) return null;
        }
        reads.push({watts: imp.val - exp.val, at: Math.min(imp.ts, exp.ts),
            latest: Math.max(imp.ts, exp.ts)});
    }
    if (Math.max(...reads.map(r => r.latest)) - Math.min(...reads.map(r => r.at)) > 2000) return null;
    return {at: Math.min(...reads.map(r => r.at)), phasesW: reads.map(r => r.watts)};
}

function phaseTestDevicePower() {
    if (phaseTest.kind === 'battery') {
        const snapshot = batteryHeadsSnapshot();
        const head = snapshot.heads.find(h => h.index === phaseTest.index);
        if (!snapshot.valid || !head?.valid) return null;
        return {watts: head.acPowerW, at: head.sourceTs, setpoint: -head.gsW,
            idle: snapshot.heads.every(h => h.gsW === 0 && Math.abs(h.acPowerW) <= 30)
                && !batteryHeadOwners.some(h => h.owned)};
    }
    const wb = phaseTest.index, age = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
    const power = getState(CFG.dp.wallboxesKW[wb]);
    const amps = CFG.dp.wallboxPhaseCurrents[wb].map(id => freshDhwNumber(id, age));
    const topology = vehiclePhaseControl(wb);
    const fixedOnePhase = getState(`${CFG.root}.Vehicles.Wallbox${wb}.PhaseSwitchEnabled`)?.val !== true
        && Number(nativeConfig[`wb${wb}ProductionPhases`] ?? 1) === 1;
    if (!power || power.ack !== true || power.q || nowInvalid(power.ts, age)
        || !Number.isFinite(power.val) || amps.some(a => a === null || a < 0)
        || !(topology.confirmedPhases === 1 || fixedOnePhase)
        || amps[1] > 0.5 || amps[2] > 0.5
        || getState(`${CFG.root}.Devices.Wallbox${wb}.PhaseSwitchPending`)?.val === true) return null;
    return {watts: power.val * 1000, at: power.ts, amps: Math.max(...amps),
        setpoint: readNumber(`${CFG.root}.Devices.Wallbox${wb}.OutputCommand_A`, 0),
        idle: phaseTestStorageIdle()};
}

function phaseTestStorageIdle() {
    if (getState(`${CFG.root}.Devices.Battery.Present`)?.val !== true) return true;
    if (!batteryHeadsMode()) {
        const power = batteryMeasuredPowerW();
        return power !== null && Math.abs(power) <= 30 && !batteryOutputOwned;
    }
    const snapshot = batteryHeadsSnapshot();
    return snapshot.valid && snapshot.heads.every(head => head.gsW === 0 && Math.abs(head.acPowerW) <= 30)
        && !batteryHeadOwners.some(head => head.owned);
}

function nowInvalid(at, age) {
    return !Number.isFinite(at) || at <= 0 || Date.now() < at || Date.now() - at > age;
}

function phaseTestPeers() {
    const peers = [];
    for (let wb = 0; wb < 3; wb++) {
        if (phaseTest.kind === 'wallbox' && wb === phaseTest.index) continue;
        if (getState(`${CFG.root}.Devices.Wallbox${wb}.Present`)?.val !== true) continue;
        const power = coordinatedWallboxPowerKW(CFG.dp.wallboxesKW[wb], 30000);
        if (power === null) return null;
        peers.push(power * 1000);
    }
    const dhw = getState(`${CFG.root}.Devices.MyPV_DHW.Present`)?.val === true
        ? (CFG.dp.myPvDhwOutputW || []).map(id => freshDhwNumber(id, 120000)) : [];
    if (dhw.some(x => x === null)) return null;
    peers.push(dhw.reduce((sum, w) => sum + w, 0));
    if (CFG.dp.bhkwPower) {
        const value = freshDhwNumber(CFG.dp.bhkwPower, 120000);
        if (value === null) return null;
        peers.push(value);
    }
    return peers;
}

function phaseTestGuard() {
    if (nativeConfig.globalWriteEnabled !== true || nativeConfig.controlEnabled === false
        || getState(`${CFG.root}.System.RealOutputsEnabled`)?.val !== true
        || getState(`${CFG.root}.System.DataValid`)?.val !== true
        || getState(`${CFG.root}.Control.Valid`)?.val !== true) return 'EMS-Freigabe oder gueltige Messwerte fehlen';
    const limit = currentConsumptionLimit();
    if (!limit.valid) return limit.reason || 'Netzbudget ungueltig';
    const device = phaseTestDevicePower();
    if (!device) return 'Geraetetelemetrie oder einphasige Rueckmeldung fehlt';
    const incrementA = phaseTest.kind === 'battery' ? Math.max(0, (1000 - device.watts) / 230)
        : Math.max(0, 16 - device.amps);
    for (const id of CFG.dp.myPvDhwHaCurrentA || []) {
        const amps = freshDhwNumber(id, SMA_GRID_MAX_AGE_MS);
        const maximumA = readNumber(`${CFG.root}.Config.HouseConnectionWorkingLimit_A`, 46);
        if (amps === null || amps + incrementA > maximumA) return 'Zu wenig Phasenreserve fuer den Test';
    }
    if (phaseTest.kind === 'battery') {
        const state = batteryHeadsRegulationState();
        if (!state.eligible && !(phaseTest.stage === 'baseline' && state.reason === 'Kopf-Nullbefehl noch offen')) return state.reason;
        const head = batteryHeadsLimitedSnapshots(state).find(h => h.index === phaseTest.index);
        if (!head || !head.valid || head.maxPackSoc >= Math.min(state.maxSoc, head.maxSoc)
            || head.maxChargeW < 1000) return 'Kopf kann den 1000-W-Ladetest nicht aufnehmen';
    } else {
        const wb = phaseTest.index, vehicle = vehicleState(wb);
        if (['ramp', 'measure'].includes(phaseTest.stage) && !phaseTestStorageIdle())
            return 'Speicherleistung waehrend Wallboxtest erkannt; Messung abgebrochen';
        if (nativeConfig[`wb${wb}ControlEnabled`] !== true || nativeConfig[`wb${wb}ProductionArmed`] !== true
            || !vehicle.connected || !vehicle.release || vehicle.socPct >= vehicle.targetSocPct || vehicle.maxCurrent1pA < 16
            || Number(nativeConfig[`wb${wb}CommissioningMaxA`] ?? 6) < 16)
            return 'Wallbox-/Fahrzeugfreigabe oder 16-A-Aufnahme fehlt';
    }
    return '';
}

function beginPhaseTest(message) {
    if (phaseTestActive()) return {error: 'Ein Phasentest oder dessen Ruecknahme laeuft bereits'};
    const kind = message?.kind, index = Number(message?.index);
    if (!['battery', 'wallbox'].includes(kind) || !Number.isInteger(index)
        || (kind === 'battery' ? index < 1 || index > Number(nativeConfig.batteryHeadCount ?? 1)
            || index > 3 || !batteryHeadsMode() : index < 0 || index > 2))
        return {error: 'Geraet fuer Phasentest ungueltig'};
    const previousCurrentA = kind === 'wallbox'
        ? readNumber(`${CFG.root}.Devices.Wallbox${index}.OutputCommand_A`, 0) : 0;
    if (kind === 'wallbox' && (previousCurrentA < 6 || previousCurrentA >= 16))
        return {error: 'Einphasig mit mindestens 6 A und weniger als 16 A laden, dann erneut testen'};
    phaseTestLoaded = true;
    phaseTest = {kind, index, startedAt: Date.now(), stage: 'baseline', previousCurrentA,
        status: 'Ausgangsmessung; Speicherauftraege werden zurueckgenommen',
        before: [], during: [], after: [], peers: null};
    const guard = phaseTestGuard(), readings = phaseTestReadings(), device = phaseTestDevicePower();
    if (guard || !readings || !device) {
        const error = guard || 'Frische SMA-Phasenwerte und bestaetigte einphasige Geraeteantwort erforderlich';
        phaseTest.stage = 'failed'; phaseTest.status = error; publishPhaseTest();
        return {error};
    }
    updateVehicles();
    publishPhaseTest();
    return {result: 'Phasentest gestartet'};
}

function cancelPhaseTest(reason = 'Phasentest abgebrochen') {
    if (!phaseTestActive()) return;
    phaseTest.error ||= reason;
    phaseTest.stage = 'restore'; phaseTest.restoreAt ||= Date.now();
    phaseTest.status = 'Testauftrag wird zurueckgenommen; ' + phaseTest.error;
    updateVehicles();
    if (phaseTest.kind === 'battery') stopBatteryHeadsOutput(phaseTest.status);
    publishPhaseTest();
}

function phaseTestMedian(rows, field, index = null) {
    const numbers = rows.map(row => index === null ? row[field] : row[field][index]).sort((a, b) => a - b);
    return numbers[Math.floor(numbers.length / 2)];
}

function phaseTestResult() {
    const {before, during, after} = phaseTest;
    if (before.length < 3 || during.length < 3 || after.length < 3)
        return {error: 'Zu wenige zusammenhaengende Messwerte'};
    const deltasW = [0, 1, 2].map(p => phaseTestMedian(during, 'phasesW', p)
        - phaseTestMedian(before, 'phasesW', p));
    const deviceDeltaW = phaseTestMedian(during, 'watts') - phaseTestMedian(before, 'watts');
    const tolerance = Math.max(180, deviceDeltaW * 0.2);
    const phase = deltasW.indexOf(Math.max(...deltasW));
    const stable = [0, 1, 2].every(p => Math.abs(phaseTestMedian(after, 'phasesW', p)
        - phaseTestMedian(before, 'phasesW', p)) <= 180);
    const peersStable = [...before, ...during, ...after].every(row =>
        row.peers.length === phaseTest.peers.length
        && row.peers.every((w, p) => Math.abs(w - phaseTest.peers[p]) <= 150));
    if (deviceDeltaW < 400 || !stable || !peersStable
        || Math.abs(deltasW[phase] - deviceDeltaW) > tolerance
        || deltasW.some((w, p) => p !== phase && Math.abs(w) > 180))
        return {error: 'Messung nicht eindeutig; Fremdlast oder unpassende elektrische Antwort', deltasW, deviceDeltaW};
    return {phase: phase + 1, deltasW, deviceDeltaW};
}

function phaseTestTick() {
    if (!phaseTestLoaded) {
        phaseTestLoaded = true;
        try {
            const saved = JSON.parse(getState(`${CFG.root}.Control.PhaseTest_JSON`)?.val || '{}');
            if (['baseline', 'ramp', 'measure', 'restore'].includes(saved.stage)
                && ['battery', 'wallbox'].includes(saved.kind) && Number.isInteger(saved.index)
                && (saved.kind === 'battery' ? saved.index >= 1 && saved.index <= 3 : saved.index >= 0 && saved.index <= 2)
                && Number.isFinite(saved.previousCurrentA) && saved.previousCurrentA >= 0 && saved.previousCurrentA <= 32
                && Array.isArray(saved.before)) {
                phaseTest = {...saved, stage: 'restore', restoreAt: Date.now(), before: saved.before || [], after: [],
                    error: 'Phasentest durch Neustart unterbrochen'};
                updateVehicles();
            }
        } catch { /* No retained test means ordinary control. */ }
    }
    if (!phaseTestActive()) return;
    const now = Date.now();
    if (phaseTest.stage !== 'restore') {
        const reason = phaseTestGuard();
        if (reason || now - phaseTest.startedAt > 75000) cancelPhaseTest(reason || 'Zeitlimit des Phasentests erreicht');
    }
    const reading = phaseTestReadings(), device = phaseTestDevicePower(), peers = phaseTestPeers();
    if (!reading || !device || !peers) {
        if (phaseTest.stage !== 'restore') cancelPhaseTest('Messquelle fehlt oder ist veraltet');
        return;
    }
    const row = {...reading, watts: device.watts, peers};
    const append = field => {
        const rows = phaseTest[field];
        if (!rows.length || row.at > rows.at(-1).at) rows.push(row);
        if (rows.length > 20) rows.shift();
    };
    if (phaseTest.stage === 'baseline') {
        if (!device.idle) return;
        phaseTest.peers ||= peers;
        append('before');
        if (phaseTest.before.length < 3 || now - phaseTest.before[0].at < 2000) return;
        phaseTest.stage = 'ramp'; phaseTest.rampAt = now;
        phaseTest.status = 'Leistungstest; elektrische Antwort wird abgewartet';
        updateVehicles();
    } else if (phaseTest.stage === 'ramp') {
        if (now - phaseTest.rampAt > 25000) return cancelPhaseTest('Geraet erreicht den Test-Sollwert nicht');
        const reached = phaseTest.kind === 'battery' ? device.setpoint === 1000 && device.watts >= 800
            : device.setpoint === 16 && device.amps >= 14.5;
        if (!reached || device.at < phaseTest.rampAt) return;
        phaseTest.stage = 'measure'; phaseTest.measureAt = now;
        phaseTest.status = 'Messfenster 10 Sekunden';
        append('during');
    } else if (phaseTest.stage === 'measure') {
        append('during');
        if (now - phaseTest.measureAt < 10000) return;
        phaseTest.stage = 'restore'; phaseTest.restoreAt = now;
        phaseTest.status = 'Vorherige Regelung wird wiederhergestellt';
        updateVehicles();
    } else if (phaseTest.stage === 'restore') {
        const restored = phaseTest.kind === 'battery' ? device.idle && Math.abs(device.watts) <= 30
            : device.setpoint <= phaseTest.previousCurrentA && device.amps <= phaseTest.previousCurrentA + 0.5
                && (!phaseTest.before.length || phaseTest.error && device.amps <= 0.5
                    || Math.abs(device.watts - phaseTestMedian(phaseTest.before, 'watts')) <= 180);
        if (!restored || row.at <= phaseTest.restoreAt) {
            if (now - phaseTest.restoreAt > 30000) {
                phaseTest.error ||= 'Elektrische Ruecknahme noch unbestaetigt; Regler prueft weiter';
                phaseTest.status = phaseTest.error; publishPhaseTest();
            }
            return;
        }
        append('after');
        if (phaseTest.after.length < 3 || now - phaseTest.after[0].at < 2000) return;
        const result = phaseTest.error ? {error: phaseTest.error} : phaseTestResult();
        Object.assign(phaseTest, result, {stage: result.error ? 'failed' : 'complete', finishedAt: now,
            status: result.error || `Netzphase L${result.phase} erkannt; elektrische Ruecknahme bestaetigt`});
        updateVehicles();
    }
    publishPhaseTest();
}
