# 0.17.0-alpha.249

Wenn ein einzelner SunEnergy-Kopf eine Wallbox puffert und den laufenden Entladeauftrag bereits als GS bestätigt hat, kann das EMS direkt auf einen kleineren Entladeauftrag wechseln, während die AC-Leistung noch nachläuft. Vor dem Schreiben werden die GS-Bestätigung, die Pufferfreigabe, die Netzleistung und das aktuelle Budget erneut geprüft. Eine Erhöhung setzt weiterhin eine bestätigte physische Leistungsrückmeldung voraus.

Die Korrektur deckt den beobachteten Wechsel von 458 W Entladeauftrag und 276 W Istleistung auf ein Ziel von 250 W ab. Bei fehlender Bestätigung bleibt die begrenzte Wartezeit wirksam. Bei tatsächlichem Nullziel, Richtungswechsel, deutlicher Einspeisung oder abgelaufener Rückmeldefrist greift weiterhin die Rückgabe über 0 W.
