# 0.17.0-alpha.118 — Konservativer Rückfall bei zeitversetzten Gruppenmessungen

## Befund und Umfang

Die Bestandsprüfung von alpha.117 zeigte: Der Gruppenmodus liest je Quelle
den neuesten Originalwert. Er synchronisiert weder SMA noch Wallboxen. Bei
aktivem Binärkontakt führte ein Quellenversatz über der konfigurierten Grenze
zu einer ungültigen Bilanz und damit zum Verlust positiver Zuteilungen.
Bei der lesenden Anlagenprüfung lagen die Quellen beispielsweise 3.469 ms
auseinander. Dieser Einzelabruf ist kein Tagesverlauf oder Synchronitätsnachweis.

Frische, vollständig deklarierte, bestätigte und qualitätsgültige Quellen dürfen
nun trotz Versatz die gemeinsame **Bruttogrenze in Höhe des Netzbudgets** nutzen.
Es gibt dabei **keinen Eigenstromzuschlag**. Originalwerte und Originalzeiten
bleiben erhalten. `accountingBasis=gross-only-asynchronous` und
`observation.coherent=false` markieren den Rückfall samt tatsächlichem Versatz.
`siteNetW`, `actualGroupNetW`, `rawOwnAvailableW` und `ownUsedW` bleiben dann
`null`: Aus versetzten Einzelmessungen wird kein gemessener zeitgleicher
Netz-/Eigenstromanteil erfunden. Die angezeigte Bruttoaufnahme ist in diesem
Fall nur die Summe der neuesten Einzelbeobachtungen, keine synchrone Messung.

Die unveränderten gemeinsamen Auftrags-/High-Water-Reserven begrenzen jeden
Vorschlag und Ausgang. Ein niedrigerer Sollwert gibt noch keine elektrische
Reserve frei. Bei wieder zeitlich passenden Originalquellen wird ausschließlich
deren aktuelle Bilanz ausgewertet; ein früherer Eigenstrombonus wird nicht
gespeichert oder nach einem Erzeugungsabfall wiederverwendet. Auch die Zeiten
aller Originalkomponenten von Heizphasen-/Speichersummen gehen in die Prüfung
ein; ein Summenzeitstempel kann neuere Komponenten nicht verstecken.

Fehlende, veraltete, zukünftige, unbestätigte oder qualitätsfehlerhafte Quellen,
unvollständige Messgrenzen und ungeprüfte LPC-Verträge bleiben gesperrt.
Die bisherigen Grenzen für Quellenalter und Eigenstrom-Zeitversatz werden
nicht erhöht. Es gibt keine neue Netzladeberechtigung: PV-/Preis-/SoC-Regeln,
Startbedingungen, Phasen-/Hausanschlussschutz und Ausgangsfreigaben bleiben
zusätzlich erforderlich. Inaktiver Kontakt und `legacyGross` bleiben unverändert.

## Bewusste Grenze und Einrichtung

Diese Korrektur löst die pauschale Nullzuteilung allein wegen Zeitversatz.
Sie macht asynchron abgefragte Geräte **nicht synchron** und ermöglicht bei
solchen Daten noch keinen belastbaren zusätzlichen Eigenstrombezug. Eine
historische Pufferauswahl oder künstliche Aktualisierung alter Zeitstempel
wird ausdrücklich nicht als aktuelle Erzeugungsmessung verwendet.

Der Gruppenmodus bleibt eine bewusste Einrichtung mit vollständiger Gruppe,
Messgrenze und Speichererklärung. Keine automatische Konfigurationsänderung,
Installation oder Aktorbetätigung. Die bestehenden Werte 30 s / 0 ms bleiben
erhalten; bei nicht identischen Originalzeiten gilt dann der beschriebene
Bruttorückfall. Die vorhandene GZF-/Budgetquellenberechnung wird wiederverwendet.
#166 bleibt hinsichtlich LPC und tatsächlicher Betriebsabnahme offen.

Die offizielle BNetzA-Verbraucherinformation wurde am 22.10.2026 erneut gelesen:
https://www.bundesnetzagentur.de/DE/Vportal/Energie/SteuerbareVBE/artikel.html
Sie trennt Netzbezug und Eigenversorgung; der konservative Bruttorückfall ist
eine technische Schutzstrategie des Adapters, keine neue regulatorische Formel.

## Prüfung

Regressionen prüfen reale Regler-/Ausgangsaufrufe bei 5-s-Versatz, Entzug eines
vorherigen Eigenstromzuschlags, gemeinsame Reserven mehrerer Verbraucher,
fehlende/alte/fehlerhafte Quellen, Erzeugungseinbruch und Originalzeiten hinter
Summenwerten. Die strikte Standardprüfung des unabhängigen Bilanzkerns bleibt
erhalten; der neue Rückfall wird dort ausdrücklich angefordert.

Unter Node 24.19.0 bestehen 2.727 Tests sowie Paketprüfung und isolierte
Installation des alpha.118-Tarballs (201 Dateien, 719 States). Der installierte
Loader prüft auch den asynchronen Bruttorückfall. Der unveränderte historische
Verhaltensvergleich besteht. Node-22- und GitHub-CI-Ergebnisse werden im PR
am exakten Commit dokumentiert.
Softwareprüfungen ersetzen keine natürliche aktive §14a-Anlagenabnahme.
Keine zusätzliche SQL-Historienabfrage, Pollingänderung oder Lastprüfung.
