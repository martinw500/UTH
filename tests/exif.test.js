/**
 * The metadata reader and stripper.
 *
 * Fixtures are built byte by byte here rather than checked in as binaries: a
 * committed JPEG cannot be read to see what it is meant to prove, and adjusting
 * one to test an edge case means opening a hex editor. `buildTiff` below is
 * ~60 lines and makes every case in this file legible.
 *
 * This is one of the few areas where jsdom is genuinely enough -- it is all
 * ArrayBuffer arithmetic, with no canvas, worker or SharedArrayBuffer in sight.
 */

import {
    readMetadata,
    stripMetadata,
    presentTags,
    toDecimalCoordinate,
    formatExifDate,
    mapsUrl,
} from '../js/shared/exif.js';

// ============================================
// Fixture builders
// ============================================

const TYPE = { ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 };
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

const ascii = (text) => {
    const bytes = new Uint8Array(text.length + 1);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
    return { type: TYPE.ASCII, count: bytes.length, bytes };
};

const rationals = (pairs) => {
    const bytes = new Uint8Array(pairs.length * 8);
    const view = new DataView(bytes.buffer);
    pairs.forEach(([numerator, denominator], i) => {
        view.setUint32(i * 8, numerator, true);
        view.setUint32(i * 8 + 4, denominator, true);
    });
    return { type: TYPE.RATIONAL, count: pairs.length, bytes };
};

const short = (value) => {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return { type: TYPE.SHORT, count: 1, bytes };
};

const ifdSize = (entryCount) => 2 + entryCount * 12 + 4;

/**
 * Build a little-endian TIFF block containing IFD0 plus optional EXIF and GPS
 * sub-directories. Entries are `[tag, value]` where value comes from one of the
 * helpers above.
 */
function buildTiff({ ifd0 = [], exif = [], gps = [] }) {
    const hasExif = exif.length > 0;
    const hasGps = gps.length > 0;
    const ifd0Count = ifd0.length + (hasExif ? 1 : 0) + (hasGps ? 1 : 0);

    const ifd0At = 8;
    const exifAt = ifd0At + ifdSize(ifd0Count);
    const gpsAt = exifAt + (hasExif ? ifdSize(exif.length) : 0);
    let dataAt = gpsAt + (hasGps ? ifdSize(gps.length) : 0);

    // Lay the out-of-line values out first so entry offsets are known.
    const pool = [];
    const place = (entries) => entries.map(([tag, value]) => {
        const total = TYPE_SIZE[value.type] * value.count;
        if (total <= 4) return { tag, value, inline: true };
        const at = dataAt;
        pool.push({ at, bytes: value.bytes });
        dataAt += total + (total % 2); // keep offsets even, as writers do
        return { tag, value, inline: false, at };
    });

    const placed0 = place(ifd0);
    const placedExif = place(exif);
    const placedGps = place(gps);

    const buffer = new ArrayBuffer(dataAt);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    bytes[0] = 0x49; bytes[1] = 0x49;          // "II" — little-endian
    view.setUint16(2, 42, true);
    view.setUint32(4, ifd0At, true);

    const writeIfd = (at, placed, extras = []) => {
        const all = [...placed, ...extras];
        view.setUint16(at, all.length, true);
        all.forEach((entry, i) => {
            const base = at + 2 + i * 12;
            view.setUint16(base, entry.tag, true);
            view.setUint16(base + 2, entry.value.type, true);
            view.setUint32(base + 4, entry.value.count, true);
            if (entry.inline) bytes.set(entry.value.bytes, base + 8);
            else view.setUint32(base + 8, entry.at, true);
        });
        view.setUint32(at + 2 + all.length * 12, 0, true); // no next IFD
    };

    const pointer = (tag, target) => ({
        tag,
        inline: true,
        value: (() => {
            const b = new Uint8Array(4);
            new DataView(b.buffer).setUint32(0, target, true);
            return { type: TYPE.LONG, count: 1, bytes: b };
        })(),
    });

    const extras = [];
    if (hasExif) extras.push(pointer(0x8769, exifAt));
    if (hasGps) extras.push(pointer(0x8825, gpsAt));

    writeIfd(ifd0At, placed0, extras);
    if (hasExif) writeIfd(exifAt, placedExif);
    if (hasGps) writeIfd(gpsAt, placedGps);

    for (const { at, bytes: data } of pool) bytes.set(data, at);
    return bytes;
}

