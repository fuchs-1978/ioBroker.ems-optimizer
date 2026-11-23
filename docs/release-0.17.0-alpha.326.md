# Alpha 326 – Fahrzeugwechsel zur Mindestladung und Wallbox-Countdowns

Kehrt ein Fahrzeug unter seinem Mindestladestand zurück und erhält ein bereits ladendes Fahrzeug keine weitere Zuteilung, beendet das EMS dessen optionale Ladung sofort. Die neue Wallbox erhält ihre Ladefreigabe nach bestätigtem AUS der vorherigen Wallbox und frischer elektrischer Rückmeldung von Leistung und Phasenströmen. Währenddessen bleibt die bisherige Leistung reserviert. Reicht die Zuteilung für beide Fahrzeuge, können beide parallel laden.

Der Prüffall vom 23. November bildet den Wechsel vom ladenden EQV zum Mii mit 48 % bei 50 % Mindestladestand ab. Die Tests prüfen den normalen Wechsel, eine ausbleibende AUS-Rückmeldung und die parallele Ladung, wenn beide Wallboxen einen eigenen Leistungsanteil erhalten.

Das HTML-Dashboard zeigt bei aktiver Regelung die Startverzögerung, Abschaltverzögerung und Mindestlaufzeit an der jeweiligen Fahrzeugkachel. Die Zeit läuft in Minuten und Sekunden bis zum aus der bestätigten ioBroker-Messung berechneten Ende. Ein neuer Aufruf derselben Messung setzt die Uhr nicht zurück.
