# 0.17.0-alpha.280

Ein SunEnergy-Kopf bestätigte `GS = −1.266 W` bei 1.185 W gemessener AC-Ladung. Der Live-Regler wertete die Abweichung von 81 W als fehlende Rückmeldung und löste einen Nullbefehl aus.

Die normale Einzelkopf-Regelung zählt jetzt die gesendeten Aufträge seit dem letzten frischen GS-Echo. Ein Echo des neuesten Auftrags setzt den Zähler auf null. Ein verspätetes Echo eines früheren Auftrags bestätigt diesen Stand. Neuere gesendete Aufträge warten weiter auf ihr Echo. Nach zehn gesendeten Aufträgen in Folge ohne Echo setzt der Regler den Speicher auf null.

GP dient als Nachweis der tatsächlich wirksamen AC-Leistung, der freigewordenen Leistungsreserve und des Stillstands bei der Rückgabe. Der Test reproduziert die Abweichung von 81 W sowie die Grenze von zehn Aufträgen beim Laden und Entladen.
