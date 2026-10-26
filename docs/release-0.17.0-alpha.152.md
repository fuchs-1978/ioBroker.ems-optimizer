# 0.17.0-alpha.152 – stabile Startbudgets im Parallelbetrieb

## Ursache und Aenderung

Ein bevorzugtes, noch wartendes Fahrzeug verlieh waehrend der Startqualifikation sein gesamtes ungenutztes Budget an ein laufendes Fahrzeug. Dessen reale Aufnahme und Befehlsreservierung verringerten beim naechsten Zyklus die fuer den Start verfuegbare Leistung. Die Startqualifikation wurde zurueckgesetzt; der laufende EQV verlor abwechselnd sein Budget und erhielt es erneut. Der Heizstab konnte ebenfalls ungenutztes Startbudget beanspruchen. Live zeigte der EQE 98 zurueckgesetzte Startqualifikationen und der EQV wechselnde Ziele bis hinunter auf null/6 A.

Waehrend einer gueltigen Startqualifikation behaelt der wartende Teilnehmer jetzt seinen Mindestbedarf einschliesslich der jeweils erforderlichen Startreserve als Planungsanspruch. Nur der Rest wird an nachfolgende Fahrzeuge verteilt. Der optionale Heizstab erhaelt diesen Anspruch ebenfalls nicht. Nachfolgende gemessene Halte-/PV-Schritte duerfen ihn nicht wieder aufbrauchen. Der Anspruch wird pro Zyklus neu berechnet; er ist keine vorgetaeuschte elektrische Reservierung oder Startfreigabe. Harte Grenzen, bestehende physische Reservierungen und Startwartezeit bleiben erhalten.

## Abgrenzung und Pruefung

Der Ausgangstreiber und die fruehe gemessene 1-A-Nachregelung aus 151 bleiben unveraendert. Der Fix betrifft die vorgelagerte Parallelzuteilung fuer alle Fahrzeugpositionen. Eine konfigurierte EHZ-Parallelquote oder Warmwasserpflicht wird nicht aufgehoben; die gesamte Heizstableistung wird nicht pauschal zum Auto verschoben.

Zyklischer Regressionstest: 7.430 W gemeinsames Budget, bevorzugter 3P-Start mit 300 Sekunden Wartezeit, laufender EQV und optionaler Heizstab. Der alte Code verleiht 7.360 W an den EQV und laesst kein Startminimum frei. Der neue Code belaesst dem EQV nutzbaren Rest, haelt das Startminimum frei und beendet die Startqualifikation. Softwarepruefung ersetzt keinen Nachweis des realen Anlagenverlaufs nach Installation.
