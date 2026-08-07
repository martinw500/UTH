import {
    FAVICON_SIZES,
    ICO_SIZES,
    encodeDimension,
    encodeIcoHeader,
    encodeIcoDirEntry,
    buildIco,
} from '../js/shared/ico.js';

const png = (n, byte = 0x89) => new Uint8Array(n).fill(byte);
const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const readU16 = (u8, at) => view(u8).getUint16(at, true);
const readU32 = (u8, at) => view(u8).getUint32(at, true);
const toBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

describe('encodeDimension', () => {
    test.each([[16, 16], [32, 32], [48, 48], [128, 128], [255, 255]])(
        '%ipx is written as %i', (size, expected) => {
            expect(encodeDimension(size)).toBe(expected);
        },
    );

    // The field is one byte, so 256 cannot be written literally. The format
    // says 0 means 256, and writing 256 would truncate to 0 anyway.
    test('256px is written as 0, which the format defines as 256', () => {
        expect(encodeDimension(256)).toBe(0);
    });
});

describe('header and directory layout', () => {
    test('the header declares an icon and a count', () => {
        const header = encodeIcoHeader(3);
        expect(readU16(header, 0)).toBe(0);   // reserved
        expect(readU16(header, 2)).toBe(1);   // 1 = icon, 2 = cursor
        expect(readU16(header, 4)).toBe(3);
        expect(header.length).toBe(6);
    });

    test('a directory entry records size, length and offset', () => {
        const entry = encodeIcoDirEntry({
            width: 32, height: 32, byteLength: 1234, offset: 5678,
        });
        expect(entry[0]).toBe(32);
        expect(entry[1]).toBe(32);
        expect(entry[2]).toBe(0);             // no palette
        expect(readU16(entry, 4)).toBe(1);    // colour planes
        expect(readU16(entry, 6)).toBe(32);   // bits per pixel
        expect(readU32(entry, 8)).toBe(1234);
        expect(readU32(entry, 12)).toBe(5678);
        expect(entry.length).toBe(16);
    });
});

describe('buildIco', () => {
    test('writes a header, one entry per image, then the payloads', async () => {
        const ico = await toBytes(await buildIco([
            { size: 16, data: png(40) },
            { size: 32, data: png(80) },
        ]));

        expect(readU16(ico, 2)).toBe(1);
        expect(readU16(ico, 4)).toBe(2);
        expect(ico.length).toBe(6 + 16 * 2 + 40 + 80);
    });

    // A wrong offset is the classic way an icon file parses but renders blank.
    test('every offset points at the payload it describes', async () => {
        const ico = await toBytes(await buildIco([
            { size: 16, data: png(40, 0xaa) },
            { size: 32, data: png(80, 0xbb) },
            { size: 48, data: png(120, 0xcc) },
        ]));

        const count = readU16(ico, 4);
        expect(count).toBe(3);

        const expectedFill = [0xaa, 0xbb, 0xcc];
        for (let i = 0; i < count; i += 1) {
            const entry = 6 + i * 16;
            const length = readU32(ico, entry + 8);
            const offset = readU32(ico, entry + 12);
            expect(offset + length).toBeLessThanOrEqual(ico.length);
            expect(ico[offset]).toBe(expectedFill[i]);
            expect(ico[offset + length - 1]).toBe(expectedFill[i]);
        }
    });

    test('the first payload begins immediately after the directory', async () => {
        const ico = await toBytes(await buildIco([
            { size: 16, data: png(10) }, { size: 32, data: png(10) },
        ]));
        expect(readU32(ico, 6 + 12)).toBe(6 + 16 * 2);
    });

    test('images are ordered smallest first regardless of input order', async () => {
        const ico = await toBytes(await buildIco([
            { size: 48, data: png(30) },
            { size: 16, data: png(10) },
            { size: 32, data: png(20) },
        ]));
        expect([ico[6], ico[6 + 16], ico[6 + 32]]).toEqual([16, 32, 48]);
    });

    test('a 256px image is recorded as 0 in the directory', async () => {
        const ico = await toBytes(await buildIco([{ size: 256, data: png(50) }]));
        expect(ico[6]).toBe(0);
        expect(ico[7]).toBe(0);
    });

    test('accepts typed arrays, ArrayBuffers and Blobs', async () => {
        const ico = await buildIco([
            { size: 16, data: png(10) },
            { size: 32, data: png(10).buffer },
            { size: 48, data: new Blob([png(10)]) },
        ]);
        expect(readU16(await toBytes(ico), 4)).toBe(3);
    });

    test('the blob is typed as an icon', async () => {
        const ico = await buildIco([{ size: 16, data: png(10) }]);
        expect(ico.type).toBe('image/x-icon');
    });

    test('refuses to write an empty icon', async () => {
        await expect(buildIco([])).rejects.toThrow(/at least one/i);
        await expect(buildIco(null)).rejects.toThrow(/at least one/i);
    });

    test('rejects a payload it cannot read', async () => {
        await expect(buildIco([{ size: 16, data: 42 }])).rejects.toThrow(/unsupported/i);
    });
});

describe('size sets', () => {
    test('every ICO size is also a favicon size', () => {
        for (const size of ICO_SIZES) expect(FAVICON_SIZES).toContain(size);
    });

    test('the sets are sorted and frozen', () => {
        for (const set of [FAVICON_SIZES, ICO_SIZES]) {
            expect(Object.isFrozen(set)).toBe(true);
            expect([...set].sort((a, b) => a - b)).toEqual([...set]);
        }
    });

    test('the sizes browsers and Windows actually ask for are present', () => {
        for (const size of [16, 32, 48]) expect(ICO_SIZES).toContain(size);
        // Apple touch icon and the common Android manifest sizes.
        for (const size of [180, 192, 512]) expect(FAVICON_SIZES).toContain(size);
    });
});
