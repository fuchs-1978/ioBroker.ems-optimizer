/*
 * EMS V0.2 – Beobachter und 48-h-Fahrplaner (keine Gerätesteuerung)
 *
 * HISTORIE
 * 0.2.7 - Batterie wird im verbleibenden PV-Ueberschuss rueckwaerts auf
 *         das spaetestmoegliche sichere Ladefenster verschoben.
 * 0.2.6 - Wallboxplanung mit Fahrzeug-SoC/Ziel/Freigabe; parallele
 *         Verteilung zwischen Trinkwasser-Heizstab und Wallbox;
 *         ereignisgesteuerte, entprellte Neuplanung.
 * 0.2.5 - Dreistufige PV-Ladung der Batterie: morgens 70 %, nachmittags
 *         90 %, spaete Abschlussladung auf 100 % mit Zeitreserve.
 * 0.2.4 - Eigenverbrauchsentladung bei festem Tarif: PV-geladene Energie
 *         darf prognostizierten Netzbezug bis zum Mindest-SoC ersetzen.
 *         Zusaetzliche Kennzahlen zur Bewertung von 10 kWh und 2,4 kW.
 * 0.2.3 - PV-Prognose ohne doppelte kWp-Skalierung; Hauslast und
 *         flexible-lastbereinigte Grundlast als getrennte Prognosen.
 * 0.2.2 - my-PV-Historie nur ueber den historisierten Gesamtwert
 *         javascript.0.ehz.power; keine SQL-Abfragen der Modbus-Ausgaenge.
 * 0.2.1 - ECharts-kompatible json_chart-Objekte fuer Prognosen und Fahrplaene.
 * 0.2.0 - Bedingter 48-h-Gerätefahrplan fuer Batterie (10 kWh,
 *         +/-2,4 kW), zwei my-PV-Heizstaebe, PV-Boost und drei
 *         Wallboxen. Wallboxen werden nur geplant, wenn ein Auto steckt.
 *         Liste alter Objekte unter System.ObsoleteObjects_JSON.
 * 0.1.2 - PV-Historie nur noch Lernbasis; Grundlast aus Wohnhaus 1,
 *         Wohnhaus 2, Diele und Wohnung; Profile je Wochentag/Feiertag;
 *         Energiepreis und Netzentgelt getrennt aktivierbar.
 * 0.1.1 - 48-h-Wetter- und PV-Prognose fuer fuenf PV-Flaechen.
 * 0.1.0 - Erster reiner Beobachtungsmodus.
 *
 * Grundsatz: Historie vor Prognose vor Empfehlung.
 * - liest ausschließlich bestehende Anlagenwerte
 * - bildet aus vier Unterzaehlern getrennte Viertelstundenprofile
 *   fuer jeden Wochentag und fuer Feiertage
 * - zieht konfigurierbar flexible Verbraucher aus der Grundlast ab
 * - nutzt PV-Historie nur als Lernbasis, nicht als Prognoseersatz
 * - erstellt eine rollierende 48-h-Prognose aus realer Open-Meteo-
 *   Einstrahlung fuer alle fuenf PV-Flaechen, Temperatur und Wind
 * - schreibt nur unter 0_userdata.0.EMS.Observer
 * - schaltet weder Wallboxen noch Heizstäbe noch Wärmepumpe
 *
 * Vor dem Start als neues JavaScript-Skript in ioBroker einfuegen.
 */

'use strict';

const CFG = {
    // Wird vom Adapter-Laufzeitmodul vor dem Start durch dessen Namespace ersetzt.
    root: '__ADAPTER_ROOT__',
    sqlInstance: 'sql.0',
    historyDays: 84,
    minHistorySamples: 1344, // mindestens 14 vollstaendige Tage
    forecastSlots: 192,
    dataMaxAgeMs: 120000,
    refreshSeconds: 10,
    forecastRefreshMinutes: 15,

    dp: {
        pvPower: '__DP_PV_POWER__',
        gridImport: '__DP_GRID_IMPORT__',
        gridExport: '__DP_GRID_EXPORT__',
        outsideTemp: '__DP_OUTSIDE_TEMP__',
        dhwTemp: '__DP_DHW_TEMP__',
        energyPriceSeries: '__DP_ENERGY_PRICE_SERIES__',
        gridFeeSeries: '__DP_GRID_FEE_SERIES__',
        holidayToday: '__DP_HOLIDAY_TODAY__',
        holidayTomorrow: '__DP_HOLIDAY_TOMORROW__',
        holidayAfterTomorrow: '__DP_HOLIDAY_AFTER_TOMORROW__',
        weatherHourlyBase: '__DP_WEATHER_HOURLY_BASE__',
        pvForecastBase: '__DP_PV_FORECAST_BASE__',
        haFreePower: '__DP_HA_FREE_POWER__',
        haCritical: '__DP_HA_CRITICAL__',
        par14a: '__DP_PAR14A__',
        lpcState: '__DP_LPC_STATE__',
        lpcLimit: '__DP_LPC_LIMIT__',
        lppState: '__DP_LPP_STATE__',
        lppLimit: '__DP_LPP_LIMIT__',
        batterySoc: '__DP_BATTERY_SOC__',
        batteryPower: '__DP_BATTERY_POWER__',
        wallboxCar: ['__DP_WB0_CAR__', '__DP_WB1_CAR__', '__DP_WB2_CAR__'],
        wallboxSoc: [
            '__DP_WB0_SOC__', '__DP_WB1_SOC__', '__DP_WB2_SOC__'
        ],
        wallboxSocTarget: [
            '__DP_WB0_TARGET__', '__DP_WB1_TARGET__', '__DP_WB2_TARGET__'
        ],
        wallboxSocRelease: [
            '__DP_WB0_RELEASE__', '__DP_WB1_RELEASE__', '__DP_WB2_RELEASE__'
        ],
        dhwTemps: [
            '__DP_DHW_TEMP1__', '__DP_DHW_TEMP2__', '__DP_DHW_TEMP3__', '__DP_DHW_TEMP4__'
        ],
        houseMetersW: [
            '__DP_HOUSE1__', '__DP_HOUSE2__', '__DP_HALL__', '__DP_APARTMENT__'
        ],
        wallboxesKW: [
            '__DP_WB0_POWER__', '__DP_WB1_POWER__', '__DP_WB2_POWER__'
        ],
        myPvDhwW: [
            '__DP_DHW_POWER1__', '__DP_DHW_POWER2__', '__DP_DHW_POWER3__'
        ],
        // Bereits vorgesehen; liefert bis zur Inbetriebnahme 0 / nicht verfügbar.
        myPvHeatingW: [
            '__DP_HEAT_POWER1__', '__DP_HEAT_POWER2__', '__DP_HEAT_POWER3__'
        ],
        // Nur dieser Gesamtwert ist derzeit in SQL historisiert.
        myPvDhwHistoryW: '__DP_DHW_HISTORY__',
        // Beim zweiten my-PV nach Inbetriebnahme dessen historisierten Gesamtwert eintragen.
        myPvHeatingHistoryW: '__DP_HEAT_HISTORY__'
    },

    limits: {
        myPvDhwMaxW: 9000,
        myPvHeatingMaxW: 6000,
        thermalHeaterMaxW: 15000,
        pvBoostMinExpectedW: 2500,
        pvBoostLeadSlots: 8 // zwei Stunden
    },

    pvAreas: [
        {name: '__PV_AREA1_NAME__', kwp: Number('__PV_AREA1_KWP__') || 0},
        {name: '__PV_AREA2_NAME__', kwp: Number('__PV_AREA2_KWP__') || 0},
        {name: '__PV_AREA3_NAME__', kwp: Number('__PV_AREA3_KWP__') || 0},
        {name: '__PV_AREA4_NAME__', kwp: Number('__PV_AREA4_KWP__') || 0},
        {name: '__PV_AREA5_NAME__', kwp: Number('__PV_AREA5_KWP__') || 0}
    ]
};

const DAY_TYPES = [
    'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY',
    'FRIDAY', 'SATURDAY', 'SUNDAY', 'HOLIDAY'
];

let historyProfiles = {
    pv: new Array(96).fill(null),
    houseTotal: Object.fromEntries(DAY_TYPES.map(type => [type, new Array(96).fill(null)])),
    baseload: Object.fromEntries(DAY_TYPES.map(type => [type, new Array(96).fill(null)]))
};
let historyReady = false;
let historyBuilding = false;
let forecastRebuildTimer = null;

function stateDef(id, value, type, role, unit, name) {
    const common = {name, type, role, read: true, write: false};
    if (unit) common.unit = unit;
    createState(id, value, common);
}

function configDef(id, value, type, role, unit, name) {
    const common = {name, type, role, read: true, write: true};
    if (unit) common.unit = unit;
    createState(id, value, common);
}

