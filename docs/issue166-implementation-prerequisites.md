# #166: unabhängiger Bilanzkern und offene Integration am 21.10.2026

> Historischer Stand des vorbereitenden Kerns bis alpha.116 / PR #221.
> Die anschließende aktive Opt-in-Anbindung und die erneute Quellenprüfung
> stehen in [issue166-runtime-integration.md](issue166-runtime-integration.md).
> EEBUS ist inzwischen erreichbar; normativer Download und konkreter
> LPC-Endpunktvertrag bleiben ungeprüft. Die früheren Timeoutbefunde unten
> dokumentieren ausschließlich den damaligen Abruf.

## Ausgangspunkt und Abschlussstatus

Codebasis ist main
[`76db3611b56dbe5c2335b7d78c8ccef793e35874`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/76db3611b56dbe5c2335b7d78c8ccef793e35874),
alpha.115. [#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166)
und [#220](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/220) wurden
vor Verwendung anhand GitHub-Metadaten dem Autor `fuchs-1978` zugeordnet.
#166 hatte keine Kommentare. Weitere Arbeitsgrundlagen sind die ebenfalls
autorengeprüften #219, #60, #7, #8, #216 und #26; keine fremden Issues.

**Der unabhängige Bilanzkern ist in [PR #221](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/221)
implementiert und getestet; der Gesamtumfang von #166 ist damit noch nicht abgeschlossen.**
Dieser Teilschritt ist eine reine protokollunabhängige Berechnung mit Unit-
Gegenproben. Er wird nicht an Engine, Ausgangscontroller oder Admin angeschlossen
und trifft keine Annahme über die unbekannte LPC-Schnittstelle. Die bisherige
produktive generische LPC-/Bruttobegrenzung bleibt unverändert. Nach Abschluss
dieses zunächst unveröffentlichten Teilschritts hat der Nutzer die Veröffentlichung
ausdrücklich beauftragt. Dafür wird alpha.116 mit konsistenten Manifesten und
Laufzeitanzeigen vorbereitet; Main-Übernahme und neues GitHub-Release erfolgen
erst nach den abschließenden Prüfungen. Installation und Eingriffe in das laufende
EMS gehören weiterhin nicht zum Auftrag. Die Diagnosefortschreibung steht getrennt in
[issue220-diagnosis-followup.md](issue220-diagnosis-followup.md).

## Quellenprüfung nach Veröffentlichung der Umgebung, 21.10.2026

Die veröffentlichte Netzkonfiguration ist jetzt wirksam: aktueller Runtime-
Status mit `observations_current=true`, Revision 3 und Netzwerkstatus `enforced`.
Die offiziellen Domains sind erlaubt. Die frühere CONNECT-403-Sperre für
BNetzA/VDE ist aufgehoben. Folgende Originale wurden neu mit HTTP 200 geladen
und als HTML beziehungsweise mit `pdftotext -layout` gelesen:

| Quelle | Geprüfte Aussage für den Restumfang |
| --- | --- |
| [BNetzA-Verbraucherinformation](https://www.bundesnetzagentur.de/DE/Vportal/Energie/SteuerbareVBE/artikel.html) | Normaler Haushaltsverbrauch bleibt unberührt. Selbst erzeugter Strom wird nicht gegen die Netzbezugsgrenze verrechnet. Die zulässige Netzleistung gilt für die zugeordneten SteuVE. |
| [BK6-22-300 Anlage 1](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Beschluss/BK6-22-300_Beschluss_Anlage1.pdf?__blob=publicationFile&v=1), Ziff. 2.3, 2.4, 4.4–4.6 | Zeitgleicher netzwirksamer Bezug der zugeordneten Gruppe; WP inklusive Zusatz-/Notheizung, Speicher hinsichtlich Einspeicherung; gemeinsamer EMS-Sollwert. Netzsteuerung hat Vorrang vor marktlicher Steuerung. |
| [BNetzA Mitteilung 6](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Mitteilung/Mitteilung_06/Mitteilung_Nr_06.html?nn=877500) | Empfehlung der finalen FNN-Regeln innerhalb ihres jeweiligen Umfangs; keine darüber hinausgehende Erzeugungsfreigabe ableiten. |
| [VDE-FNN Mindestleistung, April 2025](https://www.vde.com/resource/blob/2384602/0cb47de901b1129acad8510257ecc582/vde-fnn-hinweis-mindestleistung-data.pdf), Kap. 2–4 | Keine Änderung der bestehenden Faktoren/Formeln empfohlen. Vorhandene GZF-/Budgetquellenberechnung wiederverwenden. |

SHA256 der tatsächlich geladenen PDF-Antworten:

- BNetzA Anlage 1: `c8cf59ea475bb4cb866e8b4eeb4b3e2b3306cb3f3ff1c432799b090bfb5b2d35`
- VDE-FNN: `d20fdf17b34370fe8e7878cf6c1e22ad5f3f8fa05d9bf31a2477e898da6cb067`

Die Quellen bestätigen einen Gruppen-Netzbezugsdeckel mit belegter
Eigenversorgung, liefern aber keine private ioBroker-Topologie. Gruppen-IDs,
AC-Messabdeckung, Quellenkohärenz und Reservierungsverfahren unten sind
technische Adapterverträge; sie werden nicht als einzelne vorgeschriebene
Normformel oder als Zertifizierung ausgegeben.

**Verbleibender Zugriffspunkt ist EEBUS.** `https://www.eebus.org/` liefert nach
45 s keinen Inhalt (curl Exit 28, 0 Bytes). Der einmal alternativ geprüfte
kanonische Host `https://eebus.org/` endet nach 25,002 s ebenfalls ohne Inhalt.
Die HTTP-200-Zeile der Proxy-CONNECT-Antwort ist keine erfolgreiche Antwort des
Ursprungsservers. Es wurde keine aktuell zugängliche, nachweislich offizielle
normative LPC-Spezifikation festgestellt. Öffentlicher Fremdadaptercode ist
dafür kein Ersatz und belegt auch nicht den tatsächlich installierten Endpunkt.
Die Ursache des Timeouts ist nicht nachgewiesen.

Eine anschließend ausdrücklich beauftragte begrenzte Suche blieb auf öffentliche
GitHub-Metadaten beschränkt; die beiden erfolglosen Webabrufe wurden nicht
wiederholt. `EEBUS` liefert als Organisationsname HTTP 404. Die Suche nach
EEBUS-Organisationen fand `EEBusInitiative` ohne Domainverifikation, Homepage oder
öffentliche Repositories. Der ebenfalls nicht domainverifizierte Kandidat
`EEBUServiceGmbH` enthält ein öffentliches SPINE-Emulatorprojekt; das ist anhand
der Metadaten kein verifizierter normativer LPC-Vertrag. Der Kandidatenpfad
`EEBUServiceGmbH/eebus_specifications` liefert HTTP 404. Das beweist keine
allgemeine Abwesenheit veröffentlichter EEBUS-Spezifikationen, sondern benennt die
Grenze dieser Suche. Keine fremden Issues oder Drittanbieter-LPC-Semantik wurden
als neue Grundlage übernommen.

Die Anweisung zur Quellenprüfung erlaubte ausdrücklich die davon unabhängigen
Arbeiten. Deshalb wurde der reine Bilanzkern weiterentwickelt; die EEBUS-/LPC-Voraussetzung
bleibt für die davon abhängige Integration offen. Tatsächliche Endpoint-, Gruppen-
und Messverträge müssen vor positiver Freigabe geklärt werden. Die frühere
Aufforderung zur Veröffentlichung des Umgebungsentwurfs ist erledigt und wird
nicht wiederholt. Die anschließend beauftragte Adapterveröffentlichung umfasst
den unabhängigen Kern, keine ungeklärte LPC-Integration. Keine Installation.

## Vorhandene Funktionen wiederverwenden

`lib/grid-constraints.js` enthält Fest-/Extern-/EMS-Budgetquellen,
Teilnehmer-/GZF-Berechnung, thermische Gruppierung und externes Gesamtbudget ohne
erneute GZF-Skalierung. Admin und konservative Migration bestehen seit alpha.90.
`test/grid-constraints.test.js` prüft diese Funktionen bereits.

`currentConsumptionLimit()` in `lib/engine/realtime.js` und der unabhängige
`WallboxOutput.gridOperatorLimit()` werten dagegen weiterhin einen gemeinsamen
Bruttodeckel aus. Die Diagnose nennt ausdrücklich
`conservative-gross-ceiling; no own-generation uplift`. Die vorhandene
WP-Gesamtleistungsprüfung unterscheidet vollständige Leistung von Inverterteilleistung.

Die bestehende Teilnehmertabelle enthält Name, Typ und Anschlussleistung, jedoch
keine eindeutige Zuordnung von Ausgang, tatsächlichem Leistungszähler und
Messgrenze. Die generischen LPC-Status-/Limit-IDs enthalten ebenfalls keine
maschinenlesbare Gruppen-/Messgrenzenidentität. Unbekannte private IDs allein
verhindern keine generische Implementierung: Ein neuer expliziter, standardmäßig
deaktivierter Vertrag kann diese Bindungen definieren. Ihre physische Richtigkeit
und Aktivierung bleiben eine spätere Anlagenaufgabe.

## Unabhängiger Berechnungskern in diesem Teilschritt

`lib/grid-operator-accounting.js` stellt die reinen Funktionen
`evaluateGroupAccounting(input)`, `commandBudget(result, deviceId, requestedW)`
und `reserveGroupCommands(snapshot, proposalsObject)` bereit. Die erste berechnet
eine ausdrücklich deklarierte Gruppenbilanz; die zweite prüft einen einzelnen
Verbrauchsvorschlag, die dritte einen gemeinsamen Vorschlagsvektor. Der Kern
liest oder schreibt keine ioBroker-States, kennt keine LPC-Zustandsnamen und
vergibt keine Stellbefehle. Vorhandene GZF-/Budgetquellen werden nicht nachgebaut.

Der Eingabevertrag trennt:

- `mode`: ohne explizites `groupNet` besitzt der Kern keine neue Budgetautorität.
  Der inaktive Rückgabewert ersetzt keine Prüfung des bestehenden Bruttolimits.
- `limit` und `group`: bereits validiertes aktives Netzbudget sowie passende
  Gruppen-/Messgrenzen-IDs; Teilnehmer sind ausdrücklich deklariert. Ein Stand
  beschreibt genau eine vollständige gemeinsame Gruppe je Messgrenze. Separat
  berechnete Gruppenresultate derselben Grenze dürfen nicht als unabhängige
  Eigenstrombudgets addiert werden.
- `site` und `participantMeters`: vollständiger signierter NVP aus getrenntem
  Import/Export und nicht überlappende tatsächliche AC-Teilnehmeraufnahme.
  Gesteuerte Teilnehmer benötigen Einzelmessung; eine vollständige passive
  Aggregatmessung darf mehrere eindeutig zugeordnete Teilnehmer abdecken.
- `storage`: ausdrücklich kein Speicher oder vollständige vorzeichenbehaftete
  AC-Abdeckung. Unbekannter Umfang wird nicht als fehlender Speicher ausgegeben.
- `devices`: tatsächliche Messung, aktueller Verbrauchsbefehl und konservative
  High-Water-Reserve. Befehl und Reserve sind keine Quelle für Eigenstrom.
- Zeit-/Qualitätsvertrag: `ack=true`, `q=0`, gültige Einheit und vollständiger
  AC-Umfang, endlicher Quellenzeitpunkt bis zur Prüfuhr und begrenztes Alter.
  Der vorgegebene maximale Quellenversatz ist standardmäßig 0 ms. Ein explizit
  zugelassener Versatz beweist keine physisch synchrone Aufnahme.

Die reine Bilanz mit Teilnehmer-Bruttoaufnahme `R` und signiertem NVP `P`
ordnet Haushalts-/Nichtteilnehmerverbrauch zuerst der lokalen Versorgung zu.
Die mathematisch verfügbare lokale Leistung ist `max(0, R-P)`; die aktuell davon
gedeckte Aufnahme ist `min(R, max(0, R-P))`. Der so zugeordnete tatsächliche
Gruppennetzbezug ist `min(R, max(0, P))`. Diese Zuordnung ist eine ausdrückliche
konservative EMS-Strategie, keine als Normtext ausgegebene einzelne BNetzA-Formel.

Beispiele mit 4.200 W Netzbudget, ohne Speicher oder offene Stellwirkung:

| Teilnehmer-Ist `R` | NVP `P` | Verfügbare lokale Leistung | Gruppennetzbezug | Zulässiges Bruttobudget |
| ---: | ---: | ---: | ---: | ---: |
| 3.000 W | +5.000 W | 0 W | 3.000 W | 4.200 W |
| 3.000 W | +1.000 W | 2.000 W | 1.000 W | 6.200 W |
| 3.000 W | −1.000 W | 4.000 W | 0 W | 8.200 W |

Der dritte Fall trennt bereits genutzte lokale Aufnahme von zusätzlich
verfügbarem Export. Speicherentladung wird für die spätere zusätzliche
Verbrauchsfreigabe konservativ ausgeschlossen; diese Umsetzungspolitik darf die
Diagnose des tatsächlich beobachteten Gruppennetzbezugs nicht überschreiben.
PV, BHKW und Speicher werden nicht nochmals auf den NVP-Rest addiert.

Die Rückgabe trennt deshalb `rawOwnAvailableW`, `ownUsedW` und
`actualGroupNetW` als zugeordnete beobachtete Bilanz von
`eligibleOwnAvailableW` nach dem konservativen Speicherabzug. Von Letzterem
zieht `ownAvailableW` noch offene Nichtteilnehmerwirkungen ab. Erst daraus
entsteht `grossBudgetW`; `committedGroupW` umfasst dagegen tatsächliche
Teilnehmeraufnahme plus deren offene Wirkungen. Reserven schreiben die
beobachtete Bilanz nicht nachträglich um.

Ein gemeinsamer Stand wird gegen offene Teilnehmer- und
Nichtteilnehmerwirkungen geprüft. Der Aufrufer muss deren Reserven bereits
belastbar liefern; der Kern stellt weder ACK-Reihenfolge noch Reservefreigabe
fest. `commandBudget` ist eine Vorschau, keine atomare Reservierung: Mehrere
einzelne Vorschläge aus demselben unveränderten Stand beweisen keine einmalige
Vergabe. `reserveGroupCommands` prüft deshalb einen gemeinsamen Vektor gegen
einen Eigenstrompool, verändert den Ausgangsstand nicht und liefert einen
separat fortgeschriebenen Reservierungsstand. Eine spätere Integration muss
angenommene Aufträge vor weiteren Freigaben konsistent reservieren und den Stand
erneut prüfen. Die reine Funktion löst weder gleichzeitige Runtimezugriffe noch
ACK-/Reservefreigaben. Ungültige Messverträge liefern keine positive Freigabe;
ein Nullvorschlag bleibt möglich.

Bei einem gemeinsamen Bruttobudget von 5.200 W sind zwei unabhängige Vorschauen
über jeweils 3.000 W kein gemeinsamer 6.000-W-Nachweis. Der gemeinsame Vektor
muss abgewiesen werden; ebenso die zweite Erhöhung nach Übernahme des ersten
unveränderlich fortgeschriebenen `next`-Stands. Die Rückgabe trennt `allowed`,
`withinBudget`, `safeReduction` und den optionalen Folgestand `next`.

Eine zulässige Reduktion (`allowed`) kann einen bereits überschrittenen Stand
verringern, obwohl alte elektrische Aufnahme und deren Reserve noch nicht
vollständig abgebaut sind. Das ist von einem nachweislich innerhalb des Budgets
liegenden Zustand (`withinBudget`) zu unterscheiden; eine erlaubte Reduktion
ist keine Abnahme der Grenzkonformität. Die alte Reserve bleibt bis zum
unabhängigen Nachweis maßgeblich.

Damit werden keine Brutto-Haushalts-, PV- oder BHKW-Einzelwerte aus einem
Nettoresiduum erfunden. Quantisierung, Prioritätsvergabe, tatsächliche
Limitinterpretation und produktive Ausgangs-/Wiederanlaufverträge bleiben
Aufgaben der noch offenen Integration.

## Noch zu erfüllender zusammenhängender Integrationsvertrag

1. Stabile Gruppen-/Messgrenzenidentität und explizite Zuordnung der Teilnehmer
   zu Ausgängen und vollständigen AC-Messungen. Aggregat und enthaltene Teilzähler
   dürfen nicht doppelt gezählt werden. WP muss relevante Zusatzverbraucher
   vollständig abdecken; Inverter allein erlaubt keine positive Gutschrift.
2. Binär- und LPC-Eingänge ausdrücklich an ihre Gruppe/Messgrenze binden.
   Nur passende Umfänge dürfen als gemeinsames Minimum kombiniert werden.
   Unpassende aktive Gruppen müssen unabhängig durchgesetzt oder im neuen Modus
   mit genauer Diagnose gesperrt werden. Externe Gesamtbudgets bleiben unskaliert.
3. Tatsächliche positive Teilnehmeraufnahme und belegte Eigenversorgung strikt
   von Sollwerten und Reservierungen trennen. `coordinatedConsumptionLoads()`
   verwendet absichtlich `max(Ist, Befehl, Reserve)` und ist deshalb keine
   zulässige Quelle für Eigenstromgutschriften. Kein sich selbst finanzierender
   Stromschritt und kein eigener Eigenstrompool pro Wallbox.
4. Ganze NVP-Messgrenze, Speicher-AC-Umfang und Vorzeichen deklarieren. Ladung und
   Entladung getrennt behandeln; DC-/Hybridwerte nicht als AC-Teilnehmermessung
   ausgeben. PV/BHKW/Speicherwirkung im NVP nicht nochmals addieren. Ein
   NVP-Rest ist weder eine separat gemessene PV-Erzeugung noch eine vollständig
   gemessene Haushalts-Bruttolast; unbelegte Diagnosefelder bleiben unbekannt.
5. Gemeinsame Quellenkohärenz zusätzlich zu individuellem Alter/ACK/q prüfen.
   Alter NVP plus neue Gruppenlast und alte Gruppenlast plus neuer NVP nach
   Lastabfall können beide künstliche Eigenversorgung erzeugen. NULL oder
   unbekannte Qualität darf keine Budgeterhöhung erzeugen.
6. Teilnehmerabhängig begrenzen: Der heutige skalare Deckel umfasst auch EHZ und
   Heizpuffer. Nichtteilnehmer dürfen nicht als zusätzliche §14a-Einrichtung
   behandelt werden; ihre tatsächlichen und ausstehenden Lasten können jedoch
   die belegte verfügbare Eigenversorgung verringern.
7. Allocator und sämtliche unabhängigen Ausgangsprüfungen müssen dasselbe Ergebnis
   durchsetzen: parallele/sequenzielle Wallboxen, EHZ/Heizung, Einzel-/Mehrkopf-
   Speicher sowie erneute Prüfung nach wartenden Schreibaufträgen. Offene
   positive Stellwirkungen bleiben bis zum elektrischen Nachweis belastet.
   Hausanschluss-, Phasen-, Geräte-, ACK-/Antwort- und Neustartverträge erhalten.
8. Default und Migration behalten die konservative bisherige Wirkung. Keine
   automatische Aktivierung, Teilnehmererzeugung oder Erhöhung vorhandener Limits.
   Diagnose trennt Netzbudget, belegte Eigenversorgung, tatsächlichen
   Gruppennetzbezug, zulässiges Bruttobudget, Reserven und begrenzende Quelle.

## Nachweise vor einem späteren Abschluss

Die notwendige neue Regressionsfolge umfasst ohne PV, Überschuss, PV unter
Hauslast, schnelle Erzeugungsabnahme, beide Quellenversatzrichtungen,
NULL/ACK/q/Alter/Zukunft, mehrere Wallboxen und einmalige gemeinsame Vergabe,
WP-Gesamt-/Teilmessung und Zusätze, Speicher in beiden Richtungen, Teilnehmer-
und Nichtteilnehmerreservierungen, passende/unpassende gleichzeitig aktive
Gruppen sowie Migration. Integration über den produktiven Loader, unabhängige
Ausgänge und Quellenänderungen während einer Schreibqueue gehören dazu.

Unveränderte Ausgangsprüfung am genannten Commit:

| Prüfung | Ergebnis |
| --- | --- |
| Vollständiges `npm test`, Node 24.19.0 | 2.390 bestanden, 0 Fehler, 0 übersprungen |
| Vollständiges `npm test`, Node 22.23.3 | 2.390 bestanden, 0 Fehler, 0 übersprungen |
| `npm run test:package`, Node 22/24 | bestanden |
| `npm run test:artifact`, Node 22/24 | tatsächlich gepacktes/installiertes alpha.115: 193 Dateien, 719 States |

Der anfänglich unbeschreibbare npm-Homecache wurde durch einen expliziten
beschreibbaren Cache ersetzt. Das ist ein Umgebungsbefund, kein Codefehler.
Die Ergebnisse prüfen **bestehendes alpha.115**, nicht die fehlende #166-Funktion.

Abschlussprüfung des neuen unabhängigen Kerns:

| Prüfung | Ergebnis |
| --- | --- |
| Neue reine Bilanz-/Reservierungsregressionen, Node 22/24 | jeweils 159 bestanden, 0 Fehler, 0 übersprungen |
| Vollständiges `npm test`, Node 22/24 | jeweils 2.549 bestanden, 0 Fehler, 0 übersprungen |
| Unveränderte Differentialvergleiche, Node 22/24 | 19 Architekturszenarien mit 342.308 identischen Beobachtungen; 13 Wallboxszenarien mit acht gleichen Verträgen und fünf bereits erwarteten Unterschieden bestanden |
| Paket-/Installationsprüfung, Node 22/24 | bestanden; der neue Kern wird zusätzlich direkt aus dem isoliert installierten Tarball geladen und mit einer Bilanz-/Budgetgegenprobe ausgeführt |

Die Tests prüfen NULL/ACK/q, Alter/Zukunft und beide Versatzrichtungen,
vollständige/überlappende WP- und Speichergrenzen, einmaligen gemeinsamen
Spielraum mehrerer Verbraucher, gleichzeitig vorgeschlagene Teilnehmer-/EHZ-
Erhöhungen, unveränderte Reserven nach Reduktionsaufträgen sowie getrennte
beobachtete und freigabefähige Speicherwirkung. Keine bestehenden Tests wurden
abgeschwächt. Der Produktionsloader, die bisherigen Ausgangscontroller und
Konfigurationsvorgaben sind unverändert; der neue Kern wird bislang nur von
Tests und der isolierten Paketprüfung geladen. Diese Ergebnisse belegen keine
aktive #166-Regelung oder reale Betriebsabnahme.

Der aktuelle Veröffentlichungsauftrag umfasst den unabhängigen Teilschritt im
PR, die abschließenden Node-22-/Node-24-Prüfungen, danach Main-Übernahme und
ein neues Tag/GitHub-Release alpha.116. Die Release-Notiz trennt den neuen,
noch ungenutzten Bilanzkern von den bereits in main enthaltenen Änderungen
alpha.111–115 seit dem zuvor letzten Release alpha.110. Installation oder
Aktivierung werden nicht durchgeführt. Die spätere Integration benötigt zuerst
die offenen Schnittstellen-/Messverträge und
Nachweise über den produktiven Loader und sämtliche unabhängigen Ausgänge.
Natürliche aktive §14a-/LPC-Abnahme, tatsächliche Messgrenzen und Energiepotenzial
bleiben getrennt; Score 71/100, Änderung 0. Die konkreten nächsten SQL-Prüfpunkte
stehen im Diagnosefolgeplan.
