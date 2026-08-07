// Rendering an edit state onto a canvas.
//
// There is exactly ONE renderer, used by both the live preview and the export.
// The old editor had two: the preview set ctx.filter while the export baked
// filters into a throwaway canvas, and geometry ops destructively flattened the
// backing canvas in between. The two paths disagreed, so the preview showed
// something the export did not produce.

import {
    buildFilterString,
    needsConvolution,
    normaliseRotation,
    FULL_RECT,
} from '../../js/shared/pipeline.js';
import {
    fitBox,
    normalisedToPx,
    rotatedBounds,
    largestInscribedRect,
} from '../../js/shared/geometry.js';
import { unsharpMask } from '../../js/shared/convolve.js';
import { downscaleStepped } from '../../js/shared/image.js';

function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
}

/** Crop the source to the state's normalised rect. */
function applyCrop(source, crop) {
    const rect = crop ?? FULL_RECT;
    if (rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1) return source;

    const px = normalisedToPx(rect, source.width, source.height);
    const out = makeCanvas(px.width, px.height);
    out.getContext('2d').drawImage(
        source, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height,
    );
    return out;
}

/** Rotate by a multiple of 90 and/or mirror. */
function applyOrientation(source, rotation, flipH, flipV) {
    const angle = normaliseRotation(rotation);
    if (!angle && !flipH && !flipV) return source;

    const swaps = angle % 180 === 90;
    const out = makeCanvas(
        swaps ? source.height : source.width,
        swaps ? source.width : source.height,
    );
    const ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    return out;
}

/**
 * Rotate by an arbitrary angle, optionally trimming the empty corners.
 *
 * Without the trim a straighten leaves transparent wedges, which then matte to
 * white in a JPEG — so auto-crop is the default.
 */
function applyStraighten(source, angleDeg, autoCrop) {
    if (!angleDeg) return source;

    const bounds = rotatedBounds(source.width, source.height, angleDeg);
    const rotated = makeCanvas(bounds.width, bounds.height);
    const ctx = rotated.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);

    if (!autoCrop) return rotated;

    const inner = largestInscribedRect(source.width, source.height, angleDeg);
    if (inner.width < 1 || inner.height < 1) return rotated;

    const out = makeCanvas(inner.width, inner.height);
    out.getContext('2d').drawImage(
        rotated,
        (rotated.width - inner.width) / 2,
        (rotated.height - inner.height) / 2,
        inner.width, inner.height,
        0, 0, inner.width, inner.height,
    );
    return out;
}

/** Resize to an explicit size under a fit/cover/stretch mode. */
function applyResize(source, resize, background) {
    if (!resize || !resize.width || !resize.height) return source;

    const mode = resize.mode || 'fit';
    const box = fitBox(source.width, source.height, resize.width, resize.height, mode);

    // Stepping only helps when shrinking, and only when the whole source is
    // used; a cover crop already discards the overflow.
    const scaled = (mode !== 'cover' && box.dw < source.width / 2)
        ? downscaleStepped(source, box.dw, box.dh)
        : source;

    const out = makeCanvas(resize.width, resize.height);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Letterbox bars are real pixels in the output, so they need the matte
    // colour rather than being left transparent.
    if (mode === 'fit' && background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, out.width, out.height);
    }

    if (scaled === source) {
        ctx.drawImage(source, box.sx, box.sy, box.sw, box.sh, box.dx, box.dy, box.dw, box.dh);
    } else {
        ctx.drawImage(scaled, box.dx, box.dy, box.dw, box.dh);
    }
    return out;
}

/** Sharpen, which CSS filters cannot express. */
function applySharpen(source, amount) {
    const ctx = source.getContext ? source.getContext('2d') : null;
    if (!ctx) return source;

    const image = ctx.getImageData(0, 0, source.width, source.height);
    const sharpened = unsharpMask(image.data, source.width, source.height, {
        amount: amount / 100,
    });
    ctx.putImageData(new ImageData(sharpened, source.width, source.height), 0, 0);
    return source;
}

/**
 * Render `source` under `state` and return a new canvas.
 *
 * Order is crop -> straighten -> rotate/flip -> resize -> colour -> sharpen.
 * Geometry first so filters are never resampled by a later scale; sharpen last
 * so it operates on the pixels that actually ship.
 *
 * `previewScale` renders a smaller canvas for the on-screen preview. It changes
 * only the pixel count, never the pipeline, which is what keeps preview and
 * export in agreement.
 */
export function renderState(source, state, {
    background = null,
    previewScale = 1,
    skipSharpen = false,
} = {}) {
    let canvas = applyCrop(source, state.crop);
    canvas = applyStraighten(canvas, state.straighten, state.autoCropStraighten);
    canvas = applyOrientation(canvas, state.rotate, state.flipH, state.flipV);
    canvas = applyResize(canvas, state.resize, background);

    const targetW = Math.max(1, Math.round(canvas.width * previewScale));
    const targetH = Math.max(1, Math.round(canvas.height * previewScale));

    const filter = buildFilterString(state.adjust);
    const needsScale = previewScale !== 1;

    // One draw applies both the scale and the colour filters.
    const out = makeCanvas(targetW, targetH);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.filter = filter;
    ctx.drawImage(
        needsScale && targetW < canvas.width / 2
            ? downscaleStepped(canvas, targetW, targetH)
            : canvas,
        0, 0, targetW, targetH,
    );
    ctx.filter = 'none';

    if (!skipSharpen && needsConvolution(state.adjust)) {
        applySharpen(out, state.adjust.sharpen);
    }

    return out;
}

/** Scale that fits an image into the preview area without upscaling it. */
export function previewScaleFor(width, height, containerWidth, maxHeight = 500) {
    const available = containerWidth > 0 ? containerWidth : 800;
    return Math.min(1, available / width, maxHeight / height);
}
