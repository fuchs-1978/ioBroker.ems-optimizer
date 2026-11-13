# 0.17.0-alpha.255

Bei der Haushaltsentladung eines SunEnergy-Kopfs führte kurze Einspeisung während der AC-Leistungsanpassung zu Nullbefehlen und erneutem Netzbezug. In einem beobachteten Fall bestätigte der XT500 einen Auftrag von 125 W und lieferte bereits 80 W. Das EMS berechnete einen niedrigeren Sollwert von 54 W. Bei rund 31 W Einspeisung unterbrach es die Entladung.

Nach bestätigtem GS und einer dazu passenden frischen Netzmessung darf der Regler direkt reduzieren. Die aus Netzwert und AC-Entladeleistung berechnete Restlast begrenzt den kleineren Auftrag. Der Regler prüft sie vor dem Schreiben erneut. Bei einem vor der AC-Rückmeldung eingetroffenen Netzwert wartet er innerhalb der bestehenden Rückmeldefrist kurz auf eine neue Netzmessung. Bei fehlendem Bedarf, Richtungswechsel oder entfallener Freigabe greift der Nullbefehl.

Der Regressionstest prüft den direkten Übergang von 270 W auf 186 W und das anschließende Abschalten bei Wegfall der Restlast. Dieser Fix setzt beim Entladen an und verwendet das eingestellte Totband. Kleine Ladeaufträge bleiben Gegenstand von [Issue #410](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/410).
