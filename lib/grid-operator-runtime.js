'use strict';

// Adapter boundary for the pure accounting policy. Reads only original AC
// observations and the existing synchronous high-water cache. No actuator,
// persistence, transport interpretation, reservation expiry or timers here.
const policy = require('./grid-operator-accounting');
const constraints = require('./grid-constraints');
const {buildNativeMapping} = require('./native-mapping');
const {normalizeWallboxPowerKW} = require('./wallbox-measurement');
const {SMA_GRID_MAX_AGE_MS} = require('./source-diagnostics');
const {readTopology} = require('./sunenergy-heads');
const {batteryHeadOwnership} = require('./output-metadata');

const MAX_ITEMS = 128;
const BATTERY_SUM = '@controlled-battery-ac';
const DEVICES = ['Wallbox0', 'Wallbox1', 'Wallbox2', 'MyPV_DHW', 'MyPV_Heating', 'Battery'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function groupAccountingEnabled(config = {}) {
    return config.par14aAccountingMode !== undefined && config.par14aAccountingMode !== 'legacyGross';
}

function sourceId(value, namespace) {
    const id = text(value);
    return id && id === value && id.length <= 256 && !/[\u0000-\u001f*?]/u.test(id)
        && !id.startsWith('@') && !(namespace && (id === namespace || id.startsWith(`${namespace}.`))) ? id : null;
}

// The recorder and startup subscription consume this same bounded inventory.
// Invalid declarations never broaden subscriptions or expand namespaces.
function accountingSources(config = {}, namespace = '') {
    if (config.par14aAccountingMode !== 'groupNet') return [];
    const rows = [...(Array.isArray(config.par14aParticipants) ? config.par14aParticipants : []),
        ...(Array.isArray(config.par14aStorageMeters) ? config.par14aStorageMeters : [])];
    if (rows.length > MAX_ITEMS * 2) return [];
    const sources = new Map();
    for (const row of rows) {
        const id = sourceId(row?.powerId, namespace);
        if (id && ['W', 'kW'].includes(row.powerUnit)) sources.set(id, {id, unit: row.powerUnit});
    }
    return sources.size <= MAX_ITEMS ? [...sources.values()] : [];
}

function evaluateRuntimeGroup({config = {}, mapping = {}, namespace = '', getState, now = Date.now()} = {}) {
    const fail = reason => ({groupNet: true, valid: false, active: true, budgetW: 0,
        snapshot: null, reason: `Gruppen-Netzbilanz gesperrt: ${reason}`});
    if (config.par14aAccountingMode !== 'groupNet') return fail('Bilanzmodus fehlt oder ist unbekannt');
    if (typeof getState !== 'function' || !finite(now) || now <= 0 || !namespace) return fail('Lesekontext ungueltig');
    const mapped = {...mapping, ...buildNativeMapping(config)};
    const groupId = text(config.par14aGroupId), boundaryId = text(config.par14aBoundaryId);
    if (!groupId || groupId.length > 100 || !boundaryId || boundaryId.length > 100
        || config.par14aSiteScope !== 'whole-site-ac') return fail('Gruppe oder vollstaendige NVP-AC-Messgrenze nicht deklariert');
    // Unknown LPC semantics cannot establish absence of a group constraint,
    // even if the legacy string parser happens to call a value "unlimited".
    if (mapped.DP_LPC_STATE || mapped.DP_LPC_LIMIT) return fail('LPC-Vertrag ist nicht verifiziert; kein Gruppen-Netzmodus bei konfiguriertem LPC');
    const ageS = config.par14aAccountingMaxAgeS ?? 30, maxSkewMs = config.par14aAccountingMaxSkewMs ?? 0;
    if (!finite(ageS) || ageS <= 0 || ageS > 30 || !finite(maxSkewMs)
        || maxSkewMs < 0 || maxSkewMs > 1000 || maxSkewMs > ageS * 1000) return fail('Quellenalter oder Versatzgrenze ungueltig');
    const maxAgeMs = ageS * 1000;
    const read = id => {try {return getState(id);} catch {return null;}};
    const strictState = (id, age) => {
        if (!sourceId(id, namespace)) throw new Error('Physische Quelle fehlt oder ist keine exakte fremde State-ID');
        const state = read(id);
        if (!object(state) || state.ack !== true || state.q !== 0 || !finite(state.ts)
            || state.ts <= 0 || state.ts > now || now - state.ts > age) throw new Error(`Quelle ${id}: ACK/Qualitaet/Zeit fehlt oder ungueltig`);
        return state;
    };
    try {
        let legacyActive = false;
        if (!mapped.DP_PAR14A) throw new Error('Binaerkontakt fuer die deklarierte Gruppe fehlt');
        const contactState = strictState(mapped.DP_PAR14A, Infinity);
        const contact = contactState.val;
        const boolean = [true, 1, '1'].includes(contact) ? true : [false, 0, '0'].includes(contact) ? false : null;
        if (boolean === null) throw new Error('Binaerkontakt ist nicht eindeutig boolesch');
        legacyActive = config.par14aActiveHigh === false ? !boolean : boolean;
        const externalState = config.par14aBudgetMode === 'external' ? strictState(mapped.DP_PAR14A_LIMIT, 15000) : null;
        const external = externalState?.val ?? null;
        const constraintSources = [{id: mapped.DP_PAR14A, ts: contactState.ts, ack: contactState.ack, q: contactState.q},
            ...(externalState ? [{id: mapped.DP_PAR14A_LIMIT, ts: externalState.ts, ack: externalState.ack, q: externalState.q}] : [])];
        const budget = constraints.binaryContactBudget(config, external);
        const limit = constraints.evaluateConsumptionLimit({legacyConfigured: true, legacyActive, legacyBudget: budget});
        if (!limit.valid) throw new Error(limit.reason);
        if (!limit.active) return {groupNet: true, ...limit, snapshot: policy.evaluateGroupAccounting({mode: 'groupNet',
            limit: {...limit, groupId, boundaryId}}), calculation: budget, constraintSources};

        const raw = new Map();
        const descriptor = (id, unit, role = '') => {
            if (!['W', 'kW'].includes(unit)) throw new Error('AC-Leistungseinheit fehlt/ungueltig');
            const state = strictState(id, role === 'site' ? Math.min(maxAgeMs, SMA_GRID_MAX_AGE_MS) : maxAgeMs);
            if (!finite(state.val)) throw new Error(`Quelle ${id}: keine endliche originale Zahl`);
            const previous = raw.get(id);
            if (previous && (previous.unit !== unit || previous.val !== state.val || previous.ts !== state.ts))
                throw new Error(`Quelle ${id}: widerspruechliche Alias-/Einheitenzuordnung`);
            raw.set(id, {id, val: state.val, unit, ts: state.ts, ack: state.ack, q: state.q});
            let val = state.val;
            if (role === 'wallbox') {
                if (unit !== 'kW') throw new Error('Wallbox-Istquelle muss dem vorhandenen kW-Vertrag entsprechen');
                val = normalizeWallboxPowerKW(val);
                if (val === null) throw new Error(`Quelle ${id}: ungueltige Wallboxleistung`);
            }
            return {id, unit, scope: 'total-ac', boundaryId, state: {...state, val}};
        };
        const sumDescriptor = (id, readings, positiveOnly = false) => {
            if (!readings.length) throw new Error('Vollstaendige AC-Messsumme fehlt');
            const val = readings.reduce((sum, item) => sum + (positiveOnly ? Math.max(0, item.watts) : item.watts), 0);
            if (!finite(val) || val < 0) throw new Error('AC-Verbrauchssumme ungueltig');
            return {id, unit: 'W', scope: 'total-ac', boundaryId,
                state: {val, ack: true, q: 0, ts: Math.min(...readings.map(item => item.ts))}};
        };
        const own = suffix => read(`${namespace}.${suffix}`)?.val;
        // A topology/configuration change does not return a former actuator.
        // Read the durable claims independently of aggregate display flags:
        // a partially persisted restart must not turn battery discharge into PV.
        const ledgerState = read(`${namespace}.Devices.Battery.HeadOwnership_JSON`);
        const ledger = ledgerState?.val;
        if (ledgerState !== undefined && ledgerState !== null) {
            if (ledgerState.ack !== true || ledgerState.q !== undefined && ledgerState.q !== 0)
                throw new Error('Dauerhafte Speicher-Besitzliste ist nicht bestaetigt oder hat ungueltige Qualitaet');
            if (typeof ledger !== 'string' || ledger.length > 32768) throw new Error('Speicher-Besitzliste fehlt im begrenzten Originalformat');
            let body;
            try {body = JSON.parse(ledger);} catch {throw new Error('Speicher-Besitzliste unlesbar');}
            if (body?.version !== 1 || !Array.isArray(body.heads) || body.heads.length > 6)
                throw new Error('Speicher-Besitzliste ungueltig');
            for (const head of body.heads) {
                for (const key of ['commandW', 'reservedChargeW', 'unobservedCommandW']) {
                    if (!finite(head?.[key]) || key === 'reservedChargeW' && head[key] < 0)
                        throw new Error('Speicherkopf-Auftrag oder Reserve unbekannt');
                }
            }
        }
        const retainedHeads = batteryHeadOwnership({namespace, getCachedState: read});
        const retainedReserveW = retainedHeads.reduce((sum, head) => sum
            + Math.max(0, head.commandW, head.reservedChargeW, head.unobservedCommandW), 0);
        const unobservedBattery = own('Devices.Battery.OutputUnobservedCommand_W');
        if (unobservedBattery !== undefined && !finite(unobservedBattery)) throw new Error('Unbeobachteter Speicherauftrag ungueltig');
        const ownPower = suffix => {
            const val = own(suffix);
            if (val === undefined) return 0;
            if (!finite(val) || val < 0) throw new Error(`Bestehende Reserve ${suffix} ungueltig`);
            return val;
        };
        const positiveCommand = suffix => {
            const val = own(suffix);
            if (val === undefined) return 0;
            if (!finite(val)) throw new Error(`Bestehender Auftrag ${suffix} ungueltig`);
            return Math.max(0, val);
        };
        const reserve = device => Math.max(ownPower(`Devices.${device}.${device === 'Battery' ? 'OutputReservedCharge_W' : 'OutputReservedPower_W'}`),
            device === 'Battery' ? Math.max(retainedReserveW, unobservedBattery || 0)
                : [1, 2, 3].reduce((sum, phase) => sum + ownPower(`Devices.${device}.OutputReservedPhase${phase}_W`), 0));
        const nativePresent = device => config[device === 'Battery' ? 'batteryPresent' : device === 'MyPV_DHW' ? 'dhwPresent'
            : device === 'MyPV_Heating' ? 'heatingPresent' : `wb${device.slice(-1)}Present`] === true;
        const relevant = device => nativePresent(device) || own(`Devices.${device}.Present`) === true
            || own(`Devices.${device}.OutputOwned`) === true || own(`Devices.${device}.OutputActive`) === true || reserve(device) > 0
            || device === 'Battery' && (retainedHeads.length > 0 || unobservedBattery !== undefined && unobservedBattery !== 0);
        const participantRows = config.par14aParticipants;
        if (!Array.isArray(participantRows) || !participantRows.length || participantRows.length > MAX_ITEMS) throw new Error('Explizite Teilnehmertabelle fehlt/zu gross');
        const rows = participantRows.map(row => {
            if (!object(row) || !text(row.name) || row.name !== row.name.trim() || row.name.length > 100
                || !['wallbox', 'heatPump', 'cooling', 'storage'].includes(row.kind) || row.powerScope !== 'total-ac')
                throw new Error('Teilnehmeridentitaet, Typ oder vollstaendiger AC-Messumfang fehlt');
            const deviceId = row.deviceId === '' ? null : row.deviceId;
            if (deviceId !== null && (!DEVICES.includes(deviceId) || deviceId.startsWith('MyPV_')
                || (deviceId === 'Battery' ? row.kind !== 'storage' : row.kind !== 'wallbox')))
                throw new Error('Teilnehmer-/Ausgangsbindung fehlt oder ist unzulaessig');
            return {...row, deviceId};
        });
        const bindings = new Map(rows.filter(row => row.deviceId).map(row => [row.deviceId, row]));
        if (bindings.size !== rows.filter(row => row.deviceId).length) throw new Error('Ausgang mehrfach als Teilnehmer gebunden');

        const site = {import: descriptor(mapped.DP_GRID_IMPORT, 'W', 'site'), export: descriptor(mapped.DP_GRID_EXPORT, 'W', 'site')};
        const storageRows = config.par14aStorageMeters;
        if (!['none', 'complete-ac'].includes(config.par14aStorageCoverage) || !Array.isArray(storageRows)
            || storageRows.length > MAX_ITEMS || (config.par14aStorageCoverage === 'none' ? storageRows.length !== 0 : !storageRows.length))
            throw new Error('Speicherabdeckung muss ausdruecklich keine oder vollstaendige AC-Liste sein');
        const storageMeters = storageRows.map(row => {
            if (row?.powerScope !== 'total-ac' || !['charge-positive', 'discharge-positive'].includes(row.direction)) throw new Error('Speicher-AC-Umfang oder Vorzeichen fehlt');
            if (/\.total\.batteryPower$|\.heads\.\d+\.battery\./u.test(String(row.powerId)))
                throw new Error('Bekannte DC-/Batterietelemetrie ist kein vollstaendiger AC-Zaehler');
            if (/^sunenergyxt500\.\d+\.(?:heads\.[1-3]\.grid\.GP|total\.gridPower)$/u.test(String(row.powerId))
                && (row.direction !== 'discharge-positive' || row.powerUnit !== 'W'))
                throw new Error('SunEnergy-AC-Vertrag ist W und entladepositiv, auch fuer externe Koepfe');
            return {...descriptor(row.powerId, row.powerUnit), direction: row.direction};
        });
        for (const meter of storageMeters) {
            const total = meter.id.match(/^(sunenergyxt500\.\d+)\.total\.gridPower$/);
            if (total && storageMeters.some(other => other.id.startsWith(`${total[1]}.heads.`)))
                throw new Error('Speicher-Gesamtzaehler und enthaltene Kopfzaehler ueberlappen');
        }
        let controlledBatteryIds = [];
        const batterySources = () => {
            let ids;
            if (config.batteryDispatchMode === 'sunenergy-heads') {
                const topology = readTopology(config);
                if (!topology.valid) throw new Error('Mehrkopf-Speichertopologie ungueltig');
                ids = topology.heads.map(head => `${head.baseId}.grid.GP`);
            } else {
                ids = [mapped.DP_BATTERY_AC_POWER];
                if (config.batteryControlEnabled === true) {
                    const target = String(config.batterySetpointId || '').match(/^(sunenergyxt500\.\d+)\.heads\.([1-3])\.control\.GS$/);
                    const expected = target ? `${target[1]}.heads.${target[2]}.grid.GP` : '';
                    if (!expected || mapped.DP_BATTERY_AC_POWER !== expected
                        && !(own('Devices.Battery.SingleHeadVerified') === true && mapped.DP_BATTERY_AC_POWER === `${target[1]}.total.gridPower`))
                        throw new Error('Gesteuerter GS-Ausgang und vollstaendige AC-Istquelle passen nicht zusammen');
                }
            }
            const singleTarget = String(config.batterySetpointId || '').match(/^(sunenergyxt500\.\d+)\.heads\.([1-3])\.control\.GS$/);
            const actualIdFor = setpointId => {
                // The existing verified single-head total is an alias of this
                // exact head, never additional generation or a second meter.
                if (singleTarget && setpointId === config.batterySetpointId
                    && own('Devices.Battery.SingleHeadVerified') === true
                    && mapped.DP_BATTERY_AC_POWER === `${singleTarget[1]}.total.gridPower`)
                    return mapped.DP_BATTERY_AC_POWER;
                return setpointId.replace(/\.control\.GS$/, '.grid.GP');
            };
            for (const head of retainedHeads) ids.push(actualIdFor(head.setpointId));
            const former = own('Devices.Battery.OutputSetpointId');
            if (former && (own('Devices.Battery.OutputOwned') === true || reserve('Battery') > 0 || unobservedBattery !== undefined && unobservedBattery !== 0)) {
                if (typeof former !== 'string' || !/^sunenergyxt500\.\d+\.heads\.[1-3]\.control\.GS$/.test(former))
                    throw new Error('Frueherer Speicher-Ausgang ist nicht sicher AC-zuordenbar');
                ids.push(actualIdFor(former));
            } else if (!former && !retainedHeads.length && (own('Devices.Battery.OutputOwned') === true
                || reserve('Battery') > 0 || unobservedBattery !== undefined && unobservedBattery !== 0))
                throw new Error('Bestehender Speicherauftrag ohne belastbare Ausgangszuordnung');
            ids = [...new Set(ids)];
            if (config.par14aStorageCoverage !== 'complete-ac' || ids.some(id => !id)) throw new Error('Gesteuerter Speicher braucht vollstaendige deklarierte AC-Abdeckung');
            controlledBatteryIds = ids;
            return ids.map(id => {
                const matches = storageMeters.filter(meter => meter.id === id);
                if (matches.length !== 1) throw new Error('Gesteuerter Speicher ist nicht eindeutig in der AC-Liste abgedeckt');
                const meter = matches[0];
                // Existing SunEnergy GS/GP contracts are discharge-positive.
                if (meter.direction !== 'discharge-positive' || meter.unit !== 'W') throw new Error('Speicher-AC-Vertrag passt nicht zum Ausgangstreiber');
                return {watts: -meter.state.val, ts: meter.state.ts};
            });
        };
        let batteryReading = null;
        if (relevant('Battery') || bindings.has('Battery')) batteryReading = sumDescriptor('@accounting/Battery', batterySources(), true);
        const participantMeters = new Map();
        for (const row of rows) {
            let reading;
            if (row.deviceId === 'Battery' && row.powerId === BATTERY_SUM) {
                if (row.powerUnit !== 'W' || !batteryReading) throw new Error('Speicher-Summenbindung fehlt');
                reading = batteryReading;
                // A signed aggregate is intentionally not invented. The core
                // sees positive charge while raw storage directions stay separate.
            } else {
                if (row.deviceId?.startsWith('Wallbox') && (row.powerId !== mapped[`DP_WB${row.deviceId.slice(-1)}_POWER`] || row.powerUnit !== 'kW'))
                    throw new Error('Wallbox-Teilnehmer muss seine vorhandene kW-Istquelle verwenden');
                if (row.deviceId === 'Battery') {
                    const ids = batterySources();
                    if (ids.length !== 1 || row.powerId !== mapped.DP_BATTERY_AC_POWER) throw new Error('Speichergruppe benoetigt vollstaendige Summenbindung');
                }
                reading = descriptor(row.powerId, row.powerUnit, row.deviceId?.startsWith('Wallbox') ? 'wallbox' : '');
            }
            const previous = participantMeters.get(reading.id);
            if (previous && (previous.unit !== reading.unit || previous.state.val !== reading.state.val)) throw new Error('Teilnehmerzaehler widerspruechlich');
            if (previous) previous.participantIds.push(row.name);
            else participantMeters.set(reading.id, {...reading, participantIds: [row.name]});
        }
        const devices = [], heaterPhases = Object.create(null);
        const physicalOwners = new Map();
        const siteIds = new Set([site.import.id, site.export.id]);
        const storageIds = new Set(storageMeters.map(meter => meter.id));
        const declareDeviceSources = (device, ids) => {
            if (new Set(ids).size !== ids.length) throw new Error('Gesteuerte AC-Messkanaele sind doppelt zugeordnet');
            for (const id of ids) {
                if (siteIds.has(id) || device !== 'Battery' && storageIds.has(id)
                    || physicalOwners.has(id) && physicalOwners.get(id) !== device)
                    throw new Error('Physische AC-Messgrenzen von NVP, Speicher oder Ausgaengen ueberlappen');
                physicalOwners.set(id, device);
            }
        };
        for (const device of DEVICES) {
            if (!relevant(device) && !bindings.has(device)) continue;
            const binding = bindings.get(device);
            let measurement, commandW = 0;
            const owned = own(`Devices.${device}.OutputOwned`) === true;
            if (device.startsWith('Wallbox')) {
                const wb = device.slice(-1), voltage = own('Config.WallboxNominalVoltage_V') ?? config.wallboxNominalVoltageV ?? 230;
                if (!finite(voltage) || voltage < 200 || voltage > 260) throw new Error('Nennspannung ungueltig');
                const phases = own(`Devices.${device}.OutputPhases`) >= 3 ? 3 : 1;
                measurement = descriptor(mapped[`DP_WB${wb}_POWER`], 'kW', 'wallbox');
                declareDeviceSources(device, [measurement.id]);
                if (owned && own(`Devices.${device}.OutputActive`) === true) commandW = ownPower(`Devices.${device}.OutputCommand_A`) * voltage * phases;
            } else if (device === 'Battery') {
                measurement = binding && binding.powerId !== BATTERY_SUM
                    ? participantMeters.get(binding.powerId) : batteryReading;
                declareDeviceSources(device, controlledBatteryIds);
                commandW = Math.max(owned ? positiveCommand(`Devices.${device}.OutputCommandInternal_W`) : 0,
                    retainedHeads.reduce((sum, head) => sum + Math.max(0, head.commandW), 0));
            } else {
                const prefix = device === 'MyPV_DHW' ? 'DP_DHW_OUTPUT' : 'DP_HEAT_OUTPUT';
                const readings = [1, 2, 3].map(phase => descriptor(mapped[`${prefix}${phase}`], 'W'));
                if (readings.some(item => item.state.val < 0)) throw new Error('Einzelne Heizphasenleistung ist negativ');
                declareDeviceSources(device, readings.map(item => item.id));
                if (new Set(readings.map(item => item.id)).size !== 3) throw new Error('Heizphasen doppelt zugeordnet');
                measurement = sumDescriptor(`@accounting/${device}`, readings.map(item => ({watts: item.state.val, ts: item.state.ts})));
                heaterPhases[device] = {stageW: device === 'MyPV_DHW' ? 3000 : 2000,
                    actualW: readings.map(item => item.state.val),
                    reservedW: [1, 2, 3].map(phase => ownPower(`Devices.${device}.OutputReservedPhase${phase}_W`))};
                if (owned) commandW = ownPower(`Devices.${device}.OutputCommand_W`);
            }
            const phaseProof = heaterPhases[device];
            const phasePeakW = phaseProof ? phaseProof.actualW.reduce((sum, watts, phase) => sum
                + Math.max(watts, phaseProof.reservedW[phase]), 0) : 0;
            devices.push({id: device, participantId: binding?.name ?? null, measurement, commandW,
                reservedW: Math.max(reserve(device), phasePeakW)});
        }
        for (const row of rows) {
            const ids = row.powerId === BATTERY_SUM && row.deviceId === 'Battery' ? controlledBatteryIds : [row.powerId];
            if (ids.some(id => physicalOwners.has(id) && physicalOwners.get(id) !== row.deviceId))
                throw new Error('Teilnehmermessung ueberlappt einen anders oder nicht als Teilnehmer gebundenen Ausgang');
        }
        // Aggregates cannot hide an older component; every original source is
        // included here before any synthetic sum is admitted to the pure core.
        const sources = [...raw.values()], firstAt = Math.min(...sources.map(item => item.ts)), lastAt = Math.max(...sources.map(item => item.ts));
        if (lastAt - firstAt > maxSkewMs) throw new Error('Originalquellen ueberschreiten die gemeinsame Versatzgrenze');
        if (raw.size > MAX_ITEMS) throw new Error('Zu viele deklarierte AC-Quellen');
        const snapshot = policy.evaluateGroupAccounting({mode: 'groupNet', now, maxAgeMs, maxSkewMs,
            limit: {...limit, groupId, boundaryId}, group: {id: groupId, boundaryId,
                participants: rows.map(row => ({id: row.name, deviceId: row.deviceId,
                    // This declared sum is already positive AC charge, not a
                    // signed raw storage meter. Keep original signed heads in
                    // storage for discharge exclusion exactly once.
                    kind: row.kind === 'storage' && row.powerId !== BATTERY_SUM ? 'storage' : 'load'}))},
            site, participantMeters: [...participantMeters.values()],
            storage: {coverage: config.par14aStorageCoverage, meters: storageMeters}, devices});
        if (!snapshot.valid) throw new Error(snapshot.reason);
        return {groupNet: true, valid: true, active: true, budgetW: null,
            snapshot: {...snapshot, rawSources: sources, heaterPhases}, calculation: budget, constraintSources,
            reason: `Gruppen-Netzbudget ${snapshot.netBudgetW} W; belegte Eigenversorgung ${Math.floor(snapshot.ownAvailableW)} W; Bruttobudget ${Math.floor(snapshot.grossBudgetW)} W`};
    } catch (error) {return fail(error.message);}
}

function deviceGroupLimit(result, deviceId) {
    if (!result?.valid) return {valid: false, maximumW: 0, reason: result?.reason || 'Gruppenbilanz fehlt'};
    const preview = policy.commandBudget(result.snapshot, deviceId, 0);
    if (!preview.valid || result.active && !Object.hasOwn(result.snapshot.devices, deviceId)) return {valid: false, maximumW: 0, reason: preview.reason};
    return {valid: true, maximumW: preview.maximumW, reason: result.reason};
}

function checkGroupCommand(result, deviceId, watts) {
    if (!finite(watts) || watts < 0) return {allowed: false, reason: 'Ungueltiger positiver Verbrauchsbefehl'};
    if (watts === 0) return {allowed: true, reason: 'Sicherer Nullbefehl'};
    const limit = deviceGroupLimit(result, deviceId);
    if (!limit.valid) return {allowed: false, reason: limit.reason};
    const device = result.snapshot?.devices?.[deviceId];
    const oldCommitmentW = device ? Math.max(device.actualW, device.commandW, device.reservedW) : 0;
    const peakW = commandReservationW(result.snapshot, deviceId, watts);
    // Holding an old high water cannot prevent its safe reduction. Growing a
    // phase peak, however, consumes new shared capacity before publication.
    const requiredW = peakW > oldCommitmentW ? peakW : watts;
    const allowed = finite(requiredW) && (limit.maximumW === null || requiredW <= limit.maximumW);
    return {allowed, reason: allowed ? 'Frische Gruppenbilanz samt bestehenden Reserven erlaubt Auftrag'
        : 'Gemeinsames Gruppen-Netz-/Eigenstrombudget ausgeschoepft', maximumW: limit.maximumW};
}

function projectedHeaterPhases(snapshot, deviceId, watts) {
    const proof = snapshot?.heaterPhases?.[deviceId];
    if (!proof) return null;
    if (!finite(proof.stageW) || proof.stageW <= 0 || !Array.isArray(proof.actualW)
        || !Array.isArray(proof.reservedW) || proof.actualW.length !== 3 || proof.reservedW.length !== 3
        || [...proof.actualW, ...proof.reservedW].some(value => !finite(value) || value < 0)) return {invalid: true};
    const stage = proof.stageW, bounded = Math.min(watts, stage * 3);
    const target = bounded <= stage ? [bounded, 0, 0] : bounded <= stage * 2
        ? [bounded - stage, stage, 0] : [bounded - stage * 2, stage, stage];
    return {...proof, reservedW: target.map((value, phase) => Math.max(value, proof.actualW[phase], proof.reservedW[phase]))};
}

function commandReservationW(snapshot, deviceId, watts) {
    if (!finite(watts) || watts < 0) return NaN;
    if (watts === 0) return 0;
    const projected = projectedHeaterPhases(snapshot, deviceId, watts);
    return projected?.invalid ? NaN : projected ? Math.max(watts, projected.reservedW.reduce((sum, value) => sum + value, 0)) : watts;
}

// A staged aggregate reduction can INCREASE electrical overlap. Reserve its
// prospective per-phase high waters before deciding whether to grant it, while
// keeping the actual total command separate from that conservative peak.
function reserveRuntimeGroupCommands(snapshot, proposals) {
    if (!object(snapshot?.devices) || !object(proposals)) return policy.reserveGroupCommands(snapshot, proposals);
    const devices = Object.create(null), phases = Object.create(null);
    for (const [id, device] of Object.entries(snapshot.devices)) devices[id] = {...device};
    for (const [id, proof] of Object.entries(snapshot.heaterPhases || {})) phases[id] = proof;
    let growsElectricalPeak = false;
    for (const [id, watts] of Object.entries(proposals)) {
        if (!Object.hasOwn(devices, id) || !finite(watts) || watts <= 0) continue;
        const peak = commandReservationW(snapshot, id, watts);
        if (!finite(peak)) return {valid: false, allowed: false, withinBudget: false, safeReduction: false,
            next: null, reason: 'Prospektive Heizphasenreserve ungueltig'};
        const old = devices[id];
        growsElectricalPeak ||= peak > Math.max(old.actualW, old.commandW, old.reservedW);
        devices[id].reservedW = Math.max(devices[id].reservedW, peak);
        const projected = projectedHeaterPhases(snapshot, id, watts);
        if (projected) phases[id] = projected;
    }
    const result = policy.reserveGroupCommands({...snapshot, devices, heaterPhases: phases}, proposals);
    if (result.allowed && !result.withinBudget && growsElectricalPeak)
        return {...result, allowed: false, safeReduction: false, next: null,
            reason: 'Neue elektrische Phasenspitze passt nicht ins gemeinsame Gruppenbudget'};
    return result;
}

module.exports = {groupAccountingEnabled, accountingSources, evaluateRuntimeGroup, deviceGroupLimit,
    checkGroupCommand, commandReservationW, reserveRuntimeGroupCommands,
    BATTERY_SUM, reserveGroupCommands: policy.reserveGroupCommands,
    commandBudget: policy.commandBudget};
