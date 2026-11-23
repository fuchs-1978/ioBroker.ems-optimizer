# Alpha 327 – Vorausschauender Mindeststrom bei späterem PV-Überschuss

Der koordinierte SunEnergy-Fahrplan kann auch einem noch nicht ladenden, verbundenen und freigegebenen Fahrzeug den einphasigen Mindeststrom zuweisen, wenn gegenwärtige PV den Mindeststrom samt Startreserve deckt und die dadurch verschobene Speicherladung vollständig durch später bereits prognostizierte Einspeisung wieder aufgeholt wird. Die Endenergie des Speichers bleibt im Modell erhalten; es wird keine zusätzliche Batterieentladung oder Netzladung angenommen.

Der Vergleich zum Tagesissue [#515](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/515) verwendet einen eingefrorenen Rest-PV-Verlauf nach Haus- und Wärmebedarf von 1871, 846 und 758 W. Aus einer vorherigen Batteriesollleistung von 1522 W werden im ersten Viertelstundenintervall 1380 W Fahrzeugladung und 491 W Batterieladung. Die später nachgeholten 257,75 Wh an AC-Batterieladung erhalten im Modell den End-SoC. Das ist kein Nachweis einer realen Einsparung.

Die bestehende Mindest-SoC-, Phasen-, Leistungs- und Anschlussfreigabe sowie Preis- und Wärmepflichten bleiben unangetastet. Der neue Planungsfall erteilt keine neue Live-Startberechtigung; insbesondere wird die bestehende Regel für batteriegestützte 6-A-Ladung während aktiver Wärmeversorgung nicht aufgehoben. Eine spätere reale Wirkung muss separat nachgewiesen werden.
