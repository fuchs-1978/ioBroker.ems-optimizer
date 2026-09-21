# Eigene EMS-Diagnose ab 0.17.0-alpha.16

Die Diagnose befindet sich in den ioBroker-Objekten unter
`ems-optimizer.0.Debug`. Sie ist standardmäßig eingeschaltet und benötigt weder
den globalen Adapter-Loglevel „debug“ noch zusätzliche SQL-Aufzeichnung.
Sie beobachtet nur; Freigaben, Schutzgrenzen, Stellbefehle und Regeltimer
bleiben unverändert. Auch im Beobachterbetrieb können Daten gesammelt werden.

## Objekte

Alle folgenden Namen sind relativ zu `ems-optimizer.0.Debug`.

| Objekt | Inhalt |
| --- | --- |
| `Summary` | Übersicht über aktuellen EMS-Zustand und Freigaben |
| `Wallbox0.Summary`, `Wallbox1.Summary`, `Wallbox2.Summary` | Klartext zu Status, Warten oder Sperrgrund der jeweiligen Wallbox |
| `EHZ.Summary` | Klartext zu Leistung und Regel-/Sperrgrund des Trinkwasser-EHZ |
| `Snapshot_JSON` | Aktuelle Sicht auf Freigaben, Planung, Soll-/Istleistung, SoC, Phasen, Timer und relevante Rückmeldungen |
| `Events_JSON` | Letzte 100 Ereignisse, chronologisch; ältere Einträge werden verdrängt |
| `PowerTrace_JSON` | Bis zu 120 Leistungsmesspunkte im Abstand von 10 Sekunden: ungefähr 20 Minuten bei durchgehendem Betrieb |
| `LastEvent` | Letztes aufgezeichnetes Ereignis im Klartext |
| `LastUpdate` | Zeitstempel der letzten Diagnoseaktualisierung |
| `EventCount` | Gesamtzahl der Ereignisse seit dem letzten Leeren; gespeichert bleiben höchstens die letzten 100 |
| `Enabled` | Schreibbar: `false` pausiert die Aufzeichnung, `true` setzt sie fort |
| `Clear` | Taster: einmal `true` leert Ereignis- und Leistungsverlauf; wird automatisch zurückgesetzt |

## Was die Diagnose zeigt

Der aktuelle Snapshot wird etwa alle fünf Sekunden erneuert. Er führt die
verteilten bisherigen Diagnoseobjekte zusammen: ausgewählte Wallbox,
Haupt-/Gerätefreigaben, Daten-/Fahrplangültigkeit, Netzbezug bzw. Einspeisung,
zugeteilte und reale Leistung, Start-/Mindestlauf-/Ausschaltzeiten,
SoC-Grenzen, Phasen sowie ausstehende Wallbox-Rückmeldungen.

Wichtige Zustandswechsel werden getrennt vom regelmäßig abgetasteten
Leistungsverlauf gespeichert. Laufende Sekunden- oder Wattänderungen sollen
Start-/Stopp-/Fehlermeldungen nicht aus der Ereignisliste verdrängen.
Die zuletzt erfolgreich gespeicherten Verläufe werden bei einem normalen
Adapterneustart wieder eingelesen. Zeitstempel und Sitzungskennung helfen,
alte Ereignisse vom neuen Start zu unterscheiden.

Fehlende Messwerte werden nicht als gemessene Null dargestellt. Verfügbare
Rückmeldungen enthalten auch Bestätigungs-/Qualitäts- und Altersinformationen.
Ein angezeigter Rohwert ist deshalb nicht automatisch ein gültiger Messwert.
Die bestehende Freigabe-/Schutzprüfung bleibt maßgeblich.

Wallbox-Zielstrom, ausstehender Amperebefehl und bestätigter Ausgangsstrom sind
unterschiedliche Größen. Beim EHZ ist ein abgeschlossener Schreibauftrag keine
Bestätigung, dass die gemessene Heizleistung bereits null ist. Deshalb immer
Soll, Ist, Rückmeldung und Eigentums-/Übergabestatus gemeinsam betrachten.

## Für den nächsten Test

1. Erst zum begleiteten Test auf die neue Version wechseln; konkurrierende
   Stellskripte vor dem ersten Adapterstart stoppen, wie im Regelungstestplan.
2. In `Debug.Enabled` den Wert `true` kontrollieren. Bei Bedarf unmittelbar vor
   dem Test mit `Debug.Clear=true` eine übersichtliche neue Aufzeichnung beginnen.
3. Bei einem unerwarteten Verhalten die Uhrzeit notieren und möglichst sofort
   `Snapshot_JSON`, `Events_JSON` und `PowerTrace_JSON` kopieren. Zusätzlich hilft
   der Klartext der betroffenen Wallbox bzw. des EHZ.

Die JSON-Inhalte können direkt als Text zur Fehlersuche weitergegeben werden.
Sie enthalten eine gezielte technische Auswahl, keinen vollständigen
Adapterkonfigurationsexport. Vor öffentlichem Teilen trotzdem prüfen: SoC,
Zeitstempel und Energiedaten können Rückschlüsse auf Nutzung zulassen.

## Grenzen

Dies ist ein begrenzter Diagnoserekorder, kein lückenloses Langzeitarchiv und
kein zusätzlicher Schutzregler. Sehr kurze Leistungsspitzen zwischen den
Abtastungen können fehlen. Bei Prozessabsturz oder nicht erreichbarer Datenbank
können noch nicht gespeicherte Einträge verloren gehen. Das Abschalten oder
Leeren der Diagnose schaltet keine Geräte aus und bestätigt keine sichere
Rückgabe an andere Skripte.
