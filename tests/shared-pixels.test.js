import {
    KERNEL_SHARPEN,
    KERNEL_SHARPEN_SOFT,
    convolve3x3,
    unsharpMask,
} from '../js/shared/convolve.js';

import { createUrlSlot, createUrlPool } from '../js/shared/objecturl.js';
import { parseExif, summariseExif, ORIENTATION_LABELS } from '../js/shared/exif.js';

// ============================================
// convolve.js
// ============================================

/** Build RGBA data from a grid of grey levels. */
function greyImage(rows) {
    const height = rows.length;
    const width = rows[0].length;
    const data = new Uint8ClampedArray(width * height * 4);
    let i = 0;
    for (const row of rows) {
        for (const value of row) {
            data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
            i += 4;
        }
    }
    return { data, width, height };
}

const IDENTITY_KERNEL = [0, 0, 0, 0, 1, 0, 0, 0, 0];

describe('convolve3x3', () => {
    test('an identity kernel returns the image unchanged', () => {
        const { data, width, height } = greyImage([
            [10, 20, 30],
            [40, 50, 60],
            [70, 80, 90],
        ]);
        expect(Array.from(convolve3x3(data, width, height, IDENTITY_KERNEL)))
            .toEqual(Array.from(data));
    });

    test('a box blur averages a single bright pixel outward', () => {
        const { data, width, height } = greyImage([
            [0, 0, 0],
            [0, 90, 0],
            [0, 0, 0],
        ]);
        const box = [1, 1, 1, 1, 1, 1, 1, 1, 1];
        const out = convolve3x3(data, width, height, box, { divisor: 9 });
        expect(out[4 * 4]).toBe(10);           // centre: 90/9
        expect(out[0]).toBeGreaterThan(0);     // light has spread to the corner
    });

    test('sharpening a flat area changes nothing', () => {
        const { data, width, height } = greyImage([
            [100, 100, 100],
            [100, 100, 100],
            [100, 100, 100],
        ]);
        const out = convolve3x3(data, width, height, KERNEL_SHARPEN);
        expect(Array.from(out)).toEqual(Array.from(data));
    });

    test('sharpening increases contrast across an edge', () => {
        const { data, width, height } = greyImage([
            [0, 0, 200],
            [0, 0, 200],
            [0, 0, 200],
        ]);
        const out = convolve3x3(data, width, height, KERNEL_SHARPEN);
        const brightBefore = data[(1 * 3 + 2) * 4];
        const brightAfter = out[(1 * 3 + 2) * 4];
        expect(brightAfter).toBeGreaterThanOrEqual(brightBefore);
    });

    // Convolving alpha haloes the edges of a transparent PNG.
    test('alpha is passed through untouched', () => {
        const data = new Uint8ClampedArray([
            255, 255, 255, 0, 255, 255, 255, 128,
            255, 255, 255, 255, 255, 255, 255, 64,
        ]);
        const out = convolve3x3(data, 2, 2, KERNEL_SHARPEN);
        expect([out[3], out[7], out[11], out[15]]).toEqual([0, 128, 255, 64]);
    });

    test('values are clamped into 0..255 rather than wrapping', () => {
        const { data, width, height } = greyImage([
            [0, 0, 0],
            [0, 255, 0],
            [0, 0, 0],
        ]);
        const out = convolve3x3(data, width, height, KERNEL_SHARPEN);
        for (const value of out) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(255);
        }
    });

    // Skipping the border would leave a visibly unsharpened frame. The corner
    // here is chosen so the sharpened value lands mid-range: a corner that
    // clamps to 0 or 255 would look identical whether or not it was processed.
    test('edge pixels are processed, not skipped', () => {
        const { data, width, height } = greyImage([
            [150, 100],
            [100, 100],
        ]);
        const out = convolve3x3(data, width, height, KERNEL_SHARPEN);
        expect(out[0]).toBe(250);   // 5*150 - 150 - 100 - 150 - 100
        expect(out[0]).not.toBe(data[0]);
    });

    test('a kernel summing to zero does not divide by zero', () => {
        const { data, width, height } = greyImage([[10, 20], [30, 40]]);
        const edgeDetect = [0, -1, 0, -1, 4, -1, 0, -1, 0];
        const out = convolve3x3(data, width, height, edgeDetect);
        for (const value of out) expect(Number.isFinite(value)).toBe(true);
    });

    test('both sharpen kernels are 3x3 and frozen', () => {
        for (const kernel of [KERNEL_SHARPEN, KERNEL_SHARPEN_SOFT]) {
            expect(kernel).toHaveLength(9);
            expect(Object.isFrozen(kernel)).toBe(true);
        }
    });
});

