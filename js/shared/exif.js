// Minimal read-only EXIF reader for JPEG files.
//
// This exists for honesty, not for editing. Re-encoding through a canvas always
// discards EXIF, GPS and ICC data -- there is no canvas API that preserves it,
// so the editor cannot offer a "keep metadata" option. What it can do is say
// what is about to be dropped, which turns an invisible side effect into a
// visible privacy feature: "this photo contains GPS coordinates, they will not
// be included in the export".
//
// Pure DataView parsing, so it is fully testable from a byte fixture.

const JPEG_SOI = 0xffd8;
const APP1 = 0xffe1;
const TIFF_LITTLE_ENDIAN = 0x4949;
const TIFF_BIG_ENDIAN = 0x4d4d;

const TAG = {
    MAKE: 0x010f,
    MODEL: 0x0110,
    ORIENTATION: 0x0112,
    DATE_TIME: 0x0132,
    EXIF_IFD: 0x8769,
    GPS_IFD: 0x8825,
    DATE_TIME_ORIGINAL: 0x9003,
};

const GPS_TAG = {
    LAT_REF: 0x0001,
    LAT: 0x0002,
    LON_REF: 0x0003,
    LON: 0x0004,
};

// EXIF type -> bytes per component. Index matches the spec's type numbers.
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Human descriptions of the eight EXIF orientation values. */
export const ORIENTATION_LABELS = Object.freeze({
    1: 'normal',
    2: 'mirrored',
    3: 'rotated 180°',
    4: 'mirrored and rotated 180°',
    5: 'mirrored and rotated 90° CCW',
    6: 'rotated 90° CW',
    7: 'mirrored and rotated 90° CW',
    8: 'rotated 90° CCW',
});

function readString(view, offset, length) {
    let out = '';
    for (let i = 0; i < length; i += 1) {
        const code = view.getUint8(offset + i);
        if (code === 0) break;
        out += String.fromCharCode(code);
    }
    return out.trim();
}

/** Read one IFD entry's value, following the pointer when it does not fit inline. */
function readValue(view, entryOffset, tiffStart, littleEndian) {
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const size = TYPE_SIZE[type];
    if (!size) return null;

    const total = size * count;
    // Values of 4 bytes or fewer are stored in the entry itself; anything
    // larger is a file offset.
    const valueOffset = total <= 4
        ? entryOffset + 8
        : tiffStart + view.getUint32(entryOffset + 8, littleEndian);

    if (valueOffset + total > view.byteLength) return null;

    switch (type) {
        case 2: // ASCII
            return readString(view, valueOffset, count);
        case 1:
        case 7:
            return view.getUint8(valueOffset);
        case 3: // SHORT
            return view.getUint16(valueOffset, littleEndian);
        case 4: // LONG
            return view.getUint32(valueOffset, littleEndian);
        case 5: { // RATIONAL — used by GPS, which needs all three components
            const values = [];
            for (let i = 0; i < count; i += 1) {
                const numerator = view.getUint32(valueOffset + i * 8, littleEndian);
                const denominator = view.getUint32(valueOffset + i * 8 + 4, littleEndian);
                values.push(denominator === 0 ? 0 : numerator / denominator);
            }
            return count === 1 ? values[0] : values;
        }
        default:
            return null;
    }
}

function readIfd(view, ifdStart, tiffStart, littleEndian, wanted) {
    const found = {};
    if (ifdStart + 2 > view.byteLength) return found;

    const entries = view.getUint16(ifdStart, littleEndian);
    for (let i = 0; i < entries; i += 1) {
        const entryOffset = ifdStart + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) break;
        const tag = view.getUint16(entryOffset, littleEndian);
        if (!wanted || wanted.includes(tag)) {
            found[tag] = readValue(view, entryOffset, tiffStart, littleEndian);
        }
    }
    return found;
}

/** Degrees/minutes/seconds triple + hemisphere -> signed decimal degrees. */
function toDecimalDegrees(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    const [degrees, minutes, seconds] = dms;
    const value = degrees + minutes / 60 + seconds / 3600;
    if (!Number.isFinite(value)) return null;
    return (ref === 'S' || ref === 'W') ? -value : value;
}

