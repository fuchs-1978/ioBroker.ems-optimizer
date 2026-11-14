# 0.17.0-alpha.259

## SunEnergy-Entladung

Bei einem einzelnen Kopf hält das EMS einen bestätigten Entladeauftrag, wenn der nächste Sollwert höchstens 5 W davon abweicht und die zeitlich passende SMA-Messung im eingestellten Totband liegt. Bei einem bereits gesendeten Kleinauftrag und kurzer, geringer Einspeisung kann das EMS innerhalb der bisherigen Frist auf das Echo warten, wenn die gemessene AC-Leistung weiterhin zum vorherigen Auftrag passt und eine Haushaltsrestlast belegt ist. Nach einer größeren Laständerung folgt ein neuer Sollwert auf Basis der aktuellen Restlast. [Issue #418](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/418)

Am wirksamen Entladelimit eines einzelnen Kopfes wertet das EMS mindestens drei getrennte, frische GS/GP-Messungen über mindestens drei Sekunden aus. Wenn zwei aufeinanderfolgende Messungen eine AC-Leistung von mindestens 95 % und unter 98 % des bestätigten Auftrags zeigen und die aktuelle SMA-Messung weiter Netzbezug belegt, kann das EMS den Auftrag auf den gemessenen Wert senken. Beim Mitschnitt mit `GS = 2400 W` und `GP = 2367 → 2355 → 2333 → 2316 W` ergibt sich `GS = 2316 W`. Die Grenze gilt für den laufenden Entladevorgang. Die verbleibende Differenz steht im Ausgangsstatus. Auch eine nach Neustart übernommene Ausgangsverantwortung verwendet die aktuelle Kopfkonfiguration zur Berechnung der wirksamen Grenze. [Issue #419](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/419)

Das EMS prüft Entladefreigabe, SoC, Gerätegrenzen, Messdaten und die Haushaltsrestlast auch unmittelbar vor der Ausgabe. Der reduzierte Auftrag braucht eine eigene GS/GP-Bestätigung.

## PV-Überschuss zwischen Speicher und Auto teilen

Mit aktiver SoC-abhängiger Wallbox-Koordination kann das erste geeignete Fahrzeug mit 6 A starten, sobald der PV-Überschuss über der verfügbaren Batterieladeleistung liegt und nach Abzug der Mindestleistung fürs Auto mindestens die Hälfte der Batterieladeleistung übrig bleibt. Bei einer Ladegrenze von 2.400 W und 230 V einphasig liegt dieser Punkt bei 2.580 W. Bei 2.600 W gehen nach dem Start rund 1.380 W ans Auto und 1.220 W in den Speicher. Während der Startfreigabe stellt der Speicher die konfigurierte Startreserve vorübergehend aus seiner Ladeleistung bereit. Die Startverzögerung und die Freigaben werden wie bisher geprüft. Bei bindendem Speicherfahrplan oder am Mindest-SoC hat die volle Speicherleistung Vorrang.
