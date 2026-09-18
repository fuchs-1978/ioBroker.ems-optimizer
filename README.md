# ioBroker EMS Optimizer

Aktuelle Version: **0.12.4**

Prognosebasierter Energiemanagement-Beobachter für ioBroker. Der Adapter führt
Messwerte, SQL-Historie, Wetter- und PV-Prognosen, Strompreise sowie flexible
Verbraucher in einem rollierenden 48-Stunden-Fahrplan zusammen.

Der aktuelle Entwicklungsstand arbeitet grundsätzlich im Beobachtermodus. Ab
Version 0.12.0 kann ausschließlich der Trinkwasser-EHZ nach einer dreifachen
Freigabe produktiv angesteuert werden. Wallboxen, Batterie, Heizpuffer und
Wärmepumpe bleiben reine Simulation.

## Funktionen

### Simulierter my-PV-Trinkwasser-Controller (ab 0.6.0)

Der Trinkwasser-Heizstab wird als erstes Geraet mit seiner realen
Leistungskennlinie simuliert. Der Adapter schreibt weiterhin weder
`modbus.4.holdingRegisters.1000_Power` noch `javascript.0.ehz.power_vorgabe`
oder einen anderen Aktorwert.

Aus dem vorhandenen Skript wurden folgende Grenzen uebernommen:

- maximal 9.000 W
- Abschaltung ab 76,0 °C am unteren Speichersensor
- Wiedereinschaltung unterhalb 75,5 °C
- maximal 7.500 W von 70 bis 71 °C
- maximal 6.000 W von 71 bis 73 °C
- maximal 4.000 W von 73 bis 74 °C
- maximal 3.000 W von 74 bis 76 °C
- die temperaturabhaengigen Stufen greifen wie bisher bei mehr als 60 °C
  AC-THOR-Ausgangstemperatur
- maximal 3.000 W ab 76 °C AC-THOR-Ausgangstemperatur
- Sicherheitsabschaltung bei 82 °C am oberen Speichersensor
- Schichtungsgrenzen von 900 beziehungsweise 500 W
- simulierte Aenderungsbegrenzung von 1.000 W je zehn Sekunden

Die wichtigsten vollstaendigen Diagnoseobjekte sind:

- `ems-optimizer.0.Devices.MyPV_DHW.Available`
- `ems-optimizer.0.Devices.MyPV_DHW.Release`
- `ems-optimizer.0.Devices.MyPV_DHW.MustHeat`
- `ems-optimizer.0.Devices.MyPV_DHW.BottomTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.MiddleLowerTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.MiddleUpperTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.TopTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.OutletTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.RemainingCapacity_kWh`
- `ems-optimizer.0.Devices.MyPV_DHW.ActualPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.PlannedPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.TemperaturePowerLimit_W`
- `ems-optimizer.0.Devices.MyPV_DHW.SimulatedTargetPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.Status`

### SoC-, Phasen- und Fahrzeugverwaltung (ab 0.5.0)

Der `vehicle-manager` verwaltet alle drei Wallboxen getrennt. Er uebernimmt die
Semantik der vorhandenen EV-Skripte: Ziel-SoC erreicht bedeutet Sperre,
zwischen Mindest- und Ziel-SoC ist das Fahrzeug PV-flexibel und unterhalb des
Mindest-SoC besteht Pflichtladebedarf. Zusaetzlich werden `alw0…2`,
`socmin0…2`, `socmax0…2`, die
go-e-Anschlusszustaende und die konfigurierten SoC-Quellen ausgewertet. Beim Mii
kann damit der vorhandene geschaetzte SoC verwendet werden. `socfrei0…2` wird
als Vergleichswert angezeigt, die EMS-Freigabe jedoch aus den korrekt gemappten
SoC-Quellen neu berechnet. Damit wird die alte, teilweise nicht mehr passende
Fahrzeugzuordnung nicht ungeprueft uebernommen.

Pro Wallbox werden fehlende Fahrzeugenergie, Ladeenergie inklusive Verlusten,
naechste Abfahrt und spaetester sicherer Ladebeginn berechnet. Vor diesem
Zeitpunkt bleibt das Fahrzeug PV-flexibel. Danach plant der Adapter bei Bedarf
eine Pflichtladung bis zum Ziel-SoC. Pflichtladung, frueheste Deadline und
Prioritaet bestimmen die Reihenfolge. Seit Version 0.9.0 kann verbleibender
PV-Ueberschuss danach an weitere angeschlossene Fahrzeuge verteilt werden.
Damit bleibt die Prioritaet erhalten, ohne ungenutzte Leistung nur wegen einer
bereits ausgereizten ersten Wallbox einzuspeisen.

