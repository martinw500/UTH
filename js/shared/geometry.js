// Rectangle and sizing maths for the image editor.
//
// Everything here is pure and unit-free: rects are in NORMALISED image space,
// where x, y, w and h all run 0..1 relative to the image being edited.
//
// That choice is the fix for a real bug. The editor used to store the crop rect
// in canvas-attribute pixels and clamp it against `canvas.width`, while the
// drag deltas came from `getBoundingClientRect()` in CSS pixels. Those two units
// agree only when the canvas happens to be displayed at exactly its attribute
// size, so on a narrow viewport every crop landed somewhere other than where it
// was drawn. Normalised coordinates have no such split: they convert to CSS
// pixels to position the overlay and to image pixels at apply time, and are
// resolution-independent in between -- which is also what lets a single crop
// rect apply correctly to every image in a batch.

/** Smallest crop, as a fraction of the image. Below this a rect is unusable. */
export const MIN_RECT = 0.01;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Where a pointer is inside an element, as a 0..1 fraction of its box.
 *
 * Reads the element's *rendered* size, so it is correct whatever CSS has done
 * to it. Values outside the element are clamped rather than allowed to go
 * negative, so a drag that leaves the canvas pins to the edge.
 */
export function elementToNormalised(clientX, clientY, element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
        x: clamp01((clientX - rect.left) / rect.width),
        y: clamp01((clientY - rect.top) / rect.height),
    };
}

/** Normalised rect -> integer pixel rect within a width x height image. */
export function normalisedToPx(rect, width, height) {
    const x = Math.round(rect.x * width);
    const y = Math.round(rect.y * height);
    return {
        x,
        y,
        // Round the far edge rather than the size, so adjacent rects tile
        // exactly instead of drifting apart by a pixel.
        width: Math.max(1, Math.round((rect.x + rect.w) * width) - x),
        height: Math.max(1, Math.round((rect.y + rect.h) * height) - y),
    };
}

/** Integer pixel rect -> normalised, the inverse of normalisedToPx. */
export function pxToNormalised(px, width, height) {
    if (!width || !height) return { x: 0, y: 0, w: 1, h: 1 };
    return {
        x: clamp01(px.x / width),
        y: clamp01(px.y / height),
        w: clamp01(px.width / width),
        h: clamp01(px.height / height),
    };
}

/**
 * Keep a rect inside the image, preserving its size where possible.
 *
 * Translates first and only shrinks when the rect genuinely cannot fit, so
 * dragging a selection off the edge slides it back rather than squashing it.
 */
export function clampRect(rect, { minW = MIN_RECT, minH = MIN_RECT } = {}) {
    let w = Math.min(1, Math.max(minW, rect.w));
    let h = Math.min(1, Math.max(minH, rect.h));
    const x = Math.min(Math.max(0, rect.x), 1 - w);
    const y = Math.min(Math.max(0, rect.y), 1 - h);
    return { x: clamp01(x), y: clamp01(y), w, h };
}

/**
 * Parse an aspect-ratio spec into width/height, or null for unconstrained.
 *
 * Accepts '16:9', '16/9', '1.5', 'original' (needs srcW/srcH) and 'free'.
 */
export function parseRatio(spec, srcW, srcH) {
    if (spec == null || spec === 'free' || spec === '') return null;
    if (spec === 'original') {
        return srcW > 0 && srcH > 0 ? srcW / srcH : null;
    }
    if (typeof spec === 'number') return spec > 0 ? spec : null;

    const parts = String(spec).split(/[:/]/);
    if (parts.length === 2) {
        const a = parseFloat(parts[0]);
        const b = parseFloat(parts[1]);
        return a > 0 && b > 0 ? a / b : null;
    }
    const single = parseFloat(spec);
    return single > 0 ? single : null;
}

/**
 * Force a rect to an aspect ratio, holding one corner still.
 *
 * `ratio` is width/height in IMAGE pixels, but the rect is normalised, so the
 * image's own proportions have to be divided out first -- a 1:1 crop on a
 * 2000x1000 image is 0.5 x 1.0 in normalised space, not a normalised square.
 * Forgetting that is the classic way square crops come out rectangular.
 */
