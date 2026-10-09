# Issue 123: DecisionRecords in begrenzten Fenstern lesen

## Belegte Diagnose und offene Ursache

Grundlage sind [Tages-Issue 123](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/123) und [Vergleich 116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/116). Bei dieser Untersuchung wurden ausschließlich ioBroker-Zustände, Objekte, Logs und SQL-Historien gelesen. SQL-Konfiguration, Aufzeichnungseinstellungen, Aktoren und bestehende Skripte wurden nicht verändert.

Die neue Werkzeugunterstützung behebt eine konkrete Lücke im bisherigen Arbeitsablauf: `decode-decision-records.js` prüft und rekonstruiert einen bereits gewonnenen Export, beschafft aber keine vollständigen begrenzten Rohseiten. Große oder am Limit abgeschnittene Einzelabfragen dürfen nicht als vollständiger Tag behandelt werden. Die Ursache der sporadischen Backend-/Connector-Timeouts ist weiterhin nicht abschließend geklärt.

| Dimension | Lesend belegter Befund | Aussagegrenze |
|---|---|---|
| SQL-Adapter | `sql.0`, Version 4.2.0, MySQL, alive/connection=true bei den Proben. | Verfügbarkeit beweist weder kurze Querylaufzeiten noch Speicherung jedes Records. |
| Konfiguration | Bestehende Retention 86400 s; Änderungen, kein Debounce/Block, kein periodisches Relogging für DecisionRecord. | Nur gelesen; keine Änderung. |
| Zeitlimit | Drei spätere 15-/30-s-Abfragen mit 80/100 Records scheiterten nach 25,737/25,751/26,040 s mit `ioBroker did not answer in time`. | Der Fehler sagt nicht, ob die Datenbank, SQL-Adapterantwort oder Connectortransport länger brauchte; kein serverseitiger Queryplan gemessen. |
| Kontrollquelle | WB-Leistung im selben 30-s-Fenster: sechs Zahlen, ca. 0,82 s; kleine 2-s-Recordfenster um 1,1–1,3 s lesbar. | Das begründet eine größenabhängige Untersuchung, keinen Beweis einer alleinigen Payloadursache. |
| Seitenpayload | Erfolgreiche Proben um 1,25–1,88 s und ca. 0,76–1,48 MB; auch ein langsamer Erfolg nach 22,88 s. Ein 4-s-Fenster erreichte das 50er-Limit bereits vor dem angeforderten Ende. | Fensterlänge allein begrenzt die Antwortmenge nicht. Limit und tatsächlicher letzter Rohzeitstempel müssen geprüft werden. |
| Aufzeichnung | 10.310 eindeutige alpha.58-Records, Sitzung `1791548168417`, Sequenzen 26408–36717. Ereigniszeiten 09.10.2026 13:42:48,008–14:10:08,388 UTC: 27:20,380 min, ca. 6,285 Records/s. | Ereignis-/Heartbeatfrequenz, keine zugesicherte konstante Frequenz oder SQL-Schreibrate. |
| Recordgröße | Diese eindeutigen Originalrecords ergeben 128.448.505 UTF-8-Bytes: Median 11.452, P90 15.757, Maximum 41.742 Bytes. | JSON-Hüllen des Connectors kosten zusätzlich; keine Hochrechnung als gemessene 24-h-Datenmenge. |
| Tatsächlicher Abruf | 133 protokollierte Abfragen, drei Timeouts, 88 Grenzduplikate, keine Lücke zwischen den erfassten Sequenzen. Einschließlich Überlappung 129.530.277 Rawrecordbytes und 149.260.190 Connectorantwortzeichen. | Dieser Teilabruf ist kein vollständiger 24-h-Abruf. Die ersten zehn Records sind Deltas; die vorherige Basis 26263 muss separat beschafft werden. Erst Snapshot 26418 liefert in diesem Teilarchiv eine eigene Basis. |
| Tagesanfang | Eine erneute 2-s-Probe am 08.10.2026 17:56:49–51 UTC lieferte acht alpha.53-Deltas 53766–53773 nach 1,175 s. | Kein Retentionsverlust des Tagesanfangs belegt. Ein vollständig fehlender älterer Abschnitt wäre getrennt zu untersuchen. |
| Recorderzähler | `dropped`/`writeErrors` werden je Sitzung aus den historischen Records ausgewiesen. | Aktuelle Nullen beweisen keine fehlerfreie vorherige Sitzung und keine vollständige SQL-Speicherung. |

