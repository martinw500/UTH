/**
 * The privacy tool's metadata reader and stripper (js/shared/metadata.js).
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
} from '../js/shared/metadata.js';

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

// ============================================
// What must survive, and what hides past the end
// ============================================

const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let cursor = 0;
    for (const part of parts) { out.set(part, cursor); cursor += part.length; }
    return out;
};
const text = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const segment = (marker, payload) => {
    const head = new Uint8Array([0xff, marker, 0, 0]);
    new DataView(head.buffer).setUint16(2, 2 + payload.length, false);
    return concat(head, payload);
};
const containsBytes = (haystack, needle) => {
    outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
        for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
        return true;
    }
    return false;
};

describe('stripMetadata — JPEG keeps what the picture needs', () => {
    const icc = concat(text('ICC_PROFILE\0'), new Uint8Array([1, 1, 0xaa, 0xbb]));
    const mpf = concat(text('MPF\0'), new Uint8Array([0xcc, 0xdd]));
    const adobe = concat(text('Adobe'), new Uint8Array([0, 100, 0, 0, 0, 0, 2]));
    const jpeg = buildJpeg(buildTiff({ ifd0: [[0x010f, ascii('TestCam')]] }), {
        extraSegments: [[0xe2, icc], [0xe2, mpf], [0xee, adobe]],
    });
    const { bytes } = stripMetadata(asBuffer(jpeg));

    // Without it an iPhone's Display P3 photo is shown as sRGB: visibly dull.
    test('keeps the ICC colour profile', () => {
        expect(containsBytes(bytes, icc)).toBe(true);
    });

    // Without it a CMYK/YCCK JPEG decodes with inverted colours.
    test('keeps the Adobe APP14 segment', () => {
        expect(containsBytes(bytes, adobe)).toBe(true);
    });

    test('drops MPF, which shares APP2 with the profile', () => {
        expect(containsBytes(bytes, mpf)).toBe(false);
    });

    test('keeping them is not reported as something found', () => {
        expect(readMetadata(asBuffer(bytes)).found).toEqual([]);
    });
});

describe('stripMetadata — JPEG, data after the main image', () => {
    // Phones append MPF images (depth maps, HDR gain maps), each a whole JPEG
    // with its own EXIF, after the main image's EOI.
    const secondary = buildJpeg(buildTiff({
        gps: [[0x0001, ascii('N')], [0x0002, rationals([[1, 1], [2, 1], [3, 1]])],
            [0x0003, ascii('E')], [0x0004, rationals([[4, 1], [5, 1], [6, 1]])]],
    }));
    const main = buildJpeg(null);
    const jpeg = concat(main, secondary);

    test('is reported', () => {
        expect(readMetadata(asBuffer(jpeg)).found.map((f) => f.kind)).toContain('Embedded images');
    });

    test('is cut off, so its EXIF goes with it', () => {
        const { bytes } = stripMetadata(asBuffer(jpeg));
        expect(Array.from(bytes)).toEqual(Array.from(main));
    });
});

describe('stripMetadata — progressive JPEG', () => {
    // A progressive file has several scans with segments between them. The
    // walker must step over scan data rather than stop at the first SOS, and
    // an FF D9 inside a segment's payload is not the end of the image.
    const sos = new Uint8Array([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]);
    const scan1 = new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]); // stuffed FF, RST0
    const dht = segment(0xc4, new Uint8Array([0x10, 0xff, 0xd9, 0x01]));
    const lateExif = segment(0xe1, concat(text('Exif\0\0'), buildTiff({ ifd0: [[0x010f, ascii('Late')]] })));
    const scan2 = new Uint8Array([0x78, 0x9a]);
    const eoi = new Uint8Array([0xff, 0xd9]);
    const jpeg = concat(new Uint8Array([0xff, 0xd8]), sos, scan1, dht, lateExif, sos, scan2, eoi);
    const { bytes } = stripMetadata(asBuffer(jpeg));

    test('finds metadata between scans', () => {
        expect(readMetadata(asBuffer(jpeg)).tags['Camera make']).toBe('Late');
        expect(readMetadata(asBuffer(bytes)).tags).toEqual({});
    });

    test('keeps every scan and the table between them, byte for byte', () => {
        expect(Array.from(bytes)).toEqual(
            Array.from(concat(new Uint8Array([0xff, 0xd8]), sos, scan1, dht, sos, scan2, eoi)));
    });
});

// ============================================
// WebP
// ============================================

function buildWebp(chunks) {
    const chunk = ([fourcc, data]) => {
        const head = concat(text(fourcc), new Uint8Array(4));
        new DataView(head.buffer).setUint32(4, data.length, true);
        return concat(head, data, new Uint8Array(data.length % 2));
    };
    const body = concat(text('WEBP'), ...chunks.map(chunk));
    const head = concat(text('RIFF'), new Uint8Array(4));
    new DataView(head.buffer).setUint32(4, body.length, true);
    return concat(head, body);
}

describe('WebP', () => {
    const tiff = buildTiff({ ifd0: [[0x010f, ascii('WebCam')]] });
    // VP8X flags byte: ICC 0x20, EXIF 0x08, XMP 0x04.
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x20 | 0x08 | 0x04;
    const webp = buildWebp([
        ['VP8X', vp8x], ['ICCP', new Uint8Array([1, 2])], ['VP8 ', new Uint8Array([9, 9, 9])],
        ['EXIF', tiff], ['XMP ', text('<x/>')],
    ]);
    const { bytes } = stripMetadata(asBuffer(webp));
    const view = new DataView(bytes.buffer);

    test('reads EXIF from its chunk', () => {
        const meta = readMetadata(asBuffer(webp));
        expect(meta.format).toBe('WebP');
        expect(meta.tags['Camera make']).toBe('WebCam');
        expect(meta.found.map((f) => f.kind)).toEqual(['Exif', 'XMP']);
    });

    test('drops EXIF and XMP, keeps ICCP and the image', () => {
        expect(readMetadata(asBuffer(bytes)).found).toEqual([]);
        expect(containsBytes(bytes, text('ICCP'))).toBe(true);
        expect(containsBytes(bytes, new Uint8Array([9, 9, 9]))).toBe(true);
    });

    test('rewrites the RIFF size', () => {
        expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    });

    // A VP8X still announcing EXIF/XMP promises chunks that are gone.
    test('clears the EXIF and XMP flags, and only those', () => {
        expect(bytes[20]).toBe(0x20);
    });
});

// ============================================
// HEIC
// ============================================

/** ftyp + meta(iinf, iloc) + mdat holding one Exif item. */
function buildHeic(tiff) {
    const box = (type, ...parts) => {
        const body = concat(...parts);
        const head = concat(new Uint8Array(4), text(type));
        new DataView(head.buffer).setUint32(0, 8 + body.length, false);
        return concat(head, body);
    };
    const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, false); return b; };
    const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, false); return b; };
    const fullBox = (type, version, ...parts) => box(type, new Uint8Array([version, 0, 0, 0]), ...parts);

    const payload = concat(u32(6), text('Exif\0\0'), tiff);
    const ftyp = box('ftyp', text('heic'), u32(0), text('mif1heic'));
    const iinf = fullBox('iinf', 0, u16(2),
        fullBox('infe', 2, u16(1), u16(0), text('hvc1'), text('\0')),
        fullBox('infe', 2, u16(2), u16(0), text('Exif'), text('\0')));
    const iloc = (offset) => fullBox('iloc', 0, new Uint8Array([0x44, 0x00]), u16(1),
        u16(2), u16(0), u16(1), u32(offset), u32(payload.length));
    const meta = (offset) => fullBox('meta', 0, iinf, iloc(offset));
    const mdatOffset = ftyp.length + meta(0).length + 8;
    return concat(ftyp, meta(mdatOffset), box('mdat', payload));
}

describe('HEIC', () => {
    const heic = buildHeic(buildTiff({
        ifd0: [[0x010f, ascii('Apple')], [0x0110, ascii('iPhone 15')]],
        gps: [[0x0001, ascii('S')], [0x0002, rationals([[33, 1], [51, 1], [54, 1]])],
            [0x0003, ascii('E')], [0x0004, rationals([[151, 1], [12, 1], [36, 1]])]],
    }));
    const meta = readMetadata(asBuffer(heic));

    test('is recognised by its brand', () => {
        expect(meta.format).toBe('HEIC');
    });

    // iPhone originals are HEIC, and the location is the whole point.
    test('finds the Exif item through iinf and iloc', () => {
        expect(meta.tags['Camera model']).toBe('iPhone 15');
        expect(meta.gps.latitude).toBeCloseTo(-33.865, 3);
        expect(meta.found.map((f) => f.kind)).toEqual(['Exif']);
    });

    test('cannot be rewritten in place, and says so with null', () => {
        expect(stripMetadata(asBuffer(heic))).toBeNull();
    });

    test('a truncated box table reports nothing rather than throwing', () => {
        const cut = heic.slice(0, 60);
        expect(() => readMetadata(asBuffer(cut))).not.toThrow();
    });
});
