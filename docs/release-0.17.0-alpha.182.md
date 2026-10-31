# 0.17.0-alpha.182 – Geschätzte Frühlings-Rückblicke

Auf Betreiberwunsch werden die vier nicht existenten lokalen Viertelstunden der einstündigen Frühjahrsumstellung ausschließlich als Lasso-Eingangsmerkmale geschätzt: beispielsweise 02:15 = (gemessene 01:15 + gemessene 03:15) / 2. Beide gültigen Messwerte sind erforderlich. Der tatsächliche einstündige Sprung des Zeitzonenoffsets sowie Datum, Uhrzeit und Minuten werden geprüft. Andere Zeitsprünge und normale SQL-Lücken werden nicht ergänzt.

Jeder neue Prognoseslot enthält `estimatedLagDays`: beispielsweise `[7]` kennzeichnet den geschätzten Wochenrückblick, `[]` keinen verwendeten geschätzten Lag. Model_JSON enthält `estimatedLagSamples`, `estimatedLagValues` und `calendarLagPolicy` für die zum Training verwendeten Schätzungen. Die Schätzwerte werden nicht in die Messwertbasis geschrieben. Median, gemessene Zielwerte und Ist-Bewertung werden nicht mit geschätztem Verbrauch aufgefüllt. Beide Herbstvorkommen werden weiterhin nur bei vollständigen gültigen Messungen gemittelt.

Bereits ausgegebene Vorabprognosen bleiben unverändert. Die produktive Steuerung, SQL-Aufzeichnung und Zählerzuordnung werden nicht geändert. 92-/100-Slot-Zieltage bleiben außerhalb der bisherigen 96-Slot-Vergleichsausgabe. Da die Historie auf 84 Tage begrenzt ist, wirkt die Frühlingsregel im aktuellen Oktober-/November-Vergleich nicht; sie greift bei passenden Rückblicken auf die nächste Frühjahrsumstellung.

Regressionen: alle vier fehlenden Viertelstunden für 2-/7-Tage-Rückblick, beide Nachbarmessungen erforderlich, normale Messlücken unbekannt, Kennzeichnung im Forecast und Trainingsdiagnose, unveränderte Persistenz sowie keine Ergänzung fehlender Ist-Werte.
