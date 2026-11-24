# Alpha 330 – Warmwasser bei schwankender Speicherladeleistung

Bei freien Wallboxen kann der Warmwasser-Heizstab weiterlaufen, wenn die gemessene AC-Ladeleistung des SunEnergy-Speichers kurz unter seine Leistungsgrenze fällt. Der EMS zieht bei jedem Regelschritt die noch verfügbare Ladeleistung vom Überschuss ab. Bei laufendem Heizstab zählt dessen gemessene Leistung mit, weil sie am Netzzähler bereits als Verbrauch enthalten ist. Netzbezug verringert das Wärmebudget entsprechend.

Ein ausgeschalteter Heizstab kann wieder anlaufen, wenn die gemessene Ladeleistung ihre Grenze erreicht oder der Speicher den vollen EMS-Ladeauftrag zurückmeldet und bereits messbar lädt. Für den Start muss der verbleibende Überschuss das temperaturabhängige Schichtungsminimum decken. Beim Anstecken eines Autos endet diese Wärmefreigabe.

Der Regressionstest verwendet drei Messpunkte vom 24. November 2026. Die Ladegrenze betrug 2.400 W und das Schichtungsminimum 900 W.

| Uhrzeit | Speicherladung gemessen | Einspeisung gemessen | Heizstab gemessen | Heizstab-Sollwert im Test |
|---|---:|---:|---:|---:|
| 10:06:35 | 2.375 W | 136 W | 2.476 W | 2.500 W |
| 10:10:20 | 2.155 W | 2.892 W | 0 W | 2.600 W |
| 10:14:35 | 2.340 W | 70 W | 2.568 W | 2.500 W |

Um 10:10:20 Uhr fehlten dem Speicher 245 W bis zur maximalen Ladeleistung. Von den 2.892 W Einspeisung blieben damit 2.647 W für Warmwasser verfügbar. Der EMS rundet den Heizsollwert auf 2.600 W ab. Weitere Prüffälle bilden einen Netzbezug, das Unterschreiten des Schichtungsminimums und die Rückkehr des EQV unter seinem Mindestladestand ab.
