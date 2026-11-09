# 0.17.0-alpha.221

- Eine manuelle Fahrzeug-SoC-Korrektur bei bestätigt abgestecktem Fahrzeug wird 30 Minuten für das nächste Anstecken gespeichert. Voraussetzung ist die aktivierte SoC-Schätzung für das Fahrzeug.
- Der eingetragene Wert gilt bereits für die erste Ladeentscheidung. Die Fortschreibung beginnt mit dem ersten frischen Ladeenergiezählerstand der neuen Sitzung.
- Eine Eingabe von `-1` hebt die Vormerkung oder Korrektur auf. Eine ungenutzte Vormerkung verfällt nach 30 Minuten. Nach dem Abstecken gilt wieder die Fahrzeugquelle.
- Tests prüfen den Mii mit 65 % Vorabwert, 49 % Cloud-SoC und 50 % Mindest-SoC sowie Ablauf, Neustart, Abbruch und erneutes Anstecken.
