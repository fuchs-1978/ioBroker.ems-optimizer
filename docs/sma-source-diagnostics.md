# SMA-Quellendiagnose ab alpha.48

## Datenweg und Anlass

Der SMA-Adapter veröffentlicht seine Messwerte in ioBroker. Beim Start liest der EMS die konfigurierten ioBroker-Zustände ein und abonniert Änderungen. Anschließend aktualisiert `main.js:onStateChange` den EMS-Cache. Die Ausgangs- und Reglerprüfungen lesen normalerweise diesen Cache, nicht unmittelbar den SMA. Die Quellenzeit `ts` wird nicht durch den Empfangszeitpunkt ersetzt; `lc` bezeichnet die letzte Wertänderung und ist keine Frischeprüfung. Ein unveränderter Wert kann trotzdem frisch aktualisiert werden.

Am 07.10.2026 um 15:14:22 Europe/Berlin war ein EQV-Stopp unter alpha.46 mit 12 s altem SMA-Einspeisewert dokumentiert. Alpha.47 erhöht auf Nutzerauftrag die Toleranz für Gesamtbezug/-einspeisung auf 30 s. Dass der EMS einen alten Wert sah, beweist weder einen ausgebliebenen SMA-Sendevorgang noch dessen Ursache. Zeitgleich aufgetretene Abfragefehler sind ohne weitere Nachweise nur eine mögliche Korrelation.

## Fehlerbericht

Bei einem ungültigen Gesamt-Netzwert enthält die unmittelbare Abschaltmeldung eine Ereigniskennung und für die betroffene Quelle ID, Wert, `ts`, `lc`, ACK, Qualität, berechnetes Alter und den EMS-Empfang samt Herkunft. `initial-read` ist ein Einlesezeitpunkt beim Start, kein nachgewiesenes neues Sensorupdate. `stateChange` ist die im EMS beobachtete Zustellung eines ioBroker-Updates. Fehlende Empfangshistorie wird als unbekannt ausgegeben; sie wird nicht rückwirkend erfunden.

Jede betroffene Quelle wird pro zusammenhängendem Fehlerereignis einmal zusätzlich über `getForeignStateAsync` gelesen. Dieser Versuch läuft asynchron, wartet höchstens 5 s und verzögert keine Schutzentscheidung oder Abschaltung. Er erneuert den operativen Cache nicht und kann keine Freigabe erteilen. Antwort, Dauer, Quellenfelder und eine Vergleichsmessung des Cache-Stands bei Abschluss werden separat gespeichert. Fehlende Antwort, Fehler und Timeout bleiben unbekannt. Eine verspätete Antwort darf kein neues Fehlerereignis und keinen späteren Abschaltgrund überschreiben. Idealisierte Schattenausgänge führen diesen zusätzlichen realen Diagnoseversuch nicht aus.

Das Ergebnis steht in `Devices.WallboxN.LastStopSourceDiagnostics_JSON`, einer ergänzenden Logmeldung und – solange noch demselben Fehler zugeordnet – im `LastStopReason`. Der produktive DecisionRecord enthält die Diagnose. Vorhandene SQL-Aufzeichnung und Datenabdeckung müssen weiterhin separat geprüft werden; SQL-Einstellungen werden nicht verändert.

## Interpretation

- Alter Cache zu Prüfzeitpunkt, frischer direkter ioBroker-Wert und weiterhin alter Cache bei Leseabschluss: unterschiedliche beobachtete Zustände sind belegt. Verarbeitungs-/Zustellungsverzögerung untersuchen; noch kein Beweis einer bestimmten Fehlerursache.
- Sowohl Cache als auch direkte Antwort alt: ioBroker liefert zu beiden Beobachtungszeiten einen alten Quellenzeitstempel. SMA-Adapter, Empfangsverarbeitung und Sender bleiben getrennte mögliche Ursachen.
- Cache und direkte Antwort bei Abschluss beide frisch: Erholung innerhalb des Leseversuchs möglich. Eine reguläre Aktualisierung zwischen den Beobachtungszeiten ist kein Beweis für einen vorherigen Cachedefekt.
- Direkte Antwort fehlt oder läuft ins Timeout: Zugriff zum Diagnosezeitpunkt nicht bewertbar; keine Aussage über die Sensorleistung oder elektrische Ruhe.

## Nächste reale Prüfung

Version und Zuständigkeit erneut lesen. Beim nächsten natürlich auftretenden Quellenfehler Ereigniskennung, Prüfzeit, ursprüngliches Quellenalter, Empfangszeit, Leseanforderung/-abschluss und Cache-/Direktantwort zusammenführen. Schutzstopps, aktuelle 30-s-Grenze, ACK/Qualität und realen Wiederanlauf getrennt bewerten. Keine Quellen künstlich blockieren und keine Schutzgrenzen zum Test umgehen.

Regressionstests prüfen Empfangszeit ohne Änderung der Quellenzeit, Datenfeldbegrenzung, direkte Antwortzeit, fehlende/fehlerhafte Antworten, Timeout und verspätete Antwort sowie Abschaltung ohne Warten auf Diagnose und ohne operative Cache-Erneuerung. Softwaretests ersetzen keinen realen Ursachen- oder Abnahmenachweis.
