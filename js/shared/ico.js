// A Windows .ico writer.
//
// The container is trivial -- a 6-byte header, a 16-byte directory entry per
// image, then the payloads -- and PNG-in-ICO has been understood by Windows
// since Vista and by every browser, so there is no need to encode BMP.
//
// Hand-written for the same reason as zip.js: the whole thing is byte layout,
// which means it is fully testable in jsdom, where a vendored library would be
// opaque.

const ICO_TYPE = 1;   // 2 would be a cursor
const HEADER_SIZE = 6;
const ENTRY_SIZE = 16;

/** Sizes a favicon set conventionally carries. */
export const FAVICON_SIZES = Object.freeze([16, 32, 48, 64, 128, 180, 192, 256, 512]);

/** The subset that belongs inside the .ico itself. */
export const ICO_SIZES = Object.freeze([16, 32, 48, 64, 128, 256]);

/**
 * A 256px image is stored as 0 in the directory, because the field is one byte.
 * Writing 256 there truncates to 0 anyway, but doing it deliberately documents
 * why the largest icon looks like a zero.
 */
export function encodeDimension(size) {
    return size >= 256 ? 0 : size;
}

export function encodeIcoHeader(count) {
    const bytes = new Uint8Array(HEADER_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0, true);          // reserved
    view.setUint16(2, ICO_TYPE, true);
    view.setUint16(4, count, true);
    return bytes;
}

export function encodeIcoDirEntry({ width, height, byteLength, offset }) {
    const bytes = new Uint8Array(ENTRY_SIZE);
    const view = new DataView(bytes.buffer);
    bytes[0] = encodeDimension(width);
    bytes[1] = encodeDimension(height);
    bytes[2] = 0;                        // palette size; 0 for truecolour
    bytes[3] = 0;                        // reserved
    view.setUint16(4, 1, true);          // colour planes
    view.setUint16(6, 32, true);         // bits per pixel
    view.setUint32(8, byteLength, true);
    view.setUint32(12, offset, true);
    return bytes;
}

/**
 * Build an .ico from PNG payloads.
 *
 * @param {{size: number, data: Uint8Array|ArrayBuffer|Blob}[]} images
 * @returns {Promise<Blob>}
 */
export async function buildIco(images) {
    if (!Array.isArray(images) || images.length === 0) {
        throw new Error('An icon needs at least one image.');
    }
    if (images.length > 0xffff) {
        throw new Error('Too many images for one icon file.');
    }

    const payloads = [];
    for (const image of images) {
        const { data } = image;
        let bytes;
        if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
            bytes = new Uint8Array(data);
        } else if (data && typeof data.arrayBuffer === 'function') {
            bytes = new Uint8Array(await data.arrayBuffer());
        } else {
            throw new TypeError('Unsupported icon payload');
        }
        payloads.push({ size: image.size, bytes });
    }

    // Smallest first is conventional and is the order tools expect.
    payloads.sort((a, b) => a.size - b.size);

    let offset = HEADER_SIZE + ENTRY_SIZE * payloads.length;
    const parts = [encodeIcoHeader(payloads.length)];
    const entries = [];

    for (const { size, bytes } of payloads) {
        entries.push(encodeIcoDirEntry({
            width: size, height: size, byteLength: bytes.length, offset,
        }));
        offset += bytes.length;
    }

    parts.push(...entries, ...payloads.map((p) => p.bytes));
    return new Blob(parts, { type: 'image/x-icon' });
}
