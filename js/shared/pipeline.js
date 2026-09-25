// The image editor's edit state, as data.
//
// The editor used to apply each operation destructively to a backing canvas the
// moment it happened, and separately re-derive a CSS filter string for the live
// preview. Two code paths described the same image, so they could disagree --
// and did: the preview applied filters the export had already baked in, so what
// you saw was not what you saved.
//
// Here the whole edit is one plain object. Preview and export both render FROM
// it, so they cannot drift; undo is a stack of these rather than a stack of
// canvas snapshots; and every derived number is a pure function, testable
// without a canvas.

import { clampRect, rotatedBounds, largestInscribedRect } from './geometry.js';

/** Adjustments at their no-op values. */
export const IDENTITY_ADJUST = Object.freeze({
    brightness: 0,   // -100..100
    contrast: 0,     // -100..100
    saturation: 0,   // -100..100
    blur: 0,         // 0..20 (px)
    grayscale: 0,    // 0..100
    sepia: 0,        // 0..100
    invert: 0,       // 0..100
    hueRotate: 0,    // -180..180 (deg)
    sharpen: 0,      // 0..100 — NOT a CSS filter, see needsConvolution
});

/** The full crop rect, in normalised image space. */
export const FULL_RECT = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

/** A fresh edit with nothing applied. */
export function createState() {
    return {
        adjust: { ...IDENTITY_ADJUST },
        crop: { ...FULL_RECT },
        rotate: 0,          // multiples of 90
        straighten: 0,      // -45..45, applied on top of rotate
        autoCropStraighten: true,
        flipH: false,
        flipV: false,
        resize: null,       // {width, height, mode} or null to keep source size
    };
}

/** Deep-enough copy for the undo stack; every field is a primitive or flat. */
export function cloneState(state) {
    return {
        ...state,
        adjust: { ...state.adjust },
        crop: { ...state.crop },
        resize: state.resize ? { ...state.resize } : null,
    };
}

export function isIdentityAdjust(adjust) {
    return Object.keys(IDENTITY_ADJUST)
        .every((key) => adjust[key] === IDENTITY_ADJUST[key]);
}

/** True when nothing at all has been changed. */
export function isPristine(state) {
    return isIdentityAdjust(state.adjust)
        && state.crop.x === 0 && state.crop.y === 0
        && state.crop.w === 1 && state.crop.h === 1
        && state.rotate === 0
        && state.straighten === 0
        && !state.flipH && !state.flipV
        && !state.resize;
}

/**
 * The CSS filter string for the adjustments.
 *
 * Sharpen is deliberately absent: CSS has no sharpen filter, so it is applied
 * as a convolution afterwards. See needsConvolution.
 */
export function buildFilterString(adjust) {
    const parts = [];
    if (adjust.brightness) parts.push(`brightness(${100 + adjust.brightness}%)`);
    if (adjust.contrast) parts.push(`contrast(${100 + adjust.contrast}%)`);
    if (adjust.saturation) parts.push(`saturate(${100 + adjust.saturation}%)`);
    if (adjust.grayscale) parts.push(`grayscale(${adjust.grayscale}%)`);
    if (adjust.sepia) parts.push(`sepia(${adjust.sepia}%)`);
    if (adjust.invert) parts.push(`invert(${adjust.invert}%)`);
    if (adjust.hueRotate) parts.push(`hue-rotate(${adjust.hueRotate}deg)`);
    if (adjust.blur) parts.push(`blur(${adjust.blur}px)`);
    return parts.length ? parts.join(' ') : 'none';
}

/** Sharpen needs a pixel pass; everything else is a CSS filter. */
export function needsConvolution(adjust) {
    return (adjust.sharpen || 0) > 0;
}

/** Normalise a rotation to 0/90/180/270. */
export function normaliseRotation(degrees) {
    return ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
}

/**
 * Final output dimensions for a source image under this state.
 *
 * Pure, and the single source of truth for "how big will this be?" — the size
 * readout, the resize inputs and the export canvas all ask this rather than
 * each computing it slightly differently.
 */
