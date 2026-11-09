# 0.17.0-alpha.213

- Nach einem erfolgreichen SQL-Lauf speichert der Adapter geprüfte Viertelstunden im eigenen Instanzverzeichnis. Beim nächsten Start kann er daraus sofort einen aktuellen Fahrplan berechnen. SQL ergänzt die jüngsten Viertelstunden und noch offene Zeitfenster im Hintergrund.
- Der Cache muss zu SQL-Instanz, Quellen, Aufzeichnungseinstellungen, Zeitfenster und Profilmethode passen. Er darf höchstens 36 Stunden alt sein. Ein fehlender oder unbrauchbarer Cache führt zum normalen SQL-Neuaufbau. Spätestens beim nächsten Historienlauf nach sieben Tagen werden auch ältere Viertelstunden neu eingelesen.
- Ausgewählte Wallbox-Anzeigen werden bei Wertänderung veröffentlicht. Steuerdaten, Freigaben, Rückmeldungen und Zeitstempel für Sicherheitsprüfungen werden weiter wie bisher verarbeitet.
- Die Echtzeitregelung liest Fahrplan-JSON bei einer Änderung des Inhalts neu ein. Sie prüft Gültigkeit und Zeitfenster weiterhin bei jedem Zugriff.
