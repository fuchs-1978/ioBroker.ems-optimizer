# Issue #36 – [Roadmap] Aktiver Restumfang und Zuständigkeiten – Alpha 186

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36. Letzte Issue-Änderung: 2026-11-01T22:21:48Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Aktuelle Roadmap – 01.11.2026 / Alpha 186

Software-main und zuletzt laufende Version: **0.17.0-alpha.186**, #312. Eine laufende Version beweist keinen exakten installierten Commit oder die vollständige Anlagenabnahme. README-Pflege allein erzeugt keine neue Adapterversion.

### Priorität und klare Zuständigkeit

| Bereich | Aktueller Stand | Tatsächlicher Rest / zuständiges Issue |
| --- | --- | --- |
| Wallbox/EHZ | Laufende produktive Funktionen und Teilabnahmen; heutige Fixes #309–312 vorhanden | Reale weitere Quellen-, Schutz-, Phasen- und Übergabefälle #7/#8; widersprüchliche Rückmeldungen #216 |
| Recorder/SQL | Qualifizierte Recovery und erneute Originalbestätigungen unter 186; Rückstau abgebaut | Ursache langer Transporte und nachhaltige Verlustfreiheit **#60**; aktuelle Fälle #313 |
| Lastprognose | Vier passive Vorab-Kandidaten, Zeitumstellung/Messgrenze korrigiert, Wetter-/Raumhistorie eingerichtet | Vollständige und mehrtägige Ist-Bewertung **#284**, keine produktive Umschaltung |
| Diagnose/Bedienung | Funktionen #156–#159/#161–#164 softwareseitig vorhanden und installiert | Visuelle Abnahme, reale Übergangsketten/Stichproben, externe Abrufabdeckung, Prognosekalibrierung und geeigneter realer Offline-Quellenexport bleiben jeweils offen |
| Batterie/Modul 3 | Bestehende Ausgänge/Planung und lesende Strategievorbereitung | Produktive neue Reserve-/EV-Strategie und reale Hardware-/Tarifabnahme **#25** |
| Wärme/KNX/WP | Raumdaten sammeln, WP-Telemetrie/passive Empfehlung | Bis passende WP-/Wärmemessungen vorhanden sind zurückgestellt: **#160/#304/#306**; kein neuer KNX-Steuerungsauftrag |
| §14a/LPC | Vorhandene Binärkontakt-/Gruppenbilanz; keine pauschale neue Freigabe | Produzenten-/Gruppenvertrag und produktive LPC-groupNet-Anbindung **#166**, historischer Audit-Draft #223 |
| Qualität/Release | CI Node 22/24/26, Paket-/Controller-/Artefakt-/Vergleichschecks vorhanden | **#26/#197**: öffentlicher Kontakt/Topics/aktueller Checkerrest, längerfristige Qualität; npm/Latest/Stable bewusst zurückgestellt |

### Erledigt / archiviert

- #291: Eingangsreihenfolge und Netzpaarvertrag seit #292/alpha.170 implementiert, auf main und in der später installierten 186 enthalten. Weitere reale Abnahme ist Teil #7/#8, kein zweiter Implementierungsauftrag.
- Tagesberichte #290, #298 und #305 sind historische Berichte. Ihre offenen Ursachen-/Abnahmegrenzen werden in #7/#216/#60/#284 weitergeführt; Archivierung ist keine Fehlerbehebung. #313 ist der aktuelle Tagesbericht.
- Zurückgestelltes automatisches Dependabot-Mergen #22 wird als nicht eingeplante Referenz geschlossen. Abhängigkeiten weiterhin manuell nach Prüfung übernehmen; keine neue automatische Veröffentlichung.

### Nicht erneut entwickeln oder automatisch auslösen

Bestehende Fixes, Datenpunkte und Tests wiederverwenden. Historische Belege bleiben datiert; aktuelle ruhige Zustände ersetzen keine alten ACK-/Elektroketten. Keine künstlichen Messwerte, rückwirkende Prognosen, pauschalen Scorepunkte, automatische Installationen/Neustarts oder zusätzlichen Aktorbefehle aus dieser Aufgabenpflege.

Bei späteren Implementierungen zuerst aktuelles main, wirksame Konfiguration, Quellen und laufende Arbeiten prüfen. Deutsche Bedienung: README.de.md, Kurzüberblick: README.md.

<details>
<summary>Datierte Entwicklung und frühere Prüfstände (historisch)</summary>

<!-- battery-strategy-preparation-165 -->
## alpha.165 auf main: Batterie-Softwarevorbereitung – 29.10.2026

[PR283](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/283), main `3176caf81fa515614aab1d01084614bc4c2a4ad5`, exakt geprüfter Baum `26258932d0579d66b2bbfff19cc94ac0c9d99c61`;3319Tests und acht grüne CI-Jobs.

- [x] Neue gestufte Batterie-/Fahrzeugstrategie als lesende Vorschau berechnet und dokumentiert: Geräte-Min/Max, Arbeitsbereich am Zwischenziel, begrenzte Fahrzeugunterstützung, Mindest-SoC-Nachtbedarfe und gemeinsame Energielücke. Bisherige gestufte Abendziele/Puffer werden wiederverwendet.
- [ ] **Produktive Integration in Batterie-/EV-Koordination und Modul3-Kaufplanung bleibt offen in #25**. Vorschau ist kein neuer aktiver Regler; aktuelle Preis-Ladesitzungen unverändert. Keine neueHardwarefreigabe oder Anlagenänderung.
- [ ] Bestehende Speicher-/Modul3-Hardwareabnahme aus dem abgeschlossenen Software-Issue #75 weiterhin zentral in #25. WP-Wärmeplanung und LPC bleiben wie bisher zurückgestellt/offen.

