# 0.17.0-alpha.231

- Bei einem einzelnen, bereits ladenden SunEnergy-Kopf wartet das EMS bei einem Rückgang des PV-Ladesollwerts um bis zu 200 W auf die ausstehende Rückmeldung. Danach kann das EMS den niedrigeren Sollwert schreiben.
- Während der Wartezeit darf die gemessene Ladeleistung den neuen Sollwert höchstens um die bisherige Messtoleranz überschreiten. Geräte-, SoC-, Hausanschluss- und Netzbetreibergrenzen sowie Nullziel und Rückmeldefrist gelten weiterhin.
- Bereits festgehaltene Reservierungen lassen sich nach bestätigtem Stillstand über `Devices.Battery.ConfirmPhysicalStop` zurücksetzen. Siehe [Speicherdokumentation](alpha17-storage-thermal.md).
