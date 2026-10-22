# 0.17.0-alpha.124 — Telemetrieueberbrueckung bei inaktiver Gruppenbegrenzung

Alpha.123 schliesst den groupNet-Modus pauschal aus der begrenzten Wallbox-Telemetrieueberbrueckung aus. Der Gruppenmodus bleibt jedoch auch bei inaktivem Netzbetreiberkontakt als groupNet gekennzeichnet. Dadurch wurde die in alpha.123 vorhandene Ausnahme selbst ohne aktive Gruppenbegrenzung nicht wirksam. Ausgangspunkt: Tagesbericht [#231](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/231) und anschliessender ausdruecklicher Aenderungsauftrag; keine aus dem unvollstaendigen Tagesabruf behauptete neue elektrische Unterbrechung.

## Enger Umfang

Die bestehende Ueberbrueckung wird nur bei einem gueltigen und ausdruecklich inaktiven groupNet-Ergebnis zugelassen (`active === false`). Es wird kein Eigenstromaufschlag aus alten Wallboxdaten berechnet oder neu vergeben. Sobald der Kontakt aktiv, seine Qualitaet ungueltig oder der Gruppenvertrag unklar ist, gibt es keine Ausnahme. Ein konfigurierter ungepruefter LPC-Vertrag bleibt gesperrt.

Unveraendert bleiben:
- Nur eine in derselben Sitzung physisch bestaetigte, vom EMS gefuehrte Ladung bei unveraendertem Strom und unveraenderter Phase.
- Keine neuen EIN-, Strom- oder Phasenbefehle aus der Bruecke; keine Starts, offenen Bestaetigungen oder Phasenwechsel.
- Maximal 60 Sekunden Gesamtalter der Wallboxproben, normale Grenze weiterhin 30 Sekunden; Quellzeitstempel/ACK/Qualitaet werden nicht gefaelscht.
- Frische SMA-Netz-/Phasenmessungen, Hausanschluss-/Geraetegrenzen, Benutzer-/SoC-/Masterfreigaben sowie konservative volle Eigen-, Peer- und Heizstabreservierungen.
- Aktive Gruppenbegrenzung bleibt waehrend einer Geraete-Telemetrieluecke ausgeschlossen. Die vorhandene regulaere Gruppenbilanzierung mit frischen Daten wird nicht geaendert.
- Taper- und modellierte Rueckmeldungen bleiben ausgeschlossen. Das Phasenfolgeskript ist unveraendert.

## Regression und reale Folgepruefung

Die Ausgangstests verwenden den echten Gruppen-Auswerter: inaktiver Kontakt und unveraenderter alter statischer Kontakt, 31-/59-/61-Sekunden-Verlauf, Rueckkehr frischer Daten, Kontaktaktivierung trotz ausreichend belegtem Gruppenbudget, fehlende/unbestaetigte/schlechte/zukuenftige Kontaktwerte, LPC-Konfiguration und ungueltige Gruppen-/Messgrenzen. Die vorhandenen SMA-, Geraete-, Freigabe- und Leistungsgrenzentests laufen auch im inaktiven Gruppenmodus.

Integration mit echtem Zuteiler und Ausgangsautomaten prueft sequentiellen/parallelen Betrieb jeweils mit/ohne Heizstab und mit/ohne groupNet. Pruefresultate und Grenzen stehen in [PR #232](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/232). Die unveraenderte alpha.123-Implementierung muss an den neuen positiven Gruppen-Regressionsfaellen scheitern.

Nach einer gesonderten manuellen Installation sind natuerliche Ereignisse zu beobachten: gueltiger inaktiver Kontakt, vorher bestaetigte reale Ladung, kurze alte Wallboxproben bei frischem SMA, Status TELEMETRIE-UEBERBRUECKUNG ohne neue Ladebefehle, erhaltene Reserve und anschliessend frische elektrische Rueckmeldungen. Bei Kontaktaktivierung, Qualitaetsverlust oder Ablauf muss die Ausnahme enden. Keine kuenstlichen Schaltversuche oder automatische Anlageninstallation. Softwaretests/Release sind keine bestandene reale Abnahme und bringen keine automatischen Scorepunkte.
