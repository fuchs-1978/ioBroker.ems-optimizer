createStates();
write(`${CFG.root}.System.Version`, '0.3.0');
write(`${CFG.root}.System.ObsoleteObjects_JSON`, JSON.stringify([
    `${CFG.root}.Forecast.PV_24h_JSON`, `${CFG.root}.Forecast.HouseLoad_24h_JSON`,
    `${CFG.root}.Forecast.Price_24h_JSON`, `${CFG.root}.Forecast.Price_48h_JSON`,
    `${CFG.root}.History.GridImportSamples`, `${CFG.root}.History.GridExportSamples`,
    `${CFG.root}.Config.BatteryTargetSoC_pct`
]));
setTimeout(enableOutputHistory, 5000);
setTimeout(buildHistory, 8000);
setTimeout(observe, 10000);

schedule(`*/${CFG.refreshSeconds} * * * * *`, observe);
schedule(`*/${CFG.forecastRefreshMinutes} * * * *`, buildForecast);
schedule('10 0 * * *', buildHistory);

on({id: [
    `${CFG.root}.Config.DynamicEnergyPriceEnabled`,
    `${CFG.root}.Config.DynamicGridFeeEnabled`,
    `${CFG.root}.Config.FixedEnergyComponent_ct_kWh`,
    `${CFG.root}.Config.FixedGridFee_ct_kWh`,
    `${CFG.root}.Config.DynamicEnergyAdders_ct_kWh`,
    `${CFG.root}.Config.DHWParallelDistributionEnabled`,
    `${CFG.root}.Config.DHWParallelMinimum_W`,
    `${CFG.root}.Config.WallboxPlanWithoutSoC`,
    `${CFG.root}.Config.BatteryCapacity_kWh`,
    `${CFG.root}.Config.BatteryMaxCharge_W`,
    `${CFG.root}.Config.BatteryMaxDischarge_W`,
    `${CFG.root}.Config.BatteryMinSoC_pct`,
    `${CFG.root}.Config.BatteryMorningTargetSoC_pct`,
    `${CFG.root}.Config.BatteryAfternoonTargetSoC_pct`,
    `${CFG.root}.Config.BatteryLateTargetSoC_pct`,
    `${CFG.root}.Config.BatteryFinalChargeReserve_min`,
    `${CFG.root}.Config.BatteryForecastSafetyFactor_pct`,
    `${CFG.root}.Config.BatteryManualSoC_pct`,
    `${CFG.root}.Config.BatteryEfficiency_pct`,
    `${CFG.root}.Config.BatterySelfConsumptionEnabled`,
    `${CFG.root}.Config.MinArbitrageSpread_ct_kWh`,
    `${CFG.root}.Config.DHWVolume_l`,
    `${CFG.root}.Config.DHWMinTemperature_C`,
    `${CFG.root}.Config.DHWTargetTemperature_C`,
    `${CFG.root}.Config.HeatingBufferVolume_l`,
    `${CFG.root}.Config.HeatingBufferTemperature_C`,
    `${CFG.root}.Config.HeatingBufferMinTemperature_C`,
    `${CFG.root}.Config.HeatingBufferTargetTemperature_C`,
    `${CFG.root}.Config.Wallbox0MaxPower_W`,
    `${CFG.root}.Config.Wallbox1MaxPower_W`,
    `${CFG.root}.Config.Wallbox2MaxPower_W`,
    `${CFG.root}.Config.Wallbox0VehicleCapacity_kWh`,
    `${CFG.root}.Config.Wallbox1VehicleCapacity_kWh`,
    `${CFG.root}.Config.Wallbox2VehicleCapacity_kWh`,
    `${CFG.root}.Config.VehicleChargingEfficiency_pct`
], change: 'ne'}, buildForecast);

on({id: [
    ...CFG.dp.wallboxCar,
    ...CFG.dp.wallboxSoc,
    ...CFG.dp.wallboxSocTarget,
    ...CFG.dp.wallboxSocRelease,
    CFG.dp.batterySoc,
    ...CFG.dp.dhwTemps,
    CFG.dp.energyPriceSeries,
    CFG.dp.gridFeeSeries
], change: 'ne'}, requestForecastRebuild);

on({id: [
    `${CFG.root}.Config.WallboxesIncludedInSubmeters`,
    `${CFG.root}.Config.MyPV_DHW_IncludedInSubmeters`,
    `${CFG.root}.Config.MyPV_Heating_IncludedInSubmeters`
], change: 'ne'}, buildHistory);

log('EMS V0.3.0 modularer Beobachter/Fahrplaner gestartet – keine Gerätesteuerung', 'info');
