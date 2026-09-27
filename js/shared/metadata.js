/**
 * Read and remove image metadata.
 *
 * Hand-written rather than vendored, because the job is small, the formats are
 * stable, and it is pure `ArrayBuffer` work -- which means jsdom can test it
 * properly. That is unusual for this codebase: the note in STATE.md about jsdom
 * proving nothing applies to canvas, workers and `SharedArrayBuffer`, none of
 * which appear here.
 *
 * The stripper rebuilds the container byte-for-byte with the metadata segments
 * removed. It never re-encodes through a canvas. A canvas round-trip is how
 * most "remove EXIF" tools work and it silently re-compresses the photo,
 * so the file people were told was merely cleaned comes back visibly worse.
 *
 * What is removed, per format:
 *   JPEG  APP1 (Exif, XMP), APP2 other than ICC (MPF), APP3-13, APP15, COM,
 *         and anything after the main image's EOI
 *   PNG   eXIf, tEXt, zTXt, iTXt, tIME
 *   WebP  EXIF and XMP chunks, and their VP8X flags
 *   HEIC  read only; stripMetadata returns null and the caller re-encodes
 *
 * What is kept on purpose: the ICC profile (APP2 ICC_PROFILE, PNG iCCP, WebP
 * ICCP) and JPEG APP14. iPhone photos are Display P3, and without the profile
 * they are shown as sRGB and look dull; without APP14 a CMYK or YCCK JPEG
 * decodes with inverted colours. Neither identifies anyone.
 *
 * Main's js/shared/exif.js is a separate, smaller reader with three callers
 * that only need orientation, camera and GPS. This one is the privacy tool's.
 */

// ============================================
// Byte helpers
// ============================================

function bytesAt(view, offset, length) {
    return new Uint8Array(view.buffer, view.byteOffset + offset, length);
}

/**
 * Decode single-byte text.
 *
 * Done by hand rather than with `TextDecoder` for two reasons: jest's jsdom
 * environment does not define `TextDecoder` as a global, and every string this
 * module reads is single-byte anyway. EXIF ASCII fields are 7-bit by spec, and
 * PNG `tEXt` is Latin-1 by spec -- so a UTF-8 decoder would be the wrong tool
 * for the one case where it would make a difference.
 *
 * Chunked because `fromCharCode(...bytes)` overflows the argument limit on a
 * long value, which only shows up on the large fields (an XMP packet, a comment)
 * and never on the short ones you would test with.
 */
function decodeLatin1(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 4096) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    return out;
}

function readAscii(view, offset, length) {
    return decodeLatin1(bytesAt(view, offset, length));
}

// ============================================
// Tag dictionaries
// ============================================

const TIFF_TAGS = {
    0x010e: 'Description',
    0x010f: 'Camera make',
    0x0110: 'Camera model',
    0x0112: 'Orientation',
    0x0131: 'Software',
    0x0132: 'Modified',
    0x013b: 'Artist',
    0x8298: 'Copyright',
};

const EXIF_TAGS = {
    0x829a: 'Exposure time',
    0x829d: 'Aperture',
    0x8822: 'Exposure program',
    0x8827: 'ISO',
    0x9003: 'Taken',
    0x9004: 'Digitised',
    0x9204: 'Exposure compensation',
    0x9207: 'Metering mode',
    0x9209: 'Flash',
    0x920a: 'Focal length',
    0x9286: 'User comment',
    0xa002: 'Width',
    0xa003: 'Height',
    0xa402: 'Exposure mode',
    0xa403: 'White balance',
    0xa405: 'Focal length (35mm equivalent)',
    0xa406: 'Scene type',
    0xa430: 'Camera owner',
    0xa431: 'Body serial number',
    0xa432: 'Lens specification',
    0xa433: 'Lens make',
    0xa434: 'Lens model',
    0xa435: 'Lens serial number',
};

const GPS_TAGS = {
    0x0000: 'GPSVersionID',
    0x0001: 'GPSLatitudeRef',
    0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef',
    0x0004: 'GPSLongitude',
    0x0005: 'GPSAltitudeRef',
    0x0006: 'GPSAltitude',
    0x0007: 'GPSTimeStamp',
    0x001d: 'GPSDateStamp',
};