Die Fahrzeugdaten werden direkt auf der Konfigurationsseite eingestellt. Pro
Wallbox stehen Fahrzeugname, SoC-Datenpunkt, Batteriekapazitaet, maximale
Ladeleistung sowie die Stromgrenzen fuer ein- und dreiphasiges Laden bereit.
Der Haken **1-/3-phasige Umschaltung erlauben** entscheidet, ob der Planer
ueberhaupt dreiphasiges Laden empfehlen darf. Ohne Haken werden die
dreiphasigen Felder ignoriert.

Beispiel einer moeglichen Zuordnung:

| Wallbox | Fahrzeug | Phasenumschaltung | 1-phasig | 3-phasig |
|---|---|---:|---:|---:|
| 0 | Vehicle 0 | nein | 6–16 A | wird ignoriert |
| 1 | Vehicle 1 | ja | 6–16 A | 6–16 A |
| 2 | Vehicle 2 | ja | 6–16 A | 6–16 A |

Der Planer bevorzugt einphasiges Laden, wenn die benoetigte Energie bis zur
Abfahrt damit sicher erreicht werden kann. Bei grossem PV-Fenster oder wenn die
einphasige Leistung zeitlich nicht ausreicht, empfiehlt er fuer freigegebene
Fahrzeuge dreiphasiges Laden. Die eigentliche Umschaltung bleibt in dieser
Version simuliert.

Die Abfahrtszeit wird hier eingestellt:

- `ems-optimizer.0.Vehicles.Wallbox0.DepartureTime`
- `ems-optimizer.0.Vehicles.Wallbox1.DepartureTime`
- `ems-optimizer.0.Vehicles.Wallbox2.DepartureTime`

Format: `HH:MM`, Standard `06:00`. Die Prioritaet steht in:

- `ems-optimizer.0.Vehicles.Wallbox0.Priority`
- `ems-optimizer.0.Vehicles.Wallbox1.Priority`
- `ems-optimizer.0.Vehicles.Wallbox2.Priority`

Je Fahrzeug sind unter anderem folgende vollstaendige Objekte vorhanden
(entsprechend auch fuer `Wallbox1` und `Wallbox2`):

- `ems-optimizer.0.Vehicles.Wallbox0.Connected`
- `ems-optimizer.0.Vehicles.Wallbox0.SoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.MinimumSoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.TargetSoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.Release`
- `ems-optimizer.0.Vehicles.Wallbox0.MustCharge`
- `ems-optimizer.0.Vehicles.Wallbox0.EnergyRequired_kWh`
- `ems-optimizer.0.Vehicles.Wallbox0.GridEnergyRequired_kWh`
- `ems-optimizer.0.Vehicles.Wallbox0.DepartureTimestamp`
- `ems-optimizer.0.Vehicles.Wallbox0.LatestStartTimestamp`
- `ems-optimizer.0.Vehicles.Wallbox0.PhaseSwitchEnabled`
- `ems-optimizer.0.Vehicles.Wallbox0.RecommendedPhases`
- `ems-optimizer.0.Vehicles.Wallbox0.Status`

### Simulierte NVP-Echtzeitregelung (ab 0.4.0)

Zusätzlich zum rollierenden 15-Minuten-Fahrplan berechnet der Adapter alle zwei
Sekunden eine schnelle Ausregelung am Netzverknüpfungspunkt (NVP). Der Fahrplan
entscheidet, welche Verbraucher im aktuellen Zeitfenster freigegeben sind und
welche Leistung sie höchstens erhalten. Die Echtzeitebene reduziert diese
Sollwerte bei einer Wolke und verteilt realen Überschuss innerhalb der
Fahrplangrenzen. Mehrere freigegebene Verbraucher bleiben dabei parallel aktiv;
die Batterie übernimmt die schnelle verbleibende Differenz.

Version 0.4.0 arbeitet ausschließlich als Simulation. Alle Ergebnisse werden
nur unter `ems-optimizer.0.Control` ausgegeben. Es wird kein Datenpunkt einer
Batterie, Wallbox, eines my-PV oder einer Wärmepumpe beschrieben.

Wichtige vollständige Objekte:

