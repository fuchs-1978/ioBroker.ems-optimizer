# Diagnosefortschreibung zu #220, 21.10.2026

## Grundlage und Aussagegrenze

Geprüfter Ausgangscommit ist
[`76db3611b56dbe5c2335b7d78c8ccef793e35874`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/76db3611b56dbe5c2335b7d78c8ccef793e35874),
Manifestversion alpha.115. Arbeitsgrundlagen sind ausschließlich die anhand der
GitHub-Metadaten als von `fuchs-1978` verfasst geprüften Issues
[#220](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/220),
[#219](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/219),
[#60](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60),
[#7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7),
[#8](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8) und
[#216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216).
Auch die vorhandenen Kommentare in #60/#7/#8 stammen laut Metadaten von diesem
Autor; die übrigen hier genannten Issues hatten bei Prüfung keine Kommentare.
Historische Kommentare begründen keine erneute Implementierung vorhandener Fixes.

Die folgenden Betriebszahlen sind fortgeschriebene Befunde dieser Tagesberichte.
Hier standen weder ein ioBroker-Connector noch die gesicherten SQL-Rohseiten zur
erneuten unabhängigen Dekodierung zur Verfügung. Es wurde keine zusätzliche
SQL-Abfrage, Recovery, Installation oder Anlagenaktion ausgelöst. Die Codeprüfung
und lokalen Softwaretests sind davon getrennt. Zeitangaben beziehen sich auf
Europe/Berlin, sofern nicht ausdrücklich anders bezeichnet.

Installierte Objektversion und Laufzeitanzeige sind laut Bericht seit dem
20.10. gegen 16:41 alpha.115; der genaue installierte Commit bleibt unbekannt.
Der jüngste im Ausgangsstand geprüfte GitHub-Release ist alpha.110. Main-Merge,
Veröffentlichung, Installation und reale Abnahme sind vier getrennte Nachweise.
**Weiterbetrieb bleibt begrenzt bewertbar; Score 71/100, Änderung 0.**

## Erhaltener Teilbestand und fehlender Tag

Das Sollfenster ist 20.10.2026 19:57:02 bis 21.10.2026 19:57:02. Erhalten sind
Originale vom 20.10. 19:57:03.005 bis 21.10. 07:44:28.036, Sitzung
`1792507275188`, Sequenzen 35992–160329: **124.338 Originale ohne interne
Recordsequenzlücke**. 9.957 SQL-Werte sind die Transportebene, nicht dieselbe
Zählgröße wie die darin enthaltenen Originale.

Auf Originalebene bleiben 43.954,969 s (12:12:34.969) nicht oder unsicher
bewertbar: 1,005 s Beginnrand sowie 43.953,964 s (12:12:33.964) nach dem letzten
Original. Das ist keine bewiesene vollständige Anlagenblindheit. Im erhaltenen
Nachtteil gibt es keinen Lade-/Heizlastfall; späterer Lastbetrieb bleibt unbekannt.
28 fehlende Delta-Basen gehören ausschließlich zum 60-s-Vorlauf vor der ersten
Vollbasis. Innerhalb des Sollfensters wurden keine unbekannten Rekonstruktionen
oder Hashkonflikte berichtet. Das ersetzt hier keine erneute Rohdatenprüfung.

## Recorder, externe Anfrage und SQL getrennt halten

| Ebene | Beleg | Nicht daraus ableitbar |
| --- | --- | --- |
| Lokale Aufnahme im erhaltenen Nachtteil | `dropped=0`, `writeErrors=0`; kumulative lokale Ablehnungen 5.970.240 unverändert; maximal beobachtet 14 Queueeinträge / 1.227.850 Bytes, älteste Wartezeit 2,070 s | Keine Erklärung älterer Verluste und keine Abnahme des fehlenden Tages |
| Historische Recorderverluste am 20.10. unter alpha.113 | Sitzung `1792485826313`: 19 fehlende seq771–789, vier seq792–795, drei seq30706–30708; zusammen 26. Bytekapazität 8 MiB bei 90–93 Einträgen erreicht | Kein Beweis eines NAS-/DB-Fehlers; Anzahl fehlender Records ist keine Dauer |
| Externer Connector-/Runtimeweg am 21.10. | 525 reguläre sequenzielle Aufrufe, 523 erfolgreich mit 9.957 SQL-Werten; zwei fehlgeschlagene Zugriffe | Ähnliche Fehlerfristen beweisen keine gemeinsame SQL-Ursache |
| SQL-Speichernachweis und Backendende | Frische exakte EMS-eigene Originalbestätigungen liegen vor; fehlgeschlagene externe Anfrage ohne nachgewiesenes Backendende | Alive/Connection oder andere erfolgreiche Anfragen beenden diese konkrete Anfrage nicht nachweislich |

Die historischen Randintervalle vom 20.10. sind 10:46:00.165–10:46:00.652,
10:46:00.659–10:46:01.172 und 12:30:18.447–12:30:19.035, zusammen **1,588 s**,
größtes Intervall **0,588 s**. Sie werden nicht aus der Recordanzahl errechnet
und nicht als heutige alpha.115-Verlustepisode ausgegeben.

Die beiden neuen externen Fehler bleiben eigenständige Befunde:

1. 20:29:06.736–20:29:32.471, `McpServerError: Connection failed.`, 25,735 s;
   Historienfenster 01:36:58.103–01:37:42.714, Limit 80. Nach Gesundheitsprüfung
   und 68,056 s Abstand wurde genau ein kleinerer 2-s-Versuch in 0,644 s leer
   und parsebar beantwortet; danach gelang der reguläre Abruf wieder. Das leere
   Fenster beweist keine vollständige Tagesabdeckung oder Erledigung des ersten
   unbekannten Backends.
2. 20:44:59.489–20:45:25.002, `McpServerError: ioBroker did not answer in time`,
   25,513 s; Fenster 07:44:32.337–07:47:42.350, Limit 80. Danach wurde der Abrufweg
   beendet, einschließlich einer sonst möglichen BHKW-Historienabfrage.

Die 34 beziehungsweise 47 Zeichen Fehlertext sind keine SQL-Ergebnismengen.
DB-Prozess-, Blockierungs- und Indexsicht fehlen. Zugängliche leere Warnlogs und
frische eigene Bestätigungen ersetzen diese Sicht nicht. Ein zweiter Versuch
nach dem erneuten Fehler oder eine zusätzliche Metadaten-Recovery wird durch
diesen Auftrag nicht ausgelöst.

## Bereits vorhandene Schutz- und Decoderverträge

Die Prüfung am Ausgangscommit findet die benötigten Grundverträge bereits vor:

- `tools/read-decision-records.js` archiviert begrenzte Rohseiten, trennt
  ursprünglichen Fehlertext, Antwortzeichen/-bytes und Parsezustand und führt
  Anfragen sequenziell aus. Eine bloße Retry-Erlaubnis ohne beobachtetes
  Backendende blockiert die Fortsetzung; ein Kandidaten-Cursor ist kein
  vollständiger Wiederanlaufnachweis.
- `lib/decision-record-transport.js` prüft und entpackt die ganze schema4-Hülle
  mit Größen-/Anzahlgrenzen, bevor gültige Originale freigegeben werden. Ein
  beschädigter Suffix oder verschachtelte Hülle darf keinen gültigen Präfix
  vortäuschen. Decoder und Reader erhalten Originalzeit, Session, Sequenz,
  Quellenproben, NULL, ACK, q und Verlustmarker.
- Originale werden nach Session/Recordsequenz/Hash geprüft, Quellenproben nach
  Session/sampleSequence. Widersprüchliche Identitäten oder fehlende Delta-Basen
  bleiben ausdrücklich unbekannt. Verkleinerte Fenster benötigen weiterhin
  dieselbe vollständige Snapshotbasis. Intervallstatistiken werden nicht zu
  kontinuierlicher Quellenfrische oder nachträglich erfundenen Rohproben.
- Recorder- und Journaltests unterscheiden Anzahl- und Bytekapazität, Wartezeit,
  abgeschlossene Appenddauer sowie langsame Health-/Dateiarbeit. Der bereits in
  PR #212 übernommene `closed`-Guard von `_scheduleHealth()` ist vorhanden und
  wird nicht erneut implementiert.
- `DecisionRecordDelivery.stopAndDrain()` wartet begrenzt auf seine tatsächlichen
  Backendoperationen. Die eigene `SqlVerificationRecovery.inspect()` und deren
  persistente Inspection-Sperre bleiben ein gesonderter Shutdownpfad. Eine
  frische Verbindung allein hebt keine unbekannte Sperre auf. Im heutigen
  Bericht ist `sqlRecoveryInspection=null`; diese offene Frage ist daher kein
  Beleg der heutigen Abrufursache.

Die passenden vorhandenen Regressionen stehen in
`test/decision-record-history.test.js`, `test/decision-record-transport.test.js`,
`test/recorder-slow-append.test.js`, `test/recorder-backpressure.test.js`,
`test/decision-record-journal.test.js`, `test/decision-record-delivery.test.js`
und `test/sql-verification-recovery.test.js`. Es wird kein neuer Recorderfix,
keine Queue-/Timeoutvergrößerung und keine Änderung von fsync, Retention,
SQL-Parallelität oder Rechten aus den ungesicherten Ursachen abgeleitet.

Eine lokale Wiederholung der unveränderten History-/Transport-, Slow-Append-,
Backpressure-, Recovery- und Heater-Write-Proof-Suiten unter Node 24.19.0
bestand mit **77 Tests, 0 Fehlern, 0 übersprungenen Fällen**:

```sh
node --test test/heater-write-proof.test.js test/decision-record-history.test.js test/decision-record-transport.test.js test/recorder-slow-append.test.js test/recorder-backpressure.test.js test/sql-verification-recovery.test.js
```

Diese Offline-Fixtures führen keine produktiven SQL-Abfragen aus und belegen
weder den Abschluss der fehlgeschlagenen externen Anfrage noch reale Verlustfreiheit.

## EHZ und reale Reglerabnahme

Im erhaltenen Nachtteil stehen alle drei Wallboxen bei allow=0 und Leistung=0;
die drei EHZ-Istregister sind ebenfalls 0. Die historische EHZ-Reserve ist
0/ready. Das sind Leerlaufbeobachtungen, keine Last-, Timer-, Phasen-, Übergabe-
oder aktive §14a-/LPC-Abnahme. Historische SoC-/Timerwerte werden nicht auf den
späteren fehlenden Tag rückdatiert.

Die Logmeldungen WB0 AUS um 11:40:44.051 und WB2 AUS um 14:35:34.153 wegen
Budget/unter Mindeststrom enthalten keine vollständige historische Soll-/ACK-/
Istkette. Sie belegen deshalb weder Dauer noch Ursache oder Zahl realer
Ladeunterbrechungen. Der WB2-Wert -10 W um 14:01:40.064 ist der bereits
vorgesehene Leerlaufboden und kein neuer Filterfehler.

Der spätere aktuelle EHZ-Snapshot außerhalb des Sollfensters zeigt Reserve
1.500 W/pending=true, Auftrag 0 und drei frische Istregister 0 sowie
`zeroProofStatus=blocked/overlapping-write`. Der Statusbezug auf einen Nullauftrag
um 16:09:05 ersetzt keine unabhängige Ereignishistorie. Entstehung, Dauer und
gleichzeitige Auswirkung auf Netz-/Ladeleistung bleiben unbekannt. Der Snapshot
beweist keine tatsächliche 1.500-W-Aufnahme und keinen bestätigten unsicheren
Ausgang.

`lib/heater-write-proof.js` blockiert absichtlich für den Prozess, wenn ein
zweiter Write beginnt, bevor der vorherige Write eindeutig abgeschlossen ist.
Ein korrelierter Write-only-Nullbeleg benötigt eigenen Schreibauftrag,
passenden Modbus-NULL-Reset und Transportabschluss. `NULL` ist keine gemessene
Leistungsnull. Die Tests in `test/heater-write-proof.test.js` behandeln fehlenden
Reset, fehlenden Transportabschluss, verspäteten positiven ACK, fremden Reset,
Quellenqualität und sequenzielle Nullauffrischung getrennt. Frische unabhängige
Istnullen erklären nicht rückwirkend die mehrdeutige Write-Zuordnung. Die Reserve
wird nicht manuell gelöscht und die Sperre nicht automatisch aufgehoben.

Die widersprüchliche EQV-Rückmeldung aus #216 bleibt ein datierter alpha.113-Fall;
die Einmalkorrektur/Startreserve aus #217/alpha.114 und die weiteren bestehenden
Korrekturen aus #212–215/#218 werden nicht erneut entwickelt. Ein fremder
Schreiber ist nicht bewiesen. Pumpen-/Master-/ACK-Kopplung bleiben bestehende
Verträge; die KNX-Schaltaktorrückmeldung belegt keinen mechanischen Durchfluss
und ihr Fehlen begründet hier keinen neuen Pumpenumbau.

## Nächste begrenzte SQL-Prüfpunkte

1. Vor einem späteren regulären Abruf gesicherte Rohseiten und atomare
   Prüfstände wiederverwenden. Die letzte ausgegebene Anfrage mit Fenster,
   Start-/Endzeit, Fehler und nachweisbarem Backendende abgleichen. Die
   unbekannte Anfrage nicht allein aufgrund von Alive oder eines verstrichenen
   Zeitabstands als beendet behandeln. Kein Zusatzvollabruf/Lasttest und keine
   parallelen SQL-Anfragen.
2. Nur bei nachgewiesener Gesundheit und zulässiger Fortsetzung höchstens einen
   kontrollierten kleineren Diagnoseversuch mit Abstand, insgesamt maximal drei
   zusätzliche Diagnosequeries; nach erneutem Fehler Schluss. Der am 21.10.
   bereits berichtete zweite Fehler hat diesen Abrufweg beendet.
3. Neue Originale und exakte SQL-Bestätigungen nach Session/Recordsequenz/Hash
   zeitlich zuordnen; Sample-Sequenzverluste separat führen. Queueanzahl/-bytes,
   älteste Wartezeit, aktive lokale Operation und abgeschlossene Appendzeiten
   getrennt von Journalbytes und unbestätigten Originalen erfassen.
   `expiredRecords` und `expiredUnconfirmedRecords` neben der tatsächlichen
   Bestätigung prüfen: Alterung ist keine Recovery und ein kleineres Journal
   allein kein Speichernachweis.
4. Für die EHZ-Sperre das erste überlappende Schreibpaar samt ursprünglichem
   Auftrag, Transportabschluss, eigenem Schreibecho, Modbus-Reset und Quellen-
   zeit/ACK/q rekonstruieren. Zeitgleich die drei echten Istregister und
   Reservierungs-/Nullplateaudiagnose verfolgen. Eigene Folgeaufträge,
   verspätete Rückmeldungen und fremde Quellen als offene Alternativen prüfen;
   keine bloße zeitliche Korrelation als Ursache ausgeben.
5. Nächste natürliche Lade-/Heizfälle mit damaligem SoC, Freigabe, Priorität,
   Timer, aktiver Bilanz-/Thermikgrenze, geordneten Sollbefehlen, ACK und L1–L3/
   Leistungsantwort prüfen. Abgebrochene EIN-Aufträge nicht durch spätere andere
   EIN-Antworten erklären. Phasenmodus-ACK bleibt von elektrischer Antwort
   getrennt; eine erforderliche sequenzielle Übergabe benötigt AUS und Ruhe.

Reale Master-Rückgabe, belastete Phasenwechsel, aktive §14a-/LPC-Grenzreaktion,
vollständige sequenzielle Übergaben und der spätere Tagesbetrieb sind weiterhin
nicht abgenommen. Die im qualifizierten Nachtteil geschätzten 2,952 kWh Bezug
und 0,888 kWh Rückspeisung lassen die Erzeugungsquelle offen. BHKW ist bereits
im gemessenen NVP enthalten; es wird nicht hinzuaddiert oder prognostiziert.
Weder eine zusätzliche zulässige Aufnahmeplanung noch ein Tagesenergiepotenzial
ist daraus belastbar belegt. Keine Hochrechnung aus Reserve mal Lückendauer,
keine garantierte Einsparung und kein Scorebonus durch Softwaretests/Release.
