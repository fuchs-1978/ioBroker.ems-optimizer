# 0.17.0-alpha.229

- Bei einem blockierten SunEnergy-Speicherausgang genügt es, die Speicher-Steuerfreigabe im Admin auszuschalten. Wallboxen und Heizstäbe bleiben regelbar.
- Wenn der Speicher nachweislich stillsteht und der alte Stellauftrag ausgeschlossen ist, setzt der Taster `Devices.Battery.ConfirmPhysicalStop` die Reservierung zurück. Das EMS prüft dazu für jeden betroffenen Kopf einen geschriebenen Nullbefehl sowie eine frische Rückmeldung mit GS und GP bei null. Anschließend kann die Speicher-Steuerfreigabe wieder eingeschaltet werden.
