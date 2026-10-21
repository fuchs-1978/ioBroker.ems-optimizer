# #166: Anbindung der Gruppen-Netzbilanz

## Umfang und unveränderte Migration

### Nachtrag alpha.118: zeitversetzte Originalquellen

Seit alpha.118 führt allein ein zu großer Originalzeitversatz bei ansonsten
vollständig gültigen Quellen zum konservativen gemeinsamen Bruttobudget ohne
Eigenstrombonus statt zur pauschalen Nullfreigabe. Die unten dokumentierte
Eigenstromzuordnung benötigt weiterhin die erklärte zeitliche Kohärenz.
Unbekannte Netz-/Eigenstromanteile werden als `null` ausgewiesen. Alle Original-
Komponenten von Summenwerten bleiben in der Zeitprüfung. Einzelheiten und
verbleibende Grenzen: [alpha.118](release-0.17.0-alpha.118.md).

Ausgangspunkt ist main
[`9df2e232d05075703de4d437d68e056396262f7b`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/9df2e232d05075703de4d437d68e056396262f7b),
veröffentlicht als alpha.116. Dort war der reine Bilanzkern aus
[PR #221](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/221) noch ohne
Produktivanbindung. Dieser Folgeauftrag verbindet den Kern mit Regler,
gemeinsamer Zuteilung und unabhängigen Ausgangsprüfungen. Der ursprüngliche
Auftrag [#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166)
wurde vor Verwendung erneut anhand GitHub-Metadaten dem Autor `fuchs-1978`
zugeordnet; das Issue hatte keine Kommentare.

`par14aAccountingMode` bleibt standardmäßig `legacyGross`. Vorhandene
Konfigurationen erhalten keine neuen Teilnehmer, Messzuordnungen,
Eigenstromgutschriften oder höheren Limits. Vorhandene Budgetquellen,
GZF-Berechnung und die bisherige generische LPC-/Bruttobegrenzung bleiben in
diesem Modus wirksam. Kein Update aktiviert Master, Produktionsgates oder
Ausgänge. Es wurde keine Installation oder produktive Konfiguration vorgenommen.

Der ausdrücklich konfigurierte Modus `groupNet` unterstützt eine gemeinsame
Binärkontakt-Gruppe innerhalb einer vollständig deklarierten AC-Messgrenze.
**Jede konfigurierte LPC-Quelle sperrt den neuen Modus**, auch wenn die bisherige
Statusauswertung einen Wert als unbegrenzt bezeichnen würde. Die Bedeutung des
konkreten LPC-Endpunkts wird nicht aus Statusnamen oder Marketingtext abgeleitet.
Der LPC-abhängige Rest von #166 bleibt damit offen.

## Offizielle Quellen erneut geprüft

Abrufe am **21.10.2026, 22:43–22:44 Europe/Berlin**, ausschließlich von offiziellen
BNetzA-, VDE- und EEBUS-Domains, mit höchstens 20 Sekunden pro Dokument. Die
PDF-Antworten wurden erneut mit `pdftotext -layout` gelesen.

| Quelle | Frisches Ergebnis und belegter Umfang |
| --- | --- |
| [BNetzA-Verbraucherinformation](https://www.bundesnetzagentur.de/DE/Vportal/Energie/SteuerbareVBE/artikel.html) | HTTP 200; normaler Haushalt bleibt von der SteuVE-Begrenzung getrennt, Eigenversorgung ist vom netzwirksamen Bezug zu unterscheiden. |
| [BK6-22-300 Anlage 1](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Beschluss/BK6-22-300_Beschluss_Anlage1.pdf?__blob=publicationFile&v=1), insbesondere Ziff. 2.3, 2.4 und 4.4–4.6 | HTTP 200; zeitgleicher netzwirksamer Bezug der zugeordneten Einrichtungen; WP inklusive Zusatz-/Notheizung, Speicher hinsichtlich Einspeicherung; gemeinsame EMS-Steuerung und Mindestleistung. |
| [VDE-FNN Mindestleistung, Version 1.0, April 2025](https://www.vde.com/resource/blob/2384602/0cb47de901b1129acad8510257ecc582/vde-fnn-hinweis-mindestleistung-data.pdf), Kap. 2–4 | HTTP 200; keine Änderung der vorhandenen Faktoren/Formeln empfohlen. Bestehende GZF-Berechnung wiederverwendet. |
| [EEBUS Power Limitation](https://www.eebus.org/power-limitation/) | HTTP 200; allgemeine Beschreibung von LPC, CEM und Messung. Kein vollständiger normativer Endpunkt-/Status-/Gruppenvertrag. |
| [EEBUS Spezifikationsverzeichnis](https://www.eebus.org/specifications/) und [Dokumentationsübersicht](https://www.eebus.org/specifications-documentation/) | Beide HTTP 200. Offizielles Verzeichnis benennt LPC Technical Specification **1.0.0, Dezember 2022**, Implementation Guideline **1.1.0, April 2025**, High Level Test Specification **1.0.2, März 2025**. Die Downloadschaltflächen erfordern ausdrücklich einen kostenlosen EEBUS-Account und Anmeldung; die öffentliche Antwort enthält keinen PDF-Downloadlink. |

Damit ist der frühere Website-Timeout **kein aktueller Zugriffsbeleg mehr**.
Die EEBUS-Website und der offizielle LPC-Dokumentnachweis sind jetzt erreichbar;
der normative Dokumentinhalt und der tatsächlich installierte Adapter-Endpunkt
sind weiterhin nicht verifiziert. Es gab drei gezielte EEBUS-Folgeabrufe nach
der Homepage, keine Anmeldung, Registrierung oder Umgehung der Downloadgrenze.
Keine Drittanbieter-Semantik oder fremden Issues wurden übernommen.

SHA256 der frischen PDF-Antworten, jeweils identisch mit der früheren Prüfung:

- BNetzA Anlage 1: `c8cf59ea475bb4cb866e8b4eeb4b3e2b3306cb3f3ff1c432799b090bfb5b2d35`
- VDE-FNN: `d20fdf17b34370fe8e7878cf6c1e22ad5f3f8fa05d9bf31a2477e898da6cb067`

SHA256 der erhaltenen offiziellen EEBUS-Seiten:

- Homepage: `e2e62455d4e3b39bfc93072775e7c7f32592e5f497434e093c24c77cf18d7ab4`
- Power Limitation: `c285e5ac44ddc55d4ac3de592560a49a59daf85d4d7d97c8775e0e6570b3142f`
- Dokumentationsübersicht: `f0eb15136e2cbcc23142c90793aa7bfac0ac2ded81b3da7f1c4bd2b07ec88810`
- Spezifikationsverzeichnis: `fa39c84b900400858916eb81bc88c1f0d33ca1c0b913999edc9afbe6e1c307ec`

Die physische Teilnehmer-/Messzuordnung und die konservative Zuteilungsstrategie
unten sind explizite technische Adapterverträge. Sie werden nicht als einzelne
vorgeschriebene Normformel, Zertifizierung oder reale Anlagenabnahme ausgegeben.

## Konfiguration vor einer späteren Anlagenfreigabe

Die folgenden Schritte beschreiben die bewusste Einrichtung im Admin. Sie wurden
in diesem Auftrag nicht an einer produktiven Anlage ausgeführt.

1. Die mit dem Netzbetreiber vereinbarte feste Teilnehmergruppe und die
   tatsächliche vollständige AC-Messgrenze bestimmen. Normale Hauslasten und
   eigenständige Warmwasser-/Heizpuffer-Heizstäbe nicht als zusätzliche SteuVE
   anlegen. WP einschließlich relevanter Zusatz-/Notheizung vollständig erfassen.
2. Den vorhandenen realen Binärkontakt und seine tatsächliche Polarität
   zuordnen. `fixed`, `ems` oder `external` als bestehende Budgetquelle verwenden.
   Das externe Gesamtbudget wird nicht mit GZF erhöht. Fehlt der Kontakt, ist
   keine gültige aktive Gruppenbilanz nachgewiesen.
3. Unter Netzanschluss / §14a / EEBUS `par14aGroupId` und `par14aBoundaryId`
   ausdrücklich setzen. Die Kennungen benennen physisch geprüfte Umfänge;
   gleiche Zeichenfolgen allein beweisen keine elektrische Topologie.
4. `par14aSiteScope=whole-site-ac` erst deklarieren, wenn die vorhandenen
   Netzbezugs-/Rückspeisefelder getrennte, nichtnegative W-Originalmessungen des
   gesamten zugeordneten Anschlusses liefern. Inverter-, Teilkreis- oder
   DC-Messungen ersetzen diesen NVP nicht. PV und BHKW sind bereits im NVP
   enthalten und werden nicht zusätzlich addiert.
5. Die Teilnehmerzeilen um die unten genannten Mess-/Ausgangsbindungen
   vervollständigen. Bei festem oder externem Budget wird dieselbe Tabelle im
   Gruppen-Netzmodus ebenfalls angezeigt; ihre Anschlussleistungsfelder werden
   nicht zu einer zweiten GZF-Berechnung verwendet.
6. Den Speicherumfang ausdrücklich als `none` oder `complete-ac` deklarieren.
   Alle Speicher innerhalb der Messgrenze berücksichtigen, auch nicht vom EMS
   gesteuerte Speicher. Fehlende Angaben bleiben unbekannt.
7. Quellenalter und gemeinsame Zeitstempelgrenze anhand des tatsächlichen
   Quellenvertrags wählen. Das Auslieferungsmaximum sind 30 Sekunden Alter und
   0 Millisekunden Versatz; 0 bedeutet identische Originalzeitstempel. Ein bewusst
   gesetzter Versatz bis 1000 Millisekunden beweist keine synchrone Abtastung.
8. `groupNet` bewusst auswählen. Alle bisherigen Master-/Geräte-/Produktivgates
   bleiben separat erforderlich. Konfigurierte LPC-Eingänge sperren den neuen
   Modus; ihre produktive Zuordnung soll nicht allein zum Umgehen dieser Sperre
   gelöscht werden. Die vorhandene Bruttobetriebsart bleibt separat verfügbar.

### Teilnehmerzeilen

| Spalte | Vertrag |
| --- | --- |
| `name`, `kind`, `connectionPowerW` | Bestehende eindeutige Teilnehmeridentität, Typ und elektrische Netzanschlussleistung. Keine thermische Nennleistung oder Akkukapazität. GZF zählt konfigurierte Einrichtungen, keine gerade angeschlossenen Fahrzeuge. |
| `deviceId` | Leer: nur gemessener Teilnehmer ohne EMS-Ausgang. Sonst genau `Wallbox0`, `Wallbox1`, `Wallbox2` oder `Battery`. Ein Ausgang darf nur einmal gebunden sein. Standalone-EHZ/Heizpuffer sind keine zusätzliche Teilnehmeroption. |
| `powerId` | Exakte fremde Original-State-ID, ohne Wildcards und Steuerzeichen; keine vom EMS selbst erzeugten Diagnose-/Sollwerte. Für eine gesteuerte Wallbox muss sie ihrer vorhandenen zugeordneten kW-Leistungsquelle entsprechen. |
| `powerUnit` | Ausdrücklich `W` oder `kW`, passend zum tatsächlichen Originalwert. Gesteuerte Wallboxen verwenden ihren vorhandenen `kW`-Vertrag. |
| `powerScope` | Standard `unconfigured`; nur die bewusste Erklärung `total-ac` bestätigt vollständige AC-Abdeckung einschließlich relevanter Zusatzverbraucher. |

Mehrere passive Teilnehmer dürfen denselben vollständigen Aggregatzähler nur
als einmalige gemeinsame Abdeckung verwenden. Dieselbe elektrische Last darf
nicht zusätzlich in enthaltenen Teilzählern auftauchen. Ein gesteuerter
Teilnehmer benötigt eine eigene vollständige Messgrenze; eine unbekannte
Verteilung eines gemeinsamen Zählers wird nicht erfunden. WP-Inverterleistung
allein genügt nicht für WP samt Zusatz-/Notheizung.

### Speicher und Mehrkopf-Batterie

`par14aStorageCoverage=unconfigured` ist keine Erklärung, dass kein Speicher
existiert. `none` verlangt eine leere Speicherliste und eine tatsächlich
speicherfreie deklarierte AC-Messgrenze. `complete-ac` verlangt alle
vollständigen signierten AC-Messungen, je Zeile mit `powerId`, `powerUnit`,
`powerScope=total-ac` und tatsächlicher `direction`:

- `charge-positive`: positives Vorzeichen bedeutet Ladung, negatives Entladung.
- `discharge-positive`: positives Vorzeichen bedeutet Entladung, negatives Ladung.

DC-Batterieleistung und nur teilweise verfügbare Adaptergesamtwerte sind keine
vollständige AC-Aufnahme. Jede ursprüngliche Kopf-/Teilquelle wird vor Bildung
einer Summe auf Alter, Qualität und gemeinsamen Zeitstempelversatz geprüft.
Speicherentladung bleibt beobachtete Leistung; sie wird konservativ von der für
zusätzliche optionale Lade-/Heizaufnahme verfügbaren Eigenversorgung abgezogen.

Für einen gesteuerten SunEnergy-Mehrkopfspeicher erhält die Speicherteilnehmerzeile
`deviceId=Battery`, `powerId=@controlled-battery-ac`, `powerUnit=W` und
`powerScope=total-ac`. Das besondere Kürzel bedeutet die Summe der positiven
AC-Ladeanteile aller ausgewählten gesteuerten Köpfe. Es ist kein ioBroker-State
und erzeugt kein zusätzliches Quellenabonnement. Jeder ausgewählte Kopf muss
mit seiner originalen `heads.N.grid.GP`-Quelle vollständig in der Speicherliste
stehen: W, `total-ac`, `discharge-positive`. Fehlende, doppelte oder zum
ausgewählten Kopf abweichende Quellen sperren die positive Gruppenfreigabe.
Die signierten Originalquellen bleiben getrennt für die Entladungsbilanz erhalten.

Für einen gesteuerten Einzelkopf kann die Teilnehmermessung direkt der bereits
zugeordneten `batteryAcPowerId` entsprechen. Sie muss dieselbe vollständige
AC-Quelle wie der Ausgangstreiber sein, in W und in der Speicherliste ebenfalls
mit `discharge-positive`. Eine beliebige DC- oder Gegenzeichenquelle wird nicht
still passend umgerechnet. Zusätzliche fremde Speicher dürfen ihre ausdrücklich
deklarierte tatsächliche Vorzeichenkonvention verwenden.

## Gemeinsame Bilanz und Schutzverträge

`lib/grid-operator-runtime.js` verbindet den reinen Kern mit expliziter
Konfiguration, Originalquellen und den bestehenden synchronen Soll-/Reservewerten.
`lib/engine/grid-operator-control.js` verbindet dieses Ergebnis mit der produktiven
VM, quantisierter Zuteilung und gemeinsamer Vorschlagsprüfung. Der produktive
Loader lädt die neue Grenze vor ihren Regler-/Ausgangsaufrufern. Wallboxen und
thermische/Batterieausgänge prüfen die Gruppenbilanz zusätzlich unabhängig;
ein wartender Auftrag benötigt vor seinem tatsächlichen Schreiben einen
aktuellen Nachweis. Befehle oder intern publizierte Budgets sind kein Beleg
für erzeugten Eigenstrom.

Für Teilnehmer-Bruttoaufnahme `R` und NVP `P` (positiv Bezug, negativ Export)
bleibt die dokumentierte konservative Zuordnung:

- mathematisch verfügbare lokale Leistung: `max(0, R - P)`;
- davon gegenwärtig genutzte Eigenversorgung: `min(R, max(0, R - P))`;
- zugerechneter tatsächlicher Gruppennetzbezug: `min(R, max(0, P))`.

Damit wird normale Haushaltslast nicht pauschal zum §14a-Teilbudget gerechnet.
Ein belegter NVP-Rest ist zugleich keine neu gemessene Haushalts-Bruttolast oder
separat gemessene PV-/BHKW-Erzeugung. Solche unbelegten Einzelwerte werden nicht
aus dem Rest erfunden. Beispiel ohne Speicher oder offene Stellwirkung:
3.000 W Teilnehmeraufnahme und 1.000 W NVP-Bezug ergeben 2.000 W dieser Gruppe
zugeordnete verfügbare Eigenversorgung; bei 4.200 W Netzbudget sind rechnerisch
bis zu 6.200 W Bruttobudget möglich. Das Beispiel hebt keine andere Grenze auf.

Offene Teilnehmerwirkungen belasten den gemeinsamen Gruppenpool. Offene
Nichtteilnehmerwirkungen vermindern die verfügbare Eigenversorgung. Bestehende
High-Water-Reserven bleiben nach einer Reduktionsanforderung bestehen, bis die
jeweils vorhandenen elektrischen Nachweise ihre Freigabe erlauben. Eine
Vorschlagsreduktion finanziert kein vorweggenommenes Zuschalten eines anderen
Verbrauchers. Es gibt keinen eigenen Eigenstrompool je Wallbox oder Kopf.

Die Reservierung betrachtet bei gestuften Heizern bereits vor Zuteilung und
Ausgabe die größere elektrische Phasenspitze. Zum Beispiel kann der Übergang
von 2.800 W auf 3.400 W die alte L1-Aufnahme und eine neue 3.000-W-L2-Stufe
überlappen: erforderlich sind dann bis zu 5.800 W High-Water-Reserve. Der
gemeinsame Vorschlagsnachweis prüft diese Spitze getrennt vom 3.400-W-Befehl.
Eine nominelle Reduktion darf keine ungedeckte neue Phasenspitze erzeugen.
Vorhandene elektrische Freigaben und Reservierungsfristen werden nicht ersetzt.

Bei Speicherwechseln gehören auch noch nicht zurückgegebene frühere Ausgänge
zum erforderlichen AC-Nachweis. Dauerhafte Kopfansprüche werden unabhängig von
einer möglicherweise unvollständigen aggregierten Besitzanzeige gelesen.
Unlesbare oder unbestätigte Besitznachweise sperren die positive Gruppenbilanz.
Gesamtzähler und darin enthaltene Kopfzähler dürfen nicht als unabhängige
Speicherquellen doppelt eingehen. Bekannte SunEnergy-GP-Quellen bleiben W und
entladepositiv; bekannte DC-Batteriewerte ersetzen sie nicht.

Quellen müssen endliche originale Zahlen, `ack=true`, `q=0` sowie endliche,
positive, nicht zukünftige Originalzeitstempel liefern. Fehlendes `q` bleibt
unbekannt. Alter und Versatz werden gemeinsam über alle benötigten tatsächlichen
Quellen geprüft, nicht nur über die Zeit einer künstlichen Summe. Ein ungültiger
Nachweis erzeugt keine positive Gruppenbudget-Freigabe. Null-/Schutzbefehle
bleiben möglich. Ein inaktiver realer Binärkontakt ist vom fehlenden oder
ungültigen Kontakt zu unterscheiden.

Mindest-SoC, Ziel-SoC und Preisladung übersteuern diese Grenze nicht. Hausanschluss,
Phasen-, Geräte-, ACK-/Antwort-, Master-, Wiederanlauf- und Shutdownschutz bleiben
zusätzlich wirksam. Dieser Auftrag erhöht keine Toleranz, verlängert keine
Antwortfrist und verändert keine Recorder-/SQL-Durabilitätsvorgabe.

## Diagnose und reale Folgeabnahme

`Control.GridOperatorCalculation_JSON` trennt im Gruppenmodus Netzbudget,
beobachtete Gruppen-Bruttoaufnahme, zugerechneten Gruppennetzbezug, mathematische
und freigabefähige Eigenversorgung, Speicherladung/-entladung, offene Wirkungen,
Bruttobudget, Quellenzeiten und einen konkreten Sperrgrund. Diese Bilanz ist
keine eigenständige Aktorfreigabe. Teilnehmer-/Speicher-Originalquellen werden
über denselben begrenzten Quellenparser abonniert und diagnostisch aufgezeichnet;
der Parser erweitert weder Wildcards noch Recordergrenzen.

Reale Folgeabnahme bleibt separat offen. Bei natürlichen aktiven Begrenzungs-
und Ladefällen zusammenhängend prüfen:

- Ereigniszeit, Session/Sequenz, aktive Grenze, Quelle und tatsächliche
  Teilnehmer-/Messzuordnung;
- Original-NVP, Gruppenaufnahme, Speicherwirkung, Qualität und Quellenversatz;
- gemeinsames Netz-/Eigenstrom-/Bruttobudget und noch belastete Reserven;
- geordnete Befehle, jeweilige ACKs, L1–L3-/AC-Antwort und echte Freigabealter;
- Absenkung bei natürlichem Erzeugungsabfall und Abbau offener Wirkungen,
  getrennt von Vorschlags-/Diagnoseänderungen.

Keine künstlichen Anlagenversuche oder selbst ausgelösten Last-/Recoveryfälle.
Die Recorder-/Zugriffsdiagnose aus #60/#220 bleibt unverändert getrennt:
Originalbestätigungen, Session-/Sequenz-/Sample-Verluste, Queue-/Journalbytes,
unbestätigte Records und `expiry`/`expiredUnconfirmed` separat bewerten. Fehlende
Originale sind keine wiederhergestellten Daten. Softwaretests und ein Release
ersetzen keine reale Betriebsabnahme und versprechen keinen Score- oder
Energiegewinn.

## Software-Nachweise

Die abschließenden lokalen Softwareprüfungen unter **Node 22.23.3 und 24.19.0** sind erfolgreich:

| Prüfung | Ergebnis je Node-Version |
| --- | --- |
| Vollständiges `npm test` | 2.715 bestanden, 0 Fehler, 0 übersprungen; Ausgangsstand alpha.116: 2.549 |
| `npm run test:package` | bestanden |
| `npm run test:artifact` | alpha.117 tatsächlich isoliert installiert; 200 Paketdateien, 719 States; aktive Gruppenprüfung über den installierten produktiven Loader ausgeführt |
| Unverändertes `npm run test:equivalence` | 19 Architekturszenarien / 342.308 identische Beobachtungen gegen `9585b276`; 13 Wallboxszenarien gegen `25fd38b`, acht gleiche Verträge und fünf bereits dokumentierte historische Korrekturen |
| Direkter Vorher-/Nachher-Vergleich zum alpha.116-Ausgangsbaum | 19 Szenarien / 342.308 identische geordnete Beobachtungen, einschließlich Schreibfolgen, Übergängen und Diagnose-/Recorderverträgen |

Der direkte Vergleich verwendet den unveränderten Commit
[`f15f2e429d65b9c1e8aa75b62abeff2e9e86b415`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/f15f2e429d65b9c1e8aa75b62abeff2e9e86b415).
Sein Dateibaum ist exakt der des geprüften und veröffentlichten Ausgangs-main
`9df2e232d05075703de4d437d68e056396262f7b`, dessen Merge-Elternteil er ist.
Die Vergleichsuhr, Eingaben und Entropie sind kontrolliert. Nur publizierte
Versionsmetadaten werden wie im unveränderten Vergleichswerkzeug gepinnt.
Die neuen Funktionen sind bewusst unterschiedlich; die Gleichheitsnachweise
beziehen sich auf den bisherigen, standardmäßig erhaltenen Betriebsmodus.

166 zusätzliche gezielte Fälle sichern die neuen Grenzen: 83 Runtime-/Messvertragsfälle,
35 integrierte Regelungs-/Ausgangsfolgen, 18 Gegenproben, 12 Aux-/Mehrkopffälle,
neun unabhängige Wallboxfälle und je drei Admin-, Quelleninventar- und echte
Main-Warteschlangenfälle. Die kombinierte Folge mit zwei Wallboxen, Batterie
und beiden Heizern prüft über 115 deterministische Frames auch die natürliche
SoC-Übergabe. Alle aktiven Integrationstests verwenden den produktiven Loader.
Kein bestehender Test wurde abgeschwächt. Die Modulreihenfolge-Prüfung enthält
explizit das neue deklarative Modul zwischen `energy-coordination` und `planner`;
die Reihenfolge der bisherigen Module, Isolation und fehlender impliziter
Bootstrap bleiben exakt geprüft.

GitHub-CI-, PR-, Merge- und Veröffentlichungsnachweise werden am jeweiligen
exakten Commit im PR und Release dokumentiert. Nicht geprüft wurden eine reale
Produktivinstallation/-freigabe, physische Messzuordnung, natürliche aktive
§14a-/LPC-Lastfälle, normative LPC-Dokumentinhalte oder ein neuer SQL-Tagesabruf.
Softwareprüfungen ersetzen diese offene Betriebsabnahme nicht.