- `ems-optimizer.0.Control.Enabled`
- `ems-optimizer.0.Control.TargetGridPower_W`
- `ems-optimizer.0.Control.Deadband_W`
- `ems-optimizer.0.Control.ActualGridPower_W`
- `ems-optimizer.0.Control.PredictedGridPower_W`
- `ems-optimizer.0.Control.RemainingError_W`
- `ems-optimizer.0.Control.Targets.Battery_W`
- `ems-optimizer.0.Control.Targets.MyPV_DHW_W`
- `ems-optimizer.0.Control.Targets.MyPV_Heating_W`
- `ems-optimizer.0.Control.Targets.Wallbox0_W`
- `ems-optimizer.0.Control.Targets.Wallbox1_W`
- `ems-optimizer.0.Control.Targets.Wallbox2_W`
- `ems-optimizer.0.Control.Targets.Wallbox0_A`
- `ems-optimizer.0.Control.Targets.Wallbox1_A`
- `ems-optimizer.0.Control.Targets.Wallbox2_A`
- `ems-optimizer.0.Control.Targets.Wallbox0_Phases`
- `ems-optimizer.0.Control.Targets.Wallbox1_Phases`
- `ems-optimizer.0.Control.Targets.Wallbox2_Phases`
- `ems-optimizer.0.Control.Targets.PVBoostRelease`

Vorzeichen: `ems-optimizer.0.Control.TargetGridPower_W` ist bei Netzbezug
positiv und bei Einspeisung negativ. Der Standardwert `-100 W` hält eine kleine
Einspeisereserve. Für `ems-optimizer.0.Control.Targets.Battery_W` bedeutet ein
positiver Wert Laden und ein negativer Wert Entladen.

- rollierende 48-Stunden-Prognose in 15-Minuten-Schritten
- PV-Prognose für bis zu fünf getrennte PV-Flächen
- Hauslast- und bereinigte Grundlastprognose
- Lernprofile aus SQL-Historie nach Wochentag und Feiertag
- Energiepreis und dynamisches Netzentgelt getrennt aktivierbar
- Fahrpläne für Batterie, drei Wallboxen und zwei my-PV-Heizstäbe
- reine Freigabe- und Budgetplanung für Wärmepumpen-PV-Boost
- Trinkwassertemperatur und thermische Speicherkapazität in der Planung
- dreistufige Batterieladung mit Morgen-, Nachmittags- und Spätziel
- zeitlich möglichst späte, aber sichere Batterieladung
- Batterieentladung für Eigenverbrauch oder Preisverschiebung
- ECharts-kompatible `json_chart`-Datenpunkte
- Datenqualitäts-, Alters- und Plausibilitätskontrolle
- keinerlei Schreibzugriff auf reale Geräteausgänge

## Grundprinzip

> Historie vor Prognose vor Empfehlung.

1. Historische Messwerte bilden typische 15-Minuten-Profile.
2. Wetter, PV-Erwartung, Preise und bekannte Gerätezustände erzeugen eine
   rollierende Prognose.
3. Der Planer verteilt die erwartete Energie auf flexible Verbraucher.
4. Ein schneller Beobachter berechnet alle zehn Sekunden Empfehlungen aus den
   aktuellen Messwerten.
5. Sicherheitsfunktionen und reale Gerätecontroller verbleiben außerhalb des
   Adapters.

## Berücksichtigte Ressourcen

- PV-Erzeugung und Netzanschlusspunkt
- vier getrennte Gebäude- beziehungsweise Bereichszähler
- AC-gekoppelter Batteriespeicher
- bis zu drei Wallboxen
- my-PV Trinkwasser-Heizstab
- my-PV Heizpuffer-Heizstab
- Wärmepumpen-PV-Boost als Freigabeempfehlung
- Hausanschlussreserve
- §14a-, LPC- und LPP-Signale
- dynamische oder feste Energiepreise
- dynamische oder feste Netzentgelte

## Installation

In ioBroker unter **Adapter aus eigener URL installieren** folgende URL
verwenden:

```text
https://github.com/fuchs-1978/ioBroker.ems-optimizer
```

Danach eine Instanz `ems-optimizer.0` anlegen beziehungsweise die vorhandene
Instanz neu starten.

## Konfiguration

### Strukturierte Konfigurationsseite ab 0.10.0

Die wichtigsten Einstellungen werden nicht mehr nur ueber EMS-Objekte oder das
erweiterte JSON gepflegt. Die Adapterseite ist in folgende Bereiche gegliedert:

- Allgemein und Historie
- Wallbox 0, Wallbox 1 und Wallbox 2
- my-PV Trinkwasser
- my-PV Heizpuffer
- Hausspeicher
- NVP-Echtzeitsimulation
- Preise und Netzentgelte
- erweiterte Datenpunktzuordnung

Je Fahrzeug werden Name, SoC-Datenpunkt, Kapazitaet, maximale Ladeleistung,
Freigabe der 1-/3-phasigen Umschaltung und die getrennten Stromgrenzen
eingestellt. Beim Trinkwasser-Heizstab sind die Temperaturdatenpunkte,
Speichergrenzen, Leistungskennlinie und Leistungsrampe sichtbar. Fuer Batterie
und Heizpuffer stehen Kapazitaet, Leistung und relevante Zielwerte bereit.

