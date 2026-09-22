# Schattenbetrieb ab 0.17.0-alpha.19

Der Schattenbetrieb beantwortet: **Welche Leistungen würde das EMS bei
freigegebenem Master mit den aktuellen Messwerten und Gerätefreigaben anfordern?**
Er läuft zusätzlich zur bisherigen Beobachtersimulation. Dieselben Engine-Module
wie im Produktivbetrieb berechnen in einer getrennten Umgebung die Entscheidungen
für Wallboxen, Trinkwasser-EHZ, Heizpuffer-EHZ, Speicher und WP-Empfehlung.

Nur in dieser privaten Rechenumgebung gilt der Master als eingeschaltet.
Vorhanden-/Gerätefreigaben, Inbetriebnahmebestätigungen, Konfiguration,
SoC-Grenzen, Temperatur- und Kühlsperren bleiben maßgeblich. Ein noch nicht
konfigurierter Speicher wird dadurch nicht automatisch freigegeben.
Bereits bestehende thermische Hysteresesperren werden aus dem laufenden Regler
nur gelesen, damit die Vorschau auch innerhalb des Hysteresebands korrekt startet.
Die reale Instanzkonfiguration und die realen Steuerdatenpunkte werden nicht
geändert. Die Umgebung besitzt keine Verbindung zu realen Stellbefehlen,
Skriptabonnements oder SQL-Aufträgen.

## Einschalten und lesen

Nach dem GitHub-Update und Adapterstart:

1. **Master release for configured real outputs** bleibt ausgeschaltet.
2. **Enable simulation** bleibt eingeschaltet.
3. `ems-optimizer.0.Debug.Shadow.Enabled` steht standardmäßig auf `true`.
4. `Debug.Shadow.Valid`, `Summary` und `LastUpdate` prüfen.

Bei eingeschaltetem realem Master pausiert die Vorschau ausdrücklich. Die
produktiven Diagnoseobjekte unter `Debug` laufen wie bisher weiter.
Ein ausgeschalteter Schattenbetrieb oder eine ungültige Berechnung darf keine
alten positiven Schattenziele als aktuell gültig anzeigen.

Alle folgenden Objektpfade liegen unter `ems-optimizer.0.Debug.Shadow`:

| Objekt | Inhalt |
| --- | --- |
| `Summary` | Zusammenfassung der Entscheidung und des Betriebszustands |
| `Valid`, `LastUpdate` | Gültigkeit und Zeitpunkt der Vorschau |
| `SelectedWallbox`, `FineRegulator` | Ausgewähltes Fahrzeug und zuständiger Feinregler |
| `Targets.Wallbox0_W` bis `Wallbox2_W` | Angeforderte Wallboxleistungen |
| `Targets.Wallbox0_A` bis `Wallbox2_A` | Angeforderte Ladeströme |
| `Targets.Wallbox0_Phases` bis `Wallbox2_Phases` | Verwendete Phasenanzahl |
| `Targets.MyPV_DHW_W`, `Targets.MyPV_Heating_W` | Leistungsvorschläge für die beiden Heizkreise |
| `Targets.Battery_W` | Interner Speichersollwert: positiv Laden, negativ Entladen |
| `Targets.HeatPumpMode` | WP-Empfehlung `REDUCED`, `NORMAL` oder `BOOST` |
| `Actuals.*` | Tatsächlich gemessene Leistungen zum Vergleich |
| `Wallbox0.Summary` bis `Wallbox2.Summary` | Fahrzeugbezogene Erläuterungen |
| `Battery.Summary`, `MyPV_DHW.Summary`, `MyPV_Heating.Summary`, `HeatPump.Summary` | Gerätebezogene Erläuterungen |
| `Wallbox0.OutputBlockReason` bis `Wallbox2.OutputBlockReason`, `Battery.OutputBlockReason`, `MyPV_DHW.OutputBlockReason`, `MyPV_Heating.OutputBlockReason` | Bekannte Sperre vor einer tatsächlichen Ausgabe |
| `Snapshot_JSON` | Zusammengehörige Entscheidung mit Kontext und Grenzen |
| `SQL.Status`, `SQL.Enabled`, `SQL.ConfiguredCount` | Ergebnis der SQL-Einrichtung |

