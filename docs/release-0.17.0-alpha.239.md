# 0.17.0-alpha.239

Mit aktivem `BatteryPvFeedbackObservationEnabled` kann ein SunEnergy-Kopf nach bestätigtem Sollwert und bestätigter AC-Ladeleistung sofort über die gelernte Ladegrenze hinaus nachregeln. Der neue Ladeauftrag ergibt sich aus der gemessenen Ladeleistung und der aktuellen Einspeisung. Die konfigurierte Schrittweite, das EMS-Ladeziel und die Schutzgrenzen begrenzen die Erhöhung.

Der reguläre 50-W-Prüfschritt bleibt für den Betrieb ohne Beobachtungsmodus und für Fälle ohne frische bestätigte Einspeisung verfügbar.
