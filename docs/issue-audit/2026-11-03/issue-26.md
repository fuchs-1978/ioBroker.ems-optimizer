# Issue #26 – [AP3] Qualitätsrest: Checker/Kontakt, Laufzeitnachweise und spätere Veröffentlichung

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/26. Letzte Issue-Änderung: 2026-11-01T22:21:49Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Aktueller Qualitätsumfang – 01.11.2026 / Alpha 186

### Softwareprüfung erledigt

- [x] Standard-CI mit Node 22/24/26, ESLint, Lockfile/`npm ci`, Paket-/frische Controller-Integration, installiertes Testartefakt und historische Vergleiche vorhanden; #312 nach sämtlichen grünen Checks übernommen.
- [x] Alpha 186 installiert und laufend gelesen; frühere Installations-To-dos zu 162/164/170 sind überholt.
- [x] Diagnoseanzeigen, Quellenreihenfolge, geordnete Initiallesungen und Zeitstempel-/Netzpaarvertrag implementiert. #291 ist als Softwareaufgabe abgeschlossen.
- [x] README-Kurzüberblick und deutsche Bedienung werden auf den tatsächlichen 186-Umfang bereinigt; reine Dokumentationspflege benötigt keine neue Laufzeitversion.

### Offen und getrennt weiterführen

- [ ] Technische Recorder-/SQL-Ursache, historische Verluste und nachhaltige Zustellqualität zentral in **#60**; heutige Befunde #313. Gute aktuelle Queues heilen keine verlorenen Originale.
- [ ] Vergleichbare längerfristige RAM-/Lastmessung; keine behauptete physische Ursache aus bloßer Transportwartezeit.
- [ ] Visuelle Admin-Abnahme und reale Geräte-/Schutz-/Rückgabefälle in #36/#7/#8. State-Texte und CI ersetzen diese nicht.
- [ ] Öffentliche Kontaktadresse, Topics und vollständiger aktueller Remote-Checkerbericht in #197; keine Kontaktadresse erfinden.
- [ ] npm-/Latest-/Stable-Veröffentlichung bleibt zurückgestellt. GitHub-main, Tag/Release und installierter Stand sind unterschiedliche Nachweise.

Die historischen unerledigten Listen unten beschreiben ihren jeweiligen damaligen Stand; sie beauftragen keine erneute Umsetzung bereits vorhandener CI-/Paket-/Lint-/Metadatenfunktionen.

<details>
<summary>Datierte Entwicklung und frühere Prüfstände (historisch)</summary>

<!-- issue-cleanup-20261029 -->
## Aktueller Installations- und Recorderrest – 29.10.2026

main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec`, [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282), geprüfter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`; 3314 Tests und acht grüne Node22/24/26-CI-Jobs. Installation/Laufzeit am29.10.2026 direkt durch `System.Version=0.17.0-alpha.164`, `alive=true` und aktuelle Diagnostics-States bestätigt. Der exakte installierte Commit wurde nicht aus der Anlage ausgelesen.

- [x] Installation und laufende Datenlieferung der neuen Diagnosefunktionen sind bestätigt; das ist nicht mehr offen.
- [ ] Visuelle Admin-Abnahme getrennt in #36; Softwaretests sind keine vollständige Anlagenabnahme.
- [ ] Aus archiviertem #278 weiterführen:19 damalige Verluste unter160 und lange SQL-Transport-/Speichernachweise samt offener physischer Ursache. Guter aktueller Betrieb hebt diese früheren Befunde nicht auf; keine erneuten alten SQL-Fenster laden.
- [ ] Öffentliche Kontaktadresse, Topics und vollständiger aktueller Botbericht bleiben offen. npm/Latest weiterhin ausdrücklich zurückgestellt.

Der vorhandene Standard-Workflow, Lint, Lockfile/npm-ci, offizielle Paket-/Controllerintegration und vollständige responsive Prüfung sind erledigt und werden nicht erneut als Entwicklungsauftrag geführt.

