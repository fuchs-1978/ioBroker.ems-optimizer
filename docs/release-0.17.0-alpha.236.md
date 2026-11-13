# 0.17.0-alpha.236

- Fällt der PV-Überschuss direkt nach einem Ladestart aus dem Stillstand, wartet das EMS bei einem einzelnen SunEnergy-Kopf bis zu sechs Sekunden nach der Ausgabe auf die erste Sollwertbestätigung. Sobald die Rückmeldung eintrifft, gilt der aktuelle PV-Sollwert. Leistungs- und Schutzgrenzen haben Vorrang.
- Trifft die Bestätigung erst während des Stopps ein, kann das EMS die Leistungsreserve nach dem Nullbefehl und einer frischen Nullrückmeldung automatisch freigeben. Fehlt der Nachweis für den früheren Ladeauftrag, bleibt die Reserve bestehen.
