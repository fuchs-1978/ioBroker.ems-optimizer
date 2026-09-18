# ioBroker EMS Optimizer

Aktuelle Version: **0.4.0**

Prognosebasierter Energiemanagement-Beobachter für ioBroker. Der Adapter führt
Messwerte, SQL-Historie, Wetter- und PV-Prognosen, Strompreise sowie flexible
Verbraucher in einem rollierenden 48-Stunden-Fahrplan zusammen.

Der aktuelle Entwicklungsstand arbeitet ausschließlich im **Beobachtermodus**:
Es werden Prognosen, Fahrpläne und Empfehlungen erzeugt, aber keine Wallbox,
kein Heizstab, keine Batterie und keine Wärmepumpe direkt angesteuert.

## Funktionen

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

Die Zuordnung der vorhandenen ioBroker-Datenpunkte erfolgt in der
Adapterkonfiguration über `dataPointMapJson`. Das Repository enthält mit
`config.example.json` eine neutrale Vorlage.

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

Der aktuelle Adapter schreibt ausschließlich in seinen eigenen Namespace
`ems-optimizer.0` und niemals auf konfigurierte Geräteausgänge.

## Entwicklungshistorie

| Version | Änderung |
|---|---|
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
