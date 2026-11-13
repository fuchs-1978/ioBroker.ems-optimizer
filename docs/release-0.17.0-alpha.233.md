# 0.17.0-alpha.233

- Verwirft das EMS einen SunEnergy-Stellauftrag vor der ioBroker-Ausgabe, bestätigt die Warteschlange, dass der Auftrag nie ausgegeben wurde. Nach dem Nullbefehl und einer frischen Nullrückmeldung gibt das EMS die zugehörige Reserve automatisch frei.
- Ist der Versandstatus unklar oder stammt die Reservierung aus einem früheren Adapterlauf, bleibt die bisherige Bestätigung erforderlich. Bereits festgehaltene Reservierungen ohne Versandnachweis lassen sich nach bestätigtem Stillstand über `Devices.Battery.ConfirmPhysicalStop` zurücksetzen.