export function applyAspect(rect, ratio, anchor = 'nw', srcW = 1, srcH = 1) {
    if (!ratio || ratio <= 0) return rect;

    const imageAspect = srcW > 0 && srcH > 0 ? srcW / srcH : 1;
    const normalisedRatio = ratio / imageAspect;

    // Width-driven, then clamped: deterministic, and never larger than the
    // image in either axis.
    let w = rect.w;
    let h = w / normalisedRatio;
    if (h > 1) { h = 1; w = h * normalisedRatio; }
    if (w > 1) { w = 1; h = w / normalisedRatio; }

    const holdRight = anchor === 'ne' || anchor === 'se' || anchor === 'e';
    const holdBottom = anchor === 'sw' || anchor === 'se' || anchor === 's';

    let x;
    let y;
    if (anchor === 'center') {
        x = rect.x + rect.w / 2 - w / 2;
        y = rect.y + rect.h / 2 - h / 2;
    } else {
        x = holdRight ? rect.x + rect.w - w : rect.x;
        y = holdBottom ? rect.y + rect.h - h : rect.y;
    }

    return clampRect({ x, y, w, h }, { minW: 0, minH: 0 });
}

/** The corner or edge opposite a handle — the point a drag holds still. */
const OPPOSITE = {
    nw: 'se', ne: 'sw', sw: 'ne', se: 'nw',
    n: 's', s: 'n', e: 'w', w: 'e',
};

/**
 * Resize a rect by dragging one of the eight handles.
 *
 * `dx`/`dy` are normalised deltas from the drag origin. With `ratio` set this
 * is the aspect-constrained crop: the constraint is arithmetic here rather than
 * a special case in the pointer handlers.
 */
export function resizeRectByHandle(orig, handle, dx, dy, {
    ratio = null,
    minW = MIN_RECT,
    minH = MIN_RECT,
    srcW = 1,
    srcH = 1,
} = {}) {
    const movesLeft = handle.includes('w');
    const movesRight = handle.includes('e');
    const movesTop = handle.includes('n');
    const movesBottom = handle.includes('s');

    let left = orig.x;
    let top = orig.y;
    let right = orig.x + orig.w;
    let bottom = orig.y + orig.h;

    if (movesLeft) left = Math.min(orig.x + dx, right - minW);
    if (movesRight) right = Math.max(orig.x + orig.w + dx, left + minW);
    if (movesTop) top = Math.min(orig.y + dy, bottom - minH);
    if (movesBottom) bottom = Math.max(orig.y + orig.h + dy, top + minH);

    let next = {
        x: clamp01(left),
        y: clamp01(top),
        w: clamp01(right) - clamp01(left),
        h: clamp01(bottom) - clamp01(top),
    };

    // Hold the opposite corner still, so the handle under the cursor is the one
    // that appears to move.
    if (ratio) next = applyAspect(next, ratio, OPPOSITE[handle], srcW, srcH);

    return clampRect(next, { minW, minH });
}

/** Move a rect without resizing it, keeping it inside the image. */
export function moveRect(orig, dx, dy) {
    return clampRect({ x: orig.x + dx, y: orig.y + dy, w: orig.w, h: orig.h }, { minW: 0, minH: 0 });
}

/** A centred rect of the given ratio covering `coverage` of the image. */
export function centredRect(ratio, srcW, srcH, coverage = 0.8) {
    const base = { x: (1 - coverage) / 2, y: (1 - coverage) / 2, w: coverage, h: coverage };
    if (!ratio) return base;
    const sized = applyAspect(base, ratio, 'center', srcW, srcH);
    return clampRect(
        { x: (1 - sized.w) / 2, y: (1 - sized.h) / 2, w: sized.w, h: sized.h },
        { minW: 0, minH: 0 },
    );
}

