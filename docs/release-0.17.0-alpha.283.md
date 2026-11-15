# 0.17.0-alpha.283

Wenn die aktuelle Netzmessung einen eingeplanten Richtungswechsel überholt, verwirft die Ausgabe den Auftrag. Der Regler bewertet den zuletzt gesendeten GS mit dem nächsten gültigen Messwert weiter, sofern seine Leistungsreserve innerhalb der aktuellen Schutzgrenzen liegt. Diese Neuberechnung erscheint im Debug-Protokoll.

Bei ungültigen Messdaten oder einer überschrittenen Schutzgrenze fordert der Regler den Stopp an und wartet auf die Rückmeldung. Die Tests stellen den überholten Richtungswechsel in beiden Richtungen sowie einen unbestätigten Netz-Messwert und eine gesenkte Ladegrenze nach.
