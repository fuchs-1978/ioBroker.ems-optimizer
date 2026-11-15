# 0.17.0-alpha.277

Im Alpha.276-Livebetrieb wechselte ein einzelner SunEnergy-Kopf um 04:56:05 Uhr direkt vom Entladeauftrag `GS = +18 W` auf `GS = −10 W` zum Laden. Der Kopf meldete den neuen GS zurück. Seine gemessene AC-Leistung `GP` blieb bei 0 W. Der Ablauf der kurzen Umschaltfrist löste trotzdem um 04:56:11 Uhr einen Nullbefehl aus.

Eine frische Rückmeldung des neuen GS beendet die kurze Umschaltfrist, sobald GP keine Leistung in der alten Richtung mehr zeigt. Die normale Prüfung der AC-Reaktion übernimmt. Bei `GP = 0 W` gilt der Stellauftrag weiterhin als elektrisch offen und die Ladeleistung bleibt reserviert. Eine fehlende GS-Rückmeldung oder anhaltende Leistung in der alten Richtung unterliegt der Umschaltfrist.
