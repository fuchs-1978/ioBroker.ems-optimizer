# 0.17.0-alpha.247

Bei aktiver PV-Speicherpriorität kann SunEnergy den PV-Fehlbetrag einer bereits ladenden Wallbox während ihrer Ausschaltverzögerung decken. Der Timer berücksichtigt weiterhin den PV-Fehlbetrag, auch wenn die gemessene Netzleistung durch die Entladung auf null fällt. Sobald die PV-Leistung wieder reicht oder die Wallbox abschaltet, endet diese Unterstützung.

Die Funktion gilt für eine laufende PV-Ladung ohne Preis- oder Pflichtladefreigabe und nutzt die bestehenden Entlade- und SoC-Grenzen.
