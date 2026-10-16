# 0.17.0-alpha.84

## Anlass und Ursache
Bei der Betriebsanalyse vom 16.10.2026 (#167) blieb eine EHZ-Phase mit 3000 W reserviert, obwohl der letzte Nullauftrag transportseitig abgeschlossen war und die drei Ausgangsregister Null meldeten. Fuer die letzte positive Phase fehlte der volle Wirkungsnachweis. Der Ersatzweg verlangte bisher einen numerischen Null-Soll-ACK. Das untersuchte Modbus-Sollobjekt ist jedoch nur schreibbar (`read=false`, `poll=false`): Nach Verarbeitung wird der Sollwert erwartungsgemaess mit ACK auf NULL zurueckgesetzt. NULL ist hier weder ein gemessener Nullwert noch ein Kommunikationsfehler.

## Korrektur
Nur fuer lesend gepruefte, nur schreibbare numerische Modbus-Holdingregister wird ein separater Befehlsnachweis verfolgt. Die Laufzeit ordnet einen tatsaechlich ausgegebenen EMS-Auftrag seinem beobachteten unbestaetigten Command-State und einem zeitlich spaeteren NULL-Reset des zugehoerigen Modbus-Adapters zu. Ein Datenbank-Schreibcallback allein ist weiterhin kein solcher Nachweis. Der Reset bestaetigt die Befehlsverarbeitung, nicht die elektrische Wirkung.

Nach einem so zugeordneten Nullauftrag, abgeschlossenem EMS-Schreibtransport und unveraenderter Quellen-/Zielzuordnung muessen alle drei echten Ausgangsregister mehrfach bestaetigte, qualitativ gueltige, frische Nullwerte liefern: mindestens drei unabhaengig fortgeschrittene Probensaetze ueber mindestens 15 Sekunden oder die laengere eingestellte Settle-Zeit. Alle Proben liegen nach Transportabschluss und Befehlsreset. Eine positive Phase, NULL-Istwerte, ungueltige Qualitaet, fehlender ACK, grosse Messluecken oder neue Befehle unterbrechen den Nachweis. Ein Neustart uebernimmt keinen alten Resetnachweis.

Ueberlappende Auftraege, ungeklaerte Transportfehler oder fremde/unzuordenbare Schreibereignisse sperren diesen zusaetzlichen Nachweis fuer den laufenden EMS-Prozess; die Schutzreserve wird dadurch nicht spekulativ geloescht. Metadatenwechsel verwerfen den bisherigen Beleg und duerfen eine offene Befehlsunsicherheit nicht zuruecksetzen. Der bisherige Freigabeweg ueber beobachtete positive Wirkung und spaetere reale Reduktion sowie der numerische Null-ACK-Weg bleiben erhalten. Status und `OutputReservationState_JSON.lastReleaseProof` unterscheiden den neuen Befehlsreset von physischer Stillstandsbeobachtung. Die Beweisfuehrung sendet keine zusaetzlichen Aktorbefehle oder SQL-Abfragen.

## Validierung und reale Nachpruefung
Regressionen pruefen NULL-Reset-Zuordnung und Herkunft, Datenbankcallback ohne Reset, Fremdschreiber, ueberlappende/verspaetete Auftraege, Metadatenwechsel, Neustart, drei reale Phasen, Messluecken, Qualitaet, neue positive Wirkung und laengere Settle-Zeit. Vollstaendige Testsuite und Paketpruefung werden vor Merge/Release ausgefuehrt.

Nach manueller Installation pruefen: tatsaechlich beobachteter eigener Nullauftrag, zugeordneter Modbus-Reset und danach frische dreiphasige Stillstandsproben; Reserveabbau nur mit dokumentiertem `write-only-zero-receipt-and-electrical-plateau`. Bei bleibender Reserve zuerst Status, Quellenzeiten und Befehlsfolge lesen, nicht manuell loeschen. Ein verzoegerter Leistungsanstieg muss den Stillstandsnachweis unterbrechen. Ausbleibender Nachweis ist offen und kein erfolgreicher Fix. Softwaretests ersetzen weder diese reale Abnahme noch die allgemeine EMS-Abnahme; keine Scorepunkte allein fuer das Release.

Keine automatische Installation, Aktivierung oder Aenderung produktiver Konfiguration, SQL-Einstellungen, Skripte, Freigaben oder Aktoren.
