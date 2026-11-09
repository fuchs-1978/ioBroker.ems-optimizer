# Alpha.211 · Ersatzwahl nach Ziel-SoC

Meldet die Wallbox das manuell priorisierte Fahrzeug als abgesteckt, vergleicht das EMS die Abstände der ladeberechtigten Ersatzfahrzeuge zu ihrem jeweiligen Ziel-SoC in Prozentpunkten. Bekannte Abstände gehen vor unbekannten. Bei Gleichstand gilt die bisherige Reihenfolge. Pflichtladung, Preisfreigaben und elektrische Schutzgrenzen gelten weiterhin.

Die Echtzeitregelung hält die Auswahl während der Startqualifikation und solange der Ausgang belegt ist. Nach einem tatsächlichen Stopp kann beim nächsten Start neu ausgewählt werden. Im Fahrplan bleibt die Auswahl über zusammenhängende Ladeintervalle erhalten. Das manuell priorisierte Fahrzeug hat bei Wiederanschluss und Ladefreigabe wieder seine bisherige Priorität.
