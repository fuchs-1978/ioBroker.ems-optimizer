# Alpha 318 – Sofort gestartete Haushaltsprogramme im 48-Stunden-Fahrplan

Ein direkt gestarteter Trockner oder Geschirrspüler belegt im Haus-, Speicher-, Wallbox-, Warmwasser- und Netzfahrplan sein verbleibendes Programmprofil. Dafür genügt im Gerätemodus **Beobachten** oder **Automatisch** die bestätigte Laufmeldung. Der Zeitstempel des Geräts bestimmt den Beginn. Bei einem vorgezogenen Start ersetzt er die zuvor geplante Uhrzeit. Der nächste Gerätezyklus erkennt die Änderung, die zentrale Prognose rechnet anschließend neu. Mehrere gleichzeitig laufende Geräte teilen sich denselben PV-Überschuss.

Startet der Trockner um 12:05 Uhr mit einer Leistung von konstant 900 W, enthält die Gerätekurve für 12:00 bis 12:15 Uhr 0,15 kWh bzw. 600 W im Viertelstundenmittel. Rechnet der Speicher um 12:10 Uhr neu, fallen bis 12:15 Uhr noch 0,075 kWh bei 900 W an. Für jede folgende Viertelstunde gilt der zu diesem Zeitpunkt erreichte Abschnitt des Programms.

| Datenpunkt | Inhalt |
| --- | --- |
| `Plan.Appliances_48h_JSON` | Verlauf pro Gerät und Summe der eingeplanten Lasten. Ein vollständig durchlaufenes Profil bei fortdauernder Laufmeldung erscheint unter `unresolvedDevices`. |
| `Forecast.HouseLoad_48h_JSON` | Hauslastprognose einschließlich der angesetzten Programme. `applianceW` kennzeichnet ihren Beitrag zur Kalenderviertelstunde. |
| `Forecast.Baseload_48h_JSON` | Grundlast aus Median oder Median/Lasso als Ausgangswert für den Fahrplan. |
| `Plan.Allocation_48h_JSON` | `baseW` enthält die Grundlast und den angesetzten Programmanteil `applianceW`. Die laufende Viertelstunde verwendet die mittlere Leistung der verbleibenden Minuten. |

Der Fahrplan übernimmt auch automatische Starttermine und bereits gesendete Starts. Reine Startvorschauen bleiben in der Geräteansicht. Kostenberechnungen für das nächste Programm ersetzen den bereits im Netzfahrplan enthaltenen Geräteanteil durch die aktuellen zeitgenauen Reservierungen. Bestätigtes Ende und Abbruch geben die Restlast frei. Für ein unbekanntes Programm kann das EMS den Mittelwert bereits gelernter Programme desselben Geräts verwenden.

Für das Training protokolliert das EMS bestätigte Läufe über den eingestellten Historienzeitraum. Bei vollständig gemessenen Läufen speichert es zusätzlich das Leistungsintegral je Kalenderviertelstunde unter `Devices.ProgramHistory`. Ist in der Programmzeile **Geräteleistung wird von den Haus-Unterzählern mitgemessen** bestätigt, zieht es diese Beiträge bei der Bildung der historischen Hauslastprofile und der Median-/Lasso-Grundlast ab. Zeitgleiche gemessene Läufe werden summiert. Bei fehlender Messabdeckung, ungeklärter Messzuordnung oder unplausiblem Abzug entfällt die betroffene Trainingsbeobachtung. Ältere Laufprofile mit Beginn zwischen zwei Viertelstunden enthalten nur Mittelwerte relativ zum Programmstart. Auch diese Intervalle entfallen. Ältere Zeiträume ohne zuordenbare Laufaufzeichnung liefern weiterhin historische Vergleichswerte. Die Rohmessungen bleiben als Referenz erhalten.
