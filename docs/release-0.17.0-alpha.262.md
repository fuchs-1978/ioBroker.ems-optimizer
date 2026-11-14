# 0.17.0-alpha.262

## PV-Ladepause am SoC-Ziel

Bei aktiver SoC-abhängiger Wallbox-Koordination endet die PV-Speicherladung mit Erreichen des aktuellen Fahrplanziels. Die Wallboxen bekommen den freigewordenen Überschuss bis zu ihren eingestellten Fahrzeug-Ladezielen. Ein später höheres Ziel, etwa das der prognosebasierten Schlussladung, gibt die PV-Speicherladung wieder frei, sobald Überschuss und Gerätefreigaben vorliegen.

Die Ladepause gilt für das erreichte Ziel am lokalen Kalendertag. Ein vorübergehender SoC-Rückgang oder eine Prognoselücke öffnet dieselbe Ladestufe während dieses Tages nicht erneut. Der 48-Stunden-Fahrplan berücksichtigt die gemessene Ladepause und bildet weitere erreichte Stufen in der Simulation ab.

Die SunEnergy-Ausgabe prüft das Ziel vor einem wartenden Ladebefehl und gibt bei Erreichen 0 W aus. Die PV-Beobachtung kann bei einer begonnenen, noch unbestätigten Ladung keinen weiteren Ladeauftrag aus der abgeschlossenen Stufe halten. Tarifladung, Mindestreserve und die Entladung für Eigenverbrauch folgen ihren jeweiligen Freigaben. Beim Wiederanlauf gilt zusätzlich die SunEnergy-Ladehysterese.
