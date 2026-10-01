# Preisoptimiertes Netzladen ab alpha.25

Speicher und Fahrzeuge können zusätzlich zum PV-Laden Energie aus dem Netz
beziehen, wenn der Fahrplan dafür ein günstiges Ladefenster vorsieht. Der
Fahrplan berechnet Viertelstunden; die tatsächliche Leistungsregelung arbeitet
weiterhin im Sekundenbereich und prüft die Netzladefreigabe erneut.

## Preise und Freigaben

Entscheidend ist der **Gesamtarbeitspreis in ct/kWh brutto**, einschließlich
Netzentgelt und konfigurierter Aufschläge. Fester Energiepreis zusammen mit
zeitabhängigem Netzentgelt genügt. Ein dynamischer Börsentarif ist nicht
erforderlich. Die Preisquellen werden wie unter
[Tarife und Preisquellen](prices-and-tariffs.md) eingerichtet.

Preisoptimiertes Netzladen wird für den Speicher und für jede Wallbox separat
freigegeben. Bei der erstmaligen Einrichtung sind diese Freigaben aus;
bereits gesetzte Freigaben bleiben bei einem Update erhalten.
Zusätzlich gelten weiterhin die Gerätefreigaben, der globale Schreibschalter,
die Produktionsfreigaben und die vorhandenen Ausgangs- und Messwertprüfungen.
Das Update schaltet keine Geräte ein.

Eine Preisobergrenze ist je Gerät möglich. `0` bedeutet keine zusätzliche
Obergrenze. Negative Preisgrenzen sind zulässig. Diese Grenze betrifft das
preisoptimierte Netzladen; vorhandene Pflichtladegründe wie Mindest-SoC oder
manueller Mindeststrom bleiben eigenständig.

| Admin-Bereich | Neue Einstellungen |
|---|---|
| Preise & Tarife | Preisfenster für Netzladung, Vorgabe 24 Stunden; Ladeblockdauer, Vorgabe 30 Minuten |
| Speicher | Preisladung erlauben, Preisobergrenze, Mindestersparnis nach Verlusten, zusätzliche Reserve |
| Je Wallbox | Preisladung erlauben, Preisobergrenze, AC-Energiemenge bei fehlendem SoC |

## Fahrzeuge

Der Plan zieht die erwartete nutzbare PV-Energie vom Ladebedarf ab und verteilt
den verbleibenden Bedarf auf günstige verfügbare Ladeblöcke. Die Fahrzeuge laden
weiterhin nacheinander. Mindest-SoC, Freigaben, Fahrzeugprioritäten,
Phasenstellung und Stromgrenzen bleiben maßgeblich.

Mit gültigem Fahrzeug-SoC ergibt sich der Bedarf aus Kapazität und Ziel-SoC,
einschließlich des eingestellten Ladewirkungsgrads. Ohne SoC kann eine
**AC-Energiemenge pro Steckvorgang** vorgegeben werden. Die tatsächlich gemessene
Ladeenergie, auch aus PV, reduziert dieses Budget. Ein Plan-Neuaufbau oder
Adapterneustart erneuert das Budget nicht. Ohne SoC und ohne vorgegebene
Energiemenge entsteht kein preisabhängiger Netzladeauftrag.

Zwischen zwei SoC-Rückmeldungen wird bereits gemessene Ladeenergie vom Bedarf
abgezogen. Ein unveränderter älterer SoC darf dadurch bei einer Neuplanung kein
neues Netzladebudget erzeugen. Fällt eine zuvor vorhandene SoC-Rückmeldung aus,
wechselt diese Sitzung nicht automatisch auf ein manuelles Ersatzbudget.

Bei einer Lücke in der Leistungserfassung wird ein manuelles Budget nicht
geschätzt oder neu aufgefüllt. Die Sitzung meldet den Grund; erneutes
Abstecken und Anstecken beginnt eine neue Sitzung. Sehr kleine Restmengen
dürfen einen kürzeren letzten Ladeblock ergeben.

**Ab alpha.26 berücksichtigt ein Fahrzeug ohne feste Abfahrtszeit die nutzbare
PV der gesamten kommenden 48 Stunden.** Reicht diese für sein Ladeziel, wird
keine zusätzliche preisabhängige Netzladung geplant. Reicht sie nur teilweise,
wird ausschließlich der verbleibende Bedarf auf günstige Netzladeblöcke verteilt.
Die vorgeschaltete PV-Verteilung berücksichtigt die Fahrzeugprioritäten und
das nacheinander erfolgende Laden; derselbe PV-Überschuss wird nicht mehreren
Autos zugesagt. Mindest-SoC und manuelle Pflichtladegründe bleiben verbindlich.

