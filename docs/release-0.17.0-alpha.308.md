# Alpha 308 – PV-Überschussstart mit SunEnergy

Lädt ein einzelner SunEnergy-Kopf seit mindestens zwei Minuten mit PV-Leistung bis auf 50 W an seiner Ladegrenze, kann das EMS Leistung an ein ladebereites Fahrzeug abgeben. Bei einem 2.400-W-Kopf liegt die Schwelle bei 2.350 W. Bisher konnte bei einem Regeltakt von zwei Sekunden der Nachweis nach vier Sekunden verfallen. Ein Speicher, der etwa alle fünf Sekunden meldete, erreichte dadurch trotz gleichmäßiger Ladung die zwei Minuten nicht.

Das EMS bestimmt den Meldetakt jetzt aus den Gerätezeitstempeln. Zwischen zwei Speichermeldungen prüft es weiter die Leistung am Netzanschlusspunkt. Eine wiederholte Meldung mit demselben Gerätezeitstempel verlängert die nachgewiesene Ladezeit nicht. Bei einer zu großen Messlücke, ungültigen Netzmesswerten oder zu geringer PV-Ladeleistung beginnen die zwei Minuten neu. Für eine Speichermeldung gelten die eingestellte Datenfrische und eine Obergrenze von zehn Sekunden.

Bei gemessener Einspeisung kann der Speicher Leistung für den Anlauf freigeben. Die Wallbox prüft vor dem Einschalten den tatsächlich verfügbaren Überschuss, die Ladefreigabe und die geltenden Leistungsgrenzen. Der reguläre PV-Start folgt weiterhin der eingestellten Startwartezeit.
