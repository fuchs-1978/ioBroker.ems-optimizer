createStates();
write(`${CFG.root}.System.Version`, '0.17.0-alpha.2');

// Rebuild all vehicle releases and SoC limits before the productive output
// guard starts. This is especially important after an Admin save: ioBroker
// restarts the adapter, while a running EMS-owned wallbox is intentionally
// kept on for the checked handoff. The output guard must never evaluate stale
// derived MinimumSoC/TargetSoC/Release states from the previous configuration.
updateVehicles();
write(`${CFG.root}.System.ActiveScriptAudit_JSON`, JSON.stringify({
    scope: 'Nur aktive Skripte; deaktivierte Altversionen nicht ausgewertet',
    integrated: [
        'PV_Ueberschuss_Verteilung: feste Wallbox-Grundränge, SoC-Freigabe, Benutzerfreigabe, Fahrzeugstatus und Prioritaet',
        'PV_min_max/SoC: Mindest- und Ziel-SoC, Ladebedarf und Abfahrtszeit',
        'PV_Phasen0/1/2: direkte Erkennung aus drei go-e-Phasenströmen',
        'EHZ-Aufteilen_V5: 50/50-Verteilung mit 4/3-kW- und 9/8-kW-Hysterese',
        'EHZ-Leistung_V2: 9-kW-Grenze und Temperaturkennlinie',
        'PV_Ueberschuss_Stufen/Nacht: 2-s-Batterieregler, 10-s-Lastregler und ganze Ampere ab 6 A',
        'Werte_schreiben_0/1/2_V2: produktive go-e-Freigabe, Ampere-Rampen, Rueckmeldung und Hausanschlussbegrenzung im ALPHA-Modus'
    ],
    intentionallyLocal: [
        'Phasenumschaltung1/2_V2: reale Phasenumschaltung',
        'RFID1_Freischaltung: lokale RFID-Freigabe',
        'Fehler_5: lokale Fehlerquittierung',
        'EHZ-Pumpe_V2 und EHZ-P2FBH: Pumpe, Räume und FBH-PV-Boost'
    ],
    correctedInAdapter: [
        'Phasen werden direkt aus L1/L2/L3 ermittelt; dadurch wirken die Trigger-/L3-Fehler der aktiven Phasenskripte nicht auf den EMS-Plan.',
        'SoC-Zuordnung wird aus den konfigurierten Datenpunkten statt aus fest verdrahteten Fahrzeugnamen gebildet.',
        'Ab 0.13.0 alternativ eine Wallbox im gesicherten Einzeltest: feste Phasen, 6-A-Start und bestaetigte Rueckmeldung; keine automatische Phasenumschaltung.',
        'SoC-Grenzen und Prioritaet optional im Admin; Mindest-SoC hat Vorrang; zwei Reduktionsstufen je Fahrzeug.',
        'Ab 0.14.0: amin0/1/2 und konfigurierbare Mindeststromstufen bei socfrei=2 in Planung, Echtzeit und Produktivausgang.',
        'Ab 0.14.0: zentraler EHZ-/Wallbox-Verteiler; Wallbox als Ampere-Grobstufe, EHZ als stufenloser NVP-Feinregler. Kombination bleibt bis zur separaten Bestaetigung gesperrt.',
        'Ab 0.15.0: EEBUS-LPC als gemeinsames Leistungsbudget der §14a-Verbraucher; richtungsrichtige HA-Phasenleistung. Reale Phasenumschaltung bleibt im externen Skript.',
        'Ab 0.15.1: §14a-Binaerkontakt mit festem Budget; bei gleichzeitigem EEBUS-LPC gilt automatisch das strengere aktive Limit.',
        'Ab 0.15.2: leere Wallbox-Abfahrtszeit bedeutet keine Abfahrt und laesst den gesamten Prognosehorizont frei.',
        'Ab 0.15.3: Wallboxen starten erst nach stabilem Ueberschuss und halten eine Mindestlaufzeit; nicht nutzbares Wallbox-Budget uebernimmt der EHZ.',
        'Ab 0.15.4: Die produktive Mindestlaufzeit startet erst mit dem bestaetigten realen Ausgang; Countdown-Diagnosen sind je Wallbox sichtbar.',
        'Ab 0.15.5: Eine zuvor vom EMS besessene aktive Wallbox wird nach ungeplantem Neustart nur bei vollstaendig gueltiger Sicherheitspruefung ohne Schaltunterbrechung uebernommen.',
        'Ab 0.16.0-alpha.1: Alle drei Wallboxen koennen freigegeben werden; produktiv laedt immer nur eine. Die naechste startet erst nach bestaetigtem AUS der vorherigen; der EHZ bleibt Feinregler.',
        'Ab 0.16.0-alpha.2: Eine bereits produktiv laufende Wallbox startet keinen neuen Einschalt-Countdown; die Timerobjekte zeigen die reale Mindestlaufzeit.',
        'Ab 0.17.0-alpha.1: AP2-Datenquellen sind explizit im Admin konfigurierbar; JSON bleibt Migrations-Fallback. Wallbox/EHZ folgen gemessener Leistung statt vorweggenommenem Sollwert; schnelle EHZ-Einspeisenachfuehrung und unterbrechungsfreie Restart-Uebergabe.',
        'Ab 0.17.0-alpha.2: 50/50 startet exakt ab der konfigurierten Schwelle; unterhalb der Ausschaltschwelle bleibt die Wallbox vorrangig aktiv. SoC-Ableitungen werden vor einer Restart-Uebergabe aktualisiert.'
    ]
}));
write(`${CFG.root}.System.ObsoleteObjects_JSON`, JSON.stringify([
    `${CFG.root}.Forecast.PV_24h_JSON`, `${CFG.root}.Forecast.HouseLoad_24h_JSON`,
    `${CFG.root}.Forecast.Price_24h_JSON`, `${CFG.root}.Forecast.Price_48h_JSON`,
    `${CFG.root}.History.GridImportSamples`, `${CFG.root}.History.GridExportSamples`,
    `${CFG.root}.Config.BatteryTargetSoC_pct`
]));
setTimeout(enableOutputHistory, 5000);
setTimeout(buildHistory, 8000);
setTimeout(updateVehicles, 9000);
setTimeout(updateDhwSimulation, 9500);
setTimeout(observe, 10000);
setTimeout(realtimeControl, 12000);

