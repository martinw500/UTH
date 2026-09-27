// HEIC decoding for browsers that have none (everything but Safari).
//
// Loaded only by decodeImageFile, and only after the browser's own decoder has
// failed on a HEIC file: the vendored library is ~2 MB of inlined wasm. It is
// LGPL-3.0, which is why it stays a separate, unmodified file (see
// js/vendor/README.md).

import libheif from '../vendor/libheif-bundle.js';

let modulePromise = null;

/**
 * Decode the primary image of a HEIC/HEIF file into an ImageBitmap.
 * libheif applies the container's rotation and mirroring (irot/imir) itself,
 * so the result is upright, like createImageBitmap's 'from-image'.
 */
export async function decodeHeic(blob) {
    modulePromise ??= Promise.resolve(libheif()).catch((error) => {
        modulePromise = null;
        throw error;
    });
    const heif = await modulePromise;

    const images = new heif.HeifDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    if (!images?.length) throw new Error('Could not read this HEIC file.');
    try {
        const image = images[0];
        const width = image.get_width();
        const height = image.get_height();
        const pixels = new ImageData(width, height);
        await new Promise((resolve, reject) => image.display(pixels, (result) => (
            result ? resolve() : reject(new Error('Could not decode this HEIC file.')))));
        return await createImageBitmap(pixels);
    } finally {
        for (const image of images) image.free?.();
    }
}
