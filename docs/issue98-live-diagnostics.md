# Tages-Issue #98: Diagnose, Phasenvertrag und Reproduktion

Grundlage erneut gelesen: main `381edcb951ee8014e4581a93cfb2669b71a6f7eb`,
0.17.0-alpha.37; Issues #98, #86, #57/#60/#62 einschließlich Kommentare,
geschlossenes #92 und zusammengeführte PRs #93/#96/#97. Die bereits enthaltenen
Warmwasser-, Prognose-, Grundlast- und Schatten-Zeitkorrekturen werden nicht
erneut umgesetzt. Kein Versionswechsel, Merge oder Anlagenzugriff zum Schreiben.

## 1. Produktive Diagnose und PV-Quellenvertrag

**Belegt:** Der bisherige `Debug.Shadow.DecisionRecord` ist eine geordnete,
begrenzte FIFO mit Sitzung/Sequenz, Verlust-/Schreibfehlerzählern und 60-s-
Lebenszeichen. SQL-Metadaten am 06.10. erneut gelesen: sql.0, 86.400 s,
blockTime=0, changesRelogInterval=0. Bei Master EIN pausiert das Modell
absichtlich; sein Record enthielt Realfeedback, aber keine produktiven Budgets,
Timer oder Befehlskette. Debug-Ringe sind auf 100 Ereignisse/120 Tracewerte begrenzt.

**Änderung:** Derselbe Aufnahmeweg erhält produktive Records (`schema=2`),
regelmäßig im vorhandenen Sekundentakt und unmittelbar bei Befehl, relevanter
Ausgangsflanke und WB-Quellenrückmeldung. Ein Record ist ein unteilbarer JSON-
Cacheframe; physische Quellen bleiben asynchron und behalten ACK/q/Quellenzeit.
Es entsteht kein neuer SQL-Datenpunkt, keine neue automatische SQL-Konfiguration.

- `recordSession`/`recordSequence` gelten für beide Betriebsarten gemeinsam.
- `mode` trennt PRODUCTION, PRODUCTION_GATE_INCOMPLETE und MASTER_OFF.
  `controlState` zeigt beide Schreibfreigaben und observerOnly einzeln.
- `production.control`, `wallboxes[].allocation`, `timers`, `responseDeadlines`
  und `deviceRuntime` enthalten Auswahl, Budget vor Quantisierung,
  Start-/Mindestlauf-/Stoppzeit, laufende Vorgänge und tatsächlich konfigurierte Fristen.
- `event.commandId` = Sitzung + Befehlssequenz; `production.commands` enthält
  Ziel-ID, Wert, `issuedAt` und aktuelle Roh-Rückmeldung. `command.attempt`,
  `transport_complete` und `transport_error` bedeuten Schreibversuch bzw.
  Transportergebnis. Sie sind keine Geräte-ACK und kein elektrischer Erfolg.
- `source.update` bewahrt auch ACK=false, q!=0 und NULL, bevor ein späterer
  Poll sie ersetzt. Fahrzeugstatus, Strom/Leistung und L1–L3 bleiben getrennt.
- `ResponseSentAt`, `ResponseAcknowledgedAt`, `ResponseConfirmedAt`,
  `ResponseState`, `StopConfirmedAt` und `StopPowerPending` zeigen den jeweiligen
  Ausgangsablauf. Nach Master AUS wird eine noch offene Ausgabe/Abschaltung
  weiter beobachtet. Eine alte Bestätigung muss zu ihrem Befehl passen.
- `production.power.grid_W` und die gerichteten Quellen zeigen reale
  Netzleistung; `valid=false/modelPaused=true` bewertet weiterhin das pausierte
  Schattenmodell. Produktive Reglergültigkeit steht in `production.control.Valid`;
  Messgültigkeit steht an jeder Quelle. Kein Telemetriefehler allein aus Modellpause.

