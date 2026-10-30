# 0.17.0-alpha.173 – manuelle SoC-Basis bei Prioritaetswechsel erhalten

Reproduzierbarer Fehler: Eine bereits fortgeschriebene manuelle 94-%-Basis wurde durch eine erneute Auswertung mit nur 1 ms aelterer Zykluszeit als ungueltig verworfen. Das entfernte die Basis und liess den weiterhin gemeldeten alten Cloud-SoC von 65 % wieder wirksam werden. Unter anderem Prioritaets-/Uebergabepfade rufen die SoC-Pruefung mehrmals mit einer zuvor erfassten Zykluszeit auf.

Der Fahrzeugpfad wertet den aktuellen Cache jetzt mindestens mit der aktuellen Uhrzeit aus. Der gemeinsame Schaetzer behaelt bei einem leicht aelteren Auswertungszeitpunkt die bereits neuere manuelle Basis samt Schaetzung unveraendert. Bei ungueltiger manueller Basis bleibt der Nachweis gespeichert und SoCValid wird false; es erfolgt kein stiller Rueckfall auf alte Cloud-Werte. Bestaetigtes Abstecken und die qualifizierte automatische Fahrzeuguebernahme bleiben erhalten.

Regressionen: 94 % bleiben trotz 1 ms aelterer erneuter Auswertung gegenueber Cloud 65 % erhalten; anschliessende Energie wird weitergezaehlt; Auswertung unmittelbar nach der Korrektur; ungueltige gespeicherte Zeitfolge; Fahrzeugpfad mit aelterer Prioritaets-Zykluszeit. Historische Vergleichstests sichern die unveraenderten uebrigen Stellpfade.

Eine unter alpha.172 bereits verlorene manuelle Basis kann das Update nicht rekonstruieren. Nach Installation den aktuellen SoC am Fahrzeug/in der App pruefen und gegebenenfalls neu unter SoCCorrection_pct mit ack=false eintragen.