schedule(`*/${CFG.refreshSeconds} * * * * *`, observe);
schedule('*/30 * * * * *', updateVehicles);
schedule('*/10 * * * * *', updateDhwSimulation);
schedule('*/2 * * * * *', realtimeControl);
schedule('*/5 * * * * *', updateDhwProductionOutput);
schedule('*/2 * * * * *', updateWallboxProductionOutput);
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
    `${CFG.root}.Config.DHWParallelStartPower1P_W`,
    `${CFG.root}.Config.DHWParallelStopPower1P_W`,
    `${CFG.root}.Config.DHWParallelStartPower3P_W`,
    `${CFG.root}.Config.DHWParallelStopPower3P_W`,
    `${CFG.root}.Config.DHWParallelShare_pct`,
    `${CFG.root}.Config.SlowControlCycle_s`,
    `${CFG.root}.Config.WallboxNominalVoltage_V`,
    `${CFG.root}.Config.WallboxMaxStep_A`,
    `${CFG.root}.Config.WallboxCombinedMaxStep_A`,
    `${CFG.root}.Config.WallboxStartReserve_W`,
    `${CFG.root}.Config.WallboxStartDelay_s`,
    `${CFG.root}.Config.WallboxMinimumRunTime_s`,
    `${CFG.root}.Config.DHWMaxStep_W`,
    `${CFG.root}.Config.WallboxPlanWithoutSoC`,
    `${CFG.root}.Config.BatteryCapacity_kWh`,
    `${CFG.root}.Config.BatteryMaxCharge_W`,
    `${CFG.root}.Config.BatteryMaxDischarge_W`,
    `${CFG.root}.Config.BatteryMinSoC_pct`,
    `${CFG.root}.Config.BatteryMaxSoC_pct`,
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
    ...CFG.dp.wallboxManualMinCurrent,
    ...CFG.dp.wallboxMinSoc,
    ...CFG.dp.wallboxAllow,
    ...CFG.dp.wallboxPhases,
    ...CFG.dp.wallboxPhaseCurrents.flat(),
    CFG.dp.wallboxPriority,
    CFG.dp.dhwParallelRelease,
    CFG.dp.batterySoc,
    ...CFG.dp.dhwTemps,
    CFG.dp.energyPriceSeries,
    CFG.dp.gridFeeSeries,
    CFG.dp.dynamicEnergyPriceEnabled,
    CFG.dp.dynamicGridFeeEnabled
], change: 'ne'}, () => {
    updateVehicles();
    requestForecastRebuild();
});

on({id: [
    `${CFG.root}.Vehicles.Wallbox0.DepartureTime`,
    `${CFG.root}.Vehicles.Wallbox1.DepartureTime`,
    `${CFG.root}.Vehicles.Wallbox2.DepartureTime`,
    `${CFG.root}.Vehicles.Wallbox0.Priority`,
    `${CFG.root}.Vehicles.Wallbox1.Priority`,
    `${CFG.root}.Vehicles.Wallbox2.Priority`
], change: 'ne'}, () => {
    updateVehicles();
    requestForecastRebuild();
});

on({id: [
    `${CFG.root}.Config.WallboxesIncludedInSubmeters`,
    `${CFG.root}.Config.MyPV_DHW_IncludedInSubmeters`,
    `${CFG.root}.Config.MyPV_Heating_IncludedInSubmeters`
], change: 'ne'}, buildHistory);

on({id: `${CFG.root}.Config.MinimumBaseload_W`, change: 'ne'}, buildForecast);

on({id: [
    ...CFG.dp.dhwTemps,
    CFG.dp.myPvDhwOutletTemp,
    CFG.dp.myPvDhwConnection,
    CFG.dp.myPvDhwRelease,
    `${CFG.root}.Config.DHWControllerMaxPower_W`,
    `${CFG.root}.Config.DHWControllerStopTemperature_C`,
    `${CFG.root}.Config.DHWControllerResumeTemperature_C`,
    `${CFG.root}.Config.DHWControllerOutletDerating_C`,
    `${CFG.root}.Config.DHWControllerOutletProtection_C`,
    `${CFG.root}.Config.DHWControllerTopEmergencyStop_C`
], change: 'ne'}, updateDhwSimulation);

log('EMS V0.17.0-alpha.2 mit stabiler 50/50- und SoC-Uebergabe gestartet', 'info');
