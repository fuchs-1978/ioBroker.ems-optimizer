# Startphasenwahl ab alpha.46

## Auftrag und belegter Ausgangspunkt

Am 07.10.2026 um etwa 14:09 Europe/Berlin war die externe Priorität `javascript.0.ev.prio` auf WB1/EQV gesetzt. Der EQV war noch abgesteckt und bestätigte 3P; der ausgewählte Mii lud mit 10 A. Die geltende Logik hielt den Mii bis zur Zulässigkeit des EQV ausgewählt. Beim späteren Auswählen hätte auch eine gestoppte Zielwallbox zunächst 120 s niedriges Budget qualifizieren müssen, gegebenenfalls zusätzlich 15 min Phasenhaltezeit. Eine zukünftige Ansteck-/Umschaltsequenz war zu diesem Zeitpunkt noch nicht beobachtet.

## Verhalten

Vor dem Start prüft der EMS für die ausgewählte angeschlossene Zielwallbox gültiges reales Budget, SoC-/Benutzerfreigaben und die bisherige Phasenführung. Die neue Vorbereitung gilt nur bei unabhängig bestätigter Freigabe AUS, höchstens 20 W absoluter Leistung, höchstens 0,5 A auf jeder Phase, Ausgang nicht aktiv und Ausgang nicht mehr besessen. Fehler, fehlende/ungültige/veraltete Werte oder offene Stopps qualifizieren nicht. Der reale Ausgang prüft die Schutz- und Startbedingungen weiterhin selbst.

Bei gültigem Budget ab 1P-Mindestleistung plus Startreserve, aber unter 3P-Mindestleistung plus Startreserve, wird vor der Ladung unmittelbar 1P angefordert. Bei 6 A, 230 V und 300 W Reserve sind dies 1.680 W bis unter 4.440 W. Bei Budget über der nutzbaren 1P-Maximalleistung plus Reserve und mindestens der 3P-Mindestleistung plus Reserve kann 3P vorbereitet werden. Dazwischen bleibt die bestehende Topologie erhalten. Mindestströme, Geräte-/Hausanschluss- und gemeinsame Verbrauchsgrenzen bleiben wirksam.

Die Vorbereitung umgeht nur die Qualifikation und Phasenhaltezeit für einen bereits laufenden Wechsel. Ein Kaltstart behält seine allgemeine Einschaltverzögerung. Eine belegte qualifizierte Fahrzeugübergabe darf diese allgemeine Verzögerung nach bestehenden Regeln umgehen; eine bloße Prioritätswahl oder ein Ansteck-Snapshot erzeugt keinen Nachweis. Feste bzw. externe Phasenführung und Pflichtladung werden nicht übersteuert. Während der begrenzten nativen Umschaltung bleibt die Zielphase bestehen; erst eine echte Modus-ACK autorisiert den weiteren Ausgangsablauf. Strom-/Freigabe-ACK und anschließende elektrische Fahrzeugantwort sind getrennte Nachweise.

Der bisherige Ausgang wird durch die vorhandene sichere Auswahl-/Stoppsequenz zurückgenommen. Vorbereitung der Zielphase und Abschalten des bisherigen Autos können zeitlich überlappen; die neue Ladung beginnt erst nach Modusbestätigung und belegtem AUS samt elektrischer Ruhe des bisherigen Autos. Es gibt keine Zusage einer unterbrechungsfreien Überlappung zweier Autos. Der Phasenfolger muss in seiner geprüften EMS-Zuständigkeit laufen; der Adapter aktiviert oder verändert kein Skript.

## Regression und nächste reale Abnahme

Tests prüfen sofortige 1P-Startvorbereitung trotz vorheriger Haltezeit, unveränderte laufende Wechselregeln, fehlenden Stoppnachweis, ungültiges bzw. zu kleines Budget und native ACK-false-Echos. Ein Integrationstest verbindet den realen Verteiler mit den realen Ausgangszustandsautomaten und einem synthetischen 1P-Gerät: zuvor bestätigte 3P-Konfiguration, laufender Mii, manuelle Zielpriorität, Anstecken, 1P-Anforderung, verzögerte Modus-ACK sowie 10 s verzögerte elektrische Ruhe des bisherigen Autos. Die Zielwallbox startet ohne zusätzliche 120-/300-s-Wartezeit erst nach den notwendigen Nachweisen. Das ist kein realer Hardwaretest und kein Nachweis eines gelungenen heutigen EQV-Wechsels.

Nach manueller Installation in der Betriebsanalyse prüfen:

1. Installierte Version, Zuständigkeit und echte Priorität lesen. EQV-Anstecken, SoC/Freigaben und gültiges rekonstruierbares Budget belegen.
2. `Control.Wallbox1.PhaseDecision_JSON`: `pre-start-budget-phase`, Budget und Schwellen. Eine 1P-Anforderung ist noch keine reale 1P-Bestätigung.
3. Modus-Schreibecho, unabhängige Modus-ACK, Stop-/Leistungsrückmeldungen des Mii, EQV-Strom-/Freigabebefehle und Fahrzeugantwort in Ereigniszeit zuordnen. Keine neue Ladung vor alter elektrischer Ruhe, keine doppelte Budgetnutzung.
4. Starttimer nur bei wirklich qualifizierter Übergabe umgehen. Datenlücken und abgelaufene Vorbereitung als offen bzw. unbekannt dokumentieren; Kaltstarts behalten ihre Timer.
5. Nach erfolgreichem Start gelten laufende Phasenqualifikation und Mindesthaltezeit wieder. Bei wechselnder PV Nachregelung und Schutzgrenzen mit realen Daten bewerten.

Es erfolgen keine automatischen produktiven Änderungen. Softwarefortschritt allein erhöht den Abnahmescore nicht.