Schema 3 und seine Vollsnapshots/Deltas sind bereits seit alpha.50 vorhanden ([Formatvertrag](compact-decision-records.md)); sie werden nicht erneut implementiert. Als zusätzliche verlustfreie Komprimierung wurde lokal die Auswahl eines kürzeren Eltern-`set` statt vieler Blattoperationen geprüft. 700 Originalrecords mit Vollbasis, 13:43:51–13:46:00 UTC, blieben exakt rekonstruierbar; 8.805.504 auf 8.642.677 Bytes ergeben aber nur 1,85 % Einsparung. Dieser begrenzte Nutzen erklärt oder behebt die Timeouts nicht. Der produktive Codec und die Recorderfrequenz bleiben deshalb unverändert.

## Lesendes Werkzeug und Transportvertrag

`tools/read-decision-records.js` exportiert `readDecisionRecordHistory(options)`. Das Modul hat keine SQL-Verbindungs-, Konfigurations- oder Stellfunktion. Ein vorhandener lesender Transport wird als `readHistory(request)` injiziert; lokale Senken schreiben Export und Abrufprotokoll. Das Werkzeug wird nicht automatisch im Adapter gestartet.

Der Transport muss **unaggregierte Originalzeilen** `{ts, val}` im inklusiven SQL-Zeitfenster liefern, mit dem angegebenen Recordlimit. Er liefert ein Array oder `{result: [...], error?: ...}`. Kein Resampling, keine künstlichen Randwerte, keine NULL-Unterdrückung, kein `newest only`. Das Format von `val` bleibt unverändert, auch ein String, `null` oder unlesbares JSON. Optional gemeldete `truncated: true`/`hasMore: true` erzwingen weitere Teilung. Adapter-/Connectorparameter für Datum, ID, `count` oder `limit` müssen im Transport passend umgesetzt werden; die jeweilige Originalanfrage wird zusätzlich dokumentiert.

Das Werkzeug fordert zunächst 15-s-Fenster mit Limit 80 an, einschließlich 60 s Vorlauf vor dem gewünschten Beginn. Sättigung wird konservativ angenommen, sobald das Limit erreicht ist, auch ohne ausdrücklichen Truncationhinweis. Solche Fenster werden halbiert und an der Grenze überlappend gelesen. Ein Limit in einem nicht weiter aufteilbaren Millisekundenfenster bleibt ein expliziter Blocker. Der Vorlauf ist eine Suchhilfe für die vorhergehende Vollbasis, keine Garantie: bleibt diese aus, bleibt die anfängliche Rekonstruktion unbekannt. Kein späterer Snapshot füllt die Vergangenheit nachträglich.

Alle Abfragen laufen nacheinander. **Transportfehler stoppen standardmäßig den gesamten Abruf**, weil eine Connectorablehnung keinen abgeschlossenen SQL-Backendauftrag beweist. `retryErrors: true` ist nur zulässig, wenn der Transport den abgeschlossenen oder abgebrochenen Backendauftrag unabhängig garantiert. Dann werden fehlgeschlagene Fenster bis zur festen Fehlerteilungstiefe halbiert. Nach einem lokalen Abfragelimit von standardmäßig 30 s wird ein `AbortSignal` ausgelöst und immer gestoppt, auch mit `retryErrors: true`. Ein ignoriertes Abortsignal wird ausdrücklich nicht als tatsächlicher Serverabbruch gewertet; es folgen keine weiteren Abfragen. Dadurch entsteht höchstens ein ausstehender Auftrag, keine unbeschränkte Reihe von Wiederholungen.

