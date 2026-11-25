# 0.17.0-alpha.333

Am 25. November um 15:34 Uhr lud der EQV einphasig mit 6 A. Sein Ladestand lag bei 50,3 %, das eingestellte Minimum bei 60 %. Die letzte Leistungsmeldung seiner Wallbox war 31,7 Sekunden alt. Auch die beiden ruhenden Wallboxen hatten seit rund 35 Sekunden keine neue Leistung gemeldet. Bei einer eingestellten Messwertgültigkeit von 30 Sekunden entzog Alpha 332 dem EQV die Ladefreigabe. Rund 20 Sekunden nach dem Abfall auf null lag die gemessene Ladeleistung wieder bei 1,36 kW.

Alpha 333 hält in diesem Fall den zuletzt bestätigten Ladestrom und dessen Phasenzahl. Beim EQV bleiben damit mindestens 1.380 W reserviert. Während der Messlücke bleiben neue Starts, Stromerhöhungen und Phasenwechsel gesperrt. Der Ausgang prüft die SMA-Netzmessung, die Belastung aller drei Hausanschlussphasen, die Reservierungen anderer Verbraucher, die Netzbetreibergrenzen und die Fahrzeugfreigabe. Bei Überlast, unzureichenden Schutzmessungen, einem Gerätefehler oder entzogener Freigabe fordert er die Abschaltung an.

Der Regressionstest bildet den gemeinsamen Ausfall der drei Wallboxmeldungen und das zeitversetzte Eintreffen von Messung und neuer Zuteilung ab. Der EQV lädt durchgehend mit derselben Freigabe. Unter `Devices.Wallbox1.OutputStatus` zeigt das EMS während der Lücke den gehaltenen Ladestrom und die reservierte Leistung.
