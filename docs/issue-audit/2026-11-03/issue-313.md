# Issue #313 – [SQL 2026-11-01] EMS-Livebetrieb: Tagesauswertung

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/313. Letzte Issue-Änderung: 2026-11-01T20:28:01Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

Carsten, **Weiterbetrieb: im beobachteten Umfang vertretbar; Aufzeichnung deutlich beeinträchtigt.** Der untersuchte EQV-Budgetstopp ist normal erklärt. EHZ-Zuteilung und zwei weitere Ablaufketten bleiben offen. Ein aktuell unsicherer Ausgang ist nicht bestätigt; keine vollständige Schutzabnahme.

**Rahmen:** Beginn 01.11.2026,19:55:25; Deadline20:40:25. Referenz31.10.19:55:25–01.11.19:55:25, Europe/Berlin. Einmaliger Primärabruf `DailySummary_JSON`, schema1, Zustand19:55:15,291. Passend ist **current31.10.20:00–01.11.20:00**, beobachtet bis **19:55:15,132**, 9,868 s vor Referenzende. Noch zukünftige284,868 s bis20 Uhr sind keine vergangene Datenlücke. Previous30.10.20:00–31.10.20:00 geprüft; keine Grenzennachladung.

**Stand:** installiert common.version/installedVersion und laufende System.Version **alpha.186**. Jüngster Startlog13:59:23,090; Versionszustand13:57:41,104 vom vorherigen186-Start, nicht mit aktuellem Start gleichsetzen. Exakter installierter Commit unbekannt. [main49ce291](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/49ce2918c3d1625ce3a7e9a6c5db83278f04d3e0), Paketdateien186, heutige PR #309–312 geprüft. Letztes GitHub-Release weiterhin alpha.162 vom28.10.; Merge, Release, Installation und Wirksamkeit getrennt. Master/reale Ausgänge EIN, PRODUCTION, Daten gültig, Parallelbetrieb; WB0 feste1P, WB1/2 EMS-Phasenführung, EHZ Feinregler, sql.0; Batterie nicht eingerichtet.

**Wichtigste Befunde:**
- Erfasste Leistungsintegrale: Netzbezug **4,173 kWh**, Export **5,690 kWh**, PV **23,971 kWh**, BHKW separat **21,667 kWh**, EHZ elektrisch **2,789 kWh**; Mii9,843/EQV1,910/EQE5,294 kWh. Schätzungen, keine abrechnungsfähigen Zählerdifferenzen. Vermeidbare Einspeisung nicht belastbar quantifizierbar.
- **46.171 beobachtete Record-Verwerfungen und4 Schreibfehler** in der Kompaktbilanz, trotz über99,5% Energieabdeckung der vergangenen Zeit. Logs belegen Journalfüllung bis134.211.291/134.217.728 Bytes und Aufzeichnungspause. Kleine heutige Restqueues heilen die Detailverluste nicht.
- **EQV14:57:** Nullbudget, verbleibender Abschalt-Countdown51→0 s, AUS-Auftrag, unabhängiges ACK, elektrische Null und erst danach Besitz-/Reservefreigabe. Normaler beobachteter Budgetstopp, kein Timerfix.
- **EHZ10:44–10:46 unter184:** reale Aufnahme folgt positiven Sollwerten, dazwischen erneute Nullaufträge. Gleichzeitig3 kW Altreserve mit gesperrtem Nullnachweis „overlapping-write“. Zentraler Nullbudgetauslöser und erster Schreibkonflikt nicht vollständig erhalten; keine belegte pauschale Temperaturblockade oder gesicherte Fixursache.
- SQL-Leitfall#60 erneut auch unter186: **2.081,658 s** Transportwartezeit18:06:40–18:41:22, anschließend21 Originale bestätigt; Folgeanfrage mit SQL-Antwortfehler. Aktuell wieder frische exakte Bestätigung ohne Fence. Keine behobene DB-/Transportursache daraus ableiten. **Keine weitere Codeänderung begründet.**

