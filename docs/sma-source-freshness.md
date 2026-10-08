# Einheitlicher SMA-Netzquellenvertrag ab alpha.52

## Änderung und Geltungsbereich

Die zugeordneten Netz- und Hausanschlussmessungen verwenden in alpha.52 höchstens **30 Sekunden Quellenalter**. Maßgeblich ist die Quellenzeit `ts`; die letzte Wertänderung `lc` und der EMS-Empfangszeitpunkt ersetzen sie nicht. Ein unveränderter, neu aktualisierter Messwert kann frisch sein.

| Prüfer und zugeordnete Netzquellen | Vertrag bis alpha.51 | Vertrag ab alpha.52 |
|---|---|---|
| Wallboxausgang: Gesamtnetzbezug und -einspeisung | 30 s | 30 s |
| Wallboxausgang: L1–L3-Bezugs-/Einspeiseleistung und Phasenstromfallback | 15 s | 30 s |
| Direkter Trinkwasser-/Heizpuffer-EHZ-Netzregler: Gesamtnetzbezug/-einspeisung | 10 s | 30 s |
| Trinkwasser-/Heizpuffer-EHZ-Hausanschlussprüfung: L1–L3-Leistung und Phasenstromfallback | 120 s | 30 s |
| Speicher-Hausanschlussprüfung: L1–L3-Leistung und Phasenstromfallback | Konfigurierbare Geräte-Messfrist | 30 s |
| Passive Wärmepumpenempfehlung: Gesamtnetzbezug/-einspeisung | 10 s | 30 s |
| Observer: Gesamtnetzbezug/-einspeisung | 120 s | 30 s |
| Schattenantwort: aktuelle Original-Gesamtnetzwerte | 10 s | 30 s |
| Passende Produktiv-, Schutz- und Schattendiagnosen dieser Quellen | Bisher vom Prüfpfad abhängig | Derselbe 30-s-Vertrag |

Das betrifft die zugeordneten SMA-Netzquellen auch dann, wenn deren IDs über die kompatible Mapping-Konfiguration eingebunden sind. Auch die optionale Speicher-/Heizpufferregelung und passive Wärmepumpenempfehlung verwenden für diese Netzquellen den gemeinsamen Vertrag. PV-Leistung, BHKW, SoC, Temperaturen und Gerätemessungen werden nicht pauschal auf 30 s gesetzt. go-e-Rückmeldungen, Befehls-ACK, Fahrzeugreaktion, Phasenwechsel, Start-/Stoppverzögerung, Mindestlaufzeit und Regeltakt behalten ihre separaten Grenzen. Historische Paarung im Schattenmodell bleibt zusätzlich durch ihre vorhandenen Zeit- und Änderungsgrenzen beschränkt.

Gültige Werte bis einschließlich 30 s dürfen im jeweiligen Netzprüfpfad verwendet werden. Mehr als 30 s alte, fehlende, NULL-, nichtnumerische, unbestätigte, qualitätsungültige oder für den jeweiligen Messwert unplausible Angaben bleiben ungültig. Zukunftszeiten außerhalb der bestehenden Uhrtoleranz werden weiterhin verworfen; diese Toleranzen werden nicht erweitert. Die neue Altersgrenze ersetzt keine Prüfung von Sicherungs-, Geräte- oder gemeinsamen Leistungsgrenzen. Ein noch zulässiger älterer Wert kann von der tatsächlichen Momentanleistung abweichen; er ist keine neue Messung.

## Belegter Anlass am 08.10.2026

Alle Zeiten in Europe/Berlin. Unter installierter alpha.51 wurde der EQV wegen etwa 16 s alter Hausanschluss-L3-Bezugs- und Einspeisewerte gestoppt. Diese überschritten die bisherige 15-s-Grenze, obwohl der Wallbox-Gesamtnetzwert bereits einen 30-s-Vertrag hatte.

| Zeit | Belegter Vorgang |
|---|---|
| 10:21:04.036 | EMS versucht `allow_charging=0` für den EQV |
| 10:21:04.671 | Gerät bestätigt AUS |
| 10:21:22.023 | EMS versucht erneut EIN |
| 10:21:22.269 | Gerät bestätigt EIN; Freigabe war etwa 17,6 s entzogen |
| 10:21:45.444 | Gemessene Ladeleistung etwa 1,24 kW |

Damit sind der Quellenfehler und der reale Freigabewechsel belegt. Die Meldung beweist weder einen SMA-Sendestopp noch eine tatsächliche Überlast. Warum die L3-Werte im EMS nicht frischer vorlagen, bleibt ungeklärt. Alpha.52 vereinheitlicht den Altersvertrag; sie behauptet keine Behebung der Updateursache.

## Diagnose bei einer erneuten Quellenlücke

Die vorhandene [SMA-Quellendiagnose](sma-source-diagnostics.md) wird im Wallboxausgang auf die Hausanschluss-Phasenquellen erweitert. Eine betroffene Quelle wird einmal je zusammenhängendem Fehlerereignis zusätzlich asynchron aus ioBroker gelesen. Der direkte Leseversuch wartet höchstens 5 s außerhalb der Steuerungssequenz. Er verändert weder operative Cache-Werte noch Quellenzeiten und verzögert keine Schutzabschaltung.

`Devices.WallboxN.LastStopSourceDiagnostics_JSON` enthält ursprünglichen Cache-Wert, `ts`, `lc`, ACK, Qualität, Prüfzeit und EMS-Empfang sowie direkte Antwort, Lesedauer und Cache-Stand bei Abschluss. Ein fehlender oder verspäteter Leseabschluss bleibt unbekannt und darf keinen späteren Abschaltgrund überschreiben. Die direkte Anfrage liest den ioBroker-Zustand, nicht das SMA-Gerät. Eine jüngere Antwort kann eine Zustellungs- oder Verarbeitungsverzögerung eingrenzen; sie allein erklärt den früheren Fehler nicht.

Produktive DecisionRecords und Quellen-/Befehlsereignisse bleiben die Grundlage für den historischen Vergleich. Die Änderung legt keine rückwirkende Historie an und ändert keine SQL-Einstellungen.

## Regressions- und Betriebsnachweise

Regressionen prüfen die einheitliche Altersgrenze einschließlich der 30-s-Grenzkante, die vorher problematische 16-s-Hausphase und Gegenfälle mit zu alten bzw. ungültigen Quellen. Quellenfehlerdiagnosen müssen auch bei Phasenwerten die betroffene ID und unveränderte Rohzeitstempel enthalten. Direkte Leseantworten dürfen keine operative Frische erzeugen und die Abschaltung nicht verzögern.

Nach manueller Installation zuerst installierte Laufzeitversion und tatsächlichen Masterstatus neu lesen. Beim nächsten natürlich auftretenden Netzquellenfehler Quellenzeit, EMS-Empfang, direkten Leseabschluss, Freigabe-ACK und elektrische Fahrzeugantwort zusammenführen. Eine 15–30 s alte ansonsten gültige Hausphase darf allein keinen Quellenalter-Stopp mehr verursachen; über 30 s oder bei anderer Ungültigkeit muss die normale Sperre erhalten bleiben. Keine Quellen künstlich blockieren oder Schutzwerte umgehen. Eine unauffällige Phase ohne entsprechendes Ereignis ist kein bewiesener Grenzfalltest.

Die Änderung installiert nichts in ioBroker und verändert weder produktive Konfiguration, SQL, Bestandsskripte, Master Control noch Freigaben oder Aktoren. Softwaretests und Veröffentlichung ersetzen keine reale Betriebsabnahme oder Ursachenklärung und begründen für sich keine Scorepunkte.
