# 0.17.0-alpha.160 – Journal-Segmente und gezielte Datenbank-/Speicherwartung

Ausgangs-main: `f98eea67ff76cb49f433e787e645ac012538c84a` / alpha.159.
Auftrag vom 28.10.2026 zu #60: weniger lokale Dateioperationen, gezielte
Index-/Sperrprüfung und optionaler Wechsel auf einen belegbar geeigneten lokalen
Speicher. Keine alten SQL-Fenster, künstlichen Anlagenversuche oder neuen
produktiven Protokollierungen. Batch-Appends, Kompression, SQL-Pakete,
Late-Callback-Verarbeitung und getrennte Lesespur waren bereits vorhanden.

## Implementierter Segmentpfad

Der produktive Recorder schreibt kompakte Originale eines bereits vorhandenen
Append-Batches jetzt in unveränderliche Segmente. Höchstens 16 Originale und
512 KiB Originalpayload pro Batch; der bestehende begrenzte Einzelrecordpfad
behält seine bisherige Größenobergrenze. Neue Checkpoints, Sitzungen oder
Sequenzunterbrechungen beginnen ein eigenes Segment. Es gibt keine zusätzliche
Wartezeit zur Batchbildung. Große oder unabhängige Vollframes werden daher nicht
zwangsläufig gebündelt; einzelne Appends haben keinen garantierten Gewinn.

Für acht aufeinanderfolgende kompakte Originale im Offline-Vergleich sinken die
Originaldatei-Syncs und Links jeweils von acht auf eins. Die beiden
Verzeichnisbarrieren bleiben. Das ist ein belegter Operationsrückgang bei dieser
Last, keine gemessene Beschleunigung auf der realen Anlage und keine Behebung
der separat beobachteten langen SQL-Transportantworten.

- Originalpayload, Ereigniszeit, Sitzung/Sequenz und SHA-256 bleiben unverändert;
  zusätzlich schützt eine Segmentprüfsumme das vollständige Paket.
- Registrierung/Veröffentlichung erst nach File-Sync, Link, Commit-Directory-Sync,
  Entfernen des temporären Namens und Cleanup-Directory-Sync.
- Kein Segment überspannt eine Wiederanlauf-/Abhängigkeitsgruppe. Erst eine
  unabhängig bestätigte geschlossene Gruppe darf unter dauerhaftem Marker
  bereinigt werden. Physische Segmentbytes bleiben bis zum letzten Mitglied.
- Eine gepinnte Lesung schützt ihre vollständige Gruppe. Langsame Lesungen
  blockieren weiterhin keine Appends; höchstens vier parallele Dateileser/-schreiber.
- Neustart liest Altdateien und Segmente in Ordinalreihenfolge. Intakte temporäre
  Segmente werden nach erneutem Sync exklusiv übernommen; defekte Pakete bleiben
  als unbekannt/ungültig erhalten, ohne einen scheinbar gültigen Präfix auszugeben.
- 128 Records/8 MiB Rohqueue, Journalgrenzen, Retention, Verluste, Fristen,
  SQL-Abfragegrenzen und unabhängige Datenbanknachweise bleiben erhalten.
- Keine Änderung an Regler, Ausgängen, Phasenumschaltung oder Wärmeplanung.

## Datenbank und Speicher prüfen – auf dem ioBroker-Host

Die verbundenen Werkzeuge erlauben keine Shell-/MySQL-Ausführung auf dem Host.
Daher wurde weder der produktive Index verändert noch eine SSD-Migration
vorgenommen. Die folgenden Werkzeuge sind vorbereitet; die tatsächliche
Konfiguration und der Pfad müssen am Host ermittelt werden. Beispielwerte sind
Platzhalter, keine Feststellung des produktiven Datenbanknamens oder Speicherorts.

Der lokale MySQL-Client benutzt eine bereits eingerichtete private Clientkonfiguration
(`--defaults-file` ist hier eine absolute `--defaults-extra-file` für den Client)
oder `--login-path`. Keine Passwörter in Kommandozeilen oder Diagnoseberichte.

```sh
node tools/inspect-storage-sql.js --database DATENBANKNAME \
  --journal /TATSAECHLICHER/PFAD/decision-record-journal \
  --defaults-file /PRIVATER/PFAD/mysql-client.cnf
```

Standardmäßig rein lesend: `SHOW INDEX`, ein enges `EXPLAIN` des existierenden
Nachweis-SELECTs, höchstens 32 Prozess-/Metadatenlock-/Transaktionszeilen ohne
Abfragetexte sowie Mount-/Kapazitäts-/I/O-Angaben (`findmnt`, `df`, optional `iostat`).
Es werden keine Historienwerte abgerufen. Fehlende Datenbankrechte werden als
unbekannt ausgegeben; unauffällige Momentaufnahmen erklären alte Verzögerungen
nicht nachträglich. Ergebnisse können private Host-/Benutzernamen enthalten und
gehören nicht ungeprüft in öffentliche Issues.

