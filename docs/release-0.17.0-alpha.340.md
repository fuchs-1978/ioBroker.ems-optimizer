# 0.17.0-alpha.340

## PV-Überschuss nach erreichtem Speicherziel

Der gemeinsame Fahrplan für SunEnergy-Speicher und Wallboxen berücksichtigt ein am selben Tag bereits erreichtes Speicherziel auch dann, wenn der SoC durch die Hausversorgung wieder gesunken ist. Haus, Warmwasser und die eingeplanten Ladestufen der Fahrzeuge bekommen ihre Leistung. Für den Speicher kann der Planer anschließend den noch verfügbaren PV-Überschuss bis zur zulässigen Ladeleistung und SoC-Obergrenze einplanen. Die Priorität der nächsten Speicherstufe gilt ab ihrem regulären Beginn.

## Vergleich mit dem Fahrplan vom 27. November

Beim Tageswechsel lag der Speicher bei 75 % und hatte das Vormittagsziel von 70 % erreicht. In der Planung von 07:17 Uhr sank sein SoC bis zum Vormittag auf rund 43 %. Der EQV benötigt für die kleinste Ladestufe 1.380 W. Das Replay mit denselben PV- und Grundlastwerten ergab folgende Viertelstunden.

| Uhrzeit | Überschuss nach Grundlast | EQV in beiden Versionen | Speicherladung in 340 | Einspeisung 339 → 340 |
|---|---:|---:|---:|---:|
| 09:45 Uhr | 992 W | 0 W | 992 W | 992 → 0 W |
| 10:00 Uhr | 1.536 W | 1.380 W | 156 W | 156 → 0 W |
| 12:15 Uhr | 1.331 W | 0 W | 1.331 W | 1.331 → 0 W |
| 12:30 Uhr | 1.837 W | 1.610 W | 227 W | 227 → 0 W |
| 12:45 Uhr | 2.048 W | 0 W | 2.048 W | 0 → 0 W |

Die geplante Einspeisung für den restlichen Freitag sank im Replay von 1,088 auf 0 kWh. Das Ergebnis gilt für diese Eingangsprognose. Ein weiterer Test bildet ab, wie eine erst innerhalb der Simulation erreichte Stufe nach einer Entladung behandelt wird und wie der Planer beim nächsten lokalen Tageswechsel wieder mit dem Ziel des neuen Tages beginnt.
