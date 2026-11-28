# Alpha 346 – Speicher im Niedertarif und ruhigere Terminladung

## Modul 3

Unter **Batteriespeicher** kannst du **Speicherentladung im Niedertarif sperren** aktivieren. Unter **Preise & Tarife** müssen zeitabhängige Netzentgelte und ein gültiger Jahrestarif mit Zeitfenstern eingerichtet sein. Während jeder Viertelstunde der Tarifstufe „Niedertarif“ beziehen verschobene Verbraucher ihren Bedarf aus dem Netz, soweit die eigene Erzeugung ihn nicht deckt. Der Speicher hält seine Ladung bis zum Ende des Niedertarifs. Die Option ist ab Werk ausgeschaltet.

Mit **Speicher-Netzladen in ausgewählten günstigen Zeiten erlauben** kann der Speicher im selben Fenster laden. Die Preisplanung berücksichtigt den erwarteten Hausverbrauch, die PV-Prognose, verfügbare Ladeleistung, Verluste und die eingestellte Mindestersparnis. Ein hoher späterer Bedarf kann eine Ladung bis zum eingestellten maximalen Netzlade-SoC rechtfertigen. Bei ausreichend erwarteter Sonne bleibt entsprechend mehr Platz im Speicher. Eine fällige Fahrzeugladung bekommt ihre Leistung zuerst. Sobald die Wallbox den Ladestrom bestätigt, kann der Speicher freie Leistung für die geplante Netzladung nutzen. Die Anschluss-, Phasen-, Speicher- und Netzbetreibergrenzen gelten dabei weiterhin.

In `Plan.BatteryPower_48h_JSON` kennzeichnet `lowTariffDischargeBlocked` das Haltefenster. `gridChargeW` gibt den geplanten Netzanteil an. Die aktuelle Zuteilung steht in `Control.BatteryPriceGridCharge_W`. Die Sperre gilt auch in Viertelstunden ohne geplanten Einkauf sowie nach Erreichen des Ladeziels.

## Terminladung

Bei einem gebuchten Abfahrtsziel mit Netzfreigabe und konfiguriertem AC-Energiezähler führt das EMS den Restbedarf anhand der an der Wallbox gemessenen kWh fort. Eine gerundete Fahrzeugmeldung kann die angekommene Energie dadurch nicht bei jedem Abruf löschen. Zwei neue, übereinstimmend abweichende Beobachtungen korrigieren die Berechnung. Eine manuelle Korrektur oder eine Fahrzeugmeldung am Ziel wirkt sofort. Der angezeigte Fahrzeug-SoC bleibt auf die Fahrzeugdaten und die bestehende Schätzung bezogen.

Wenn die zeitgeführte Terminladung läuft, prüft der Regler die reale Leistungsaufnahme bei bestätigtem Ladestrom. Er kann den Strom schrittweise anpassen. Die Terminreserve beträgt weiterhin 15 Minuten. Eine knappe Restzeit, der Ladestromdeckel und elektrische Grenzen wirken unmittelbar. PV-Zuteilung und günstige Termin-Ladefenster verwendet der Fahrplan weiterhin.

## Gleich günstige Nächte vor der Abfahrt

Wenn zwei Niedertariffenster denselben Gesamtpreis haben, nutzt das EMS das spätere, soweit es den offenen Bedarf deckt. So kann PV am Tag dazwischen die noch einzukaufenden kWh verringern. Innerhalb des ausgewählten Fensters sucht der Fahrplan den kleinsten ausreichenden Ladestrom in ganzen Ampere und den spätesten passenden Viertelstundenbeginn. Er berücksichtigt die Anlaufzeit, spätere PV, das Abregeln des Fahrzeugs am Ladeende und die gemeinsame verfügbare Leistung. Reicht das letzte Fenster nicht aus, wird der fehlende Anteil früher geladen.

Bei 90 kWh Fahrzeugkapazität, 74 % Ausgangs-SoC, 90 % Ladewirkungsgrad und Abfahrt am Montag um 06:00 Uhr fehlen 26 kWh an der Wallbox. Bei zwei gleich günstigen Nächten von 23:00 bis 05:00 Uhr und voller Verfügbarkeit der letzten Nacht passt die Ladung mit 3 × 7 A in das Fenster am Sonntagabend. Mit fünf Minuten Anlaufzeit beginnt das geplante Zeitfenster um 23:30 Uhr und endet gegen 04:58 Uhr am Montag.
