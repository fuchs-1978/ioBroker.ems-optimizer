# Alpha 328 – Durchgehende PV-Ladung vor dem nächsten Speicherziel

Der gemeinsame Fahrplan für SunEnergy und Wallboxen hält eine laufende einphasige PV-Ladung auf Mindeststrom, wenn die PV den Ladestrom deckt und der Speicher seine verschobene Ladung aus späterer Einspeisung innerhalb derselben Speicherstufe nachholen kann. Für jede verschobene Wattstunde reserviert der Planer Platz und Leistung in den späteren Viertelstunden. Erst danach verwendet er den verbleibenden Überschuss für weitere Ampere-Schritte. Bei einer Neuberechnung im laufenden Intervall zählt die verbleibende Ladezeit. Der Planer prüft dabei die Ausgangsübernahme und die gemessene Fahrzeugleistung.

Der Regressionstest verwendet die EQV-Prognose vom 24. November 2026, Stand 07:47 Uhr. Um 10:15 Uhr stehen nach Abzug der Hauslast 2.952 W zur Verfügung.

| Prognose um 10:15 Uhr | Alpha 327 | Alpha 328 |
|---|---:|---:|
| EQV | 0 W | 1.380 W (6 A) |
| Speicherladung | 1.958 W | 1.572 W |
| Einspeisung | 994 W | 0 W |

Die verschobene Speicherladung beträgt in dieser Viertelstunde rund 97 Wh. Ein zusätzlicher Ampere-Schritt im vorherigen Intervall macht weitere 55 Wh Speicherkapazität frei. Die Prognose weist zwischen 10:30 und 11:30 Uhr nacheinander 121, 158, 180 und 148 W der Speicherladung zu. Der Speicher erreicht im Test sein Vormittagsziel von 70 % bis 11:30 Uhr.
