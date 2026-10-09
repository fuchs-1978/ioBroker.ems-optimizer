# Begonnenen Mindestladestart während Peer-Abschaltung erhalten

## Beobachteter Anlass

Am 09.10.2026, Zeiten Europe/Berlin, lief die installierte alpha.58 mit Master EIN.
Die zusammenhängenden DecisionRecords der Sitzung `1791548168417` und passende
reale go-e-Leistungs-/Freigaberückmeldungen zeigen:

| Zeitpunkt | Beobachtung |
| --- | --- |
| 16:34:36.033 | EQV/WB1 erhält ON für eine parallele Mindestladung; Sequenz 44094. ON-ACK folgt um 16:34:36.257. Elektrische Ladeleistung ist noch 0. |
| 16:34:36 | EQE/WB2 steht bei SoC 90%; seine Mindestgrenze wird in den Records von 95 auf 90% geändert. EQV bleibt mit SoC 85% unter Mindest-SoC 90%. |
| 16:34:38.029 | EQV erhält erneut AUS: „Parallelbetrieb: kein Startbudget zugeteilt“; Sequenz 44113. |
| 16:34:38.063 | EQE erhält AUS wegen erreichtem Mindest-SoC ohne weiteres PV-/Preisbudget; Sequenz 44118. AUS-ACK um 16:34:38.341. |
| 16:34:46.184 | EQE-Leistung erstmals als 0 kW gemessen; Phasenströme ebenfalls 0. AUS-ACK allein hatte zuvor noch keine elektrische Ruhe bewiesen. |
| 16:34:54.223 | Zweiter EQV-ON-Befehl bestätigt; Sequenz 44258. |
| 16:35:14.583 | EQV elektrisch mit etwa 1,24 kW und 5,4 A auf L1 bestätigt. Rund 20 s Fahrzeugreaktion liegen innerhalb der eingestellten 45-s-Frist. |

Das ist ein belegter zusätzlicher Startversuch. Eine Unterbrechung einer zuvor
bereits elektrisch ladenden EQV-Ladung ist für diesen Abschnitt nicht belegt.
Der ursprüngliche parallele Start war bei zwei Fahrzeugen unter Mindest-SoC
autorisiert. Das erfolgreiche spätere Einschalten erfolgte nach EQE-AUS und
elektrischer Ruhe. Wer die Mindestgrenze änderte, ist nicht aus den Records
abzuleiten.

## Reproduzierte Ursache und Änderung

Der Parallelverteiler schützt seit alpha.55 eine **bereits elektrisch
bestätigte** laufende Mindestladung. Ein vorhandener, bereits gesendeter Start
mit noch ausstehender Befehls- oder Fahrzeugantwort fällt nicht darunter.
Nach dem EQE-Mindestabschluss schrumpft das weiche Ladebudget, während die
EQE-Abschaltung noch Leistung reserviert. Dadurch verlor der EQV-Start seine
Zuteilung. Die Regression bildet diese Kombination mit beiden Ziel-SoC 100%
nach; am unveränderten alpha.58-Code wird statt 6 A ein Nullziel geliefert.

Alpha.59 führt einen expliziten Treibernachweis
`Devices.WallboxN.OutputStartReservation_JSON` ein:

```json
{"schema":1,"pending":true,"stage":"allow","amps":6,"phases":1,"stageAt":1791556476033,"validUntil":1791556496033}
```

Dies ist ein Formatbeispiel mit Ereigniszeit und 20-s-Befehlsfrist, kein
nachträglich beobachteter alpha.59-Datensatz. `current` und `allow` verwenden
die feste Befehlsrückmeldefrist; `vehicle_response` beginnt beim tatsächlichen
ON-ACK mit der konfigurierten Fahrzeugreaktionsfrist. Fristen werden nicht pro
Regeltakt verlängert. Ohne Startnachweis lautet der Zustand
`{"schema":1,"pending":false}`.

Der Verteiler hält ausschließlich das noch benötigte eigene 1P-Mindestbudget
eines gültigen begonnenen Starts. Sämtliche Peer-/EHZ-Reservierungen bleiben
einmal vollständig in der harten Bilanz enthalten. Eigentümerschaft und
Reservierung allein gelten nicht als Startbeweis, denn sie können auch zu
einer offenen Abschaltung gehören.

Wenn eine Peer-Abschaltung die nächste Startaktion noch sperrt, wartet der
Ausgang innerhalb der bestehenden Frist, ohne einen zusätzlichen AUS-Befehl
allein wegen dieser weichen Änderung zu erzeugen. Neue ON-Befehle und
Erhöhungen bleiben an die unabhängigen Peer-AUS-/elektrischen Rückmeldungen
und das aktuelle harte Budget gebunden. Ungültige Quellen, Fehler, fehlende
Freigabe, erreichte Ladegrenze, Neustart und abgelaufene Fristen begründen
keine fortgesetzte Startreservierung. 3P-Starts und Phasenwechsel erhalten
keine neue Ausnahme.

## Prüfung und offene reale Abnahme

Regressionen prüfen die Mindestgrenzenänderung in `current`, `allow` und
`vehicle_response`, Peer-Nachlauf, unveränderte Reservierungen und den
zusätzlichen Ausgangs-Wartepfad. Negative Fälle betreffen neue inaktive
Starter, fehlende/veraltete/ungültige Nachweise, abgeschlossene Ladepflicht,
Quellenqualität, Phasenwechsel, Ablauf sowie schrumpfende Hausanschluss-/
§14a-/Gerätebudgets. Ein Recorder-Replay erhält Stufe und ursprüngliche Frist,
ohne Reservierung oder unbekannte Leistung als reale Ladung darzustellen.

Nach manueller Installation bei einer vergleichbaren Übergabe in SQL prüfen:

1. Startstufe, feste Frist und `pendingMinimumStartW` müssen zusammenpassen;
   keine Reservierungsverlängerung durch bloße Snapshots.
2. EQE-AUS-ACK und elektrische Ruhe getrennt nachvollziehen. Erforderliche
   neue EQV-ON-/Erhöhungsbefehle dürfen erst nach diesen Rückmeldungen erfolgen.
3. Kein zusätzlicher EQV-AUS-Befehl ausschließlich durch den beschriebenen
   weichen Budgetverlust; reale Fahrzeugantwort innerhalb der eingestellten
   Frist und belastbare Schutzbilanz prüfen. Ein Fristablauf beendet den
   Startnachweis; eine Fahrzeugbegrenzung bleibt von einem fehlenden
   Befehls-ACK und einem Schutzfehler zu unterscheiden. Erforderliche
   Schutzstopps bleiben wirksam. Ein rechtzeitig bestätigter Strombefehl,
   dessen nächste Startaktion wegen des Peers ausbleibt, wird als begrenzter
   Übergabe-Wartezeitablauf statt als fehlendes go-e-ACK gemeldet.

Tests sind keine beobachtete Liveabnahme. Diese Änderung installiert nichts
in ioBroker, verändert keine Produktionskonfiguration und verspricht keine
Scorepunkte.
