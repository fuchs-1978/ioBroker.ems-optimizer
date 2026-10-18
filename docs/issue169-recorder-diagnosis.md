# Recorder-Verluste am 17.10.2026: eingegrenzter Pfad, Ursache weiterhin offen

Fortschreibung vom 18.10.: [#181 und begrenzte historische Verlustdiagnose](issue181-recorder-loss-episodes.md).
Die folgende Bestandsaufnahme beschreibt den damaligen Stand; Batch-Append aus
PR #172 und der spätere Episodennachweis sind dort getrennt eingeordnet.

Grundlage ist [Tagesbericht #169](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/169),
mit dem am Bericht geprüften Quellstand
[`795a722`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/795a72265c69616e0c515d34e57d9677da6a84ef)
(alpha.84). Die älteren Ereignisse aus #167 sind keine erneut beobachteten Ereignisse des 17.10.

## Belegter Betriebsbefund

Für Sitzung `1792188919717` meldet #169 **238 fehlende Originalrecords in 42 Sequenzlücken**
und **565 fehlende Quellen-Sample-Sequenzen**. `RecordDropped` und `RecordWriteErrors` steigen
von 0 auf 238; kumulierte Journalablehnungen von 5.949.846 auf 5.950.084.
Die Verlustbereiche liegen am 17.10.2026 um 12:00:15–12:02:31, 12:30:17 und
15:00:14–15:05:03 Europe/Berlin.

Der Text „Lokale Recorder-Warteschlange voll; Datensatz nicht angenommen“ entsteht in
`ShadowController.enqueueRecord()` **vor** dem Aufruf von `DecisionRecordJournal.append()`.
Der Aufnahmepfad begrenzt noch nicht abgearbeitete, vollständige Records auf 128 Einträge
und zusammen 8 MiB. Das Betriebsbild belegt diese lokale Aufnahmegrenze. Der Text sagt
nicht, welche der beiden Grenzen erreicht wurde.

`RecordWriteErrors` zählt hier auch eine Aufnahmeablehnung. Das ist kein Nachweis eines
fehlgeschlagenen Dateisystemaufrufs. Die getrennten Journalzähler in
`recording.localJournal` und `RecordJournalStatus` dürfen damit nicht gleichgesetzt werden.
Ebenso sind SQL-Abfragefehler, lokale Ablehnungen und fehlende Quellenproben getrennte Befunde.

Auch ein `command.transport_complete` kann hinter bereits aufgenommenen Quellenrecords
abgelehnt werden. Ein vorhandener `command.attempt` mit fehlendem Abschluss beweist deshalb
weder den Befehlsausfall noch den erfolgreichen Abschluss. Das gilt für die in #169 genannten
realen Wallbox-/myPV-Befehle ebenso wie für den Istspiegel.

## Kontrollierte lokale Reproduktion

`test/recorder-slow-append.test.js` führt den echten Pfad
`captureProduction → Quellenbündel → productionRecord → enqueueRecord → Encoder → Journal`
mit einem privaten temporären Verzeichnis aus. Es werden keine produktiven Zustände,
SQL-Abfragen oder Aktoren verwendet. Ein kontrolliertes Gate verzögert den ersten lokalen
Originaldatei-Write; nach Freigabe laufen die tatsächlichen Write-/fsync-Schritte weiter.

Zwei Fälle verwenden dieselben 300 gültigen Quellenbeobachtungen und denselben Befehl:

- Bei zwischenzeitlich abgearbeiteten lokalen Appends bleiben alle Quellenproben sowie
  Auftrag und Transportabschluss erhalten; keine Aufnahmeablehnung entsteht.
- Ohne zwischenzeitliche Abarbeitung erreicht die vorgeschaltete Queue 128 Einträge,
  obwohl ihr Byteumfang unter 8 MiB bleibt. Weitere Quellenrecords und der danach kommende
  Transportabschluss werden abgelehnt. Der zuvor aufgenommene Auftrag bleibt erhalten.
  Jede Recordablehnung wird durch Sequenzlücke und kumulierte Verlustzähler sichtbar.
  Die Fortsetzung und der nächste reguläre Vollcheckpoint sind rekonstruierbar;
  verlorene Quellenproben oder Befehlsabschlüsse werden nicht ergänzt.

Der Test prüft auch: Journalablehnungen entsprechen den gemeldeten Verlusten,
Dateisystem-Writefehler bleiben in diesem Fall 0, die Queue ist nach Abarbeitung leer und
überlebende Originalproben behalten ihren genauen Inhalt ohne Doppelung.

Ausführung:

```sh
node --test test/recorder-slow-append.test.js
```

Dies ist eine Reproduktion des Aufnahme-/Verlustmechanismus. Die künstlich verzögerte lokale
Schreiboperation identifiziert **keine** produktive I/O-, NAS- oder Datenbankursache.
Ein endlicher FIFO kann bei dauerhaft höherer Ankunftsrate nicht alle späteren Übergänge
erhalten; der Test verspricht insbesondere keinen Erhalt aller Sicherheits-/Befehlsereignisse
bei Sättigung.

## Verbleibende Diagnosegrenze und Entscheidung

Der Quellpfad bündelt routinemäßige Quellenbeobachtungen, während wichtige Quellenflanken
und Befehlsereignisse sofort vollständige Kontexte anfordern. Alle laufen in dieselbe
begrenzte Aufnahmequeue. Das Journal serialisiert Appends und lokale Lese-/Bestätigungsarbeit;
ein noch offener Append kann daher auch lokale Wartezeit enthalten. Transportdauer oder
SQL-Bestätigung allein messen diese Wartezeit nicht.

Die vorliegenden Betriebsbelege enthalten keine hinreichende, zeitlich zugeordnete Messung
von Queuebytes, Queuealter, höchster Belegung und lokaler Append-/Wartezeit an den
Verluststellen. Damit bleibt offen, welchen Anteil ein Quellenburst und welchen Anteil
lokaler Abarbeitungsverzug hatten. `RecordQueueDepth` ist ein aktueller Zustand und wird
über die reguläre `historyIds`-Auswahl nicht zusätzlich historisiert. Seine heute gelesene
Belegung rekonstruiert keine vergangene Spitze. Auch `bufferLost=0` oder
`statisticsLost=0` widerlegen abgelehnte Record-/Quellenbündel nicht.

**Keine Änderung am produktiven Recorder in dieser Korrektur:** Eine größere Queue,
weniger Aufzeichnung, Priorisierung oder veränderte I/O-Durabilität wäre ohne weiteren
Ursachennachweis eine zusätzliche Verhaltensänderung. Ziel 2 bleibt offen. Der neue Test
sichert die konkrete Diagnose und die ehrliche Verlust-/Fortsetzungsdarstellung ab;
er behebt die 238 Verluste nicht und belegt keine verlustfreie Betriebsabnahme.

## Prüfpunkte für die nächste reguläre SQL-Auswertung

1. Fenster, Europe/Berlin-Zeiten, ursprüngliche Record-/Quellenzeiten, Versionsfelder und
   Sitzung getrennt zuordnen. Neue Laufzeitzähler dürfen bei Sitzungswechsel zurücksetzen;
   persistierte Journalzähler haben eine andere Lebensdauer.
2. Neue `recording.dropped`-/`writeErrors`-Zuwächse, Record-Sequenzlücken und nach
   Sitzung/`sampleSequence` deduplizierte Quellenlücken getrennt zählen. Die heutigen
   238/565 sind datierte Vergleichswerte. Den ersten und letzten erhaltenen Record um
   neue Lücken sowie den genauen Fehlertext sichern; unbekannte Inhalte bleiben unbekannt.
3. An erhaltenen Lückenrändern `recording.localJournal`, tatsächliche Journal-/Delivery-
   Gesundheitsstände, SQL-Bestätigungen und Ablaufzähler vergleichen. Ein vorheriger
   Append-Snapshot (`snapshotPhase=before-current-append`) ist keine Bestätigung dieses
   gerade beschriebenen Records. Eine aktuell kleine Queue beweist keine vergangene Ruhe.
4. Befehle nach vollständiger `commandId` zuordnen: Versuch, Transportabschluss/-fehler,
   unabhängige ACK-Quelle und elektrische Antwort. Einen fehlenden Logabschluss separat
   als unbeobachtet markieren. `NULL/ACK=true` eines Write-only-Sollregisters ist kein
   numerischer Istwert und keine elektrische Nullbestätigung.
5. Exakte SQL-Originalbestätigung weiterhin über Session/Sequenz/Hash prüfen; steigende
   kumulierte Bestätigungen oder erfolgreiche Tagesabfragen sind keine Garantie für
   vollständige lokale Aufnahme. Keine SQL-Paketzeit als ursprüngliche Ereigniszeit verwenden.

Hierfür nur den regulären Folgetagesabruf und vorhandene Zustände auswerten. Kein Zusatzlasttest,
kein wiederholter Vollabruf, keine erhöhte Parallelität und keine selbst ausgelöste
Metadaten-Recovery. Bei Abruffehlern Originaltext, Fenster/Limit, gemessene Laufzeit/Menge
und Parse-/Truncationbefund sichern; Backendabschluss ohne Einblick offen lassen. Nach
Gesundheitsprüfung und Abstand höchstens ein kontrollierter kleinerer Versuch und insgesamt
höchstens drei zusätzliche Diagnoseabfragen gemäß Arbeitsauftrag.
