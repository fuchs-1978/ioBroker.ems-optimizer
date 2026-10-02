# Schattenbetrieb ab 0.17.0-alpha.21

Der Schattenbetrieb beantwortet: **Welche Leistungen würde das EMS bei
freigegebenem Master mit den aktuellen Messwerten und Gerätefreigaben anfordern?**
Er läuft zusätzlich zur bisherigen Beobachtersimulation. Dieselben Engine-Module
wie im Produktivbetrieb berechnen in einer getrennten Umgebung die Entscheidungen
für Wallboxen, Trinkwasser-EHZ, Heizpuffer-EHZ, Speicher und WP-Empfehlung.
Zusätzlich durchläuft jede Wallbox den produktiven Ausgangsablauf in einem
isolierten Modell. Strom-/Freigabebefehle werden dort privat sofort bestätigt.
Ab alpha.21 wird dazu eine ideale elektrische Wallbox-Antwort bei 230 V
angenommen. Die private Netzleistung wird um die Differenz zwischen realer und
modellierter Wallboxlast korrigiert. So passt die Leistungsantwort zum vorherigen
Modellbefehl, auch wenn die Bestandsskripte einen anderen Strom vorgeben.
Echte Messungen bleiben separat erhalten; SoC und Phasenwechsel werden nicht
simuliert. Fehlerstatus, Quellenqualität und physische Schutzwerte bleiben bindend.

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
| `Modeled.Wallbox0_W/A/Phases` bis `Wallbox2_W/A/Phases` | Modellierter Ausgang nach Start-, Rampen-, Halte- und Sperrlogik |
| `Response.Valid`, `Response.Grid_W` | Quellenprüfung und angenommene Netzleistung für die elektrische Wallbox-Antwort; ausdrücklich keine reale Messung |
| `WallboxN.ModelOwned`, `ModelStatus` | Virtuelle Übernahme und Ablaufzustand für N = 0, 1, 2 |
| `WallboxN.MinimumRunTimeRemaining_s`, `StopDelayRemaining_s` | Restzeiten des isolierten Ausgangsmodells |
| `Targets.MyPV_DHW_W`, `Targets.MyPV_Heating_W` | Leistungsvorschläge für die beiden Heizkreise |
| `Targets.Battery_W` | Interner Speichersollwert: positiv Laden, negativ Entladen |
| `Targets.HeatPumpMode` | WP-Empfehlung `REDUCED`, `NORMAL` oder `BOOST` |
| `Actuals.*` | Tatsächlich gemessene Leistungen zum Vergleich |
| `Wallbox0.Summary` bis `Wallbox2.Summary` | Fahrzeugbezogene Erläuterungen |
| `Battery.Summary`, `MyPV_DHW.Summary`, `MyPV_Heating.Summary`, `HeatPump.Summary` | Gerätebezogene Erläuterungen |
| `Wallbox0.OutputBlockReason` bis `Wallbox2.OutputBlockReason`, `Battery.OutputBlockReason`, `MyPV_DHW.OutputBlockReason`, `MyPV_Heating.OutputBlockReason` | Bekannte Sperre vor einer tatsächlichen Ausgabe |
| `Snapshot_JSON` | Zusammengehörige Entscheidung mit Kontext und Grenzen |
| `DecisionRecord` | Kompakter zusammengehöriger SQL-Datensatz mit Zyklus, Zeit, Bedarf, Modell und echten Rückmeldungen |
| `CycleId` | Fortlaufende Zyklusnummer seit diesem Adapterstart |
| `RecordSequence`, `RecordQueueDepth`, `RecordDropped`, `RecordWriteErrors`, `RecordLastError` | Reihenfolge und Zustand der Datensatz-Veröffentlichung; Verluste/Fehler bleiben sichtbar |
| `SQL.Status`, `SQL.Enabled`, `SQL.ConfiguredCount` | Ergebnis der SQL-Einrichtung |

Ein Schatten-Sollwert ist ein berechneter Bedarf. Ein modellierter Ausgang ist
eine ausdrücklich angenommene Befehlsfolge. Beide sind keine bestätigten realen
Gerätestellwerte. Auch bei gültiger Verteilung kann eine zusätzliche
Ausgangssperre bestehen; deshalb `OutputBlockReason` und `ModelStatus` mitlesen.
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
unter `Debug.Shadow`: Soll-, Modell- und Istleistungen, Ströme, Gültigkeit,
Betriebsarten und Gründe. Hinzu kommt `DecisionRecord` als einzelner
zusammengehöriger Textdatensatz. Große JSON-Snapshots und die Debug-Ringspeicher werden
nicht zusätzlich als ganze Dokumente in SQL geschrieben.

Gemessene Leistungsreihen und Countdownwerte behalten die Begrenzung auf einen
Wert pro zehn Sekunden. Soll- und Modellausgänge, Zustands- und
Begründungswechsel erhalten keine solche Sperre. Unveränderte Einzelwerte
werden nach 60 Sekunden erneut gespeichert.

