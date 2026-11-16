# 0.17.0-alpha.288

Während ein freigegebenes Fahrzeug unter seinem Mindest-SoC Pflichtladung benötigt, pausiert die normale Regelung des Hausspeichers. Das gilt für alle drei Wallboxen. Ein neuer Start wartet auf die Rückmeldung der vorherigen Speicherleistung. Sobald die letzte Pflichtladung endet, greift der konfigurierte Speichervorrang wieder.

Optionale Speicherhilfe für das Autoladen setzt mindestens 80 % Speicher-SoC voraus. Bei SunEnergy zählt zusätzlich der niedrigste gemeldete Pack-SoC. Höhere geltende Entladegrenzen begrenzen die Unterstützung weiter.

Erwartet der 48-Stunden-Fahrplan mehr als sechs zusammenhängende Stunden unter 20 % Speicher-SoC, setzt das EMS die Entladegrenze auf mindestens 20 %. Für diese Entscheidung verwendet es die Prognose vor Anwendung der Zusatzreserve. Bei gemessenem Unterschreiten stehen bis zu 1.000 W Netzladeleistung bis zur Reserve zur Verfügung. Das EMS nutzt ein günstigeres Fenster, wenn es den Beginn der Unterdeckung beobachtet hat und die benötigte Energie innerhalb von sechs Stunden laden kann. Bei unklarem Beginn, fehlendem Preis oder zu knappem Zeitfenster beginnt die Nachladung bei freier Leistung sofort.

Die Nachladung bis 20 % kann mit der Fahrzeug-Pflichtladung zusammenlaufen. Das EMS begrenzt sie durch das freie gemeinsame Netzbudget, die gemessenen Phasenreserven und die gültigen Gerätegrenzen. `Plan.BatteryForecastReserve_JSON` zeigt den prognostizierten Zeitraum und den Ladebeginn. `Control.BatteryForecastReserveGridCharge_W` zeigt die aktuell zugeteilte Nachladeleistung.
