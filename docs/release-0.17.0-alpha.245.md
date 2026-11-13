# 0.17.0-alpha.245

Ein einzelner SunEnergy-Kopf erhält bei sinkendem Entladeziel bis zu sechs Sekunden für die Bestätigung des laufenden Stellauftrags. Beim regulären Neustart gilt das bestehende Wartefenster von bis zu 2,5 Sekunden. Danach kann die bestätigte Nullrückmeldung den Auftrag automatisch freigeben.

Die Wartezeit setzt frische Messwerte, Freigaben und die Einhaltung der Leistungsgrenzen voraus. Einspeisung oberhalb des Speicher-Totbands beendet die Wartezeit. Fehlt jede belastbare Bestätigung des alten Auftrags, bleibt die bestehende Rückgabe erforderlich.