**Prognosevergleich und Wetterhistorie:** **Noch kein vollständiger Ist-Vergleich verfügbar:** Evaluation.days leer, completeDays0, kein neuester abgeschlossener Vergleichstag. Paarweise MAE/RMSE und energyBiasKWh aller vier Kandidaten unbekannt; der1.11. läuft noch. Training4.905 Werte/52 Tage. Vollständige vorab gespeicherte96/96-Prognosen für1.11. und2.11. vorhanden. Für **2.11.00:00–3.11.00:00**, ausgegeben1.11.00:10:12,784: Median **24,199**, Lasso **26,861**, 50:50 **25,530**, Hybrid **26,861 kWh** – Vorhersagen, kein Gütenachweis. Produktion bleibt Median; zusätzliche Wettergrößen keine neuen Lasso-Eingänge, Temperatur-/Heizgradkoeffizienten0. Wetterarchiv letzter Stand **1.11.19:34:23**, Strahlung unbekannt; Anbieter-current keine lokale Messung. Raumhistorie12/12 Originalquellen mindestens90 Tage, Kind3 elektrisch; Metadatenstatus kein vollständiger Zustellnachweis.

**Vorläufiger Teilscore25/35≈71/100, bewertetes Gewicht35/100;65 unbekannt. Kein Gesamtscore.** Vergleichbar nur Aufzeichnung: heute15/25 statt gestern18/25, wesentlich wegen realer Detailverluste.

<details><summary>Bilanz, Quellenabdeckung und Retention</summary>

|Quelle|Positive Energie kWh|Export kWh|Abgedeckt s / hh:mm:ss|Vergangen unbekannt s / hh:mm:ss|
|---|---:|---:|---|---|
|grid|4.173|5.690|85737.982 / 23:48:57|377.150 / 00:06:17|
|pv|23.971|—|85752.999 / 23:49:12|362.133 / 00:06:02|
|bhkw|21.667|—|85752.999 / 23:49:12|362.133 / 00:06:02|
|wallbox0|9.843|—|85727.833 / 23:48:47|387.299 / 00:06:27|
|wallbox1|1.910|—|85713.037 / 23:48:33|402.095 / 00:06:42|
|wallbox2|5.294|—|85722.885 / 23:48:42|392.247 / 00:06:32|
|ehz|2.789|—|85752.999 / 23:49:12|362.133 / 00:06:02|

Noch zukünftige284,868 s (00:04:44) für jede Quelle separat; nicht in vergangene Lücken eingerechnet. hh:mm:ss abgerundet, Millisekunden in Sekundenangabe erhalten. Netz meanW−63,672 W und meanAbsoluteW414,120 W beschreiben unterschiedliche Größen; kein vorzeichenloses Einsparpotenzial daraus. EQE hat zusätzlich0,030 Wh negative Rohleistung im Integral, keine behauptete Stromerzeugung des Autos.

PV-Quelle javascript.0.PV.Eigenerzeugung ohne BHKW; BHKW separat und nicht nochmals zum SMA-NVP-Budget addiert. EHZ-Ist aus1074/1075/1076, write-only1000_Power ist Auftrag/Reset, keine elektrische Messung. Keine Nutzwärme- oder PV-Herkunftsquote aus den Aggregaten.

Energieabdeckung und Recorderintegrität sind getrennt: die eigenständige5-s-Kompaktbilanz kann weiter integrieren, während detaillierte Entscheidungsrecords fehlen. observedDropped46.171/writeErrors4/counterResets0 sind Tagesbeobachtungen, kein vollständiger Nachweis sämtlicher Verlustursachen oder aller unbestätigten Originale. Fünf Starts beobachtet; Neustarts nicht zusätzlich als Regelfehler bewertet.

eventCount1.744, eventOverflow1.735, protectedOverflow0; neun Events erhalten, davon sechs geschützte Stopps und zwei Recorderereignisse. protectedOverflow wäre Teil des Gesamtüberlaufs, nicht zusätzlich. investigation.overflow99 =49 Export+47 deviation+3 sampling-gap; overflowBeforeRetention0, keine Doppelzählung. Fehlende Episoden beweisen keine Ereignisfreiheit. protectionAssessment bleibt not-assessed, avoidableExportWh=null.

Nachtüberschuss erhält keinen eigenen Fall/Scoreabzug. Größerer Tagesexport vor gültiger Heizfreigabe oder bei belegtem Code5 ist kein Beweis zusätzlicher erlaubter Aufnahme. Bezug ohne bewiesene zeitgleiche Abregelmöglichkeit nicht per Such-SQL vertieft. Sampling-gaps08:17:50–08:21:50 (240,667 s) und11:04:25–11:04:58 (33,333 s) bleiben in Abdeckung; letztere mit185-Startlog11:04:36 abgeglichen. Für die frühere Lücke fehlt im begrenzten Logausschnitt der genaue Startbeleg; kein erfundener Neustart-/SQL-Verlustgrund.

