'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('admin/i18n/en/translations.json', 'utf8'));
const de = JSON.parse(fs.readFileSync('admin/i18n/de/translations.json', 'utf8'));
test('all visible Admin texts resolve through complete English and German catalogs', () => {
    assert.equal(config.i18n, true);
    assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort());
    function visit(value) {
        if (!value || typeof value !== 'object') return;
        for (const [key, entry] of Object.entries(value)) {
            if (['label', 'text', 'help', 'tooltip', 'title'].includes(key)) {
                assert.equal(typeof entry, 'string');
                assert.ok(en[entry]?.trim(), `missing English: ${entry}`);
                assert.ok(de[entry]?.trim(), `missing German: ${entry}`);
            } else visit(entry);
        }
    }
    visit(config.items);
    assert.equal(de[config.items.dhwTab.label], 'Warmwasser-Heizstab');
    assert.equal(de.General, 'Allgemein');
    assert.match(de['Writable go-e release (allow_charging, numeric 0/1)'], /allow_charging.*0\/1/);
});
