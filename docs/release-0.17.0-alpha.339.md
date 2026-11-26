# 0.17.0-alpha.339

## Speicherbedarf von SQL-Historie und Diagnose

Beim Einlesen dichter Leistungsdaten übernimmt das EMS jede vollständige SQL-Teilantwort in einen gemeinsamen Zeitstempelindex. Eine Antwort am Abfragelimit wird verworfen und ihr Zeitraum aufgeteilt. Beim Aufbau der mehrtägigen Historie kann das EMS neue, chronologisch anschließende Viertelstunden direkt anhängen. Für Korrekturen in zurückliegenden Zeiträumen ersetzt es die betroffenen Werte und führt doppelte Zeitstempel zusammen.

Beim Aufzeichnen der Diagnose vergleicht der Encoder die Felder zweier aufeinanderfolgender Datensätze in einem Durchgang. Er kopiert einen Feldpfad, wenn er ihn für eine Änderung benötigt. Das Wörterbuch für Altersfelder baut er auf, wenn sich ein entsprechender Zahlenwert ändert.

## Vergleich mit Alpha 338

Sieben gepaarte Läufe je Messfall unter Linux mit Node.js 24.22.3. Jede Version lief pro Messung in einem frischen Prozess, die Startreihenfolge wechselte. Die Tabelle zeigt die Mediane. RSS bezeichnet den maximal gleichzeitig residenten Prozessspeicher. Die letzte Spalte misst, wie viel Speicher V8 über den gesamten Durchlauf belegt hat, einschließlich zwischenzeitlich wieder freigegebener Objekte.

| Messfall | Spitzen-RSS 338 | Spitzen-RSS 339 | Kumulierte V8-Allokationen 338 → 339 |
|---|---:|---:|---:|
| Ein Tag Leistungsdaten im Minutentakt, eine SQL-Abfrage | 41,1 MiB | 40,8 MiB | 1,56 → 1,17 MiB |
| Ein Tag Leistungsdaten im Sekundentakt, 31 SQL-Abfragen einschließlich verworfener Teilantworten | 96,3 MiB | 72,6 MiB | 83,7 → 52,0 MiB |
| Aufbau des Verlaufs einer Quelle aus 84 Tagesantworten mit je 96 Viertelstunden | 58,5 MiB | 41,7 MiB | 79,4 → 2,47 MiB |
| 816 Diagnoseaufzeichnungen aus der Wiedergabe von 68 aufeinanderfolgenden Betriebsdatensätzen | 136,6 MiB | 134,1 MiB | 2.924 → 1.395 MiB |

Die beiden SQL-Tests nutzten generierte Leistungswerte und die Abfragegrenze von 10.000 Rohwerten. Im 84-Tage-Test lagen die fertigen Viertelstunden bereits vor. Beim Diagnosetest wurde dieselbe Folge zwölfmal mit einem jeweils neu gestarteten Encoder verarbeitet. Der SHA-256-Vergleich ergab in beiden Versionen identische Viertelstunden, Cachewerte und serialisierte Diagnosedatensätze. Die RSS-Werte beschreiben die jeweiligen Testprozesse. Der Gesamtverbrauch einer ioBroker-Instanz hängt zusätzlich unter anderem von konfigurierten Quellen, geladenen Daten und Laufzeit ab.
