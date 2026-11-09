# 0.17.0-alpha.225

- Wenn das rollierende SQL-Historienfenster weiterrückt, begrenzt der Startcache die zum erneuten Abruf vorgemerkten Datenlücken auf den gültigen Zeitraum. Dadurch bleibt der Cache auch über mehrere Neustarts nutzbar.
- Beim Einlesen älterer Snapshots werden vor dem gespeicherten Zeitfenster liegende Abschnitte der Abrufintervalle abgeschnitten. Alter, Konfiguration, Datenzeilen und Vollständigkeit des Profils werden weiterhin geprüft.
- Im Regressionstest steht das Profil bei drei aufeinanderfolgenden Starts vor der SQL-Aktualisierung bereit. SQL liest pro Start vier Teilfenster. Vor der Korrektur löste der zweite Start einen vollständigen Abruf mit 42 Teilfenstern aus.