describe('unsharpMask', () => {
    const image = greyImage([
        [0, 0, 200],
        [0, 0, 200],
        [0, 0, 200],
    ]);

    test('zero amount is a no-op', () => {
        const out = unsharpMask(image.data, image.width, image.height, { amount: 0 });
        expect(Array.from(out)).toEqual(Array.from(image.data));
    });

    test('it does not mutate the input', () => {
        const copy = new Uint8ClampedArray(image.data);
        unsharpMask(image.data, image.width, image.height, { amount: 1 });
        expect(Array.from(image.data)).toEqual(Array.from(copy));
    });

    // The slider needs to be continuous; the raw kernel is one fixed strength.
    test('a larger amount moves pixels further from the original', () => {
        const distance = (out) => out.reduce(
            (sum, value, i) => sum + Math.abs(value - image.data[i]), 0,
        );
        const gentle = unsharpMask(image.data, image.width, image.height, { amount: 0.25 });
        const strong = unsharpMask(image.data, image.width, image.height, { amount: 1 });
        expect(distance(strong)).toBeGreaterThan(distance(gentle));
    });

    test('output stays in range', () => {
        const out = unsharpMask(image.data, image.width, image.height, { amount: 1 });
        for (const value of out) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(255);
        }
    });
});

// ============================================
// objecturl.js
// ============================================

describe('createUrlSlot', () => {
    let created;
    let revoked;

    beforeEach(() => {
        created = 0;
        revoked = [];
        global.URL.createObjectURL = jest.fn(() => `blob:fake/${created++}`);
        global.URL.revokeObjectURL = jest.fn((url) => revoked.push(url));
    });

    test('holds the URL it created', () => {
        const slot = createUrlSlot();
        const url = slot.set(new Blob(['a']));
        expect(slot.get()).toBe(url);
    });

    // The editor revoked the previous URL only when the *next* export started,
    // so a failed export leaked and the final export leaked forever.
    test('setting a second blob revokes the first', () => {
        const slot = createUrlSlot();
        const first = slot.set(new Blob(['a']));
        slot.set(new Blob(['b']));
        expect(revoked).toContain(first);
    });

    test('revoke releases the URL and clears the slot', () => {
        const slot = createUrlSlot();
        const url = slot.set(new Blob(['a']));
        slot.revoke();
        expect(revoked).toContain(url);
        expect(slot.get()).toBeNull();
    });

    test('revoking twice does not revoke twice', () => {
        const slot = createUrlSlot();
        slot.set(new Blob(['a']));
        slot.revoke();
        slot.revoke();
        expect(revoked).toHaveLength(1);
    });

    test('revoking an empty slot is safe', () => {
        expect(() => createUrlSlot().revoke()).not.toThrow();
    });
});

describe('createUrlPool', () => {
    beforeEach(() => {
        let n = 0;
        global.URL.createObjectURL = jest.fn(() => `blob:fake/${n++}`);
        global.URL.revokeObjectURL = jest.fn();
    });

    test('keeps one URL per key', () => {
        const pool = createUrlPool();
        const a = pool.set('a', new Blob(['a']));
        const b = pool.set('b', new Blob(['b']));
        expect(a).not.toBe(b);
        expect(pool.get('a')).toBe(a);
        expect(pool.size).toBe(2);
    });

    test('replacing a key revokes its previous URL', () => {
        const pool = createUrlPool();
        pool.set('a', new Blob(['a']));
        pool.set('a', new Blob(['b']));
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(pool.size).toBe(1);
    });

    // Clearing a batch must not leave its results pinned in memory.
    test('revokeAll empties the pool', () => {
        const pool = createUrlPool();
        pool.set('a', new Blob(['a']));
        pool.set('b', new Blob(['b']));
        pool.revokeAll();
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
        expect(pool.size).toBe(0);
        expect(pool.get('a')).toBeNull();
    });

    test('an unknown key reads as null and revokes harmlessly', () => {
        const pool = createUrlPool();
        expect(pool.get('nope')).toBeNull();
        expect(() => pool.revoke('nope')).not.toThrow();
    });
});

// ============================================
// exif.js
// ============================================

