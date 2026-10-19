# 0.17.0-alpha.109 – Recorder-Abschluss vor EMS-Neustart

## Belegter Betriebszustand

Am 19.10.2026 um 16:34 Uhr Europe/Berlin enthielt das Journal 10302 unbestätigte Records und 134201132 von 134217728 erlaubten Bytes (128 MiB). Die aktuelle Recorder-Queue war leer; es gab keine gemeldeten Datei-Lese-/Schreibfehler. Der Rückstau liegt deshalb im dauerhaften Journal und ist kein erneuter Nachweis des früheren Queue-Bursts.

Eine SQL-Historienprüfung mit verificationId decision-record:c851248f-f93a-4402-a937-7330ac08af86 blieb seit 15:13:09,407 offen. Der anschließende EMS-Neustart begann um 15:13:12,650. SQL war verbunden und seit dem 14.10. im selben Prozess aktiv. Die aktuelle Delivery meldete backendBlocked=true und persistentVerificationFence=true, ohne neue SQL-Anfragen auszugeben. Der vorhandene Wiederanlauf war korrekt mangels beobachtetem SQL-Neustart gesperrt. Aus einer Verbindung oder einem alten Timeout darf kein abgeschlossener Backend-Auftrag abgeleitet werden.

Die genaue ursprüngliche SQL-Ausführung beziehungsweise Callback-Ankunft kann rückwirkend nicht nachgewiesen werden. Der geprüfte Code schloss das Journal ohne Abschlussbarriere für eine noch laufende Delivery-SQL-Operation. Eine danach beobachtete Antwort kann ihre dauerhafte Sperre nicht mehr sicher abschließen. Dieser zum beobachteten Neustart passende Grenzfall ist reproduziert.

## Korrektur

Delivery erfasst die tatsächlich laufenden Historienoperationen einschließlich der dauerhaften Abschlussbuchung, auch nach lokalem Timeout. Beim geordneten Beenden werden zunächst Aktoren bereinigt beziehungsweise die geprüfte Wallbox-Übergabe gesichert und neue Delivery-Arbeit gestoppt. Danach bleiben bis zu zwei Sekunden für tatsächliche Antworten und ihre Sperrenbuchung; erst anschließend schließt das Journal. Ein ioBroker-Stopzeitrahmen von zehn Sekunden schafft dafür Raum, ohne die zweisekündige Diagnosewartezeit zu verlängern.

Eine echte SQL-Antwort beendet nur die passende Anfrage. Gespeicherte Records bestätigt weiterhin ausschließlich der unabhängige exakte Historienvergleich. Unbekannte oder zu späte Abschlüsse bleiben gesperrt. Geerbte Sperren werden beim Start mit Zeitpunkt und Journalbelegung ausdrücklich geloggt. Weder Kapazitäten, Batch-Appends, SQL-Abfrageparallelität noch die Wallboxregelung werden verändert. Keine bestehenden Daten werden gelöscht.

## Bereits vorhandene Sperre lösen

Das Update allein ist kein Abschlussnachweis für die bereits verwaiste alte Anfrage. Nach Installation ist ein einmaliger Neustart von sql.0 durch den Betreiber erforderlich. EMS startet SQL nicht selbst neu. Anschließend benötigt die vorhandene Recovery eine mindestens 60 Sekunden stabile neue SQL-Prozessgeneration, nachgewiesene globale PROCESS-Sicht und eine lesend geprüfte ruhige Datenbank. Erst dann kann sie die alte Anfragesperre freigeben; die Speicherabnahme bleibt separat. Fehlende Rechte oder laufende Datenbankarbeit bleiben sichtbar gesperrt.

Danach über die reguläre begrenzte Zustellung prüfen: RecordSQLRecoveryStatus, RecordDeliveryStatus.backendBlocked, sinkende unbestätigte Journalbelegung und neue exakte SQL-Bestätigungen. Keine zusätzlichen Vollabrufe, keine höhere Parallelität, kein pauschaler Fence-Reset. Bereits verworfene Diagnoseereignisse lassen sich damit nicht nachträglich wiederherstellen. Normale SQL-Signalhistorie ist davon getrennt zu bewerten.

## Prüfung und Grenzen

Regressionen prüfen echte späte Callback-Ankunft nach lokalem Timeout mit anschließendem Journal-Neustart, unverändert unbestätigte Record-Inhalte, begrenzten Ablauf ohne Callback, geerbte Sperre ohne laufende Prozessoperation, keine zusätzlichen SQL-Aufträge sowie Abschaltreihenfolge und Fehlerpfad. Ein harter Prozessabbruch oder eine Antwort außerhalb des Abschlussfensters kann weiterhin eine unbekannte Anfrage hinterlassen; die Sicherheitsregel bleibt bewusst bestehen.

Produktiver Wiederanlauf und Verlustfreiheit sind nach Installation und Betreiber-Neustart von SQL gesondert nachzuweisen. Die fehlenden 20-Uhr-Auswertungsdaten werden nicht durch Softwaretests ersetzt.
