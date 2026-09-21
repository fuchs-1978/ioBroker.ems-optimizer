# Speicher und Wärme: alpha17

Diese Erweiterung ist eine Grundlage für begleitete Tests, keine bestätigte
Inbetriebnahme. Es wurden keine laufenden ioBroker-Instanzen, Skripte oder
Geräte umgeschaltet. Neue produktive Ausgänge sind standardmäßig unkonfiguriert
und nicht scharfgeschaltet. Das vorhandene Skript kann bis zum vereinbarten
Test weiterlaufen; zwei Regler dürfen niemals denselben Aktor bedienen.

## Regelaufteilung

| Verbraucher | Aufgabe | Voreinstellung |
| --- | --- | --- |
| Speicher | Kleine Restabweichungen ausgleichen | 100 W pro bestätigtem Schritt, mindestens 2 s; Totband 50 W |
| Trinkwasser-EHZ / Heizpuffer-EHZ | Größere zugeteilte Wärmeleistung | Eigene Leistungs-/Temperaturgrenzen, Ausgabe alle 5 s |
| Wallbox | Grobe, diskrete Leistung | Ganze Ampere, bestehende Start-, Mindestlauf- und Ausschaltzeiten |
| Wärmepumpe | Langsame Betriebsabsicht | Empfehlung mit PV-Hysterese und 300 s Haltezeit; keine fremden Schreibzugriffe |

Der zentrale Verteiler nominiert genau einen Netz-Feinregler. Mit verfügbarer
Batterie folgen die Heizstäbe dem zugeteilten Budget. Bei deaktivierter Batterie,
fehlender Freigabe oder ausgeschöpftem Spielraum übernimmt ein verfügbarer EHZ
die Netznachführung. Eine kleine PV-Reserve von standardmäßig 200 W ist im Admin
einstellbar; ein deaktivierter Speicher reserviert keine fiktive Ladeleistung.
Sicherheitsbedingte Reduzierungen warten nicht auf eine langsame Aufwärtsrampe.

Die Übergabe setzt weiterhin gültige Leistungsmessungen voraus. Ist die reale
Leistung eines vorhandenen Verbrauchers unbekannt, darf der Verteiler daraus
weder freie PV noch freien Hausanschlussspielraum ableiten: Dann bleibt die
gemeinsame Ausgabe gesperrt, bis die Messung wieder belastbar ist.

## Speicher im Admin

Im Batteriebereich werden der Ausgang, die zugehörigen Rückmeldungen und die
Regelparameter eingestellt. Vorhanden, Regelung und produktive Scharfschaltung
sind getrennte Freigaben; zusätzlich gilt der globale Hauptschalter.

| Zweck | Sun-Energy-Zuordnung / Bedeutung |
| --- | --- |
| Leistungs-Ausgang | `sunenergyxt500.0.heads.1.control.GS` für den tatsächlich konfigurierten Kopf |
| GS-Vorzeichen | `+W` entladen/einspeisen, `-W` laden, `0` neutral |
| Öffentliche Anforderung | `ems-optimizer.0.Devices.Battery.RequestedPower_W`, ebenfalls GS-Vorzeichen; Diagnose, kein zweiter Stellweg |
| Interner Leistungswert | `Control.Targets.Battery_W` und `OutputCommandInternal_W`: positiv laden, negativ entladen |
| Echte AC-Leistung für die Regelung | `batteryAcPowerId`: `heads.1.grid.GP`, alternativ `total.gridPower` bei genau einem Kopf; positiv bedeutet Einspeisung und wird intern umgekehrt |
| Interne Batterie-/DC-Leistung | `batteryPowerId`: zum Beispiel `total.batteryPower`; nicht als AC-Stellrückmeldung verwenden |
| SoC | Passender Kopf, beispielsweise `heads.1.battery.SC` |
| Gerätemodus | Bestätigtes `MM=false` und `LM=true` desselben Kopfes |
| Verfügbarkeit | Passendes Online-Signal und frischer `info.lastUpdate`-Heartbeat |

Das Sun-Energy-Adapterverhalten wurde anhand von Version 0.2.10 geprüft:
Der Adapter muss aktiviert sein und `controlMode=off` verwenden, damit der EMS
direkt GS vorgibt und kein zweiter Sun-Energy-Regler gegenregelt. **Nicht** die
EMS-Speicheranforderung als `gridPowerStateId` eintragen: Dieser Eingang erwartet
eine Netzleistungsmessung, keinen Batterie-Leistungsauftrag.

