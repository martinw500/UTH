// Page-selection arithmetic for the PDF tools.
//
// Pure and pdf-lib-free: parsing "1-3, 7, 9-" is the part that goes wrong, and
// it is much easier to get right when it is separated from anything that has to
// open a document. pdf-lib itself only ever sees an array of indices.

/**
 * Parse a page-range string into zero-based indices.
 *
 * Accepts `1-3`, `5`, `7-` (to the end), `-4` (from the start), `last`, and any
 * comma- or space-separated mix. One-based in, zero-based out, because users
 * count pages from 1 and every PDF API counts from 0 -- doing that conversion
 * in one place is the point.
 *
 * Out-of-range numbers are clamped rather than rejected: someone typing "1-999"
 * for a 10-page document means "all of it".
 *
 * @returns {number[]} sorted, de-duplicated, zero-based
 */
export function parsePageRange(spec, pageCount) {
    if (pageCount <= 0) return [];
    const text = String(spec ?? '').trim().toLowerCase();
    if (!text || text === 'all' || text === '*') {
        return Array.from({ length: pageCount }, (_, i) => i);
    }

    const wanted = new Set();
    const asPage = (token) => {
        if (token === 'last') return pageCount;
        const n = parseInt(token, 10);
        return Number.isFinite(n) ? n : null;
    };

    for (const part of text.split(/[,\s]+/).filter(Boolean)) {
        let rawStart;
        let rawEnd;

        if (part.startsWith('-')) {
            // "-4" is an open START (from page one), not a negative number.
            rawStart = '';
            rawEnd = part.slice(1);
        } else {
            const dash = part.indexOf('-');
            if (dash === -1) {
                const page = asPage(part);
                if (page !== null && page >= 1 && page <= pageCount) wanted.add(page - 1);
                continue;
            }
            rawStart = part.slice(0, dash);
            rawEnd = part.slice(dash + 1);
        }

        let start = rawStart === '' ? 1 : asPage(rawStart);
        let end = rawEnd === '' ? pageCount : asPage(rawEnd);
        if (start === null || end === null) continue;

        // "5-2" is a typo, not an empty selection. An open range is not: "20-"
        // on a 10-page file used to swap into 10-20 and select page 10.
        if (rawStart !== '' && rawEnd !== '') {
            if (start > end) [start, end] = [end, start];
        } else if (start > end) {
            continue;
        }
        start = Math.max(1, start);
        end = Math.min(pageCount, end);
        for (let page = start; page <= end; page += 1) wanted.add(page - 1);
    }

    return [...wanted].sort((a, b) => a - b);
}

/** Render indices back as a compact human range, for confirmation in the UI. */
export function describePageRange(indices) {
    if (!indices.length) return 'no pages';
    const runs = [];
    let start = indices[0];
    let previous = indices[0];

    for (const index of indices.slice(1)) {
        if (index === previous + 1) { previous = index; continue; }
        runs.push([start, previous]);
        start = index;
        previous = index;
    }
    runs.push([start, previous]);

    return runs
        .map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}–${b + 1}`))
        .join(', ');
}

/**
 * The indices NOT selected, which is what "remove these pages" needs.
 */
export function invertSelection(indices, pageCount) {
    const excluded = new Set(indices);
    const kept = [];
    for (let i = 0; i < pageCount; i += 1) if (!excluded.has(i)) kept.push(i);
    return kept;
}

/**
 * Split points into chunks of `size` pages.
 *
 * Used by "split every N pages"; returns arrays of zero-based indices.
 */
export function chunkPages(pageCount, size) {
    const n = Math.max(1, Math.floor(size));
    const chunks = [];
    for (let start = 0; start < pageCount; start += n) {
        chunks.push(
            Array.from({ length: Math.min(n, pageCount - start) }, (_, i) => start + i),
        );
    }
    return chunks;
}

/** Normalise a rotation to one of the four values PDF allows. */
export function normalisePdfRotation(degrees) {
    return ((Math.round(Number(degrees) / 90) * 90) % 360 + 360) % 360;
}

/**
 * Name one part of a split.
 *
 * Zero-padded so a 12-part split sorts correctly in a file manager, which
 * plain numbering does not.
 */
export function splitPartName(baseName, index, total) {
    const stem = String(baseName).replace(/\.[^.]+$/, '') || 'document';
    const width = String(total).length;
    return `${stem}-${String(index + 1).padStart(width, '0')}.pdf`;
}

/**
 * Indices back into text the page-range field accepts, for when a thumbnail
 * click changes the selection. The field stays the one source of truth, so
 * this must round-trip through parsePageRange.
 */
export function pageRangeSpec(indices, pageCount) {
    const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < pageCount).sort((a, b) => a - b);
    if (!sorted.length) return '';
    if (sorted.length === pageCount) return 'all';
    return describePageRange(sorted).replace(/–/g, '-');
}

/**
 * Where pdf-lib must draw an image so it lands where the user put it.
 *
 * The user places the box on the page *as displayed*: after its /Rotate and
 * cropped to its CropBox. pdf-lib draws in the page's own, unrotated user
 * space. Getting that mapping wrong is the canvas-vs-CSS-pixels bug again -- a
 * signature that lands somewhere other than where it was dropped, or on its
 * side. Stored normalised (0..1), like the image editor's crop.
 *
 * @param {object} o
 * @param {{u: number, v: number, w: number, h: number}} o.box  left, top, width, height,
 *        as fractions of the displayed page; v grows downwards
 * @param {number} o.rotation  the page's /Rotate, degrees clockwise
 * @param {{x: number, y: number, width: number, height: number}} o.cropBox  unrotated, PDF points
 * @returns {{x: number, y: number, width: number, height: number, rotate: number}}
 *        pdf-lib drawImage options, with `rotate` in degrees anticlockwise about (x, y)
 */
export function placeOnPage({ box, rotation, cropBox }) {
    const r = normalisePdfRotation(rotation);
    const { x: x0, y: y0, width: W, height: H } = cropBox;
    const x1 = x0 + W;
    const y1 = y0 + H;
    const sideways = r === 90 || r === 270;
    const displayW = sideways ? H : W;
    const displayH = sideways ? W : H;

    // A point on the displayed page -> user space. (0, 0) is the displayed
    // top-left; rotating a page clockwise brings its bottom-left there at 90.
    const toUser = (u, v) => ({
        0: [x0 + u * W, y1 - v * H],
        90: [x0 + v * W, y0 + u * H],
        180: [x1 - u * W, y0 + v * H],
        270: [x1 - v * W, y1 - u * H],
    })[r];

    // The image's bottom-left as the user sees it, and the displayed page's
    // "right" is user space rotated by the same angle, anticlockwise.
    const [x, y] = toUser(box.u, box.v + box.h);
    return { x, y, width: box.w * displayW, height: box.h * displayH, rotate: r };
}