Sichtbare Datenpunktfelder ueberschreiben den entsprechenden Eintrag aus dem
erweiterten JSON. Bleibt ein sichtbares Datenpunktfeld leer, wird die vorhandene
JSON-Zuordnung weiterverwendet. Alle externen Objekt-IDs werden aus der
Adapterkonfiguration gelesen; die Auslieferung enthaelt keine anlagenspezifischen
Zuordnungen.

Fahrzeugname, SoC-Datenpunkt, Batteriekapazitaet, maximale Ladeleistung,
Phasenfreigabe und Stromgrenzen werden direkt in den sichtbaren Feldern der
Adapterkonfiguration gepflegt. Die Zuordnung der weiteren vorhandenen
ioBroker-Datenpunkte erfolgt weiterhin ueber `dataPointMapJson`. Das Repository
enthaelt mit `config.example.json` eine neutrale Vorlage.

Beispiel:

```json
{
  "DP_PV_POWER": "javascript.0.energy.pvPower",
  "DP_GRID_IMPORT": "meter.0.grid.importPower",
  "DP_GRID_EXPORT": "meter.0.grid.exportPower",
  "DP_HOUSE1": "meter.0.house1.power",
  "DP_HOUSE2": "meter.0.house2.power",
  "DP_HALL": "meter.0.hall.power",
  "DP_APARTMENT": "meter.0.apartment.power",
  "DP_BATTERY_SOC": "battery.0.soc",
  "DP_BATTERY_POWER": "battery.0.power"
}
```

Die Beispiel-IDs müssen vollständig durch die Datenpunkte der eigenen Anlage
ersetzt werden. Persönliche Anlagen- und Gerätekennungen sind nicht Bestandteil
dieses öffentlichen Repositorys.

## Historische Lernbasis

Der Adapter verwendet aktuell die letzten **84 Tage**. Die SQL-Aufbewahrung der
Eingangsmessungen sollte deshalb mindestens 90 Tage betragen. Empfohlen werden:

```text
Nur Änderungen speichern:     aktiviert
Entprellzeit:                  5 Sekunden
Minimales Speicherintervall:  60 Sekunden
Relog-Intervall:              900 Sekunden
Aufbewahrung:                 90 Tage
```

Benötigt werden insbesondere Historien für:

- PV-Gesamtleistung
- alle vier Bereichs- beziehungsweise Gebäudezähler
- Gesamtleistung jeder Wallbox
- Gesamtleistung des Trinkwasser-Heizstabs
- später die Gesamtleistung des Heizpuffer-Heizstabs

Die Abfragen erfolgen seit Version 0.2.9 speicherschonend nacheinander und in
Sieben-Tage-Blöcken. Die EMS-eigenen Ergebniswerte werden seit Version 0.2.10
maximal 90 Tage aufbewahrt.

Der Zustand der Lernbasis ist unter folgenden Objekten sichtbar:

```text
ems-optimizer.0.History.Building
ems-optimizer.0.History.Ready
ems-optimizer.0.History.Status
ems-optimizer.0.History.PVSamples
ems-optimizer.0.History.SubmeterSamples
ems-optimizer.0.History.LastBuild
```

## Zentrale Ergebnisobjekte

Aktuelle, normierte Messwerte:

```text
ems-optimizer.0.Actual.PV_W
ems-optimizer.0.Actual.GridPower_W
ems-optimizer.0.Actual.HouseLoad_W
ems-optimizer.0.Actual.Baseload_W
ems-optimizer.0.Actual.Wallboxes_W
ems-optimizer.0.Actual.MyPV_DHW_W
ems-optimizer.0.Actual.MyPV_Heating_W
```

Fahrplan und Status:

```text
ems-optimizer.0.Plan.Valid
ems-optimizer.0.Plan.Status
ems-optimizer.0.Plan.BatteryPower_48h_JSON
ems-optimizer.0.Plan.BatterySoC_48h_JSON
ems-optimizer.0.Plan.MyPV_DHW_48h_JSON
ems-optimizer.0.Plan.MyPV_Heating_48h_JSON
ems-optimizer.0.Plan.Wallbox0_48h_JSON
ems-optimizer.0.Plan.Wallbox1_48h_JSON
ems-optimizer.0.Plan.Wallbox2_48h_JSON
```

Kurzfristige Empfehlungen:

```text
ems-optimizer.0.Recommendation.Valid
ems-optimizer.0.Recommendation.PVBoostRelease
ems-optimizer.0.Recommendation.PVBoostAvailable_W
ems-optimizer.0.Recommendation.MyPV_DHW_W
ems-optimizer.0.Recommendation.MyPV_Heating_W
ems-optimizer.0.Recommendation.Reason
```

## ECharts

