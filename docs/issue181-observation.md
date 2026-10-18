# Ziele 2/3 aus #181: EHZ, reale Abnahme und SMA-Quellen

Begleitende lesende Prüfung zu [Tagesbericht #181 vom 18.10.2026](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/181)
und [Arbeitsauftrag #169](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/169).
Die Beobachtungen begründen keinen eigenen Reglerfix oder Release. Die begrenzte
Recorder-Diagnoseverbesserung aus Ziel 1 wird getrennt bewertet; sie beseitigt
weder die hier offenen Abnahmen noch eine bislang ungeklärte Quellenursache.

## Prüfgrundlage und Grenzen

Zuerst wurden #181, [PR #170](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/170)
und Quelldateien über den GitHub-Connector gelesen. Alle nachfolgenden EMS-Codelinks
beziehen sich auf den im Tagesbericht geprüften Commit
[`c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8),
Version alpha.95. Diese Prüfung ist kein erneuter vollständiger Tagesabruf.

Zusätzlich erfolgten zehn gezielte ioBroker-Objektlesungen: EMS-Instanz,
SMA-Instanz, fünf SMA-Quellen und drei EHZ-Ausgangsregister. Ein gemeinsamer
State-Leseaufruf prüfte sieben aktuelle Zustände. Dabei wurden ausschließlich
die für diese Diagnose nötigen Versions-, Zuordnungs- und Messmetadaten
ausgewertet; private Konfigurationen und Gerätekennungen werden hier nicht
veröffentlicht. Der aktuelle SMA-Quellenstand lag um **18.10.2026 19:12:11 UTC /
21:12:11 Europe/Berlin**, also außerhalb des Tagesfensters. EMS-Installationsobjekt
und Laufzeitstate meldeten alpha.95; Master war EIN. Diese aktuellen Zustände
beweisen keine historische Zuordnung, Qualität oder Anlagenkonfiguration um 18:36.
Der State-Connector gibt hier `id/value/ack/ts` und teilweise `lc` zurück, jedoch
kein `q` oder `from`; daraus wird keine neue Aussage `q=0` oder zur Herkunft
eines einzelnen aktuellen Updates abgeleitet.

Keine SQL-Abfrage, keine Änderung an ioBroker, SMA, Skripten, Aufzeichnung,
Freigaben oder Aktoren; keine künstlichen Schaltversuche. Die unten beschriebenen
Softwarefälle wurden von realen Betriebsbelegen getrennt behandelt.

## EHZ: vorhandene Korrektur und offene reale Nachweise

PR #170/alpha.85 ist übernommen. In
[`heaterConfirmedZeroPlateau()`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/lib/engine/dhw-output.js#L157)
identifiziert die ununterbrochene Nullfolge das Plateau; ein vollständig
zugeordneter Nullrefresh verschiebt dessen Beginn nicht ständig. Der neueste
Transport-/Resetbeleg und danach neue gültige Proben aller drei realen Phasen
bleiben nötig. Gezählt werden mindestens drei unabhängig fortgeschrittene
Probensätze über mindestens 15 s beziehungsweise die längere konfigurierte Frist.
Ein offener Refresh pausiert; positive Wirkung, ungültige Quellen, Zeitrücklauf,
große Probenlücken und Zuordnungswechsel unterbrechen den Nachweis.
[`lastReleaseProof`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/lib/engine/dhw-output.js#L282)
enthält den jüngsten Receipt und den Beginn `zeroEpisode` getrennt.

Die vorhandenen
[`ehz-production-tick`-Regressionen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/test/ehz-production-tick.test.js)
decken produktiven 5-s-Schreibtakt, längere Frist, offenen Transport, fehlenden
oder fremden Reset, Transportfehler, verzögerte positive Wirkung, NULL-Istwert,
Qualitätsfehler, stehende Zeitstempel, große Quellenlücke, Mappingwechsel und
neuen Prozess ab. Für diese lesende Teilprüfung wurden sie geprüft, nicht erneut
ausgeführt; aktuelle Test-/CI-Nachweise des Recorder-PR sind separat anzugeben.

Die sieben neuen Freigaben am 18.10., einschließlich des letzten Nachweises mit
fünf unabhängigen Dreiphasensätzen über 20,227 s, sind die datierten realen
Teilnachweise aus #181. Sie wurden hier nicht erneut aus SQL rekonstruiert.
Ein neuer positiver Auftrag nach gültiger Freigabe erzeugt eine neue Reserve.
Weitere natürliche Heiz-/Stoppfolgen mit verzögerter Wirkung, NULL-/ACK-/
Qualitätswechseln und neuen Sitzungen bleiben zu beobachten.

Das Write-only-Sollregister `1000_Power` und sein NULL-Reset sind keine
Istleistung. Maßgeblich sind die drei unabhängigen Ausgangsleistungsregister
1074/1075/1076. Deren aktuelle Objektmetadaten haben eine leere Einheit; der
Wattvertrag folgt hier dem vorhandenen Mapping-/Code- und Betriebsnachweis,
nicht einer unabhängig bestätigten Einheitenbeschriftung dieser Objekte.

Die Pumpen-/Durchflusskette bleibt offen: #181 beschreibt die aktive,
Istspiegel-gesteuerte Pumpe_V2 und die nur loggende 5-s-Korrekturfunktion.
Ohne historische Pumpen-/Durchflussreihe und Vorlaufnachweis folgt daraus weder
eine erfolgreiche Abnahme noch ein belegter Durchflussfehler. Diese Prüfung hat
keine Pumpenhistorie erzeugt und begründet keinen zusätzlichen Schutzumbau.

## Wallboxen und alpha.95: Beobachtung statt erneuter Korrektur

Aus #181 gelten der beobachtete EQV-Ladeblock, das Mindest-SoC-Ende sowie der
EQE-Start als reale Teilnachweise. Der bewusste Parallelmodus ist keine streng
sequenzielle Übergabeabnahme. Fehlende Records und Sitzungsgrenzen bleiben
unbeobachtet; aktuelle Mindest-SoC-/Zielwerte dürfen nicht rückwirkend gelten.

Die schnellen EQV-Stromrichtungswechsel entstanden vor alpha.95. Strompendeln
ist kein Freigabestopp. Die bereits umgesetzte PV-Zulassung verwendet getrennt
100 W Hold-Spielraum und bei dieser Einstellung 80 W Admission; siehe
[`pvImportAdmissionW()`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/lib/grid-constraints.js#L147)
und den
[`IncreaseBudget_JSON`-Pfad](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/lib/wallbox-output.js#L1864).
Im Tagesfenster gab es unter alpha.95 keinen vergleichbaren neuen
PV-Stromerhöhungsfall. Deshalb keine reale Regelruheabnahme aus Veröffentlichung,
Softwaretests oder einem Abschnitt ohne passenden Lastfall ableiten.

Zusammenhängende Soll-/ACK-/L1–L3-Antworten innerhalb 20 s ACK und 45 s
elektrischer Antwort sowie der jeweils geltenden Schutzfristen bleiben zu prüfen.
Echte Phasenwechsel mit 180-s-Frist, Wiederanlauf, Master-AUS/Rückgabe, sichere
Grenzen und Pumpenwirkung sind ohne eingetretenes und beobachtetes Ereignis offen.
SoC-Energiezähler sind erst ab etwa 14:24 historisch enthalten. BHKW-Leistung ist
bereits im SMA-Netzfluss enthalten und wird nicht nochmals auf das Netzbudget
addiert; fehlende Messzeitanker oder Zukunftsprognosen ersetzen keine Messung.

## SMA: Quellenvertrag, Einheiten und operative Verwendung

Die gezielt gelesenen SMA-Metadaten bestätigen `amperage` als numerischen Wert
in **A** sowie `pregard`/`psurplus` als numerische Werte in **W**. Aktuell sind
alle drei getrennten Bezugs- und Einspeisephasen zugeordnet. Der Hausanschlusspfad
verwendet bei dieser vollständigen Richtungszuordnung
**(Phasenbezug_W − Phaseneinspeisung_W) / 230 V**; der Stromwert ist der
Fallback für eine Konfiguration ohne Richtungsleistungen. Siehe
[`WallboxOutput`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/lib/wallbox-output.js#L1619),
[`phaseLimitedDhwPower()`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/lib/engine/dhw-output.js#L556)
und
[`netImportCurrentA()`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/lib/grid-constraints.js#L135).
Der Rohstromwert 53 A allein beweist deshalb keinen tatsächlich verwendeten
operativen Phasenwert. #181 beschreibt zusätzlich auffällige Richtungsleistungen;
deren mögliche Verwendung bleibt ebenfalls zuzuordnen. Das aktuelle Mapping
beweist die historische Konfiguration nicht.

Der Weg ist SMA-Adapter → ioBroker-State → EMS-`onStateChange` → Cache →
Regler-/Ausgangsprüfung. Der
[`Cachepfad`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/main.js#L1000)
übernimmt fremde Zustände unverändert; `receivedAt` wird getrennt erfasst.
Die gemeinsame operative SMA-Frist beträgt
[`30000 ms`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/lib/source-diagnostics.js#L6)
anhand `ts`. `lc` und Empfangszeit ersetzen sie nicht. Die vorhandene
[Quellendiagnose](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/c9c47dbf34d4c7e397b6c0a073988be2a65ed9e8/docs/sma-source-diagnostics.md)
trennt Cache, Empfang und direkten ioBroker-Leseversuch; letzterer liest nicht
unmittelbar das SMA-Gerät und erneuert den operativen Cache nicht.

Das Installationsobjekt des Quellenadapters meldet `sma-em` 1.4.0. Ergänzend
wurde dessen öffentlicher Quellstand
[`v1.4.0/main.js`](https://github.com/iobroker-community-adapters/ioBroker.sma-em/blob/v1.4.0/main.js)
über den GitHub-Connector gelesen. Dieser skaliert OBIS-Leistungen mit 0,1 W und
Ströme mit 0,001 A. Seine Messwertwrites verwenden `setState(id, value, true)`
ohne selbst gesetztes `ts`: der ioBroker-Zeitstempel bezeichnet die Veröffentlichung;
er ist kein direkt mitgelieferter physikalischer Messzeitpunkt. Der SMA-TimeTick
wird bei der anfänglichen Ratenermittlung verwendet, aber nicht als Zeitstempel
der einzelnen Leistungs-/Stromstates weitergereicht. Der öffentliche Tag wurde
nicht mit den installierten Quellbytes verglichen.

## Isolierte Reproduktion eines möglichen SMA-Konkurrenzmechanismus

Der öffentliche
[`UDP-message`-Handler](https://github.com/iobroker-community-adapters/ioBroker.sma-em/blob/v1.4.0/main.js#L945)
ist asynchron; eine Serialisierung seiner `updatePoints()`-Aufrufe ist dort nicht
sichtbar. Im
[`mean`-Zweig](https://github.com/iobroker-community-adapters/ioBroker.sma-em/blob/v1.4.0/main.js#L1301)
wird der gemeinsame Counter vor `await setState` zurückgesetzt, der gemeinsame
Akkumulator jedoch erst danach geleert. Ein weiterer überlappender Aufruf kann
dadurch zum noch vorhandenen ausgegebenen Wert addieren.

Eine isolierte Ausführung der exakten öffentlichen `updatePoints()`-Methode mit
einem synthetischen konstanten 13,267-A-Eintrag und effektiver Periode 1 ergab
bei vier überlappenden, noch nicht abgeschlossenen Statewrites
**13,267 → 26,534 → 39,801 → 53,068 A**. Nach Abschluss aller vier Writes folgte
wieder **13,267 A**. Es wurden weder UDP-Verbindung noch ioBroker, Datenbank oder
reale Aktoren angesprochen. Diese Ausführung erfolgte zunächst in isoliertem
JavaScript; die unten stehende Node-Anordnung wurde anschließend unverändert
aus dieser Dokumentation ausgeführt und bestand einschließlich des seriellen
Kontrollfalls. Das ist eine isolierte Reproduktion, kein Test gegen ioBroker.

Zum Nachvollziehen ausschließlich die öffentliche Datei des oben verlinkten Tags
als `/tmp/sma-em-main-v1.4.0.js` speichern. Dann mit Node.js ausführen; keine
Adapterinstallation oder Paketabhängigkeit nötig. Die Anordnung extrahiert genau
die vorhandene Methode, ersetzt ihren Statewriter durch ein kontrolliertes Gate
und liefert nur einen synthetischen OBIS-Eintrag, keine privaten Rohframes:

```sh
node - /tmp/sma-em-main-v1.4.0.js <<'JS'
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
const start = source.indexOf('    async updatePoints(');
const end = source.indexOf('\n    findIPv4IPs(', start);
assert.ok(start >= 0 && end > start, 'reviewed v1.4.0 method boundaries');
const method = source.slice(start, end);

async function run(overlap) {
    const cache = new Map([['synthetic.L2.amperage', {
        updPeriod: 1, updCounter: 1, updValue: []
    }]]);
    const Adapter = new Function('updCache',
        'return class Adapter {' + method + '}')(cache);
    const adapter = new Adapter();
    adapter.log = {warn() {}, error() {}};
    const points = {[0x00330400]: {id: 'L2.amperage', active: true,
        updateType: 'mean', length: 4, factor: 1 / 1000}};
    const sample = {length: 36, readUInt32BE(position) {
        assert.ok(position === 28 || position === 32);
        return position === 28 ? 0x00330400 : 13267;
    }};
    const writes = [], release = [];
    adapter.setState = (id, value, ack) => {
        assert.equal(id, 'synthetic.L2.amperage');
        assert.equal(ack, true);
        writes.push(value);
        return overlap ? new Promise(resolve => release.push(resolve))
            : Promise.resolve();
    };
    if (overlap) {
        const pending = Array.from({length: 4}, () =>
            adapter.updatePoints('synthetic', sample, points));
        assert.equal(release.length, 4, 'four writes wait at the gate');
        release.splice(0).forEach(resolve => resolve());
        await Promise.all(pending);
        adapter.setState = async (_id, value) => {writes.push(value);};
        await adapter.updatePoints('synthetic', sample, points);
    } else {
        for (let i = 0; i < 5; i++)
            await adapter.updatePoints('synthetic', sample, points);
    }
    return writes;
}
(async () => {
    const serial = await run(false), overlapping = await run(true);
    const expected = [13.267, 26.534, 39.801, 53.068, 13.267];
    assert.equal(overlapping.length, expected.length);
    assert.ok(overlapping.every((value, i) => Math.abs(value - expected[i]) < 1e-9));
    assert.ok(serial.every(value => Math.abs(value - 13.267) < 1e-9));
    console.log(JSON.stringify({serial, overlapping}));
})().catch(error => {console.error(error); process.exitCode = 1;});
JS
```

**Grenze:** Das reproduziert einen passenden Softwaremechanismus, nicht die
produktive Ursache des Bursts vom 18.10. Die
[effektive Periode](https://github.com/iobroker-community-adapters/ioBroker.sma-em/blob/v1.4.0/main.js#L1137)
ist `updatePeriod × throttleFactor`; Periode 1 ist hier eine kontrollierte
Testannahme. Tatsächliche historische UDP-Pakete, Ratenermittlung,
Schreiblatenz/Überlappung und installierte Quellbytes sind unbekannt.
Die Folgen aus #181 werden weder nachträglich geglättet noch als sichere reale
Hauslast oder als bewiesener Fehler dieses Pfads bezeichnet. Kein SMA-Fix,
keine Anlagenänderung und keine pauschale Entwarnung daraus ableiten.

## Konkrete nächste kleine SQL-Prüfpunkte

Vorzugsweise vorhandene gesicherte Originale und den nächsten regulären Abruf
verwenden; hier wurden keine Zusatzabfragen ausgeführt. Originale nach Sitzung,
Sequenz und Hash rekonstruieren, Quellen nach Sitzung/`sampleSequence` deduplizieren;
Paketzeit nicht als gleichzeitige Ereigniszeit verwenden.

1. **Nächste natürliche EHZ-Stoppfolge:** Einen kleinen Abschnitt mit Beginn,
   Nullauftrag, neuestem vollständigem Receipt, `zeroEpisode`, unabhängigen
   Originalwerten aller drei Phasen und neuem `lastReleaseProof` zusammenführen.
   `ts`, `receivedAt`, ACK, q und NULL getrennt erhalten; Reserveabbau, verzögerte
   positive Wirkung und neue Sitzung prüfen. Einen fehlenden Befehlsabschluss
   unbekannt lassen. Fehlt Pumpen-/Durchflusshistorie weiterhin, bleibt diese
   Abnahme offen; dafür keine Aufzeichnung verändern.
2. **Nächster echter PV-Stromschritt:** Kleines Ereignisfenster um Soll-/ACK-/
   elektrische Antwort mit `IncreaseBudget_JSON`, `budgetSources`,
   `electricalSources`, Toleranz/Admission und aktuellem Schutzkontext verbinden.
   20-s-ACK-/45-s-Antwortfristen und sichere Grenzen prüfen; reale Phasenwechsel,
   Wiederanlauf und Master-Rückgabe nur bei natürlich eintretenden Ereignissen.
   Historische Ziel-/Mindest-SoC-Werte aus dem damaligen Kontext verwenden.
3. **SMA-Burst:** Zuerst den bereits gesicherten kleinen Abschnitt
   **18.10.2026 18:36:25–18:36:35 Europe/Berlin** prüfen. Strom, L2-Bezug/
   -Einspeisung und Gesamtwerte nach `sampleSequence`, `ts` und `receivedAt`
   vergleichen, gleiche Zeitstempel mit verschiedenen Werten sichtbar erhalten.
   Anhand zusammengehöriger Entscheidungs-/Budgetkontexte feststellen, welche
   Werte tatsächlich verwendet wurden; reine Zwischenproben getrennt halten.
   Fehlt dieser Nachweis, bleibt die operative Wirkung unbekannt. Die
   isolierte Reproduktion ersetzt keinen historischen Paket-/Konkurrenznachweis.

Kein zusätzlicher SQL-Lasttest oder Vollabruf, keine höhere Parallelität und keine
selbst ausgelöste Metadaten-Recovery. Bei künftigem Abruffehler Originaltext,
Fenster, Limit, Laufzeit, Menge und Parsebefund sichern; Backendabschluss ohne
Nachweis unbekannt lassen. Nur nach Gesundheitsprüfung und Abstand höchstens
ein kleinerer kontrollierter Versuch, insgesamt maximal drei zusätzliche
Diagnoseabfragen entsprechend #181. Softwareprüfungen ersetzen keine reale
Abnahme und erzeugen keine Scorepunkte.