function createStates() {
    const r = CFG.root;
    stateDef(`${r}.System.Version`, '0.2.7', 'string', 'text', '', 'EMS-Version');
    stateDef(`${r}.System.Mode`, 'OBSERVER', 'string', 'text', '', 'Betriebsart');
    stateDef(`${r}.System.NoActuation`, true, 'boolean', 'indicator', '', 'Keine Gerätesteuerung');
    stateDef(`${r}.System.Status`, 'Start', 'string', 'text', '', 'Status');
    stateDef(`${r}.System.LastUpdate`, 0, 'number', 'value.time', '', 'Letzte Aktualisierung');
    stateDef(`${r}.System.DataValid`, false, 'boolean', 'indicator', '', 'Eingangsdaten gültig');
    stateDef(`${r}.System.InvalidInputs_JSON`, '[]', 'string', 'json', '', 'Ungültige Eingänge');
    stateDef(`${r}.System.ObsoleteObjects_JSON`, JSON.stringify([
        `${r}.Forecast.PV_24h_JSON`, `${r}.Forecast.HouseLoad_24h_JSON`,
        `${r}.Forecast.Price_24h_JSON`, `${r}.Forecast.Price_48h_JSON`,
        `${r}.History.GridImportSamples`, `${r}.History.GridExportSamples`,
        `${r}.Config.BatteryTargetSoC_pct`
    ]), 'string', 'json', '', 'Alte Objekte, die manuell geloescht werden koennen');

    configDef(`${r}.Config.DynamicEnergyPriceEnabled`, false, 'boolean', 'switch.enable', '', 'Dynamischen Energiepreis verwenden');
    configDef(`${r}.Config.DynamicGridFeeEnabled`, false, 'boolean', 'switch.enable', '', 'Dynamisches Netzentgelt verwenden');
    configDef(`${r}.Config.FixedEnergyComponent_ct_kWh`, 22.85, 'number', 'value', 'ct/kWh', 'Fester Preisanteil ohne Netzentgelt');
    configDef(`${r}.Config.FixedGridFee_ct_kWh`, 6.04, 'number', 'value', 'ct/kWh', 'Festes Netzentgelt');
    configDef(`${r}.Config.DynamicEnergyAdders_ct_kWh`, 9.301, 'number', 'value', 'ct/kWh', 'Aufschlaege auf Boersenpreis ohne Netzentgelt');
    configDef(`${r}.Config.WallboxesIncludedInSubmeters`, true, 'boolean', 'switch.enable', '', 'Wallboxen stecken in Unterzaehlern');
    configDef(`${r}.Config.MyPV_DHW_IncludedInSubmeters`, true, 'boolean', 'switch.enable', '', 'my-PV Trinkwasser steckt in Unterzaehlern');
    configDef(`${r}.Config.MyPV_Heating_IncludedInSubmeters`, false, 'boolean', 'switch.enable', '', 'my-PV Heizung steckt in Unterzaehlern');
    configDef(`${r}.Config.DHWParallelDistributionEnabled`, true, 'boolean', 'switch.enable', '', 'Trinkwasser und Wallbox parallel planen');
    configDef(`${r}.Config.DHWParallelMinimum_W`, 2000, 'number', 'value.power', 'W', 'Trinkwasser Mindestleistung bei paralleler Planung');
    configDef(`${r}.Config.WallboxPlanWithoutSoC`, false, 'boolean', 'switch.enable', '', 'Wallbox bei fehlendem Fahrzeug-SoC planen');
    configDef(`${r}.Config.BatteryCapacity_kWh`, 10, 'number', 'value', 'kWh', 'Batteriekapazitaet');
    configDef(`${r}.Config.BatteryMaxCharge_W`, 2400, 'number', 'value.power', 'W', 'Batterie maximale Ladeleistung');
    configDef(`${r}.Config.BatteryMaxDischarge_W`, 2400, 'number', 'value.power', 'W', 'Batterie maximale Entladeleistung');
    configDef(`${r}.Config.BatteryMinSoC_pct`, 15, 'number', 'value', '%', 'Batterie Mindest-SoC');
    configDef(`${r}.Config.BatteryMorningTargetSoC_pct`, 70, 'number', 'value', '%', 'Batterie Ziel-SoC morgens');
    configDef(`${r}.Config.BatteryAfternoonTargetSoC_pct`, 90, 'number', 'value', '%', 'Batterie Ziel-SoC nachmittags');
    configDef(`${r}.Config.BatteryLateTargetSoC_pct`, 100, 'number', 'value', '%', 'Batterie Ziel-SoC spaet');
    configDef(`${r}.Config.BatteryFinalChargeReserve_min`, 45, 'number', 'value.interval', 'min', 'Zeitreserve fuer Abschlussladung');
    configDef(`${r}.Config.BatteryForecastSafetyFactor_pct`, 80, 'number', 'value', '%', 'Sicher nutzbarer Anteil des Rest-PV-Ueberschusses');
    configDef(`${r}.Config.BatteryManualSoC_pct`, 50, 'number', 'value', '%', 'Batterie Ersatz-SoC');
    configDef(`${r}.Config.BatteryEfficiency_pct`, 92, 'number', 'value', '%', 'Batterie Wirkungsgrad');
    configDef(`${r}.Config.BatterySelfConsumptionEnabled`, true, 'boolean', 'switch.enable', '', 'Batterie fuer Eigenverbrauch entladen');
    configDef(`${r}.Config.MinArbitrageSpread_ct_kWh`, 4, 'number', 'value', 'ct/kWh', 'Mindestpreisspreizung fuer Netzladen');
    configDef(`${r}.Config.DHWVolume_l`, 500, 'number', 'value', 'l', 'Trinkwasservolumen');
    configDef(`${r}.Config.DHWMinTemperature_C`, 48, 'number', 'value.temperature', '°C', 'Trinkwasser Mindesttemperatur');
    configDef(`${r}.Config.DHWTargetTemperature_C`, 60, 'number', 'value.temperature', '°C', 'Trinkwasser Zieltemperatur');
    configDef(`${r}.Config.HeatingBufferVolume_l`, 400, 'number', 'value', 'l', 'Heizpuffervolumen');
    configDef(`${r}.Config.HeatingBufferTemperature_C`, 40, 'number', 'value.temperature', '°C', 'Heizpuffer Temperatur bis Sensor vorhanden');
    configDef(`${r}.Config.HeatingBufferMinTemperature_C`, 35, 'number', 'value.temperature', '°C', 'Heizpuffer Mindesttemperatur');
    configDef(`${r}.Config.HeatingBufferTargetTemperature_C`, 50, 'number', 'value.temperature', '°C', 'Heizpuffer Zieltemperatur');
    configDef(`${r}.Config.Wallbox0MaxPower_W`, 11000, 'number', 'value.power', 'W', 'Wallbox 0 Planungsgrenze');
    configDef(`${r}.Config.Wallbox1MaxPower_W`, 11000, 'number', 'value.power', 'W', 'Wallbox 1 Planungsgrenze');
    configDef(`${r}.Config.Wallbox2MaxPower_W`, 11000, 'number', 'value.power', 'W', 'Wallbox 2 Planungsgrenze');
    configDef(`${r}.Config.Wallbox0VehicleCapacity_kWh`, 90.6, 'number', 'value.energy', 'kWh', 'Fahrzeugkapazitaet Wallbox 0');
    configDef(`${r}.Config.Wallbox1VehicleCapacity_kWh`, 90, 'number', 'value.energy', 'kWh', 'Fahrzeugkapazitaet Wallbox 1');
    configDef(`${r}.Config.Wallbox2VehicleCapacity_kWh`, 32.3, 'number', 'value.energy', 'kWh', 'Fahrzeugkapazitaet Wallbox 2');
    configDef(`${r}.Config.VehicleChargingEfficiency_pct`, 90, 'number', 'value', '%', 'Ladewirkungsgrad Fahrzeuge');

    stateDef(`${r}.History.Ready`, false, 'boolean', 'indicator', '', 'Historische Basis verfügbar');
    stateDef(`${r}.History.Building`, false, 'boolean', 'indicator.working', '', 'Historie wird ausgewertet');
    stateDef(`${r}.History.Days`, CFG.historyDays, 'number', 'value', 'd', 'Historienzeitraum');
    stateDef(`${r}.History.PVSamples`, 0, 'number', 'value', '', 'PV-Lernwerte');
    stateDef(`${r}.History.SubmeterSamples`, 0, 'number', 'value', '', 'Gemeinsame Unterzaehler-Historienwerte');
    stateDef(`${r}.History.LastBuild`, 0, 'number', 'value.time', '', 'Letzte Historienbildung');
    stateDef(`${r}.History.Status`, 'Noch nicht aufgebaut', 'string', 'text', '', 'Historienstatus');
    stateDef(`${r}.History.Profiles_JSON`, '{}', 'string', 'json', '', 'Verfuegbare Tagestyp-Profile');

    stateDef(`${r}.Actual.PV_W`, 0, 'number', 'value.power.production', 'W', 'PV-Leistung');
    stateDef(`${r}.Actual.GridImport_W`, 0, 'number', 'value.power.consumption', 'W', 'Netzbezug');
    stateDef(`${r}.Actual.GridExport_W`, 0, 'number', 'value.power.production', 'W', 'Einspeisung');
    stateDef(`${r}.Actual.GridPower_W`, 0, 'number', 'value.power', 'W', 'Netzleistung positiv Bezug');
    stateDef(`${r}.Actual.HouseLoad_W`, 0, 'number', 'value.power.consumption', 'W', 'Berechnete Hauslast');
    stateDef(`${r}.Actual.SubmetersTotal_W`, 0, 'number', 'value.power.consumption', 'W', 'Summe der vier Unterzaehler');
    stateDef(`${r}.Actual.Baseload_W`, 0, 'number', 'value.power.consumption', 'W', 'Grundlast ohne enthaltene flexible Verbraucher');
    stateDef(`${r}.Actual.House1_W`, 0, 'number', 'value.power.consumption', 'W', 'Wohnhaus 1');
    stateDef(`${r}.Actual.House2_W`, 0, 'number', 'value.power.consumption', 'W', 'Wohnhaus 2');
    stateDef(`${r}.Actual.Hall_W`, 0, 'number', 'value.power.consumption', 'W', 'Diele');
    stateDef(`${r}.Actual.Apartment_W`, 0, 'number', 'value.power.consumption', 'W', 'Wohnung');
    stateDef(`${r}.Actual.Wallboxes_W`, 0, 'number', 'value.power.consumption', 'W', 'Wallboxen gesamt');
    stateDef(`${r}.Actual.MyPV_DHW_W`, 0, 'number', 'value.power.consumption', 'W', 'my-PV Trinkwasser');
    stateDef(`${r}.Actual.MyPV_Heating_W`, 0, 'number', 'value.power.consumption', 'W', 'my-PV Heizpuffer');
    stateDef(`${r}.Actual.FlexibleLoads_W`, 0, 'number', 'value.power.consumption', 'W', 'Flexible Verbraucher');
    stateDef(`${r}.Actual.OutsideTemperature_C`, 0, 'number', 'value.temperature', '°C', 'Außentemperatur');
    stateDef(`${r}.Actual.DHWTemperature_C`, 0, 'number', 'value.temperature', '°C', 'Trinkwasserspeicher');
    stateDef(`${r}.Actual.HAFreePower_W`, 0, 'number', 'value.power', 'W', 'Freie Hausanschlussleistung');

    stateDef(`${r}.Forecast.PV_48h_JSON`, '[]', 'string', 'json', '', 'PV-Prognose 48 h');
    stateDef(`${r}.Forecast.HouseLoad_48h_JSON`, '[]', 'string', 'json', '', 'Hauslastprognose 48 h');
    stateDef(`${r}.Forecast.Baseload_48h_JSON`, '[]', 'string', 'json', '', 'Grundlastprognose ohne flexible Verbraucher 48 h');
    stateDef(`${r}.Forecast.Weather_48h_JSON`, '[]', 'string', 'json', '', 'Wetterprognose 48 h');
    stateDef(`${r}.Forecast.EnergyPrice_48h_JSON`, '[]', 'string', 'json', '', 'Energiepreissignal 48 h');
    stateDef(`${r}.Forecast.GridFee_48h_JSON`, '[]', 'string', 'json', '', 'Netzentgeltsignal 48 h');
    stateDef(`${r}.Forecast.TotalPrice_48h_JSON`, '[]', 'string', 'json', '', 'Wirksamer Gesamtpreis 48 h');
    stateDef(`${r}.Forecast.PriceMode`, '', 'string', 'text', '', 'Aktive Preisquellen');
    stateDef(`${r}.Forecast.HeatDemandIndex_48h_JSON`, '[]', 'string', 'json', '', 'Relativer Waermebedarfsindex 48 h');
    stateDef(`${r}.Forecast.PVNext2h_Wh`, 0, 'number', 'value.energy', 'Wh', 'PV-Prognose nächste 2 h');
    stateDef(`${r}.Forecast.Confidence_pct`, 0, 'number', 'value', '%', 'Prognosevertrauen');
    stateDef(`${r}.Forecast.Source`, 'SQL-Tagestypen + Open-Meteo PV/Wetter', 'string', 'text', '', 'Prognosequelle');
    stateDef(`${r}.Forecast.WeatherValid`, false, 'boolean', 'indicator', '', 'Wetterprognose gueltig');
    stateDef(`${r}.Forecast.DayTypes_JSON`, '[]', 'string', 'json', '', 'Verwendete Tagestypen');
    stateDef(`${r}.Forecast.LastUpdate`, 0, 'number', 'value.time', '', 'Letzte Prognose');

    stateDef(`${r}.Plan.Valid`, false, 'boolean', 'indicator', '', 'Fahrplan gueltig');
    stateDef(`${r}.Plan.Status`, 'Noch nicht berechnet', 'string', 'text', '', 'Fahrplanstatus');
    stateDef(`${r}.Plan.LastUpdate`, 0, 'number', 'value.time', '', 'Letzte Fahrplanberechnung');
    stateDef(`${r}.Plan.BatterySoCSource`, '', 'string', 'text', '', 'Quelle des Batterie-SoC');
    stateDef(`${r}.Plan.BatteryStage_48h_JSON`, '[]', 'string', 'json', '', 'Batterie-Ladestufe 48 h');
    stateDef(`${r}.Plan.BatteryTargetSoC_48h_JSON`, '[]', 'string', 'json', '', 'Batterie Ziel-SoC 48 h');
    ['BatteryPower', 'BatterySoC', 'MyPV_DHW', 'MyPV_Heating', 'PVBoost',
        'Wallbox0', 'Wallbox1', 'Wallbox2', 'GridPower'].forEach(name =>
        stateDef(`${r}.Plan.${name}_48h_JSON`, '[]', 'string', 'json', '', `${name} Fahrplan 48 h`));
    stateDef(`${r}.Plan.ExpectedImport_kWh`, 0, 'number', 'value.energy', 'kWh', 'Erwarteter Netzbezug');
    stateDef(`${r}.Plan.ExpectedExport_kWh`, 0, 'number', 'value.energy', 'kWh', 'Erwartete Einspeisung');
    stateDef(`${r}.Plan.ConnectedWallboxes_JSON`, '[]', 'string', 'json', '', 'Beim Planen angeschlossene Wallboxen');
    stateDef(`${r}.Plan.WallboxStatus_JSON`, '[]', 'string', 'json', '', 'Wallbox Ladebedarf und Begruendung');

    stateDef(`${r}.Evaluation.BatteryMaxPlannedCharge_W`, 0, 'number', 'value.power', 'W', 'Maximal geplante Batterieladung');
    stateDef(`${r}.Evaluation.BatteryMaxPlannedDischarge_W`, 0, 'number', 'value.power', 'W', 'Maximal geplante Batterieentladung');
    stateDef(`${r}.Evaluation.BatteryAtMinSoC_h`, 0, 'number', 'value.interval', 'h', 'Zeit am Mindest-SoC');
    stateDef(`${r}.Evaluation.BatteryAtTargetSoC_h`, 0, 'number', 'value.interval', 'h', 'Zeit am Ziel-SoC');
    stateDef(`${r}.Evaluation.RemainingGridImport_kWh`, 0, 'number', 'value.energy', 'kWh', 'Verbleibender Netzbezug im Plan');
    stateDef(`${r}.Evaluation.RemainingPVExport_kWh`, 0, 'number', 'value.energy', 'kWh', 'Verbleibender PV-Export im Plan');
    stateDef(`${r}.Evaluation.AdditionalShiftPotential_kWh`, 0, 'number', 'value.energy', 'kWh', 'Obere Abschaetzung fuer zusaetzlich verschiebbare Energie');
    stateDef(`${r}.Evaluation.BatterySizingHint`, '', 'string', 'text', '', 'Hinweis zur Batterieauslegung');

    [
        ['PV_48h_json_chart', 'PV-Prognose'],
        ['HouseLoad_48h_json_chart', 'Hauslastprognose'],
        ['Baseload_48h_json_chart', 'Grundlastprognose ohne flexible Verbraucher'],
        ['OutsideTemperature_48h_json_chart', 'Aussentemperaturprognose'],
        ['HeatDemandIndex_48h_json_chart', 'Waermebedarfsindex'],
        ['EnergyPrice_48h_json_chart', 'Energiepreis'],
        ['GridFee_48h_json_chart', 'Netzentgelt'],
        ['TotalPrice_48h_json_chart', 'Gesamtstrompreis'],
        ['BatteryPower_48h_json_chart', 'Batterieleistung'],
        ['BatterySoC_48h_json_chart', 'Batterie-SoC'],
        ['BatteryTargetSoC_48h_json_chart', 'Batterie Ziel-SoC'],
        ['MyPV_DHW_48h_json_chart', 'my-PV Trinkwasser'],
        ['MyPV_Heating_48h_json_chart', 'my-PV Heizpuffer'],
        ['PVBoostBudget_48h_json_chart', 'PV-Boost-Budget'],
        ['Wallbox0_48h_json_chart', 'Wallbox 0'],
        ['Wallbox1_48h_json_chart', 'Wallbox 1'],
        ['Wallbox2_48h_json_chart', 'Wallbox 2'],
        ['GridPower_48h_json_chart', 'Erwartete Netzleistung']
    ].forEach(([id, name]) => stateDef(`${r}.Chart.${id}`, '[]', 'string', 'json', '', `${name} fuer ECharts`));

    stateDef(`${r}.Capacity.MyPV_DHW_Max_W`, CFG.limits.myPvDhwMaxW, 'number', 'value.power', 'W', 'my-PV Trinkwasser maximal');
    stateDef(`${r}.Capacity.MyPV_Heating_Max_W`, CFG.limits.myPvHeatingMaxW, 'number', 'value.power', 'W', 'my-PV Heizpuffer maximal');
    stateDef(`${r}.Capacity.HeatersTotal_Max_W`, CFG.limits.thermalHeaterMaxW, 'number', 'value.power', 'W', 'Heizstäbe gesamt maximal');

    stateDef(`${r}.Recommendation.Valid`, false, 'boolean', 'indicator', '', 'Empfehlung gültig');
    stateDef(`${r}.Recommendation.PVBoostRelease`, false, 'boolean', 'indicator', '', 'Empfohlene PV-Boost-Freigabe');
    stateDef(`${r}.Recommendation.PVBoostAvailable_W`, 0, 'number', 'value.power', 'W', 'Für PV-Boost verfügbares Budget');
    stateDef(`${r}.Recommendation.MyPV_DHW_W`, 0, 'number', 'value.power', 'W', 'Empfehlung my-PV Trinkwasser');
    stateDef(`${r}.Recommendation.MyPV_Heating_W`, 0, 'number', 'value.power', 'W', 'Empfehlung my-PV Heizpuffer');
    stateDef(`${r}.Recommendation.Reason`, 'Historie wird aufgebaut', 'string', 'text', '', 'Begründung');
    stateDef(`${r}.Recommendation.GeneratedAt`, 0, 'number', 'value.time', '', 'Empfehlung berechnet');
}

