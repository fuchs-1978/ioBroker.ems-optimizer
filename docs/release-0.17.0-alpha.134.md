# 0.17.0-alpha.134 – Ladung beim Telemetrie-Wiederanlauf halten

Beobachtet am 24.10.2026 um 10:51:30 Europe/Berlin: Der Mii wurde nach einer kurzen Wallbox-Messlücke trotz bereits aktiver SMA-überwachter Haltefunktion gestoppt. Die Parallelverteilung hatte den rund 35 Sekunden alten eigenen Leistungsmesswert zurückgewiesen. Eine frische Wallboxmeldung kam vor der nächsten gültigen Zuteilung an; die Haltefunktion wechselte zu früh in den normalen Pfad und dieser stoppte wegen der noch ungültigen Zuteilung.

Die neue Version hält ausschließlich eine zuvor bestätigte, unveränderte Ladung über diese kurze Wiederanlaufkante. Die alte Ablehnung muss frisch, bestätigt und eindeutig allein durch den veralteten eigenen Wallbox-Leistungsmesswert begründet sein. Der normale Zuteilungs-TTL begrenzt den Übergang. Fremde Quellenfehler, gemischte/fehlende Diagnosen, ungültige Qualität, unbestätigte Werte und abgelaufene Zuteilungen qualifizieren nicht.

Es wird kein zusätzlicher EIN-/Strom-/Phasenbefehl ausgegeben. Die volle frühere Leistungsreserve bleibt erhalten; historische Messwerte werden nicht als frisch umgeschrieben. Sämtliche vorhandenen Haltebedingungen einschließlich frischer SMA-/Hausanschlussmessungen, Freigaben, SoC, Stromgrenzen, Peer-/Heizlastreserven und Betreibergrenzen werden erneut geprüft. Aktive/unklare groupNet-Grenzen werden nicht umgangen. Nach gültiger neuer Zuteilung kehrt der normale Regler zurück.

Regression: tatsächlicher Parallelverteiler und Ausgangssteuerung mit versetzten Geräte-/Verteilertakten reproduzieren den Abbruch vor dem Fix und halten danach die bestätigte Ladung ohne weitere Befehle. Master AUS, Gerätefehler, Hausanschlussschutz, ungültige SMA-Qualität und externe AUS-Meldung stoppen weiterhin. Zusätzliche Vertragsfälle prüfen Ablehnungsgrund, Zeitgrenzen und Qualität. Kein allgemeines Lockerstellen der Quellenfristen.

Der frühere separate Abbruch um 10:47:56 mit 'Ladefreigabe extern entzogen' ist damit nicht als behoben nachgewiesen; seine Ursache bleibt offen. Softwaretests ersetzen die reale Nachbeobachtung nach Installation.
