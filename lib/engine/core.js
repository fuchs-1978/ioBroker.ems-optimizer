/*
 * EMS V0.7 – Vollstaendig abgeglichene EV-/EHZ-Simulation
 *
 * HISTORIE
 * 0.17.0-alpha.10 - dauerhafte Abschaltdiagnose fuer produktive Wallboxausgaenge.
 * 0.17.0-alpha.9 - Startsequenz bis zur bestaetigten Ladefreigabe gegen weiche Sollwertspruenge geschuetzt.
 * 0.17.0-alpha.8 - 50/50-Laufzeitschalter von der sicheren Kombinationsfreigabe getrennt.
 * 0.17.0-alpha.7 - Restart-Handoff endet erst nach stabilen frischen EMS-Daten.
 * 0.17.0-alpha.6 - Restart-Handoff startet Mindestlaufzeit auch im Echtzeitregler neu.
 * 0.17.0-alpha.5 - sinkendes Soll ersetzt offenen Amperebefehl ohne Wallbox-Stopp.
 * 0.17.0-alpha.4 - produktive 1-/3-Phasenrueckmeldung; neue Mindestlaufzeit nach Restart-Uebergabe.
 * 0.17.0-alpha.3 - kurzer Sollwertschutz nach erfolgreicher Restart-Uebergabe.
 * 0.17.0-alpha.2 - stabile 50/50-Schwellen und frische SoC-Ableitungen vor Restart-Uebergabe.
 * 0.17.0-alpha.1 - AP2-Adminfelder mit JSON-Migration; zentrale HA-Grenze;
 *                  rueckmeldungsgefuehrte Wallbox/EHZ-Verteilung, schnelle
 *                  EHZ-Einspeisenachfuehrung und Restart-Uebergabe.
 * 0.16.0-alpha.2 - Laufende Produktiv-Wallbox sperrt erneute Startverzoegerung;
 *                  Diagnoseobjekte folgen der realen Mindestlaufzeit.
 * 0.16.0-alpha.1 - Sequenzielle Produktivsteuerung aller drei Wallboxen mit
 *                  bestaetigter Uebergabe; EHZ bleibt paralleler Feinregler.
 * 0.15.5 - Sichere Wiederuebernahme einer zuvor EMS-eigenen, noch aktiven
 *          Wallbox nach ungeplantem Adapterneustart.
 * 0.15.4 - Produktive Mindestlaufzeit an den real bestaetigten Wallbox-Ausgang
 *          gekoppelt; Start- und Laufzeit-Countdowns je Wallbox ergaenzt.
 * 0.15.3 - Wallbox-Startverzoegerung, Startreserve und Mindestlaufzeit;
 *          nicht nutzbares Wallbox-Budget faellt an den EHZ-Feinregler zurueck.
 * 0.15.2 - Leere Fahrzeug-Abfahrtszeit bedeutet keine Abfahrt und begrenzt
 *          die PV-Planung nicht mehr.
 * 0.15.1 - Statischer §14a-Binaerkontakt mit konfigurierbarem Festlimit;
 *          bei parallelem EEBUS-LPC gilt automatisch das strengere Limit.
 * 0.15.0 - EEBUS-LPC als gemeinsames §14a-Budget fuer Waermepumpe und
 *          Wallboxen; richtungsrichtige HA-Pruefung aus Phasenleistungen.
 *          Reale Phasenumschaltung bleibt beim externen Skript.
 * 0.8.0 - Fahrplan als Freigabe, reale Mehr-PV-Nutzung, Wallbox-Ampere-
 *          Quantisierung und getrennte 2-s-/10-s-Regelkreise.
 * 0.7.0 - 50/50-Aufteilung mit 4/3-kW- bzw. 9/8-kW-Hysterese in
 *         Prognose und Echtzeit; bestehende Fahrzeugprioritaet und direkte
 *         Phasenerkennung aus go-e-Messwerten uebernommen.
 * 0.6.0 - Simulierter my-PV-Trinkwasser-Controller mit 9-kW-Grenze,
 *         Temperaturschutz und Leistungskennlinie aus dem Bestandsskript.
 * 0.5.0 - Vehicle-Manager fuer drei Wallboxen mit Anschluss, Freigabe,
 *         Min-/Ziel-SoC, Energiebedarf, Abfahrtszeit und Pflichtladung.
 * 0.4.0 - Simulierter NVP-Echtzeitregler im Zwei-Sekunden-Takt. Der Fahrplan
 *         gibt Freigaben/Obergrenzen vor; Batterie, my-PV und Wallboxen
 *         erhalten berechnete Sollwerte, ohne reale Aktoren zu beschreiben.
 * 0.3.2 - Versionsmeldungen des Adapters vereinheitlicht.
 * 0.3.1 - Konfigurierbare Mindestgrundlast verhindert unplausible
 *         Nullwerte nach Abzug historischer flexibler Verbraucher.
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
    historyDays: Math.max(7, Math.min(365, Number(nativeConfig.historyDays ?? 84) || 84)),
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
        dynamicEnergyPriceEnabled: '__DP_DYNAMIC_ENERGY_ENABLED__',
        dynamicGridFeeEnabled: '__DP_DYNAMIC_GRID_ENABLED__',
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
        heatPumpPower: '__DP_HEAT_PUMP_POWER__',
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
        wallboxManualMinCurrent: [
            '__DP_WB0_AMIN__' || 'javascript.0.ev.amin0',
            '__DP_WB1_AMIN__' || 'javascript.0.ev.amin1',
            '__DP_WB2_AMIN__' || 'javascript.0.ev.amin2'
        ],
        wallboxMinSoc: [
            '__DP_WB0_MIN_SOC__' || 'javascript.0.ev.socmin0',
            '__DP_WB1_MIN_SOC__' || 'javascript.0.ev.socmin1',
            '__DP_WB2_MIN_SOC__' || 'javascript.0.ev.socmin2'
        ],
        wallboxAllow: [
            '__DP_WB0_ALLOW__' || 'javascript.0.ev.alw0',
            '__DP_WB1_ALLOW__' || 'javascript.0.ev.alw1',
            '__DP_WB2_ALLOW__' || 'javascript.0.ev.alw2'
        ],
        wallboxPhases: [
            '__DP_WB0_PHASES__' || 'javascript.0.ev.pha0',
            '__DP_WB1_PHASES__' || 'javascript.0.ev.pha1',
            '__DP_WB2_PHASES__' || 'javascript.0.ev.pha2'
        ],
        wallboxPhaseCurrents: [
            ['__DP_WB0_L1_A__' || 'go-e.0.energy.phase1.ampere', '__DP_WB0_L2_A__' || 'go-e.0.energy.phase2.ampere', '__DP_WB0_L3_A__' || 'go-e.0.energy.phase3.ampere'],
            ['__DP_WB1_L1_A__' || 'go-e.1.energy.phase1.ampere', '__DP_WB1_L2_A__' || 'go-e.1.energy.phase2.ampere', '__DP_WB1_L3_A__' || 'go-e.1.energy.phase3.ampere'],
            ['__DP_WB2_L1_A__' || 'go-e.2.energy.phase1.ampere', '__DP_WB2_L2_A__' || 'go-e.2.energy.phase2.ampere', '__DP_WB2_L3_A__' || 'go-e.2.energy.phase3.ampere']
        ],
        wallboxPriority: '__DP_WB_PRIORITY__' || 'javascript.0.ev.prio',
        dhwParallelRelease: '__DP_DHW_PARALLEL_RELEASE__' || 'javascript.0.ehz.aufteilen',
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
        myPvDhwRelease: '__DP_DHW_RELEASE__' || 'javascript.0.ehz.freigabe',
        myPvDhwOutletTemp: '__DP_DHW_OUTLET_TEMP__' || 'modbus.4.holdingRegisters.1001_Temp1',
        myPvDhwConnection: '__DP_DHW_CONNECTION__' || 'modbus.4.info.connection',
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
    stateDef(`${r}.System.Version`, '0.17.0-alpha.10', 'string', 'text', '', 'EMS-Version');
    stateDef(`${r}.System.Mode`, 'OBSERVER_SIMULATION', 'string', 'text', '', 'Betriebsart');
    stateDef(`${r}.System.NoActuation`, true, 'boolean', 'indicator', '', 'Keine Gerätesteuerung');
    stateDef(`${r}.System.RealOutputsEnabled`, false, 'boolean', 'indicator', '', 'Globale Freigabe reale Ausgänge');
    stateDef(`${r}.System.Status`, 'Start', 'string', 'text', '', 'Status');
    stateDef(`${r}.System.LastUpdate`, 0, 'number', 'value.time', '', 'Letzte Aktualisierung');
    stateDef(`${r}.System.DataValid`, false, 'boolean', 'indicator', '', 'Eingangsdaten gültig');
    stateDef(`${r}.System.InvalidInputs_JSON`, '[]', 'string', 'json', '', 'Ungültige Eingänge');
    stateDef(`${r}.System.MappingStatus_JSON`, '{}', 'string', 'json', '', 'AP2-Datenquellen und Migrationsstatus');
    stateDef(`${r}.System.ActiveScriptAudit_JSON`, '{}', 'string', 'json', '', 'Abgleich der aktiven EV- und EHZ-Skripte');
    stateDef(`${r}.System.ObsoleteObjects_JSON`, JSON.stringify([
        `${r}.Forecast.PV_24h_JSON`, `${r}.Forecast.HouseLoad_24h_JSON`,
        `${r}.Forecast.Price_24h_JSON`, `${r}.Forecast.Price_48h_JSON`,
        `${r}.History.GridImportSamples`, `${r}.History.GridExportSamples`,
        `${r}.Config.BatteryTargetSoC_pct`
    ]), 'string', 'json', '', 'Alte Objekte, die manuell geloescht werden koennen');

    configDef(`${r}.Config.DynamicEnergyPriceEnabled`, false, 'boolean', 'switch.enable', '', 'Dynamischen Energiepreis verwenden');
    configDef(`${r}.Config.DynamicGridFeeEnabled`, false, 'boolean', 'switch.enable', '', 'Dynamisches Netzentgelt verwenden');
    stateDef(`${r}.Config.DynamicEnergyPriceSourceStatus`, 'intern', 'string', 'text', '', 'Quelle dynamischer Energiepreis');
    stateDef(`${r}.Config.DynamicGridFeeSourceStatus`, 'intern', 'string', 'text', '', 'Quelle dynamisches Netzentgelt');
    configDef(`${r}.Config.FixedEnergyComponent_ct_kWh`, 22.85, 'number', 'value', 'ct/kWh', 'Fester Preisanteil ohne Netzentgelt');
    configDef(`${r}.Config.FixedGridFee_ct_kWh`, 6.04, 'number', 'value', 'ct/kWh', 'Festes Netzentgelt');
    configDef(`${r}.Config.DynamicEnergyAdders_ct_kWh`, 9.301, 'number', 'value', 'ct/kWh', 'Aufschlaege auf Boersenpreis ohne Netzentgelt');
    configDef(`${r}.Config.WallboxesIncludedInSubmeters`, true, 'boolean', 'switch.enable', '', 'Wallboxen stecken in Unterzaehlern');
    configDef(`${r}.Config.MyPV_DHW_IncludedInSubmeters`, true, 'boolean', 'switch.enable', '', 'my-PV Trinkwasser steckt in Unterzaehlern');
    configDef(`${r}.Config.MyPV_Heating_IncludedInSubmeters`, false, 'boolean', 'switch.enable', '', 'my-PV Heizung steckt in Unterzaehlern');
    configDef(`${r}.Config.MinimumBaseload_W`, 500, 'number', 'value.power', 'W', 'Mindestgrundlast der Prognose');
    configDef(`${r}.Config.DHWParallelDistributionEnabled`, true, 'boolean', 'switch.enable', '', 'Trinkwasser und Wallbox parallel planen');
    configDef(`${r}.Config.DHWParallelMinimum_W`, 2000, 'number', 'value.power', 'W', 'Trinkwasser Mindestleistung bei paralleler Planung');
    configDef(`${r}.Config.DHWParallelStartPower1P_W`, 4000, 'number', 'value.power', 'W', '50/50 ein ab Leistung einphasig');
    configDef(`${r}.Config.DHWParallelStopPower1P_W`, 3000, 'number', 'value.power', 'W', '50/50 aus unter Leistung einphasig');
    configDef(`${r}.Config.DHWParallelStartPower3P_W`, 9000, 'number', 'value.power', 'W', '50/50 ein ab Leistung dreiphasig');
    configDef(`${r}.Config.DHWParallelStopPower3P_W`, 8000, 'number', 'value.power', 'W', '50/50 aus unter Leistung dreiphasig');
    configDef(`${r}.Config.DHWParallelShare_pct`, 50, 'number', 'value', '%', 'Anteil Trinkwasser bei paralleler Verteilung');
    configDef(`${r}.Config.SlowControlCycle_s`, 5, 'number', 'value.interval', 's', 'Regelzyklus Wallboxen und Heizstaebe');
    configDef(`${r}.Config.WallboxNominalVoltage_V`, 230, 'number', 'value.voltage', 'V', 'Nennspannung fuer Wallbox-Ampereberechnung');
    configDef(`${r}.Config.WallboxMaxStep_A`, 6, 'number', 'value.current', 'A', 'Maximale Wallbox-Aenderung je langsamem Zyklus');
    configDef(`${r}.Config.WallboxCombinedMaxStep_A`, 1, 'number', 'value.current', 'A', 'Maximale Wallbox-Aenderung im EHZ-Kombibetrieb');
    configDef(`${r}.Config.WallboxStartReserve_W`, 300, 'number', 'value.power', 'W', 'Zusaetzlicher stabiler Ueberschuss vor Wallboxstart');
    configDef(`${r}.Config.WallboxStartDelay_s`, 30, 'number', 'value.interval', 's', 'Stabilitaetszeit vor Wallboxstart');
    configDef(`${r}.Config.WallboxMinimumRunTime_s`, 120, 'number', 'value.interval', 's', 'Mindestlaufzeit einer gestarteten Wallbox');
    configDef(`${r}.Config.WallboxRestartHandoffSettle_s`, 10, 'number', 'value.interval', 's', 'Stabile EMS-Daten vor Abschluss der Restart-Uebergabe');
    configDef(`${r}.Config.PhaseSwitchTransition_s`, 90, 'number', 'value.interval', 's', 'Toleranz nach bestaetigter go-e-Phasenumschaltung');
    configDef(`${r}.Config.DHWMaxStep_W`, 1000, 'number', 'value.power', 'W', 'Maximale Heizstab-Aenderung je langsamem Zyklus');
    configDef(`${r}.Config.DHWFastIncreaseMaxStep_W`, 3000, 'number', 'value.power', 'W', 'Schnelle EHZ-Erhoehung bei bestaetigter Einspeisung');
    configDef(`${r}.Config.DHWSettleTolerance_W`, 300, 'number', 'value.power', 'W', 'Toleranz Istleistung zum letzten EHZ-Befehl');
    configDef(`${r}.Config.DHWSettleTimeout_s`, 15, 'number', 'value.interval', 's', 'Maximale Wartezeit auf EHZ-Rueckmeldung');
    configDef(`${r}.Config.DHWCommissioningMaxPower_W`, 1000, 'number', 'value.power', 'W', 'Produktive EHZ-Leistungsgrenze fuer Inbetriebnahme');
    configDef(`${r}.Config.DHWHouseConnectionLimit_A`, 46, 'number', 'value.current', 'A', 'Legacy-EHZ-Arbeitsgrenze; aus zentraler HA-Grenze abgeleitet');
    configDef(`${r}.Config.HouseConnectionFuse_A`, 50, 'number', 'value.current', 'A', 'Physische Hausanschlusssicherung je Phase');
    configDef(`${r}.Config.HouseConnectionReserve_A`, 4, 'number', 'value.current', 'A', 'Reserve vor der Hausanschlusssicherung');
    stateDef(`${r}.Config.HouseConnectionWorkingLimit_A`, 46, 'number', 'value.current', 'A', 'Abgeleitete gemeinsame Arbeitsgrenze');
    configDef(`${r}.Config.DHWTemperatureMaxAge_min`, 60, 'number', 'value.interval', 'min', 'Maximales Alter unveraenderter Speichertemperaturen');
    configDef(`${r}.Config.WallboxPlanWithoutSoC`, false, 'boolean', 'switch.enable', '', 'Wallbox bei fehlendem Fahrzeug-SoC planen');
    configDef(`${r}.Config.BatteryCapacity_kWh`, 10, 'number', 'value', 'kWh', 'Batteriekapazitaet');
    configDef(`${r}.Config.BatteryMaxCharge_W`, 2400, 'number', 'value.power', 'W', 'Batterie maximale Ladeleistung');
    configDef(`${r}.Config.BatteryMaxDischarge_W`, 2400, 'number', 'value.power', 'W', 'Batterie maximale Entladeleistung');
    configDef(`${r}.Config.BatteryMinSoC_pct`, 15, 'number', 'value', '%', 'Batterie Mindest-SoC');
    configDef(`${r}.Config.BatteryMaxSoC_pct`, 100, 'number', 'value', '%', 'Batterie Maximal-SoC');
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
    configDef(`${r}.Config.DHWControllerMaxPower_W`, 9000, 'number', 'value.power', 'W', 'Trinkwasser-Heizstab maximale Leistung');
    configDef(`${r}.Config.DHWControllerStopTemperature_C`, 76, 'number', 'value.temperature', '°C', 'Trinkwasser-Heizstab Abschalttemperatur unten');
    configDef(`${r}.Config.DHWControllerResumeTemperature_C`, 75.5, 'number', 'value.temperature', '°C', 'Trinkwasser-Heizstab Wiedereinschalttemperatur unten');
    configDef(`${r}.Config.DHWControllerOutletDerating_C`, 60, 'number', 'value.temperature', '°C', 'Ausgangstemperatur fuer Leistungsreduzierung');
    configDef(`${r}.Config.DHWControllerOutletProtection_C`, 76, 'number', 'value.temperature', '°C', 'Ausgangstemperatur fuer 3-kW-Leitungsschutz');
    configDef(`${r}.Config.DHWControllerTopEmergencyStop_C`, 82, 'number', 'value.temperature', '°C', 'Obere Speicher-Sicherheitsgrenze');
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

    [0, 1, 2].forEach(wb => {
        configDef(`${r}.Vehicles.Wallbox${wb}.DepartureTime`, '06:00', 'string', 'text', '', `Abfahrtszeit Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.BelowMinimum`, false, 'boolean', 'indicator', '', 'Unter Mindest-SoC');
        stateDef(`${r}.Vehicles.Wallbox${wb}.SocLimitsSource`, 'external', 'string', 'text', '', 'Quelle der SoC-Grenzen');
        stateDef(`${r}.Vehicles.Wallbox${wb}.TaperCurrentLimit_A`, 32, 'number', 'value.current', 'A', 'SoC-Strombegrenzung');
        stateDef(`${r}.Vehicles.Wallbox${wb}.ManualMinimumCurrent_A`, 0, 'number', 'value.current', 'A', 'Manueller Mindeststrom');
        stateDef(`${r}.Vehicles.Wallbox${wb}.LowSocMinimumCurrent_A`, 0, 'number', 'value.current', 'A', 'Mindeststrom aus niedriger SoC-Stufe');
        stateDef(`${r}.Vehicles.Wallbox${wb}.RequestedMinimumCurrent_A`, 0, 'number', 'value.current', 'A', 'Angeforderter Mindeststrom vor Sicherheitsgrenzen');
        stateDef(`${r}.Vehicles.Wallbox${wb}.CurrentConstraintStatus`, '', 'string', 'text', '', 'Erklaerung der wirksamen Stromgrenzen');
        stateDef(`${r}.Vehicles.Wallbox${wb}.StartDelayActive`, false, 'boolean', 'indicator', '', 'Einschaltverzoegerung aktiv');
        stateDef(`${r}.Vehicles.Wallbox${wb}.StartDelayRemaining_s`, 0, 'number', 'value.interval', 's', 'Verbleibende Einschaltverzoegerung');
        stateDef(`${r}.Vehicles.Wallbox${wb}.MinimumRunTimeActive`, false, 'boolean', 'indicator', '', 'Mindestlaufzeit aktiv');
        stateDef(`${r}.Vehicles.Wallbox${wb}.MinimumRunTimeRemaining_s`, 0, 'number', 'value.interval', 's', 'Verbleibende Mindestlaufzeit');
        stateDef(`${r}.Devices.Wallbox${wb}.LastStopReason`, '', 'string', 'text', '', 'Letzter Abschaltgrund des produktiven Ausgangs');
        stateDef(`${r}.Devices.Wallbox${wb}.LastStopAt`, 0, 'number', 'value.time', '', 'Zeitpunkt der letzten produktiven Abschaltung');
        configDef(`${r}.Vehicles.Wallbox${wb}.Priority`, 3 - wb, 'number', 'value', '', `Ladeprioritaet Wallbox ${wb}`);
        configDef(`${r}.Vehicles.Wallbox${wb}.DefaultMinimumPower_W`, 1380, 'number', 'value.power', 'W', `Mindestladeleistung Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.Connected`, false, 'boolean', 'indicator.connected', '', `Fahrzeug an Wallbox ${wb} angeschlossen`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.CarState`, 1, 'number', 'value', '', `go-e Fahrzeugstatus Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.SoC_pct`, 0, 'number', 'value.battery', '%', `Fahrzeug-SoC Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.SoCValid`, false, 'boolean', 'indicator', '', `SoC Wallbox ${wb} gueltig`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.SoCSource`, '', 'string', 'text', '', `SoC-Quelle Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.MinimumSoC_pct`, 0, 'number', 'value', '%', `Sofortladegrenze Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.TargetSoC_pct`, 100, 'number', 'value', '%', `Ziel-SoC Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.LegacySoCRelease`, 0, 'number', 'value', '', `Vorhandene socfrei-Stufe Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.UserRelease`, false, 'boolean', 'indicator', '', `Vorhandene alw-Freigabe Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.Release`, false, 'boolean', 'indicator', '', `EMS-Ladefreigabe Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.MustCharge`, false, 'boolean', 'indicator', '', `Pflichtladung Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.Capacity_kWh`, 0, 'number', 'value.energy', 'kWh', `Fahrzeugkapazitaet Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.EnergyRequired_kWh`, 0, 'number', 'value.energy', 'kWh', `Fehlende Energie im Fahrzeug Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.GridEnergyRequired_kWh`, 0, 'number', 'value.energy', 'kWh', `Erforderliche Ladeenergie Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.MinimumPower_W`, 1380, 'number', 'value.power', 'W', `Mindestleistung Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.DetectedPhases`, 1, 'number', 'value', '', `Direkt erkannte Phasen Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.SelectedPriority`, false, 'boolean', 'indicator', '', `Alte prio-Auswahl Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.EffectivePriorityScore`, 0, 'number', 'value', '', `Wirksame Prioritaet Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.MaximumPower_W`, 11000, 'number', 'value.power', 'W', `Maximalleistung Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.DepartureTimestamp`, 0, 'number', 'value.time', '', `Naechste Abfahrt Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.LatestStartTimestamp`, 0, 'number', 'value.time', '', `Spaetester Ladebeginn Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.HoursRemaining`, 0, 'number', 'value.interval', 'h', `Zeit bis Abfahrt Wallbox ${wb}`);
        stateDef(`${r}.Vehicles.Wallbox${wb}.Status`, 'Noch nicht ausgewertet', 'string', 'text', '', `Fahrzeugstatus Wallbox ${wb}`);
    });

    configDef(`${r}.Control.Enabled`, true, 'boolean', 'switch.enable', '', 'Simulierten NVP-Regler aktivieren');
    stateDef(`${r}.Control.Mode`, 'SIMULATION', 'string', 'text', '', 'Reglermodus ohne Aktorzugriff');
    configDef(`${r}.Control.TargetGridPower_W`, -100, 'number', 'value.power', 'W', 'NVP-Ziel positiv Bezug negativ Einspeisung');
    configDef(`${r}.Control.Deadband_W`, 100, 'number', 'value.power', 'W', 'Totband um das NVP-Ziel');
    stateDef(`${r}.Control.CycleSeconds`, 2, 'number', 'value.interval', 's', 'Reglerzyklus');
    stateDef(`${r}.Control.SlowCycleSeconds`, 5, 'number', 'value.interval', 's', 'Reglerzyklus langsame Verbraucher');
    stateDef(`${r}.Control.SlowLastUpdate`, 0, 'number', 'value.time', '', 'Letzte Anpassung langsamer Verbraucher');
    stateDef(`${r}.Control.SelectedWallbox`, -1, 'number', 'value', '', 'Aktuell ausgewaehlte Wallbox');
    stateDef(`${r}.Control.WallboxPrioritySource`, 'auto', 'string', 'text', '', 'Quelle der Wallboxprioritaet');
    stateDef(`${r}.Control.RestartHandoffActive`, false, 'boolean', 'indicator', '', 'Laufende Wallbox wartet auf Wiederuebernahme nach Neustart');
    stateDef(`${r}.Control.RestartHandoffSince`, 0, 'number', 'value.time', '', 'Beginn der Neustart-Uebergabe');
    stateDef(`${r}.Control.MultiWallboxAlphaArmed`, false, 'boolean', 'indicator', '', 'ALPHA-Mehrgeraetesteuerung bestaetigt');
    stateDef(`${r}.Control.Valid`, false, 'boolean', 'indicator', '', 'Echtzeit-Simulation gueltig');
    stateDef(`${r}.Control.Status`, 'Wartet auf ersten Zyklus', 'string', 'text', '', 'Status des Echtzeitreglers');
    stateDef(`${r}.Control.LastUpdate`, 0, 'number', 'value.time', '', 'Letzter Reglerzyklus');
    stateDef(`${r}.Control.ActualGridPower_W`, 0, 'number', 'value.power', 'W', 'Gemessene NVP-Leistung positiv Bezug');
    stateDef(`${r}.Control.PredictedGridPower_W`, 0, 'number', 'value.power', 'W', 'Erwartete NVP-Leistung mit simulierten Sollwerten');
    stateDef(`${r}.Control.Error_W`, 0, 'number', 'value.power', 'W', 'Regelabweichung Ist minus Ziel');
    stateDef(`${r}.Control.RemainingError_W`, 0, 'number', 'value.power', 'W', 'Nicht ausregelbare Restabweichung');
    stateDef(`${r}.Control.PlanSlotTimestamp`, 0, 'number', 'value.time', '', 'Verwendeter Fahrplan-Zeitpunkt');
    stateDef(`${r}.Control.GridOperatorLimitActive`, false, 'boolean', 'indicator', '', 'Netzbetreiberbegrenzung aktiv');
    stateDef(`${r}.Control.GridOperatorBudget_W`, -1, 'number', 'value.power', 'W', 'Gemeinsames LPC-Budget der §14a-Verbraucher; -1 unbegrenzt');
    stateDef(`${r}.Control.GridOperatorStatus`, 'Noch nicht ausgewertet', 'string', 'text', '', 'Status §14a/LPC-Leistungsbegrenzung');
    stateDef(`${r}.Control.Targets.Battery_W`, 0, 'number', 'value.power', 'W', 'Simulierter Batteriesollwert positiv Laden');
    stateDef(`${r}.Control.Targets.MyPV_DHW_W`, 0, 'number', 'value.power', 'W', 'Simulierter Sollwert my-PV Trinkwasser');
    stateDef(`${r}.Control.Targets.MyPV_Heating_W`, 0, 'number', 'value.power', 'W', 'Simulierter Sollwert my-PV Heizpuffer');
    [0, 1, 2].forEach(wb => stateDef(`${r}.Control.Targets.Wallbox${wb}_W`, 0,
        'number', 'value.power', 'W', `Simulierter Sollwert Wallbox ${wb}`));
    [0, 1, 2].forEach(wb => stateDef(`${r}.Control.Targets.Wallbox${wb}_A`, 0,
        'number', 'value.current', 'A', `Simulierter Ampere-Sollwert Wallbox ${wb}`));
    stateDef(`${r}.Control.Targets.PVBoostRelease`, false, 'boolean', 'indicator', '', 'Simulierte PV-Boost-Freigabe');

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
    stateDef(`${r}.Actual.HeatPump_W`, 0, 'number', 'value.power.consumption', 'W', 'Wärmepumpenleistung für §14a-Budget');
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
    ['BatteryPower', 'BatterySoC', 'MyPV_DHW', 'MyPV_Heating', 'PVBoost', 'ParallelDistribution',
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
        ['ParallelDistribution_48h_json_chart', '50/50-Parallelverteilung'],
        ['Wallbox0_48h_json_chart', 'Wallbox 0'],
        ['Wallbox1_48h_json_chart', 'Wallbox 1'],
        ['Wallbox2_48h_json_chart', 'Wallbox 2'],
        ['GridPower_48h_json_chart', 'Erwartete Netzleistung']
    ].forEach(([id, name]) => stateDef(`${r}.Chart.${id}`, '[]', 'string', 'json', '', `${name} fuer ECharts`));

    stateDef(`${r}.Capacity.MyPV_DHW_Max_W`, CFG.limits.myPvDhwMaxW, 'number', 'value.power', 'W', 'my-PV Trinkwasser maximal');
    stateDef(`${r}.Capacity.MyPV_Heating_Max_W`, CFG.limits.myPvHeatingMaxW, 'number', 'value.power', 'W', 'my-PV Heizpuffer maximal');
    stateDef(`${r}.Capacity.HeatersTotal_Max_W`, CFG.limits.thermalHeaterMaxW, 'number', 'value.power', 'W', 'Heizstäbe gesamt maximal');

    stateDef(`${r}.Devices.MyPV_DHW.Available`, false, 'boolean', 'indicator.reachable', '', 'my-PV Trinkwasser erreichbar');
    stateDef(`${r}.Devices.MyPV_DHW.Present`, true, 'boolean', 'indicator', '', 'Trinkwasser-EHZ vorhanden');
    stateDef(`${r}.Devices.MyPV_DHW.ControlEnabled`, false, 'boolean', 'indicator', '', 'Produktive Trinkwasser-EHZ-Steuerfreigabe');
    stateDef(`${r}.Devices.MyPV_DHW.OutputActive`, false, 'boolean', 'indicator', '', 'Produktiver EHZ-Ausgang aktiv');
    stateDef(`${r}.Devices.MyPV_DHW.OutputCommand_W`, 0, 'number', 'value.power', 'W', 'Zuletzt gesendeter EHZ-Sollwert');
    stateDef(`${r}.Devices.MyPV_DHW.OutputStatus`, 'Gesperrt', 'string', 'text', '', 'Status produktiver EHZ-Ausgang');
    stateDef(`${r}.Devices.MyPV_DHW.OutputLastWrite`, 0, 'number', 'value.time', '', 'Letzter produktiver EHZ-Schreibzugriff');
    stateDef(`${r}.Devices.MyPV_DHW.DirectGridPower_W`, 0, 'number', 'value.power', 'W', 'Direkte NVP-Leistung des produktiven Reglers');
    stateDef(`${r}.Devices.MyPV_DHW.ActuatorSettled`, false, 'boolean', 'indicator', '', 'AC THOR hat den letzten Befehl erreicht');
    stateDef(`${r}.Devices.MyPV_DHW.ActuatorDifference_W`, 0, 'number', 'value.power', 'W', 'Istleistung minus letzter Befehl');
    stateDef(`${r}.Devices.MyPV_DHW.CommandAge_s`, 0, 'number', 'value.interval', 's', 'Alter des letzten geaenderten Befehls');
    stateDef(`${r}.Devices.MyPV_DHW.EffectiveStep_W`, 0, 'number', 'value.power', 'W', 'Aktuell verwendete adaptive Schrittweite');
    stateDef(`${r}.Devices.MyPV_DHW.ProductionRemainingError_W`, 0, 'number', 'value.power', 'W', 'Erwartete NVP-Restabweichung des produktiven EHZ');
    stateDef(`${r}.Devices.MyPV_DHW.ControlReason`, '', 'string', 'text', '', 'Begruendung des produktiven EHZ-Reglers');
    stateDef(`${r}.Devices.MyPV_DHW.ExistingRelease`, false, 'boolean', 'indicator', '', 'Freigabe des vorhandenen EHZ-Skripts');
    stateDef(`${r}.Devices.MyPV_DHW.Release`, false, 'boolean', 'indicator', '', 'Simulierte EMS-Freigabe');
    stateDef(`${r}.Devices.MyPV_DHW.MustHeat`, false, 'boolean', 'indicator', '', 'Trinkwasser Pflichtwaermebedarf');
    stateDef(`${r}.Devices.MyPV_DHW.BottomTemperature_C`, 0, 'number', 'value.temperature', '°C', 'Speichertemperatur unten');
    stateDef(`${r}.Devices.MyPV_DHW.MiddleLowerTemperature_C`, 0, 'number', 'value.temperature', '°C', 'Speichertemperatur Mitte unten');
    stateDef(`${r}.Devices.MyPV_DHW.MiddleUpperTemperature_C`, 0, 'number', 'value.temperature', '°C', 'Speichertemperatur Mitte oben');
    stateDef(`${r}.Devices.MyPV_DHW.TopTemperature_C`, 0, 'number', 'value.temperature', '°C', 'Speichertemperatur oben');
    stateDef(`${r}.Devices.MyPV_DHW.AverageTemperature_C`, 0, 'number', 'value.temperature', '°C', 'Mittlere Speichertemperatur');
    stateDef(`${r}.Devices.MyPV_DHW.OutletTemperature_C`, 0, 'number', 'value.temperature', '°C', 'AC-THOR Ausgangstemperatur');
    stateDef(`${r}.Devices.MyPV_DHW.RemainingCapacity_kWh`, 0, 'number', 'value.energy', 'kWh', 'Thermische Restkapazitaet bis Abschaltung');
    stateDef(`${r}.Devices.MyPV_DHW.ActualPower_W`, 0, 'number', 'value.power', 'W', 'Gemessene Heizstableistung');
    stateDef(`${r}.Devices.MyPV_DHW.PlannedPower_W`, 0, 'number', 'value.power', 'W', 'Aktuelle Fahrplanleistung');
    stateDef(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0, 'number', 'value.power', 'W', 'Temperaturabhaengige Leistungsgrenze');
    stateDef(`${r}.Devices.MyPV_DHW.SimulatedTargetPower_W`, 0, 'number', 'value.power', 'W', 'Simulierter sicherer Sollwert');
    stateDef(`${r}.Devices.MyPV_DHW.TemperatureLock`, false, 'boolean', 'indicator', '', 'Temperatur-Hysterese aktiv');
    stateDef(`${r}.Devices.MyPV_DHW.Status`, 'Noch nicht ausgewertet', 'string', 'text', '', 'Status my-PV Trinkwasser-Simulation');
    stateDef(`${r}.Control.ParallelDistributionActive`, false, 'boolean', 'indicator', '', '50/50-Aufteilung im Echtzeitregler aktiv');
    stateDef(`${r}.Control.ParallelDistributionReleased`, false, 'boolean', 'indicator', '', 'Externe Freigabe fuer EHZ-/Wallbox-Aufteilung');
    stateDef(`${r}.Control.ParallelDistributionReleaseStatus`, '', 'string', 'text', '', 'Status des externen Aufteilungsobjekts');
    stateDef(`${r}.Control.ParallelDistributionThresholds`, '', 'string', 'text', '', 'Aktive 50/50-Hystereseschwellen');

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

function readBooleanInput(id) {
    try {
        if (!id || !existsState(id)) return null;
        const value = getState(id)?.val;
        if (value === true || value === 1 || value === '1') return true;
        if (value === false || value === 0 || value === '0') return false;
        return null;
    } catch (_) {
        return null;
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
