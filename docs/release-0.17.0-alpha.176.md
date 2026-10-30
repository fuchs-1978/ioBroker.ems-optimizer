# 0.17.0-alpha.176 – Prognosevergleich Median / Lasso

## Aktivierung

Unter **History & forecast** den Schalter **Prognosevergleich Median / Lasso aktivieren** setzen und speichern. **Aussentemperatur im Lasso-Vergleich beruecksichtigen** ist voreingestellt. Die konfigurierte Aussentemperaturquelle muss in derselben SQL-Instanz aufgezeichnet sein, in Grad Celsius vorliegen und ausreichend mit der Last zeitlich ueberlappen. Bei dieser Anlage ist die KNX-Aussentemperatur in sql.0 aktiviert; ein lesender Abruf bestaetigte Werte der vergangenen Wochen. Das belegt noch keine vollstaendige Viertelstundenabdeckung.

Der Vergleich ist standardmaessig deaktiviert. Er aendert weder die ausgewaehlte produktive Lastprognose (Median oder recent-weighted) noch Fahrplan, Ladefreigaben oder Ausgangsgrenzen. Die isolierte Steuerungsvorschau fuehrt kein Vergleichstraining aus.

## Daten und Modell

Der Vergleich verwendet die vorhandenen, zeitlich vollstaendig zusammengefuehrten Unterzaehlerreihen. Wallboxen und Heizstaebe werden gemaess den vorhandenen Zuordnungsschaltern abgezogen. Eine Luecke bei einem enthaltenen flexiblen Verbraucher erzeugt keine erfundene Grundlast. Die Modellgrundlage ist die bereinigte Grundlast vor der produktiven Mindestgrundlast-Untergrenze; beide Vergleichsverfahren werden gegen genau diese Last bewertet. Die Abgrenzung bleibt von korrekter Konfiguration der Zaehler und enthaltenen Verbraucher abhaengig.

Lasso-Merkmale: Last zur gleichen lokalen Viertelstunde vor zwei und sieben Kalendertagen, zwei Tagesgang-Harmonische, Wochentag/Feiertag sowie optional Aussentemperatur und Heizgrad max(0, 18 °C minus Aussentemperatur). Zwei statt einem Tag Rueckblick stellt sicher, dass fuer den kompletten morgigen Tag alle Verbrauchsmerkmale schon bei der Ausgabe vorliegen. Historische Temperaturen stammen aus SQL; fuer die Prognose gelten die vorhandenen frischen Open-Meteo-Wetterstunden. Helligkeit ist noch kein Modellmerkmal. Das ist eine begrenzte, LEAR-inspirierte Lasso-Variante, keine vollstaendige Replikation eines Standard-LEAR-Modells.

Die Historienverarbeitung liest fuer den Vergleich bei aktivierter Temperatur genau eine weitere Quelle in den vorhandenen taeglichen SQL-Stuecken mit Cache. Fehler dieser Zusatzquelle sperren nur den Vergleich. Das Training verwendet hoechstens 84 Tage und braucht mindestens 28 verschiedene nutzbare Zieltage und 28 mal 72 Viertelstunden nach Lag- und Temperaturzuordnung. Fuer die zeitlich letzten sieben Tage werden drei Strafstaerken (5, 25, 100 W bei standardisierten Merkmalen) verglichen; danach wird die gewaehlte Staerke mit allen verfuegbaren Trainingswerten neu angepasst. Diese interne Abstimmung mit historischen gemessenen Temperaturen ist kein Beleg fuer die Guete einer Wettervorhersage. Massgeblich fuer den Praxisvergleich sind ausschliesslich die danach wirklich vorab ausgegebenen Prognosen.

Der Solver minimiert den quadratischen Fehler plus L1-Strafe per Koordinatenabstieg, mit unbestraftem Achsenabschnitt und Standardisierung nur auf den jeweiligen Trainingsdaten. Er ist auf 300 Durchlaeufe begrenzt und gibt nach jedem Durchlauf die Ereignisschleife frei. Nicht konvergierte Modelle werden verworfen. Abbruch bei Adapterende verhindert Weitertraining und spaete Ergebnisveroeffentlichung. Methodische Referenz: [scikit-learn Lasso objective and coordinate descent](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Lasso.html).

## Vorabprognose und Messvergleich

Die erste vollstaendige Prognose fuer den naechsten lokalen Kalendertag wird einmalig gespeichert. Spaetere Wetteraktualisierungen und Neustarts schreiben sie nicht um. Ohne vollstaendige Lag-, Median- und Wetterdaten bleibt die Ausgabe unvollstaendig und geht nicht als gueltiger Prognosetag in die Auswertung. Der Vergleichsmedian verwendet Tagestyp und Viertelstunde; bei weniger als zwei Feiertagsbeobachtungen wird das Sonntagsprofil verwendet. Es gibt keine automatische Umschaltung der Produktion.

Die bestehenden Historienlaeufe beim Start und um 00:10 Uhr trainieren und bewerten den Vergleich. Eine Lernbasis aelter als 36 Stunden stellt keine neuen Vergleichsprognosen aus. Der erste vollstaendige Messvergleich ist fruehestens nach Ablauf des vorhergesagten morgigen Tages und dem folgenden erfolgreichen Historienlauf moeglich. Auch ein teilweise aktueller Tag wird nicht rueckwirkend als prognostiziert ausgegeben.

Zustaende unter `Forecast.LoadComparison`:

- `Status`, `Ready`: Ausgabe- und Datenstatus fuer morgen.
- `Forecast_JSON`: unveraenderte Vorabprognose mit Median- und Lasso-Werten je Viertelstunde.
- `Model_JSON`: Merkmale, Gewichte, Stichprobenzahl, Zeitgrenze und interne Strafstaerkenwahl.
- `Evaluation_JSON`, `Result`: Messvergleich der letzten 14 Tage, einschliesslich fehlender Abdeckung.
- `Ledger_JSON`: begrenzte persistente Vorabprognosen mit Quellen-/Zuordnungsvertrag; hoechstens 16 Tageintraege.

MAE und RMSE werden nur auf identischen Viertelstunden mit beiden Vorhersagen und Messwerten berechnet. Tagesenergie und vorzeichenbehaftete Energieabweichung (Prognose minus Messung) setzen alle 96 Viertelstunden voraus. Zeitumstellungstage mit 23 oder 25 Stunden bleiben explizit unbewertet. Unbekannte Werte werden nie null. Geaenderte Quellen oder Lastzuordnungen verwerfen die Vergleichbarkeit alter Eintraege; Ergebnisse sind kein garantierter Effizienzgewinn.

## Pruefung

Tests decken die analytische Soft-Threshold-Loesung, Temperaturmerkmale, zeitliche Trennung, fehlende Historie, Zukunftsdaten, eingefrorene Vorabprognosen, Neustart, Quellenwechsel, paarweise Fehler-/Energiebewertung, Zeitumstellung, freiwillige Ereignisschleifenfreigabe, Abbruch und deaktivierte bzw. isolierte Kontexte ab. Bestehende Produktions- und historische Vergleichstests pruefen die unveraenderte Regelung.
