# 0.17.0-alpha.232

- Ein einzelner SunEnergy-Kopf kann bei PV-Ladung einen niedrigeren Sollwert erhalten, wenn er den laufenden Sollwert bestätigt und bis zum Ende der Rückmeldefrist wiederholt eine stabile, niedrigere Ladeleistung meldet.
- Das EMS hält die bisherige Leistungsreserve bis zur Bestätigung des niedrigeren Sollwerts und seiner Istleistung. Nach bestätigter Korrektur wartet das EMS 60 Sekunden und prüft bei ausreichendem PV-Überschuss bis zu 50 W mehr. Bestätigt der Kopf den höheren Wert, kann das EMS in weiteren Schritten anheben. Bleibt die gemessene Leistung darunter, regelt das EMS erneut zurück. Bei einem Nullbefehl endet die Begrenzung.
- Fehlende oder widersprüchliche Rückmeldungen und verletzte Leistungsgrenzen führen weiterhin zum Stopp. Bereits festgehaltene Reservierungen werden nach bestätigtem Stillstand über `Devices.Battery.ConfirmPhysicalStop` zurückgesetzt.
