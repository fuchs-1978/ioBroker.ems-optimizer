# 0.17.0-alpha.92

Optionale SoC-Schaetzung fuer jede der drei Wallboxen aus tatsaechlich gemessener AC-Ladeenergie. Zwischen echten Fahrzeugmeldungen wird die nachgeladene Energie mit nutzbarer Akkukapazitaet und individuellem Wirkungsgrad in Prozent umgerechnet. Mindest-/Zielentscheidungen verwenden den wirksamen Wert, der Ausgang prueft ihn unabhaengig erneut. Originalmeldungen bleiben unveraendert; die Preisladung zieht Ladeenergie nicht doppelt ab.

Im jeweiligen Fahrzeugreiter aktivieren, echten Fahrzeug-SoC, Ladeenergiezaehler in kWh und nutzbare Kapazitaet zuordnen; Wirkungsgrad standardmaessig 90 %. Optional kann der zur Fahrzeugmeldung gehoerende echte Messzeitpunkt in Unix-Millisekunden zugeordnet werden. Standard ist aus; bestehende Mii-Skriptzuordnung wird nicht automatisch geaendert. Nicht mit einer bereits vorgeschätzten SoC-Quelle kombinieren.

Gemeldeter und geschaetzter SoC sowie Status und zusammengehoerige Basis sind getrennt sichtbar. Ein persistierter Datensatz verhindert doppeltes Zaehlen nach Neustart. Abstecken, Zaehlerreset, Quellwechsel, unplausible Spruenge oder unklare Zuordnung verwerfen die Basis; dann gilt ein gueltiger Fahrzeugwert, bis eine neue zugeordnete Meldung vorliegt. Keine Schaetzung von Fahrverbrauch. Meldung und Basis bleiben auf zwei Stunden begrenzt.

Grenzen: Wirkungsgrad ist eine Annahme. Ohne echten Messzeitpunkt bleibt die Zuordnung verspaeteter Cloud-Meldungen ungenau. Start erfordert zeitliche Zuordnung zwischen Bericht und Zaehlerstand; bei einem alten Startwert kann die Funktion bis zur naechsten Fahrzeugmeldung warten.

Validierung umfasst Energiebilanz, Wiederholungen/Neustart, zeitlich verspaetete Berichte, Reset, Abstecken/Quellwechsel, fehlerhafte/alte Werte, Energiespruenge, alle drei Fahrzeugentscheidungen, unabhaengige Zielabschaltung und unveraenderte Preisbilanz. Reale Wirkung nach Installation pruefen.
