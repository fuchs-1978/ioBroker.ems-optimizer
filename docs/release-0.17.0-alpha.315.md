# Alpha 315 – PV-Ladepause vor der Abfahrt

Ein fehlender PV-Wert zählt für die betreffende Viertelstunde mit 0 W. Bleibt am Vormittag ein nutzbares PV-Fenster, kann die Wallbox die dafür vorgesehene Energie weiter freihalten.

Hat das Fahrzeug den geplanten Zwischen-SoC erreicht und entfällt das PV-Fenster bei einer Neuberechnung, prüft der EMS die verbleibende Ladezeit mit 0 W PV. Er sucht den spätesten zusammenhängenden Zeitraum, in dem der Mindestladestrom neben Hauslast, Wärme, Speicher-Netzladung und anderen Fahrzeugen verfügbar ist. Für die lieferbare Energie rechnet er mit höchstens 80 % der Mindestladeleistung. Eine niedriger eingestellte Prognosesicherheit verringert den Ansatz. Die Startwartezeit und die 15 Minuten Reserve vor der Abfahrt gehen in die Rechnung ein. Der Status „Warten auf PV; abgesicherte Nachladung ab …“ zeigt den Beginn dieses Zeitraums.

Die Pause gehört zur jeweiligen Steckverbindung, Abfahrt und SoC-Vorgabe. Bei jeder Neuplanung prüft der EMS unter anderem die Mobilitätsreserve, weitere fällige Fahrzeuge, manuelle Stromvorgaben und die verfügbaren Leistungsgrenzen. Reicht die Zeit für eine sichere Nachladung nicht mehr aus, greift die reguläre Mindestladung.

Im Regressionstest für den EQE fehlen um 03:04 Uhr bei 88,1 % noch 1,91 kWh an der Wallbox bis zum Ziel von 90 %. Bei 6 A einphasig, fünf Minuten Startwartezeit und Abfahrt um 12:00 Uhr ergibt die Rechnung einen spätesten Start um 09:45 Uhr. Ein separater Test durchläuft diesen Übergang mit dem produktiven Wallboxregler und simulierter Leistungsrückmeldung.
