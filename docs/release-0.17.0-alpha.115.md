# 0.17.0-alpha.115 — 1P vor der Fahrzeugübergabe vorbereiten

## Ausgangsbefund

Am 20.10.2026 um etwa 16:09–16:12 Europe/Berlin lief alpha.114. EQE: 58,3 % bei Ziel 60 %, etwa 2.608 W gemeinsames PV-Ladebudget. EQV: 58 % bei Ziel 90 %, freigegeben, go-e AUS/0 W, bestätigter 3P-Modus. Die aktuelle 0-W-Zuteilung des wartenden EQV hielt seine Phase bei 3P. Gleichzeitig war auch der Mii mit 75 % bei Ziel 90 % freigegeben; die beobachtete Reihenfolge war EQE → Mii → EQV. Daraus folgt keine Garantie, dass der EQV als Nächster lädt.

Die bestehende alpha.114-Logik kann einen gestoppten 3P-Empfänger nach Zielabschluss oder Prioritätswechsel bereits auf 1P vorbereiten. Neu ist die Vorbereitung des tatsächlich nächsten wartenden Empfängers während der andere noch lädt. Die vorherige reine Momentaufnahme belegte deshalb keinen vollständigen Übergabefehler.

## Umsetzung

- Nur im gültigen Produktiv-Parallelbetrieb: erster priorisierter Kandidat lädt unter eigener Kontrolle, ist keine Pflichtladung und hat keine laufende Phasenarbeit. Der nächste wartende Kandidat wird nach unveränderten Auswahlregeln bestimmt. Höher priorisierte wartende Fahrzeuge werden nicht übersprungen; keine feste Sonderbehandlung für EQV.
- Nur bei EMS-Phasenführung, unabhängig bestätigtem bisherigen 3P-Modus, unbesetztem Ausgang und frischem bestätigtem AUS, maximal 20 W bzw. gültigem Nullrauschen und maximal 0,5 A auf jeder Phase. Keine Vorbereitung bei unbekannten Modi, fremder Phasenführung, Fehlern oder offenen Stopp-/Besitzverhältnissen.
- Hypothetisches Ersatzbudget über dieselbe begrenzte Rechnung wie bei der bestehenden Übergabe: andere reale Wallboxreservierungen, Pflichtladungsböden und EHZ-/Haus-/Netzbetreibergrenzen berücksichtigen. Nur wenn es für 1P samt konfigurierter Startreserve reicht, für 3P samt Reserve aber nicht, 1P anfordern. Beispiel bei 230 V und 6 A: ab 1.680 W bis unter 4.440 W mit 300 W Reserve.
- Dieses Budget beeinflusst ausschließlich die Topologieberatung. Tatsächliche Ampere-/Wattzuteilung, Geberreserve und EHZ-Zuteilung bleiben unverändert. Kein EIN, kein vorzeitiger Start und kein dadurch erzeugter Startverzögerungs-Bypass. Eine passende reale Übergabe muss später unabhängig qualifiziert werden.
- Bei Zielabschluss während einer exakt bekannten kalten 1P-Vorbereitung darf die bestehende begrenzte Übergabe warten. Alten Phasenmodus, frischen ACK und Befehls-Echo weiter unterscheiden; ursprünglichen Phasenanforderungszeitpunkt statt eines neuen Timers verwenden. Unbekannte/veraltete/falsche Phasenbelege oder Timeout erhalten die Sperre.
- Ein weiterer Codebefund: Auch unbesetzte ausgeschaltete Wallboxen erhielten nach 3P→1P-ACK bisher die 90-s-Nachlaufmarkierung für Lastwechsel. Die kalte Vorbereitung beendet diese erst bei unabhängig bestätigten AUS-/Nullproben nach dem zugehörigen Phasen-ACK. Alte Nullproben oder Reststrom genügen nicht. Für besetzte/laufende Ausgänge bleibt die Lastwechsel-Schutzzeit unverändert.

Diagnose: `Control.WallboxN.PhaseDecision_JSON` nennt beim neuen Plan `reason=idle-replacement-one-phase`, `preparationOnly=true`, `prospectiveDonor`, `allocatedBudgetW` und `replacementBudgetW`. Hypothetisches Budget ausdrücklich vom echten aktuellen Budget unterscheiden. Keine neuen Adminfelder und keine Änderung von 600-s-Stoppverzögerung, normaler Einschaltverzögerung, Polling, SQL oder externem Phasenfolger.

## Prüfung und offene Betriebsnachweise

Gezielte Regressionen reproduzieren EQE→EQV mit 2.608 W und prüfen fehlende Freigabe/Leistung/Quelle, fremde Phasenführung, Reststrom, EHZ-/Peer-/Hausgrenzen, Geberphasenarbeit und einen höher priorisierten wartenden Mii. Integrierte Replays verwenden Produktionsloader und Ausgangscontroller mit unabhängig verzögerten ACKs und elektrischer Antwort: 1P wird vor Geberziel angefordert, Geber lädt weiter, Empfänger bleibt AUS. Phasenbestätigung vor, während und gleichzeitig mit Zielabschluss muss nach echter Geberruhe einen begrenzten Start ohne erneute volle 300 s erlauben. Kein gleichzeitiger physischer Bezug beider Fahrzeuge aus derselben Übergabe; Startstrom-ACK bleibt erforderlich. Ein weiterer Ausgangstest trennt alte Nullproben und Reststrom vom gültigen Nachweis nach Phasen-ACK.

Fünf positive neue Fälle schlagen auf unverändertem alpha.114 fehl. Lokal unter Node 24.19.0 bestehen alle 2.390 Tests ohne Fehler oder übersprungene Fälle, Paket-/Tarballinstallation (192 Dateien, 719 initiale Zustände) und beide historischen Vergleichsläufe. Die vorhandenen historischen Baselines bleiben unverändert. GitHub-CI prüft den endgültigen Commit vor Merge zusätzlich unter Node 22 und 24.

Die synthetische Testanlage bildet den Phasenfolger-ACK kontrolliert nach; sie ist kein realer Schaltversuch. Installation durch den Betreiber. Natürlicher Phasen-ACK, unveränderte Geberladung, Zielabschluss, AUS/Stromruhe und Empfängerstart sind anschließend im Betrieb nachzuweisen. Keine garantierte pausenlose Übergabe, kein bezifferter Energiegewinn und keine zugesagten Scorepunkte.
