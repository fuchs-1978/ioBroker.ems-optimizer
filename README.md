# ioBroker EMS Optimizer

Aktuelle Version: **0.17.0-alpha.1**

Prognosebasierter Energiemanagement-Beobachter für ioBroker. Der Adapter führt
Messwerte, SQL-Historie, Wetter- und PV-Prognosen, Strompreise sowie flexible
Verbraucher in einem rollierenden 48-Stunden-Fahrplan zusammen.

Der aktuelle Entwicklungsstand arbeitet grundsätzlich im Beobachtermodus. Ab
Version 0.12.0 kann der Trinkwasser-EHZ nach ausdrücklicher Freigabe produktiv
angesteuert werden. Version 0.13.0 ergänzte alternativ den gesicherten Einzeltest
einer Wallbox. Version 0.14.0 gleicht die Stromuntergrenzen der aktiven Skripte
ab und bereitet den gemeinsamen Betrieb einer Wallbox mit dem EHZ vor. Version
0.15.0 ergänzte das gemeinsame §14a-/LPC-Leistungsbudget und eine richtungsrichtige
Hausanschlussprüfung. Version 0.15.1 unterstützt zusätzlich einen statischen
§14a-Binärkontakt mit festem Leistungsbudget. Version 0.15.2 macht die optionale
Abfahrtszeit tatsächlich abschaltbar. Version 0.15.3 stabilisiert den produktiven
PV-Betrieb von Wallbox und EHZ. Version 0.15.4 koppelt die Mindestlaufzeit an den
tatsächlich bestätigten Wallbox-Ausgang. Version 0.15.5 kann einen noch laufenden,
zuvor EMS-eigenen Auftrag nach einem ungeplanten Neustart sicher wieder übernehmen.
Version 0.16.0-alpha.2 korrigiert die Zeitführung einer bereits produktiv
laufenden Wallbox: Sie startet keinen neuen Einschalt-Countdown und die separaten
Diagnoseobjekte zeigen ihre reale Mindestlaufzeit. Version 0.16.0-alpha.1 erlaubt
die gemeinsame Freigabe aller drei Wallboxen und
des EHZ. Die Wallboxen arbeiten dabei zwingend nacheinander; der EHZ darf parallel
zur jeweils ausgewählten Wallbox als Feinregler laufen.
Version 0.17.0-alpha.1 setzt AP2 (#5 und #28–#32) gemeinsam um: normale
Datenquellen sind als eigene Admin-Felder sichtbar, der Hausanschluss besitzt
eine gemeinsame Grenze, und die kombinierte Wallbox-/EHZ-Regelung verteilt nach
der tatsächlich gemessenen Wallboxleistung.
Batterie, Heizpuffer und Wärmepumpe bleiben Simulation.
Reale Phasenwechsel führt ausschließlich das vorhandene externe Skript aus; der
Adapter stellt dafür nur Empfehlungen bereit. Ein Update aktiviert keine neuen Ausgänge.

## Neu in 0.17.0-alpha.1 – AP2 Admin/Konfiguration

- Eigene Reiter strukturieren Messwerte, Historie/Prognose und allgemeine
  Wallbox-Einstellungen. PV, Netzbezug/-einspeisung, Außentemperatur,
  Teilzähler, Fahrzeug-/SoC-Werte, Preisreihen und externe Freigaben können ohne
  JSON direkt eingetragen werden.
- Explizite Felder haben Vorrang. `dataPointMapJson` bleibt als kompatibler
  Migrations-Fallback erhalten; leere neue Felder löschen daher keine bestehende
  Zuordnung. `System.MappingStatus_JSON` zeigt explizite, übernommene und fehlende
  Zuordnungen.
- Für Wallboxen und EHZ gilt eine zentrale Hausanschlusssicherung mit gemeinsamer
  Reserve. Die Arbeitsgrenze ist Sicherung minus Reserve. Alte getrennte Grenzen
  bleiben ausschließlich zur Migration lesbar.
- Wallbox-Priorität kann automatisch, im Admin oder über ein externes Objekt
  bezogen werden. Dynamische Energiepreis- und Netzentgelt-Freigaben können
  ebenfalls aus externen Bool-Objekten kommen; ungültige externe Werte schalten
  die jeweilige Dynamik sicher aus und erzeugen einen Diagnosestatus.
- Die Außentemperatur erwartet °C. Ungültige oder fehlende Werte werden verworfen;
  die Prognose arbeitet dann mit ihrem konservativen Rückfall weiter. Der
  Historienzeitraum ist zwischen 7 und 365 Tagen konfigurierbar.
- Im gemeinsamen Betrieb steigt eine Wallbox standardmäßig nur noch um 1 A pro
  langsamem Zyklus. Der EHZ bekommt den Rest zur **gemessenen** Wallboxleistung,
  nicht zu einer vorweggenommenen Sollleistung. So wird die Einspeisung während
  einer trägen Fahrzeugreaktion unmittelbar nachgeregelt und die 50/50-Verteilung
  nähert sich kontrolliert an.
- Ein bereits EMS-eigener, bestätigter Wallbox-Ausgang bleibt bei einem normalen
  Adapterneustart oder GitHub-Update eingeschaltet. Die neue Instanz prüft alle
  Schutzbedingungen erneut und übernimmt den Auftrag ohne AUS/EIN-Unterbrechung.
  Beim Deaktivieren oder Entfernen der Instanz sowie bei ungültiger Übergabe wird
  weiterhin sicher abgeschaltet. Status: `Control.RestartHandoffActive`.
- Der EHZ darf bei bestätigter Rückmeldung Einspeisung mit einem größeren
  Aufwärtsschritt aufnehmen (Standard maximal 3.000 W). Bei −2.000 W NVP und
  6.500 W Istleistung ergibt sich beim Ziel −100 W direkt etwa 8.400 W statt nur
  der bisherigen 1-kW-Stufe. Temperatur-, Zuweisungs- und Hausanschlussgrenzen
  bleiben bindend.

Ein Update übernimmt bestehende Freigaben unverändert, setzt aber keinen bisher
deaktivierten produktiven Ausgang selbsttätig auf aktiv.

Hinweis für den ersten Wechsel von 0.16: Dessen bereits laufender Prozess kennt
die neue Restart-Übergabe noch nicht und kann die Wallbox bei genau diesem einen
Upgrade weiterhin kurz stoppen. Sobald 0.17.0-alpha.1 läuft, verwenden folgende
Restarts und GitHub-Updates die unterbrechungsfreie Übergabe.

## Neu in 0.16.0-alpha.2 – konsistente Wallbox-Timer

- Eine bereits produktiv laufende Wallbox wird unabhängig von einem kurzzeitig
  auf null fallenden internen Sollwert als laufend behandelt.
- Während ihrer Mindestlaufzeit startet deshalb kein neuer Einschalt-Countdown.
- `MinimumRunTimeActive` und `MinimumRunTimeRemaining_s` folgen dem bestätigten
  produktiven Ausgang und stimmen mit dem Countdown im Ausgangsstatus überein.

## Neu in 0.16.0-alpha.1 – Alpha-Gesamtsteuerung

- WB0, WB1 und WB2 dürfen gleichzeitig zur Adaptersteuerung freigegeben werden.
  Der neue Schalter **Arm ALPHA control for all released wallboxes + DHW** muss
  dafür zusätzlich ausdrücklich gesetzt sein.
- Produktiv lädt immer nur **eine** Wallbox. Auswahl: laufender EMS-Auftrag,
  Mindest-SoC, Pflichtladung, Priorität und Fahrplan. Die nächste Wallbox erhält
  erst nach bestätigtem `allow_charging = 0` der vorherigen eine Startfreigabe.
- Fahrplan und Echtzeitregler erzeugen ebenfalls nie parallele Wallbox-Sollwerte.
  Der EHZ bleibt parallel zulässig und regelt den nach der Ganzampere-Stufe
  verbleibenden Überschuss stufenlos aus.
- Erkennt der Alpha-Modus beim Übergang eine laufende, noch nicht dem EMS gehörende
  Wallbox, übernimmt er deren unbekannten Auftrag nicht. Er setzt sie zuerst
  kontrolliert auf AUS und startet sie bei vorhandenem Budget über die bestätigte
  Sequenz AUS → Mindeststrom → EIN neu.
- Eigentümerschaft, sichere Wiederübernahme nach ungeplantem Neustart,
  Startverzögerung, Mindestlaufzeit, Hausanschlussgrenzen, §14a/LPC sowie alle
  Geräte-, Messwert- und SoC-Sperren bleiben wirksam.
- Reale Phasenumschaltung ist weiterhin nicht Bestandteil dieses Alpha-Tests.
  Jede Wallbox arbeitet mit der im Admin bestätigten festen Phasenzahl.

Für den Alpha-Test werden alle drei Wallbox-Schreiber
`Werte_schreiben_0_V2`, `Werte_schreiben_1_V2`, `Werte_schreiben_2_V2` sowie die
konkurrierenden EHZ-Leistungsschreiber deaktiviert. Mess-, SoC-, Benutzer-/RFID-,
Hausanschluss-, §14a-/EEBUS-, Pumpen-, Temperatur- und Geräteschutzfunktionen
bleiben aktiv. Danach werden je Wallbox **Control release** und **Arm wallbox
output**, für den EHZ dessen Steuerfreigabe und die Kombinationsfreigabe sowie
zuletzt Alpha- und globale Schreibfreigabe gesetzt.

Die Rückkehr zum Skriptbetrieb erfolgt umgekehrt: zuerst die Gerätefreigaben
entziehen, auf `OutputOwned=false`, alle `OutputActive=false`, alle go-e-
Freigaben `0` und EHZ-Sollwert `0 W` warten, dann Alpha-/globale Freigabe aus
und erst anschließend die alten Ausgangsschreiber wieder starten.

## Neu in 0.15.5 – sichere Wiederübernahme nach Neustart

- War eine Wallbox vor einem ungeplanten Adapterneustart nachweislich im Besitz des
  EMS (`OutputOwned=true`) und produktiv aktiv (`OutputActive=true`), kann der neue
  Prozess den laufenden Auftrag ohne Abschaltimpuls wieder übernehmen.
- Vor der Übernahme werden erneut alle Freigaben und Sicherheitsbedingungen geprüft,
  darunter Verbindung, Gerätefehler, Fahrzeug/SoC, Hausanschlussschutz, §14a/LPC,
  feste Phasentopologie sowie bestätigter Ladestrom.
- Ist eine Bedingung ungültig oder fehlt die frühere EMS-Eigentümerschaft, erfolgt
  keine Übernahme. Ein noch eigener Ausgang wird dann wie bisher sicher gestoppt.
- Dies war in 0.15.5 auf ungeplante Prozessabbrüche begrenzt. Ab 0.17.0-alpha.1
  nutzt auch ein normaler Restart oder GitHub-Update die geprüfte Übergabe;
  Deaktivieren oder Entfernen der Instanz sendet weiterhin einen Stoppbefehl.

Version 0.15.5 ergänzt keine Objekte, entfernt keine Objekte und aktiviert keine
zusätzlichen produktiven Ausgänge.

## Neu in 0.15.4 – reale Mindestlaufzeit und Countdown-Diagnose

- Bei einer produktiv gesteuerten Wallbox beginnt die Mindestlaufzeit erst, wenn
  `Devices.WallboxX.OutputActive` den realen Start bestätigt. Ein bereits länger
  vorhandener Simulationssollwert kann die Mindestlaufzeit nicht mehr vorzeitig
  ablaufen lassen.
- Je Wallbox zeigen vier neue Diagnoseobjekte die aktive Einschaltverzögerung und
  Mindestlaufzeit sowie die jeweils verbleibenden Sekunden an:
  `StartDelayActive`, `StartDelayRemaining_s`, `MinimumRunTimeActive` und
  `MinimumRunTimeRemaining_s` unter `Vehicles.WallboxX`.
- Sicherheitsgrenzen, Gerätefehler, ungültige Daten, Hausanschlussschutz und §14a
  dürfen die Mindestlaufzeit weiterhin sofort übersteuern.

Version 0.15.4 ergänzt zwölf Diagnoseobjekte, entfernt keine Objekte und aktiviert
keine zusätzlichen produktiven Ausgänge.

## Neu in 0.15.3 – stabiler Wallbox-/EHZ-Betrieb

- Eine PV-geführte Wallbox startet erst, wenn ihre Mindestleistung zuzüglich
  **300 W Startreserve** mindestens **30 Sekunden** stabil verfügbar ist.
- Nach dem Start hält der Regler die Wallbox standardmäßig mindestens
  **120 Sekunden** auf ihrem Mindeststrom. Harte Sicherheitsgrenzen,
  Gerätefehler, ungültige Daten, Hausanschlussschutz und §14a bleiben vorrangig.
- Reicht ein Überschuss nicht für den Wallbox-Mindeststrom oder bleibt wegen der
  Ganzampere-Stufen Leistung übrig, übernimmt der EHZ diesen Rest als stufenloser
  Feinregler.
- Während einer laufenden Ladung berücksichtigt die Nachregelung die tatsächlich
  aufgenommene Wallboxleistung. Zieht ein Fahrzeug weniger Strom als der go-e-
  Sollwert erwarten lässt, können verbleibende 1-A-Stufen kontrolliert nachgeführt
  werden, ohne den Sollwert bei einem nicht ladenden Fahrzeug hochzuschrauben.
- Unter 4.000 W startet keine neue 50/50-Aufteilung. Wurde sie zuvor oberhalb
  von 4.000 W aktiviert, bleibt sie entsprechend der vorhandenen Hysterese bis
  unter 3.000 W aktiv.
- Meldungen unterscheiden jetzt unter anderem ein nicht angeschlossenes Fahrzeug,
  einen veralteten Fahrzeugstatus, einen unbestätigten SoC-Datenpunkt und einen
  erreichten Ziel-SoC.

Die drei Parameter liegen ab 0.17 unter **Wallbox general**:

- `Additional surplus before wallbox start`: 300 W
- `Stable surplus time before wallbox start`: 30 s
- `Wallbox minimum run time`: 120 s

Version 0.15.3 ergänzt drei Konfigurationsobjekte, entfernt keine Objekte und
aktiviert keine zusätzlichen produktiven Ausgänge. Die reale Phasenumschaltung
bleibt weiterhin extern.

## Neu in 0.15.2 – optionale Abfahrtszeit

- Ein leerer Wert in `ems-optimizer.0.Vehicles.WallboxX.DepartureTime` bedeutet
  jetzt **keine hinterlegte Abfahrt**.
- Das Fahrzeug bleibt dann im gesamten 48-Stunden-Horizont für die PV-geführte
  Planung verfügbar.
- Ohne Abfahrtszeit wird keine Deadline-Ladung ausgelöst, auch wenn deren
  Admin-Schalter aktiviert ist.
- Eine gesetzte Uhrzeit bleibt unverändert die harte Planungsgrenze.

**In Version 0.15.2 werden keine Objekte angelegt oder entfernt.** Die
Admin-Oberfläche und sämtliche produktiven Ausgänge bleiben unverändert.

## Neu in 0.15.1 – Issue #8

### Automatische Auswahl der §14a-Quelle

- Ist nur der optionale Binärkontakt konfiguriert, bedeutet der aktive Zustand
  ein festes gemeinsames Leistungsbudget. Standard sind **4.200 W**.
- Ist nur EEBUS-LPC konfiguriert, bestimmt weiterhin `LPC.state` zusammen mit
  `LPC.limit` das Budget.
- Sind beide Quellen konfiguriert, werden sie unabhängig ausgewertet. Begrenzen
  beide gleichzeitig, gilt automatisch das kleinere und damit strengere Limit.
- Ein unveränderter Binärkontakt bleibt gültig und wird nicht allein aufgrund
  seines alten Zeitstempels verworfen. Wert, Bestätigung und Qualität müssen
  weiterhin gültig sein. Dynamische EEBUS-Werte bleiben zeitüberwacht.
- Die Wirkrichtung des Kontakts und das feste Limit sind im Reiter **General**
  unter **§14a / EEBUS LPC** einstellbar. Voreinstellung: `true/1` ist aktiv,
  festes Limit 4.200 W.
- Mindeststrom und Pflichtladung können auch das feste Binärlimit nicht übersteuern.

**In Version 0.15.1 werden keine Objekte angelegt oder entfernt.** Produktive
Ausgänge bleiben nach dem Update ausgeschaltet; vorhandene Skripte werden nicht verändert.

## Neu in 0.15.0 – Issues #8 und #27

### §14a / EEBUS LPC

- `LPC.state = limited` aktiviert `LPC.limit` als gemeinsames Leistungsbudget der
  §14a-Verbraucher. Die aktuell gemessene elektrische Wärmepumpenleistung wird
  zuerst abgezogen; nur der Rest steht den Wallboxen zur Verfügung.
- `unlimitedAutonomous` und `unlimitedControlled` bedeuten kein aktives Limit.
  Fehlende, veraltete oder unbekannte dynamische LPC-Signale sowie `failsafe`
  sperren die Wallboxleistung sicher auf null.
- Solange die Wärmepumpe als nicht vorhanden konfiguriert ist, wird nichts für sie
  abgezogen. Wird sie als vorhanden markiert, ist ihr Leistungsdatenpunkt für ein
  aktives LPC-Limit verpflichtend.
- Mindeststrom und Pflichtladung dürfen das Budget nicht übersteuern.

Die Datenpunkte werden im Reiter **General** unter **§14a / EEBUS LPC** eingetragen.
Der optionale §14a-Binärkontakt darf leer bleiben, wenn allein `LPC.state` und
`LPC.limit` verwendet werden. Umgekehrt dürfen die LPC-Felder leer bleiben,
wenn nur der Binärkontakt mit festem Limit verwendet wird.

Neue Diagnoseobjekte:

- `ems-optimizer.0.Control.GridOperatorLimitActive`
- `ems-optimizer.0.Control.GridOperatorBudget_W` (`-1` bedeutet unbegrenzt)
- `ems-optimizer.0.Control.GridOperatorStatus`
- `ems-optimizer.0.Actual.HeatPump_W`

### Hausanschluss und Admin-Struktur

Die vollständige Konfiguration **House-connection protection** liegt nun im Reiter
**General**. Für eine richtungsrichtige Prüfung können Bezug und Einspeisung je
Phase als sechs SMA-Leistungsdatenpunkte angegeben werden. Nur ein vollständiger
Satz wird akzeptiert. Bleiben alle sechs Felder leer, verwendet der Adapter weiter
die drei Strombeträge als konservativen Rückfall. Dadurch ändert ein Update keine
bisherige Schutzkonfiguration; mit den Richtungswerten wird hohe Einspeisung aber
nicht mehr fälschlich als Bezug begrenzt.

### Phasenumschaltung

Der Adapter beschreibt keinen Phasenumschalter. Er liefert ausschließlich
`Vehicles.WallboxX.RecommendedPhases` und das stabilisierte Ziel
`Control.Targets.WallboxX_Phases`. Die reale Umschaltung einschließlich Stop,
Rückmeldung und Verriegelungszeit bleibt vollständig beim externen Skript.

**In Version 0.15.0 entfallen keine Objekte.** Produktive Ausgänge und
Phasenumschaltung bleiben nach dem Update unverändert bzw. ausgeschaltet.

## Neu in 0.14.0 – Issues #6 und #7

### Mindestströme aus den aktiven Wallboxskripten

- Die vorhandenen Objekte `javascript.0.ev.amin0`, `javascript.0.ev.amin1` und
  `javascript.0.ev.amin2` werden als manuelle Mindestströme gelesen. Ihre IDs sind
  pro Wallbox in der Admin-Oberfläche einstellbar; der Adapter beschreibt sie nicht.
- Nur bei `socfrei == 2` gelten zusätzlich die konfigurierbaren niedrigen SoC-Stufen:
  Mii standardmäßig bis 30 % mindestens 10 A und bis 10 % mindestens 16 A;
  EQV/EQE bis 50 % mindestens 10 A, bis 30 % mindestens 16 A und bis 10 %
  mindestens 25 A.
- Fahrzeug-, Phasen-, Leistungs-, Taper-, Hausanschluss- und
  Inbetriebnahmegrenzen bleiben vorrangig. Eine Forderung von 25 A wird zum Beispiel
  bei einer dreiphasig auf 16 A begrenzten EQV-Ladung sicher auf 16 A begrenzt.
- Die Regeln wirken konsistent in 48-h-Fahrplan, Echtzeitverteilung und
  Produktivausgang. Reale Befehle bleiben ganzzahlig und niemals zwischen 1 und 5 A.

### Ein zentraler NVP-Regler für Wallbox und EHZ

Zwei unabhängige Nullregler sind ausdrücklich ausgeschlossen. Der Echtzeitregler
berechnet zuerst die gesamte flexible Leistung und verteilt sie anschließend:

- Wallbox: grobe Leistungsstufe in ganzen Ampere
- Trinkwasser-EHZ: stufenloser Feinregler auf den NVP-Sollwert
- Standardverteilung: 50 % EHZ / 50 % Wallbox
- einphasig EIN oberhalb 4.000 W, AUS unterhalb 3.000 W
- dreiphasig EIN oberhalb 9.000 W, AUS unterhalb 8.000 W
- nicht nutzbare oder durch Ampere-Rundung verbleibende Leistung geht an das andere Gerät

Vor einer Erhöhung der Wallbox wartet der Produktivausgang, bis der EHZ seinen
neuen niedrigeren Anteil erreicht hat. Dadurch entsteht beim Umschichten kein
zusätzlicher Netzbezug; eine kurze zusätzliche Einspeisung ist sicherer und zulässig.
Bei einer notwendigen Reduzierung wird die Wallbox sofort zurückgenommen, der EHZ
füllt den verbleibenden Überschuss anschließend stufenlos auf.

Als Laufzeitschalter dient ausschließlich das vorhandene Objekt
`javascript.0.ehz.aufteilen`. Das Admin-Feld **Existing distribution switch data
point** ist mit dieser ID vorbelegt und kann auf eine andere ID gelegt werden.
Akzeptiert werden `true`/`false` sowie `1`/`0`; fehlende oder ungültige Werte
deaktivieren die gemeinsame Verteilung. Der Adapter beschreibt dieses Objekt nicht.

Für einen gemeinsamen Produktivtest müssen zusätzlich alle folgenden Sperren
bewusst freigegeben sein:

1. globale Schreibfreigabe,
2. eine oder mehrere Wallbox-Steuerfreigaben,
3. **Arm wallbox output** jeder freigegebenen Wallbox,
4. bei mehreren Wallboxen die **ALPHA-Mehrgerätefreigabe**,
5. EHZ-Steuerfreigabe,
6. **Arm combined wallbox + DHW production**,
7. gültiges und eingeschaltetes Aufteilungsobjekt.

Der zusätzliche Kombinationsschalter ist nach jedem Update standardmäßig aus.
Für den ersten Wallbox-Einzeltest bleibt die EHZ-Steuerfreigabe aus; dann arbeitet
die Wallbox wie in 0.13.0 allein gegen den NVP. Der Kombinationsbetrieb ist
softwareseitig vorbereitet, aber noch nicht an der realen Anlage abgenommen.

### Vorbereitung des Wallbox-Einzeltests

Vor dem ersten Test wird genau eine Wallbox ausgewählt. Für diese Wallbox sind
in der Admin-Oberfläche mindestens feste Phasenzahl, tatsächlich belegte
Netzphase bei einphasigem Laden, Strom-/Freigabeausgang sowie bestätigter Strom,
Verbindung und Fehlerstatus zu prüfen. Die sichere Startkonfiguration ist:

- globale Schreibfreigabe zunächst aus,
- nur die ausgewählte Wallbox vorhanden und zur Steuerung freigegeben,
- **Arm SINGLE wallbox test** nur für diese Wallbox an,
- Inbetriebnahmegrenze 6 A,
- EHZ-Steuerfreigabe und **Arm COMBINED wallbox + DHW production test** aus,
- automatische Phasenumschaltung aus und feste Phasenzahl am Gerät verifiziert.

Unmittelbar vor der Übernahme wird nur der vollständige aktive Schreiber der
ausgewählten Wallbox ausgeschaltet:

| Wallbox | Fahrzeug | auszuschaltender Schreiber |
|---|---|---|
| 0 | Mii/e-Up | `script.js.EV-Charge.Werte_schreiben_0_V2` |
| 1 | EQV | `script.js.EV-Charge.Werte_schreiben_1_V2` |
| 2 | EQE | `script.js.EV-Charge.Werte_schreiben_2_V2` |

Eine zugehörige automatische Phasenumschaltung muss ebenfalls aus sein.
Messwert-, SoC-, RFID-/Benutzerfreigabe-, `PV_Sicherung`-, §14a-/EEBUS- und
Geräteschutzskripte bleiben eingeschaltet. Erst danach wird die globale
Schreibfreigabe als letzter Schritt gesetzt.

Für die Rückkehr zum Skriptbetrieb zuerst die Wallbox-Steuerfreigabe entziehen
und auf bestätigte Ladefreigabe 0 sowie `OutputOwned=false` warten. Danach
**Arm SINGLE wallbox test** und die globale Schreibfreigabe ausschalten und erst
dann den oben genannten Schreiber wieder aktivieren. Der Adapter schaltet bei
Installation oder Update weder Skripte noch Produktivausgänge selbst um.

Der gemeinsame Test mit EHZ ist eine eigene zweite Inbetriebnahmestufe. Dann
müssen neben dem ausgewählten Wallbox-Schreiber auch die aktiven konkurrierenden
EHZ-Leistungsschreiber, insbesondere `script.js.E-Heizer.EHZ-Leistung_V2` und
`script.js.E-Heizer.EHZ-Aufteilen_V5`, anhand ihrer tatsächlichen vollständigen
IDs geprüft und ausgeschaltet sein. Schutz-, Pumpen-, Temperatur- und
Messskripte bleiben aktiv. Diese Umschaltung darf erst nach erfolgreichem
Wallbox-Einzeltest erfolgen.

### Neue Diagnoseobjekte in 0.14.0

Für die Wallboxen werden ergänzt:

- `ems-optimizer.0.Vehicles.Wallbox0.ManualMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox0.LowSocMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox0.RequestedMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox0.CurrentConstraintStatus`
- `ems-optimizer.0.Vehicles.Wallbox1.ManualMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox1.LowSocMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox1.RequestedMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox1.CurrentConstraintStatus`
- `ems-optimizer.0.Vehicles.Wallbox2.ManualMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox2.LowSocMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox2.RequestedMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox2.CurrentConstraintStatus`

Für die gemeinsame Verteilung werden ergänzt:

- `ems-optimizer.0.Control.ParallelDistributionReleased`
- `ems-optimizer.0.Control.ParallelDistributionReleaseStatus`
- `ems-optimizer.0.Control.CombinedProductionArmed`

**In Version 0.14.0 entfallen keine Objekte.** Bestehende Diagramme und die
bisherigen Freigabeobjekte bleiben erhalten.

## Neu in 0.13.0 – Issue #4

### Fahrzeugbedarf und Admin-Konfiguration

- Jede Wallbox lässt sich mit **Wallbox … present / include in planning** abwählen.
  Ihr Fahrplan und ihre Freigabe bleiben dann null; die bisherigen Objekte bleiben erhalten.
- **SoC limits source** legt pro Fahrzeug fest, ob die bisherigen gemappten
  Min-/Max-Datenpunkte oder die neuen Admin-Felder gelten. Standard bleibt
  **Existing mapped data points**; das vorhandene JSON kann unverändert bleiben.
- **Minimum SoC**: sofortiger Ladebedarf, auch ohne PV. **Target SoC**: darüber
  nur PV-Laden bis zum Ziel. Netzladung bis zum Ziel aufgrund einer Abfahrtszeit
  erfordert jetzt ausdrücklich **Allow grid charging to target before departure**
  (standardmäßig aus). Diese Änderung betrifft auch die Simulation.
- **Preferred wallbox**: externes Prioritätsobjekt, automatisch oder Wallbox 0/1/2.
  Unter Mindest-SoC hat ein Fahrzeug Vorrang vor der manuellen Auswahl und vor
  einem früheren Fahrplan. Nach Erreichen der Mindestgrenze wird neu priorisiert.
- **Reduce current near target SoC** aktiviert zwei Stufen je Fahrzeug.
  Abstand zum Ziel wird in Prozentpunkten, die Stromgrenze in A je Phase eingegeben.
  Beispiel aus dem aktiven Mii-Skript: Ziel minus 5 Punkte → höchstens 13 A;
  Ziel minus 2 Punkte → höchstens 8 A. Für EQV/EQE separat einstellbar;
  standardmäßig bei allen aus, damit keine Fahrzeuggrenze ungefragt geändert wird.
  Beide Stufen wirken in Prognose, Echtzeitsimulation und Produktivausgang.
  Der Fahrplan berechnet sie aus dem fortgeschriebenen Fahrzeug-SoC.

Bei einer kurzen Restladung ist `valueW` im Fahrplan die mittlere Leistung des
15-Minuten-Fensters. `currentA` und `chargingMinutes` beschreiben den dazugehörigen
Ladestrom und die Dauer; real werden niemals 1–5 A angefordert.
Eine nicht vorhandene Hausbatterie gleicht in der Echtzeitsimulation keine Last mehr aus.

### Gesicherter Wallbox-Einzeltest

Die neue Ausgangsstufe benötigt **globale Schreibfreigabe**, **Wallbox vorhanden**,
**Wallbox control release** und die zusätzliche Bestätigung **Arm SINGLE wallbox test**.
Die zusätzliche Bestätigung ist standardmäßig aus, auch bei bestehenden Installationen.
Das anfängliche Produktionslimit beträgt **6 A**. Alle Ausgangs- und Rückmelde-IDs
werden pro Wallbox in der Admin-Oberfläche eingegeben; es gibt keine fest verdrahteten Geräte-IDs.

| Admin-Feld | Wallbox 0 / Mii | Wallbox 1 / EQV | Wallbox 2 / EQE |
|---|---|---|---|
| Writable go-e current | `go-e.0.amperePV` | `go-e.1.amperePV` | `go-e.2.amperePV` |
| Writable go-e release | `go-e.0.allow_charging` | `go-e.1.allow_charging` | `go-e.2.allow_charging` |
| Confirmed go-e current | `go-e.0.ampere` | `go-e.1.ampere` | `go-e.2.ampere` |
| go-e connection state | `go-e.0.info.connection` | `go-e.1.info.connection` | `go-e.2.info.connection` |
| go-e error code | `go-e.0.error` | `go-e.1.error` | `go-e.2.error` |

**Optional available current** bleibt leer, solange `go-e.0.avail_ampere`,
`go-e.1.avail_ampere` beziehungsweise `go-e.2.avail_ampere` keine gültigen Werte
liefern. Wird das Feld belegt, ist der Wert verpflichtend und begrenzt den Strom;
fehlende/veraltete Werte sperren dann den Ausgang. Die Fehlercodes werden gelesen,
aber niemals automatisch quittiert. Eine Stromreduktion lässt sich nicht allein
aus geringer Stromaufnahme eindeutig als Temperaturproblem erkennen.

Die Schreibfolge lautet: Ladefreigabe 0 bestätigen lassen, Mindeststrom schreiben,
bestätigte Ampere-Rückmeldung abwarten, erst dann Ladefreigabe 1. Ein eigener
Schreibauftrag (`ack=false`) zählt nicht als Rückmeldung. Bei Schreibfehler oder
Rückmelde-Timeout wird abgeschaltet und bis zum Adapter-Neustart gesperrt.
Der Regler erhöht nicht weiter, wenn das Auto den angeforderten Strom noch nicht
abnimmt. Er nutzt direkte NVP-Werte und ganze Ampere; normale Erhöhungen beachten
Regelintervall und Rampe, Abschaltungen und kleinere Schutzgrenzen wirken sofort
beim nächsten 2-Sekunden-Prüflauf.

Die Hausanschlussprüfung verwendet bevorzugt die phasenweisen SMA-Leistungen für
Bezug und Einspeisung. Ohne diese optionalen Richtungswerte werden die drei
konfigurierten SMA-Phasenströme weiterhin konservativ ausgewertet. Wallbox-Grenze:
standardmäßig 50 A, keine Erhöhung oberhalb 46 A. Die Zuordnung **Grid phase used
by wallbox L1** muss der tatsächlichen Verdrahtung entsprechen. Ein gültiges
begrenztes LPC-Signal reduziert die Wallbox auf das verbleibende §14a-Budget;
ungültige oder veraltete Signale stoppen sie.

**Bewusste Grenze der damaligen Version 0.13.0:** genau eine Wallbox produktiv und die
EHZ-Steuerfreigabe im Adapter aus. Die Phasenzahl wird für den Test physisch fest
eingestellt und unter **Verified fixed phases** bestätigt. Der Adapter schaltet
keine Phasenschütze. Seine 1-/3-Phasen-Prognose bleibt eine Empfehlung; der Ausgang
rechnet das Wattbudget auf die feste Test-Phasenzahl um. Der kombinierte Test
mit EHZ folgt nach erfolgreichem Einzeltest. Reale Phasenwechsel verbleiben
dauerhaft beim externen Skript und nutzen nur die EMS-Empfehlungen.

Vor dem Test müssen die aktiven Ampere-/Freigabe-Schreibskripte **der ausgewählten
Wallbox** und deren automatische Phasenumschaltung aus sein. Für den Mii ist der
geprüfte Schreiber `script.js.EV-Charge.Werte_schreiben_0_V2`; für die anderen
Wallboxen vor dem Umschalten die tatsächlichen aktiven Schreiber prüfen.
RFID-/Benutzerfreigabe, SoC-Zulieferung, `PV_Sicherung` und Netzbetreibersignale
bleiben erforderlich. Der EHZ bleibt während des isolierten Tests ebenfalls
aus bzw. ohne Leistungsanforderung, damit die NVP-Reaktion eindeutig messbar ist.
Das Update selbst schaltet kein Skript ab.

Zur Rückgabe an das alte Skript zuerst die Wallbox-Steuerfreigabe entziehen und
auf bestätigte Ladefreigabe 0 sowie `OutputOwned=false` warten. Erst danach den
alten Schreiber einschalten. Bei Kommunikationsverlust kann der Adapter eine
Abschaltung anfordern, aber deren physische Ausführung nicht garantieren;
Geräteschutz und lokale Schutzfunktionen bleiben notwendig.

### Neue Diagnoseobjekte (vollständige IDs)

| Zweck | Wallbox 0 | Wallbox 1 | Wallbox 2 |
|---|---|---|---|
| Bestätigter Produktionsstrom | `ems-optimizer.0.Devices.Wallbox0.OutputCommand_A` | `ems-optimizer.0.Devices.Wallbox1.OutputCommand_A` | `ems-optimizer.0.Devices.Wallbox2.OutputCommand_A` |
| Begründung / Wartezustand | `ems-optimizer.0.Devices.Wallbox0.OutputStatus` | `ems-optimizer.0.Devices.Wallbox1.OutputStatus` | `ems-optimizer.0.Devices.Wallbox2.OutputStatus` |
| Ausgang aktiv | `ems-optimizer.0.Devices.Wallbox0.OutputActive` | `ems-optimizer.0.Devices.Wallbox1.OutputActive` | `ems-optimizer.0.Devices.Wallbox2.OutputActive` |
| Steuerung noch übernommen | `ems-optimizer.0.Devices.Wallbox0.OutputOwned` | `ems-optimizer.0.Devices.Wallbox1.OutputOwned` | `ems-optimizer.0.Devices.Wallbox2.OutputOwned` |
| Schreib-/Rückmeldefehler | `ems-optimizer.0.Devices.Wallbox0.OutputFault` | `ems-optimizer.0.Devices.Wallbox1.OutputFault` | `ems-optimizer.0.Devices.Wallbox2.OutputFault` |
| Unter Mindest-SoC | `ems-optimizer.0.Vehicles.Wallbox0.BelowMinimum` | `ems-optimizer.0.Vehicles.Wallbox1.BelowMinimum` | `ems-optimizer.0.Vehicles.Wallbox2.BelowMinimum` |
| SoC-bedingte Stromgrenze | `ems-optimizer.0.Vehicles.Wallbox0.TaperCurrentLimit_A` | `ems-optimizer.0.Vehicles.Wallbox1.TaperCurrentLimit_A` | `ems-optimizer.0.Vehicles.Wallbox2.TaperCurrentLimit_A` |

Weitere neue Diagnosefelder je Wallbox: `OutputPhases`, `OutputLastWrite`,
`FeedbackCurrent_A`, `AvailableCurrent_A` sowie beim Fahrzeug `SocLimitsSource`.
**Keine Objekte entfallen in 0.13.0. Bestehende Diagramme funktionieren weiter.**

## Funktionen

### Simulierter my-PV-Trinkwasser-Controller (ab 0.6.0)

Der Trinkwasser-Heizstab wird als erstes Geraet mit seiner realen
Leistungskennlinie simuliert. Im Beobachtermodus schreibt der Adapter weder
`modbus.4.holdingRegisters.1000_Power` noch `javascript.0.ehz.power_vorgabe`
oder einen anderen Aktorwert.

Aus dem vorhandenen Skript wurden folgende Grenzen uebernommen:

- maximal 9.000 W
- Abschaltung ab 76,0 °C am unteren Speichersensor
- Wiedereinschaltung unterhalb 75,5 °C
- maximal 7.500 W von 70 bis 71 °C
- maximal 6.000 W von 71 bis 73 °C
- maximal 4.000 W von 73 bis 74 °C
- maximal 3.000 W von 74 bis 76 °C
- die temperaturabhaengigen Stufen greifen wie bisher bei mehr als 60 °C
  AC-THOR-Ausgangstemperatur
- maximal 3.000 W ab 76 °C AC-THOR-Ausgangstemperatur
- Sicherheitsabschaltung bei 82 °C am oberen Speichersensor
- Schichtungsgrenzen von 900 beziehungsweise 500 W
- simulierte Aenderungsbegrenzung von 1.000 W je zehn Sekunden

Die wichtigsten vollstaendigen Diagnoseobjekte sind:

- `ems-optimizer.0.Devices.MyPV_DHW.Available`
- `ems-optimizer.0.Devices.MyPV_DHW.Release`
- `ems-optimizer.0.Devices.MyPV_DHW.MustHeat`
- `ems-optimizer.0.Devices.MyPV_DHW.BottomTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.MiddleLowerTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.MiddleUpperTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.TopTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.OutletTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.RemainingCapacity_kWh`
- `ems-optimizer.0.Devices.MyPV_DHW.ActualPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.PlannedPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.TemperaturePowerLimit_W`
- `ems-optimizer.0.Devices.MyPV_DHW.SimulatedTargetPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.Status`

### SoC-, Phasen- und Fahrzeugverwaltung (ab 0.5.0)

Der `vehicle-manager` verwaltet alle drei Wallboxen getrennt. Er uebernimmt die
Semantik der vorhandenen EV-Skripte: Ziel-SoC erreicht bedeutet Sperre,
zwischen Mindest- und Ziel-SoC ist das Fahrzeug PV-flexibel und unterhalb des
Mindest-SoC besteht Pflichtladebedarf. Zusaetzlich werden `alw0…2`,
`socmin0…2`, `socmax0…2`, die
go-e-Anschlusszustaende und die konfigurierten SoC-Quellen ausgewertet. Beim Mii
kann damit der vorhandene geschaetzte SoC verwendet werden. `socfrei0…2` wird
als Vergleichswert angezeigt, die EMS-Freigabe jedoch aus den korrekt gemappten
SoC-Quellen neu berechnet. Damit wird die alte, teilweise nicht mehr passende
Fahrzeugzuordnung nicht ungeprueft uebernommen.

Pro Wallbox werden fehlende Fahrzeugenergie, Ladeenergie inklusive Verlusten,
naechste Abfahrt und spaetester sicherer Ladebeginn berechnet. Vor diesem
Zeitpunkt bleibt das Fahrzeug PV-flexibel. Danach plant der Adapter bei Bedarf
eine Pflichtladung bis zum Ziel-SoC. Pflichtladung, frueheste Deadline und
Prioritaet bestimmen die Reihenfolge. Seit Version 0.9.0 kann verbleibender
PV-Ueberschuss danach an weitere angeschlossene Fahrzeuge verteilt werden.
Damit bleibt die Prioritaet erhalten, ohne ungenutzte Leistung nur wegen einer
bereits ausgereizten ersten Wallbox einzuspeisen.

Die Fahrzeugdaten werden direkt auf der Konfigurationsseite eingestellt. Pro
Wallbox stehen Fahrzeugname, SoC-Datenpunkt, Batteriekapazitaet, maximale
Ladeleistung sowie die Stromgrenzen fuer ein- und dreiphasiges Laden bereit.
Der Haken **1-/3-phasige Umschaltung erlauben** entscheidet, ob der Planer
ueberhaupt dreiphasiges Laden empfehlen darf. Ohne Haken werden die
dreiphasigen Felder ignoriert.

Beispiel einer moeglichen Zuordnung:

| Wallbox | Fahrzeug | Phasenumschaltung | 1-phasig | 3-phasig |
|---|---|---:|---:|---:|
| 0 | Vehicle 0 | nein | 6–16 A | wird ignoriert |
| 1 | Vehicle 1 | ja | 6–16 A | 6–16 A |
| 2 | Vehicle 2 | ja | 6–16 A | 6–16 A |

Der Planer bevorzugt einphasiges Laden, wenn die benoetigte Energie bis zur
Abfahrt damit sicher erreicht werden kann. Bei grossem PV-Fenster oder wenn die
einphasige Leistung zeitlich nicht ausreicht, empfiehlt er fuer freigegebene
Fahrzeuge dreiphasiges Laden. Die eigentliche Umschaltung bleibt in dieser
Version simuliert.

Die Abfahrtszeit wird hier eingestellt:

- `ems-optimizer.0.Vehicles.Wallbox0.DepartureTime`
- `ems-optimizer.0.Vehicles.Wallbox1.DepartureTime`
- `ems-optimizer.0.Vehicles.Wallbox2.DepartureTime`

Format: `HH:MM`, Standard `06:00`. Die Prioritaet steht in:

- `ems-optimizer.0.Vehicles.Wallbox0.Priority`
- `ems-optimizer.0.Vehicles.Wallbox1.Priority`
- `ems-optimizer.0.Vehicles.Wallbox2.Priority`

Je Fahrzeug sind unter anderem folgende vollstaendige Objekte vorhanden
(entsprechend auch fuer `Wallbox1` und `Wallbox2`):

- `ems-optimizer.0.Vehicles.Wallbox0.Connected`
- `ems-optimizer.0.Vehicles.Wallbox0.SoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.MinimumSoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.TargetSoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.Release`
- `ems-optimizer.0.Vehicles.Wallbox0.MustCharge`
- `ems-optimizer.0.Vehicles.Wallbox0.EnergyRequired_kWh`
- `ems-optimizer.0.Vehicles.Wallbox0.GridEnergyRequired_kWh`
- `ems-optimizer.0.Vehicles.Wallbox0.DepartureTimestamp`
- `ems-optimizer.0.Vehicles.Wallbox0.LatestStartTimestamp`
- `ems-optimizer.0.Vehicles.Wallbox0.PhaseSwitchEnabled`
- `ems-optimizer.0.Vehicles.Wallbox0.RecommendedPhases`
- `ems-optimizer.0.Vehicles.Wallbox0.Status`

### Simulierte NVP-Echtzeitregelung (ab 0.4.0)

Zusätzlich zum rollierenden 15-Minuten-Fahrplan berechnet der Adapter alle zwei
Sekunden eine schnelle Ausregelung am Netzverknüpfungspunkt (NVP). Der Fahrplan
entscheidet, welche Verbraucher im aktuellen Zeitfenster freigegeben sind und
welche Leistung sie höchstens erhalten. Die Echtzeitebene reduziert diese
Sollwerte bei einer Wolke und verteilt realen Überschuss innerhalb der
Fahrplangrenzen. Mehrere freigegebene Verbraucher bleiben dabei parallel aktiv;
die Batterie übernimmt die schnelle verbleibende Differenz.

Version 0.4.0 arbeitet ausschließlich als Simulation. Alle Ergebnisse werden
nur unter `ems-optimizer.0.Control` ausgegeben. Es wird kein Datenpunkt einer
Batterie, Wallbox, eines my-PV oder einer Wärmepumpe beschrieben.

Wichtige vollständige Objekte:

- `ems-optimizer.0.Control.Enabled`
- `ems-optimizer.0.Control.TargetGridPower_W`
- `ems-optimizer.0.Control.Deadband_W`
- `ems-optimizer.0.Control.ActualGridPower_W`
- `ems-optimizer.0.Control.PredictedGridPower_W`
- `ems-optimizer.0.Control.RemainingError_W`
- `ems-optimizer.0.Control.Targets.Battery_W`
- `ems-optimizer.0.Control.Targets.MyPV_DHW_W`
- `ems-optimizer.0.Control.Targets.MyPV_Heating_W`
- `ems-optimizer.0.Control.Targets.Wallbox0_W`
- `ems-optimizer.0.Control.Targets.Wallbox1_W`
- `ems-optimizer.0.Control.Targets.Wallbox2_W`
- `ems-optimizer.0.Control.Targets.Wallbox0_A`
- `ems-optimizer.0.Control.Targets.Wallbox1_A`
- `ems-optimizer.0.Control.Targets.Wallbox2_A`
- `ems-optimizer.0.Control.Targets.Wallbox0_Phases`
- `ems-optimizer.0.Control.Targets.Wallbox1_Phases`
- `ems-optimizer.0.Control.Targets.Wallbox2_Phases`
- `ems-optimizer.0.Control.Targets.PVBoostRelease`

Vorzeichen: `ems-optimizer.0.Control.TargetGridPower_W` ist bei Netzbezug
positiv und bei Einspeisung negativ. Der Standardwert `-100 W` hält eine kleine
Einspeisereserve. Für `ems-optimizer.0.Control.Targets.Battery_W` bedeutet ein
positiver Wert Laden und ein negativer Wert Entladen.

- rollierende 48-Stunden-Prognose in 15-Minuten-Schritten
- PV-Prognose für bis zu fünf getrennte PV-Flächen
- Hauslast- und bereinigte Grundlastprognose
- Lernprofile aus SQL-Historie nach Wochentag und Feiertag
- Energiepreis und dynamisches Netzentgelt getrennt aktivierbar
- Fahrpläne für Batterie, drei Wallboxen und zwei my-PV-Heizstäbe
- reine Freigabe- und Budgetplanung für Wärmepumpen-PV-Boost
- Trinkwassertemperatur und thermische Speicherkapazität in der Planung
- dreistufige Batterieladung mit Morgen-, Nachmittags- und Spätziel
- zeitlich möglichst späte, aber sichere Batterieladung
- Batterieentladung für Eigenverbrauch oder Preisverschiebung
- ECharts-kompatible `json_chart`-Datenpunkte
- Datenqualitäts-, Alters- und Plausibilitätskontrolle
- keinerlei Schreibzugriff auf reale Geräteausgänge

## Grundprinzip

> Historie vor Prognose vor Empfehlung.

1. Historische Messwerte bilden typische 15-Minuten-Profile.
2. Wetter, PV-Erwartung, Preise und bekannte Gerätezustände erzeugen eine
   rollierende Prognose.
3. Der Planer verteilt die erwartete Energie auf flexible Verbraucher.
4. Ein schneller Beobachter berechnet alle zehn Sekunden Empfehlungen aus den
   aktuellen Messwerten.
5. Sicherheitsfunktionen und reale Gerätecontroller verbleiben außerhalb des
   Adapters.

## Berücksichtigte Ressourcen

- PV-Erzeugung und Netzanschlusspunkt
- vier getrennte Gebäude- beziehungsweise Bereichszähler
- AC-gekoppelter Batteriespeicher
- bis zu drei Wallboxen
- my-PV Trinkwasser-Heizstab
- my-PV Heizpuffer-Heizstab
- Wärmepumpen-PV-Boost als Freigabeempfehlung
- Hausanschlussreserve
- §14a-, LPC- und LPP-Signale
- dynamische oder feste Energiepreise
- dynamische oder feste Netzentgelte

## Installation

In ioBroker unter **Adapter aus eigener URL installieren** folgende URL
verwenden:

```text
https://github.com/fuchs-1978/ioBroker.ems-optimizer
```

Danach eine Instanz `ems-optimizer.0` anlegen beziehungsweise die vorhandene
Instanz neu starten.

## Konfiguration

### Strukturierte AP2-Konfiguration ab 0.17.0-alpha.1

Die wichtigsten Einstellungen werden nicht mehr nur ueber EMS-Objekte oder das
erweiterte JSON gepflegt. Die Adapterseite ist in folgende Bereiche gegliedert:

- Allgemeine Freigaben, zentrale Hausanschlussgrenze und §14a/LPC
- Messwerte und optionale Teil-/Phasenmessungen
- Historie, Wetter-/PV-Prognose, Preise und Netzentgelte
- allgemeine Wallbox-Regelung und Prioritätsquelle
- Wallbox 0, Wallbox 1 und Wallbox 2
- my-PV Trinkwasser
- my-PV Heizpuffer
- Hausspeicher
- NVP-Echtzeitsimulation
- erweiterte Migrationszuordnung

Je Fahrzeug werden Name, SoC-Datenpunkt, Kapazitaet, maximale Ladeleistung,
Freigabe der 1-/3-phasigen Umschaltung und die getrennten Stromgrenzen
eingestellt. Beim Trinkwasser-Heizstab sind die Temperaturdatenpunkte,
Speichergrenzen, Leistungskennlinie und Leistungsrampe sichtbar. Fuer Batterie
und Heizpuffer stehen Kapazitaet, Leistung und relevante Zielwerte bereit.

Sichtbare Datenpunktfelder überschreiben den entsprechenden Eintrag aus dem
Legacy-JSON. Bleibt ein sichtbares Datenpunktfeld leer, wird die vorhandene
JSON-Zuordnung weiterverwendet. Alle externen Objekt-IDs werden aus der
Adapterkonfiguration gelesen; die Auslieferung enthaelt keine anlagenspezifischen
Zuordnungen.

`dataPointMapJson` ist ab AP2 nicht mehr der normale Konfigurationsweg. Es bleibt
im Reiter **Advanced data points** nur erhalten, damit bestehende Installationen
ohne Datenverlust migrieren. Die wirksame Herkunft ist unter
`ems-optimizer.0.System.MappingStatus_JSON` nachvollziehbar.

Beispiel:

```json
{
  "DP_PV_POWER": "javascript.0.energy.pvPower",
  "DP_GRID_IMPORT": "meter.0.grid.importPower",
  "DP_GRID_EXPORT": "meter.0.grid.exportPower",
  "DP_HOUSE1": "meter.0.house1.power",
  "DP_HOUSE2": "meter.0.house2.power",
  "DP_HALL": "meter.0.hall.power",
  "DP_APARTMENT": "meter.0.apartment.power",
  "DP_BATTERY_SOC": "battery.0.soc",
  "DP_BATTERY_POWER": "battery.0.power"
}
```

Die Beispiel-IDs müssen vollständig durch die Datenpunkte der eigenen Anlage
ersetzt werden. Persönliche Anlagen- und Gerätekennungen sind nicht Bestandteil
dieses öffentlichen Repositorys.

## Historische Lernbasis

Der Adapter verwendet standardmäßig die letzten **84 Tage**; der Wert ist im
Reiter **History & forecast** zwischen 7 und 365 Tagen einstellbar. Die
SQL-Aufbewahrung sollte den gewählten Zeitraum mit Reserve abdecken. Für den
Standardwert werden mindestens 90 Tage empfohlen:

```text
Nur Änderungen speichern:     aktiviert
Entprellzeit:                  5 Sekunden
Minimales Speicherintervall:  60 Sekunden
Relog-Intervall:              900 Sekunden
Aufbewahrung:                 90 Tage
```

Benötigt werden insbesondere Historien für:

- PV-Gesamtleistung
- alle vier Bereichs- beziehungsweise Gebäudezähler
- Gesamtleistung jeder Wallbox
- Gesamtleistung des Trinkwasser-Heizstabs
- später die Gesamtleistung des Heizpuffer-Heizstabs

Die Abfragen erfolgen seit Version 0.2.9 speicherschonend nacheinander und in
Sieben-Tage-Blöcken. Die EMS-eigenen Ergebniswerte werden seit Version 0.2.10
maximal 90 Tage aufbewahrt.

Der Zustand der Lernbasis ist unter folgenden Objekten sichtbar:

```text
ems-optimizer.0.History.Building
ems-optimizer.0.History.Ready
ems-optimizer.0.History.Status
ems-optimizer.0.History.PVSamples
ems-optimizer.0.History.SubmeterSamples
ems-optimizer.0.History.LastBuild
```

## Zentrale Ergebnisobjekte

Aktuelle, normierte Messwerte:

```text
ems-optimizer.0.Actual.PV_W
ems-optimizer.0.Actual.GridPower_W
ems-optimizer.0.Actual.HouseLoad_W
ems-optimizer.0.Actual.Baseload_W
ems-optimizer.0.Actual.Wallboxes_W
ems-optimizer.0.Actual.MyPV_DHW_W
ems-optimizer.0.Actual.MyPV_Heating_W
```

Fahrplan und Status:

```text
ems-optimizer.0.Plan.Valid
ems-optimizer.0.Plan.Status
ems-optimizer.0.Plan.BatteryPower_48h_JSON
ems-optimizer.0.Plan.BatterySoC_48h_JSON
ems-optimizer.0.Plan.MyPV_DHW_48h_JSON
ems-optimizer.0.Plan.MyPV_Heating_48h_JSON
ems-optimizer.0.Plan.Wallbox0_48h_JSON
ems-optimizer.0.Plan.Wallbox1_48h_JSON
ems-optimizer.0.Plan.Wallbox2_48h_JSON
```

Kurzfristige Empfehlungen:

```text
ems-optimizer.0.Recommendation.Valid
ems-optimizer.0.Recommendation.PVBoostRelease
ems-optimizer.0.Recommendation.PVBoostAvailable_W
ems-optimizer.0.Recommendation.MyPV_DHW_W
ems-optimizer.0.Recommendation.MyPV_Heating_W
ems-optimizer.0.Recommendation.Reason
```

## ECharts

Die `json_chart`-Objekte entsprechen dem von ECharts und Open-Meteo
verwendbaren Format `[{"ts":"...","val":...}]`.

Leistungsdiagramm:

```text
ems-optimizer.0.Chart.PV_48h_json_chart
ems-optimizer.0.Chart.HouseLoad_48h_json_chart
ems-optimizer.0.Chart.Baseload_48h_json_chart
ems-optimizer.0.Chart.BatteryPower_48h_json_chart
ems-optimizer.0.Chart.MyPV_DHW_48h_json_chart
ems-optimizer.0.Chart.MyPV_Heating_48h_json_chart
ems-optimizer.0.Chart.PVBoostBudget_48h_json_chart
ems-optimizer.0.Chart.Wallbox0_48h_json_chart
ems-optimizer.0.Chart.Wallbox1_48h_json_chart
ems-optimizer.0.Chart.Wallbox2_48h_json_chart
ems-optimizer.0.Chart.GridPower_48h_json_chart
```

Preisdiagramm:

```text
ems-optimizer.0.Chart.EnergyPrice_48h_json_chart
ems-optimizer.0.Chart.GridFee_48h_json_chart
ems-optimizer.0.Chart.TotalPrice_48h_json_chart
```

Batteriediagramm:

```text
ems-optimizer.0.Chart.BatteryPower_48h_json_chart
ems-optimizer.0.Chart.BatterySoC_48h_json_chart
ems-optimizer.0.Chart.BatteryTargetSoC_48h_json_chart
```

## Vorzeichen

- `Actual.GridPower_W`: positive Werte bedeuten Netzbezug.
- `Plan.BatteryPower_48h_JSON`: positive Werte bedeuten Laden, negative Werte
  bedeuten Entladen.

## Sicherheit

Der Adapter ist kein Schutz- oder Sicherheitsgerät. Hausanschlussschutz,
Temperaturgrenzen, §14a-Vorgaben, Geräteschutz, Schütze und Notabschaltungen
müssen weiterhin durch geeignete lokale und deterministische Funktionen
gewährleistet werden.

Ohne ausdrückliche globale und gerätespezifische Freigabe schreibt der Adapter
ausschließlich in seinen eigenen Namespace `ems-optimizer.0`. Freigegebene
Fremdschreibzugriffe sind der konfigurierte Trinkwasser-Sollwert mit optionalem
Istwert-Spiegel oder die beiden konfigurierten Ausgänge der einzeln getesteten Wallbox.

## Gerätefreigaben ab 0.11.0

Jedes geplante Gerät besitzt zwei getrennte Schalter auf der
Konfigurationsseite:

- **Vorhanden / in Planung berücksichtigen** nimmt das Gerät in Fahrplan und
  Simulation auf. Ist der Schalter aus, bleibt seine geplante Leistung null.
- **Steuerfreigabe** erlaubt beim Trinkwasser-EHZ zusammen mit dem globalen
  Hauptschalter die produktive Ansteuerung. Ab 0.16.0-alpha.1 können alle drei
  einzeln bestätigten Wallboxen freigegeben werden; die harte Verriegelung lässt
  weiterhin nur eine Wallbox gleichzeitig laden. Batterie, Heizpuffer und
  Wärmepumpe bleiben ohne Aktorzugriff.

Darüber liegt die globale Freigabe **Master release for configured real outputs**.
Sie ist standardmäßig aus. Der EHZ-Ausgang wird erst freigegeben, wenn
alle drei Bedingungen gleichzeitig erfüllt sind: globaler Schalter,
gerätespezifische Steuerfreigabe und gültige Sicherheits-/Messwerte vorliegen.

Für den ersten Ausbau sollten nur Wallbox 0, Wallbox 1, Wallbox 2 und der
Trinkwasser-Heizstab als vorhanden markiert sein. Heizpuffer-Heizstab,
Hausbatterie und Wärmepumpe bleiben bis zur realen Inbetriebnahme ausgeschaltet.
Die vier Punkte der Trinkwasser-Temperaturkennlinie bestehen nun jeweils aus
einer frei einstellbaren Temperatur und der dazugehörigen maximalen Leistung.

### Produktiver Trinkwasser-EHZ ab 0.12.0

Der Ausgang ist im Auslieferungszustand gesperrt und zunächst auf 1.000 W
begrenzt. Vor jedem Schreiben prüft der Adapter die drei Freigaben, EMS- und
Reglergültigkeit, AC-THOR-Verbindung, vier Speichertemperaturen,
Ausgangstemperatur, Temperaturkennlinie, Hausanschlussschutz und die freie
Stromstärke jeder Phase. Die harten Stufen 2 und 3 besitzen wie im bisherigen
Skript eine Wiederzuschaltverzögerung von 30 Sekunden. Bei Verlust einer
Freigabe oder eines gültigen Messwerts sowie beim Adapterstopp wird ein zuvor
aktiver Ausgang auf 0 W gesetzt.

```text
ems-optimizer.0.System.RealOutputsEnabled
ems-optimizer.0.Devices.MyPV_DHW.ControlEnabled
ems-optimizer.0.Devices.MyPV_DHW.OutputActive
ems-optimizer.0.Devices.MyPV_DHW.OutputCommand_W
ems-optimizer.0.Devices.MyPV_DHW.OutputStatus
ems-optimizer.0.Devices.MyPV_DHW.OutputLastWrite
ems-optimizer.0.Devices.MyPV_DHW.DirectGridPower_W
ems-optimizer.0.Devices.MyPV_DHW.ActuatorSettled
ems-optimizer.0.Devices.MyPV_DHW.ActuatorDifference_W
ems-optimizer.0.Devices.MyPV_DHW.CommandAge_s
ems-optimizer.0.Devices.MyPV_DHW.EffectiveStep_W
ems-optimizer.0.Devices.MyPV_DHW.ProductionRemainingError_W
ems-optimizer.0.Devices.MyPV_DHW.ControlReason
```

Seit Version 0.12.4 nutzt der produktive EHZ-Regler die aktuellen Import- und
Exportwerte direkt vom Netzverknüpfungspunkt. Nach einer Leistungserhöhung
wartet er, bis die gemessene AC-THOR-Leistung höchstens 300 W vom letzten
Befehl abweicht; nach spätestens 15 Sekunden darf er vorsichtig erneut
erhöhen. Bei Netzbezug reduziert er ohne diese Wartezeit. Die Schrittweite
wird nahe dem NVP-Ziel automatisch von maximal 1.000 W auf 500 W bzw. 200 W
verkleinert. Dadurch werden mehrere noch nicht umgesetzte Erhöhungen und das
beim Inbetriebnahmetest beobachtete Pendeln vermieden.

## Zweistufige Echtzeit-Simulation ab 0.8.0

Der 48-Stunden-Fahrplan ist eine strategische Freigabe und kein starrer
Leistungsdeckel. Wenn real mehr PV als prognostiziert zur Verfügung steht,
duerfen freigegebene Wallboxen und der Trinkwasser-Heizstab bis zu ihren
technischen, SoC- und Temperaturgrenzen mehr Leistung aufnehmen.

- Die Batterie regelt die NVP-Abweichung alle 2 Sekunden aus.
- Wallboxen und Heizstäbe ändern ihre Sollwerte standardmäßig alle 5 Sekunden. Damit kann der Trinkwasser-Heizstab den NVP ohne vorhandene Batterie zeitnah ausregeln.
- Wallboxen arbeiten nur mit ganzen Ampere und mindestens dem je Fahrzeug
  konfigurierten Mindeststrom.
- Wallboxänderungen sind auf 6 A je langsamem Zyklus begrenzt.
- Der Trinkwasser-Heizstab ändert sich um höchstens 1.000 W je langsamem Zyklus.
- Bei der Ampere-Abrundung freie Leistung wird dem stufenlosen Heizstab angeboten.
- Nach Versorgung des priorisierten Fahrzeugs wird verbleibender Ueberschuss
  auf weitere freigegebene Fahrzeuge verteilt.
- Die 1-/3-phasige Empfehlung beachtet den Umschalthaken und die getrennten
  Stromgrenzen jedes Fahrzeugs.
- Erreicht ein Gerät seine SoC-, Temperatur- oder Sicherheitsgrenze, bleibt es
  auch bei zusätzlicher PV-Leistung gesperrt.

Die unmittelbar simulierten Werte stehen vollständig unter:

```text
ems-optimizer.0.Control.Targets.Battery_W
ems-optimizer.0.Control.Targets.MyPV_DHW_W
ems-optimizer.0.Control.Targets.Wallbox0_W
ems-optimizer.0.Control.Targets.Wallbox0_A
ems-optimizer.0.Control.Targets.Wallbox1_W
ems-optimizer.0.Control.Targets.Wallbox1_A
ems-optimizer.0.Control.Targets.Wallbox2_W
ems-optimizer.0.Control.Targets.Wallbox2_A
ems-optimizer.0.Control.Targets.Wallbox0_Phases
ems-optimizer.0.Control.Targets.Wallbox1_Phases
ems-optimizer.0.Control.Targets.Wallbox2_Phases
```

## Abgleich der aktiven Wallbox- und E-Heizer-Skripte

Version 0.7.0 berücksichtigt ausschließlich die aktuell aktiven Skripte;
deaktivierte Altversionen wurden nicht übernommen.

| Funktion | Umsetzung im Adapter | Zuständigkeit bis zur Produktivfreigabe |
|---|---|---|
| Fahrzeugpriorität | Grundrang Wallbox 0/1/2, `socfrei`, `alw`, Fahrzeugstatus und `javascript.0.ev.prio` | Erst priorisiertes Fahrzeug, danach weitere Fahrzeuge mit Restueberschuss |
| SoC-Verwaltung | Mindest-/Ziel-SoC, `amin0..2` und die von `socfrei == 2` abhängigen Stromstufen | Fahrplan, Echtzeitverteilung und Produktivausgang |
| Phasenerkennung | Direkte Auswertung von L1/L2/L3 mit mehr als 5 A; alter Phasenwert nur als Rückfall | Adapter-Simulation |
| Wallbox + Trinkwasser | 50/50-Verteilung, Wallbox in ganzen Ampere, ungenutzter Anteil und Rundungsrest an den EHZ | Prognose und zentraler 2-s-Regler; produktiver Kombitest ab 0.14.0 separat gesperrt |
| Hysterese einphasig | EIN über 4.000 W, AUS unter 3.000 W | Konfigurierbar unter `Config.DHWParallelStartPower1P_W` und `Config.DHWParallelStopPower1P_W` |
| Hysterese dreiphasig | EIN über 9.000 W, AUS unter 8.000 W | Konfigurierbar unter `Config.DHWParallelStartPower3P_W` und `Config.DHWParallelStopPower3P_W` |
| E-Heizer-Schutz | 9-kW-Maximum und bestehende Temperaturkennlinie | Adapter simuliert den sicheren Sollwert |
| NVP-Ausregelung | Ein gemeinsamer Regler: Wallbox grob, stufenloser EHZ als Feinregler; später Batterie für den verbleibenden Fehler | Simulation; produktiv einzeln ab 0.12/0.13, Kombination ab 0.14.0 zur Abnahme vorbereitet |
| Ampere-/Freigabeschreiben, Hausanschlussschutz | Gesicherter Einzeltest mit Rückmeldung; ab 0.14.0 sichere gemeinsame Freigabekette | Je Aktor genau ein Schreiber; niemals Adapter und Bestandsskript gleichzeitig |
| Phasenumschaltung | rohe und stabilisierte 1-/3-phasige Empfehlung mit fahrzeugspezifischen Grenzen; kein Aktorzugriff | Ausschließlich bestehende lokale Skripte schalten real |
| RFID und Fehlerquittierung | Nicht doppelt implementiert | Bestehende lokale Skripte |
| EHZ-Pumpe und Raum-PV-Boost | Nicht doppelt implementiert | `EHZ-Pumpe_V2` und `EHZ-P2FBH` |

Der aktuelle Abgleich ist außerdem maschinenlesbar unter
`ems-optimizer.0.System.ActiveScriptAudit_JSON` abgelegt. Es werden mit dieser
Version keine Adapter-Objekte entfernt.

### Skriptumschaltung

Solange alle produktiven Gerätefreigaben ausgeschaltet sind, bleiben
**alle derzeit aktiven Wallbox- und E-Heizer-Skripte eingeschaltet**. Insbesondere
bleiben `PV_Sicherung`, `Werte_schreiben_0_V2`, `Werte_schreiben_1_V2`,
`Werte_schreiben_2_V2`, `EHZ-Pumpe_V2` und `EHZ-P2FBH` aktiv. Ein Abschalten der
Schreibskripte wäre ohne gezielte Übernahme falsch. Für den Wallbox-Einzeltest
und die spätere gemeinsame Inbetriebnahme gilt die konkrete Übergabeanleitung
oben. Version 0.15.1 schaltet kein Skript automatisch ab. Bei einer ausdrücklich
produktiv freigegebenen Übernahme werden wegen doppelter Entscheidungslogik
schrittweise folgende Skripte abgelöst:

- `PV_Fahrplan`
- `PV_Nacht`
- `PV_Ueberschuss_Freigabe`
- `PV_Ueberschuss_Stufen`
- `PV_Ueberschuss_Verteilung`
- `EHZ-Aufteilen_V5`
- `EHZ-Leistung_V2`

Die drei Skripte `Werte_schreiben_0_V2`, `Werte_schreiben_1_V2` und
`Werte_schreiben_2_V2` dürfen erst abgeschaltet werden, wenn der Adapter die
go-e-Ausgänge einschließlich Hausanschlussgrenze, §14a, Rampen und Rückmeldung
nachweislich selbst übernimmt. `PV_Sicherung`, die übergeordneten
§14a-/EEBUS-Funktionen, `EHZ-Pumpe_V2`, `EHZ-P2FBH`, Geräte- und
Temperaturschutz sowie Notabschaltungen bleiben auch dann als unabhängige
Sicherheitsebene aktiv. `PV_Ueberschuss_SOCmin` und `PV_min_max` bleiben in der
ersten Übergangsstufe ebenfalls aktiv, solange ihre Zustände noch Eingänge des
Adapters sind.

## Entwicklungshistorie

| Version | Änderung |
|---|---|
| 0.17.0-alpha.1 | Gemeinsame AP2-Umsetzung der Issues #5 und #28–#32: explizite Admin-Datenquellen mit JSON-Migration, zentrale Hausanschlussgrenze, eigene Wallbox-/Historien-/Prognosebereiche, externe Prioritäts- und Preisschalter sowie Diagnose. Kombiregelung nutzt gemessene Wallboxleistung und begrenzt Erhöhungen auf standardmäßig 1 A je Zyklus; EHZ-Einspeisenachführung bis 3 kW je bestätigtem Schritt. Laufende EMS-eigene Wallbox bleibt bei Restart/GitHub-Update aktiv und wird geprüft übernommen. Keine neue Ausgangsfreigabe wird aktiviert. |
| 0.16.0-alpha.2 | Zeitführung laufender Produktiv-Wallboxen korrigiert: kein erneuter Einschalt-Countdown bei kurzzeitigem internem Null-Sollwert; separate Diagnoseobjekte folgen der realen Mindestlaufzeit. |
| 0.16.0-alpha.1 | Alpha-Gesamtsteuerung für WB0, WB1, WB2 und Trinkwasser-EHZ. Harte Sequenzverriegelung: nie mehr als eine Wallbox gleichzeitig, bestätigtes AUS vor Übergabe, unbekannte laufende Fremdfreigaben werden zuerst kontrolliert gestoppt. EHZ bleibt während der Startverzögerung und parallel zur aktiven Wallbox Feinregler. Startreserve arbeitet nach Beginn des Countdowns als Hysterese; zusätzliche produktive Mindestlaufzeit-Sicherung direkt am Wallbox-Ausgang. Neue standardmäßig ausgeschaltete Alpha-Freigabe; reale Phasenumschaltung bleibt extern. |
| 0.15.5 | Sichere Wiederübernahme eines zuvor EMS-eigenen und weiterhin aktiven Wallbox-Auftrags nach ungeplantem Prozessneustart. Vollständige Live-Sicherheitsprüfung vor der Übernahme; bei fehlender Eigentümerschaft oder ungültigen Bedingungen wird nicht übernommen. Keine Objekte ergänzt oder entfernt und keine zusätzlichen Ausgänge aktiviert. |
| 0.15.4 | Produktive Wallbox-Mindestlaufzeit beginnt erst mit dem bestätigten realen Ausgang statt mit einem früheren Simulationssollwert. Einschaltverzögerung und verbleibende Mindestlaufzeit werden je Wallbox über vier Diagnoseobjekte sichtbar. Zwölf Objekte ergänzt, keine entfernt und keine zusätzlichen Ausgänge aktiviert. |
| 0.15.3 | Produktiven PV-Betrieb stabilisiert: konfigurierbare Startreserve, Startverzögerung und Wallbox-Mindestlaufzeit; nicht nutzbares Ganzampere-/Mindestleistungsbudget fällt an den EHZ-Feinregler zurück. Laufende Wallboxen werden anhand ihrer tatsächlichen Leistungsaufnahme nachgeregelt. 4/3-kW-Hysterese mit Tests abgesichert und Statusmeldungen für Fahrzeug/SoC präzisiert. Drei Konfigurationsobjekte ergänzt, keine Objekte entfernt und keine weiteren Ausgänge aktiviert. |
| 0.15.2 | Leere Wallbox-Abfahrtszeit als „keine Abfahrt“ umgesetzt. Das Fahrzeug bleibt dann im gesamten 48-Stunden-Horizont planbar; ohne Uhrzeit wird keine Deadline-Ladung ausgelöst. Keine Objekte ergänzt oder entfernt, keine Admin-Einstellungen und keine produktiven Ausgänge verändert. |
| 0.15.1 | Issue #8: statischen §14a-Binärkontakt mit konfigurierbarem Festlimit ergänzt. Binärkontakt und EEBUS-LPC werden automatisch anhand der angegebenen Datenpunkte ausgewertet; bei zwei aktiven Begrenzungen gilt das kleinere Limit. Statische Kontakte verfallen nicht wegen eines unveränderten Zeitstempels. Keine Objekte ergänzt oder entfernt und keine produktiven Ausgänge aktiviert. |
| 0.15.0 | Issues #8/#27: EEBUS-LPC als gemeinsames Budget von Wärmepumpe und Wallboxen umgesetzt; ungültige Signale sperren sicher. Phasenweisen Hausanschlussschutz um optionale getrennte Bezugs-/Einspeiseleistungen ergänzt und die zugehörigen Admin-Felder nach General verschoben. Der Adapter gibt weiterhin nur Phasenempfehlungen aus; reale Umschaltung bleibt beim externen Skript. Vier Diagnoseobjekte ergänzt, keine Objekte entfernt und keine produktiven Ausgänge aktiviert. |
| 0.14.0 | Issues #6/#7: manuelle Mindestströme `amin0..2` und nur bei `socfrei == 2` wirksame niedrige SoC-Stromstufen ergänzt; zentralen NVP-Regler für 50/50-Verteilung vorbereitet, Wallbox grob und EHZ stufenlos als Feinregler. Vorhandenes `javascript.0.ehz.aufteilen` als konfigurierbaren, nur gelesenen Laufzeitschalter übernommen; separater standardmäßig ausgeschalteter Kombinations-Arming-Schalter, Diagnose und sichere Übergabereihenfolge ergänzt. Keine Objekte entfernt. |
| 0.13.0 | Issue #4: Min-/Ziel-SoC und Fahrzeugpriorität im Admin, Mindest-SoC vor manueller Priorität, zwei konfigurierbare SoC-Reduktionsstufen in Prognose/Simulation/Output; gesicherter Wallbox-Einzeltest mit 6-A-Start, bestätigter Rückmeldung, Fehler-/NVP-/Hausanschlussprüfung. Neue Ausgänge bleiben aus; keine Objekte entfernt. |
| 0.12.4 | Produktive NVP-Regelung des Trinkwasser-EHZ auf direkte SMA-Netzwerte umgestellt; Rückmelde-/Beruhigungslogik für den AC THOR, sofortige Reduktion bei Netzbezug, adaptive 1.000-/500-/200-W-Schritte und zusätzliche Diagnoseobjekte ergänzt. |
| 0.12.3 | Zeitüberwachung an Sensorverhalten angepasst: unveränderte Tanktemperaturen bis 60 Minuten gültig, dynamische Ausgangstemperatur und Regler weiterhin eng überwacht. Produktiver Trinkwasser-Heizstab und langsame Zielverteilung standardmäßig alle 5 Sekunden. |
| 0.12.2 | Hausanschlussbegrenzung des EHZ auf aktuelle SMA-Phasenströme umgestellt; statische `FreieAmpere`-Werte dürfen unverändert bleiben, ohne den Watchdog auszulösen. |
| 0.12.1 | Watchdog ergänzt: produktiver EHZ fällt auf 0 W, wenn EMS- oder Echtzeitregelung nicht mehr innerhalb ihrer zulässigen Zeit aktualisiert werden. |
| 0.12.0 | Dreifach gesperrter Produktivausgang ausschließlich für den Trinkwasser-EHZ; konfigurierbarer Sollwert, 1-kW-Inbetriebnahmegrenze, Temperatur-/Daten-/HA-Prüfung, Stufenverzögerung und sichere Abschaltung. |
| 0.11.0 | Globale und gerätespezifische Freigaben ergänzt; nicht vorhandene Geräte werden aus Planung und Simulation entfernt. Trinkwasserkennlinie auf vier konfigurierbare Temperatur-/Leistungspaare umgestellt und sichere Skript-Umschaltfolge dokumentiert. |
| 0.10.0 | Konfigurationsseite fuer Fahrzeuge, beide Heizstaebe, Batterie, NVP-Regelung sowie Preise/Netzentgelte gegliedert; Trinkwasser-Temperaturkennlinie konfigurierbar. |
| 0.9.0 | Sichtbare Fahrzeugkonfiguration, eigener Haken fuer 1-/3-phasige Umschaltung, getrennte Stromgrenzen und parallele Nutzung mehrerer Wallboxen bei Restueberschuss. |
| 0.8.0 | Fahrplan als Freigabe statt starrem Leistungsdeckel; zusätzliche reale PV-Leistung wird verteilt. Wallboxen in ganzen Ampere ab 6 A, langsame Verbraucher alle 10 s und Batterieausregelung alle 2 s. |
| 0.7.0 | Aktive Wallbox-/E-Heizer-Skripte abgeglichen: vollständige Fahrzeugpriorität, direkte Phasenerkennung und 50/50-Verteilung mit 4/3-kW- bzw. 9/8-kW-Hysterese in Prognose und 2-s-Simulation. |
| 0.6.0 | Trinkwasser-Heizstab mit Temperaturkennlinie, 9-kW-Grenze und reiner Sollwertsimulation ergänzt. |
| 0.3.2 | Versionsmeldungen des Adapters vereinheitlicht; keine Änderung der EMS-Logik oder Objekte. |
| 0.3.1 | Konfigurierbare Mindestgrundlast verhindert unplausible Nullwerte nach Abzug historischer flexibler Verbraucher. Standard: 500 W über `ems-optimizer.0.Config.MinimumBaseload_W`. |
| 0.3.0 | EMS-Logik ohne Funktionsänderung in Module für Kern, Historie, Prognose, Planung, Beobachtung und Start getrennt. |
| 0.2.10 | Aufbewahrung der EMS-eigenen SQL-Ausgänge auf 90 Tage begrenzt. |
| 0.2.9 | SQL-Historie speicherschonend nacheinander und in Sieben-Tage-Blöcken. |
| 0.2.8 | Adapter-Icon und Objekt `info.connection` ergänzt. |
| 0.2.7 | Batterieladung in das spätestmögliche sichere PV-Fenster verschoben. |
| 0.2.6 | Fahrzeug-SoC, Ladeziel und Freigabe sowie parallele Verteilung zwischen Trinkwasser und Wallbox ergänzt. |
| 0.2.5 | Dreistufige Batterieladung: morgens 70 %, nachmittags 90 %, später Abschluss auf 100 %. |
| 0.2.4 | Batterieentladung für Eigenverbrauch und Kennzahlen zur Speicherbewertung ergänzt. |
| 0.2.3 | PV-Skalierung korrigiert; Hauslast und bereinigte Grundlast getrennt. |
| 0.2.2 | my-PV-Historie auf einen historisierten Gesamtleistungswert umgestellt. |
| 0.2.1 | ECharts-kompatible `json_chart`-Objekte ergänzt. |
| 0.2.0 | 48-Stunden-Gerätefahrplan für Batterie, zwei Heizstäbe, PV-Boost und drei Wallboxen. |
| 0.1.2 | Vier Unterzähler, Profile je Wochentag/Feiertag und getrennte Preisbestandteile. |
| 0.1.1 | Wetter- und PV-Prognose für fünf PV-Flächen. |
| 0.1.0 | Erster reiner Beobachtungsmodus. |

## Lizenz

MIT
