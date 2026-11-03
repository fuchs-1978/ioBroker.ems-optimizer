# Issue #7 – [AP1] Alpha-Abnahme: Wallboxen, parallele Mindestladung und EHZ

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7. Letzte Issue-Änderung: 2026-11-01T22:21:51Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Aktueller Abnahmerest – 01.11.2026 / Alpha 186

### Seit dem letzten Abgleich bereits implementiert

- [x] #309/alpha.183: qualifizierte Rückkehr-/Prioritätsübergabe.
- [x] #310/alpha.184: feste Einphasigkeit ohne fehlenden Phasenmodus-ACK bei gezielter Spender-Rücknahme.
- [x] #311/alpha.185: rechtzeitiges AUS-ACK vor Startbudget-Warten auswerten; einmaliger begrenzter Fortsetzungsnachweis nach gelöschtem Fehler 5.
- [x] #312/alpha.186: laufende Folgestromsequenz bei Verbindungsverlust bereits vor ACK-Frist in den vorhandenen qualifizierten Haltepfad führen; unveränderte Cloud-Prozente setzen eine lückenlose SoC-Fortschreibung nicht erneut zurück.
- [x] Alpha 186 läuft. Manuelle, vom Betreiber in der App bestätigte Mii-Korrektur 91 % wurde wirksam; Ladebeendigung/0 W/AUS beobachtet. Das ist kein mehrstündiger realer Nachweis der neuen automatischen Ladefortschreibung.
- [x] #313/R1: EQV-Budgetstopp am 01.11., 14:57 mit ablaufendem Resttimer, AUS-Auftrag, unabhängigem ACK, elektrischer Null und anschließender Besitz-/Reservefreigabe im genannten Teilfenster positiv belegt.

### Noch offen, ohne erneute Entwicklung derselben Fixes

- [ ] Nächster natürlicher Fehler-5-Reset: tatsächliche Fortsetzung ohne erneute allgemeine Startwartezeit unter allen bestehenden Quellen-/Budget-/Stillstandsbedingungen.
- [ ] Natürliche längere Mii-Ladung mit unveränderten Cloud-Wiederholungen: Ladeenergie genau einmal fortschreiben; geänderten echten Fahrzeugwert und manuelle Basis getrennt beurteilen.
- [ ] #313/R2: EQV-Stoppsituation 14:00 während Historienanlauf; damalige Zuteilung samt Frische und vollständige Ausgangskette fehlen.
- [ ] #313/R3: Mii→EQV um 13:35; vollständiger eigener Freigabe-/Spender-/Reserve-/Empfängerstartnachweis fehlt. Nicht mit dem separat beobachteten EQE→Mii-Wechsel 11:31 gleichsetzen.
- [ ] #313/R4: EHZ-Nullzuteilungen und überlappender Schreibnachweis 10:44–10:46 unter 184. Zentrale Budgetursache/erster Schreibkonflikt nicht vollständig vorhanden; keine pauschale Temperatur- oder WLAN-Ursache bewiesen.
- [ ] #298/R2: Export-/Mehrfahrzeugabschnitt 30.10., 11:22–11:24 mit unvollständiger EQV-/EHZ-Folgekette und fehlenden Originalen ab 11:23:23. Weitere historische Budget-/Stoppketten aus #305 und #278 bleiben datiert ungeklärt.
- [ ] Weitere Fahrzeuge, Gegenrichtungen/Phasen, harte Schutz-/Freigabefälle und eindeutige Master-/Skriptrückgabe in #8/#216 abnehmen.

Recorder-/SQL-Abdeckung in #60, Prognosevergleich in #284. Fehlende historische Ketten werden nicht durch erneutes Laden bereits geschlossener Berichtsfenster oder durch heutige Cachewerte ersetzt.

<details>
<summary>Datierte Entwicklung und frühere Prüfstände (historisch)</summary>

<!-- issue-cleanup-20261029 -->
## Übernommene Restfälle und Diagnoseabnahme – 29.10.2026

Der abgeschlossene Tagesbericht #278 wird archiviert. Seine offenen EQE-Budgetstopps28.10.14:21/15:44 und Mii-Absteckstopp16:57 bleiben hier als ungeklärte historische Ketten erhalten; fehlende damalige Timer-/Befehl-/ACK-/Stromwerte werden nicht nachträglich erfunden. Widersprüchliche go-e-Quellen bleiben zusätzlich in #216.

Die Live-Erklärung aus #155 ist implementiert und liefert ein reales positives Beispiel: am29.10.08:19 Uhr Mii Soll6A/1P, gemessen etwa1,3kW, SoC27%/Ziel90%; EQV/EQE ohne zugeteiltes Startbudget und EHZ0W. Sollstrom/Status/SoC/Ziel anschließend einzeln gegen aktuelle eigene States abgeglichen. Das bestätigt diese Anzeige, keine vollständige Start-/Schutz-/Rückgabekette. Weitere natürliche Gegenfälle und die vorhandene Anlagenabnahme bleiben offen.

---

<!-- issue-audit-20261028 -->
## Abgleich sämtlicher Abnahmebelege – 28.10.2026

Die bereits bestandenen EQV-Start-/EQV→EQE-Übergabe- und EQE-Phasenpunkte bleiben abgehakt. Zusätzlich aus vorhandenen Berichten übernommen:

- [x] Mii-Mindest-SoC-Ende27.10.21:35 unter159: neue60%-SoC-Quelle, Pflichtladeende, neue Nullzuteilung, AUS-Auftrag/echtes ACK, frische elektrische Null und anschließende Besitz-/Reservefreigabe in #278/R1 belegt. Dies erfüllt den normalen Mindestlade-Endfall, nicht sämtliche Mii-Ziel-/Absteck-/Fehlerfälle.
- [x] EHZ nutzt vor EQE-Start27.10. gegen10:02 während Countdown etwa5–6kW und reduziert vor6-A-Start/anschließender Erhöhung; begrenzte reale Folgeabnahme alpha.156 aus #274/R2 anerkannt. Keine vollständige Lastsprung-/Wolken-/Temperaturabnahme daraus.
- [x] Tatsächlicher EQE-Rückwechsel3P→1P am19.10. mit elektrischer Wiederaufnahme bereits in #211 dokumentiert; mit offener damaliger Status-/Freigabeursache in #8 ergänzt.
- [ ] #278: EQE-Budgetstopps28.10.14:21/15:44 und Mii-Absteckstopp16:57 mit vollständigen damaligen Timer-/Befehl-/ACK-/elektrischen Ketten erklären. Logs/Code allein reichen nicht für pauschales Bestehen.
- [ ] Weiterhin alle Fahrzeuge/Gegenrichtungen, aktive Schutz-/Grenzfälle, wechselnde PV, längere Regelruhe sowie vollständige Master-/Skriptrückgabe abnehmen.
- [ ] Erfolgreiche natürliche Telemetrie-Haltefälle der vorhandenen Korrekturen146/157 mit frischen unabhängigen Schutzquellen belegen; guter Normalbetrieb ist kein Test einer Quellenlücke.

Widersprüchliche spätere go-e-EIN-/Stromquellen ohne entsprechenden EMS-Auftrag bleiben als Herkunftsfrage in #216 und bestehendem go-e-PR366 verknüpft. Historische Regelungs-/EHZ-Restthemen aus archivierten Tagesberichten bleiben hier erhalten; keine erneute Entwicklung bereits vorhandener Fixes. Kein neuer Gesamtscore und keine Anlagen-/SQL-/Codeänderung.

---

<!-- eqv-eqe-priority-handoff-20261028-1349 -->
## Reale Teilabnahme EQV → EQE nach Prioritaetswechsel – 28.10.2026, 13:49 MEZ

