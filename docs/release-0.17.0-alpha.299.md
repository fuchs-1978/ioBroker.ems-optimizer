# Alpha 299 – Fernstart für erstmals gewählte Geräteprogramme

Ein Geschirrspüler mit fünf gemessenen Programmprofilen kann jetzt auch sein sechstes Programm automatisch zum geplanten Zeitpunkt starten. Das EMS sendet die gewählte Programmkennung, wenn **Gewähltes Programm starten** aktiviert ist. Für die gemeinsame Planung mit anderen Geräten verwendet es den Viertelstunden-Mittelwert aller gemessenen Programmprofile dieses Geschirrspülers. Ein einziges bekanntes Profil genügt.

Jedes bekannte Programm zählt einmal, unabhängig von der Anzahl seiner Messläufe. Nach dem Ende eines kürzeren Programms gehen für dessen restliche Viertelstunden 0 W in den Mittelwert ein. Das geschätzte Zeitfenster reicht bis zum Ende des längsten einbezogenen Profils. Läuft das Gerät darüber hinaus, wartet die Planung weiterer Starts auf eine Rückmeldung über das Programmende.

Meldet das Gerät ein reguläres Ende und deckt die Leistungshistorie den Lauf vollständig ab, speichert das EMS das erste eigene Profil unter der ausgeführten Programmkennung in `Devices.ProgramProfiles`. Mit der nächsten Freigabe nutzt es die gemessene Leistungskurve. Bei abgebrochenen Läufen oder Lücken in der Messung steht für den nächsten Versuch weiterhin der Gerätemittelwert zur Verfügung.

Unter `Devices.Programs.N` erkennst du die Schätzung an `profileSource = deviceAverage`, der Anzahl bekannter Programme in `fallbackProgramCount` und `profileSamples = 0`. Nach dem ersten vollständig gemessenen Lauf zeigt die nächste Planung `profileSource = program` und `profileSamples = 1`. Bei einem neuen Gerät mit Programmauswahl liefert ein erster manueller Messlauf die Grundlage für den Fernstart.
