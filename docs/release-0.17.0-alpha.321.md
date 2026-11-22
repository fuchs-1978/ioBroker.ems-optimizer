# 0.17.0-alpha.321 · Vorbereitung auf den ioBroker-Review

Die Testmatrix führt die Adaptertests und einen Installations- und Starttest mit dem ioBroker-Controller unter Ubuntu, Windows und macOS aus. Die Node.js-Versionen sind 22, 24 und 26. Das installierbare Paket wird aus einer expliziten Dateiliste gebaut und separat installiert und geprüft.

Laufende EMS-Timer verwenden die ioBroker-Instanz als Eigentümer. Beim Stoppen entfernt der Adapter die noch offenen Engine-Timer. Bereits fällige Rückrufe führen nach Beginn des Stopps keine neue Gerätearbeit mehr aus. Einige Zeitlimits für ausstehende Schreibvorgänge und den Neustart der Batterieanbindung verwenden die Node-Timer unabhängig vom Lebenszyklus der Instanz. Dadurch enden diese Wartevorgänge auch während des Stopps.

Für Maintainer erstellt der bestehende Workflow `release.yml` auf ausdrückliche Anforderung einen geprüften GitHub-Vorabrelease. Zur separaten Veröffentlichung genau dieses Tags auf npm dient der manuelle Start von `test-and-release.yml` mit gesetztem `publish_to_npm`. Der Job prüft den Tag, die Abstammung von `main` und beide Versionsangaben und veröffentlicht erst nach der Testmatrix. Alpha-Versionen erhalten bei npm den Distributions-Tag `alpha`. Die Anmeldung erfolgt über npm Trusted Publishing für diesen Workflow. [npm-Dokumentation](https://docs.npmjs.com/trusted-publishers/)
