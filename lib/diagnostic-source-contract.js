'use strict';

const {buildNativeMapping} = require('./native-mapping');

const MAX_PUMP_SOURCES = 32;
const MAX_SOURCE_ID_LENGTH = 256;
const MAX_PUMP_CONFIG_BYTES = 20000;

function sourceId(value) {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    return id && id.length <= MAX_SOURCE_ID_LENGTH && !/[\u0000-\u001f*?]/u.test(id) ? id : null;
}

/** Explicit existing state IDs only. Never expand namespaces or wildcards.
 * A bad list is reported instead of silently recording an arbitrary prefix.
 */
function parseDiagnosticPumpSources(value, namespace = '') {
    let parsed;
    try {
        if (value === undefined || value === null || value === '') parsed = [];
        else if (typeof value === 'string') {
            if (Buffer.byteLength(value) > MAX_PUMP_CONFIG_BYTES)
                return {ids: [], status: 'invalid', errors: ['configuration-too-large']};
            parsed = JSON.parse(value);
        } else parsed = value;
    } catch { return {ids: [], status: 'invalid', errors: ['invalid-json']}; }
    if (!Array.isArray(parsed)) return {ids: [], status: 'invalid', errors: ['expected-state-id-array']};
    if (parsed.length > MAX_PUMP_SOURCES) return {ids: [], status: 'invalid', errors: ['source-limit']};
    const ids = [], errors = [];
    parsed.forEach((value, index) => {
        const id = sourceId(value);
        if (!id) errors.push(`invalid-source-${index}`);
        else if (namespace && (id === `${namespace}.Debug` || id.startsWith(`${namespace}.Debug.`)))
            errors.push(`recorder-loop-${index}`);
        else if (!ids.includes(id)) ids.push(id);
    });
    // Partially accepting a malformed configuration would make its coverage
    // look complete. The UI/recorder can expose these reasons before use.
    if (errors.length) return {ids: [], status: 'invalid', errors};
    return {ids, status: ids.length ? 'configured' : 'not-configured', errors: []};
}

/** The finite diagnostic source inventory is independent of state values.
 * Subscriptions and recorder hooks consume the same IDs; this function never
 * reads a state, writes SQL settings, or manufactures a cached observation.
 */
