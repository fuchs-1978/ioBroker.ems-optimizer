# Alpha 322 – Speicherplatz für den PV-Überschuss am Nachmittag

Wenn der koordinierte SunEnergy-Fahrplan bei vollem Speicher Einspeisung erwartet, kann er einem bereits ladenden Fahrzeug vorher ein zusätzliches Ampere geben. Dafür muss das Fahrzeug noch Energie bis zum Ziel-SoC benötigen. Der Speicher lädt in dieser Zeit weiter mit mindestens der Hälfte seiner maximalen Ladeleistung. Der Plan reserviert nur so viele Wattstunden, wie der Speicher später am selben Tag aus überschüssiger PV tatsächlich nachladen kann. Eine Versorgungslücke unterbricht die Verschiebung.

Die Wallbox behält ihre bestätigte Phasenzahl. Für einen Teil einer Viertelstunde kann die reale Stromstufe später beginnen. In der Wallbox-Zeitreihe stehen der Mittelwert in `valueW`, die obere Stufe in `currentA` und der Beginn der Stufe in `pvHeadroom.from`. Die Regelung prüft den aktuellen Netzfluss, die gemessene Speicherladung und die Wallbox-Rückmeldung, bevor sie PV-Leistung dafür freigibt. Abfahrten, Netzbetreibergrenzen, Speicherreserve, Kalibrierung und Preisladungen haben Vorrang.

Erreicht der Speicher bereits seine AC-Ladegrenze, kann der Fahrplan verbleibende PV-Leistung einem ohnehin vorgesehenen Warmwasser-Heizvorgang geben. Er berücksichtigt den thermischen Bedarf, die Heizleistungsgrenzen und die übrigen Verbraucher. Die Anlage kann die zusätzliche Leistung nur bei gültigen Messungen und aktiver Heizfreigabe nutzen.

Im nachgerechneten Montagsfahrplan entfallen dadurch rund 0,54 kWh Einspeisung am Nachmittag. Im Dienstagsbeispiel steigen die bestehenden 1.125 W Warmwasserleistung in drei Viertelstunden auf 1.219 W, 1.247 W und 1.172 W. Zusammen nehmen sie rund 0,066 kWh zusätzlichen Solarstrom auf. Beide Ergebnisse beziehen sich auf die Prognose.
