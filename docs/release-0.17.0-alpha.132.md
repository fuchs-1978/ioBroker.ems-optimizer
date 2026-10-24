# 0.17.0-alpha.132 – kompakte Tagesbilanz

Der Adapter sammelt passive Kennzahlen alle fünf Sekunden aus den bereits qualifizierten Debug-Messquellen. Kein SQL-Abruf, keine neue Historienkonfiguration, keine Änderung an Reglern oder Aktoren. Die Sammlung läuft auch bei ausgeschalteter Debug-Aufzeichnung.

## Ein kleiner Abruf statt Tagesprotokollen

`ems-optimizer.0.Debug.DailySummary_JSON` enthält `current` und `previous`: die laufende und die zuletzt abgeschlossene beobachtete Periode. Grenze ist 20 Uhr Europe/Berlin; Tage mit Zeitumstellung haben 23 bzw. 25 Stunden. Ein Zustandsabruf liefert beide Berichte, maximal 64 kB. Die Automation muss den Zeitraum im Bericht prüfen, statt einen älteren Bericht für heute zu verwenden. Der Zustand wird höchstens minütlich und zusätzlich beim Periodenwechsel/normalen Beenden geschrieben. Direkt um 20 Uhr kann die Umschaltung bis zur nächsten 5-Sekunden-Probe dauern. Nach Installation ist die erste Periode unvollständig.

Pro Quelle (`grid`, `pv`, `bhkw`, `wallbox0`–`wallbox2`, `ehz`) enthält der Bericht `coveredMs`, `unassessedMs`, `importWh`, `exportWh`, `meanW`, `meanAbsoluteW` und die für das Netz relevante Zeit unter −200 W. Import/Export bezeichnet positive/negative Leistung der jeweiligen Quelle: positive PV-/BHKW-/Geräteleistung wird in `importWh` integriert; beim Netz entspricht dies Netzbezug. Netzleistung ist Bezug minus Einspeisung; PV und BHKW bleiben getrennt, ohne doppelte Anrechnung.

Es sind **Leistungsintegrale als Schätzung**, keine Zählerabrechnung: linker Messwert wird maximal 10 Sekunden fortgeschrieben, beide Intervallenden müssen gültig sein. Längere Lücken und Neustarts werden nicht überbrückt. NVP benötigt zusätzlich zeitlich zusammenpassende Bezugs-/Einspeisewerte (maximal 5 s Versatz). Vor-/Nachlauf außerhalb der belegten Abdeckung ist unbekannt, nie Nullenergie. Die 200-W-Schwelle ist eine Diagnosegröße, keine Schutzgrenze und kein Nachweis vermeidbarer Einspeisung. `avoidableExportWh` bleibt ohne simultanen Kapazitätsnachweis null.

Quellen sind die bestehenden `DebugRecorder.snapshot()`-Verträge: Mapping DP_GRID_IMPORT/EXPORT (W), DP_PV_POWER (W), DP_BHKW_POWER (W, nur bei vorhandenem BHKW), DP_WB0/1/2_POWER (kW → W) und die drei qualifizierten realen EHZ-Ausgangsregister. Write-only Heizstab-Sollwerte werden nicht integriert. Fehlende oder ungültige Quellen bleiben unbekannt.

Maximal 100 beobachtete Ereignisse mit Gesamt-/Überlaufzähler: Masterwechsel, Auswahlwechsel, Netzlimitstatus, LastStopAt samt Grund und Phasenstatus. Dies sind abgetastete Zustandsänderungen, keine vollständigen elektrischen Übergabe-/Schutznachweise. Kurze Zwischenereignisse können fehlen; nach Lücken wird keine durchgängige Ereigniskette behauptet. Recorderzählerdifferenzen erfassen beobachtete Zunahmen und Rücksetzungen, aber beweisen keine vollständige SQL-Zustellung. `protectionAssessment` bleibt ausdrücklich nicht vollständig bewertet. Kein automatischer Score.

## Persistenz und Prüfung

Ein einzelner bestätigter ioBroker-Zustand enthält beide Perioden. Schreibzugriffe sind serialisiert und auf einen laufenden plus einen neuesten Stand begrenzt. Bei normalem Neustart bleiben Summen erhalten; Interpolations-/Ereignisbasen werden verworfen. Bei hartem Ausfall können seit der letzten erfolgreichen minütlichen Speicherung erfasste Werte fehlen; diese Zeit wird nach Neustart nicht als abgedeckt erfunden. Fehlerhafte oder übergroße Zustände werden verworfen und neu begonnene Abdeckung bleibt erkennbar. SQL-Rohdaten sind weiterhin für gezielte Fehleranalyse nutzbar.

Tests: DST-Grenzen, Intervallsplitting um 20 Uhr, ungültige Quellen/Quellenversatz, Ausfälle, Neustart ohne Lückenüberbrückung, Ereignis-/Größenbegrenzung und beschädigter Prüfstand. Softwaretests ersetzen keine reale Tagesabnahme nach Installation.