---

<!-- operator-packages-164-20261029 -->
## Softwarefortschritt alpha.164 – 29.10.2026

Auf ausdrücklichen Nutzerauftrag mit [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282) umgesetzt und nach acht grünen CI-Jobs nach main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec` übernommen. Geprüfter/gemergter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`.

- [x] Paket-bugs-URL, Support-Dokument und tatsächliche öffentliche GitHub-Maintaineridentität ergänzt.
- [x] Fünf Operator-Entwicklungspakete softwareseitig integriert;539responsiveFelder und583Schlüssel je elf Kataloge.
- [ ] Empfangsfähige öffentliche Kontakt-E-Mail ist nicht festgelegt; Commit-No-Reply wird nicht als Supportpostfach erfunden. Entsprechende Autor-/Copyright-Checkerbefunde und Repository-Topics bleiben offen.
- [ ] npm/Latest ausdrücklich zurückgestellt; reale Anzeige-/Anlagenabnahme und langfristige Laufzeit-/Kalibrierungsnachweise getrennt.

**Prüfung:**3314Unit-Tests,61offizielle Paket-/Schematests, installiertes Testtarball, historische Vergleiche und Node22/24/26 einschließlich frischem Controller-Integrationstest erfolgreich. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828802101), [Branch-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828796346).

[Umfang und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b3aa288b14d6424b81e1af9bd9668e4c13c421ec/docs/release-0.17.0-alpha.164.md). Keine neuen SQL-/Historienabrufe, Originalquellenprotokollierungen, Anlagenversuche oder produktiven Konfigurationsänderungen. GitHub-Release164 und tatsächliche Installation hier nicht durchgeführt. Das Issue bleibt wegen seiner genannten Restpunkte offen; ältere fehlende Implementierungsaussagen unten sind datierte Ausgangsstände.

---

<!-- adapter-quality-163-20261028 -->
## Qualitätspaket alpha.163 – Punkte 1, 3, 4, 5 und 6 erledigt

