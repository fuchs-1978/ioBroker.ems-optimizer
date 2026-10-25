# 0.17.0-alpha.149 – Wichtige Tagesereignisse und konkrete Sollstrom-Konfliktdiagnose

## Belegte Ausgangslage

Am 25.10.2026 um 18:47 Uhr MEZ unter laufender alpha.148: Die kompakte aktuelle Tagesperiode zaehlte 35 Statusereignisse, `eventOverflow=35`, `events=[]`. Die bestehende 64.000-Byte-Begrenzung entfernte Statusereignisse vor Untersuchungsepisoden. Dadurch konnten saemtliche Stopp-/Statusdetails aus der Kurzfassung verschwinden. Das belegt keine fehlenden SQL-Originale. Die Tagesperiode 24.10.20:00–25.10.20:00 Europe/Berlin umfasst wegen Zeitumstellung korrekt 25 Stunden; das wird nicht veraendert.

Der EQE-Stopp vom 25.10. um 10:39:34.095 MEZ bleibt in [Issue #216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216) offen: Der bisherige Sammelgrund konnte mehrere gescheiterte Bedingungen oder einen bereits verbrauchten Korrekturversuch bedeuten. Die damaligen fehlenden Quellen-/Befehlsnachweise werden durch diese Version nicht rekonstruiert. Der vorhandene begrenzte 1-A-Korrekturversuch aus alpha.114 wird nicht erneut entwickelt oder erweitert.

## 1. Geschuetzte kleine Ereignisreserve

Je aktueller/vorheriger Tagesperiode bleiben weiterhin hoechstens 100 abgetastete Statusereignisse und zusammen hoechstens 64.000 Byte fuer den gesamten Zustand. Geschuetzt werden innerhalb dieser bestehenden Liste die **sechs juengsten Wallboxstopps** (`wb0..2.stopAt`, gemeinsam) und **zwei juengsten Recorderfehler-Beobachtungen** (`recorder.dropped`/`recorder.writeErrors`, gemeinsam). Normales SoC-Ende oder Benutzerstopp wird damit nicht als Fehler eingestuft.

Ein neues wichtiges Ereignis kann bei voller Liste den aeltesten nicht reservierten Eintrag ersetzen. Beide Kategorien schuetzen ihre Reserve gegeneinander. Bei Byteknappheit werden zuerst nicht reservierte Ereignisse entfernt, danach bestehende abgeschlossene Untersuchungsepisoden nach deren unveraenderter Prioritaet. Deren Verlust bleibt in `investigation.overflow` und den bereits vorhandenen Typzaehlern sichtbar; keine Doppelzaehlung oder Ausblendung von Einspeisung/Quellenluecken.

Nur falls die nicht weiter verkleinerbare Basis sonst nicht in die feste Bytegrenze passt, duerfen auch reservierte Ereignisse entfallen. `protectedEventOverflow` beziehungsweise `eventRetention.protectedOverflow` weisen diese neuen erzwungenen Reserveverluste aus. Sie sind Teil des gesamten `eventOverflow`, nicht zusaetzlich zu addieren. `eventRetention` nennt die beiden Reservelimits und tatsaechlich behaltenen reservierten Anzahlen. Das ist keine Garantie vollstaendiger Ereigniserfassung.

Positive, innerhalb eines gueltigen bisherigen Abtastintervalls beobachtete Recorderzaehler-Differenzen erzeugen nun kleine Fehlerereignisse mit `delta`. Reset, fehlender Vergleichswert oder Beobachtungsluecke werden nicht als neue Fehler erfunden. Bestehende Recorder-Summen, Energieintegrale, Quellenabdeckung, 10-s-Fortschreibungsgrenze und Periodenwechsel bleiben erhalten.

Schema1-Altstaende, alte Ereignisse und bestehende Ueberlaufzaehler bleiben lesbar. Die neue Reserve-Verlustzaehlung beginnt mit dieser Schutzregel; fruehere Verluste sind nicht nachtraeglich nach Schutzkategorie aufteilbar. Bereits entfernte 35 Ereignisse werden nicht wiederhergestellt. Eine Kurzfassung ersetzt weiterhin keine vollstaendige Soll-/ACK-/elektrische Wirkungskette.

## 2. Konkrete Diagnose vor dem bestehenden Sollstrom-Konfliktstopp

Die bestehenden Korrekturbedingungen werden in identischer Reihenfolge und mit identischer Kurzschlussauswertung geprueft. Der erste falsche Ausdruck erhaelt einen festen Diagnosecode. Nachfolgende Bedingungen bleiben ungeprueft/unbekannt; der Code ist keine bewiesene physische Ursache fuer die falsche Rueckmeldung.

Codes: `correction-used`, `not-owned`, `recovering`, `no-active-run`, `output-inactive`, `allow-not-on`, `phase-switch`, `phase-transition`, `phase-unconfirmed`, `budget-step-pending`, `shared-feedback-id`, `command-not-own-current`, `command-before-write`, `feedback-before-write`, `not-one-amp-difference`, `feedback-not-integer`, `feedback-below-minimum`, `feedback-above-maximum`, `no-electrical-load`, `measured-below-minimum`, `response-assumed`.

`Devices.WallboxN.CurrentConflict_JSON` entsteht nur bei einem solchen neuen Konflikt. Die begrenzte reine Diagnose enthaelt Zeitpunkt, Wallbox, Bedingung, erwarteten/gelesenen/angeforderten Strom, wirksame Min-/Maxwerte, Phasen, Leistung/Strom, Korrektur-/Beruhigungsstatus und originale Command-/Feedbackwerte mit ts/lc/ACK/q. Fehlendes/NULL bleibt unbekannt, false ACK oder schlechtes q werden nicht in einen gueltigen Nachweis umgedeutet. Keine Zugangsdaten, kompletten Konfigurationen oder beliebigen Quellobjekte. Zeichenketten sind auf 80 Zeichen begrenzt.

Der unveraenderte Sammelgrund erhaelt einen eindeutigen Anhang `[current:Zeitstempel:Bedingung]`. Der passende Recorder-Vollsnapshot und Stopp-Ereigniskontext erhalten zusaetzlich `wallboxes[].currentConflict`; ein spaeterer anderer Stopp erbt diesen Kontext nicht. Die Tagesbilanz kann Zeitpunkt/Code/erwarteten/gelesenen Strom als kleinen Stoppzusatz behalten.

Diagnoseerzeugung und optionale eigene Zustandsspeicherung erfolgen ohne zusaetzliche Direktlesung/SQL-Abfrage. Ein ausstehender, abgelehnter oder synchron fehlschlagender Diagnose-Schreibzugriff verzoegert oder verhindert den bisherigen AUS-Pfad nicht. Der neue Zustand ist keine Korrektur-/Neustartberechtigung und wird dafuer nicht zurueckgelesen. Keine Aenderung von Freigaben, Stellbefehlen, Schwellen, 1-A-Ausnahme, Retrybudget, ACK-Frist, Reserven oder Schutzpruefungen.

## Softwarebelege und reale Abnahme

26 zusaetzliche Tests: volle Ereignisliste, getrennte Reserven trotz Fehlerflut, zwei volle Tagesperioden mit Byteknappheit/Unicode, Wiederaufnahme ohne erfundene Altereignisse, explizit gezaehlter letzter Reserveverlust, Recorderreset/-luecke, konkrete Konfliktbedingungen, unveraenderter AUS-Befehl trotz haengender/fehlgeschlagener Diagnosespeicherung, originale ACK/q/NULL und passender Recorder-Ereigniskontext. Drei Kernregressionen scheitern auf alpha.148.

Abschliessend lokal unter Node.js24.22.1: 3115/3115 Tests bestanden, Paketmetadaten mit sieben Versionsnachrichten, installierbarer Tarball mit 243 Dateien/720 erzeugten Zustaenden sowie beide historischen Verhaltensvergleiche bestanden. CI22/24/26 und Release sind eigene Nachweise im PR/Workflow. Kein Anlagenversuch oder neu geladener historischer SQL-Abschnitt.

Nach manueller Installation an natuerlichen neuen Ereignissen pruefen: wichtige Ereignisse/Reserven bei wachsender Tagesbilanz, alle Ueberlaufzaehler zusammen mit Typverlusten, unveraenderte Energie-/Quellenabdeckung; bei einem neuen Sollstromkonflikt exakter Bedingungscode und Quellen im passenden SQL-Original sowie bisheriger AUS-/ACK-/elektrischer Ablauf. Keine kuenstlichen Schaltversuche, Installation oder Konfigurationsaenderung durch diesen Entwicklungsauftrag. Keine reale Ursachenaufklaerung des alten EQE-Stopps, vollstaendige Tagesabnahme oder Scorepunkte allein aus der Softwareaenderung behaupten.
