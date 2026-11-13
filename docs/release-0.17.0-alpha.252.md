# 0.17.0-alpha.252

Die Option „Mii nachts optional aus BHKW-Überschuss und einem Speicherfenster von 10 SoC-Punkten laden“ ist im Speicher-Reiter standardmäßig aus. Sie gilt für WB0 im einphasigen Betrieb mit 6 A, einem SunEnergy-Kopf und aktiver gemeinsamer Wallbox-Zuteilung. Das Zeitfenster reicht von 20 bis 6 Uhr (Europe/Berlin), bei geringer PV-Leistung und gemessenem BHKW-Überschuss am Netzanschluss.

Am wirksamen Speichermaximum kann das EMS einen Ladeabschnitt starten, wenn die nutzbare Energie für die konfigurierte Mindestlaufzeit reicht. Der Speicher ergänzt den gemessenen Fehlbetrag der Wallbox. Zehn SoC-Punkte unter dem Maximum oder an einer höheren wirksamen Reserve endet der Ladeabschnitt. Der nächste Start ist erst wieder am Maximum möglich. Bei 80 % Maximum ergibt sich so beispielsweise das Fenster 80 → 70 → 80 %. Während des Anlaufs und beim Abschalten können durch die Geräteantwort kurzzeitig Abweichungen am Netzanschluss entstehen.

Schutzgrenzen, Pflicht- und Preisladung haben Vorrang. Der Ladeabschnitt endet auch, wenn der BHKW-Überschuss, die Speicherfreigabe oder die gültigen Messwerte wegfallen. Der Zustand steht in `Control.BhkwWallboxCycleStatus`.
