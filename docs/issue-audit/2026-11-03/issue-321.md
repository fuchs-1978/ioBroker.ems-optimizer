# Issue #321 – [SQL 2026-11-02] EMS-Livebetrieb: Tagesauswertung

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/321. Letzte Issue-Änderung: 2026-11-02T19:14:56Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

Carsten, **Weiterbetrieb: im beobachteten Umfang vertretbar; Detailaufzeichnung weiterhin beeinträchtigt.** EHZ-Anlauf und ein Mii-Telemetriehalt sind real nachvollziehbar. Der Mii-Stopp um13:30 war eine Schutzreaktion bei veralteter Leistung und noch unbestätigter Stromrücknahme. Eine vollständige Schutz-/Anlagenabnahme ist das nicht.

**Rahmen:** Arbeitsbeginn02.11.2026,19:57:08,489 MEZ; Deadline20:42:08,489. Referenz01.11.19:57:08,489–02.11.19:57:08,489, Europe/Berlin. Genau ein Primärabruf, schema1, Zustand19:57:15,220. Passend ist **current01.11.20:00–02.11.20:00**, beobachtet bis **19:57:15,091**; das liegt6,602 s nach dem fixierten Referenzende. Noch zukünftige164,909 s bis Periodenende sind keine vergangene Lücke. Previous31.10.20:00–01.11.20:00 geprüft; keine Grenzennachladung.

**Stand:** installiert common.version/installedVersion und laufend **alpha.190**, Versionszustand13:56:26,635; jüngster Startlog13:56:09,175. Installierter Commit unbekannt. [main b94bc05](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/b94bc05d7632178cc4c51e5de28f0bc51f72c4e7), package/io-package190. PR#315/187, #317/188, #318/189, #319/190 bereits gemergt; keine zusätzliche Änderung in diesem Lauf. Jüngstes Release alpha.162/28.10., getrennt von Merge und Installation. Master/reale Ausgänge EIN, PRODUCTION, sql.0; WB0 feste1P, WB1/2 EMS-Phasenführung, EHZ Feinregler. Batterie weiterhin present=false/control=false.

**Wichtigste Befunde:**
- Geschätzte Leistungsintegrale: Bezug **7,435**, Export **3,029**, PV **12,679**, BHKW separat **21,767**, EHZ **1,334 kWh**; Mii5,086/EQV3,434/EQE2,142. Keine Zählerdifferenzen. Vermeidbares Exportpotenzial nicht belastbar quantifizierbar.
- **EHZ08:54:** zunächst unter900-W-Schichtungsminimum; nach Überschreiten900-W-Auftrag, echter Modbus-Reset, rund920 W Ist, NVP im Totband. Normal im untersuchten Abschnitt; keine zweite Grenzkorrektur.
- **Mii13:30:** Leistung33,688 s alt, Rücknahme13→11 A noch unbestätigt; gemeinsame Zuteilung deshalb ungültig. AUS, ACK, elektrische Null und Wiederanlauf belegt. **Mii16:47:** bestätigte6 A/1P mit1.380-W-Reserve bei veralteter Telemetrie gehalten, kein neuer Wallboxbefehl; danach frische1,32 kW und normale Regelung. WLAN als physische Ursache nicht bewiesen.
- **77 verworfene Originalrecords**, ebenso77 WriteErrors-Beobachtungen: derselbe Verlust, nicht 154. 45 Sequenzlücken im Mii-Fenster exakt passenden Queue-Abweisungen zugeordnet. Ursache lokaler Verzögerungen nicht vollständig geklärt.
- Vier erhaltene heutige SQL-Fristüberschreitungen, Transportwartezeiten537–980 s; später jeweils13/14 Originale bestätigt, auch ein neuer Fall unter190. Aktuell wieder exakte SQL-Treffer ohne Fence. Keine behauptete Behebung der Datenbank-/Transportursache. EQE-Stopp10:28 bleibt mangels kompletter Wirkungskette offen. **Keine Codeänderung begründet.**