Ein Instanz-Heartbeat darf gleichbleibende Messwerte nur bei nachgewiesener
Zuordnung bestätigen. Aggregate wie `total.gridPower` sind nur bei genau
einem konfigurierten Kopf eindeutig. Andere Köpfe, unbekannte Qualität,
unbestätigte Modussignale und veraltete Daten sperren die Regelung.

Die Trennung von AC und Batterie/DC ist wesentlich: Wandlungsverluste und
direkt am Speicher angeschlossene PV können beide Leistungen auseinanderlaufen
lassen. Eine größere Regeltoleranz würde eine falsche Messquelle nicht beheben.
Auch der Sun-Energy-eigene Regler verwendet die gemeldete Netzportleistung GP
zur Stellrückmeldung. Die AC-Quelle ist deshalb separat ausdrücklich zuzuordnen.

Maximale Lade- und Entladeleistung müssen zur tatsächlichen Anlage passen;
die vorhandene Konfiguration ist kein Nachweis der Hardwareleistung. Mindest-
und Höchst-SoC bleiben wirksam. Neue Installationen starten mit 15 % Reserve;
ein vorhandener ausdrücklich gesetzter Wert wird nicht still überschrieben.
Eine Reserve von null ist keine Freigabe für produktives Entladen.

Ein Befehl gilt nicht schon durch den ioBroker-Schreibabschluss als physisch
ausgeführt. Erhöhungen warten auf tatsächliche Leistungsrückmeldung;
Richtungswechsel führen über bestätigte Null. Fehlende Rückmeldung stoppt und
verriegelt den Ausgang. Diagnose beachten; `ResetFault` ist kein Ersatz für
behobene Kommunikations- oder Gerätefehler.

Ein bislang nicht beobachteter älterer Leistungsauftrag bleibt separat
reserviert, auch nach einem neueren Nullbefehl und über einen Adapterneustart
hinweg. Ein noch unveränderter Null-Messwert beweist nicht, dass der frühere
Auftrag nicht verspätet eintreffen kann. Solche Reserven stehen weder einem
anderen Heizstab noch der Wallbox zur Verfügung. Sie werden nicht allein durch
Zeitablauf oder `ResetFault` gelöscht. Das gilt entsprechend für die Heizstäbe,
einschließlich der Reserven pro Phase.

`Devices.Battery.ConfirmPhysicalStop` bzw. der entsprechende Taster unter
`Devices.MyPV_DHW` / `Devices.MyPV_Heating` ist ausschließlich eine ausdrückliche
Bestätigung **nach unabhängig geprüftem Gerätestopp und ausgeschlossenem alten
Stellauftrag**. Kein automatisches Rücksetzen durch Skript oder Zeitplan!
Die globale Ausgabe muss aus sein; frische plausible Nullleistung bleibt
zusätzliche Voraussetzung. Kann der alte Auftrag nicht sicher ausgeschlossen
werden, die Verriegelung stehen lassen und am Gerät/Treiber klären.

Diese Prüfung ist absichtlich konservativ: Eine nur teilweise erreichte
Leistung beweist den vollen früheren Auftrag nicht. Auch eine nachträgliche
Schutzabweisung in der Schreibwarteschlange kann eine bereits gespeicherte
Reserve stehen lassen. Fehler nicht pauschal als „nie am Gerät angekommen“
behandeln; die Reservierungsdiagnose beschreibt den noch offenen Nachweis.

**Ausfallgrenze:** Für GS ist kein verlässlich nachgewiesener geräteseitiger
Zeitablauf vorhanden. Bei Ausfall von ioBroker, Netzwerk oder Strom kann ein
alter Sollwert im Gerät bestehen bleiben. Für unbeaufsichtigte Nutzung wird
eine unabhängig wirksame Rückfall-/Watchdog-Lösung benötigt. Ein Adapter-Update
oder eine Simulation kann diese Geräteeigenschaft nicht ersetzen.

Die Reihenfolge der EMS-Schreibaufträge wird je Datenpunkt eingehalten; ein
ioBroker-Schreibabschluss beweist jedoch nicht die Reihenfolge interner
HTTP-Aufträge des Geräteadapters. Auch verzögerte Gerätebefehle müssen beim
realen Test geprüft werden. Für unbeaufsichtigten Betrieb muss der Gerätetreiber
eine verlässliche Befehlsreihenfolge und Rückmeldung gewährleisten.

