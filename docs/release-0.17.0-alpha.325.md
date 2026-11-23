# Alpha 325 – Laufende PV-Ladung bei Speicherpriorität

Wenn ein Fahrzeug bereits mit PV-Strom lädt und der gemessene Überschuss seinen Mindeststrom deckt, gibt die koordinierte Regelung den dafür benötigten Teil der Speicherreservierung frei. Die Wallbox hält die Ladung, der Speicher übernimmt den verbleibenden Überschuss. Das gilt auch nach Ablauf der Freigabe, mit der das Fahrzeug ursprünglich gestartet ist.

Im Prüffall vom 23. November stehen nach dem Hausverbrauch 3.280 W zur Verfügung. Der Mii fordert einphasig 6 A an. Dafür reserviert das EMS 1.380 W. Bei einer gemessenen Fahrzeugleistung von 1.320 W kann der Speicher rund 1.960 W aufnehmen. Der Test hält diese Situation länger als die eingestellten zehn Minuten Abschaltverzögerung und senkt anschließend den Überschuss auf 820 W. Erst bei diesem tatsächlichen Defizit greift die Abschaltverzögerung.

Die Freigabe setzt aktuelle Netz-, Speicher- und Fahrzeugmessungen, einen bestätigten Ladebetrieb und eine passende Phasenrückmeldung voraus. Für ein neu angeschlossenes Fahrzeug gelten die Startbedingungen. Eine geplante Schlussladung des Speichers, Mindest-SoC, Pflichtwärme sowie Netz- und Anschlussgrenzen behalten ihren Vorrang.

Während der zweiminütigen Prüfung am Ladelimit des Speichers enthält die Zuteilungsdiagnose der wartenden Wallbox den Zeitpunkt `start.batteryPvQualificationUntil` in Unix-Millisekunden. Das HTML-Dashboard zeigt daraus die verbleibende Prüfzeit an. Fällt die gemessene Speicherladung unter die Schwelle, entfällt die Anzeige. Für die normale Startverzögerung nutzt das Dashboard weiterhin `StartDelayRemaining_s`.
