# 0.17.0-alpha.241

- Der laufende SunEnergy-Ladeschritt bleibt während der ausstehenden Rückmeldung aktiv, solange der aktuelle Leistungsrahmen ihn zulässt. Die gelernte Ladegrenze begrenzt weitere Erhöhungen.
- Bestätigt der XT500 den Sollwert bereits, während die AC-Ladeleistung noch ansteigt, speichert das EMS diese Bestätigung. Nach Neustart gibt eine frische Nullrückmeldung nach dem Nullschreiben die Reserve automatisch frei. Ein Auftrag ohne Gerätenachweis bleibt reserviert.
