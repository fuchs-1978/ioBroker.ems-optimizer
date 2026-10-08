# Tagesbericht #116: go-e-Stoppdiagnose und bleibende Sperre

## Ausgangspunkt und getrennte Abnahme

Geprüft am 08.10.2026: main `d95cd264e8c8af90dbcac30f33135a52d89ca195`,
Manifeste, Laufzeit und `installedFrom` **0.17.0-alpha.53**.
[#116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/116), #110,
#7/#8 und #57/#60/#62 einschließlich Diskussionen wurden erneut gelesen.
PRs #111–#115 sind übernommen: Recordervergleich und Netzdiagnose (#111),
verlustfreier Schema-3-Replay (#112), Ruheprüfung leerer Peers (#113),
gemeinsame SMA-Frischegrenze (#114), parallele Mindestladung (#115).
Diese Korrekturen werden nicht doppelt umgesetzt. Die offenen Bot-PRs #15–#24
betreffen andere Arbeiten; kein neuer paralleler Regler-PR wurde bei der Prüfung gefunden.

Betriebsstand aus #116: Master EIN, produktive Ausgänge freigegeben,
Schattenmodell erwartungsgemäß pausiert. **66/100 bleibt der belegte
Abnahmestand; dieses Release verspricht keine weiteren Punkte.**
Softwarefortschritt ist keine reale Wiederanlauf-, Mehrfahrzeug- oder Tagesabnahme.
ioBroker wurde ausschließlich gelesen: keine Installation, Konfiguration,
SQL-/Indexänderung, Skriptänderung, Master-/Freigabe-/Aktoraktion oder Quellenstörung.
Kein Issue wird automatisch geschlossen.

Der SMA-Upstream-[Draft #919](https://github.com/iobroker-community-adapters/ioBroker.sma-em/pull/919)
wurde erneut als offen, draft, nicht gemergt geprüft. Er ist nicht installiert.
Er erklärt die go-e-Lücke nicht; im unabhängig beobachteten Ereignis war SMA frisch.

## P1: belegte Diagnoselücke und Änderung in alpha.54

Der go-e-Fehlerstatus wurde korrekt anhand seiner **Quellenzeit** als veraltet
verworfen. Ein frischer EMS-Empfang darf einen alten Quellenzeitstempel nicht
ersetzen. Die Ursache der 61,270-s-Quellenlücke bei `serverInterval=15`
(go-e 1.0.42) zwischen Gerät, Polling, State-Datenbank und EMS-Empfang bleibt offen.
Der belegte Softwarebedarf ist die fehlende unabhängige Diagnose dieses Pfads:
die bisherige Direktlesung war für SMA-Stoppquellen angeschlossen, nicht für
go-e-Fehlerstatus und AUS-Timeout.

alpha.54 nutzt dieselbe `LastStopSourceDiagnostics_JSON`-Ablage:
ungültige go-e-Fehler-, Verbindungs-, Fahrzeug- und elektrische Rückmeldungen
erhalten beim übernommenen Ausgang eine Quellendiagnose. Die Menge ist durch
die feste Eingangs-/L1–L3-Topologie begrenzt, mit deduplizierten IDs; es gibt
keine neue anwachsende JSON-Liste. Die betroffene Quelle, Freigabe, Leistung
und alle drei Ströme werden unabhängig gelesen. Ein AUS-Timeout erhält einmal
zusätzlich seine eigene Freigabe-Direktlesung und das damalige ACK=false-Echo.

Jede Lesung ist auf fünf Sekunden begrenzt. Auftrag und Schutzstopp warten
nicht auf die Antwort. Direktantworten werden niemals in den operativen Cache
geschrieben. Ein erfolgreicher State-Datenbankread beweist weder eine Geräteantwort
noch deren kausale Herkunft. `missing`, `timeout`, `error` bleiben unbekannt.
Nach einer Zeitüberschreitung verändert eine spätere Direktantwort das Ergebnis nicht.

Erfasst werden Originalwert, ts/lc, ACK/q, Quellenalter, EMS-Empfang samt Weg,
Prüfuhrzeit, Direktanforderung/-abschluss, Direktwert und Cache-/Empfangsstand am
Abschluss. `key` enthält auch eine monotone Diagnosezahl: zwei Stopps in
derselben Millisekunde kollidieren nicht. `reason`, `stopAt`, `stopGeneration`
und `recordSession` ordnen die Diagnose dem ursprünglichen Stopp zu.
`recordSequenceAtCheck` ist ausdrücklich der Recorderstand **vor** dem
Diagnoseereignis, nicht die Sequenz eines späteren AUS-Auftrags.

Anforderung, Abschluss und AUS-Timeout werden in der **bestehenden begrenzten
DecisionRecord-FIFO/SQL-Reihe** als `source_diagnostic.*` erfasst. Das hält auch
den Abschluss einer überholten Diagnose unter ihrem ursprünglichen Schlüssel fest.
Die letzte Diagnose bleibt nach Erholung erhalten; eine spätere Antwort
überschreibt weder die Diagnose eines neueren Stopps noch dessen LastStopReason.
Queue-/Publikationsfehler bleiben über die vorhandenen Zähler prüfbar.
Recorderfehler dürfen den AUS-Auftrag nicht blockieren.
Beim Adapterende wird keine erfolgreiche Diagnose erfunden; dann kann ein
Anforderungsrecord ohne Abschluss übrig bleiben.

## P1: Sperrvertrag und Anzeige

Der alte Pfad wurde reproduziert: `stop()` setzt beim AUS-Timeout `d.fault`;
`completeStopIfConfirmed()` gibt nach spätem echtem AUS und nachgewiesener
elektrischer Ruhe den Besitz frei, löscht `d.fault` aber nicht.
Das ist der bestehende Sicherheitsvertrag, kein neu behaupteter Regelungsfehler.

Neu lautet die Anzeige bei bestätigtem AUS und Ruhe:
**„AUS inzwischen bestaetigt, elektrisch ruhig, Wiederfreigabe gesperrt“**.
AUS-ACK ohne ausreichende elektrische Evidenz bleibt ein Wartezustand mit Besitz
und Reserve. Bei später fehlender aktueller AUS-/Ruheevidenz wird die ruhige
Anzeige wieder zurückgenommen; die Sperre bleibt erhalten.
Abstecken oder Nullleistung allein bestätigt den AUS-Auftrag nicht.
Die bestehenden 20-s-ACK- und 45-s-Elektrofristen werden nicht verlängert.

Eine neue manuelle Entsperraktion ist **nicht implementiert**. Ein eigener Vertrag
müsste separat begründen: bewusste Bedienaktion für genau den betroffenen Ausgang,
vorheriger Stoppauftrag und echtes AUS nach diesem Auftrag, frische qualitätsgültige
0-W-/L1–L3-Ruhe, Verbindung und Gerätefehler 0, eindeutige Phase, keine offene
Aktion oder widersprüchliche Zuständigkeit sowie sichere gemeinsame Lastreserve.
Neue Freigabe müsste über die normale Start-/Budget-/ACK-Sequenz erfolgen.
Ein Neustart ist keine Betriebsabnahme und darf die ungeklärte Kommunikationslücke
nicht unkontrolliert umgehen. Softwaretests ersetzen keinen realen Wiederanlauf.

Positiver Gegenfall aus #116 bleibt erhalten: Sitzung `1791449618898`,
EQV AUS-ACK **104081**, 0 W / L1–L3 0 A **104147**, Mii EIN erst **104208**.
Bestehende Übergabe- und Schutztests laufen weiter; keine neue allgemeine 300-s-Wartezeit.

## P2: ausschließlich lesende SQL-Prüfung

Originalreihe: `ems-optimizer.0.Debug.Shadow.DecisionRecord`, `agg=raw`.
Testfenster UTC **08.10.2026 16:38:50.000–16:40:09.999**
(18:38:50–18:40:09.999 Europe/Berlin).
Keine SQL-Einstellung oder Recorderkompression wurde dafür geändert.

| Probe | Ergebnis |
| --- | --- |
| 16:39:15–16:39:25, Limit 1000 | 39 Records, 575.579 JSON-Antwortzeichen |
| 16:38:50–16:39:50, Limit 50 | genau 50 Records, 761.457 JSON-Antwortzeichen; ausdrücklich abgeschnitten |
| gleiche Minute, Limit 1000 | Werkzeugantwort `tool call error`; kein vollständiges Resultat |
| aufgeteiltes Mii-Fenster, 16 × 5 s plus letzte 0,999 s, Limit 1000 | alle Antworten unter Limit; 383 eindeutige Records |
| wiederholter Abruf mit Limit 30 und überlappendem Zeitcursor | 14 Antworten, 396 Zeilen, 13 identische Dubletten; dieselben 383 Rohrecords |
| letzter Cursor 16:40:07.908 bis 16:40:09.999 | 6 Records, unter Limit: eindeutiger Abschluss |
| zusätzliche Schlussprobe 16:40:09.013–16:40:09.014, Limit 30 | 1 Record, Sequenz 30378, unter Limit |

Eine erfolgreiche Fünf-Sekunden-Antwort um 16:39:45–50 umfasst 94 Records und
1.255.442 JSON-Antwortzeichen. Daraus folgt **keine ermittelte feste Bytegrenze**.
HTTP/MCP-/SQL-interne Begrenzung und Ursache des Minutenfehlers bleiben unbekannt.
Die Zählung der Antwortzeichen umfasst JSON-Escaping; sie ist nicht die Größe
der ursprünglichen Record-Payloads oder einer HTTP-Übertragung.

Reproduzierbare Pagination: jede volle Antwort am letzten SQL-`ts` überlappend
fortsetzen, Dubletten anhand (Session, Sequenz) und identischem vollständigem
Record vergleichen. Niemals blind um 1 ms vorspringen. Wenn derselbe Zeitstempel
das Limit sättigt und der Cursor nicht weiterkommt, fehlt ein Offset-/Sequenzcursor:
ausdrücklicher Fehler statt Vollständigkeitsbehauptung. Hier schritt jeder Cursor voran.

| Seitenstart UTC | Anzahl | nächste Grenze / Schluss |
| --- | ---: | --- |
| 16:38:50.000 | 30 | 16:39:00.474 |
| 16:39:00.474 | 30 | 16:39:06.602 |
| 16:39:06.602 | 30 | 16:39:15.444 |
| 16:39:15.444 | 30 | 16:39:25.011 |
| 16:39:25.011 | 30 | 16:39:35.305 |
| 16:39:35.305 | 30 | 16:39:46.009 |
| 16:39:46.009 | 30 | 16:39:47.978 |
| 16:39:47.978 | 30 | 16:39:49.339 |
| 16:39:49.339 | 30 | 16:39:50.053 |
| 16:39:50.053 | 30 | 16:39:51.235 |
| 16:39:51.235 | 30 | 16:39:55.213 |
| 16:39:55.213 | 30 | 16:40:05.013 |
| 16:40:05.013 | 30 | 16:40:07.908 |
| 16:40:07.908 | 6 | Abschluss unter Limit |

Sitzung **1791471577122**, Sequenzen **29996–30378**, keine interne Lücke oder
widersprüchliche Dublette. Originale `val`-JSONs: **4.662.440 UTF-8-Bytes**.
Die zwei Abrufmethoden stimmen bytegenau in den nach Sequenz sortierten
`{ts,val}`-Zeilen überein; SHA-256 ihrer `JSON.stringify(rows)`-Darstellung:
`339ca203a12c5dff028f3183d3cd37cc39bdc54316a26b7f8f019b36af10c16f`.

Ohne Vorbasis bleiben die ersten 22 Records (29996–30017) korrekt unbekannt.
Mit zusätzlich gelesenem Vorlauf **16:38:20–50** und dem unveränderten Decoder
aus main sind **alle 383 Records** vollständig rekonstruierbar.
NULL, fehlende Basis und Sequenzlücken werden nicht zu Nullleistung umgedeutet.

### Rekonstruierte reale Kette

Alle Zeiten in dieser Tabelle UTC am 08.10.2026, Session wie oben.
SQL-Zeit, Recordzeit, interne Bestätigung und originale Quellenzeit sind getrennt.

| Sequenz | Beleg | Original-/Auftragszeit |
| --- | --- | --- |
| 30097 | AUS-Auftrag, command `2378`; LastStopAt 16:39:18.019 | event.at 16:39:18.030 |
| 30098 | Schreibecho allow=0, **ACK=false**, q=0 | ts/lc 16:39:18.039 |
| 30149 | AUS-Rückmeldung fehlt; d.fault gesetzt | OutputFault-Quelle 16:39:40.025 |
| 30150 | neuer AUS-Versuch, command `2387` | event.at 16:39:40.028 |
| 30206 | echtes allow=0, **ACK=true**, q=0 | ts/lc 16:39:47.791 |
| 30222 | OutputOwned=false, StopPowerPending=false, Fault bleibt | Besitzquelle 16:39:48.019 |

Beim Record 30206 sind 0 W und 0 A zwar schon sichtbar, ihre Quellenzeiten
liegen **vor** dem echten AUS: Power 16:39:47.738, L1/L2/L3
16:39:47.654/.660/.671. Sie genügen noch nicht allein als Nachweis der
post-ACK-Abschaltung. Bei 30222: bestätigte Freigabequelle 16:39:47.907,
Power **16:39:47.993**, L1/L2/L3 **16:39:47.948/.958/.976**,
je ACK=true/q=0, frisch und nach bestätigtem AUS. Besitzfreigabe ist damit belegt.
Gleichzeitiges Abstecken und Ruhe machen die physische Ursache weiterhin unbekannt.

Der alte Fehlerstatus stammt aus **16:38:46.389**, der nächste aus
**16:39:47.659**, beide Code 0: Abstand **61,270 s**.
Aktuelle go-e-Werte oder der SMA-Draft schließen diese historische Lücke nicht.

### Grenzen und nächste SQL-Abnahme

**Vollständige 24-h-DecisionRecord-Lesbarkeit bleibt ein separater Blocker.**
Der Beginn des angefragten Tages wurde zusätzlich in einem begrenzten 10-s-Read
geprüft (24 Records); das ist kein vollständiger Tagesabruf.
Das große Tagesfenster wurde nicht vollständig paginiert und wird nicht aus
den 383 Ereignisrecords hochgerechnet. `connect ETIMEDOUT` und fehlende
Historienindizes aus #116 beweisen keine EMS-Schreibverluste.
Es gibt keine spekulative weitere Datenreduktion.

Nach einer bewusst durch den Betreiber vorgenommenen Installation:
1. Mit Vorbasis ein begrenztes reales Stoppfenster überlappend vollständig lesen,
   pro Session/Sequenz deduplizieren, Replay zweimal vergleichen, Abschluss unter
   Limit oder konkreten Cursor-/Werkzeugfehler protokollieren.
2. Diagnosekey, stopAt, LastStopReason, AUS-Auftrag/Transportabschluss,
   ACK=false-Echo, echtes ACK=true/q=0 und post-ACK-Power/L1–L3 samt Quellenzeiten
   und Session/Sequenz zusammenstellen; Direktlesung und EMS-Empfang getrennt.
3. Nach Ruhe sowohl OutputOwned=false/Reserve 0 als auch verbleibendes OutputFault
   und gesperrte Wiederfreigabe lesen. Ein Diagnoseabschluss gehört zum alten key,
   auch wenn inzwischen ein anderer Stopp eingetreten ist.
4. Für 24 h alle Rohrecords, Vorbasis, Sessionwechsel, identische Überlappungen,
   Sequenz-/Recorderverlustzähler und eindeutigen letzten Abschluss separat
   nachweisen. Fehlende Basis, NULL, Cursorstillstand oder Lücke bleiben unbekannt.
   Kein Reale-Wiederanlauf-Erfolg aus Softwaretests ableiten.

## Deployment-Lücke und manuelle Rückgabe

`script.js.EMS.Phasenumschaltung_V1` wurde erneut nur gelesen:
installiert ist weiterhin die ältere Variante mit Control.Valid-Prüfung und
Zahlenwertvergleich nach 15 s. Explizite Master-/Ausgangsfreigabe sowie
ACK/q/Frischeprüfung fehlen dort. Das Repository-Beispiel
`examples/ems-phase-follow.js` enthält diese Prüfungen bereits und wird nicht
nochmals geändert. Übernahme und reale Rückgabe sind ein gesonderter Betriebsauftrag.

Carstens manuelle Rückfallfolge bleibt dokumentiert:
**zuerst EMS-Phasenskript ausschalten, danach Master AUS**.
Diesen Ablauf hier nicht ausführen. Abschaltung, ACK, elektrische Ruhe und
eindeutige Rückgabe an genau einen Bestandsschreiber sind real zu prüfen.
Keine automatische Aktivierung alter Skripte oder Wiederfreigabe des Mii.

## Testnachweise

15 neue Regressionen: alte go-e-ts bei frischem EMS-Empfang; ACK=false;
verzögerte, fehlende und gestallte Direktantwort; fünfsekündiger Abschluss;
spätes echtes AUS mit post-ACK-L1–L3-Ruhe und bleibender Sperre; Reststrom,
unbekannte/alte/qualitätsungültige elektrische Phase; Abstecken, Gerätefehler,
unklare Topologie; parallele Lastreserve; neuer Stopp vor Diagnoseabschluss,
auch bei gleicher Uhrzeit; Recorder-/Loggerfehler; lossless SQL-Event-Replay.

Mit dem ursprünglichen alpha.53-wallbox-output scheitern **neun** der neuen
Regressionsfälle; mit alpha.54 bestehen lokal **362 Wallbox-, 39 Parallel-,
14 Produktionsrecord-, 4 Quellendiagnose-, 15 Phasenfolger- und 8 Manifesttests**.
Paketprüfung, npm-pack-Trockenlauf (83 Dateien) und diff --check bestanden.
Die dateiweise lokale Suite unter Node 24 besteht mit 1.290 Tests bei zwei
explizit ausgelassenen vorhandenen CLI-Unterprozesstests (1.292 insgesamt).
Lokale Node-24-Vollsuite hängt in vorhandenen CLI-Unterprozessen;
die beiden CLI-Fälle müssen vor Merge vollständig in der Node-20-GitHub-CI
bestehen. Es wird kein umgangener Test als bestanden gezählt.

