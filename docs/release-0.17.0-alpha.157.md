# 0.17.0-alpha.157 — Laufende Ladung bei Telemetrielücken halten

Am 27.10.2026 um 09:51:48 Europe/Berlin wurde am EQE eine Abschaltung wegen
über 30 Sekunden altem go-e-Fehlerstatus protokolliert. Auch Leistung und
Phasenströme waren zu diesem Zeitpunkt veraltet. Der Log allein beweist weder
sicheren SMA-Netzanschluss noch den exakten internen Auslöser der fehlenden
Überbrückung. Die folgenden Lücken wurden unabhängig davon im Code reproduziert.

## Korrektur

- Ein bestätigter Stromschritt wird im selben Ausgangstakt als Haltenachweis
  erfasst. Es ist kein weiterer Tick vor dem Kommunikationsausfall erforderlich.
  Das bestätigt keine noch ausstehende elektrische Leistungsaufnahme und
  verschiebt keine Antwortfrist.
- Gleichzeitig veraltete Peer-Leistungen führen bei belegten unveränderten
  Ladesitzungen nicht zum gegenseitigen Abschalten. Die bestehenden Befehls-
  und Leistungsreserven bleiben vollständig gebunden. Unbekannte, fehlerhafte
  oder gerade wechselnde Peer-Zustände erhalten keine Ausnahme.
- Eine explizit wegen veralteter eigener Leistung ungültige Parallelzuteilung
  darf ihre bloße 1P-Leerlaufvorgabe nicht als Abbruch einer bestätigten
  3P-Ladung durchsetzen. Eine angeforderte/aktive physische Phasenumschaltung
  bleibt ausgeschlossen. Die bestehende Topologie bleibt unverändert.

Während der Überbrückung werden weder neue Ströme noch Phasen oder EIN-Befehle
geschrieben. Historische Wallboxwerte werden nicht frisch gestempelt. Reserven
werden nicht freigegeben. Frische SMA-Gesamt- und Phasenwerte, konservative
Reserven, gültige Netzbetreibergrenzen und sämtliche Benutzer-/SoC-Freigaben
bleiben erforderlich. Überlast, ungültiges SMA, echter Gerätefehler, AUS und
entzogene Freigaben führen weiterhin zum Stopp. Aktive groupNet-Begrenzungen
ohne ausreichende frische Messnachweise werden nicht überbrückt.

## Validierung

Neue Regressionen reproduzieren die vorherige Abschaltung bei unmittelbar
bestätigten Stromschritten für 1P und 3P, gleichzeitig alten Mii-/EQE-Werten und
3P-Ladung mit rein planerischem Leerlaufrückfall. Gegenproben prüfen weiter
Abschaltung bei SMA-Ausfall, Hausanschlussschutz, globalem AUS und Gerätefehler.
Bestehende Schutz-, Start-, Phasen-, EHZ- und Regeltests bleiben erhalten.
Softwaretests sind keine Live-Abnahme; der konkrete Vormittagsfall ist nicht als
vollständig aufgeklärte Herkunfts- oder Sicherheitsanalyse zu verstehen.
