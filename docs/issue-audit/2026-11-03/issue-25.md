# Issue #25 – [AP5] Batterie: dynamische Reserve und NVP-Feinregelung

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25. Letzte Issue-Änderung: 2026-10-29T09:49:46Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- vehicle-mobility-reserve-167 -->
## Präzisierte Fahrzeug-/Modul-3-Regel — 29.10.2026

Diese Vereinbarung präzisiert die ältere Aussage „unter Mindest-SoC sofort/vorrangig laden“ für die künftige Modul-3-Integration:

- Mindest-SoC ist das Bereitschaftsziel bis zur nächsten gültigen Abfahrt; Unterschreiten allein soll im Modul-3-Betrieb nicht automatisch eine sofortige teure Netzladung auslösen.
- Separate Mobilitätsreserve je Fahrzeug als beschreibbares Objekt `Vehicles.WallboxN.MobilityReserve_pct`, Vorgabe **0 % = aus**. Keine pauschale 15-%-Reserve festgelegt. Reserve maximal bis zum jeweiligen Mindest-SoC; fehlende/ungültige Werte schaffen keine Freigabe.
- Unterhalb der gültigen Reserve soll erforderliche Sofortladung möglich sein, unter allen Geräte-, Freigabe-, Netz-/Phasen- und Schutzgrenzen. Ausdrückliches Sofortladen/manueller Nutzerwunsch bleibt gesondert zu berücksichtigen.
- Für die restliche Mindestladung günstige Gesamtpreisfenster vor der Abfahrt nutzen, einschließlich Netzentgelt. Reichen sie zeitlich/leistungsmäßig nicht aus, nur die notwendigen teureren Zeitanteile einplanen; realistische Leistung und Zeitpuffer beachten.
- PV nur berücksichtigen, soweit vor der betreffenden Abfahrt nutzbar. Reserveenergie ist Teil des Mindestbedarfs, keine zusätzliche Nachtenergiemenge.
- Vorhandene `DepartureTime`/`DepartureTimestamp` und DeadlineEnabled wiederverwenden. Anlagenprüfung: alle drei DepartureTime leer, Timestamp 0, Preisfrist flexibel; keine feste Abfahrt eingestellt. Keine Uhrzeiten automatisch erfunden. Verhalten ohne gültige Abfahrt ausdrücklich behandeln; flexible Preisplanung ist keine garantierte Abfahrtsdeckung.

### Vorbereiteter Softwareumfang

- [x] Persistente Reserveeingaben mit Erstwert 0 und lesende Vorschau samt begrenztem Teilbedarf/Abfahrtsinformation in [PR #287](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/287) implementiert und lokal geprüft.
- [ ] **Produktive** Sofortlade-/Mindest-SoC-Priorität, Preis-Ladesitzungen, Frist-/PV-/Tarifplanung und Rückfallverhalten gemeinsam auf die oben beschriebene Regel umstellen und testen.
- [ ] Installation und reale Reserve-/Abfahrts-/Modul-3-Abnahme.

**Alpha.167 bereitet nur Eingabe und Vorschau vor. Die bisherige produktive Sofortladung unter Mindest-SoC wird dadurch noch nicht ersetzt.** Vorschau bleibt `productionReady=false`; keine neue Geräte-/Preisfreigabe oder live eingestellte Abfahrt. Der produktive Integrationsauftrag bleibt hier offen.

---

<!-- battery-strategy-preparation-165 -->
## Gestufte Batteriestrategie vorbereitet – 29.10.2026, alpha.165

Nutzerregeln: Batterie bleibt bei Aktivität Feinregler, hält den geplanten Zwischen-SoC im kleinen Arbeitsbereich und puffert Fahrzeugstufen; oberhalb des Ziels begrenzte Energie ans Fahrzeug, unterhalb Batterievorrang gegenüber Fahrzeugen oberhalb ihres Mindest-SoC. Fahrzeuge unter Minimum haben Vorrang. Abendfüllung möglichst spät mit vorhandenem Prognosepuffer; Geräteminimum/-maximum aus echten Batteriequellen. Modul3-Nachtziele der Fahrzeuge sind Mindest-SoC, gemeinsame Nachtenergielücke nach erwartetem Tages-PV/Verbrauch betrachten.

- [x] Berechnete **lesende Vorschau** in Diagnostics.BatteryStrategy und Snapshot_JSON integriert. Vorgeschlagene konservative Vorschauparameter:1Prozentpunkt Arbeitsbereich,500W begrenzte Fahrzeugunterstützung und maximal1A Fahrzeugschritt; keine Änderungen der vorhandenen Ausgangsrampen.
- [x] Echte frische SunEnergy-Kopfprofile mit Gerätegrenzen, Kapazität und aktuelles Plan-Zwischenziel erforderlich. Fehlende/alte/ungültige Daten bleiben unbekannt; Geräte-Maximum unter100% wird respektiert. Bestehende operative Grenzen bleiben zusätzlich wirksam.
- [x] Mindest-SoC-AC-Bedarfe der Fahrzeuge und gemeinsame Nacht-Energiebilanz sichtbar; deaktivierte/gesperrte Fahrzeuge werden nicht als freigegebene Käufer angenommen. Bestehenden Abendpuffer übernehmen;90%-PV-Nutzung ist eine ausdrücklich angenommene Vorschaureserve, keine gemessene Prognosegüte.
- [ ] **Produktive Koordination und Preisplaner auf diese neue Strategie umstellen:** Noch nicht umgesetzt/freigegeben. productionReady bleibt immerfalse; die bisherigen Preis-Ladesitzungen und ihre Zielsemantik wurden NICHT geändert. Nacht-Energiebilanz beweist keine zeitliche Deckung oder kaufbare günstige Fenster; nightGridKWh je Fahrzeug bleibt unbekannt.
- [ ] Hardwareanschluss, Kopf-/Mess-/Grenzzuordnung, echte ACK-/Leistungsantwort, NVP-Regelung, gegenseitiges Hochregeln, Schutzgrenzen und sichere Rückgabe real abnehmen. Legacy-Einzelkopf ohne geprüftes Profil liefert bewusst keine angenommenen Gerätegrenzen.

[PR283](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/283) nach acht grünen Node22/24/26-Jobs nach main `3176caf81fa515614aab1d01084614bc4c2a4ad5` übernommen; geprüfter/gemergter Baum `26258932d0579d66b2bbfff19cc94ac0c9d99c61`.3319Tests,61Paket-/Schematests,540responsiveFelder, installiertes Testtarball und historische Vergleiche bestanden. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40838524106). [Umfang/Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/3176caf81fa515614aab1d01084614bc4c2a4ad5/docs/release-0.17.0-alpha.165.md).