Debug.SourcePowerHistory statuscomplete, sql.0/relog600 s und vier Originalobjekte frisch gelesen: changesOnly=true, changesRelogInterval600, changesMinDelta0, ignoreZero=false. Ein10-min-Abstand unveränderter Skalarwerte ist kein belegter Ausfall und gilt nicht pauschal für DecisionRecords.

</details>

<details><summary>Fallplan und Ergebnistabelle</summary>

|Fall / Ereigniszeit|Tatsächlich geprüfte Originalquelle/Fenster|Engste belegte Erklärung / fehlender Nachweis|Status|
|---|---|---|---|
|R1 · EQV01.11.14:57:02,067|DecisionRecord14:56:10–14:58:10;24 sequenzielle5-s-Seiten,492 Originale/491 rekonstruierbar; Log und186-Code|Budget0, Sollverteilung0 A bei noch laufenden6 A/1,26–1,28 kW. Historische Konfiguration Start300/Mindestlauf600/Abschaltverzögerung600 s. Beobachteter Restcountdown51→0, kein Mindestlauf mehr. AUS→ACK→Nullleistung→Besitz→Reserve in richtiger Folge. Beginn der gesamten600-s-Delle außerhalb des Fensters, keine vollständige600-s-Abnahme.|**normal erklärt**, reale Stopp-Teilabnahme.|
|R2 · EQV14:00:48,076|Kompaktereignis, Warnlog, aktuelle/historische186-Codezuordnung;5-s-Originalprobe14:00:45–14:00:50 vollständig leer|Meldung gemeinsame Zuteilung ungültig/abgelaufen während Historienaufbau13:59:42–14:02:49; dieser Kontext plausibel, aber nicht vollständige Kausal-/ACK-/Leistungskette. Volles Journal zeitnah belegt; leere Probe beweist weder allein Verlust noch gesamten Episodeninhalt.|**offen**; damalige Zuteilung samt Frische, Auftrag/ACK/Leistung/Reserve fehlen.|
|R3 · Mii→EQV13:35:54,070|Gespeicherter kontrollierter Prioritätsstopp und Warnlog; späterer R1-Frame enthält historisches StopConfirmedAt13:35:55,388|Ein gewünschter Übergabepfad ist protokolliert. Späterer Cache ist kein damaliges unabhängiges Geräte-ACK. Eigenständige Prioritätsänderung/Spenderfreigabe, elektrische Ruhe, Reservewechsel und Empfängerstart fehlen. Kein zusätzlicher SQL-Abruf in das bereits belegte Pufferproblem hinein.|**offen**, keine pauschale Übergabeabnahme.|
|R4 · Export/EHZ10:44:10,069–10:46:10,069|Genau suggestedFrom/To der Exportepisode;24 Seiten,500 Originale/462 rekonstruierbar, Version184. Ist1074/5/6, Soll1000, Plan/Temperatur/Reserve und aktueller Code|EHZ thermisch500 W Minimum/9 kW Maximum freigegeben, tatsächlich0→818/914→bis1.119 W. Soll0→800/900/1.000→0, dann600–1.100 W. Nullzweig folgt zentralem Control.Targets.MyPV_DHW_W≤0; erste Ursache dieser Zuteilung nicht vollständig enthalten.3 kW Altreserve bleibt wegen gesperrtem Nullnachweis „overlapping-write“. Dieser verhindert sichere Freigabe, ist aber nicht als alleinige Ursache sämtlicher Nullaufträge bewiesen. Koordinations-Alttext „kein gültiger48-h-Plan“ bei aktuellen Plan.Valid=true ist kein Beweis aktuell ungültiger Planung.|**offen**, enger Budget-/Schreibnachweisfall; keine quantifizierte vermeidbare Energie.|
|R5–R10|Kompaktbilanz, Logs, heutige Versionen/PRs und bekannte Ursachen abgeglichen|Code5 und Offline-Stopp sind die bereits durchPR311/312 bearbeiteten heutigen Ursachen, keine zweite Entwicklung. EQE-Abstecken, Nullleistung, normale Haushaltsbezüge und Nachtüberschuss nicht künstlich als neue Fehler ausgewählt.|**kein geeigneter neuer Fall**; unbekannte verdrängte Episoden bleiben unbekannt.|
|S1 · #60-Aufzeichnung, neue Tagesverluste|DailySummary, Prozesslogs11:39:17/13:57:51/13:59:52, RecordJournalStatus und Recorder-Code|Journal erreicht134.211.291 von134.217.728 Bytes, Aufnahme wird verweigert, erhaltene Originale nicht stillschweigend verdrängt. Aktueller Prozess830 dropped/1 writeError ist Teil des Tages46.171/4, nicht addieren. Zusammenhang Sperre→fehlende Bereinigung→Kapazitätsgrenze belegt; genaue verlorene Sequenzen/alle vier Fehlerdetails und physische Ausgangsursache fehlen.|**Fehler belegt** (reale Aufzeichnungslücken), bestehender#60-Folgefall, kein neuer Fix.|
|S2 · #60-SQL, auch nach186|Fehlercheckpoint/Delivery/Recovery und SQL-Logs, heutiger186-SQL-Code; kein separater SQL-Diagnosequery|18:06:40,733→18:41:22,404:2.081,658 s Transportwartezeit;21 Originale spät bestätigt. Nächste Anfrage18:41:23,096→18:42:31,812:68,690 s, lateOutcome sql-response-error,0 bestätigt. Aktuell wieder Originaltreffer. Keine isolierte DB-Ausführungszeit oder bewiesene Index-/Storageursache.|**Fehler belegt** (Frist-/Antwortfehler), bestehender#60-Folgefall; Ursache offen.|
|S3–S5|Externe Abrufe und Metadaten geprüft|49 empfangene externe Antworten,0 Fehler; R2 leer ist Abdeckungsgrenze, kein Abruffehler. Kein neuer unabhängiger Recorderursachenfingerabdruck erfunden.|**kein geeigneter neuer Fall**.|

