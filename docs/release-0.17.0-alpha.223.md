# 0.17.0-alpha.223

- Der Warmwasser-Fahrplan kann die nötige Netz-Wärme vor einem Preisanstieg gleichmäßig im günstigeren Tarifblock einplanen, auch wenn bis zum Ende des Prognosehorizonts kein weiteres Versorgungsfenster sichtbar ist.
- Dafür müssen Preise und Viertelstunden durchgängig vorliegen. Die Prüfung von Mindestreserve, freiem Speicherplatz und Heizleistung bleibt wirksam.
- Im Regressionstest werden dieselben 23,4255 kWh über sechs Stunden zum selben Tarif eingeplant. Die modellierte Netzspitze im Block sinkt von 9,745 auf 4,649 kW.
- Netz-Wärmefreigabe und reale Leistungsgrenzen werden weiterhin separat geprüft.
