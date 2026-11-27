# Alpha 343 – EQV lädt bei unterbrochener Speicherrückmeldung weiter

Meldet sich ein SunEnergy-Kopf offline oder bleibt seine Leistungsmessung aus, prüft das EMS eine bereits bestätigte Ladung am Netzverknüpfungspunkt. Solange Netzzähler, Phasenmessungen, Wallbox und Freigaben den bisherigen Ladestrom zulassen, bleibt die Wallbox auf derselben Stromstärke und Phasenzahl. Das gilt auch bei vorübergehendem Netzbezug. Während der Messlücke gibt das EMS keine neue Ladung und keine Leistungserhöhung frei.

Das EMS berücksichtigt ausstehende Leistungsänderungen anderer Verbraucher und die mögliche Leistungsänderung des ausgefallenen Speicherkopfs auf seiner Anschlussphase. Fehlt die Phasenzuordnung, reserviert es diese Leistung vorsorglich auf jeder Phase. Ein aktiver Hausanschlussschutz, eine zu knappe Phasenreserve, der Entzug der Ladefreigabe oder fehlende Schutzmesswerte beenden die Ladung.

Im Anlagentest lädt der EQV einphasig mit 6 A durch eine Speicherstörung. Dabei wechselt der Netzfluss zeitweise von Einspeisung auf Bezug. Nach Rückkehr der Speicherdaten übernimmt die reguläre PV-Regelung ohne neuen Wallboxstart.
