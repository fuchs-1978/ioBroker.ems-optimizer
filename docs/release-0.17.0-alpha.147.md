# 0.17.0-alpha.147 – Langsame Journal-Lesung blockiert Recorder-Appends nicht mehr

## Beleg und Ursachenabgrenzung

Am25.10.2026, Sitzung1792939197779 unter laufender alpha.146:108 lokal abgewiesene Originale, Sequenz97–204, Ereigniszeiten15:40:29.827–15:40:42.511 MEZ,9.445.810 Rohbytes. Die Recorderqueue hielt95 Originale/8.369.204Bytes bei128Records/8.388.608Bytes Grenze. Im ersten Verlustkontext lief eine lokale `read-batch`-Operation bereits9.844ms; die aelteste Queuewartezeit stieg bis21.357ms. Das Randintervall ist keine pauschale Messausfalldauer.

Der bisherige Code hielt waehrend eines ganzen Publikations-Lesebatches die gemeinsame Journal-Mutationswarteschlange. Eine einzelne festgehaltene Dateilesung blockierte dadurch auch sonst schreibfaehige Recorder-Appends. Dies ist offline reproduziert. Die Ursache der langen realen Dateilesung (Dateisystem/Host/Storage) ist damit nicht festgestellt; lokale Operationszeit ist keine isolierte SQL-Laufzeit. Verlorene Originale werden nicht wiederhergestellt.

## Korrektur und Grenzen

Genau eine begrenzte Lesebatch-Spur liest unveraenderliche Originaldateien mit weiterhin hoechstens vier Dateilesern. Auswahl und Pinning erfolgen atomar in der weiterhin serialisierten Mutationsspur. Die eigentlichen Lesezugriffe halten diese Spur frei: Appends samt bestehenden Datei-/Verzeichnissynchronisationen, SQL-Fences und Metadaten koennen fortfahren. Lokale Lese-I/O kann dadurch mit einem serialisierten Mutationsauftrag ueberlappen; SQL-Parallelitaet wird nicht erhoeht.

SQL-bestaetigte Bereinigung und Ablaufbereinigung ueberspringen jede Gruppe mit gepinnten Originalen. Kein Teil einer solchen Delta-Abhaengigkeitsgruppe wird geloescht. Pins werden auch bei Fehlern erst nach Abschluss aller beteiligten Lesezugriffe freigegeben. Laengen-, Datei-, Identitaets- und Hashpruefungen bleiben erhalten; ein beschaedigter Batch liefert keine gueltige Teilmenge. Spaetere SQL-Bestaetigungen werden bei Rueckgabe korrekt abgebildet. `close()` wartet auf alle vorher angenommenen Lesebatches, Pinfreigaben und Journalmutationen. Nach geschlossenem Journal entstehen keine neuen Leseauftraege.

Keine neue Datei-/Transportversion, Migration, automatische Wiederherstellung, Queuevergroesserung oder neue SQL-Abfrage. Rohqueue-/Journalgrenzen, Retention, ACK-/Originalnachweise und Regler-/Schutzregeln bleiben unveraendert. Ein unendlich langsamer oder ausgefallener Datentraeger kann weiterhin Appends blockieren; dies ist keine Garantie verlustfreien Betriebs unter beliebiger Last.

## Nachweise

Neue Regressionen pruefen fortgesetztes dauerhaftes Schreiben bei einer festgehaltenen Dateilesung, gleichzeitig eintreffende exakte SQL-Bestaetigung, gruppenweises Pinning/Loeschen, Ablaufzaehler, Hoechstzahl paralleler Leser, Cursor-/Bytegrenzen, beschaedigte Geschwister ohne Teilergebnis und geordnetes Beenden einschliesslich angenommener wartender Lesebatches. Zwei Kernregressionen scheitern unter alpha.146. Eine weitere Regression nutzt den echten Recorder und Codec:140 aufeinanderfolgende grosse Quellkontexte waehrend einer festgehaltenen Lesung, keine Abweisung, exakte Quellen/ACK/q/NULL/Zeiten und bytegleiche Wiederaufnahme nach Neustart. Keine Anlagen- oder Storage-Benchmarks.

Die zwei bisherigen historischen Recordervergleichsszenarien erhalten in beiden Baeumen ausdruecklich dieselbe neue Lese-/Drainpolitik; keine Felder, Originale, Hashes oder Stellbefehle werden aus Vergleichen entfernt. Die absichtlich geaenderte Konkurrenzregel wird separat vor/nach geprueft. Tests, Paket-/Artefaktpruefung und CI werden im PR belegt.

## Noch erforderliche reale Abnahme

Nach manueller Installation neue natuerliche Sitzungen pruefen: RecordDropped/RecordWriteErrors samt Session/Sequenz/Ereigniszeit, Rohqueuebytes/-alter, `activeRead` getrennt von `activeOperation`, Journalfehler, Originalbestaetigungen und Ablauf-unbestaetigt. Ein kleiner aktueller Puffer allein ist keine Langzeitabnahme. Neue Verluste trotz dieser Version gezielt zuordnen, keine alten SQL-Fenster erneut laden oder kuenstliche Quellen-/Storage-Last erzeugen. Keine Installation, Neustarts oder Anlagenaenderung durch diesen Entwicklungsauftrag.