`DecisionRecord` wird bei relevanten Zustandswechseln und als eigener
60-Sekunden-Lebensnachweis geschrieben. SQL-Wiederholwerte sind dafür deaktiviert.
Die eigene Zyklusnummer, Zeitpunkt, `valid`, `targets`, `modeled` und
`realFeedback` ermöglichen eine konsistente Auswertung. Einzelne skalare Reihen
sind keine atomare Zeile und sollen keinen vermeintlichen Neustart allein durch
einen verspäteten Wiederholwert beweisen. Reale Rückmeldungen enthalten Wert,
Quellzeitpunkt, Qualität und Bestätigung. Auch bei Master EIN werden sie im
ungültigen/pausierten Datensatz weiter aufgezeichnet, ohne das Modell zu starten.
Datensätze werden in Reihenfolge veröffentlicht. Eine begrenzte Warteschlange
hält bis zu 128 weitere Datensätze zusätzlich zum laufenden Schreibzugriff.
Überlauf und fehlgeschlagene Veröffentlichungen stehen in Diagnosezählern sowie
im nächsten Datensatz. `recordSession` und `recordSequence` machen solche
Lücken erkennbar. Ein Adapterende oder nicht beobachtete Quellereignisse werden
dadurch nicht nachträglich rekonstruiert.
Die Aufzeichnung beginnt ab Einrichtung; vergangene Schattenentscheidungen
lassen sich nicht nachträglich erzeugen.

Die Einstellung lautet `retention: 86400` Sekunden, also 24 Stunden.
**SQL 4.1.5 ergänzt bei kurzen Aufbewahrungszeiten intern einen Tag und bereinigt
periodisch.** Die Datenbank kann deshalb ältere Werte länger enthalten; dies ist
keine minutengenaue Löschung nach 24 Stunden. Der Schattenbetrieb führt keine
eigenen SQL-Löschbefehle aus. Bestehende Messreihen und deren 90-Tage-Historie
bleiben unverändert.

## Aussagegrenze

Die Vorschau berechnet Entscheidungen anhand echter, laufend erneuerter
Messungen. Das Ausgangsmodell nimmt in seinem privaten Speicher eine
unmittelbare Strom-/Freigabebestätigung und eine ideale elektrische
Wallbox-Leistungsantwort an. Für diesen Rechenzweig gilt:
`Netzleistung Modell = Netzleistung real + Summe(Wallboxleistung Modell − Wallboxleistung real)`.
Damit bleiben Erzeugung und sonstige Lasten als gemessene Randbedingungen
erhalten. Die originalen Quellobjekte werden nicht verändert. Ungültige oder
veraltete Quellwerte werden durch die Annahme nicht repariert; die
Antwortgültigkeit muss bei der Auswertung berücksichtigt werden.
Ein angeforderter Phasenwechsel wird erst durch eine echte go-e-Phasenmeldung
bestätigt. Temperaturen, SoC, EHZ- und Speicherantwort werden nicht simuliert.

Damit können wir Verteilung, Prioritäten, Startbedingungen, SoC-Grenzen,
Preisreaktion, Speicher-Feinregelung und Kühlsperren prüfen. Das Wallboxmodell
zeigt zusätzlich Start, Rampe, Mindestlaufzeit und Abschaltverzögerung. Es ist
keine Simulation der vollständigen Anlage: Reale Hausanschluss- und
Phasenstromgrenzen sowie die tatsächliche EHZ-Antwort können Modellrampen
weiterhin begrenzen. Reale Ladeabbrüche,
Geräteverzögerungen und Kommunikation müssen im begleiteten Gerätetest geprüft
werden. Der Schattenbetrieb erteilt keine zusätzliche Ausgangsfreigabe.

Die Konfiguration der Phasenführung und die Änderungen aus den SQL-Auswertungen
stehen in [Issues #57–#60 / alpha.20](issues57-60-alpha20.md).
Die Messwerttoleranz, die Budgetdiagnose und der SQL-Auswerter sind in
[Issue #62 / alpha.21](issue62-alpha21.md) beschrieben.

## Zyklus und Quellenqualität ab alpha.28

DecisionRecord ergänzt `adapterVersion` und `protectionFeedback`. Die Schutzquellen
bleiben echte Messungen, auch wenn die elektrische Wallboxantwort virtuell ist.
`realFeedback.*.maxAgeMs` erklärt die geltende Altersgrenze; null steht hier für
einen bewusst ohne Altersgrenze retained Zustand, nicht für einen fehlenden Messwert.
Startresetzähler stehen unter `allocation.WallboxN.start.history` beziehungsweise
`startHistory` bei nicht ausgewählter Wallbox. Sie gelten für die aktuelle Regler-VM,
nicht als persistente Tageszähler. Ein neuer Versuch nach Budgetmangel ersetzt keine
Kontinuität durch einen SQL-/Sitzungsausfall.

Die skalare Abschlussmarke `ScalarCycleId` wird erst nach sämtlichen Werten geschrieben.
Vollständige Frames sind geordnet, bei langsamer Speicherung werden Zwischenframes
gezählt zusammengefasst. Fehlgeschlagene Frames bekommen keine neue Abschlussmarke.
Die Abschlussmarke ist keine SQL-Durabilitätsbestätigung und keine Mehr-State-Transaktion.
DecisionRecords bleiben in der gesonderten begrenzten FIFO-Warteschlange;
`ScalarSkippedCycles` ist nicht `RecordDropped`.
