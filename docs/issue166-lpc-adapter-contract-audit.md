# #166: LPC-Adaptervertrag nach Anleitung und Quellcode geprüft

Stand: **22.10.2026, Europe/Berlin**. Ausgangs-main:
[`ef7306d2744668c0acc14175eb915efbbda6d53a`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/ef7306d2744668c0acc14175eb915efbbda6d53a),
veröffentlicht als alpha.117. Die Arbeitsgrundlage
[#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166) wurde erneut
über GitHub-Metadaten dem Autor `fuchs-1978` zugeordnet; keine Kommentare vorhanden.
Es wurden keine fremden Issues als Arbeitsgrundlage verwendet.

## Ergebnis und Umfang

Die Anleitung klärt wesentliche Teile der LPC-Schnittstelle. Die frühere Aussage,
der gesamte Adaptervertrag sei unbekannt, ist damit überholt. Eine Freigabe der
zusätzlichen Eigenstrom-/Gruppenbilanz allein durch Entfernen der LPC-Sperre ist
dennoch nicht belegt. Drei konkrete Voraussetzungen bleiben offen:

1. Installierte Version, Backendstand und zugeordneten Root-/Guard-Umfang
   identifizieren. Ein passender `eebus-go`-Datenpunktname erlaubt die Zuordnung
   zur Adapterfamilie, ersetzt aber keinen installierten Versionsnachweis.
2. Dessen Budgetautorität der tatsächlichen Teilnehmer-/AC-Messgrenze zuordnen und
   die Verwendung als netzwirksames Gruppenbudget nachweisen.
3. Zusammengehörige aktuelle Grenzwerte über Neustart, Zustandswechsel und
   konkurrierende RPC-Abschlüsse belastbar erkennen. ACK, Qualität und frische
   Zeitstempel allein beweisen keine aktuelle semantische Zuordnung.

Die Veröffentlichung alpha.117 und ihr konservativer LPC-Pfad werden nicht
verändert. Die LPC-Sperre in `groupNet` bleibt erhalten. Dieser Bericht ist keine
reale Betriebsabnahme, keine Aussage über einen beobachteten Anlagenfehler und
kein Nachweis, dass der vorhandene Bruttomodus sämtliche beschriebenen
Asynchronitätsfälle abdeckt. Kein neues Release allein für diese Diagnose.

## Commitgebundene Quellen

| Quelle | Geprüfter Stand |
| --- | --- |
| [FernetMenta/ioBroker.eebus-go: Anleitung](https://github.com/FernetMenta/ioBroker.eebus-go/blob/d6f9329fc424445f81cfd56b0b20f3929c9d16c2/README.md) | main `d6f9329fc424445f81cfd56b0b20f3929c9d16c2`, Manifestversion 1.2.0 |
| [LPC-Zustandsmaschine und Datenpunktexport](https://github.com/FernetMenta/ioBroker.eebus-go/blob/d6f9329fc424445f81cfd56b0b20f3929c9d16c2/lib/lpc-use-case.js) | Zustände, Einheiten, Timer und Veröffentlichung |
| [LPC-Guard-Zuteilung](https://github.com/FernetMenta/ioBroker.eebus-go/blob/d6f9329fc424445f81cfd56b0b20f3929c9d16c2/lib/eg-lpc.js) | Gesamtbudget und zugeteilte Anteile |
| [Veröffentlichtes v1.2.0](https://github.com/FernetMenta/ioBroker.eebus-go/tree/bb8e8cbdeae20dcb79fb64a4917d339cf113137b) | `lib/lpc-use-case.js`, `lib/eg-lpc.js`, `lib/hems.js` und `lib/energy-guard.js` gegenüber dem geprüften main unverändert; kein Installationsnachweis |
| [eebus-grpc v2.0.2](https://github.com/FernetMenta/eebus-grpc/tree/34b32f62cc50cbcf5f7b995dd110874ee5826f8f) | `34b32f62cc50cbcf5f7b995dd110874ee5826f8f`; darin gebundene enbility-Version geprüft |
| [enbility LPC](https://github.com/enbility/eebus-go/blob/0aa83d264add807f8bd5f54aabd7ba82fd9e8c04/usecases/cs/lpc/usecase.go#L248) und [Messkennung](https://github.com/enbility/eebus-go/blob/0aa83d264add807f8bd5f54aabd7ba82fd9e8c04/usecases/internal/measurement.go#L84) | `0aa83d264add807f8bd5f54aabd7ba82fd9e8c04` |

Die Suche fand mehrere unterschiedliche ioBroker-EEBUS-Adapter. Deren
Datenpunktbäume sind nicht austauschbar. Eine paketübergreifende Freigabe wird
aus dieser Prüfung nicht abgeleitet. Die normativen EEBUS-Downloads wurden nicht
durch einen Login oder eine Registrierung beschafft; eine technische
Adapterbeschreibung wird nicht als normative EEBUS-Zertifizierung ausgegeben.

## Was die Anleitung und Implementierung tatsächlich belegen

| Export | Belegter Vertrag | Grenze des Nachweises |
| --- | --- | --- |
| `LPC.state` | String: `init`, `limited`, `failsafe`, `unlimitedControlled`, `unlimitedAutonomous` | Kein gemeinsamer Snapshot mit `LPC.limit` |
| `LPC.limit` | Zahl in W; aktives Controlbox-Verbrauchslimit, bei Deaktivierung 0; im Failsafe aus separater RPC-Abfrage | 0 ist kontextabhängig; keine tatsächliche Leistungsmessung |
| `LPC.limitDuration` | Minuten, aus ursprünglicher Dauer gerundet; 0 auch bei unbegrenzter Dauer oder kurzen gerundeten Dauern | Kein präziser Restzeit-Countdown oder absoluter Ablaufzeitpunkt |
| `LPC.EnergyGuards.Guard_<name>.currentLimit` | Dem Guard zugeteilter Watt-Anteil; 0 bei Deaktivierung | Nicht identisch mit dem gesamten Root-Budget |
| `info.connection` | gRPC-/HEMS-Verbindung bzw. Initialisierung | Kein unabhängiger Controlbox-Heartbeat- oder Snapshotnachweis |

Der Erzeuger bestätigt die exportierten Werte mit ACK. Ursprüngliche EEBUS-
Messzeit, gemeinsame Producer-Epoche, Revision und Gruppen-/Messbeschreibung
werden in diesen beiden LPC-Feldern nicht mitgeliefert. Die tatsächlichen
ioBroker-Originalwerte und ihre Qualität müssen weiterhin geprüft werden.

Initialisierung, Heartbeats, Limitdauer und Failsafe-Timer gehören zum
EEBUS-Adapter. `unlimitedAutonomous` ist dort ausdrücklich ein Zustand nach
Initial-/Failsafe-Ablauf bei fehlender Controlbox; eine getrennte Verbindung
darf nicht pauschal jeden solchen Zustand in einen anderen Zustand umdeuten.
Die gerundete `limitDuration` darf keinen zweiten erfundenen Ablaufvertrag im
EMS begründen. Es wird keine Änderung bestehender Timeouts vorgeschlagen.

### Gesamtbudget, Guard und Messgrenze

Der Adapter verteilt das Controlbox-Gesamtbudget auf alle konfigurierten Guards
nach Prozentanteilen und Failsafe-Regeln. Getrennte Guards behalten ihre Anteile
auch bei fehlender Verbindung. Der Beispiel-Wallbox-Guard verwendet deshalb
seinen `currentLimit`, nicht beliebig das Root-`LPC.limit`.

Das EMS darf das Root-Budget nur bei belegter Zuständigkeit für dessen gesamten
Umfang beanspruchen. Bei einem zugeordneten Guard muss dessen Anteil zur
vollständig gemessenen EMS-Gruppe passen. Mehrere nachgeordnete Gruppen dürfen
nicht jede das volle Root-Budget erhalten. Ein empfangenes Gesamtbudget wird
auch dann nicht nochmals mit GZF erhöht.

Die gebundene enbility-Implementierung beschreibt eine Verbrauchsverpflichtung
in W (`signDependentAbsValueLimit`, `obligation`, `consume`,
`activePowerLimit`) und referenziert die AC-Gesamtmessung der jeweiligen Entity.
Die Messkennung kann ersatzweise 50 sein. Das ist kein automatischer Beweis,
dass eine beliebige installierte Entity dieselbe Teilnehmer-/NVP-Messgrenze
wie die konfigurierte EMS-Bilanz beschreibt. Es beweist ebenso wenig eine
Bruttobegrenzung für sämtliche Installationen: die konkrete Zuordnung bleibt
zu klären. Ein Beispiel mit `maxGridPower` ersetzt diesen Anlagenvertrag nicht.

## Getrennte Veröffentlichung und verspätete Antworten

Der Datenlistener startet asynchrone Handler ohne gegenseitige Serialisierung.
Jeder `DataUpdateLimit`-Handler wartet auf seine eigene `ConsumptionLimit`-
Antwort. Eine ältere Abfrage kann daher nach einer jüngeren Abfrage fertig
werden und deren Wert überschreiben. Status, Zahlenwert und Dauer erhalten
keine gemeinsame Revisionskennung.

Separat schreibt ein Zustandswechsel `LPC.state` vor dem neuen `LPC.limit`.
Eine beim Eintritt in Failsafe gestartete Abfrage schreibt ihren späteren Wert
außerdem ohne erneute Prüfung der aktuellen FSM-Generation. Ein Verbraucher
kann solche semantisch alten Werte nicht allein anhand von ACK/q und neuen
ioBroker-Schreibzeitstempeln erkennen.

Der erste isolierte Failsafe-Replay verwendete 4.200 W als verspätete Antwort
nach einem neueren 1.000-W-Limit. Er belegt den verspäteten Export, modelliert
aber nicht die vorgeschaltete Guard-Zulassung: Bei unveränderter
Failsafe-Summe von 4.200 W könnte das 1.000-W-Limit schon abgelehnt werden.
Dieser Fall wird deshalb nicht als vollständig zugelassene Anlagenfolge
ausgegeben.

### Reproduzierter Fall mit zwei zugelassenen Grenzwerten

Der [dauerhafte Offline-Replay](../test/replays/eebus-lpc-ordering.cjs) lädt die
unveränderte geprüfte Upstream-Klasse und ihre tatsächliche
`javascript-state-machine`-Abhängigkeit. Beide Eingabedateien werden vor der
Ausführung durch SHA256 geprüft. Test-Doubles ersetzen ioBroker-I/O, gRPC,
Use-Case-Registrierung, Uhr/Timer, Guard-Failsafe-Konfiguration und den
Verteilungs-Callback. Die tatsächliche `EgLpc`-Zuteilung wird nicht ausgeführt.
Es gibt keine Netzwerkabfrage oder Gerätebetätigung.

1. Der tatsächliche `LimitWriteApprovalRequired`-Handler lässt 9.000 W bei
   4.200 W Guard-Failsafe-Summe zu.
2. Die zugehörige `ConsumptionLimit`-Antwort bleibt ausstehend.
3. Derselbe Zulassungshandler lässt anschließend 4.200 W zu.
4. Die neuere Antwort veröffentlicht 4.200 W / 5 Minuten und übergibt 4.200 W an
   den protokollierten Verteilungs-Callback.
5. Die ältere Antwort trifft danach ein und überschreibt die Veröffentlichung
   wieder mit 9.000 W / 10 Minuten; der Zustand bleibt `limited`. Der
   Verteilungs-Callback erhält ebenfalls wieder 9.000 W.

Beide Grenzwerte bestehen zusätzlich die tatsächliche exportierte
`shouldApproveLimit`-Regel. Frische bestätigte Schreibzeitstempel, `q=0` und eine
nach dem Zahlenwert geschriebene Dauer erkennen die alte Antwort nicht.

| Kontrollierte Antwortreihenfolge | Node 22.23.3 | Node 24.19.0 |
| --- | --- | --- |
| Ältere Antwort vor neuerem Limit | `limited`, 4.200 W / 5 Minuten | `limited`, 4.200 W / 5 Minuten |
| Ältere Antwort nach neuerem Limit | `limited`, 9.000 W / 10 Minuten | `limited`, 9.000 W / 10 Minuten |

[Geordnete synthetische Spuren und Eingabehashes](evidence/issue166-lpc-ordering.json)
sind versioniert. Das ist ein möglicher Modulablauf unter kontrollierter
RPC-Antwortreihenfolge. Vollständige SHIP-Zulassung, konkrete
Transportbedingungen, Geräteantworten und Auftreten in einer realen Anlage
wurden damit nicht geprüft. Keine behauptete Ursache eines Betriebsereignisses.

Zur Wiederholung die beiden angegebenen öffentlichen Quelldateien unverändert
von den gebundenen Commits beschaffen; sie sind nicht ins EMS vendort:

- [LpcUseCase](https://github.com/FernetMenta/ioBroker.eebus-go/blob/d6f9329fc424445f81cfd56b0b20f3929c9d16c2/lib/lpc-use-case.js),
  SHA256 `b9da9b439d422ef36f25cfa3a2f50a39a980f5facaa2e9eb3ba1958a7020f2dc`;
- [FSM 3.1.0](https://github.com/jakesgordon/javascript-state-machine/blob/0d603577423244228cebcd62e60dbbfff27c6ea3/dist/state-machine.js),
  SHA256 `f10baaebe04f6132ad391fb7274c7e59ceeb87fdf45449c6bd1a745ca9d49289`.

```sh
node test/replays/eebus-lpc-ordering.cjs /pfad/lpc-use-case.js /pfad/state-machine.js
```

Das Programm prüft sowohl Kontroll- als auch Gegenfall durch Assertions und
gibt die synthetischen Beobachtungen als JSON aus. Es ist ein gesonderter
Komponenten-Replay mit extern beschafften, unveränderlichen Quellen und gehört
nicht zu den normalen Offline-EMS-Regressionen. Es lädt keinen Adapter,
Container oder eine laufende ioBroker-Instanz.

## Bestehende EMS-Grenze und künftige Umsetzung

Die gemeinsame Laufzeitgrenze in `lib/grid-operator-runtime.js` blockiert derzeit
jede wirksame LPC-Zuordnung im neuen Gruppenmodus. Danach verlangt sie einen
Binärkontakt. Allein das Entfernen der LPC-Sperre würde daher keine vollständige
LPC-Unterstützung ergeben.

Ein belegter Adaptervertrag kann später an dieser gemeinsamen Grenze in einen
geprüften `{valid, active, budgetW, groupId, boundaryId}`-Nachweis übersetzt werden.
Der reine Bilanzkern, gemeinsame Eigenstrompool, High-Water-Reserven sowie die
unabhängigen Wallbox-, Heizungs-, Speicher- und wartenden Queueprüfungen können
dabei erhalten bleiben. Erforderlich sind insbesondere:

- ausdrückliches Adapterprofil mit gebundenem Root-/Guard- und Gruppenvertrag;
- eigenständiger LPC-Pfad ohne erzwungenen Binärkontakt;
- kleinere gleichzeitige Binär-/LPC-Grenze nur bei gleichem nachgewiesenem Umfang;
- belegte Verwerfung überholter Antworten und kohärente aktuelle Veröffentlichung,
  beispielsweise über einen Producer-Epochen-/Revisionsvertrag; eine andere
  Lösung braucht einen gleichwertigen Nachweis;
- exakte Abonnements, Vorladen und Recorderinventar für alle zusätzlich
  erforderlichen Zustands-, Verbindungs- und Gültigkeitsquellen;
- Regressionen für Status-/Limitwechsel, Neustart, Ablauf, Verbindungsausfall,
  unterschiedliche Gruppen und Quellenverlust während echter Schreibwartezeiten;
- unverändertes Legacy-Verhalten, vorhandene Bilanz-/Reserveprüfungen und
  anschließend vollständige Node-22/24-, Paket-, Artefakt- und Vergleichsprüfungen.

Die bisherige Binärkontakt-Einrichtung steht in
[issue166-runtime-integration.md](issue166-runtime-integration.md). LPC-
Zuordnungen sollen nicht gelöscht oder in einen künstlichen Binärkontakt
umgeschrieben werden, um die neue Sperre zu umgehen.

## Prüfungen und nicht geprüfte Fälle

Die vorhandenen Tests für `grid-constraints`, `grid-operator-accounting` und
`grid-operator-runtime` bestehen unter Node 22.23.3 und 24.19.0 jeweils mit
**256 bestandenen Tests**, ohne Fehler oder übersprungene Fälle. Das prüft den
vorhandenen Softwarestand; daraus folgt keine neue LPC-Freigabe.

Nicht geprüft sind installierter Adapter-/Backendstand, reale Root-/Guard-
Zuordnung, physische Messgrenze, tatsächliche Originalzustände und natürliche
aktive LPC-/Lastfälle. Kein SQL-Abruf, keine künstlichen Anlagenversuche,
produktiven Konfigurationsänderungen, Heartbeat-/Aktorwrites, Installation oder
Aktivierung wurden durchgeführt. Keine Issues geschlossen, keine fremden
Issues/Kommentare erstellt und keine privaten Konfigurationen veröffentlicht.