Die `json_chart`-Objekte entsprechen dem von ECharts und Open-Meteo
verwendbaren Format `[{"ts":"...","val":...}]`.

Leistungsdiagramm:

```text
ems-optimizer.0.Chart.PV_48h_json_chart
ems-optimizer.0.Chart.HouseLoad_48h_json_chart
ems-optimizer.0.Chart.Baseload_48h_json_chart
ems-optimizer.0.Chart.BatteryPower_48h_json_chart
ems-optimizer.0.Chart.MyPV_DHW_48h_json_chart
ems-optimizer.0.Chart.MyPV_Heating_48h_json_chart
ems-optimizer.0.Chart.PVBoostBudget_48h_json_chart
ems-optimizer.0.Chart.Wallbox0_48h_json_chart
ems-optimizer.0.Chart.Wallbox1_48h_json_chart
ems-optimizer.0.Chart.Wallbox2_48h_json_chart
ems-optimizer.0.Chart.GridPower_48h_json_chart
```

Preisdiagramm:

```text
ems-optimizer.0.Chart.EnergyPrice_48h_json_chart
ems-optimizer.0.Chart.GridFee_48h_json_chart
ems-optimizer.0.Chart.TotalPrice_48h_json_chart
```

Batteriediagramm:

```text
ems-optimizer.0.Chart.BatteryPower_48h_json_chart
ems-optimizer.0.Chart.BatterySoC_48h_json_chart
ems-optimizer.0.Chart.BatteryTargetSoC_48h_json_chart
```

## Vorzeichen

- `Actual.GridPower_W`: positive Werte bedeuten Netzbezug.
- `Plan.BatteryPower_48h_JSON`: positive Werte bedeuten Laden, negative Werte
  bedeuten Entladen.

## Sicherheit

Der Adapter ist kein Schutz- oder Sicherheitsgerät. Hausanschlussschutz,
Temperaturgrenzen, §14a-Vorgaben, Geräteschutz, Schütze und Notabschaltungen
müssen weiterhin durch geeignete lokale und deterministische Funktionen
gewährleistet werden.

Ohne ausdrückliche globale und gerätespezifische Freigabe schreibt der Adapter
ausschließlich in seinen eigenen Namespace `ems-optimizer.0`. Der einzige
vorbereitete Fremdschreibzugriff ist der konfigurierte Trinkwasser-Sollwert.

## Gerätefreigaben ab 0.11.0

Jedes geplante Gerät besitzt zwei getrennte Schalter auf der
Konfigurationsseite:

- **Vorhanden / in Planung berücksichtigen** nimmt das Gerät in Fahrplan und
  Simulation auf. Ist der Schalter aus, bleibt seine geplante Leistung null.
- **Steuerfreigabe** erlaubt beim Trinkwasser-EHZ zusammen mit dem globalen
  Hauptschalter die produktive Ansteuerung. Bei allen anderen Geräten bleibt
  sie in Version 0.12.0 ohne Aktorzugriff.

Darüber liegt die globale Freigabe **Master release for future real outputs**.
Sie ist standardmäßig aus. Der EHZ-Ausgang wird erst freigegeben, wenn
alle drei Bedingungen gleichzeitig erfüllt sind: globaler Schalter,
gerätespezifische Steuerfreigabe und gültige Sicherheits-/Messwerte vorliegen.

Für den ersten Ausbau sollten nur Wallbox 0, Wallbox 1, Wallbox 2 und der
Trinkwasser-Heizstab als vorhanden markiert sein. Heizpuffer-Heizstab,
Hausbatterie und Wärmepumpe bleiben bis zur realen Inbetriebnahme ausgeschaltet.
Die vier Punkte der Trinkwasser-Temperaturkennlinie bestehen nun jeweils aus
einer frei einstellbaren Temperatur und der dazugehörigen maximalen Leistung.

### Produktiver Trinkwasser-EHZ ab 0.12.0

Der Ausgang ist im Auslieferungszustand gesperrt und zunächst auf 1.000 W
begrenzt. Vor jedem Schreiben prüft der Adapter die drei Freigaben, EMS- und
Reglergültigkeit, AC-THOR-Verbindung, vier Speichertemperaturen,
Ausgangstemperatur, Temperaturkennlinie, Hausanschlussschutz und die freie
Stromstärke jeder Phase. Die harten Stufen 2 und 3 besitzen wie im bisherigen
Skript eine Wiederzuschaltverzögerung von 30 Sekunden. Bei Verlust einer
Freigabe oder eines gültigen Messwerts sowie beim Adapterstopp wird ein zuvor
aktiver Ausgang auf 0 W gesetzt.

