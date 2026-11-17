# 0.17.0-alpha.295

Im Admin unter **Batteriespeicher → Preisabhängiges Speicherladen** steht der neue Schalter **Speicherenergie für das nächste Hochtariffenster reservieren**. Er ist bei der Installation aus. Aktiviere ihn, wenn dein Anschluss nach den zeitabhängigen Netzentgelten abgerechnet wird und das passende Tarifprofil hinterlegt ist.

Beginnt das eingestellte Hochfenster um 16:30 Uhr, berechnet das EMS anhand von Hauslast, PV, aktuellem SoC und Entladeleistung, wie viel gespeicherte Energie es ab 16:30 Uhr voraussichtlich einsetzen kann. Bei gleichem Preis plant es begrenzte Energie zuerst für die Viertelstunden mit höherer erwarteter Last nach PV. Sind zum Beispiel 0,45 kWh zur Abgabe verfügbar und lautet die Prognose 450 W um 16:30 Uhr und 1.800 W um 16:45 Uhr, kann der Fahrplan die 0,45 kWh komplett für 16:45 Uhr vormerken. Die tatsächliche Entladeleistung ergibt sich aus dem gemessenen Netzbezug.

Über die Reservierung hinaus verfügbare Energie kann vorher Hauslast decken. Mindest-SoC, Prognosereserve und Vorrang der Fahrzeug-Pflichtladung gelten auch im Hochfenster. Preis-Netzladen bleibt ein eigener Schalter mit Wirtschaftlichkeitsprüfung. Fehlt ein gültiger Hochfensterplan, gelten bei ausgeschaltetem Preis-Netzladen die normalen Entladeregeln.

`Plan.PriceChargingDiagnostics_JSON` zeigt unter `battery.highTariffReserve` den Zeitraum, den erwarteten SoC zu Beginn und den voraussichtlich verbleibenden Hausbezug. `Plan.BatteryPower_48h_JSON` zeigt mit `dischargeFloorPct`, wie weit der Speicher in der jeweiligen Viertelstunde entladen darf.
