# Issue #329 – [SQL 2026-11-03] EMS-Livebetrieb: Tagesauswertung

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/329. Letzte Issue-Änderung: 2026-11-03T20:08:29Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

# Tagesauswertung 03.11.2026

**Weiterbetrieb: im beobachteten Umfang vertretbar.** Drei begrenzte Reglerabläufe sind untersucht; eine vollständige Anlagen-/Schutzabnahme liegt weiterhin nicht vor. Aktuell sind Master und reale Ausgangsfreigabe EIN, Systemmodus PRODUCTION. Wallboxen ohne Startbudget, EHZ-Auftrag und Reserve 0 W; kein bestätigter unsicherer Ausgang.

Arbeitsbeginn **03.11.20:04:35,385**, Deadline **20:49:35,385 Europe/Berlin (MEZ)**. Referenz: **02.11.20:04:35,385–03.11.20:04:35,385**. Einmal gelesene frische Tagesbilanz schema1, Zustandszeit **20:06:25,321**: gewählt wurde **previous mit tatsächlichen Grenzen 02.11.20:00–03.11.20:00**, observedUntil exakt **03.11.20:00**. Die neue current-Periode beginnt bereits am03.11.20:00. Keine SQL-Angleichung des abweichenden Referenzrahmens.

Installiert/common.installedVersion und laufende System.Version: **0.17.0-alpha.197**. Startlog **18:51:15,788**, Versionszustand **18:51:33,416**. Exakter installierter Commit unbekannt. Main **[7fa9f4f](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/7fa9f4ff38710516402ff6fb413e54a4bd5c80c7)**; package/io-package ebenfalls197. Jüngster veröffentlichter GitHub-Release bleibt [alpha.191](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.191), veröffentlicht02.11.23:17:28. Merge, Release, Installation und reale Wirkung sind getrennte Nachweise.

Die wichtigsten Befunde:

- **Aufzeichnung verbessert:** 0 neu beobachtete verworfene Records, 0 WriteErrors, 0 Zählerresets; gestern77 Verluste. Quellenabdeckung jeweils86.219,185 s, vergangen unbekannt180,815 s. Sechs beobachtete Starts; bekannte Updateunterbrechungen bleiben als Lücken enthalten.
- **EQV13:55:** Nach8→7→6-A-Aufträgen wurde6 A bestätigt; danach erschienen erneut8 A in Vorgabe/Rückmeldung ohne neuen EMS-8-A-Auftrag. Sichere AUS-/Ruhe-/Reservekette belegt. Herkunft der Rückmeldung bleibt im bestehenden#216/go-e-PR366 offen.
- **EHZ15:43:** 4–5 W echte Restmessung verhinderten zunächst die strenge Nullfreigabe. Nach Update196 neuer Nullauftrag und vier unabhängige Nullproben über15,953 s; anschließend Reserve/Eigentum frei. Kein belegter WLAN- oder Heizstabdefekt.
- **Übergabe14:21:** EQV-Absteckstatus und0 W vor EMS-AUS; nach Bestätigung/Reservefreigabe startet EQE ohne erneute300-s-Qualifikation und nimmt Leistung auf. Aktuell Mii-SoC84%, cloud-after-unplug, Warnung AUS: begrenzte Zustandsbestätigung des bereits vorhandenen PR328/197.
- **SQL bleibt offen:** Vier natürliche Prüffristüberschreitungen; später15/14/24/13 Originale bestätigt, Transportwartezeiten97–774 s. Aktuell exakter Originaltreffer, keine offenen Requests/Fence. Keine behauptete Behebung der DB-/Storageursache.

Leistungsintegral-Schätzungen: Netzbezug **12,833 kWh**, Einspeisung **4,747 kWh**, PV **31,592 kWh**, BHKW separat **21,821 kWh**. Vermeidbare Einspeisung **nicht belastbar quantifizierbar**; keine Einsparhochrechnung.

**Prognosevergleich und Wetterhistorie:** Zwei vollständige Vorabvergleiche01./02.11., jeweils96/96 Viertelstunden. Neuester abgeschlossener Tag **02.11.**, Ist30,424 kWh: Median/Lasso/50:50/Hybrid MAE405/423/399/388 W, RMSE629/633/612/590 W, Bias−6,226/−3,564/−4,895/−3,564 kWh. Zwei Tage belegen keinen allgemeinen Sieger. Training5.117 Werte/54 Tage;96 Vorhersageslots für04.11. vorab gespeichert. Produktion bleibt Median. Wetterstatus letzter Stand03.11.20:03:57, Strahlungs-/vollständige DB-Abdeckung unbekannt; Anbieter-Schätzungen, keine lokalen Messungen. Raumhistorie12 Originalquellen/90 Tage geprüft, Zustellung nicht abgenommen; Kind3 elektrisch, keine neuen Lasso-Merkmale.

