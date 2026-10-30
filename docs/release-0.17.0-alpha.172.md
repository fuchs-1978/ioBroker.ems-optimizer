# 0.17.0-alpha.172 – automatische Rueckkehr zur Fahrzeugquelle

Eine aktive manuelle SoC-Korrektur kann ohne echten Fahrzeug-Messzeitpunkt automatisch enden, wenn:

- nach der Korrektur ein gueltiger Fahrzeugwert mit neuerem Publikationszeitpunkt eintrifft und sich der Prozentwert tatsaechlich gegenueber dem zuvor beobachteten Cloud-Wert geaendert hat;
- das Fahrzeug weiterhin angeschlossen und die manuelle Ladeenergie-Kette gueltig und nicht ausgesetzt ist;
- ein gueltiger Zaehlerwert innerhalb 60 Sekunden zum Fahrzeugbericht zugeordnet werden kann;
- der neue Fahrzeug-SoC maximal einen Prozentpunkt vom zu diesem Zeitpunkt fortgeschriebenen manuellen SoC abweicht.

Beispiel: manuell 94 %, Cloud bisher 65 %. Ohne weitere Ladung darf ein neuer Cloud-Wert von 94 % die manuelle Basis abloesen. Nach Fortschreibung auf 96 % sind 95 bis 97 % plausibel. Wiederholte 65 % oder ein bereits vor der Korrektur vorhandener 94-%-Wert mit nur erneuertem Publikationszeitstempel reichen nicht.

Die Uebernahme setzt `SoCCorrectionActive=false` und vermerkt sie in `SoCCorrectionStatus`. `SoCCorrection_pct` bleibt als letzter bestaetigter Bedienwert erhalten und wird nicht als neuer Befehl wiederholt. Die weitere Ladeenergie wird ab der zugeordneten Fahrzeugmeldung gezaehlt. `-1` mit ack=false bleibt als bewusste manuelle Ruecksetzung verfuegbar.

Bei Abstecken, ausgesetzter manueller Basis, Zaehlerreset, unplausiblen Energiespruengen, Luecken, ungueltigen Quellen oder unpassendem SoC erfolgt diese Plausibilitaetsuebernahme nicht. Ein vorhandener echter Messzeitpunkt behaelt seinen bisherigen gesonderten qualifizierten Uebernahmepfad. Bestehende alpha.171-Korrekturen werden unter Verwendung des zuvor gespeicherten Cloud-Werts weiterverwendet, sofern die Messkette den Neustart gueltig ueberbrueckt.

Ohne echten Fahrzeug-Messzeitpunkt ist dies eine Plausibilitaetsentscheidung, kein Nachweis der physikalischen Messfrische.