Das **Preisfenster für Netzladung** (Vorgabe 24 Stunden) begrenzt die Suche nach
kaufbaren Preisblöcken. Es ist keine Frist, bis zu der ein Auto ohne Abfahrt voll
sein muss. Seine PV-Vorschau umfasst unabhängig davon bis zu 48 Stunden und
wandert bei jeder Neuplanung mit. Eine aktivierte echte Abfahrt ist dagegen
eine feste Frist: Nur vorher nutzbare PV reduziert dann den Netzladebedarf.
Eine abgelaufene Abfahrt wird innerhalb derselben Sitzung nicht automatisch
auf den nächsten Tag verschoben.

Bereits angeschlossene Fahrzeuge übernehmen die flexible Vorschau beim Update
von alpha.25, ohne Abstecken. Session-ID, gemessene Ladeenergie, SoC-Bezug und
eventuelle Messfehler bleiben erhalten. Auch ein manuelles Budget ohne SoC
wird durch die rollierende Vorschau oder einen Neustart nicht erneuert.

Beispiel: Heute bleibt ein Ladebedarf von 18 kWh, morgen ist ausreichend
zugeteilter PV-Überschuss verfügbar. Ohne feste Abfahrt wartet das Auto auf die
PV, selbst wenn heute Nacht günstiger Netzstrom angeboten wird. Bei einer
Abfahrt morgen früh muss die fehlende Energie dagegen vorher geladen werden.
Fehlende Preise, fehlende Leistung oder Gerätesperren können eine vollständige
Ladung verhindern; unbekannte Preisfenster werden nicht als billig behandelt.

## Speicher

Der Plan berücksichtigt Hausverbrauch, nutzbare Rest-PV, Mindest-SoC und
Speichergrenzen. Fehlende Energie wird in vorhergehenden günstigen Zeitfenstern
nachgeladen. Erwartete PV und bereits vorhandene Energie verringern den
Netzladebedarf. Die bekannten SoC-Ziele bleiben Teil der Planung.

Die Wirtschaftlichkeitsprüfung berücksichtigt Lade- und Entladeverluste sowie
eine einstellbare Mindestersparnis. Ein niedriger Preis allein ist kein Anlass,
den Speicher unabhängig vom späteren Bedarf vollständig aus dem Netz zu laden.
Geplante Reserven verhindern, dass günstig geladene Energie schon vor ihrem
vorgesehenen Einsatz verbraucht wird.

Die zusätzliche Reserve oberhalb des Mindest-SoC wird aus vorhandener Energie
und PV aufgebaut. Sie löst allein keine unwirtschaftliche Netzladung aus.
Das Auffüllen auf ein SoC-Stufenziel rechtfertigt ebenfalls keine Netzladung
ohne einen nutzbaren späteren Verbrauch und ausreichende Ersparnis.

## Tatsächliche Ausführung

Nur ausdrücklich markierte Netzladeaufträge aus dem aktuellen Fahrplanfenster
dürfen zusätzliche Netzleistung anfordern. Der Regler prüft dazu den aktuell
gültigen Gesamtpreis. Eine fehlende Preisangabe oder eine Überschreitung der
Preisgrenze entzieht die preisabhängige Netzladefreigabe.

§14a/LPC, Hausanschlussgrenzen und die gemeinsamen Leistungsbudgets gelten auch
während günstiger Ladefenster. Eine Wallbox kann nur mit ihren realen Mindest-
und Maximalströmen laden. Der Speicher soll einen absichtlich aus dem Netz
ladenden Verbraucher nicht gleichzeitig durch Entladung versorgen.

Die Fahrpläne und ihre Erläuterungen zeigen die geplanten Ladeaufträge. Erst
die gemessenen Leistungen belegen deren tatsächliche Ausführung. Bei fehlender
Schreibfreigabe bleibt die Berechnung als Vorschau nutzbar.

`Plan.PriceChargingStatus` und `Plan.PriceChargingDiagnostics_JSON` nennen
Bedarf, eingeplante Netzenergie und Gründe für ausbleibende Ladefenster.
`Vehicles.WallboxN.PriceSessionStatus`, `PriceChargedEnergy_kWh` und
`PriceRemainingEnergy_kWh` erläutern die jeweilige Fahrzeug-Sitzung.
`Control.BatteryPriceGridCharge_W` und `Control.WallboxNPriceGridCharge_W`
zeigen die aktuell zugeteilte Netzladeleistung. `N` steht für 0, 1 oder 2.
