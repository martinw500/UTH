// Canvas encode/compress helpers.
//
// Fixes several long-standing image-editor bugs at the source: JPEG exports
// compositing transparency to black, a "webp" file that is silently a PNG, and
// a target-size search that could neither reach quality 1.0 nor ever hit a
// small target for a large photo.

// Chrome silently produces a blank canvas past this; better to refuse loudly.
export const MAX_CANVAS_DIMENSION = 16384;

export const MIME_BY_FORMAT = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
};

export const EXT_BY_MIME = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/avif': 'avif',
};

/** Formats with no alpha channel, which therefore need a background matte. */
const OPAQUE_MIMES = new Set(['image/jpeg']);

/** Quality is meaningless for lossless formats. */
export const isLossless = (mime) => mime === 'image/png';

export function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error(`Could not encode as ${mime}`))),
            mime,
            isLossless(mime) ? undefined : quality,
        );
    });
}

/**
 * Encode, and report whether the browser actually honoured the format.
 *
 * toBlob falls back to PNG when it cannot encode the requested type, with no
 * error -- which is how a file could be saved as .webp while containing a PNG.
 */
export async function encodeVerified(canvas, mime, quality) {
    const blob = await canvasToBlob(canvas, mime, quality);
    const actualMime = blob.type || mime;
    return { blob, actualMime, fellBack: actualMime !== mime };
}

/** Is this format encodable here? Cheap 1x1 probe, cached per format. */
const encodeSupport = new Map();
export function canEncode(mime) {
    if (encodeSupport.has(mime)) return encodeSupport.get(mime);
    let supported = false;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        supported = canvas.toDataURL(mime).startsWith(`data:${mime}`);
    } catch {
        supported = false;
    }
    encodeSupport.set(mime, supported);
    return supported;
}

/**
 * Copy a canvas, laying it over an opaque background when the target format
 * has no alpha channel.
 *
 * Without this, exporting a transparent PNG to JPEG yields a black background,
 * because an untouched canvas is transparent *black*.
 */
export function drawWithBackground(source, mime, background = '#ffffff') {
    const needsMatte = OPAQUE_MIMES.has(mime) && background !== null;
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext('2d');
    if (needsMatte) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(source, 0, 0);
    return out;
}

/** Scale w x h down to fit within maxDim, preserving aspect ratio. */
export function fitWithin(width, height, maxDim) {
    const longest = Math.max(width, height);
    if (longest <= maxDim) return { width, height, scale: 1 };
    const scale = maxDim / longest;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        scale,
    };
}

function scaledCopy(source, scale) {
    if (scale >= 1) return source;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(source.width * scale));
    out.height = Math.max(1, Math.round(source.height * scale));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out;
}

/**
 * Encode a canvas to at most `targetBytes`.
 *
 * Pure: returns a result object and never touches the DOM, so it can be tested
 * and reused. Progress is reported through `onProgress`.
 *
 * Strategy -- three fixes over a plain binary search on quality:
 *  1. Probe maxQuality first, so an already-small image is returned untouched
 *     instead of being needlessly re-encoded at ~0.999.
 *  2. Binary search quality only within [minQuality, maxQuality].
 *  3. If even minQuality overshoots, progressively downscale. Without this a
 *     4000x3000 photo can never reach a 50 KB target at any quality.
 */
export async function compressToTarget(canvas, mime, targetBytes, {
    minQuality = 0.3,
    maxQuality = 0.95,
    maxIterations = 8,
    allowDownscale = true,
    minScale = 0.2,
    background = '#ffffff',
    onProgress = () => {},
} = {}) {
    const source = drawWithBackground(canvas, mime, background);

    if (isLossless(mime)) {
        // PNG ignores the quality argument entirely, so searching over it just
        // burns identical encodes. Downscaling is the only lever available.
        const blob = await canvasToBlob(source, mime);
        if (blob.size <= targetBytes && !allowDownscale) {
            return { blob, quality: 1, scale: 1, reachedTarget: true, attempts: 1 };
        }
        if (blob.size <= targetBytes) {
            return { blob, quality: 1, scale: 1, reachedTarget: true, attempts: 1 };
        }
        return downscaleLoop(source, mime, targetBytes, { minScale, onProgress, quality: undefined, startAttempt: 1 });
    }

    let attempts = 0;
    const encode = async (cnv, quality) => {
        attempts += 1;
        const blob = await canvasToBlob(cnv, mime, quality);
        onProgress({ attempt: attempts, size: blob.size, quality, target: targetBytes });
        return blob;
    };

    // 1. Best-quality probe.
    const best = await encode(source, maxQuality);
    if (best.size <= targetBytes) {
        return { blob: best, quality: maxQuality, scale: 1, reachedTarget: true, attempts };
    }

    // 2. Binary search within the allowed quality band.
    let lo = minQuality;
    let hi = maxQuality;
    let found = null;
    let foundQuality = minQuality;

    for (let i = 0; i < maxIterations && hi - lo > 0.01; i += 1) {
        const mid = (lo + hi) / 2;
        const blob = await encode(source, mid);
        if (blob.size <= targetBytes) {
            found = blob;
            foundQuality = mid;
            lo = mid;
        } else {
            hi = mid;
        }
    }

    if (found) {
        return { blob: found, quality: foundQuality, scale: 1, reachedTarget: true, attempts };
    }

    // 3. Even the floor quality is too big -- shrink the pixels instead.
    if (!allowDownscale) {
        const blob = await encode(source, minQuality);
        return { blob, quality: minQuality, scale: 1, reachedTarget: blob.size <= targetBytes, attempts };
    }

    return downscaleLoop(source, mime, targetBytes, {
        minScale, onProgress, quality: minQuality, startAttempt: attempts,
    });
}

async function downscaleLoop(source, mime, targetBytes, { minScale, onProgress, quality, startAttempt }) {
    let attempts = startAttempt;
    let scale = 1;
    let last = null;

    while (scale > minScale) {
        scale *= 0.75;
        if (scale < minScale) scale = minScale;
        const blob = await canvasToBlob(scaledCopy(source, scale), mime, quality);
        attempts += 1;
        onProgress({ attempt: attempts, size: blob.size, quality, scale, target: targetBytes });
        last = blob;
        if (blob.size <= targetBytes) {
            return { blob, quality: quality ?? 1, scale, reachedTarget: true, attempts };
        }
        if (scale === minScale) break;
    }

    return { blob: last, quality: quality ?? 1, scale, reachedTarget: false, attempts };
}

/**
 * Decode a File into an ImageBitmap or HTMLImageElement.
 *
 * Prefers createImageBitmap with imageOrientation:'from-image', which applies
 * EXIF rotation -- otherwise phone photos come out sideways.
 */
export async function decodeImageFile(file) {
    if (typeof createImageBitmap === 'function') {
        try {
            return await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch {
            // Older Safari rejects the options bag; fall through.
        }
    }

    const url = URL.createObjectURL(file);
    try {
        return await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Could not decode this image.'));
            img.src = url;
        });
    } finally {
        // Safe: the decoded image keeps its own copy of the pixels.
        URL.revokeObjectURL(url);
    }
}
