# Kompakte produktive DecisionRecords ab alpha.50

## Zweck und Grenzen

`ems-optimizer.0.Debug.Shadow.DecisionRecord` bleibt der bestehende Aufzeichnungskanal. Im produktiven Betrieb ersetzt Schema 3 die wiederholte vollständige Serialisierung durch selbstständige Vollsnapshots und rekonstruierbare Deltas. Die Steuerung, Befehle, Schutzgrenzen, Reaktionsfristen und vorhandenen SQL-Einstellungen werden dadurch nicht geändert.

Der Anlass ist die große Nutzdatenmenge der produktiven Schema-2-Aufzeichnung, auch bei ruhenden Lasten. Diese Änderung reduziert die Wiederholung unveränderter Inhalte zwischen Vollsnapshots. Sie belegt keine Ursache früherer SQL-Zugriffsfehler und verspricht keine bestimmte Datenmengenreduktion oder Abnahmepunktzahl. Maßgeblich sind anschließend echte SQL-Schreib- und Leseprüfungen mit ausgewiesener Abdeckung.

## Aufzeichnungsvertrag

- Die erste produktive Aufzeichnung einer Sitzung ist ein vollständiger Snapshot.
- Während laufender Aufzeichnung liefert der nächste Record nach Ablauf des 30-s-Snapshotintervalls wieder eine vollständige Basis. Der bestehende 1-s-Heartbeat bleibt erhalten; ohne neuen Record wird kein künstlicher Datenpunkt behauptet.
- Master-/Moduswechsel und ein zurückspringender Zeitbezug erzeugen eine neue vollständige Basis. Ein Delta, das größer als ein Vollsnapshot wäre, wird als Vollsnapshot geschrieben.
- Dazwischen speichern Deltas nur die Änderungen gegenüber dem unmittelbar vorherigen Record. Die Rekonstruktion ergibt denselben vollständigen produktiven Datenstand wie die bisherige Schema-2-Aufzeichnung.
- Befehlsversuche und Transportabschlüsse bleiben eigene Ereignisse. Gleiche zyklische Befehle werden nicht pauschal entfernt. Quellenzeitstempel, ACK, Qualität, NULL-Wechsel, Timer und Rückmeldungen bleiben erhalten.
- Queueverlust oder Schreibfehler erzwingen für den nächsten aufgezeichneten produktiven Record eine neue vollständige Basis. Die Verlust-/Fehlerdiagnose bleibt sichtbar. Das ist kein Nachweis, dass SQL jeden veröffentlichten Record erfolgreich gespeichert hat.
- Schattenrecords mit Schema 1 und ältere vollständige Produktivrecords mit Schema 2 werden nicht umgeschrieben.

Die Änderung betrifft Nutzdaten pro Record. Aus kleineren Deltas folgt keine pauschale Verringerung der Ereignis- oder Recordanzahl.

## Schema 3 und Reihenfolge

Sitzung und Sequenz bilden den Rekonstruktionsschlüssel. Die Hülle behält Ereigniszeit, `recordSession`, `recordSequence`, `cycleId`, Adapterversion, Betriebsmodus, `masterEnabled`, Ereignis und Aufzeichnungszustand. Diese Metadaten sind auch bei einem Delta unmittelbar auswertbar.

| Feld | Bedeutung |
|---|---|
| `schema: 3` | Kompaktes produktives Format. |
| `frameType: "snapshot"` | Selbstständiger vollständiger Datenstand in `data`. |
| `frameType: "delta"` | Änderungen in `ops`, anzuwenden auf den unmittelbar vorherigen rekonstruierten Datenstand. |
| `baseSequence` | Sequenz des direkt vorherigen Records, auf den sich das Delta bezieht. |
| `checkpointSequence` | Sequenz des letzten vollständigen Snapshots dieser Kette. |
| `ops` | Operationen mit `op: "set"` oder `op: "delete"`, einem Pfadarray `path` und beim Setzen einem `value`. |

Ein gesetzter NULL-Wert ist ein beobachteter NULL-Wert; ein gelöschtes Feld ist fehlend. Beides darf nicht als beobachtete Nullleistung ausgelegt werden. Auch ein leerer Delta enthält einen Ereignis-/Zeitbezug und darf nicht unbemerkt die Sequenzkette verlieren.