function readNumber(id, fallback = 0) {
    try {
        if (!existsState(id)) return fallback;
        const s = getState(id);
        const n = Number(s && s.val);
        return Number.isFinite(n) ? n : fallback;
    } catch (_) {
        return fallback;
    }
}

function readFreshNumber(id, invalid, required = true) {
    try {
        if (!existsState(id)) {
            if (required) invalid.push(`${id}: fehlt`);
            return 0;
        }
        const s = getState(id);
        const n = Number(s && s.val);
        if (!Number.isFinite(n)) {
            if (required) invalid.push(`${id}: ungültig`);
            return 0;
        }
        if (Date.now() - Number(s.ts || 0) > CFG.dataMaxAgeMs) {
            if (required) invalid.push(`${id}: veraltet`);
        }
        return n;
    } catch (e) {
        if (required) invalid.push(`${id}: Lesefehler`);
        return 0;
    }
}

function sum(ids, multiplier = 1) {
    return ids.reduce((total, id) => total + readNumber(id, 0) * multiplier, 0);
}

function write(id, value) {
    try {
        const old = getState(id);
        if (!old || old.val !== value) setState(id, value, true);
    } catch (e) {
        log(`EMS Observer: Schreiben fehlgeschlagen ${id}: ${e}`, 'warn');
    }
}