**Prognosevergleich und Wetterhistorie:** Erster vollständiger Ist-Vergleich: **01.11.2026**, ein abgeschlossener Tag, identische96/96 Viertelstunden, Prognose vor Tagesbeginn gespeichert. Ist24,274 kWh. Median/Lasso/50:50/Hybrid: MAE **274/307/271/333 W**, RMSE **436/388/389/449 W**, Energieabweichung **−2,816/+2,229/−0,293/+2,229 kWh**. Ein Tag belegt keinen allgemeinen Sieger. Training5.001 Werte/53 Tage. Für03.11.00:00–04.11.00:00 sind96 Vorhersageslots vorab gespeichert:22,069/26,139/24,104/26,139 kWh, keine Gütewerte. Produktion bleibt Median. Wetterarchiv letzter gemeldeter Stand02.11.19:34:13; vollständige DB-Zustellung und Strahlungsabdeckung aus Status allein nicht nachgewiesen. Anbieterwerte sind keine lokalen Messungen. Raumhistorie12/12 Originalquellen mindestens90 Tage, Kind3 elektrisch; keine neuen Modellmerkmale oder Zustellabnahme.

**Vorläufiger Teilscore28/35=80/100 normiert; bewertetes Gewicht35/100,65 unbekannt. Kein Gesamtscore und keine80-Punkte-Freigabe.** Vergleichbarer Aufzeichnungsanteil18/25 gegenüber15/25 am01.11.; keine pauschale Aussage über alle Reglerfunktionen.

<details><summary>Quellenabdeckung, Verluste und Bewertungsgrenzen</summary>

|Quelle|positive Energie kWh|Export kWh|Abdeckung s / hh:mm:ss|Vergangen unbekannt s / hh:mm:ss|
|---|---:|---:|---|---|
|grid|7.435|3.029|86115.395 / 23:55:15|119.696 / 00:01:59|
|pv|12.679|—|86115.395 / 23:55:15|119.696 / 00:01:59|
|bhkw|21.767|—|86115.395 / 23:55:15|119.696 / 00:01:59|
|wallbox0|5.086|—|85947.343 / 23:52:27|287.748 / 00:04:47|
|wallbox1|3.434|—|86070.437 / 23:54:30|164.654 / 00:02:44|
|wallbox2|2.142|—|86095.329 / 23:54:55|139.762 / 00:02:19|
|ehz|1.334|—|86115.395 / 23:55:15|119.696 / 00:01:59|

Für jede Quelle separat164,909 s noch zukünftige Periodenzeit; hh:mm:ss abgerundet. Tageswerte beziehen sich ausschließlich auf die gedeckte Zeit. Mittelwerte Netz meanW184,165/meanAbsoluteW437,428 W sind verschiedene Größen, kein Einsparpotenzial. Winziger negativer Mii-Rohanteil0,014469 Wh ist keine behauptete Fahrzeugerzeugung.

Historische PV-Quelle javascript.0.PV.Eigenerzeugung ohne BHKW; BHKW nicht nochmals zum SMA-Budget addieren. EHZ-Ist aus1074/1075/1076, nicht1000_Power. Schattenmodell bei Master EIN pausiert, keine realen Nullwerte daraus.

34 beobachtete Ereignisse, eventOverflow26, protectedOverflow0; acht erhalten, davon sechs Stopps/zwei Recorderbeobachtungen. investigation.overflow56 =21 Export+33 deviation+2 sampling-gap, overflowBeforeRetention0; keine zusätzliche Zählung der Typverdrängungen. protectionAssessment bleibt not-assessed, avoidableExportWh=null. Vier Starts beobachtet. Zwei erhaltene sampling-gaps31,197 s um23:55 und30,475 s um13:56; zweite durch190-Neustart zeitlich erklärt, keine zusätzliche Fehlerwertung. Für erste Lücke kein zeitlich vollständiger Startlog im begrenzten Ausschnitt; sampling-gap allein beweist weder Neustart noch SQL-Verlust.

