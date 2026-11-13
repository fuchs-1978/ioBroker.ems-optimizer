# 0.17.0-alpha.230

- Bei einem einzelnen SunEnergy-Kopf wartet das EMS bei einer kleinen Senkung des PV-Ladesollwerts innerhalb der vorhandenen Leistungstoleranz auf die ausstehende Rückmeldung. Es schreibt erst danach einen neuen Sollwert.
- Die Wartezeit ist durch die vorhandene Rückmeldefrist begrenzt. Der bisherige Auftrag muss innerhalb der Geräte-, SoC-, Hausanschluss- und Netzbetreibergrenzen liegen. Ein Nullziel, eine größere Reduktion und ein tatsächlich überschrittener PV-Sollwert während der offenen Rückmeldung lösen weiterhin den Stopp aus.
- Bereits festgehaltene Leistungsreservierungen werden nach bestätigtem Stillstand über `Devices.Battery.ConfirmPhysicalStop` zurückgesetzt. Siehe [Speicherdokumentation](alpha17-storage-thermal.md).
