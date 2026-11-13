# 0.17.0-alpha.250

Ein einzelner SunEnergy-Kopf kann auch bei der Haushaltsentladung einen bereits bestätigten Entladeauftrag direkt reduzieren, während die AC-Leistung noch nachläuft. Im nachgestellten Livefall meldete der Speicher 547 W Soll und 369 W Ist. Das EMS sendet bei gesunkenem Bedarf direkt den neuen Sollwert von 432 W.

Die Korrektur setzt eine frische Sollwertbestätigung, eine gültige Netzleistungsmessung und ein zulässiges Entladebudget voraus. Für ein Nullziel, einen Richtungswechsel oder eine abgelaufene Rückmeldefrist bleibt die Rückgabe über 0 W wirksam. Der Regeltakt bleibt bei einer Sekunde.