export function outputSize(srcW, srcH, state) {
    const crop = clampRect(state.crop ?? FULL_RECT, { minW: 0, minH: 0 });
    let { width, height } = straightenedSize(
        Math.max(1, Math.round(srcW * crop.w)),
        Math.max(1, Math.round(srcH * crop.h)),
        state.straighten,
        state.autoCropStraighten,
    );

    if (normaliseRotation(state.rotate ?? 0) % 180 === 90) {
        [width, height] = [height, width];
    }

    if (state.resize && state.resize.width > 0 && state.resize.height > 0) {
        width = Math.max(1, Math.round(state.resize.width));
        height = Math.max(1, Math.round(state.resize.height));
    }

    return { width, height };
}

/** Size after a straighten, exactly as render.js's applyStraighten produces it. */
function straightenedSize(width, height, angleDeg, autoCrop) {
    if (!angleDeg) return { width, height };
    if (autoCrop) {
        const inner = largestInscribedRect(width, height, angleDeg);
        if (inner.width >= 1 && inner.height >= 1) return inner;
    }
    return rotatedBounds(width, height, angleDeg);
}

/**
 * Turn a rect drawn over the preview into the state's new source-space crop.
 *
 * The preview shows crop -> straighten -> rotate/flip, but `state.crop` is
 * applied to the source before either, so the drawn rect is walked back
 * through the orientation and the straighten, then composed with the existing
 * crop. Storing it as drawn kept the wrong region after any rotate or flip.
 *
 * Rotate and flip invert exactly. A straighten does not: the drawn rect maps
 * back to a tilted quad, so this keeps its bounding box, and the auto-crop
 * then trims slightly inside it.
 */
export function previewRectToCrop(rect, state, srcW, srcH) {
    const crop = state.crop ?? FULL_RECT;
    const angle = normaliseRotation(state.rotate ?? 0);
    const cropW = Math.max(1, srcW * crop.w);
    const cropH = Math.max(1, srcH * crop.h);
    const frame = straightenedSize(cropW, cropH, state.straighten, state.autoCropStraighten);
    const rad = ((state.straighten || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const points = [
        [rect.x, rect.y], [rect.x + rect.w, rect.y],
        [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h],
    ].map(([u, v]) => {
        // Centred, normalised to the frame being undone at each step.
        let a = u - 0.5;
        let b = v - 0.5;
        if (angle === 90) [a, b] = [b, -a];
        else if (angle === 180) [a, b] = [-a, -b];
        else if (angle === 270) [a, b] = [-b, a];
        if (state.flipH) a = -a;
        if (state.flipV) b = -b;
        if (!rad) return [a, b];
        const px = a * frame.width;
        const py = b * frame.height;
        return [(px * cos + py * sin) / cropW, (-px * sin + py * cos) / cropH];
    });

    const xs = points.map(([a]) => Math.min(1, Math.max(0, a + 0.5)));
    const ys = points.map(([, b]) => Math.min(1, Math.max(0, b + 0.5)));
    const local = {
        x: Math.min(...xs), y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
    };
    return {
        x: crop.x + local.x * crop.w,
        y: crop.y + local.y * crop.h,
        w: crop.w * local.w,
        h: crop.h * local.h,
    };
}

/** Short human summary of what is currently applied, for the UI and for tests. */
export function describeState(state, srcW, srcH) {
    const notes = [];
    const crop = state.crop ?? FULL_RECT;
    if (crop.w < 1 || crop.h < 1) {
        notes.push(`cropped to ${Math.round(crop.w * 100)}×${Math.round(crop.h * 100)}%`);
    }
    const rotation = normaliseRotation(state.rotate ?? 0);
    if (rotation) notes.push(`rotated ${rotation}°`);
    if (state.straighten) notes.push(`straightened ${state.straighten}°`);
    if (state.flipH) notes.push('flipped horizontally');
    if (state.flipV) notes.push('flipped vertically');
    if (state.resize) {
        const { width, height } = outputSize(srcW, srcH, state);
        notes.push(`resized to ${width}×${height}`);
    }
    if (!isIdentityAdjust(state.adjust)) notes.push('adjusted');
    return notes;
}
