# 0.17.0-alpha.281

Die Ausgabeprüfung verwarf einen Entladeauftrag über 427 W, nachdem sich das Leistungsbudget geändert hatte. Der Kopf meldete GS und GP von 0 W. Der Vergleich mit dem verworfenen Sollwert löste eine dauerhafte Sperre aus.

Bei einem nachweislich vor der Übertragung verworfenen Auftrag stellt das EMS den vorherigen Auftrag und seine Reservierung wieder her. Ein freier Kopf wird mit dem nächsten gültigen Messwert erneut eingeplant. Ein gesendeter Stellwert kann aktiv bleiben, solange er in das neue Budget passt. Fällt das Budget für den laufenden Auftrag weg, wird der Ausgang zurückgegeben und nach bestätigtem Stillstand bei erneut gültigem Budget automatisch übernommen.

Die Tests decken den verworfenen 427-W-Auftrag aus dem Stillstand, eine abgelehnte Ladeerhöhung und den selbstständigen Wiederanlauf nach einer tatsächlichen Rückgabe ab. Die Schutzprüfung erkennt fremde GS-Aufträge anhand der Gerätedaten und der Schreibquelle.
