// Saving a blob to the user's disk.
//
// This existed four times, and the four copies disagreed with each other.
// qr-generator and instagram-downloader appended the anchor to the document and
// waited 100ms before revoking, with a comment explaining that revoking
// immediately can cancel the download. convert/ and the image editor did
// neither: no append, and `setTimeout(..., 0)`. Same repo, opposite conclusions
// about the same browser behaviour, so at least one pair was wrong.
//
// Both details matter, and both are settled here:
//
//   * **The anchor must be in the document.** A detached <a>.click() is ignored
//     by Firefox. Chrome tolerates it, which is why the two detached copies
//     appeared to work for whoever wrote them.
//   * **The URL must outlive the click.** `.click()` returns as soon as the
//     event dispatches, not when the browser has finished reading the blob;
//     revoking on the next tick races the read and produces a failed download
//     for a large file. A whole second costs nothing -- the blob is already in
//     memory either way -- and removes the race.
//
// Nothing here creates a URL it does not also revoke, except `saveUrl` and
// `attachDownload`, where the caller owns the URL through an objecturl.js slot.

import { sanitiseFilename } from './format.js';

/** How long a created URL is kept alive after the click. See the note above. */
export const REVOKE_AFTER_MS = 1000;

/**
 * Click a temporary anchor, then clean it up.
 *
 * The single place that knows the append/click/remove dance, so the three
 * public functions below cannot drift apart the way their ancestors did.
 */
function clickAnchor(doc, href, { filename, newTab }, onCleanup, cleanupAfterMs) {
    const a = doc.createElement('a');
    a.href = href;
    // Cross-origin responses ignore this attribute entirely -- see saveRemote.
    if (filename) a.download = filename;
    if (newTab) { a.target = '_blank'; a.rel = 'noopener'; }
    a.style.display = 'none';

    doc.body.appendChild(a);
    a.click();

    setTimeout(() => {
        a.remove();
        onCleanup?.();
    }, cleanupAfterMs);
}

/**
 * Save a blob under a filename.
 *
 * Owns the object URL it creates and revokes it once the click has landed.
 *
 * @returns {boolean} false if there was nothing to save or no document to do it
 *   with, so a caller can report rather than assume success.
 */
export function saveBlob(blob, filename, { revokeAfterMs = REVOKE_AFTER_MS, doc = document } = {}) {
    if (!blob || !doc?.body) return false;

    const url = URL.createObjectURL(blob);
    clickAnchor(
        doc,
        url,
        { filename: sanitiseFilename(filename) },
        () => URL.revokeObjectURL(url),
        revokeAfterMs,
    );
    return true;
}

/**
 * Save from a URL the caller already holds, and never revoke it.
 *
 * For URLs owned by a slot or pool from objecturl.js: those revoke on `set` and
 * `revokeAll`, so revoking here as well would release a URL still wired to a
 * visible preview or a persistent download button.
 */
export function saveUrl(url, filename, { doc = document } = {}) {
    if (!url || !doc?.body) return false;
    clickAnchor(doc, url, { filename: sanitiseFilename(filename) }, null, REVOKE_AFTER_MS);
    return true;
}

/**
 * Save something served by a server rather than built here.
 *
 * **The `download` attribute is ignored cross-origin.** The server's
 * Content-Disposition decides the filename, and if it sets none the browser may
 * open the response in a tab instead of saving it. That is why this is a
 * separate function: the YouTube download passes its filename to the backend as
 * a query parameter for exactly this reason, and a call site reaching for
 * `saveBlob` here would silently get a different behaviour on the two hosts
 * (same-origin on Vercel, cross-origin from GitHub Pages).
 *
 * `newTab` is the honest fallback for a media URL that cannot be fetched: it may
 * open rather than save, but that beats failing silently.
 */
export function saveRemote(url, { filename = '', newTab = false, doc = document } = {}) {
    if (!url || !doc?.body) return false;
    clickAnchor(
        doc,
        url,
        { filename: filename ? sanitiseFilename(filename) : '', newTab },
        null,
        REVOKE_AFTER_MS,
    );
    return true;
}

/**
 * Point a persistent anchor at a blob, taking the URL from a slot or pool.
 *
 * The slot is passed in rather than created here so ownership stays explicit and
 * a call site cannot end up revoking a URL the slot still believes it holds --
 * the leak objecturl.js was written to stop.
 *
 * @param {{set: Function}} slot  a createUrlSlot(), or a createUrlPool() with `key`
 * @returns {string} the object URL, for callers that also want to preview it
 */
export function attachDownload(anchor, blob, filename, slot, key = undefined) {
    const url = key === undefined ? slot.set(blob) : slot.set(key, blob);
    anchor.href = url;
    anchor.download = sanitiseFilename(filename);
    return url;
}

/**
 * Save several results as one zip.
 *
 * A zip rather than N downloads because browsers throttle rapid successive
 * downloads and Chrome blocks them outright after a handful, so a large batch
 * silently arrived incomplete. Both batch tools had worked this out separately.
 *
 * zip.js is imported lazily: most pages that save a file never save a batch, and
 * this keeps download.js free of a dependency they would all otherwise pay for.
 */
export async function saveAllAsZip(entries, zipName, { doc = document } = {}) {
    if (!entries?.length) return false;
    const { buildZip } = await import('./zip.js');
    const zip = await buildZip(entries);
    return saveBlob(zip, zipName, { doc });
}
