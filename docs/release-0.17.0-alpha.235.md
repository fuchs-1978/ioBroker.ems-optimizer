# 0.17.0-alpha.235

- Bestätigt der einzelne SunEnergy-Kopf den laufenden Sollwert, kann das EMS bei fallendem PV-Überschuss sofort auf einen niedrigeren Ladewert regeln, während die Istleistung noch nachläuft. Die bisherige Leistungsreserve bleibt bis zur Bestätigung des niedrigeren Auftrags bestehen.
- Beim Hochregeln begrenzen die aktuelle Istleistung, die eingestellte Schrittweite und das aktuelle Leistungsbudget jeden neuen Ladewert. Der XT500 erhält dazu weiterhin einen absoluten GS-Sollwert.
- Muss das EMS auf null gehen, kann es einen bereits vom Gerät bestätigten Ladeauftrag nach dem Nullbefehl und einer frischen Nullrückmeldung selbstständig freigeben. Bei einem Auftrag ohne bestätigten Gerätesollwert bleibt die Reserve bestehen.
