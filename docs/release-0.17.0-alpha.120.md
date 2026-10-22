# 0.17.0-alpha.120

## Korrektur

Die Parallelverteilung vergab zunächst theoretische Anteile nach Priorität. Wartete das bevorzugte Fahrzeug auf seinen Start oder konnte seinen Mindestladestrom noch nicht nutzen, erhielt ein nachrangiges Fahrzeug davon nichts. Die anschließende Restverteilung leitete die ungenutzte Leistung an den Heizstab weiter.

Ungenutzte Anteile werden nun innerhalb desselben Regeldurchlaufs an nachfolgende Wallboxen weitergegeben. Bereits physisch belegte oder durch ausstehende Befehle reservierte Leistung bleibt gebunden. Benötigt das bevorzugte Fahrzeug erst eine Lastreduktion eines anderen Verbrauchers, wird dieser Anspruch nicht zurückverteilt. Tarifgebundene Netzladefreigaben werden nicht als PV an andere Fahrzeuge weitergereicht. Die vorhandenen Startverzögerungen und Ausgangsprüfungen bleiben zuständig.

`Control.WallboxN.AllocationDiagnostics_JSON.redistributedW` zeigt den zusätzlich angebotenen Anteil. Dieser Wert ist kein Nachweis tatsächlich aufgenommener Leistung.

## Prüfung

Regression mit 4.285 W Gesamtbudget, wartender Prioritäts-Wallbox, laufendem EQV bei 6 A und optionalem Heizstab: Der EQV erhält Mehrleistung ohne manuelle Priorisierung. Zusätzliche Fälle prüfen die gemeinsame 4.200-W-Grenze einschließlich Heizstabreservierung sowie die Startverzögerung eines ebenfalls wartenden Folgefahrzeugs. Bestehender Regressionstest gegen blockierte Prioritätsübergabe bleibt erfüllt.

Keine automatische Installation oder Änderung der Anlagenfreigaben. Die reale Betriebsbeobachtung nach Installation steht aus.
