# 0.17.0-alpha.321 · Vorbereitung auf den ioBroker-Review

Die Testmatrix prüft unter Ubuntu, Windows und macOS mit Node.js 22, 24 und 26, ob der ioBroker-Controller den Adapter installieren, starten und nach der Initialisierung auf Anforderung sauber beenden kann. Das installierbare Paket wird aus einer expliziten Dateiliste gebaut und separat installiert und geprüft.

Beim Schreiben und Wiederherstellen von Aufzeichnungen öffnet das Journal die für die Synchronisierung benötigten Handles unter Windows mit Schreibzugriff. Ein Fehler bei der Synchronisierung wird weiter als Fehler gemeldet. Der historische Vergleich berücksichtigt die nativen Pfadtrenner und die tatsächlichen Pfade temporärer Verzeichnisse.

Laufende EMS-Timer verwenden die ioBroker-Instanz als Eigentümer. Beim Stoppen entfernt der Adapter die noch offenen Engine-Timer. Bereits fällige Rückrufe führen nach Beginn des Stopps keine neue Gerätearbeit mehr aus. Einige Zeitlimits für ausstehende Schreibvorgänge und den Neustart der Batterieanbindung verwenden die Node-Timer unabhängig vom Lebenszyklus der Instanz. Dadurch enden diese Wartevorgänge auch während des Stopps.

Für Maintainer erstellt der bestehende Workflow `release.yml` auf ausdrückliche Anforderung einen geprüften GitHub-Vorabrelease. Die erste npm-Alpha veröffentlicht ein angemeldeter Maintainer aus dem geprüften Versions-Tag mit `npm publish --tag alpha`. Sobald das Paket existiert, lässt sich `test-and-release.yml` in den npm-Paketeinstellungen als Trusted Publisher eintragen. [Erstveröffentlichung bei npm](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/) · [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

Für spätere Veröffentlichungen startet der Maintainer `test-and-release.yml` für den gewünschten Versions-Tag und aktiviert `publish_to_npm`. Der Job prüft den Tag, die Abstammung von `main` und beide Versionsangaben und veröffentlicht erst nach erfolgreicher Testmatrix. Alpha-Versionen erhalten bei npm den Distributions-Tag `alpha`.
