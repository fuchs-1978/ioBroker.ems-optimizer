# Alpha.204 – Vorläufigen Fahrzeug-SoC nach der Fahrt korrigieren

Hat das EMS das Abstecken beobachtet und liegt beim neuen Ladebeginn noch der App-Wert von vor dem Abstecken vor, zeigt es die daraus berechnete Schätzung als `energy-estimate-provisional-trip` an. Zur Einordnung verwendet es die letzte Wertänderung des App-Datenpunkts, ersatzweise dessen Veröffentlichungszeit.

In den ersten 30 Minuten der neuen beobachteten Ladung kann ein niedrigerer App-Wert einmalig zur neuen Basis werden. Dafür braucht das EMS eine durchgängige Energiekette und einen passenden Zählerstand. Ohne echten Fahrzeugmesszeitpunkt setzt es die neue Basis am ersten passenden Zählerstand ab Veröffentlichung und addiert die danach gemessene Energie. Der frühere Messzeitpunkt bleibt unbekannt. Eine bereits vor dem Ladebeginn eingetroffene neue App-Meldung liefert direkt die neue Basis.

Die Ausnahme endet bei einer neuen verankerten Meldung, nach 30 Minuten oder bei unterbrochener Zählung. Eine konfigurierte Fahrzeugmesszeit und die manuelle Korrektur behalten ihre eigenen Bedingungen.

Die Tests bilden den Mii mit 70 % vor der Fahrt und 60 % als verspäteter App-Meldung während der neuen Ladung ab. Nach der Übernahme der 60 % erkennt das EMS Pflichtladebedarf bis zur erneut berechneten 70-%-Mindestmarke. Eine Stunden später eintreffende widersprüchliche Meldung bleibt ein Plausibilitätsfall.
