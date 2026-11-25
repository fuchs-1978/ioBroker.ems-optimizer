# Alpha 331 – Mindest-SoC zur Abfahrt

Am 25. November um 06:37 Uhr meldete der Mii bei 75 % Mindest-SoC einen fortgeschriebenen Ladestand von 81,4 %. Die Abfahrt war auf 07:00 Uhr eingestellt, der Ziel-SoC auf 100 %. Alpha 330 reservierte bei 0 W PV-Budget und ausgeschalteter Preisladung 6 A. Die Wallbox meldete 1,32 kW. Auslöser war die Berechnung des spätesten Ladebeginns aus der Energie bis 100 %.

Alpha 331 berechnet den regulären Abfahrtsbedarf aus dem Mindest-SoC. Ist er gedeckt, beträgt der späteste erforderliche Ladebeginn in `Vehicles.WallboxN.LatestStartTimestamp` für diese Abfahrt 0. Die Energie bis zum oberen Ziel bleibt als Bedarf für PV- oder freigegebene Preisladung sichtbar. In der letzten Viertelstunde einer Pflichtladung plant das EMS nur die benötigten Lademinuten ein. Bei ausreichendem Überschuss kann die Ladung oberhalb des Minimums fortgesetzt werden.

Mit der neuen Option **Zusätzlich bis zum Ziel-SoC aus dem Netz laden** lässt sich das frühere Verhalten für eine einzelne Wallbox auswählen. Sie setzt die aktive Abfahrtsregel voraus und ist beim Update standardmäßig aus.

Die Prüffälle bilden Parallel- und Einzelbetrieb ab. Bei 81,4 % und exakt 75 % bleibt die Wallbox ohne weiteres Ladebudget aus. Bei 74,9 %, 32,3 kWh Kapazität und 90 % Ladewirkungsgrad fehlen rund 0,036 kWh AC. Die Simulation prüft die kurze Schlussladung, das Abschalten am Minimum und die PV-Ladung vor der Abfahrt. Eigene Prüfungen decken die ausdrücklich freigegebene Ziel-, Preis- und manuelle Mindestladung ab.