```text
ems-optimizer.0.System.RealOutputsEnabled
ems-optimizer.0.Devices.MyPV_DHW.ControlEnabled
ems-optimizer.0.Devices.MyPV_DHW.OutputActive
ems-optimizer.0.Devices.MyPV_DHW.OutputCommand_W
ems-optimizer.0.Devices.MyPV_DHW.OutputStatus
ems-optimizer.0.Devices.MyPV_DHW.OutputLastWrite
ems-optimizer.0.Devices.MyPV_DHW.DirectGridPower_W
ems-optimizer.0.Devices.MyPV_DHW.ActuatorSettled
ems-optimizer.0.Devices.MyPV_DHW.ActuatorDifference_W
ems-optimizer.0.Devices.MyPV_DHW.CommandAge_s
ems-optimizer.0.Devices.MyPV_DHW.EffectiveStep_W
ems-optimizer.0.Devices.MyPV_DHW.ProductionRemainingError_W
ems-optimizer.0.Devices.MyPV_DHW.ControlReason
```

Seit Version 0.12.4 nutzt der produktive EHZ-Regler die aktuellen Import- und
Exportwerte direkt vom Netzverknüpfungspunkt. Nach einer Leistungserhöhung
wartet er, bis die gemessene AC-THOR-Leistung höchstens 300 W vom letzten
Befehl abweicht; nach spätestens 15 Sekunden darf er vorsichtig erneut
erhöhen. Bei Netzbezug reduziert er ohne diese Wartezeit. Die Schrittweite
wird nahe dem NVP-Ziel automatisch von maximal 1.000 W auf 500 W bzw. 200 W
verkleinert. Dadurch werden mehrere noch nicht umgesetzte Erhöhungen und das
beim Inbetriebnahmetest beobachtete Pendeln vermieden.

## Zweistufige Echtzeit-Simulation ab 0.8.0

Der 48-Stunden-Fahrplan ist eine strategische Freigabe und kein starrer
Leistungsdeckel. Wenn real mehr PV als prognostiziert zur Verfügung steht,
duerfen freigegebene Wallboxen und der Trinkwasser-Heizstab bis zu ihren
technischen, SoC- und Temperaturgrenzen mehr Leistung aufnehmen.

- Die Batterie regelt die NVP-Abweichung alle 2 Sekunden aus.
- Wallboxen und Heizstäbe ändern ihre Sollwerte standardmäßig alle 5 Sekunden. Damit kann der Trinkwasser-Heizstab den NVP ohne vorhandene Batterie zeitnah ausregeln.
- Wallboxen arbeiten nur mit ganzen Ampere und mindestens dem je Fahrzeug
  konfigurierten Mindeststrom.
- Wallboxänderungen sind auf 6 A je langsamem Zyklus begrenzt.
- Der Trinkwasser-Heizstab ändert sich um höchstens 1.000 W je langsamem Zyklus.
- Bei der Ampere-Abrundung freie Leistung wird dem stufenlosen Heizstab angeboten.
- Nach Versorgung des priorisierten Fahrzeugs wird verbleibender Ueberschuss
  auf weitere freigegebene Fahrzeuge verteilt.
- Die 1-/3-phasige Empfehlung beachtet den Umschalthaken und die getrennten
  Stromgrenzen jedes Fahrzeugs.
- Erreicht ein Gerät seine SoC-, Temperatur- oder Sicherheitsgrenze, bleibt es
  auch bei zusätzlicher PV-Leistung gesperrt.

Die unmittelbar simulierten Werte stehen vollständig unter:

```text
ems-optimizer.0.Control.Targets.Battery_W
ems-optimizer.0.Control.Targets.MyPV_DHW_W
ems-optimizer.0.Control.Targets.Wallbox0_W
ems-optimizer.0.Control.Targets.Wallbox0_A
ems-optimizer.0.Control.Targets.Wallbox1_W
ems-optimizer.0.Control.Targets.Wallbox1_A
ems-optimizer.0.Control.Targets.Wallbox2_W
ems-optimizer.0.Control.Targets.Wallbox2_A
ems-optimizer.0.Control.Targets.Wallbox0_Phases
ems-optimizer.0.Control.Targets.Wallbox1_Phases
ems-optimizer.0.Control.Targets.Wallbox2_Phases
```

## Abgleich der aktiven Wallbox- und E-Heizer-Skripte

Version 0.7.0 berücksichtigt ausschließlich die aktuell aktiven Skripte;
deaktivierte Altversionen wurden nicht übernommen.

