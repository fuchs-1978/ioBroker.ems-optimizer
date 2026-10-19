# Getrennte Befunde außerhalb des Refactorings

## Zeitabhängiger Historien-Unit-Test

Im ersten abschließenden Node-22-Lauf unter gleichzeitig laufender Node-24-Suite
und Differentialreplays scheiterte der unveränderte Test
`run budget preserves a cursor and remaining windows after the outstanding request has returned`
in `test/decision-record-history.test.js:302`: 0 statt 1 Historyaufruf.

Der Test setzt `maxRunMs: 10`, erwartet aber, dass die erste Abfrage vor Ablauf
dieses realen Zeitbudgets startet. `tools/read-decision-records.js` prüft die
verstrichene monotone Zeit bereits vor der ersten Transportausgabe. Dauert der
Vorlauf unter Prozesslast länger, endet der Lauf korrekt ohne erste Abfrage;
die Testannahme ist dann nicht erfüllt. Test und Implementierung sind gegenüber
dem Ausgangscommit unverändert. Die isolierten 27 Historientests bestanden unter
Node 22; die vollständige Suite wurde anschließend ohne konkurrierenden zweiten
Suiten-/Replaylauf erneut geprüft.

Dies belegt keinen durch das Refactoring verursachten Regelungs- oder SQL-Fehler.
Möglicher separater Auftrag: diese Unit-Prüfung mit kontrollierter monotoner
Zeit absichern, einschließlich des bereits vor der ersten Abfrage erschöpften
Budgets. In diesem PR werden weder Assertions noch Zeitlimits noch die
Produktivimplementierung geändert.

## Bereits bekannte fachliche Restarbeiten

- #181: reale Recorder-Verlustursache und Verlustfreiheit unter tatsächlicher Last.
- #7/#8: reale Regelruhe, Phasenwechsel, Rückgabe und Pumpen-/Durchflussnachweise.
- #166: Eigenstrom-/Teilnehmerbilanz zusätzlich zur bereits vorhandenen GZF-Berechnung.
- Offizielle ioBroker-Integration-/Checkerabnahme und offene Abhängigkeits-PRs.

Diese Themen werden hier weder implementiert noch als erledigt bewertet.
