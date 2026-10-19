# 0.17.0-alpha.105 – EQE-Regelruhe

## Belegter Auslöser

Am 19.10.2026, Europe/Berlin, Sitzung 1792414683001:

- Sequenz 511, 15:00:14: 17 → 14 A trotz 56,1 W Rückspeisung. Die alte Zuteilung verwendete 3090 W; frisch bestätigt waren 16,7 A / 3720 W. Der bisherige Halteschutz verlangte zusätzlich mindestens 3795 W bei pauschal 230 V und lehnte die reale Aufnahme ab.
- Sequenz 600, 15:00:26: 17 → 12 A bei 138,6 W Bezug. Die Antwort stand noch aus; die nominale Softgrenze verstärkte ein Defizit von weniger als einem Ampere auf fünf Ampere.
- Sequenz 699, 15:00:38: 15 → 14 A trotz 773,8 W Rückspeisung und bestätigten 14,7 A / 3300 W.

## Korrektur

Nur bestehende, bestätigte und frisch gemessene PV-Ladung darf über einer nominalen Softgrenze gehalten werden, sofern deren volle Nennleistung weiterhin gegen harte Grenzen und andere Verbraucher reserviert ist. Bei neuerer bestätigter Fahrzeugantwort darf eine ältere Zuteilung keine künstliche Rücknahme auslösen. Stromnachweis ersetzt dabei die zusätzliche unrealistische Forderung nach Nennspannung mal Strom.

Bei einem echten Defizit wird eine bereits laufende, bestätigte Stromvorgabe relativ um die zur Toleranzeinhaltung nötigen ganzen Ampere reduziert. Die Zuteilung muss diese Reduktion ausdrücklich zulassen, und die bisherige Nennlast muss weiterhin in das harte Budget passen. Alte Messwerte, fehlende ACKs, Tarife, Phasenwechsel und harte Limits erhalten keine Ausnahme. Erhöhungen behalten ihre bisherigen Zulassungen; alpha.104-Proben bleiben begrenzt.

Keine neuen Admin-Felder, keine Änderung an Polling oder Abschaltverzögerung. Es erfolgt keine automatische Installation oder Aktorbetätigung durch die Entwicklung.

## Erwarteter Nutzen und Abnahme

Vermeidung der belegten unnötigen Rücknahmen und anschließenden Wiedererhöhungen. Ein kWh-Gewinn lässt sich aus diesem kurzen Abschnitt ohne Vergleichsbetrieb nicht belastbar beziffern. Software-Regressionsprüfungen müssen die drei belegten Fälle und Gegenproben abdecken. Die reale Abnahme bleibt offen: natürliche PV-/Lastwechsel nach Installation auswerten, Stellfolgen, Netzabweichung, ungenutzte Energie und Datenlücken vergleichen. Harte Grenzen müssen jederzeit wirksam bleiben.
