# 0.17.0-alpha.179 – zwei Kombinationen im Prognosevergleich

Der aktivierte Median-/Lasso-Vergleich ergaenzt zwei feste, passive Kandidaten:

- **50/50 (`blendW`)**: je Viertelstunde das arithmetische Mittel aus Median und Lasso.
- **Lasso-Tagesenergie mit Median-Verlauf (`hybridW`)**: alle Medianwerte mit `Summe(Lasso) / Summe(Median)` multiplizieren. So bleibt der relative Median-Tagesverlauf erhalten; seine Tagesenergie entspricht Lasso. Werte bleiben ungerundet, damit die Energie erhalten bleibt.

Keine adaptive Gewichtung und keine Auswahl anhand spaeterer Messwerte. Beide Regeln werden vor der Lieferung angewandt und zusammen mit den beiden Einzelprognosen und `ensembleVersion: 1` gespeichert. Fehlende Basiswerte bleiben unbekannt. Der Hybrid setzt einen vollstaendigen 96-Slot-Tag und eine positive Median-Summe voraus; bei ungueltiger Skalierung oder Werten ueber 100 kW bleibt der gesamte Hybrid unbekannt. Es wird weder aufgefuellt noch begrenzt. Ein unbekannter Hybrid verhindert keine gueltige Median-/Lasso-Vorabprognose.

## Vergleich und Bestandsschutz

`Forecast.LoadComparison.Forecast_JSON` und neue Eintraege in `Ledger_JSON` enthalten die zusaetzlichen Felder. `Evaluation_JSON` ergaenzt `blend` und `hybrid` mit `pairedSlots`, `maeW`, `rmseW` und `energyBiasKWh`. Die Basis sind dieselben gueltigen Median-/Lasso-Messpaare; die Paaranzahl jeder Variante bleibt sichtbar. Tagesenergieabweichungen erfordern 96 gemessene Paare. `Result` nennt die beiden Kombinationen oder ausdruecklich ihre fehlende Abdeckung.

Vorhandene Ledger-Eintraege werden nicht veraendert, neu ausgestellt oder nachtraeglich um Kombiprognosen ergaenzt. Deren Median-/Lasso-Vergleich bleibt auswertbar; Kombimetriken sind unbekannt. Die neuen Kandidaten starten erst mit einem nach Installation neu vorab gespeicherten Tag. Der Quellenvertrag wird nicht geaendert, damit bestehende Vorabprognosen erhalten bleiben.

Nach Installation trainiert der normale Startlauf wie bisher. Die Prognosen werden nach Tagesende beim folgenden erfolgreichen Historienlauf bewertet. Keine zusaetzlichen SQL-Abfragen, kein neues Trainingsmodell und keine Wirkung auf produktive Planung oder Aktorbefehle.

## Bekannte Grenze

Die bisherige Zeitumstellungsbehandlung bleibt bestehen. Insbesondere fehlen fuer den 1.11.2026 die Lasso-Wochenlags vom 25.10., weil dieser 25-Stunden-Tag vollstaendig ausgeschlossen wird. Auch die neuen Kombinationen koennen diese Luecke nicht schliessen. Eine gezielte Zeitumstellungskorrektur bleibt separat offen.

Die bisherigen acht Stunden vom 31.10. zeigen bessere Energieabdeckung durch Lasso und niedrigeren Viertelstunden-MAE beim Median. Sie beweisen weder einen stabilen Vorteil noch eine bessere Kombination oder einen Nutzen fuer Batterie-/Fahrzeugplanung. Mehrere vollstaendige, ungesehene Tage sind erforderlich; produktive Uebernahme bleibt gesondert freizugeben.

## Validierung

Regressionen pruefen die feste Mischung, Energieerhaltung und Formtreue des Hybrids, gemeinsame Messpaare, unbekannte Werte bei Luecken/Nullsumme/extremer Skalierung, Ledger-Wiederherstellung und unveraenderte Altprognosen. Der bestehende Integrationstest prueft weiterhin identische produktive Prognosen und Planereingaenge mit und ohne Vergleich.
