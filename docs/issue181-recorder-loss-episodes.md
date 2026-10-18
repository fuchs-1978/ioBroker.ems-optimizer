# Recorder-Verlustdiagnose zum Tagesbericht vom 18.10.2026

Grundlage: [#181](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/181),
fortgeführter Arbeitsauftrag [#169](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/169).
Vor der Umsetzung wurden main
[`c9c47db`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8),
die gemergten PRs #170–180, Release alpha.95 und bestehende Tests über den
GitHub-Connector gelesen. Die lokale Umsetzung baut auf genau diesem Stand auf.

## Anlass und eingegrenzte Änderung

Der Bericht nennt 514 fehlende Originale in 29 Record-Sequenzlücken sowie 2.686
fehlende Quellen-Sample-Sequenzen. Davon liegen 87 Originale unter alpha.86 und
427 unter alpha.93, also auch nach [PR #172](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/172).
Der belegte Ablehnungspfad ist die vorgeschaltete lokale Recorderqueue;
Dateisystem-I/O-Fehler waren an den geprüften Rändern getrennt davon 0.
Quellenburst gegenüber Abarbeitungsverzug bleibt als produktive Ursache offen.
Eine NAS- oder SQL-Ursache ist nicht nachgewiesen.

PR #172 hat begrenzte Batch-Appends bereits eingeführt. Die damalige aktuelle
Queue-/Highwateranzeige kann eine frühere Spitze einer anderen Sitzung nicht
rekonstruieren. Im gespeicherten `recording.localJournal` fehlte insbesondere
die zeitliche Zuordnung von Queuebelegung, tatsächlicher Grenze, abgelehntem
Umfang und lokaler Warte-/Appendarbeit. Ausschließlich diese Diagnose wird ergänzt.

## Historischer Nachweis

`recording.localJournal` enthält weiterhin den Zustand **vor dem aktuellen Append**.
Der zusätzlich angegebene Erfassungszeitpunkt ist vom Ereigniszeitpunkt des
Records verschieden: Ein bereits wartender älterer Record kann einen später
erfassten Verlustnachweis tragen. Sein eigener Append ist dadurch noch nicht
bestätigt. Erst der dauerhaft erhaltene Originalrecord ist der lokale Beleg;
SQL-Speicherung benötigt weiterhin einen unabhängigen exakten Nachweis.

Die begrenzte Historie `lossEpisodes` fasst aufeinanderfolgende Ablehnungen
derselben Sitzung zusammen. Sie enthält Sitzungs- und Record-Sequenzgrenzen,
erste/letzte Ereignis- und Erfassungszeit, abgelehnte Recordanzahl und
summierte Rohkontextbytes sowie die tatsächlich getroffene Anzahl-/Bytegrenze.
Beide Grenzen können zugleich getroffen sein. Rohkontextbytes bezeichnen die
Größe vor dem Encoder; sie sind weder Dateibytes noch verlorene Quellen-Sampleanzahl.

Der Kontext trennt die vorgeschaltete Recorderqueue (Anzahl, Bytes, unveränderte
Grenzen, Alter und aktive Arbeit) vom serialisierten lokalen Journal
(ausstehende Appends und lokale Operation). Die letzte abgeschlossene
Append-Batch-Messung bleibt separat. Deren bisheriges `elapsedMs` umfasst
Journalwartezeit und Append; zusätzliche `waitMs` und `appendMs` trennen diese
Abschnitte. Das sind lokale Softwarezeiten, keine SQL- oder NAS-Latenzmessungen.

Höchstens vier Episoden bleiben detailliert erhalten. Verdrängte Episoden,
Records und Rohbytes werden ausdrücklich gezählt. Die Diagnose speichert feste
Zahlen-/Statusfelder und keine zusätzlichen privaten Originalframes,
Quellwerte, Konfigurationen oder Zugangsdaten. Sie nutzt die vorhandene begrenzte
Journal-Gesundheitspersistenz und bleibt über einen geordneten Shutdown und
Neustart zuordenbar; neue Recorder-Sitzungszähler bleiben davon getrennt.

Die Persistenz ist kein unbedingtes Crashversprechen: Vor bestätigter
Metadaten-/Originalspeicherung können neue Beobachtungen verloren gehen; bei
defektem oder vollem Datenträger bleibt der Nachweis entsprechend begrenzt.
Eine nicht angenommene Quelle oder ein fehlender Befehlsabschluss wird nicht
aus späteren Werten rekonstruiert.

## Umfang und Validierung

Unverändert bleiben 128 Records/8 MiB vorgeschaltete Pendingkapazität,
Batchgrenzen, FIFO-Abarbeitung, Parallelitätsgrenzen und sämtliche
Datei-/Verzeichnis-Durabilitätsbarrieren. Es gibt keine Priorisierung,
Aufzeichnungsunterdrückung, private Zusatzexporte oder produktive SQL-/ioBroker-Änderung.

Die vorhandenen Slow-Append-, Backpressure-, Batch-, Durabilitäts- und
Shutdowntests werden weiterverwendet. Ergänzt werden getrennte Anzahl-/Bytegrenzen
mit großen Rohkontexten, historisch gespeicherte Episoden bei verzögertem Append
und konkurrierender lokaler Arbeit, getrennte Warte-/Appendmessung, begrenzte
Historie sowie Sitzung/Shutdown/Neustart. Erhaltene Originalinhalte und
rekonstruierbare Fortsetzung werden geprüft; verlorene Befehlsabschlüsse bleiben
ausdrücklich unbekannt.

Relevante lokale Prüfungen:

```sh
node --test test/recorder-slow-append.test.js test/recorder-backpressure.test.js test/recording-continuity.test.js test/decision-record-journal.test.js test/shadow-controller.test.js
npm test
npm run test:package
npm pack --dry-run --json
```

Die endgültigen Test-/CI-Ergebnisse und lokale Ausführungsgrenzen stehen im PR
und Release. Die gezielten lokalen Recorderprüfungen verwenden Node 24;
GitHub-CI und Releasevalidierung verwenden Node 20.
Softwaretests beweisen weder die konkrete produktive Verlustursache noch
anhaltende Verlustfreiheit unter tatsächlicher Last. Die Veröffentlichung ist
keine vollständige reale Abnahme und begründet keine zusätzlichen Scorepunkte.

## Nächste reguläre SQL-Prüfpunkte

1. Nach der tatsächlichen späteren Installation Version, Recordsession und
   Ereigniszeiten festhalten. Neue Dropzuwächse und Record-Sequenzlücken getrennt
   von Quellen-Samplelücken zählen. Die Werte 514/2.686 sind datierte
   Berichtswerte, keine Messung der neuen Version.
2. Um jede neue Lücke den letzten erhaltenen Vorgänger und den ersten
   rekonstruierbaren erhaltenen Nachfolger prüfen. `lossEpisodes` nach Sitzung,
   Sequenz- und Zeitgrenzen zuordnen, Erfassungszeit und Record-Ereigniszeit
   auseinanderhalten. Fortgeschrittene Verdrängungszähler als Diagnosegrenze
   ausweisen; keine Vollständigkeit aus einem kleinen Ring ableiten.
3. Getroffene Anzahl-/Bytegrenze, abgelehnte Rohbytes und erste/letzte
   Queuebelegung gegen Queuealter, aktive lokale Arbeit und letzte abgeschlossene
   Batchmessung vergleichen. Quellenankunftsrate separat aus erhaltenen
   `sampleSequence`/`receivedAt` betrachten. Damit neue Verluste zeitlich erklären;
   Performancekorrekturen erst nach belastbarer Reproduktion begründen.
4. Journalablehnungen, Dateisystem-Schreib-/Lesefehler, Kapazitätsstatus,
   SQL-Bestätigungen und Retention getrennt beurteilen. Vollständige `commandId`
   inklusive Sitzung verwenden; fehlender Transportabschluss beweist weder
   erfolgreichen Abschluss noch Stellfehler.
5. Für EHZ, reale PV-Stromschritte und den SMA-Burst gelten die gezielten
   [Beobachtungspunkte](issue181-observation.md). Keine künstlichen Schaltversuche;
   nicht eingetretene Phasenwechsel, Wiederanlauf-, Master-Rückgabe- und
   Pumpen-/Durchflussprüfungen bleiben offen.

Hierfür den regulären Folgeabruf und vorhandene Originale verwenden. Kein
zusätzlicher SQL-Lasttest, Vollabruf, höhere Parallelität oder selbst ausgelöste
Metadaten-Recovery. Bei Abruffehler Originaltext, Fenster, Limit, gemessene
Laufzeit und Menge sowie Parse-/Truncationbefund sichern; Backendabschluss ohne
Nachweis unbekannt lassen. Erst nach Gesundheitsprüfung und Abstand höchstens
ein kleinerer kontrollierter Versuch und maximal drei zusätzliche
Diagnoseabfragen gemäß Arbeitsauftrag. Keine Installation oder Livefreigabe
ist Teil dieser Veröffentlichung; Issues bleiben offen, #166 separat.
