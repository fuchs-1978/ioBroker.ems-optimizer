# Alpha 324 – Mehrere Ladestufen für spätere PV-Überschüsse

Wenn ein zusätzliches Ampere in allen geeigneten Viertelstunden noch Einspeisung bei vollem Speicher übrig lässt, prüft der Fahrplan eine weitere Stufe. Dafür müssen im Auto noch Ladebedarf und an der Wallbox Stromreserven bestehen. Der Hausspeicher lädt in den früheren Viertelstunden weiterhin mit mindestens der Hälfte seiner maximalen Ladeleistung. Jede zusätzlich ans Auto vergebene Wattstunde muss der Speicher später am selben Tag aus dem erwarteten Überschuss nachladen können.

Im Fahrplan vom 23. November um 07:49 Uhr erhielt der Mii bereits in 14 Viertelstunden je 1 A zusätzlich. Das entsprach 805 Wh. Gegen 15:30 Uhr verblieben rund 943 W Einspeisung für 15 Minuten. Für die fehlenden 236 Wh reicht bei 230 V eine zweite Stufe in vier vollen Viertelstunden und für rund anderthalb Minuten in einer weiteren. In der Nachrechnung nimmt der Speicher um 15:30 Uhr die gesamten 1.115 W Überschuss auf.

In `Plan.WallboxN_48h_JSON` ist `pvHeadroom.baseA` der ursprünglich geplante Strom. `currentA` gibt die höchste Stufe an. Beginnt sie innerhalb der Viertelstunde, gilt bis `pvHeadroom.from` die unmittelbar darunterliegende Stufe. `valueW` enthält die mittlere Leistung des Intervalls.

Im Betrieb prüft der Regler den verfügbaren PV-Strom bei jeder Stufe erneut. Er wartet auf die Rückmeldung der laufenden Wallbox, bevor er ein weiteres Ampere freigibt.
