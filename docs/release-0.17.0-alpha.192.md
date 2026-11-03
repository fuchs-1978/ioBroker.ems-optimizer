# 0.17.0-alpha.192 – Stoppnachweise und gemeinsame Prognosefenster

Eine Mii-Stoppkante konnte als unbekannt erscheinen, obwohl AUS-ACK und elektrische Ruhe erst in spaeteren Diagnoseintervallen eintrafen. Die bisherige Pruefung verlangte alle Nachweise im Intervall der Abschaltkante.

## Wallbox-Stoppdiagnose

- Eine in dieser Sitzung beobachtete EIN/AUS-Kante startet je Wallbox eine begrenzte Diagnosekette. Sie verwendet den beobachteten `LastStopAt`, andernfalls die Grenze des vorherigen Abtastintervalls. Die feste Frist endet nach 120 Sekunden; Auffrischungen verlaengern sie nicht.
- Unabhaengig beobachtetes AUS-ACK und `StopConfirmedAt` koennen spaeter eintreffen. Eine bestaetigte AUS-Beobachtung bleibt innerhalb der Kette bei normaler Cache-Alterung erhalten. Befehls-Echos, Qualitaetsfehler, widerspruechliche oder ungueltige Quellenzeiten duerfen sie nicht tragen.
- Erfolg erfordert zusaetzlich gueltige, nach dem AUS-Nachweis liegende elektrische Nullleistung und alle drei Ruhestroeme. Ein AUS-ACK allein beweist keine elektrische Abschaltung. Die Reservefreigabe wird dadurch nicht bestaetigt.
- Neustart des Beobachters rekonstruiert keine alte Kette. Abtastluecken ueber zehn Sekunden, Zeitruecklauf, fehlendes Fahrzeug, erneute Aktivierung/AUS-Ueberholung, EIN-Rueckmeldung, Ausgangsfehler oder Fristablauf beenden offene Ketten als unbekannt.
- `Diagnostics.Transitions` zeigt ausstehende Stoppnachweise; `Diagnostics.Snapshot_JSON` enthaelt `transitions.pendingStops` und getrennte Kanten-, ACK-, Stoppbestaetigungs- und elektrische Quellenzeiten. Ein abgeschlossener Vorgang erscheint einmal.

## 7-/14-Kalendertage-Prognosevergleich

- `Forecast.LoadComparison.Evaluation_JSON.windows` enthaelt zwei Fenster ueber die letzten sieben bzw. vierzehn abgeschlossenen lokalen Kalendertage. `Result` zeigt beide Fenster zusaetzlich zu den bisherigen Tagesergebnissen. Aktualisierung erfolgt mit der vorhandenen Historienauswertung, beim Start und taeglich um 00:10.
- Median, Lasso, feste 50/50-Kombination und Lasso-Energie/Median-Verlauf verwenden exakt dieselben vorhandenen Viertelstunden: Nur vorab gespeicherte Prognosen aller vier Modelle und ein gueltiger Istwert bilden einen gemeinsamen Vergleichspunkt. Alte Eintraege ohne Kombinationsprognosen werden nicht nachtraeglich vervollstaendigt.
- MAE und RMSE werden aus allen gemeinsamen Einzelabweichungen berechnet. Insbesondere ist der Gesamt-RMSE kein Mittelwert der Tages-RMSE.
- Energieabweichung ist die vorzeichenbehaftete Summe ausschliesslich identischer vollstaendiger 96-Viertelstunden-Tage. Positiv bedeutet Ueberschaetzung, negativ Unterschaetzung. Daneben verhindert der mittlere absolute Tagesenergiefehler, dass gegenlaeufige Tagesfehler unsichtbar werden. Ohne vollstaendigen Tag bleiben Energiewerte unbekannt.
- Gemeinsame Viertelstunden, verfuegbare Prognosetage, vollstaendige Tage, Energiedaten und erwartete Abdeckung bleiben explizit. Ein Fenster mit fehlenden regulaeren Tagen ist vorlaeufig. 23-/25-Stunden-Zeitumstellungstage bleiben als Zieltage ausgeschlossen und werden separat gezaehlt; Fenstergrenzen und Aufbewahrung folgen trotzdem lokalen Kalendertagen.
- Doppelte identische Prognosetage zaehlen einmal. Widerspruechliche doppelte Prognosen oder Istwerte erzeugen keinen Nachweis.

## Grenzen und Pruefung

Die Aenderungen betreffen ausschliesslich vorhandene Diagnose- und Vergleichsausgaben. Es entstehen keine zusaetzlichen SQL-Abfragen, neuen Stellfreigaben, Aenderungen der Ladestromregelung oder automatischen Modellwechsel. Die Fortschreibung ab VW-Quellzeitpunkt bleibt in #320 zurueckgestellt. Die Installation erfolgt durch den Betreiber.

Regressionen pruefen versetzte Stoppnachweise, ungueltige Quellen und Abbrueche, gemeinsame Modellabdeckung, gepoolte Fehler, vorzeichenbehaftete und absolute Energiefehler, unvollstaendige/alte Prognosen, Duplikate, beide Zeitumstellungen sowie den vorhandenen Ausgabeweg. Die Hauptregressionen scheitern gegen Alpha 191. Erfolgreiche Softwaretests ersetzen keine reale Abnahme des naechsten natuerlichen Stopps.
