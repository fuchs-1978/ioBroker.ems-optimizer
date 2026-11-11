# 0.17.0-alpha.227

- Der einphasige Mii/e-Up an Wallbox 0 kann im Parallelbetrieb seine konfigurierte SoC-Stufe aus der freien Netzreserve erhalten. Die Standardstufen liegen bei 10 A bis einschließlich 30 % und 16 A bis einschließlich 10 %, jeweils unterhalb des Mindest-SoC.
- Die anderen Fahrzeuge erhalten zuerst ihren Mindeststrom. Der EMS berücksichtigt bestehende Lastreservierungen sowie die aktuellen Netz-, Phasen- und Fahrzeuggrenzen. Die Ausgabesteuerung prüft die SoC-Stufe vor der Stromerhöhung erneut.
- Der Fahrplan berücksichtigt die SoC-Stufe im prognostizierten Netzbudget.
