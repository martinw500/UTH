/**
 * Page-list arithmetic for the PDF toolkit.
 *
 * Deliberately separate from `pdf-toolkit.js`: none of this touches pdf-lib or
 * the DOM, so `tests/pdf-toolkit.test.js` imports the real functions rather
 * than a copy. A test carrying its own copy of a function is testing the copy —
 * that has bitten this repo before.
 *
 * The unit of work is a **page reference**: `{ docId, pageIndex, rotation }`.
 * The editor holds an ordered array of those, so merging two files is a
 * concat, reordering is a splice, and nothing is rewritten until export.
 */

/**
 * Parse a human page range against a document of `pageCount` pages.
 *
 * Accepts `1-3, 5, 8-10`, open-ended `12-`, and `end` / `last` as the final
 * page. Returns zero-based indices, sorted and de-duplicated.
 *
 * Errors are values, not exceptions: `{ pages, errors }`. A typo in one term
 * should not throw away the terms that were fine, and the page needs the bad
 * terms back so it can say which ones it ignored.
 */
export function parsePageRange(input, pageCount) {
    const result = { pages: [], errors: [] };
    if (typeof input !== 'string' || !input.trim()) return result;
    if (!Number.isInteger(pageCount) || pageCount < 1) return result;

    const seen = new Set();

    for (const rawTerm of input.split(/[,\s]+/)) {
        const term = rawTerm.trim().toLowerCase();
        if (!term) continue;

        const match = term.match(/^(\d+|end|last)(?:\s*-\s*(\d+|end|last)?)?$/);
        if (!match) {
            result.errors.push(rawTerm);
            continue;
        }

        const isRange = term.includes('-');
        const from = resolve(match[1], pageCount);
        // `12-` with nothing after it means "to the end", which is what people
        // type far more often than they type the real last page number.
        const to = isRange ? resolve(match[2], pageCount) : from;

        if (from === null || to === null) {
            result.errors.push(rawTerm);
            continue;
        }

        // A page number outside the document is a mistake worth reporting, not
        // something to silently clamp — clamping turns "1-500" into the whole
        // document without telling anyone the 500 was wrong.
        if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
            result.errors.push(rawTerm);
            continue;
        }

        // Accept a reversed range rather than rejecting it; "9-3" is obviously
        // meant as pages 3 to 9.
        const [low, high] = from <= to ? [from, to] : [to, from];
        for (let page = low; page <= high; page += 1) seen.add(page - 1);
    }

    result.pages = [...seen].sort((a, b) => a - b);
    return result;
}

function resolve(token, pageCount) {
    if (token === undefined) return pageCount;
    if (token === 'end' || token === 'last') return pageCount;
    const value = Number(token);
    return Number.isInteger(value) ? value : null;
}

/** Compress a sorted index list back to `1-3, 5, 8-10` for display. */
export function formatPageRange(indices) {
    const pages = [...new Set(indices)].map(i => i + 1).sort((a, b) => a - b);
    if (!pages.length) return '';

    const runs = [];
    let start = pages[0];
    let previous = pages[0];

    for (let i = 1; i <= pages.length; i += 1) {
        const page = pages[i];
        if (page === previous + 1) {
            previous = page;
            continue;
        }
        runs.push(start === previous ? `${start}` : `${start}-${previous}`);
        start = page;
        previous = page;
    }

    return runs.join(', ');
}

/**
 * Move the page at `from` to sit at `to`, returning a new array.
 *
 * Splice-then-insert, not swap: dragging page 1 to position 5 should shuffle
 * 2-5 up by one, not exchange 1 and 5.
 */
export function movePage(pages, from, to) {
    const next = [...pages];
    if (from < 0 || from >= next.length) return next;
    const clamped = Math.max(0, Math.min(next.length - 1, to));
    const [moved] = next.splice(from, 1);
    next.splice(clamped, 0, moved);
    return next;
}

/** Remove the pages at these indices, returning a new array. */
export function removePages(pages, indices) {
    const drop = new Set(indices);
    return pages.filter((_, index) => !drop.has(index));
}

/**
 * Rotate the pages at these indices by `degrees`, normalised to 0/90/180/270.
 *
 * Rotation is stored on the reference rather than applied to the page, so
 * rotating twice and back leaves the document exactly as it started.
 */
export function rotatePages(pages, indices, degrees) {
    const touch = new Set(indices);
    return pages.map((page, index) => {
        if (!touch.has(index)) return page;
        const rotation = (((page.rotation || 0) + degrees) % 360 + 360) % 360;
        return { ...page, rotation };
    });
}

/** Split a page list into chunks of at most `size`, for "one file per N pages". */
export function chunkPages(pages, size) {
    if (!Number.isInteger(size) || size < 1) return [pages];
    const chunks = [];
    for (let i = 0; i < pages.length; i += size) chunks.push(pages.slice(i, i + size));
    return chunks;
}

/** Describe a page for its card: "document.pdf page 3 · rotated 90°". */
export function describePage(page, documentName) {
    const parts = [`${documentName} page ${page.pageIndex + 1}`];
    if (page.rotation) parts.push(`rotated ${page.rotation}°`);
    return parts.join(' · ');
}

/** Output filename that says what happened, without stacking suffixes forever. */
export function outputName(sources, action) {
    const base = (sources[0] || 'document').replace(/\.pdf$/i, '');
    if (action === 'merge' && sources.length > 1) return `${base}-and-${sources.length - 1}-more.pdf`;
    return `${base}-${action}.pdf`;
}
