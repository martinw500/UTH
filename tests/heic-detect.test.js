/**
 * @jest-environment node
 */

// isHeif decides whether decodeImageFile loads the ~2 MB HEIC decoder. It goes
// by bytes because iOS and Windows often give .heic files an empty type.
// Node's Blob, because jsdom's has no arrayBuffer().

import { isHeif } from '../js/shared/image.js';

const ftyp = (major, ...compatible) => {
    const brands = [major, '\0\0\0\0', ...compatible].join('');
    const bytes = new Uint8Array(8 + brands.length);
    new DataView(bytes.buffer).setUint32(0, bytes.length, false);
    bytes.set(Array.from('ftyp' + brands, (c) => c.charCodeAt(0)), 4);
    return new Blob([bytes, new Uint8Array(32)]);
};

describe('isHeif', () => {
    test('an iPhone photo (major brand heic)', async () => {
        expect(await isHeif(ftyp('heic', 'mif1', 'heic'))).toBe(true);
    });

    test('a HEIF whose major brand is generic but lists heic as compatible', async () => {
        expect(await isHeif(ftyp('mif1', 'heic'))).toBe(true);
    });

    // Browsers decode AVIF themselves; routing it to libheif would be a 2 MB
    // download for nothing (and this build has no AV1 decoder).
    test('AVIF is not HEIF for this purpose', async () => {
        expect(await isHeif(ftyp('avif', 'mif1', 'miaf', 'avif'))).toBe(false);
    });

    test('an MP4 is not', async () => {
        expect(await isHeif(ftyp('isom', 'iso2', 'mp41'))).toBe(false);
    });

    test('a JPEG, or nothing at all, is not', async () => {
        expect(await isHeif(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]))).toBe(false);
        expect(await isHeif(new Blob([]))).toBe(false);
    });
});