**Vorläufiger Teilscore30/35 =85,7/100 normiert; bewertetes Gewicht35/100,65 unbekannt. Kein Gesamtscore.** Gestern28/35 =80,0 bei gleichem Gewicht; +2 Punkte ausschließlich im Aufzeichnungsanteil. Keine Punkte für Versionen oder Tests. **Keine zusätzliche Codeänderung begründet.**

<details><summary>Bilanz, Quellenabdeckung und Grenzen</summary>

Alle Zeiten Europe/Berlin. Leistungsintegrale sind Schätzungen über gedeckte Abschnitte, keine abrechnungsfähigen Zählerdifferenzen.

|Quelle|Positive Energie kWh|Einspeisung kWh|Gedeckt s / hh:mm:ss|Vergangen unbekannt s / hh:mm:ss|
|---|---:|---:|---|---|
|Netz|12,832635|4,746961|86.219,185 /23:56:59|180,815 /00:03:00|
|PV|31,591986|—|86.219,185 /23:56:59|180,815 /00:03:00|
|BHKW|21,821219|—|86.219,185 /23:56:59|180,815 /00:03:00|
|Mii/WB0|17,995434|—|86.219,185 /23:56:59|180,815 /00:03:00|
|EQV/WB1|9,610945|—|86.219,185 /23:56:59|180,815 /00:03:00|
|EQE/WB2|1,892562|—|86.219,185 /23:56:59|180,815 /00:03:00|
|EHZ|0,569698|—|86.219,185 /23:56:59|180,815 /00:03:00|

hh:mm:ss abgerundet. Für die abgeschlossene Bilanz keine zukünftige Restzeit. MAX_GAP10 s; Abdeckung99,7907%; Lücke nicht als0 gerechnet. Winzige negative Rohanteile WB0 0,124731 Wh/WB2 0,013906 Wh bleiben Messbefund, keine behauptete Fahrzeugerzeugung. grid.meanW337,610 und meanAbsoluteW734,019 W sind unterschiedliche Größen, kein Einsparpotenzial. BHKW nicht nochmals zum SMA-NVP-Budget oder zur PV-Quelle javascript.0.PV.Eigenerzeugung addiert.

21 beobachtete Statusänderungen,15 eventOverflow, davon protectedOverflow0; sechs Stopps erhalten. investigation.overflow49 =22 Export+23 deviation+4 sampling-gap; Typverdrängungen nicht zusätzlich addiert. Zwei jüngste sampling-gaps erhalten:11:01:45,214–11:02:18,662 (33,448 s) und11:37:20,101–11:37:51,602 (31,501 s). Vier weitere verdrängt, ursprüngliche Einzelgrenzen unbekannt. Kompaktstarts6; begrenzter aktueller Logausschnitt belegt Update-/Wartungsbeendigungen und Starts195/196/197, insbesondere15:43:13,754→15:43:19,116 und18:51:10,260→18:51:15,788. Nicht alle sechs Startursachen nachträglich als erklärt behauptet. sampling-gap allein beweist weder Neustart noch SQL-Verlust. Bekannte Updateunterbrechungen erhalten keinen eigenen Fall/zusätzlichen Scoreabzug.

protectionAssessment bleibt **not-assessed**. avoidableExportWh=null bleibt unbekannt. Fehlende verdrängte Ereignisse beweisen keine Ereignisfreiheit. Die lange vormittägliche Export-/Mii-Unteraufnahme gehört zu bereits bearbeiteten PR324–326; kein zweiter Fix. Tagesexport einschließlich Nacht bleibt in der Bilanz, erhält keinen eigenständigen Nachtfall/Scoreabzug. Für Haushaltsbezug ohne damalige belegte Abregelmöglichkeit keine Such-SQL-Abfrage.

Aktuell SQL-Instanz sql.0; globale Freigaben sowie WB0/1/2 ProductionArmed wahr, BatteriePresent/ControlEnabled falsch. Hausanschluss im historischen R1/R3-Kontext50 A, Reserve4 A/Erhöhungsgrenze46 A, keine aktive Netzbetreiberbegrenzung;4,2 kW ist keine pauschale absolute Hausbezugsgrenze. Mii-Phase skriptgeführt, EQV/EQE EMS-geführt. Phasenumschaltung_V1 aktuell EIN; vier gelesene alte PV_Ueberschuss-Skripte AUS. Dies ist ein aktueller Ausschnitt, keine vollständige historische Fremdschreiberabnahme. EHZ-Pumpenskript Umwälzpumpe_MyPV_TW_V1 aktuell AUS; daraus weder Durchfluss noch Defekt abgeleitet. Schattenpause ist kein realer Nullwert. Keine Installation/Neustarts/Konfigurations-, Aktor- oder SQL-Schreibaktionen dieses Laufs.

