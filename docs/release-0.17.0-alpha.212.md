# 0.17.0-alpha.212

Warmwasser- und Heizpuffer-Heizstab haben im Admin jeweils einen Schalter für den Notbetrieb, einen separaten Temperaturfühler und eine Einschaltschwelle. Beide Schalter sind standardmäßig aus, beide Schwellen stehen auf 0 °C. Die Option **Heizstab nur im Notbetrieb einsetzen** nimmt den jeweiligen Heizstab aus der regulären Heizplanung und PV-Überschussregelung.

Bei einer Schwelle von 30 °C startet der Notbetrieb unter 30 °C und endet ab 32 °C. Die Regelung braucht einen aktuellen, bestätigten Messwert. Der Notbetrieb kann auch ohne PV-Überschuss und unabhängig vom Strompreis aus dem Netz heizen. Gerätefreigaben, thermische Grenzen, Hausanschlussschutz und aktive Netzbetreiberlimits gelten weiter. Der Heizpuffer bleibt im Kühlbetrieb gesperrt. Während des Notbetriebs pausiert die Regelung Wallboxen und Batteriesollwert. Bei gleichzeitiger Anforderung erhält Warmwasser den ersten Anteil am gemeinsamen Leistungsbudget.