/** Wrap a TIFF block in a JPEG, with recognisable "pixel" bytes after SOS. */
function buildJpeg(tiff, { extraSegments = [] } = {}) {
    const parts = [new Uint8Array([0xff, 0xd8])];

    if (tiff) {
        const header = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
        const length = 2 + header.length + tiff.length;
        const marker = new Uint8Array(4);
        marker.set([0xff, 0xe1]);
        new DataView(marker.buffer).setUint16(2, length, false);
        parts.push(marker, header, tiff);
    }

    for (const [markerByte, payload] of extraSegments) {
        const head = new Uint8Array(4);
        head.set([0xff, markerByte]);
        new DataView(head.buffer).setUint16(2, 2 + payload.length, false);
        parts.push(head, payload);
    }

    // SOS with a small header, then stand-in entropy data, then EOI.
    const sos = new Uint8Array([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]);
    const pixels = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
    parts.push(sos, pixels, new Uint8Array([0xff, 0xd9]));

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) { out.set(part, cursor); cursor += part.length; }
    return out;
}

function buildPng(chunks = []) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const parts = [new Uint8Array(signature)];

    const chunk = (type, data) => {
        const out = new Uint8Array(12 + data.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, data.length, false);
        for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
        out.set(data, 8);
        // CRC is not validated by the walker, and computing it here would test
        // the fixture builder rather than the parser.
        view.setUint32(8 + data.length, 0, false);
        return out;
    };

    parts.push(chunk('IHDR', new Uint8Array(13)));
    for (const [type, data] of chunks) parts.push(chunk(type, data));
    parts.push(chunk('IDAT', new Uint8Array([1, 2, 3, 4])));
    parts.push(chunk('IEND', new Uint8Array(0)));

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) { out.set(part, cursor); cursor += part.length; }
    return out;
}

const asBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

// ============================================
// Tests
// ============================================

describe('readMetadata — JPEG', () => {
    const tiff = buildTiff({
        ifd0: [
            [0x010f, ascii('TestCam')],
            [0x0110, ascii('Model X')],
            [0x0132, ascii('2024:03:11 14:05:09')],
            [0x0112, short(6)],
        ],
        exif: [
            [0x8827, short(400)],
            [0x829d, rationals([[28, 10]])],
            [0xa431, ascii('SN-12345678')],
        ],
        gps: [
            [0x0001, ascii('N')],
            [0x0002, rationals([[49, 1], [16, 1], [3000, 100]])],
            [0x0003, ascii('W')],
            [0x0004, rationals([[123, 1], [7, 1], [1500, 100]])],
        ],
    });

    const jpeg = buildJpeg(tiff);
    const meta = readMetadata(asBuffer(jpeg));

    test('identifies the container', () => {
        expect(meta.format).toBe('JPEG');
    });

    test('reads IFD0 strings', () => {
        expect(meta.tags['Camera make']).toBe('TestCam');
        expect(meta.tags['Camera model']).toBe('Model X');
    });

    // The EXIF sub-directory is behind a pointer tag, so a parser that only
    // walks IFD0 finds the make and model and silently misses everything that
    // actually identifies the photographer.
    test('follows the pointer into the EXIF sub-directory', () => {
        expect(meta.tags.ISO).toBe(400);
        expect(meta.tags['Body serial number']).toBe('SN-12345678');
    });

    test('reads a rational as a number', () => {
        expect(meta.tags.Aperture).toBeCloseTo(2.8, 3);
    });

    test('converts GPS to signed decimal degrees', () => {
        expect(meta.gps.latitude).toBeCloseTo(49.275, 4);
        // West is negative. Dropping the hemisphere puts Vancouver in Kazakhstan.
        expect(meta.gps.longitude).toBeCloseTo(-123.1208, 3);
    });

    test('lists the metadata blocks it found', () => {
        expect(meta.found.map(f => f.kind)).toContain('Exif');
    });

    test('a JPEG with no APP1 reports no tags rather than failing', () => {
        const bare = readMetadata(asBuffer(buildJpeg(null)));
        expect(bare.format).toBe('JPEG');
        expect(bare.tags).toEqual({});
        expect(bare.gps).toBeNull();
    });

    test('a truncated file returns null instead of throwing', () => {
        expect(readMetadata(new ArrayBuffer(4))).toBeNull();
        expect(readMetadata(null)).toBeNull();
    });

    test('a bad TIFF byte-order mark is ignored, not guessed at', () => {
        const broken = buildTiff({ ifd0: [[0x010f, ascii('X')]] });
        broken[0] = 0x5a; broken[1] = 0x5a;
        expect(readMetadata(asBuffer(buildJpeg(broken))).tags).toEqual({});
    });
});

