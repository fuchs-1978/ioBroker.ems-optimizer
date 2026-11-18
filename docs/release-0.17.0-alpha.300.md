# Alpha 300 – Weniger Rechenaufwand im EMS

- **48-Stunden-Fahrplan.** Das EMS prüft bei einem neuen JSON-Fahrplan einmal die Abstände der Zeitstempel. Bei einem durchgehenden Viertelstundenraster bestimmt es den aktuellen Eintrag direkt aus der Uhrzeit. Bei Lücken, Überschneidungen und als Array übergebenen Fahrplänen prüft es die Zeitstempel einzeln.
- **Datenpunktzuordnung.** Die Feldnamen der festen Zuordnungen und der drei Wallboxen werden beim Laden des Moduls einmal aufgebaut. Die Datenpunkt-IDs liest das EMS bei jeder Zuordnung aus der aktuellen Konfiguration.
- **Historische Lastprofile.** Für aufeinanderfolgende Viertelstunden desselben lokalen Kalendertags verwendet das EMS die bereits ermittelte Tagesart. Wechselt das Datum, bestimmt es Wochentag und Feiertagsstatus neu.
- **SQL-Aufzeichnung.** Der Recorder verwendet das bereits zur Größenprüfung komprimierte Paket auch zum Schreiben. Das Rücklesen prüft die Originaldatensätze wie bisher.

## Messung mit Alpha 299 als Vergleich

In neun gepaarten Läufen einer fünfminütigen Anlagensimulation sank die CPU-Zeit im Median um 4,6 %. Die Einzelpaare reichten von 9,5 % Mehrverbrauch bis 19,7 % Einsparung. Die mediane Speicherspitze des gesamten Testprozesses lag bei 218,2 MiB mit Alpha 299 und 217,6 MiB mit den vier Änderungen.

Im Vergleich mit fester Uhr und identischen Messwerten stimmten alle 404 Stellbefehle und die Leistungsspur über 300 Sekunden überein. Unter den 49.099 Zustandsaktualisierungen unterschieden sich der Versionsdatenpunkt und die in 61 Diagnose-Snapshots enthaltene Versionsnummer. Drei geprüfte SQL-Pakete mit insgesamt 40 Originaldatensätzen belegten in beiden Varianten zusammen 36.027 Nutzbytes.
