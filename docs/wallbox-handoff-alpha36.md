# Qualifizierte Fahrzeugübergabe ab 0.17.0-alpha.36

## Ergebnis

Bei einem kontrollierten Wechsel zwischen zwei Wallboxen kann der zweite allgemeine Start-Countdown entfallen. Das gilt für eine gültige manuelle Fahrzeugwahl und für die automatische Folgeladung nach frisch bestätigtem Erreichen des Ziel-SoC. Die alte Wallbox wird zuerst abgeschaltet; erst nach AUS-Bestätigung und elektrischer Ruhe startet die nächste mit der regulären 6-A-Sequenz. Die Rückmeldetotzeit, Phasenbestätigung und Reaktion des Autos bleiben Bestandteil der Übergabe.

Die Version ändert keine konfigurierten Start-, Stopp- oder Mindestlaufzeiten. Ein normaler Erststart verwendet weiter die eingestellte Startverzögerung. Updates aktivieren keine Geräte.

## Wann der zweite Countdown entfallen darf

| Nachweis | Bedingung |
| --- | --- |
| Vorherige EMS-Ladung | Der Echtzeitregler hat in seiner aktuellen Sitzung einen inaktiven Ausgang und danach die eigene aktive Ladung beobachtet. Gespeicherte Startwerte oder eine fremde Bestandsladung reichen nicht. |
| Wechselgrund | Die neue gültige manuelle Priorität wählt das geeignete Fahrzeug, oder die alte Ladung hat ihr gültiges Ziel-SoC erreicht. Abstecken, Fehler oder Freigabeentzug erzeugen keine automatische Abkürzung. |
| Budget | Bei der einmaligen Vorbereitung mindestens phasenabhängige Mindestleistung plus Startreserve; danach durchgehend mindestens Mindestleistung innerhalb aller Sicherheitsgrenzen. |
| Ziel und Quellen | Fahrzeug vorhanden, angeschlossen, freigegeben und unter Ziel-SoC; gültige Fahrzeug-, Mess-, Steuerungs- und Fahrplandaten. Auswahl, Phasen und Preisberechtigungsbasis bleiben passend. |
| Schattenantwort | Im Schatten muss die private elektrische Antwort des aktuellen Modellzyklus ausdrücklich gültig sein. Veröffentlichte Debug-Werte und reale Leistung des Bestandsskripts ersetzen sie nicht. |
| Beobachtung und Frist | Durchgehende Reglerbeobachtung; feste Frist aus Befehls-, Fahrzeug- und Phasenwartezeiten, höchstens fünf Minuten. Sie wird nicht pro Zyklus erneuert. |

Die Vorbereitung gehört zu einem einzigen Wechsel. Bei Daten- oder Budgetverlust, anderer Auswahl, Änderung der Phasen-/Preisberechtigungsbasis, Reglerreset oder Fristende verfällt sie. Derselbe alte Ladeabschnitt kann sie nicht wiederholt neu herstellen; eine spätere Wiederaufnahme folgt der normalen Startqualifikation.

## Reihenfolge und Sicherheit

1. Das geeignete neue Fahrzeug wird ausgewählt. Beim Ziel-SoC-Ende darf seine Budgetvorbereitung bereits beginnen, während die alte Wallbox ihren AUS-Vorgang beendet.
2. Der bisherige Ausgang bleibt zugeordnet und seine Last reserviert, solange AUS oder elektrische Abschaltung nicht bestätigt sind. Im realen Ausgang werden frische bestätigte Leistung bis 20 W und alle drei Phasenströme bis 0,5 A verlangt. Nach einer aktiven Ladung müssen diese Messwerte mindestens so neu wie die passende AUS-Bestätigung sein.
3. Der neue Ausgang prüft weiterhin die andere Wallbox, Phasenstellung, Quellen, Gerätefehler, Freigaben sowie Hausanschluss- und §14a-/LPC-Grenzen. Die Budgetabkürzung ist keine elektrische Freigabe.
4. Erst anschließend werden Mindeststrom, dessen Rückmeldung, Ladefreigabe und Fahrzeugantwort bestätigt. Die nächste Aufregelung wartet weiterhin auf die neue gültige elektrische Antwort.

Es gibt keine gleichzeitige Freigabe zweier Wallboxen. Die verbleibende Übergabepause hängt von Rückmeldungen und Fahrzeugreaktion ab; ein fester sofortiger Start wird nicht versprochen.

## Diagnose

Das DecisionRecord enthält je Wallbox unter `allocation.WallboxN.start.vehicleHandoff`:

- `eligible` und `qualified`: ob die Vorbereitung aktuell den zusätzlichen Countdown vermeiden darf;
- `reason`: Vorbereitung, Ablehnung, Abschluss oder Verfall;
- `from` und `to`: bisherige und nächste Wallbox;
- `until` und `remainingS`: feste Ablaufzeit und verbleibende Frist.

Die Ausgangsdiagnose trennt eine unbekannte elektrische Schattenantwort von einer gültigen modellierten Restlast. Eine unbekannte Modellantwort liefert keinen Nullnachweis. Die realen AUS-Prüfungen sind unverändert.

## Prüfkriterien und Abnahme

Regressionen prüfen normale Erststarts mit 120 Sekunden, manuelle Übergabe und Ziel-SoC-Folgeladung, verzögerte AUS-Rückmeldung und Lastabfall, bestätigten 6-A-Start sowie fehlende, veraltete oder fremde Ausgangsnachweise, Neustart, Budget-/Preisverlust und ungültige Schattenantworten. Modellierte Bestätigungen werden nicht als reale Fahrzeugreaktion ausgegeben.

Ein höherer Score erfordert neue ausreichend vollständige SQL-Betriebsbelege. Vor einem begleiteten Live-Test müssen unter anderem nur ein aktiver Regler, sichere Übergabe, reale Phasenbestätigung und die elektrischen Schutzprüfungen konkret nachgewiesen sein. Diese Softwareänderung erteilt keine Livefreigabe und schaltet den Master nicht ein.
