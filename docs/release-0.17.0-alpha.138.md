# 0.17.0-alpha.138 – Heizstab-Schichtungsminimum in der Diagnose erklären

## Untersuchte Auffälligkeit

Die Exportmarkierung vom 24.10.2026, 15:48:00–15:49:45 Uhr (Europe/Berlin), wurde anhand eines begrenzten SQL-Fensters von 15:47:50–15:49:50 untersucht. Der erste Teil enthielt Rückspeisung von ungefähr 0,7–0,9 kW, keine ladende Wallbox und ein Heizstabziel von 0 W. Die gespeicherten Temperaturen lagen oben bei 68,4 °C, unten bei 53,2–53,3 °C. Der bestehende Controller verwirft bei mehr als 15 K Schichtung Heizbudgets unter 900 W. Bei geringerem Temperaturabstand und oben über 35 °C gilt weiterhin die bestehende 500-W-Grenze.

339 rekonstruierte Produktionssnapshots reichen von 15:48:00.176 bis 15:49:46.951; der anfängliche Vorlauf ohne vollständige Deltabasis bleibt unbekannt. Um 15:49:44.011 wurde bei etwa 1048,6 W Rückspeisung ein 1000-W-Heizbudget zugeteilt, später im Fenster ein 1000-W-Befehl sichtbar. Das Fenster enthält noch keinen bestätigten elektrischen Heizanstieg. Die 200-W-Exportmarkierung bezeichnet eine Untersuchungsschwelle, nicht automatisch vermeidbare Energie oder einen Fehler. Der Fall ist von der EQE-Antwortverzögerung in PR246 verschieden.

## Korrektur der Diagnose

`Devices.MyPV_DHW.MinimumAdmissionPower_W` veröffentlicht die Mindestleistung aus derselben Funktion, welche die bestehende Schichtungsregel anwendet. Bei unbekannten Temperaturwerten bleibt sie null; null ist kein Nachweis einer Mindestleistung von 0 W. Der Wert ist keine Freigabe: Temperatur-, Bedarfs-, Leistungs-, Quellen- und Schutzprüfungen bleiben erforderlich.

Bei gültiger Temperaturbewertung, eigener NVP-Feinregelung und positivem Überschuss unter dieser Mindestleistung erklärt der bisher generische Nullbudgetstatus jetzt den konkreten Grund. Die Ermittlung nutzt die zurückgewinnbare eigene Istleistung minus NVP-Regelfehler; das verändert keinen Befehl und gibt keine Fremdreservierung frei.

DecisionRecord-Snapshots enthalten die Mindestleistung. Die kompakten Episoden ergänzen `contextStart.ehzAdmission` und `contextEnd.ehzAdmission` mit Mindestleistung, Freigabe, Temperaturmaximum und oberer/unterer Temperatur. Das sind Randbeobachtungen, kein durchgehender Beweis für alle Zwischenzeitpunkte oder andere Verbraucher. Alte Episoden bleiben unverändert, fehlende Felder unbekannt. Keine rückwirkende automatische Klassifikation, keine Unterdrückung von Exportepisoden und keine Änderung von Energieintegralen oder Schutzeinstellungen.

Die Regression prüft die bekannte Schichtung, 500-/900-W-Schwellen und unbekannte Temperaturen, den erklärten Nullauftrag sowie Erhalt des Exportereignisses mit Kontext. Die Verbesserung verhindert unnötige erneute SQL-Grundanalysen; sie behauptet keinen behobenen Anlagenfehler für ein korrektes Warten.
