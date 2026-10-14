# 0.17.0-alpha.77 – Diagnoseaufzeichnung und SQL-Transport

## Belegte Probleme

Am 14.10.2026 blieb das lokale Journal unter installierter alpha.76 nahezu voll, obwohl weitere SQL-Originalnachweise eintrafen. Der alte normale Versand war auf vier einzelne Originalrecords je fünf Sekunden begrenzt. Bereits sekündliche Quellenpakete können diesen Durchsatz überschreiten; die Diagnose kann dann auch bei gesundem SQL nicht dauerhaft aufholen.

Zusätzlich benutzen EHZ- und Wallboxtreiber unterschiedliche Kriterien für `Control.Mode`: der eine elektrische Aktivität, der andere weiter gehaltenen Ausgangsbesitz. Bei einem ausgeschalteten, noch verantworteten EHZ entstehen deshalb künstliche Wechsel zwischen EHZ und bereit. Die Regression scheitert am unveränderten alpha.76-Code.

## Änderung

- Beide Treiber zeigen den Ausgangsbesitz konsistent an. Elektrische Aktivität bleibt separat in `OutputActive`; die EHZ-Rücknahme-/Reservierungsbedingungen bleiben unverändert.
- Der normale Versand übernimmt bis zu 16 unveränderte Originalrecords je fünf Sekunden. Mehrere kleine Originale teilen einen SQL-State-Schreibaufruf als `{schema:4,frameType:"transport-bundle",records:[originalJSONStrings]}`. Einzeloriginale bleiben im alten Format.
- Höchstens vier State-Schreibaufrufe je Versandrunde; Paketgrenze 128 KiB, insgesamt höchstens 512 KiB einschließlich Verpackung. Ein größeres bestehendes Einzeloriginal bleibt einzeln im bisherigen Journal-/Batchlimit. Keine Erhöhung der Abfrageparallelität: weiterhin eine Abfrage pro Prüfrunde, vorhandene Zeitfenster-/Antwort-/Timeoutgrenzen.
- Im Fehlerbetrieb weiterhin höchstens ein Original und eine Diagnoseabfrage je 30 Sekunden nach der Pause. Ein unbekannter Backendabschluss bleibt gesperrt, auch über Neustarts.
- Jedes Original behält seinen exakten JSON-String, Hash, Session/Sequenz, Ereigniszeit, NULL, Rohzeitstempel, ACK/q und Verlustmarker. Ein SQL-Paket ist keine simultane Reglerentscheidung. Sein SQL-Zeitstempel ist der Transportzeitpunkt.
- Der SQL-Prüfer validiert die gesamte Paketstruktur und bestätigt anschließend jedes passende Original anhand seines unabhängigen exakten Hash-/Identitätsnachweises. Veröffentlichung allein bleibt kein Speichernachweis. Bestätigte Ketten werden wie bisher erst vollständig und geschlossen entfernt; aktive Basis und unbekannte Originale bleiben erhalten.
- Batchdecoder, Exportdecoder und sequenzieller Historienleser entpacken gemischte alte/neue SQL-Werte, erhalten originale SQL-Seiten und deduplizieren danach die Originalidentitäten.
- `Debug.Shadow.RecordDeliveryStatus` zeigt Originalversuche, tatsächliche Transportaufrufe, Bestätigungen, Prüffenster, Rückstau, Limits und letzte Abfrage getrennt. Keine vollständige Abfragechronik im State und keine automatische SQL-Aktivierung dieses Diagnosestates.

## Tests und reale Prüfung

Regressionen prüfen identische Besitzanzeige bei Nullauftrag und anschließender Freigabe, endlichen gesunden Rückstau mit echtem Journal und Snapshot/Delta-Gruppen, bytegenaue Paketrekonstruktion, rohe SQL-Provenienz, Größen-/Aufruf-/Trackinggrenzen, ungesendete Suffixe, fehlerhafte/nestende Pakete, widersprüchliche Identitäten und gedrosselten Wiederanlauf. Die vorhandenen unbekannten Timeout-, Neustart-, ACK-, Schutz- und Aktortests bleiben maßgeblich.

Nach manueller Installation prüfen: frische Originalereignisse der neuen Sitzung, stabile Modusanzeige, gültige Pakete, positive unabhängige SQL-Nachweise, sinkende unbestätigte Records/Journalbytes ohne zusätzliche Altersverluste, explizite Fehlfenster und unveränderte Geräteantworten. Ein zurückgehender Altbestand allein durch 24-h-Expiry ist kein Aufholen.

Kein NAS-/Datenbankfix und keine Garantie gegen externe Schnittstellenabbrüche. Frühere nicht aufgezeichnete Records werden nicht wiederhergestellt. Keine Änderungen an SQL-Konfiguration, Retention, Reglerbudgets, Schutzgrenzen, Aktorbefehlen oder produktiver Installation. Softwaretests ersetzen weder einen realen vollständigen 24-h-Abruf noch die Betriebsabnahme.
