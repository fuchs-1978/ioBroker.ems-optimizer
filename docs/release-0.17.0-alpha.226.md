# 0.17.0-alpha.226

- Endet die Pflichtladung am Mindest-SoC, protokolliert das EMS die Abschaltanforderung als Info.
- Die Meldung „Abschaltung bestätigt“ folgt, sobald die AUS-Rückmeldung und frische Leistungs- und Phasenstromwerte den Ladestopp bestätigen.
- Bei Fristablauf warnt das EMS pro Stopp einmal je Ursache. Es unterscheidet eine fehlende AUS-Rückmeldung und eine fehlende elektrische Bestätigung nach der AUS-Rückmeldung.
