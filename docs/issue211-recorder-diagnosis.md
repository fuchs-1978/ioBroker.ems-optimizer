# Recorderdiagnose zu Issue #211, 19.10.2026

## Grundlage und Grenzen

Geprüfter Ausgangsstand ist main `72dee1bbbd9326fcc06d1d40cdcc1283f84a605b`,
Paketversion alpha.109. Die Livebelege stammen aus
[Issue #211](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/211),
mit [#181](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/181) als
Vortagsgrundlage. Die Autoren wurden anhand der GitHub-Metadaten als
`fuchs-1978` geprüft. Die hier ausgeführten Reproduktionen verwenden lokale
temporäre Dateien und injizierte Antworten; es erfolgten keine Live-SQL-Abfragen,
produktiven Recoveryauslösungen oder Änderungen an der Anlage.

Die laufende Versionsanzeige alpha.109 beweist keinen exakten installierten
Commit. Die folgenden Codebefunde gelten für den genannten Repositorystand.
Zeitangaben aus dem Tagesbericht beziehen sich auf Europe/Berlin.

## Getrennte Verlust- und Wiederaufnahmebefunde

| Befund aus #211 | Aussage | Nicht daraus ableitbar |
| --- | --- | --- |
| 14 erhaltene Detailverlustepisoden mit 173 Ablehnungen unter alpha.99/100 | Die rohe Recorderwarteschlange erreichte ihre Bytegrenze von 8 MiB bei 94–95 Records. Die Anzahlgrenze wurde dabei nicht erreicht. | Keine bewiesene NAS-, Dateisystem- oder SQL-Ursache. |
| Ältester wartender Auftrag bis 17,048 s | Beobachtete Wartezeit der lokalen Recorderqueue. `activeOperation`, `lastAppendBatch.waitMs` und `appendMs` beschreiben andere Zeitanteile. | Keine Messung eines einzelnen 17-s-Dateiappends. |
| Verifierauftrag 15:13:09.407, EMS-Neustart 15:13:12.650; später Journal fast 128 MiB | Separater Rückstau bei ungeklärtem SQL-Abschluss. Die persistente Verifikationssperre überlebt den EMS-Neustart. | Kein Beweis, dass die vorherigen 173 RAM-Ablehnungen dieselbe Ursache hatten. |
| Kumulierte Journalablehnungen +19.616 | Umfasst auch weitere Kapazitäts- und Backpressurefälle. | Weder ausschließlich RAM-Drops noch eine Dauer in Sekunden. |
| SQL-Prozesswechsel 16:47/48, anschließend frische exakte Bestätigungen und Rückstauabbau | Erhaltene Originale wurden wieder zugestellt und geprüft. | Verworfene Originale wurden nicht wiederhergestellt. |

Die überlieferten Originale enthalten 226 interne fehlende Recordsequenzen;
zusätzlich fehlen im alpha.109-Präfix 1.337 Sequenzen. Die internen Randintervalle
umfassen 21,755 s, das größte 6,702 s. Davon getrennt liegt der lange fehlende
Originalabschnitt 15:47:34.083–16:51:20.018 über 3.825,935 s. Diese Grenzen
beschreiben die Aufzeichnung, nicht eine bewiesene vollständige Anlagenblindheit
oder den genauen Verlustzeitpunkt jedes Originals. Spätere Bestätigungen
erhaltener Records schließen diese historischen Lücken nicht.

Die Grenzen entsprechen unterschiedlichen Codepfaden:
`ShadowController.enqueueRecord()` begrenzt die vor dem Append gehaltenen
Rohframes. Die Journalgrenze begrenzt bereits lokal abgelegte Originale;
`skipBackpressuredRecord()` zählt anschließend ausdrücklich ausgelassene Records.
Die vier zuletzt gespeicherten Detailepisoden sind begrenzte Diagnostik, kein
vollständiges Archiv aller Verlustursachen.

[PR #209](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/209),
Mergecommit `5d14cab505aed90c6332bc01ddee3942b04fbf18`, enthält bereits den
begrenzten Drain tatsächlicher Delivery-Backendoperationen vor dem Journalschluss.
Dieser Pfad wurde nicht erneut implementiert. Ein bekannter unbekannter
Backendabschluss darf weder durch einen EMS-Neustart noch allein durch einen
gesunden Verbindungsstatus als erledigt gelten. Auch ein beobachteter Callback
ist noch kein exakter Original-Speichernachweis.

## Reproduzierter und korrigierter Journalschlussfehler

Der eigenständige Befund aus dem weiterhin offenen
[PR #193](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/193),
Head `e8e2806219a743484e434220d0f6ac7dc9ee2fc2`, besteht auch im geprüften main:
Nach abgeschlossenem `journal.close()` führen abgelehnte Einzel-/Batch-Appends
über `_reject()` und `reportLoss()` erneut zu `_scheduleHealth()`. Dadurch werden
`.health.tmp`, Rename und Verzeichnissynchronisation nach dem abgeschlossenen
Shutdown gestartet. Nach Entfernung eines temporären Verzeichnisses entstehen
zusätzliche Zugriffsversuche und ein künstlicher ENOENT-Diagnosefehler.

Die neue Regression scheiterte vor der Korrektur an acht unerlaubten
nachträglichen Dateisystemaufrufen. Der minimale Fix ergänzt die Prüfung auf
`closed` beim Planen weiterer Healtharbeit. Späte Verlustzähler bleiben im
Speicher sichtbar. `close()` schreibt weiterhin seinen direkten finalen
Healthcheckpoint, nachdem bereits angenommene Arbeit abgearbeitet wurde.

Eine zweite Regression lässt einen vor `close()` angenommenen Batch an der
unveränderten Kapazitätsgrenze scheitern: Seine beiden Ablehnungen bleiben nach
Journalneustart gespeichert; das zuvor angenommene Original bleibt erhalten.
Damit ist die endgültige Verlustpersistenz bereits angenommener Arbeit geprüft.
Veraltete Releaseworkflows aus PR #193 werden nicht übernommen.

Gezielte Prüfung unter Node 24.19.0:

```sh
node --test --test-name-pattern='completed journal shutdown|journal shutdown persists losses' test/decision-record-journal.test.js
node --test test/decision-record-journal.test.js
```

Nach dem Fix bestehen alle 35 Journaltests ohne Fehler oder übersprungene Tests.
Dieser Shutdownfix erhöht weder Queuekapazität noch Durchsatz und ist keine
belegte Erklärung der 173 Tagesablehnungen.

## Zusätzlich reproduziert, weiterhin offen: Recovery-Inspection beim Shutdown

`SqlVerificationRecovery.inspect()` hält eigene Metadatenanfragen und eine
persistente `sqlRecoveryInspection`. Diese Operationen gehören nicht zu
`DecisionRecordDelivery.backendOperations`, auf die PR #209 wartet.

Eine lokale Reproduktion nutzt den wirklichen `recovery.tick()` mit gültigen
synthetischen Nachweisen einer späteren SQL-Prozessgeneration. Sie hält den
Callback der ersten Metadatenanfrage zurück, führt `delivery.stopAndDrain(2000)`
und anschließend `journal.close()` aus und liefert dann den tatsächlichen
Callback. Ergebnis:

- Der Deliverydrain meldet `settled: true`, `pending: 0`, `fencePending: true`.
- Der Inspectionabschluss scheitert mit `journal is closed`.
- Nach Journalneustart bleibt `sqlRecoveryInspection` gesetzt.
- Der nächste Recoverytick blockiert mit
  `Original or recovery inspection completion unknown`, bevor neue Status- oder
  SQL-Abfragen erfolgen.

Dieser weitere Shutdownpfad wurde nicht korrigiert. Eine passende spätere
Regression muss eine tatsächlich laufende Recovery-Inspection während des
Journalschlusses behandeln und bei ausbleibendem Callback die Ungewissheit
erhalten. Sie darf keine zusätzliche Anfrage oder erfundene Speicherbestätigung
erzeugen. Im aktuellen Bericht ist `sqlRecoveryInspection=null`; der reproduzierte
Fall ist deshalb keine Erklärung des aktuell beobachteten Betriebszustands.

## Unbekanntes und nächste begrenzte SQL-Prüfpunkte

Die Ursache der Quellenbursts gegenüber lokaler Abarbeitung bleibt offen.
Datei-/Journalwartezeiten, tatsächliche Appenddauer und SQL-Callbackabschluss
müssen zeitlich getrennt zugeordnet werden. Fehlende Originalinhalte werden aus
späteren Zuständen nicht rekonstruiert.

Für die nächste reguläre, sequenzielle Betriebsbeobachtung:

1. Neue Originale mit Session, Record-/Sample-Sequenz und exakter SQL-Bestätigung
   zuordnen; alte nachgelieferte Originale getrennt von neuer Aufnahme ausweisen.
2. Recorderqueuebytes/-anzahl/-wartezeit, aktive Journaloperation und abgeschlossene
   Appendzeiten gemeinsam erfassen. Journalbytes, unbestätigte Originale sowie
   RAM-/Journalablehnungen jeweils als eigene Zählerdifferenzen führen.
3. Bei Rückstauabbau zusätzlich `expiredRecords` und
   `expiredUnconfirmedRecords` prüfen. Eine sinkende Journalgröße allein beweist
   keine erfolgreiche SQL-Bestätigung.
4. Nach einem natürlich stattfindenden Neustart Verifieridentität,
   `sqlVerificationPending`, `sqlRecoveryInspection` und beobachtete spätere
   exakte Originalbestätigungen abgleichen. Kein Neustart oder Recoverytest wird
   für diese Diagnose ausgelöst.

Der externe MCP-Fehler `-32603 Internal error` nach 31,571 s beweist keinen
SQL-Timeout. Der einmalige kleinere Abruf nach 82,144 s war erfolgreich; weder
dieser Fehler noch frühere Laufzeiten bilden eine universelle Schnittstellenfrist.
Backendabschluss, DB-Blockierung und Dateisystemursache bleiben dafür unbelegt.
Es gibt keinen Anlass für zusätzliche parallele Abfragen, Lasttests oder
Änderungen an Queues, Timeouts, fsync, Retention oder Rechten.
