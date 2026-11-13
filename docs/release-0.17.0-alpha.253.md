# 0.17.0-alpha.253

Sinkt der SoC eines SunEnergy-Kopfs unter die höhere Grenze aus EMS-Mindest-SoC und Geräte-Mindest-SoC, darf das EMS zur Wiederherstellung der Reserve Netzstrom nutzen. Die Sollleistung beträgt bis zu 1.000 W. Die Nachladung endet zwei Prozentpunkte über der wirksamen Mindestgrenze, spätestens an der Ladeobergrenze. Bei 10 % Mindest-SoC beginnt sie unter 10 % und endet bei 12 %.

Die Nachladung gilt im freigegebenen SunEnergy-Kopfbetrieb auch bei ausgeschalteter Preisladung. Frische Messwerte, die Gerätefreigabe und die bestehenden Leistungs-, Hausanschluss- und Netzbetreibergrenzen bleiben Voraussetzung. Der normale Leistungsanstieg wartet auf die Bestätigung des Geräts. Anschließend kann die normale Überschuss- oder Preisladung weiterlaufen.

`Devices.Battery.ReserveRecoveryActive` zeigt den Nachladebedarf. `Control.BatteryReserveGridCharge_W` zeigt die aktuell freigegebene Nachladeleistung.
