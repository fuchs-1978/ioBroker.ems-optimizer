# 0.17.0-alpha.334

Am 25. November fiel der Gesamtpreis um 23 Uhr von 30,04 auf 23,56 ct/kWh. Der Fahrplan rechnete 5,14 kW für den Warmwasser-Heizstab ein, obwohl die preisbedingte Netzheizung deaktiviert und ihre Leistungsgrenze auf 0 W eingestellt war. In dieser Viertelstunde ergaben Hauslast und Wallboxen zusammen rund 2,71 kW.

Der Fahrplan prüft jetzt für jede Viertelstunde die Freigabe, die Tarifart, den ungerundeten Gesamtpreis und die erlaubte Netzleistung. Warmwasser und Heizpuffer teilen sich diese Leistung. Auch eine nachträgliche Verschiebung von Warmwasser in eine günstigere Viertelstunde muss in deren verbleibendes Budget passen. Die thermische Bilanz schreibt dem Speicher die eingeplante Wärme aus PV und freigegebenem Netzstrom gut. Bleibt Wärmebedarf offen, zeigt ihn die Diagnose.

Für den 26. November erwartete der Fahrplan um 13 Uhr 3.810 W PV, 1.316 W Hauslast und 1.125 W Warmwasserleistung. Die verbleibenden 1.369 W unterschritten das einphasige Fahrzeugminimum von 1.380 W. Nach Erreichen des 90-%-Zwischenziels wies der Plan die 1.369 W als Einspeisung aus. Die bestehende SunEnergy-Regelung kann diesen Rest in den Akku laden. Der Fahrplan berücksichtigt das jetzt nach der Zuteilung an die Verbraucher. Die Ladeleistung, die Hausanschlussgrenzen und die wirksame SoC-Obergrenze begrenzen die zusätzliche Ladung.

In `Plan.Allocation_48h_JSON` bezeichnet `thermalGridLimitW` das preislich freigegebene gemeinsame Netzbudget für Wärme und `dhwGridW` den für Warmwasser verwendeten Netzanteil. `batteryStageSurplusPvW` gibt die zusätzlich eingeplante PV-Ladeleistung nach Erreichen eines Zwischenziels an.