</details>

<details><summary>Fallplan R1–R10 / S1–S5 mit Originalketten</summary>

|Fall / Ereignis|Originalquelle / tatsächlich geprüft|Engste belegte Erklärung, Wirkung und fehlender Nachweis|Status / Zuordnung|
|---|---|---|---|
|R1 EQV03.11.13:55:00,132|Geschützter Stopp, Warnlog, DecisionRecord-Fenster13:54:00,253–13:56:00,253;577 Originale,526 Vollbilder rekonstruierbar/51 initial ohne Basis;alpha195|13:54:40,052 Auftrag8 A,42,059→7 A,46,053→6 A.6-A-Vorgabe ACK57,599, Feedback ACK57,643; Ausgang übernimmt6 A um58,286. Dann Vorgabe8 A ts59,898/Feedback8 A ts59,902, ACKtrue/q0, von go-e.1. Kein weiterer EMS-8-A-Auftrag im gesamten Fenster. Gemessen bereits5,6 A/1,29 kW, nicht8 A. Konflikt13:55:00,109 command-not-own-current, erwartet6/beobachtet8. Ein-Ampere-Beruhigung greift bei2 A Differenz nicht. AUS-Auftrag00,221, unabhängiges allow0 ACK00,644; weitere spätere ACKs/StopConfirmedAt01,718. Erste erhaltene Nullleistung29,254, Besitz frei30,109, Zuteilungsreserve0 ab32,024. Reserviert zuvor1.840 W. Ursprung der erneut veröffentlichten8 A ohne HTTP-/Fremdschreibprovenienz unbekannt; Code-Gates/Sicherstopp erklärt, kein neues pauschales Ignorieren solcher Meldungen.|**offen** bezüglich Herkunft; sichere Teilwirkung real bestätigt. Bekannte#216/go-e-PR366-Signatur, kein neuer Halte-/Antwortfix.|
|R2 EHZ03.11.15:42–15:44|suggested15:42:45,079–15:44:45,079;252 Originale/252 rekonstruierbar über zwei Sitzungen;195→196, Originalzeiten teilweise vor Transportfenster|Auftrag0 gespeichert15:42:40,125; erhaltener tatsächlicher0-W-Schreibversuch ts40,432/Transport40,585, write-only-NULL-ACK41,959.1074 meldet zuvor916/919 W, dann5 W ts42,411 und4–5 W weiter.1075/1076=0. Strenge Nullprüfung blockiert wegen echter positiver Restmessung, hält1.169 W Reserve. Budget um790–808 W unter bekanntem900-W-Schichtungsminimum, oben67,5/unten48,9°C; kein erlaubter erneuter Heizstart. Updateunterbrechung. Neuer Nullauftrag15:43:40,875, Transport40,956, NULL-ACK42,452. Echte1074-Null ts43,008; im erhaltenen Reservebeleg vier unabhängig fortgeschrittene Dreiphasenproben von44,093 bis15:44:00,046=15,953 s. Freigabebeleg00,204, Reservepublikation0 um00,215, Eigentumfrei00,240 (Frame46:00,244). NULL ist kein numerisches Ist;4–5-W-Restursache unbekannt, kein belegter WLAN-/Durchflussdefekt. Die übrige35-Minuten-Exportepisode ist nicht elektrisch vollständig erklärt.|**normal erklärt** für konservative Abschaltung/Reservefreigabe und bekannten900-W-Mindestpfad. Reale Teilabnahme, keine neue Grenzkorrektur.|
|R3 EQV→EQE03.11.14:21|Gezielter Absteck-/Übergabekontext14:20:06,114–14:22:06,114;655 Originale/573 rekonstruierbar,82 initial ohne Basis;195|EQV car1 ts14:21:04,340, Leistung0 ts04,431 vor AUS-Auftrag06,198; ACK06,633. Besitzfrei08,089; Zuteilungsreserve4.880→0 W ab09,047. EQE69%/Ziel90%, Freigaben gültig, bestätigte1P; prepared-vehicle-handoff mit festem Ablauf14:25:44,010 und StartDelayRemaining0. Neuer6-A-Auftrag12,102, unabhängiges6-A-Stromfeedback ts12,468; Vorgabe-ACK6 A erst14,369. EIN14,136/ACK14,395; erste erhaltene positive Leistung570 W ts31,423. Danach8 A/13 A und tatsächliche Aufnahme bis2,80 kW; spätere Rücknahmen11 A um56,056/10 A um58,138 bei neuem Netzbezug bis364 W und begrenztem Zuteilungsbudget2.526,4 W.10-A-Rückmeldung58,321, elektrische Antwort2,15 kW ts14:22:01,442/confirmed02,100. Keine weitere Stoppflanke im Fenster. Kein erneuter300-s-Countdown; keine vorzeitige Übertragung unbestätigter Spenderwatt.|**normal erklärt**, reale begrenzte Folgeabnahme vorhandener Übergabepfade PR256/267/318/326, kein neuer Ursachentyp.|
|R4–R10|Tagesbilanz, begrenzte Logs, aktueller Code und PR324–328|Freie Plätze: Mii-Vormittags-Unteraufnahme/Finish/SoC bereits bearbeitet; aktuelle84%-Cloudübernahme bestätigt nur den Zustand von197, keinen neuen Ladezyklus. Übrige reine deviation-/Nachtmarkierungen ohne unabhängige damalige Stellfähigkeit ausgeschlossen. Erhaltene Mii-Budget-/Mindest-SoC-Stopptexte und EQE-Budgetstopp15:25:56,083 ersetzen keine vollständigen Wirkungsketten; daraus keine Fehlerfreiheit oder neue Ursachen erfunden.|**kein geeigneter neuer Fall** nach Auswahlfilter; nicht vollständig angeforderte Detailhistorie von echten Lücken unterschieden.|
|S1 #60 produktive SQL-Prüfung03.11.|RecordSQLFailures_JSON schema1, max16/16KiB, evicted203/checkpointStatus restored; Delivery/Recovery/Journal und historisch erhaltener Decoder-/Zustellungspfad|Vier neue natürliche transport-deadline-Fälle später vollständig verarbeitet, siehe Tabelle. Kein neuer äußerer Lesefehler. Aktuell14 Originale durch exakten DB-SELECT bestätigt,78,421 ms Transport, keine offenen Requests/Fence, Leser/Schreiber ready. Vier heute behaltene Fehler sind keine vollständige Fehlerfreiheit bei203 kumulativ verdrängten Details. Keine DB-Prozess-/Sperr-/Index-/Pool-/Rücktransportsicht; langsame Werkzeug-/Transportzeit ist keine isolierte SQL-Ausführung. Bestehender Late-Callback-/Backoff-/SELECT-Pfad bleibt zuständig.|**Fehler belegt**, Ausgangsursache offen; bekannter#60-Folgefall, kein zweiter SQL-/Cache-/Late-Callback-Fix.|
|S2–S5|Kompaktzähler, Journal, drei externe Fenster|0 neue beobachtete Verluste/0 WriteErrors/0 Resets, keine neue bekannte Verlustepisode im Journal (letzte alte02.11.). Nicht nachhaltige Verlustfreiheit behauptet. Extern72 vollständige Seiten/0 Fehler, keine Truncation oder Limitgrenze. Fehlende Anfangsbasis133 Records ist hier eine gewählte Abrufgrenze, kein belegter produktiver Verlust. Ein lokaler Dateifilterfehler bei erneuter Rekonstruktion und fehlendes erstes elapsed-Feld wurden aus gesicherten Daten korrigiert, keine SQL-Ursache/kein erneuter Abruf.|**kein geeigneter neuer Fall**; bestehende Aufzeichnungsursache weiter offen.|

