# Alpha 329 – Überschuss für Warmwasser bei voller Speicherladeleistung

Melden alle vorhandenen Wallboxen ein abgestecktes Fahrzeug und lädt der SunEnergy-Speicher an seiner AC-Leistungsgrenze, darf der EMS den Warmwasser-Heizstab aus der gemessenen Einspeisung starten. Das gilt auch bei einem Heizsollwert von 0 W im aktuellen Fahrplan. Läuft der Heizstab bereits, berücksichtigt die Regelung seine gemessene Leistung. Bei nachlassender Erzeugung sinkt sein Leistungsbudget. Ein neu angestecktes Fahrzeug beendet diese Überschussfreigabe.

Der Regressionstest bildet die Beobachtung vom 24. November gegen 09:30 Uhr nach. Der Speicher kann 2.400 W aufnehmen. Der geschichtete Warmwasserspeicher benötigt mindestens 900 W. Die Tabelle zeigt die eingeregelten Leistungen im Test.

| Überschuss nach Hauslast | Speicherladung | Warmwasser | Einspeisung |
|---:|---:|---:|---:|
| 4.540 W | 2.400 W | 2.100 W | 40 W |
| 3.400 W | 2.400 W | 1.000 W | 0 W |
| 3.150 W | 2.400 W | 0 W | 750 W |

Der Viertelstundenplan reserviert zuerst die Speicherladung. Den nutzbaren Rest führt er in der Warmwasser- und Netzprognose mit. Die Regelung berücksichtigt das Schichtungsminimum, die 100-W-Stufen des Heizsollwerts, die Temperaturfreigabe und die Leistungsgrenzen des Hausanschlusses.