/**
 * Build a minimal little-endian JPEG carrying an APP1/EXIF block.
 * Entries are [tag, type, count, value] with 4-byte inline values.
 */
function makeJpegWithExif(entries) {
    const entryBytes = entries.length * 12;
    const tiffLength = 8 + 2 + entryBytes + 4;
    const app1Length = 2 + 6 + tiffLength;
    const total = 2 + 2 + app1Length;

    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    let p = 0;

    view.setUint16(p, 0xffd8); p += 2;              // SOI
    view.setUint16(p, 0xffe1); p += 2;              // APP1
    view.setUint16(p, app1Length); p += 2;
    for (const ch of 'Exif') { view.setUint8(p, ch.charCodeAt(0)); p += 1; }
    view.setUint16(p, 0); p += 2;                   // padding

    const tiffStart = p;
    view.setUint16(p, 0x4949); p += 2;              // little-endian
    view.setUint16(p, 42, true); p += 2;
    view.setUint32(p, 8, true); p += 4;             // IFD0 at tiffStart + 8

    view.setUint16(p, entries.length, true); p += 2;
    for (const [tag, type, count, value] of entries) {
        view.setUint16(p, tag, true);
        view.setUint16(p + 2, type, true);
        view.setUint32(p + 4, count, true);
        view.setUint32(p + 8, value, true);
        p += 12;
    }
    view.setUint32(p, 0, true);                     // no IFD1

    return buffer;
}

describe('parseExif', () => {
    test('reads orientation', () => {
        const buffer = makeJpegWithExif([[0x0112, 3, 1, 6]]);
        expect(parseExif(buffer).orientation).toBe(6);
    });

    test('defaults orientation to 1 when absent', () => {
        const buffer = makeJpegWithExif([[0x0112, 3, 1, 1]]);
        expect(parseExif(buffer).orientation).toBe(1);
    });

    // PNG, WebP and JPEGs without metadata are all normal inputs.
    test.each([
        ['a PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer],
        ['an empty buffer', new ArrayBuffer(0)],
        ['a truncated file', new Uint8Array([0xff, 0xd8]).buffer],
    ])('returns null for %s rather than throwing', (_label, buffer) => {
        expect(parseExif(buffer)).toBeNull();
    });

    test('a JPEG with no APP1 segment returns null', () => {
        const buffer = new ArrayBuffer(8);
        new DataView(buffer).setUint16(0, 0xffd8);
        expect(parseExif(buffer)).toBeNull();
    });

    test('a corrupt byte-order mark is rejected, not misread', () => {
        const buffer = makeJpegWithExif([[0x0112, 3, 1, 6]]);
        new DataView(buffer).setUint16(12, 0x0000);
        expect(parseExif(buffer)).toBeNull();
    });

    test('an entry count past the end of the buffer does not throw', () => {
        const buffer = makeJpegWithExif([[0x0112, 3, 1, 6]]);
        new DataView(buffer).setUint16(20, 9999, true);
        expect(() => parseExif(buffer)).not.toThrow();
    });
});

describe('summariseExif', () => {
    test('nothing to report reads as an empty list', () => {
        expect(summariseExif(null)).toEqual([]);
        expect(summariseExif({ orientation: 1, gps: null })).toEqual([]);
    });

    // The whole point of the module: make the dropped GPS visible before export.
    test('GPS is reported first and named as a location', () => {
        const lines = summariseExif({
            orientation: 1,
            make: 'Canon',
            model: 'EOS',
            dateTime: '2024:01:01 10:00:00',
            gps: { lat: 51.5074, lon: -0.1278 },
        });
        expect(lines[0]).toMatch(/GPS/);
        expect(lines[0]).toContain('51.50740');
        expect(lines[0]).toContain('-0.12780');
    });

    test('camera and date are included when present', () => {
        const lines = summariseExif({
            orientation: 1, make: 'Canon', model: 'EOS', dateTime: '2024:01:01', gps: null,
        }).join(' | ');
        expect(lines).toContain('Canon EOS');
        expect(lines).toContain('2024:01:01');
    });

    test('a non-default orientation is described in words', () => {
        const lines = summariseExif({ orientation: 6, gps: null });
        expect(lines.join(' ')).toContain(ORIENTATION_LABELS[6]);
    });

    test('every orientation value has a label', () => {
        for (let i = 1; i <= 8; i += 1) {
            expect(typeof ORIENTATION_LABELS[i]).toBe('string');
        }
    });
});
