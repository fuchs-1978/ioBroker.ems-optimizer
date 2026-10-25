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

// The repository checker requires these eleven catalog paths. Checking every
// key (not only today's visible fields) catches incomplete catalog updates.
const languages = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
for (const language of languages) {
    test(`${language}: complete non-empty Admin catalog and manifest translations`, () => {
        const catalog = JSON.parse(fs.readFileSync(`admin/i18n/${language}/translations.json`, 'utf8'));
        assert.deepEqual(Object.keys(catalog).sort(), Object.keys(en).sort());
        for (const key of Object.keys(en)) {
            assert.equal(typeof catalog[key], 'string', `${language}: ${key}`);
            assert.ok(catalog[key].trim(), `${language}: empty ${key}`);
        }
        const common = JSON.parse(fs.readFileSync('io-package.json', 'utf8')).common;
        for (const [name, texts] of Object.entries({titleLang: common.titleLang,
            desc: common.desc, ...common.news})) {
            assert.equal(typeof texts[language], 'string', `${name}: missing ${language}`);
            assert.ok(texts[language].trim(), `${name}: empty ${language}`);
        }
    });
}