/**
 * Source and destination boxes for drawing srcW x srcH into dstW x dstH.
 *
 *  - 'fit'     letterbox: whole image visible, padding around it
 *  - 'cover'   fill the frame, centre-cropping the overflow
 *  - 'stretch' exactly the requested size, distorting if need be
 */
export function fitBox(srcW, srcH, dstW, dstH, mode = 'fit') {
    const safe = (n) => (Number.isFinite(n) && n > 0 ? n : 1);
    srcW = safe(srcW); srcH = safe(srcH); dstW = safe(dstW); dstH = safe(dstH);

    if (mode === 'stretch') {
        return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: dstW, dh: dstH };
    }

    if (mode === 'cover') {
        // Take the largest source region matching the destination's aspect.
        const scale = Math.max(dstW / srcW, dstH / srcH);
        const sw = Math.min(srcW, dstW / scale);
        const sh = Math.min(srcH, dstH / scale);
        return {
            sx: (srcW - sw) / 2,
            sy: (srcH - sh) / 2,
            sw,
            sh,
            dx: 0,
            dy: 0,
            dw: dstW,
            dh: dstH,
        };
    }

    const scale = Math.min(dstW / srcW, dstH / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    return {
        sx: 0,
        sy: 0,
        sw: srcW,
        sh: srcH,
        dx: (dstW - dw) / 2,
        dy: (dstH - dh) / 2,
        dw,
        dh,
    };
}

/** Scale a size by a percentage, never rounding a dimension away to zero. */
export function sizeFromPercent(width, height, percent) {
    const factor = percent / 100;
    return {
        width: Math.max(1, Math.round(width * factor)),
        height: Math.max(1, Math.round(height * factor)),
    };
}

/** Height implied by a width at a fixed aspect ratio, and vice versa. */
export function heightForWidth(width, srcW, srcH) {
    if (!srcW) return Math.max(1, Math.round(width));
    return Math.max(1, Math.round(width * (srcH / srcW)));
}

export function widthForHeight(height, srcW, srcH) {
    if (!srcH) return Math.max(1, Math.round(height));
    return Math.max(1, Math.round(height * (srcW / srcH)));
}

const toRad = (deg) => (deg * Math.PI) / 180;

/** Bounding box of a w x h rectangle rotated by `angleDeg` about its centre. */
export function rotatedBounds(width, height, angleDeg) {
    const rad = toRad(angleDeg);
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    return {
        width: Math.max(1, Math.round(width * cos + height * sin)),
        height: Math.max(1, Math.round(width * sin + height * cos)),
    };
}

/**
 * Largest-area axis-aligned rectangle that fits wholly inside the rotated
 * image — the crop that removes the transparent corners a straighten leaves.
 *
 * Note it maximises area rather than preserving the source aspect ratio, so the
 * result is generally a different shape from the input.
 */
export function largestInscribedRect(width, height, angleDeg) {
    if (width <= 0 || height <= 0) return { width: 0, height: 0 };

    const angle = Math.abs(toRad(angleDeg)) % Math.PI;
    const a = angle > Math.PI / 2 ? Math.PI - angle : angle;
    if (a === 0) return { width, height };

    const longer = Math.max(width, height);
    const shorter = Math.min(width, height);
    const sin = Math.abs(Math.sin(a));
    const cos = Math.abs(Math.cos(a));

    let w;
    let h;
    if (shorter <= 2 * sin * cos * longer || Math.abs(sin - cos) < 1e-10) {
        // Half-constrained: the shorter side is the limit.
        const x = 0.5 * shorter;
        if (width >= height) { w = x / sin; h = x / cos; } else { w = x / cos; h = x / sin; }
    } else {
        const cos2 = cos * cos - sin * sin;
        w = (width * cos - height * sin) / cos2;
        h = (height * cos - width * sin) / cos2;
    }

    return {
        width: Math.max(0, Math.floor(Math.min(w, width))),
        height: Math.max(0, Math.floor(Math.min(h, height))),
    };
}
