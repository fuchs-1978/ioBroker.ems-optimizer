/*
 * EMS V0.3 – Modularer Beobachter und 48-h-Fahrplaner (keine Gerätesteuerung)
 *
 * HISTORIE
 * 0.3.0 - Unveraenderte Beobachterlogik in eigenstaendige Module fuer
 *         Kern, Historie, Prognose, Planung, Beobachtung und Start getrennt.
 * 0.2.10 - Aufbewahrung der EMS-eigenen SQL-Ausgaenge auf 90 Tage
 *          begrenzt; Eingangs- und Prognoselogik unveraendert.
 * 0.2.9 - SQL-Historie speicherschonend: Datenpunkte nacheinander und
 *         84 Tage in Sieben-Tage-Bloecken statt paralleler Grossabfragen.
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
    stateDef(`${r}.System.Version`, '0.3.0', 'string', 'text', '', 'EMS-Version');
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
            retention: 7776000,
            changesRelogInterval: 900
        }
    }));
}