Ein Schatten-Sollwert ist ein berechneter Bedarf und kein bestätigter
Gerätestellwert. Auch bei gültiger Verteilung kann eine zusätzliche
Ausgangssperre bestehen; deshalb `OutputBlockReason` mitlesen. Eine leere
Vorprüfung ersetzt keine reale Start-/Rückmeldesequenz.
Fehlende Messwerte bleiben als unbekannt erkennbar. Die
Gültigkeitsreihe gehört deshalb in eine spätere Diagrammauswertung dazu.

## 24-Stunden-Aufzeichnung in SQL

Die Einrichtung erfolgt automatisch **beim Start der neuen Adapterversion** in
der unter `historyInstance` konfigurierten SQL-Instanz, beispielsweise `sql.0`.
Der Adapter wartet auf die Rückmeldung für jede ausgewählte Zeitreihe.
`SQL.Enabled=true` bedeutet, dass alle angeforderten Einstellungen bestätigt
wurden; `SQL.ConfiguredCount` nennt deren Anzahl. Ein SQL-Fehler stoppt die
Schattenberechnung nicht und wird in `SQL.Status` sichtbar.

Gespeichert werden ausschließlich die dafür ausgewählten skalaren Datenpunkte
unter `Debug.Shadow`: Soll- und Istleistungen, Ströme, Gültigkeit, Betriebsarten
und Gründe. Große JSON-Snapshots und die vorhandenen Debug-Ringspeicher werden
nicht zusätzlich als ganze Dokumente in SQL geschrieben.

Leistungsreihen werden bei Änderung mit einer Begrenzung auf einen Wert pro
zehn Sekunden aufgezeichnet. Spätestens nach 60 Sekunden wird ein unveränderter
Wert erneut gespeichert. Zustands- und Begründungswechsel erhalten keine solche
Zehn-Sekunden-Sperre. Die Aufzeichnung beginnt ab der Einrichtung; vergangene
Schattenentscheidungen lassen sich nicht nachträglich erzeugen.

Die Einstellung lautet `retention: 86400` Sekunden, also 24 Stunden.
**SQL 4.1.5 ergänzt bei kurzen Aufbewahrungszeiten intern einen Tag und bereinigt
periodisch.** Die Datenbank kann deshalb ältere Werte länger enthalten; dies ist
keine minutengenaue Löschung nach 24 Stunden. Der Schattenbetrieb führt keine
eigenen SQL-Löschbefehle aus. Bestehende Messreihen und deren 90-Tage-Historie
bleiben unverändert.

## Aussagegrenze

Die Vorschau berechnet Entscheidungen anhand echter, laufend erneuerter
Messungen. Sie erfindet keine Schaltbestätigung und verändert keine gemessene
Leistung, Temperatur oder Batterie-/Fahrzeugladung. Läuft ein Bestandsskript,
gehen dessen tatsächliche Geräteleistungen in die nächste Vorschau ein.

Damit können wir Verteilung, Prioritäten, Startbedingungen, SoC-Grenzen,
Preisreaktion, Speicher-Feinregelung und Kühlsperren prüfen. Ein vollständiger
virtueller Tagesverlauf nach allen hypothetischen Schaltbefehlen wird nicht
behauptet: Mindestlaufzeiten nach bestätigtem Gerätestart, reale Ladeabbrüche,
Schaltverzögerungen und Kommunikation müssen im begleiteten Gerätetest geprüft
werden. Der Schattenbetrieb erteilt keine zusätzliche Ausgangsfreigabe.
