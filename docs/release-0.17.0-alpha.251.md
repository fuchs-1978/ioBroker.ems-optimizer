# 0.17.0-alpha.251

Beim Wechsel zwischen Laden und Entladen kann das EMS den alten SunEnergy-Auftrag früher abschließen. Dafür muss der Treiber den gerade gesendeten Nullbefehl bestätigen. Eine frische Geräterückmeldung muss danach noch sinkende AC-Leistung in der bisherigen Richtung zeigen, eine weitere den Stillstand innerhalb der Nulltoleranz. Erst dann darf die Gegenrichtung bei gültiger Freigabe und gültigem Leistungsbudget starten.

Fehlt diese Folge, gilt für unbeobachtete Altaufträge weiterhin die Prüfung mit mindestens drei frischen Nullmeldungen über mindestens zehn Sekunden. Der 1-Sekunden-Regeltakt bleibt bestehen.
