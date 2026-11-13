# 0.17.0-alpha.243

Im Beobachtungsmodus regelt ein einzelner SunEnergy-Kopf den laufenden Ladeauftrag anhand der gemessenen Abweichung am Netzanschlusspunkt nach. Bei 0 W Netzziel entsprechen 150 W Einspeisung einer Erhöhung um bis zu 150 W und 20 W Bezug einer Senkung um bis zu 20 W. Die nächste Korrektur wartet auf die bestätigte Speicherreaktion und eine aktuelle Netzmessung. Schrittweite, EMS-Leistungsbudget und Schutzgrenzen begrenzen den Auftrag.

Bei Batteriepriorität kann das Auto zunächst mit Mindeststrom laden. Ist die Ladegrenze des Speichers erreicht, kann die bestehende Wallbox-Regelung weiteren Überschuss in ganzen Ampere-Stufen nutzen.
