# 0.17.0-alpha.284

Der Warmwasser-Fahrplan verteilt die Netz-Wärmeleistung gleichmäßiger, wenn sich der günstige Nachtblock am Folgetag wiederholt. Ein gemeinsamer Planungshorizont für die Viertelstunden des Blocks hält die geplante Leistung konstant. Die Glättung setzt ein lückenloses Preisraster und ausreichende Wärmereserve und Speicherkapazität voraus.

Im nachgestellten Fahrplan aus [#449](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/449) sank die modellierte Netzspitze von 9,814 auf 4,085 kW. Wärmemenge, Endreserve und Tarifkosten des Nachtblocks blieben gleich. Die Änderung erteilt keine reale Ausgangsfreigabe.