**Zählung:** Regler tatsächlich untersucht4/10 (R2/R3 ausdrücklich nur teilweise); SQL-/Recorder2/5 als gezielte heutige Folgeprüfungen des bestehenden#60; insgesamt6/15. Davon1 normal erklärt,2 mit realem Fehlerbefund und weiterhin offener Ursache,3 offen;0 Codekorrekturen/PRs,1 reale Stopp-Teilkette bestätigt (Teilmenge des erklärten Falls). **Neues Fallkontingent4 Regler/0 neue SQL-Ursachen,4/15**; die beiden bekannten#60-Folgeprüfungen nicht als neue Ursachen zählen. Reglerprüfungen trotz Recorderbefund fortgeführt.

</details>

<details><summary>Bereinigte Originalbelege und Codeabgleich</summary>

R1 Session1793537962325, seq14083–14574, intern durchgehend;14083 ohne anfängliche Vollbasis. R4 Session1793522235583, seq19080–19579,38 Anfangsrecords ohne Vollbasis. Kein Cache-Frame wird auf andere Quellenproben übertragen.

|R1-Beleg|Zeit Europe/Berlin|Original / Aussage|
|---|---|---|
|Countdown,seq14095|14:56:11,013|OutputOwned/Active true, bestätigte6 A,6 A-Restladung, StopDelayRemaining51 s; gültige gemeinsame Zuteilung0 W, Reserve1.380 W, positive Netzleistung etwa1,12 kW, PV972 W. Freigegebene damalige SMA-/Phasenquellen frisch, §14a-Begrenzung inaktiv; keine allgemeine Schutzabnahme.|
|Countdown,seq14256|14:56:53,013|9 s Rest, kein Mindestlauf; physische Last1,26 kW.|
|Stopp / Auftrag,seq14309|14:57:02,067 /02,140|Budget-/Mindeststromstopp; command1372 fordert allow_charging0.|
|Unabhängiges ACK,sample154450|14:57:02,473, empfangen02,554|go-e.1.allow_charging0/ack=true/q0; nicht das EMS-ack=false-Echo. Spätere Bestätigung03,146 im StopConfirmedAt.|
|Restleistung,sample154484|14:57:03,230|Trotz AUS-ACK noch1,26 kW; kein vorzeitiges Freigeben der Reserve.|
|Elektrische Null,sample154717|14:57:08,318, empfangen08,422|go-e.1.energy.power0/ack=true/q0, danach frischer bestätigter Stillstand im Ausgang.|
|Besitz/Reserve,seq14360/14362/14414|14:57:10,088 /10,100 /23,017|StopPowerPendingfalse, anschließend OutputOwnedfalse; gemeinsame Reserve erst später0.|
|R4,seq19118/19325/19571|10:44:16,308 /10:45:05,086 /10:46:05,077|Nullbudgetzweig; später1.000→0 W trotz zuletzt916 W Ist; danach wieder1.100 W-Auftrag und1.119 W Ist. Randwerte erklären nicht alle Quellenzeitpunkte oder die Gesamt-Exportepisode10:43:05–10:48:50.|