- [x] Prioritaetswechsel von tatsaechlich ladendem EQV/WB1 zu EQE/WB2: AUS-Auftrag, unabhaengiges AUS-ACK, frische elektrische Null, anschliessende Reservefreigabe und Empfaengerstart mit EIN-ACK/elektrischer Aufnahme in richtiger Reihenfolge real nachgewiesen.
- [x] Vorbereitete Fahrzeuguebergabe ohne erneute300-s-Startqualifikation in diesem normalen Fall real bestaetigt; Donorreserve blieb bis zum elektrischen Abschluss bestehen.

### Beobachtete Zeitkette

| MEZ | Beleg |
| --- | --- |
| 13:49:41.423 / 13:49:47.224 | EQV zuvor real2,25kW, EIN bestaetigt,10A-Vorgabe; EQE AUS/0W |
| 13:49:46.606 | Externe Prioritaet vom Betreiber auf2 gesetzt; Recorder-Eingang13:49:47.033 |
| 13:49:48.409 | EMS-AUS-Auftrag an go-e.1.allow_charging, Command-ID1793191568790:command:25; Transportabschluss13:49:48.767 |
| 13:49:49.309 | Unabhaengige go-e-AUS-Quelle ack=true/q0; das vorangehende ack=false-Echo wurde nicht als Geraetebestaetigung gezaehlt |
| 13:49:49.959–13:49:50.053 | EQV trotz AUS-ACK noch9,6A/2,27kW; StopPowerPending bleibt wirksam, Reserve2300W weiter gebunden |
| 13:49:51.730/.733/.737/.750 | EQV alle drei Phasenstroeme0A und Leistung0kW, jeweils ack=true/q0 |
| 13:49:52.161/.189 | Rekonstruierter Ausgang: StopPowerPending=false, danach OutputOwned=false |
| 13:49:53.081 | Frische gemeinsame Zuteilung: EQV-Reserve0W, EQE-Startreserve1380W; prepared-vehicle-handoff, eligible=true |
| 13:49:56.088 | EQE6-A-Auftrag, Command-ID1793191568790:command:31 |
| 13:49:58.098 | EQE-EIN-Auftrag, Command-ID1793191568790:command:32; Transportabschluss13:49:58.213 |
| 13:49:58.267/.318 | Echte EQE-Quellen bestaetigen6A und EIN, ack=true/q0 |
| 13:50:22.600/.603/.606/.623 | EQE L1=5,9A, L2=L3=0A, Leistung1,30kW; reale1P-Aufnahme etwa24,3s nach EIN-Quellenbestaetigung |
| 13:50:24.102/.132 | Fahrzeugantwort als confirmed verarbeitet, danach neuer8-A-Auftrag |
| 13:50:27.380 / 13:50:32.823 | Originalleistung steigt auf1,61 beziehungsweise1,75kW |

**Ergebnis:** Richtige AUS-/Null-/Reserve-/EIN-Reihenfolge, kein gemessener Ladeueberlapp im erfassten Wechsel. Kein Wallbox-Ausgangsfehler und kein Recorderverlust in den erhaltenen Kontexten. Die rund24s zwischen EIN und deutlicher EQE-Aufnahme sind beobachtete Fahrzeuganlaufzeit innerhalb der noch offenen Antwortfrist, kein belegter EMS-Fehler. Die regulaere Startverzoegerung300s wurde fuer die belegte vorbereitete Uebergabe bewusst nicht neu durchlaufen. Gespeicherte Timer dieses Falls: Start300s, Mindestlaufzeit600s, Stopp600s; diese verhindern nicht den expliziten kontrollierten Betreiber-Prioritaetswechsel.

**Nachweisgrenze:** Laufend alpha.161, Recordsession1793191568790. Drei neue getrennte SQL-Zustellfenster13:49:21.606–13:50:26.606,7/13/11Zeilen bei je Limit24, keines gesaettigt.393Originale, zusammenhaengende Sequenzen382–774; fruehe57Deltas ohne Vorbasis bleiben Kontext-unbekannt, ab Vollbasis seq439/13:49:32.713 sind336Records durchgehend rekonstruierbar und umfassen den kompletten Wechsel. Quellen-/Ereignis-/SQL-Zustellzeiten getrennt. Anschliessend eng begrenzte originale EQE-Leistungsreihe bis13:51:30 abgefragt; vier gespeicherte Aenderungswerte, kein daraus behaupteter vollstaendiger Dauertest. Kein alter Tagesabruf, kuenstlicher Anlagenversuch, neue Protokollierung oder Code-/Konfigurations-/Aktorwrite durch diese Analyse.

Dieser reale Erfolg bleibt abgehakt. Vollstaendige Abnahme aller drei Fahrzeuge, weiterer Gegenrichtungen/Prioritaets-/Leistungs-/Fehlerfaelle, Schutzreaktionen und Master-Rueckgabe bleiben offen. Kein neuer Gesamtscore allein aus diesem Teilnachweis; Sammel-Issue bleibt offen.

---

<!-- eqv-natural-start-partial-acceptance-20261028 -->
## Teilabnahme EQV-Start und ruhender EQE-Ausgang – 28.10.2026

- [x] EQV / WB1: natuerlicher produktiver 6-A-/1P-Start mit Stromauftrag, unabhaengiger EIN-Rueckmeldung und echter elektrischer Aufnahme unter laufender alpha.160 nachgewiesen.
- [x] EQE / WB2: nach Absteckerkennung im bereits elektrisch ruhenden Zustand AUS-Auftrag, unabhaengiges AUS-ACK, frische Nullleistung und anschliessend keine Ausgangsreserve im geprueften Ausschnitt bestaetigt.

**Zeitkette, MEZ:** EQE `car=1` ab Quelle08:34:34.879; bereits davor0W. Um08:34:40.610 EMS-AUS-Auftrag an go-e.2, Command-ID `1793164788802:command:3172`, Transportabschluss08:34:40.877. Eigenes ack=false-Schreibecho separat; echter go-e-AUS-Wert ack=true/q0 mit Quellenzeit08:34:40.995, danach frische0W08:34:41.178. Rekonstruierter Kontext bis08:34:45.643: OutputOwned/Active=false, StopPowerPending=false, WB2-allocation.reservedW=0. WB1 wartete bei0W; um08:34:35 fehlte Startbudget, keine laufende elektrische Donor-Uebergabe.

**EQV-Start:** 6-A-Auftrag08:51:50.061 (`:command:3584`), EIN-Auftrag08:51:52.586 (`:command:3587`), Transportabschluss08:51:52.856. Unabhaengige go-e-Quellen bestaetigen6A um08:51:53.283 und EIN um08:51:53.344 (je ack=true/q0). Elektrische Quellen:08:52:09.742 L1=4,1A, Leistung0,90kW um08:52:09.765;08:52:14.725 L1=5,8A und08:52:14.748 Leistung1,35kW. Frischer nativer Phasenmodus1, keine weitere Phase in den abgerufenen Originalquellen. Voll rekonstruierter Kontext08:52:15.089–.771: EQV OutputOwned/Active=true, OutputCommand_A=6, ConfirmedPhases=1, ResponseState=confirmed; EQE weiter AUS/0W/Reserve0. Danach Originalleistung beispielsweise1,79kW um08:52:54.754. Gespeicherte damalige Timer: Start300s, Mindestlaufzeit600s, Stopp600s; Start-Historie bewaffnet08:46:43.015, kein gespeicherter Reset. Keine aktuelle Einstellung rueckdatiert.

