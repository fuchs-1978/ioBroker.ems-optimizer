# 0.17.0-alpha.80

## Ursache
Ein gefüllter SQL-Prüfrückstau ließ echte Speichernachweise altern, bevor der Verifier sie las. Der Fehlerbetrieb blieb deshalb trotz gesundem Backend gedrosselt, weil der unveränderte Recovery-Vertrag einen nach Fehlerbeginn gespeicherten und höchstens 60 Sekunden alten SQL-Wert fordert. Dies wurde mit unverändertem alpha.79-Code und einer endlichen Queue lokal reproduziert; es erklärt nicht die Ursache separater NAS-/SQL-/MCP-Zeitüberschreitungen.

## Korrektur
Im Fehlerbetrieb wechselt die Auswahl zwischen einem noch frischen Veröffentlichungsfenster nach Fehlerbeginn und dem bisherigen FIFO. Unter den frischen Fenstern wird das älteste innerhalb von drei Vierteln der bestehenden Frischefrist bevorzugt: Das lässt asynchrone Speicherung nachlaufen und reserviert Antwortspielraum. Erst ein unabhängig zurückgelesenes, exakt nach Hash/Sitzung/Sequenz passendes Original hebt die Drosselung auf. Alte oder leere Antworten beweisen weiterhin keine neuen Schreibvorgänge. Alte Fenster dürfen nicht verhungern.

Unverändert: ein Original/eine Abfrage je 30 Sekunden im Fehlerbetrieb, normale Versand-/Abfragebudgets, Frischevertrag, Sperren bei unbekanntem Backendabschluss, Grenzen/Retention des Journals, Rohzeitstempel und NULL/ACK/q. Keine Steuerungs-, SQL-Konfigurations- oder Aktoränderung. Keine automatische Installation.

## Validierung und reale Abnahme
Neue Regressionen bilden zehn alte Prüffenster mit 1.000 Originalen ab: gesundes Backend, asynchron verzögerte Sichtbarkeit und fehlende neue Speicherung. Gegen den unveränderten main-Code scheitern die beiden positiven Erholungsfälle; mit Korrektur erfolgt die Erholung und die endliche Queue wird mit exakten Nachweisen abgearbeitet. Der negative Fall bleibt gedrosselt und bestätigt keine unbelegten neuen Originale; alte Nachweise werden weiterhin bedient. Bestehende Tests prüfen unbekannte Backendabschlüsse und ungültige Belege.

Nach manueller Installation separat prüfen: frischer exakter Recovery-Nachweis, Rückkehr aus degraded, nachhaltiger Rückgang von unbestätigten Records und Journalbytes ohne neue Verluste. Erfolgreiche Tests oder einzelne SQL-Treffer ersetzen keine vollständige reale 24-h-/Anlagenabnahme. Keine Wiederherstellung bereits verlorener Daten, keine zugesagten Scorepunkte.
