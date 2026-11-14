# 0.17.0-alpha.264

Die einphasige Ladung kann weiterlaufen, wenn go-e nach einer bestätigten PV-Erhöhung um 1 A auf den vorherigen Strom zurückfällt. Beide Rückmeldekanäle müssen den niedrigeren Wert melden. Frische Leistung und gemessene Phasenströme müssen dazu passen.

Beim EQE meldete go-e nach einem bestätigten 9-A-Auftrag wieder 8 A. Die Wallbox maß 7,9 A. Wenn das EMS in dieser Situation 7 A anfordert, sendet es den niedrigeren Wert bei aktiver Ladefreigabe. Bis beide Kanäle die Korrektur bestätigen, bleibt der bisherige höhere Strom für die Leistungsplanung reserviert.

Das EMS prüft vor der Ausgabe erneut Messwerte, Hausanschluss und Netzbetreiberbudget. Die Korrektur ist einmal pro Ladevorgang möglich. Bei ausbleibender Bestätigung greift nach der Rückmeldefrist die Schutzabschaltung.
