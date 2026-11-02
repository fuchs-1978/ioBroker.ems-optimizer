# 0.17.0-alpha.189 – Prioritätsübergabe ohne erneute Startwartezeit

Bei einem manuellen Prioritätswechsel zwischen Fahrzeugen muss eine bereits erfolgreich gestartete Ladung nicht nochmals die normale Startqualifikation durchlaufen. Bisher wurde diese Qualifikation bei einer Leistungsdelle während der Übergabe endgültig verworfen. Mit der Rückkehr ausreichender Leistung begann dann beispielsweise erneut eine Wartezeit von 300 Sekunden.

## Ablauf

- Das EMS muss die laufende, eigene Ladung im aktuellen Prozess positiv beobachtet haben. Gespeicherte Aktivitätsflags allein reichen nicht; eine tatsächlich abgeschlossene und unabhängig bestätigte Übernahme nach Neustart bleibt nach dem bestehenden Vertrag möglich.
- Bei einem bewussten Prioritätswechsel kann der bisherige optionale Ladevorgang auch während einer vorübergehenden Leistungsdelle seine Freigabe abgeben. Seine Mindestlaufzeit und normale Ausschaltverzögerung verzögern diese kontrollierte Übergabe nicht. Ein Fahrzeug mit geschützter Mindestladung bleibt geschützt.
- Die reale und ausstehende Leistung des bisherigen Fahrzeugs bleibt reserviert, bis frisches AUS-ACK und unabhängige elektrische Ruhe sowie freigegebene Ausgangsverantwortung vorliegen. Eine Nullvorgabe allein gibt kein Budget frei.
- Das neue Fahrzeug benötigt die Mindestleistung seiner bestätigten Topologie, bei 6 A und einer Phase nominal 1.380 W. Es benötigt keine zweite Startreserve und keinen neuen Startcountdown. Strom-, Phasen- und Freigabebestätigungen bleiben notwendig.
- Reicht das aktuelle Budget noch nicht, zeigt die Startdiagnose `handoff-budget-pending`. Die übernommene Startqualifikation bleibt innerhalb der bereits bestehenden festen Übergabefrist erhalten. Sobald genug Leistung vorhanden und die restlichen Prüfungen abgeschlossen sind, kann der Ausgang starten. Die Frist wird durch Leistungsschwankungen nicht verlängert und beträgt höchstens fünf Minuten ab Vorbereitung.
- Optionaler Heizstabverbrauch muss weiterhin vor dem Fahrzeugstart nachweisbar reduziert werden. Die hypothetisch zurückholbare Heizleistung ist kein sofort nutzbares Ausgangsbudget.

## Grenzen

Ungültige/veraltete Quellen, verlorene Freigabe, geänderte Auswahl, nicht mehr zulässiges Fahrzeug, geänderte Preis-/Phasenbasis, unzureichende harte Kapazität, abgelaufene Übergabefrist oder ein Reglerreset entwerten die jeweilige Qualifikation weiterhin. Ein späterer normaler Kaltstart erhält sie nicht zurück. Paralleles Hinzustarten eines zusätzlichen Fahrzeugs bei ausreichend freier Leistung behält seine normale Startqualifikation. Automatische Übergaben bei Ziel-SoC/Abstecken und der sequentielle Betriebszweig behalten ihre bisherigen Regeln.

Die Änderung erlaubt keinen Start unterhalb der Mindestleistung und keinen zusätzlichen Netzbezug. Die bestehende Netzbezugs-Toleranz laufender Fahrzeuge wird nicht auf einen ungestarteten Empfänger übertragen. Alle Haushalts-, Gruppen-, Netzbetreiber-, Phasen- und Ausgangslimits sowie echten Reservierungen bleiben bindend. Die reine Startqualifikation ist laufzeitgebunden und wird nicht als Berechtigung über einen Neustart gespeichert.

## Prüfung und Nutzung

Gezielte Tests prüfen den Fall EQE → EQV bei 1.270 W und anschließender Rückkehr auf 1.380 W ohne erneuten Countdown. Deterministische Anlagenprüfungen verwenden den echten Regler und die Ausgangszustandsmaschinen, verzögerte ACKs und verzögertes physisches Abschalten. Sie prüfen beide Bilanzmodi, kurzfristigen Leistungseinbruch, Mindestleistung ohne neue Startreserve, zeitlichen Ablauf, fehlende Doppelbelegung und Entwertung durch harte Grenzen, ungültige Messwerte, Freigabe, Preisänderung und Reset. Weitere bestehende Tests prüfen unter anderem fehlendes AUS-ACK, fehlerhafte Ruhestromwerte, Phasenbestätigung und geschützte Mindestladungen.

Keine neue Einstellung erforderlich. Carsten installiert die versionierte Fassung selbst. Softwaretests ersetzen die reale Abnahme der nächsten natürlichen Fahrzeugübergabe nicht.
