# Alpha 317 – Speicherziele bei PV-Überschuss

Der EMS prüft beim Erstellen des 48-Stunden-Fahrplans, wie viel Energie das Haus bis zum nächsten nutzbaren PV-Fenster benötigt. Die Option **Adaptive Speicherziele und monatliche PV-Vollladung** ist im Reiter Batteriespeicher standardmäßig aktiv. Aus den eingestellten Zielen 70, 90 und 100 % ergeben sich drei mögliche Fahrpläne.

| Absenkung | Vormittagsziel | Nachmittagsziel | Abendziel |
| --- | ---: | ---: | ---: |
| 20 Prozentpunkte | 50 % | 70 % | 80 % |
| 10 Prozentpunkte | 60 % | 80 % | 90 % |
| 0 Prozentpunkte | 70 % | 90 % | 100 % |

Das EMS rechnet die Verbraucher mit den jeweiligen Speicherzielen erneut durch. Es bevorzugt die niedrigste geeignete Stufe. Es prüft Netzbezug, Einspeisung, geplante Fahrzeugenergie bis zur Abfahrt und bis zum Ende des Fahrplans sowie den Pflichtbedarf für Warmwasser. Beim Vergleich der Einspeisung zählt die einmalige Änderung der gespeicherten Energiemenge mit. Eine zweite Rechnung verwendet den eingestellten PV-Sicherheitsfaktor und hält oberhalb des geltenden Mindest-SoC fünf Prozentpunkte für Prognoseabweichungen frei. Absenken setzt einen nachfüllbaren Speicher und eine weitere nutzbare PV-Phase nach der Nacht voraus. Bei höherem Nachtbedarf oder schlechterer Prognose kann der nächste Fahrplan das Abendziel wieder anheben.

Die reale Regelung beachtet die gewählte Ladestufe. Bereits im Speicher vorhandene Energie steht dem Haus beim Übergang weiter zur Verfügung. Für die Unterstützung von Mii und EQV liegen die Schwellen entsprechend tiefer. Beispielsweise liegt die Tagesschwelle bei einem Abendziel von 80 % bei mindestens 70 %. Erwarteter Nachtbedarf, Preisreserve und Gerätegrenzen können sie anheben. Hausverbrauch darf weiterhin die Energie bis zur geltenden Entladegrenze nutzen.

Das EMS zählt eine gemessene Vollladung auch im normalen Betrieb. Im SunEnergy-Kopfmodus müssen alle online gemeldeten Packs aller konfigurierten Köpfe 100 % melden. Frische, fortschreitende Gerätemessungen müssen dabei mindestens 30 Sekunden lang eine DC-Leistung von höchstens 50 W je Kopf im Betrag zeigen. Im Einzelbetrieb werden bestätigte Messungen des gewählten Speichers verwendet. Das ist ein beobachtbares Ladeende. Das EMS weist damit die Vollladung nach. Der genaue Abschluss des internen Zellabgleichs lässt sich aus diesen Messwerten allein nicht bestimmen.

Nach 30 Tagen oder bei der ersten Inbetriebnahme ohne bestätigten Zeitpunkt sucht der Planer ein spätes PV-Fenster, das frühestens um 14 Uhr Berliner Zeit endet. Die Prognose muss den fehlenden Energieinhalt einschließlich Ladeverlusten decken. Die letzte nutzbare Viertelstunde dient als Zeitreserve. Ein begonnenes Fenster wird bei einer neuen Prognose mit den verbleibenden PV-Mengen erneut geprüft. Der Kalender erteilt keine Netzladefreigabe. Können die installierten Geräte oder die eingestellten Obergrenzen 100 % nicht erreichen, bleibt die Vollladung aus. Nach gemessenem Ladeende übernimmt wieder die gewählte Stufe.

`Plan.BatteryOperatingWindow_JSON` zeigt die Ziele, die berechnete Reserve und den vorgesehenen Zeitraum. `Plan.BatteryStage_48h_JSON` enthält die Werte je Viertelstunde. `Devices.Battery.LastFullChargeAt` speichert den Zeitpunkt der letzten gemessenen Vollladung über Neustarts hinweg.