Keine Anlagen-, Aktor-, SQL- oder Preisfreigabe geändert; keine Hardwareaktivierung oder neue Rohprotokollierung. Die spätere Umsetzung und reale Abnahme bleiben hier offen. Kein automatischer Scoregewinn.

---

<!-- issue-cleanup-20261029 -->
## Gebündelte Speicherabnahme aus #75 – 29.10.2026

- [x] Modul3-Speicherplanung ist seit alpha.29/PR77 implementiert und getestet; #75 wird als erledigte Softwareaufgabe geschlossen.
- [ ] Tatsächliche NT-Netzladung mit passendem SoC-Verlauf und elektrischer Aufnahme belegen.
- [ ] PV-Freiraum und reale HT-Entlastung mit gültigen Tarif-/Energiequellen nachweisen; berechnete Ersparnis ist keine Abrechnung.
- [ ] Befehle, unabhängige Rückmeldungen, Leistungs-/SoC-Grenzen, Reserve, Ausfälle und sichere Rückgabe real abnehmen.

Diese Restpunkte sind ausdrücklich **nicht bestanden**; sie werden hier als gemeinsamer Hardware-/Batterieabnahmepunkt weitergeführt. Keine Batterie aktiviert und kein Versuch ausgelöst.

---

## Einordnung 19.10.2026

