// "Here is your file" -- the row every tool shows when it has produced one.
//
// The convert hub and the image editor had grown near-identical copies of this,
// and they had already drifted: the hub computed its own percentage inline
// instead of using savings(), and the editor coloured a byte-identical
// re-encode with the error colour because it mapped three directions through a
// two-way ternary. Neither is a hard bug, and that is exactly why they survived
// -- a result panel looks fine until you compare two of them side by side.
//
// The panel does not exist until the user acts, so nothing that reads raw HTML
// -- deployed-site.test.js, or a crawler -- can ever see it. Building it in JS
// is therefore free, and the static-HTML rule for the homepage grid does not
// apply here. The CONTAINER and its heading stay in each page's markup, because
// those carry copy that e2e-parity.test.js pins.

import { formatBytes } from './format.js';
import { savings } from './compression.js';
import { attachDownload } from './download.js';

/** savings() direction -> the class that colours it. */
const SAVINGS_CLASS = {
    smaller: 'positive',
    larger: 'negative',
    // "Same size" is a normal outcome, not a failure. This is the mapping the
    // image editor got wrong.
    same: 'neutral',
};

/**
 * The meta line under a result's filename.
 *
 * Pure, so the wording and the arithmetic can be tested without a DOM -- which
 * is where the two copies actually differed.
 *
 * @returns {{text: string, direction: string, savingsClass: string}}
 */
export function resultSummary({ originalSize, outputSize, extra = [] } = {}) {
    const delta = savings(originalSize, outputSize);
    const parts = [
        formatBytes(outputSize),
        // An empty label means there was nothing to compare against, not that
        // the sizes matched.
        delta.label || null,
        ...extra,
    ].filter(Boolean);

    return {
        text: parts.join(' · '),
        direction: delta.direction,
        savingsClass: SAVINGS_CLASS[delta.direction] ?? 'neutral',
    };
}

/**
 * A div with text, classed by the caller.
 *
 * The class is added at the call site as a literal rather than passed in here,
 * because the "styles.css defines the classes the shared modules apply" test in
 * esm-conventions.test.js reads class names out of this source. A name that
 * arrives as a variable is invisible to it, which would leave this file listed
 * as gated while actually being ungated.
 */
function div(text) {
    const node = document.createElement('div');
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * One produced file.
 *
 * The URL comes from the caller's slot or pool (objecturl.js) rather than being
 * created here, so a preview and its download button share one URL and it is
 * revoked exactly once, by whoever owns the batch.
 *
 * @param {object}   o
 * @param {string}   o.filename
 * @param {Blob}     o.blob
 * @param {number}   [o.originalSize]  omit when there is nothing to compare
 * @param {boolean}  [o.preview]       show the blob as an image thumbnail
 * @param {string[]} [o.extra]         extra meta fragments, e.g. ['3 pages']
 * @param {object}   o.slot            a createUrlSlot(), or createUrlPool() with `key`
 * @param {*}        [o.key]
 * @param {Node[]}   [o.actions]       extra buttons, placed before Download
 * @param {string}   [o.downloadLabel]
 */
export function renderResult({
    filename, blob, originalSize, preview = false, extra = [],
    slot, key, actions = [], downloadLabel = 'Download',
}) {
    const row = document.createElement('div');
    row.classList.add('output-item');

    const link = document.createElement('a');
    link.className = 'btn btn-primary btn-sm';
    link.textContent = downloadLabel;
    const url = attachDownload(link, blob, filename, slot, key);

    if (preview) {
        const host = div();
        host.classList.add('output-item-preview');
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        host.append(img);
        row.append(host);
    }

    const summary = resultSummary({ originalSize, outputSize: blob.size, extra });

    const name = div(filename);
    name.classList.add('output-item-name');

    const meta = div(summary.text);
    meta.classList.add('output-item-meta', 'output-savings');
    meta.classList.add(summary.savingsClass);

    const info = div();
    info.classList.add('output-item-info');
    info.append(name, meta);
    row.append(info);

    if (actions.length) {
        const group = div();
        group.classList.add('output-actions');
        group.append(...actions);
        row.append(group);
    }

    row.append(link);
    return row;
}

/**
 * A file that could not be produced.
 *
 * Shown in the same list as the successes rather than collapsed into one
 * notice, because in a batch the only useful question is *which* file failed.
 */
export function renderFailure({ filename, error }) {
    const row = document.createElement('div');
    row.classList.add('output-item', 'output-error');

    const name = div(filename);
    name.classList.add('output-item-name');

    const meta = div(error || 'Could not be produced.');
    meta.classList.add('output-item-meta');

    const info = div();
    info.classList.add('output-item-info');
    info.append(name, meta);

    row.append(info);
    return row;
}

/**
 * Fill a container with results, then failures.
 *
 * Successes first: a batch where two of twenty failed should open on the
 * eighteen that worked, not on the apology.
 */
export function renderResultList(host, { results = [], failures = [] } = {}) {
    host.replaceChildren(
        ...results.map((result) => renderResult(result)),
        ...failures.map((failure) => renderFailure(failure)),
    );
    return host;
}