`onRawPage({query, rows})` archiviert jede erfolgreiche Rohantwort **vor** Deduplizierung und Teilung, einschließlich limitierter Elternseiten. So bleiben alle ursprünglichen SQL-Zeitstempel und die Herkunft erhalten. `onRecords(rows)` erhält die eindeutigen Zeilen aus den endgültigen Teilfenstern einschließlich des Basisvorlaufs; gleiche Session/Sequenz plus gleicher Inhalts-Hash werden einmal ausgegeben. Beide Originalzeilen einer widersprüchlichen Identität bleiben für die Konfliktprüfung des Decoders erhalten, und das Gesamtreplay wird als ungültig ausgewiesen. Die Querydiagnose zählt Payloadbytes vor Deduplizierung; `duplicates` zählt doppelte Identitäten der endgültigen Teilfenster, nicht alle Wiederholungen der archivierten Elternseiten.

`onQuery(query)` protokolliert Grenzen, Limit, Ergebnis, Dauer, Recordanzahl und Payloadbytes. `onReport(report)` speichert am Ende auch einen vorzeitig beendeten Teilabruf. Rawseiten und deduplizierte Ausgabe können fortlaufend in JSONL geschrieben werden; der Reader hält keine Tagespayload im Speicher. Identitäts-/Sitzungstabellen und Zahl der Abfragen besitzen feste Kapazitäten. Erreichen dieser Grenzen wird mit noch nicht abgedeckten Fenstern ausgewiesen. Eine fehlgeschlagene lokale Archiv-/Protokollsenke wirft einen Fehler und darf nicht als erfolgreicher Abruf behandelt werden.

Beispiel für eine **lokale** Auswertung mit einem bereits vorhandenen, separat geprüften lesenden Transport:

```js
const fs = require('node:fs/promises');
const {readDecisionRecordHistory} = require('./tools/read-decision-records');

// readHistory maps request.start/end/limit to the existing read-only connector.
// Use exclusive local files so a rerun cannot mix incompatible export sessions.
const raw = await fs.open('decision-raw-pages.jsonl', 'wx');
const records = await fs.open('decision-records.jsonl', 'wx');
const queries = await fs.open('decision-queries.jsonl', 'wx');
try {
    await readDecisionRecordHistory({
        readHistory,
        start: Date.parse('2026-10-08T17:56:49Z'),
        end: Date.parse('2026-10-09T17:56:49Z'),
        // retryErrors remains false unless backend completion is guaranteed.
        onRawPage: page => raw.write(`${JSON.stringify(page)}\n`),
        onRecords: rows => records.write(rows.map(row => JSON.stringify(row)).join('\n')
            + (rows.length ? '\n' : '')),
        onQuery: query => queries.write(`${JSON.stringify(query)}\n`),
        onReport: report => fs.writeFile('decision-report.json', JSON.stringify(report, null, 2), {flag: 'wx'})
    });
} finally {
    await Promise.all([raw.close(), records.close(), queries.close()]);
}
```

Dieses Beispiel stellt keinen Connector bereit und behauptet keine erfolgte 24-h-Ausführung. Reader und Transport ausschließlich außerhalb produktiver Steuerungs-/Bestandsskripte verwenden. Für das Replay die deduplizierten Rohzeilen einschließlich Basisvorlauf über den bestehenden Codec dekodieren; erst danach auf das gewünschte Ereigniszeitfenster beschränken. SQL- und Ereigniszeit werden getrennt geprüft und unverändert archiviert.

## Abnahme eines tatsächlichen 24-h-Abrufs

Für 08.10.2026 19:56:49–09.10.2026 19:56:49 Europe/Berlin sind die UTC-Grenzen 17:56:49Z–17:56:49Z des Folgetags. Installierte Version und aktuelle Sitzung müssen erneut gelesen werden; das historische Fenster enthält mehrere Versionen und Sitzungen. Ein Release belegt keine Installation.

