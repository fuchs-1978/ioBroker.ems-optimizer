# 0.17.0-alpha.129 – Paketpflege und Node.js-26-Prüfung

## Umfang

Dieses Wartungspaket bearbeitet die konkret geprüften Punkte aus Bot-Issue #13 und #197 sowie den vorhandenen Abhängigkeits-PRs #191/#192. Ausgangsstand ist alpha.128 auf main `ef179f682c8cca644e725631a39db814a3b05651`.

- Beide vorhandenen Workflows prüfen Node.js 22, 24 und 26: normale Push-/PR-Prüfung und ausdrücklich manuell gestartete Releaseprüfung. Alle drei Versionen führen vollständige Testsuite, Paketprüfung, frische Tarballinstallation und historische Vergleichsprüfungen aus. Die Mindestanforderung bleibt Node.js >=22. Laut offizieller Node-Planung beginnt die LTS-Phase von Node.js 26 am 28.10.2026; diese Versionspflege führt kein produktives Node-Upgrade aus.
- Die Mindestanforderung für `@iobroker/adapter-core` steigt von `^3.2.3` auf `^3.4.3`, für das Entwicklungswerkzeug `@iobroker/testing` von `^5.0.0` auf `^6.3.0`. Das aktualisiert die deklarierten Anforderungen; eine bisher bereits höher aufgelöste Installation wird nicht pauschal als alte Bibliotheksversion bezeichnet. Die beiden vorhandenen PRs werden inhaltlich wiederverwendet, nicht ungeprüft mit ihren alten Ausgangsständen gemergt.
- `common.news` enthielt bereits wieder 31 Versionseinträge. Nach Ergänzen dieser Version bleiben die neuesten sieben im Manifest. Ältere Texte und Releasebeschreibungen bleiben über `CHANGELOG_OLD.md` und die bestehenden Dokumente zugänglich; keine historischen Releases werden verändert.
- `npm run test:package` prüft nun zusätzlich die übereinstimmenden Manifestversionen, einen Eintrag für die aktuelle Version und höchstens sieben News-Einträge. Die bisherige Admin-JSON-Syntaxprüfung bleibt erhalten. Regressionen prüfen insbesondere die Grenze 7/8, eine nur alte Nachrichtenliste, ungültige Nachrichtenformen und widersprüchliche Versionen.

## Prüfung und Grenzen

Vor Übernahme und Veröffentlichung sind die vollständigen GitHub-Prüfungen unter allen drei Node-Versionen erforderlich. Ein fehlgeschlagener Node-26-Lauf wird nicht als bestandene Kompatibilität ausgegeben. Die neue Metadatenprüfung ist ein enger Paketvertrag und kein vollständiger offizieller ioBroker-Checker oder Integrationstest.

Der Repository-Checker 5.23.2 wurde im experimentellen lokalen Modus vollständig ausgeführt. Er empfiehlt inzwischen höchstens sieben News-Einträge (E1032); diese Grenze ist deshalb im Paket und in der Regression umgesetzt. Der vollständig abgeschlossene Lauf mit 19 Nachrichten war wegen weiterer offener Befunde insgesamt nicht grün. Die anschließende Gesamtprüfung mit sieben Nachrichten wurde bereits beim GitHub-Metadatenzugriff durch einen Proxy-Tunnel-Timeout nach 5 s blockiert (ERR_PROXY_TUNNEL); dies ist kein Adapter-Testfehler. Die lokale Paketprüfung und die Grenzregression 7/8 sind bestanden. Der lokale Modus prüft den geänderten Arbeitsstand und ersetzt keinen späteren Repository-Builder-Lauf auf der veröffentlichten Version. Noch offene Übersetzungen, responsive Admin-Breite, Lint-/Integrationstests, öffentliche Kontaktadresse sowie npm-/Latest-/Stable-Aufnahme werden durch dieses Paket nicht pauschal für erledigt erklärt. Der funktionierende getrennte Test-/manuelle Releaseprozess bleibt bestehen; ein abweichender Dateiname ist kein fehlender Testnachweis. Auto-Merge bleibt deaktiviert.

Die Änderung enthält keine neue EMS-Regelstrategie, keine Timer-/Budget-/Schutzlockerung und keinen SQL-Lastfix. Die funktionalen Korrekturen aus alpha.126–128 bleiben enthalten. Softwareprüfungen und Veröffentlichung sind keine reale Anlagenabnahme und begründen keine Scorepunkte. Keine automatische ioBroker-Installation, Node-Umstellung oder Konfigurations-/Skript-/Aktoränderung.

## Quellen

- [Bot-Issue #13](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/13) und [Checker-Issue #197](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/197)
- [adapter-core PR #191](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/191), [testing PR #192](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/192)
- [Node.js-Releaseplanung](https://github.com/nodejs/Release/blob/main/schedule.json)
- [adapter-core 3.4.3](https://github.com/ioBroker/adapter-core/releases/tag/v3.4.3), [testing 6.3.0](https://github.com/ioBroker/testing/releases/tag/v6.3.0)