[PR #281](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/281) nach acht grünen CI-Jobs übernommen: main `f1adfe6fd03b39b5f04453b132b055f320941828`, geprüfter/gemergter Baum `83aa0bf1f76a06787bf9f7a64eea5d2036882e36`. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40764635739), [Branch-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40764628643).

- [x] Standard-`test-and-release.yml` mit offiziellen ioBroker-Actions und Node22/24/26. Kein automatisches Veröffentlichen.
- [x] Normale Engine-/Historien-/Marktpreis-Timer nutzen den Adapter-Eigentümer und vorhandene Abbruchpfade. Begrenzte native SQL-/Recorder-/Abschlussfristen bleiben absichtlich erhalten, damit Abschlussversprechen und späte Antworten nicht abgeschnitten werden. AST-Lint verbietet neue nackte Laufzeit-Timeraufrufe; die einfache Checker-RegExp kann Methodendeklarationen namens setTimeout weiterhin als Vorschlag melden.
- [x] Vollständiger responsiver Recheck: offizielles JSON-config-Modul von repochecker5.23.2 ohne Fehler/Warnungen; zusätzlicher dauerhafter CI-Check über533Felder. Keine notwendige Layoutänderung, visuelle Anlagenabnahme separat.
- [x] Gemeinsame ESLint-Konfiguration aktiv; echte Fehlerregeln bleiben eingeschaltet, VM-/Mapping-Ausnahmen begründet und getestet.
- [x] Lockfile eingecheckt und sauberes `npm ci` geprüft; CI und manuelle GitHub-Releaseprüfung verwenden es.
- [x]3294Unit-Tests,61offizielle Paket-/Schematests, tatsächlich installiertes Testtarball und beide historischen Vergleiche. Frischer isolierter Controller-Start und Testabbau auf allen drei CI-Node-Versionen bestanden; Testtelemetrie deaktiviert. Lokale Startgrenze `uv_interface_addresses` dadurch eingeordnet.

**Offen/ausgenommen:** Punkt7 (npm/Latest) ausdrücklich zurückgestellt. Kontakte, Topics und weitere optionale bzw. verbleibende Checkerbefunde bleiben separat offen; kein pauschaler Sammelabschluss. Vollständiger netzabhängiger Checker-Neulauf scheiterte am GitHub-Proxy, kein neuer Remote-Botbericht behauptet. GitHub-Prerelease163 und tatsächliche Anlageninstallation hier nicht durchgeführt. Keine SQL-/Historienabrufe, Anlagenversuche oder Regeländerungen.

[Versionsdetails](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/f1adfe6fd03b39b5f04453b132b055f320941828/docs/release-0.17.0-alpha.163.md).

---

<!-- issue-audit-20261028 -->
## Aktueller Abgleich und erledigte Teilpunkte – 28.10.2026

Geprüfter main 95fdc1e7ca8e902a668fbcd43e500270bca21e3c / alpha.161. Dieser Abschnitt ersetzt veraltete Offen-Aussagen unten; historische Originaltexte bleiben erhalten.

- [x] Node22/24/26-Matrix mit erfolgreichen vollständigen Suite-/Paket-/Tarball-/Äquivalenzprüfungen; #13 abgeschlossen. [Aktueller CI-Nachweis](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40689952976).
- [x] Mindest-Node>=22, repository-Metadaten und ioBroker-Keyword vorhanden; adapter-core ^3.4.3 und testing ^6.3.0 bereits aktualisiert (PR237).
- [x] Titel/Beschreibung und sieben aktuelle news-Einträge übersetzt; elf Admin-Kataloge mit je567 Schlüsseln und vollständigen Feld-/Hilfetexten (PR261/262). Englische Haupt-README plus deutsche README.de.md vorhanden.
- [x] Tier2, licenseInformation, js-controller>=6.0.11/Admin>=7.8.23 sowie Changelog/Lizenzabschnitte und Paket-Ausschlüsse vorhanden; vorhandene Paket-/Artefaktchecks sind keine offizielle ioBroker-Integration.
- [ ] Offizielle Paket-/frische Controller-Integration einschließlich Start/unload und vollständiger aktueller Checkerbericht. testing-Abhängigkeit allein erfüllt dies nicht.
- [ ] Standard-Workflowvertrag E3002, ESLint, Lockfile/npm-ci-Strategie, bugs-/Kontaktmetadaten, verbliebene Timer-/Objekt-/responsive Checkerbefunde prüfen/bearbeiten; derzeit existieren eigene test.yml/release.yml, keine test-and-release.yml.
- [ ] Vergleichbare längerfristige RAM-/Lastmessung und nachhaltige Recorder-/SQL-Abnahme in #60.
- [ ] npm-/Latest-/Stable-Veröffentlichung und weitere Veröffentlichungsaufgaben getrennt abschließen; GitHub-Prerelease ist kein npm-Nachweis.

Aktuelles Checker-Leit-Issue ist #197; #14 ist bereits geschlossen und ersetzt. Keine zweite Entwicklung der erledigten Matrix/Abhängigkeiten/Übersetzungen, keine neue Version oder Anlagenänderung aus diesem Abgleich.

---

## Aktueller Teilabschluss und Restumfang – 19.10.2026

Bleibt offen; jüngst geprüfter main `9585b276c75c3ed79634204ba8318166e577dc44`. Reine Repository-/CI-Pflege ist nicht automatisch in der laufenden alpha.96 oder deren unveränderlichem Releaseartefakt enthalten.

Erledigt in main: Node >=22, vollständige Node22/24-CI (#183/#184), drei node:-Imports, licenseInformation und Dependabot ohne Auto-Merge (#185), Tier2 (#186), Keyword ioBroker und Mindestversionen js-controller6.0.11/Admin7.8.23 (#189), aktueller README-Changelog mit verlinktem Archiv (#190). Vorhandene de/en-Admin-Hilfe, news und begrenzte Schreib-/Recorderpfade sind Teilumsetzungen. Alte entsprechende Checkboxen unten sind datierte Ausgangsstände, keine erneut offenen Entwicklungsaufträge.

Weiter offen: offizieller Paket-/Integrationstest einschließlich frischer Installation/Start/unload; vollständiger aktueller Adapter-Checker; repository/bugs und Kontakt-/Paketmetadaten nach bewusster Festlegung; adapter-core/testing-Abhängigkeiten, Lockfile/npm-ci-Strategie, Lint, Sprachumfang und responsiver Admin; objekt-/timerbezogene Checkerrestpunkte, messbare RAM-/Lastabnahme; npm-/Latest-/Stable-Veröffentlichungsreife. Aktuelle package.json enthält noch adapter-core^3.2.3/testing^5.0.0 und keine repository/bugs. Kein neues Checker-Ergebnis in dieser Prüfung, alte Reportzahlen nicht als aktuell ausgeben.

Node26 fehlt in CI (#13), daher offen. Bot-Checker #14 bleibt offen: einzelne erledigte Metadaten machen keinen vollständigen Checker-Nachweis. Aus den archivierten Berichten übernommene Laufzeit-/Datenqualitätsthemen werden gemeinsam mit #60 bearbeitet. Sprachen-/README-Vorgaben gegen den ausdrücklichen Wunsch nach deutscher verständlicher Anleitung abwägen, nicht blind umschreiben.

---

<!-- status-review-2026-10-10-alpha63 -->
## Standabgleich 10.10.2026 – alpha.63

Geprüfter main: [88e85a2](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/88e85a223024ce69c849e4c67f288f2235504fa0), veröffentlichte und laut Startlog am 10.10. um 04:41:32 MESZ laufende **0.17.0-alpha.63** ([Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.63)). Produktive Regelung freigegeben, aktuelles Control.Valid=true. Dieser Snapshot ersetzt keine Ereignishistorie. Letzter belegter Score **69/100**, keine zusätzlichen Punkte durch Veröffentlichung/Installation. Historische Befunde unten bleiben datiert erhalten.

- [x] Begrenzte Anzeige-Persistenz: höchstens laufender und neuester Ersatzwert je geeigneter Forecast-/Plan-/Chart-Serie; weniger unveränderte JSON-Serialisierung ([alpha.61](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.61)). Geordnete Steuer-/Diagnosepfade bleiben separat.
- [x] Begrenzte ereignisorientierte Live-Diagnose umgesetzt (alpha.62/.63; Details #60).
- [x] Vollständige aktuelle lokale Suite: **1492 Tests bestanden**; [Node-20-PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/38017580509) und [main-Releaseprüfung](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/38017757777) erfolgreich.
- [ ] RAM/RSS/Heap bei vergleichbarer Last und längerer Laufzeit messen; keine garantierte MB-Einsparung oder bewiesene EMS-Ursache des früheren Absturzes.
- [ ] Offizielle ioBroker-Paket-/Integration-/Checkerprüfung, unterstützte Node-Matrix und Metadatenpflege abschließen. Aktuell package.json weiter engines.node>=18, adapter-core ^3.2.3, testing ^5.0.0; repository/bugs fehlen. Diese alten Punkte sind weiterhin offen.

Lokaler Node-24-Suitenlauf bestand aktuell; daraus folgt keine vollständige GitHub-Node-22/24/26-Matrix. Tests ersetzen keine Betriebsabnahme. npm-/Latest-/Stable-Reife nicht behauptet. Issue bleibt offen.

---

<!-- status-review-2026-10-08-alpha54 -->
## Standabgleich 08.10.2026 – alpha.54, CI und Testqualität

Geprüfter aktueller Stand: **0.17.0-alpha.54**, main [a9e99b7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/a9e99b782d4421bc3e69d5ef474f7dad879d8ca3), PR [#117](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/117), [GitHub-Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.54). Installationsobjekt und Laufzeitanzeige stimmen überein. Aktuell EMS-Livebetrieb: Ausgangsfreigabe EIN, Control.Valid=true; EQV/EQE-Phasenführung jeweils `ems`.

**Aktuelle Softwareprüfung:** [vollständiger Node-20-CI-Lauf](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/37834649298) unter **Node 20.20.2** am genannten main-Commit erfolgreich: **42 Testdateien, 1.292 bestandene Testfälle, 0 fehlgeschlagen, 0 übersprungen**, ungefähr **31 Sekunden Testlauf**, Paketprüfung bestanden. GitHub-Tag/Prerelease veröffentlicht. Das ist keine npm-/Latest-/Stable-Freigabe und keine reale Betriebsabnahme.

**Einordnung der Testzahl (Stichproben-/Strukturprüfung, kein vollständiger Einzelaudit):** Die Zahl enthält Varianten und Untertests; ein SMA-Test prüft beispielsweise neun Signale mit fünf Altersvarianten (45 Fälle). Frischegrenzen knapp unter/auf/über 30 s, NULL, ACK=false, q!=0, AUS-Timeout, Master AUS, Budget-/Hausanschlussgrenzen und unbekannte Record-Deltas sind sinnvolle Regressionen. Tests laufen in Entwicklung/CI; `test/` ist vom Installationspaket ausgeschlossen und belastet die produktive Regelung nicht.

**Gezielte Qualitätsprüfpunkte:**
- [ ] Unterstützte Node-Matrix um das tatsächlich verwendete **Node 24** erweitern bzw. reproduzierbar prüfen: zwei lokale CLI-Unterprozesstests hingen dort, obwohl die vollständige Node-20-CI besteht. Ursache/Umgebung zunächst klären; kein daraus abgeleiteter bewiesener produktiver Reglerfehler.
- [ ] Überlappende einzelne Admin-Übersetzungsprüfungen gegenüber vollständiger de/en-Prüfung sowie feste Versions-/Quelltext-/Hilfetextvergleiche auf Nutzen und Wartungsaufwand prüfen. Bei Bereinigung gleichwertige Verhaltens-/Vertragsprüfung erhalten.
- [ ] Sicherheits-, Negativ-, Grenzwert- und reale Fehlerregressionen beibehalten; keine Testlöschung nur zur Senkung der Anzahl. Keine neue Version allein für eine Kennzahl.

Offizielle ioBroker-Integrations-/Checker- und vollständige Veröffentlichungsreife bleiben getrennte Nachweise; dieser Abgleich erklärt die alten Metadaten-/Checkerpunkte nicht pauschal für erledigt. Softwaretests ersetzen keine echte Phasen-/Last-/Störfallabnahme. Kein Code, keine Tests und keine produktive Konfiguration durch diese Dokumentationspflege geändert; Score weiterhin **66/100**. Issue bleibt offen.

---

## Standabgleich 07.10.2026 – Software und Betriebsabnahme

Geprüfter Softwarestand am **07.10.2026**: **0.17.0-alpha.41**, [main `7b3d32e`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/7b3d32e48c106a0b96bc2005cf25566e306e674e). Softwareumsetzung und reale Betriebsabnahme werden getrennt bewertet.

**Erledigte Teilpunkte:** Paketinhalt durch `.npmignore` festgelegt (alpha.34); Admin-Beschriftungen zentral über de/en-Übersetzungsdateien (alpha.31). Der volle Sprachumfang de/en/es/fr/it/nl/pl/pt/ru/uk/zh-cn bleibt offen.

Paketinhalt am 07.10. erneut mit `npm pack --dry-run --json --ignore-scripts` geprüft: Hauptprogramm, io-package, lib, Admin-Konfiguration, de/en-Übersetzungen, Analysewerkzeug und Dokumentation enthalten; Entwicklungstests ausgeschlossen. Keine EMS-`gitignore-fallback`-Warnung. Dies bestätigt nicht die Freigabepolitik anderer ioBroker-Pakete.

**Weiter offen:** offizieller Integrations-/Checker-Lauf, Node-Testmatrix einschließlich #13, weitere Metadaten/Abhängigkeiten und Veröffentlichungsreife. Aktuelle CI nutzt Node 20, keine Node-26-Abnahme. Das Arbeitspaket bleibt offen; Paketpflege allein erhöht den Betriebsscore nicht.

---

Teil der zentralen Roadmap #36, **AP3**. Issue #13 (Node.js 26) und Bot-Issue #14 werden in diesem Paket gemeinsam abgearbeitet. Der Admin-/Übersetzungsteil folgt nach AP2/#33, damit die Oberfläche nur einmal umgebaut und übersetzt wird. Veröffentlichung bleibt bis nach der realen AP1-Abnahme gesperrt.

## Ziel

Den Adapter schrittweise an die aktuelle offizielle ioBroker-Adapterstruktur anpassen, ohne dabei Regelungslogik oder produktive Freigaben unbeabsichtigt zu verändern.

Grundlagen:

- [Eigener Adapter](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/de/dev/adapterdev.md)
- [Best Practices](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/de/dev/bestpractices.md)
- [Adapter testen](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/de/dev/adaptertesting.md)
- [io-package.json](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/de/dev/iopackage.md)
- [Veröffentlichen](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/de/dev/adapterpublish.md)

Der Repro-/Adapter-Checker-Befund und die manuelle Prüfung sind hier zusammengeführt. Es wird **kein zweites paralleles Qualitäts-Issue** benötigt.

## Bereits passend

- [x] Standarddateien `package.json`, `io-package.json`, `main.js`, `admin/jsonConfig.json`
- [x] Zugriff über `@iobroker/adapter-core`
- [x] Daemon-Lebenszyklus mit `ready`, `stateChange` und `unload`
- [x] Timer/Jobs sowie übernommene Produktivausgänge werden beim Beenden behandelt
- [x] `info.connection` als `instanceObject`
- [x] JSON-Admin-Oberfläche
- [x] Typ `energy`, `connectionType: local`, `dataSource: push`
- [x] README, Lizenz und Icons vorhanden
- [x] Eigene Verhaltenstests vorhanden; aktuell 86 erfolgreiche Tests
- [x] GitHub Actions vorhanden
- [x] Keine Zugangsdaten, die derzeit verschlüsselt/protected gespeichert werden müssten

## Stufe 1 – Paket- und Testqualität ohne EMS-Verhaltensänderung

Diese Stufe soll zuerst und modular umgesetzt werden. Produktive Ausgänge bleiben standardmäßig aus.

### package.json und Installation

- [x] `repository` ergänzen – **E0017**
- [ ] `bugs` ergänzen
- [x] Mindestversion auf Node.js `>=20` anheben – **E0029**
- [x] `@iobroker/adapter-core` mindestens auf 3.4.3 aktualisieren – **W0034**
- [x] `@iobroker/testing` auf aktuelle Version, mindestens 6.2.1, aktualisieren – **E0036**
- [x] Keyword exakt `ioBroker` ergänzen – **E0040**
- [x] Mit `files` oder `.npmignore` den npm-Paketinhalt festlegen – **E9502**
- [x] `.commitinfo` in `.gitignore` aufnehmen – **E9006**
- [ ] `package-lock.json` einchecken und CI auf `npm ci` umstellen
- [x] Node-Built-ins als `node:fs`, `node:path`, `node:vm` importieren – **E5043**
- [ ] gültige Maintainer-E-Mail in den Metadaten festlegen – **E4048**

### Für die nächste EMS-Version vorgemerkt: npm-Paketwarnung (05.10.2026)

Carsten hat die folgende Korrektur für die nächste Version nach **0.17.0-alpha.33** beauftragt. **Priorität P3 – Paketqualität**, zugehörig zum bereits offenen Paketinhalt-Punkt **E9502**.

- [x] `.npmignore` ergänzt (alpha.34): Laufzeitdateien erhalten; Entwicklungstests, CI und lokale/private Dateien ausgeschlossen. Enthält unter anderem `node_modules/`, `*.tgz`, `coverage/`, `.idea/`, `.vscode/`, `.DS_Store`.
- [x] Mit `npm pack --dry-run --json --ignore-scripts` prüfen, dass die EMS-eigene `gitignore-fallback`-Warnung entfällt und Hauptprogramm, `io-package.json`, sämtliche `lib/`-/Engine-Module, Admin-Konfiguration, Icons, Übersetzungen, Analysewerkzeug und Dokumentation enthalten sind.
- [x] Die kleine Verpackungskorrektur mit der nächsten EMS-Version bündeln; Regelung, Gerätefreigaben und reale ioBroker-/SQL-Einstellungen bleiben davon unberührt.

**Einordnung der übrigen Installationsmeldungen:** Die Installation von alpha.33 endete erfolgreich mit Code 0. `skipping integrity check for git dependency` betrifft die direkte GitHub-Installation und ist kein gemeldeter Prüfsummenfehler. `install-scripts … allowScripts` betrifft die Freigabepolitik der gesamten ioBroker-Installation und die dort genannten Pakete. Keine pauschalen Skriptfreigaben oder Änderungen an der ioBroker-Hauptkonfiguration in den EMS-Adapter aufnehmen. `npm fund` ist ein Spendenhinweis. Für die Verpackungskorrektur allein werden keine Betriebs-/Abnahmepunkte vergeben.

Grundlage: [npm-Paketinhalt und Ausschlussdateien](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files).

### Offizielle Tests und CI

`@iobroker/testing` ist bereits eingetragen, wird derzeit aber nicht aufgerufen.

- [ ] offiziellen Pakettest von `@iobroker/testing` einrichten
- [ ] echten Integrationstest ergänzen: frische Instanz installieren, starten und sauber beenden
- [ ] Start ohne vorhandene Nutzerkonfiguration testen
- [ ] `unload` und das sichere Beenden übernommener Ausgänge testen
- [ ] Standardworkflow `.github/workflows/test-and-release.yml` ergänzen – **E3002**
- [x] unterstützte Node.js-Versionen mindestens 20 und 22 in einer Matrix testen
- [ ] Adapter Checker in CI aufnehmen
- [ ] ESLint mit `@iobroker/eslint-config` und `npm run lint` ergänzen – **W0062/W0074**
- [x] Node.js 26 getrennt entsprechend Issue #13 prüfen – **W8004**

Die vorhandenen fachlichen Tests für Fahrplan, SoC, Wallbox, EHZ und Schutzketten bleiben bestehen.

### io-package.json

- [ ] `common.title` ergänzen
- [x] `common.titleLang` vollständig übersetzen – **E1027**
- [x] `common.desc` vollständig übersetzen – **E1034**
- [x] `common.news` mit Versionshistorie ergänzen – **E1030/E1105**
- [x] passendes `common.tier` festlegen – **E1035/E1105**
- [x] `common.keywords` ergänzen – **E1069**
- [x] `common.license` durch `common.licenseInformation` ersetzen – **E1105/W1081**
- [x] Abhängigkeit `js-controller >=6.0.11` setzen – **E1057**
- [x] globale Abhängigkeit `admin >=7.6.17` setzen – **E1057**
- [ ] `common.docs` nach Erstellung der englischen/deutschen Dokumentation ergänzen
- [x] Versionen in `package.json` und `io-package.json` weiterhin synchron halten

### Admin und Übersetzungen

- [x] `admin/i18n` für de, en, es, fr, it, nl, pl, pt, ru, uk und zh-cn erzeugen – **E5010/W5615**
- [x] alle Admin-Texte über Übersetzungsschlüssel führen (de/en seit alpha.31)
- [ ] responsive Größen `xs/sm/md/lg/xl` für alle betroffenen Elemente ergänzen – **E5507**
- [ ] Checker erneut ausführen, weil die erste Prüfung nach Erreichen des Maximums abbrach – **E5510**
- [ ] `@iobroker/adapter-dev` für Übersetzung und Build einrichten – **W0062**

### README und Lizenz

- [x] englische README als Repository-Haupt-README erstellen – **E6015**
- [ ] bestehende deutsche Anleitung nach `docs/de/README.md` übernehmen
- [ ] englische Anleitung unter `docs/en/README.md`
- [x] Abschnitt `## Changelog` ergänzen – **E6003**
- [x] Abschnitt `## License` ergänzen – **E6004**
- [ ] gültige Kontakt-E-Mail in README-Copyright ergänzen – **E4050**
- [ ] gültige Kontakt-E-Mail in LICENSE-Copyright ergänzen – **E4051**

## Stufe 2 – Laufzeitqualität und Datenbanklast

Diese Änderungen betreffen das Laufzeitverhalten und benötigen deshalb eigene Verhaltenstests.

- [ ] interne States nur schreiben, wenn sich Wert oder Bestätigungsstatus tatsächlich geändert haben
- [ ] Zeitstempel/Heartbeats wie `LastUpdate` bewusst von der Änderungssperre ausnehmen
- [ ] Wirkung auf SQL-Historisierung und Ereignislast prüfen
- [ ] Objektrollen, Einheiten, `min`, `max`, `read` und `write` systematisch prüfen
- [ ] dynamisch angelegte Standardobjekte langfristig auf sinnvolle `instanceObjects` prüfen; keine große Migration ohne Nutzen
- [ ] Plain-`setTimeout`-Fundstellen beseitigen – **E5005**
  - Hinweis: Die Engine läuft derzeit in einer VM und der globale Timer wird in `main.js` bereits auf den Adapter-Timer umgeleitet.
  - Trotzdem soll die Struktur so angepasst werden, dass der Checker und der Quelltext eindeutig den Adapter-Timer erkennen.
- [ ] optional ioBroker dev-server für gefahrlose Entwicklung außerhalb des Produktivsystems einrichten

## Stufe 3 – Veröffentlichung

Erst nach realer Abnahme der Produktivausgänge und erfolgreicher Stufe 1/2.

- [ ] `@alcalzone/release-script` einrichten – **W0062**
- [ ] Paket auf npm veröffentlichen – **E2000**
- [ ] ioBroker als npm-Mitbesitzer aufnehmen
- [ ] Forum-Testthread eröffnen
- [ ] Repository-Topics setzen – **E8002**
- [ ] Aufnahme ins Latest-Repository beantragen – **W4001**
- [ ] später Stable-Aufnahme und Discovery prüfen

## Bewusst nicht vorgesehen

- kein Neuaufbau mit dem Adapter Creator
- kein pauschaler Umbau auf TypeScript
- keine große Umstrukturierung der EMS-Regelmodule nur für formale Konformität
- keine npm-/Repository-Veröffentlichung vor den praktischen Wallbox-/EHZ-Tests
- keine automatische Aktivierung produktiver Ausgänge durch diese Arbeiten

## Abnahmebedingungen

- alle vorhandenen Verhaltenstests bleiben erfolgreich
- offizieller Paket- und Integrationstest sind erfolgreich
- Adapter startet auf einer frischen Instanz und beendet sich sauber
- Adapter Checker meldet keine Fehler mehr; verbleibende Warnungen sind dokumentiert
- GitHub Actions laufen für die festgelegten Node.js-Versionen erfolgreich
- keine Regelungs- oder Freigabeänderung in Stufe 1
- neue und entfallende Objekt-IDs werden vollständig dokumentiert


</details>


