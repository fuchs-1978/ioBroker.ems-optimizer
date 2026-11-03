# Issue #216 – Wallbox: einmaliger sicher begrenzter Sollstrom-Korrekturversuch bei widersprüchlicher Rückmeldung

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216. Letzte Issue-Änderung: 2026-10-28T19:28:16Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- issue-audit-20261028 -->
## Aktueller Restumfang – Abgleich 28.10.2026

- [x] Einmalige eng qualifizierte Sollstromkorrektur seitalpha.114 vorhanden; nicht erneut entwickeln.
- [x] Konkrete erste Konfliktbedingung samt Originalquellen/Kontext in CurrentConflict_JSON seitalpha.149/PR260 implementiert.
- [ ] Nächsten natürlichen qualifizierten Konflikt mit Bedingungscode, ursprünglichem Stromauftrag, unabhängigem ACK und elektrischer Antwort vollständig zuordnen.
- [ ] Historische widersprüchliche go-e-EIN-/Strommeldungen nach AUS aus #271/#274 und unzureichend erklärte alte Konflikte getrennt offenlassen; fehlende damalige Rohdaten nicht nachträglich rekonstruieren oder automatisch demselben Fehler zuordnen.

Bestehender [go-e-Upstream-PR366](https://github.com/MK-2001/ioBroker.go-e/pull/366) frisch geprüft: offen/nicht gemergt, Headba90b5ab5ab851adfa68cee34c4c9645bcf05661. Kein Upstream-Release/Installation oder bewiesener HTTP-Ursprung der historischen Ereignisse. Keine zweite Korrektur, keine Lockerung der Schutz-/Retrygrenzen. Aktuelle Tagesbelege in #278, reale allgemeine Abnahme in #7.

---

## Anlass und belegter Betriebsfall

Am 20.10.2026 unter laufender 0.17.0-alpha.113, go-e-Adapter 1.0.42 / API2, kam es beim EQV (Wallbox1) zu einem Schutzstopp wegen „Ladestrom extern veraendert; konkurrierenden Regler pruefen“. Alle Uhrzeiten Europe/Berlin.

Gezielter lesender Recorderabruf 11:54:15–11:54:50, 19 SQL-Transportwerte. Transportbündel mit Repository-Decodern expandiert; frühere Deltas ohne Basis nicht als vollständige Zustandsrekonstruktion verwenden. Maßgebliche Sitzung1792485826313. Befehls-/Quellenereignisse:

| Ereignis | Zeit / Nachweis |
| --- | --- |
| EMS fordert10A über `go-e.1.amperePV` | 11:54:30.229, seq19389, command1826 |
| go-e bestätigt10A in `amperePV` und `ampere` | 11:54:33.370 / .375, seq19427/19428 |
| Weitere10A-Rückmeldungen | `ampere`11:54:34.839 und11:54:36.668; `amperePV`weiter10A |
| Rückmeldung `go-e.1.ampere` springt auf11A | 11:54:38.245, seq19459, ack=true, from=system.adapter.go-e.1 |
| EMS fordert AUS | 11:54:40.145, seq19476; Warnung11:54:40.066 |
| Rückmeldung wieder10A | 11:54:40.807, seq19501 |

Kein neuer fremder Ampere-Schreibbefehl im geprüften Ausschnitt belegt. Die geprüften alten EV-Ladeschreiber und früheren Phasenumschaltskripte waren bei der anschließenden Inventur deaktiviert. Der aktive EMS-Phasenfolger schreibt Phasenmodus, keine Ampere-Vorgaben. Das ebenfalls aktive Fehler5-Skript kann einen Gerätestart auslösen; Fehlerstatus im qualifizierten Ereignisausschnitt0. Diese Inventur ist kein vollständiger historischer Nachweis aller möglichen externen Clients.

**Offene Ursache:** verspätete/widersprüchliche Adapter-/Geräteantwort versus tatsächlich externer Eingriff. Die Warnung beweist keinen konkurrierenden Regler; keine dieser Ursachen vorschnell behaupten.

## Gewünschtes Verhalten / Umfang

Gezielte Verbesserung der Widerspruchsbehandlung, keine allgemeine Lockerung des Schutzpfads:

1. Zuerst den beschriebenen 10→11→10-A-Fall mit realer Befehls-, ACK-, Poll- und Tickreihenfolge reproduzieren und den aktuellen Behandlungspfad prüfen. Vorhandene ACK-/Antwortfristen, Eigenbefehlsnachweise und Reservierungen wiederverwenden.
2. Nur bei eindeutig eigenem aktivem Auftrag, frischen gültigen Quellen und weiterhin nachgewiesen eingehaltenen Geräte-/Haus-/Phasen-/Netzbetreiber-/Peer-/EHZ-Grenzen einen einzelnen widersprüchlichen Strom-Sollwert begrenzt behandeln.
3. Höchstens einmal den zuletzt unabhängig freigegebenen **und aktuell noch zulässigen** Sollstrom erneut senden. Nicht blind den alten Wert wiederherstellen: aktuelle Budgetreduktionen und harte Grenzen haben Vorrang. Keine neue ON-Freigabe und keine Erhöhung aus dem Widerspruch ableiten.
4. Während der Korrektur keine weitere Erhöhung. Bestehende ACK-Frist als begrenztes Prüffenster nutzen; ausstehende Wirkungen konservativ reservieren. Keine wiederholte Fristverlängerung durch Polls, ACK-Echos oder Retries.
5. Bei erneutem Widerspruch nach Korrekturbestätigung, ausbleibender passender Bestätigung oder unzureichender Sicherheits-/Quellenlage stoppen. Bereits vor Dispatch erzeugte oder nachweislich alte/in-flight Antworten anhand tatsächlicher Zeitnachweise von einem neuen Eingriff unterscheiden, nicht pauschal ignorieren.
6. Keine Endlosschleife gegen einen anderen Regler: Korrekturbudget nicht mit jedem unveränderten Poll oder kurzfristigem ACK neu aufladen. Rücksetzregel ausdrücklich festlegen und testen.
7. Reale Überlast, Gerätefehler, ungültige/veraltete Messdaten, Master-/Benutzerfreigabeentzug sowie unerwartete AUS-Freigabe bleiben im vorhandenen Schutzpfad. Der neue Mechanismus gilt ausschließlich für qualifizierte Sollstrom-Widersprüche.

Vor Implementierung die genaue sichere Zustandsmaschine festlegen; falls die Beweislage keinen sicheren Korrekturversuch erlaubt, bestehende Abschaltung beibehalten und den Grund diagnostisch ausgeben.

## Nutzen und Abhängigkeiten

Nutzen: vermeidbare Ladeunterbrechungen durch einzelne widersprüchliche Sollstrom-Rückmeldungen reduzieren, ohne konkurrierende Steuerungen zu übersteuern. Energiepotenzial derzeit nicht belastbar quantifiziert. Kein garantierter Scoregewinn.

Abhängigkeiten: bestehender Wallbox-Output, ACK-/elektrischer Antwortnachweis, private Befehlsidentität, aktuelles gemeinsames Leistungsbudget und Quellenqualität. Diagnose von Geräte-/Adapterursache getrennt von der begrenzten Verhaltensverbesserung halten. Bezug: reale Betriebsabnahme #7 und Phasen-/Zuständigkeitsdiagnose #8; Hinweise aus #211 wiederverwenden, umgesetzte Funktionen nicht erneut entwickeln.

## Überprüfbare Abnahmekriterien

- [ ] Konkrete zeitliche 10→11→10-A-Folge reproduziert; Ursache und verbleibende Unbekannte sauber getrennt.
- [ ] Qualifizierter einzelner Widerspruch erzeugt höchstens einen Korrekturbefehl, keine zusätzliche ON-Freigabe und keinen vermeidbaren Stopp bei rechtzeitiger passender Antwort.
- [ ] Keine Erhöhung während der Korrektur; aktuelle Reduktion, geänderte Limits und konservative Reservierung bleiben wirksam.
- [ ] Wiederholter echter Widerspruch / konkurrierender Schreiber, fehlender oder verspäteter ACK und fehlender Nachweis führen innerhalb fester Fristen zum Stopp, ohne Reset der Retrygrenze durch ACK-Polls.
- [ ] Alte/in-flight Pollantworten, beide Rückmelde-IDs, Reihenfolgen vor/nach ACK und verspätete Verarbeitung gezielt getestet; keine pauschale Echo-Ausnahme.
- [ ] Fehler-/Überlast-/Qualitäts-/Master-/Benutzerfreigabe- und Phasenschutz bleiben wirksam; 1P und3P sowie gemeinsame Peer-/EHZ-Reservierungen abgedeckt.
- [ ] Neustart übernimmt keinen ungeklärten Korrekturzustand als bestätigte sichere Ladung; keine neue Freigabe oder unbegrenzte Retryserie aus alten Zuständen.
- [ ] Diagnose nennt erwarteten/gelesenen Wert, Quellen-/Befehlszeit, Korrekturversuch und Ergebnis; keine Behauptung eines zweiten Reglers allein aus einer Wertabweichung.
- [ ] Nach getesteter Umsetzung natürliche Soll-/ACK-/elektrische Betriebskette prüfen; Softwaretests/CI getrennt von realer Abnahme berichten.

Dieses Issue beauftragt noch keine Installation, produktive Konfigurations-/Skriptänderung oder Aktorbetätigung. Keine globalen Timeout-/Polling-/SQL-Anpassungen und keine Änderung der600-s-Stoppverzögerung.

## Softwarestand alpha.114 — umgesetzt, reale Folgeabnahme offen

Umsetzung in [PR #217](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/217), nach grüner CI in main übernommen, Merge `f081e6b6ea6f792aed14de05dd708cd319fd5d58`.

Der qualifizierte ±1-A-Fall bei eigener aktiver Ladung mit separatem bestätigtem Befehlsdatenpunkt erhält genau einen begrenzten Korrekturversuch pro Ladezyklus. Ziel höchstens letzter eigener und aktuell noch zulässiger Strom, kein EIN und keine Erhöhung während der Korrektur. Feste vorhandene ACK-Frist; Reduktionen und Schutzprüfungen bleiben vorrangig. Größere/unklare Widersprüche, fehlender Nachweis, wiederholter Konflikt oder fehlender rechtzeitiger ACK stoppen weiterhin. Bestätigungen und Neustarts erneuern das Korrekturbudget nicht. Ungeklärter gespeicherter Korrekturmarker wird nach Neustart nicht übernommen. Marker wird vor Dispatch bestätigt gespeichert; nach dieser asynchronen Arbeit werden die Live-Grenzen erneut geprüft.

`Devices.WallboxN.CurrentCorrection_JSON` entsteht beim ersten Fall. Es dokumentiert erwarteten/gelesenen Wert, Quellen-/Befehlszeit, Versuch, Ziel, feste Deadline, Dispatch und Bestätigung; Schutzabbrüche bleiben über LastStopReason und vorhandene Antwortdiagnosen nachvollziehbar.

Softwarebelege: 2.369 Tests ohne Fehler/übersprungene Fälle, Paket-/Tarballinstallation und beide Vergleichsläufe lokal bestanden. Sowohl Push- als auch PR-CI unter Node 22 und 24 vollständig erfolgreich: [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/39414096787). 10/11/10-A-Regressionsfälle in 1P/3P schlagen auf alpha.113 fehl. Zusätzliche Tests behandeln beide ID-Pollreihenfolgen, alte/verspätete ACKs und rechtzeitigen ACK bei später Verarbeitung, feste Frist trotz Reduktion, zweiten Konflikt, Neustart und Sperren sowie Freigabe-/Budgetänderungen während der Marker-Speicherung. Die Tests modellieren den belegten Ablauf; sie sind keine vollständige Rekonstruktion aller ursprünglichen Gerätezeitpunkte und kein Ursachennachweis für den abweichenden go-e-Poll.

**Weiter offen:** natürliche Soll-/ACK-/elektrische Betriebskette nach manueller Installation, Geräte-/Adapterursache und quantifizierbarer Energiegewinn. Kein zugesagter Scoregewinn. Issue bleibt dafür offen. Die zusätzliche EHZ-Startreserve und −30-W-Warnbehandlung sind in den [Releasehinweisen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/main/docs/release-0.17.0-alpha.114.md) beschrieben; die 600-s-Stoppverzögerung ist unverändert.

<!-- eqe-current-stop-and-update-20261025 -->
## Neuer EQE-Fall25.10.2026 – Stopp vor142-Update, kein belegtes Scheitern einer laufenden3P-Uebergabe

Rein lesende Folgeuntersuchung, gepruefter main b02c1fe9c18496ef48c1e6e8b43a5ca7b2f2c296. Laufende/installierte Version142 und go-e1.0.42 separat ueber aktuelle Zustands-/Objektmetadaten bestaetigt. Alle folgenden Zeiten Europe/Berlin, MEZ.

### Belegte Reihenfolge
-10:39:10 kompakter Leistungstrace: zuvor11A, neuer10A-Befehl wartet auf Rueckmeldung; gemessen7280W.10:39:20 bereits10A aktiv/eigen,6440W; frische Parallelzuteilung11A. Diese10–15-s-Stichproben ersetzen keine vollstaendige ACK-Kette.
-10:39:34.095 LastStopAt, Warnung34.111: „Sollstrom-Rueckmeldung widerspruechlich; Korrektur nicht sicher freigegeben oder bereits verbraucht“. Erhaltene Diagnose FeedbackCurrent_A11A, aber erwarteter interner Strom und beide Originalquellen samt ts/ACK/q genau beim Konflikt fehlen. CurrentCorrection_JSON fehlt/null; daraus kein verbrauchter Korrekturversuch behaupten.
-10:39:35.834 Trace bereits AUS/kein aktiver Auftrag, gemessene Leistung noch5870W im Nachlauf;10:39:50.291 Leistung0W und OutputOwned=false. Das spaetere Update beginnt erst mit Terminate10:40:08.462, neuer142-Prozess10:40:14.807.
-RestartHandoffActive=false; RestartHandoffSince blieb auf altem24.10.-Zeitpunkt. Der aktuelle Unloadpfad erhaelt ausschliesslich aktive EMS-eigene Ausgaenge. Hier war der EQE bereits vorher gestoppt und elektrisch ruhig. **Kein Nachweis eines durch das Update abgebrochenen laufenden3P-Auftrags.**
-3P blieb nach Neustart zunaechst bestaetigt. Ab10:41:18 neuer300-s-Startcountdown.10:43:36/40 MustCharge/manueller Mindeststrom6A aktiv, Countdown bei zuvor165s beendet;10:43:46 neue Freigabe.
-Erst10:44:08 geht das EMS-Phasenziel auf1P (Zuteilung12A/2760W, Mindestladeanteil1380W);10:44:10 wird1P bestaetigt, mit nativer Pause und spaeterem Wiederanlauf.10:44:33/38 ist der manuelle Mindeststrom wieder0. Dies ist zeitlich eine neue Mindestlade-/Budgetentscheidung nach dem Update, kein beim Neustart verlorener3P-Modus.

### Codeabgleich und Nachweisgrenzen
Der bereits vorhandene handleCurrentCorrection-Pfad behandelt nur eng qualifizierte1-A-Konflikte; ein10-s-Beruhigungsfenster fuer zusammenpassende alte Pollwerte und genau ein begrenzter Korrekturversuch existieren bereits. Der Sammelgrund im neuen Stopp unterscheidet nicht, welches einzelne Gate scheiterte. Ohne damalige Command-/Feedbackwerte, Quellzeiten, maximalen Strom, Phasen-/Antwortzustand und konkretes Gate bleiben verspaetete Adapterantwort, groessere/andersartige Abweichung und sonstige Gegensteuerung offen. Keine Schutzlockerung oder Wiederholung der vorhandenen1-A-Korrektur begruendet.

Go-e-Upstream[PR366](https://github.com/MK-2001/ioBroker.go-e/pull/366) weiterhin offen/nicht gemergt, Headba90b5ab5ab851adfa68cee34c4c9645bcf05661. Dessen reproduzierte Antwortordnungsmoeglichkeit ist kein Beweis fuer den HTTP-Ursprung dieses neuen10:39-Ereignisses. Kein zweiter Upstream-Patch.

59 passende bestehende Offline-Tests zu Korrektur/Settling/Schutz/Restart bestanden. Zusaetzlicher isolierter Komponentendurchlauf mit aktuellem echten WallboxOutput: zuvor aktive/eigene3P-Ladung10A, frische gueltige Quellen und Neustartmarker werden ohne Stellschreibbefehl als3P uebernommen. Das bestaetigt den Softwarepfad, nicht eine reale Uebergabe dieses bereits gestoppten EQE.

Weiterer synthetischer Durchlauf der echten stabilizedPhaseTarget-Funktion: manuelle Mindestladung und eigenes Budget2760W koennen bei vorher3P sofort parallel-minimum-one-phase erzeugen; nach abgeschlossener Transition und aufgehobener Mindestladung qualifizieren6800W wieder300s fuer3P. Das passt zum gespeicherten Verlauf; der genaue historische Phasenentscheidungsgrund/volle Budgetkette um10:44:08 ist nicht erhalten. Keine pauschale Einstufung der Umschaltung als Fehler oder unvermeidbar.

### Enger naechster Nachweis
Bei neuem Sollstromkonflikt vor dem Sammelstopp einmal begrenzt festhalten: erwarteter/ausgelesener Strom, Original-Command/Feedback mit ts/ACK/q, letzter Dispatch und ACK, Korrektur-/Beruhigungsstatus sowie konkret fehlgeschlagene Sicherheits-/Budget-/Phasengates. Bestehenden Fall/Pfad verwenden, kein blindes Erweitern der1-A-Ausnahme und keine endlose Korrektur gegen andere Regler. Fuer eine Phasenoptimierung ist der zeitgleiche eigene3P-Budget-/Reserve-/Freigabenachweis noetig, nicht allein der Haus-PV-Ueberschuss.

Keine neue Version/Codekorrektur aus ungeklaerter Ursache, keine Anlagen-/Konfigurations-/Aktorwrites. Keine SQL-/Historienabfrage: der bereits beendete externe Abrufweg wurde nicht eigenstaendig neu geoeffnet. Kompakte aktuelle Zustandsdaten, vorhandene Logs/100-Ereignis-/20-Minuten-Traces genutzt; alter Ereignisteil bereits verdraengt. Bei einmaliger gebuendelter Zustandsantwort war PowerTrace abgeschnitten; generierter Download lokal nicht erreichbar, fehlenden PowerTrace anschliessend allein gelesen, erfolgreiche Ereignisdaten nicht erneut geladen. Downloadproblem ist kein SQL-Fehler.


<!-- alpha149-current-conflict-and-critical-events -->
## Softwarestand alpha.149 – konkrete Konfliktbedingung und geschuetzte Tagesereignisse

Am 25.10.2026 als [PR #260](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/260) nach sechs gruenen Branch-/PR-CI-Laeufen22/24/26 nach main uebernommen: `4b0f58a8c253ef7ad45d2ca8222ff0a03ae398b3`. [v0.17.0-alpha.149](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.149) am 25.10.2026 um 19:13:55 MEZ veroeffentlicht; Tag zeigt auf denselben Commit. [Releaseworkflow](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40220077108) samt erneuter22/24/26-Validierung und Publish erfolgreich.

Die bestehende Korrekturpruefung behaelt Reihenfolge, Kurzschlussauswertung, Schwellen, Retrybudget und anschliessenden AUS-Pfad. Die erste gescheiterte Bedingung wird als fester Code mit erwarteter/gelesener Vorgabe, Strom-/Leistungs-/Phasenkontext und Original-Command-/Feedbackwerten samt ts/lc/ACK/q in `Devices.WallboxN.CurrentConflict_JSON` festgehalten. Der bisherige Sammelstoppgrund erhaelt einen korrelierbaren Zeit-/Bedingungsanhang. Der passende Recorder-Vollsnapshot und Stopp-Ereigniskontext enthalten `wallboxes[].currentConflict`; die Tagesbilanz erhaelt einen kleinen Zusatz. Weitere, nach dem ersten Fehlschlag nicht ausgewertete Bedingungen bleiben unbekannt. Der Code benennt keine bewiesene Geraete-/Adapterursache.

Diagnosepersistenz wird nicht vor AUS abgewartet; haengende, abgelehnte und synchron fehlschlagende Diagnose-Schreibzugriffe sind gegen einen unveraenderten AUS-Befehl getestet. Der neue Zustand ist keine Korrektur-/Neustartberechtigung. Bestehenden alpha.114-Korrekturmechanismus nicht erneut beauftragen oder erweitern.

Zusaetzlicher belegter Kurzfassungsbefund am 25.10.18:47 Uhr unter alpha.148:35 erfasste Statusereignisse, `events=[]`, `eventOverflow=35`. Ab149 bleiben innerhalb unveraenderter100 Ereignisse/Periode und64.000Byte Gesamtzustand die sechs juengsten Wallboxstopps und zwei juengsten Recorderfehler-Beobachtungen getrennt reserviert. Normales SoC-Ende wird dadurch nicht zum Fehler. Byteknappheit entfernt erst nicht reservierte Ereignisse, dann abgeschlossene Untersuchungsepisoden mit weiterhin sichtbaren Typ-/Gesamtueberlaeufen. Erzwingt eine nicht weiter reduzierbare Basis dennoch Reserveverlust, nennt `eventRetention.protectedOverflow` diesen Anteil von `eventOverflow`; nicht zusaetzlich addieren. Quellen-/Energiebilanz und25-h-Zeitumstellungsperiode unveraendert. Alte entfernte Ereignisse bleiben verloren; kein Nachweis fuer SQL-Verlust daraus.

Softwarebelege:3115/3115 lokale Tests,26 zusaetzliche Tests, drei Kernregressionen scheitern auf148; Paketmetadaten/sieben Nachrichten, installierbarer Tarball243Dateien/720Zustaende und beide historischen Verhaltensvergleiche bestanden. Getesteter lokaler und Connector-Tree `9991f609e89b7e4ec49629325d4ee24d64815cf8` identisch. [Vertrag, Diagnosecodes und Abnahme](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/4b0f58a8c253ef7ad45d2ca8222ff0a03ae398b3/docs/release-0.17.0-alpha.149.md).

**Weiter offen:** Keine nachtraegliche Aufklaerung des10:39:34.095-EQE-Stopps. Nach manueller Installation den naechsten natuerlichen Konflikt mit passendem SQL-Original/Bedingungscode und unveraenderter AUS-/ACK-/elektrischer Antwort pruefen; Reserven/Ueberlauf bei wachsender Tagesbilanz getrennt abnehmen. Keine Anlagenversuche, SQL-/Historienabfrage, Installation, Neustarts oder Livekonfigurationsaenderung durch diesen Auftrag. Keine reale Abnahme oder Scorepunkte aus Softwaretests ableiten. Issue bleibt offen.