**Zählung:** Regler tatsächlich untersucht **3/10**, SQL-/Recorder **1/5**, insgesamt **4/15**. Status:2 normal erklärt,1 Fehler belegt,1 offen;0 Codekorrekturen/0 neue PRs. Drei reale begrenzte Wirkungsketten bestätigt (R1 AUS, R2 Reservefreigabe, R3 Übergabe); keine vollständige Anlagenabnahme. Zwei Ursachen bleiben offen (R1 Herkunft, S1 Verzögerung). Alle vier sind neue Tagesbelege zu bekannten Familien, **0 neue eigenständige Ursachenfälle**; keine Altfälle als neue Entwicklung gezählt.

</details>

<details><summary>SQL-/Recorderprüfstand, Code und Versionsabgleich</summary>

|Prüfanfrage03.11. MEZ|Tatsächlicher Callback|Transportwartezeit s|Später exakt bestätigte Originale|
|---|---|---:|---:|
|00:06:48,409|00:19:42,643|774,221|15|
|06:06:48,521|06:16:41,682|593,150|14|
|12:06:50,725|12:19:10,871|740,135|24|
|18:06:52,661|18:08:29,911|97,236|13|

Die18:06-Anfrage unter196, heutiger langer12:06-Fall vor195; kein nachträgliches Behaupten einer Regression von197. Knapper gelesener sql.0-Warn-/Fehlerausschnitt enthält fünf id-not-found-Meldungen zu anderen SoC-/Energiequellen um12:19, keine belegte Ursache der vier DecisionRecord-Transportwartezeiten. Keine künstlichen Diagnose-/Erfolgsabfragen, keine Backend- oder Konfigurationsänderung.