Offen wegen tatsächlicher Batterie-/NVP-/Reserve-/Rückgabeabnahme und weitergehender Reserve aus Verbrauch, WP-Bedarf, PV-Unsicherheit und Ladefenstern. Temperaturreserve (alpha.68), Modul3-Planung (#75) und vorbereitete SunEnergy-Mehrkopfpfade sind vorhandene Software, nicht erneut von Grund auf beauftragen. Wallbox-/EHZ-Erfolge sind keine reale Batterieabnahme.

Historische kombinierte Batterie-/Heizkreis-/WP-Prüfpunkte aus #57 und den archivierten Tagesberichten bleiben hier bzw. #160/#36 verlinkt erhalten; fehlende Hardware-/Durchfluss-/WP-Nachweise nicht als festgestellten Defekt behandeln. Keine Geräteaktivierung oder Installation durch diese Bereinigung.

---

Teil der zentralen Roadmap #36, **AP5**. Der Batterie-Anteil aus #8 wird hier zusammengeführt.

## Ziel

Nach Einbau der realen Hausbatterie soll der EMS-Adapter die schnelle NVP-Feinregelung auf die Batterie überführen und eine vorausschauende Mindestreserve bestimmen. Bis reale Mess- und Schreibpunkte vorhanden und geprüft sind, wird keine Batterieleistung angenommen oder simuliert.

## Abhängigkeiten

- AP1 / #7: aktuelle Wallbox-/EHZ-Regelung real abgenommen
- AP2B / #33: benötigte Mess-, Wetter- und Prognosequellen vollständig im Admin konfigurierbar
- reale Batterie mit bestätigten SoC-, Leistungs- und Grenzwerten

## Teil 1 – Sichere Batterieanbindung

- [ ] SoC, Lade-/Entladeleistung, Betriebszustand und verfügbare Leistungsgrenzen einlesen.
- [ ] Schreibausgänge mit Rückmeldung, Timeout, Watchdog und sicherer Rückgabe versehen.
- [ ] Mindest-/Maximal-SoC und Lade-/Entladeleistung als harte Schutzgrenzen behandeln.
- [ ] Fehlende, veraltete oder unbestätigte Werte führen zu Reduktion oder sicherem Stop.
- [ ] Es existiert höchstens ein schreibender Batterieregler.

## Teil 2 – NVP-Feinregelung

- [ ] Batterie übernimmt perspektivisch die schnelle NVP-Feinregelung.
- [ ] Wallboxen bleiben grobe Laststufen.
- [ ] Rolle, Priorität und Rampen des EHZ nach realem Batterietest neu festlegen.
- [ ] Sprünge bei Wallbox-Start, -Stopp und Ampereänderung möglichst gegenläufig ausgleichen.
- [ ] Verhalten bei voller/leerer Batterie und ausgeschöpfter Lade-/Entladeleistung testen.

## Teil 3 – Dynamischer Mindest-SoC

Bei der Reserveberechnung berücksichtigen:

- [ ] Median beziehungsweise belastbares Profil des nächtlichen Hausverbrauchs;
- [ ] Außentemperatur und daraus erwarteten Wärmepumpenbedarf;
- [ ] PV-Energieprognose des Folgetags;
- [ ] Prognoseunsicherheit und feste Sicherheitsreserve;
- [ ] geplante Fahrzeugabfahrten und Pflichtladungen.

## Teil 4 – Fahrzeugladen aus der Hausbatterie

- [ ] Fahrzeug darf aus der Hausbatterie laden, solange der berechnete Mindest-SoC sicher eingehalten wird.
- [ ] Reserveverletzung beendet oder reduziert die Batterieunterstützung.
- [ ] §14a/LPC, Hausanschlussgrenzen und Fahrzeug-Mindeststrom bleiben vorrangig.
- [ ] Batterie darf nicht zyklisch gegen EHZ oder Wallbox arbeiten.

## Abnahme

Reale Messwerte und Rückmeldungen sind plausibel, harte Grenzen werden nie überschritten, der dynamische Mindest-SoC ist erklärbar und die Rückgabe an einen Betrieb ohne EMS-Batteriesteuerung ist dokumentiert.

## Zugehörige Kommentare zum Archivzeitpunkt

### Kommentar 6097038952 – 2026-10-10T11:30:33Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25#issuecomment-6097038952)

Umsetzung als **0.17.0-alpha.68** veröffentlicht: [PR #133](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/133), [main-Commit 4203bca](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/4203bca2c292477217c5ed914d25ad2ec0923ffc), [Tag/Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.68).

Die optionale temperaturabhängige Mindestreserve ist im Admin-Reiter Speicher konfigurierbar (Quelle, zwei Schwellen, drei SoC-Werte, Quellenalter). Standard: <0 °C 30 %, 0–5 °C 20 %, >5 °C 10 %. Funktion standardmäßig AUS, Quelle leer; SoC-Maximum und bestehende Tages-/Spätladeziele bleiben erhalten. Keine zusätzliche SI-Registersteuerung und keine Installation oder Anlagenänderung ausgeführt.

Die Auswahl beginnt je Tagesperiode um 20:00 Uhr Europe/Berlin, bleibt bei Neustart mit geprüftem Beleg stabil und behandelt fehlende/ungültige Quellen als unbekannt: belegte Reserve halten oder ausdrücklich statisches Minimum verwenden. Spätere gültige Quellen werden nur mit tatsächlichem Auswahlzeitpunkt erfasst. Keine fiktive Anhebung des gemessenen SoC und keine neue Netzladefreigabe. Plan, Echtzeit-Speichervertrag und Schattenmodell nutzen dieselbe wirksame Reserve; Diagnose enthält Original-Quellenzeit/ACK/q und den zugehörigen Auswahlbeleg.

**Nachweis:** vollständige Node-20-GitHub-CI vor Merge und auf dem veröffentlichten main-Commit: 1.592/1.592 Tests bestanden, JSON-Paketprüfung und Paketvorschau bestanden. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/38048431321), [Release-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/38048548024). Tag verweist auf den geprüften main-Commit.

**Weiter offen in #25:** reale Speicherabnahme sowie umfassende Reserveberechnung aus Haus-/WP-Bedarf, PV-Unsicherheit und Ladefenstern. Dies ist ein Temperaturreserve-Teilbeitrag, keine vollständige AP5-Abnahme. Die in #75 vorhandene Speicherladung wird weiterverwendet. Nach manueller Einrichtung: Prognosezeitraum/Einheit prüfen, tatsächliche Tagesauswahl und Quellen-Ausfall/Neustart unterscheiden, gleichen Mindestwert in Plan und echter GS-/Leistungsantwort nachweisen. Softwaretests oder Release allein begründen keine Scorepunkte. Issue bleibt offen.

