# Alpha 304 – RAM-Bedarf von Diagnose und SQL-Prüfung

Die Bedienerdiagnose verwendet zwei feste Datumsformatierer für die Zeitzone Europe/Berlin. Sie liest die PV- und Grundlastkurve je Fünf-Sekunden-Durchlauf einmal ein und verwendet sie für Prognose und Batterievorschau gemeinsam.

Bei der unabhängigen SQL-Prüfung validiert das EMS zuerst alle Zeilen des angeforderten Zeitfensters. Dann entpackt und prüft es je ein Transportpaket. Für passende Originale merkt es sich die Nachweisdaten und den ersten passenden SQL-Zeitstempel. Die Bestätigung im Journal erfolgt nach der Prüfung aller Pakete. Ein beschädigtes Paket trägt keinen Teilnachweis bei. Sitzung, Sequenz und SHA-256 des unveränderten Originaltexts müssen übereinstimmen. Die Zeitangabe `proofProcessingMs` umfasst das Entpacken, die Prüfung und die Bestätigung im Journal.

## Vergleich mit Alpha 303

Je fünf gepaarte Messungen unter Node.js 24.22.3 auf Linux, mit wechselnder Reihenfolge und einem neuen Prozess für jeden Lauf. Angegeben ist der Median des maximalen residenten Prozessspeichers (RSS). Die Diagnose verwendete einen eingefrorenen Anlagensnapshot und 192 Viertelstunden je Kurve. Der SQL-Test verwendete daraus erzeugte Voll- und Deltadatensätze, regulär gepackte SQL-Zeilen sowie einen lokalen Journal- und SQL-Ersatz.

| Messfall | Alpha 303 | Alpha 304 |
|---|---:|---:|
| 720 Diagnosezyklen, eine simulierte Stunde | 101,7 MiB | 77,1 MiB |
| 55 SQL-Abfragen mit je 2 Paketen und 20 Originalen | 58,1 MiB | 58,3 MiB |
| 8 SQL-Abfragen mit je 24 Paketen und 192 Originalen | 228,0 MiB | 111,3 MiB |

Alle 11.520 Diagnoseausgaben je Lauf waren bytegleich. Beim SQL-Vergleich stimmten die Bestätigungen für alle 1.100 bzw. 1.536 Originale und die jeweils letzten frischen Nachweise samt Zeitstempel überein. Eine getrennte Anlagensimulation mit einem von −1 bis 7,8 kW wechselnden Überschuss ergab in 360 Sekunden dieselben 457 Stellbefehle und denselben Leistungsverlauf. Die Tabelle misst die einzelnen Diagnosepfade. Den Gesamtverbrauch der installierten Instanz kann erst ein Vergleich bei ähnlicher Anlagenlast und Laufzeit zeigen.
