# Issue #60 – [Offen] Recorder-/SQL-Ursache und nachhaltige Zustellqualität – Recovery unter alpha.186 vorhanden

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60. Letzte Issue-Änderung: 2026-11-01T22:21:46Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Aktives Leit-Issue Recorder / SQL – 01.11.2026

**Wieder geöffnet: reale Verluste und lange Transportwartezeiten sind weiterhin belegt.** #26 führt die allgemeine Qualitäts-/Veröffentlichungsarbeit; die technische Recorder-/SQL-Ursache wird hier gesammelt. Frühere Tagesberichte bleiben datierte Originalbelege.

### Bereits umgesetzt

- [x] Haltbares begrenztes Journal, Verlust-/Kapazitätsdiagnose, direkte begrenzte SQL-Prüfung mit exakten Originalnachweisen und getrennte Qualitätsanzeigen.
- [x] #312 / alpha.186: bei erkannter MariaDB ab 10.1 anfragebezogene Zwei-Sekunden-Ausführungs-/Lock-Grenze der eigentlichen Historienprüfung; kein unbeschränkter Ersatzversuch. Höchstens drei Recoveryversuche pro 15 Minuten statt dauerhaft erschöpfter Versuche.
- [x] Nach beobachtetem SQL-Neustart am 01.11. wurde die alte verwaiste Anfrage qualifiziert freigegeben; Journalrückstau anschließend abgebaut. Das bestätigt diese Recovery, nicht die Behebung jeder Latenzursache.
- [x] Letzter lesender Zustand bei dieser Pflege: Alpha 186, Recorder arbeitsfähig, Journal etwa 0,6 %, zwei unbestätigte Originale, Recovery idle/kein ungelöster Request. Historische Fehlerzähler werden dadurch nicht gelöscht.

### Verbleibender Fehler / Abnahme

- [ ] #313/S1: Tagesbeobachtung 46.171 verworfene Records und vier Schreibfehler, darunter volles Journal mit 134.211.291/134.217.728 Bytes. Ein aktueller Prozesszähler ist kein vollständiger Tageszähler; nicht addieren.
- [ ] #313/S2: auch unter 186 Transportwartezeit 2.081,658 s (18:06:40–18:41:22), danach 21 exakte Originalbestätigungen; Folgeanfrage mit Antwortfehler. DB-Ausführung, Metadaten-/Poolqueue, Sperren und Rücktransport sind nicht isoliert. Kein behaupteter neuer Indexbedarf oder Beweis, dass ein MariaDB-Statement selbst 2.081 s lief.
- [ ] Ursache anhand neuer, geeigneter natürlicher Fälle eingrenzen; keine geschlossenen alten SQL-Fenster erneut laden und keinen unbekannten Abschluss zwangsweise quittieren.
- [ ] Mehrtägige nachhaltige Aufnahme-/Zustellqualität, Original-/Hash-/Sequenzabdeckung und externe Abrufbarkeit getrennt belegen. Historische Verluste bleiben verloren/unbekannt.

Weitere datierte Belege: #290 (u.a. 391,252 s), #298 (485,985 s und unvollständige externe Folgeabdeckung), #305 (Latenzen/Abdeckungsgrenzen), #313. Lokaler ENOSPC einer Auswertungsumgebung ist nicht automatisch ein EMS- oder Datenbankfehler. Bedienung und Grenzen: [alpha.186](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/main/docs/release-0.17.0-alpha.186.md).

Diese Wiederöffnung ist eine Aufgabenbereinigung, kein Auftrag zu SQL-/Anlagenneustarts, Lastversuchen oder einer weiteren Regeländerung.

<details>
<summary>Datierte Entwicklung und frühere Prüfstände (historisch)</summary>

<!-- issue-audit-20261028 -->
## Fortschritt und verbleibende reale Fehler – 28.10.2026

Aktueller Code-main95fdc1e / alpha.161, laufende161 separat belegt. Aktueller Tagesbericht #278 ist maßgeblich; ältere Tagesberichte bleiben als historische Belege erhalten.

- [x] Dauerhafte gebündelte Journal-Segmente und begrenzte Wartungswerkzeuge in PR277/alpha.160 implementiert und getestet.
- [x] Direkte SQL-(id,ts)-Zeitbereichsprüfung mit begrenztem ID-Cache/Identitätsguard in PR279/alpha.161 implementiert; echte Callback-/Originalbestätigungen im Betrieb belegt.
- [x] SQL-Fristfall unter161 vom28.10.17:03:26 mit späterem vollständigem Callback nach399,621s und14 exakt bestätigten Originalen dokumentiert; danach wieder Bestätigungen ohne offene Blockade. Dies ist funktionierende Recovery, keine behobene Latenzursache.
- [ ] Nachhaltige Verlustfreiheit: #278 enthält19 reale Recorderverluste unter160 um13:00:20–21, Gruppen16+3 an der8-MiB-Rohqueuegrenze. Laufzeitverlustzähler0 unter161 löschen diese Tagesverluste nicht.
- [ ] Physische Storage-/Appendstau-Ursache und SQL-/Pool-/Sperr-/Rücktransport-Latenz getrennt klären;399,621s sind keine isolierte DB-Ausführungszeit.
- [ ] Mehrtägiger Nachweis ohne neue Verluste/ungeklärten Ablauf, mit Original-/Hash-/Sequenzqualität und externer Abdeckung. Alte verlorene Daten werden nicht wiederhergestellt.

Vorhandene SQL-Befunde in [alpha.161](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/95fdc1e7ca8e902a668fbcd43e500270bca21e3c/docs/release-0.17.0-alpha.161.md): vorhandener PRIMARY(id,ts), keine neue Indexpflicht; Betreiber-Threadcache32 mit Wiederverwendung belegt, Dauerhaftigkeit der Serverkonfiguration offen. Kein weiterer manueller SQL-Auftrag, keine Wiederholung alter Historienfenster, künstliche Last, Schutzlockerung oder neue Version durch diese Pflege.

Historische aktive Restthemen aus #181/#211/#219/#220/#231/#240/#249/#263/#271/#274 werden hier weitergeführt: Recorderverluste, verspätete/unbekannte Backendabschlüsse externer Abrufe, unvollständige Tages-/Decoder-/Quellenabdeckung und RAM-/Lastnachweise. Die konkreten damaligen Ursprünge bleiben datiert unbekannt, soweit die Originale fehlen; Archivierung bedeutet keine Fehlerbehebung.

---

## Aktives Leit-Issue Recorder / SQL – 19.10.2026

Dieses frühere Auswertungs-Issue bleibt als zuständige offene Aufgabe für Recorder-/SQL-Qualität erhalten. Archivierte Tagesberichte und deren unveränderte Reproduktionen siehe #36; jüngster vollständiger Tagesbefund #181.

- Bereits implementiert: lokale dauerhafte Originale, begrenzte Batch-Appends, schema4-Kompression, unabhängige exakte SQL-Bestätigung, begrenzte Rückstau-/Recoverypfade sowie alpha.96-Verlustepisoden mit Sitzung/Sequenz/Ereigniszeit und Queue-/Grenz-/Warte-/Appendkontext. Vor Änderungen aktuellen Code prüfen; keine doppelte Batch-Entwicklung.
- Weiter offen: produktive Verlustursache und nachhaltig verlustfreie Aufnahme bei tatsächlicher Last. #181 enthält 514 neue Verluste unter alpha.86/.93 trotz vorhandener Batch-Funktion; spätere kurze verlustfreie Abschnitte widerlegen das nicht.
- Sporadische PV-Historien-/Recorder-Verifier-Fristen bleiben zu diagnostizieren, getrennt von Dateifehlern/Queueablehnung/SQL-Speichernachweis. Aktuell leere Queue und frische Bestätigung sind keine nachträgliche Ursachenerklärung. Keine pauschale NAS-/SQL-Ursache, Timeout-/Queueerhöhung oder höhere Parallelität.
- Für neue Episoden Zeitlücken als begründete Randintervalle/Quellenabdeckung in Sekunden und hh:mm:ss sowie fehlende Record-/Sample-Anzahl getrennt darstellen. Planmäßige ruhige Vollframe-Abstände und Transportverzug sind keine Messausfälle.
- Mehrtägigen nachhaltigen Puffer-/Bestätigungsverlauf, neue Verluste, Ablauf/expiredUnconfirmed, Decoder-/Hash-/Sequenzqualität und RAM bei vergleichbarer Last getrennt bewerten. Verlorene alte Rohdaten bleiben unbekannt; keine Wiederherstellung behaupten.

Reproduktionen und Softwareabschlüsse insbesondere #123, #143, #145, #149 einschließlich Kommentare bleiben historische Referenzen. Noch offene reale Kontroll-/Phasenfälle gehören zu #7/#8, weitergehende integrierte Qualitätsanzeige zu #158 und Veröffentlichungstests zu #26. Kein neuer Vollabruf/Lasttest und keine Anlagenänderung durch diese Bereinigung.

---

<!-- status-review-2026-10-10-alpha63 -->
## Standabgleich 10.10.2026 – alpha.63

