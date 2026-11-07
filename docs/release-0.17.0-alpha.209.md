# Alpha.209 · Einzelne Lasso-Prognoselücke interpolieren

Bei einem regulären Zieltag mit genau einer fehlenden Lasso-Viertelstunde und zwei gültigen direkten Nachbarn wird das arithmetische Mittel dieser Nachbarprognosen als eigener Kandidat vorab gespeichert. Der Tag braucht eine vollständige Median-Prognose. Mehrere Lücken sowie Lücken am Tagesanfang oder -ende bleiben offen.

`Forecast.LoadComparison.Forecast_JSON.lassoInterpolation` enthält Ausgabezeit, ersetzte Viertelstunde, Schätzwert und vollständige Kurve. Die ursprüngliche Lasso-Reihe bleibt mit ihrer Lücke sichtbar. Die Variante erhält einen separaten unveränderlichen Eintrag im Ledger. Wird die reine Prognose später vollständig, kann sie unabhängig davon vorab gespeichert werden. Frühere Tage werden nicht nachträglich ergänzt.

`Evaluation_JSON.lassoInterpolationDays` vergleicht die interpolierte Variante mit Median auf denselben gemessenen Viertelstunden. Der ersetzte Slot wird zusätzlich separat ausgewiesen. Ohne gemessenen Wert bleibt er unbekannt. Reines Lasso, 50/50, Hybrid, das 7-/14-Tage-Fenster und der produktive Fahrplan behalten ihren bisherigen Berechnungsweg.