Alle Annahmen und Grenzen in [Versionshinweisen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/3176caf81fa515614aab1d01084614bc4c2a4ad5/docs/release-0.17.0-alpha.165.md). Installation und GitHub-Veröffentlichung sind getrennte Schritte, nicht aus dem Merge abgeleitet.

---

<!-- issue-cleanup-20261029 -->
## Bereinigter aktiver Restumfang – 29.10.2026

main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec`, [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282), geprüfter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`; 3314 Tests und acht grüne Node22/24/26-CI-Jobs. Installation/Laufzeit am29.10.2026 direkt durch `System.Version=0.17.0-alpha.164`, `alive=true` und aktuelle Diagnostics-States bestätigt. Der exakte installierte Commit wurde nicht aus der Anlage ausgelesen.

**Erledigt und geschlossen:** #155 Live-Erklärung, #165 Konfigurationshinweise; #75 als fertige Modul3-Planungssoftware mit verbleibender realer Speicherabnahme zentral in #25; #278 als abgeschlossener historischer Tagesbericht, dessen offene Ursachenfälle in #7/#216/#26 erhalten bleiben. Schließung bedeutet keine pauschale Anlagen-/Schutzabnahme. **Aktuell17offene Issues statt21.**

- [x] Installation alpha.164 und aktuelle Werte der neuen Diagnoseanzeigen bestätigt.
- [x] Reales positives Live-Anzeigebeispiel Mii6A/1P/~1,3kW mit getrennten Soll-/Status-/SoC-/Ziel-States abgeglichen; Konfigurationsanzeige meldet aktuell keinen erkannten Konflikt. Software-Gegenfälle sind getestet.
- [ ] Zentrale **visuelle Admin-Abnahme** für die abgeschlossenen Softwarefeatures #155/#165 und die übrigen Anzeigen: tatsächliche Darstellung im Browser, Freigabe-/Budget-/Unbekannt-Gegenfälle und stimmige Bedienhinweise. Die lesbaren State-Texte beweisen keine Browserdarstellung.
- [ ] Weitere Konfigurationsklassen bei konkretem Bedarf ergänzen; der zusätzliche Prüfer ersetzt keine vollständige Schutzvalidierung.
- [ ] #164: reale aktive Abfahrts-/Mehrfahrzeugfälle und verbleibende PV-/Netzanteilsgrenzen, nicht nur die bereits korrekte Anzeige ohne aktive Frist.
- [ ] #156/#159: natürliche vollständige Übergangs-/Reaktionsketten und Stichprobenumfang; #157: tatsächliche Vermeidbarkeit/Abdeckung; #163: ausreichende reale Kalibrierung.
- [ ] #161: erster geeigneter realer Quellenexport mit belegter Startkonfiguration für den implementierten Offline-Vergleich.
- [ ] #158: externer Berichtseingang/tatsächliche Abrufabdeckung weiterhin fehlend; #162: vollständige historische Ziel-/Engpassbelege und Anzeigeabnahme weiterhin offen.
- [ ] #7/#8/#216: verbleibende reale Fahrzeug-/Phasen-/Schutz-/Rückgabefälle und Herkunft widersprüchlicher Rückmeldungen.
- [ ] #25: gemeinsame reale Batterie-/Modul3-Abnahme und weitergehende Reserve/NVP-Funktionen. #166:LPC-Integration offen. #160:Wärmeplanung bis Wärmepumpe zurückgestellt.
- [ ] #26/#197: Kontakt/Topics/Checkerrest und langfristige Laufzeitqualität; npm/Latest zurückgestellt.

Keine neue Version, Konfigurationsänderung, Anlagenversuche oder Historienabrufe durch diese Bereinigung. Bestehende bestandene Teilabnahmen bleiben anerkannt; keine automatischen Scorepunkte.

---

<!-- operator-packages-164-20261029 -->
## Softwarefortschritt alpha.164 – 29.10.2026

Auf ausdrücklichen Nutzerauftrag mit [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282) umgesetzt und nach acht grünen CI-Jobs nach main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec` übernommen. Geprüfter/gemergter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`.

