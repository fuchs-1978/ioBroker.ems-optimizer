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

test('npm deployment requires explicit dispatch on a tested tag and derives the channel from both manifests', t => {
    const ci = fs.readFileSync(path.join(__dirname, '../.github/workflows/test-and-release.yml'), 'utf8');
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    assert.ok(deploy.includes('needs: [check-and-lint, adapter-tests]'));
    assert.ok(deploy.includes("if: github.event_name == 'workflow_dispatch' && inputs.publish_to_npm && startsWith(github.ref, 'refs/tags/v')"));
    assert.ok(deploy.includes('git merge-base --is-ancestor HEAD origin/main'));
    const versionCheck = deploy.match(/node - <<'JS'\n([\s\S]*?)\n +JS\n/)[1];
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-npm-release-'));
    t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
    const output = path.join(cwd, 'output');
    for (const [pkg, io, tag, channel] of [
        ['1.2.3-alpha.4', '1.2.3-alpha.4', 'v1.2.3-alpha.4', 'alpha'],
        ['1.2.3', '1.2.3', 'v1.2.3', 'latest'],
        ['1.2.3-alpha.4', '1.2.3', 'v1.2.3-alpha.4', null],
        ['1.2.3-alpha.4', '1.2.3-alpha.4', 'v1.2.3', null],
        ['1.2.3-custom', '1.2.3-custom', 'v1.2.3-custom', null]
    ]) {
        fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({version: pkg}));
        fs.writeFileSync(path.join(cwd, 'io-package.json'), JSON.stringify({common: {version: io}}));
        fs.writeFileSync(output, '');
        const check = spawnSync(process.execPath, ['-'], {cwd, input: versionCheck, encoding: 'utf8',
            env: {...process.env, GITHUB_REF_NAME: tag, GITHUB_OUTPUT: output}});
        assert.equal(check.status, channel ? 0 : 1, check.stderr);
        assert.equal(fs.readFileSync(output, 'utf8'), channel ? 'channel=' + channel + '\n' : '');
    }
});

for (const scenario of ['new', 'existing-release', 'existing-tag', 'moved-main', 'main-api-failure', 'api-failure', 'malformed-release-list', 'invalid-list-shape', 'invalid-release-entry', 'git-failure', 'publish-failure']) {
    test(`release shell preserves existing publications and fails closed: ${scenario}`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-release-check-'));
        try {
            const shim = `const fs = require('node:fs');
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
                const file = path.join(directory, tool + '.cjs');
                fs.writeFileSync(file, shim.replaceAll('process.env.TOOL', JSON.stringify(tool)));
            }
            const calls = path.join(directory, 'calls.jsonl');
            const bash = process.platform === 'win32' ? path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : 'bash';
            const commands = 'git() { node "$EMS_MOCKS/git.cjs" "$@"; }\ngh() { node "$EMS_MOCKS/gh.cjs" "$@"; }\n';
            const result = spawnSync(bash, ['-c', commands + script], {encoding: 'utf8', env: {...process.env,
                EMS_MOCKS: directory.replaceAll('\\', '/'), SCENARIO: scenario, CALLS: calls,
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
