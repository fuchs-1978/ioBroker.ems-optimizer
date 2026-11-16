# 0.17.0-alpha.292

Bei aktiver Prognosereserve und einem Speicher-SoC unter 20 % nutzt das EMS freien PV-Überschuss bis zur zulässigen Ladeleistung. In einem freigegebenen Netzladefenster ergänzt Netzstrom den fehlenden Anteil bis zu 1.000 W Gesamtladeleistung. Das gilt auch bei fehlendem PV-Überschuss. Der Speicher kann überschüssige PV aufnehmen, während er auf ein günstigeres Netzladefenster wartet.

Bei 600 W freiem PV-Überschuss und freigegebener Netzladung ergeben sich 1.000 W Ladeleistung, davon 400 W Netzanteil. Bei 2.400 W freiem PV-Überschuss und entsprechender Gerätefreigabe lädt der Speicher mit 2.400 W aus PV. Das EMS prüft den Überschuss vor dem Stellbefehl erneut und begrenzt die Nachladung anhand des Netz-, Phasen- und Gerätebudgets. Eine parallele Fahrzeug-Pflichtladung behält ihre Zuteilung.

`Control.BatteryForecastReserveCharge_W` zeigt die zugeteilte Gesamtladeleistung für die Reservenachladung. `Control.BatteryForecastReserveGridCharge_W` zeigt den zugeteilten Netzanteil. Bei erreichtem Reserve-SoC übernimmt die normale Speicherregelung.
