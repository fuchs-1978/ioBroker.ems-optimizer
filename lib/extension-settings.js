'use strict';

// Config-state suffix -> [native Admin field, default]. Kept separate from
// actuator code so startup applies the same values that the UI exposes.
const EXTENSION_SETTINGS = Object.freeze(Object.fromEntries(Object.entries({
    BatteryFineStep_W: ['batteryFineStepW', 100],
    BatteryFineReserve_W: ['batteryFineReserveW', 200],
    BatteryDeadband_W: ['batteryDeadbandW', 50],
    BatteryCycle_s: ['batteryCycleS', 2],
    BatteryFeedbackTimeout_s: ['batteryFeedbackTimeoutS', 15],
    BatteryMeasurementMaxAge_s: ['batteryMeasurementMaxAgeS', 30],
    BatterySoCMaxAge_s: ['batterySoCMaxAgeS', 300],
    BatteryTemperatureMax_C: ['batteryTemperatureMaxC', 50],
    HeatingInhibit: ['heatingInhibit', false],
    HeatingTemperatureMaxAge_s: ['heatingTemperatureMaxAgeS', 3600],
    HeatingCoolingMaxAge_s: ['heatingCoolingMaxAgeS', 120],
    HeatingOutputMaxAge_s: ['heatingOutputMaxAgeS', 120],
    HeatingStopTemperature_C: ['heatingStopTempC', 60],
    HeatingResumeDelta_C: ['heatingResumeDeltaC', 2],
    HeatingMaxStep_W: ['heatingMaxStepW', 1000],
    HeatingSettleTolerance_W: ['heatingSettleToleranceW', 300],
    HeatingOutletEmergency_C: ['heatingOutletEmergencyC', 80],
    HeatPumpAdviceEnabled: ['heatPumpAdviceEnabled', false],
    HeatPumpMinimumHold_s: ['heatPumpMinHoldS', 300],
    HeatPumpPVBoostOn_W: ['heatPumpPvBoostOnW', 2500],
    HeatPumpPVBoostOff_W: ['heatPumpPvBoostOffW', 1200],
    HeatPumpTemperatureMaxAge_s: ['heatPumpTemperatureMaxAgeS', 3600],
    HeatPumpHeatingTarget_C: ['heatPumpHeatingTargetC', 45],
    HeatPumpDHWTarget_C: ['heatPumpDhwTargetC', 60],
    ThermalCheapPriceEnabled: ['thermalCheapPriceEnabled', false],
    ThermalCheapPriceMax_ct_kWh: ['thermalCheapPriceMaxCt', 0],
    ThermalCheapFixedTariffAllowed: ['thermalCheapFixedTariffAllowed', false],
    ThermalCheapGridMax_W: ['thermalCheapGridMaxW', 0]
}).map(([key, value]) => [key, Object.freeze(value)])));

module.exports = {EXTENSION_SETTINGS};
