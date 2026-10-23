'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {validatePackageMetadata} = require('../tools/check-package-metadata');

function metadata(count) {
    const version = '0.17.0-alpha.129';
    return [{version}, {common: {version, news: Object.fromEntries(Array.from({length: count}, (_, i) =>
        [`0.17.0-alpha.${129 - i}`, {de: 'Änderung', en: 'Change'}]))}}];
}

test('package guard accepts the last 19 versions and rejects a twentieth addition', () => {
    assert.doesNotThrow(() => validatePackageMetadata(...metadata(19)));
    assert.throws(() => validatePackageMetadata(...metadata(20)), /fewer than 20 entries/);
});

test('package guard requires current release notes, not just a short old list', () => {
    const [pkg, io] = metadata(2);
    delete io.common.news[pkg.version];
    assert.throws(() => validatePackageMetadata(pkg, io), /current package version/);
    for (const news of [null, [], 'old']) {
        io.common.news = news;
        assert.throws(() => validatePackageMetadata(pkg, io), /version map/);
    }
});

test('package guard rejects mismatched manifest versions', () => {
    const [pkg, io] = metadata(1);
    io.common.version = '0.17.0-alpha.128';
    assert.throws(() => validatePackageMetadata(pkg, io), /versions must match/);
});
