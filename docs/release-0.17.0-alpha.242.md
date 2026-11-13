# 0.17.0-alpha.242

Bei regulärem Neustart oder Update wartet das EMS bei einem noch laufenden, freigegebenen SunEnergy-Ladeauftrag bis zu 2,5 Sekunden auf die Sollwertbestätigung, bevor es den Nullbefehl schreibt. Der Neustart kann danach anhand der gespeicherten Bestätigung und frischer Nullrückmeldung selbstständig weiterregeln.

Die Wartezeit gilt bei gleicher, freigegebener Speicherkonfiguration und gültigem Leistungsrahmen. Bei entzogener Freigabe oder ungültigen Messwerten greift der Nullbefehl sofort. Eine bereits gespeicherte Reserve ohne nachweisbaren Altauftrag bleibt bestehen.
