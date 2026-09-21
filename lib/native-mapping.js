'use strict';

// Explicit native fields always win. The free JSON mapping remains a migration
// fallback so an update from 0.16 does not silently lose any source.
const FIELD_TO_MAPPING = Object.freeze({
    historyInstance: 'DP_SQL_INSTANCE',
    pvPowerId: 'DP_PV_POWER',
    gridImportId: 'DP_GRID_IMPORT',
    gridExportId: 'DP_GRID_EXPORT',
    outsideTemperatureId: 'DP_OUTSIDE_TEMP',
    dhwTemperatureId: 'DP_DHW_TEMP',
    energyPriceSeriesId: 'DP_ENERGY_PRICE_SERIES',
    gridFeeSeriesId: 'DP_GRID_FEE_SERIES',
    dynamicEnergyPriceEnabledId: 'DP_DYNAMIC_ENERGY_ENABLED',
    dynamicGridFeeEnabledId: 'DP_DYNAMIC_GRID_ENABLED',
    holidayTodayId: 'DP_HOLIDAY_TODAY',
    holidayTomorrowId: 'DP_HOLIDAY_TOMORROW',
    holidayAfterTomorrowId: 'DP_HOLIDAY_AFTER_TOMORROW',
    weatherHourlyBaseId: 'DP_WEATHER_HOURLY_BASE',
    pvForecastBaseId: 'DP_PV_FORECAST_BASE',
    haFreePowerId: 'DP_HA_FREE_POWER',
    haCriticalId: 'DP_HA_CRITICAL',
    lppStateId: 'DP_LPP_STATE',
    lppLimitId: 'DP_LPP_LIMIT',
    house1PowerId: 'DP_HOUSE1',
    house2PowerId: 'DP_HOUSE2',
    hallPowerId: 'DP_HALL',
    apartmentPowerId: 'DP_APARTMENT',
    batterySocId: 'DP_BATTERY_SOC',
    batteryPowerId: 'DP_BATTERY_POWER',
    dhwPowerId: 'DP_DHW_POWER1',
    dhwHistoryId: 'DP_DHW_HISTORY',
    dhwTemp1Id: 'DP_DHW_TEMP1',
    dhwTemp2Id: 'DP_DHW_TEMP2',
    dhwTemp3Id: 'DP_DHW_TEMP3',
    dhwTemp4Id: 'DP_DHW_TEMP4',
    dhwReleaseId: 'DP_DHW_RELEASE',
    dhwParallelReleaseId: 'DP_DHW_PARALLEL_RELEASE',
    dhwOutletTempId: 'DP_DHW_OUTLET_TEMP',
    dhwConnectionId: 'DP_DHW_CONNECTION',
    dhwHysteresisId: 'DP_DHW_HYSTERESIS',
    heatingPowerId: 'DP_HEAT_POWER1',
    heatingHistoryId: 'DP_HEAT_HISTORY',
    heatingTempId: 'DP_HEAT_TEMP',
    heatPumpPowerId: 'DP_HEAT_PUMP_POWER',
    dhwSetpointId: 'DP_DHW_SETPOINT',
    dhwActualMirrorId: 'DP_DHW_ACTUAL_MIRROR',
    dhwOutput1Id: 'DP_DHW_OUTPUT1',
    dhwOutput2Id: 'DP_DHW_OUTPUT2',
    dhwOutput3Id: 'DP_DHW_OUTPUT3',
    dhwHaL1FreeCurrentId: 'DP_DHW_HA_L1_FREE_A',
    dhwHaL2FreeCurrentId: 'DP_DHW_HA_L2_FREE_A',
    dhwHaL3FreeCurrentId: 'DP_DHW_HA_L3_FREE_A',
    dhwHaL1CurrentId: 'DP_DHW_HA_L1_CURRENT_A',
    dhwHaL2CurrentId: 'DP_DHW_HA_L2_CURRENT_A',
    dhwHaL3CurrentId: 'DP_DHW_HA_L3_CURRENT_A',
    haL1ImportPowerId: 'DP_HA_L1_IMPORT_W',
    haL2ImportPowerId: 'DP_HA_L2_IMPORT_W',
    haL3ImportPowerId: 'DP_HA_L3_IMPORT_W',
    haL1ExportPowerId: 'DP_HA_L1_EXPORT_W',
    haL2ExportPowerId: 'DP_HA_L2_EXPORT_W',
    haL3ExportPowerId: 'DP_HA_L3_EXPORT_W',
    par14aId: 'DP_PAR14A',
    lpcStateId: 'DP_LPC_STATE',
    lpcLimitId: 'DP_LPC_LIMIT',
    wallboxPriorityId: 'DP_WB_PRIORITY'
});

const WALLBOX_FIELDS = Object.freeze({
    SocId: 'SOC', MinSocId: 'MIN_SOC', TargetSocId: 'TARGET', ReleaseId: 'RELEASE',
    UserAllowId: 'ALLOW', CarStateId: 'CAR', PhaseStateId: 'PHASES', PowerId: 'POWER',
    L1CurrentId: 'L1_A', L2CurrentId: 'L2_A', L3CurrentId: 'L3_A',
    ManualMinCurrentId: 'AMIN'
});

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

function buildNativeMapping(config = {}, onInvalidJson = () => {}) {
    let mapping = {};
    try {
        const parsed = JSON.parse(String(config.dataPointMapJson || '{}'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) mapping = {...parsed};
        else onInvalidJson('Mapping JSON must contain an object');
    } catch (error) {
        onInvalidJson(error.message);
    }
    for (const [field, key] of Object.entries(FIELD_TO_MAPPING)) {
        const id = text(config[field]);
        if (id) mapping[key] = id;
    }
    for (let wb = 0; wb < 3; wb++) {
        for (const [suffix, keySuffix] of Object.entries(WALLBOX_FIELDS)) {
            const id = text(config[`wb${wb}${suffix}`]);
            if (id) mapping[`DP_WB${wb}_${keySuffix}`] = id;
        }
    }
    return mapping;
}

function houseConnectionSettings(config = {}) {
    const legacyLimit = Number(config.wallboxHaLimitA ?? config.dhwHaLimitA ?? 50);
    const fuseA = Math.max(1, Number(config.houseConnectionFuseA ?? legacyLimit) || 50);
    const legacyIncrease = Number(config.wallboxHaIncreaseLimitA);
    const inferredReserve = Number.isFinite(legacyIncrease)
        ? Math.max(0, fuseA - legacyIncrease) : 4;
    const reserveA = Math.max(0, Number(config.houseConnectionReserveA ?? inferredReserve) || 0);
    return {fuseA, reserveA, increaseLimitA: Math.max(0, fuseA - reserveA)};
}

module.exports = {buildNativeMapping, houseConnectionSettings, FIELD_TO_MAPPING, WALLBOX_FIELDS};
