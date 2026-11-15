# 0.17.0-alpha.285

Ab zwei konfigurierten SunEnergy-Köpfen nutzt das EMS bis einschließlich 500 W Gesamtleistung einen geeigneten Kopf. Die Schwelle und die SoC-Hysterese sind im Admin unter Batteriespeicher einstellbar. Oberhalb der Schwelle verteilt das EMS nach SoC und Online-Packzahl.

Beim Laden zählt der niedrigste und beim Entladen der höchste SoC der geeigneten Köpfe. Ein laufender Kopf bleibt innerhalb der voreingestellten fünf Prozentpunkte im Einsatz. Bei neuen Starts wechseln sich die Köpfe im SoC-Band ab. Das EMS speichert den letzten per GS und GP bestätigten Kopf über Neustarts hinweg und wartet beim Wechsel auf die Leistungsrückmeldung des abgeregelten Kopfs.

Hat ein Kopf genug Leistung, deckt er den Auftrag alleine. Liegen alle zulässigen Kopfleistungen unter dem Auftrag, übernimmt ein Kopf bis zu seiner zulässigen Leistung. Die Tests decken die Schwelle, Rotation, Hysterese, Rückmeldung, Neustart und überholte wartende Aufträge ab.
