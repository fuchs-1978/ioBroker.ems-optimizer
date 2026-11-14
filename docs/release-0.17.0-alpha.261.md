# 0.17.0-alpha.261

## Speicher und Wallbox im 48-Stunden-Fahrplan

Mit der SoC-abhängigen Wallbox-Koordination reserviert der Fahrplan PV-Leistung für das jeweils eingestellte Speicherziel. Die Voreinstellungen sind 70 % für den Vormittag, 90 % für den Nachmittag und 100 % für die Schlussladung. PV-Leistung oberhalb des aktuellen Speicherbedarfs steht den anderen Verbrauchern zur Verfügung. Die Prognose berechnet aus den verbleibenden PV-Viertelstunden, wann die Schlussladung beginnen muss. Bei geringer PV-Leistung am Nachmittag kann sie früher beginnen. Die konfigurierte Zeitreserve vor dem Ende des nutzbaren PV-Fensters fließt in die Berechnung ein.

Für die Übergabe an die Wallbox verwenden Fahrplan und Live-Regler dieselbe Leistungsberechnung. Bei 2.600 W Überschuss und 2.400 W verfügbarer Speicherleistung sind nach dem Start 1.380 W fürs Auto und 1.220 W für den Speicher möglich. Das gilt, wenn die erwartete Energie bis zum nächsten Speicherziel ausreicht und der Speicher über seinem Mindest-SoC liegt. Die Prognose gibt die hierfür je Viertelstunde erforderliche PV-Ladeleistung als `requiredPvChargeW` an die Live-Regelung weiter. Im laufenden Betrieb gelten zusätzlich die Startverzögerung, die gemessene verfügbare Leistung und die Gerätefreigaben. Der veröffentlichte Fahrplan bilanziert die Leistungen und die daraus folgende SoC-Entwicklung im Viertelstundenraster.

## Monatliche PV-Korrektur

Im Admin-Reiter **PV-Korrektur** steht pro Anlage eine Zeile mit zwölf Faktoren von Januar bis Dezember zur Verfügung. Als PV-Flächenname dient der exakte Name aus dem Prognosebaum. Der Faktor wird je Anlage auf die stündliche und viertelstündliche Leistung angewendet, bevor das EMS die Anlagenwerte addiert. 0,80 ergibt 80 % und 1,20 ergibt 120 % der ursprünglichen Prognose. Bei fehlenden oder ungültigen Faktoren verwendet das EMS 1,00. Für ein Intervall über eine Monatsgrenze zählt der lokale Monat zu Intervallbeginn.
