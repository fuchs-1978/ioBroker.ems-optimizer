# 0.17.0-alpha.234

- Wenn der PV-Überschuss vorübergehend sinkt, senkt das EMS die Ladeleistung. Die aus der Geräterückmeldung gelernte Obergrenze und der Zeitpunkt der nächsten Leistungsprobe bleiben dabei erhalten.
- Sobald der PV-Überschuss zurückkehrt, regelt der XT500 in den üblichen Schritten bis zur gelernten Grenze hoch. Weitere Leistungsproben und die Netz-, Anschluss- und Gerätegrenzen gelten weiterhin.
- Kleine PV-bedingte Sollwertsenkungen innerhalb der Messtoleranz lösen bei bestätigter Ladeleistung keinen neuen Stellauftrag aus. Größere Senkungen und Leistungsgrenzen werden sofort berücksichtigt.