[R1-Ausgangspfad](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/49ce2918c3d1625ce3a7e9a6c5db83278f04d3e0/lib/wallbox-output.js#L2548): erst vorhandene Halte-/Timerbedingungen, nach Softdefizitablauf Stopp; harte Quellen-/Haus-/Phasen-/Freigabegrenzen bleiben unabhängig.

[R4-EHZ](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/49ce2918c3d1625ce3a7e9a6c5db83278f04d3e0/lib/engine/dhw-output.js#L737): zentraler Sollwert begrenzt Ausgang, simulatedW≤0 erzeugt Nullzweig. Temperaturkapazität ist keine alleinige Ausgangsfreigabe. [Schreibnachweis](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/49ce2918c3d1625ce3a7e9a6c5db83278f04d3e0/lib/heater-write-proof.js#L36): zwei offene Writes lassen das ACK keinem Auftrag eindeutig zuordnen; Sperre bleibt absichtlich bestehen. dhw-output.js/heater-write-proof.js im historischen184-Merge91a1789 und aktuellem186 vollständig textgleich. Erstes überlappendes Write/Reset und damaliger zentrale Budgetauslöser fehlen; keine Lockerung der Besitz-/Nullnachweisregeln.

PR #309/183 Rückkehrqualifikation, PR #310/184 feste1P-/Spender-Rücknahme, PR #311/185 AUS-ACK-Reihenfolge und Code5-Fortsetzung, PR #312/186 unveränderte Cloud-SoC-Publikationen/Kommunikationshalt/SQL-Frist bereits vorhanden. Keine zweite Korrektur derselben Signatur. Beobachteter R1-Mii-SoC91 bei gemeldetem69 ist eine manuelle Energieabschätzung, kein aktueller physischer SoC-Beweis und kein mehrstündiger Wirksamkeitstest des186-Fixes.

</details>

<details><summary>SQL, Aufzeichnung, Prognosegrenzen und gemeinsamer Prüfstand</summary>

Eigene Issues#249/#263/#271/#274/#60/#216/#7/#284 und jüngster Tagesbericht#305 frisch gelesen, Autor jeweils fuchs-1978; relevante Kommentare#7/#60/#284 gelesen. Ältere reale Abnahmen bleiben datiert erhalten, werden nicht zu heutigen vollständigen Erfolgen umgeschrieben. Heute zuvor kein Tagesissue/zugänglicher gleichnamiger Prüfstand gefunden; eigener aktueller Startauftrag allein nicht als fremde laufende Verarbeitung behandelt. [go-e-PR #366](https://github.com/MK-2001/ioBroker.go-e/pull/366) weiter offen/nicht gemergt. Keine alten historischen Fenster erneut geladen.

**Produktive SQL-Zustellung:** schema1/max16/16KiB; checkpointStatus restored,195 kumulative Verdrängungen.15 erhaltene deadline-Einträge:14 lateOutcome complete,1 sql-response-error; zusätzlicher response-validation-Fehler mit beobachtetem Backendabschluss. Keine vollständige heutige Fehlerliste. Frühere verwaiste Anfrage laut Shutdownlogs seit **11:04:29MEZ**, EMS-Neustarts lassen Fence ausdrücklich bestehen. SQL-Log13:58:33,671 bestätigt „No database connection“, zeitgleich EMS-Historienabbruch. „Cannot get index ... id not found“ betrifft die Datenpunkt-ID-Auflösung; daraus folgt kein belegter fehlender physischer Datenbankindex. Keine Metadaten-Recovery ausgeführt.

CurrentRecovery idle, kein Fence/keine aktive Anfrage; letzter unabhängiger exakter Originaltreffer **19:55:55,716**, SQL-ts19:55:55,408; letzte Abfrage14 Originale,107,920ms Transport. queryErrors4 seit jüngstem Prozessstart. Veröffentlichung/sqlConfirmed76.496 sind keine eindeutigen Tagesrecords. Journal86 Records/1.457.531 Bytes,12 unbestätigt; Queue1/88.504 Bytes, HighWater26/2.304.782 Bytes. Snapshot14 unbestätigt bei1.284.510 Bytes zuvor: verschiedene Ablesezeiten, kein Widerspruch. expiredRecords17.390/expiredUnconfirmed8.537 historisch; sqlRecoveryInspectionnull. Alte aufgehobene Sperre, Pufferabbau, genaue SQL-Treffer und nachhaltige Verlustfreiheit bleiben getrennt.

[186-SQL-Code](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/49ce2918c3d1625ce3a7e9a6c5db83278f04d3e0/lib/decision-record-sql.js) begrenzt bei tatsächlich erkannter geeigneter MariaDB das einzelne SELECT anfragebezogen. SQL-Adapter4.3.0/dbtype mysql gelesen, konkreter Serverversionstring und Ausführungs-/Pool-/Sperrsicht fehlen. Eine2.081-s-Transportwartezeit ist damit nicht automatisch Beweis einer2 s lang überschrittenen DB-Statementausführung; Metadaten-/Queue-/Rücktransportanteile nicht isoliert. Kein neuer pauschaler Timeout-/Indexpatch.

**Externe Historie:** drei disjunkte Fenster: R1=120 s, R2=5 s, R4=120 s.49 sequenzielle5-s-Anfragen/Limit20, jeweils mindestens2 s Abstand; größte Antwort60.325 Zeichen, längste Werkzeuglaufzeit3,303 s, maximal3 Transportwerte/Seite.89 Transportwerte→992 eindeutige Originale,953 rekonstruierbar/39 Anfangsrecords ohne Vollbasis.11.315 deduplizierte Originalquellenproben,0 Inhaltskonflikte; ACK/q/ts/lc/receivedAt/NULL erhalten. Quellenzeit ist nicht Transportzeit; Bündel kein simultaner Geräteframe.

Aktuelle main-Decoder: schema4 vollständig validiert, maximal16 Originale/2MiB entpackt/60KiB neue Hülle; historische records-Arrays unterstützt. Keine beschädigte Hülle, Sequenz-/Hashkonflikte oder gelieferten Offset-/Download-/Truncation-Signale. R2 vollständig leer, keine Quellenabdeckung behauptet. **Gesamt-/Folgefehler0/0, Retries0, separate SQL-Ursachendiagnosequeries0.** Erfolgreiche Rohseiten vor Cursorfortschritt gespeichert; Zähler lokal aus tatsächlichen Rohseiten rekonstruiert, keine Wiederholungsabfragen. Lokaler Analyse-Fehler beim Zugriff auf ein optionales Analysefeld einmal korrigiert, kein SQL-Fehler. Historienweg nach diesen Fenstern für1.11. geschlossen; offene alte Teilketten werden nicht automatisch nachgeladen.

**Prognosen:** Vorab-Ledger hat1.11. (aus31.10.19:16:11,481) und2.11. (aus1.11.00:10:12,784), jeweils96 Slots/ensembleVersion1.1.11.-Vorhersagen Median21,45775/Lasso26,50250/Blend23,980125/Hybrid26,50250 kWh bleiben unverändert. Kein gemessener vollständiger Kalendertag, keine heutigen pairedSlots/MAE/RMSE/energyBiasKWh in Evaluation.days; unbekannt, nicht0. Interne Strafstärken-Validierung ist kein Vorab-Ist-Ergebnis. Quellenvertrag vier Unterzähler ohne Wallboxabzug, EHZ enthalten; keine Rückübernahme der verworfenen31.10.-Metriken. Keine Forecast-SQL-Abfrage, kein Umschalten.

Wetterarchiv meldet Sammlung/SQL-Aktivierung und24 Anbieter-Stunden, nicht vollständige unabhängige DB-Zustellung. Fehlende kurzwellige Strahlung und current-Sonnenscheindauer unbekannt; Einheiten nicht aus PV erfinden. Raumhistorie12 numerische Originalreihen/90 Tage meldet Metadatenprüfung, keine Temperaturkopien/neuen Modellmerkmale und keine vollständige Mess-/Zustellabnahme.

</details>

<details><summary>Scorebegründung und nächste Schritte</summary>

|Unterkriterium|Reale Stärke / Defizit / bewerteter Umfang|Punkte|
|---|---|---:|
|Zuteilung/Nachregelung20|R1-Budgetstopp nachvollziehbar; R4-Zentralbudget und gesperrter Nullnachweis nicht vollständig erklärt. Keine ausreichend vergleichbare Gesamtbewertung dieses Kriteriums.|unbewertet|
|Regelruhe10|Zwei-Minuten-Ausschnitte: R1 ruhiges6 A-Halten, R4 wechselnde EHZSollwerte mit offener Eingangsursache. Keine belastbare Tages-Regelruhe.|unbewertet|
|Start/Stopp/Reserve10|R1 Restcountdown, Auftrag, echtes ACK, elektrische Null, Besitz- und Reservefreigabe real in richtiger Reihenfolge. Nur dieser Ablauf, keine gesamte600-s-Ursachenkette/Übergabeabnahme.|10/10|
|Phasen10|Keine vollständige neue Phasenwechselkette untersucht.|unbewertet|
|Wirksame Schutzreaktionen15|Frische SMA-/Freigabeproben und Code5-Stopp sind keine vollständige heutige Schutzreaktionsabnahme; not-assessed erhalten.|unbewertet|
|Zuständigkeit/Freigaben10|R1 EMS-Auftrag zugeordnet, aber R2/R3 und erster EHZ-Schreibkonflikt fehlen; kein vollständiger Schreiber-/Rückgabenachweis.|unbewertet|
|Quellenabdeckung10|Hauptquellen über99,5% der vergangenen Bilanzzeit. Vergangene Lücken etwa362–402 s offen erhalten, zukünftige Zeit getrennt.|9/10|
|Original-/Zustellintegrität10|992 natürliche Originale unabhängig empfangen und exakte SQL-Treffer vorhanden.46.171 Tagesverwerfungen/4 Schreibfehler, volle Puffer, lange ungeklärte Bestätigungsfristen und einzelne Antwortfehler sind erhebliche reale Defizite.|3/10|
|Nachvollziehbare Diagnose5|R1 elektrisch erklärbar, R4 bis Nullbudget-/Reservezweig eingegrenzt;1.735 Ereignis-/99 Episodendetails und195 kumulative Fehlercheckpointdetails verdrängt. Erstursachen/R2/R3 bleiben offen.|3/5|

**25/35≈71/100 normiert; bewertetes Gewicht35/100, unbekannt65/100. Kein Gesamtscore, keine80-Punkte-Freigabe.** Vergleichbarer Aufzeichnungsanteil15/25=60% gegenüber18/25=72% am31.10.; bessere Energieabdeckung (+1 Punkt) bei deutlich schlechterer Detailintegrität (−4 Punkte). Kein pauschaler Rückschritt aller Reglerfunktionen aus dieser Zahl.

Nächste Schritte, ohne Zusatzlauf:
1. Nächster regulärer Bericht: vorhandene Evaluation nach Ablauf1.11. lesen. Kriterium vollständige identische96/96-Messpaare mit vorab gespeichertem Median/Lasso/Blend/Hybrid; keine ergänzende Routine-SQL-Serie.
2. Nächster natürlicher EHZ-Nullbudget-/Schreibkonflikt: zentralen Sollwertauslöser und ersten überlappenden Auftrag/Reset samt Strom-/Phasenreserve zuordnen; Kriterium eindeutige Auftrag→Reset→elektrische Wirkung, keine Aufweichung des Nullnachweises. Heutiges Fenster nicht wiederholen.
3. Nächste natürliche#60-Störung: offene Backendphase und Aufnahmeverluste zeitlich korrelieren; Kriterium exakte Originaltreffer, keine neuen Verlustzunahmen und nachvollziehbarer Bestand unbestätigter Records/Bytes. Keine automatische Recovery, Neustarts oder Änderungen an Datenbank-/Retention-/Timeoutparametern.

</details>

## Nachtrag 01.11.2026, 21:28 MEZ: EHZ und vermuteter WLAN-Ausfall

Gezielte Offline-Nachprüfung auf Betreiberauftrag, begonnen um 21:24 MEZ. Grundlage ausschließlich die bereits gesicherten Originalseiten des EHZ-Fensters **10:44:10.069–10:46:10.069 MEZ**, Sitzung `1793522235583`. Keine neue Anlagenlesung, kein zusätzlicher Historienabruf, keine Anlagenänderung. Der abgeschlossene Tagesabruf bleibt geschlossen; ursprüngliche Bilanz, Fallzählung und Score bleiben erhalten.

**Ergebnis: Fehlende EHZ-Ist-Leistungsmesswerte erklären das Verhalten im untersuchten Fenster nicht.** Die bereits zuvor ausgelöste Schreibnachweis-Sperre ist belegt; ihr ursprünglicher Auslöser bleibt offen.

|Geprüfter Beleg|Ergebnis und Grenze|
|---|---|
|EHZ-Istleistung aus `1074_P_out1`, `1075_P_out2`, `1076_P_out3`|Jeweils **111** anhand ihres Empfangszeitpunkts innerhalb des 120-s-Fensters liegende Proben; alle ACK=true, q=0, numerischer Wert. Größter Empfangsabstand 1.274/1.288/1.288 ms, größter Abstand Empfang zu Original-ts 218/192/192 ms. Die zuvor genannten 115 gesicherten Proben je Reihe schließen vier Vorlaufproben vor Fensterbeginn ein.|
|EHZ-Austrittstemperatur `1001_Temp1`|111 Proben innerhalb des Fensters, alle ACK=true/q=0/numerisch; größter Empfangsabstand 1.195 ms. Dies ist keine vollständige Temperatur-/Schutzabnahme.|
|Schreibregister `1000_Power`|Bei **22 vollständig erfassten Aufträgen** zwischen 10:44:20.213 und 10:46:05.075 liegen Auftrag, Transportabschluss und anschließender Modbus-Reset vor. Abschluss einschließlich Reset nach **1.539–1.778 ms**, jeweils vor dem nächsten Auftrag. `val=null, ack=true` ist hier die Verarbeitung quittierende Rücksetzung des write-only Registers, kein fehlender Ist-Leistungswert und kein elektrischer AUS-Nachweis. Zwei frühere nur als Zustandsfolge vorliegende Aufträge sind nicht als vollständige Ketten mitgezählt.|
|Offline-Wiedergabe des Schreibnachweises|22 Original-Auftrags-/Transport-/Zustandsfolgen mit ihren gespeicherten Zeitpunkten in einen frischen, ausschließlich lokalen `HeaterWriteProof` eingespielt: **keine Sperre, kein verbleibender offener Auftrag**. Das reproduziert aus diesen 22 Ketten keinen neuen Schreibkonflikt. Es ersetzt weder den ursprünglichen Prozesszustand noch die unbekannte Vorgeschichte.|
|Produktive Sperre und Codepfad|Bereits zu Beginn des verfügbaren Abschnitts ist eine EHZ-Phasenreserve von 3.000 W mit blockiertem Nullnachweis/`overlapping-write` dokumentiert. `HeaterWriteProof.begin()` setzt diesen Zustand bei einem neuen Auftrag mit noch offenem Vorgänger; `block()` hält die Unsicherheit für den restlichen EMS-Prozess fest. Später eintreffende gültige Messwerte und quittierte Aufträge heben sie nicht auf. Die jeweils sichtbare Reservebegründung wechselt mit dem Betriebszustand; sie ist nicht in jedem Frame identisch.|
|Noch offene Ursache|Der **erste** überlappende Auftrag samt ausstehendem Reset liegt vor dem rekonstruierbaren Abschnitt. Ein früher verzögerter Kommunikationsabschluss, etwa durch WLAN, ist möglich, aber ebenso wenig belegt wie eine konkurrierende Softwareansteuerung. Die Ursache der zentralen wiederholten Nullbudgets bleibt ebenfalls offen; die gehaltene Reserve ist nicht als alleinige Ursache sämtlicher Nullbefehle bewiesen.|

Codebeleg: [Schreibnachweis auf geprüftem main](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/49ce2918c3d1625ce3a7e9a6c5db83278f04d3e0/lib/heater-write-proof.js). Der ausgewertete Schreibnachweispfad ist gegenüber dem für die EHZ-Episode maßgeblichen Stand unverändert. Aktueller main bleibt `49ce2918c3d1625ce3a7e9a6c5db83278f04d3e0`; daraus folgt keine Installationsbehauptung.

**R4 bleibt offen, ist aber enger eingegrenzt:** im geprüften Fenster keine fehlenden EHZ-Leistungsmesswerte und kein neu reproduzierter Schreibkonflikt. Der später dokumentierte Mii-Kommunikationsstopp um 11:47:26 ist kein Nachweis für dieselbe Ursache beim EHZ um 10:44. Keine Codeänderung begründet, keine neue Version. Eine automatische Aufhebung der konservativen Schreibnachweis-Sperre ist durch diese Daten nicht gerechtfertigt. Für den nächsten ohnehin stattfindenden regulären Bericht bleibt als Kriterium die erste natürliche Konfliktfolge mit Auftrag, Reset, zentralem Sollwert und elektrischer Wirkung; kein erneutes Laden dieses Fensters.


