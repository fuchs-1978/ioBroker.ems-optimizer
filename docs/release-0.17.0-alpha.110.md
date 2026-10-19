# 0.17.0-alpha.110 – Antwortnachweis bei einphasiger PV-Ladung

## Anlass und belegter Umfang

Der autorengeprüfte [Tagesbericht #211](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/211) beschreibt unter alpha.109 wiederholte 6-/7-A-Befehle mit passenden ACKs und elektrischer Antwort. Ein Beispiel wechselt bei 1603 W PV von 6 auf 7 A und anschließend trotz 1450 W gemessener Aufnahme und 40,8 W Einspeisung zurück auf 6 A. Gleichzeitig stehen im Ausgang `ResponseState=confirmed`, `awaitingElectricalStep=true` und die nominelle Grenze von 6 A.

Code-Ausgangspunkt ist main `72dee1bbbd9326fcc06d1d40cdcc1283f84a605b`, einschließlich der bereits übernommenen PRs #205–210. Die gemeldete laufende Versionsnummer alpha.109 beweist keinen exakten installierten Commit.

Endliche, konstruierte integrierte Replays verwenden die berichteten Befehlszeiten und Werte. Der Produktionsloader, die Zuteilung und der Ausgangscontroller durchlaufen einen echten synthetischen Start mit verzögertem ACK und elektrischer Antwort. Nicht berichtete einzelne Quellenzeitpunkte, lokale Rohkonfiguration und der vorausgehende Start werden kontrolliert vorgegeben. Das ist keine vollständige Rekonstruktion der ursprünglichen Rohdaten durch SQL und kein Nachweis, dass alle 41 berichteten Befehle dieselbe Ursache haben.

## Korrekturen an der Wallboxantwort

Der Haltenachweis für einen gemessenen PV-Schritt verwendete bei einphasiger Ladung die konfigurierte Hausphase als Index in den lokalen go-e-Stromkanälen. Eine auf Haus-L2 oder Haus-L3 angeschlossene einphasige Wallbox meldet ihren aktiven Strom weiterhin auf ihrem lokalen L1-Kanal. Der bisherige Index las dadurch den ruhenden lokalen L2-/L3-Kanal. Die elektrische Antwort konnte bereits bestätigt sein, während der gesonderte PV-Schrittnachweis offen blieb und die nominelle Grenze wieder eine Rücknahme auf 6 A auslöste.

Der Antwortnachweis verwendet nun die lokalen Gerätekanäle. Die Zuordnung zu den Hausphasen bleibt für die gemeinsame Hausanschlussbilanz bestehen. Der Replay prüft dieselbe 6,6-A-/1450-W-Antwort bei Zuordnung zu Haus-L1, Haus-L2 und Haus-L3.

Eine zweite Regression behandelt die Reihenfolge, wenn Zuteilung und anschließende elektrische Bestätigung denselben Millisekundenzeitstempel besitzen. Dieser Gleichstand darf den Übergang nicht allein verwerfen. Das Halten bleibt an den vorherigen ausstehenden Antwortzustand, die passende Befehls-/ACK-Kette und die Identität der verwendeten Quellenproben gebunden. Ein gleicher Zeitstempel allein genügt nicht. Daraus entsteht keine Freigabe für einen weiteren Stromschritt; reale Defizite, offene Zusagen und die bestehenden Geräte-, Phasen-, Peer-, Hausanschluss-/LPC- und EHZ-Grenzen bleiben maßgeblich.

Eine dritte integrierte Reproduktion behandelt einen unveränderten frischen 7-A-ACK-Poll, dessen Zeitstempel nach den weiterhin frischen 1450-W-/6,6-A-Proben liegt. Der Haltenachweis verglich die elektrische Aufnahme bisher mit diesem neuesten Pollzeitpunkt statt mit dem ursprünglichen ACK des zugehörigen Befehls. Dadurch konnte dieselbe bereits belegte Aufnahme wieder als unzureichend gelten. Die Regressionen prüfen sowohl einen solchen Poll beim ersten bestätigenden Tick als auch einen späteren erneuten Poll.

Nur für dieselbe bereits bestätigte Stromvorgabe darf der gespeicherte `ResponseAcknowledgedAt` maßgeblich bleiben: Der ursprüngliche ACK muss rechtzeitig zum unveränderten gesendeten Befehl gehören, der gespeicherte Sendezeitpunkt muss weiterhin zum aktuellen Befehl passen und der aktuelle ACK muss frisch, gültig und wertgleich sein. Neue oder noch unbestätigte Befehle bleiben an die strenge ACK-/Messwertreihenfolge gebunden. Ein unveränderter ACK-Poll verdient keinen weiteren Ampere-Schritt ohne neuen elektrischen Fortschritt. Antwortfristen werden nicht erneuert und die Bezugstoleranz wird nicht erhöht.

## Getrennter Journalschlussfehler

Nach abgeschlossenem `journal.close()` konnten abgelehnte späte Appends erneut Health-Dateiarbeit auslösen. Die Korrektur verhindert das Planen dieser Arbeit bei geschlossenem Journal. Bereits angenommene Arbeit wird weiterhin abgearbeitet und ihr finaler Healthcheckpoint geschrieben; spätere Verlustzähler bleiben im Speicher sichtbar.

Dieser lokal reproduzierte Shutdownfehler erklärt nicht nachweislich die 173 im Tagesbericht beschriebenen Recorderablehnungen. Queuekapazitäten, fsync, Retention, SQL-Abfragebudgets und das bereits vorhandene begrenzte Delivery-Drain werden dadurch nicht erweitert. Die weiterhin offene Recovery-Inspection beim Shutdown ist ein anderer Pfad und wird durch diese Korrektur nicht behoben. Befunde und getrennte Prüfpunkte stehen in [Recorderdiagnose zu #211](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/v0.17.0-alpha.110/docs/issue211-recorder-diagnosis.md).

## Prüfung und reale Folgeabnahme

Die gezielten Regressionen prüfen die konstruierte Befehls-/ACK-/Leistungsfolge über den Produktionsloader und die realen Controller, alle drei Hausphasenzuordnungen, die Reihenfolge innerhalb derselben Millisekunde, unveränderte ACK-Polls beim ersten Bestätigen und danach sowie den abgeschlossenen Journalschluss und die Verlustpersistenz bereits angenommener Arbeit. Unter Node 22 und 24 bestehen jeweils alle 2.309 Tests ohne Fehler oder übersprungene Fälle sowie Paket-/Installationsprüfung und unveränderte gepinnte Differentialvergleiche. Die [reproduzierbaren Softwarebelege](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/v0.17.0-alpha.110/docs/issue211-software-validation.md) dokumentieren Umfang und Gegenproben; die CI-Ergebnisse des endgültigen Commits stehen im zugehörigen Pull Request.

Eine Veröffentlichung installiert oder aktiviert nichts. Reale Stromruhe, Zuständigkeit während der Recorderlücken, Verlustfreiheit und unbeobachtete Schutz-/Übergabefälle bleiben in einer späteren natürlichen Betriebsbeobachtung zu prüfen. Der berichtete **Score bleibt 71/100, Änderung 0**. Die bedingte Abschätzung von 0–0,3 Wh für einen eng qualifizierten Ausschnitt ist weder garantierte Einsparung noch Tagesobergrenze und wird hier nicht hochgerechnet. Die [reale Folgeabnahme](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/v0.17.0-alpha.110/docs/issue211-real-acceptance-followup.md) beschreibt die nächsten begrenzten Nachweise.
