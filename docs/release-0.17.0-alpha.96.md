# 0.17.0-alpha.96

Recorder-Verlustepisoden werden jetzt in begrenzter Form historisch erhalten:
Sitzung, Ereigniszeit und Sequenzbereich, tatsächlich getroffene Anzahl-/Bytegrenze,
abgelehnter Umfang sowie Queue-, Warte- und Appendkontext erscheinen im nächsten
erhaltenen Original unter `recording.localJournal`. Die vorhandenen
Journal-Metadaten tragen die begrenzte Historie über geordneten Shutdown und
Neustart; Verdrängungen aus der Detailhistorie werden ausdrücklich gezählt.

Die Ergänzung schließt die nach erneuter Codeprüfung bestätigte Diagnoselücke
aus [#181](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/181).
Das begrenzte Batch-Append aus #172 bleibt bestehen. Queuekapazität,
Aufzeichnungsinhalt, Reihenfolge, fsync und SQL-Abfragebudgets bleiben erhalten.
Es werden keine zusätzlichen privaten Vollframes exportiert.

Regressionen ergänzen die vorhandenen Slow-Append-/Batch-/Backpressuretests um
große Rohkontexte, getrennte Grenzen, dauerhafte Episodennachweise,
Warte-/Appendmessung, begrenzte lokale Konkurrenz sowie Sitzung/Shutdown.
Der Veröffentlichungsworkflow prüft die vollständige Testsuite,
Paketmanifeste und den Paketinhalt vor Erstellung dieses Tags und Prereleases.

Die produktive Ursache Quellenburst gegenüber Abarbeitungsverzug bleibt offen.
Dies ist eine Diagnoseverbesserung, keine nachgewiesene Performancekorrektur.
Softwaretests ersetzen keine reale Folgeabnahme und versprechen keine
Scorepunkte. Neue Verluste müssen anhand der neuen Historie zeitlich erklärt
werden; anhaltende Verlustfreiheit unter tatsächlicher Last bleibt später zu belegen.

EHZ und alpha.95-Regelung erhalten keine weitere Korrektur. Ihre reale Abnahme
wird weiter beobachtet; Pumpen-/Durchflusswirkung und nicht beobachtete
Betriebsfälle bleiben offen. Die Veröffentlichung installiert oder aktiviert
nichts in ioBroker und schließt keine Issues.

[Diagnose, Grenzen und nächste SQL-Prüfpunkte](issue181-recorder-loss-episodes.md) ·
[Lesende EHZ-/SMA-/PV-Prüfung](issue181-observation.md)
