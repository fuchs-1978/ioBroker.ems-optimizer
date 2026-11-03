# Issue #8 – [AP4] Externe Phasenumschaltung und §14a/LPC-Diagnose

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8. Letzte Issue-Änderung: 2026-10-28T19:28:13Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- issue-audit-20261028 -->
## Wiedergefundener historischer Rückwechselnachweis – Abgleich 28.10.2026

- [x] EQE: realer belasteter3P→1P-Rückwechsel mit Ziel, Modus-ACK, elektrischer Pause und1P-Wiederaufnahme bereits am19.10.2026 unteralpha.98 in #211 dokumentiert.
- [x] Zusätzlicher praktischer Rückwechsel im Tagesverlauf27.10.: um09:28 dreiphasig etwa5,9kW, um13:44 einphasig etwa2,4kW. Das sind positive Betriebsbeobachtungen, keine zusätzliche durchgehende Umschaltmomentkette.
- [ ] Vollständig unauffällige Rückwechselkette mit eindeutig zugeordnetem Befehls-/Freigabeursprung unter späterem Softwarestand sowie weitere Fahrzeuge/Gegenfälle/Master-Rückgabe.

**Originalbericht #211:** Sitzung1792402814793, zunächst12:14:46.914 echte3P-Ströme[5,9;5,8;5,9]A/3,85kW. Ziel1P12:16:35.054, Modus-ACK12:16:46.635, allow0 .642/Leistung0 .830. EMS-OFF12:16:50.344(seq19279), EIN12:16:54.194(seq19314); volle1P-Antwort12:17:16.821 mit[5,8;0;0]A/1,28kW. Pause30,014s, volle elektrische Antwort22,627s nach EIN innerhalb der damaligen45-s-Frist.

**Offene Grenze dieses realen Erfolgs:** damalige Statusdeutung „Freigabe extern entzogen“ und externer Freigabeursprung nicht vollständig erklärt. Daher echter elektrischer Rückwechselteilnachweis, keine pauschale fehlerfreie Status-/Zuständigkeitsabnahme. Der27.10.-Fall bleibt separat datiert. Die alte Formulierung eines völlig fehlenden Rückwechselnachweises ist damit überholt; ein neuer sauber korrelierter Gegenfall bleibt offen. Kein erneuter SQL-Abruf, kein künstlicher Wechsel und keine automatische Scoreänderung.

---

<!-- phase-partial-acceptance-2026-10-27 -->
## Aktueller Abnahmestand – 27.10.2026

- [x] EQE: realer einphasiger Ladebetrieb positiv geprüft.
- [x] EQE: natürlicher 1P→3P-Wechsel mit Stromreduktion, unabhängigem Modus-ACK, Umschaltpause und frischen L1–L3-Strömen sowie Wiederaufnahme der Ladung nachgewiesen.
- [x] EQE: dreiphasige Leistungsaufnahme nach dem Wechsel positiv geprüft.
- [ ] 3P→1P als vollständige neue Auftrag-/ACK-/Stromkette getrennt dokumentieren; bloße 1P-/3P-Momentaufnahmen reichen hierfür nicht.
- [ ] Weitere Fahrzeuge und tatsächlich auftretende Fehler-/Abbruchfälle, insbesondere Kommunikationsausfall während Umschaltung, getrennt abnehmen.
- [ ] Master-AUS, Ausbleiben weiterer Phasenbefehle und Rückgabe an genau einen Stellregler vollständig nachweisen.