Nur wenn kein sichtbarer vollständiger BTREE-Index mit führenden Spalten `(id,ts)`
existiert, kann derselbe Aufruf mit `--apply-index` ihn ergänzen. Dafür ist
bestätigtes InnoDB erforderlich. Der feste Indexname darf nicht bereits anders
belegt sein; `ALGORITHM=INPLACE, LOCK=NONE` und kurze sitzungsbezogene Lockfristen
verhindern einen automatischen blockierenden Fallback. Ein vorhandener passender
Index führt zu keiner Schemaänderung. Keine Pool-/Global-/EMS-Timeoutänderung,
kein `OPTIMIZE TABLE`, kein blinder Indexaufbau. Auch Online-DDL erzeugt reale
Arbeit: bei lokalem Timeout kann die DB-Operation noch laufen; vor jeder
Wiederholung den tatsächlichen Datenbankabschluss prüfen, nicht einfach erneut starten.

## Optional auf lokalen Speicher wechseln

Erst nach dem Mount-/Latenzbefund einen geeigneten dauerhaften lokalen Datenträger
wählen. `/tmp`, RAM-Dateisystem und ein nur vermuteter SSD-Pfad sind ungeeignet.
Während des Betriebs keine Journaldateien verschieben. Adapter geordnet stoppen;
vor der Wiederaufnahme die normale Ausgangs-/Zuständigkeitslage berücksichtigen.

```sh
# Als ioBroker-Benutzer, nach geprüftem Adapterstopp; Elternverzeichnis vorab anlegen.
node tools/copy-decision-journal.js \
  --source /BISHERIGER/PFAD/decision-record-journal \
  --destination /LOKALER-SSD-ROOT/ems-optimizer.0/decision-record-journal \
  --namespace ems-optimizer.0 --stopped-adapter
```

Die Quelle bleibt unverändert. Ziel muss neu sein; private Rechte, Größenlimits,
Byte-/Hashvergleich, unveränderte Quelldateien, Originalalter und offene
SQL-Fences werden geprüft. Wiederanlauf-/Gruppenprüfung erfolgt ausschließlich
an der Kopie. Eine beschädigte oder während des Kopierens geänderte Quelle
bekommt keine Freigabemarkierung. Fehlgeschlagene Ziele bleiben zur Prüfung
stehen und dürfen nicht benutzt werden.

Danach die native Instanzeinstellung `recorderJournalRoot` auf
`/LOKALER-SSD-ROOT` setzen und erst dann wieder starten. Der Adapter benutzt darin
`ems-optimizer.0/decision-record-journal`. Andere Instanzen haben eigene Unterordner.
Ohne Einstellung bleibt der bisherige Standardpfad. Mit Einstellung wird ein
passender Offline-Kopienachweis zwingend verlangt; kein stiller Start mit leerem
Journal und kein automatischer Rückfall auf den alten Pfad. Die alte Kopie ist
anschließend kein aktueller Fallback: vor einem Rückwechsel wieder offline kopieren.
Die Hostmigration ist hier vorbereitet, nicht ausgeführt oder real abgenommen.

## Rückwechsel auf alpha.159 oder älter

Ältere Binärstände kennen `.segment` nicht. Vor jedem Downgrade bei gestopptem
Adapter eine neue geprüfte Kopie im alten Format erzeugen:

```sh
node tools/copy-decision-journal.js \
  --source /AKTUELLER/PFAD/decision-record-journal \
  --destination /NEUER/PFAD/decision-record-journal \
  --namespace ems-optimizer.0 --stopped-adapter --legacy
```

Die Originale werden mit denselben IDs, Payloads, Prüfsummen und Alterszeiten in
Einzeldateien exportiert; offene SQL-Fences und Verlustmetadaten bleiben erhalten.
Erst nach erfolgreicher Prüfung das exportierte Verzeichnis an den vom alten
Adapter erwarteten Standardpfad übernehmen. Quelle/Datensicherung aufbewahren;
niemals den alten Adapter direkt auf dem Segmentverzeichnis starten. Diese
Schritte sind Offline-Wartung, keine automatische Änderung an der Anlage.

## Prüfung und verbleibende Abnahme

Neue Offline-Gegenproben prüfen Operationsanzahl vor/nach Segmentierung,
Original-/Hash-/Unicode-/NULL-/ACK-Erhalt, gemischte Alt-/Segmentdateien,
Checkpoint-/Sitzungsgrenzen, Teilbereinigung und Neustart, sämtliche
Durabilitätsphasen, unverfügbare/defekte Dateien, Pinning, Kapazitäten, Shutdown,
Expiry mit unbekannter SQL-Abdeckung, Offline-Kopien und Rückexport.
Softwareprüfungen, GitHub-CI und Merge werden im PR getrennt nachgewiesen.

Reale Folgeprüfung ausschließlich nach separat bestätigter Installation unter
natürlicher Last: neue Verlustzähler/Sitzungen, Queuebytes/-alter, Appendphasen,
frische exakte SQL-Nachweise und Ablauf-unbestätigt. Keine alten Fenster neu laden.
Physische Storage-/Pool-/DB-/Rücktransportursache bleibt offen; verlorene Originale
werden nicht wiederhergestellt. Kein neuer Score aus Code, Tests oder Installation.
Issue #60 bleibt offen.