Nachtüberschuss ohne eigenen Untersuchungsplatz/Scoreabzug. Keine SQL-Suche nach bloß möglicher Haushaltsabregelung. Laufende abendliche Bezugsepisode bei obligatorischer Mii-Mindestladung ist ohne zusätzliche damalige Reduktionsfreigabe kein belegter Regelfehler. Aktuelle Konfiguration nicht auf frühere Ereignisse übertragen. Keine Energiehochrechnung unbekannter Abschnitte.

</details>

<details><summary>Fallplan R1–R10 / S1–S5 und Ergebnisse</summary>

|Fall/Zeit|Originalquelle und tatsächlich geprüftes Fenster|Engste Erklärung und Grenze|Status|
|---|---|---|---|
|R1 EHZ02.11.08:54|suggested08:53:40,224–08:55:40,224;564 Originale,530 rekonstruierbar,34 Anfangsrecords ohne Basis;187|900-W-Minimum bei oben67,6/unten41,1°C, Temperaturfreigabe bis9 kW. Zunächst833–865 W Überschuss und0 W. Zentralziel900 W ab08:54:41,064; Auftrag08:54:45,507, Reset08:54:47,079/ACKtrue;1074 meldet920 W um08:54:48,966. Danach Netzpunkt ungefähr−8 bis−32 W. Plan gültig, keine Altreserve. Keine Erklärung der gesamten66-Minuten-Episode aus zwei Minuten.|**normal erklärt**, bekannte Minimumsignatur/aktuelle Teilabnahme; kein neuer Grenzfall/Fix.|
|R2 Mii02.11.13:30:58,364|gezielter Stoppkontext13:29:58,364–13:31:58,364;696 Originale,631 rekonstruierbar/65 ohne Basis;189|13-A-Ladung bestätigt.11-A-Rücknahme angefordert13:30:54,087, beim Stopp noch command_ack. Quelle power ts13:30:24,417; Zuteilungsdiagnose13:30:58,105: source-stale, Alter33.688 ms/max30.000. Kein qualifizierter bestätigter Haltefall. AUS-Auftrag58,515; unabhängiges allow0 ACK13:30:59,735. Positive2,9 kW noch13:31:01,195, elektrische Null ts13:31:04,460 im erhaltenen Frame11281; zusätzlicher unabhängiger Rohwert0 um13:31:07,564. Besitzrückgabe/Neustartfolge, EIN-ACK11,690, erste erhaltene positive Probe1,32 kW um13:31:30,428; anschließend12→13 A bestätigt.45 dazwischen fehlende Originale offen erhalten.|**normal erklärt** im Schutz-/Wiederanlaufpfad; physische Ursache verspäteter Telemetrie offen, keine komplette verlustfreie Stoppkette behauptet.|
|R3 Mii02.11.16:47–16:49|suggested16:47:40,483–16:49:40,483;457 Originale,454 rekonstruierbar/3 ohne Basis;190|Eigene bestätigte6 A/1P; Quellenalter bis79 s, unveränderte1.380-W-Reserve, frische SMA-Überwachung, kein go-e.0-Auftrag im gesamten geladenen Abschnitt. Originalleistung wieder1,32 kW ts16:48:40,067/empfangen40,311. Nach erneuerter Zuteilung normale Regelung16:48:46. Spätere weitere Quellendelle am Fensterrand nicht vollständig abgenommen; reale Leistung während fehlender Messwerte unbekannt.|**normal erklärt**, gezielter Wirksamkeitsnachweis des bekannten Telemetrie-Haltefalls; kein neuer Fehler.|
|R4 EQE02.11.10:28:16,063|geschütztes Tagesereignis, Warnung und unabhängige ioBroker-Direktlesediagnose; kein zusätzliches SQL-Fenster|error=0/ACKtrue/q0, aber über31 s alt; auch Leistung1,7 kW/Ströme alt. Stopp unter187, vor188-Update. Ursprünglicher Bestätigungs-/Pending-/Reservekontext und vollständige AUS-/Leistungskette fehlen. Nicht allein als Sonnenmangel oder WLAN ursachenerklärt.|**offen**, bekannte Telemetrie-Familie/gezielte neue Folgeprüfung nur teilweise; kein zweiter Haltefix.|
|R5–R10|Kompaktbilanz, Logs, bekannte Fälle/PR315–319|Manuelle Übergabe11:32 vor189 gehört zur bereits bearbeiteten Signatur vonPR318; Mii-Abstecken17:34 und Budgetstopps nicht ohne Originalkette als neue Fehler erklärt. Keine weiteren unabhängig geeigneten neuen Fälle ausgewählt; verdrängte Episoden bleiben unbekannt.|**kein geeigneter neuer Fall** für freie Plätze.|
|S1 #60 neue02.11.-Verluste|Kompaktbilanz, vier aktuelle Verlustkontexte, R2-Sequenzen und Journalcode/Diagnose|77 Verluste heute; R2 fehlend11259–11280=22 und11286–11308=23 exakt in Session1793619611278. Rohqueue94/128 Einträge,8.315.499–8.331.037 Bytes an8-MiB-Grenze, Wartezeit bis7,114 s. Aktive verification-/Appendphase, einmal offene Datei-Sync; vorheriges Batch2,104 s, anderes3,306 s mit2,320 s Warten. Keine bewiesene NAS-/physische Storageursache; nicht77 Dateisystemfehler.|**Fehler belegt**, bestehender#60-Folgefall; Ursache der Verzögerungen offen.|
|S2 #60 SQL-Zustellung|Fehlercheckpoint schema1/max16/16KiB, Delivery/Recovery, begrenzte SQL-Logs,PR317/319 und aktuellerSQL-Code|Vier heutige deadline-Fälle später korrekt abgeschlossen; siehe Tabelle.12:13 Logs connect ETIMEDOUT/ER_HOST_IS_BLOCKED belegen Verbindungsstörung vor190; keine automatische Entsperrung.18:06 neuer langer SELECT-Transport unter190, kein Nachweis einer erneuten Hostsperre. Frische spätere genaue Originaltreffer, kein aktueller Fence. DB-Ausführung/Pool/Netz/Rücktransport nicht isoliert.|**Fehler belegt**, bekannte#60-Folgeprüfung; kein zweiter Backoff-/Late-Callback-Patch.|
|S3–S5|externer Leseweg und Transportseiten|72 passende historische Seiten vollständig;0 externe Fehler. Zusätzlich eine anfangs irrtümlich an die nicht vorhandene Suffix-ID gerichtete5-s-Abfrage leer; Aufruf transparent separat gezählt, anschließend ID per Objektsuche korrigiert. Zugehörige id-not-found-Logwarnung stammt von dieser Untersuchung und ist kein neuer Produktivfehler.|**kein geeigneter neuer Fall**.|

