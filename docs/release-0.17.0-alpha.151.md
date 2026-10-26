# 0.17.0-alpha.151 – schnelleres Nachregeln bei Stromversatz

Bei einer bleibenden Differenz zwischen Vorgabe und Fahrzeugaufnahme kann ein weiterer 1-A-Schritt das PV-Budget sinnvoll nutzen. Die vorhandene Qualifikation nach zehn Sekunden anhaltender Einspeisung wurde beim gemessenen Budgetpfad bisher durch eine zweite Bedingung bis zum vollen Antworttimeout verzoegert.

Beide Pfade verwenden jetzt dieselbe qualifizierte Frist. Voraussetzung bleiben frische Messungen nach dem Befehl und der Qualifikationsfrist, bestaetigte Stromvorgabe, ausreichender Ueberschuss, gemeinsame Zuteilung und alle harten Reserven. Maximal zwei Versuche ohne messbare Antwort, kein unbeschraenktes Hochlaufen. Ein echter Strom- und Leistungsanstieg setzt das Versuchskontingent zurueck; ein konstanter Abstand innerhalb der bestehenden Toleranz verhindert diesen Nachweis nicht.

Regression: 7,8 A bei Vorgabe 10 A, 500 W Export, Freigabe eines gemessen finanzierten 11-A-Versuchs nach zwoelf Sekunden statt 45 Sekunden. Anschliessend bestaetigen 8,8 A und 1,98 kW den Anstieg. Gegenproben: zu wenig Export, fehlender ACK, alte Messung, harte Stromgrenze und erschoepfte Versuche. Softwaretests ersetzen keine reale Folgeabnahme.
