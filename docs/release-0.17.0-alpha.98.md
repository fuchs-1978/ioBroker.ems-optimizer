# 0.17.0-alpha.98 – Tatsächliche Antwort auf Stromerhöhungen

## Rekonstruierter Betriebsbefund

Alpha.97 war am 19.10.2026 installiert. Sitzung 1792400166497:

| MESZ | Sequenz | Befehl | Netz | Wallboxmessung |
|---|---:|---:|---:|---:|
| 11:19:44 | 11768 | 13 A | 463 W Export | 2.740 W, vorher 12 A |
| 11:19:46 | 11802 | 12 A | 260 W Export | 2.710 W / 11,6 A |
| 11:19:54 | 11859 | 14 A | 397 W Export | 2.940 W, vorher 12 A |
| 11:19:56 | 11910 | 11 A | 64 W Bezug | 2.730 W / 11,7 A |

Der ergänzende begrenzte Abruf liefert die vorher fehlende Snapshotbasis.
Die vier Befehlsdatensätze sind vollständig rekonstruiert; frühe Deltas ohne
Basis wurden nicht als vollständige Entscheidungen interpretiert.

Die bisherige Aufnahmeprüfung akzeptierte einen neuen Poll nach ACK schon bei
`Ist >= Soll - 3 A`. Dadurch konnte selbst ein gesunkener Strom von 11,6 A
als Antwort auf 12 -> 13 A gelten. Die offene Antwort wurde beendet, bevor
die begrenzte Messversatzbehandlung aus alpha.97 greifen konnte.

## Korrektur und Grenzen

Für zugelassene laufende Erhöhungen im Parallelbetrieb werden die bereits in
alpha.97 flüchtig gespeicherten Zulassungsdaten um Leistung und drei Ströme
vor dem Befehl ergänzt. Nach ACK müssen die verwendeten Phasenströme und die
Summenleistung jeweils mindestens 0,5 A beziehungsweise die entsprechende
Leistungsstufe ansteigen. Alternativ genügt das frisch belegte angeforderte
Niveau mit 0,5 A Abstand; ein bereits nahezu erreichtes Ziel erfordert keinen
physikalisch unmöglichen zusätzlichen Anstieg. Die vorhandenen Frische-,
Qualitäts-, Chronologie-, Topologie- und Überstromprüfungen bleiben notwendig.

Die Zulassungsdaten sind nur im Speicher der aktuellen Antwort enthalten.
Es gibt keine Wiederherstellung einer Haltefreigabe nach Neustart. Starts,
Reduktionen und explizite Schattenantworten erhalten ihre bisherigen Verträge.

Ein elektrisch bestätigter offener Strombefehl wird im ACK-Übergang nicht
wegen des vorherigen internen Stromwerts zurückgenommen, solange die aktuelle
Zuteilung ihn weiterhin erlaubt und die gemessene Leistung ins reale Budget
passt. Neue Schutzgrenzen und Bezugsüberschreitungen bleiben sofort wirksam.

Die ursprüngliche Antwortfrist wird nicht verlängert. Bei fehlendem Fortschritt
nach Ablauf erscheint `limited`; weitere Erhöhungen warten mit der Diagnose
`await-measured-current-progress` auf tatsächliche Antwort. Echte spätere
Messungen entsperren weitere Erhöhungen ohne Adapterneustart. Der ACK-Übergang
ist als `acknowledged-measured-current-hold` diagnostizierbar.

## Prüfungen und reale Abnahme

Die beiden Livefolgen werden vor der Korrektur als fehlschlagende Regressionen
nachgestellt. Weitere Fälle prüfen 3P, reine Strom-/reine Leistungsantwort,
einzelne neue Phase, bereits erreichtes Stromniveau, Fristablauf, spätere
Entsperrung, Defizite, harte Grenzen und zurückgenommene Zuteilung.

Softwareprüfungen ersetzen keine reale Betriebsabnahme. Nach Installation sind
natürliche Erhöhungen, Halteentscheidungen, reale Lastantwort und Netzbezug
gegenüberzustellen. Ein Tageswert für zusätzliche nutzbare Energie ist mit
diesem kurzen Ausschnitt nicht belegt. Das produktive System wurde nicht verändert.
