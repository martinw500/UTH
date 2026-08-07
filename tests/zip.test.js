import {
    ZIP_LIMITS,
    crc32,
    dosDateTime,
    shouldStore,
    encodeLocalHeader,
    encodeCentralEntry,
    encodeEndOfCentralDirectory,
    buildZip,
} from '../js/shared/zip.js';

const bytes = (text) => new TextEncoder().encode(text);
const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const readU16 = (u8, at) => view(u8).getUint16(at, true);
const readU32 = (u8, at) => view(u8).getUint32(at, true);

async function zipToBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

describe('crc32', () => {
    // Published vectors. Getting the polynomial or the reflection wrong still
    // produces plausible-looking numbers, so these are checked against known
    // values rather than against ourselves.
    test.each([
        ['', 0x00000000],
        ['a', 0xe8b7be43],
        ['abc', 0x352441c2],
        ['123456789', 0xcbf43926],
        ['The quick brown fox jumps over the lazy dog', 0x414fa339],
    ])('crc32(%p)', (text, expected) => {
        expect(crc32(bytes(text))).toBe(expected);
    });

    test('is always an unsigned 32-bit value', () => {
        const crc = crc32(bytes('The quick brown fox jumps over the lazy dog'));
        expect(crc).toBeGreaterThanOrEqual(0);
        expect(crc).toBeLessThanOrEqual(0xffffffff);
    });

    test('can be computed incrementally', () => {
        const whole = crc32(bytes('123456789'));
        const piecewise = crc32(bytes('56789'), crc32(bytes('1234')));
        expect(piecewise).toBe(whole);
    });
});

describe('dosDateTime', () => {
    test('encodes a date into the DOS fields', () => {
        const { time, date } = dosDateTime(new Date(2024, 4, 17, 13, 45, 30));
        expect((date >> 9) + 1980).toBe(2024);
        expect((date >> 5) & 0x0f).toBe(5);      // May
        expect(date & 0x1f).toBe(17);
        expect((time >> 11) & 0x1f).toBe(13);
        expect((time >> 5) & 0x3f).toBe(45);
        expect((time & 0x1f) * 2).toBe(30);      // two-second resolution
    });

    // The DOS epoch is 1980; an earlier date would otherwise wrap to a
    // nonsense year and some tools reject the archive.
    test('clamps dates before the 1980 epoch', () => {
        const { date } = dosDateTime(new Date(1970, 0, 1));
        expect((date >> 9) + 1980).toBe(1980);
    });
});

describe('shouldStore', () => {
    // DEFLATE gains ~0% on these and costs real time, so storing is the better
    // default rather than a shortcut.
    test.each(['photo.jpg', 'a.png', 'clip.mp4', 'song.mp3', 'x.webp', 'archive.zip', 'doc.pdf'])(
        '%s is stored, not deflated',
        (name) => expect(shouldStore(name)).toBe(true),
    );

    test.each(['data.json', 'page.html', 'notes.txt', 'icon.svg'])(
        '%s is worth deflating',
        (name) => expect(shouldStore(name)).toBe(false),
    );

    test('falls back to the MIME type when the name is unhelpful', () => {
        expect(shouldStore('blob', 'image/png')).toBe(true);
        expect(shouldStore('blob', 'application/json')).toBe(false);
    });

    test('is case insensitive', () => {
        expect(shouldStore('PHOTO.JPEG')).toBe(true);
    });
});

describe('byte layout', () => {
    const header = {
        nameBytes: bytes('a.txt'),
        method: 0,
        crc: 0x12345678,
        compressedSize: 5,
        size: 5,
        time: 0x6000,
        date: 0x5000,
    };

    test('local header starts with the right signature and fields', () => {
        const out = encodeLocalHeader(header);
        expect(readU32(out, 0)).toBe(0x04034b50);
        expect(readU16(out, 6)).toBe(0x0800);          // UTF-8 filename flag
        expect(readU16(out, 8)).toBe(0);               // method: store
        expect(readU32(out, 14)).toBe(0x12345678);     // crc
        expect(readU32(out, 18)).toBe(5);              // compressed size
        expect(readU32(out, 22)).toBe(5);              // uncompressed size
        expect(readU16(out, 26)).toBe(5);              // filename length
        expect(out.length).toBe(30 + 5);
    });

    test('central entry records the local header offset', () => {
        const out = encodeCentralEntry({ ...header, localOffset: 1234 });
        expect(readU32(out, 0)).toBe(0x02014b50);
        expect(readU32(out, 42)).toBe(1234);
        expect(out.length).toBe(46 + 5);
    });

    test('EOCD records the count, size and offset', () => {
        const out = encodeEndOfCentralDirectory(3, 200, 900);
        expect(readU32(out, 0)).toBe(0x06054b50);
        expect(readU16(out, 8)).toBe(3);
        expect(readU16(out, 10)).toBe(3);
        expect(readU32(out, 12)).toBe(200);
        expect(readU32(out, 16)).toBe(900);
        expect(out.length).toBe(22);
    });
});

