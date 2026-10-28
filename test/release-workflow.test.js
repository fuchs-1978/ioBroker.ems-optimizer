'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8');
const marker = '        run: |\n';
const script = workflow.slice(workflow.lastIndexOf(marker) + marker.length)
    .split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');

for (const scenario of ['new', 'existing-release', 'existing-tag', 'moved-main', 'main-api-failure', 'api-failure', 'malformed-release-list', 'invalid-list-shape', 'invalid-release-entry', 'git-failure', 'publish-failure']) {
    test(`release shell preserves existing publications and fails closed: ${scenario}`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-release-check-'));
        try {
            const shim = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2), scenario = process.env.SCENARIO;
fs.appendFileSync(process.env.CALLS, JSON.stringify({tool:process.env.TOOL,args})+'\\n');
if (process.env.TOOL === 'git') {
    if (scenario === 'git-failure') process.exit(1);
    if (scenario === 'existing-tag') console.log('abc refs/tags/v0.17.0-alpha.999');
} else if (args[0] === 'api') {
    if (scenario === 'main-api-failure') process.exit(1);
    console.log(scenario === 'moved-main' ? 'different' : 'current');
}
else if (args[1] === 'list') {
    if (scenario === 'api-failure') process.exit(1);
    console.log(scenario === 'malformed-release-list' ? 'not-json'
        : scenario === 'invalid-list-shape' ? '{}'
        : scenario === 'invalid-release-entry' ? '[{}]'
        : JSON.stringify(scenario === 'existing-release' ? [{tagName:'v0.17.0-alpha.999'}] : []));
} else if (args[1] !== 'create') process.exit(2);
else if (scenario === 'publish-failure') process.exit(1);
`;
            for (const tool of ['gh', 'git']) {
                const file = path.join(directory, tool);
                fs.writeFileSync(file, shim.replaceAll('process.env.TOOL', JSON.stringify(tool)), {mode: 0o700});
            }
            const calls = path.join(directory, 'calls.jsonl');
            const result = spawnSync('bash', ['-c', script], {encoding: 'utf8', env: {...process.env,
                PATH: directory + path.delimiter + process.env.PATH, SCENARIO: scenario, CALLS: calls,
                RELEASE_VERSION: '0.17.0-alpha.999', GITHUB_SHA: 'current',
                GITHUB_REPOSITORY: 'test/ems', RUNNER_TEMP: directory}});
            const operations = fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
            assert.equal(result.status, ['moved-main', 'main-api-failure', 'api-failure', 'malformed-release-list', 'invalid-list-shape', 'invalid-release-entry', 'git-failure', 'publish-failure'].includes(scenario) ? 1 : 0,
                result.stderr);
            const creates = operations.filter(call => call.tool === 'gh' && call.args[1] === 'create');
            assert.equal(creates.length, ['new', 'publish-failure'].includes(scenario) ? 1 : 0);
            if (creates.length) {
                assert.ok(creates[0].args.includes('v0.17.0-alpha.999'));
                assert.ok(creates[0].args.includes('--prerelease'));
                assert.ok(!creates[0].args.includes('--clobber'));
            }
            assert.ok(operations.every(call => call.tool !== 'git' || call.args[0] === 'ls-remote'));
        } finally {fs.rmSync(directory, {recursive: true, force: true});}
    });
}
