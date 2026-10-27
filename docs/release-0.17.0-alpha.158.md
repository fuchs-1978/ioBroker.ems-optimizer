# 0.17.0-alpha.158 – Recorderverluste trotz Beobachtungslücke zählen

Am 27.10.2026 meldete die Tagesbilanz 21 neue Recorderverluste. Vier erhaltene
Verlustgruppen derselben Sitzung belegen jedoch 53 (32 + 14 + 6 + 1).
Die ersten 32 Ereignisse von 17:32:23.363 bis 17:32:25.841 CET liegen innerhalb
der beobachteten Sampling-Lücke 17:32:14.515–17:32:26.858. Der bisherige Code
wertete Diagnosezähler nur zusammen mit dem maximal zehn Sekunden langen
Energie-Interpolationsintervall aus. Dadurch blieb genau dieser Anstieg aus.

Monotone Diagnosezähler werden jetzt unabhängig von der Energieinterpolation
verglichen, wenn beide Beobachtungen innerhalb derselben Periode und desselben
Prozesslaufs liegen. Negative Differenzen werden weiterhin nur als Reset
vermerkt. Die erste Probe nach Neustart bildet keine rückwirkende Zählbasis.
Über eine lange Lücke am Periodenwechsel bleiben Verluste zeitlich unzugeordnet.

Energieabdeckung, Quellenfrische, Schutzgrenzen, Stellbefehle, SQL-/Journalpfad,
Queues und Aufbewahrungsgrenzen ändern sich nicht. Die Korrektur behebt weder
die eigentliche Recorder-Verlustursache noch stellt sie verlorene Originale
wieder her. Bereits gespeicherte Tageswerte werden nicht nachträglich geändert.

Vier neue Offline-Regressionen decken den 32+21-Fall, Reset während einer Lücke,
Neustart ohne erfundene Basis und eine lange Lücke über der Periodengrenze ab.
Drei neue Fälle scheitern mit dem bisherigen Code; die Grenzgegenprobe besteht
bereits vorher. Ein bestehender Test wurde an die ausdrücklich beobachtete
Zählerzunahme während einer Lücke angepasst. Softwareprüfung ist keine reale
Folgeabnahme; diese erfolgt erst an neuen natürlichen Ereignissen nach Installation.
