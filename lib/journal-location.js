'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// A configured root is a deliberate OFFLINE relocation, never a fallback that
// silently starts an empty spool while old unconfirmed originals remain behind.
async function journalDirectory(dataDirectory, root, namespace) {
    if (root === undefined || root === null || root === '') return path.join(dataDirectory, 'decision-record-journal');
    if (typeof root !== 'string' || !path.isAbsolute(root) || !/^ems-optimizer\.\d+$/.test(namespace))
        throw new Error('Journal root must be an absolute local path for this instance');
    const directory = path.join(root, namespace, 'decision-record-journal');
    const marker = path.join(directory, '.ems-journal-copy-ready');
    const stat = await fs.lstat(marker);
    if (!stat.isFile() || stat.size > 2048) throw new Error('Offline journal copy marker is invalid');
    const copy = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (copy?.schema !== 1 || copy.namespace !== namespace || copy.kind !== 'verified-offline-journal-copy')
        throw new Error('Journal relocation requires a verified offline copy for this instance');
    return directory;
}
module.exports = {journalDirectory};
