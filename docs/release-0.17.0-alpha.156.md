# 0.17.0-alpha.156 — EHZ während der Einschaltverzögerung weiter nutzen

## Beobachteter Fall und Ursache

Fallkennung: `2026-10-26-ehz-cutoff-during-mii-start-delay`.

Am 26.10.2026 begann um 15:41:37 Uhr Europe/Berlin der 300-s-Startcountdown
des Mii. Um 15:41:40 Uhr wurde der EHZ von 1.400 auf 0 W gesetzt, obwohl
der Mii noch nicht starten durfte. Die Parallelverteilung zog den geschützten
Startanspruch sofort auch vom Heizbudget ab. Danach wurde rund 1,6 kW eingespeist.

Beleg: begrenzt gelesene produktive DecisionRecords, Sitzung 1793018496968,
rekonstruierte Fenster 14:41:18–14:41:45 und 14:42:19–14:42:59 UTC sowie
skalare go-e-Leistungswerte. Um 15:42:44 wurde manuell 6 A Mindestladung
angefordert; ab 15:42:49 galt `mandatory-charge`. Um 15:43:03 nahm der Mii
1,32 kW auf. Die spätere Meldung „Kein Fahrzeug angeschlossen“ um 15:43:53
ist ein anderes Ereignis. Der vollständige 300-s-Ablauf wurde in diesem
realen Fall durch die manuelle Mindestladung unterbrochen.

## Änderung

- Im produktiven Wallbox-Parallelbetrieb darf der optionale Warmwasser-EHZ
  den vorgemerkten Anteil des bevorzugten, noch inaktiven Fahrzeugs während
  des normalen Startcountdowns verwenden. Andere Fahrzeuge erhalten diesen
  geschützten Anteil weiterhin nicht.
- Die Startqualifikation kann die nach einer EHZ-Reduzierung verfügbare
  Kapazität berücksichtigen. Reale Reservierungen anderer Fahrzeuge und
  Heizkreise sowie die gemeinsame harte Grenze bleiben dabei abgezogen.
  Diese rechnerische Kapazität wird ausschließlich für die Qualifikation
  verwendet, niemals als freigegebene elektrische Leistung.
- Nach Ablauf des Countdowns wird das Heizbudget reduziert. Stromzuteilung
  und Ausgang behalten die tatsächlichen EHZ-Reservierungen und Messwerte
  bei. `await-heater-reduction` bezeichnet das Warten auf ausreichend freie
  Leistung; der abgelaufene Countdown bleibt erhalten.
- Pflichtwärme, aktiv konfigurierte Wärme-/Fahrzeugaufteilung, Phasenvorbereitung,
  Pflicht-/Preisladung sowie bereits laufende oder übernommene Ausgänge erhalten
  diese zusätzliche Countdown-Nutzung nicht. Bestehende Start- und Schutzregeln
  gelten weiter. Feste 1P-Wallboxen benötigen keine nicht vorhandene PSM-Rückmeldung.

Die vorhandene Zuteilungsdiagnose enthält bei Bedarf `heaterCountdownUseW`
und im Startobjekt `qualificationSafetyW`/`reclaimableHeaterW`. Die echte
Sicherheitsgrenze bleibt separat sichtbar. Keine neuen Objekte oder Einstellungen.

## Prüfung und weitere Beobachtung

Regressionen prüfen 300 Sekunden weiterlaufenden EHZ, reale verzögerte
Heizleistungsreduzierung vor PV-Ladestart, keine zweite Einschaltverzögerung,
Schwankungen innerhalb der Startreserve, echten Überschussmangel, bindende
harte Grenzen, ungültige Quellen, entzogene Benutzerfreigabe und manuelle 6 A.
Bestehende Tests für Mehrfahrzeugbetrieb, Phasenwechsel und Startvorbereitung
bleiben Teil der Prüfung. Die beiden bisherigen Erwartungen einer sofortigen
Heizbudgetentnahme während qualifiziertem Countdown wurden gezielt ersetzt.

Dieser Fall ist mit dieser Änderung bearbeitet. Eine erneute Untersuchung soll
neue Aufzeichnungen nach Installation verwenden und denselben Fall als mögliche
Regression ergänzen. Softwaretests belegen noch keine reale Betriebsabnahme.