// Format wie open-meteo-weather ... json_chart: [{"ts": ..., "val": ...}]
function chartJson(series, value) {
    return JSON.stringify(series.map(item => {
        const raw = value(item);
        const ts = Number(item.timestamp);
        const val = raw === null || raw === undefined ? NaN : Number(raw);
        return {ts: String(ts), val};
    }).filter(item => item.ts !== 'NaN' && Number.isFinite(item.val)));
}

function enableOutputHistory() {
    const ids = [
        `${CFG.root}.Actual.PV_W`,
        `${CFG.root}.Actual.GridPower_W`,
        `${CFG.root}.Actual.HouseLoad_W`,
        `${CFG.root}.Actual.SubmetersTotal_W`,
        `${CFG.root}.Actual.Baseload_W`,
        `${CFG.root}.Actual.House1_W`,
        `${CFG.root}.Actual.House2_W`,
        `${CFG.root}.Actual.Hall_W`,
        `${CFG.root}.Actual.Apartment_W`,
        `${CFG.root}.Actual.Wallboxes_W`,
        `${CFG.root}.Actual.MyPV_DHW_W`,
        `${CFG.root}.Actual.MyPV_Heating_W`,
        `${CFG.root}.Recommendation.PVBoostAvailable_W`,
        `${CFG.root}.Recommendation.MyPV_DHW_W`,
        `${CFG.root}.Recommendation.MyPV_Heating_W`
    ];
    ids.forEach(id => sendTo(CFG.sqlInstance, 'enableHistory', {
        id,
        options: {
            enabled: true,
            changesOnly: true,
            debounceTime: 0,
            retention: 63072000,
            changesRelogInterval: 900
        }
    }));
}

function getHistory(id, start, end) {
    return new Promise(resolve => {
        sendTo(CFG.sqlInstance, 'getHistory', {
            id,
            options: {
                start,
                end,
                aggregate: 'average',
                step: 15 * 60 * 1000,
                addId: false,
                limit: 10000
            }
        }, result => {
            if (!result || result.error || !Array.isArray(result.result)) {
                resolve([]);
                return;
            }
            resolve(result.result.filter(x => Number.isFinite(Number(x.val))));
        });
    });
}

function slotOf(ts) {
    const d = new Date(Number(ts));
    return d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
}

function profile(values, filter) {
    const buckets = Array.from({length: 96}, () => []);
    values.forEach(x => {
        if (!filter || filter(new Date(Number(x.ts)))) {
            buckets[slotOf(x.ts)].push(Number(x.val));
        }
    });
    return buckets.map(list => {
        if (!list.length) return null;
        list.sort((a, b) => a - b);
        // Median ist robuster gegen einzelne Lade- und Heizspitzen.
        const m = Math.floor(list.length / 2);
        return Math.round(list.length % 2 ? list[m] : (list[m - 1] + list[m]) / 2);
    });
}

function mergeSubmeterProfile(meterSeries, flexibleSeries) {
    const byTs = new Map();
    const round = ts => Math.floor(Number(ts) / 900000) * 900000;
    meterSeries.forEach((series, index) => series.forEach(x => {
        const k = round(x.ts);
        const o = byTs.get(k) || {meters: [], flexibleW: 0};
        o.meters[index] = Number(x.val);
        byTs.set(k, o);
    }));
    flexibleSeries.forEach(item => item.series.forEach(x => {
        const k = round(x.ts);
        const o = byTs.get(k) || {meters: [], flexibleW: 0};
        o.flexibleW += Number(x.val) * item.multiplier;
        byTs.set(k, o);
    }));
    const totalValues = [];
    const baseloadValues = [];
    byTs.forEach((o, ts) => {
        if (o.meters.length === meterSeries.length && o.meters.every(Number.isFinite)) {
            const meterTotalW = o.meters.reduce((sumValue, value) => sumValue + value, 0);
            totalValues.push({ts, val: Math.max(0, meterTotalW)});
            baseloadValues.push({ts, val: Math.max(0, meterTotalW - o.flexibleW)});
        }
    });
    return {totalValues, baseloadValues};
}

function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
}

function isHolidayNI(date) {
    const key = `${date.getMonth() + 1}-${date.getDate()}`;
    if (['1-1', '5-1', '10-3', '10-31', '12-25', '12-26'].includes(key)) return true;
    const easter = easterSunday(date.getFullYear());
    const offset = calendarDayNumber(date) - calendarDayNumber(easter);
    return [-2, 1, 39, 50].includes(offset); // Karfreitag, Ostermontag, Himmelfahrt, Pfingstmontag
}

function historicDayType(date) {
    if (isHolidayNI(date)) return 'HOLIDAY';
    return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][date.getDay()];
}

function forecastDayType(date, dayOffset) {
    const holidayIds = [CFG.dp.holidayToday, CFG.dp.holidayTomorrow, CFG.dp.holidayAfterTomorrow];
    const holiday = dayOffset >= 0 && dayOffset < holidayIds.length
        ? Boolean(getState(holidayIds[dayOffset])?.val)
        : false;
    if (holiday || isHolidayNI(date)) return 'HOLIDAY';
    return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][date.getDay()];
}

function calendarDayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function localDateKey(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function buildHistory() {
    if (historyBuilding) return;
    historyBuilding = true;
    write(`${CFG.root}.History.Building`, true);
    write(`${CFG.root}.History.Status`, 'SQL-Historie wird ausgewertet');

    const end = Date.now();
    const start = end - CFG.historyDays * 86400000;
    try {
        const historyIds = [
            CFG.dp.pvPower,
            ...CFG.dp.houseMetersW,
            ...CFG.dp.wallboxesKW,
            ...(CFG.dp.myPvDhwHistoryW ? [CFG.dp.myPvDhwHistoryW] : []),
            ...(CFG.dp.myPvHeatingHistoryW ? [CFG.dp.myPvHeatingHistoryW] : [])
        ];
        const result = await Promise.all(historyIds.map(id => getHistory(id, start, end)));
        let cursor = 0;
        const pv = result[cursor++];
        const meters = CFG.dp.houseMetersW.map(() => result[cursor++]);
        const wallboxes = CFG.dp.wallboxesKW.map(() => result[cursor++]);
        const myPvDhw = CFG.dp.myPvDhwHistoryW ? result[cursor++] : [];
        const myPvHeating = CFG.dp.myPvHeatingHistoryW ? result[cursor++] : [];
        const flexibleSeries = [];
        if (Boolean(getState(`${CFG.root}.Config.WallboxesIncludedInSubmeters`)?.val)) {
            wallboxes.forEach(series => flexibleSeries.push({series, multiplier: 1000}));
        }
        if (Boolean(getState(`${CFG.root}.Config.MyPV_DHW_IncludedInSubmeters`)?.val)) {
            flexibleSeries.push({series: myPvDhw, multiplier: 1});
        }
        if (Boolean(getState(`${CFG.root}.Config.MyPV_Heating_IncludedInSubmeters`)?.val)) {
            if (myPvHeating.length) flexibleSeries.push({series: myPvHeating, multiplier: 1});
        }
        const house = mergeSubmeterProfile(meters, flexibleSeries);
        historyProfiles.pv = profile(pv);
        DAY_TYPES.forEach(type => {
            historyProfiles.houseTotal[type] = profile(house.totalValues, d => historicDayType(d) === type);
            historyProfiles.baseload[type] = profile(house.baseloadValues, d => historicDayType(d) === type);
        });
        const profileCounts = {
            houseTotal: Object.fromEntries(Object.entries(historyProfiles.houseTotal)
                .map(([type, values]) => [type, values.filter(Number.isFinite).length])),
            baseload: Object.fromEntries(Object.entries(historyProfiles.baseload)
                .map(([type, values]) => [type, values.filter(Number.isFinite).length]))
        };
        const weekdayProfilesReady = [
            'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY',
            'FRIDAY', 'SATURDAY', 'SUNDAY'
        ].every(type => profileCounts.houseTotal[type] >= 90 && profileCounts.baseload[type] >= 90);
        historyReady = house.totalValues.length >= CFG.minHistorySamples && weekdayProfilesReady;

        write(`${CFG.root}.History.PVSamples`, pv.length);
        write(`${CFG.root}.History.SubmeterSamples`, Math.min(...meters.map(series => series.length)));
        write(`${CFG.root}.History.Ready`, historyReady);
        write(`${CFG.root}.History.Profiles_JSON`, JSON.stringify(profileCounts));
        write(`${CFG.root}.History.LastBuild`, Date.now());
        write(`${CFG.root}.History.Status`, historyReady
            ? `Bereit: ${house.totalValues.length} Hauslast-/Grundlastwerte; ${pv.length} PV-Lernwerte`
            : `Zu wenig Unterzaehler-Historie: ${house.totalValues.length} gemeinsame Werte`);
        buildForecast();
    } catch (e) {
        historyReady = false;
        write(`${CFG.root}.History.Ready`, false);
        write(`${CFG.root}.History.Status`, `Fehler: ${e}`);
        log(`EMS Observer Historienfehler: ${e}`, 'warn');
    } finally {
        historyBuilding = false;
        write(`${CFG.root}.History.Building`, false);
    }
}

function safeJson(id, fallback) {
    try {
        const s = getState(id);
        const parsed = JSON.parse(s && s.val);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

function seriesValueAt(series, timestamp) {
    if (!Array.isArray(series) || !series.length) return null;
    const hourTs = Math.floor(timestamp / 3600000) * 3600000;
    const exact = series.find(item => Number(item.ts) === hourTs);
    if (exact && Number.isFinite(Number(exact.val))) return Number(exact.val);
    return null;
}

function buildPriceForecast(startTs) {
    const dynamicEnergyEnabled = Boolean(getState(`${CFG.root}.Config.DynamicEnergyPriceEnabled`)?.val);
    const dynamicGridEnabled = Boolean(getState(`${CFG.root}.Config.DynamicGridFeeEnabled`)?.val);
    const fixedEnergy = readNumber(`${CFG.root}.Config.FixedEnergyComponent_ct_kWh`, 22.85);
    const fixedGrid = readNumber(`${CFG.root}.Config.FixedGridFee_ct_kWh`, 6.04);
    const dynamicAdders = readNumber(`${CFG.root}.Config.DynamicEnergyAdders_ct_kWh`, 9.301);
    const energySeries = safeJson(CFG.dp.energyPriceSeries, []);
    const gridSeries = safeJson(CFG.dp.gridFeeSeries, []);
    const energy = [];
    const grid = [];
    const total = [];
    for (let i = 0; i < CFG.forecastSlots; i++) {
        const timestamp = startTs + i * 900000;
        const dynamicEnergy = seriesValueAt(energySeries, timestamp);
        const dynamicGrid = seriesValueAt(gridSeries, timestamp);
        const energyCt = dynamicEnergyEnabled && dynamicEnergy !== null
            ? dynamicEnergy + dynamicAdders
            : fixedEnergy;
        const gridCt = dynamicGridEnabled && dynamicGrid !== null
            ? dynamicGrid
            : fixedGrid;
        energy.push({timestamp, offsetMin: i * 15, value_ct_kWh: Math.round(energyCt * 1000) / 1000,
            source: dynamicEnergyEnabled && dynamicEnergy !== null ? 'dynamic' : 'fixed'});
        grid.push({timestamp, offsetMin: i * 15, value_ct_kWh: Math.round(gridCt * 1000) / 1000,
            source: dynamicGridEnabled && dynamicGrid !== null ? 'dynamic' : 'fixed'});
        total.push({timestamp, offsetMin: i * 15,
            value_ct_kWh: Math.round((energyCt + gridCt) * 1000) / 1000});
    }
    return {
        energy,
        grid,
        total,
        mode: `Energie=${dynamicEnergyEnabled ? 'dynamisch' : 'fest'}, Netz=${dynamicGridEnabled ? 'dynamisch' : 'fest'}`
    };
}

function readOptionalNumber(id) {
    if (!existsState(id)) return null;
    const n = Number(getState(id)?.val);
    return Number.isFinite(n) ? n : null;
}

function weatherHours() {
    const result = [];
    for (let hour = 0; hour < 48; hour++) {
        const weatherBase = `${CFG.dp.weatherHourlyBase}.hour${hour}`;
        const pvWeatherBase = `${CFG.dp.pvForecastBase}.Carport.hourly-forecast.hour${hour}`;
        const timestamp = readOptionalNumber(`${weatherBase}.date`)
            ?? readOptionalNumber(`${pvWeatherBase}.unix_time_stamp`);
        const temperatureC = readOptionalNumber(`${weatherBase}.temperature_2m`)
            ?? readOptionalNumber(`${pvWeatherBase}.temperature_2m`);
        const windKmh = readOptionalNumber(`${weatherBase}.wind_speed_10m`)
            ?? readOptionalNumber(`${pvWeatherBase}.wind_speed_10m`);
        const cloudPct = readOptionalNumber(`${weatherBase}.cloud_cover`);
        let pvW = 0;
        let irradianceValid = true;
        CFG.pvAreas.forEach(area => {
            const base = `${CFG.dp.pvForecastBase}.${area.name}.hourly-forecast.hour${hour}`;
            const gti = readOptionalNumber(`${base}.global_tilted_irradiance`);
            if (gti === null) irradianceValid = false;
            // Der Adapterwert ist bei dieser Instanz bereits die auf die
            // konfigurierte PV-Flaeche umgerechnete Leistung in Watt.
            else pvW += gti;
        });
        if (timestamp !== null && temperatureC !== null && windKmh !== null && irradianceValid) {
            result.push({timestamp, temperatureC, windKmh, cloudPct, pvW: Math.round(pvW)});
        }
    }
    return result;
}

function nearestWeather(hours, timestamp) {
    if (!hours.length) return null;
    let best = hours[0];
    let distance = Math.abs(hours[0].timestamp - timestamp);
    for (let i = 1; i < hours.length; i++) {
        const currentDistance = Math.abs(hours[i].timestamp - timestamp);
        if (currentDistance < distance) {
            best = hours[i];
            distance = currentDistance;
        }
    }
    return distance <= 45 * 60 * 1000 ? best : null;
}

function buildForecast() {
    const now = new Date();
    const startTs = Math.floor(now.getTime() / 900000) * 900000;
    const pv = [];
    const house = [];
    const baseload = [];
    const weather = [];
    const heatDemand = [];
    const dayTypes = [];
    const hourlyWeather = weatherHours();
    for (let i = 0; i < CFG.forecastSlots; i++) {
        const timestamp = startTs + i * 900000;
        const date = new Date(timestamp);
        const slot = slotOf(timestamp);
        const dayOffset = calendarDayNumber(date) - calendarDayNumber(now);
        const dayType = forecastDayType(date, dayOffset);
        const wx = nearestWeather(hourlyWeather, timestamp);
        const weatherPvW = wx ? wx.pvW : null;
        const pvW = weatherPvW === null ? 0 : Math.round(weatherPvW);
        const houseW = historyProfiles.houseTotal[dayType][slot];
        const fallbackHouseW = dayType === 'HOLIDAY'
            ? (historyProfiles.houseTotal.SUNDAY[slot] || 0)
            : 0;
        const baseloadW = historyProfiles.baseload[dayType][slot];
        const fallbackBaseloadW = dayType === 'HOLIDAY'
            ? (historyProfiles.baseload.SUNDAY[slot] || 0)
            : 0;
        const temp = wx ? wx.temperatureC : null;
        const wind = wx ? wx.windKmh : null;
        const heatIndex = temp === null ? null : Math.round(Math.max(0, 20 - temp) * (1 + Math.max(0, (wind || 0) - 10) * 0.01) * 10) / 10;

        pv.push({timestamp, offsetMin: i * 15, valueW: Math.max(0, pvW)});
        house.push({timestamp, offsetMin: i * 15, dayType, valueW: houseW ?? fallbackHouseW});
        baseload.push({timestamp, offsetMin: i * 15, dayType, valueW: baseloadW ?? fallbackBaseloadW});
        weather.push({timestamp, offsetMin: i * 15, temperatureC: temp, windKmh: wind, cloudPct: wx ? wx.cloudPct : null});
        heatDemand.push({timestamp, offsetMin: i * 15, value: heatIndex});
        const dateKey = localDateKey(date);
        if (!dayTypes.some(x => x.date === dateKey)) {
            dayTypes.push({date: dateKey, type: dayType});
        }
    }
    const prices = buildPriceForecast(startTs);
    const pvNext2hWh = Math.round(pv.slice(0, CFG.limits.pvBoostLeadSlots)
        .reduce((sumValue, x) => sumValue + x.valueW * 0.25, 0));
    const weatherValid = hourlyWeather.length >= 36;
    const confidence = historyReady
        ? (weatherValid ? 85 : 55)
        : 0;

    write(`${CFG.root}.Forecast.PV_48h_JSON`, JSON.stringify(pv));
    write(`${CFG.root}.Forecast.HouseLoad_48h_JSON`, JSON.stringify(house));
    write(`${CFG.root}.Forecast.Baseload_48h_JSON`, JSON.stringify(baseload));
    write(`${CFG.root}.Forecast.Weather_48h_JSON`, JSON.stringify(weather));
    write(`${CFG.root}.Forecast.EnergyPrice_48h_JSON`, JSON.stringify(prices.energy));
    write(`${CFG.root}.Forecast.GridFee_48h_JSON`, JSON.stringify(prices.grid));
    write(`${CFG.root}.Forecast.TotalPrice_48h_JSON`, JSON.stringify(prices.total));
    write(`${CFG.root}.Forecast.PriceMode`, prices.mode);
    write(`${CFG.root}.Forecast.HeatDemandIndex_48h_JSON`, JSON.stringify(heatDemand));
    write(`${CFG.root}.Forecast.PVNext2h_Wh`, pvNext2hWh);
    write(`${CFG.root}.Forecast.Confidence_pct`, confidence);
    write(`${CFG.root}.Forecast.WeatherValid`, weatherValid);
    write(`${CFG.root}.Forecast.DayTypes_JSON`, JSON.stringify(dayTypes));
    write(`${CFG.root}.Forecast.LastUpdate`, Date.now());
    write(`${CFG.root}.Chart.PV_48h_json_chart`, chartJson(pv, x => x.valueW));
    write(`${CFG.root}.Chart.HouseLoad_48h_json_chart`, chartJson(house, x => x.valueW));
    write(`${CFG.root}.Chart.Baseload_48h_json_chart`, chartJson(baseload, x => x.valueW));
    write(`${CFG.root}.Chart.OutsideTemperature_48h_json_chart`, chartJson(weather, x => x.temperatureC));
    write(`${CFG.root}.Chart.HeatDemandIndex_48h_json_chart`, chartJson(heatDemand, x => x.value));
    write(`${CFG.root}.Chart.EnergyPrice_48h_json_chart`, chartJson(prices.energy, x => x.value_ct_kWh));
    write(`${CFG.root}.Chart.GridFee_48h_json_chart`, chartJson(prices.grid, x => x.value_ct_kWh));
    write(`${CFG.root}.Chart.TotalPrice_48h_json_chart`, chartJson(prices.total, x => x.value_ct_kWh));
    // Der Geraeteplan nutzt die Grundlast; sonst wuerden historisch enthaltene
    // Heizstaebe und Wallboxen beim erneuten Planen doppelt gezaehlt.
    buildDevicePlan({pv, house: baseload, prices, heatDemand});
}

function requestForecastRebuild() {
    if (forecastRebuildTimer) return;
    forecastRebuildTimer = setTimeout(() => {
        forecastRebuildTimer = null;
        buildForecast();
    }, 5000);
}

function percentile(values, fraction) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function freshOptionalNumber(id, maxAgeMs) {
    try {
        if (!existsState(id)) return null;
        const s = getState(id);
        const n = Number(s?.val);
        return Number.isFinite(n) && Date.now() - Number(s?.ts || 0) <= maxAgeMs ? n : null;
    } catch (_) {
        return null;
    }
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

function buildDevicePlan(data) {
    const r = CFG.root;
    if (!historyReady || !data.pv.length || !data.house.length) {
        write(`${r}.Plan.Valid`, false);
        write(`${r}.Plan.Status`, 'Wartet auf gueltige Historie und Prognose');
        return;
    }

    const capacity = Math.max(0.1, readNumber(`${r}.Config.BatteryCapacity_kWh`, 10));
    const maxCharge = Math.max(0, readNumber(`${r}.Config.BatteryMaxCharge_W`, 2400));
    const maxDischarge = Math.max(0, readNumber(`${r}.Config.BatteryMaxDischarge_W`, 2400));
    const minSoc = readNumber(`${r}.Config.BatteryMinSoC_pct`, 15);
    const morningTarget = Math.max(minSoc, Math.min(100,
        readNumber(`${r}.Config.BatteryMorningTargetSoC_pct`, 70)));
    const afternoonTarget = Math.max(morningTarget, Math.min(100,
        readNumber(`${r}.Config.BatteryAfternoonTargetSoC_pct`, 90)));
    const targets = {
        morning: morningTarget,
        afternoon: afternoonTarget,
        late: Math.max(afternoonTarget, Math.min(100,
            readNumber(`${r}.Config.BatteryLateTargetSoC_pct`, 100)))
    };
    const efficiency = Math.max(0.5, Math.min(1, readNumber(`${r}.Config.BatteryEfficiency_pct`, 92) / 100));
    const targetPlan = buildBatteryTargetPlan(data, capacity, maxCharge, efficiency, targets,
        readNumber(`${r}.Config.BatteryFinalChargeReserve_min`, 45));
    const liveSoc = freshOptionalNumber(CFG.dp.batterySoc, 5 * 60 * 1000);
    let soc = Math.max(0, Math.min(100, liveSoc === null
        ? readNumber(`${r}.Config.BatteryManualSoC_pct`, 50) : liveSoc));
    const socSource = liveSoc === null ? 'Config.BatteryManualSoC_pct (Livewert fehlt/veraltet)' : CFG.dp.batterySoc;

    const dhwValues = CFG.dp.dhwTemps.map(id => freshOptionalNumber(id, 10 * 60 * 1000)).filter(Number.isFinite);
    const dhwTemp = dhwValues.length
        ? dhwValues.reduce((a, b) => a + b, 0) / dhwValues.length
        : readNumber(`${r}.Actual.DHWTemperature_C`, 50);
    const dhwMin = readNumber(`${r}.Config.DHWMinTemperature_C`, 48);
    const dhwTarget = readNumber(`${r}.Config.DHWTargetTemperature_C`, 60);
    let dhwNeedKWh = Math.max(0, readNumber(`${r}.Config.DHWVolume_l`, 500) * 1.163 * (dhwTarget - dhwTemp) / 1000);
    const heatTemp = readNumber(`${r}.Config.HeatingBufferTemperature_C`, 40);
    const heatMin = readNumber(`${r}.Config.HeatingBufferMinTemperature_C`, 35);
    const heatTarget = readNumber(`${r}.Config.HeatingBufferTargetTemperature_C`, 50);
    let heatNeedKWh = Math.max(0, readNumber(`${r}.Config.HeatingBufferVolume_l`, 400) * 1.163 * (heatTarget - heatTemp) / 1000);

    const planWithoutSoc = Boolean(getState(`${r}.Config.WallboxPlanWithoutSoC`)?.val);
    const wallboxStatus = CFG.dp.wallboxCar.map((id, index) => {
        const carState = readNumber(id, 1);
        const connectedNow = [2, 3, 4].includes(carState);
        const vehicleSoc = freshOptionalNumber(CFG.dp.wallboxSoc[index], 2 * 60 * 60 * 1000);
        const targetSoc = readNumber(CFG.dp.wallboxSocTarget[index], 100);
        const released = Boolean(readNumber(CFG.dp.wallboxSocRelease[index], 1));
        let reason = 'Kein Fahrzeug angeschlossen';
        let eligible = false;
        if (connectedNow && vehicleSoc === null) {
            eligible = planWithoutSoc && released;
            reason = eligible ? 'SoC fehlt; Planung laut Konfiguration erlaubt' : 'SoC fehlt; keine Planung';
        } else if (connectedNow && vehicleSoc >= targetSoc) {
            reason = `Ladeziel erreicht (${vehicleSoc} >= ${targetSoc} %)`;
        } else if (connectedNow && !released) {
            reason = 'Ladefreigabe socfrei ist aus';
        } else if (connectedNow) {
            eligible = true;
            reason = `Ladebedarf (${vehicleSoc} < ${targetSoc} %)`;
        }
        return {index, carState, connected: connectedNow, soc_pct: vehicleSoc,
            target_pct: targetSoc, released, eligible, reason};
    });
    const connected = wallboxStatus.filter(x => x.connected).map(x => x.index);
    const eligibleWallboxes = wallboxStatus.filter(x => x.eligible).map(x => x.index);
    const vehicleEfficiency = Math.max(0.5, Math.min(1,
        readNumber(`${r}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const wallboxRemainingKWh = wallboxStatus.map(x => x.eligible
        ? (x.soc_pct === null
            ? Infinity
            : Math.max(0, (x.target_pct - x.soc_pct) / 100
                * readNumber(`${r}.Config.Wallbox${x.index}VehicleCapacity_kWh`, 50)))
        : 0);
    const parallelEnabled = Boolean(getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val);
    const dhwParallelMinimumW = Math.max(0,
        readNumber(`${r}.Config.DHWParallelMinimum_W`, 2000));
    const prices = data.prices.total.map(x => Number(x.value_ct_kWh));
    const lowPrice = percentile(prices, 0.30);
    const highPrice = percentile(prices, 0.70);
    const spreadOk = highPrice - lowPrice >= readNumber(`${r}.Config.MinArbitrageSpread_ct_kWh`, 4);
    const selfConsumptionEnabled = Boolean(getState(`${r}.Config.BatterySelfConsumptionEnabled`)?.val);

    const battery = [], batterySoc = [], batteryTarget = [], batteryStage = [], dhw = [], heating = [], boost = [];
    const wallboxes = [[], [], []], grid = [];
    const flexPlan = [];
    let importWh = 0, exportWh = 0;

    // Pass 1: Alle verschiebbaren Verbraucher ausser der Batterie planen.
    // So kennt die Batterie anschliessend den wirklich noch freien PV-Rest.
    for (let i = 0; i < data.pv.length; i++) {
        const timestamp = data.pv[i].timestamp;
        const pvW = Math.max(0, Number(data.pv[i].valueW) || 0);
        const baseW = Math.max(0, Number(data.house[i].valueW) || 0);
        const price = prices[i] || 0;
        const activeWallbox = eligibleWallboxes.find(wb => wallboxRemainingKWh[wb] > 0) ?? null;
        let remainingPvW = Math.max(0, pvW - baseW);
        let dhwW = 0, heatW = 0;
        const wbW = [0, 0, 0];

        // Bei ladebeduerftigem Auto zunaechst eine Trinkwasser-Mindestleistung
        // reservieren. Eine zwingende Mindesttemperatur hat weiterhin Vorrang.
        const forcedDhw = dhwNeedKWh > 0 && dhwTemp < dhwMin && price <= lowPrice;
        if (dhwNeedKWh > 0 && (remainingPvW > 0 || forcedDhw)) {
            const needW = dhwNeedKWh * 4000;
            const parallelShare = parallelEnabled && activeWallbox !== null && !forcedDhw;
            dhwW = forcedDhw
                ? Math.min(CFG.limits.myPvDhwMaxW, needW)
                : Math.min(CFG.limits.myPvDhwMaxW, needW, remainingPvW,
                    parallelShare ? dhwParallelMinimumW : CFG.limits.myPvDhwMaxW);
            dhwNeedKWh = Math.max(0, dhwNeedKWh - dhwW / 4000);
            remainingPvW = Math.max(0, remainingPvW - dhwW);
        }

        // Nur ein Auto gleichzeitig; nur bei Anschluss, Ladebedarf und Freigabe.
        if (activeWallbox !== null && remainingPvW >= 1380) {
            wbW[activeWallbox] = Math.min(remainingPvW,
                readNumber(`${r}.Config.Wallbox${activeWallbox}MaxPower_W`, 11000));
            remainingPvW -= wbW[activeWallbox];
            if (Number.isFinite(wallboxRemainingKWh[activeWallbox])) {
                wallboxRemainingKWh[activeWallbox] = Math.max(0,
                    wallboxRemainingKWh[activeWallbox] - wbW[activeWallbox] * 0.25 / 1000 * vehicleEfficiency);
            }
        }

        // Nach der parallelen Wallboxzuteilung darf Trinkwasser verbleibende
        // Leistung bis 9 kW aufnehmen.
        if (dhwNeedKWh > 0 && remainingPvW > 0) {
            const extraDhwW = Math.min(CFG.limits.myPvDhwMaxW - dhwW,
                dhwNeedKWh * 4000, remainingPvW);
            dhwW += extraDhwW;
            dhwNeedKWh = Math.max(0, dhwNeedKWh - extraDhwW / 4000);
            remainingPvW -= extraDhwW;
        }

        if (heatNeedKWh > 0 && (remainingPvW > 0 || (heatTemp < heatMin && price <= lowPrice))) {
            const needW = heatNeedKWh * 4000;
            heatW = Math.min(CFG.limits.myPvHeatingMaxW, needW,
                remainingPvW > 0 ? remainingPvW : CFG.limits.myPvHeatingMaxW);
            heatNeedKWh = Math.max(0, heatNeedKWh - heatW / 4000);
            remainingPvW = Math.max(0, remainingPvW - heatW);
        }

        flexPlan.push({timestamp, offsetMin: i * 15, pvW, baseW, price,
            residualPvW: Math.max(0, remainingPvW), dhwW, heatW, wbW});
        const meta = {timestamp, offsetMin: i * 15};
        dhw.push({...meta, valueW: Math.round(dhwW)});
        heating.push({...meta, valueW: Math.round(heatW)});
        wallboxes.forEach((series, wb) => series.push({...meta, valueW: Math.round(wbW[wb]),
            conditional: eligibleWallboxes.includes(wb)}));
    }

    // Pass 2: Die Batterie so spaet wie moeglich in den verbleibenden
    // PV-Rest legen. Nur wenn die spaeteren sicheren Ladefenster bis zum
    // Stufenziel nicht reichen, wird bereits im aktuellen Slot geladen.
    const forecastSafety = Math.max(0.3, Math.min(1,
        readNumber(`${r}.Config.BatteryForecastSafetyFactor_pct`, 80) / 100));
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
        } else if (shortfallStoredKWh > 0 && spreadOk && slot.price <= lowPrice) {
            // Netzladung nur fuer die trotz sicherer PV-Restfenster verbleibende
            // Luecke und nur in einem wirklich guenstigen Preisfenster.
            batteryW = Math.min(maxCharge,
                shortfallStoredKWh / efficiency * 1000 / 0.25);
        } else if (slot.baseW > slot.pvW && soc > minSoc && (
            (selfConsumptionEnabled && !spreadOk) || (spreadOk && slot.price >= highPrice)
        )) {
            const availableW = Math.max(0, (soc - minSoc) / 100 * capacity * 4000 * efficiency);
            batteryW = -Math.min(maxDischarge, slot.baseW - slot.pvW, availableW);
        }

        soc += batteryW >= 0
            ? batteryW * 0.25 / 1000 * efficiency / capacity * 100
            : batteryW * 0.25 / 1000 / efficiency / capacity * 100;
        soc = Math.max(minSoc, Math.min(100, soc));

        const boostBudgetW = Math.max(0, slot.residualPvW - Math.max(0, batteryW));
        const gridW = slot.baseW + slot.dhwW + slot.heatW
            + slot.wbW.reduce((a, b) => a + b, 0) + batteryW - slot.pvW;
        importWh += Math.max(0, gridW) * 0.25;
        exportWh += Math.max(0, -gridW) * 0.25;
        const meta = {timestamp: slot.timestamp, offsetMin: slot.offsetMin};
        battery.push({...meta, valueW: Math.round(batteryW)});
        batterySoc.push({...meta, value_pct: Math.round(soc * 10) / 10});
        batteryTarget.push({...meta, value_pct: targetSoc});
        batteryStage.push({...meta, stage: targetPlan[i].stage, target_pct: targetSoc});
        boost.push({...meta, release: boostBudgetW >= CFG.limits.pvBoostMinExpectedW,
            budgetW: Math.round(Math.max(0, boostBudgetW))});
        grid.push({...meta, valueW: Math.round(gridW)});
    }

    write(`${r}.Plan.BatteryPower_48h_JSON`, JSON.stringify(battery));
    write(`${r}.Plan.BatterySoC_48h_JSON`, JSON.stringify(batterySoc));
    write(`${r}.Plan.BatteryTargetSoC_48h_JSON`, JSON.stringify(batteryTarget));
    write(`${r}.Plan.BatteryStage_48h_JSON`, JSON.stringify(batteryStage));
    write(`${r}.Plan.MyPV_DHW_48h_JSON`, JSON.stringify(dhw));
    write(`${r}.Plan.MyPV_Heating_48h_JSON`, JSON.stringify(heating));
    write(`${r}.Plan.PVBoost_48h_JSON`, JSON.stringify(boost));
    wallboxes.forEach((series, wb) => write(`${r}.Plan.Wallbox${wb}_48h_JSON`, JSON.stringify(series)));
    write(`${r}.Plan.GridPower_48h_JSON`, JSON.stringify(grid));
    write(`${r}.Chart.BatteryPower_48h_json_chart`, chartJson(battery, x => x.valueW));
    write(`${r}.Chart.BatterySoC_48h_json_chart`, chartJson(batterySoc, x => x.value_pct));
    write(`${r}.Chart.BatteryTargetSoC_48h_json_chart`, chartJson(batteryTarget, x => x.value_pct));
    write(`${r}.Chart.MyPV_DHW_48h_json_chart`, chartJson(dhw, x => x.valueW));
    write(`${r}.Chart.MyPV_Heating_48h_json_chart`, chartJson(heating, x => x.valueW));
    write(`${r}.Chart.PVBoostBudget_48h_json_chart`, chartJson(boost, x => x.budgetW));
    wallboxes.forEach((series, wb) => write(`${r}.Chart.Wallbox${wb}_48h_json_chart`, chartJson(series, x => x.valueW)));
    write(`${r}.Chart.GridPower_48h_json_chart`, chartJson(grid, x => x.valueW));
    write(`${r}.Plan.ExpectedImport_kWh`, Math.round(importWh / 10) / 100);
    write(`${r}.Plan.ExpectedExport_kWh`, Math.round(exportWh / 10) / 100);
    write(`${r}.Plan.ConnectedWallboxes_JSON`, JSON.stringify(connected));
    write(`${r}.Plan.WallboxStatus_JSON`, JSON.stringify(wallboxStatus));
    write(`${r}.Plan.BatterySoCSource`, socSource);
    write(`${r}.Plan.Valid`, true);
    write(`${r}.Plan.Status`, `48 h berechnet; angeschlossen: ${connected.length ? connected.join(', ') : 'keine'}; Ladebedarf: ${eligibleWallboxes.length ? eligibleWallboxes.join(', ') : 'keiner'}`);
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

function observe() {
    const invalid = [];
    const pv = readFreshNumber(CFG.dp.pvPower, invalid);
    const gridImport = readFreshNumber(CFG.dp.gridImport, invalid);
    const gridExport = readFreshNumber(CFG.dp.gridExport, invalid);
    const outside = readFreshNumber(CFG.dp.outsideTemp, invalid, false);
    const dhwTemp = readFreshNumber(CFG.dp.dhwTemp, invalid, false);
    const submeterValues = CFG.dp.houseMetersW.map(id => readFreshNumber(id, invalid));
    const wallboxes = Math.round(sum(CFG.dp.wallboxesKW, 1000));
    const myPvDhw = Math.round(sum(CFG.dp.myPvDhwW));
    const myPvHeating = Math.round(sum(CFG.dp.myPvHeatingW));
    const gridPower = Math.round(gridImport - gridExport);
    const houseLoad = Math.max(0, Math.round(pv + gridImport - gridExport));
    const flexible = wallboxes + myPvDhw + myPvHeating;
    const submetersTotal = Math.max(0, Math.round(submeterValues.reduce((a, b) => a + b, 0)));
    const includedFlexible =
        (Boolean(getState(`${CFG.root}.Config.WallboxesIncludedInSubmeters`)?.val) ? wallboxes : 0)
        + (Boolean(getState(`${CFG.root}.Config.MyPV_DHW_IncludedInSubmeters`)?.val) ? myPvDhw : 0)
        + (Boolean(getState(`${CFG.root}.Config.MyPV_Heating_IncludedInSubmeters`)?.val) ? myPvHeating : 0);
    const baseload = Math.max(0, submetersTotal - includedFlexible);
    const haFreePower = Math.max(0, readNumber(CFG.dp.haFreePower, 0));
    const haCritical = Boolean(getState(CFG.dp.haCritical)?.val);

    write(`${CFG.root}.Actual.PV_W`, Math.round(pv));
    write(`${CFG.root}.Actual.GridImport_W`, Math.round(gridImport));
    write(`${CFG.root}.Actual.GridExport_W`, Math.round(gridExport));
    write(`${CFG.root}.Actual.GridPower_W`, gridPower);
    write(`${CFG.root}.Actual.HouseLoad_W`, houseLoad);
    write(`${CFG.root}.Actual.SubmetersTotal_W`, submetersTotal);
    write(`${CFG.root}.Actual.Baseload_W`, baseload);
    write(`${CFG.root}.Actual.House1_W`, Math.round(submeterValues[0]));
    write(`${CFG.root}.Actual.House2_W`, Math.round(submeterValues[1]));
    write(`${CFG.root}.Actual.Hall_W`, Math.round(submeterValues[2]));
    write(`${CFG.root}.Actual.Apartment_W`, Math.round(submeterValues[3]));
    write(`${CFG.root}.Actual.Wallboxes_W`, wallboxes);
    write(`${CFG.root}.Actual.MyPV_DHW_W`, myPvDhw);
    write(`${CFG.root}.Actual.MyPV_Heating_W`, myPvHeating);
    write(`${CFG.root}.Actual.FlexibleLoads_W`, flexible);
    write(`${CFG.root}.Actual.OutsideTemperature_C`, outside);
    write(`${CFG.root}.Actual.DHWTemperature_C`, dhwTemp);
    write(`${CFG.root}.Actual.HAFreePower_W`, Math.round(haFreePower));
    write(`${CFG.root}.System.InvalidInputs_JSON`, JSON.stringify(invalid));
    write(`${CFG.root}.System.DataValid`, invalid.length === 0);
    write(`${CFG.root}.System.LastUpdate`, Date.now());

    recommend({pv, gridExport, haFreePower, haCritical, invalid});
}

function recommend(x) {
    const r = CFG.root;
    if (!historyReady) {
        write(`${r}.Recommendation.Valid`, false);
        write(`${r}.Recommendation.PVBoostRelease`, false);
        write(`${r}.Recommendation.PVBoostAvailable_W`, 0);
        write(`${r}.Recommendation.MyPV_DHW_W`, 0);
        write(`${r}.Recommendation.MyPV_Heating_W`, 0);
        write(`${r}.Recommendation.Reason`, 'Keine ausreichende 84-Tage-Historie (mindestens 14 vollstaendige Tage erforderlich)');
        return;
    }
    if (x.invalid.length || x.haCritical) {
        write(`${r}.Recommendation.Valid`, false);
        write(`${r}.Recommendation.PVBoostRelease`, false);
        write(`${r}.Recommendation.PVBoostAvailable_W`, 0);
        write(`${r}.Recommendation.MyPV_DHW_W`, 0);
        write(`${r}.Recommendation.MyPV_Heating_W`, 0);
        write(`${r}.Recommendation.Reason`, x.haCritical
            ? 'Hausanschluss kritisch'
            : `Ungültige Eingangsdaten: ${x.invalid.join(', ')}`);
        return;
    }

    const forecast2hWh = readNumber(`${r}.Forecast.PVNext2h_Wh`, 0);
    const forecastAverageW = forecast2hWh / 2;
    const safeNowW = Math.max(0, Math.min(x.gridExport, x.haFreePower));
    const boost = safeNowW >= 1000 || forecastAverageW >= CFG.limits.pvBoostMinExpectedW;

    // Nur Beobachterempfehlung: keine Temperatur-Automatik und keine Geräteausgänge.
    const dhwRecommendation = Math.min(CFG.limits.myPvDhwMaxW, safeNowW);
    const heatingRecommendation = Math.min(
        CFG.limits.myPvHeatingMaxW,
        Math.max(0, safeNowW - dhwRecommendation)
    );
    const boostBudget = Math.min(
        Math.max(safeNowW, Math.round(forecastAverageW)),
        Math.max(0, x.haFreePower)
    );

    write(`${r}.Recommendation.Valid`, true);
    write(`${r}.Recommendation.PVBoostRelease`, boost);
    write(`${r}.Recommendation.PVBoostAvailable_W`, boost ? boostBudget : 0);
    write(`${r}.Recommendation.MyPV_DHW_W`, dhwRecommendation);
    write(`${r}.Recommendation.MyPV_Heating_W`, heatingRecommendation);
    write(`${r}.Recommendation.Reason`, boost
        ? `Beobachtung: ${Math.round(x.gridExport)} W Ueberschuss, Wetterprognose Ø ${Math.round(forecastAverageW)} W PV in den naechsten 2 h`
        : `Kein Boost: ${Math.round(x.gridExport)} W Ueberschuss, Wetterprognose Ø ${Math.round(forecastAverageW)} W PV in den naechsten 2 h`);
    write(`${r}.Recommendation.GeneratedAt`, Date.now());
    write(`${r}.System.Status`, 'OBSERVER – keine Aktoren werden beschrieben');
}

createStates();
write(`${CFG.root}.System.Version`, '0.2.7');
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

log('EMS V0.2.7 Beobachter/Fahrplaner gestartet – keine Gerätesteuerung', 'info');
