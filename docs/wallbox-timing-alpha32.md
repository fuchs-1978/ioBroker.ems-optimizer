# Wallbox-Zeitverhalten ab 0.17.0-alpha.32

## Anlass und Ziel

Die Tagesauswertung vom 04.10.2026 ([#80](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/80)) zeigte nachvollziehbare virtuelle Budgetstopps und zusätzlich nicht bewertbare elektrische Schattenantworten bei versetzten Messzeitpunkten. Ein Budgetstopp, ein tatsächlicher Freigabewechsel, eine reale Leistungsdelle und eine ungültige Modellrechnung sind getrennte Befunde. Diese Version ändert keine historische Bewertung und behauptet keine bestandene Liveabnahme.

Die untersuchten go-e-Instanzen liefern über ihren Adapter/API-V2-Pfad Statuswerte im Abstand von 15 Sekunden. Eine Schreibbestätigung bestätigt die Wallboxvorgabe; die elektrische Reaktion des Autos kann erst später sichtbar werden. Die EMS-Ausgangslogik arbeitet mit ioBroker-Datenpunkten und setzt weder einen bestimmten Modbus-Zyklus noch eine sofortige Fahrzeugreaktion voraus.

## Befehlsbestätigung und Fahrzeugreaktion

Die bestehende gerätespezifische `wbNFeedbackTimeoutS` begrenzt die Befehlsbestätigung (Standard 20 s). Erst nach der Bestätigung beginnt die zusätzliche elektrische Reaktionsfrist. Leistungswert und alle verwendeten Phasenstromwerte müssen gültig, frisch und nach dem Schreiben sowie mindestens zum Zeitpunkt der Bestätigung veröffentlicht sein. Frühe Werte aus einem vorherigen Poll genügen nicht. Je nach Veröffentlichungsreihenfolge kann erst der folgende Poll alle nötigen Messwerte liefern.

| Einstellung im Reiter Wallboxen allgemein | Standard | Bedeutung |
| --- | ---: | --- |
| `wallboxResponseSettleTimeoutS` | 45 s | Zusätzliche Reaktionsfrist ab Befehlsbestätigung, einstellbar 5–120 s |
| `wallboxResponseCurrentToleranceA` | 1,5 A | Zulässige Abweichung nach oben für die elektrische Rückmeldung, einstellbar 0,5–3 A; keine Änderung des Wallbox-Überstromschutzes |

Während dieser Wartephase wird eine normale PV-Aufregelung oder Richtungsumkehr nicht mit vorangegangenen Messwerten fortgesetzt. Die bisherige Anti-Windup-Grenze für geringe Abnahme bleibt erhalten. Nach der Frist wird geringe Abnahme als `limited` ausgewiesen und verhindert weitere Erhöhungen, bis eine entsprechende elektrische Abnahme vorliegt. Fehlende neue Messungen beziehungsweise anhaltende Überschreitung der bestätigten Vorgabe führen im produktiven Ausgang zu `timeout` und sicherem Stopp mit Fehlerdiagnose.

Benutzer-/Masterfreigaben, SoC-/Verbindungs-/Gerätefehler, Hausanschluss- und §14a-Grenzen sowie ungültige Schutzquellen wirken weiter unmittelbar. Eine neue harte Stromobergrenze kann einen noch ausstehenden höheren Befehl ersetzen. Die vorhandene Mindestlaufzeit und Stoppverzögerung laufen weiter; die neue Wartephase verlängert sie nicht. go-e-Fehler 5 (`Overamp`) wird niemals durch die Reaktionsfrist unterdrückt oder vom EMS automatisch zurückgesetzt.

Die Ausgabezustände unter `Devices.WallboxN` unterscheiden `command_ack`, `vehicle_response`, `confirmed`, `limited`, `timeout`, `modeled` und `unavailable`. `ResponsePending`, `ResponseRemaining_s`, `ResponseStatus` und `ResponseConfirmedAt` ergänzen diese Zustände. Der letzte Befehl, der vorherige Befehl, Sende-/Bestätigungszeit und gemessener Strom/Leistung stehen als `ResponseCommand_A`, `ResponsePreviousCommand_A`, `ResponseSentAt`, `ResponseAcknowledgedAt`, `ResponseMeasuredCurrent_A` und `ResponseMeasuredPower_W` zur Verfügung.

## Gemeinsame Schatten-Messbasis

Große Lastkorrekturen dürfen eine neue Netzleistung nicht mit einer zeitlich abweichenden Wallboxleistung kombinieren. Der Schattenpuffer sucht daher eine gemeinsame, tatsächlich aufgezeichnete historische Messbasis. Ab alpha.32 kann diese höchstens 20 s alt sein und bleibt zusätzlich durch `wallboxMeasurementMaxAgeS` begrenzt. Beide Netzreihen müssen zur Basis passen. Die aktuellen Original-Netzquellen müssen vor dem Versuch weiterhin ACK, Qualität, Wertebereich und maximal 10 s Alter erfüllen.

Eine Zwischenzeit wird ausschließlich zwischen vorhandenen Wallboxwerten interpoliert: maximal 20 s Abstand und maximal 100 W Änderung pro Wallbox. Ein Qualitätsfehler im benötigten Messpaar sperrt die Zuordnung. Die aktuellen und zugeordneten Wallboxwerte dürfen ebenfalls höchstens 100 W abweichen; die aktuelle Netzleistung darf höchstens 500 W von der Basis abweichen. Kein Wert wird unbegrenzt fortgeschrieben. Größere Last-/Netzsprünge, fehlende Messpaare oder schlechte aktuelle Quellen bleiben nicht bewertbar.

Die Kriterien verringern vermeidbare Polling-Lücken bei nahezu konstanter Last. Die Grenze von 20 s entspricht dem beobachteten 15-s-Poll plus einem 5-s-Regelzyklus, ist keine Behauptung unveränderter Leistung zwischen Messungen und keine Freigabe für langsamere Messung ohne weitere Prüfung.

| Diagnose | Aussage |
| --- | --- |
| `Response.TimingState=current-input` | Aktuelle Messbasis genügt den Korrekturprüfungen |
| `aligned-historical-frame` | Begrenzte gemeinsame historische Basis verwendet; Alter und Zeitpunkt sind ausgewiesen |
| `waiting-for-common-measurements` | Frische Einzelwerte, aber noch kein ausreichend belegtes gemeinsames Messpaar; `Valid=false` |
| `invalid-source` | Eine benötigte Quelle fehlt oder verletzt Qualität/ACK/Alter/Wertebereich; `Valid=false` |

Im DecisionRecord beschreibt `response.alignment` die zulässige Altersgrenze und gegebenenfalls verworfene Zuordnungsgründe. `observedPowerSpreadW` enthält die Summe der tatsächlich verwendeten Wallbox-Streuungen. `powerUncertaintyBoundW` ist die Summe der zulässigen 100-W-Grenzen. Das ältere Feld `maximumObservedPowerSpreadW` bleibt zur Kompatibilität erhalten und bezeichnet ebenfalls diese Toleranzobergrenze, keine gemessene Streuung. `inputTimestamp`/`inputAgeMs` bleiben historische Angaben; aktuelle Originalwerte bleiben separat sichtbar.

## Modellannahme und Abnahmebelege

Im isolierten Schattenmodell sind Bestätigung und elektrische Antwort ausdrücklich Annahmen (`responseAssumed=true`, Zustand `modeled`). Eine gültige Antwort wird nur über den expliziten Modellnachweis angeboten. Bei ungültiger Schattenantwort gilt `unavailable`; die reale Stromaufnahme des unabhängig laufenden Bestandsskripts bestätigt keinen virtuellen Befehl und erzeugt keinen erfundenen virtuellen Fahrzeug-Überstromfehler. Die beiden `ResponseMeasured`-Werte bleiben im Schatten `null`, weil kein reales Strom-/Leistungs-Messpaar für einen virtuellen Befehl vorliegt. Reale Originalwerte stehen separat in `realFeedback`/`actuals`, Modellstrom und -leistung in `modeled`/`response`. Vor einer produktiven Rückmeldung bleiben fehlende Messwerte ebenfalls `null`, statt eine 0-W-Abschaltung zu suggerieren. Echte Geräte- und Schutzfehler bleiben bindend. Zeit und Leistungsbasis stehen im zusammengehörigen DecisionRecord; skalare States können unterschiedliche Veröffentlichungszeitpunkte haben.

Die folgenden Befunde sind Grundlage für Fortschritt Richtung begleiteter Abnahme:

1. Vollständige DecisionRecords mit nachvollziehbaren Sitzungen/Sequenzen und ausgewiesenen unbekannten Zeiträumen; keine Schreib- oder Datenverluste als fehlerfreien Betrieb ausgeben.
2. Wallbox-Ladeblöcke bei stabiler und wechselnder PV: alle virtuellen Stopps begründet; Startverzögerung, Mindestlaufzeit, Stoppverzögerung und harte Schutzreaktion anhand zusammengehöriger Ereignisse prüfen.
3. Sichere Übergabe mit genau einem realen Regler, korrekte Phasenanforderung und reale Bestätigung sowie nachvollziehbare Budget-/Netzbilanz konkret bestehen.
4. Danach eng begleitet in kleinen Schritten reale ACK-/Fahrzeugzeiten, Grenzreaktionen und Rückgabe an den Bestand prüfen. Das Update schaltet Master, Skripte oder Aktoren nicht ein.

Ein Softwaretest oder höherer Anteil gültiger Schattenframes allein erhöht nicht den täglichen Abnahme-Score. Nicht beobachtete oder nur angenommene Fahrzeugreaktionen und nicht getestete Übergaben erhalten keine Erfolgspunkte. Ab etwa 80/100 kommt ein begleiteter Test nur bei zuvor konkret bestandenen harten Sicherheits- und Übergabekriterien infrage.

## Admin-Schema

Die Object-ID-Auswahl für Heizpuffer und Speicher verwendet jetzt das dokumentierte `filterFunc` für schreibbare numerische Zustände. `customFilter.common.write` war im Admin-Schema unzulässig. Die Metadatenprüfung vor einer produktiven Ausgabe bleibt unabhängig davon verbindlich. Regressionstests verwenden einen festgehaltenen Ausschnitt des offiziellen Admin-Schemas und prüfen gültige sowie ungültige Auswahlobjekte.
