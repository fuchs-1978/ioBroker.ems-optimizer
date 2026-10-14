# 0.17.0-alpha.78 – Wiederaufnahme nach SQL-Adapterupdate

## Belegter Auslöser

Am 14.10.2026 wurde während des EMS-Starts sql.0 aktualisiert. Der Historienaufbau erhielt `No database connection`; anschließend blieben Plan.Valid/Control.Valid falsch, weil ein fehlgeschlagener Startup-Aufbau erst nachts wiederholt wurde. Ein manueller EMS-Neustart stellte die gültige Historie und Steuerung wieder her. Unabhängig davon blieb die persistente Recorder-Sperre für eine während des SQL-Prozesswechsels verwaiste Abfrage erhalten. Ein weiterer EMS-Neustart löscht diese Sperre zu Recht nicht.

## Lösung ohne direkten NAS-Zugriff

Der konfigurierte MySQL/MariaDB-SQL-Adapter wird als vorhandener lesender Abfrageweg verwendet. Höchstens drei Versuche je ursprünglicher Anfrage und laufendem EMS-Prozess, mindestens 60 Sekunden Abstand; kein Versuch während des Historienaufbaus. Pro Versuch maximal zwei sequenzielle Metadatenabfragen:

1. `SHOW GRANTS` belegt bestehende globale PROCESS-Sicht (oder globale ALL PRIVILEGES); Rechte werden niemals verändert. Ohne diesen Nachweis bleibt die Sperre bestehen.
2. Eine begrenzte PROCESSLIST-Abfrage muss keine andere aktive Datenbankarbeit zeigen. Die eigene Prüfung ist ausgenommen. Aktive oder nicht vollständig bewertbare Arbeit bleibt gesperrt.

Zusätzlich müssen frische bestätigte alive-/uptime-Daten einen SQL-Prozesswechsel nach der ursprünglichen Anfrage zeigen, mit entsprechendem Stoppsignal und neu aufgebauter Verbindung; vor/nach der Prüfung muss dieselbe Generation bestehen. Eine bloße connection=true-Anzeige oder ein abgelaufener Timer genügt nicht. Metadatenprüfungen besitzen selbst einen dauerhaften offenen Anfragevermerk; ein unbekannter Prüfabschluss verhindert weitere Versuche auch über EMS-Neustarts. Nur tatsächliche Callback-Antworten bzw. ein nachweislich lokal nie gesendeter Auftrag lösen diesen Prüfvermerk.

Dieser kombinierte Nachweis erlaubt das Ende der verwaisten Anfrage festzustellen und die normale begrenzte Recorder-Prüfung wieder aufzunehmen. Er bestätigt keine SQL-Records und löscht keine unbekannten Originale. Der Fehler-Backoff bleibt bis zum frischen exakten Originalnachweis bestehen. Das alpha.77-Paketformat und die bestehenden Journal-/Retentions-/Schutzverträge bleiben erhalten.

`Debug.Shadow.RecordSQLRecoveryStatus` zeigt Erfolg oder konkreten Blocker. Fehlende vorhandene Datenbankrechte werden ausdrücklich nicht automatisch erteilt; die Version kann in diesem Fall keine erfolgreiche Wiederaufnahme versprechen.

## Historien-Wiederanlauf

Nach beobachtet abgeschlossenem Fehler versucht ein noch nicht gültiger Startup-Historienaufbau höchstens drei Wiederholungen mit mindestens 60 Sekunden Abstand. Kein paralleler Aufbau; eine unbekannte laufende Abfrage oder offene Recorder-/Metadatensperre verhindert Wiederholungen. Ein verspäteter tatsächlicher Callback beendet nur seine offene Anfrage und gibt danach die begrenzte Wiederholungsmöglichkeit frei. Fehlende Profile bleiben ungültig; alte Zähleranzeigen ersetzen keine neue Startbasis. Ein bereits gültiges Profil bleibt bei fehlgeschlagenem Hintergrundrefresh wie bisher erhalten.

## Verifikation und Grenzen

Regressionen prüfen Prozesswechsel plus globale Ruhe, fehlende Rechte, aktive Abfragen, Generationwechsel während der Prüfung, endliche/zeitlich begrenzte Versuche, unbekannte Metadaten-Timeouts, persistente Sperren über Neustarts, lokale Abbruchgrenzen und bestätigte versus unbekannte Historienfehler. Vollständige Tests und Node-20-CI vor Veröffentlichung erforderlich.

Nach manueller Installation zuerst RecoveryStatus lesen: tatsächlicher Endnachweis oder konkreter Blocker. Danach frische exakte SQL-Bestätigungen und Abbau unbestätigter Records/Bytes ohne zusätzliche Altersverluste nachweisen. Control.Valid/Plan.Valid und reale Geräteantworten getrennt prüfen. Kein automatischer NAS-/SQL-/EMS-Neustart, keine Installation, Konfigurations-/Rechte-/Indexänderung oder Steuerungsfreigabe. Alte verlorene Daten werden nicht wiederhergestellt; kein Scorebonus allein durch Veröffentlichung.
