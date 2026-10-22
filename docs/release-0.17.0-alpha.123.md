# 0.17.0-alpha.123 — kurze Wallbox-Messluecken

Eine bereits physisch bestaetigte, vom EMS gefuehrte Ladung kann bei unveraendertem Strom und unveraenderter Phase bis maximal 60 Sekunden Gesamtalter der Wallbox-Messwerte weiterlaufen. Bei der normalen 30-Sekunden-Grenze sind das hoechstens 30 Sekunden zusaetzlich. Es werden keine neuen Ladebefehle gesendet und keine Quellzeitstempel veraendert.

Aktuelle SMA-Netz- und Phasenmessungen, alle Freigaben und konservativ ausreichende Reserven sind Voraussetzung. Die volle moegliche Ladeleistung bleibt reserviert; andere Wallboxen und Heizstab werden mitgerechnet. Optionales PV-Laden wird bei fehlendem Ueberschuss nicht fortgesetzt. Mindest-SoC-Laden darf weiterhin den erlaubten Netzbezug nutzen.

Bei Ablauf, explizitem Offline-Status, Fehlern, ungueltiger Datenqualitaet, Stop-Anforderung, Ziel-SoC, geaenderter Prioritaet oder Phase sowie notwendigen Leistungsreduzierungen greifen die normalen Abschaltbedingungen. Starts, offene Bestaetigungen und Phasenwechsel werden nicht ueberbrueckt. Die Ausnahme gilt nicht fuer Taper-, modellierte oder Group-Net-Regelung; nicht nachweisbare Reserven fuehren ebenfalls zur normalen Abschaltung.

Nach frischen Rueckmeldungen uebernimmt die normale Regelung wieder. Der Status zeigt TELEMETRIE-UEBERBRUECKUNG an. Die Korrektur der qualifizierten Ziel-SoC-Uebergabe aus alpha.122 ist enthalten. Das externe Phasenumschaltskript bleibt unveraendert.

Validierung: gezielte Ausgangstests fuer Zeitgrenzen, Wiederkehr, Freigaben, SMA-Ausfall, Ueberlast und Leistungsgrenzen; Integration mit realer Zuteilung jeweils mit/ohne paralleles Laden und Heizstab; historische Aequivalenztests. Softwaretests ersetzen keine Beobachtung der installierten Version.
