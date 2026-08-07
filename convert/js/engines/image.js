// Image -> image conversion, on the canvas. No dependencies, no network.
//
// Engine contract, shared with every other engine so the page controller never
// needs to know which one it is talking to:
//
//   export const id, kinds
//   export async function convert(file, { target, options, signal, onProgress })
//       -> { blob, filename, meta }

import {
    canvasToBlob,
    compressToTarget,
    decodeImageFile,
    downscaleStepped,
    drawWithBackground,
    encodeVerified,
    fitWithin,
    isLossless,
} from '../../../js/shared/image.js';
import { outputName } from '../../../js/shared/convert-registry.js';
import { parseTargetBytes } from '../../../js/shared/compression.js';

export const id = 'image';
export const kinds = Object.freeze(['image']);

/** Draw a decoded image onto a canvas, resizing if asked. */
function toCanvas(source, maxDimension) {
    const fit = maxDimension
        ? fitWithin(source.width, source.height, maxDimension)
        : { width: source.width, height: source.height, scale: 1 };

    // Stepped halving rather than one jump: a single draw from 4000px to 500px
    // samples roughly one source pixel in 64 and looks it.
    if (fit.scale < 1) return downscaleStepped(source, fit.width, fit.height);

    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d').drawImage(source, 0, 0);
    return canvas;
}

export async function convert(file, { target, options = {}, signal, onProgress = () => {} }) {
    onProgress({ phase: 'read', ratio: 0, note: 'Decoding…' });

    // createImageBitmap applies EXIF orientation, so phone photos convert
    // upright rather than sideways.
    const source = await decodeImageFile(file);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const maxDimension = options.resize && options.resize !== 'original'
        ? Number(options.resize)
        : null;

    onProgress({ phase: 'run', ratio: 0.4, note: 'Converting…' });
    const canvas = toCanvas(source, maxDimension);
    const background = options.matte || '#ffffff';
    const targetBytes = parseTargetBytes(options.targetSize?.value, options.targetSize?.unit);

    let blob;
    if (targetBytes) {
        const result = await compressToTarget(canvas, target.mime, targetBytes, {
            background,
            onProgress: ({ attempt, size }) => onProgress({
                phase: 'run',
                ratio: Math.min(0.9, 0.4 + attempt * 0.06),
                note: `Attempt ${attempt}: ${Math.round(size / 1024)} KB`,
            }),
        });
        blob = result.blob;
    } else {
        const matted = drawWithBackground(canvas, target.mime, background);
        const quality = isLossless(target.mime)
            ? undefined
            : Number(options.quality ?? 80) / 100;

        // encodeVerified reports the browser silently substituting PNG for a
        // format it cannot encode, which would otherwise save a PNG named .avif.
        const encoded = await encodeVerified(matted, target.mime, quality);
        if (encoded.fellBack) {
            throw new Error(
                `Your browser cannot encode ${target.label}. `
                + 'The file would have been a PNG with the wrong extension, so nothing was saved.',
            );
        }
        blob = encoded.blob;
    }

    onProgress({ phase: 'done', ratio: 1, note: '' });

    return {
        blob,
        filename: outputName(file.name, target),
        meta: { width: canvas.width, height: canvas.height },
    };
}

// Re-exported so tests can exercise the resize decision without a canvas.
export { fitWithin, canvasToBlob };