describe('stripMetadata — JPEG', () => {
    const tiff = buildTiff({ ifd0: [[0x010f, ascii('TestCam')]] });
    const comment = new Uint8Array([0x68, 0x69]); // "hi"
    const jpeg = buildJpeg(tiff, { extraSegments: [[0xfe, comment]] });

    test('removes every metadata segment', () => {
        const { bytes } = stripMetadata(asBuffer(jpeg));
        expect(readMetadata(asBuffer(bytes)).tags).toEqual({});
        expect(readMetadata(asBuffer(bytes)).found).toEqual([]);
    });

    test('reports how many bytes went', () => {
        const { removed } = stripMetadata(asBuffer(jpeg));
        expect(removed).toBeGreaterThan(tiff.length);
        expect(removed).toBe(jpeg.length - stripMetadata(asBuffer(jpeg)).bytes.length);
    });

    // The reason not to round-trip through a canvas: the picture must come back
    // bit-identical, not merely similar. A canvas re-encode is why most online
    // EXIF removers quietly degrade the photo.
    test('copies the image data through untouched', () => {
        const { bytes } = stripMetadata(asBuffer(jpeg));
        const tail = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0xff, 0xd9];
        expect(Array.from(bytes.slice(-tail.length))).toEqual(tail);
    });

    test('the result is still a JPEG', () => {
        const { bytes } = stripMetadata(asBuffer(jpeg));
        expect(bytes[0]).toBe(0xff);
        expect(bytes[1]).toBe(0xd8);
    });

    test('stripping an already-clean file is a no-op, not a corruption', () => {
        const clean = buildJpeg(null);
        const { bytes, removed } = stripMetadata(asBuffer(clean));
        expect(removed).toBe(0);
        expect(Array.from(bytes)).toEqual(Array.from(clean));
    });
});

describe('PNG', () => {
    const text = new Uint8Array([
        ...'Author'.split('').map(c => c.charCodeAt(0)), 0,
        ...'Jane'.split('').map(c => c.charCodeAt(0)),
    ]);
    const png = buildPng([['tEXt', text]]);

    test('reads a tEXt chunk as a key/value pair', () => {
        const meta = readMetadata(asBuffer(png));
        expect(meta.format).toBe('PNG');
        expect(meta.tags.Author).toBe('Jane');
    });

    test('strips text chunks and keeps the image data', () => {
        const { bytes } = stripMetadata(asBuffer(png));
        const after = readMetadata(asBuffer(bytes));
        expect(after.tags).toEqual({});
        expect(bytes.length).toBeLessThan(png.length);
        // IHDR, IDAT and IEND must all survive or the file will not open.
        expect(after.format).toBe('PNG');
    });
});

describe('toDecimalCoordinate', () => {
    test('combines degrees, minutes and seconds', () => {
        expect(toDecimalCoordinate([49, 16, 30], 'N')).toBeCloseTo(49.275, 4);
    });

    test('south and west are negative', () => {
        expect(toDecimalCoordinate([33, 51, 54], 'S')).toBeLessThan(0);
        expect(toDecimalCoordinate([118, 14, 37], 'W')).toBeLessThan(0);
    });

    test('a missing reference letter still yields a magnitude', () => {
        expect(toDecimalCoordinate([10, 0, 0], undefined)).toBe(10);
    });

    // Half a GPS block would otherwise plot as a point in the Atlantic.
    test('rejects a malformed triplet rather than inventing a location', () => {
        expect(toDecimalCoordinate(null, 'N')).toBeNull();
        expect(toDecimalCoordinate([49], 'N')).toBeNull();
        expect(toDecimalCoordinate([49, NaN, 0], 'N')).toBeNull();
    });
});

describe('presentTags', () => {
    test('turns an orientation code into words', () => {
        expect(presentTags({ Orientation: 6 }).Orientation).toBe('Rotated 90° CW');
    });

    test('renders a fast shutter as a fraction, the way a camera does', () => {
        expect(presentTags({ 'Exposure time': 0.004 })['Exposure time']).toBe('1/250 s');
    });

    test('renders a long exposure in seconds', () => {
        expect(presentTags({ 'Exposure time': 2.5 })['Exposure time']).toBe('2.5 s');
    });

    test('prefixes an aperture with f/', () => {
        expect(presentTags({ Aperture: 2.8 }).Aperture).toBe('f/2.8');
    });

    test('drops values that render to nothing rather than showing blanks', () => {
        expect(presentTags({ 'Exposure time': 0 })).toEqual({});
    });
});

describe('formatExifDate', () => {
    // EXIF writes YYYY:MM:DD, which no Date parser accepts.
    test('rewrites colons in the date part only', () => {
        expect(formatExifDate('2024:03:11 14:05:09')).toBe('2024-03-11 14:05:09');
    });

    test('leaves an unrecognised string alone', () => {
        expect(formatExifDate('sometime last year')).toBe('sometime last year');
    });
});

describe('mapsUrl', () => {
    test('builds a link carrying both coordinates', () => {
        const url = mapsUrl({ latitude: 49.275, longitude: -123.12 });
        expect(url).toContain('mlat=49.275');
        expect(url).toContain('mlon=-123.12');
    });

    test('is null when there is no location', () => {
        expect(mapsUrl(null)).toBeNull();
    });
});
