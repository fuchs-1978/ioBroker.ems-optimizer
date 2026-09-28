# Issue #62 – Änderungen in 0.17.0-alpha.21

Diese Version verbessert die Behandlung kleiner negativer Leistungsmesswerte,
die elektrische Rückkopplung im Schattenmodell und die Diagnose von
Wallbox-Stopps. Schattenpausen sind keine nachgewiesenen realen EMS-Abbrüche.

## 1. Kleine negative Wallbox-Leistung

Eine gültige Leistung von −20 W bis unter 0 W wird ausschließlich für die
Regelung auf 0 W begrenzt. Der Rohwert bleibt im Quellobjekt und im Debug erhalten.
Die Grenze beträgt 20 W. Das ist keine Toleranz für ungültige Datenqualität,
fehlende Bestätigung oder veraltete Messwerte. Werte unter −20 W stoppen
weiterhin über die Messwertprüfung. Andere Messgrößen werden nicht pauschal
auf 0 begrenzt.

Ein echter Leistungsmangel kann weiterhin nach Mindestlaufzeit und
Abschaltverzögerung zum regulären Stopp führen. Die Änderung verhindert nur den
sofortigen harten Stopp allein wegen eines kleinen negativen Leistungswerts.

## 2. Elektrische Antwort im Schattenmodell

Bis alpha.20 konnte die Stromberechnung einen virtuellen 6-A-Befehl mit der
realen Leistung des unabhängig arbeitenden Bestandsskripts kombinieren.
Alpha.21 rechnet stattdessen mit einer privaten idealen Leistungsantwort auf
den letzten modellierten Ausgang: Strom × bestätigte Phasen × 230 V.

Die Netzbilanz wird im selben privaten Rechenzweig angepasst:

`Netzmodell = Netz real + Summe(Wallboxmodell − Wallbox real)`

Alle beteiligten Wallboxen und die Netzleistung werden gemeinsam ersetzt.
Die ursprünglichen Werte unter `Actuals` und `realFeedback` bleiben erhalten.
`Response.Grid_W` ist ausdrücklich eine angenommene Netzleistung. Bei
ungeeigneten Quellen zeigt `Response.Valid=false` die fehlende Aussagekraft.
Die Fehlerdiagnose wird weiterhin aus den realen Rückmeldungen gewonnen.

Reale Phasenbestätigung, Fahrzeugstatus, SoC, Fehlerstatus und Freigaben bleiben
verbindlich. Reale Phasenströme und Hausanschlussgrenzen werden weiterhin für
die Schutzprüfungen verwendet. Nur die Prüfung, ob das Modell seinen eigenen
vorherigen Strom angenommen hat, darf den privaten Modellstrom verwenden.
Das produktive Verhalten dieser Rückkopplung bleibt unverändert.

EHZ, Speicher, Temperaturen und SoC werden nicht als vollständige physikalische
Anlage simuliert. Ihre echten Werte bleiben Randbedingungen. Deshalb bedeutet
ein ruhiger Modellverlauf noch keine bestandene EMS-Liveabnahme.

## 3. Diagnose der Stoppursache und des Budgets

Die Wallbox meldet nun getrennt, ob ein echter Gerätefehler mit Fehlercode
vorliegt oder eine Rückmeldung fehlt, unbestätigt, qualitativ ungültig,
veraltet oder nicht numerisch ist. Negative Leistung außerhalb der Toleranz
erhält eine eigene Erklärung mit Rohwert. Verbindungszustände werden als
statische Statuswerte behandelt: Ein seit Langem unverändertes `true` ist
allein kein Kommunikationsfehler.

`DecisionRecord.realFeedback.WallboxN` enthält zusätzlich `error` und
`connection`, Quellzeit, Alter, ACK, Qualität und Quellenprüfung.

`Control.WallboxN.AllocationDiagnostics_JSON` erklärt die Stromberechnung:

| Feld | Bedeutung |
| --- | --- |
| `timestamp`, `valid`, `selected` | Zeitpunkt und Gültigkeit der Budgetentscheidung |
| `requiredControlledW`, `pairAvailableW` | Gesamter Bedarf und verfügbare Leistung für WB/EHZ |
| `requestedBeforeStabilizationW`, `requestedW` | Budget vor Start-/Haltebedingungen und unmittelbar vor Quantisierung |
| `previousA`, `actualPowerW` | Verwendeter vorheriger Strom und Leistungsantwort |
| `responseBasis`, `deltaW`, `deltaA` | Nennleistungsrechnung oder Antwortregelung mit Änderungsschritt |
| `minimumA`, `maximumA`, `rampA` | Verwendete Stromgrenzen und maximale Erhöhung |
| `requestedA`, `targetA`, `reason` | Strom vor Mindeststromprüfung, Ergebnis und Begrenzungsgrund |
| `safetyBudgetW` | Gemeinsames Leistungsbudget; `null` bedeutet keine zusätzliche endliche Grenze |

Die produktiven Debug-Snapshots enthalten diese Daten unter `allocation`.
Im Schattenbetrieb stehen sie je Wallbox in `Snapshot_JSON` und dem
zusammengehörigen `DecisionRecord`. Ein Zeitstempel macht sichtbar, wenn der
langsame Budgetzyklus älter als der gerade laufende Ausgangszyklus ist.

## 4. Nur lesende SQL-Auswertung

`npm run analyze:shadow -- export.json` analysiert exportierte SQL-Daten.
Eine Anleitung und das Eingabeformat stehen in
[tools/README-shadow-analysis.md](../tools/README-shadow-analysis.md).

Die Auswertung verwendet Ereigniszeit, Sitzung und Sequenznummer. Sie trennt
Modellpausen von gemessenen Leistungseinbrüchen und zählt unbekannte Abschnitte
nicht als Abschaltungen. Sie verbindet Ladeblöcke nach Abstecken nicht zu einer
scheinbar langen Zwischenunterbrechung. Quellenfehler und Datenabdeckung bleiben
im Ergebnis sichtbar.

Netzenergie stammt bevorzugt aus zusammenpassenden Import-/Exportzählern mit
vollständigen Fenstergrenzen. Ersatzweise wird Nettoleistung mit begrenzter
Wertfortschreibung integriert. Dünne gerichtete SMA-Rohhistorien werden nicht
automatisch zu einer vermeintlich genauen Tagesbilanz verrechnet.

Die Aufbewahrung bleibt auf 24 Stunden eingestellt. Die zusätzlich gespeicherte
angenommene Netzleistung wird wie eine kontinuierliche Leistungsreihe auf
höchstens einen SQL-Wert pro zehn Sekunden begrenzt; Gültigkeitswechsel und
zusammengehörige Entscheidungsereignisse behalten ihre volle Auflösung.

## Update und Überprüfung

Das Update erfolgt wie bisher aus GitHub. Bestehende Freigaben und
Phaseneinstellungen werden nicht neu aktiviert. Die bereits vorhandenen
EMS-Phasenfolgeskripte werden beim späteren begleiteten Test verwendet.

Regressionen prüfen kleine negative Leistungen, stärkere negative und ungültige
Messungen, echte Fehler, Stopphandshake und Wiederanlauf. Schattenprüfungen
decken Betrieb über die 600-s-Mindestlaufzeit hinaus, wechselnde PV und
unterschiedliche reale Skriptströme bei identischer Ausgangslage ab. Dabei
müssen die privaten Entscheidungen zusammenpassen und alle echten Schutzwerte
weiter wirken. Tests der SQL-Auswertung prüfen zusätzlich Lücken, Duplikate,
normale Ladeenden, Zählerrücksetzungen und unvollständige Energieabdeckung.

Die veröffentlichte Testsuite verwendet ausschließlich künstlich erzeugte
Eingaben. Der lange Verlauf prüft mit wechselnden PV-, Last- und SoC-Werten die
elektrische Bilanz, den Betrieb über die Mindestlaufzeit hinaus und das
reguläre Ende am Ziel-SoC. Fahrplan und thermische Bedingungen sind fest
vorgegeben. Diese Prüfungen ersetzen keine praktische EMS-Liveabnahme.

Die praktische Abnahme nach dem Update bleibt unter [Issue #62](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/62) nachvollziehbar.
