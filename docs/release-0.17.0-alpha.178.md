# 0.17.0-alpha.178 – Wetterhistorie fuer spaetere Prognosemerkmale

## Beginn der Sammlung

Bei aktiviertem Lastvergleich ist die neue Option **Meteo-Prognosen fuer spaeteres Lernen archivieren** standardmaessig eingeschaltet. Nach Installation und Neustart richtet das EMS ausschliesslich fuer seinen eigenen Zustand `Debug.WeatherArchive.Snapshot_JSON` eine SQL-Aufzeichnung mit 90 Tagen Aufbewahrung ein. Bereits vorhandene Aufzeichnungen anderer Datenpunkte werden nicht geaendert. Deaktivierung beendet die Sammlung; bestehende SQL-Daten bleiben bis zur Aufbewahrungsgrenze erhalten. Es werden keine alten Vorhersagen nachtraeglich erfunden.

Der lesende Vorabcheck dieser Anlage fand Temperatur, Wind, Bewoelkung, Feuchte, Niederschlag und Sonnenscheindauer im konfigurierten Meteo-Stundenbereich. Die Sonnenscheindauer traegt dort die Einheit h. Eine direkte kurzwellige Strahlungsgroesse war nicht vorhanden. Das Archiv erfindet dafuer weder Messwerte noch eine Umrechnung aus PV-Leistung.

## Zeitbezug und Quellen

Ein SQL-Sample enthaelt bis zu 48 vorhandene Wetterstunden mit Zielzeit (`validAt`), Datumspublikation und pro Variable Wert, Quellzeitstempel und gegebenenfalls einem expliziten Fehlergrund. Erfassungszeit (`capturedAt`) und Quellenzeit sind getrennt. Der Erfassungszeitpunkt belegt, wann dieses EMS den Stand gesichert hat; er behauptet nicht den unbekannten Modell-Lauf- oder API-Ausgabezeitpunkt des Wetteranbieters. Ein Sample ist eine Vorhersageversion, nicht eine Messreihe von hour0, hour1 usw., deren Zielstunde laufend wandert.

Zusaetzlich werden verfuegbare current-Werte des gleichen Meteo-Orts gespeichert. Diese sind **aktuelle Anbieter-Schaetzungen und keine lokalen Messungen**. Ihre gemeldete Uhrzeit bleibt als Originaltext erhalten, weil der Adapter hier keinen eindeutigen UTC-Messzeitstempel liefert. Historische lokale KNX-Temperatur und Anbieter-Schaetzungen duerfen beim spaeteren Lernen nicht stillschweigend gemischt werden.

Die archivierten Variablen sind temperature_2m, wind_speed_10m, cloud_cover, relative_humidity_2m, precipitation, sunshine_duration und optional shortwave_radiation. Originaleinheiten werden aus den Quellobjekten uebernommen und geprueft. Unbekannte oder nicht unterstuetzte Einheiten, fehlende Werte, schlechte Qualitaet, unbestaetigte oder alte Daten, Zukunftspublikationen und inkohärente Zeitstaende bleiben null mit Fehlergrund. Der bestehende Lasso-Vergleich bekommt dadurch noch keine neuen Merkmale: Dies baut nur die spaetere Datenbasis auf.

## Betrieb und Grenzen

Die Sammlung laeuft nach dem Start der Aktoren asynchron. Ein Minutenabruf uebernimmt nur neue verfuegbare Staende. Fuer sequenzielle Meteo-Aktualisierungen gilt eine Wartezeit von 30 Sekunden; Datum und Wert einer Vorhersage duerfen in ihren Publikationszeiten hoechstens zwei Minuten auseinanderliegen. Identische gespeicherte Staende werden auch nach einem Neustart nicht mit einem neuen Erfassungsdatum ausgegeben. Ruecklaeufige Quellenzeit wird verworfen. Jede Zeile bleibt selbstbeschreibend; Luecken und teilweise verfuegbare Horizonte werden nicht aufgefuellt.

SQL-Optionen des eigenen Snapshot-Zustands werden nach enableHistory zurueckgelesen und verifiziert. Der Status unterscheidet Aktivierungsfehler, fehlende Daten, unveraenderte Staende und gespeicherte Wetterpakete. **SQL-Konfiguration und eine erfolgreiche Zustandsveroeffentlichung sind noch kein Nachweis jeder einzelnen Datenbankzustellung**; fuer spaetere Auswertungen ist die tatsaechliche SQL-Abdeckung zu pruefen. Bei fehlgeschlagener initialer SQL-Einrichtung Status pruefen und nach Wiederherstellung neu starten. Das Archiv verspricht keine verlustfreie Zustellung waehrend SQL-Ausfaellen.

Die eigenen JSON-Pakete sind auf 60.000 UTF-8-Bytes begrenzt. Die Datenmenge haengt von neuen Anbieterstaenden ab; bis zu 48 Stunden und die Quellmetadaten werden pro Version gespeichert. Die Aufbewahrung ist auf 90 Tage begrenzt. Der letzte Stand bleibt zusaetzlich als ioBroker-Zustand erhalten. Das Archiv verwendet eigene abbrechbare Anfragen und Adapter-Timer; Stoppen beendet Abrufe und verhindert weitere Archivschreibvorgaenge. Es vergibt keine Steuerungsfreigabe und beeinflusst weder Lastprognose noch Fahrplan oder Aktorbefehle.

Im Admin unter **History & forecast** zeigt **Status Wetterarchiv** den aktuellen Zustand. Der Datenpunkt lautet `Debug.WeatherArchive.Status`.

## Regressionen

Geprueft werden Zeitpunkt-/Einheitenerhalt, fehlende Strahlung, h-Sonnenscheindauer, Datenqualitaet und Plausibilitaet, ausschliessliche SQL-Konfiguration des eigenen Zustands, verifizierte Optionen, neue Publikationen, unveraenderte Staende bei Neustart, Aktualisierungspausen, alte Quellen, deaktivierte Konfiguration, SQL-Fehler sowie Abbruch laufender Anfragen ohne spaete Schreibvorgaenge.
