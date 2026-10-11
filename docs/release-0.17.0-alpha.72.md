# 0.17.0-alpha.72

## Anlass und Änderung

Am 11.10.2026 meldete die installierte alpha.71 ein volles lokales Journal (134.203.648 von 134.217.728 Bytes), 4.359 noch nicht SQL-bestätigte Records und rund 1,49 Millionen abgewiesene Aufzeichnungsversuche. Die Regelung lief weiter. Der letzte SQL-Fehler war `local query deadline; backend completion unknown; verification stopped`. Diese Angaben sind Diagnose-Snapshots, keine vollständige Nacht-Historie.

Der Codevergleich reproduziert eine unnötige Qualitätskante: interne Cache-Publikationen ohne `q` und ioBroker-Echos mit `q=0` wurden als unterschiedliche Qualität behandelt. Beide bedeuten hier gültige Qualität. Eigene Cache-Publikationen verwenden jetzt `q=0`; die Diagnose normalisiert ausschließlich die Ereignisentscheidung für fehlendes `q`. Originale Quellenproben behalten alle Metadaten unverändert. Echte NULL-, ACK-, Fehlerqualitäts-, Wert- und Zeitrücksprungereignisse bleiben erfasst. Dieser reproduzierte Mitfaktor beweist nicht die alleinige Ursache der SQL-Zeitüberschreitung.

Nach einer Kapazitätsablehnung pausieren weitere aussichtslose Encodes/Appends einschließlich bereits wartender Frames. Fehlende Aufnahmeversuche werden ausdrücklich gezählt, ihre Journal-Verlustmeldungen höchstens einmal pro Sekunde gebündelt und beim Abschluss nachgetragen. `Debug.Shadow.RecordBackpressure` zeigt die Pause. Die Aufzeichnung setzt erst bei geprüftem freiem Platz und leerer Appendqueue mit einem neuen Snapshot fort. Unbestätigte Originale werden nicht gelöscht, der Journaldeckel wird nicht erhöht. Bei dauerhaft ausbleibendem SQL-Nachweis ist weiterhin keine dauerhafte verlustfreie Aufzeichnung möglich.

Bei einem tatsächlichen SQL-Fehler mit beobachtetem Backendabschluss werden spätere Nachweisfenster und Limits adaptiv halbiert. Es gibt keinen Retry im fehlgeschlagenen Tick, keine Parallelisierung und keinen pauschal erhöhten Timeout. Ein lokales Timeout mit unbekanntem Abschluss bleibt durch die bestehende dauerhafte Sperre blockiert. Ein später beobachteter Abschluss derselben Anfrage kann die Sperre nach dem bestehenden Vertrag lösen; Adaptergesundheit und Neustart allein können das nicht.

## Prüfung und Grenzen

Neue Regressionen reproduzieren falsche q-Kanten, die volle Queue und fehlende adaptive Fehlerfenster auf unverändertem alpha.71-Code. Prüfungen erfassen unveränderte Rohmetadaten, echte Qualitäts-/Wertwechsel, begrenzte Appendversuche, kumulative Verluste, Shutdown-/Neustartnachweise und einen vollständigen neuen Snapshot nach der Pause. Die bestehende vollständige Testsuite sowie Paket-/JSON-Prüfung und Node-20-GitHub-CI müssen vor Veröffentlichung bestehen.

Keine Änderungen an ioBroker-Konfiguration, SQL-Einstellungen, Bestandsskripten, Master, Aktoren, Leistungsregelung oder Schutzgrenzen. Kein automatisches Installieren oder Aktivieren. Fehlende Nachtaufzeichnungen bleiben unbekannt; Softwaretests beweisen keine erfolgreiche reale 24-h-Aufzeichnung, SQL-Abnahme oder RAM-Einsparung. Nach Installation sind Ereignisdichte, Journalfüllung, Verlustzähler, Rückstauabbau und SQL-Bestätigung erneut im Betrieb zu prüfen.
