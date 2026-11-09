'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');

const MAX_BYTES = 32 * 1024 * 1024;
const hash = text => createHash('sha256').update(text).digest('hex');

async function readHistoryCache(directory) {
    const filename = path.join(directory, 'forecast-history.json');
    try {
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size > MAX_BYTES) return null;
        const data = await fs.readFile(filename, 'utf8');
        const body = data.slice(65);
        return data[64] === '\n' && data.slice(0, 64) === hash(body) ? JSON.parse(body) : null;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function writeHistoryCache(directory, snapshot) {
    const body = JSON.stringify(snapshot);
    if (Buffer.byteLength(body) + 65 > MAX_BYTES) return;
    await fs.mkdir(directory, {recursive: true});
    const filename = path.join(directory, 'forecast-history.json');
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, `${hash(body)}\n${body}`, {mode: 0o600, flag: 'wx', flush: true});
        await fs.rename(temporary, filename);
    } finally {
        await fs.rm(temporary, {force: true});
    }
}

module.exports = {readHistoryCache, writeHistoryCache};
