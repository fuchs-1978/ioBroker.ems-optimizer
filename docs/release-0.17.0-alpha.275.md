# 0.17.0-alpha.275

Der Live-Regler zieht die laufende Ladeleistung vom Netzbezug ab. Liegt der verbleibende Haushaltsbezug oberhalb des Speicher-Totbands, sendet er am selben SunEnergy-Ausgang direkt die Entladeleistung. Bei 25 W Laden, 107 W Netzbezug und einem Netzsollwert von 0 W folgt auf GS −25 W direkt GS +82 W.

Die Warteschlange übernimmt den neuen Sollwert auch bei ausstehender Ladebestätigung. Bis zur Rückmeldung über die Entladung berücksichtigt das EMS die bisherige Ladeleistung bei der Leistungsreservierung.
