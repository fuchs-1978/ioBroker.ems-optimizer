# 0.17.0-alpha.265

Die gemeinsame Verbrauchsrechnung und die Phasenreserve verwenden dieselbe Nulltoleranz wie der Wallbox-Ausgang. Ein frischer, bestätigter go-e-Leistungswert zwischen −30 W und 0 W geht als 0 W in die Leistungsbilanz ein. Der Originalwert bleibt für die Diagnose erhalten.

Beim EQE meldete go-e am 14. November um 12:30:14 Uhr beim Anlauf kurz −10 W. Die Verbrauchsrechnung verwarf die Zuteilung, worauf das EMS zwei Sekunden später die Wallbox ausschaltete. Die folgende Ladefreigabe musste die Einschaltverzögerung erneut durchlaufen. Die Anlaufsimulation zeigt, dass die Freigabe bei −10 W und an der Grenze von −30 W erhalten bleibt.

Messwerte unter −30 W, fehlende Bestätigung, ungültige Qualität und veraltete Messwerte sperren die gemeinsame Freigabe weiterhin. Ausstehende Ladebefehle und gemessene Phasenströme gehen weiter in die Leistungsreserve ein.
