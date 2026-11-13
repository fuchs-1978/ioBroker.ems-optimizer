# 0.17.0-alpha.232

- Ein einzelner SunEnergy-Kopf kann bei PV-Ladung einen niedrigeren Sollwert erhalten, wenn er den laufenden Sollwert bestätigt und bis zum Ende der Rückmeldefrist wiederholt eine stabile, niedrigere Ladeleistung meldet.
- Das EMS hält die bisherige Leistungsreserve bis zur Bestätigung des niedrigeren Sollwerts und seiner Istleistung. Für den laufenden Ladevorgang begrenzt es weitere Sollwerte auf die gemessene Ladeleistung. Bei einem Nullbefehl endet diese Begrenzung.
- Fehlende oder widersprüchliche Rückmeldungen und verletzte Leistungsgrenzen führen weiterhin zum Stopp. Bereits festgehaltene Reservierungen werden nach bestätigtem Stillstand über `Devices.Battery.ConfirmPhysicalStop` zurückgesetzt.
