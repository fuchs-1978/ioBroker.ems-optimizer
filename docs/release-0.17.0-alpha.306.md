# Alpha 306 – Mindest-SoC zur Abfahrt

Mit aktivierter Abfahrt, gültiger Uhrzeit, freigegebenem Fahrzeug und verwertbarem SoC berechnet das EMS die fehlende Energie bis zum Mindest-SoC. Es berücksichtigt nutzbare Akkukapazität, Ladeverluste, Restzeit und die eingestellten Strombegrenzungen nahe dem Ziel. Die Planung zielt auf einen Abschluss eine Viertelstunde vor Abfahrt. Bei kürzerer Restzeit fordert sie die verfügbare Leistung an. Die laufende Regelung berechnet den Bedarf mit dem aktualisierten SoC neu.

Bei paralleler Ladung erhält jede fällige Wallbox ihre Reservierung vor der Verteilung von Überschuss an das bevorzugte Auto. Im sequenziellen Betrieb hat ein Fahrzeug mit offenem Abfahrtsminimum Vorrang. Eine ausdrücklich aktivierte zeitversetzte Preisladung oberhalb der Mobilitätsreserve setzt weiterhin einen ausreichenden Fahrplan bis zur Abfahrt voraus.

Der Ausgang gleicht den Auftrag mit SoC, Mindest-SoC und Abfahrt ab. Die zusätzliche Netzfreigabe endet mit gedecktem Mindest-SoC oder aufgehobener Abfahrt. Nutzerfreigabe, Phasenrückmeldung, Stromgrenzen, Hausanschluss, Netzbetreiberlimit und bestätigte Reaktion der Wallbox gelten bei jedem Schritt. Verhindern diese Grenzen eine rechtzeitige Ladung, kann die Prognose eine verbleibende Energielücke ausweisen.

Der Regressionstest bildet einen Mii mit 32,3 kWh, 56,3 % SoC, 100 % Mindest-SoC und 90 % Ladewirkungsgrad neben einem bevorzugten EQE nach. Bei gut acht Stunden Restzeit und ohne PV startet der Fahrplan mit 9 A für den Mii und 6 A für den EQE.
