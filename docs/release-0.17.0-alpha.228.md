# 0.17.0-alpha.228

- Im Parallelbetrieb rechnet das EMS die reservierte Leistung einer Wallbox während ihrer Abschaltverzögerung in das gemeinsame Ausgabebudget ein, wenn der PV-Überschuss und die Leistungsgrenzen alle beteiligten Verbraucher abdecken.
- Dadurch kann ein anderes Fahrzeug seine Ladeleistung schon während des Nachlaufs erhöhen. Vor dem Schreibbefehl prüft der Adapter die aktuellen Messwerte, Reservierungen und Leistungsgrenzen.
