# 0.17.0-alpha.224

- Die optionale Mindest-SoC-Planung rechnet bei ausgeschalteter SoC-Schätzung die gültig gemessene Ladeenergie der Stecksession auf Mindestbedarf und Ladeende an. Wiederholte Meldungen desselben App-SoC setzen die Messbilanz bei lückenloser Erfassung nicht zurück.
- Eine geänderte Abfahrtszeit löst für das angeschlossene Fahrzeug einen neuen Fahrplan aus. Die Stecksession und ihre Ladebilanz bleiben erhalten. Ohne gültige Abfahrtszeit greift die Sofortladung zum Mindest-SoC. Nach Ablauf der Frist bleibt die ursprüngliche Abfahrt dieser Sitzung gespeichert, bis die Uhrzeit geändert oder eine neue Sitzung begonnen wird.
- Bei gemeinsamer Planung bekommen Fahrzeuge mit früherer Abfahrt zuerst die passenden Preisfenster. Eine ausdrücklich gewählte Fahrzeugpriorität und die elektrischen Grenzen gelten weiter.
- Die Voreinstellung pro Fahrzeug ist die Sofortladung bis zum Mindest-SoC.