1. Rohseiten, jede Originalanfrage und alle endgültigen Abfragefenster lokal archivieren. Erfasste Grenzen, fehlende Fenster, Timeouts, erreichte Limits und Kapazitätsabbrüche ausweisen. Keine vollständigen Rohdaten in Issue/PR veröffentlichen.
2. Session/Sequenz und Inhalts-Hash deduplizieren, Konflikte, Lücken und rückläufige Sequenzen je Sitzung prüfen. `recording.dropped`/`writeErrors` pro historischer Sitzung auswerten; `recordingCountersMissing` zählt fehlende/ungültige Zählerfelder, `counterRegressions` rückläufige Zähler innerhalb derselben Sitzung. Ein ausgewiesenes Maximum 0 bei zugleich fehlenden Zählern ist kein vollständiger Fehlerfreiheitsnachweis.
3. Die letzte vorangehende vollständige Basis lesen, anschließend lückenlose Deltas rekonstruieren. Fehlende/null/ungültige Quellen und unlesbare Records bleiben unbekannt; sie werden nicht als gemessene 0 W interpretiert. Originalereignisse, Befehlsversuche, ACK und rohe Quellenzeitstempel gegen einzelne Originalquellen prüfen.
4. `queryCoverageComplete`, `sequenceContinuityValid` und `replayValid` sind getrennte Prüfergebnisse. Selbst drei positive Werte beweisen nicht die ursprüngliche SQL-Speicherung oder Retention aller Records. `retentionVerified` bleibt im Werkzeug bewusst false; `storageCompleteness` bleibt `not_proven_by_history_queries`. Historische Schreib-/Sitzungsgrenzen, Anfang/Ende, leere Abschnitte und unabhängige Quellen müssen für die Betriebsabnahme zusätzlich bewertet werden. Ein erfolgreich gelesenes leeres Fenster ist kein beobachteter Nullbetrieb.
5. Ein voller Tagesabruf ist erst belegt, wenn die gesamten 24 h samt Basis und sämtlichen Sitzungen ohne nicht erklärte Lücken tatsächlich gelesen und geprüft wurden. Der hier gewonnene 27-min-Teilabruf und die simulierte Softwareprüfung erfüllen diese Betriebsabnahme nicht.

Softwareprüfungen umfassen simulierte 24 h mit Neustart, kleine Limitseiten, Timeoutteilung nur unter explizitem Abschlussvertrag, Grenzduplikate, widersprüchliche Identitäten, fehlende Basis/Sequenzen, Null/unlesbares JSON, frische Rohzeitstempel, historische/fehlende/rückläufige Sitzungszähler, Millisekundenkollision, Speicher-/Abfragegrenzen, defekte Senken und nie antwortenden Transport. Eine kleine explizit bezeichnete Projektion echter alpha.58-Records prüft den verlustfreien Transport der Quellenzeiten/ACK und der Unterscheidung null/0. Sie ist kein vollständiger Anlagenreplay.

Zusätzlich wurde der neue Reader ausschließlich lokal gegen alle 10.310 archivierten Originalrecords ausgeführt: 244 simulierte begrenzte Anfragen mit 15 s/80, alle 10.310 eindeutigen Zeilen erhalten, keine Sequenzlücke. Ohne vorherige Vollbasis blieben genau die zehn führenden Deltas unbekannt; entsprechend `queryCoverageComplete=true`, `sequenceContinuityValid=true`, `replayValid=false`. Diese Prüfung bestätigt den Werkzeugvertrag, keinen neuen Liveabruf und keine erfolgreiche Tagesabnahme.

Der vollständige tatsächliche 24-h-Abruf bleibt offen; sporadische Backend-/Connectorlaufzeit und vollständige historische Schreibabdeckung bleiben konkrete Blocker. Keine Softwareprüfung vergibt Scorepunkte oder ersetzt die reale Betriebsabnahme.