describe('buildZip', () => {
    test('produces a readable archive of one stored file', async () => {
        const zip = await zipToBytes(await buildZip(
            [{ name: 'hello.jpg', data: bytes('hello') }],
            { compress: 'store' },
        ));

        expect(readU32(zip, 0)).toBe(0x04034b50);
        // The EOCD is the last 22 bytes when there is no archive comment.
        const eocd = zip.length - 22;
        expect(readU32(zip, eocd)).toBe(0x06054b50);
        expect(readU16(zip, eocd + 8)).toBe(1);
    });

    test('the central directory offset actually points at the central directory', async () => {
        const zip = await zipToBytes(await buildZip([
            { name: 'a.jpg', data: bytes('aaaa') },
            { name: 'b.jpg', data: bytes('bbbbbb') },
        ]));
        const eocd = zip.length - 22;
        const centralOffset = readU32(zip, eocd + 16);
        expect(readU32(zip, centralOffset)).toBe(0x02014b50);
    });

    // A wrong local-header offset is the classic way an archive opens in
    // Windows Explorer (which scans) but fails in 7-Zip (which seeks).
    test('every central entry points at a real local header', async () => {
        const zip = await zipToBytes(await buildZip([
            { name: 'a.jpg', data: bytes('aaaa') },
            { name: 'b.jpg', data: bytes('bb') },
            { name: 'c.jpg', data: bytes('cccccccc') },
        ]));

        const eocd = zip.length - 22;
        const count = readU16(zip, eocd + 8);
        let cursor = readU32(zip, eocd + 16);

        for (let i = 0; i < count; i += 1) {
            expect(readU32(zip, cursor)).toBe(0x02014b50);
            const nameLength = readU16(zip, cursor + 28);
            const localOffset = readU32(zip, cursor + 42);
            expect(readU32(zip, localOffset)).toBe(0x04034b50);
            cursor += 46 + nameLength;
        }
        expect(cursor).toBe(eocd);
    });

    test('records a correct CRC for the stored content', async () => {
        const payload = bytes('123456789');
        const zip = await zipToBytes(await buildZip(
            [{ name: 'n.jpg', data: payload }], { compress: 'store' },
        ));
        expect(readU32(zip, 14)).toBe(crc32(payload));
    });

    test('the uncompressed size is always the real size', async () => {
        const payload = bytes('x'.repeat(500));
        const zip = await zipToBytes(await buildZip(
            [{ name: 'n.txt', data: payload }],
        ));
        expect(readU32(zip, 22)).toBe(500);
    });

    test('accepts strings, Uint8Arrays, ArrayBuffers and Blobs', async () => {
        const zip = await buildZip([
            { name: 'a.txt', data: 'plain string' },
            { name: 'b.txt', data: bytes('typed array') },
            { name: 'c.txt', data: bytes('array buffer').buffer },
            { name: 'd.txt', data: new Blob(['blob']) },
        ]);
        const out = await zipToBytes(zip);
        expect(readU16(out, out.length - 22 + 8)).toBe(4);
    });

    test('the blob is typed as a zip', async () => {
        const zip = await buildZip([{ name: 'a.jpg', data: bytes('a') }]);
        expect(zip.type).toBe('application/zip');
    });

    // Two files of the same name make an archive different tools disagree
    // about, so the second is renamed rather than shadowing the first.
    test('duplicate names are made unique', async () => {
        const zip = await zipToBytes(await buildZip([
            { name: 'photo.jpg', data: bytes('one') },
            { name: 'photo.jpg', data: bytes('two') },
        ]));
        const text = new TextDecoder().decode(zip);
        expect(text).toContain('photo.jpg');
        expect(text).toContain('photo (2).jpg');
    });

    test('non-ASCII filenames are flagged UTF-8', async () => {
        const zip = await zipToBytes(await buildZip([{ name: 'café ☕.jpg', data: bytes('x') }]));
        expect(readU16(zip, 6) & 0x0800).toBe(0x0800);
        expect(new TextDecoder().decode(zip)).toContain('café ☕.jpg');
    });

    test('refuses an empty archive rather than writing a useless one', async () => {
        await expect(buildZip([])).rejects.toThrow(/nothing to zip/i);
    });

    test('refuses more entries than the format can address', async () => {
        const many = { length: ZIP_LIMITS.maxEntries + 1 };
        await expect(buildZip(Array.from(many, (_, i) => ({
            name: `${i}.jpg`, data: bytes('x'),
        })))).rejects.toThrow(/more than/i);
    });

    test('rejects a payload it cannot read', async () => {
        await expect(buildZip([{ name: 'a.jpg', data: 42 }]))
            .rejects.toThrow(/unsupported/i);
    });
});
