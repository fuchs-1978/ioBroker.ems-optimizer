# Zeitzuordnung für die täglichen Schattenauswertungen

Die Tagesberichte #80 und #86 nennen zusammenpassende Netz-/Wallbox-Messungen
unter Last als offenen Abnahmepunkt. Die gezielte Nachprüfung findet zusätzliche
Fälle, in denen die bisherige Schattenrechnung einen Zeitversatz übersieht.
Die Reproduktionen verwenden künstliche Daten; sie weisen keine Ursache eines
bestimmten historischen Ladeereignisses nach.

## Korrekturen

Ein neuer Nullwert der anderen Netzrichtung macht einen älteren positiven
Bezugs- oder Einspeisewert nicht aktuell. Die Korrektur vergleicht die
Wallbox-Zeitpunkte mit der tatsächlich positiven Netzrichtung. Sind beide
Netzrichtungen positiv, müssen ihre Zeitpunkte innerhalb der bestehenden
Zwei-Sekunden-Grenze liegen. Auch gegenüber den Wallboxen zählen dann beide
Zeitpunkte. Bestätigung, Qualität und Altersgrenzen bleiben erforderlich.

Die bisherigen Einzelprüfungen konnten zwei zeitversetzte Korrekturen von je
700 W zulassen. Jetzt wird die Summe der Beträge aller Korrekturen mit mehr als
zwei Sekunden Zeitversatz geprüft. Ab 1.000 W bleibt die gemeinsame Rechnung
unbekannt. Gegenläufige Korrekturen dürfen sich bei dieser Prüfung nicht
aufheben. Synchronisierte Korrekturen zählen nicht zu dieser Summe.
Die Größe ist ein Prüfmaß für die angewendete Lastsubstitution, kein gemessener
Netzfehler und keine garantierte physische Fehlerobergrenze.

Bei reinen Zeitfehlern darf weiterhin die vorhandene gemeinsame historische
Basis verwendet werden: höchstens 20 Sekunden alt, nur mit begrenzten
Messpaaren, maximal 100 W Wallbox-Streuung und maximal 500 W Netzabweichung.
Fehlende oder qualitativ ungültige aktuelle Quellen bleiben ungültig.
Es gibt keine Verlängerung dieser Grenzen und keine Reparatur realer
Schutz-, Phasen- oder Aktorrückmeldungen.

## Neue Diagnose im DecisionRecord

| Feld unter `response` | Bedeutung |
| --- | --- |
| `gridImportTs`, `gridExportTs` | Originalzeitpunkte der jeweils verwendeten Netzwerte |
| `gridTs` | Zeit der positiven Netzrichtung; bei zwei positiven Richtungen der frühere Zeitpunkt; bei zwei Nullen der neuere |
| `gridPairSkewMs` | Absoluter Zeitabstand zwischen Bezug und Einspeisung |
| `asynchronousCorrectionW` | Betragssumme der Wallbox-Korrekturen mit mehr als zwei Sekunden Abstand zur relevanten Netzquelle |
| `wallboxes.WallboxN.correctionW` | Vorzeichenbehaftete Differenz zwischen modellierter und realer Wallboxleistung |
| `currentTiming` | Bei historischer Zuordnung die entsprechenden Zeit-/Summenwerte der zuvor abgelehnten aktuellen Messbasis |

`currentTimingReason`, `inputTimestamp`, `inputAgeMs`, `alignment`, die
Originalwerte und die bestehende Trennung von Telemetrie- und Korrekturgültigkeit
bleiben erhalten. Eine historische Basis wird nicht als aktuelle Messung
ausgegeben. Die Änderungen betreffen die private Schattenrechnung.

## Vergleich im nächsten Tageslauf

1. Den tatsächlich installierten Commit und seine Installationszeit erfassen.
   Die Änderungen auf `main` sind kein Nachweis, dass die laufende Instanz sie
   verwendet. Sitzungen vor und nach dem Update getrennt bewerten.
2. Gültigkeit während realer Ladeblöcke je Fahrzeug ausweisen. Zusätzlich
   `current-input`, `aligned-historical-frame`, wartende Zeitzuordnung und
   ungültige Quellen getrennt zeitgewichten. Ein historisch zugeordneter Frame
   ist kein neuer aktueller Messwert. Lücken bleiben unbekannt.
3. Bei Stopps die relevanten Netz- und Wallbox-Zeitstände, Korrekturbeträge,
   Timer und Auswahl gemeinsam vergleichen. Reale Ladeenden und Modellstopps
   weiterhin getrennt zählen. Prüfen, ob die neuen Sperrgründe auftreten und ob
   gültige gemeinsame Messpaare eine Wiederaufnahme erlauben.
4. Die qualifizierte Fahrzeugübergabe bleibt ein eigener Versuch: beobachteter
   aktiver Modellspender, kontrollierter Wechselgrund, gültige Budgetbasis,
   bestätigtes AUS und elektrische Ruhe vor der nächsten Freigabe.
   `active-donor-not-observed` beim in #86 beschriebenen bereits ausgeschalteten
   Modellspender ist weiterhin eine berechtigte Ablehnung.

Die neue Softwareprüfung ersetzt weder den Tagesvergleich noch die noch
offene reale Übernahme-/Phasenabnahme. Aus den Regressionstests folgt keine
Scoreerhöhung. Das ungeklärte reale Mii-Ende und die BHKW-Quellenprüfung aus #86
werden durch diese Korrekturen nicht erklärt.
