# Alpha 313 – Teuren Netzbezug für Warmwasser vorziehen

Die Wärmeprognose verlegt den verbleibenden Netzanteil einer geplanten Warmwasserspitze in frühere Viertelstunden mit günstigerem Strom. Dafür muss der Heizstab dort bereits mit Netzstrom eingeplant sein. Die Verschiebung endet, sobald der Tank gefüllt wäre, die Heizleistung oder eine Phasengrenze erreicht wird oder die ursprüngliche Netzspitze des betrachteten Zeitraums überschritten würde. Bei einer Betreiberbegrenzung oder einer Lücke in den Tarifdaten bleibt die Verschiebung aus.

Der Fahrplan verrechnet zuerst die PV-Energie, die zuvor Autos, Hausbatterie oder Heizpuffer erhalten haben. Anschließend kann er auch den übrigen bereits eingeplanten Netzbezug für Warmwasser vorziehen. Beide Schritte prüfen die Ladung der Batteriereserve und die dafür vor Ablauf der Frist verfügbare Leistung. Zusätzlich eingekaufte Wärme passt nur so lange in den Tank, wie im ursprünglichen Verlauf Platz dafür vorhanden ist. Die PV-Zuteilung, die gesamte Wärmeenergie und der Wärmevorrat am Ende des Zeitraums bleiben erhalten.

## Vergleich für Sonntag, 22. November

Der Regressionstest bildet den relevanten Ausschnitt der Prognose vom 21. November um 22:18 Uhr nach. Die Werte sind geplante elektrische Leistungen des Warmwasser-Heizstabs.

| Zeit | Bisher | Alpha 313 | Netzanteil mit Alpha 313 |
| --- | ---: | ---: | ---: |
| 02:15 bis 05:00 Uhr | 2,89 kW | 3,55 kW | 3,55 kW |
| 13:00 bis 13:15 Uhr | 3,20 kW | 1,28 kW | 0 kW |
| 13:15 bis 13:30 Uhr | 6,48 kW | 1,21 kW | 0 kW |

Dadurch wechseln zusätzlich 1,80 kWh von 30,04 auf 23,56 ct/kWh. Das spart in diesem Fahrplan rund 0,12 €. Die kleinste prognostizierte Warmwasserreserve beträgt weiterhin 0,50 kWh. Die Einstellung für reale Netzheizung gilt unabhängig von der Prognose. Bei ausgeschalteter Preisheizung löst die prognostizierte Nachtladung keinen Heizauftrag aus.

Im vollständigen 48-Stunden-Fahrplan von 22:32 Uhr fällt die höchste Viertelstundenleistung am Netzanschluss von 5,27 auf 4,07 kW. Netzbezug (52,83 kWh), Einspeisung (1,18 kWh) und PV-Wärme (7,50 kWh) sind in beiden Rechnungen gleich. Auch die PV-Anteile der Fahrzeuge und der Batterie stimmen in allen 192 Viertelstunden überein.
