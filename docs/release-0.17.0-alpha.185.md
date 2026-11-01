# 0.17.0-alpha.185 – Startbudget und Fortsetzung nach Fehler 5

Ein bereits rechtzeitig bestätigtes AUS wird vor der Budgetprüfung ausgewertet. Beim Warten auf Startbudget läuft deshalb kein Rückmelde-Timeout mehr gegen den falschen Sollstrom. Fehlende oder verspätete AUS-Bestätigung bleibt ein Fehler. Der Budgetwartepfad ist auf fünf Minuten begrenzt und wird weiterhin durch Gerätefehler und Schutzbedingungen abgebrochen.

Eine tatsächlich beobachtete Ladung mit mehr als 500 W kann bei Gerätefehler 5 einen einmaligen Fortsetzungsnachweis erhalten. Nach frischem Fehlerstatus 0 und bestätigtem Stillstand entfällt damit die erneute 300-Sekunden-Startwartezeit. Der Nachweis gilt höchstens 15 Minuten, wird nicht durch wiederholte Fehlermeldungen verlängert und nach erfolgreichem Start verbraucht. Abstecken, andere Fehler, Freigabeverlust, geänderte Ladesitzung und Adapter-Neustart verwerfen ihn.

Die Fortsetzung benötigt bestätigtes AUS, frische Leistungs- und Strommessungen ohne Last, gültige Quellen, SoC unter Ziel, passende Phasen und ausreichendes Mindestbudget. Hausanschluss-, Gruppen- und übrige Schutzprüfungen bleiben wirksam. Ein kalter Start mit Fehler 5 erzeugt keinen Nachweis. Das EMS quittiert den Gerätefehler nicht automatisch.

Regressionstests prüfen die bestätigte AUS-Budgetwartephase einschließlich Zeitablauf, fehlender Bestätigung und Schutzabbruch sowie Erzeugung, Verfall und Verbrauchsvoraussetzungen des Fehler-5-Nachweises. Eine zuvor bereits verriegelte Rückmeldestörung wird durch diese Änderung nicht im laufenden Adapter zurückgesetzt. Installation und Neustart erfolgen durch den Nutzer.