Snapshot20:07:22,705 frischer exakter SQL-Originalnachweis; Journal zum gesonderten20:07:25,011-Snapshot89 Records/1.694.431 Bytes,87 retained bestätigt/2 unbestätigt, Rohqueue1/108.380 Bytes. Diese Momentaufnahmen sind zeitversetzt. expiredRecords17.390/expiredUnconfirmed8.537 unverändert; alte Alterung ist keine Recovery. Kumulativ6.834.726 Bestätigungen sind keine eindeutige Tagesanzahl. Historische rejectedRecords6.016.927, evictedLossEpisodes44/evictedRecords601 sind keine heutigen Verluste. LastError ist eine alte Queuewarnung; aktueller Backoff und letzter exakter Nachweis zeigen keinen anhaltenden Fence. sqlRecoveryInspection=null; keine Recovery ausgelöst.

**Externer Tagesabruf abgeschlossen:** drei disjunkte120-s-Fenster, jeweils24 Seiten zu5 s/Limit20, insgesamt72 history_query;126 Transportwerte,1.484 Originale,1.351 rekonstruierte Vollbilder/133 Anfangsrecords ohne verfügbare Vollbasis. Alle unbekannten Rekonstruktionen mit Grund„Delta ohne verfuegbaren Vollsnapshot“, keine beschädigte Teilhülle akzeptiert. Keine internen Sequenzlücken:
R1 Sitzung1793708606152 seq7551–8127;
R2 gleiche Sitzung39068–39197, neue1793716998446 seq1–122 mit erhaltener Shutdown-/Updategrenze;
R3 Sitzung1793708606152 seq14946–15600.
15.422 deduplizierte Quellenproben,0 beobachtete Inhaltskonflikte. Original-ts/lc/ACK/q/NULL und receivedAt erhalten; Vorlaufproben/Quellenpakete sind keine rückwirkenden Vollentscheidungen oder simultanen Geräteframes.

0 Gesamt-/0 Folgefehler,0 Retries,0 separate SQL-Ursachendiagnoseabfragen. Jeweils eine historische Anfrage gleichzeitig; erst vollständig gesichert/aktuell dekodiert, dann mindestens2,05 s Pause. Größte gemessene JSON-Antwort101.594 Zeichen; längste separat gemessene Werkzeuglaufzeit3,635 s. Erste Seite nicht separat gestoppt: kombinierter Werkzeugaufruf einschließlich weiterer Arbeit2,2 s, keine erfundene isolierte SQL-Laufzeit. Inline-JSON, keine angebotenen Truncation-/nextOffset-/Downloadhinweise, kein Limit20 erreicht. Erfolgreiche Fenster nie erneut geladen. Zähler aus tatsächlich gespeicherten Rohseiten/Metadaten abgeglichen; temporär validierter Prüfstand atomar ersetzt. **Abrufweg für03.11. geschlossen**, keine automatische Nachholung.

Decoder und Transport aus geprüftem main197 verwendet: schema4 vollständig vor Freigabe validiert,16 Originale/2MiB entpackt/60KiB neue Hülle, historisch128KiB ungepackte Hülle; schema3 nach Sitzung/Sequenz rekonstruiert. Ruhige30-s-Intervalle sind keine Verluste. DecisionRecord-Objekt aktuell SQL enabled/changesOnly, kein Relog/debounce/blockTime, ignoreZero=false. SourcePowerHistory meldet sql.0/600s für die vier ursprünglichen Leistungsquellen; Metadatenstatus ist kein vollständiger Zustellnachweis und10-min-Unverändertabstände keine pauschalen DecisionRecord-Lücken.

