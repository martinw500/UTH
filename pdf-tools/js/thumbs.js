// Page thumbnails, so choosing pages is clicking them rather than typing
// "1-3, 7" blind.
//
// The page-range field stays the one source of truth: a click rewrites it, and
// the highlight is read back from it. Pages render only once scrolled into
// view, one at a time -- a 400-page PDF rendered eagerly runs the tab out of
// memory.

import { renderPage } from '../../js/shared/pdf-render.js';
import { parsePageRange, pageRangeSpec } from '../../js/shared/pdf-pages.js';

const THUMB_WIDTH = 96; // CSS pixels

/**
 * @param {object} o
 * @param {HTMLElement} o.grid
 * @param {HTMLInputElement} o.rangeInput  written on click; an 'input' event follows
 * @param {(item) => Promise} o.docFor  the pdf.js document for a queue item
 */
export function createThumbGrid({ grid, rangeInput, docFor }) {
    let shown = null; // the queue item on display
    let observer = null;
    let chain = Promise.resolve();

    function hide() {
        observer?.disconnect();
        observer = null;
        shown = null;
        grid.hidden = true;
        grid.replaceChildren();
    }

    function sync() {
        if (!shown) return;
        const selected = new Set(parsePageRange(rangeInput.value, shown.pageCount));
        for (const thumb of grid.children) {
            thumb.setAttribute('aria-pressed', String(selected.has(Number(thumb.dataset.index))));
        }
    }

    function toggle(index) {
        const selected = new Set(parsePageRange(rangeInput.value, shown.pageCount));
        if (selected.has(index)) selected.delete(index); else selected.add(index);
        rangeInput.value = pageRangeSpec([...selected], shown.pageCount);
        rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function render(thumb, item) {
        chain = chain.then(async () => {
            if (shown !== item || thumb.dataset.state !== 'queued') return;
            try {
                const canvas = await renderPage(await docFor(item), Number(thumb.dataset.index) + 1, { width: THUMB_WIDTH });
                if (shown !== item) return;
                canvas.className = 'pdf-thumb-canvas';
                thumb.querySelector('.pdf-thumb-page').replaceChildren(canvas);
                thumb.dataset.state = 'done';
            } catch {
                thumb.dataset.state = 'failed';
            }
        });
    }

    function show(item) {
        if (shown === item) { sync(); return; }
        hide();
        shown = item;
        grid.hidden = false;

        observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting || entry.target.dataset.state) continue;
                entry.target.dataset.state = 'queued';
                render(entry.target, item);
            }
        }, { root: grid, rootMargin: '200px' });

        grid.replaceChildren(...Array.from({ length: item.pageCount }, (_, index) => {
            const thumb = document.createElement('button');
            thumb.type = 'button';
            thumb.className = 'pdf-thumb';
            thumb.dataset.index = String(index);
            thumb.setAttribute('aria-label', `Page ${index + 1}`);
            const page = document.createElement('span');
            page.className = 'pdf-thumb-page';
            const number = document.createElement('span');
            number.className = 'pdf-thumb-number';
            number.textContent = String(index + 1);
            thumb.append(page, number);
            thumb.addEventListener('click', () => toggle(index));
            observer.observe(thumb);
            return thumb;
        }));
        sync();
    }

    return { show, hide, sync };
}
