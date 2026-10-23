'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Repository checker recommends at most seven version messages. Run this in
// normal and release CI, so a version bump cannot silently grow the list.
function validatePackageMetadata(packageJson, ioPackage) {
    assert.equal(ioPackage.common?.version, packageJson.version,
        'package.json and io-package.json versions must match');
    const news = ioPackage.common?.news;
    assert.ok(news && typeof news === 'object' && !Array.isArray(news),
        'common.news must be a version map');
    assert.ok(Object.keys(news).length <= 7,
        'common.news must contain at most 7 entries; archive older changes in CHANGELOG_OLD.md');
    assert.ok(Object.hasOwn(news, packageJson.version),
        'common.news must describe the current package version');
}

if (require.main === module) {
    const root = path.resolve(__dirname, '..');
    const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    const pkg = read('package.json');
    const io = read('io-package.json');
    validatePackageMetadata(pkg, io);
    // Preserve the existing Admin JSON syntax check in test:package.
    read('admin/jsonConfig.json');
    console.log(JSON.stringify({version: pkg.version, newsEntries: Object.keys(io.common.news).length,
        maximumNewsEntries: 7, adminJson: 'valid'}));
}

module.exports = {validatePackageMetadata};