Historischer195-Merge[ef8b4f3](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/ef8b4f3fa5070300413075f8145fd68d0239ddac) und main197 sind für wallbox-output, wallbox-allocation, engine/realtime und engine/dhw-output **vollständig textgleich**. Konkrete Codepfade:
[Konfliktprüfung](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/7fa9f4ff38710516402ff6fb413e54a4bd5c80c7/lib/wallbox-output.js#L525),
[AUS/Reserve](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/7fa9f4ff38710516402ff6fb413e54a4bd5c80c7/lib/wallbox-output.js#L1600),
[EHZ-Nullplateau](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/7fa9f4ff38710516402ff6fb413e54a4bd5c80c7/lib/engine/dhw-output.js#L158),
[vorbereitete Übergabe](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/7fa9f4ff38710516402ff6fb413e54a4bd5c80c7/lib/engine/realtime.js#L700).
stop()-Methode außerdem textgleich zu190; datierte Stoppteilabnahme aus#313/#321 bleibt eng übertragbar.

Heute bereits vorhandene, getrennte Korrekturen:
[PR323/192](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/323) passive Stopp-/Vergleichsfenster,
[PR324/193](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/324) begrenzter PV-Prüfschritt,
[PR325/194](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/325) Finish/Übergabe,
[PR326/195](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/326) Aufnahmebegrenzung/SoC-Kontinuität,
[PR327/196](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/327) passive Sollwertdiagnose,
[PR328/197](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/328) Cloud-SoC nach Abstecken.
PR-Beschreibungen melden jeweils grüne erforderliche Prüfungen; dieser Tageslauf führt keine zusätzliche Softwarekorrektur/Version/Tests aus. Einzelne reale Teilketten sind kein Nachweis sämtlicher Änderungen, der Mii-Abregeltest aus193/195 ist damit nicht pauschal abgenommen. Jüngster GitHub-Release191 enthält noch keine behauptete Veröffentlichung von197.

Eigene Issues#249/#263/#271/#274/#60/#216 und jüngster Tagesbericht#321 frisch gelesen, Autorenfuchs-1978 bestätigt; relevante#60/#216-Kommentare gelesen, #7 ebenfalls Autor bestätigt. Kein heutiges Tagesissue vor Start gefunden; spätere Suche der jüngsten eigenen Tagesberichte bestätigt#321 als jüngsten. Kein aktueller lokaler Tagesprüfstand vorhanden; ergänzende Dateisuche kein exakt passendes heutiges Belegpaket. Frühere lokale Dateien nicht als verfügbare Belege behauptet. Kein historisches26./27.10.- oder01./02.11.-SQL-Fenster erneut geladen. [go-e-UpstreamPR366](https://github.com/MK-2001/ioBroker.go-e/pull/366) frisch geprüft:offen/nicht gemergt, kein paralleler Patch.

</details>

<details><summary>Prognosevergleich und Wetterhistorie – vollständige Kennzahlen</summary>

Einmal gebündelt aktuelle Ready/Status/Result/Evaluation/Model/Forecast/Ledger sowie WeatherArchive.Status und RoomHistory.Status/Status_JSON gelesen. Ready=true; aktuelle Modelltrainierung03.11.18:51:33,451,5.117 Werte/54 Tage. Trainings-/Abstimmungsfehler sind keine Vorabgüte.

**Neuester abgeschlossener Isttag02.11.00:00–03.11.00:00**,96 identische Viertelstunden je Kandidat, vorab gespeichert **01.11.00:10:12,784 MEZ** (Original-issuedAt1793488212784), also vor dem Zieltagesbeginn. Ist **30,424370 kWh**. Vorzeichen Bias=Prognose−Ist.

|Modell|pairedSlots|MAE W|RMSE W|Prognoseenergie kWh|energyBiasKWh|
|---|---:|---:|---:|---:|---:|
|Median|96|404,859|629,165|24,198750|−6,225620|
|Lasso|96|422,647|632,614|26,860750|−3,563620|
|50/50 fest|96|399,368|612,200|25,529750|−4,894620|
|Lasso-Energie/Median-Verlauf|96|388,338|589,886|26,860750|−3,563620|

01.11. ebenfalls vollständig96/96, Ist24,273595 kWh, Original-issuedAt1793470571481 vor Tagesbeginn. Keine rückwirkenden Ensembles ergänzt; beide Tage ensembleVersion1.

|Modell, über01./02.11. gepoolt|Identische Paare|MAE W|RMSE W|Summe signierter Energiefehler kWh|Mittlerer absoluter Tagesenergiefehler kWh|
|---|---:|---:|---:|---:|---:|
|Median|192|339,623|541,240|−9,041465|4,520733|
|Lasso|192|364,630|524,602|−1,334715|2,896263|
|50/50 fest|192|335,019|512,782|−5,188090|2,594045|
|Lasso-Energie/Median-Verlauf|192|360,809|523,992|−1,334715|2,896263|

50/50 bisher geringste gepoolte MAE/RMSE und geringster mittlerer absoluter Tagesenergiefehler; kleine signierte Summen bei Lasso/Hybrid enthalten Fehlerkompensation zwischen Tagen. Am02.11. allein Hybrid geringster MAE/RMSE. Keine allgemeine Überlegenheit aus zwei Tagen. 7-Tage-Fenster nur192/672 Paare,2/7 komplette Tage;14 Tage192/1248,2/13 komplette Tage, ein Zeitumstellungstag ausgeschlossen. Fehlende Tage bleiben unbekannt.

**Vorhersage, kein Güteergebnis:** Ziel04.11.00:00–05.11.00:00,96 Slots, issuedAt03.11.00:10:11,841. Median22,455750/Lasso26,824500/50:50 24,640125/Hybrid26,824500 kWh. Datum03.11. ist noch kein abgeschlossener Istvergleich im gelesenen Evaluationsstand. Produktionsverfahren laut heutiger Konfiguration median.

Zielgröße cleaned-baseload: vier Hauszähler minus EHZ, keine nochmalige Wallboxsubtraktion, da diese nicht in der Vierer-Hauszählersumme liegen; Heizlastabzug nicht aktiv. Quellenzuordnung aus der gelesenen Ledger-Signatur. Keine zusätzlichen SQL-Prognoseabrufe.

Wetterarchivstatus SQL aktiviert, letzter gemeldeter Wetterstand03.11.20:03:57. Aus diesem Status sind weder Vollständigkeit aller Größen, Strahlung noch vollständige unabhängige Datenbankzustellung nachweisbar; fehlende Strahlung unbekannt. Meteo-current sind Anbieter-Schätzungen. Raumhistorie Status/schema1 meldet12 bestehende numerische Original-SQL-Quellen, mindestens90 Tage oder unbegrenzt; kein zweites Temperaturarchiv. Kind3 elektrisch getrennt. Wetter-/Raumhistorie ist kein nachgewiesenes neues Lasso-Merkmal: Temperatur-/Heizgradkoeffizienten aktuell0. Keine Umschaltung/adaptive Mischung/neue Automation aus diesem Vergleich.

</details>

<details><summary>Score mit belegtem Umfang und nächste Schritte</summary>

|Unterkriterium / Maximalgewicht|Reale Stärken, Defizite und tatsächlich bewerteter Umfang|Punkte|
|---|---|---:|
|Zuteilung/Nachregelung20|R3 belegt erfolgreichen Start und Nachregelung auf heutige elektrische Antwort; schnelle Änderungen nachvollzogen. Nur kurzer Ausschnitt, bekannte Mii-Unteraufnahme vor195/193 und Tageszuteilung nicht repräsentativ abgenommen.|unbewertet|
|Regelruhe10|R1 echte schnelle8/7/6-A-Aufträge und Konflikt, R3 auf wechselndes Budget reagierende13/11/10 A. Keine ausreichende repräsentative Tages-Regelruhe; nicht allein aus Diagnosekorrektur196 Punkte.|unbewertet|
|Start/Stopp/Reservefreigabe10|Eng bewerteter heutiger R3-Ablauf: Abstecksignal, AUS-ACK, elektrische Ruhe, Besitz-/Reservefreigabe vor Empfängerstart, unabhängige EIN-/Leistungsantwort. R1 sicherer Stopp und R2 konservative Reservefreigabe ergänzen reale Stärken. Volle10 Punkte ausschließlich für diese konkret belegten Normal-/Schutzstopp-/Übergabeketten, nicht alle möglichen Starts/Fehlersituationen.|10/10|
|Phasen10|R3 bestätigte1P, kein heutiger vollständiger Phasenwechsel. Datierte EQE1P→3P-Teilabnahme#274 bleibt anerkannt; ihre Übertragbarkeit auf alle seitdem geänderten Start-/Phasenfälle ist hier nicht vollständig geprüft.|unbewertet|
|Wirksame Schutzreaktionen15|R1 konservatives AUS, R2 keine Freigabe bei positiven Restwerten; keine vollständige Grenz-/Negativfallabnahme, protectionAssessment not-assessed.|unbewertet|
|Zuständigkeit/Freigaben10|Historische und aktuelle Teilfenster mit Besitz-/Freigaben belegt. Herkunft des R1-Konflikts und vollständige historische Fremdschreiberkette offen; aktueller Skriptstatus wird nicht zurückdatiert.|unbewertet|
|Quellenabdeckung10|Alle wesentlichen Quellen99,7907% der abgeschlossenen Periode gedeckt,180,815 s unbekannt ausdrücklich erhalten. Hohe, unvollständige Abdeckung, vergleichbares Kriterium wie gestern.|9/10|
|Original-/Zustellintegrität10|0 heutige beobachtete Verluste/WriteErrors/Resets statt gestern77; reale produktive Originaltreffer und natürliche späte Bestätigungen vorhanden. Vier Transport-Fristüberschreitungen sowie fehlende durchgehende Volltag-Zustellabnahme begrenzen auf7. Keine Punkte für gelungene externe Abfragen, kleinere Prüfauswahl, Code oder bloßen Pufferabbau.|7/10|
|Nachvollziehbare Diagnose5|Drei Wirkungsketten mit Code-/Originalzeit/ACK/Reserve geprüft, S1 getrennt von externem Lesen.15 Ereignisse/49 Episoden und203 historische Fehlerdetails verdrängt, R1-/SQL-Ausgangsursachen offen.|4/5|

**30/35=85,7/100 normiert, bewertetes Gewicht35/100, unbekannt65/100; kein Gesamtscore/Freigabe.** Vergleich03.11. zu02.11.: Aufzeichnung20/25 statt18/25, übriger bewerteter Start-/Stoppumfang10/10; zusammen30/35 statt28/35. Unterschied+2 im gleichen35er Gewicht, keine Aussage„gesamte Anlage um5,7 Punkte besser“. Historische71/100 vom23.10. sind kein heutiger Score und nicht unmittelbar vergleichbar.

Nächste Schritte, ohne Zusatzlauf:
1. **Nächster natürlicher Stromkonflikt / nächster regulärer Bericht:** vorhandene go-e-HTTP-/Antwortprovenienz mit Auftrag/ACK/elektrischer Wirkung korrelieren, sofern verfügbar. Kriterium: erneute ältere Antwort von echtem neuen Fremd-/Gerätebefehl unterscheiden. BestehendenPR366/#216 nutzen, keinen zweiten Patch oder pauschale Schutzlockerung.
2. **Nächste natürliche SQL-Verzögerung:** vorhandene DB-/Pool-/Netz- und Callbackbelege im engen Ereignisabschnitt zuordnen. Kriterium: konkrete wartende Phase mit Backendabschluss und exaktem Originalnachweis, ohne neue Verluste/Ablaufverschleierung. Keine künstlichen Tests oder automatische Recovery.
3. **Nächster regulärer Tagesbericht nach04.11.00:00:** abgeschlossenen03.11.-Vorabvergleich auf gemeinsame96/96 Paare aller vier Kandidaten prüfen. Kriterium vollständige identische Messintervalle, Tagezahl/Fehler getrennt; keine produktive Umschaltung.

**Keine zusätzliche Codeänderung begründet.** Keine neuen Tags/Releases, keine Issues aus unbelegter Ursache geschlossen.

</details>


<!-- switch-replacement-20261103 -->
## Nachtrag 03.11.2026 – Switchtausch gegen 20:30 Uhr MEZ

Betreiberangabe von Carsten: Am 03.11.2026 wurde gegen **20:30 Uhr Europe/Berlin** der Switch getauscht; Fehler in diesem Zeitraum ordnet der Betreiber dem Tausch zu. Zeitlich passende Netzwerk-, Verbindungs- und Messwertunterbrechungen sind damit als Wartungskontext zu berücksichtigen, nicht allein als neuer EMS-Softwarefehler oder zusätzlicher Scoreabzug. Exakte Beginn-/Endzeiten und einzelne betroffene Meldungen sind durch diese Angabe nicht unabhängig nachgemessen; daraus keine pauschale Erklärung anderer Schutz- oder Ausgangsfehler ableiten. Tatsächliche Aufzeichnungslücken bleiben erhalten.

Der Wechsel liegt **nach dem Bilanzende 03.11.20:00 Uhr** dieses Berichts. Die vier zuvor dokumentierten produktiven SQL-Prüffristüberschreitungen um 00:06, 06:06, 12:06 und 18:06 Uhr sowie der EQV-Konflikt um 13:55 Uhr werden dadurch nicht rückwirkend erklärt. Bilanz und vorläufiger Teilscore bleiben unverändert. Für die folgende Bilanzperiode 03.11.20:00–04.11.20:00 Uhr ist der Wartungskontext bei der Zuordnung zeitlich passender Ereignisse mitzunehmen.

Nur dokumentarischer Nachtrag: keine erneute Historienabfrage, keine Wiederöffnung des abgeschlossenen Abrufwegs und keine Anlagenänderung.


