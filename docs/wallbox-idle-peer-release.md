# Abgesteckte Wallbox mit fremder Ladefreigabe

## Belegter Anlass

Am 08.10.2026 lief der EQV an WB1 produktiv unter EMS-Steuerung mit alpha.50. Die folgende Ereigniskette wurde aus zusammengehörigen DecisionRecords und realen Leistungswerten gelesen. Alle Uhrzeiten sind Europe/Berlin.

| Uhrzeit | Beobachtung |
|---|---|
| 08:50:31.453 | `go-e.2.allow_charging` meldet 1 mit `ack=true` und `q=0`. |
| 08:50:31.543–31.732 | EQE/WB2 meldet `car=1` („kein Fahrzeug“), 0 W und auf L1–L3 jeweils 0 A nach der Freigabekante. |
| 08:50:32.027 | EQV erhält den Stoppgrund „Sequenzbetrieb: Ladefreigabe Wallbox 2 noch aktiv“. |
| 08:50:32.040 | EMS schreibt für WB1 `allow_charging=0`. |
| 08:50:32.213–32.344 | EMS schreibt anschließend für WB2 AUS; die Gerätebestätigung meldet 0. |
| 08:50:52.018–52.035 | EQV erhält wieder Ladefreigabe 1. |
| 08:51:15.029 | EQV misst wieder ungefähr 1,22 kW. |

Die 63 Records des begrenzten Fensters 08:50:30–08:50:35 gehören zur Sitzung `1791433038939`, Sequenzen 46446–46508. Der EQV-Ausgangswechsel steht in Sequenz 46474 und sein AUS-Befehlsversuch in Sequenz 46477. Die reale Freigabe war damit ungefähr 20 Sekunden entzogen; die elektrische Fahrzeugantwort folgte später. Der Ursprung der fremden EQE-Freigabe ist nicht belegt. Ein Adapter-Absender oder die zeitliche Nähe zum Abstecken beweist weder eine Firmwareursache noch einen Skript- oder Benutzereingriff.

## Enge Ausnahme für eine laufende Ladung

Alpha.51 trennt eine belegbar abgesteckte, elektrisch ruhende Wallbox mit `allow=1` von einer aktiven oder unbekannten fremden Freigabe. Die Ausnahme gilt ausschließlich beim Weiterführen der bereits aktiven, ausgewählten EMS-eigenen Wallbox. Die fremde Wallbox muss ohne EMS-Eigentümerschaft und ohne offene Start-, Stopp-, Rückmelde- oder Phasenaktion sein.

Die realen Quellen müssen frisch, bestätigt und qualitativ gültig sein: `car=1`, gültige Verbindung, Gerätefehlerstatus 0, normierte Leistung höchstens 20 W und jeder der drei nichtnegativen Phasenströme höchstens 0,5 A. Fehlende, NULL-, ungültige oder veraltete Werte reichen nicht aus. Eine angenommene Schattenantwort bestätigt keine physische Ruhe.

Fahrzeugstatus, Leistung und sämtliche Phasenströme müssen mindestens so neu wie die tatsächliche ON-Kante der fremden Freigabe sein. Maßgeblich ist ihr gültiger `lc`-Zeitstempel; nur wenn `lc` fehlt, wird `ts` verwendet. Eine alte Nullmessung vor der Freigabekante genügt nicht. Das spätere zyklische Einlesen eines unveränderten Freigabewerts verschiebt die bereits belegte Kante nicht künstlich nach vorne.

Wenn diese Bedingungen erfüllt sind, löst die fremde Freigabe weder den Sequenzstopp der laufenden Wallbox noch eine administrative AUS-Übernahme der abgesteckten Wallbox aus. Damit entsteht auch keine nachfolgende Sperre durch einen solchen neu angelegten Abschaltauftrag. Die Ausnahme gibt der fremden Wallbox keine EMS-Ladefreigabe und beansprucht sie nicht als Ausgang.

## Unveränderte Verriegelungen

Ein neuer Erststart darf diese Ausnahme nicht verwenden. Vor einer neuen Ladefreigabe benötigen die anderen steuerbaren Wallboxen weiterhin eine passende AUS-Rückmeldung und elektrische Ruhe. Bestehende Eigentümerschaft, offene Aktionen, Wiederanlauf-/Restart-Prüfungen und reale Übergaben bleiben im normalen Ablauf.

Bei weiterhin bestätigtem `allow=1` sperrt die normale Sequenzverriegelung wieder, sobald die fremde Wallbox ein Fahrzeug, Last, einen Gerätefehler oder unzureichende Ruhebelege meldet. Unbekannte Freigabewerte werden weiterhin nach den bestehenden Regeln behandelt: Sie beweisen kein AUS und verhindern neue Starts; eine einzelne Telemetrielücke eines unbesetzten Peers beendet keine bereits etablierte Ladung. Der laufende Ausgang erhält keine pauschale Immunität gegen Peerfehler. Hausanschluss-, §14a-, Geräte-, Quellen- und Budgetprüfungen sowie konfigurierte Kommunikations- und Reaktionsfristen bleiben erhalten. Start-, Stopp- und Mindestlaufzeiten werden nicht geändert.

Die Befreiung basiert auf zuletzt bestätigten Messwerten innerhalb der konfigurierten Frischefrist. Ein physisches Anstecken zwischen zwei Geräteabfragen bleibt daher ein Kommunikations- und Reaktionsfall. Softwaretests beweisen keine ungemessene Zwischenzeit und keine reale Geräteabschaltung.

## Regressionen und nächste Betriebsprüfung

Die gezielten Regressionen müssen den fortlaufenden Regeltakt mit abgestecktem Peer und `allow=1` abbilden: Die bestehende Ladung bleibt aktiv, erhält keinen AUS-Befehl und verliert weder Ladeblock noch Timer. Gegenproben müssen Anstecken, positive Leistung oder Phasenströme, fehlende/veraltete/ungültige Quellen, Messungen vor der ON-Kante, fremde Eigentümerschaft und offene Aktionen wieder sperren. Erststarts bleiben auch bei bestätigter Ruhe bis zum fremden AUS verriegelt.

Nach ausdrücklicher Installation sind passende reale Ereignisse erneut lesend zu prüfen: Freigabekante, Fahrzeugstatus, ACK/Qualität, alle Quellenzeiten, elektrische Ruhe, weiterlaufende EQV-/Mii-/EQE-Ladung und fehlender administrativer Peer-Abschaltauftrag müssen zusammenpassen. Bei einer tatsächlichen Übergabe sind weiterhin AUS-Bestätigung, elektrische Ruhe, Phasenrückmeldung und Fahrzeugantwort getrennt nachzuweisen.

Keine automatische Installation oder Änderung von ioBroker-Konfiguration, SQL, Bestandsskripten, Master Control, Phasenfolgen oder Aktoren. Neue Betriebsnachweise und Scorepunkte werden nicht vorweggenommen.
