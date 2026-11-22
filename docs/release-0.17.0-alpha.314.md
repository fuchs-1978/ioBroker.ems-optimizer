# Alpha 314 – SunEnergy-Wiederanlauf nach einer Nullmeldung

Nach einem Konflikt am SunEnergy-Sollwert `GS` genügt eine frische Originalmeldung pro konfiguriertem Kopf, um die Regelung wieder freizugeben. Der Kopf muss in derselben Messung **0 W Sollleistung (GS) und 0 W tatsächliche AC-Leistung (GP)** melden. Danach berechnet der EMS den nächsten Auftrag aus dem aktuellen Netzbezug oder Überschuss und den geltenden Leistungsgrenzen.

## Die Nacht vom 22. November

Um 03:31 Uhr wiederholte der EMS einen Ladeauftrag von −293 W. Dazwischen hatte er unter anderem −273 W vorgegeben. Die Rückmeldungen trafen verzögert ein und Alpha 313 verriegelte den Speicherausgang. Um 03:31:14 Uhr stand der zurückgelesene Sollwert bereits bei 0 W, am AC-Anschluss lagen noch 17 W an. Um 03:31:16 Uhr meldete der Treiber erstmals für beide Werte 0 W. Im Regressionstest gibt Alpha 314 genau mit dieser Meldung die Regelung wieder frei. Im damaligen Anlagenbetrieb blieb Alpha 313 bis zur manuellen Quittierung gesperrt.

Der Gerätezeitstempel und die Herkunft der Originalmeldung belegen den Stillstand nach dem Konflikt und der Übertragung des Nullbefehls. Später beobachtete Fremdaufträge und neuere Messungen mit Leistung behalten Vorrang vor verspätet eingehenden Nullen. Bei mehreren Köpfen prüft der EMS jeden einzeln, bevor er die gemeinsame Freigabe erteilt. Ein gespeicherter GS-Konflikt aus Alpha 313 lässt sich ebenfalls automatisch mit einer neuen Messung nach dem Start auflösen. Ein ausstehender Stopp wird zuerst abgeschlossen.