Der Decoder kontrolliert Sitzung, Sequenz und Basis. Nach einer fehlenden Basis, Sequenzlücke oder widersprüchlichen Kette bleibt der vollständige Datenstand unbekannt, bis ein neuer gültiger Vollsnapshot vorliegt. Er wendet kein Delta auf eine zufällig passende ältere Sitzung an. `reconstruction.valid=false` kennzeichnet nicht rekonstruierbare Stellen und nennt den Grund. Ein späterer Snapshot stellt nur ab seiner eigenen Ereigniszeit wieder eine Basis her; die Lücke wird nicht rückwirkend gefüllt.

## Lesendes Replay-Werkzeug

```sh
npm run decode:records -- export.json
```

`tools/decode-decision-records.js` liest ausschließlich einen vorhandenen JSON-Export. Das Werkzeug stellt keine SQL-/ioBroker-Verbindung her, ändert keine Aufzeichnungseinstellungen und importiert nichts zurück. Der Eingang kann ein Recordarray oder ein Objekt mit `records` sein. Die Verarbeitung ordnet exportierte Records und behandelt Duplikate; widersprüchliche oder unvollständige Ketten bleiben diagnostizierbar.

Der gemeinsame Codec liegt in `lib/decision-record-codec.js`. Er exportiert `DecisionRecordEncoder`, `DecisionRecordDecoder` und `decodeDecisionRecords`. Ältere Schema-1-/Schema-2-Records bleiben lesbar; gültige Schema-3-Ketten werden in vollständige Schema-2-Datenstände zurückgeführt. Nicht rekonstruierbare Stellen werden ausdrücklich gekennzeichnet.

Ein JSON-Export muss zuvor vollständig und nachvollziehbar gewonnen werden: begrenzte SQL-Zeitfenster lesen, bei Limits unterteilen, Grenzüberlappungen deduplizieren sowie Sitzung/Sequenz und Abdeckung prüfen. Beginnt ein Export zwischen zwei Vollsnapshots, benötigt seine Rekonstruktion die letzte vorhergehende vollständige Basis. Ist diese nicht vorhanden, sind die anfänglichen Deltas unbekannt. Der Decoder ersetzt keine Vollständigkeitsprüfung der SQL-Abfrage.

## Regressionen und nächste Betriebsprüfung

Die Softwareprüfung muss die vollständigen rekonstruierten Datenstände gegen die Eingänge vergleichen: verschachtelte Daten, Arrays, Feldlöschung und NULL, Quellenzeit-/ACK-/Qualitätswechsel, Timer-/Masterwechsel, unveränderte Heartbeats, Befehlsversuch und Transportabschluss. Zusätzlich erforderlich sind Sitzung-/Sequenzlücken, Neustart, Uhrsprung, Queueverlust und Schreibfehler sowie die Erholung durch einen späteren Snapshot. Legacy-Schatten-/Produktivrecords bleiben Teil des Vertrags.

Für die nächste lesende SQL-Auswertung:

1. Installierte Version und Aufzeichnungssitzung erneut feststellen; ein GitHub-Release beweist keine Installation.
2. Ein zusammenhängendes begrenztes Fenster einschließlich Vollbasis vollständig lesen und rekonstruieren. Rohsequenzen, Delta-/Snapshotanzahl, UTF-8-Datenmenge, Fehler und tatsächliche Grenzen ausweisen. Bei Abfragelimits weiter teilen.
3. Mindestens ein relevantes reales Ereignis anhand rekonstruierter Befehle, ACKs und Geräteantworten gegen Originalquellen vergleichen. Ein Nachtleerlauf ist kein bestandener Last- oder Phasenwechseltest.
4. Für längere Fenster Vollständigkeit, Quellenqualität, Schreibdiagnose und Lesezeiten prüfen. Fehlende Records bleiben unbekannt; Fortschreibung darf keine beobachteten Werte erfinden.

Die Tagesanalyse liest neue kompakte Records über den Codec oder einen gleichwertigen geprüften Replaypfad. Deltas dürfen nicht wie volle Schema-2-Records behandelt werden. Softwaretests ersetzen weder reale Übergabe-/Lastabnahme noch einen Nachweis dauerhaft stabiler SQL-Aufzeichnung.

Keine automatische Installation, Aktivierung, Rückgabe oder Änderung produktiver Einstellungen.
