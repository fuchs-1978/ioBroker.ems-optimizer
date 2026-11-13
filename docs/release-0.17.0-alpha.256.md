# 0.17.0-alpha.256

Bei der Haushaltsentladung eines SunEnergy-Kopfs konnte in Alpha.255 vor dem Echo eines neuen Auftrags eine kurze Einspeisung einen Stopp auslösen. Im Live-Mitschnitt meldete der XT500 noch 129 W Soll und 137 W AC-Entladung, als das EMS bereits 161 W angefordert hatte. Auf rund 28 W Einspeisung folgten ein Nullbefehl und wieder mehr als 100 W Bezug.

Bei geringer Einspeisung, nachgewiesener Restlast und weiterhin zulässigem Entladeauftrag wartet der Regler innerhalb der bestehenden Rückmeldefrist auf das neue Sollwert-Echo. Kommt während der Ausgabewartezeit eine neuere Rückmeldung oder sinkt das verfügbare Budget, kann der Regler eine erwiesenermaßen ungesendete Korrektur verwerfen und mit den nächsten Messwerten neu berechnen. Bis dahin verfolgt er den letzten bestätigten Auftrag und dessen ursprüngliche Frist weiter.

Fehlender Entladebedarf, ungültige Messwerte, eine unterschrittene SoC-Grenze, eine reduzierte Leistungsgrenze und abgelaufene Rückmeldefristen führen weiterhin zur sicheren Rückgabe. Dabei ordnet der Regler die Geräteantwort dem zuletzt gesendeten Auftrag zu. Ein verworfener Auftrag konnte hier in Alpha.255 zusätzlich eine dauerhafte Sperre wegen eines vermeintlich fremden Sollwerts auslösen. Die Tests decken den beobachteten Wechsel von 129 auf 161 W und geänderte Messwerte vor der Ausgabe ab.