Primärquellen: [Sun-Energy README v0.2.10](https://github.com/Creekhail/ioBroker.sunenergyxt500/blob/v0.2.10/README.md),
[Adapterimplementierung](https://github.com/Creekhail/ioBroker.sunenergyxt500/blob/v0.2.10/src/main.ts),
[Zustandsdefinitionen](https://github.com/Creekhail/ioBroker.sunenergyxt500/blob/v0.2.10/src/lib/states.ts).

## Zwei my-PV und Kühlung

Der zweite my-PV ist ein **eigenständiger Leistungs-Ausgang**, kein angenommener
Umschalter des ersten Geräts. Trinkwasser und Heizpuffer können gleichzeitig
Leistung erhalten, solange beide thermisch aufnahmefähig sind und das gemeinsame
elektrische Budget ausreicht. Der bestehende Trinkwasser-Vorrang bei echtem
Wärmebedarf bleibt erhalten.

Für den Heizpuffer müssen Ausgang, Verbindung, echte Temperatur und drei echte
Phasenleistungen zugeordnet werden. Die angenommene elektrische Stufung beträgt
3 × 2 kW; beim Trinkwasser 3 × 3 kW. Anschlussfolge und Messungszuordnung sind
vor dem realen Test zu bestätigen. Optional zugeordnete zusätzliche
Auslauftemperaturen wirken als weitere Schutzbedingung.

Bei engem Spielraum auf einer einzelnen Phase kann die sichere Rampe vor dem
nächsten elektrischen Stufensprung begrenzt bleiben, obwohl andere Phasen noch
Platz hätten. Auch jeder Zwischenschritt muss zur realen Anschlussfolge passen;
ein insgesamt zulässiger Endwert macht nicht automatisch kleinere Zwischenwerte
phasensicher. Überschuss bleibt in diesem Fall bewusst ungenutzt.

`heatingCoolingActiveId` muss zuverlässig melden, ob der betroffene Heizkreis
gerade kühlt. Kühlung **aktiv oder unbekannt/veraltet** sperrt den Heizpuffer-EHZ.
Ein optionaler frischer Kühlstatus-Heartbeat kann einen unveränderten bestätigten
Status absichern. `HeatingInhibit` ist eine zusätzliche manuelle Sperre.
Trinkwasser ist davon getrennt, sofern es hydraulisch tatsächlich unabhängig
ist. Software ersetzt keinen Temperaturbegrenzer, Durchfluss- oder Pumpenschutz.

## Preise und Wärmepumpen-Empfehlung

Preisabhängiges zusätzliches Heizen ist standardmäßig aus; das zusätzliche
Netzbudget ist standardmäßig 0 W. Erst Preisfreigabe, konfigurierter maximaler
**Gesamtpreis** und ein positives begrenztes Zusatzbudget erlauben es. Ein
negativer Börsenpreis allein reicht nicht. Fehlende Viertelstundenpreise,
veraltete Daten oder abgelaufene Preisfreigabe erlauben keinen Billigstrombezug.

Der Speicher darf weder absichtlichen preisgünstigen Wärmebezug noch
verpflichtende EV-Ladung aus seiner Reserve versorgen. Entladung wird auf die
separate Hausgrundlast begrenzt. §14a-/LPC-Budgets zählen Bruttoverbrauch:
Batterieentladung ist keine Gutschrift gegen Wallbox- oder Heizleistung.

Die WP bekommt zunächst nur eigene EMS-Objekte:

| Empfehlung | Wert | Bedeutung |
| --- | --- | --- |
| `REDUCED` | 0 | Wenig zusätzliche Energie anfordern; **kein Verdichter-AUS-Befehl** |
| `NORMAL` | 1 | Lokale Regelung normal arbeiten lassen; auch sicherer Rückfall |
| `BOOST` | 2 | Bei Temperaturspielraum mehr Wärme bevorzugen |

PV-Ein-/Ausschaltschwellen, Haltezeit und Zieltemperaturen sind einstellbar.
Sperren, fehlende Eingangsdaten oder Kühlung nehmen eine Empfehlung unmittelbar
auf NORMAL zurück. Eine nur preisbedingte BOOST-Empfehlung überlebt keine
abgelaufene Preisfreigabe. Die konkrete Hersteller-/SG-Ready-Anbindung ist
**noch nicht verbunden**; lokale Verdichterlaufzeiten und Schutzfunktionen
bleiben bei der WP.

## Begleitete Abnahme

1. Zuerst mit allen produktiven Ausgängen aus: Admin-Zuordnungen,
   `DriverStatus`, SoC, GS-/Messwertvorzeichen, reale Temperaturen und
   Kühlstatus vergleichen. Fehlende Messungen dürfen nicht als reale Null gelten.
2. Nur Speicher bei kleiner zugelassener Leistung: Aufwärtsrampe, echte
   Rückmeldung, beide Richtungen, Mindest-/Höchst-SoC und Hauptschalter AUS.
   Nach Nullauftrag die **physische** Null und einen frischen Heartbeat prüfen.
3. Speicher plus Trinkwasser-EHZ: steigende PV und Wolke; anschließend Speicher
   deaktivieren. Feinregler muss zum EHZ wechseln, ohne ungenutztes Speicherbudget.
4. Zweiten my-PV allein und anschließend beide Kreise prüfen. Kühlstatus aktiv
   und fehlend muss nur den betroffenen Heizpuffer-EHZ sperren.
5. Preisheizen zuerst mit kleinem Zusatzbudget prüfen; Preisfreigabe entziehen.
   Kein weiterlaufender Preisbezug und keine Batterieentladung für die Heizstäbe.
6. Wallbox dazunehmen: Mindeststrom, Startverzögerung, kurze/lang anhaltende
   Wolke, Hausanschluss und begrenztes gemeinsames Netzbetreiberbudget.
7. Kontrollierten Adapterneustart und Kommunikationsausfall nur unter Aufsicht
   prüfen. Vor Rückgabe an Skripte reale Ausgangszustände bestätigen.

Für jeden Abschnitt `Debug.Snapshot_JSON`, `Debug.Events_JSON` und
`Debug.PowerTrace_JSON` sichern. Abbruch bei unklarer Zuordnung, fehlender
Rückmeldung, unerwarteter Leistung oder widersprüchlichem Kühl-/Temperaturstatus.
Automatisierte Tests verwenden simulierte Geräte und verzögerte Rückmeldungen;
sie beweisen keine reale Hydraulik, Anschlussfolge oder Hardwareabschaltung.

## Automatisierte gekoppelte Simulation

Abschlussstand alpha17: `npm test` besteht mit **457/457 Tests**;
Paket-/Admin-JSON-Prüfung und `git diff --check` sind ebenfalls erfolgreich.
Zusätzlich wurde ein positiver Trinkwasser-Ausgang mit dem tatsächlichen
Main-Schreibschutz und simulierten Datenbank-/Geräterückmeldungen geprüft:
Besitz, Ziel und Reserven waren vor dem Stellbefehl dauerhaft gespeichert.

Die 25 gekoppelten Szenarien laufen in virtuellen Sekundenschritten mit den produktiven
Regelintervallen: 2 s für zentralen Verteiler, Speicher und Wallbox, 5 s für
die Heizstäbe. Die modellierten Rückmeldungen folgen bei go-e/Heizstäben erst
nach 4 s, beim Speicher nach 2 s. Zusätzliche Problemfälle verzögern die Wirkung
auf 8 s und fordern bereits davor null an. Szenarien laufen bis zu 460 virtuelle Sekunden.
Die Anlagenmodelle sind keine Herstellermodelle.

Geprüft werden insbesondere PV-Wechsel zwischen Defizit und bis zu 10 kW
Überschuss, 120-s-Wallboxstart, kurze und anhaltende Wolken, SoC-Grenzen,
deaktivierter/ausgefallener/nicht folgender Speicher, zwei Heizkreise,
2-kW-Preisbudget, Kühlung, fehlende Messungen, 4.200-W-Brutto-LPC-Budget und
46-A-Hausanschlussgrenze mit bereits 8 kW Grundlast auf L1. Weitere Fälle
prüfen elektrische Stufensprünge, Batterie-Richtungswechsel, veraltete
Spiegelwerte und die unveränderte Befehlsfolge mit/ohne Debug-Aufzeichnung.
AC-/DC-Unterschiede werden mit reiner DC-PV-Ladung bei AC=0 sowie 10 %
Umwandlungsdifferenz geprüft. Die Ausgangs-Warteschlange prüft geänderte
Leistungsgrenzen nochmals unmittelbar vor dem tatsächlichen Schreibzugriff.
