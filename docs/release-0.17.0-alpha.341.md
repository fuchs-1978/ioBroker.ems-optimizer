# Alpha 341 – EQV-Ladung bei einer kurzen PV-Lücke

Lädt der EQV bereits einphasig und reicht die PV-Leistung vorübergehend nicht für 6 A, kann der SunEnergy-Speicher die Differenz liefern. Der Fahrplan prüft, ob die PV-Ladung innerhalb derselben Speicherstufe wieder einsetzt. Die Freigabe gilt für eine zusammenhängende Lücke mit höchstens 0,5 kWh auf der AC-Seite und maximal 600 W Speicherleistung. Sie nutzt die aktivierte EQV-Speicherhilfe mit einem SunEnergy-Kopf. Der wirksame Mindest-SoC und die Reserven des Speichers gelten auch während der Überbrückung.

Im Fahrplan vom 27. November um 07:55 Uhr fehlen um 12:15 Uhr 49 W. In Alpha 341 decken 1.331 W PV und 49 W Speicherentladung die 1.380 W des EQV. Die Viertelstunde kostet 12,25 Wh Speicherenergie auf der AC-Seite. Um 12:30 Uhr trägt die PV wieder 7 A. Um 12:45 Uhr gehen die verfügbaren 2.048 W an den Hausspeicher. In der aktualisierten Prognose von 08:00 Uhr beginnt die nächste Speicherstufe bereits um 11:45 Uhr. Dort endet der Ladeblock direkt.

Die Live-Regelung prüft Netz-, Fahrzeug- und Speichermesswerte vor der Freigabe. Sie hält die Leistungsgrenzen der einzelnen Viertelstunden über Neuberechnungen und Neustarts fest. Sobald gemessener Überschuss die reguläre PV-Ladung wieder deckt, steht das Budget für eine spätere Lücke erneut zur Verfügung.