**Belegumfang:** neue eng begrenzte Originalquellen-/DecisionRecord-Fenster vom28.10.; Sitzung1793164788802. Auswahlfenster91 Originale(seq23567–23657), nach vorhandener Vollbasis ab08:34:35.051 rekonstruierbar; Startfenster200 Originale, erster voll rekonstruierbarer Kontext ab08:52:15.089. Fruehe Deltas ohne Vollbasis bleiben Kontext-unbekannt; ihre eigenstaendig gespeicherten Befehls-/Quellenereignisse wurden nicht als vollstaendige Entscheidungen ausgegeben. SQL-Zustellzeit und originale Ereignis-/Quellenzeit getrennt. Enger go-e.1-Leistungsverlauf erreichte das160-Zeilen-Limit: kein Vollstaendigkeitsanspruch bis zum angeforderten Ende09:10. Keine Wiederholung alter27./26.10.-Fenster, kuenstlichen Versuche, Anlagen-/Konfigurations-/Codewrites.

**Weiter offen:** komplette Uebergabe aus zuvor elektrisch laufender EQE-Ladung, dadurch bedingte Reservefreigabe und Empfaengerstart; vollstaendige Timer-/Prioritaets-/Mehrfahrzeug-/Schutz- und Rueckgabefaelle. Der EQE hatte in den heute verfuegbaren Leistungsbelegen keinen positiven Ladeblock. Diese positiven Teilpunkte bleiben anerkannt, ohne den umfassenden Mehr-Wallbox-Uebergabepunkt oder das Sammel-Issue zu schliessen. Kein neuer Gesamtscore aus dieser Teilpruefung.

---

<!-- phase-partial-acceptance-2026-10-27 -->
## Teilabnahme Phasenbetrieb – 27.10.2026

- [x] Grundlegender EQE-1P-/3P-Ladebetrieb und natürlicher 1P→3P-Wechsel einschließlich frischer elektrischer Wiederaufnahme real positiv geprüft; dieser Teilpunkt ist abgehakt. Belege und verbleibende Gegenfälle: #8 und #274/R1.

Teilabnahme des beobachteten normalen EQE-Betriebs unter alpha.156, auf ausdrücklichen Betreiberauftrag. Dies zählt als realer Fortschritt und wird nicht durch fehlende Vollabnahme wieder offen gesetzt. Kein vollständiger 3P→1P-Auftrag/ACK/Stromkettennachweis, keine Abnahme aller Fahrzeuge, von Master-AUS/Rückgabe, fehlendem ACK oder Kommunikationsausfall während eines Phasenwechsels. Alpha.159 ist separat laufend bestätigt; der heutige Wechsel ist kein neuer Wechseltest unter .159.

Die übrige Wallbox-/EHZ-Abnahme dieses Sammel-Issues bleibt getrennt offen. Historische pauschale Formulierungen einer noch völlig unbelegten Phasenumschaltung werden durch den Teilnachweis in #8 ersetzt; keine pauschale Vollabnahme oder neuen Score aus Versionsinstallation ableiten.

---

## Aktive Abnahme und übernommene historische Prüfpunkte – 19.10.2026

Leit-Issue bleibt offen. Aktuelle Gesamtübersicht #36, jüngste reale Tagesbelege #181 (71/100 am 18.10.; diese Dokumentationspflege ändert den Score nicht). Ältere Tagesberichte werden archiviert, nicht als vollständig bestandene Abnahme geschlossen.

Weiter zu beobachten: alle drei Fahrzeuge in tatsächlich auftretenden Start-/Stopp-/Absteck-/Prioritätsfällen; autorisierte Parallel-Mindestladung und echte Fahrzeugübergabe getrennt; unabhängiges AUS-ACK und elektrische Ruhe; Wiederübernahme nach Neustart; Schutz-/Quellenfälle, Preisfreigabe/Widerruf, Phasenabnahme in #8. Die Historie enthält unbeauftragtes Mii-Laden beim Anstecken (#7-Kommentare/alpha.66), kleine negative WB-Rohwerte (alpha.67) und Mehrfahrzeug-/Mindestladefehler (#116/#123): Softwarekorrekturen vorhanden, verbleibende natürliche Gegenfälle und reale Wirkung weiter prüfen, nicht erneut implementieren. Historische ungeklärte Gerätefehler/Bestandsskript-Endgründe aus #57/#62/#64/#66/#71/#73 bleiben als datierte Referenz erhalten; kein unbelegter heutiger EMS-Defekt daraus.

EHZ-Reservefreigabe wiederholt real belegt in #181, aber weitere Last-/Null-/Qualitätsfolgen beobachten. alpha.94: unbrauchbare thermische Restbudgets freigeben; alpha.95: PV-Schrittstrategie bei echter wechselnder PV noch vergleichbar prüfen. Vermeidbare Einspeisung in Wh/kWh und betroffene Zeit nur bei tatsächlich nutzbarem Budget beziffern (#157). Pumpen-KNX-Rückmeldung bestätigt Schaltaktor, keinen Durchfluss; Betreiber meldet keine Störung, daher kein eigenständiger Pumpenumbau.

Sämtliche archivierten Originalberichte und Kommentare bleiben über #36 zugänglich. Ein fehlender historischer Nachweis wird nicht nachträglich erfunden. Ältere pauschale Forderungen „nie gleichzeitig“ und feste 120-s-Timer sind keine aktuellen allgemeinen Verträge.

---

<!-- status-review-2026-10-10-alpha63 -->
## Standabgleich 10.10.2026 – alpha.63

Geprüfter main: [88e85a2](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/88e85a223024ce69c849e4c67f288f2235504fa0), veröffentlichte und laut Startlog am 10.10. um 04:41:32 MESZ laufende **0.17.0-alpha.63** ([Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.63)). Produktive Regelung freigegeben, aktuelles Control.Valid=true. Dieser Snapshot ersetzt keine Ereignishistorie. Letzter belegter Score **69/100**, keine zusätzlichen Punkte durch Veröffentlichung/Installation. Historische Befunde unten bleiben datiert erhalten.