**PV-Ursache:** `DebugRecorder.measurement` verlangte ACK=true, während
`observe/readFreshNumber` die skriptgenerierte PV-Summe bereits ohne ACK-Pflicht
auf numerischen Wert, Qualität und Alter prüft. Die aktuelle Quelle
`javascript.0.PV.Eigenerzeugung` erneut gelesen: 0 W, ACK=false; System.DataValid
war true. Das erklärt den Debug-NULL-Wert, beweist aber keinen PV-Ausfall und
keine Ursache der Tagesstopps. Die Diagnose folgt jetzt ausschließlich für die
zugeordnete PV-Messsumme diesem bestehenden Vertrag: maximal 120 s alt,
numerisch, gute Qualität; Roh-ACK bleibt sichtbar. Netz-, Geräte-, Schutz- und
Prognose-ACK-Prüfungen bleiben erforderlich. Ungültige PV bleibt NULL.

System.Mode/Status werden im Beobachtungstakt auch bei fehlender Planungshistorie
erneuert; Control.Mode/Status und der Warmwasser-Diagnosetext unterscheiden
Produktivfreigabe und Simulation. Produktivfreigabe ist kein Nachweis aktiver Last.

**Grenzen:** Es sind Cacheframes, keine synchronen Messungen oder ein SQL-
Commitbeweis. Ein bestätigter ioBroker-State-Schreibaufruf beweist nicht die
anschließende SQL-INSERT-Operation. Die FIFO hat weiterhin maximal 128 wartende
Records plus einen laufenden. Überlast/Fehler werden ausdrücklich gezählt;
keine Verlustfreiheit unter beliebig langsamer Speicherung zugesichert.
Produktive Sekundendaten und Quellenflanken erzeugen mehr Daten als frühere
60-s-Pausenrecords; Speicher-/SQL-Durchsatz ist noch real zu prüfen. Abbruch,
Crash und unbeobachtete Neustartgrenzen bleiben unbekannt. Der vorhandene
Unload verwirft wartende Records, damit sichere Ausgänge nicht auf Diagnose-I/O
warten; die letzte Abschaltung beim Prozessende benötigt zusätzliche externe
SQL-Quellen und darf nicht als lückenlos aufgenommen behauptet werden.

## 2. Phasen-Rückfallvertrag

**Belegt:** Das aktive `script.js.EMS.Phasenumschaltung_V1` am 06.10. erneut
gelesen: Prüfung von Control.Valid/Verbindung, kein Master; nach 15 s nur
Zahlenvergleich. Die Repository-Unterlagen enthielten bisher kein ausführbares
Master-gekoppeltes Beispiel. Der Adapter schaltet keine Phasen; er prüft den
bestätigten Modus unabhängig auf ACK/Qualität, wartet in EMS-Phasenführung
begrenzt (aktuell 180 s) und behält harte Schutz- und Budgetstopps bei.
Seine Freigabesicherung kann den externen Skriptschreiber nicht sperren.

**Vorschlag:** `examples/ems-phase-follow.js` ist standardmäßig deaktiviert,
wird vom Adapter weder geladen noch installiert. Vor einem neuen Schreibversuch
braucht es Master EIN, bestätigten gültigen/frischen Reglerlauf, EMS-Phasenmodus,
Verbindung und frisches 1P/3P-Ziel. Masterwechsel/Stop entwerten ausstehende
Callbacks per Generation und löschen Timer; verzögerte Callbacks dürfen nach
AUS/EIN keinen alten Erfolg melden. Die Bestätigungsprüfung verlangt
ACK=true, q=0 (ioBroker: fehlendes q entspricht 0), Quellenzeit **nach** dem
Befehl und innerhalb der Prüfungsfrist. Ziel und Freigaben werden erneut geprüft.
Das Beispiel begrenzt die ACK-Ablesung auf 20 s und Wiederholversuche auf
höchstens einmal pro 60 s; das ändert keinen Adapter-Reglertimer. Der Adapter-
Phasenwartepfad bleibt zusätzlich unabhängig wirksam.

Bereits an go-e übertragene Befehle können durch Master AUS nicht zurückgerufen
werden. Der Vertrag verhindert neue bzw. noch im Skript ausstehende Ausführungen
und ungültige Bestätigungen. Ein externer Phasenschreibversuch erscheint im
Recorder als Quellenflanke (`phaseSwitchMode`, ACK=false, Quellzeit); er hat
keine erfundene adaptereigene commandId. Zur externen Zuordnung dienen Ziel-ID
und Schreibzeit, danach die frische Modus-ACK. Eine Skriptlogmeldung ist kein
elektrischer Messbeweis. Konfigurierte Stellung, Meldung und L1–L3-Antwort sind
getrennt zu bewerten. go-e kann unter Last umschalten; die fehlende externe
Stillstandsprüfung allein beweist keine gefährliche Umschaltung.

