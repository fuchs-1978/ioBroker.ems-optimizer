# 0.17.0-alpha.238

Bei aktiviertem `BatteryPvFeedbackObservationEnabled` hält das EMS den letzten SunEnergy-PV-Ladeauftrag bei ausstehender Rückmeldung auch dann, wenn der gemessene PV-Überschuss vorübergehend ausfällt oder Netzbezug einsetzt. Der vorhandene Auftrag und seine Leistungsreserve bleiben erhalten. Die Warnung enthält Ladeauftrag, Sollwert, Istleistung und Netzleistung.

Neue Erhöhungen brauchen weiterhin eine bestätigte Rückmeldung. Messwertausfall, Schutzgrenzen und entzogene Freigaben lösen weiterhin die vorgesehene Abschaltung aus. Ein vor dem Update bereits eingeleiteter Stopp erfordert gegebenenfalls die bestehende Rückgabe.
