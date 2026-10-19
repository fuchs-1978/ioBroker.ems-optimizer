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
In der ausdrücklich beauftragten Nachprüfung vor dem Merge wurde dieser
Test mit kontrollierter monotoner Zeit abgesichert. Alle bestehenden Assertions
und das 10-ms-Budget bleiben erhalten; ein zusätzlicher Test sichert die
Nichtausgabe einer Abfrage nach Budgetverbrauch vor Transportbeginn ab.
Die produktive Readerimplementierung wird nicht geändert.

Im Push-CI-Lauf 39209612828 des Zwischencommits ac22f3f scheiterte Node 22 bei
`npm test`, während der PR-Lauf desselben Commits auf beiden Node-Versionen und
Push-Node-24 erfolgreich waren. Die CI meldete nur den Prozessfehler; der
Detail-Logdownload war aus dieser Umgebung durch die Netzwerkregel blockiert.
Dieser konkrete CI-Fehler wird deshalb nicht rückwirkend eindeutig diesem
Historientest zugeschrieben. Der endgültige Commit wird auf beiden Laufzeiten
vollständig erneut geprüft, bevor er gemergt wird.

## Bereits bekannte fachliche Restarbeiten

- #181: reale Recorder-Verlustursache und Verlustfreiheit unter tatsächlicher Last.
- #7/#8: reale Regelruhe, Phasenwechsel, Rückgabe und Pumpen-/Durchflussnachweise.
- #166: Eigenstrom-/Teilnehmerbilanz zusätzlich zur bereits vorhandenen GZF-Berechnung.
- Offizielle ioBroker-Integration-/Checkerabnahme und offene Abhängigkeits-PRs.

Diese Themen werden hier weder implementiert noch als erledigt bewertet.
