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
            if ((['label', 'text', 'help', 'tooltip', 'title'].includes(key) || (key === 'unit' && ['days', 'percentage points'].includes(entry)))) {
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

// A catalog with every key but copied English help text is not a translation.
// Product names and short shared technical terms may legitimately stay equal.
for (const language of languages.filter(locale => !['en', 'de'].includes(locale))) {
    test(`${language}: extended Admin guidance is translated, not English fallback`, () => {
        const catalog = JSON.parse(fs.readFileSync(`admin/i18n/${language}/translations.json`, 'utf8'));
        for (const [key, source] of Object.entries(en)) {
            const sentences = source.split(/(?<=[.!?])\s+(?=[A-Z])/u);
            for (const sentence of sentences) {
                if ((sentence.match(/[A-Za-z]{2,}/g) || []).length < 8) continue;
                assert.ok(!catalog[key].includes(sentence),
                    `${language}: untranslated English sentence in ${key}`);
            }
            for (const literal of source.match(/@controlled-battery-ac|\b[A-Za-z][A-Za-z0-9]*(?:[._][A-Za-z0-9_*]+)+\b/g) || []) {
                assert.ok(catalog[key].includes(literal),
                    `${language}: altered technical identifier ${literal}`);
            }
        }
    });
}

const sharedLabels = new Set(['§14a / EEBUS LPC', 'kWh', 'Wh', 'J', 'L1', 'L2', 'L3', 'W', 'kW']);
const sharedLocalWords = {es: ['General'], fr: ['1 phase', '3 phases', 'Standard'], it: ['Standard'], pl: ['VAT']};
const countNumbers = text => {
    const result = new Map();
    for (const number of text.match(/\d+(?:\.\d+)*/g) || []) result.set(number, (result.get(number) || 0) + 1);
    return result;
};
for (const language of languages.filter(locale => !['en', 'de'].includes(locale))) {
    test(`${language}: translated labels retain literals, quantities and clean text`, () => {
        const catalog = JSON.parse(fs.readFileSync(`admin/i18n/${language}/translations.json`, 'utf8'));
        for (const [key, source] of Object.entries(en)) {
            const value = catalog[key];
            assert.doesNotMatch(value, /[▁�]|<(?:s|unk|pad|\/s)>|(?:eng|spa|fra|ita|nld|pol|por|rus|ukr|zho)_(?:Latn|Cyrl|Hans)/u, `${language}: tokenizer artifact in ${key}`);
            if (value === source) assert.ok(sharedLabels.has(source) || sharedLocalWords[language]?.includes(source),
                `${language}: untranslated label ${key}`);
            for (const token of ['Europe/Berlin', 'day0', 'day1', 'ACK=true', 'q=0',
                'online=true', 'MM=false', 'LM=true', 'controlMode=off', 'socfrei',
                'SOCmin', 'rawResponse', 'OutputOwned', '14a']) {
                if (source.includes(token)) assert.ok(value.includes(token), `${language}: changed ${token}`);
            }
            // Localized quarter labels may use Roman numerals or local month names.
            // These are display strings; option values stay in jsonConfig.json.
            if (/^Q[1-4] \(/.test(source)) continue;
            const actual = countNumbers(value);
            const permitted = countNumbers(source);
            const numberWords = {zero: '0', one: '1', single: '1', two: '2', three: '3', four: '4',
                five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10'};
            for (const word of source.toLowerCase().match(/\b[a-z]+\b/g) || []) {
                if (numberWords[word]) permitted.set(numberWords[word], (permitted.get(numberWords[word]) || 0) + 1);
            }
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
            for (const month of source.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/g) || []) {
                const number = String(monthNames.indexOf(month) + 1);
                permitted.set(number, (permitted.get(number) || 0) + 1);
            }
            if (/quarter[- ]hour/i.test(source)) permitted.set('15', (permitted.get('15') || 0) + 1);
            for (const [number, count] of actual) assert.ok((permitted.get(number) || 0) >= count,
                `${language}: invented numerical value ${number} in ${key}`);
            for (const [number, count] of countNumbers(source)) assert.ok((actual.get(number) || 0) >= count,
                `${language}: omitted or changed numerical value ${number} in ${key}`);
        }
    });
}
