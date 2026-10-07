# Tages-Issue #110: Recorder, Netzquellen und EHZ-Reserve

## Ausgangspunkt und Reichweite

Grundlage ist [#110](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/110),
mit Vorbericht #98, offenen realen Abnahmen #7/#8 und Vergleichen #57/#60/#62.
Erneut geprüfter main: `c4032cf58eab92f6afce3cd29739177ffb037707`,
Version 0.17.0-alpha.48. PRs #104–#109 sind sämtlich übernommen; insbesondere
die operative 30-s-SMA-Frist (#108) und die Quellen-/Empfangs-/Direktlesediagnose
(#109) werden nicht nochmals implementiert. Bei der Prüfung waren keine PRs offen.
Die Installation wurde erneut lesend als alpha.48 bestätigt.

ioBroker wurde ausschließlich gelesen. Keine Installation, SQL-Konfiguration,
Skript-, Master-, Freigabe- oder Aktoränderung und keine künstliche Störung.
Der letzte belegte Abnahmestand bleibt 64/100, Änderung 0 gegenüber #98.
Die folgende Softwarekorrektur ist keine vollständige Tages- oder Lastabnahme.

## P1: begrenzte SQL-Abfragen und produktives Volumen

Erneut gelesen: `ems-optimizer.0.Debug.Shadow.DecisionRecord`, roh, Limit 3,
Fenster **07.10.2026 20:04:30,000–20:04:35,190 Europe/Berlin**
(18:04:30,000–18:04:35,190 UTC). Aufrufe wurden sequenziell ausgeführt;
ein voller Antwortblock wurde am letzten SQL-Zeitstempel erneut überlappend
fortgesetzt. Kein produktiver Belastungstest und keine große Tagesabfrage.

| Start UTC | Records / Sequenzen | Dauer des Connector-Aufrufs |
| --- | --- | --- |
| 18:04:30,000 | 3 / 28121–28123 | 2.048 ms |
| 18:04:30,227 | 3 / 28123–28125 | 1.420 ms |
| 18:04:30,267 | 3 / 28125–28127 | 1.006 ms |
| 18:04:30,291 | 3 / 28127–28129 | 1.134 ms |
| 18:04:31,695 | 3 / 28129–28131 | 1.080 ms |
| 18:04:33,006 | 3 / 28131–28133 | 1.033 ms |
| 18:04:35,005 | 3 / 28133–28135 | 1.168 ms |
| 18:04:35,189–35,190, abschließender 1-ms-Ausschnitt | 1 / 28135, unter Limit | nicht separat gemessen |

Die ersten sieben Antworten enthalten 21 Zeilen: **15 eindeutige Records** und
**6 identische Überlappungen**, dedupliziert nach `(recordSession, recordSequence)`
und mit identischem vollständigem JSON verglichen. Der abschließende kleine
Ausschnitt unter Limit prüft zusätzlich den gesättigten Endzeitstempel.
Sitzung `1791390772167`, Sequenzen **28121–28135**, keine interne Lücke oder
widersprüchliche Dublette. Jeder Record ließ sich vollständig parsen.

Die 15 eindeutigen JSON-Payloads umfassen **512.990 UTF-8-Bytes**,
je **34.101–34.308 Bytes**. Enthalten: 6 Frames, 4 `command.attempt`,
2 `command.transport_complete`, 3 `source.update`. Zähler in dieser Stichprobe:
`dropped=0`, `writeErrors=0`. Das belegt weder jede SQL-Insertion über den Tag
noch eine unbekannte Tagesmenge. Die Laufzeiten sind Connector-Gesamtdauern;
SQL-interne Laufzeit und Antwortbytegrenze sind nicht aus dem Werkzeug ablesbar.

Eine zusätzlich versuchte Abfrage mit **identischem Start und Ende**
18:04:35,190 lieferte `RangeError: Invalid array length: NaN`. Die anschließende
nichtleere 1-ms-Abfrage war erfolgreich. Der konkrete Fehler des leeren
Zeitfensters beweist nicht die Ursache der früheren Zeitüberschreitungen.
Bei mehreren Records mit demselben SQL-Zeitstempel kann ein Zeitcursor ohne
Offset stehenbleiben: nicht blind um 1 ms vorspringen, sondern die fehlende
Pagination ausdrücklich als Blocker behandeln. Kein Überspringen von Zeilen.

**Nur dieses kleine Fenster wurde vollständig nachgelesen.** Der restliche
ursprüngliche 10-s-Ausschnitt und die 24-h-Historie sind damit nicht vollständig.
Das Recordvolumen als Ursache der SQL-/Transportfehler bleibt eine Hypothese.

### Belegter Recorderfehler und begrenzte Korrektur

Der Vergleichsschlüssel von `productionRecord()` enthielt Snapshotuhr und
laufend abgeleitete Quellenalter. Dadurch erzeugten zusätzliche unveränderte
Abtastungen innerhalb einer Sekunde neue vollständige Records, obwohl der
vorhandene Vergleich sie bis zum nächsten 1-s-Heartbeat vermeiden sollte.
Regressionen reproduzieren dies mit eingefrorenen Quellen und einer laufenden
Uhr; der ursprüngliche Code besteht diese Tests nicht.

alpha.49 entfernt ausschließlich Snapshot-`ts`/`timestamp` und abgeleitete
`ageMs`/`valueAgeMs` aus dem **Vergleich**, nicht aus den gespeicherten Records.
Rohquellen-`ts`/`lc`, Gültigkeit, ACK, Qualität, Leistung, Strom, Master,
Befehlsidentitäten und sämtliche Timerwerte bleiben im Vergleich bzw. in ihren
Ereignissen erhalten. Unveränderte Frames behalten den 1-s-Heartbeat.
Quellen mit neuer Zeit, echte ACK/q/NULL-Wechsel und jede Befehlsphase werden
weiter unmittelbar vollständig aufgezeichnet. Schema 2 und Queue bleiben erhalten;
kein deltaabhängiger Decoder, keine erfundene Nullleistung und keine neue
verlustbehaftete Verdichtung.

Die zyklischen 0-W-Stellversuche und EHZ-Mirror-Schreibvorgänge wurden geprüft.
Sie bleiben erhalten: Ein gleicher Sollwert beweist weder Empfang noch
Stellwirkung, insbesondere bei NULL-Sollrückmeldung und offener Reserve.
Die Änderung beseitigt daher nicht die volle Ereignis-Payload und verspricht
keine Reduktion gerade der 15 bereits sekündlich/ereignisbezogen erzeugten
Records. **Weniger redundante Frames beweisen keine behobene Zugriffsursache.**

## P2: operative Fristen und Diagnoseverträge

Unter alpha.48 meldet `protectionFeedback.gridImport/gridExport.maxAgeMs=10000`,
während Wallboxausgang und `production.measurements` 30000 verwenden.
Dieser Diagnosewiderspruch ist im Quellstand und den SQL-Records belegt.
Aus dem alten Diagnosefeld wird keine reale 10-s-Wallboxabschaltung abgeleitet.

alpha.49 verwendet für Wallboxausgang, seine Fehlerdiagnose, produktive
Messwertdiagnose und die beiden Schutzdiagnosefelder eine gemeinsame
30-s-Konstante. Schutzfelder enthalten außerdem Quellen-ID, `ts`, `lc` und
den ausdrücklich benannten Vertrag. Hausphasen bleiben bei 15 s;
Gerätefristen, elektrische Anschlussgrenzen, ACK- und Phasenfristen bleiben erhalten.

Der direkte EHZ-Netzregler hat unabhängig davon weiterhin **10 s**.
`protectionFeedback.dhwGridImport/dhwGridExport` zeigt diesen Vertrag getrennt
und benennt die Folge einer ungültigen Quelle: Stopp des Heizerausgangs.
Seine bisherige ACK-/Qualitäts-/Zeitprüfung bleibt operativ unverändert.
Ein frischer Wallbox-Netzwert bedeutet nicht automatisch einen gültigen EHZ-Netzwert.
Die bestehende alpha.48-Direktlesediagnose bleibt unabhängig und erneuert keine
operative Cache-Frische.

## P2: EHZ-Restreserve

Erneuter lesender Snapshot: `highW=[3000,0,0]`, `seenAt=[0,0,0]`,
`commandW=[0,0,0]`, `pending=true`, `OutputOwned=true`. Alle drei realen
Ausgangsleistungen sind bestätigt 0 W, Sollregister `1000_Power` bleibt NULL.
Die Ausgangsquellen aktualisieren `ts`, ihre älteren `lc` bleiben getrennt sichtbar.
Das ist kein Nachweis einer realen 3-kW-Last oder einer verursachten Ladeblockade.

Der Reservierungsvertrag verhindert, dass eine frühe Nullmessung einen noch
verzögert möglichen positiven Auftrag freigibt: Erst volle Stellwirkung auf
der betreffenden Phase beobachten, dann spätere echte Reduktion nach dem
Nullbefehlsabschluss. NULL im Sollregister bestätigt weder einen Auftrag
noch dessen Rücknahme. `seenAt=0` erklärt die nicht freigegebene Reserve.
Der Zustand wurde mit frischen Null-Ausgängen und NULL-Sollregister sowie nach
Neustart reproduziert. **Kein belegter Fehler, deshalb keine Reservelöschung
oder Lockerung.** Die bestehende manuelle Stillstandsbestätigung wird nicht ausgelöst.

## Softwareprüfung und verbleibende Abnahme

Neue Regressionen: Wallbox-/EHZ-Verträge bei 10/12/30/30,001 s, fehlende/NULL/
unbestätigte/qualitativ ungültige Netzquellen, unveränderte Hausphasen- und
Gerätefristen, zusätzliche unveränderte Abtastungen, echte Timer-/Frischewechsel,
neue Quellenzeitstempel, ACK/q/NULL und identische zyklische 0-W-Befehle samt
korrelierten Abschlüssen. Deterministischer Replay mit bzw. ohne zusätzliche
unveränderte Abtastungen liefert exakt gleiche volle Records, Ereignisse,
Timer und Quellenalter. Bestehende Regressionen sichern Master AUS, letzte
elektrische AUS-Flanke, Neustart, Queue-Grenzen und Schreibfehler ab.

EHZ-Regressionen prüfen volle/teilweise Stellwirkung je Phase, NULL als fehlenden
Nachweis, spätere reale Reduktion, neue Last, verzögerte Befehlsabschlüsse und
Neustart. Leistungsmessung, Phase und harte Grenzen werden nicht synthetisch
auf null gesetzt. Softwaretests ersetzen keine Hardware-Abnahme.

Vor Release müssen Manifest-/Laufzeitversion, Paketprüfung und vollständige
Repositorytests auf dem PR und dem übernommenen Stand bestehen. Tag und
GitHub-Release gehören zum Softwareabschluss; keine ioBroker-Installation.

Nächste Tagesanalyse, ausschließlich lesend:

1. Vollständige, begrenzte Rohhistorie mit nichtleeren Fenstern, Limits,
   Antwortgrößen/-zeiten und expliziten Pagination-Abschlüssen; Dubletten,
   Sitzungen, Sequenzen, NULL-/Neustartgrenzen und Verlustzähler prüfen.
   SQL-Backend-/Transportfehler separat zuordnen; nicht vom kleineren Volumen
   auf eine behobene Zugriffsursache schließen.
2. Bei natürlichem Quellenfehler operative 30-s-Wallbox- bzw. 10-s-EHZ-Frist,
   Quellen-`ts`/`lc`, EMS-Empfang und die bestehende einmalige Direktlesung
   samt Beginn, Ende und Dauer den Befehls-/Stopp-/Wiederanlaufereignissen zuordnen.
3. Reservierungs-/Freigabegrund mit passenden realen L1–L3-Ausgangsleistungen,
   Auftrag, Transportabschluss, ACK und `seenAt` prüfen. Keine Last oder
   Ladeblockade allein aus der Reserve bzw. dem Soll-Ist-Unterschied ableiten.
4. Vor Übergaben echte AUS-ACK und elektrische Ruhe, während Phasenwechseln
   Modus-ACK, Phasenpause und Wiederanlauf vollständig nachweisen. Das installierte
   Phasenskript besitzt weiterhin keine eigene Masterkopplung; #8 bleibt offen.
   Ein Repository-Beispiel ist kein Nachweis einer produktiven Installation.
5. Bei realem Überschuss mögliche weitere Ampere anhand frischer Netz-/Strom-/
   Leistungsdaten, passender Strom-ACK und neuer elektrischer Antwort prüfen;
   Budget, Phasenreserve und harte Anschlussgrenzen erhalten.