| Funktion | Umsetzung im Adapter | Zuständigkeit bis zur Produktivfreigabe |
|---|---|---|
| Fahrzeugpriorität | Grundrang Wallbox 0/1/2, `socfrei`, `alw`, Fahrzeugstatus und `javascript.0.ev.prio` | Erst priorisiertes Fahrzeug, danach weitere Fahrzeuge mit Restueberschuss |
| SoC-Verwaltung | Mindest-SoC, Ziel-SoC, fehlende kWh und Abfahrtszeit | Adapter-Simulation |
| Phasenerkennung | Direkte Auswertung von L1/L2/L3 mit mehr als 5 A; alter Phasenwert nur als Rückfall | Adapter-Simulation |
| Wallbox + Trinkwasser | 50/50-Verteilung, ungenutzter Anteil wird dem anderen Gerät angeboten | Prognose und 2-s-Regler |
| Hysterese einphasig | EIN über 4.000 W, AUS unter 3.000 W | Konfigurierbar unter `Config.DHWParallelStartPower1P_W` und `Config.DHWParallelStopPower1P_W` |
| Hysterese dreiphasig | EIN über 9.000 W, AUS unter 8.000 W | Konfigurierbar unter `Config.DHWParallelStartPower3P_W` und `Config.DHWParallelStopPower3P_W` |
| E-Heizer-Schutz | 9-kW-Maximum und bestehende Temperaturkennlinie | Adapter simuliert den sicheren Sollwert |
| NVP-Ausregelung | Alle 2 Sekunden innerhalb des aktuellen Fahrplans | Adapter simuliert; Batterie schließt die verbleibende Lücke |
| Ampere-/Freigabeschreiben, Hausanschlussschutz | Nicht doppelt implementiert | Aktive `Werte_schreiben_0/1/2_V2`-Skripte |
| Phasenumschaltung | 1-/3-phasige Empfehlung mit fahrzeugspezifischen Grenzen; noch kein Aktorzugriff | Bestehende lokale Skripte schalten real |
| RFID und Fehlerquittierung | Nicht doppelt implementiert | Bestehende lokale Skripte |
| EHZ-Pumpe und Raum-PV-Boost | Nicht doppelt implementiert | `EHZ-Pumpe_V2` und `EHZ-P2FBH` |

Der aktuelle Abgleich ist außerdem maschinenlesbar unter
`ems-optimizer.0.System.ActiveScriptAudit_JSON` abgelegt. Es werden mit dieser
Version keine Adapter-Objekte entfernt.

### Skriptumschaltung

Solange die produktive EHZ-Freigabe ausgeschaltet ist, bleiben
**alle derzeit aktiven Wallbox- und E-Heizer-Skripte eingeschaltet**. Insbesondere
bleiben `PV_Sicherung`, `Werte_schreiben_0_V2`, `Werte_schreiben_1_V2`,
`Werte_schreiben_2_V2`, `EHZ-Pumpe_V2` und `EHZ-P2FBH` aktiv. Ein Abschalten der
Schreibskripte wäre jetzt falsch, weil der Adapter ihre reale Funktion noch
nicht übernimmt.

Erst mit einer späteren, ausdrücklich produktiv freigegebenen Adapterversion
werden wegen doppelter Entscheidungslogik zunächst folgende Skripte abgelöst:

- `PV_Fahrplan`
- `PV_Nacht`
- `PV_Ueberschuss_Freigabe`
- `PV_Ueberschuss_Stufen`
- `PV_Ueberschuss_Verteilung`
- `EHZ-Aufteilen_V5`
- `EHZ-Leistung_V2`

Die drei Skripte `Werte_schreiben_0_V2`, `Werte_schreiben_1_V2` und
`Werte_schreiben_2_V2` dürfen erst abgeschaltet werden, wenn der Adapter die
go-e-Ausgänge einschließlich Hausanschlussgrenze, §14a, Rampen und Rückmeldung
nachweislich selbst übernimmt. `PV_Sicherung`, die übergeordneten
§14a-/EEBUS-Funktionen, `EHZ-Pumpe_V2`, `EHZ-P2FBH`, Geräte- und
Temperaturschutz sowie Notabschaltungen bleiben auch dann als unabhängige
Sicherheitsebene aktiv. `PV_Ueberschuss_SOCmin` und `PV_min_max` bleiben in der
ersten Übergangsstufe ebenfalls aktiv, solange ihre Zustände noch Eingänge des
Adapters sind.

## Entwicklungshistorie

