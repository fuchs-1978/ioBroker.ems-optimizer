# EHZ-Temperaturdiagnose ab alpha.58

## Problem und Verhalten

Ein unveränderter, zuletzt gültiger Temperaturwert ist kein aktueller Messnachweis.
Am 09.10.2026 blieb eine plausible Speichertemperatur längere Zeit ohne erneuerte
Quellenzeit. Der vorhandene Schutz sperrte den EHZ, die Geräteanzeige gab die
unbekannte Temperatur jedoch als 0 °C aus. Auch unbekannter Durchschnitt und
thermische Restkapazität erschienen als numerische Nullwerte.

Ab alpha.58 bleibt eine unbekannte Temperatur `null`. Eine bestätigte, frische
und plausible Messung von genau 0 °C bleibt ein gültiger Nullwert. Frische wird
aus `ts`, nicht aus `lc`, berechnet: Eine echte erneute Bestätigung desselben
Temperaturwerts ist zulässig, auch wenn die letzte Wertänderung lange zurückliegt.
Der Adapter schreibt oder erneuert keine fremden Sensorzustände.

## Diagnoseobjekte

- `Devices.MyPV_DHW.TemperatureValid`: alle vier Speicherschichten und die
  Ausgangstemperatur sind nach dem bestehenden Quellenvertrag gültig.
- `Devices.MyPV_DHW.TemperatureSources_JSON`: strukturierte Bewertung der fünf
  Eingänge mit Quelle, Rohwert, gültigem Celsiuswert oder `null`, Quellenzeit,
  letzter Wertänderung, Prüfzeit, Alter, maximalem Alter, ACK, Qualität und Grund.
- `Devices.MyPV_DHW.Status`: nennt bei ungültiger Temperatur den betroffenen
  Eingang. Die verfügbaren anderen Temperaturen bleiben sichtbar.
- Durchschnitt und Restkapazität bleiben unbekannt, soweit ihre erforderlichen
  Eingänge oder die Temperaturkonfiguration nicht bewertbar sind.

Der DebugRecorder übernimmt die Quellenbewertung als begrenztes JSON-Objekt,
ohne die übliche 600-Zeichen-Kürzung für Statustexte. Die produktiven
DecisionRecords erhalten unbekannte Werte und die vollständigen fünf
Quellenbewertungen auch nach Vollsnapshot-/Delta-Replay. Das Feld ersetzt keine
historische Quelle: Prüfzeit und Quellenzeit bleiben getrennt.

Reine Altersfortschreibung wird höchstens alle 60 Sekunden publiziert; echte
Quellen-, Qualitäts- und Gültigkeitswechsel sofort. Die Temperaturprüfung und
Schutzreaktion laufen weiterhin im bestehenden Regelzyklus.

## Bestehende Schutzverträge

Die Änderung lockert keine Frischegrenze, Thermosperre, Temperaturkennlinie,
Verbindungsprüfung, Hausanschluss-/§14a-Grenze oder Wallboxtimer. Der allgemeine
Zahlenleser für Leistungs-/Stromquellen bleibt unverändert. Ungültige
Temperaturdaten ergeben weiterhin keine Heizfreigabe und keinen sicheren
positiven Sollwert. Die produktive Installation wird nicht automatisch ausgeführt.

## Regressionen und nächste Betriebsprüfung

Softwareprüfungen decken fehlende Zustände, `null`, veraltete und zukünftige
Zeitstempel, ACK=false, schlechte Qualität, unplausible Temperaturen, gültige
0 °C und konstante Werte mit erneuertem `ts` bei altem `lc` ab. Die
Produktivaufzeichnung wird einschließlich einer Quellenbewertung über 600
Zeichen verlustfrei rekonstruiert.

Nach einer manuellen Installation prüfen:

1. Version in Installationsobjekt und `System.Version` stimmt überein.
2. Sensoren aktualisieren ihre Original-`ts` tatsächlich im konfigurierten
   Intervall; ein Alias oder erneuter Cache-Schreibzugriff ersetzt dies nicht.
3. `TemperatureValid`, Freigabe und Quellenbewertung stimmen mit den realen
   ACK-/Qualitäts-/Alterswerten überein. Keine Störung künstlich auslösen.
4. Beim nächsten natürlichen Quellenfehler bleibt der Rohwert in der Diagnose
   erhalten, der gültige Temperaturwert wird `null`; Ursache, Freigabe,
   Stellbefehl und tatsächliche Leistung werden zeitlich getrennt ausgewertet.
5. KNX-Raumtemperaturen/Taupunkte für die spätere WP-Kühlung erfüllen ihren
   eigenen 120-s-Vertrag. Eine eingestellte Minutenmeldung ist erst belegt,
   wenn alle ausgewählten Originalquellen passend bestätigt werden.

Die am 09.10.2026 geprüften Shelly-Bestätigungen lagen etwa 60 Sekunden
auseinander. Die anschließenden KNX-Stichproben bestätigten noch nicht bei
allen ausgewählten Quellen eine Minutenmeldung. Die WP blieb passiv. Dies sind
datierte Betriebsbefunde, keine nachträgliche Abnahme oder zugesagten Scorepunkte.