/**
 * Tags whose presence is the reason this tool exists: they identify a person,
 * a place, or a specific physical camera. The UI surfaces these first.
 */
export const SENSITIVE_TAGS = new Set([
    'Camera owner',
    'Body serial number',
    'Lens serial number',
    'Artist',
    'User comment',
    'Description',
    'Software',
]);

const ORIENTATIONS = {
    1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored, rotated 180°',
    5: 'Mirrored, rotated 90° CCW', 6: 'Rotated 90° CW',
    7: 'Mirrored, rotated 90° CW', 8: 'Rotated 90° CCW',
};

const EXPOSURE_PROGRAMS = {
    0: 'Not defined', 1: 'Manual', 2: 'Program', 3: 'Aperture priority',
    4: 'Shutter priority', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape',
};

const METERING_MODES = {
    0: 'Unknown', 1: 'Average', 2: 'Centre-weighted', 3: 'Spot',
    4: 'Multi-spot', 5: 'Pattern', 6: 'Partial',
};

const WHITE_BALANCE = { 0: 'Auto', 1: 'Manual' };
const EXPOSURE_MODES = { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' };

// ============================================
// TIFF / IFD parsing
// ============================================

// Bytes per component, indexed by TIFF type. Index 0 is unused.
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

function readValue(view, entryOffset, little, tiffStart) {
    const type = view.getUint16(entryOffset + 2, little);
    const count = view.getUint32(entryOffset + 4, little);
    const size = TYPE_SIZES[type] || 0;
    if (!size || count === 0) return null;

    const total = size * count;
    // Four bytes or fewer live inline; anything bigger is an offset from the
    // start of the TIFF header (not from the file, and not from the entry).
    const dataOffset = total <= 4
        ? entryOffset + 8
        : tiffStart + view.getUint32(entryOffset + 8, little);

    if (dataOffset < 0 || dataOffset + total > view.byteLength) return null;

    switch (type) {
        case 1:
        case 7: { // BYTE, UNDEFINED
            const out = [];
            for (let i = 0; i < count; i += 1) out.push(view.getUint8(dataOffset + i));
            return out;
        }
        case 2: { // ASCII, NUL-terminated
            const raw = readAscii(view, dataOffset, count);
            return raw.replace(/\0.*$/, '').trim();
        }
        case 3: { // SHORT
            const out = [];
            for (let i = 0; i < count; i += 1) out.push(view.getUint16(dataOffset + i * 2, little));
            return count === 1 ? out[0] : out;
        }
        case 4: { // LONG
            const out = [];
            for (let i = 0; i < count; i += 1) out.push(view.getUint32(dataOffset + i * 4, little));
            return count === 1 ? out[0] : out;
        }
        case 5:
        case 10: { // RATIONAL, SRATIONAL
            const signed = type === 10;
            const out = [];
            for (let i = 0; i < count; i += 1) {
                const at = dataOffset + i * 8;
                const numerator = signed ? view.getInt32(at, little) : view.getUint32(at, little);
                const denominator = signed ? view.getInt32(at + 4, little) : view.getUint32(at + 4, little);
                out.push(denominator === 0 ? 0 : numerator / denominator);
            }
            return count === 1 ? out[0] : out;
        }
        case 9: { // SLONG
            const out = [];
            for (let i = 0; i < count; i += 1) out.push(view.getInt32(dataOffset + i * 4, little));
            return count === 1 ? out[0] : out;
        }
        default:
            return null;
    }
}

function readIfd(view, ifdOffset, little, tiffStart, dictionary, into, subIfds) {
    if (ifdOffset + 2 > view.byteLength) return;
    const count = view.getUint16(ifdOffset, little);

    for (let i = 0; i < count; i += 1) {
        const entry = ifdOffset + 2 + i * 12;
        if (entry + 12 > view.byteLength) return;

        const tag = view.getUint16(entry, little);

        // Pointers to the nested EXIF and GPS directories.
        if (subIfds && (tag === 0x8769 || tag === 0x8825)) {
            const pointer = readValue(view, entry, little, tiffStart);
            if (typeof pointer === 'number') {
                subIfds[tag === 0x8769 ? 'exif' : 'gps'] = tiffStart + pointer;
            }
            continue;
        }

        const name = dictionary[tag];
        if (!name) continue;

        const value = readValue(view, entry, little, tiffStart);
        if (value !== null && value !== '') into[name] = value;
    }
}

/** Parse a TIFF block (the payload of an Exif APP1, eXIf chunk, or WebP EXIF). */
function parseTiff(view, tiffStart) {
    if (tiffStart + 8 > view.byteLength) return null;

    const order = view.getUint16(tiffStart, false);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;

    if (view.getUint16(tiffStart + 2, little) !== 42) return null;

    const ifd0 = tiffStart + view.getUint32(tiffStart + 4, little);
    const tags = {};
    const gpsRaw = {};
    const subIfds = {};

    readIfd(view, ifd0, little, tiffStart, TIFF_TAGS, tags, subIfds);
    if (subIfds.exif) readIfd(view, subIfds.exif, little, tiffStart, EXIF_TAGS, tags, null);
    if (subIfds.gps) readIfd(view, subIfds.gps, little, tiffStart, GPS_TAGS, gpsRaw, null);

    return { tags, gpsRaw };
}

// ============================================
// GPS
// ============================================

/**
 * Degrees/minutes/seconds triplet plus a hemisphere letter to a signed decimal.
 * Returns null unless both are present and sane -- a half-populated GPS block
 * would otherwise plot as a point off the coast of Africa.
 */
export function toDecimalCoordinate(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 2) return null;
    const [degrees, minutes, seconds = 0] = dms;
    if ([degrees, minutes, seconds].some(n => typeof n !== 'number' || !isFinite(n))) return null;

    const magnitude = Math.abs(degrees) + Math.abs(minutes) / 60 + Math.abs(seconds) / 3600;
    const negative = typeof ref === 'string' && /^[SW]/i.test(ref.trim());
    const value = negative ? -magnitude : magnitude;
    return Number(value.toFixed(6));
}

