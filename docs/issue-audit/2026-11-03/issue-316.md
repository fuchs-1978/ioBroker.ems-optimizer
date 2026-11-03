# Issue #316 – Please consider fixing issues detected by repository checker

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316. Letzte Issue-Änderung: 2026-11-02T07:24:26Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Notification from ioBroker Check and Service Bot
Dear adapter developer,

I'm the ioBroker Check and Service Bot. I'm an automated tool processing routine tasks for the ioBroker infrastructure. I have recently checked the repository for your adapter _**ems-optimizer**_ for common errors and appropiate suggestions to keep this adapter up to date.

### This check is based on the current head revisions (master / main  branch) of the adapter repository

Please see the result of the check below.

### [ioBroker.ems-optimizer](https://github.com/fuchs-1978/ioBroker.ems-optimizer)
[![Downloads](https://img.shields.io/npm/dm/iobroker.ems-optimizer.svg)](https://www.npmjs.com/package/iobroker.ems-optimizer)  - [![Test and Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml)

**ERRORS:**
- [ ] :heavy_exclamation_mark: [E1144] Untranslated "common.news" entries detected (identical to English text): es(0.17.0-alpha.181, 0.17.0-alpha.182, 0.17.0-alpha.183, 0.17.0-alpha.184, 0.17.0-alpha.185, 0.17.0-alpha.186, 0.17.0-alpha.187); fr(0.17.0-alpha.181, 0.17.0-alpha.182, 0.17.0-alpha.183, 0.17.0-alpha.184, 0.17.0-alpha.185, 0.17.0-alpha.186, 0.17.0-alpha.187); it(0.17.0-alpha.181, 0.17.0-alpha.182, 0.17.0-alpha.183, 0.17.0-alpha.184, 0.17.0-alpha.185, 0.17.0-alpha.186, 0.17.0-alpha.187); nl(0.17.0-alpha.181, 0.17.0-alpha.182, 0.17.0-alpha.183, 0.17.0-alpha.184, 0.17.0-alpha.185, 0.17.0-alpha.186, 0.17.0-alpha.187); pl(0.17.0-alpha.181, 0.17.0-alpha.182, 0.17.0-alpha.183, 0.17.0-alpha.184, 0.17.0-alpha.185, 0.17.0-alpha.186, 0.17.0-alpha.187); pt(0.17.0-alpha.181, 0.17.0-alpha.182, 0.17.0-alpha.183, 0.17.0-alpha.184, 0.17.0-alpha.185, 0.17.0-alpha.186, 0.17.0-alpha.187); ru(0.17.0-alpha.181, 0.17.0-alpha.182, 0.17.0-alpha.183, 0.17.0-alpha.184, 0.17.0-alpha.185, 0.17.0-alpha.186, 0.17.0-alpha.187); uk(0.17.0-alpha.181, 0.17.0-alpha.182, 0.17.0-alpha.183, 0.17.0-alpha.184, 0.17.0-alpha.185, 0.17.0-alpha.186, 0.17.0-alpha.187).
- [ ] :heavy_exclamation_mark: [E2000] Package iobroker.ems-optimizer not found on npm. Please publish
- [ ] :heavy_exclamation_mark: [E3009] "test-and-release.yml" is missing recommended concurrency configuration. See "https://github.com/ioBroker/ioBroker.example/blob/e7db900495bb3c2b89dc35d863dda4ccf33f5def/JavaScript/.github/workflows/test-and-release.yml#L17" for details.
- [ ] :heavy_exclamation_mark: [E3012] "test-and-release.yml": job "deploy" is not defined. Consider adding it for automated releases.
- [ ] :heavy_exclamation_mark: [E3027] "test-and-release.yml": testing for OS windows, macos is missing in job "adapter-tests". Add corresponding tests to "test-and-release.yml" or adapt [package.json](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/package.json) "os" accordingly.
- [ ] :heavy_exclamation_mark: [E3032] Release 0.17.0-alpha.187 from [io-package.json](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/io-package.json)/package.json has not yet been tagged. Tagging releases is required.
- [ ] :heavy_exclamation_mark: [E3037] "test-and-release.yml": "push" trigger "branches" must include "*" or the default branch "main". Found: ["**"]
- [ ] :heavy_exclamation_mark: [E3040] "test-and-release.yml": "push" trigger "tags" is missing required pattern(s): v[0-9]+.[0-9]+.[0-9]+, v[0-9]+.[0-9]+.[0-9]+-**
- [ ] :heavy_exclamation_mark: [E4048] No valid email address found for author/maintainer (package.json author "fuchs-1978", [io-package.json](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/io-package.json) author "fuchs-1978")
- [ ] :heavy_exclamation_mark: [E4050] No valid email address found for copyright line in [README.md](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/README.md) (MIT License. Copyright (c) 2026 Carsten Reineke. See [LICENSE](LICENSE) for the full license text.)
- [ ] :heavy_exclamation_mark: [E4051] No valid email address found for copyright line in LICENSE (Copyright (c) 2026 Carsten Reineke)
- [ ] :heavy_exclamation_mark: [E5005] Plain setTimeout() found in source files (lib/adapter-timers.js, [main.js](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/main.js)). Please use this.setTimeout() or adapter.setTimeout() instead.
- [ ] :heavy_exclamation_mark: [E6013] [README.md](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/README.md) suggests to install the adapter directly from GitHub, directly from npm or using npm commands. Installation from GitHub is discouraged. Please remove these instructions.
- [ ] :heavy_exclamation_mark: [E6033] `## License` section in [README.md](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/README.md) must contain a copyright line like "Copyright (c) 2026 iobroker-community-adapters".
- [ ] :heavy_exclamation_mark: [E8002] No topics found in the repository. Please go to "https://github.com/fuchs-1978/ioBroker.ems-optimizer", press the settings button beside the about title and add some topics.

**WARNINGS:**
- [ ] :eyes: [W0062] Consider adding and using package "@alcalzone/release-script".
- [ ] :eyes: [W0062] Consider adding and using package "@iobroker/adapter-dev".
- [ ] :eyes: [W0076] "prettier.config.mjs" is missing although "@iobroker/eslint-config" is configured.
- [ ] :eyes: [W1068] "common.keywords" should not contain "iobroker, adapter, smart home" [io-package.json](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/io-package.json)
- [ ] :eyes: [W3028] "test-and-release.yml": job "check-and-lint" uses "ioBroker/testing-action-check@v1" which is below the required version "v2".
- [ ] :eyes: [W3038] Could not retrieve npm release information for testing checks: Request failed with status code 404
- [ ] :eyes: [W3052] "test-and-release.yml": no "adapter-tests" job found in [run #116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/41359392588) on branch "main". Cannot verify "npm run test:integration" output.
- [ ] :eyes: [W4001] Cannot find "ems-optimizer" in latest repository. Please ignore if PR to add adapter to repositories already exists.
- [ ] :eyes: [W9503] .npmignore found - consider using [package.json](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/package.json) object "files" instead.

**SUGGESTIONS:**
- [ ] :pushpin: [S0048] At least one devDpendency at [package.json](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/package.json) requires a specific version. Consider using "~1.2.3" or "^1.2.3" syntax unless freezing dependencies is really desired.
- [ ] :pushpin: [S0065] No devDependency for "@types/node" found. Consider adding "@types/node":">=22" to devDependencies at [package.json](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/master/package.json).
- [ ] :pushpin: [S0085] No devDependency "@tsconfig/nodeXX" found. Consider adding one for proper type checking (see ioBroker.examples for examples).
- [ ] :pushpin: [S0087] Missing "/tsconfig.json". Consider adding it for proper type checking (see ioBroker.examples for examples).
- [ ] :pushpin: [S4036] Consider adding .vscode/settings.json file with JSON schema definitions for better development experience with Visual Studio Code.
- [ ] :pushpin: [S5601] i18n directory "admin/i18n" uses long format ({lang}/translations.json). Consider migrating to short format ({lang}.json) using "npm run translate convert".
- [ ] :pushpin: [S8913] No automerge workflow for dependabot PRs found. Consider setting up automerging by adding ".github/workflows/automerge-dependabot.yml".


Please review issues reported and consider fixing them as soon as appropiate.

**Errors** reported by repository checker should be fixed as soon as possible - at least with next minor release. Some of them require a new release to be considered as fixed. **Please note that errors reported by checker might be considered as blocking point for future updates at stable repository.** Priority bugfixes will **not be blocked** by existing errors as long as tests pass.

**Warnings** reported by repository checker should be reviewed. While some warnings can be ignored due to good reasons or a dedicated decision of the developer, most warnings should be fixed as soon as appropiate.

**Suggestions** reported by repository checker should be reviewed. Suggestions can be ignored due to a decision of the developer but they are reported as a hint to use a configuration which might get required in future or at least is used be most adapters. Suggestions are always optional to follow.

You may start a new check or force the creation of a new issue at any time by adding the following comment to this issue:

`@iobroker-bot recheck`
or
`@iobroker-bot recreate`

Please note that I (and the server at GitHub) have always plenty of work to do. So it may last up to 30 minutes until you see a reaction. I will drop a comment here as soon as I start processing.

Feel free to contact me (@iobroker-bot) if you have any questions or feel that an issue is incorrectly flagged.

And **THANKS A LOT** for maintaining this adapter from me and all users.
_Let's work together for the best user experience._

your
_ioBroker Check and Service Bot_

Note: This issue replaces issue #197

@mcm1957 for evidence

Last update at Mon, 02 Nov 2026 07:24:26 GMT based on commit 7bc4a08c80574a260d689b6b733a61dd5ad956e5
ioBroker.repochecker 5.22.16

