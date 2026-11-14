# 0.17.0-alpha.267

Die vorhandene Speicheroption für den Mii unterstützt die einphasige WB0 zwischen 6 und 20 Uhr (Europe/Berlin), wenn PV-Speichervorrang und SoC-abhängige Wallbox-Koordination aktiv sind. Der Start mit 6 A braucht einen vollen, entladebereiten SunEnergy-Kopf, mindestens 900 W gemessenen Überschuss am Netzanschlusspunkt und die konfigurierte Einschaltverzögerung. Der Überschuss enthält die tatsächlich wirksame PV- und BHKW-Erzeugung.

Der Speicher ergänzt die nach dem Start gemessene Lücke mit höchstens 500 W. Liegt der Bedarf drei aufeinanderfolgende frische Netzmessungen darüber oder erreicht der niedrigste Pack 90 % SoC beziehungsweise eine höhere wirksame Untergrenze, endet die Speicherhilfe. Bei sinkendem Überschuss schaltet das EMS die freiwillige Autoladung ohne Mindestlaufzeit und Ausschaltverzögerung ab. Reicht der Überschuss allein für den Mindeststrom, kann die normale PV-Ladung weiterlaufen.

Nach bestätigtem AUS und gemessener elektrischer Ruhe darf der Speicher dieselbe Ladegrenze wieder erreichen. Die Freigabe gilt, sobald der Speicher den Mii nachweislich unterstützt hat. Der Nachladeauftrag folgt dem gemessenen Überschuss und der SunEnergy-Ladehysterese. Sobald die Ladegrenze wieder erreicht ist, kann ein neuer Zyklus starten.

Die physische Anschluss- und Netzbetreiberbegrenzung sowie Pflichtladung, manuell angeforderter Mindeststrom, Preisladung und zwingender Wärmebedarf gelten weiter. Die Nachtlogik für BHKW-Überschuss verwendet ihr bisheriges Zeitfenster und SoC-Band.
