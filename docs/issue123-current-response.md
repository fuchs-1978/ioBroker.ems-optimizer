# EQE-Strombefehle: Ursache, Korrektur und reale Abnahme

Grundlage sind Tages-Issue [#123](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/123), Vergleich [#116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/116) und main `28e1b8f3b7d68d2881fa04400b3ed67f50bae6d4` / alpha.59. Die 117 historischen EQE-Befehle stammen aus dem Mischversions-Tag vor alpha.59, insbesondere aus der alpha.58-Sitzung `1791548168417`. Der relevante Regelpfad ist auf unverändertem alpha.59 reproduziert; die vorhandenen Korrekturen #118/#119/#121/#122 bleiben eigenständige, bereits abgeschlossene Arbeiten.

## Belegte Ursache

Die 117 Originalbefehle zwischen 15:27:28 und 16:10:08 Europe/Berlin wurden mit ihrer jeweiligen DecisionRecord-Sequenz, Zuteilung, elektrischen Antwort und frischen SMA-Quelle abgeglichen. Die Regelung verwendete bei laufender Mindestladung nominale Quantisierung (`actualPowerW=null`); die Freigabe der Mindestladung umging auch die numerische Prüfung des aktuell gemessenen Überschussbudgets oberhalb ihres 6-A-Floors. Eine noch gültige Zuteilung war mehrere Sekunden älter als das unmittelbar vor dem Schreiben gemessene Netzbudget. Frische Zeitstempel allein beweisen ausreichende Watt nicht.

| Sitzung / Sequenz | Europe/Berlin | Alter Befehl → historischer Befehl | Neu gemessenes Budget | Nominal benötigt | Reproduktion nach Korrektur |
|---|---|---|---:|---:|---|
| 1791548168417 / 27749 | 09.10.2026 15:46:34 | 7 → 9 A | 2.036,1 W | 2.070 W | 8 A |
| 1791548168417 / 27856 | 09.10.2026 15:46:46 | 7 → 10 A | 2.065,3 W | 2.300 W | 8 A |
| 1791548168417 / 29220 | 09.10.2026 15:50:34 | 6 → 9 A | 1.780,6 W | 2.070 W | 7 A |

30 der 116 Folgebefehle überschritten das jeweils frisch ausgewiesene nominale Budget; 14 Reduktionen wurden während einer noch offenen elektrischen Antwort gesendet. Keine Erhöhung während `ResponsePending=true` wurde belegt. Am Beispiel 15:43:08 → :14 → :22 ist `6 → 9 → 7 → 10 A` erklärt: die niedrigere nominelle Zuteilung ersetzte den noch unbeantworteten 9-A-Befehl, obwohl der Wagen erst etwa 1.290 W / 5,8 A abnahm und die neue SMA-Messung noch 471,4 W Export zeigte. Eine spätere neue Messung bestätigte den Ersatzbefehl im vorhandenen Toleranzbereich. Daraus folgt kein realer Ladestopp und kein Freigabeentzug. Eine Behauptung, alle 117 Schritte hätten dieselbe Fahrzeugreaktion oder reale PV als alleinige Ursache, wäre weitergehend als die Belege.

## Begrenzte Änderung

Die laufende parallele Mindestladung verwendet nun ihre qualifizierte gemessene Leistungsantwort bei der Quantisierung; ein ausdrücklich zugeteilter Mindestfloor bleibt erhalten. Starts, Preisfreigaben und offene Phasentopologien behalten ihre nominalen Verträge. Es gibt kein zusätzliches allgemeines Zeitdelay und kein neues globales Rampentempo.

Der Ausgang trennt harte Geräte-, Hausanschluss-, Phasen- und §14a/LPC-Grenzen von der weichen Zuteilung. Während einer noch offenen elektrischen Antwort darf ausschließlich der schon geschriebene Befehl ohne weiteren Schreibzugriff erhalten bleiben, wenn das aktuelle Netzbudget die tatsächliche Last deckt und die physische Peer-Reserve im gemeinsamen Budget Platz hat. Ein tatsächliches Netzdefizit, eine harte Stromkappe, widerrufene Preisfreigabe, Quellen-/Gerätefehler und die bestehenden Stopregeln bleiben unmittelbar wirksam. Wenn die harte Kappe eine Reduktion verlangt, wird zugleich die aktuelle kleinere Zuteilung eingehalten; daraus darf kein unnötiges AUS durch die Schreibvorprüfung entstehen. Die vorherige Höchstreserve bleibt bis zur neuen physischen Antwort bestehen.

Für neue parallele Erhöhungen müssen die gültigen SMA-Quellen und die Zuteilung nach dem letzten elektrischen Befehl liegen. Zusätzlich muss das numerische aktuelle Budget genügen: eigener gemessener Verbrauch plus aktuelle Netzeinspeisung minus Netzbezug plus Netzziel und tatsächlich autorisierte Netzleistung. Die Mindestpflicht autorisiert nur ihren Floor. Rundung des nominalen Ganzwattvertrags hat maximal 0,5 W Toleranz. Die gemeinsame Peer-/EHZ-/Schutzreserve wird unabhängig nochmals vor dem Schreiben geprüft; sie wird nicht als neuer Überschuss gutgeschrieben. Bei unklarer Peer-Netzzuordnung kann eine Erhöhung daher konservativ warten. Eine bereits laufende Mindestladung behält ihre bestehenden Mindestlaufzeit-/Stoppverzögerungsregeln und PV-Provenienz aus #119.

Eine Befehls-ACK ersetzt keine elektrische Antwort. Die vorhandenen Prüfungen verlangen neue Leistungs- und verwendete Fahrzeugstrommessungen nach Befehl und ACK; Messungen aus einem vorherigen Poll bleiben unzulässig, auch wenn sie innerhalb der Stromtoleranz liegen. Die feste elektrische Antwortfrist wird durch normale Polls nicht verlängert. Nach Ablauf wird eine belegte Unterantwort als `limited` diagnostiziert; fehlende neue oder unzulässig hohe Rückmeldung behält den bisherigen Schutzstopp. Eine abgelaufene Frist ist keine erfundene Fahrzeugbestätigung. Der bestehende Schutz gegen Aufdrehen bei deutlich zu geringer Abnahme gilt weiter.

## Diagnose und Softwaretests

`Devices.WallboxN.IncreaseBudget_JSON` enthält neben Watt und Zielstrom jetzt Rohquellen mit Zeitstempel und Messwert, aktuelle Zuteilungszeit, letzten elektrischen Befehl, noch offenen Strombefehl, ACK-Zeit, feste Antwortdeadline, Antwortzustand, harte Kappe, aktuelle Wattkappe und Entscheidungsgrund. `awaitingElectricalStep` umfasst nun auch die allgemeine elektrische Antwort. `AllocationDiagnostics_JSON` weist bei Mindestladung die echte Leistungsantwort und deren Quellenzeit aus. Unbekannte Werte bleiben `null` und werden nicht als Messnull dokumentiert.

Die Tests verwenden Originalzeitstempel der drei oben genannten historischen Budgetabweichungen und übersetzen sie um einen gemeinsamen Offset in eine deterministische Uhr. Weitere Regressionen prüfen 1P/3P, steigende und sinkende PV, Fahrzeugtotzeit, sofortige Hausanschluss-/§14a-/Gerätereduktion, gleichzeitig kleinere harte und weiche Grenzen, zwei Fahrzeuge mit zurückgehaltener Peer-Reserve, reine ACK ohne Lastantwort, alte elektrische Polls, alte noch formal frische Netzbudgets und Ablauf der festen Antwortfrist. Bestehende PV-/Mindest-SoC-/600-s-Stopverzögerungsfälle müssen weiterhin bestehen.

## Prüfpunkte für die nächste SQL-Auswertung

1. Nach einer manuell autorisierten Installation reale Version, Master, Sitzung und Konfiguration lesen. Diese Softwareänderung installiert und aktiviert nichts.
2. Für jeden EQE-Stromschritt Ereignis-ID und Rohzeitstempel mit genau einer rekonstruierten DecisionRecord-Sequenz verbinden; Doppelzählungen an Fensterrändern entfernen. Zuteilungszeit, SMA-Zeit, Leistung-/Stromzeit, Befehl, ACK und Antwortdeadline getrennt vergleichen.
3. Oberhalb des Mindestfloors darf eine Erhöhung das aktuelle nominale Budget nicht überschreiten. Eine ältere höhere Zuteilung darf keine zusätzliche Netzfreigabe liefern.
4. Während Fahrzeugtotzeit darf ein kleineres weiches Ziel bei weiter gemessenem Überschuss den vorhandenen Befehl nur halten. Die Reserve darf nicht an ein zweites Fahrzeug ausgegeben werden. Reales Defizit und Schutzkappen müssen weiterhin sofort reduzieren oder sicher stoppen.
5. Bei bestätigter neuer elektrischer Antwort bzw. klar abgelaufener Antwortfrist die nächste Entscheidung prüfen. Befehls-ACK, Stromtoleranz und Quellenalter allein sind kein Beweis für eine neue elektrische Messung.
6. Stromwechselzahl, Median-/Kurzabstände und echte Leistung/Freigabe erneut bewerten. Änderungen an alten geschlossenen Regelkreisen verändern deren späteres Fahrzeug-/Netzverhalten; die historischen Messungen sind deshalb kein vollständiger Hardware-Replay der korrigierten Software.

Softwaretests liefern keine reale Betriebsabnahme und keine Scorepunkte. Ein vergleichbarer Peer-Wechsel unter alpha.59 und reale Phasen-/Schutztests bleiben unabhängig offen.