**Zählung:** Regler tatsächlich untersucht4/10 (R4 nur teilweise), SQL-/Recorder2/5, insgesamt6/15.3 normal erklärt,2 reale Aufzeichnungs-/SQL-Fehlerbefunde mit offener Ausgangsursache,1 offener Reglerfall;0 Codekorrekturen/PRs.2 neue reale erfolgreiche Teilabläufe R1/R3, R2 Schutz-/Wiederanlauf mit Detailverlustgrenze; keine vollständige neue Anlagenabnahme. **Neue Ursachenplätze:**1 neuer Reglerkontext (R2),0 neue SQL-Ursachen; bekannte R1-/R3-/R4-/#60-Zuordnungen nicht als neue Grundfälle gezählt.

</details>

<details><summary>Code, Originalbelege, SQL und gemeinsamer Prüfstand</summary>

[EHZ-Pfad](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b94bc05d7632178cc4c51e5de28f0bc51f72c4e7/lib/engine/dhw-output.js#L772) begrenzt auf zentrales Budget; unter Schichtungsminimum kein Heizstart, bei freigegebenem Budget Feedback-Nachführung. Kein erneuter Umbau des bekannten900-W-Minimums.187 behebt lautPR315 identische überlappende Refreshwrites; heutiger guter Anlauf beweist weder jede Fehlerfreiheit dieses Fixes noch nachträglich die ursprüngliche Ursache vom01.11.

[Wallbox-Pfad](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b94bc05d7632178cc4c51e5de28f0bc51f72c4e7/lib/wallbox-output.js#L1915) prüft Haltemöglichkeit vor normalem Gate; [Haltepfad](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b94bc05d7632178cc4c51e5de28f0bc51f72c4e7/lib/wallbox-telemetry-bridge.js#L32) verlangt qualifizierten bestätigten Ausgang bzw. ausdrücklich bezeugte begrenzte offene Befehlsfortsetzung. Im R2 ist ein neuer Stromauftrag unbestätigt und connection weiterhin true; der begrenzte Sonderpfad für expliziten Linkausfall ist damit nicht automatisch freigegeben. Keine generelle Alterslockerung aus einer vermeintlich noch vorhandenen Leistung. WallboxOutput und Telemetriebridge189-Merge600bd2d gegenüber aktuellem190 vollständig textgleich. Die stop()-Methode ist zusätzlich gegenüber dem im gestrigen Bericht geprüften186-Commit49ce291 textgleich; frühere datierte Stopp-Teilabnahme bleibt eng übertragbar.

R1 Session1793573708777 seq93883–94446, keine internen Sequenzlücken.
R2 Session1793619611278 seq10902–11642 mit45 exakt zugeordneten Fehlrecords; ursprüngliche Basis fehlt für65 Anfangsrecords.
R3 Session1793624168427 seq32334–32790, keine internen Sequenzlücken;3 Anfangsrecords ohne Basis.
Insgesamt140 Transportwerte,1.717 eindeutige Originale,1.615 rekonstruierbar/102 initial unbekannt.16.818 deduplizierte Quellenproben aus erhaltenen Originalen;0 beobachtete Identitäts-/Inhaltskonflikte. Originale ts/lc/ACK/q/NULL und receivedAt erhalten; Bündel sind keine simultanen Geräteframes. Vorlaufproben sind keine rückwirkenden Vollentscheidungen. Keine zusätzlichen Basisfenster.

**Externer Abruf:** drei disjunkte120-s-Fenster,72 passende5-s-Seiten/Limit20, plus1 leerer5-s-Aufruf auf falsche Suffix-ID innerhalb R1; **73 Aufrufe insgesamt**,0 Gesamt-/0 Folgefehler,0 Retries,0 separate SQL-Ursachendiagnoseabfragen. Genau eine Historienanfrage gleichzeitig, nach vollständigem Sichern/Verarbeiten mindestens2,05 s Pause. Größte tatsächliche JSON-Antwort110.304 Zeichen, längste passende Werkzeuglaufzeit3,183 s; keine gelieferten Truncation-/Offset-/Downloadhinweise, kein Limit20 erreicht. Erfolgreiche Seiten nicht wiederholt. Aktueller main-Decoder und Transportcode vollständig verwendet: schema4 atomar validiert/entpackt,16 Originale/2MiB entpackt/60KiB neue Hülle; schema3-Basen/Sequenzen erhalten. Ein lokaler Analysezugriff auf event=null korrigiert, kein SQL-Fehler. Rohseiten lokal vorhanden, Prüfstand erst temporär validiert und atomar ersetzt. **Abrufweg für02.11. geschlossen**, keine automatische Nachholung.

|Produktive Prüfanfrage02.11.|Callback|Transportwartezeit s|Spät exakt bestätigt|
|---|---|---:|---:|
|00:06:40,793|00:23:00,956|980,151|13|
|06:06:41,920|06:15:42,377|540,445|14|
|12:06:43,308|12:21:42,826|899,484|14|
|18:06:44,453|18:15:41,248|536,784|14|

Werkzeug-/Transportlaufzeit ist keine isolierte SQL-Ausführungszeit. Beim Snapshot19:57:40/41: letzter exakter Originalnachweis19:57:39,687; SELECT17 Originale,91,957 ms Transport, keine offenen Requests/Fence; Leser/Schreiber ready. Journal35 Records/632.133 Bytes,9 unbestätigt, Queue1/101.101 Bytes. Historische expired17.390/unconfirmed8.537 unverändert; keine Recovery aus Alterung ableiten. sqlRecoveryInspectionnull.199 kumulative Fehlercheckpoint-Verdrängungen, restored; leerer/gekürzter Verlauf beweist keine historische Fehlerfreiheit. Verlustkontexte44 verdrängte Episoden/601 Records kumulativ, nicht zusätzlich zum Tages77 zählen.

SourcePowerHistory complete, sql.0/relog600 s, vier Originalquellen already-configured; zusätzlich alle vier Originalobjekte heute gelesen: SQL enabled, changesOnly=true, changesRelogInterval600, changesMinDelta0, ignoreZero=false. Das belegt Konfiguration, keine lückenlose Zustellung.10-min-Wiederholung unveränderter Skalarleistung allein ist kein Ausfallbeweis und gilt nicht für DecisionRecords. Keine DB-Prozess-/Sperr-/Indexsicht, keine Konfiguration/Testwrites/Recovery/Installation/Neustarts durch diesen Lauf.

Eigene Issues#249/#263/#271/#274/#60/#216 sowie jüngster Bericht#313 einschließlich21:28-Nachtrag frisch gelesen, Autoren fuchs-1978 bestätigt;#7 und relevante#60/#284-Kommentare gelesen. Kein heutiges Tagesissue vor Start oder vor Speicherung gefunden, kein zugänglicher heutiger Prüfstand; keine Altfenster erneut geladen. Alte lokale Belegpfade waren nicht vorhanden und wurden nicht als unabhängige Belege ausgegeben. [go-ePR366](https://github.com/MK-2001/ioBroker.go-e/pull/366) weiterhin offen/nicht gemergt.

</details>

<details><summary>Prognosemetriken, Scorebegründung und nächste Schritte</summary>

Alle Prognosemetriken beziehen sich auf **01.11.00:00–02.11.00:00**, dieselben96 gemessenen Viertelstunden. issuedAt31.10.19:16:11,481 liegt vollständig vor Lieferung. Evaluation.completeDays1; heutiger02.11. noch offen und nicht null gesetzt.

|Kandidat|pairedSlots|MAE W|RMSE W|Prognoseenergie kWh|Bias Prognose−Ist kWh|
|---|---:|---:|---:|---:|---:|
|Median|96|274,387|435,927|21,45775|−2,815845|
|Lasso|96|306,613|387,574|26,50250|+2,228905|
|50/50 fest|96|270,670|388,719|23,980125|−0,293470|
|Lassoenergie/Medianverlauf|96|333,279|448,518|26,50250|+2,228905|

Ist24,273595 kWh. Lasso hat an diesem Tag geringeren RMSE, Median geringeren MAE; keine allgemeine Überlegenheit. Die Mischung ist fest, keine adaptive Gewichtung. Hybrid erhält die Lasso-Tagesenergie und den Medianverlauf; unterschiedliche Energie und Zeitfehler getrennt bewerten. Keine rückwirkenden Kombiprognosen alter Tage erfunden.

Aktuelles Modell5.001 Trainingswerte/53 Tage; Training13:56:26,670, aktuelle Abstimmungsfehler keine Vorabgüte. Gespeicherte Vorhersage für03.11.00:00–04.11.00:00 stammt aus02.11.00:10:06,515,96 Slots/ensembleVersion1; nicht durch späteres Training zum Ist-Vergleich umdeuten. Temperatur-/Heizgradkoeffizienten derzeit0; zusätzliche Wetterhistorie kein nachgewiesener Heizlastgewinn. Archivstatus allein belegt weder alle Wettergrößen/Strahlung noch vollständige Zustellung; Status_JSON-Objekt nicht vorhanden. Raumhistorie meldet nur geprüfte bestehende Originalreihen und Aufbewahrung, keine Messvollständigkeit.

|Unterkriterium|Belegter Umfang, Stärke/Defizit und Begründung|Punkte|
|---|---|---:|
|Zuteilung/Nachregelung20|R1 Anlauf und Nachregelung real gut; nur zwei Minuten. Gesamte Zuteilung, Handovers und R4 nicht ausreichend vergleichbar bewertet.|unbewertet|
|Regelruhe10|R1 Totband/R3 stabiler6-A-Halt; keine repräsentative Tages-Regelruhe.|unbewertet|
|Start/Stopp/Reserve10|Datierte EQV-Teilabnahme01.11./#313 mit Auftrag→ACK→elektrisch Null→Reservefreigabe; stop()-Code unverändert. R2 heutige Reaktion eingegrenzt,45 Recordlücken und Reserve-/Neustartübergang bleiben ausdrücklich begrenzt.10 Punkte gelten nur dem früher vollständig belegten Ablauf, nicht allen heutigen Starts/Übergaben.|10/10|
|Phasen10|Keine neue vollständige Phasenwechselkette; feste1P allein genügt nicht.|unbewertet|
|Wirksame Schutzreaktionen15|R2 zeigt konkrete Altersreaktion, R3 konservativen Halt. Vollständige Negativ-/Grenzfälle fehlen, protectionAssessment not-assessed.|unbewertet|
|Zuständigkeit/Freigaben10|Ausgangsbesitz/SMA-Kontext in Teilfenstern nachvollziehbar; keine vollständige heutige Schreiber-/Rückgabeabnahme.|unbewertet|
|Quellenabdeckung10|Mindestens99,66% der vergangenen Zeit je Hauptquelle;119,696–287,748 s vergangene Lücken offen. Hohe, aber unvollständige Abdeckung.|9/10|
|Original-/Zustellintegrität10|1.717 natürliche Originale empfangen, exakte produktive SQL-Nachweise.77 reale Verluste einschließlich45 lokal eindeutig belegter Lücken und vier lange Fristfälle begrenzen die Bewertung erheblich. Besserer beobachteter Umfang als01.11., keine nachhaltige Verlustfreiheit.|5/10|
|Nachvollziehbare Diagnose5|R1/R2/R3 zeitlich/codebezogen erklärt,45 Lücken bis Rohqueuegrenze zugeordnet;26 Ereignisse/56 Episoden und199 Fehlerdetails verdrängt, physische Ursachen/R4 offen.|4/5|

**28/35=80/100 normiert, bewertetes Gewicht35/100, unbekannt65/100.** Aufzeichnung18/25 statt15/25 am01.11.; enger Vergleich anhand desselben Gewichts. Der normierte Teilwert ist kein Gesamtscore, keine allgemeine80-Punkte-Abnahme und nicht mit historischen71 Gesamtscorepunkten vom23.10. gleichzusetzen. Keine Punkte für Code, CI, Version, Installation, Laufzeit oder erfolgreiche Abfrage vergeben.

Nächste Schritte ohne Zusatzlauf:
1. Nächster regulärer Bericht: zweiter abgeschlossener Vorabvergleich, Kriterium identische96/96-Paare aller vier Kandidaten; keine Routine-Prognose-SQL-Serie und keine Umschaltung.
2. Nächster natürlicher unklarer Telemetriestopp: genauen offenen Auftrag/Witness, Quellenzeit, SMA-/Reservekontext und AUS-/Leistungskette im bestehenden#7/#216 prüfen. Kriterium bestätigter Haltefall versus unbestätigter Stellauftrag trennbar; kein erneutes Laden heutiger Fenster.
3. Nächste natürliche#60-Störung: vorhandene I/O-/Verbindungs-/Leser-/Schreiberbelege zeitlich zuordnen. Kriterium frische Originaltreffer bei nachvollziehbarem Unbestätigten-/Bytebestand ohne neue Verlustzunahme. Keine automatische Recovery oder pauschale Queue-/Timeout-/Indexänderung.

</details>