function buildGps(gpsRaw) {
    const lat = toDecimalCoordinate(gpsRaw.GPSLatitude, gpsRaw.GPSLatitudeRef);
    const lon = toDecimalCoordinate(gpsRaw.GPSLongitude, gpsRaw.GPSLongitudeRef);
    if (lat === null || lon === null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    const gps = { latitude: lat, longitude: lon };

    if (typeof gpsRaw.GPSAltitude === 'number') {
        // Ref 1 means below sea level.
        const below = Array.isArray(gpsRaw.GPSAltitudeRef)
            ? gpsRaw.GPSAltitudeRef[0] === 1
            : gpsRaw.GPSAltitudeRef === 1;
        gps.altitude = Math.round(below ? -gpsRaw.GPSAltitude : gpsRaw.GPSAltitude);
    }

    return gps;
}

// ============================================
// Presentation
// ============================================

function formatShutter(seconds) {
    if (typeof seconds !== 'number' || seconds <= 0) return null;
    if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`;
    return `1/${Math.round(1 / seconds)} s`;
}

/** Turn raw tag values into the strings a person reads. */
export function presentTags(tags) {
    const out = {};
    for (const [key, value] of Object.entries(tags)) {
        let display = value;

        if (key === 'Orientation') display = ORIENTATIONS[value] || `Unknown (${value})`;
        else if (key === 'Exposure program') display = EXPOSURE_PROGRAMS[value] || `Unknown (${value})`;
        else if (key === 'Metering mode') display = METERING_MODES[value] || `Unknown (${value})`;
        else if (key === 'White balance') display = WHITE_BALANCE[value] ?? `Unknown (${value})`;
        else if (key === 'Exposure mode') display = EXPOSURE_MODES[value] ?? `Unknown (${value})`;
        else if (key === 'Exposure time') display = formatShutter(value);
        else if (key === 'Aperture') display = typeof value === 'number' ? `f/${Number(value.toFixed(1))}` : value;
        else if (key === 'Focal length') display = typeof value === 'number' ? `${Number(value.toFixed(1))} mm` : value;
        else if (key === 'Focal length (35mm equivalent)') display = `${value} mm`;
        else if (key === 'Flash') display = (value & 1) ? 'Fired' : 'Did not fire';
        else if (key === 'Exposure compensation') display = typeof value === 'number' ? `${value > 0 ? '+' : ''}${Number(value.toFixed(1))} EV` : value;
        else if (key === 'Taken' || key === 'Digitised' || key === 'Modified') display = formatExifDate(value);
        else if (Array.isArray(value)) display = value.join(', ');

        if (display !== null && display !== undefined && display !== '') out[key] = String(display);
    }
    return out;
}

/** EXIF dates are `YYYY:MM:DD HH:MM:SS`, which no Date parser accepts. */
export function formatExifDate(value) {
    if (typeof value !== 'string') return value;
    const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!match) return value;
    const [, y, mo, d, h, mi, s] = match;
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

// ============================================
// Container walkers
// ============================================

/**
 * Whether a JPEG segment is metadata rather than something needed to show the
 * picture as it was taken. APP2 is shared: ICC profiles live there (keep), and
 * so does MPF, the index of the extra images phones append (drop).
 */
function isJpegMetadata(view, marker, dataStart, dataLength) {
    if (marker === 0xe2) {
        return dataLength < 12 || readAscii(view, dataStart, 12) !== 'ICC_PROFILE\0';
    }
    if (marker === 0xee) return false; // APP14 Adobe: colour transform, see header
    return (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe; // APPn, COM
}

/**
 * Walk a JPEG's marker segments up to the main image's EOI, including the
 * ones between the scans of a progressive JPEG. Entropy-coded data is stepped
 * over, never reported: inside it 0xFF is always followed by 0x00 or a restart
 * marker, so the next real marker is unambiguous.
 *
 * `onSegment(marker, start, totalLength, dataStart, dataLength)`. Returns the
 * offset just past the EOI (the whole file if there is none), or -1 if this is
 * not a JPEG at all.
 */
function walkJpeg(view, onSegment) {
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return -1;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

    let offset = 2;
    while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; } // scan data or junk
        const marker = bytes[offset + 1];
        if (marker === 0xff) { offset += 1; continue; } // fill byte
        // Stuffed 0xFF, TEM, RSTn: no length field.
        if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        if (marker === 0xd9) return offset + 2;

        if (offset + 4 > bytes.length) break;
        const length = view.getUint16(offset + 2, false);
        if (length < 2 || offset + 2 + length > bytes.length) break;
        onSegment(marker, offset, 2 + length, offset + 4, length - 2);
        offset += 2 + length;
    }
    return bytes.length;
}

/** Bytes after the main image. Phones put MPF images there, each with its own EXIF. */
function hasTrailingImage(view, end) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (let i = end; i + 2 < bytes.length; i += 1) {
        if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) return true;
    }
    return false;
}

function readJpeg(view) {
    const result = { format: 'JPEG', tags: {}, gps: null, found: [] };

    const end = walkJpeg(view, (marker, start, total, dataStart, dataLength) => {
        if (marker === 0xe1 && dataLength >= 6) {
            const header = readAscii(view, dataStart, 6);
            if (header === 'Exif\0\0') {
                const parsed = parseTiff(view, dataStart + 6);
                if (parsed) {
                    Object.assign(result.tags, parsed.tags);
                    result.gps = buildGps(parsed.gpsRaw) || result.gps;
                }
                result.found.push({ kind: 'Exif', bytes: total });
                return;
            }
            if (readAscii(view, dataStart, Math.min(28, dataLength)).startsWith('http://ns.adobe.com/xap')) {
                result.found.push({ kind: 'XMP', bytes: total });
                return;
            }
        }
        if (marker === 0xed) result.found.push({ kind: 'IPTC / Photoshop', bytes: total });
        else if (marker === 0xfe) result.found.push({ kind: 'Comment', bytes: total });
        else if (isJpegMetadata(view, marker, dataStart, dataLength) && marker !== 0xe1) {
            result.found.push({ kind: marker === 0xe2 ? 'Embedded image index (MPF)' : 'Maker data', bytes: total });
        }
    });
    if (end < 0) return null;

    if (hasTrailingImage(view, end)) {
        result.found.push({ kind: 'Embedded images', bytes: view.byteLength - end });
    }
    return result;
}

function stripJpeg(view) {
    const drops = [];
    const end = walkJpeg(view, (marker, start, total, dataStart, dataLength) => {
        if (isJpegMetadata(view, marker, dataStart, dataLength)) drops.push([start, start + total]);
    });
    if (end < 0) return null;

    // Copy [0, end) minus the dropped segments. Scan data is copied verbatim;
    // the whole point is that the pixels are never touched.
    const source = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const size = end - drops.reduce((sum, [from, to]) => sum + (to - from), 0);
    const out = new Uint8Array(size);
    let cursor = 0;
    let from = 0;
    for (const [dropFrom, dropTo] of [...drops, [end, end]]) {
        out.set(source.subarray(from, dropFrom), cursor);
        cursor += dropFrom - from;
        from = dropTo;
    }

    return { bytes: out, removed: view.byteLength - size };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function isPng(view) {
    if (view.byteLength < 8) return false;
    return PNG_SIGNATURE.every((byte, i) => view.getUint8(i) === byte);
}

function walkPng(view, onChunk) {
    let offset = 8;
    while (offset + 8 <= view.byteLength) {
        const length = view.getUint32(offset, false);
        const type = readAscii(view, offset + 4, 4);
        const total = 12 + length; // length + type + data + crc
        if (offset + total > view.byteLength) break;
        onChunk(type, offset, total, offset + 8, length);
        if (type === 'IEND') break;
        offset += total;
    }
}

function readPng(view) {
    const result = { format: 'PNG', tags: {}, gps: null, found: [] };

    walkPng(view, (type, _start, total, dataStart, length) => {
        if (type === 'eXIf') {
            const parsed = parseTiff(view, dataStart);
            if (parsed) {
                Object.assign(result.tags, parsed.tags);
                result.gps = buildGps(parsed.gpsRaw) || result.gps;
            }
            result.found.push({ kind: 'Exif', bytes: total });
        } else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
            const raw = bytesAt(view, dataStart, length);
            const split = raw.indexOf(0);
            const key = split > 0 ? decodeLatin1(raw.subarray(0, split)) : type;
            // zTXt is deflate-compressed; showing the key alone is honest and
            // avoids pulling in an inflate implementation for a label.
            const value = type === 'tEXt' && split > 0
                ? decodeLatin1(raw.subarray(split + 1)).replace(/\0/g, ' ').trim()
                : '';
            if (value) result.tags[key] = value;
            result.found.push({ kind: `Text: ${key}`, bytes: total });
        } else if (type === 'tIME') {
            result.found.push({ kind: 'Modification time', bytes: total });
        }
    });

    return result;
}

function stripPng(view) {
    const keep = [];
    let removed = 0;

    walkPng(view, (type, start, total) => {
        if (PNG_METADATA_CHUNKS.has(type)) {
            removed += total;
            return;
        }
        keep.push([start, total]);
    });

    const size = 8 + keep.reduce((sum, [, total]) => sum + total, 0);
    const out = new Uint8Array(size);
    const source = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

    out.set(source.subarray(0, 8), 0);
    let cursor = 8;
    for (const [start, total] of keep) {
        out.set(source.subarray(start, start + total), cursor);
        cursor += total;
    }

    return { bytes: out, removed };
}

function isWebp(view) {
    return view.byteLength >= 12
        && readAscii(view, 0, 4) === 'RIFF'
        && readAscii(view, 8, 4) === 'WEBP';
}

function walkWebp(view, onChunk) {
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
        const fourcc = readAscii(view, offset, 4);
        const length = view.getUint32(offset + 4, true);
        // RIFF pads odd-length chunks to an even boundary.
        const total = 8 + length + (length % 2);
        if (offset + 8 + length > view.byteLength) break;
        onChunk(fourcc, offset, total, offset + 8, length);
        offset += total;
    }
}

function readWebp(view) {
    const result = { format: 'WebP', tags: {}, gps: null, found: [] };

    walkWebp(view, (fourcc, _start, total, dataStart, length) => {
        if (fourcc === 'EXIF') {
            // Some encoders prefix the TIFF block with the JPEG-style header.
            const offset = length >= 6 && readAscii(view, dataStart, 6) === 'Exif\0\0'
                ? dataStart + 6
                : dataStart;
            const parsed = parseTiff(view, offset);
            if (parsed) {
                Object.assign(result.tags, parsed.tags);
                result.gps = buildGps(parsed.gpsRaw) || result.gps;
            }
            result.found.push({ kind: 'Exif', bytes: total });
        } else if (fourcc === 'XMP ') {
            result.found.push({ kind: 'XMP', bytes: total });
        }
    });

    return result;
}

function stripWebp(view) {
    const keep = [];
    let removed = 0;

    walkWebp(view, (fourcc, start, total) => {
        if (fourcc === 'EXIF' || fourcc === 'XMP ') {
            removed += total;
            return;
        }
        keep.push([start, total]);
    });

    const payload = keep.reduce((sum, [, total]) => sum + total, 0);
    const out = new Uint8Array(12 + payload);
    const source = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

    out.set(source.subarray(0, 12), 0);
    let cursor = 12;
    for (const [start, total] of keep) {
        out.set(source.subarray(start, start + total), cursor);
        cursor += total;
    }

    // The RIFF size field counts everything after itself, so dropping chunks
    // without rewriting it produces a file that strict decoders reject.
    new DataView(out.buffer).setUint32(4, out.length - 8, true);

    // VP8X announces which optional chunks follow. Leaving the EXIF (0x08) and
    // XMP (0x04) bits set promises chunks that are no longer there.
    if (out.length >= 21 && readAscii(new DataView(out.buffer), 12, 4) === 'VP8X') out[20] &= ~0x0c;

    return { bytes: out, removed };
}

// ============================================
// HEIC / HEIF / AVIF (read only)
// ============================================
//
// ISOBMFF: a tree of boxes. EXIF is an *item*: `meta/iinf` names it (type
// 'Exif') and `meta/iloc` says where its bytes are. Re-writing the container
// without it means patching every other item's offsets, so this only reads;
// the privacy page exports a clean JPEG instead.

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis']);

function isHeif(view) {
    if (view.byteLength < 16 || readAscii(view, 4, 4) !== 'ftyp') return false;
    const size = Math.min(view.getUint32(0, false), view.byteLength);
    for (let at = 8; at + 4 <= size; at += 4) {
        if (at !== 12 && HEIF_BRANDS.has(readAscii(view, at, 4))) return true; // 12 is minor_version
    }
    return false;
}

/** Child boxes of [start, end): `onBox(type, dataStart, dataEnd)`. */
function walkBoxes(view, start, end, onBox) {
    let offset = start;
    while (offset + 8 <= end) {
        let size = view.getUint32(offset, false);
        const type = readAscii(view, offset + 4, 4);
        let header = 8;
        if (size === 1) {
            if (offset + 16 > end) return;
            size = Number(view.getBigUint64(offset + 8, false));
            header = 16;
        } else if (size === 0) {
            size = end - offset;
        }
        if (size < header || offset + size > end) return;
        onBox(type, offset + header, offset + size);
        offset += size;
    }
}

function readSized(view, at, size) {
    if (size === 0) return 0;
    if (size === 4) return view.getUint32(at, false);
    if (size === 8) return Number(view.getBigUint64(at, false));
    throw new RangeError(`unsupported field size ${size}`);
}

/** `{ id: { type, contentType } }` from an iinf box (entries are infe v2/v3). */
function readItemInfo(view, start, end) {
    const items = {};
    const version = view.getUint8(start);
    walkBoxes(view, start + 4 + (version === 0 ? 2 : 4), end, (type, dataStart, dataEnd) => {
        if (type !== 'infe') return;
        const infeVersion = view.getUint8(dataStart);
        if (infeVersion < 2) return;
        let at = dataStart + 4;
        const id = infeVersion === 2 ? view.getUint16(at, false) : view.getUint32(at, false);
        at += (infeVersion === 2 ? 2 : 4) + 2; // + protection index
        const itemType = readAscii(view, at, 4);
        at += 4;
        let contentType = '';
        if (itemType === 'mime') {
            const nameEnd = new Uint8Array(view.buffer, view.byteOffset + at, dataEnd - at).indexOf(0);
            const typeStart = at + nameEnd + 1;
            contentType = readAscii(view, typeStart, Math.max(0, dataEnd - typeStart)).replace(/\0.*$/, '');
        }
        items[id] = { type: itemType, contentType };
    });
    return items;
}

/** `{ id: { offset, length } }` for items stored at a file offset (construction method 0). */
function readItemLocations(view, start) {
    const locations = {};
    const version = view.getUint8(start);
    const sizes = view.getUint8(start + 4);
    const sizes2 = view.getUint8(start + 5);
    const offsetSize = sizes >> 4;
    const lengthSize = sizes & 0x0f;
    const baseOffsetSize = sizes2 >> 4;
    const indexSize = version === 1 || version === 2 ? sizes2 & 0x0f : 0;
    let at = start + 6;
    const count = version < 2 ? view.getUint16(at, false) : view.getUint32(at, false);
    at += version < 2 ? 2 : 4;

    for (let i = 0; i < count; i += 1) {
        const id = version < 2 ? view.getUint16(at, false) : view.getUint32(at, false);
        at += version < 2 ? 2 : 4;
        let method = 0;
        if (version === 1 || version === 2) { method = view.getUint16(at, false) & 0x0f; at += 2; }
        at += 2; // data_reference_index
        const base = readSized(view, at, baseOffsetSize);
        at += baseOffsetSize;
        const extents = view.getUint16(at, false);
        at += 2;
        for (let e = 0; e < extents; e += 1) {
            at += indexSize;
            const offset = readSized(view, at, offsetSize);
            at += offsetSize;
            const length = readSized(view, at, lengthSize);
            at += lengthSize;
            if (e === 0 && method === 0) locations[id] = { offset: base + offset, length };
        }
    }
    return locations;
}

function readHeif(view) {
    const brand = readAscii(view, 8, 4);
    const result = { format: brand.startsWith('avi') ? 'AVIF' : 'HEIC', tags: {}, gps: null, found: [] };

    let items = {};
    let locations = {};
    try {
        walkBoxes(view, 0, view.byteLength, (type, start, end) => {
            if (type !== 'meta') return;
            walkBoxes(view, start + 4, end, (child, childStart, childEnd) => {
                if (child === 'iinf') items = readItemInfo(view, childStart, childEnd);
                if (child === 'iloc') locations = readItemLocations(view, childStart);
            });
        });
    } catch {
        return result; // a malformed box table: say nothing rather than guess
    }

    for (const [id, item] of Object.entries(items)) {
        const where = locations[id];
        if (!where || where.offset + where.length > view.byteLength) continue;
        if (item.type === 'Exif' && where.length > 4) {
            // The payload opens with the offset from its own end to the TIFF
            // header, usually 6 for an 'Exif\0\0' prefix.
            const parsed = parseTiff(view, where.offset + 4 + view.getUint32(where.offset, false));
            if (parsed) {
                Object.assign(result.tags, parsed.tags);
                result.gps = buildGps(parsed.gpsRaw) || result.gps;
            }
            result.found.push({ kind: 'Exif', bytes: where.length });
        } else if (item.type === 'mime' && /xml/i.test(item.contentType)) {
            result.found.push({ kind: 'XMP', bytes: where.length });
        }
    }
    return result;
}

// ============================================
// Public API
// ============================================

/**
 * Read what an image is carrying.
 *
 * Returns `{ format, tags, gps, found }`, or `null` for a format this does not
 * understand. `tags` holds raw values; run them through `presentTags` to
 * display. `found` lists every metadata block seen, including ones with no
 * readable tags -- an XMP packet is still something the user is sharing.
 */
export function readMetadata(buffer) {
    if (!buffer || buffer.byteLength < 12) return null;
    const view = new DataView(buffer);

    if (isPng(view)) return readPng(view);
    if (isWebp(view)) return readWebp(view);
    if (isHeif(view)) return readHeif(view);
    return readJpeg(view);
}

/**
 * Remove metadata, returning `{ bytes, removed }` or `null` for a format this
 * cannot rewrite (HEIC included). The pixel data is copied, never re-encoded,
 * so the output is bit-identical picture content in a smaller file.
 */
export function stripMetadata(buffer) {
    if (!buffer || buffer.byteLength < 12) return null;
    const view = new DataView(buffer);

    if (isPng(view)) return stripPng(view);
    if (isWebp(view)) return stripWebp(view);
    if (isHeif(view)) return null;
    return stripJpeg(view);
}

/** A link a person can actually check, rather than an embedded map tile. */
export function mapsUrl(gps) {
    if (!gps) return null;
    return `https://www.openstreetmap.org/?mlat=${gps.latitude}&mlon=${gps.longitude}#map=16/${gps.latitude}/${gps.longitude}`;
}
