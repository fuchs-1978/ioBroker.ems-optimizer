# 0.17.0-alpha.140 – exakte Schichtungsgrenze und gerichtete Peakdiagnose

Die Restprüfung vom24.10.2026 in Tagesissue#249 behandelt die Exportmarkierungen14:35:50–14:39:55,15:34:05–15:35:50 und15:36:30–15:40:20 sowie sieben weitere NVP-Abweichungen. Ausgeschlossene Altfälle werden nicht erneut korrigiert.

## Exakt15K sind nicht mehr als15K

Im neuen SQL-Ausschnitt15:33:05–15:35:05 stehen67,9°C oben und52,9°C unten. Ihre mathematische Differenz beträgt15K; JavaScript liefert15.000000000000007. Der bisherige direkte Vergleich klassifiziert das fälschlich als mehr als15K und verwendet900 statt500W Schichtungsminimum.

Die gemeinsame Admission-/Diagnosefunktion berücksichtigt jetzt ausschließlich Gleitkomma-Rundungsrauschen, skaliert mit Number.EPSILON und den beiden Temperaturwerten. Es wird weder auf ganze Zehntel gerundet noch eine physikalische Hysterese/Schutzgrenze verschoben. Echte Werte oberhalb15K, etwa68,4001/53,4°C, behalten900W; unbekannte Temperatur und thermische Sicherheitsprüfungen bleiben unverändert.

Die konkrete Exportmarkierung erreicht laut kompakter Bilanz nur375W und liegt damit unter beiden Mindestleistungen. Ihr Nullziel ist dadurch nicht als vermeidbarer Regelfehler belegt. Keine eingesparte Energie aus dieser Korrektur behaupten. Regressionen reproduzieren die falschen900W vor dem Fix und prüfen exakte15K, echte Überschreitung und ungültige Quellen.

## Richtung einer NVP-Abweichung am Peak erhalten

Die sieben übrigen deviation-Markierungen speichern bisher nur den Betrag. Der Wert allein beweist weder Netzbezug noch Export oder eine verfügbare Ausregelmöglichkeit. Neue Leistungsmarkierungen erhalten gridAtPeakW, targetAtPeakW und signedDeviationAtPeakW aus genau derselben Intervall-Anfangsprobe wie peakW/peakAt. Positives Netzvorzeichen bedeutet Bezug, negatives Export; die signierte Abweichung ist Netzleistung minus damaligem Sollwert.

Diese Felder beschreiben den Peak, nicht automatisch die gesamte Episode oder eine Einsparmöglichkeit. Unterschiedliche Sollwerte und Vorzeichen sind getrennt nachvollziehbar. Gleiche maximale Beträge behalten die erste Peak-Provenienz. Alte Records bleiben unverändert; fehlende Peakdaten werden als null/ unbekannt ausgegeben, niemals aus Randkontext oder Tagesmitteln rekonstruiert. Optionale persistierte Werte werden auf Vollständigkeit, endliche Zahlen und Konsistenz geprüft. Energieintegrale, Dauer, Schwellen, Retention und Stellbefehle ändern sich durch die Diagnoseergänzung nicht.

Softwaretests sind keine reale Anlagenabnahme. Nach manueller Installation neue natürliche Episoden auf korrekte Peak-Provenienz und Grenzdiagnose prüfen. Keine automatische Installation oder Anlagenänderung.