- [x] Parallele Mindestladung und priorisierte Mehrleistung softwareseitig umgesetzt; reale Teilnachweise vom 09.10. siehe [#123](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/123).
- [x] Peer-Abschluss, begonnene Mindeststartsequenz und Mindest-SoC-Netzladeende ohne unnötigen Nachlauf korrigiert (alpha.55/.56/.59). Ein reguläres EQV-Mindest-SoC-Ende wurde im verfügbaren Log am 10.10. um 01:55:24 gemeldet; dies allein beweist keine vollständige elektrische Stoppkette.
- [x] Parallele Stromzuteilung anhand gemessener Antwort und aktuellem Erhöhungsbudget sowie sicherer EHZ-Nullabschluss softwareseitig korrigiert ([alpha.60](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.60)).
- [ ] Vergleichbare reale Regelruhe nach diesen Korrekturen, vollständige Befehl-/ACK-/Fahrzeugantwortketten, priorisierte Mehrleistung und EHZ-Aufteilung nachweisen.
- [ ] Hausanschluss-/§14a-/Gerätegrenzen unter Last und vollständige Rückgabe prüfen; Phasenabnahme in #8.

Die alten Forderungen „nie gleichzeitig“ gelten nicht mehr allgemein. Bewusste Parallel-Mindestladung und Fahrzeugübergabe sind getrennt zu prüfen; bei einer echten Übergabe bleiben unabhängiges AUS und elektrische Ruhe maßgeblich. Issue bleibt offen.

---

<!-- status-review-2026-10-08-alpha54 -->
## Standabgleich 08.10.2026 – parallele Mindestladung und reale Teilnachweise

Geprüfter aktueller Stand: **0.17.0-alpha.54**, main [a9e99b7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/a9e99b782d4421bc3e69d5ef474f7dad879d8ca3), PR [#117](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/117), [GitHub-Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.54). Installationsobjekt und Laufzeitanzeige stimmen überein. Aktuell EMS-Livebetrieb: Ausgangsfreigabe EIN, Control.Valid=true; EQV/EQE-Phasenführung jeweils `ems`.

**Aktueller Abnahmevertrag:** Seit alpha.53 / [PR #115](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/115) können mehrere berechtigte Fahrzeuge unter Mindest-SoC mit mindestens 6 A / 1P laden; Mehrleistung wird nach Priorität verteilt, gemeinsame Schutz-/Budgetgrenzen bleiben vorrangig. Die untenstehenden alten Forderungen „nie gleichzeitig“/„keine zweite Wallbox“ sind damit **kein allgemein gültiges aktuelles Abnahmekriterium**. Eine echte Donor-/Empfängerübergabe und beabsichtigte parallele Mindestladung sind getrennte Fälle.

- [x] **Reale Teilübergabe EQV→Mii am 08.10.16:03**: echtes AUS-ACK, anschließend frische 0-W-/0-A-Rückmeldung, Freigabe des Ausgangsbesitzes und erst danach Empfängerstart; Zeitfolge und Sequenzen in [#116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/116).
- [x] **Kurzer Parallel-Teilnachweis am Abend:** Mii/EQV mit 6 A / 1P, beide unter Mindest-SoC, Originalleistungen ungefähr 1,34 / 1,28 kW. Kein vollständiger Mehrfahrzeug-, Grenz- oder Dauertest.
- [x] Aktualisierte externe EMS-Phasenfolgerfassung um 22:19 aktiv bestätigt; Master-/ACK-Prüfung enthalten. Echte Wechsel-/Rückgabeabnahme siehe #8.
- [ ] Alle Fahrzeuge einzeln und gemeinsam über vollständige Start-, Lade-, Ziel-SoC-/Absteck-, Prioritäts- und Stoppfälle abnehmen.
- [ ] Mehrleistung nach Priorität, Restüberschuss, reale EHZ-Aufteilung und Verhalten bei wechselnder PV nachweisen.
- [ ] Hausanschluss-/§14a-/Gerätegrenzen unter Last sowie vollständige Rückgabe testen.

Softwareprüfungen: [vollständiger Node-20-CI-Lauf](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/37834649298), **1.292 Tests bestanden**. Reale Abnahme bleibt separat; Score **66/100**. Alte Timer-/Versionsangaben sind historische Ausgangsstände, für jeden neuen Betriebsfall tatsächliche Einstellungen neu lesen. Issue bleibt offen.

---

## Standabgleich 07.10.2026 – Software und Betriebsabnahme

Geprüfter Softwarestand am **07.10.2026**: **0.17.0-alpha.41**, [main `7b3d32e`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/7b3d32e48c106a0b96bc2005cf25566e306e674e). Softwareumsetzung und reale Betriebsabnahme werden getrennt bewertet.

### Teilbefunde aus dem begleiteten Livebetrieb am 07.10.
- [x] EQV: realer dreiphasiger Ladestart beobachtet; um 11:10 L1/L2/L3 etwa 9,1/9,0/9,1 A, Leistung 6,42 kW. Um 11:13:39 Befehl und Rückmeldung 10 A, gemessene Leistung 7,06 kW, ResponseState=confirmed.
- [x] EHZ: normale Leistungssteigerung nach alpha.39 beobachtet (4 → 5 → 6 kW); Soll-Ist-Abweichung bleibt separat sichtbar.

Diese Haken bestätigen nur die genannten Beobachtungen. Start nach Installation bereits bestätigter 3P ist kein realer 1P→3P-Wechsel. Die von Carsten anschließend gemeldete Verteilung 6.000/500 W ist ein Nutzerbefund, kein separat SQL-geprüfter Abnahmetest.

**Offen:** vollständiger Einzeltest aller drei Wallboxen, Prioritäts-/Fahrzeugübergaben mit bestätigtem AUS und elektrischer Ruhe, Kombination bei wechselnder PV, ausgelöste Schutzgrenzen und sichere Rückgabe. Die ursprünglichen festen 120-s-Angaben sind historischer Ausgangsstand; aktuelle tatsächlich konfigurierte Timer sind je Test erneut zu lesen. Das Issue bleibt offen.

---

Teil der zentralen Roadmap #36, **AP1**.

## Ausgangspunkt

Aktueller Softwarestand für die praktische Abnahme:

- Version **0.16.0-alpha.1**
- Commit `cfee89b8c9cf0e22be105422af7cd368b8a6edfc`
- 86 erfolgreiche Verhaltenstests
- WB0 = VW e-Up/Mii
- WB1 = Mercedes EQV
- WB2 = Mercedes EQE

## Softwareseitig vorbereitet

- [x] Alle drei Wallboxen können vom Adapter produktiv angesteuert werden.
- [x] Wallboxen laufen ausschließlich nacheinander, nie gleichzeitig.
- [x] Der EHZ kann parallel als schneller, stufenloser NVP-Feinregler arbeiten.
- [x] Ein zentraler Verteiler verhindert konkurrierende NVP-Regler.
- [x] 120-s-Startverzögerung für eine neue Wallbox; der EHZ darf den Überschuss währenddessen weiter nutzen.
- [x] 600-s-Mindestlaufzeit für eine gestartete Wallbox.
- [x] Vor dem Wechsel auf eine andere Wallbox wird bestätigtes AUS verlangt.
- [x] Eine nach Adapterstart bereits laufende Wallbox kann sicher übernommen werden.
- [x] Schutzgrenzen, §14a/LPC, SoC, Priorität und Pflichtladung bleiben vorrangig berücksichtigt.
- [x] Reale Phasenumschaltung bleibt außerhalb des Adapters.

## Noch praktisch abzunehmen

### 1. Übergabe und Rückfall

- [ ] Vollständige Liste der konkurrierenden Skripte festhalten, die vor der EMS-Übernahme ausgeschaltet werden.
- [ ] Mess-, SoC-, Schutz- und externe Phasenskripte kennzeichnen, die weiterlaufen müssen.
- [ ] Rückgabe an den bisherigen Skriptbetrieb für EHZ und jede Wallbox einmal vollständig durchführen.
- [ ] Prüfen, dass zu jedem Zeitpunkt höchstens ein Regler auf den jeweiligen Aktor schreibt.

### 2. Einzeltest jeder Wallbox

- [ ] WB0 einzeln testen: Zuordnung, Rückmeldungen, Stromgrenzen, Fahrzeug ab-/anstecken, SoC und Stop.
- [ ] WB1 einzeln testen: Zuordnung, Rückmeldungen, Stromgrenzen, Fahrzeug ab-/anstecken, SoC und Stop.
- [ ] WB2 einzeln testen: Zuordnung, Rückmeldungen, Stromgrenzen, Fahrzeug ab-/anstecken, SoC und Stop.
- [ ] Unbekannte, veraltete oder nicht bestätigte Rückmeldungen führen zu Reduktion oder sicherem Stop.
- [ ] Hausanschluss- und §14a-/LPC-Grenzen werden auch bei Mindeststrom/Pflichtladung nicht überschritten.

### 3. Mehr-Wallbox-Sequenz

- [x] Prioritätswechsel WB1/EQV → WB2/EQE am 28.10.2026 um13:49 MEZ mit vollständiger AUS-/Null-/Reserve-/EIN-/Aufnahmekette real nachgewiesen; Beleg oben.
- [ ] Verbleibende Prioritätsrichtungen und Einbeziehung WB0/Mii prüfen.
- [x] Bestätigtes AUS und elektrische Ruhe vor Übergabe an die nächste Wallbox im natürlichen EQV→EQE-Fall vom 28.10.2026 nachgewiesen; Beleg oben, weitere Fahrzeuge/Gegenfälle bleiben getrennt offen.
- [ ] 600-s-Mindestlaufzeit und anschließende Abschaltung bei fehlender Leistung beobachten.
- [ ] Adapterneustart mit bereits laufender Wallbox testen.
- [ ] Keine zweite Wallbox darf während Übergabe, Startverzögerung oder Fehlerfall freigegeben werden.

### 4. Kombination mit EHZ

- [x] EHZ-Aufnahme während der Startverzögerung und anschließende Übergabe an EQE im natürlichen Fall27.10. gegen10:02 real teilabgenommen (#274/R2); tatsächlicher Falltimer statt historischer120-s-Annahme. Weitere Gegenfälle bleiben offen.
- [ ] Wallbox übernimmt grobe Ampere-Stufen; der EHZ gleicht Rundungsreste und schnelle NVP-Abweichungen aus.
- [ ] Keine dauerhafte Fehlaufteilung wie gleichzeitig ca. 1,4 kW Wallbox und 3,7 kW EHZ bei eigentlich möglicher höherer Wallboxstufe.
- [ ] Verhalten bei Wolken, Lastsprüngen, sinkendem Überschuss und ausgeschöpften Gerätegrenzen prüfen.
- [ ] EHZ-Temperaturgrenzen und Freigaben bleiben wirksam.

## Abnahme

Dieses Issue wird geschlossen, wenn alle drei Wallboxen einzeln, die sequentielle Auswahl und der gemeinsame Betrieb mit dem EHZ real getestet wurden und die sichere Rückgabe an die bisherigen Skripte dokumentiert ist.

Externe Phasenumschaltung wird separat in #8 behandelt. Batteriearbeiten gehören zu #25.

<!-- alpha146-acknowledged-telemetry-hold -->
## 25.10.2026 – Mii-Telemetriestopp nach bestaetigtem Stromschritt / alpha.146

**Befund:** WB0/Mii stoppte unter alpha.145 am 25.10.2026 um **14:02:08 MEZ** wegen `Wallbox-Fehlerstatus: veraltet (Alter32 s; maximal30 s)`. Letzter Fehlerwert0, ACKtrue/q0; Leistung1,76 kW und L1=7,9 A ebenfalls rund32 s alt. Direkte ioBroker-Lesung lieferte dieselben alten Quellen. Der bereits bestaetigte9-A-Befehl wartete noch auf elektrische Aufnahme. Damit war die vorhandene Kommunikationsbruecke (`ResponseState=confirmed`) nicht zustaendig. AUS wurde anschliessend bestaetigt (StopConfirmedAt14:02:23); das spaetere fehlende Startbudget war nicht der Stoppausloeser. Keine belegte WLAN-/Adapterursache und kein neu gemeldeter Geraetefehler.

**Korrektur:** [PR#257](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/257), alpha.146, erweitert die no-write-Kommunikationsbruecke auf den exakt rechtzeitig bestaetigten Stromschritt einer bereits laufenden Ladung, auch bei begrenzter/offener elektrischer Antwort. Originale Quellenzeiten, ACK-/Antwortfrist und konservative volle Reserve bleiben erhalten; keine Erhoehung, kein Phasenwechsel und keine erfundene elektrische Bestaetigung. Gewoehnlicher Haushaltsbezug >100 W allein loest im Kommunikations-Warnzustand kein AUS mehr aus; Netzenergie waehrend der Luecke ist dadurch moeglich. Frischer SMA-/Phasenschutz, aktive Netzbetreibergrenzen, echte Geraetefehler, Benutzer/Master-AUS und Ziel-SoC bleiben wirksam. Unbestaetigte Starts/Befehle und offene Phasenwechsel erhalten keine neue Ausnahme.

**Softwarepruefung:** 3.069/3.069 Tests,23 neue Faelle; vier gezielte Regressionen scheitern mit dem unveraenderten alpha.145-Pfad. Realer Parallelverteiler mit/ohne EHZ,1P/3P, lange Luecke, Erholung ohne nachgeholtes AUS und negative Schutz-/ACK-/Freigabefaelle. Paket, installiertes Tarball-Artefakt und bestehende Aequivalenzpruefungen bestanden. CI-/Merge-/Release-Nachweis siehe PR und Release. [Releasehinweise](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/8fff408c2059d7496699ef6719ebb95b2d3fe54b/docs/release-0.17.0-alpha.146.md).

**Installation/reale Abnahme offen:** Keine Installation, Anlagenbefehle oder Live-Konfigurationsaenderung durch diesen Auftrag. Nach tatsaechlicher Installation ausschliesslich einen natuerlichen neuen Fall auf Warnung ohne altersbedingtes AUS, erhaltene Reserve und originale Erholung pruefen. Reale Schutz-/Freigabestopps weiterhin ueber AUS-ACK und elektrische Ruhe nachvollziehen. Alte Quellenluecke wird dadurch nicht ursachengeloest. Keine erwarteten Scorepunkte; Issue bleibt offen.

**Auslieferung belegt:** PR#257 nach sechs gruenen CI-Pruefungen uebernommen; main/Tag `d0df1411e98722b3ce8317b7feb393812bfe9602`, getesteter Baum `3ae71878d47de15d7d4103e0d58a07eab8abd7d0`. [Release alpha.146](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.146) veroeffentlicht am25.10.2026 um15:34:30 MEZ; [Releaseworkflow](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40202718659) erfolgreich. Letzte lesende Laufzeitpruefung weiterhin alpha.145/alive; Installation von146 nicht erfolgt/nicht belegt.


</details>


## Zugehörige Kommentare zum Archivzeitpunkt

### Kommentar 5739642319 – 2026-09-19T05:30:02Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-5739642319)

Ergänzung für die nächste Version nach Abstimmung:

- Es darf nur **einen gemeinsamen NVP-Regler** für Wallbox und Trinkwasser-EHZ geben; keine zwei unabhängig auf 0 W regelnden Geräte.
- Die Wallbox übernimmt die grobe Leistungsstufe in ganzen Ampere. Der EHZ übernimmt ohne Batterie die schnelle, stufenlose Feinregelung auf den NVP-Sollwert.
- Bei einer Wallbox-Stufenänderung wird die EHZ-Leistung gegenläufig angepasst, damit die Gesamtleistung möglichst sprungfrei bleibt.
- Die bisherige Aufteilung wird übernommen: Aktivierung oberhalb 4.000 W, Rückschaltung unterhalb 3.000 W, dazwischen Zustands-Hysterese; Standardverteilung 50/50. Nicht nutzbare Anteile werden an das jeweils andere Gerät weitergegeben.
- Für die Laufzeitfreigabe wird **kein neues Objekt erzeugt**. Verwendet wird das bereits vorhandene Objekt `javascript.0.ehz.aufteilen` („Aufteilen mit Auto“, Typ boolean).
- Die Objekt-ID wird in der Admin-Oberfläche als konfigurierbarer Eingang angeboten und standardmäßig mit `javascript.0.ehz.aufteilen` vorbelegt. Boolean sowie die vorhandenen Werte 0/1 müssen eindeutig ausgewertet werden; ungültige oder fehlende Werte deaktivieren die gemeinsame Verteilung sicher.
- Das externe Objekt ist ein Eingang und wird vom Adapter nicht beschrieben.
- Die gerätespezifischen Produktionsfreigaben und die globale Schreibfreigabe bleiben zusätzlich zwingend erforderlich. Das Aufteilungsobjekt allein darf keinen Ausgang aktivieren.
- Beim Ausschalten muss die gemeinsame Regelung sicher beendet werden, ohne einen zweiten Schreiber zu erzeugen; Übergang in Einzelbetrieb beziehungsweise Stopp wird durch Verhaltenstests abgesichert.
- Später kann die Batterie die schnelle Feinregelung übernehmen; bis dahin bleibt der EHZ Feinregler.

Diese Ergänzung verändert aktuell keine laufende Anlage.

### Kommentar 5740071873 – 2026-09-19T06:57:42Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-5740071873)

Softwarestand für die Inbetriebnahme ist mit Version 0.14.0 vorbereitet: https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/16b4ffd3173155c16ed56f31250392ed445dcc70

Neu vorbereitet:

- Ein zentraler Verteiler statt zweier konkurrierender NVP-Nullregler.
- Wallbox als grobe Stufe in ganzen Ampere; Trinkwasser-EHZ als stufenloser NVP-Feinregler.
- Konfigurierbare 50/50-Aufteilung mit 4/3-kW-Hysterese einphasig und 9/8-kW-Hysterese dreiphasig.
- Nicht nutzbare Anteile und Ampere-Rundungsreste gehen an den EHZ.
- Vor Start oder Erhöhung der Wallbox muss der EHZ seinen abgesenkten Sollwert tatsächlich erreicht haben – auch wenn dessen Ziel 0 W ist.
- Das vorhandene, in der Admin-Oberfläche frei zuordenbare Objekt `javascript.0.ehz.aufteilen` ist der nur gelesene Laufzeitschalter.
- Der Kombinationsbetrieb benötigt zusätzlich globale Schreibfreigabe, genau eine Wallbox, deren Einzeltest-Arming, EHZ-Freigabe und das standardmäßig ausgeschaltete Kombinations-Arming.
- Die vollständigen Wallbox-Schreiber und die sichere Rückgabereihenfolge sind im README dokumentiert.

Prüfung: 50 Verhaltenstests und GitHub Actions erfolgreich: https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/35427944040

Dieses Issue bleibt für die praktische Abnahme offen. Reihenfolge bleibt: zuerst eine Wallbox allein mit 6-A-Grenze testen und sicher zurückgeben, danach erst den gemeinsamen EHZ-/Wallbox-Test. An der laufenden Anlage und an aktiven Skripten wurde durch dieses Release nichts umgeschaltet.

Nicht für den ersten Test benötigte technische Folgearbeiten sind in #8 getrennt dokumentiert.

### Kommentar 6074307057 – 2026-10-09T04:32:06Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-6074307057)

Nachtrag 09.10.2026, Morgenprüfung / Umsetzung: Die echte EQV-Pause gegen 03:01 Uhr lag außerhalb des Berichtsfensters vom 08.10. und wird nicht nachträglich diesem Tagesbefund zugerechnet.

Unter alpha.54 verlor der weiterhin unter Mindest-SoC liegende EQV sein Budget, während der Mii nach erreichtem Mindest-SoC noch 1.380 W reservierte. Vollständig rekonstruierter Ereignisausschnitt: Session 1791489026293, Sequenzen 91676–92041 ohne interne Sequenzlücke. Reale AUS-Befehle an beide Fahrzeuge 03:01:06, ACK kurz danach; EQV EIN 03:01:28, wieder rund 1,3 kW um 03:01:48. Gemessene interne Pause rund 30 s. Quellen frisch, kein SMA-Altersfehler als Stoppursache.

Korrektur veröffentlicht als **0.17.0-alpha.55**: PR #118 https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/118 ; main-Commit 951b778bd0aaf26f5a998fc3a88241f310bac39d; Release https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.55 . Nur eine bereits bestätigte aktive 1P-Mindestladung erhält einen weichen Mindestdeckel. Harte gemeinsame Budgets, reale Peer-/Heizstabreservierungen, Quellen- und Phasenschutz bleiben wirksam; neue Starts erhalten keine Ausnahme.

Sechs neue Regressionen; vollständige Node-20-GitHub-CI und erneute main-Releaseprüfung jeweils **1.298 bestanden / 0 Fehler / 0 übersprungen**, Paketprüfung bestanden. Lokaler vollständiger Node-24.19.0-Lauf ebenfalls bestanden. Die beiden positiven Fortsetzungsfälle scheitern am unveränderten alpha.54-Code.

Keine Installation oder Anlagenänderung ausgeführt. Die Wirkung beim nächsten realen Mehrfahrzeugereignis bleibt abzunehmen: auslaufendes Fahrzeug Ziel 0 plus tatsächlicher Timer; bereits laufender Peer unter Mindest-SoC behält Freigabe und Mindestladung, wenn echte harte Kapazität ausreicht. Softwarefortschritt allein begründet keine neuen Scorepunkte. Prüfkriterien: https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/951b778bd0aaf26f5a998fc3a88241f310bac39d/docs/parallel-minimum-retention.md .

### Kommentar 6074998822 – 2026-10-09T05:36:23Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-6074998822)

### Entwicklungsnachtrag 09.10.2026 – alpha.56 veröffentlicht

Carstens Vorgabe aus der Nachtanalyse ist umgesetzt: Eine **beobachtete Netz-Mindestladung endet ohne Nachlauf**, sobald Mindest-SoC erreicht ist und kein weiteres nutzbares Überschuss-/aktuelles Preisbudget oder anderer Pflichtladebedarf besteht. Bei belegter PV-Fortsetzung über Mindest-SoC bleiben spätere Dellen normal verzögert, z. B. 600 s.

- PR [#119](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/119) ist nach vollständiger CI in main übernommen: [5604e078](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/5604e07884b4657c120e0779e7a26bbb581760a6).
- [0.17.0-alpha.56](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.56) mit passendem Tag/Release veröffentlicht. Lokale Suite und Node-20.20.2-CI jeweils **1325 bestanden / 0 Fehler / 0 übersprungen**; der übernommene main wurde vor Veröffentlichung erneut vollständig getestet.
- Im Parallelbudget ist der verfügbare Überschussanteil `pvBudgetW` getrennt von Pflichtnetzladung ausgewiesen. Eine vor der SoC-Kante berechnete Zuteilung wird erst nach dem nächsten normalen Budgettakt beurteilt. Quellenqualität, statische Mindestwerte, Neustart/Abstecken und spätere normale PV-Timer sind regressionsgeprüft.
- Weitere Mindestlader und die alpha.55-Korrektur bleiben erhalten. AUS-Befehl, ACK und elektrische Ruhe bleiben getrennt; die alte Leistung bleibt bis zur Bestätigung reserviert.

**Reale Abnahme offen:** Die belegten Nacht-Ereignisse stammen weiterhin aus alpha.54; sie beweisen keine Installation oder erfolgreiche Betriebsabnahme von alpha.56. Keine Installation oder Anlagen-/SQL-/Skriptänderung durchgeführt. Letzter belegter Score weiterhin **66/100, Änderung durch diese Veröffentlichung 0**.

Nächste SQL-Prüfung: Mindestwert-Kante + aktuelle Budgetzuordnung → eindeutiger Mindestabschluss-Stopp ohne Stopptimer → AUS-ACK → elektrische Ruhe; andere unterminimale Fahrzeuge ohne zusätzliche Pause. Bei PV-Fortsetzung keine AUS-Kante und bei einer späteren Delle der wirklich konfigurierte normale Timer.
[Ausführlicher Vertrag und Regressionen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/5604e07884b4657c120e0779e7a26bbb581760a6/docs/minimum-grid-charge-end.md).

### Kommentar 6094636163 – 2026-10-10T06:25:55Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-6094636163)

### Lesender Nachtrag 10.10.2026, 08:22–08:24 MESZ: Priorität im Parallelmodus verzögert Mii → EQV

Installiert alpha.63; beide Fahrzeuge angeschlossen/freigegeben, oberhalb bzw. auf Mindest-SoC (Mii 49,3 % / min 40 % / Ziel 50 %; EQV 95 % / min 95 % / Ziel 100 %). Externe Priorität wählt WB1/EQV korrekt, 1P ist bestätigt. Trotzdem keine direkte Übergabe: Mii lädt gemessen etwa 1,31 kW mit 6 A, EQV 0 W / allow=0. Mii erhält ein Nullziel, hält den Ausgang aber wegen Mindestlaufzeit/Leistungsdellentimer weiter. Um 08:22 waren etwa 362 s Mindestlaufzeit und 439 s Abschaltwartezeit übrig; diese laufen gleichzeitig, nicht nacheinander.

Zusammengehöriger aktueller Allokationssnapshot timestamp=1791613319013: Gesamtbudget 2729 W; Mii reserviert 1380 W; EQV safetyBudgetW=1349, targetA=0, `safety-cap-below-minimum`, `vehicleHandoff.reason=no-vehicle-handoff`. 31 W fehlen zum 6-A-Minimum1380 W; mit300-W-Startreserve fehlen331 W zum1680-W-Neustart. Folgesnapshot1791613427011: Budget2896W, nach Mii-Reserve1516W, weiter unter Startschwelle1680W. Keine laufende neue EQV-Startwartezeit und kein fehlender1P-ACK sind dafür belegt.

Codeabgleich auf geprüftem main1070cfd/alpha.63: `selectRealtimeWallboxes()` (lib/engine/realtime.js) löscht im Parallelzweig `wallboxManualHandoff` und `wallboxVehicleHandoff`; Priorität sortiert damit nur die Zuteilung. `updateParallelSlowTargets()` behält reale Fremdreservierungen. Der Mii-Nullauftrag wird im produktiven Output als Budgetmangel mit normalen Timern behandelt. Die unmittelbare Auswahlübergabe gilt bisher für Sequenzbetrieb. Der gewünschte Prioritätswechsel im Parallelmodus ist damit noch nicht umgesetzt.

P1-Prüf-/Umsetzungsziel: ausdrücklich qualifizierte Prioritätsübergabe auch im Parallelmodus, sofern keine verpflichtende Mindestladung des bisherigen Fahrzeugs geschützt werden muss. Donor kontrolliert stoppen; Reservierung erst nach frischem AUS-ACK und elektrischer Ruhe freigeben; Empfänger auf bestätigter realer Phase und frischem Budget ohne erneute vollständige Startwartezeit übernehmen. Keine Reservierung vorzeitig löschen, keine Schutz-/Antwortfrist lockern. Regression: zwei Fahrzeuge oberhalb Mindest-SoC, Prioritätswechsel bei Budget nur für eines; Gegenfälle beide unterMinimum, fehlendesACK, Reststrom, unbestätigtePhase und echtesPV-Defizit. Reale Übergabe anschließend separat beobachten.

Die Recorderkorrektur [PR#129](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/129) / alpha.64 enthält keine Regleränderung und behebt diesen Übergabepunkt noch nicht. Keine Anlage verändert, keine vollständige historische Ereigniskette behauptet, keine Scorepunkte vergeben.

### Kommentar 6094657513 – 2026-10-10T06:28:52Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-6094657513)

Ergänzung08:26MESZ: `ParallelDistributionReleased=false` und `ParallelDistributionActive=false` bestätigen AufteilungAUS. EHZ hat separate Produktiv-/Temperaturfreigabe, `MustHeat=false`, Soll1500W und gemessen1415W. Im Code bekommt EHZ zunächst0W, Fahrzeuge den Pool; nach sichererFahrzeugzuteilung weist `updateParallelSlowTargets()` Restleistung bedingungsunabhängig demHeizstab zu. Das ist der dokumentierte Restleistungsregler, keine aktive50/50Verteilung. Bei Mii-Reserve1380W und EQV-Budget1502W (<1680W Startschwelle) verbleiben rund1500W dafür. Die Ursache des unerwünschten langen EQV-Wartens bleibt die oben beschriebene fehlende Prioritätsübergabe; daraus ist kein zusätzlicher EHZ-Freigabefehler belegt.

### Kommentar 6094843778 – 2026-10-10T06:52:54Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-6094843778)

Die am 10.10.2026 belegte blockierte Prioritätsübergabe im Parallelmodus ist als Codekorrektur in [PR #130](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/130) umgesetzt und nach erfolgreicher Node-20-CI in main übernommen: `c172fdac03ddceb3b813035784329246a0c83f4f`. [0.17.0-alpha.65](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.65) ist als Tag/GitHub-Prerelease veröffentlicht.

Eine gültige explizite Priorität beendet eine optionale Geberladung kontrolliert, wenn deren Reserve den Empfängerstart verhindert. Die gewöhnlichen Mindestlauf-/PV-Mangel-Nachlaufzeiten halten diese angeforderte Übergabe nicht mehr auf. AUS-ACK und nachfolgend bestätigte elektrische Ruhe bleiben vor der Budgetfreigabe verbindlich; geschützte Mindestladungen anderer Fahrzeuge bleiben bestehen. Eine in der Sitzung real beobachtete Ladung kann ihre Startqualifikation übertragen. Nach Neustart liefert ein nur übernommener laufender Ausgang keine solche Qualifikation. Ein erforderlicher Phasenwechsel vor Start benötigt seine unabhängige Bestätigung.

Tests: 1511/1511 lokal und vollständige Node-20-GitHub-CI bestanden, zwölf neue integrierte Regressionen; Paketprüfung und Packkontrolle bestanden. Die Regressionen verwenden eine generische WB2-Testanlage, keine beobachtete reale EQV-Abnahme der neuen Version. Fehlendes/verspätetes AUS-ACK, Reststrom, ungültige Nullwerte, Budgetverlust, neue Priorität, Neustart und Phasenvorbereitung sind abgedeckt.

Der EHZ darf weiterhin Restleistung übernehmen, auch wenn 50/50 AUS ist; unbestätigte EHZ-Reserve wird nicht gelöscht. Keine produktive Installation oder ioBroker-/SQL-/Skript-/Aktorenänderung durchgeführt. Issue bleibt offen: Nach manueller Installation die reale EQV-Übergabekette (Priorität → Geber AUS/ACK → gültige elektrische Ruhe → Empfängerphase/6-A-ACK → ON/Leistungsantwort) einschließlich vollständiger Quellenzeiten prüfen. Codekorrektur und Veröffentlichung begründen allein keine Betriebsabnahme oder Scorepunkte.

### Kommentar 6095372275 – 2026-10-10T07:57:24Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-6095372275)

## Mii-Anstecken am 10.10.2026 – alpha.66 veröffentlicht

Bei **installiertem alpha.65** lud der Mii trotz Benutzerfreigabe AUS und EMS-Ziel 0 kurz real: 09:39:40 1,32 kW / L1 5,9 A; EMS-AUS 09:39:42.145, unabhängiges go-e-AUS-ACK 09:39:42.302; erste aufgezeichnete 0-A-/0-W-Antwort 09:39:55.389/.411, Besitzfreigabe 09:39:56. Zeiten Europe/Berlin; ca. 15-s-Pollauflösung belegt keine exakte physische Dauer.

Bereits vor dem Anstecken war `allow_charging=1` bei leerer Mii-Box aufgezeichnet. Die ältere Freigabe wurde im Parallelbetrieb durch die bisherige sequenzielle Leerlaufausnahme toleriert. Der ursprüngliche EIN-Urheber bleibt unbekannt; im vollständig abgefragten Ereignisfenster 09:38:30–09:40:10 wurde kein EMS-EIN für Mii und kein EQV-AUS gefunden. 978 eindeutige Records ohne Sequenzlücke; 723 ab erster Vollbasis rekonstruiert, frühere Deltas ohne Basis nicht als vollständige Zustandskette behauptet. Details/Reproduktionsnachweis in [PR #131](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/131).

**Softwarekorrektur:** Die Leerlaufausnahme gilt ausschließlich im sequenziellen Betrieb. Im freigegebenen produktiven Parallelbetrieb wird die fremde Peer-Freigabe kontrolliert AUS gesetzt, auch ohne Auto. Ein etabliertes anderes Fahrzeug bleibt erhalten; Stoppbesitz und Lastreserve bleiben bis frischem AUS-ACK plus elektrischer Ruhe geschützt. Keine zusätzlichen EIN-Befehle oder Timeränderungen.

[0.17.0-alpha.66](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.66) auf **main `66ffc56b4310010382afe2b71a37a88a70d88577`**, Tag/Release gegen denselben Commit geprüft. [Node-20-Release-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/38036091567) erfolgreich; **1.522/1.522 Tests**, Paketprüfung und pack-Trockenlauf bestanden. 11 neue Tick-Regressionen einschließlich WB0/WB2-Reihenfolge, EQV-Laufzeiterhalt, ACK-/Ruhe-/Reservierungsfolge, fehlendem ACK/Retry und Schreibgrenzen.

**Betriebsabnahme offen:** alpha.66 wurde durch diesen Auftrag nicht in ioBroker installiert. Nach manueller Installation getrennt nachweisen: ungenutzte WB schon vor Anstecken unabhängig AUS; bei Benutzer AUS/Nullbudget kein unbeauftragtes EIN/keine Ladeleistung beim Anstecken; etablierter EQV ohne zusätzlichen AUS-Auftrag; notwendige AUS-Kette vollständig. Bestehende Phasen-, Grenz- und Mehrfahrzeugabnahmen bleiben offen. Letzter belegter Score 69/100, keine zusätzlichen Punkte allein durch Tests/Release. Keine Anlagen-, Skript-, SQL- oder Konfigurationsänderung, Issue bleibt offen.

### Kommentar 6096160123 – 2026-10-10T09:33:00Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7#issuecomment-6096160123)

## Alpha.67: Ziel-SoC-Übergabe und belegter EQE-Quellenfehler

Die Korrektur ist mit [PR #132](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/132) auf main übernommen und als [0.17.0-alpha.67](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.67) veröffentlicht. Geprüfter main-/Tag-Commit: `c761cd9fc1f5f723bbf5cb61ad0c270295faa313`. Manifest- und Laufzeitversionen sind konsistent. Die produktive Anlage wurde nicht verändert oder automatisch aktualisiert.

### Belegte Ereignisse am 10.10.2026 (Europe/Berlin), zuvor alpha.66

| Ereignis | Beleg | Einordnung |
|---|---|---|
| EQV erreicht Ziel-SoC → EQE wartet erneut | Ziel-SoC 100 % um 10:20:19.726; Ziel-SoC-Stopp 10:20:20.015; AUS-ACK 10:20:20.383; Ausgangsabschaltung abgeschlossen 10:20:22.018. EQE beginnt um 10:20:23.010 erneut einen 300-s-Starttimer, Diagnoseframe 2368 um 10:20:23.274. | Die bisherige Parallelübergabe erfasste manuelle Prioritätswechsel, nicht das reguläre Ziel-SoC-Ende. Die nach Neustart übernommene EQV-Ladung hatte zudem keine neu beobachtete Startflanke. |
| EQE wird erneut ausgeschaltet | go-e-Rohleistung −0,01 kW um 10:46:29.623, ACK true/q0. Gemeinsame Zuteilung ungültig um 10:46:31.014; Frame 16642 um 10:46:31.361. AUS-Befehl 10:46:32.034, Frame 16650; AUS-ACK 10:46:32.188. | Der Ausgang akzeptierte die vorhandene −20-W-Leerlauftoleranz; die zentrale Budgetquellenprüfung verwarf denselben Rohwert. Die übrigen hierfür maßgeblichen Quellen waren frisch und gültig. Für diesen Stopp ist damit ein Adapterfehler belegt. |

Sitzung beider Ausschnitte: `1791620141729`. Die getrennten Rohfenster wurden vollständig in 2-s-Blöcken mit Limit 64 gelesen und dedupliziert: 392 Zeilen von 10:19:50–10:20:35 und 476 Zeilen von 10:45:45–10:46:36, jeweils ohne erreichtes Abfragelimit. Das ist ein Ereignisnachweis, kein vollständiger 24-h-Abruf.

### Änderung und Schutzgrenzen

- Automatische Ziel-SoC-Übergabe an das nächste berechtigte Fahrzeug. Ohne zweiten vollständigen Start-Countdown nur mit gültiger Ladequalifikation, anschließendem AUS-ACK und frischer elektrischer Ruhe des Spenders, tatsächlichem Startbudget und bestätigter Empfängerphase. Die Spenderleistung wird nicht vorzeitig freigegeben.
- Ein im aktuellen Prozess abgeschlossener Wiederübernahmenachweis wird separat erfasst und vom Regler unabhängig erneut geprüft. Zurückgehaltene Aktivflags, gespeicherte Marker oder ein Snapshot allein qualifizieren keinen verkürzten Start.
- Begrenzte Phasenvorbereitung erhält das logische Mindestbudget; ein passendes Schreibecho ist weiterhin keine Bestätigung und gestattet kein reales EIN.
- Nur die zentrale WB-Leistungsprüfung nutzt nun dieselbe vorhandene Leerlauftoleranz für Werte zwischen −20 und 0 W wie der Ausgang. Originale Rohwerte bleiben erhalten. Größere negative Werte sowie fehlende/unbestätigte, schlechte, alte oder unzulässig zukünftige Quellen bleiben gesperrt. SMA-/EHZ-Verträge bleiben unverändert. Begrenzte Quellenfehler und Übernahmebelege sind in den produktiven Records nachvollziehbar.

### Softwareprüfung und offene reale Abnahme

[Node-20-PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/38041362728) und [main-/Releaseprüfung](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/38041676579): 1.559/1.559 Tests bestanden; Paketprüfung und Release-Packprüfung erfolgreich. Die Regressionen umfassen den echten Ausgangstreiber mit synthetischen Rückmeldungen, verzögerten AUS-ACK und Fahrzeugreaktion, weiter reservierter Leistung, ungültigen Übernahme-/Quellenbelegen, −10/−20-W-Grenze und einer 60-s-Phasenschreibecho-Wartephase ohne reales EIN vor ACK.

Nach manueller Installation prüfen:
1. Tatsächliches Ziel-SoC-Ende: vorherige qualifizierte Ladung/aktuelle Übernahme, Empfängerauswahl und vollständige Spender-AUS-/ACK-/Ruhekette.
2. Gegebenenfalls Phasenanforderung → unabhängiger ACK → 6-A-Befehl/Strom-ACK → tatsächliche Fahrzeugantwort. Kein zweiter kompletter Countdown bei gültiger Übergabe; keine vorzeitige ON-Freigabe.
3. −10-W-Leerlaufwert bei ansonsten gültigen Quellen löst keine ungültige globale Zuteilung mehr aus. Ungültige Quellen müssen weiterhin sperren und in der Historie identifizierbar bleiben.

Letzter hier belegter Score: **69/100**. Diese Veröffentlichung begründet noch keine zusätzlichen realen Abnahmepunkte; der Betriebsnachweis für alpha.67 ist offen. Keine Issues geschlossen.

