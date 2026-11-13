# 0.17.0-alpha.236

- Fällt das PV-Ladeziel beim Start eines einzelnen SunEnergy-Kopfs um bis zu 200 W, kann das EMS bis zu drei Sekunden ab Auftrag auf die erste Rückmeldung warten. Das Ziel muss positiv bleiben. Freigaben, SoC-, Hausanschluss- und Netzbetreibergrenzen gelten weiterhin sofort.
- Meldet der Kopf einen gestoppten Ladeauftrag erst verspätet als aktiven Sollwert zurück, darf eine spätere frische Rückmeldung mit GS = 0 und AC-Leistung innerhalb der Nulltoleranz die Reserve freigeben. Der Nullbefehl muss vorher geschrieben worden sein. Für einen Altauftrag ohne passenden Sollwertnachweis bleibt die bisherige Rückgabe erforderlich.
