# 0.17.0-alpha.117 — Anbindung der Gruppen-Netz-/Eigenstrombilanz

## Funktion und bewusste Einrichtung

Alpha.116 enthielt den unabhängigen Bilanzkern für
[#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166) ohne
Produktivanbindung. Diese Version verbindet ihn mit dem produktiven Regler,
der gemeinsamen Leistungsverteilung und den unabhängigen Ausgangsprüfungen.
Bei ausdrücklich konfiguriertem `groupNet` kann belegte Eigenversorgung damit
tatsächlich zusätzliche Bruttoaufnahme der zugeordneten Teilnehmer erlauben.
Das Netzbudget allein ist weiterhin keine Freigabe für zusätzliche Preis- oder
Pflichtladung; bestehende Lade-, PV-, Temperatur- und Prioritätsregeln bleiben
zusätzlich erforderlich.

Unterstützt sind die vorhandenen Binärkontakt-Budgets `fixed`, `ems` und
`external`. Vorhandene Teilnehmer-/GZF-Berechnung und externe Gesamtbudgets
werden wiederverwendet; ein externes Gesamtbudget wird nicht nochmals mit GZF
erhöht. Normaler Haushaltsverbrauch und Nichtteilnehmer werden nicht pauschal
dem §14a-Teilbudget zugerechnet. PV, BHKW und Speicherwirkung im gemessenen NVP
werden nicht erneut addiert.

Die neue Betriebsart benötigt ausdrücklich deklarierte Gruppe und Messgrenze,
vollständige AC-Teilnehmermessungen, nachvollziehbare Gerätebindungen und eine
vollständige Erklärung des Speicherumfangs. NULL, unbekanntes `q`, fehlendes
ACK, alte oder zeitlich unpassende Originalquellen erzeugen keine positive
Freigabe. Mehrere Wallboxen und Speicher-/Heizgeräte teilen einen gemeinsamen
Nachweis; einzelne Vorschauen vergeben keinen mehrfach verwendbaren Eigenstrom.
Speicherentladung finanziert keine zusätzliche optionale Lade-/Heizaufnahme.

**Bestehende Installationen bleiben standardmäßig in `legacyGross`.**
Ein Update erzeugt keine Teilnehmer oder Messzuordnungen, erhöht keine alten
Limits und aktiviert weder Master noch Ausgänge. Die bewusste Einrichtung und
die erforderlichen Messverträge beschreibt
[issue166-runtime-integration.md](issue166-runtime-integration.md).
Es erfolgt keine automatische ioBroker-Installation oder Anlagenänderung.

## Unabhängige Schutzprüfungen und Reserven

- Leistungsverteilung und Wallboxausgänge prüfen Teilnehmergrenzen und eine
  gemeinsame quantisierte Vorschlagsmenge. Hausanschluss-, Phasen-, Geräte-
  und Startreserven bleiben zusätzlich wirksam.
- EHZ, Heizpuffer und Einzel-/Mehrkopf-Speicher prüfen ihre jeweilige Grenze
  vor einem positiven Auftrag. Nach Schreibwartezeiten werden aktuelle Quellen,
  Budgets und vorhandene Reservierungen erneut geprüft.
- Bestehende High-Water-Reserven bleiben nach einer Reduktionsanforderung bis
  zum bereits vorgesehenen elektrischen Nachweis erhalten. Befehle, ACKs und
  veröffentlichte Zielbudgets gelten nicht als erzeugter Eigenstrom.
- Noch nicht zurückgegebene frühere Speicherausgänge dürfen nach Neustart oder
  Zuordnungswechsel nicht aus der AC-Abdeckung verschwinden. Gegenläufige Köpfe
  behalten getrennte Lade-/Entladeanteile.
- Sicherheitsnull bleibt möglich. Mindestlaufzeiten, Antwortfristen,
  Master-/Wiederanlauf-/Shutdownschutz und Recorder-/SQL-Durabilität werden
  durch die neue Budgetautorität nicht ersetzt.

## LPC bleibt offen

Die offiziellen BNetzA- und VDE-Quellen wurden erneut erfolgreich geprüft.
Die EEBUS-Website ist jetzt ebenfalls erreichbar. Ihr offizielles Verzeichnis
nennt LPC Technical Specification 1.0.0, Implementation Guideline 1.1.0 und
High Level Test Specification 1.0.2. Die normativen Downloads verlangen einen
Account/Login; ihre Inhalte und der tatsächlich verwendete Endpunktvertrag
sind nicht verifiziert.

Deshalb sperren **alle konfigurierten LPC-Eingänge den neuen Gruppenmodus**.
Auch ein vom bisherigen Parser als „unlimited“ erkannter Wert dient nicht als
Beweis eines ungeprüften LPC-Vertrags. Der vorhandene konservative LPC-Pfad
bleibt im bisherigen Bruttomodus erhalten. LPC-Zuordnungen sollen nicht allein
zum Umgehen dieser Sperre gelöscht werden. #166 ist hinsichtlich der noch
offenen LPC-Integration und realen Abnahme weiterhin nicht vollständig erledigt.

## Softwareprüfung und reale Folgeabnahme

Die 159 reinen Bilanzregressionen aus alpha.116 bleiben erhalten. Neue gezielte
Tests prüfen die aktive Verbindung vom Originalmesswert über die Zuteilung bis
zum modellierten Stellbefehl, gemeinsame Reservierungen, Quellenverlust nach
Zuteilung und während echter Schreibwartezeiten, passive WP-/Zusatzlasten,
Speicher in beiden Richtungen, frühere Ausgangsansprüche sowie Migration.
Lokal sind unter Node 22.23.3 und 24.19.0 jeweils **2.715 Tests** ohne Fehler
oder übersprungene Fälle erfolgreich, einschließlich **166 neuer Fälle**.
Paketprüfung und tatsächliche isolierte Installation des alpha.117-Tarballs
bestehen ebenfalls: 200 Dateien, 719 States; der installierte produktive Loader
führt die aktive Gruppenprüfung aus. Die unveränderten historischen Vergleiche
bestehen. Ein zusätzlicher direkter Vergleich zum alpha.116-Ausgangsbaum belegt
jeweils 19 Szenarien mit 342.308 identischen geordneten Beobachtungen im
bisherigen Betriebsmodus. Exakte CI-/Commit-/PR-Nachweise werden vor Merge und
Veröffentlichung geprüft und im PR/GitHub-Release dokumentiert.

Diese Tests sind keine reale Betriebsabnahme. Es gab keine künstlichen
Anlagenversuche, produktiven Konfigurationsänderungen, zusätzliche SQL-Lasttests
oder automatische Installation. Recorder-/Zugriffsdiagnosen aus #220 und die
offene reale EHZ-/Reglerabnahme begründen keinen zusätzlichen Fix in diesem
Release.

Bei natürlichen Lastfällen sind aktive Grenze, Teilnehmer-/Messumfang,
Eigenstrom-/Netz-/Bruttobilanz, Originalzeiten und Qualität sowie Sollbefehle,
ACKs und elektrische Antwort zusammenhängend in SQL zu prüfen. Recorder-
Originalbestätigungen, Sequenz-/Sample-Verluste, Queue-/Journalbytes,
unbestätigte Records und `expiry`/`expiredUnconfirmed` bleiben getrennt.
Fehlende historische Abschnitte bleiben unbekannt. Es gibt keine zugesagte
Energieeinsparung oder einen erwarteten Scorebonus.