Bis ein geprüftes Beispiel ausdrücklich lokal umgesetzt und abgenommen wurde:
**zuerst Phasenskript AUS, danach Master AUS.** Dieser PR verändert das laufende
Skript nicht und ersetzt die manuelle Reihenfolge nicht.

## 3. Schatten-Asynchronie: Reproduktion ohne Regleränderung

Erneut gelesene SQL-Kurzfenster (UTC am 06.10.): 08:29:25–08:29:30,
08:33:22–08:33:28, 08:30:00–08:30:10, 12:23:48–12:23:53 und
12:34:37–12:34:42. Zusammen 19 Records, jeweils unter Limit 100.

| Sitzung / Seq. | Direkt erneut belegter Befund |
| --- | --- |
| 1791252525845 / 2528 | Modell-EQE AUS, Budget 334 W, beide Nachlauftimer 0; real 1.290 W und allow=1. |
| gleiche / 2539–2540 | Zeitversatz 13.509/14.535 ms, asynchrone Korrektur 1.290 W; Modellantwort ungültig. |
| gleiche / 2541 | Neue WB-Quelle, aktuelle Basis gültig; keine Änderung einer Freigabe behauptet. |
| gleiche / 2662 | Modell wieder 6 A/1.380 W, Mindestlauf 600 s; historische gemeinsame Basis, Fahrzeugmodell zunächst im 45-s-Warten. |
| 1791285019906 / 1990 | Modell-EQE AUS, Budget 437 W, Timer 0; real 1.280 W und allow=1. |
| gleiche / 2242 | Modell wieder 6 A/1.380 W, Mindestlauf 600 s; historische gemeinsame Basis, real 4.160 W/allow=1. |

Die erneut gelesenen Grenzen bestätigen 237,993 bzw. 649,008 s. Die vollständigen
89,179/120,716 s ungültige Modellzeit und 64,99 % EQV-Gültigkeit bleiben die
Tagesauswertung aus #98; die Kurzfenster berechnen diese Tageswerte nicht neu.

`test/fixtures/issue98-timing.json` bewahrt fünf reduzierte Original-Quellenframes
(Netz, WB-Leistung, Zeit/ACK/q und vorherige Modelllast). Der Regressionstest
wiederholt die aktuelle Zuordnung: 90/100 W unsynchrone Korrektur bleibt zulässig,
1.290 W bei großem Zeitversatz wird abgelehnt, ein neues synchroneres WB-Sample
erholt sich. Die vorhandenen Tests prüfen zusätzlich vollständige historische
Klammern, 15-s-Polling, 20-s-Maximalalter, Lastsprung/Lücken, ACK/q sowie die
alpha.37-Korrekturen für positive Netzrichtung und gemeinsame Korrekturbeträge.

**Kein Ursachenbeweis für die gesamte Pause:** Die Einzelrecords enthalten nicht
den vollständigen damaligen SampleBuffer und alle privaten Reglerzustände.
Historische Erholung wird deshalb mit vorhandenen synthetischen Gegenfällen
geprüft, nicht aus fehlenden Tagesklammern erfunden. Asynchronie kann Teile der
Modellgültigkeit erklären; der Budgetstopp hatte bereits eine gültige
Unterdeckungsentscheidung. 15-s-Polling, 20-s-Befehls-ACK und 45-s-Fahrzeugreaktion
sind verschiedene Fristen. Keine Änderung von Mindeststrom, Schutzgrenzen,
Start/Mindestlauf/Stopp oder Regelstrategie. Die aktuelle Anlage hat je 600 s;
die früheren Tagesstopps verwendeten 120 s Stoppzeit. Eine zusätzliche Regression
prüft: 120-s-Stoppzeit läuft innerhalb der 600-s-Mindestlaufzeit ab; nach deren
Ende folgt kein erfundener zweiter 120-s-Nachlauf.

## Reproduktion und nächste SQL-Abnahme