Beleg: [Tagesbericht #274, R1/W1](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/274): EQE/WB2 am 27.10.2026, 08:59:40–09:01:40 CET, Sitzung `1793038204605`, Sequenzen 149398–149814. Zunächst 1P/20 A und ca. 4,42 kW; Qualifikation 38→2 s, Stromreduktion auf 9 A um 09:00:26, nativer Modus 2 bestätigt, Umschaltpause mit Nullleistung; um 09:01:04.865/.870/.876 neue reale L1/L2/L3-Ströme 8,8/8,8/8,9 A, ACK=true/q=0, anschließend dreiphasige Leistungsaufnahme.

Teilabnahme des beobachteten normalen EQE-Betriebs unter alpha.156, auf ausdrücklichen Betreiberauftrag. Dies zählt als realer Fortschritt und wird nicht durch fehlende Vollabnahme wieder offen gesetzt. Kein vollständiger 3P→1P-Auftrag/ACK/Stromkettennachweis, keine Abnahme aller Fahrzeuge, von Master-AUS/Rückgabe, fehlendem ACK oder Kommunikationsausfall während eines Phasenwechsels. Alpha.159 ist separat laufend bestätigt; der heutige Wechsel ist kein neuer Wechseltest unter .159.

**Restumfang:** Nur diese offenen Gegenfälle sowie optionale LPC-Dauerdiagnosen bleiben hier aktiv; Eigenstrom-/Netzbezugsbilanz gehört zu #166. Der grundlegende beobachtete EQE-Phasenwechsel muss nicht erneut als völlig ungeprüft geführt werden. Issue bleibt wegen dieses weiteren Umfangs offen. Interne go-e-Modusumschaltung von externen Schützen unterscheiden; alte Schütz-Prüflisten nicht pauschal auf diese Anlage übertragen. Keine künstlichen Schaltversuche.

Die folgenden datierten Abschnitte sind historische Prüflisten; für den aktuellen Erledigungsstand gilt die Liste oben.

---
!-- status-review-2026-10-10-alpha63 -->
## Standabgleich 10.10.2026 – alpha.63

Geprüfter main: [88e85a2](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/88e85a223024ce69c849e4c67f288f2235504fa0), veröffentlichte und laut Startlog am 10.10. um 04:41:32 MESZ laufende **0.17.0-alpha.63** ([Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.63)). Produktive Regelung freigegeben, aktuelles Control.Valid=true. Dieser Snapshot ersetzt keine Ereignishistorie. Letzter belegter Score **69/100**, keine zusätzlichen Punkte durch Veröffentlichung/Installation. Historische Befunde unten bleiben datiert erhalten.

- [x] Aktuelle Phasenfolgerfassung wurde bereits am 08.10. um 22:19 MESZ als übernommen/aktiv bestätigt. Master-/Ausgangsfreigabe und frische ACK-/Qualitätsprüfung sind softwareseitig enthalten; dies ist ein datierter Deploymentnachweis, keine heutige erneute Skriptprüfung.
- [ ] Tatsächlichen 1P↔3P-Wechsel mit Auftrag, unabhängigem Modus-ACK, Umschaltpause, realen L1–L3-Strömen und Fahrzeug-Wiederanlauf nachweisen.
- [ ] Master-AUS, Ausbleiben weiterer Phasenbefehle und Rückgabe an genau einen Stellregler vollständig prüfen.

Die go-e-interne Umschaltung ist von einer externen Schützumschaltung zu unterscheiden; deren alte Stillstandsprüfliste nicht pauschal übertragen. Neue Diagnoseaufzeichnung ist kein Wechselnachweis. Keine neue reale Phasenabnahme in diesem Dokumentationsabgleich; Issue bleibt offen.

---

<!-- status-review-2026-10-08-alpha54 -->
## Standabgleich 08.10.2026 – Phasenskript aktualisiert, elektrische Abnahme offen

Geprüfter aktueller Stand: **0.17.0-alpha.54**, main [a9e99b7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/a9e99b782d4421bc3e69d5ef474f7dad879d8ca3), PR [#117](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/117), [GitHub-Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.54). Installationsobjekt und Laufzeitanzeige stimmen überein. Aktuell EMS-Livebetrieb: Ausgangsfreigabe EIN, Control.Valid=true; EQV/EQE-Phasenführung jeweils `ems`.

- [x] **Produktives Deployment der aktuellen Skriptfassung erledigt:** Carsten hat die neue Fassung von `EMS.Phasenumschaltung_V1` selbst übernommen und aktiviert. Lesend bestätigt: gespeichert/startet **08.10.2026 um 22:19:06 MESZ**, `ENABLED_AFTER_LOCAL_REVIEW=true`, drei Ereignisabonnements und ein Zeitplan; keine Fehlermeldung in den danach verfügbaren Skriptlogs. Master-/Ausgangsfreigabeprüfung und frische ACK-/Qualitätsprüfung sind enthalten. **Deployment erledigt; tatsächlicher Phasenwechsel samt elektrischer Antwort, Wiederanlauf und Master-AUS/Rückgabe weiterhin nicht abgenommen.**
- [x] **Codevertrag geprüft:** Befehle nur mit EMS-Ausgangsfreigabe, gültigem aktuellem Regelzyklus und Phasenauftrag, `PhaseControlMode=ems` und Verbindung. Neue Befehle höchstens alle 60 s je Box; 20-s-Prüfung erfordert ACK=true/q=0, richtige Stellung und Quellenzeit nach dem Befehl. Master-/Ausgangsfreigabeänderung verwirft offene Prüfungen/Anforderungen.
- [ ] Tatsächlichen 1P↔3P-Wechsel protokollieren: Auftrag, frische unabhängige Modus-ACK, Umschaltpause, neue reale L1–L3-/Leistungsantwort und Wiederanlauf des Autos.
- [ ] Master-AUS und vollständige Rückgabe nachweisen: keine neuen/weiteren Skriptbefehle und danach genau ein zuständiger Stellregler.

**Grenzen:** Eine bereits an go-e übergebene Anforderung lässt sich beim Masterwechsel nicht zurückrufen. Numerische Modus-ACK bestätigt zunächst die konfigurierte Stellung, nicht die elektrische Phasenlage. Das Skript stoppt nicht automatisch die Ladung und startet keine Bestandsskripte. Die go-e führt die interne Umschaltpause aus; die untenstehende Schütz-Prüfliste ist für eine tatsächlich externe Schützvariante gedacht und nicht pauschal auf den aktuellen internen go-e-Modus übertragbar.

Phasenskript-Regressionen in [vollständiger Node-20-CI-Lauf](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/37834649298) bestanden; das ersetzt keinen realen Wechseltest. Carstens bisherige manuelle Rückfallfolge bleibt dokumentiert. Aktuelle Tagesbelege in [#116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/116), keine vollständige Abnahme oder neue Scorepunkte. Issue bleibt offen.

---

## Standabgleich 07.10.2026 – Software und Betriebsabnahme

Geprüfter Softwarestand am **07.10.2026**: **0.17.0-alpha.41**, [main `7b3d32e`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/7b3d32e48c106a0b96bc2005cf25566e306e674e). Softwareumsetzung und reale Betriebsabnahme werden getrennt bewertet.

### Umgesetzt und noch zu prüfen
- [x] Begrenzte erwartete go-e-Schreibechos und Umschaltpause in alpha.41 berücksichtigt (PR #102); wiederholte Echos verlängern die Frist nicht.
- [x] Modus-ACK und neue elektrische Phasenantwort werden getrennt bewertet; Strom-, Fehler- und Schutzprüfungen bleiben wirksam.
- [ ] Tatsächlichen 1P↔3P-Wechsel unter Last mit alpha.41 protokollieren: Auftrag, gültiges ACK, Umschaltpause und reale L1–L3-/Leistungsantwort.
- [ ] Masterkopplung und bestätigte Rückgabe des tatsächlich installierten Phasenskripts nachweisen; Repository-Beispiel allein ist keine produktive Umsetzung.

Am 07.10. ist der Wiederanlauf des EQV mit bereits bestätigtem 3P-Modus belegt; daraus folgt kein bestandener Phasenwechsel unter Last mit alpha.41.

**Abgrenzung der alten Prüfliste:** Sie beschreibt auch eine externe Schützumschaltung. Die aktuell gelesene go-e-Führung schreibt den internen Phasenmodus; die go-e führt ihre eigene Umschaltpause aus. Eine fehlende separate externe Stillstandsprüfung ist deshalb allein kein Nachweis einer unsicheren go-e-Umschaltung. Die tatsächliche Hardware, Zuständigkeit und elektrische Antwort müssen passend zur verwendeten Variante geprüft werden. Eine Skriptmeldung über den Zahlenwert ersetzt kein unabhängiges ACK-/Qualitäts-/Stromsignal. Das Issue bleibt offen.

---

Teil der zentralen Roadmap #36, **AP4**.

## Abgrenzung

Der produktive, ausschließlich sequentielle Betrieb von WB0, WB1 und WB2 ist seit **0.16.0-alpha.1** softwareseitig vorbereitet und wird in #7 praktisch abgenommen.

Die spätere Batterie-Feinregelung und die dynamische Batterie-Reserve werden in #25 behandelt.

Dieses Issue enthält damit nur noch:

1. die **externe reale Phasenumschaltung**;
2. optionale zusätzliche **§14a-/LPC-Diagnosewerte**.

## Bereits erledigte Grundlage

- [x] Der EMS-Adapter schaltet niemals selbst real zwischen 1 und 3 Phasen.
- [x] `Vehicles.WallboxX.RecommendedPhases` liefert die rohe Empfehlung.
- [x] `Control.Targets.WallboxX_Phases` liefert das stabilisierte Ziel.
- [x] §14a-Binärkontakt und EEBUS-LPC können einzeln oder gemeinsam verwendet werden.
- [x] Bei zwei aktiven Begrenzungen gilt das kleinere Budget.
- [x] Fehlende, veraltete oder unbekannte dynamische LPC-Signale führen fail-safe zur Begrenzung beziehungsweise zum Stop.
- [x] Phasenweiser Bezug und Einspeisung können richtungsrichtig ausgewertet werden.

## Externe Phasenumschaltung

- [x] Das am 07.10.2026 gelesene `EMS.Phasenumschaltung_V1` verwendet `Control.Targets.WallboxX_Phases` als EMS-Vorgabe (datierter Codebefund; aktuelle Zuständigkeit separat prüfen).
- [ ] Vor jeder realen Umschaltung wird die betroffene Wallbox gestoppt.
- [ ] Der Stillstand muss durch eine gültige Rückmeldung bestätigt sein.
- [ ] Erst danach darf das externe Skript die Schütze umschalten.
- [ ] Die reale Phasenlage muss zurückgemeldet und plausibilisiert werden.
- [ ] Mindestzeit zwischen zwei Phasenwechseln und Verriegelungszeit nach der Umschaltung werden eingehalten.
- [ ] Bei fehlender, ungültiger oder widersprüchlicher Rückmeldung wird nicht weitergeladen.
- [ ] Zuerst mit einer Wallbox, danach mit WB0 bis WB2 abnehmen.
- [x] Es entsteht kein zusätzlicher Phasen-Schreibausgang im EMS-Adapter (alpha.41; externe Ausführung).

## Optionale §14a-/LPC-Diagnose

- [ ] `LPC.limitDuration` bei Bedarf als reinen Diagnosewert übernehmen.
- [ ] `LPC.limitMinutesToday` bei Bedarf als reinen Diagnosewert übernehmen.
- [ ] Beide Werte verändern das aktuelle Leistungsbudget nicht.

## Abnahme

- Reale Umschaltung erfolgt ausschließlich im externen Skript.
- Stop, bestätigtes AUS, Umschaltung, Rückmeldung und Wiederfreigabe sind nachvollziehbar protokolliert.
- Kein Laden mit ungeklärter Phasenlage.
- Schutzgrenzen bleiben bei jeder Übergabe vorrangig.

<!-- alpha143-funded-prestart-phases -->
## Softwarekorrektur25.10.2026 – Phasenwahl vor Mindestlade-Start, alpha.143

Carstens Vorgabe: fuer das jeweilige Fahrzeug vor der Ladefreigabe anhand der aktuell belegten nutzbaren Leistung1P/3P waehlen; vermeidbaren1P-Anlauf mit anschliessendem3P-Wechsel vermeiden. Aktueller Ausgangs-main b02c1fe9c18496ef48c1e6e8b43a5ca7b2f2c296, separat installierte/laufende142.

**Reproduzierter Codebefund:** Der bestehende preStartReady-Pfad schloss vehicle.mustCharge aus. Bei bestaetigt stehendem1P-Fahrzeug mit eigenem gueltigem7000W-Budget fordert der normale EQE-PV-Start sofort3P, dieselbe Situation mit manueller6A-Mindestladung bleibt1P und qualifiziert erst300s. Die Ausnahme betrifft auch Pflicht-/Mindestladung; das ist ein gezielt reproduzierter Softwarefehler, keine vollstaendige Rekonstruktion des anderen realen3P→1P-Verlaufs.

**[PR254](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/254)** entfernt nur diesen Ausschluss aus der vorhandenen Vorstartwahl. Fahrzeugspezifische effektive Mindest-/Maximalstroeme, eigenes aktuell erlaubtes Budget nach anderen Verpflichtungen, Stillstand/AUS/elektrische Ruhe, Quellenqualitaet und unabhaengige Phasenbestaetigung bleiben bindend. Bei bereits laufender oder pending Umschaltung keine Vorstartabkuerzung. Mii/feste1P-Topologie bleibt1P; bei7000W und20A-Mindeststrom reichen die Mittel weiterhin nicht fuer3P. Kein zusaetzlicher Netzbezug allein aus dem Phasenwunsch, keine Aenderung von Schutzgrenzen, Phasenskript, Halte-/Qualifikationszeiten im laufenden Betrieb oder Stromkonflikt-Abschaltung.

Nach sechs gruenen Node22/24/26-Pruefungen auf Headf30d0dea67e668149cf6ce23f8fd29e2e5374e3a nach main **78e77d68152bf9b14e7934111706bde7b8cdc342** uebernommen; exakter lokaler/Remote-Baum88246cb0be993f766ec57af01ba1c9d725463f56.3019/3019 lokale Tests,151 gezielte Phasen-/Parallelreglerfaelle, Paketmetadaten, isolierter installierter Tarball und beide historischen Vergleiche bestanden. Sechs neue Faelle: drei Vorstartfehler scheitern mit142, drei Schutzkontrollen bestehen bereits vorher; alle sechs mit143 erfolgreich. Historische Vergleichswerkzeuge benoetigen fuer diese Korrektur keine neue Normalisierung. Zusaetzlich versehentlich verschobene io-package-Kurznotizen141/142 berichtigt.

**[Release0.17.0-alpha.143](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.143) veroeffentlicht**, Tag zeigt auf obigen geprueften main. [Regulaerer Releaseworkflow40183264345](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40183264345) einschliesslich erneuter Node22/24/26-Validierung und publish erfolgreich.

**Reale Folgeabnahme offen:** Keine Installation, Neustarts, kuenstlichen Last-/Umschaltversuche oder SQL-/Historienabfragen durch diesen Auftrag. Nach separat vorgenommener Installation143 einen natuerlichen Start mit zeitgleichem eigenem Budget/Fahrzeuggrenzen, Phasenwunsch vor EIN, echtem Modus-ACK und neuer realer L1–L3-/Leistungsantwort pruefen. Aendert sich das Budget nach Start, bleibt ein sachlich erforderlicher spaeterer Wechsel moeglich; keine allgemeine Umschaltfreiheit behaupten. Potenzial nicht belastbar quantifizierbar, keine Scorepunkte aus Tests.

Der reale Sollstromstopp10:39:34 vor dem Update10:40:08 und fehlende damals eindeutige Command-/Feedback-/Guarddaten bleiben getrennt in [#216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216) offen. Die Box war bei Update schon aus; daraus kein Scheitern einer laufenden3P-Neustartuebernahme ableiten. [Versionsvertrag](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/78e77d68152bf9b14e7934111706bde7b8cdc342/docs/release-0.17.0-alpha.143.md). Bestehender Tagesauftrag um diesen bekannten Fix/bedingte Folgeabnahme ergaenzt, gespeichert geprueft; keine Doppelentwicklung oder Altfenster-Wiederholung. Issue bleibt offen.


## Zugehörige Kommentare zum Archivzeitpunkt

### Kommentar 5745655337 – 2026-09-19T22:09:26Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8#issuecomment-5745655337)

Version 0.15.0 ist mit Commit ae5fc79a9ba6265612196d99b19cf1f5c2919fec umgesetzt: https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/ae5fc79a9ba6265612196d99b19cf1f5c2919fec

Umgesetzt:
- LPC-Limit als gemeinsames Budget von Wärmepumpe und Wallboxen; gültige Begrenzung führt nicht mehr pauschal zum Stop.
- Fehlersicheres Verhalten bei fehlenden, veralteten oder widersprüchlichen Signalen.
- Richtungsrichtige Hausanschlussprüfung über optionale Bezugs-/Einspeiseleistung je Phase.
- Reale Phasenumschaltung ausdrücklich nicht im Adapter: nur rohe und stabilisierte Empfehlung für das externe Skript.
- 63 Verhaltenstests sowie Syntax- und Paketprüfung erfolgreich.

Neue Objekte:
- `ems-optimizer.0.Control.GridOperatorLimitActive`
- `ems-optimizer.0.Control.GridOperatorBudget_W`
- `ems-optimizer.0.Control.GridOperatorStatus`
- `ems-optimizer.0.Actual.HeatPump_W`

Entfallene Objekte: keine.

Das Issue bleibt für externes Phasenskript/Hardwareabnahme, mehrere produktive Wallboxen und spätere Batterie-Feinregelung offen.

### Kommentar 5745715142 – 2026-09-19T22:20:01Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8#issuecomment-5745715142)

Für die nächste Version vorgemerkt: Die Admin-Bezeichnungen der phasenweisen SMA-Leistungswerte werden an die SMA-Nomenklatur angepasst.

- Import / Netzbezug → `pregard`
- Export / Netzeinspeisung → `psurplus`
- jeweils für L1, L2 und L3

Es werden nur die sichtbaren Bezeichnungen verständlicher gemacht. Die bestehenden nativen Konfigurationsschlüssel bleiben aus Kompatibilitätsgründen erhalten, damit nach einem Update keine Einstellungen verloren gehen.

### Kommentar 5745840636 – 2026-09-19T22:38:58Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8#issuecomment-5745840636)

Ergänzung zur vorhandenen Anlage: Aktuell gibt es noch keine vollständige §14a-/EEBUS-Steuerung, sondern einen Binärkontakt `0_userdata.0.Netzbetreiber.Par14a_Aktiv`. Bei aktivem Kontakt muss die Wallbox auf ein festes Budget von 4.200 W begrenzt werden.

Für die nächste Version:
- eigener Betriebsmodus „Binärkontakt mit festem Limit“
- Datenpunkt des Binärkontakts konfigurierbar
- aktive Polarität konfigurierbar
- festes Leistungsbudget, Standard 4.200 W, in der Admin-Oberfläche einstellbar
- bei aktivem Kontakt gilt das feste Budget; Mindeststrom/Pflichtladung dürfen es nicht übersteuern
- falls später gleichzeitig ein gültiges LPC-Limit vorhanden ist, gilt die kleinere der beiden Grenzen
- ein unveränderter Binärzustand darf nicht allein wegen seines Alters ungültig werden; fehlender/ungültiger Datenpunkt bleibt fehlersicher
- bestehende Skript-/Hardwarebegrenzung bleibt bis zur produktiven EMS-Übernahme aktiv

In 0.15.0 darf der Kontakt nicht als `DP_PAR14A` verwendet werden, wenn kein zugehöriges LPC-Limit geliefert wird, weil die aktuelle Logik dann bewusst sicher sperrt.

### Kommentar 5745923369 – 2026-09-19T22:51:56Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8#issuecomment-5745923369)

Version 0.15.1 ist auf `main` veröffentlicht: e2508d361349b0913bfaa563e04dfc9d874dcc59

Umgesetzt:
- §14a-Binärkontakt allein: aktiver Kontakt verwendet das feste Budget, standardmäßig 4.200 W.
- EEBUS-LPC allein: `limited` verwendet weiterhin `LPC.limit`.
- Beide Quellen: beide werden automatisch ausgewertet; das kleinere aktive Limit gilt.
- Kontaktpolarität und Festlimit sind im Admin unter **General → §14a / EEBUS LPC** einstellbar.
- Statische Binärkontakte werden nicht aufgrund eines unveränderten Zeitstempels ungültig.
- Fehlende oder ungültige konfigurierte Signale bleiben fail-safe.
- Keine produktiven Ausgänge aktiviert; keine ioBroker-Objekte angelegt oder entfernt.

Prüfung: 66 Verhaltenstests erfolgreich, Syntax-, JSON- und Paketprüfung erfolgreich.

