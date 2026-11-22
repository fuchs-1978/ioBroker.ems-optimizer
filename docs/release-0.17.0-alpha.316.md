# Alpha 316 – Ladende Wallbox und Restüberschuss

Im Parallelbetrieb prüft der EMS für die gesamte Leistungsbilanz und die Phasenreserven denselben Nachweis wie für die Wallboxzuteilung. Eine ruhende Wallbox darf eine Abfrage verpassen, wenn die bestätigte AUS-Rückmeldung, die Leistungs- und drei Strommessungen seit der Abschaltung elektrische Ruhe belegen. Die Wallbox muss frei von laufenden Aufträgen und Leistungsreservierungen sein. Vor ihrer nächsten Ladefreigabe braucht sie wieder frische Messwerte. Im Beispiel von 09:28 Uhr blieb die laufende EQE-Ladung im Test auch bei 30,3 Sekunden alten Nullwerten der Mii-Wallbox freigegeben.

Bei einer Pflichtladung erhalten die Fahrzeuge zuerst ihre Leistung. Sobald sie messbar laden, kann der Speicher den Überschuss am Netzanschluss aufnehmen. Bereits zugeteilte Stromerhöhungen und ausstehende Heizleistung sind für die jeweiligen Geräte reserviert. Das EMS prüft den verfügbaren Überschuss erneut vor der Speicherausgabe. Eine neu eintreffende Bezugsmessung senkt die zulässige Ladeleistung. Die normale Speicherentladung für eine Fahrzeug-Pflichtladung bleibt gesperrt.

Bei 20 A einphasig nahm der EQE im beobachteten Fall rund 4,37 kW auf. Bei gemessenen 562 W Einspeisung und ruhendem Speicher stehen bis zu 562 W für dessen Ladung zur Verfügung, sobald die Fahrzeugaufnahme bestätigt und das übrige Budget frei ist.
