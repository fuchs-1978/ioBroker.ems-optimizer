# 0.17.0-alpha.200 — Zeitgewichtete Leistungs-Historie

## Anlass und Berechnung

SQL `average` mittelt gespeicherte Messpunkte. Bei ungleichmäßiger Aufzeichnung zählt ein kurzer Abschnitt mit vielen Änderungen stärker als eine lange konstante Leistung. Damit wurden unter anderem EHZ-Anteile vor dem Abzug aus der Hauslast überschätzt.

Der read-only aufgezeichnete EHZ-Verlauf vom 4. November 2026, 10:45–11:00 Uhr Europe/Berlin, enthält 35 Punkte innerhalb der Viertelstunde. Deren arithmetisches Mittel beträgt 282,428571 W. Die zeitgewichtete Leistung beträgt 54,957578 W, entsprechend rund 0,013739 kWh. [Rohpunkte und Abfragegrenzen](evidence/time-weighted-ehz-2026-11-04.json) machen diesen Unterschied reproduzierbar. Die neue Regression prüft diese Werte direkt.

Alle historischen Leistungsquellen werden aus Rohwerten mit derselben Methode auf absolute Viertelstundengrenzen gebracht: letzter gültiger Wert × seine Gültigkeitsdauer, aufsummiert und durch 900 Sekunden geteilt. Der erste Rohabruf enthält einen begrenzten Vorlauf für den Wert am Intervallanfang. W und kW sowie vorzeichenbehaftete Zählerleistungen bleiben bis zur bestehenden Verbraucherumrechnung und Gesamtlastbegrenzung erhalten. Erst danach werden alle vorhandenen Hauszähler summiert und tatsächlich enthaltene flexible Verbraucher abgezogen. Das korrigiert Produktionsprofile, Median-/Lasso-Lernbasis und die Ist-Seite des Vergleichs. Es ersetzt keine abrechnungsfähigen Energiezähler.

## Fehlende Daten und Abfragegrenzen

Ein Messpunkt wird höchstens für 1,5 × SQL `changesRelogInterval` plus fünf Sekunden gehalten, gedeckelt auf 15 Minuten. Ohne positive Angabe gelten 95 Sekunden. Beispiele: 60 Sekunden Wiederholung erlaubt höchstens 95 Sekunden, 600 Sekunden höchstens 900 Sekunden. Die aktuelle Metadateneinstellung ist eine konservative Näherung für alte Aufzeichnungen; ihre damalige Konfiguration wird nicht behauptet. Ein weiterhin periodisch aufgezeichneter, aber inhaltlich eingefrorener Sensor ist allein aus diesen Rohdaten nicht erkennbar.

NULL, nicht gute Qualität und widersprüchliche doppelte Zeitstempel unterbrechen die Abdeckung. Nur volle 900 Sekunden ergeben einen Viertelstundenwert. Bestätigte Null bleibt null, Lücken bleiben unbekannt. Es gibt keine lineare Interpolation, keinen Rückgriff auf zukünftige Werte und keine pauschale Nullauffüllung. Beide realen Stunden der Herbstumstellung bleiben unterschiedliche absolute Intervalle; die vorhandenen lokalen Tages-/DST-Regeln bleiben bestehen.

Die vorhandenen Tagesabschnitte, Cache-Überlappung, provisorischen leeren Abschnitte, Quellprüfung, 30-Sekunden-Abfragefrist und Sperre bei unbekanntem SQL-Abschluss bleiben erhalten. Rohantworten mit mindestens 10.000 Zeilen werden verworfen und in kleinere Zeitbereiche aufgeteilt, maximal 255 Anfragen je Tagesabschnitt. Erreicht bereits eine Viertelstunde das Limit, scheitert der Aufbau ausdrücklich statt aus abgeschnittenen Daten zu lernen. Der erste Aufbau kann durch die Rohdaten deutlich länger dauern; danach werden zwischengespeicherte Abschnitte wiederverwendet. Die aktuelle Echtzeitverteilung bleibt währenddessen unabhängig vom Fahrplan möglich.

Die optionale Außentemperatur behält den bisherigen SQL-Mittelwertabruf mit einem von Leistungsdaten getrennten Cache. Es werden keine SQL-Aufzeichnungseinstellungen, Geräteausgänge, Ladezeiten oder Live-Anlagenparameter durch diese Änderung geändert.

## Vergleich ohne Umschreiben der Vergangenheit

Die Quellen-Signatur bleibt unverändert, damit ausgegebene Prognosen beim Methodenwechsel nicht verloren gehen oder neu erstellt werden. Vorhandene Einträge mit allen Prognosewerten und Ausgabezeiten bleiben unverändert. Neue Einträge tragen `historyAggregation: time-weighted-hold-v1`. Alte Einträge ohne Feld sind historische Prognosen aus Messpunktmitteln.

Die Bewertung verwendet neu berechnete, zeitgewichtete Ist-Werte. `Evaluation_JSON.actualAggregation` kennzeichnet sie; jeder Tagesvergleich weist `forecastHistoryAggregation` aus. Alte MAE-/Energieergebnisse können sich dadurch ändern. Die letzten 7/14 Kalendertage und alle vier Kandidaten behalten dieselbe gemeinsame Abdeckung; ein Methodenwechsel ersetzt keine fehlenden Vergleichstage und beweist noch keine Verbesserung des Lasso-Modells.

## Prüfung

Regressionen prüfen unregelmäßige Speicherung, gemessenen EHZ-Verlauf, Null-/Qualitätsmarker, Lücken, begrenzte Randwerte, doppelte Zeitstempel, Einheiten, vollständige Viertelstunden, Sommer-/Winterzeit, volle SQL-Antworten, Tagesübergänge, Cache-Nutzung, Temperaturtrennung und den Erhalt alter Prognosen. Gesamt-, Admin-/Metadaten-, Lint-, Paket-, installierte Artefakt- und historische Vergleichsprüfungen gehören zur Freigabe. Die natürlichen Historienabdeckungen müssen nach Installation neu geprüft werden; diese Implementierung ist noch kein Live-Nachweis des neuen Aufbaus.
