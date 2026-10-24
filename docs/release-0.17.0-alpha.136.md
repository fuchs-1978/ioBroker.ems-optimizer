# 0.17.0-alpha.136 – relevante Diagnoseabschnitte erhalten

Die bisherige globale Sortierung nach Abweichungsenergie bevorzugte große Haushaltsbezüge. Nach 24 Abschnitten konnten dadurch kleinere Einspeisungsereignisse oder Quellenlücken verschwinden. Der 20-Uhr-Auswahlfilter konnte bereits verworfene Daten nicht mehr berücksichtigen.

Die kompakte Tagesdiagnose nutzt jetzt voneinander unabhängige Kontingente je Periode:

| Kategorie | Abgeschlossene Abschnitte |
| --- | ---: |
| Einspeisung `export` | 8 |
| Sollabweichung `deviation` | 8 |
| Quellenlücke `source-gap` | 6 |
| Beobachtungs-/Neustartlücke `sampling-gap` | 2 |

Damit bleiben insgesamt maximal 24 abgeschlossene Abschnitte, zusätzlich zu den bestehenden begrenzten aktiven Kandidaten. Eine Kategorie kann keine andere verdrängen. Innerhalb ihrer Kategorie bleiben die größeren Energieabweichungen bzw. längeren Lücken, bei Gleichstand die neueren Fälle. Die Größe bleibt auf 64 kB begrenzt. Muss der Bericht weiter verkleinert werden, werden wie bisher zunächst Ereignisdetails entfernt; anschließend werden kategorienübergreifend erst Sollabweichungen, dann Beobachtungslücken, dann Quellenlücken und zuletzt Einspeisungsabschnitte reduziert. Die Auswahl gilt über laufende und vorherige Periode hinweg. Auch dies ist kein vollständiges Ereignisarchiv oder garantierte Aufbewahrung jeder Einspeisung.

`investigation.retention.limits` dokumentiert die Aufteilung. `droppedByType` zählt neue Verdrängungen je Kategorie, einschließlich Größenbegrenzung und Migration. `overflowBeforeRetention` bewahrt die bereits früher angefallene, nach Kategorie unbekannte Überlaufzahl; `investigation.overflow` bleibt der Gesamtzähler. Fehlende gespeicherte Fälle beweisen bei Überlauf niemals Ereignisfreiheit. Insbesondere kann älterer Überlauf vor diesem Update bereits Einspeisungsabschnitte enthalten haben.

Alte gültige Tagesdaten werden übernommen und die vorhandenen Abschnitte bei Wiederaufnahme in die neuen Kontingente eingeordnet. Summen und Messabdeckung bleiben erhalten. Bereits vor dem Update verworfene Details werden nicht erfunden oder durch einen SQL-Vollabruf rekonstruiert. Die nach Ereignistyp aufgeteilte Begrenzung ändert weder Regelung/Schutzschwellen noch die zwei kleinen SQL-Fenster und das Zeitbudget der Auswertung.

Regressionen prüfen viele große Bezugsepisoden bei gleichzeitig kleiner Einspeisung und Lücken, Kontingente/Sortierung/Überlauf, alte Überlaufzahlen bei Migration sowie bevorzugten Erhalt von Einspeisung bei Byte-Druck über beide Perioden hinweg. Bestehende Neustart-, Größen- und Bilanztests bleiben aktiv.
