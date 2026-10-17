# 0.17.0-alpha.85

## Anlass und reproduzierte Ursache

[Tagesbericht #169 vom 17.10.2026](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/169)
führt die offenen Ziele aus [#167](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/167)
fort. Der reale Freigabefall um 00:16:05 belegt einen einzelnen Startfall von alpha.84;
er beweist keine wiederholbare Tagesfunktion. Später blieben EHZ-Reserven trotz Nullauftrag
und wiederholt neuer elektrischer Nullwerte bestehen. Die älteren Ereignisse aus #167
werden nicht als heutige Beobachtungen gezählt.

Der produktive EHZ-Ausgabepfad schreibt auch unveränderte Aufträge erneut. Jeder Write erhält
eine neue Befehlssequenz und benötigt einen eigenen Transport-/Resetnachweis. In alpha.84
verwendete `heaterConfirmedZeroPlateau()` jedoch die jeweils neue Resetsequenz samt ACK-Zeit
als Identität des elektrischen Plateaus. Damit begann dessen mindestens 15 Sekunden lange
Beobachtungsdauer bei etwa alle fünf Sekunden abgeschlossenen Nullwiederholungen immer neu.
Die bisherigen Tests gaben einen Nullauftrag aus und aktualisierten danach nur Messwerte;
sie bildeten diesen wiederholten produktiven Tick-/Write-/ACK-Pfad nicht ab.

Die neue Regression durchläuft den produktiven Tick, den tatsächlichen EHZ-Write-Aufruf,
die Beobachtung des eigenen `ack=false`-Auftrags, den zugehörigen Modbus-NULL-Reset und den
Transportabschluss mit wiederholt fortgeschrittenen realen Dreiphasenproben. Sie reproduziert
die alte Dauerblockade und prüft die Freigabe im fortlaufenden Schreibtakt. Ein weiterer
betrieblicher Sperrgrund ist durch diese Softwarekorrektur nicht ausgeschlossen.

## Korrektur und Nachweisgrenzen

Eine eindeutig zugeordnete, ununterbrochene Folge von Nullaufträgen erhält einen stabilen
Beginn. Vollständig abgeschlossene gleichartige Nullwiederholungen dürfen das zu dieser
Folge gehörende elektrische Plateau fortführen. Jeder wiederholte Auftrag bleibt einzeln
beweispflichtig: Vor einer Freigabe müssen der **neueste** gültige Reset und sein abgeschlossener
Schreibtransport vorliegen; die verwendeten L1-/L2-/L3-Proben müssen danach liegen. Ein
Schreibcallback allein beweist weiterhin weder Befehlsverarbeitung noch elektrische Wirkung.

Es bleiben mindestens drei unabhängig in allen drei Phasen fortgeschrittene, bestätigte,
qualitativ gültige reale Nullprobensätze über mindestens 15 Sekunden oder die längere
konfigurierte Reaktionsfrist erforderlich. Stehende Zeitstempel erzeugen keine zusätzlichen
Proben. Fehlende post-Reset-Proben und eine offene, sonst zugeordnete Nullwiederholung
pausieren die Freigabe. Das bisherige Plateau darf nur innerhalb derselben ununterbrochenen
Befehlsfolge erhalten bleiben; dadurch wird ein noch offener Auftrag nicht vorab freigegeben.

Ein positiver Zwischenbefehl oder eine positive elektrische Beobachtung unterbricht den
Nachweis. Das gilt ebenso für ungültige/nullwertige Istquellen, schlechte Qualität, ungültige
Verbindung, rückläufige Zeiten oder große Messlücken. Fehlender oder fremder Reset,
Überlappung, Transportfehler sowie Mapping- oder Sitzungswechsel erhalten die Unsicherheit
beziehungsweise erfordern einen neuen Nachweis. Eine neue Sitzung übernimmt keinen alten
Befehlsbeleg. Die bestehende dauerhafte Sperre bei unklarer Befehlszuordnung bleibt wirksam. Ein unerwarteter
numerischer Null-ACK darf eine gesperrte Write-only-Befehlszuordnung nicht über den
allgemeinen numerischen Rückmeldeweg umgehen.

Die tatsächlichen zyklischen Write-Aufrufe bleiben erhalten. Es gibt keine pauschale
Schreibunterdrückung, zusätzliche Aktorbefehle, Reservelöschung oder Schutzlockerung.
`OutputReservationState_JSON.zeroProofStatus` und der zugehörige Status nennen den konkreten
Sperr-/Wartegrund, Probenzahl, bisherige Dauer und erforderliche Dauer. `restartReason`
benennt zusätzlich einen Neubeginn etwa wegen rückläufiger Phasenzeit oder großer Messlücke.
Ein Aufbau des
Plateaus ist damit von einer tatsächlichen fehlenden Voraussetzung unterscheidbar.
`lastReleaseProof.commandReceipt` enthält den neuesten verwendeten Befehlsbeleg;
`lastReleaseProof.zeroEpisode` hält zusätzlich den Beginn der ununterbrochenen Nullfolge fest.

## Recorder: Mechanismus belegt, produktive Ursache offen

Die 238 fehlenden Originalrecords und 565 fehlenden Quellen-Sample-Sequenzen aus #169 sind
lokale Verluste. Ein erfolgreicher Tagesabruf behebt sie nicht. Eine kontrollierte lokale
Regression mit verzögertem Originaldatei-Append und Quellenburst erreicht die bestehende
begrenzte Aufnahmequeue; dabei können auch Befehlsabschlüsse abgelehnt werden. Sie prüft
Verlustzähler, Sequenzlücken und rekonstruierbare Fortsetzung. Das benennt den Verlustpfad,
belegt aber keine produktive NAS-/Datenbank-/I/O-Ursache und keinen Erhalt jedes
sicherheitsrelevanten Übergangs bei Sättigung.

Zeitlich passende Betriebsdaten reichen noch nicht aus, um Quellenburst und lokalen
Abarbeitungsverzug an den Verluststellen zu trennen. Deshalb enthält dieses Release keine
produktive Recorderkorrektur, Kapazitätserhöhung, SQL-Parallelisierung oder zusätzliche
Lastabfrage. Ziel 2 bleibt offen. Details und verbleibender Diagnosebedarf stehen in
[der Recorder-Diagnose zu #169](issue169-recorder-diagnosis.md).

## Validierung

Die Regressionen prüfen fortlaufende produktive Nullaufträge und korrelierte Resets,
Transport-/ACK-Reihenfolgen, offene Writes, fremde oder fehlende Resets, Überlappung,
Transportfehler, positive Zwischenbefehle und späte Wirkung, längere Reaktionsfristen,
NULL-Istwerte, Qualität, stehende oder rückläufige Zeitstempel, große Lücken sowie
Mapping-/Sitzungswechsel. Eigene Regressionen prüfen, dass ein fremder numerischer Null-ACK
die Write-only-Sperre nicht umgeht und dass bereits ein nur teilweise fortgeschrittener
Dreiphasensatz mit später rückläufiger Einzelphasenzeit den bisherigen Nachweis verwirft
(sowohl Write-only-Reset als auch numerischer ACK). Die Recorderregression läuft ausschließlich mit privatem
temporärem Journal und kontrollierter lokaler Schreibverzögerung.

Die Veröffentlichung wird auf dem gemergten `main` durch `npm test`, `npm run test:package`
und `npm pack --dry-run --json` geprüft. Erst der erfolgreiche Validierungsjob erlaubt dem
Releaseworkflow Tag und GitHub-Prerelease für genau diesen weiterhin aktuellen Main-Commit.
Konkrete Testergebnisse und CI-Lauf sind im zugehörigen Pull Request dokumentiert.

## Nächste reguläre SQL-Prüfung und reale Abnahme

1. **Version, Ereignis und Sitzung zuordnen:** Installations-/Startlog und `System.Version`
   gegen das echte Ereignisfenster prüfen. Sitzung, Adapterversion und SQL-Paketzeit getrennt
   führen; Originalereignisse mit Sitzung/Recordsequenz rekonstruieren und Quellen zusätzlich
   nach Sitzung/Sample-Sequenz deduplizieren.
2. **Nur tatsächlich stattgefundene Heiz-/Stoppfolgen werten:** Eigenen positiven Auftrag,
   elektrische L1–L3-Wirkung, Nullauftrag, vollständige `commandId`, Transportabschluss/-fehler
   und den dazu passenden unabhängigen Modbus-Reset zusammenführen. Herkunft, `ts`, `lc`,
   ACK und `q` sichern. `NULL/ACK=true/q=0` im Write-only-Sollregister ist ein Befehlsreset,
   kein numerischer Istwert und kein alleiniger Stillstandsnachweis.
3. **Neue Freigaben konkret zuordnen:** `OutputReservationState_JSON.zeroProofStatus` und
   `lastReleaseProof` nach der jeweiligen Heiz-/Stoppfolge prüfen. Neuester `commandReceipt`
   muss zum verwendeten Nullauftrag passen; `zeroEpisode` benennt den stabilen Folgenbeginn.
   Alle drei Phasen müssen nach dem neuesten Reset und Transport frisch fortgeschritten sein,
   mindestens drei Probensätze und die konfigurierte Mindestdauer sind nachzuweisen. Dazu
   muss die betreffende Reserve tatsächlich fallen. Der alte Nachweis vom 17.10. um 00:16:05
   belegt keine spätere Freigabe. Bei bleibender Reserve den genauen Sperr-/Wartegrund, `restartReason` und die
   Befehlsfolge sichern; kein Ergebnis aus fehlender Historie ergänzen.
4. **Verzögerte positive Wirkung prüfen:** Ein positiver Zwischenbefehl oder späterer
   Leistungsanstieg muss die Nullfolge beziehungsweise das Plateau unterbrechen. Kein
   verdeckter Reserveabbau bei offener, fremder, fehlgeschlagener oder überlappender
   Befehlsfolge. Reale Timer und Fristen verwenden, Leerlauf nicht als Lastabnahme werten.
5. **Recorderverluste separat zählen:** Neue Zuwächse von `RecordDropped`/`RecordWriteErrors`,
   Journalablehnungen, Recordlücken und Quellen-Sample-Lücken jeweils separat ausweisen.
   Erhaltene Lückenränder, exakten Fehlertext sowie lokale Journal-/Delivery-Gesundheit
   vergleichen. Fehlender Befehlsabschluss bleibt unbeobachtet und beweist weder Ausfall
   noch Erfolg. Die heutigen 238/565 sind datierte Vergleichswerte.
6. **SQL-Bestätigung getrennt prüfen:** Exakte Originalbestätigung benötigt passende
   Sitzung, Sequenz und Inhalts-Hash. Erfolgreiche Abrufe oder wachsende Bestätigungszähler
   beweisen keine vollständige lokale Aufnahme. Bei Abruffehlern Originaltext, Fenster/Limit,
   gemessene Laufzeit/Menge und Parse-/Truncationstatus sichern; unbekannten Backendabschluss
   offen lassen. Nur regulären Folgetagesabruf verwenden, keinen wiederholten Vollabruf oder
   Zusatzlasttest. Nach Gesundheitsprüfung und Abstand höchstens ein kontrollierter kleinerer
   Versuch und insgesamt höchstens drei zusätzliche Diagnoseabfragen; keine eigenständige
   Metadaten-Recovery.

Pumpenkette, weitere reale Wallbox-/EHZ-Lastfälle, Fahrzeugübergaben und Quellenprüfung bleiben
offen. Historische Pumpen-/Durchflussdaten werden nicht nachträglich behauptet. Der
§14a-Ausbau [#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166) bleibt separat.
Softwaretests und Release beweisen keine reale Anlagenabnahme und erzeugen keine Scorepunkte.

Keine automatische Installation, Aktivierung, Livefreigabe oder Änderung produktiver
Konfiguration, SQL-Einstellungen, Rechte, Bestandsskripte, Master Control, Freigaben,
Phasenfolger oder Aktoren.
