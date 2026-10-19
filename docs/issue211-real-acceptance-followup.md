# Reale Folgeabnahme nach Tagesbericht 19.10.2026

Arbeitsgrundlagen sind ausschließlich die per GitHub-Metadaten als von
`fuchs-1978` verfasst bestätigten Issues dieses Repositories: [#211](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/211),
[#181](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/181),
[#60](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60),
[#7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7),
[#8](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8),
[#26](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/26) und separat
[#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166).
Code-Ausgangspunkt ist `72dee1bbbd9326fcc06d1d40cdcc1283f84a605b`.

Diese Bearbeitung verwendet den autorengeprüften Tagesbericht als Datenbasis.
Sie führt keinen neuen produktiven Historienabruf und keine Anlagenprüfung aus.
Die Aussagen unten sind daher Fortschreibung und konkrete nächste Prüfpunkte,
keine neue reale Abnahme. Der berichtete Score bleibt **71/100, Änderung 0**.

## Stand und Grenzen der Datenbasis

Das berichtete Fenster reicht vom 18.10.2026 19:56:43 bis 19.10.2026 19:56:43
Europe/Berlin. Alle erhaltenen Originale zeigen Master EIN; fehlende Abschnitte
bleiben unbekannt. Die vorgesehene Schattenpause ist kein Modellfehler.

Die berichtete Installation und Laufzeitanzeige waren alpha.109. Der genaue
installierte Commit ist nicht belegt. Insbesondere identifiziert die gleiche
Versionsnummer die Runtime aus PR #209 und die späteren Metadaten aus #210
nicht als identischen installierten Build. Vor einer späteren Folgeauswertung
sind tatsächliche Laufzeitversion und, soweit vorhanden, der Buildnachweis zu
erfassen. Diese Bearbeitung installiert oder aktiviert keine neue Version.

## Natürliche PV-Ladefälle und Stromruhe

Bei einem ohnehin auftretenden vergleichbaren Ladeabschnitt sind vollständige
Originale in einem begrenzten Ereignisfenster zu prüfen. Erforderlich sind:

- geordnete Sollstrombefehle, ACK-Wert/-Qualität/-Quellenzeit und elektrische
  L1–L3-/Leistungsantwort; Hausphasenzuordnung und lokale Gerätekanäle getrennt;
- ursprünglicher Befehls-/ACK-Zeitpunkt, ResponseState/ResponsePending,
  ausstehender gemessener Schritt und Reservierungen vor/nach seiner Bestätigung;
- zusammen qualifizierte SMA-/go-e-Quellen mit ihren individuellen Zeitpunkten,
  nicht lediglich dem SQL-Paketzeitpunkt;
- aktive Geräte-, Phasen-, Peer-, Hausanschluss-/LPC- und EHZ-Grenzen sowie
  Netzsoll, geltende Toleranz und tatsächlich genehmigte PV-Zuteilung;
- Wechselzahl und -abstände im belegten Ladeabschnitt, einschließlich echter
  notwendiger Reduktionen bei Import oder Lastsprung.

Eine erfolgreiche Software-Reproduktion ist kein Nachweis, dass jedes der
41 berichteten Ereignisse dieselbe Ursache hatte. Für die reale Folgeabnahme
muss eine bestätigte, finanzierte Aufnahme innerhalb der vorhandenen Toleranz
stabil bleiben, ohne eine offene Stellwirkung doppelt zu finanzieren oder eine
weitere Erhöhung ohne elektrische Fortschreibung zu erlauben. Keine künstlichen
Schaltversuche sind Bestandteil dieses Auftrags.

Die berichteten 0–0,3 Wh sind eine bedingte Abschätzung für einen engen gemeinsam
qualifizierten Ausschnitt. Weder Tagesobergrenze noch garantierte oder bereits
realisierte Einsparung sind daraus ableitbar. Regelruhe ist der primäre Nutzen.

## AUS, Phase und Zuständigkeit

Die EQV-Folge am 19.10. um 12:08 bleibt ungeklärt: OFF um 12:08:12.125,
erste passende Bestätigung erst 12:08:40.237, danach allow=1/26 A und positive
Leistung ohne eigenen EIN. Die Originale der Sitzung `1792402814793` um
seq15064/15167/15304 sind bei einem späteren lesenden Abgleich zusammen mit
Quellenzeit, Empfangsreihenfolge, ACK/q und vorhandenen Schreiberbelegen zu
betrachten. Das beweist weder einen zweiten Regler noch dessen Abwesenheit.
Die bereits vorhandenen Latch-/Mii-Isolationskorrekturen aus #199/#200 bleiben
erhalten; dieser Befund begründet hier keinen weiteren Stellcontrollerumbau.

Der natürliche EQE-3P→1P-Wechsel unter alpha.98 ist ein Teilnachweis:
Ziel 12:16:35.054, Modus-ACK 46.635, allow=0 46.642, Leistungsnull 46.830,
EMS-OFF 50.344, EIN 54.194 und volle 1P-Antwort 12:17:16.821.
Die 30,014 s Pause liegt innerhalb der berichteten Antwort-/Phasenfristen.
Der Status „extern entzogen“ muss anhand dieser Reihenfolge interpretiert
werden; fremde Freigaben dürfen nicht pauschal ignoriert werden.

Die skalaren EQE-Unterbrechungen um 16:42 liegen dagegen in der Recorderlücke.
Leistungsruhe ist beobachtet, eine historische ACK-/q-/Freigabekette fehlt.
Weder die genaue Stoppursache noch durchgehende historische Zuständigkeit kann
daraus rekonstruiert werden. Eine zeitnahe Warnung allein ersetzt diesen Beleg
nicht.

Master-Rückgabe, gegebenenfalls streng sequenzielle Fahrzeugübergabe und eine
aktive §14a-/LPC-Grenzreaktion bleiben real unbeobachtet. Eine Mii ohne positiven
Ladeblock ist kein Lasttest. Kein solcher Fall wurde für diesen Auftrag erzeugt.

## EHZ, Pumpe und unabhängiger Ausbau

Die erneut berichtete EHZ-Reservefreigabe unter alpha.109, zuletzt
17:39:10.134/seq12225 nach 20,116 s Nullnachweis, wird als Wiederholung des
vorhandenen Teilnachweises fortgeführt. Maßgeblich bleiben die Istregister
1074/1075/1076. Write-only 1000/NULL ist keine gemessene elektrische Null.
Neue positive Aufträge sind von alten, noch nicht freigebbaren Reservierungen
zu unterscheiden. Ein weiterer Nullfolgen-Fix wird hier nicht beauftragt.

Pumpe_V2 verwendet bereits die KNX-Schaltaktorrückmeldung 1/0/9. Ein fehlender
mechanischer Durchflussnachweis belegt keinen Pumpendefekt und begründet keinen
neuen Umbauauftrag.

BHKW ist bereits im SMA-Netzbudget enthalten und darf nicht nochmals addiert
werden. Der Ausbau aus #166 bleibt unabhängig: vorhandene Admin-/GZF-/Budget-
quellen wiederverwenden, tatsächliche Teilnehmer-/Eigenstrombilanz und reale
aktive LPC-Abnahme getrennt nachweisen. Diese Bearbeitung erweitert #166 nicht.

Die getrennte Recorderdiagnose und nächsten begrenzten SQL-Prüfpunkte stehen in
[issue211-recorder-diagnosis.md](issue211-recorder-diagnosis.md).