/**
 * Parse the EXIF block of a JPEG.
 *
 * Returns null for anything that is not a JPEG carrying an APP1/EXIF segment --
 * PNG, WebP and JPEGs without metadata are all normal, not errors.
 */
export function parseExif(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 4) return null;
    const view = new DataView(arrayBuffer);
    if (view.getUint16(0) !== JPEG_SOI) return null;

    // Walk the marker segments looking for APP1.
    let offset = 2;
    let tiffStart = -1;
    while (offset + 4 <= view.byteLength) {
        const marker = view.getUint16(offset);
        if ((marker & 0xff00) !== 0xff00) break;
        const length = view.getUint16(offset + 2);
        if (marker === APP1 && offset + 10 <= view.byteLength) {
            if (readString(view, offset + 4, 4) === 'Exif') {
                tiffStart = offset + 10;
                break;
            }
        }
        if (length < 2) break;
        offset += 2 + length;
    }

    if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return null;

    const byteOrder = view.getUint16(tiffStart);
    if (byteOrder !== TIFF_LITTLE_ENDIAN && byteOrder !== TIFF_BIG_ENDIAN) return null;
    const littleEndian = byteOrder === TIFF_LITTLE_ENDIAN;

    const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
    const ifd0 = readIfd(view, tiffStart + ifd0Offset, tiffStart, littleEndian, [
        TAG.MAKE, TAG.MODEL, TAG.ORIENTATION, TAG.DATE_TIME, TAG.EXIF_IFD, TAG.GPS_IFD,
    ]);

    const result = {
        orientation: ifd0[TAG.ORIENTATION] ?? 1,
        make: ifd0[TAG.MAKE] || null,
        model: ifd0[TAG.MODEL] || null,
        dateTime: ifd0[TAG.DATE_TIME] || null,
        gps: null,
    };

    if (ifd0[TAG.EXIF_IFD]) {
        const sub = readIfd(
            view, tiffStart + ifd0[TAG.EXIF_IFD], tiffStart, littleEndian,
            [TAG.DATE_TIME_ORIGINAL],
        );
        result.dateTime = sub[TAG.DATE_TIME_ORIGINAL] || result.dateTime;
    }

    if (ifd0[TAG.GPS_IFD]) {
        const gps = readIfd(view, tiffStart + ifd0[TAG.GPS_IFD], tiffStart, littleEndian, [
            GPS_TAG.LAT_REF, GPS_TAG.LAT, GPS_TAG.LON_REF, GPS_TAG.LON,
        ]);
        const lat = toDecimalDegrees(gps[GPS_TAG.LAT], gps[GPS_TAG.LAT_REF]);
        const lon = toDecimalDegrees(gps[GPS_TAG.LON], gps[GPS_TAG.LON_REF]);
        if (lat !== null && lon !== null) result.gps = { lat, lon };
    }

    return result;
}

/**
 * Human lines describing what is present, for display next to the export button.
 *
 * GPS is deliberately listed first and named as coordinates: it is the one
 * field a user might actually care about not shipping.
 */
export function summariseExif(exif) {
    if (!exif) return [];
    const lines = [];
    if (exif.gps) {
        lines.push(`GPS location (${exif.gps.lat.toFixed(5)}, ${exif.gps.lon.toFixed(5)})`);
    }
    if (exif.make || exif.model) {
        lines.push(`Camera: ${[exif.make, exif.model].filter(Boolean).join(' ')}`);
    }
    if (exif.dateTime) lines.push(`Taken: ${exif.dateTime}`);
    if (exif.orientation && exif.orientation !== 1) {
        lines.push(`Orientation: ${ORIENTATION_LABELS[exif.orientation] ?? exif.orientation}`);
    }
    return lines;
}

/** Read just enough of a File to parse its metadata. */
export async function readExifFromFile(file, { maxBytes = 256 * 1024 } = {}) {
    try {
        const slice = file.slice(0, Math.min(maxBytes, file.size));
        return parseExif(await slice.arrayBuffer());
    } catch {
        return null;
    }
}
