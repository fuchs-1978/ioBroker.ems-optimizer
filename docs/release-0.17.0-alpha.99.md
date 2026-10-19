# 0.17.0-alpha.99 — automatische Erholung nach Abschalt-Timeout

Am 19.10.2026 um 12:08:12 MESZ führte eine ungültige gemeinsame Last-/Phasenreserve zur Abschaltung des EQV. Ein veralteter Messwert der Mii-Wallbox wurde diagnostiziert. Die AUS-Bestätigung kam verspätet; trotz später bestätigter elektrischer Ruhe blieb der EQV bis zum Adapterneustart gesperrt.

Nur die beiden Fehlerklassen fehlende AUS-Bestätigung und fehlende elektrische Abschaltbestätigung sind jetzt automatisch rücksetzbar. Erforderlich sind ein frisches ACK AUS nach dem letzten Abschaltversuch, frische elektrisch ruhige Leistung und alle drei Phasenströme nach dem AUS-Nachweis, gültiger Verbindungs-/Fehlerstatus und bei zugeordnetem Phasenmodus gültige Phasenrückmeldung. Modellierte Schattenantworten können keine Hardware-Sperre aufheben. Bestehende andere Fehler werden auch bei wiederholten Abschaltversuchen nicht durch eine rücksetzbare Timeout-Sperre ersetzt.

Das Rücksetzen sendet keinen EIN-Befehl. Ein späterer Zyklus prüft wieder Master, Fahrzeug, Bedarf, Quellen, Budget, Phasen und Schutzgrenzen samt normalem Starthandshake. Reservierungen bleiben bis zur bestätigten Abschaltung erhalten. Wiederholte Störungen führen erneut zur Schutzabschaltung; Netzwerkprobleme werden hierdurch nicht behoben. Keine Admin-Änderung erforderlich.

Regressionen decken verspätetes AUS, verspätete elektrische Ruhe, ungültige/alte/unbestätigte Quellen, Offline-Zustand, andere verriegelte Fehler, Master AUS und den regulären Wiederanlauf ohne Adapterneustart ab. Softwaretests ersetzen keine reale Betriebsabnahme.
