# 0.17.0-alpha.273

Der Fahrplan nutzt die Speicherziele für die geplante PV-Reservierung und den Zeitpunkt der Schlussladung. Sobald eine Etappe abgeschlossen ist, geht die geplante Reservierung an die weitere Verbrauchskoordination. Der Live-Regler kann verbleibenden Überschuss am Netzanschlusspunkt weiterhin in den Speicher laden. Das gilt auch für den Überschuss aus einem BHKW.

Bei einem Netzsollwert von 0 W und 10 W Speicher-Totband ergibt ein gemessener Überschuss von 10, 20 oder 100 W entsprechend 10, 20 oder 100 W Ladesollleistung, soweit SoC, Gerät und gemeinsames Leistungsbudget die Ladung zulassen. Die Freigabe für preisabhängige Netzladung wird separat geprüft.
