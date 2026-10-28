'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'];
const LEAVES = new Set(['number', 'text', 'checkbox', 'state', 'select', 'objectId', 'staticText',
    'table', 'chips', 'autocomplete', 'password', 'staticLink', 'button']);

function checkLayout(config) {
    let checked = 0;
    function visit(node, location) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        if (LEAVES.has(node.type)) {
            let previous = 12;
            for (const key of BREAKPOINTS) {
                assert.ok(Number.isInteger(node[key]) && node[key] >= 1 && node[key] <= previous,
                    `${location}.${key}: expected non-increasing integer width 1..${previous}`);
                previous = node[key];
            }
            assert.equal(node.xs, 12, `${location}: smallest screen must use full width`);
            checked++;
        }
        // Table column definitions use their own widths, not grid breakpoints.
        if (!Array.isArray(node.items))
            for (const [key, value] of Object.entries(node.items || {})) visit(value, `${location}.items.${key}`);
    }
    visit(config, 'admin');
    assert.ok(checked > 0, 'No responsive fields checked');
    return {checked, breakpoints: BREAKPOINTS};
}
if (require.main === module) console.log(JSON.stringify(checkLayout(JSON.parse(fs.readFileSync(
    path.join(__dirname, '../admin/jsonConfig.json'), 'utf8')))));
module.exports = {checkLayout};
