// A minimal ZIP writer.
//
// Hand-written rather than vendored, for three reasons:
//   - CompressionStream('deflate-raw') already does the hard part, and has been
//     in every current browser for years;
//   - we always hold complete Blobs, so every size and CRC is known before a
//     byte is written. That removes data descriptors, which are the fiddly part
//     of a streaming ZIP writer, and reduces the format to
//     [local header + data] x N, [central directory entry] x N, EOCD;
//   - it is byte-level testable in jsdom, where a vendored library would be an
//     opaque blob that nothing could assert against.
//
// Zip64 is deliberately out of scope: >65535 entries or >4GB is refused with a
// clear error rather than silently written as a corrupt archive.

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** The point past which this writer would need Zip64. */
export const ZIP_LIMITS = Object.freeze({
    maxEntries: 0xffff,
    maxBytes: 0xffffffff,
});

/**
 * Payload types where DEFLATE gains ~0% but still costs real time.
 *
 * Storing these is not a shortcut; it is the better default. A ZIP of fifty
 * JPEGs deflates to within a rounding error of its stored size.
 */
const ALREADY_COMPRESSED = /\.(jpe?g|png|gif|webp|avif|heic|mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|ogg|opus|flac|zip|gz|7z|rar|woff2?|pdf)$/i;

export function shouldStore(filename, mimeType = '') {
    if (ALREADY_COMPRESSED.test(filename)) return true;
    const type = String(mimeType).toLowerCase();
    // Text-ish payloads are the ones worth deflating.
    if (type.startsWith('text/') || type.includes('json') || type.includes('xml')
        || type.includes('svg')) return false;
    return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/');
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

/** CRC-32 as ZIP uses it (reflected, polynomial 0xEDB88320). */
export function crc32(bytes, seed = 0) {
    let crc = (seed ^ 0xffffffff) >>> 0;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encode a Date as the MS-DOS time/date pair ZIP uses.
 *
 * The epoch is 1980 and seconds have two-second resolution, so anything earlier
 * is clamped rather than wrapping into a nonsense year.
 */
export function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: ((date.getHours() & 0x1f) << 11)
            | ((date.getMinutes() & 0x3f) << 5)
            | ((Math.floor(date.getSeconds() / 2)) & 0x1f),
        date: (((year - 1980) & 0x7f) << 9)
            | (((date.getMonth() + 1) & 0x0f) << 5)
            | (date.getDate() & 0x1f),
    };
}

const encoder = new TextEncoder();

function writer(size) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    return {
        u16(value) { view.setUint16(offset, value, true); offset += 2; },
        u32(value) { view.setUint32(offset, value >>> 0, true); offset += 4; },
        raw(chunk) { bytes.set(chunk, offset); offset += chunk.length; },
        done() { return bytes; },
    };
}

/** Local file header. Exported so the byte layout can be asserted directly. */
export function encodeLocalHeader({ nameBytes, method, crc, compressedSize, size, time, date }) {
    const out = writer(30 + nameBytes.length);
    out.u32(LOCAL_SIG);
    out.u16(20);            // version needed: 2.0
    out.u16(0x0800);        // flag: filename is UTF-8
    out.u16(method);
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(compressedSize);
    out.u32(size);
    out.u16(nameBytes.length);
    out.u16(0);             // no extra field
    out.raw(nameBytes);
    return out.done();
}

/** Central directory entry. */
export function encodeCentralEntry({
    nameBytes, method, crc, compressedSize, size, time, date, localOffset,
}) {
    const out = writer(46 + nameBytes.length);
    out.u32(CENTRAL_SIG);
    out.u16(20);            // version made by
    out.u16(20);            // version needed
    out.u16(0x0800);        // UTF-8 filename
    out.u16(method);
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(compressedSize);
    out.u32(size);
    out.u16(nameBytes.length);
    out.u16(0);             // extra field length
    out.u16(0);             // comment length
    out.u16(0);             // disk number
    out.u16(0);             // internal attributes
    out.u32(0);             // external attributes
    out.u32(localOffset);
    out.raw(nameBytes);
    return out.done();
}

/** End of central directory record. */
export function encodeEndOfCentralDirectory(count, centralSize, centralOffset) {
    const out = writer(22);
    out.u32(EOCD_SIG);
    out.u16(0);             // this disk
    out.u16(0);             // disk with the central directory
    out.u16(count);
    out.u16(count);
    out.u32(centralSize);
    out.u32(centralOffset);
    out.u16(0);             // comment length
    return out.done();
}

/** Raw DEFLATE via the platform, or null where it is unavailable. */
async function deflate(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}

/**
 * Coerce a payload to bytes.
 *
 * Brand checks rather than `instanceof`: a typed array that crossed a realm --
 * from a worker, or from Node under test -- is still a real typed array but
 * fails `instanceof Uint8Array` against the local constructor.
 */
async function toBytes(data) {
    if (typeof data === 'string') return encoder.encode(data);
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
        return new Uint8Array(data);
    }
    if (data && typeof data.arrayBuffer === 'function') {
        return new Uint8Array(await data.arrayBuffer());
    }
    throw new TypeError('Unsupported zip entry payload');
}

/**
 * Build a ZIP.
 *
 * @param {{name: string, data: Blob|Uint8Array|ArrayBuffer|string, date?: Date}[]} entries
 * @param {{compress?: 'auto'|'store'|'deflate'}} [options]
 * @returns {Promise<Blob>}
 */
export async function buildZip(entries, { compress = 'auto' } = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('Nothing to zip.');
    }
    if (entries.length > ZIP_LIMITS.maxEntries) {
        throw new Error(`A zip cannot hold more than ${ZIP_LIMITS.maxEntries} files.`);
    }

    const parts = [];
    const central = [];
    let offset = 0;
    const usedNames = new Set();

    for (const entry of entries) {
        const bytes = await toBytes(entry.data);
        // Duplicate names make an archive that different tools disagree about.
        let name = entry.name;
        if (usedNames.has(name)) {
            const dot = name.lastIndexOf('.');
            const stem = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            let n = 2;
            while (usedNames.has(`${stem} (${n})${ext}`)) n += 1;
            name = `${stem} (${n})${ext}`;
        }
        usedNames.add(name);

        const nameBytes = encoder.encode(name);
        const crc = crc32(bytes);
        const { time, date } = dosDateTime(entry.date ?? new Date());

        const store = compress === 'store'
            || (compress === 'auto' && shouldStore(name, entry.data?.type));

        let payload = bytes;
        let method = METHOD_STORE;
        if (!store) {
            const deflated = await deflate(bytes);
            // Only take DEFLATE if it actually helped; on incompressible input
            // it can come out larger than the original.
            if (deflated && deflated.length < bytes.length) {
                payload = deflated;
                method = METHOD_DEFLATE;
            }
        }

        const header = { nameBytes, method, crc, compressedSize: payload.length, size: bytes.length, time, date };
        parts.push(encodeLocalHeader(header), payload);
        central.push({ ...header, localOffset: offset });
        offset += 30 + nameBytes.length + payload.length;

        if (offset > ZIP_LIMITS.maxBytes) {
            throw new Error('This zip would exceed 4GB, which needs Zip64. Download the files individually.');
        }
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const entry of central) {
        const encoded = encodeCentralEntry(entry);
        parts.push(encoded);
        centralSize += encoded.length;
    }
    parts.push(encodeEndOfCentralDirectory(central.length, centralSize, centralOffset));

    return new Blob(parts, { type: 'application/zip' });
}
