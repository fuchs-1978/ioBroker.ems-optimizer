# 0.17.0-alpha.282

Mit der bestehenden Speicherhilfe kann die bevorzugte WB1 (EQV) tagsüber bei bestätigter Einphasigkeit auf 6 A starten. Bei 230 V und 800 W nutzbarem Überschuss fehlen rechnerisch 580 W. Der einzelne SunEnergy-Kopf kann bis zu 600 W beisteuern, sobald die Wallbox messbar lädt.

Für den Start muss der Speicher an seiner oberen Ladegrenze oder im zugehörigen Wiederanlaufbereich stehen. Bei 100 % Ladegrenze und zwei Prozentpunkten Ladehysterese ist damit auch ein Speicherstand von 99 % ausreichend. Die übliche Startverzögerung beträgt in diesem Fall höchstens zwei Minuten. Die Speicherhilfe hält eine Reserve von 90 % oder die höhere wirksame Entladegrenze ein.

Die Netz- und Leistungswerte werden vor der Ladefreigabe und vor Speicheraufträgen erneut geprüft. Ein anhaltender Fehlbetrag über 600 W beendet die Speicherhilfe nach drei frischen Messungen. Bei ausreichender PV-Leistung lädt das Auto weiter. Freie PV-Leistung kann den Speicher unter Einhaltung seiner Ladehysterese anschließend oder parallel nachladen.
