'use strict';

// Transport only: immutable original JSON strings, never a merged decision.
const MAX_BUNDLE_RECORDS = 16;
const {deflateRawSync, inflateRawSync} = require('node:zlib');
const MAX_BUNDLE_BYTES = 60 * 1024;
const MAX_LEGACY_BUNDLE_BYTES = 128 * 1024;
const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;

function packOriginals(payloads) {
    if (!Array.isArray(payloads) || !payloads.length || payloads.length > MAX_BUNDLE_RECORDS
        || payloads.some(value => typeof value !== 'string')) throw new Error('invalid bounded original bundle');
    const raw = JSON.stringify(payloads);
    if (Buffer.byteLength(raw) > MAX_ORIGINAL_BYTES) throw new Error('original bundle exceeds decoded byte limit');
    const payload = JSON.stringify({schema: 4, frameType: 'transport-bundle',
        encoding: 'deflate-raw-base64', data: deflateRawSync(Buffer.from(raw)).toString('base64')});
    if (Buffer.byteLength(payload) > MAX_BUNDLE_BYTES) throw new Error('original bundle exceeds transport byte limit');
    return payload;
}

function unpackOriginals(value) {
    let frame = value;
    if (typeof frame === 'string') frame = JSON.parse(frame);
    if (!frame || frame.schema !== 4 || frame.frameType !== 'transport-bundle') return [value];
    const envelopeBytes = Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
    if (frame.encoding !== undefined) {
        if (frame.encoding !== 'deflate-raw-base64' || typeof frame.data !== 'string'
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)
            || envelopeBytes > MAX_BUNDLE_BYTES)
            throw new Error('invalid encoded transport bundle');
        const compressed = Buffer.from(frame.data, 'base64');
        frame.records = JSON.parse(inflateRawSync(compressed, {maxOutputLength: MAX_ORIGINAL_BYTES}).toString('utf8'));
    }
    if (envelopeBytes > MAX_LEGACY_BUNDLE_BYTES
        || !Array.isArray(frame.records) || !frame.records.length || frame.records.length > MAX_BUNDLE_RECORDS)
        throw new Error('invalid bounded transport bundle');
    // Validate the whole envelope before exposing any prefix of a bad bundle.
    for (const payload of frame.records) {
        if (typeof payload !== 'string') throw new Error('bundle member is not an original JSON string');
        const record = JSON.parse(payload);
        if (!record || typeof record !== 'object' || Array.isArray(record)
            || ![1, 2, 3].includes(record.schema)) throw new Error('invalid or nested original bundle');
    }
    return frame.records;
}

function expandTransportRows(rows) {
    return rows.flatMap(entry => {
        const wrapped = entry && typeof entry === 'object' && Object.hasOwn(entry, 'val');
        try {
            return unpackOriginals(wrapped ? entry.val : entry)
                .map(value => wrapped ? {...entry, val: value} : value);
        } catch {
            // Preserve an unknown row rather than silently accepting a prefix.
            return [entry];
        }
    });
}

module.exports = {packOriginals, unpackOriginals, expandTransportRows, MAX_BUNDLE_RECORDS, MAX_BUNDLE_BYTES};