Isoliert: `node test/production-record.test.js`, `node test/phase-follow.test.js`,
`node test/debug-recorder.test.js`, `node test/lifecycle.test.js`,
`node test/shadow-controller.test.js`, `node test/shadow-wallbox-response.test.js`,
`node test/wallbox-output.test.js` und `node test/control-integration.test.js`.
Diese Tests steuern keine echten Geräte. FIFO-Tests unterscheiden normal erhaltene
Flanken, verzögerte Speicherung, expliziten Überlauf und Schreibfehler.

Lokale Validierung: **951 Tests bestanden**, 34 Syntaxchecks, Paketprüfung und
`git diff --check` bestanden. Alle 34 übrigen Testdateien wurden vollständig
ausgeführt; in `shadow-analysis.test.js` zusätzlich 20 Analysetests bestanden.
Der bereits bekannte CLI-Unterprozesstest mit spawnSync/stdin blockiert hier und
wurde isoliert ausgelassen; gültige/ungültige CLI-Dateieingaben wurden zusätzlich
erfolgreich geprüft. Die unveränderte GitHub-CI führt den normalen Gesamtlauf
einschließlich CLI-Test aus. Keine reale Anlage angesteuert.

Für die nächste Tagesanalyse ausschließlich lesend:

1. Zuerst Metadaten auf tatsächlich historisierte IDs prüfen, dann begrenzte
   Raw-Fenster abrufen. Keine Abfrage nicht historisierter Control-/Devices-
   Einzelwerte und keine SQL-Einstellungen verändern. Bei schema=2 dient der
   bestehende DecisionRecord als gemeinsame Quelle; alte schema=1-Fenster bleiben
   unverändert, fehlende produktive Vergangenheit wird nicht rekonstruiert.
2. Sitzung/Sequenz, NULL, Parsefehler, Dropped/WriteErrors, QueueDepth und SQL-
   Logs prüfen. Zeitgewichten nur über aufeinanderfolgende Sequenzen gleicher
   Sitzung; keine NULL-, Neustart- oder Randfortschreibung. Cache-Schreibbestätigung
   mit tatsächlich gespeicherten SQL-Zeilen vergleichen.
3. Master AUS/EIN und Neustart getrennt nachweisen. Modellpause separat von
   fehlender Netz-/WB-Telemetrie zählen. Beide Freigaben und gültigen Control-
   Zeitstand verwenden; NoActuation und Textanzeigen allein reichen nicht.
4. Bei einem echten Start: Auslöser/Budget/Timer → commandId/issuedAt → passende
   ACK=true/q=0 mit Quellenzeit nach Befehl → neue Leistung und benötigte
   Phasenströme nach Befehl/ACK oder expliziter Timeout. 15 s Polling nicht als
   Fahrzeugantwort deuten; eingestellte ACK-/Fahrzeugfristen aus dem Record verwenden.
5. Bei Übergabe: alter allow=0 frisch bestätigt **und** Leistung elektrisch
   ruhig (inklusive frischer L1–L3), erst danach neue Freigabe und Fahrzeugantwort.
   StopPowerPending/Reservierung darf nicht als abgeschlossener Stopp gelten.
   NULL, q!=0, altes ACK oder ausbleibende Antwort sind kein Erfolg.
6. Bei Phase: neues Soll, externe ACK=false-Schreibflanke, danach frische
   Modus-ACK und separat elektrische L1–L3-Antwort. Unveränderte 1P-Stellung,
   Skriptmeldung und bloße configured-mode-ACK bestehen keine elektrische Umschaltabnahme.
   Phasen-Timeout und Master-Entzug müssen ohne neuen/alten Nachholbefehl bleiben.
7. Budgetunterdeckung gegen parallel laufende Mindestlauf-/Stoppcountdowns,
   verfügbares vorquantisiertes Budget und harte Grenzen prüfen. Die Änderung
   hat keine Verzögerung ergänzt. PV-NULL nur mit Quellvertrag/ACK/q/Alter erklären;
   BHKW nicht zusätzlich zum physisch bereits bilanzierten Netzbudget addieren.

Softwaretests sind keine Live-Lade-, Heiz-, Übergabe-, Phasen- oder Schutzabnahme.
Im Tagesfenster von #98 gab es unter Master EIN weiterhin nur 0 W WB/EHZ.
Letzter belegter Score 64/100; keine erwarteten Scorepunkte oder Freigabe zugesagt.
