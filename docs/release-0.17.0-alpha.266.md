# 0.17.0-alpha.266

Sobald der gültige Viertelstundenfahrplan in die PV-Schlussladung wechselt, kann das EMS eine laufende freiwillige PV-Autoladung sofort pausieren. Dafür müssen der aktuelle Fahrplan und die gemeinsame Live-Zuteilung für dieses Fahrzeug null vorgeben. Der Speicher muss ladebereit sein und PV-Leistung zugeteilt bekommen. Aus den aktuellen Wallbox-, Speicher- und Netzmessungen muss hervorgehen, dass der Mindestladestrom allein möglich wäre und der verbleibende Überschuss nach Speicherzuteilung dafür zu klein ist.

Beim Mii gab das EMS am 14. November um 14:15 Uhr bereits 0 A vor. Durch die Mindestlaufzeit und die Ausschaltverzögerung lud die Wallbox weiter mit 6 A, während der Speicher rund 1,1 kW aufnahm. Alpha 266 sendet in diesem Fall das AUS sofort und reserviert die Wallboxleistung bis zur bestätigten elektrischen Abschaltung weiter.

Pflichtladung, manueller Mindeststrom und Tarifladung folgen ihren bestehenden Freigaben. Bei einer gewöhnlichen PV-Delle gilt die konfigurierte Ausschaltverzögerung.