- [x] Paket1: Abfahrts-Machbarkeit und Konfigurationshinweise (#164/#165).
- [x] Paket2: begrenzte beobachtete Übergangsbewertung und Reaktionsstatistik (#156/#159).
- [x] Paket3: Regelgüte nach beobachteter Stellfreigabe, empirische Prognosebereiche, optionale gewichtete Lastprofile und kurzfristige Vorschau (#157/#163).
- [x] Paket4: allgemeiner Offline-Versionsvergleich über Originalquellen mit ausdrücklichem Kaltstart-/Open-Loop-Vertrag (#161).
- [x] Paket5: belegbare bugs-/Support-/Maintainerverweise ergänzt (#26/#197); fehlende öffentliche Kontakt-E-Mail und Topic-Einstellungen bleiben offen.
- [ ] Visuelle/reale Abnahme, längerfristige Kalibrierung, fehlende Ursprungsdaten und kausale Vermeidbarkeit bleiben separat. Kein automatischer Scorebonus. Batterie/LPC und Wärmeplanung nicht vorgezogen.

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

<!-- alpha162-software-20261028 -->
## Neue Diagnose-Version162 – Softwarepunkte erledigt

PR #280 nach sechs grünen Node22/24/26-Prüfungen nach main784aa0e72651b8809f6c03863f889af358963a05 übernommen, getesteter und gemergter Baum ecc8d3fc9dc79c492a2bf3bab28ddfe0cf277aff.

- [x] #155: verständliche lesende Live-Erklärung mit Budget/Freigabe/Timer/Frische.
- [x] #158: getrennte Recorder-/SQL-/Historienqualität und korrekte Unbekannt-/Recoverydarstellung.
- [x] #162: vorhandene laufende/vorherige Tagesbilanz verständlich mit Abdeckung und Nachweisgrenzen.
- [x]3290Tests, Paket-/tatsächlich installiertes Testtarball, historische Vergleiche und sechs GitHub-CI-Jobs bestanden. Elf Kataloge jetzt575Schlüssel.
- [ ] Tatsächliche Anlageninstallation und visuelle reale Anzeigeabnahme stehen aus; die drei Issues bleiben entsprechend offen. Keine Schutz-/Regler-/SQL-Ursachenabnahme daraus.
- [x] Nach ausdrücklicher Nutzerfreigabe am28.10.2026 um20:58:12 MEZ als [GitHub-Prerelease v0.17.0-alpha.162](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.162) veröffentlicht. Tag zeigt auf den geprüften main784aa0e72651b8809f6c03863f889af358963a05; [Releaseworkflow40758697795](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40758697795) einschließlich Node22/24/26 und Publish erfolgreich. Die vorherige automatische Ablehnung ist damit nach neuer Freigabe erledigt. Keine Anlageninstallation oder npm-/Latest-/Stable-Veröffentlichung daraus.

Keine zusätzlichen SQL-/Historienabfragen, Aktor-/Konfigurationsänderungen oder neuen Betriebsversuche. Externe Historie bleibt ohne angebundenen Prüfstand ungeprüft; historische Ziele/Kosten ohne Beleg unbekannt. [Versionsdetails](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/784aa0e72651b8809f6c03863f889af358963a05/docs/release-0.17.0-alpha.162.md).

---

<!-- issue-audit-20261028 -->
## Vollständiger Abgleich der offenen Issues – 28.10.2026

**33 offene Issues mit ihren Kommentaren gesichtet**, mit aktuellem main95fdc1e7ca8e902a668fbcd43e500270bca21e3c / alpha.161, vorhandenen Quell-/Test-/Vertragsdateien, tatsächlicher Node22/24/26-CI und vorhandenen realen Betriebsberichten abgeglichen. Referenz #278 enthält inzwischen den Abendnachtrag bis19:56. #14 und #33 separat gelesen: beide bereits geschlossen; #197 ersetzt #14. Dies ist Dokumentations-/Statuspflege, keine vollständige neue Code-, Norm-, Sicherheits- oder Anlagenabnahme. Kein SQL-/Historienabruf, künstlicher Versuch oder neue Version.

### Erledigt und archiviert

- [x] #13: Node26 tatsächlich in der grünen CI-Matrix, Mindest-Node>=22; als erfüllt geschlossen. [CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40689952976).
- [x] Zehn ältere Tagesberichte #181/#211/#219/#220/#231/#240/#249/#263/#271/#274 als historische Dokumentation archiviert. Archivierung bescheinigt weder vollständige Auswertung noch behobene damalige Fehler. Verbleibende Themen in #7/#8/#60/#216/#26/#166 übernommen; Originaltexte und Kommentare bleiben erhalten.
- [x] Vorhandene Paket-/Abhängigkeits-/Übersetzungsfortschritte in #26/#197 synchronisiert: repository, Node>=22, adapter-core^3.4.3/testing^6.3.0, elf vollständig übersetzte567-Schlüssel-Kataloge, englische README/deutsche Anleitung, Tier/Lizenz-/Mindestversionen und begrenzte news.
- [x] Reale positive Fälle in #7: Mii-Mindest-SoC-Ende27.10.21:35 (#278), EHZ→EQE27.10.10:02 (#274/R2), EQV-Start28.10.08:51/08:52 und vollständige EQV→EQE-Prioritätsübergabe28.10.13:49 anerkannt.
- [x] EQE1P-/3P-Betrieb und vollständiger natürlicher1P→3P-Wechsel27.10. anerkannt. Zusätzlich bereits in #211 vorhandenen belasteten3P→1P-Rückwechsel19.10. mit Modus-ACK/Pause/Wiederaufnahme in #8 aufgenommen; damalige Status-/Freigabeursache bleibt offen. Praktischer Rückwechsel27.10. separat anerkannt.
- [x] #166: Binärkontakt-Gruppen-Netz-/Eigenstrombilanz bereits in116/117 implementiert und integriert; konservativer asynchroner Bruttorückfall118 vorhanden. Nicht nochmals als völlig fehlende Entwicklung führen.

### Tatsächlich noch aktive Themen

| Issue | Erledigt / vorhandene Grundlage | Verbleibender Umfang |
| --- | --- | --- |
| #7 | Mehrere reale Start-/SoC-End-/EHZ-/Prioritätsketten | Alle Fahrzeuge/Gegenrichtungen, neue unvollständige Budget-/Absteckstopps aus #278, längere Regelruhe, aktive Schutzfälle und Master-/Skriptrückgabe; erfolgreiche natürliche Telemetrie-Haltefälle146/157 |
| #8 | Reale EQE-Phasenwechselteilnachweise in beiden Richtungen | Neue sauber korrelierte Rückwechsel-/Statuskette, weitere Fahrzeuge, Fehler-/Abbruch-/Kommunikationsfälle, Master-Rückgabe; optionale LPC-Diagnose |
| #60 | Dauerhaftes Journal, Segmente160, exakter SQL-SELECT148/161 und Late-Callback-Recovery |19 neue Verluste unter160 am28.10.13:00; SQL-Transport399,621s unter161, physische Ursachen, mehrtägige Verlustfreiheit und externe Abdeckung |
| #216 | Einmalige begrenzte Stromkorrektur114 und konkrete Konfliktdiagnose149 | Natürlicher Konflikt mit vollständiger Originalkette, ungeklärte go-e-Rückmeldungen; UpstreamPR366 weiterhin offen/nicht gemergt |
| #166 | GZF/Admin, Gruppenbilanz und produktive Binärkontakt-Integration | Verifizierter LPC-Endpunkt-/Gruppenvertrag und Integration; reale aktive §14a-Abnahme |
| #26 | Eigene Tests/Paket/Tarball/CI, unterstützte Node-Matrix und umfangreiche Metadaten/Sprachen | Offizielle Controller-Integration/Checker, Lint/Timer/Objekte/Lockfile/Kontakte, messbare Last und Veröffentlichung |
| #197 | Mehrere konkrete Checkerbefunde erfüllt/abgehakt | Vollständiger aktueller Recheck und verbleibende technische/Veröffentlichungsbefunde; optionale Vorschläge sind keine Defekte |
| #25 | Batterie-/Mehrkopfpfade und Temperaturreserve vorbereitet | Reale Hardware-/Mess-/Schutz-/Rückgabeabnahme, umfassende Verbrauchs-/WP-/PV-Reserve |
| #75 | Modul3-Viertelstundenplanung samt Verlusten/PV-Freiraum implementiert | Reale NT-Ladung, HT-Entlastung, SoC-/ACK-/Schutz-/Rückgabeketten mit Speicher |
| #155 | Vorhandene Status-/Ursachendiagnosen | Verständliche integrierte Live-Erklärung im Admin mit realen Beispielen |
| #156 | Originale, ACKs, elektrische Quellen und manuelle Ereignisauswertungen | Automatische korrekte Erfolg-/Auffällig-/Unbekannt-Klassifikation |
| #157 | Tagesintegrale/Abdeckung/Untersuchungsepisoden vorhanden | Regelgüte mit tatsächlich nutzbarem Stellbudget und belegter Vermeidbarkeit |
| #158 | Getrennte Recorder-/Journal-/SQL-Zustände vorhanden | Verständliche integrierte Qualitätsanzeige inklusive extern geprüft/ungeprüft |
| #159 | Einzelne gemessene Befehls-/ACK-/Antwortketten vorhanden | Systematische zuordenbare Reaktionszeitstatistik je Aktor samt Unsicherheit |
| #160 | Thermische Planung und passive WP-Vorbereitung | Bewusst bis zur kommenden Wärmepumpe zurückgestellt; aktuell kein Umbau |
| #161 | Decoder/Originalreader/isolierte Fixture-Versionsvergleiche vorhanden | Allgemeiner deterministischer Vergleich realer gleicher Eingangsdatensätze mit Lücken-/Gegenfaktikgrenzen |
| #162 | Tagesaggregate und externe Tagesberichte | Integrierter deutscher Rückblick mit belegter Zielerreichung/Engpässen und belastbarer Kostenbasis |
| #163 | Bestehende Prognose/Korrektur/Confidence-Anzeige | Zeitlich sauber kalibrierter Unsicherheitsbereich mit gemessener Trefferquote/Abdeckung |
| #164 | Abfahrts-/SoC-/Mehrfahrzeugplanung vorhanden | Verständliche Machbarkeitsanzeige erreichbar/unerreichbar/unbekannt |
| #165 | Bestehende Validierungen und Schutzprüfungen | Verständliche statische/dynamische Konfliktprüfung mit konkreten Lösungshinweisen |
| #278 | Aktueller Tagesbericht inklusive Morgen-/Abendbelegen | Referenz für den heutigen Stand; Teilscore27/35, normiert77/100 bei35/100 bewertetem Umfang, kein Gesamtscore |
| #36 | Diese Übersicht | Restumfang koordinieren, vorhandene Lösungen wiederverwenden |

**Ergebnis nach Pflege:22 offene Issues statt33.** Davon sind #36/#278 Übersicht/aktueller Bericht; ein erheblicher Teil sind Wünsche oder hardwareabhängige Abnahmen, keine22 belegten Reglerfehler. Keine neue Version beauftragt:161 weiter normal betreiben und vorhandene Diagnosen bei gezielten Kontrollen/Tagesläufen auswerten. Kein dauerhafter Hintergrundmonitor behauptet. Installation/Release/CI/reale Abnahme bleiben getrennt; exakter installierter Commit unbekannt.

Die folgenden datierten Abschnitte bleiben als Historie erhalten. Insbesondere frühere offene Node26-/Sprach-/Gruppenbilanzbehauptungen sind durch den aktuellen Abgleich ersetzt.

---

<!-- eqv-eqe-priority-handoff-20261028-1349 -->
## Fortschritt reale Fahrzeugübergabe – 28.10.2026

- [x] AP1/#7: Prioritätswechsel vom tatsächlich ladenden EQV/WB1 zum EQE/WB2 real vollständig im normalen Fall nachgewiesen.
- [x] EQV-AUS-Auftrag und unabhängiges AUS-ACK, danach frische elektrische Null aller Phasen und Freigabe der zuvor gehaltenen Reserve, erst anschließend EQE-EIN und echte 1P-Aufnahme.
- [x] Vorbereitete Übergabe ohne erneute 300-s-Startqualifikation im beobachteten Fall bestätigt.
- [ ] Verbleibende Prioritätsrichtungen, Mii-Beteiligung, Fehler-/Schutzfälle und Master-AUS/Rückgabe.

**Beleg:** #7, Abschnitt „Reale Teilabnahme EQV → EQE nach Prioritaetswechsel“, 28.10.2026, 13:49–13:50 MEZ unter laufender alpha.161. Prioritätsquelle13:49:46.606; EQV-AUS-ACK49.309, elektrische Null51.730–51.750, neue Reserveverteilung53.081; EQE-EIN-ACK58.318, echte1,30kW-Aufnahme13:50:22.623 und anschließend1,75kW. Kein gemessener Ladeüberlapp im erfassten Wechsel. Vollständige Originalkette und Grenzen der Rekonstruktion stehen zentral in #7.

Dies ist ein bestandener realer Teilpunkt, keine vollständige AP1-Abnahme. Kein Phasenwechsel, keine aktive Schutzreaktion und keine automatische Diagnosefunktion dadurch abgenommen. #7 und #36 bleiben wegen ihres Restumfangs offen; kein neuer Gesamtscore. Vorhandene Belege wiederverwendet, keine weiteren SQL-Abfragen oder Anlagenänderungen.

---

<!-- phase-partial-acceptance-2026-10-27 -->
## Fortschritt reale Abnahme – 27.10.2026

- [x] AP4/#8: EQE-Grundbetrieb 1P und 3P sowie natürlicher 1P→3P-Wechsel mit Modus-ACK, elektrischer Phasenantwort und anschließender Leistungsaufnahme real belegt und als Teilabnahme abgehakt (Tagesbericht #274/R1).
- [x] Entsprechender Phasen-Teilpunkt in AP1/#7 ist synchronisiert.
- [ ] AP4-Gesamtabnahme: verbleibende Richtungs-/Fahrzeug-/Schutz-/Master-Rückgabefälle laut aktueller Liste in #8.

Teilabnahme des beobachteten normalen EQE-Betriebs unter alpha.156, auf ausdrücklichen Betreiberauftrag. Dies zählt als realer Fortschritt und wird nicht durch fehlende Vollabnahme wieder offen gesetzt. Kein vollständiger 3P→1P-Auftrag/ACK/Stromkettennachweis, keine Abnahme aller Fahrzeuge, von Master-AUS/Rückgabe, fehlendem ACK oder Kommunikationsausfall während eines Phasenwechsels. Alpha.159 ist separat laufend bestätigt; der heutige Wechsel ist kein neuer Wechseltest unter .159.

Dieser Fortschrittsstand ersetzt die pauschale alte Aussage „reale Wechsel/Wiederanlauf noch offen“ für den oben konkret geprüften Fall. Historische Berichte und sonstige Arbeitspakete bleiben erhalten.

---

## Bereinigung und aktueller Arbeitsstand – 19.10.2026

Auf ausdrücklichen Auftrag des Betreibers wurden alle **43 offenen Issues** einschließlich vorhandener Kommentare eingeordnet. Geprüfter main: `9585b276c75c3ed79634204ba8318166e577dc44`; zuletzt belegte laufende Version alpha.96. Die jüngsten reinen Repository-/CI-/Metadatenänderungen sind nicht automatisch in der laufenden Installation enthalten. Kein neuer SQL-Vollabruf, keine neue Betriebsabnahme, keine Anlagenänderung und keine Scoreänderung durch diese Bereinigung.

### Zuständige offene Arbeitspakete

| Issue | Verbleibender Umfang |
| --- | --- |
| #7 | Reale Wallbox-/EHZ-Abnahme, Regelruhe, vollständige Start-/Stopp-/Prioritätsketten, Grenzen und Rückgabe; alte datierte Befunde nicht pauschal als erneut aktuelle Fehler behandeln. |
| #8 | EQE-1P-/3P-Betrieb und natürlicher 1P→3P-Wechsel mit Modus-ACK, frischen Phasenströmen und Wiederanlauf am 27.10. teilabgenommen. Offen: vollständiger 3P→1P-Kettennachweis, weitere Fahrzeuge/Gegenfälle, Master-Rückgabe; optionale LPC-Diagnose. |
| #60 | Recorder-/SQL-Verlust- und Timeoutursachen sowie nachhaltige Speichernachweise; alpha.96 ergänzt Diagnose, keine garantierte Verlustbehebung. |
| #26 | Offizielle Paket-/Integration-/Checker-/Sprach-/Veröffentlichungsreife und messbare Laufzeitqualität. |
| #25 | Batterieanbindung und reale Schutz-/Reserve-/NVP-Abnahme; umfassende vorausschauende Reserve noch offen. |
| #75 | Modul-3-Planung implementiert, reale Tarif-/Speicherabnahme weiterhin offen. |
| #166 | Eigenstrom-/Netzbezugsbilanz der Teilnehmergruppe noch offen; Admin/GZF/Budgetquellen seit alpha.90 nicht erneut entwickeln. |
| #181 | Jüngster Tagesbericht und Vergleichsbasis; seine offenen Ziele werden in obigen Arbeitspaketen und dem nächsten Tagesbericht fortgeführt. |
| #13 | Node-26-Kompatibilitätsprüfung nicht durch bestandene Node-22/24-CI erledigt. |
| #14 | Alter Checkerbefund nur teilweise bearbeitet; neuer vollständiger Checker-Nachweis fehlt. |

### Featurewünsche bleiben erhalten

Die vorhandenen Diagnose-States, die SoC-Schätzung und ein externer Tagesbericht erfüllen nicht automatisch alle gewünschten integrierten Funktionen. Daher kein pauschaler Abschluss:

| Issue | Thema | Einordnung |
| --- | --- | --- |
| #165 | Verständliche Prüfung widersprüchlicher EMS-Einstellungen | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #164 | Machbarkeitsanzeige für Fahrzeug-SoC zum Abfahrtszeitpunkt | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #163 | PV-Prognose mit nachvollziehbarem Vertrauensbereich | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #162 | Verständlicher persönlicher EMS-Tagesrückblick | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #161 | Historischer Versionsvergleich mit aufgezeichneten Eingangsdaten | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #160 | Komfortgeführte vorausschauende Bewirtschaftung von WW, Heizpuffer und FBH | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #159 | Gemessene Befehls- und Gerätereaktionszeiten je Aktor | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #158 | Getrennte Qualitätsanzeigen für Recorder, SQL-Speicherung und Historienabruf | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #157 | Tageskennzahlen zur Netzregelgüte bei nutzbarem Stellbudget | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #156 | Automatische ereignisbezogene Bewertung von Ladeende und Übergängen | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |
| #155 | Verständliche Live-Erklärung „Warum gerade so?“ im Admin | Offen: eigenständiger Anzeige-/Auswertungs-/Planungsumfang; vorhandene Teilfunktionen sind keine vollständige Umsetzung. |

### Archivierte Berichte statt paralleler offener Aufgabenlisten

Die folgenden **21 älteren Berichts-Issues** werden als historische Dokumentation geschlossen. Texte, Kommentare, Ereigniszeiten und Reproduktionen bleiben erhalten und verlinkbar. Geschlossen bedeutet hier **Bericht archiviert**, nicht sämtliche damaligen Fehler erklärt oder Tests bestanden. Ihre noch relevanten Prüfverträge bleiben in #7/#8/#60/#26/#25/#75 und #166 erhalten. Historische Ursachen bei fehlenden Rohdaten bleiben unbekannt, statt einen unbelegbaren alten Einzelfall endlos als aktive Aufgabe zu führen.

- #169: [SQL 2026-10-17] EMS-Livebetrieb: Tagesauswertung
- #167: [SQL 2026-10-16] EMS-Livebetrieb: Tagesauswertung
- #154: [SQL 2026-10-15] EMS-Livebetrieb: Tagesauswertung
- #149: [SQL 2026-10-14] EMS-Livebetrieb: Tagesauswertung – alpha.79, SQL-Drosselung und Datenlücken
- #145: [SQL 2026-10-13] EMS-Livebetrieb: Tagesauswertung – alpha.76, voller Recorderpuffer
- #143: [SQL 2026-10-12] EMS-Livebetrieb: Tagesauswertung – Recorder-Rückstand und unbekannte SQL-Abdeckung
- #142: [SQL 2026-10-11] EMS-Livebetrieb: Tagesauswertung – SQL-Lücken und offener Nachweis
- #136: [SQL 2026-10-10] EMS-Livebetrieb: Tagesauswertung
- #123: [SQL 2026-10-09] EMS-Livebetrieb: Tagesauswertung – erklärbare Stopps, offene Regelruhe
- #116: [SQL 2026-10-08] EMS-Livebetrieb: Tagesauswertung – Übergabe belegt, Mii-Telemetriestopp
- #110: [SQL 2026-10-07] EMS-Livebetrieb: Tagesauswertung – SQL-Zugriff begrenzt
- #98: [SQL 2026-10-06] EMS-Mischbetrieb: Tagesauswertung und begleiteter Live-Probelauf
- #86: [SQL 2026-10-05] EMS-Schattenbetrieb: Tagesauswertung
- #80: [SQL 2026-10-04] EMS-Schattenbetrieb: Tagesauswertung
- #76: [SQL 2026-10-03] EMS-Schattenbetrieb: Tagesauswertung
- #73: [SQL 2026-10-02] EMS-Schattenbetrieb: Tagesauswertung
- #71: [SQL 2026-10-01] EMS-Schattenbetrieb: Tagesauswertung
- #66: [SQL 2026-09-30] EMS-Schattenbetrieb: Tagesauswertung
- #64: [SQL 2026-09-29] EMS-Schattenbetrieb: Tagesauswertung
- #62: [SQL 28.09.2026 / alpha.20] WB0-Messwertstopp, WB1-Schattenpausen und fehlende WB2-Fehlerdiagnose
- #57: [Auswertung 22.09.2026] SQL-Schattenbetrieb: Wallbox-Stabilität, Phasenkoordination und offene Abnahme

### Bereits erledigte Repositorypflege

PR #183/#184: Node-Mindestversion >=22 und vollständige Node-22/24-CI. PR #185: Lizenzmetadaten, drei node:-Imports und Dependabot-Vorschläge ohne Auto-Merge. PR #186: Tier2. PR #189: Keyword und Admin-/Controller-Mindestversionen. PR #190: älteres Changelog ausgelagert. Diese Punkte nicht erneut entwickeln; kein neuer offizieller Checker-/npm-/Stable-Nachweis daraus. PR #22 bleibt gemäß Betreiberentscheidung offen und Auto-Merge deaktiviert.

Die nachfolgenden älteren Roadmapstände sind historische Dokumentation; diese Einordnung hat Vorrang.

---

<!-- status-review-2026-10-10-alpha63 -->
## Standabgleich 10.10.2026 – alpha.63

Geprüfter main: [88e85a2](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/88e85a223024ce69c849e4c67f288f2235504fa0), veröffentlichte und laut Startlog am 10.10. um 04:41:32 MESZ laufende **0.17.0-alpha.63** ([Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.63)). Produktive Regelung freigegeben, aktuelles Control.Valid=true. Dieser Snapshot ersetzt keine Ereignishistorie. Letzter belegter Score **69/100**, keine zusätzlichen Punkte durch Veröffentlichung/Installation. Historische Befunde unten bleiben datiert erhalten.

### Aktuelle Roadmap statt überholter Ausgangsannahmen

1. **AP1 / #7:** begleitete Liveabnahme weiterführen. Berechtigte Fahrzeuge dürfen parallel ihre Mindestladung erhalten; Mehrleistung nach Priorität. Die alte pauschale Forderung „ausschließlich nacheinander“ ist überholt. Echte Fahrzeugübergaben bleiben separat mit AUS-/Ruhe-Nachweis zu prüfen. Tatsächlich konfigurierte Timer je Ereignis lesen, keine pauschale historische 120-s-Annahme.
2. **AP4 / #8:** Phasenfolger softwareseitig vorbereitet und am 08.10. installiert bestätigt; reale Wechsel, Wiederanlauf und Master-AUS/Rückgabe bleiben offen. Interne go-e-Umschaltung und externe Schütze getrennt betrachten.
3. **Diagnose / #60:** Record-/Replay-/Abruf- und ereignisorientierte Aufzeichnung umgesetzt; vollständiger realer 24-h-Nachweis, Timeoutursache und tatsächliche Lastreduktion offen.
4. **AP3 / #26, #13, #14:** Paket-/de/en-/Regressionsteile und begrenzte Speicherpfade vorhanden; offizielle Checker-/Integrationstests, Node-Matrix, Metadaten und Veröffentlichungsreife noch offen. GitHub-Prereleases sind keine npm-/Latest-/Stable-Abnahme.
5. **AP5 / #25, #75:** Modul-3-Planung softwareseitig vorhanden, reale Batterie-/Reserve-/NVP-Abnahme erst mit tatsächlicher Hardware. WP-Vorbereitung alpha.57 ist passiv; keine reale WP-Steuerungsabnahme.

Die unten genannte Reihenfolge und offenen Einzel-Issues sind ein historischer Planungsstand, keine aktuelle Liste aller offenen Arbeiten. AP2 wird hier nicht ohne erneute Detailprüfung pauschal für vollständig abgeschlossen erklärt. Regelruhe, Schutzgrenzen, genau ein zuständiger Stellregler und sichere Rückgabe bleiben maßgeblich. Kein Issue wird durch diesen Abgleich geschlossen; keine Anlagen- oder Codeänderung.

---

## Ausgangspunkt

Aktueller Softwarestand: **0.16.0-alpha.1**, Commit `cfee89b8c9cf0e22be105422af7cd368b8a6edfc`.

Die offenen Themen werden nicht mehr als eine einzige Folgeversion behandelt, sondern in fachlich zusammenhängende Arbeitspakete gegliedert. Dadurch bleiben Regelungsänderungen, Admin-Umbau, Adapterqualität und spätere Hardwareerweiterungen voneinander prüfbar.

## Verbindliche Grundsätze

- Je Aktor gibt es höchstens einen schreibenden Regler.
- Schutzgrenzen haben Vorrang vor Mindeststrom, manueller Vorgabe und Fahrplan.
- Ein Update aktiviert keine produktiven Ausgänge.
- Die reale Phasenumschaltung bleibt ausschließlich Aufgabe des externen Skripts.
- Ohne reale Batterie wird keine fiktive Batterieleistung verwendet.
- Jedes Arbeitspaket erhält eigene Verhaltenstests und eine dokumentierte Rückfallmöglichkeit.

## AP1 – Alpha-Abnahme der aktuellen Leistungsregelung

**Leit-Issue:** #7  
**Mit enthalten:** der Mehr-Wallbox-Anteil aus #8

Gemeinsam abzunehmen:

- WB0, WB1 und WB2 werden ausschließlich nacheinander betrieben.
- Der EHZ darf parallel als schneller, stufenloser NVP-Feinregler arbeiten.
- 120-s-Startverzögerung der Wallbox ohne Verlust des verfügbaren Überschusses durch den EHZ.
- 600-s-Mindestlaufzeit sowie definierte Abschaltlogik.
- Bestätigtes AUS vor dem Wechsel auf eine andere Wallbox.
- Sichere Übernahme einer bereits laufenden Wallbox nach Adapterstart.
- Priorität, SoC, Pflichtladung, Hausanschlussgrenzen und §14a/LPC.
- Sicherer Wechsel zurück auf die bisherigen Skripte.

**Abschluss:** erst nach realem Test aller drei Wallboxen, EHZ-Kombinationsbetrieb, PV-Schwankungen, Lastsprüngen und dokumentiertem Rückfall.

## AP2 – Einheitliches Konfigurations- und Admin-Modell

**Leit-Issue:** #33

Diese Themen sollen in **einer gemeinsamen Entwicklungsserie** umgesetzt werden, weil sie dieselbe Admin-Datei, das Konfigurationsschema, die Zuordnung der Datenpunkte und die Migration bestehender Einstellungen betreffen.

### AP2A – Hausanschluss und Wallbox-Grundeinstellungen

- #28 Hausanschlusssicherung und gemeinsame Leistungsgrenzen
- #29 allgemeine Wallbox-Parameter und eigenes Register

Ziel:

- physische Hausanschlussgrenze zentral und eindeutig abbilden;
- Sicherheitsreserve/Hysterese und daraus abgeleitete Arbeitsgrenzen klar von der Sicherungsgröße trennen;
- doppelte, widersprüchliche EHZ-/Wallbox-Grenzen beseitigen;
- allgemeine Wallbox-Parameter nicht im NVP-Register verstecken.

### AP2B – Datenquellen vollständig im Admin

- #5 SoC- und Prioritätsquellen
- #30 dynamische Energiepreise und Netzentgelte
- #31 Historie-/Prognosequellen
- #32 Außentemperatur
- #33 Ablösung der manuellen JSON-Konfiguration

Ziel:

- alle benötigten Objekt-IDs und Quelloptionen über verständliche Admin-Felder auswählbar;
- sinnvolle Register für Messwerte, Prognose/Preise und Wallbox allgemein;
- bestehende JSON-Zuordnungen während der Migration weiter einlesen;
- JSON erst nach getesteter Übernahme der Altwerte aus dem Bedienweg entfernen;
- fehlende oder ungültige Pflichtquellen führen zu einer klaren Diagnose und sicherem Verhalten.

**Abschluss:** Migrationstest mit vorhandener Konfiguration, Start ohne Alt-Konfiguration, vollständige Admin-Hilfe und unveränderte Produktivfreigaben.

## AP3 – ioBroker-Qualität, CI und Veröffentlichungsreife

**Leit-Issue:** #26  
**Enthalten:** #13 und #14

Gemeinsam umzusetzen:

- Paketmetadaten, Abhängigkeiten und offizieller Pakettest;
- Node-Testmatrix einschließlich #13;
- Standard-CI, Adapter-Checker und ESLint;
- `io-package.json`, Objektdefinitionen und Timer;
- Übersetzungen, responsive Admin-Oberfläche und Dokumentation;
- abschließender Checker-Lauf zu #14.

Der Admin-/Übersetzungsteil folgt auf AP2, damit die Oberfläche nicht zweimal umgebaut und übersetzt wird. npm-/Latest-Veröffentlichung bleibt die letzte Stufe und erfolgt erst nach realer Produktivabnahme.

## AP4 – Externe Phasenumschaltung

**Leit-Issue:** #8

Separat nach AP1 umsetzen und testen:

- externes Skript liest ausschließlich `Control.Targets.WallboxX_Phases`;
- Stop, bestätigtes AUS, reale Umschaltung, Rückmeldung und Verriegelungszeit;
- keine Phasen-Schreibausgänge im EMS-Adapter;
- Fehlsignal oder fehlende Bestätigung führt nicht zum Weiterladen mit ungeklärter Phasenlage.

Die optionale §14a/LPC-Diagnose kann hier ergänzt werden, verändert aber nicht das aktuelle Leistungsbudget.

## AP5 – Batterie und vorausschauende Reserve

**Leit-Issue:** #25  
**Mit enthalten:** der Batterie-Anteil aus #8  
**Abhängigkeit:** AP2B

Erst mit real eingebauter und messbarer Batterie:

- Batterie übernimmt perspektivisch die schnelle NVP-Feinregelung;
- Rolle und Priorität des EHZ danach neu abstimmen;
- dynamischen Mindest-SoC aus nächtlichem Verbrauch, Außentemperatur/Wärmepumpenbedarf und PV-Prognose bestimmen;
- Laden eines Fahrzeugs aus der Hausbatterie nur bis zur berechneten Reserve;
- sichere Grenzen für SoC, Lade-/Entladeleistung und fehlende Messwerte.

## Empfohlene Reihenfolge

1. **AP1** abschließen – aktuellen Alpha-Stand real stabilisieren.
2. **AP2** umsetzen – konsistente Konfiguration und Migration schaffen.
3. **AP3** abschließen – Qualität und Veröffentlichung vorbereiten.
4. **AP4** separat in Betrieb nehmen – externe Phasenumschaltung.
5. **AP5** nach Einbau der Batterie entwickeln und abnehmen.

## Zuordnung der derzeit offenen Issues

| Arbeitspaket | Issues |
|---|---|
| AP1 Alpha-Abnahme | #7, Mehr-Wallbox-Abnahme aus #8 |
| AP2 Admin/Konfiguration | #5, #28, #29, #30, #31, #32, #33 |
| AP3 Qualität/Release | #13, #14, #26 |
| AP4 externe Phasenumschaltung | #8 |
| AP5 Batterie/Reserve | #25, Batterie-Anteil aus #8 |

Die Einzel-Issues bleiben bis zur jeweiligen Abnahme offen. Bot-Issues #13 und #14 werden erst geschlossen, wenn die zugehörigen Prüfungen tatsächlich erfolgreich sind.

</details>


