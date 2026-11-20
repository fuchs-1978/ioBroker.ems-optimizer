# Alpha 305 – Wärmefahrplan bei aktiver Batterie-Prognosereserve

In [Tagesauswertung #483](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/483) blieb trotz Alpha 303 eine geplante Warmwasserspitze bestehen: Die gemeinsame PV-Wärmekorrektur war bei aktivem Prognose-SoC-Reservefahrplan vollständig ausgenommen.

Alpha 305 prüft eine Verschiebung der bereits geplanten Netz-Wärme zunächst separat. Für jedes geänderte Intervall wird die ursprüngliche Reserve-Ladeentscheidung mit dem ursprünglichen SoC und der geänderten thermischen Last erneut berechnet. Die PV- und Reserve-Netzladung müssen exakt erhalten bleiben; die verfügbare Leistung zur fristgerechten Reserveauffüllung darf nicht sinken. Bei einem Konflikt bleibt die ganze ursprüngliche Planung unverändert. Die bestehende Ausnahme für preisoptimierte Batterie-Käufe und Hochfenster bleibt bestehen.

Die übrigen Bedingungen von Alpha 303 gelten weiter: gleicher Wärmebedarf einschließlich modellierter Verluste, gleiche PV-Zuteilung, zulässiger Speicher-Kopfraum, zulässige Wärmeleistung und konservative Phasen-/Netzgrenzen. Die produktive Heizfreigabe und alle Echtzeitregler bleiben unverändert. `Plan.DHWThermalDiagnostics_JSON.gridHeatShift.batteryReservePreserved` kennzeichnet eine erfolgreiche Verschiebung mit überprüfter Prognosereserve.

Die gekoppelte Regression deckt einen aktiven Prognose-Reservefahrplan mit und ohne notwendige Netz-Auffüllung ab. Batterieleistung, SoC, SoC-Ziele und Reservezeitfenster müssen identisch bleiben; die Wärme- und Netzbilanz muss weiterhin stimmen. Fehlende Leistung für die Reserve, Verlust der Kapazität vor einer Frist, geänderte PV-Aufnahme und eine fehlgeschlagene Prüfung führen zum Rückfall auf den unveränderten Plan.

Die in #483 genannte Absenkung der Netzspitze von 8,722 auf 2,978 kW ist ein eingefrorener konditionaler Modellvergleich, keine garantierte reale Wirkung. Ein neuer Fahrplan nach Installation und seine elektrische Umsetzung sind getrennt zu prüfen.