function buildDiagnosticSourceContract({namespace = '', config = {}, mapping = {}, wallboxes = []} = {}) {
    const sources = {...mapping, ...buildNativeMapping(config)};
    const byId = new Map();
    const add = (key, value, {discrete = true, powerScale = 0, maxGapMs = 10000, edgeNormalization} = {}) => {
        const id = sourceId(value);
        if (!id || namespace && (id === `${namespace}.Debug` || id.startsWith(`${namespace}.Debug.`))) return;
        const previous = byId.get(id);
        if (previous) {
            if (!previous.keys.includes(key)) previous.keys.push(key);
            // A state used as a command and a reading still retains its edges.
            previous.discrete ||= discrete;
            previous.powerScale = Math.max(previous.powerScale, powerScale);
            previous.maxGapMs = Math.min(previous.maxGapMs, maxGapMs);
            if (edgeNormalization) previous.edgeNormalization = edgeNormalization;
        } else byId.set(id, {id, keys: [key], discrete, powerScale, maxGapMs,
            ...(edgeNormalization ? {edgeNormalization} : {})});
    };
    const mapped = (key, options) => add(key, sources[key], options);
    const own = (key, options) => { if (sourceId(namespace)) add(key, `${namespace}.${key}`, options); };
    const watts = {discrete: false, powerScale: 1, maxGapMs: 10000};
    const analog = {discrete: false, powerScale: 0, maxGapMs: 10000};

    for (const key of ['DP_GRID_IMPORT', 'DP_GRID_EXPORT', 'DP_PV_POWER']) mapped(key, watts);
    for (const key of ['DP_HA_CRITICAL', 'DP_PAR14A', 'DP_LPC_STATE', 'DP_LPC_LIMIT',
        'DP_LPP_STATE', 'DP_LPP_LIMIT', 'DP_WB_PRIORITY']) mapped(key);
    for (const phase of [1, 2, 3]) {
        mapped(`DP_HA_L${phase}_IMPORT_W`, watts);
        mapped(`DP_HA_L${phase}_EXPORT_W`, watts);
        mapped(`DP_DHW_HA_L${phase}_CURRENT_A`, analog);
        mapped(`DP_DHW_HA_L${phase}_FREE_A`, analog);
    }
    for (const wb of [0, 1, 2]) {
        for (const suffix of ['ALLOW', 'RELEASE', 'SOC', 'MIN_SOC', 'TARGET', 'AMIN', 'PHASES', 'PHASE_MODE', 'CAR'])
            mapped(`DP_WB${wb}_${suffix}`);
        mapped(`DP_WB${wb}_POWER`, {...watts, powerScale: 1000});
        for (const phase of [1, 2, 3]) mapped(`DP_WB${wb}_L${phase}_A`, analog);
        const device = wallboxes.find(device => device?.wb === wb);
        for (const [key, nativeSuffix] of Object.entries({allow: 'AllowOutputId', command: 'AmpereOutputId',
            feedback: 'AmpereFeedbackId', phaseMode: 'PhaseModeId', connection: 'ConnectionId',
            error: 'ErrorId', available: 'AvailableCurrentId'}))
            add(`Wallbox${wb}.${key}`, device?.ids?.[key] || config[`wb${wb}${nativeSuffix}`]);
        for (const key of ['UserRelease', 'Release', 'MustCharge', 'Priority', 'EffectivePriorityScore',
            'SoCValid', 'BelowMinimum', 'MinimumSoC_pct', 'TargetSoC_pct',
            'StartDelayActive', 'MinimumRunTimeActive', 'RequestedMinimumCurrent_A']) own(`Vehicles.Wallbox${wb}.${key}`);
        for (const key of ['OutputOwned', 'OutputActive', 'OutputFault', 'OutputCommand_A', 'OutputPhases',
            'ConfirmedPhases', 'PhaseTransitionActive', 'PhaseControlMode', 'PhaseSwitchPending',
            'PhaseSwitchTimedOut', 'StopDelayActive', 'LastStopAt', 'LastStopReason', 'StopConfirmedAt',
            'StopPowerPending', 'ResponseState', 'ResponseAcknowledgedAt', 'ResponseConfirmedAt'])
            own(`Devices.Wallbox${wb}.${key}`, key === 'LastStopReason'
                ? {edgeNormalization: 'stable-reason'} : undefined);
    }
    for (const key of ['DP_DHW_SETPOINT', 'DP_DHW_RELEASE', 'DP_DHW_PARALLEL_RELEASE', 'DP_DHW_CONNECTION']) mapped(key);
    for (const key of ['DP_DHW_ACTUAL_MIRROR', 'DP_DHW_POWER1', 'DP_DHW_OUTPUT1', 'DP_DHW_OUTPUT2', 'DP_DHW_OUTPUT3'])
        mapped(key, watts);
    for (const key of ['OutputReservationState_JSON', 'OutputReservedPower_W', 'OutputReservedPhase1_W',
        'OutputReservedPhase2_W', 'OutputReservedPhase3_W', 'OutputReservationPending', 'OutputReservationStatus',
        'OutputSetpointId', 'OutputCommand_W', 'OutputLastWrite', 'OutputActive', 'OutputOwned', 'OutputStatus',
        'ActuatorSettled', 'ActuatorDifference_W', 'ControlReason']) own(`Devices.MyPV_DHW.${key}`,
        ['OutputLastWrite', 'ActuatorDifference_W'].includes(key) ? {discrete: false}
            : ['ControlReason', 'OutputStatus'].includes(key) ? {edgeNormalization: 'stable-reason'} : undefined);
    for (const key of ['System.Version', 'System.Mode', 'System.RealOutputsEnabled', 'System.DataValid',
        'Control.Enabled', 'Control.Mode', 'Control.Valid', 'Control.SelectedWallbox', 'Control.WallboxPrioritySource',
        'Control.GridOperatorLimitActive', 'Control.GridOperatorBudget_W', 'Control.GridOperatorStatus',
        'Control.RestartHandoffActive', 'Control.ParallelDistributionActive', 'Control.ParallelDistributionReleased',
        'Config.WallboxStartDelay_s', 'Config.WallboxMinimumRunTime_s', 'Config.WallboxStopDelay_s']) own(key);
    for (const id of parseDiagnosticPumpSources(config.diagnosticPumpSourcesJson, namespace).ids)
        add('pump.observation', id);
    return [...byId.values()];
}

module.exports = {buildDiagnosticSourceContract, parseDiagnosticPumpSources, MAX_PUMP_SOURCES,
    MAX_SOURCE_ID_LENGTH, MAX_PUMP_CONFIG_BYTES};