| Version | Änderung |
|---|---|
| 0.12.4 | Produktive NVP-Regelung des Trinkwasser-EHZ auf direkte SMA-Netzwerte umgestellt; Rückmelde-/Beruhigungslogik für den AC THOR, sofortige Reduktion bei Netzbezug, adaptive 1.000-/500-/200-W-Schritte und zusätzliche Diagnoseobjekte ergänzt. |
| 0.12.3 | Zeitüberwachung an Sensorverhalten angepasst: unveränderte Tanktemperaturen bis 60 Minuten gültig, dynamische Ausgangstemperatur und Regler weiterhin eng überwacht. Produktiver Trinkwasser-Heizstab und langsame Zielverteilung standardmäßig alle 5 Sekunden. |
| 0.12.2 | Hausanschlussbegrenzung des EHZ auf aktuelle SMA-Phasenströme umgestellt; statische `FreieAmpere`-Werte dürfen unverändert bleiben, ohne den Watchdog auszulösen. |
| 0.12.1 | Watchdog ergänzt: produktiver EHZ fällt auf 0 W, wenn EMS- oder Echtzeitregelung nicht mehr innerhalb ihrer zulässigen Zeit aktualisiert werden. |
| 0.12.0 | Dreifach gesperrter Produktivausgang ausschließlich für den Trinkwasser-EHZ; konfigurierbarer Sollwert, 1-kW-Inbetriebnahmegrenze, Temperatur-/Daten-/HA-Prüfung, Stufenverzögerung und sichere Abschaltung. |
| 0.11.0 | Globale und gerätespezifische Freigaben ergänzt; nicht vorhandene Geräte werden aus Planung und Simulation entfernt. Trinkwasserkennlinie auf vier konfigurierbare Temperatur-/Leistungspaare umgestellt und sichere Skript-Umschaltfolge dokumentiert. |
| 0.10.0 | Konfigurationsseite fuer Fahrzeuge, beide Heizstaebe, Batterie, NVP-Regelung sowie Preise/Netzentgelte gegliedert; Trinkwasser-Temperaturkennlinie konfigurierbar. |
| 0.9.0 | Sichtbare Fahrzeugkonfiguration, eigener Haken fuer 1-/3-phasige Umschaltung, getrennte Stromgrenzen und parallele Nutzung mehrerer Wallboxen bei Restueberschuss. |
| 0.8.0 | Fahrplan als Freigabe statt starrem Leistungsdeckel; zusätzliche reale PV-Leistung wird verteilt. Wallboxen in ganzen Ampere ab 6 A, langsame Verbraucher alle 10 s und Batterieausregelung alle 2 s. |
| 0.7.0 | Aktive Wallbox-/E-Heizer-Skripte abgeglichen: vollständige Fahrzeugpriorität, direkte Phasenerkennung und 50/50-Verteilung mit 4/3-kW- bzw. 9/8-kW-Hysterese in Prognose und 2-s-Simulation. |
| 0.6.0 | Trinkwasser-Heizstab mit Temperaturkennlinie, 9-kW-Grenze und reiner Sollwertsimulation ergänzt. |
| 0.3.2 | Versionsmeldungen des Adapters vereinheitlicht; keine Änderung der EMS-Logik oder Objekte. |
| 0.3.1 | Konfigurierbare Mindestgrundlast verhindert unplausible Nullwerte nach Abzug historischer flexibler Verbraucher. Standard: 500 W über `ems-optimizer.0.Config.MinimumBaseload_W`. |
| 0.3.0 | EMS-Logik ohne Funktionsänderung in Module für Kern, Historie, Prognose, Planung, Beobachtung und Start getrennt. |
| 0.2.10 | Aufbewahrung der EMS-eigenen SQL-Ausgänge auf 90 Tage begrenzt. |
| 0.2.9 | SQL-Historie speicherschonend nacheinander und in Sieben-Tage-Blöcken. |
| 0.2.8 | Adapter-Icon und Objekt `info.connection` ergänzt. |
| 0.2.7 | Batterieladung in das spätestmögliche sichere PV-Fenster verschoben. |
| 0.2.6 | Fahrzeug-SoC, Ladeziel und Freigabe sowie parallele Verteilung zwischen Trinkwasser und Wallbox ergänzt. |
| 0.2.5 | Dreistufige Batterieladung: morgens 70 %, nachmittags 90 %, später Abschluss auf 100 %. |
| 0.2.4 | Batterieentladung für Eigenverbrauch und Kennzahlen zur Speicherbewertung ergänzt. |
| 0.2.3 | PV-Skalierung korrigiert; Hauslast und bereinigte Grundlast getrennt. |
| 0.2.2 | my-PV-Historie auf einen historisierten Gesamtleistungswert umgestellt. |
| 0.2.1 | ECharts-kompatible `json_chart`-Objekte ergänzt. |
| 0.2.0 | 48-Stunden-Gerätefahrplan für Batterie, zwei Heizstäbe, PV-Boost und drei Wallboxen. |
| 0.1.2 | Vier Unterzähler, Profile je Wochentag/Feiertag und getrennte Preisbestandteile. |
| 0.1.1 | Wetter- und PV-Prognose für fünf PV-Flächen. |
| 0.1.0 | Erster reiner Beobachtungsmodus. |

## Lizenz

MIT