Geprüfter main: [88e85a2](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/88e85a223024ce69c849e4c67f288f2235504fa0), veröffentlichte und laut Startlog am 10.10. um 04:41:32 MESZ laufende **0.17.0-alpha.63** ([Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.63)). Produktive Regelung freigegeben, aktuelles Control.Valid=true. Dieser Snapshot ersetzt keine Ereignishistorie. Letzter belegter Score **69/100**, keine zusätzlichen Punkte durch Veröffentlichung/Installation. Historische Befunde unten bleiben datiert erhalten.

- [x] Zusammengehörige Records, Sitzungen/Sequenzen, Vollbasis und Delta-Replay softwareseitig vorhanden.
- [x] Begrenzter, rein lesender Abruf mit Limitprüfung, Deduplizierung, Replay-/Lückenprüfung und vorsichtigem Fehlerabbruch umgesetzt (alpha.60).
- [x] Ruhige Live-Diagnose auf 30-s-Zusammenfassungen verdichtet; Befehle und relevante Ereignisse unmittelbar, begrenzter Rohquellen-Vorlauf bis 60 s und dichter Nachlauf 120 s (alpha.62/.63, [#126](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/126), [#127](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/127)). Normale minütliche langsame Analogupdates verlängern das dichte Fenster nicht ständig. Operative Frischegrenzen bleiben unverändert.
- [ ] Vollständigen realen 24-h-Abruf einschließlich Vorbasis, Sitzungen, Sequenzen, Rand-/Restart-/Verlustgrenzen nachweisen.
- [ ] Sporadische SQL-/Connector-Zeitüberschreitungen und tatsächliche Datenmengenreduktion prüfen. Die genaue Ursache ist nicht behoben/nachgewiesen.

Intervallstatistiken sind beobachtete Zusammenfassungen, keine vollständige Sekundenhistorie und kein alleiniger Energie-/Abdeckungsnachweis. Puffer maximal 4096 Samples/1 MiB; Verluste und unveröffentlichte Daten bei Neustart bleiben unbekannt. Vorlauf enthält originale Quellenproben, keine nachträglich erfundenen vollständigen Entscheidungen. Bestehende SQL-Rohdaten/Skalarhistorien wurden nicht geändert. Issue bleibt offen.

---

<!-- status-review-2026-10-08-alpha54 -->
## Standabgleich 08.10.2026 – Ereigniskonsistenz und SQL-Abnahme

Geprüfter aktueller Stand: **0.17.0-alpha.54**, main [a9e99b7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/a9e99b782d4421bc3e69d5ef474f7dad879d8ca3), PR [#117](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/117), [GitHub-Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.54). Installationsobjekt und Laufzeitanzeige stimmen überein. Aktuell EMS-Livebetrieb: Ausgangsfreigabe EIN, Control.Valid=true; EQV/EQE-Phasenführung jeweils `ems`.

**Software umgesetzt:** zusammengehöriger DecisionRecord mit Ereigniszeit, Sitzung/Sequenz, realen Rückmeldungen, modellierten Ausgangszuständen und Verlust-/Fehlerdiagnose seit alpha.20 / PR #61. Der aktuelle Schema-3-Recorder mit Vollbasis und Replay stammt aus PR #112; alpha.54 ergänzt unabhängige go-e-Stoppdiagnosen.

**SQL-Teilnachweis:** Das Mii-Stoppfenster vom 08.10. **18:38:50–18:40:09.999 MESZ** wurde im Entwicklungsauftrag über zwei begrenzte Abrufmethoden mit **383 übereinstimmenden eindeutigen Records**, ohne interne Sequenzlücke und mit vorheriger Vollbasis rekonstruiert. Auftrag, Schreibecho, Timeout, echtes AUS und elektrische Ruhe sind getrennt nachvollziehbar. Belege: [#116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/116), [#117](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/117) und [Prüfdokument](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/a9e99b782d4421bc3e69d5ef474f7dad879d8ca3/docs/issue116-goe-stop-diagnostics.md).

**Weiter offen:** vollständiger produktiver 24-h-Abruf, Ursache großer Abfragefehler, ausreichende reale Netto-/my-PV-/Pumpenhistorie und längerfristige Geräteabnahme. Ein vollständiges kurzes Fenster beweist keinen vollständigen Tag. Der damalige 84-ms-Eintrag und das frühere WB0-Ladeende sind nicht nachträglich ursächlich geklärt.

Die frühere Phasenskript-Deployment-Lücke ist seit **08.10.22:19 MESZ** lesend als behoben bestätigt; tatsächliche Umschaltung/Rückgabe noch offen, siehe [#8](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8). Letzter belegter Score **66/100**. Historische Messbasis bleibt unverändert, Issue offen.

---

## Ergebnis und Einordnung

**Ergänzende SQL-Auswertung vom 26.09.2026 zu #57.** Gemeinsame Bearbeitung weiterhin ab 29.09.2026; hier werden zusätzliche Messbefunde und Prüfaufträge dokumentiert. Es wurden keine Steuerungs-, Konfigurations- oder Codeänderungen vorgenommen.

**Die drei realen Wallboxen zeigen im ausgewerteten Fenster jeweils einen zusammenhängenden Ladeblock ohne erfasste kurze Zwischenabschaltung. Der EMS-Master war weiterhin AUS. Dieses gute Ergebnis gehört zum Skriptbetrieb und ist keine bestandene EMS-Liveabnahme.**

Die bekannten Lücken bei Schattenmodell, PV-Diagnose und Phasenkoordination sind weiter relevant. Neu belegt ist eine zeitliche Inkonsistenz zwischen numerischer Schatten-Sollhistorie und Statushistorie, die eine automatische Unterbrechungszählung verfälschen kann.

Bezüge: #57 (erste Auswertung), #7 (Liveabnahme), #8 (Phasenkoordination), #25 (Speicher), #59 (sequenzielle Mehr-Wallbox-Prognose). #59 wurde hier nicht erneut anhand eines vollständigen 48-h-Plans geprüft; die beobachtete Echtzeit-Reihenfolge belegt keine Behebung des Prognosefehlers.

## Datenbasis und Methode

- Zeitraum: **25.09.2026, 06:48:42 bis 26.09.2026, 06:48:42, Europe/Berlin/MESZ**.
- UTC: `2026-09-25T04:48:42.117Z` bis `2026-09-26T04:48:42.117Z`.
- Installierte Version: **0.17.0-alpha.19**; Master AUS, Simulation/Schattenbetrieb EIN.
- SQL-Einrichtung bestätigt weiterhin **47 Schatten-Zeitreihen**, Aufbewahrung 86.400 s. Relevante Leistungs-, Status-, Phasen-, Timer- und Begründungsreihen sowie originale go-e-/PV-Leistungshistorien wurden gelesen.
- `Debug.Shadow.Valid`: **1.440 abgefragte Werte, alle true**. Das ist ein Gültigkeitsindikator der Berechnung, kein Gütesiegel für physische Start-/Stoppvorgänge.
- Originale go-e-Leistungshistorien: WB0 **2.221**, WB1 **2.213**, WB2 **2.038** Werte im Fenster; zusätzlich je ein unmittelbar vorhergehender Wert als Anfangswert. Keine null-Werte in diesen drei Originalreihen; größte gespeicherte Abstände ca. 60 s bei Änderungsaufzeichnung.
- Ladeblock-Erkennung: gemessene Leistung **>100 W**; kein dazwischenliegender gespeicherter Wert <=100 W innerhalb der unten genannten Blöcke.
- Energie: zeitgewichtete Integration der gespeicherten Leistungen, jeweils letzter Wert bis zum nächsten Wert; go-e kW in W umgerechnet, Fenstergrenzen berücksichtigt. Näherungswerte, keine Zählerstands-Abrechnung.
- In den Schatten-Istkopien gibt es kurze unbekannte Abschnitte: WB1 ca. **10 s**, WB2 ca. **98 s**. Diese wurden nicht als Abschaltungen behandelt; für die Ladeblöcke und Wallbox-Energien wurden die vollständigeren Originalreihen verwendet.
- Ereignisse zwischen Abfragen/gespeicherten Werten bleiben unbeobachtet. „Keine erfasste Unterbrechung“ bedeutet daher nicht den Nachweis lückenloser Millisekundenmessung.

## 1. Reale Ladeverläufe: alle drei Fahrzeuge mit längeren Ladeblöcken

Alle Zeiten in MESZ am **25.09.2026**.

| Wallbox | Zusammenhängender Ladeblock | Dauer ungefähr | Energie | Höchste Leistung |
| --- | --- | ---: | ---: | ---: |
| WB0 / Mii | 07:29:33–10:34:48 | 3 h 05 min | 12,72 kWh | 7,18 kW |
| WB2 / EQE | 11:00:11–12:53:12 | 1 h 53 min | 7,87 kWh | 4,47 kW |
| WB1 / EQV | 12:53:39–15:30:39 | 2 h 37 min | 8,01 kWh | 6,78 kW |

- Jeweils **ein** Ladeblock, keine erfassten kurzen Aussetzer darin, keine Überschneidung der drei realen Ladeblöcke.
- Tatsächliche Reihenfolge **WB0 → WB2 → WB1**.
- Am WB2-Ende steht um 12:53:14 in der Schattenbegründung „Kein Fahrzeug angeschlossen“.
- Am WB1-Ende wird um 15:30:32 „Ziel-SoC erreicht (90 >= 90 %)“ gemeldet; die SoC-Historie erreicht ebenfalls 90 %. Das passt zu regulärem Ladeende.
- Für das WB0-Ende fehlt eine entsprechend vollständige historische Fahrzeug-/Freigabesequenz; die genaue Ursache wird nicht behauptet.
- WB1 ist nach Rückkehr gegen 17:55 wieder ladeberechtigt, die Vorschau bleibt ohne nutzbares Ladebudget bei 0 W. Daraus wird kein Ladefehler abgeleitet.

**Korrektur aus #57 berücksichtigt:** Die gleichzeitige Ladung von WB0 und WB2 am 22.09. war laut Nutzer durch bewusst angehobenen Mindest-SoC gewollt. Sie wird nicht erneut als Fehlfunktion gezählt.

## 2. Schatten-Nullbudgets bestehen weiter

Die **Statushistorien** zeigen zwischen positiven Budgetabschnitten vier Nullbudget-Intervalle bei WB1 und zwei bei WB2:

| Wallbox | Beginn | Ende | Dauer |
| --- | --- | --- | ---: |
| WB2 | 11:03:00 | 11:05:06 | ca. 2 min 06 s |
| WB2 | 11:26:12 | 11:28:36 | ca. 2 min 24 s |
| WB1 | 13:23:48 | 14:04:18 | ca. 40 min 30 s |
| WB1 | 14:17:18 | 14:46:36 | ca. 29 min 18 s |
| WB1 | 15:11:36 | 15:13:48 | ca. 2 min 12 s |
| WB1 | 15:15:18 | 15:17:24 | ca. 2 min 06 s |

WB2 zusammen ca. **4 min 30 s**, WB1 gemäß Status ca. **74 min 06 s**. Die reale Ladung lief in diesen Zeiträumen weiter. Diese sechs Intervalle sind **keine sechs realen oder sicher vorhergesagten EMS-Abschaltungen**.

Begründungen nennen fehlendes nutzbares Ladebudget und Startverzögerung. Beispiel: am 25.09. um 14:17:18 wechselt das Schatten-Phasensoll von 1P auf 3P, während das WB1-Budget auf 0 W fällt. Nach Rückwechsel auf 1P um 14:44:30 zählt erneut die 120-s-Startverzögerung; ab 14:46:36 stehen wieder 1.380 W an. Das zeigt den Zusammenhang im Schattenlauf, ersetzt aber keine Prüfung des realen Phasenablaufs.

Alle drei `MinimumRunTimeRemaining_s`-Historien enthalten ausschließlich 0. Die unveränderte Konfiguration sieht 600 s Mindestlaufzeit, 120 s Start- und 120 s Abschaltverzögerung vor. Die aus #57 bekannte fehlende vollständige Simulation der Ausgangszustände bleibt deshalb eine wesentliche Aussagegrenze.

## 3. NEU: widersprüchliche SQL-Soll- und Statuswerte beim Phasenwechsel

Konkreter Befund für `Debug.Shadow.Targets.Wallbox1_W` am 25.09.:

| Zeit MESZ | Numerisch gespeicherter Wert |
| --- | ---: |
| 14:17:18.095 | 0 W |
| 14:17:18.179 | 1.380 W |
| 14:18:18.099 | 0 W |

Gleichzeitig zeigen sowohl `Wallbox1.Summary` als auch die gemeinsame `Summary` ab **14:17:18** ein Nullbudget; bis **14:46:36** gibt es dort keine erneute positive WB1-Budgetmeldung.

Folgen:
- Eine naive numerische Auswertung erzeugt zunächst ein **84-ms-Nullintervall**, danach knapp eine Minute positives Budget und erst anschließend die lange Nullphase.
- Aus der numerischen Reihe ergibt sich dadurch insgesamt etwa **73 min 06 s** WB1-Nullzeit, aus den Statusreihen etwa **74 min 06 s**.
- Der 84-ms-Eintrag ist kein Nachweis einer physischen Abschaltung und wird nicht als zusätzlicher Ladeabbruch gezählt.
- Die genaue Ursache ist **noch offen**; ein Konflikt bei Wiederholaufzeichnung, Zeitstempelbehandlung oder asynchroner Veröffentlichung ist zu untersuchen, nicht bereits als Ursache bewiesen.

Gelesene SQL-Einstellungen:
- Numerischer Sollwert: `blockTime=10000`, `changesRelogInterval=60`, `disableSkippedValueLogging=true`.
- Status: `blockTime=0`, ebenfalls 60 s Wiederholung und `disableSkippedValueLogging=true`.

### Prüfauftrag

- [ ] Den obigen Übergang anhand der gespeicherten Werte reproduzieren.
- [ ] Adapterveröffentlichung und SQL-Wiederholaufzeichnung auf alte/später geschriebene Werte sowie konsistente Zeitstempel prüfen.
- [ ] Start-/Stoppereignisse eindeutig historisieren, sodass ein verspäteter Wiederholwert keinen scheinbaren Neustart erzeugt.
- [ ] Automatische Auswertung gegen Status, Gültigkeit und reale Messwerte abgleichen; widersprüchliche Zeiträume kennzeichnen.
- [ ] Regressionstest für gleichzeitigen Phasen-/Budgetwechsel und Historien-Wiederholaufzeichnung ergänzen.

## 4. NEU konkretisiert: WB0-Schattenbudget bleibt nach realem Ladeende bestehen

- Reale WB0-Ladeleistung endet ca. **10:34:48**.
- Das Schattenbudget bleibt bis **10:59:48** bei **1.380 W**, also etwa 25 Minuten länger.
- Schattenbegründung zuvor: manueller Mindeststrom, später Pflichtladung unter Mindest-SoC.
- Um 10:59:48 wird Ziel-SoC erreicht gemeldet (**94,9 >= 90 %**), anschließend wechselt die Auswahl zu WB2.
- Das Schattenbudget bleibt während seines gesamten positiven WB0-Abschnitts auf 1.380 W, während die reale Wallbox bis 7.180 W aufnimmt.

Dies stützt die bekannte Aussagegrenze des Schattenmodells und zeigt, dass Soll-/Ist-Differenzen nicht unbesehen als Leistungsfehler interpretiert werden dürfen. Ohne vollständige Fahrzeug-, Freigabe-, Bedien- und SoC-Historie ist die Ursache des früheren realen Ladeendes nicht abschließend geklärt.

- [ ] Bei einem angeschlossenen, aber nicht mehr ladenden Fahrzeug Budget, Ladeende, SoC-Aktualisierung und manuelle Vorgaben gemeinsam nachvollziehbar darstellen.
- [ ] Virtuellen Hochlauf und realen Ladezustand sauber trennen; eine dauerhafte Startstromvorgabe darf nicht als vollständige Regelungsvorschau erscheinen.

## 5. Fortbestehende Mess- und Integrationslücken

- **PV-Diagnose:** 1.440 Schatten-PV-Werte im Fenster, alle null. Die Originalquelle enthält gleichzeitig ca. **58,88 kWh** PV-Erzeugung. Der aktuelle Quellwert wird weiterhin mit `ack=false` geliefert; die bekannte unterschiedliche Messwertbehandlung aus #57 besteht fort. Null bedeutet hier unbekannt, nicht 0 kWh.
- **Statushistorie:** Für die abgefragten originalen `go-e.X.car`, `allow_charging` und `phaseSwitchMode` werden weiterhin keine SQL-Werte geliefert.
- **Phasen:** Das Schattenmodell fordert bei WB1 und WB2 zeitweise 3P. Die aktuell gelesenen bestätigten go-e-Modi stehen auf 1P; deren Änderungszeiten liegen vor dem Auswertefenster. Mit ausgeschaltetem Master ist dies allein kein Defektnachweis. Die in #57/#8 festgehaltene Kopplung und begrenzte Wartezeit bleiben offene Integrationsarbeiten.
- **Speicher/zweiter EHZ/WP:** weiterhin nicht aktiv zur Koordination freigegeben; kein neuer Praxisnachweis.
- **EHZ-Messspitze:** Schatten-Istkopie maximal 9.284 W, Originalquelle `javascript.0.ehz.power` maximal **9.304 W**; im Original 14 Werte über 9.000 W, zeitgewichtet zusammen ca. 68 s. EHZ-Energie aus der Schatten-Istreihe ca. **16,72 kWh**. Das sind Messwerte des Skriptbetriebs, kein Nachweis eines EMS-Befehls über der eingestellten 9-kW-Grenze. Bei späterer Abnahme Sollbefehl, Messung und elektrische Betriebsbedingungen abgleichen.
- **Netzbilanz zur Einordnung:** aus der gemessenen Netzleistung ca. **14,75 kWh Bezug** und **1,72 kWh Einspeisung**. Da der EMS-Master AUS ist und bewusste Pflichtladung möglich war, werden diese Mengen nicht als EMS-Regelfehler gewertet.

## Vergleich mit dem 22.09. und weitere Bearbeitung

| Punkt | Neuer Befund |
| --- | --- |
| Reale Ladeblöcke | Jetzt alle drei Wallboxen mit je einem längeren ununterbrochen aufgezeichneten Ladeblock |
| Gleichzeitiges Laden | Im neuen Fenster keine Überschneidung; frühere bewusste Mindest-SoC-Anhebung berücksichtigt |
| Schattenmodell | Bekannte Grenzen bestehen fort; WB0-Nachlauf konkret dokumentiert |
| Schatten-Nullbudget | WB1 und WB2 betroffen; andere Fahrzeuge/Wetter/Bediendaten und andere Fensterlänge verhindern einen direkten Fortschrittsvergleich mit den elf Intervallen vom 22.09. |
| Datenkonsistenz | Neuer konkreter Widerspruch zwischen numerischer Sollhistorie und Status bei 14:17:18 |
| Produktive EMS-Stabilität | Weiterhin nicht durch diese Daten nachgewiesen, da Master AUS |

- [ ] Bei gemeinsamer Durchsicht ab 29.09. zuerst den neuen SQL-Konsistenzbefund zusätzlich zu den Arbeiten aus #57 priorisieren.
- [ ] Phasenkoordination und vollständigeres Schattenmodell vor der nächsten unbeaufsichtigten EMS-Freigabe behandeln.
- [ ] Nach Korrekturen einen begleiteten EMS-Test mit wechselndem PV-Überschuss und dokumentierten Start-/Stopp-/Phasenereignissen durchführen.
- [ ] #59 separat anhand mehrerer berechtigter Fahrzeuge im selben 48-h-Fahrplan abnehmen.

Die Zahlen und Ereignisse bleiben mit diesem Issue als zusätzliche Vergleichsbasis erhalten. Es wurde keine Aufbewahrungszeit verlängert; eine vollständige Rohdatenwoche ist weiterhin nicht zugesichert.


## Ergänzung24.10.2026 – 14 Recorder-Abweisungen, [Tagesbericht#249](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/249)

Mit vorhandenem SQL-Prüfstand weiter eingegrenzt, keine neuen Abrufe: Sitzung1792835138248, seq3915–3925/3928–3930,12:01:15.278–16.751 Berlin. Bytegrenze8MiB bei94/128 Rohrecords,1.236.365 gemeldete abgewiesene Rohbytes. Sechs gespeicherte Batchmessungen:3862ms Wartezeit und5645ms aktiver Append. Beispiel2064ms Warten/110ms Append; andere aktive Appendphase2671ms. Aktiver Append enthält mehrere lokale Schritte, keine isolierte SQL-/NAS-/fsync-Zeit. Erhaltene Journal-readErrors/writeErrors0; Caller-Abweisungen sind davon getrennt.

Gemeinsame Queue für Append, lokale Reads und Metadaten/Bereinigung im aktuellen main geprüft. Vorgängeroperation und genaue langsame Schreib-/Syncphase sind historisch nicht erfasst.38 vorhandene Regressionen bestanden; dies zeigt mögliche Stauklassen und saubere Verlust-/Restartnachweise, beweist keinen bestimmten damaligen Verursacher. Keine pauschale Queueerhöhung oder spekulative Performancekorrektur.

[PR251](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/251) nach grüner Node22/24/26-CI übernommen, mainf0af108dd8afc839713cdea567fecb2dee1ce790; [vollständige Diagnose](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/f0af108dd8afc839713cdea567fecb2dee1ce790/docs/issue249-recorder-goe-followup.md). Nur Dokumentation/Offline-Tests, keine produktive Recorderänderung oder neue Version. Fall bleibt offen. Nächster fehlender Nachweis: bei neuem natürlichem Stau vorangegangene Journaloperation und einzelne lokale Phasen zeitlich zuordnen; alte erfolgreiche SQL-Fenster nicht erneut laden. Anlagenzugriff unverändert rein lesend.


---

<!-- sql-night-analysis-20261025-alpha140 -->
## Nachtprüfung 25.10.2026 – SQL-Prüffehler und fehlende Ereignisprovenienz

Rein lesende Diagnose, **keine neue SQL-/Historienabfrage**, keine Anlagen-/Konfigurationsänderung. Geprüfter main `f0af108dd8afc839713cdea567fecb2dee1ce790`; aktuelle Laufzeitanzeige **0.17.0-alpha.140**. Gleiche Versionsnummer beweist keinen installierten Dateihash.

### Belegte Befunde (Europe/Berlin)

- Vor dem manuellen Dateiabruf gegen **00:39 Uhr MESZ** bereits `queryErrors=2`. Der externe, auf 20 Transportwerte begrenzte 24-h-Versuch endete nach **25,941 s** mit `McpServerError: ioBroker did not answer in time`; keine Rohdaten/Datei/Downloadlink. Um **00:40:01 MESZ** produktiver Verifier `queryErrors=3`, lokales 30-s-Deadlineereignis und unbekannter Backendabschluss. Zeitliche Nähe ist kein Kausalbeweis.
- Vergleich **00:40:01 MESZ → 07:50:57 MEZ**: `queryCount 1996→7689`, `queryErrors 3→13`: zehn weitere Prüf**fehler** bei 5693 weiteren Versuchen. Die einzelnen Fehlerklassen sind nicht alle erhalten; nicht als zehn sicher belegte Timeouts ausgeben. Jüngstes gespeichertes Fehlerdatum **05:03:17 MEZ**, letzter Fehlertext `local query deadline; backend completion unknown; verification stopped`.
- Bei Abschluss aktuelle Abfrage erfolgreich: **2 Transportzeilen / 19 Originale**, 32.454 gemessene Rohzeichen, etwa **29 ms Antwortbeobachtung / 56 ms Gesamtverarbeitung**. Das sind EMS-seitig gemessene Zeiten einschließlich lokaler Schritte, keine isolierte Datenbanklaufzeit. Fehlerzähler weiterhin13, Fence/Backendblock AUS, frische exakte Originalbestätigung, Journal ca.0,61MB/12 unbestätigte Originale in zeitlich benachbarten Snapshots.
- Lokale beobachtete Verlust-/Schreibfehlerzähler weiterhin0, gespeicherte Verlustepisoden unverändert historisch; Ablaufzähler17390 und expiredUnconfirmed8537 gegenüber Nachtprüfstand unverändert. Kein neuer Datenverlust daraus belegt, aber keine vollständige SQL-Tagesabnahme.
- EMS- und SQL-Prozesszustände zeigen keinen Neustart seit Beginn der Nacht. Zugängliche gefilterte Logs liefern keine passende SQL-/EMS-Ursachenmeldung. Aktuelle CPU-/RAM-/Eventloopwerte sind keine historischen Belastungsnachweise.

### Codebefund und Grenzen

Der 30-s-Timer beginnt vor `journal.beginVerification`; bis zur erfolgreichen Antwortbeobachtung gehören Journal-Fence-Vorbereitung, ioBroker-Nachrichtenweg/SQL-Antwort und dauerhafter Fence-Abschluss zum Messpfad. Daher ist „30 s“ nicht gleich „30 s reine SQL-Ausführung“. Nach unbekanntem Abschluss sind weitere Verifierreads gesperrt. Eine tatsächlich nachgelieferte SQL-Antwort kann ihren eigenen Fence dauerhaft aufheben; ein bloßer Cooldown darf das nicht. Die beobachtete Erholung ohne Prozessneustart passt zu diesem Pfad, die einzelnen späten Antwortzeiten sind nicht erhalten.

Die produktive Prüfung nutzt kleine2-s-Grundfenster, kann gesunde benachbarte Arbeit auf höchstens10s bündeln, Limit32 und eine Abfrage zugleich. MCP-Datei-/1MiB-Grenzen liegen außerhalb dieses direkten EMS→SQL-Pfads; MCP1.4 erklärt/behebt produktive Verifierfristen nicht automatisch.

**Belegte Diagnoselücke:** `DecisionRecordDelivery` besitzt einen Ring der letzten128 Abfragen im RAM. `ShadowController.publishRecordHealth` lässt `recentQueries` im veröffentlichten Status absichtlich weg; dort überschreibt jeder Erfolg `lastQuery`. Der Fehlertext bleibt zwar erhalten, aber kein stabiler eigener Verlauf mit Fehlerfenster, lokalen Teilzeiten und späterem Callback. Der vorhandene RAM-Ring ist kein dauerhaft erreichbarer Nachtfehlerverlauf.

**Ursache offen:** DB-Sperren/Prozessliste, tatsächliche Poolwartezeit, historische Eventloopverzögerung und lokale Journalteilzeiten beim Fehler sind nicht zugänglich/belegt. Keine pauschale NAS-/Index-/SQL-/Zeitumstellungsursache und kein kausaler Nachweis gegen den manuellen Dateiabruf. Keine Timeout-/Queueerhöhung oder zusätzliche Parallelität begründet.

### Nächster enger Diagnoseauftrag (noch nicht implementiert)

Vorhandene Query-/Fence-Identitäten wiederverwenden und einen kleinen separat begrenzten Fehlerverlauf vorsehen, der erfolgreiche Abfragen überlebt: Fehlerklasse/Fenster/Limit, lokaler Journalbeginn/-abschluss, Transportversand und tatsächlicher Callback, späterer Fence-Abschluss und begrenzte Stau-/Qualitätsindikatoren. Keine SQL-Nachfragen, zusätzlichen Polls, vollen Rohwerte oder privaten Konfigurationen speichern; nur vorhandene natürliche Abläufe instrumentieren, Veröffentlichungsgröße/-frequenz begrenzen. Fehlerhäufigkeit und SQL-/lokale Phasen getrennt ausweisen. Der Ring von128 erfolgreichen/fehlgeschlagenen Abfragen soll nicht pauschal sekündlich veröffentlicht werden.

Regressionen: lokales Fence-Warten, rechtzeitiger/verspäteter Callback, unbekannter Abschluss und nachfolgende erfolgreiche Prüfung; Fehlerbeleg muss erhalten bleiben, keine neue Anfrage vor Abschluss, keine falsche Speicherbestätigung. **17 bereits vorhandene gezielte Offline-Tests zu Deadline, spätem Callback, Backoff und Recovery bestanden.** Dies bestätigt Softwareverträge, nicht die reale Nachtursache. Reale Abnahme erst an einer neuen natürlichen Episode mit vollständigen Phasenzeiten. **Kein Performancefix, keine neue Version und kein Release in diesem Analyseauftrag.**


<!-- alpha141-sql-failure-checkpoint-delivered -->
## Softwareabschluss25.10.2026 – alpha.141

Die oben belegte Diagnoseluecke ist in [PR252](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/252) korrigiert, nach sechs gruenen Node22/24/26-Pruefungen auf Head80351d320bce8cc531b46bac8469284e384f6401 nach main uebernommen: **850407124055bb29dad007c4e076fa98c4a5c3a7**. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40172358611); lokale Gesamtsuite3008/3008, abschliessende71 fokussierte Tests, Paketmetadaten/isolierter Tarball und beide historischen Vergleiche bestanden. Fuenf neue Delivery-Diagnosefaelle scheitern mit der unveraenderten Delivery-Basis; zwei neue reine Helpertests sind davon getrennt.

**[GitHub-Prerelease0.17.0-alpha.141](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.141) veroeffentlicht**, Tag zeigt exakt auf obigen main-Commit. [Regulaerer Releaseworkflow](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40172542522) einschliesslich erneuter Node22/24/26-Validierung und publish erfolgreich.

Neuer nur lesbarer Zustand: `Debug.Shadow.RecordSQLFailures_JSON`, hoechstens16 Fehler/16KiB, nur Aenderungen im vorhandenen1-s-Takt, keine automatische SQL-Historisierung. Fehler bleiben ueber Erfolge und normale Adapterneustarts erhalten; spaeter Callback/Fence-Abschluss aktualisiert denselben Fall. Feste Metadatenprojektion ohne Rohrecords/SQL/Fehlersecrets. Getrennte lokale Journal-, Transport-/Callback- und Fencezeiten, explizite unbekannte Werte und Verdraengungszaehler; letzter Stand bei abruptem Ausfall vor Speicherung weiterhin nicht garantiert. Der Checkpoint wird auch bei verlangsamten/verworfenem skalarem Diagnoseframe unabhaengig erhalten. [Vertrag/Abnahme](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/850407124055bb29dad007c4e076fa98c4a5c3a7/docs/release-0.17.0-alpha.141.md).

**Keine Behebung der eigentlichen Nachtverzoegerungsursache behauptet.** SQL-Abfragezahl/-fenster, Timeout, Parallelitaet, Speicher-/Recoverygrenzen und Regler unveraendert; keine neuen Historien-/SQL-Diagnoseabfragen oder Anlagenwrites. Zuletzt separat lesend installiert **und** laufend140; keine141-Installation/Neustart ausgefuehrt. Reale Folgeabnahme an einer neuen natuerlichen Fehlerfolge offen. Issue bleibt offen.

Der bestehende20-Uhr-Auftrag wurde gezielt um das bedingte Lesen/Auswerten dieses Zustands ab realer Installation141 ergaenzt; Speicherung geprueft, Zeitplan/45Minuten/10+5/SQL- und Fehlergrenzen unveraendert. Keine erneute Entwicklung derselben Diagnoseluecke beauftragen.


<!-- alpha141-live-start-confirmed -->
### Installation separat bestaetigt

Nach obigem Softwareabschluss System.Version **0.17.0-alpha.141** lesend bestaetigt (Versionsmeldung25.10.2026,08:24:26 MEZ), alive=true. Neuer Fehlercheckpoint schema1 vorhanden, checkpointStatus=new/failures=[], evicted0; das ist ein neuer Beobachtungsbeginn, keine rueckwirkende Fehlerfreiheit. Aktuelle frische exakte SQL-Bestaetigung, Backend/Fence nicht blockiert,2 offene Nachweise; queryErrors0 gilt nur fuer die neue Sitzung. Keine Installation oder Anlagenaktion durch diesen Agenten ausgefuehrt. Reale Langzeit-/Fehlerfolgeabnahme bleibt offen.


<!-- alpha142-recorder-drain-delivered -->
## Neue lokale Recorderverluste25.10.2026 und Softwarekorrektur alpha.142

Unter laufender141 stieg RecordDropped seit Neustart von0 auf66. Neue Sitzung1792913049643, erhaltene Episoden unter anderem seq15063/15072 um09:32:17/18 MEZ und22463–22491/22494–22519 um09:52:09–16 MEZ. Die vier erhaltenen Episoden enthalten57 Abweisungen; neun weitere neue Details sind im begrenzten Ring verdraengt.8-MiB-Rohqueue bei rund90 Records, gespeicherte Queuewartezeit bis16.240ms, ein abgeschlossener Append3747ms aktive Verarbeitung. Keine isolierte NAS-/fsync-/SQL-Ursache daraus ableitbar. Zeitgleich1319 produktive SQL-Pruefungen/0Prueffehler, frischer exakter Originalnachweis und keine SQL-Sperre; das bestaetigt keine bereits lokal verworfenen Records.

**[PR253](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/253)** nach sechs gruenen Node22/24/26-Pruefungen auf Headee25e3193b879ab9b3b0577eb2536b8c8c13e1f6 uebernommen. Gepruefter main/Tag **b02c1fe9c18496ef48c1e6e8b43a5ca7b2f2c296**, exakter lokaler/Remote-Baumbestand0c69265d36d44981111fae66b326d1b9d9b6b3ca. **[Release0.17.0-alpha.142](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.142) veroeffentlicht**; [regulaerer Releaseworkflow40179961897](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40179961897) einschliesslich erneuter Node22/24/26-Validierung und publish erfolgreich.

Umgesetzt: begrenzter Append-Vorrang bei weiter genau einer lokalen Operation; spaetestens nach vier Append-Turns Bedienung der aeltesten anderen Operation. Bestaetigte Bereinigung bei wartenden Recorderoriginalen zurueckgestellt; danach automatisch hoechstens eine Gruppe/16 Dateiloeschungen je Turn. Ganzgruppen-Marker und bestehende Startup-Recovery bleiben erhalten, teilweise bereinigte Ketten sind keine Replaybasis. Groessere512-KiB-Rohbatches werden nach tatsaechlicher UTF-8-Kodiergroesse am unveraenderten512-KiB-Journalcap geteilt; bereits dauerhaft gespeicherter Anfang wird bei spaeterem Teilfehler nicht als Verlust gezaehlt. Kein neues Dateiformat oder Migration. Queuekapazitaet, Datei-/Directory-Synchronisation, SQL-Originalnachweise/Fences/Fristen/Parallelitaet, Retention und Regler-/Schutzgrenzen unveraendert.

3013/3013 lokale Tests, fuenf neue Regressionen (alle fuenf mit unveraenderter141 fehlgeschlagen), Paketmetadaten/isolierter installierter Tarball und beide historischen Vergleiche bestanden. In zwei Recorder-Vergleichsfixtures wird die ausdruecklich geaenderte Drainpolitik identisch vorgegeben; keine Ausgaben/Felder entfernt, neue Politik separat vor/nach getestet. Synthetische zwoelf grosse Quellkontexte benoetigen hoechstens drei statt sechs Sammelschreibgaenge, alle angenommenen Originale rekonstruierbar. Dies ist kein Live-Lasttest/Geschwindigkeitsversprechen und keine Behauptung eines ermittelten Dateisystemfehlers.

**Installation/reale Abnahme offen:** zuletzt separat gelesene System.Version weiterhin141, alive=true. Keine Installation/Neustarts/Anlagenwrites und keine neue SQL-/Historienabfrage durch diesen Auftrag. Neue natuerliche Quell-/Lastfaelle nach separat vorgenommener142-Installation auf Verlustzunahmen, Queuewartezeit, Rueckstauabbau und frische exakte SQL-Bestaetigungen pruefen. Die bisherigen66 Verluste bleiben historische Luecken; kein zweiter Fix/keine alte Grundanalyse fuer dieselbe Politik. [Vollstaendiger Vertrag](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b02c1fe9c18496ef48c1e6e8b43a5ca7b2f2c296/docs/release-0.17.0-alpha.142.md).

Der bestehende20-Uhr-Auftrag wurde nach frischem Promptlesen um diesen Fall/Fix und die bedingte Folgeabnahme ergaenzt; gespeicherte Fassung exakt geprueft.45Minuten/10+5, SQL-/Fehlergrenzen, Autorbeschraenkung und Ausschluss blosser Nachtueberschuesse erhalten. Issue bleibt offen; keine Score-/Wirksamkeitspunkte aus Tests.


<!-- alpha144-late-exact-sql-proof -->
## Softwarekorrektur25.10.2026 – alpha.144: spaete SQL-Antworten nutzen

Unter separat bestaetigter installierter/laufender143 ueberschritt die interne Nachweisabfrage fuer11:20:06–11:20:07.999 MEZ um11:20:36 die lokale30-s-Frist. Tatsaechlicher Callback11:21:22, etwa75,843s Transportwartezeit, danach dauerhafter Fence-Abschluss. Gegen11:22:11 wieder freier Abrufweg und erfolgreiche Folgeabfrage. Die Transportwartezeit belegt keine isolierte DB-Laufzeit oder NAS-/Poolursache. Keine neue SQL-/Historienabfrage fuer diesen Auftrag.

**Enger Codefehler:** Nach der Deadline aktualisierte die spaete Antwort den Fehler/Fence, durchlief aber den Originalabgleich nicht mehr. Bereits gespeicherte Originale konnten dadurch lokal unbestaetigt bleiben und eine erneute Nachweisabfrage benoetigen. Zwei neue Kernregressionen (Pakettreffer und reales Journal) scheitern gegen unveraenderte143.

**[PR255](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/255)** mit Head0e7d231cc0fc91e0c2dd9f7f1071d1649dd003cf nach sechs gruenen Node22/24/26-Pruefungen uebernommen: main **d0929fe0b48aeb0b3a3730465e8f8c07ee6bc8c3**, lokaler/Remote-Baum exakt9f7584a858827121aae0f9b5d168db342496c01e. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40185238240).

Ein gemeinsamer Antwortverbraucher prueft rechtzeitige und spaete Resultate gegen dieselben Paket-, Fenster-, Mengen-, Sitzungs-, Sequenz- und Hashgrenzen. Nur exakte Treffer der urspruenglich angeforderten Originale werden dauerhaft bestaetigt; Duplikate einmal. Gate bleibt bis zum Abschluss der spaeten Verarbeitung geschlossen; bestehender begrenzter Shutdown drain umfasst diese Verarbeitung. Nach bereits erfolgtem Stop keine neue Bestaetigung aus dem Callback. Leere/spaete Antworten erzeugen keine neuen Miss-/Replayentscheidungen; alte Nachweise werden nicht zu frischen Recoverybelegen. Urspruengliche Deadline/Fehlerzahl bleibt erhalten. Optionaler begrenzter Checkpoint: lateResponseAt, lateProcessedAt, lateConfirmedRecords, lateOutcome; bestehende schema1-Checkpoints weiter lesbar,16Eintraege/16KiB, keine Rohdaten/privaten Fehlertexte.

**3034/3034 lokale Tests**,15 neue Deadline-/Sicherheitsfaelle einschliesslich realer Journalbestaetigung ueber Neustart, Paketmetadaten7Notizen, isolierter installierter Tarball237Dateien/720States und beide historischen Vergleichslaeufe bestanden; keine neue Vergleichsnormalisierung. Query-/Writebudgets, Fristen, Parallelitaet, Puffer/Retention, fsync und Regler-/Schutzgrenzen unveraendert. Kein Liveversuch oder Anlagenwrite.

**[Release0.17.0-alpha.144](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.144) am25.10.2026 um11:38:11 MEZ veroeffentlicht**, prerelease=true/draft=false, Tag zeigt exakt auf obigen main-Commit. [Regulaerer Releaseworkflow40185447355](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40185447355) einschliesslich erneuter Node22/24/26-Validierung und publish erfolgreich.

**Reale Folgeabnahme offen:** Nach separat vorgenommener Installation144 eine neue natuerliche spaete Antwort anhand identischem verificationId/Fenster, Callback/Fence, lateProcessedAt/lateOutcome/lateConfirmedRecords und genau einmaliger Bestaetigung nachvollziehen. Keine erneute Abfrage eines dadurch erledigten Fensters; Journalbytes UND unbestaetigte Originale samt Ablaufzaehlern vergleichen. Ursache langer Antwortzeit, komplette SQL-Zustellung und Langzeitwirksamkeit bleiben offen; kein zugesicherter Performance-/Energiegewinn oder Scorezuwachs. Issue bleibt offen. Letzter separater Installationsnachweis143; keine Installation/Neustarts ausgefuehrt.


<!-- alpha143-recorder-recurrence-20261025-noon -->
### Neuer realer Folgefall25.10.2026,12:00 MEZ – Recorder erneut an Rohqueue-Bytegrenze

Lesend weiterhin System.Version0.17.0-alpha.143; installierte143 bereits separat vor diesem Ereignis bestaetigt, exakter installierter Buildhash unbekannt. RecordDropped=12 und RecordWriteErrors=12 in dieser Laufzeit. Zwei neue erhaltene Verlustepisoden in Sitzung1792923330524: seq14621–14626,12:00:16.843–12:00:17.144 (6Originale/544801Rohbytes), und seq14652–14657,12:00:21.529–12:00:21.894 (6Originale/545678Rohbytes). Kein erneutes Laden/Analysieren alter Vormittagsfenster und keine externe SQL-Abfrage.

Jeweils Bytegrenze, nicht128-Record-Grenze:92wartendeOriginale,8310379bzw.8322262Rohbytes vor weiterer Annahme bei8388608Bytes Kapazitaet. Gespeicherte aelteste Wartezeit bis7889ms; laufende5er-Appends und abgeschlossene Appenddaten vorhanden. Aktuell danach Queue9Originale/831615Bytes und Journalca.4.08MB; dies ist ein punktueller Rueckgang, keine vollstaendige verlustfreie Abnahme. JournalwriteErrors=0/readErrors=0; die12Recorder-Schreibfehler sind nicht automatisch12Dateisystemfehler. Keine belegte NAS-/SQL-/Blockierungsursache.

Tagesbilanz observedUntil12:00:20 enthielt erst72beobachteteVerwerfungen; sie lag vor der zweiten Episode und darf nicht gegen den spaeteren Laufzeitzahler12 verrechnet oder als Widerspruch gewertet werden. Begrenzte Verlust-/Tagesringe koennen historische Details verdraengen. SQL-Verifier beim benachbarten Abruf entsperrt,queryCount667/queryErrors1 dieser Sitzung, erfolgreiche aktuelle Originalbestaetigung; letzter gespeicherter SQL-Deadlinefall weiterhin11:20:36. Kein Nachweis, dass SQL diesen neuen Rohqueuestau verursacht hat.

**Offen fuer gezielte Folgeanalyse:** Zeitlich zugehoerige bereits vorhandene Queue-/Append-/Journalphasen und Quellburstmenge dieser NEUENEpisode nach dem142-Drainumbau abgleichen; Rohbyte-Ankunftsrate, Append-/Wartearbeit und konkurrierende Journaloperationen unterscheiden.142 ist damit nicht als reale Verlustfreiheit abgenommen.144 behandelt spaeteSQLNachweise und ist noch kein Nachweis einer Behebung dieses lokalen Staus. Keine pauschale Queuevergroesserung, keine Wiederholung des bereits umgesetzten142-Fixes und keine neue Codekorrektur ohne eng reproduzierten Befund. Diese Statuspruefung fuehrt keinen Entwicklungsauftrag/Liveversuch aus. Issue bleibt offen.


<!-- alpha145-recorder-status-20261025-1303 -->
### Folgebeobachtung25.10.2026,13:03:49 MEZ – laufende145

Nach separat gelesener145-Version und dem im Log belegten Adapterstart12:01:17: neue Laufzeit zaehlt RecordDropped=24/RecordWriteErrors=24, also weitere reale Verluste nach dem vorigen143-Fall (12Originale um12:00). Neue Sitzung1792926076895; juengste erhaltene Episode seq18300 um12:53:48.615,1Original/88607Rohbytes abgewiesen. Erhaltenes Kontextbild:93wartendeOriginale/8319588Rohbytes bei8388608Bytecap, keine128Record-Grenze, aelteste Wartezeit9811ms, aktiver5er-Append, letzter abgeschlossenerAppend1828ms. Gleicher beobachteter Rohqueue-Bytegrenzenpfad; keine zweite unabhaengige Ursache oder unbewiesene NAS-/SQL-Ursache daraus ableiten. Die komplette24er-Ereignisverteilung wurde in dieser kompakten Statuspruefung nicht rekonstruiert.

Aktuell SQL954Pruefungen/0Prueffehler dieser Sitzung, Backend/Fence frei, frischer exakter Originalnachweis. Journalca.3.78MB,7unbestaetigteOriginale und Rohqueue1Original/93465Bytes in benachbarten Snapshots; JournalwriteErrors/readErrors0. HistorischerexpiredUnconfirmedZaehler8537 unveraendert; keine Alterung als Recovery ausgegeben. Der aktuelle Rueckstauabbau ersetzt keine Verlustfreiheit. Mii aktiv,9A-Soll mit noch ausstehender elektrischer Antwort, kein neuer LastStop-Zeitstempel; keine aktuelle Ausgangsstoerung belegt. Keine SQL-Historienabfrage, Konfigurations-/Anlagenwrite, Codeaenderung oder neue Releaseausfuehrung. Bekannten lokalen Verlustfall weiterfuehren; kein erneuter142/144-Fix ohne gezielten Befund. Issue bleibt offen.


<!-- alpha146-recorder-startup-loss-20261025 -->
## 25.10.2026 – neuer Recorderverlust nach Start von alpha.146

Lesend bestaetigt: System.Version alpha.146; main ueber Connector `d0df1411e98722b3ce8317b7feb393812bfe9602`. **Neue Sitzung1792939197779, Sequenz97–204, Originalereignisse15:40:29.827–15:40:42.511 MEZ:108 lokal abgewiesene Originale,9.445.810 Rohbytes.** RecordDropped/RecordWriteErrors108. Dies sind echte lokale Abweisungen, keine bloss unbekannten externen SQL-Abrufe und keine nachtraeglich durch SQL-Erholung wiederhergestellten Originale.

Erster erhaltener Verlustkontext: Rohqueue95 Records/8.369.204Bytes bei128Records/8.388.608Bytes Grenze, also **Bytegrenze**. Aelteste Queuewartezeit8.676ms, am Episodenende21.357ms. Aktiver Recorder-Append6Originale/520.859Rohbytes wartete hinter der lokalen Journaloperation; im Kontext laeuft `read-batch` bereits9.844ms. Letzter abgeschlossener Append davor1Original/91.442Journalbytes/114ms Gesamtzeit. Codepfad commitgebunden gelesen: `readBatch` behaelt die gemeinsame Journalwarteschlange ueber den gesamten Batch und liest darin in Vierergruppen. Vorhandener Append-Vorrang kann eine bereits aktive Leseoperation nicht unterbrechen.

**Enger weiterer Untersuchungsansatz:** Mit kontrolliert verzoegerten lokalen Dateilesungen offline reproduzieren, ob ein laenger laufender Read-Batch hintereinander eintreffende Appends bis zur Rohbytegrenze blockiert; moegliche kleinere/unterbrechbare Leseturns gegen Marker-/Bereinigungs-/Shutdown- und Originalintegritaet pruefen. Noch kein zusaetzlicher Codefix oder NAS-/SQL-Ursachennachweis. Bereits vorhandene Batch-Appends/Append-Prioritaet aus142 nicht erneut entwickeln; keine pauschale Queuevergroesserung oder weitere SQL-Abfragen.

Aktuelle separate Zustandsaufnahme nach der Episode: Journalwrite/readErrors0,23unbestaetigteOriginale,1.027.888Journalbytes; Queue inzwischen1Original/97.509Rohbytes, Ablauf-unbestaetigt8.537 unveraendert. Produktiver SQL-Pruefer602Abfragen/0Fehler seit neuem Prozess, frischer exakter Originalnachweis, Backend/Fence frei. Das erklaert weder den langen lokalen Read noch bestaetigt es die108 nie angenommenen Originale.9.844ms sind lokale Operationslaufzeit, keine isolierte SQL-Laufzeit.

Nur vorhandene Kompaktdiagnosen/Logs und aktuellen Code gelesen; kein externer Historienabruf, keine Code-/Anlagenaenderung, keine Installation. Ereigniszeit-Randintervall12,684s (=00:00:12.684) ist keine pauschale Quellenblindzeit. Alter Fall fortgefuehrt, neue Sitzung klar zugeordnet; Issue bleibt offen.


<!-- alpha147-journal-read-lane-delivered -->
## alpha.147 – Recorder-Appends von langsamen unveraenderlichen Journal-Lesungen entkoppelt

Fortfuehrung der neu belegten Episode25.10.2026, Sitzung1792939197779, seq97–204,15:40:29.827–15:40:42.511 MEZ,108lokale Abweisungen/9.445.810Rohbytes. **Offline reproduziert:** Eine festgehaltene Dateilesung blockiert in146 die gemeinsame Journal-Mutationswarteschlange und damit sonst moegliche dauerhafte Appends. Dies erklaert den Software-Blockierungspfad, nicht die Ursache der langen realen Dateilesung; kein isolierter NAS-/SQL-Ursachennachweis.

[PR258](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/258), alpha.147: Genau eine begrenzte Lesebatch-Spur, maximal vier Dateileser wie bisher; Auswahl/Pinning atomar, Lese-I/O ausserhalb der serialisierten Journalmutationen. Schreibauftraege/Fences koennen damit fortfahren. Gesamte gepinnte Abhaengigkeitsgruppen bleiben gegen bestaetigte Bereinigung und Expiry erhalten; Freigabe erst nach Abschluss aller Leser, auch bei Fehlern. Laengen-/Identitaets-/Hashpruefung, kein Teilergebnis beschaedigter Batches und close()-Drain einschliesslich wartender angenommener Reads bleiben wirksam. activeRead getrennt von activeOperation. Keine neue SQL-Anfrage, Queue-/Retentionsvergroesserung, Migration oder Regleraenderung; keine Aktor-/Konfigurations-/Installationsaktion.

**Nachweise:**3.077/3.077Tests lokal, acht neue Faelle. Drei Regressionen scheitern mit unveraenderter146. Echter Recorder/Codec:140weitere grosse Quellkontexte waehrend festgehaltener Lesung ohne Abweisung, rohe Quellen/NULL/ACK/q/Zeiten erhalten, nach Neustart hashgleich. Paketpruefung/isoliertes installiertes Tarball (240Dateien/720States)/beide historischen Vergleiche bestanden. In genau zwei alten Recordervergleichsfixtures neue Read-/Drainpolitik auf beiden Seiten explizit vorgegeben; keine Felder, Hashes, Originale oder Aktortraces entfernt. Die geaenderte Konkurrenzregel ist separat vor/nach geprueft. Vier-Append-Vorrang vor SQL-Fences bleibt als Wirkungskriterium getestet.

**Reale Abnahme offen:** Verlorene Originale nicht wiederhergestellt. Langsame oder ausgefallene physische Writes/Storage koennen weiterhin zu Verlusten fuehren; kein pauschaler Performance-/Verlustfreiheitsnachweis. Nach tatsaechlicher manueller Installation ausschliesslich neue natuerliche Sitzungen mit RecordDropped/RecordWriteErrors, Session/Sequenz/Ereigniszeit, Rohqueuebytes/-alter, activeRead/activeOperation, Journalfehlern, frischen exakten SQL-Bestaetigungen und expiredUnconfirmed vergleichen. Kleine aktuelle Queue/Nullzaehler nach Neustart sind keine Wiederherstellung oder Dauerabnahme. Keine alten SQL-Fenster erneut laden; kein kuenstlicher Lasttest. Issue bleibt offen.

**Auslieferung:** PR258 nach sechs gruenen Node22/24/26-CI-Pruefungen uebernommen. main/Tag `9573aab68f8bcf674cd5432f4c4bd82cbe8e920e`, exakt gepruefter lokaler/Remote-Baum `9628c5b74c175782830b93e97226f95bc2db92a7`. [Release alpha.147](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.147) am25.10.2026 um16:47:13 MEZ veroeffentlicht; [regulaerer Releaseworkflow](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40208421859) validiert erneut mit Node22/24/26. Letzter separater lesender Laufzeitnachweis weiterhin alpha.146/alive;147 nicht installiert. [Releasehinweise](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/9573aab68f8bcf674cd5432f4c4bd82cbe8e920e/docs/release-0.17.0-alpha.147.md).


<!-- alpha148-database-only-sql-proof -->
### 25.10.2026 – CASE-20261025-SQL-CACHE-PROOF: Datenbanknachweis korrigiert, lange Transportantwort weiter ungeklärt

**Ausgangsstand:** main und laufende Anlage waren alpha.147, Commit `9573aab68f8bcf674cd5432f4c4bd82cbe8e920e`. Der bereits erfasste Vorgang 17:02:51.286–17:08:13.342 MEZ hat 322.055,637 ms Transportwartezeit; die lokale 30-s-Frist trat vorher ein. Journal-Beginn 14,456 ms, Fence-Abschluss 10,578 ms. Die alpha.144-Spaetverarbeitung verarbeitete danach 17 exakte Originaltreffer, ohne erneute Abfrage. Das bestätigt den bestehenden Late-Callback-Pfad, aber nicht isolierte DB-Laufzeit oder dauerhafte Datenbankzustellung.

**Neu belegter Nachweisfehler:** Die produktive EMS-Methode benutzte SQL-Adapter-`getHistory aggregate:none` als Persistenzbeweis. Der geprüfte offizielle SQL-Adapter 4.2.1 kann dabei noch ungespeicherte Cache-/in-flight-Originale liefern; die bisherige exakte Sitzung/Sequenz/Hash-Prüfung allein schloss dies nicht aus. Zusätzlich erzeugt sein MySQL-getHistory Randwert-UNION-Abfragen trotz späterem `removeBorderValues`. Beides ist aus [offiziellem Code](https://github.com/ioBroker/ioBroker.sql/blob/eaa7fcfeb8c915fda64a6272253145a1f64361e7/src/main.ts) nachvollziehbar; als Ursache der 322-s-Antwort ist es nicht bewiesen.

**Im Code behoben:** [PR #259](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/259), alpha.148. Ein reiner begrenzter Datenbank-SELECT über `query`, exakter Datenpunkt-/Aliasname und Typ, inklusive Fenstergrenzen, höchstens zehn Sekunden/32 Zeilen; keine Cachebeweise, Historienrandwerte oder zusätzlichen COUNT-/Metadaten-SQL-Anfragen. MySQL/MariaDB/PostgreSQL/SQLite/MSSQL mit streng geprüfter Konfiguration. Abort/Unload/Instanzwechsel nach asynchroner Objektlesung verhindern späteren Dispatch. Vorhandene Original-/Paket-/Hash-Prüfungen, Fristen, Sperren und Late-Callback-Verarbeitung bleiben wirksam. Alte getHistory-Treffer sind keine nachträglichen DB-Haltbarkeitsnachweise; bereits entfernte Originale werden nicht wiederhergestellt.

**Regression/Veröffentlichung:** Zwei Kernregressionen scheitern auf alpha.147, darunter echter Journalabbau durch einen ausschließlich gecachten Originaltreffer. Abschließend 3089/3089 lokale Tests, zwölf zusätzliche Tests, echter lokaler SQLite-SELECT, Paket-/Tarball-/Verhaltensprüfungen bestanden. Sechs Branch-/PR-CI-Läufe Node.js22/24/26 grün. main/Tag `ba1cf0399981bd86dedddddedf2be2362798f5c9`, getesteter und Connector-Tree `832e9a42046dce5216c6aa41b5a71e711654612e` identisch. [Releaseworkflow](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40212266890) mit erneuter 22/24/26-Validierung erfolgreich; [v0.17.0-alpha.148](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.148) veröffentlicht am 25.10.2026 um 17:35:47 MEZ. [Vertrag und Abnahme](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/ba1cf0399981bd86dedddddedf2be2362798f5c9/docs/release-0.17.0-alpha.148.md).

**Offen/reale Abnahme:** Zuletzt lesend bestätigte Installation alpha.147; keine Installation/Neustarts/Anlagen- oder SQL-Konfigurationsänderung durch diesen Auftrag. Null neue Live-SQL-Diagnoseabfragen. Nach manueller Installation neue natürliche SELECT-Callbacks/Originaltreffer, Journalabbau getrennt von expiredUnconfirmed/Ablauf/Verlust und Transportwartezeiten prüfen. Kein behaupteter Last-/Latenzfix: erforderliche Datenbanklesungen können nicht mehr durch Cachetreffer ersetzt werden. DB-Prozess-/Sperr-/Indexsicht und tatsächliche Ursache der langen Antwort fehlen weiterhin. Keine erneute historische Grundanalyse und keine reale Langzeitabnahme aus Softwaretests ableiten. Issue bleibt offen.

<!-- alpha159-append-phase-diagnosis-20261027 -->
## 27.10.2026 – tatsächliche Recorderverluste und SQL-Verzögerungen getrennt geprüft; alpha.159

Manueller Folgeauftrag nach Abschluss des Tagesberichts [#274](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/274). Vorhandene bereinigte Belege wiederverwendet, **keine erneuten SQL-/Historienfenster**, keine Testwrites, Installation oder Anlagenänderung. Frisch geprüfter Ausgangs-main `fdf964550895d176771c7968f8db1da8a38782c5` / alpha.158; laufend zuletzt separat alpha.157 seit 27.10.14:42:07.877 CET, exakter installierter Commit unbekannt. Alpha.158 korrigiert nur die Tageszählung, nicht die realen Verluste.

**Recorder-Ursachenfingerabdruck:** Sitzung 1793108511626; seq45332–45363 (32),45369–45382 (14),45388–45393 (6),45404 (1); 17:32:23.363–17:32:32.085 CET. Insgesamt 53 nachgewiesene Rohqueue-Abweisungen, nicht 106: RecordDropped und RecordWriteErrors beschreiben denselben Verlust. Rohqueue 92 Einträge / rund 8,3 Millionen Bytes bei unveränderter 8-MiB-Bytegrenze, nicht der 128-Record-Grenze. Queuealter bis 21,805 s; vorherige Append-Batches 10,805 s und 7,216 s. Aktiver lokaler Pfad `append-batch`; alte Metadaten trennen File-Open/Write/Sync/Close, Link und Directory-Barrieren nicht. Keine konkrete physische Dateisystem-/NAS-Ursache belegt; kein erneuter Fix des unter 147 bereits entkoppelten Lesepfads.

**Gezielte Diagnoseverbesserung:** [PR275](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/275), alpha.159, Head `742fe6c5098dcfa08e6a9c627b66b84b3323e3a9`, geprüfter Baum `9342b051ff2792d5c4a3337ec46e090622263cb1`. Aktive Appendphase/Phasenbeginn/-dauer und höchstens vier parallele Open/Write/Sync/Close-Vorgänge; fünf abgeschlossene Phasenzeiten. Bei neuer natürlicher Rohqueue-Abweisung werden diese im bestehenden begrenzten Verlustkontext erhalten. Alte Checkpoints bleiben ohne die neuen Felder lesbar. Vier Gruppen/8 KiB, Verdrängungszähler, Original-/SQL-Formate, Sync-Barrieren, sichere Registrierung, Parallelität und sämtliche Queue-/Journal-/SQL-Grenzen bleiben erhalten. **Kein nachgewiesener Performancefix und keine Wiederherstellung verlorener Originale.**

**SQL separat:** Die 16 im Tagesbericht erhaltenen Deadlinefälle wurden später passend vollständig beantwortet; längste Transportphase17:03:12.924–17:30:36.090 CET = 1643,166 s, nicht isolierte DB-Laufzeit. Read-only SQL-Adapterstand 4.2.1 und `multiRequests=true` geprüft. [Offizieller Quellstand](https://github.com/ioBroker/ioBroker.sql/blob/eaa7fcfeb8c915fda64a6272253145a1f64361e7/src/main.ts) führt diese Benutzerabfragen ohne serielle Taskqueue aus; Pool-/Treiber-/DB-/Rücktransportwartezeit bleibt ungetrennt. Vier gelesene `id not found`-Warnungen betreffen andere Datenpunkte und beweisen keine Ursache dieser Verzögerung. DB-Prozess-/Sperr-/Indexsicht fehlt. Bestehenden Datenbank-SELECT-/Late-Callback-Pfad148/144 weiterverwenden; keine zusätzliche Abfrage, Pool-/Timeoutänderung oder Doppelkorrektur.

**Prüfung/Reststand:** Sechs neue verzögerte echte lokale Datei-I/O-Gegenproben scheitern unverändert auf 158, nachher 6/6 grün; 3232/3232 Gesamttests, Paketmetadaten und isoliert installiertes Tarball (266 Dateien/747 States) grün. Historische Regler-/Recordervergleiche grün; ausschließlich neue passive Phasenblätter in den zwei alten Recorderfixtures vor Serialisierung angeglichen, neue Diagnose und Haltbarkeitsbarrieren separat geprüft. Alle sechs Branch-/PR-CI-Prüfungen Node 22/24/26 grün; PR275 nach main übernommen: `f98eea67ff76cb49f433e787e645ac012538c84a`. Der gemergte Baum stimmt exakt mit dem lokal geprüften Baum `9342b051ff2792d5c4a3337ec46e090622263cb1` überein. Kein Tag/Release oder Anlageninstallation durch diesen Auftrag. [Releasehinweise](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/742fe6c5098dcfa08e6a9c627b66b84b3323e3a9/docs/release-0.17.0-alpha.159.md). Keine Installation oder reale Wirksamkeit behauptet; Issue bleibt offen.


</details>


## Zugehörige Kommentare zum Archivzeitpunkt

### Kommentar 5856214167 – 2026-09-27T13:19:00Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60#issuecomment-5856214167)

Die aus dieser Auswertung abgeleiteten Softwareverbesserungen sind in **0.17.0-alpha.20 / PR #61** enthalten:

- Der neue `Debug.Shadow.DecisionRecord` enthält Bedarf, modellierten Ausgang und reale Rückmeldungen zusammen in einem Datensatz, mit eigenem Zeitpunkt und Zyklus. SQL-Wiederholaufzeichnung dafür ist ausgeschaltet; der Adapter erzeugt Zustandswechsel und einen eigenen 60-s-Lebensnachweis.
- Soll-/Modellausgänge haben keine 10-s-Blockzeit mehr. Zusammengehörige Datensätze werden in Reihenfolge gepuffert; bei Überlauf oder Schreibfehler zeigen Sequenznummern und Zähler ausdrücklich eine Lücke.
- Reale Wallbox-Rückmeldungen bleiben auch bei Master EIN im dann als ungültig/pausiert markierten Schattendatensatz verfügbar.
- Virtuelle Übernahme, Hochlauf, Mindestlaufzeit, Abschaltverzögerung und Phasenwarten sind nun separat sichtbar. Ein angeforderter Nullwert ist weiterhin keine gezählte physische Abschaltung.
- Frische PV-Skriptwerte mit ack=false werden angezeigt. Skriptgeführte Phasen bilden die echte go-e-Topologie ab; EMS-geführtes Warten ist begrenzt.
- Ergänzende Korrektur: Frische Netzleistung und EHZ-Leistung werden aus den aktuellen Quellen gemeinsam bilanziert. Der Test für physisch 5.900 W EHZ bei veraltetem 0-W-Spiegelwert bleibt jetzt stabil.

**547 Tests bestanden.** Die genaue Ursache des damaligen 84-ms-Eintrags und des früheren realen WB0-Ladeendes wird dadurch nicht nachträglich bewiesen. Dieses Issue bleibt für die Prüfung der neuen SQL-Daten und die begleitete Liveabnahme offen. Keine Änderungen an laufenden ioBroker-Skripten oder realen Ausgangsfreigaben vorgenommen.

[Änderungsliste und Testgrundlage](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/main/docs/issues57-60-alpha20.md)

