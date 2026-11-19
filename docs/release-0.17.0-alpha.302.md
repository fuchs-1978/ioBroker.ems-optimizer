# 0.17.0-alpha.302

Die Einzelkopfregelung von SunEnergy kann einen kleinen Lade- oder Entladeauftrag mit dem nächsten Sollwert ablösen, während die GS-Rückmeldung noch aussteht. Bisher führte eine vorgehende Geräteuhr dabei zum Nullbefehl. In einem aufgezeichneten Fall setzte das EMS einen Ladeauftrag von 24 W nach einer Sekunde zurück, weil die Gerätezeit der ioBroker-Empfangszeit um rund neun Sekunden voraus war.

Bis einschließlich 100 W in beide Richtungen prüft das EMS, ob zwei unterschiedliche Originalmessungen des konfigurierten Treibers in plausibler Folge eingetroffen sind. Die Grenze gilt für das aktuelle Leistungsziel, die beteiligten Aufträge und Reserven sowie den vom Kopf gemeldeten GS und die gemessene AC-Leistung. Die Gerätezeit ordnet die Messungen. Die lokale Empfangszeit bestimmt ihr Alter. Das erneute Lesen desselben Gerätezeitstempels verlängert dessen Gültigkeit nicht.

Zur nachträglichen Bestätigung eines Auftrags müssen zwei fortschreitende Messungen nach der Übertragung eingegangen sein. Das EMS unterscheidet die GS-Rückmeldung von der elektrischen Wirkung am GP. Zehn offene übertragene Sollwerte oder zehn verschiedene auswertbare Messungen ohne passendes GS-Echo führen zum Nullbefehl. Ein unveränderter Sollwert erzeugt keine periodischen Schreibzugriffe.

Bei einem echten Stopp wartet das EMS auf die Rückgabe des Kopfs. Die Kleinleistungsfreigabe gilt für die koordinierte Einzelkopfregelung. Größere Leistungen, Speichergrenzen, Hausanschlussgrenzen und Gerätefehler unterliegen ihren regulären Prüfungen.
