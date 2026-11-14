# 0.17.0-alpha.273

Der Fahrplan nutzt die Speicherziele für die geplante PV-Reservierung und den Zeitpunkt der Schlussladung. Nach Abschluss einer Etappe steht die reservierte PV-Leistung der weiteren Verbrauchskoordination zur Verfügung. Der Live-Regler nimmt den verbleibenden Überschuss am Netzanschlusspunkt auf. Er berücksichtigt die Leistung, die Wallboxen zum Start oder zur Leistungsanhebung brauchen, sowie die zugeteilte Leistung der Heizstäbe. Das gilt auch für den Überschuss aus einem BHKW.

Bei einem Netzsollwert von 0 W und 10 W Speicher-Totband ergibt ein gemessener Überschuss von 10, 20 oder 100 W entsprechend 10, 20 oder 100 W Ladesollleistung, soweit SoC, Gerät und gemeinsames Leistungsbudget die Ladung zulassen. Die Freigabe für preisabhängige Netzladung wird separat geprüft.
