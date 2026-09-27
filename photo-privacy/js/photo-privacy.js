// Photo privacy page controller. Wiring only: the byte work is in
// js/shared/metadata.js and the wording in ./report.js.

import { requireIds, setBusy, el } from '../../js/shared/dom.js';
import { formatBytes, stripExtension } from '../../js/shared/format.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { showError, showSuccess, clearNotice, announce } from '../../js/shared/notify.js';
import { createUrlPool } from '../../js/shared/objecturl.js';
import { saveAllAsZip } from '../../js/shared/download.js';
import { renderResultList } from '../../js/shared/result-card.js';
import { decodeImageFile, drawWithBackground, canvasToBlob } from '../../js/shared/image.js';
import { readMetadata, stripMetadata } from '../../js/shared/metadata.js';
import { privacyReport } from './report.js';

const MAX_FILES = 50;
const MAX_BYTES = 100 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

const ui = requireIds(
    'dropzone', 'fileInput', 'browseBtn', 'notice',
    'workspace', 'queueSummary', 'addMoreBtn', 'clearBtn', 'reportList',
    'cleanBtn', 'results', 'resultsInfo', 'downloadAllBtn', 'resultList',
);

const urls = createUrlPool();
let queue = [];
let results = [];
let nextId = 1;
let running = false;

async function addFiles(files) {
    const added = files.map((file) => ({ id: nextId++, file, meta: undefined, error: null }));
    queue.push(...added);
    const leftOut = Math.max(0, queue.length - MAX_FILES);
    queue = queue.slice(0, MAX_FILES);

    ui.dropzone.hidden = true;
    ui.workspace.hidden = false;
    ui.results.hidden = true;
    clearNotice(ui.notice);

    for (const item of added.filter((i) => queue.includes(i))) {
        try {
            item.meta = readMetadata(await item.file.arrayBuffer());
            if (!item.meta) item.error = 'Not a JPEG, PNG, WebP or HEIC photo.';
        } catch {
            item.error = 'Could not be read.';
        }
    }
    render();
    if (leftOut) {
        showError(ui.notice, `Up to ${MAX_FILES} photos at a time, so ${leftOut} `
            + `${leftOut === 1 ? 'was' : 'were'} left out.`);
    }
}

function renderReport(item) {
    const remove = el('button', {
        type: 'button', class: 'file-item-remove', 'aria-label': `Remove ${item.file.name}`,
        onclick: () => {
            queue = queue.filter((i) => i !== item);
            if (!queue.length) clearAll(); else render();
        },
    }, '×');

    const head = el('div', { class: 'privacy-card-head' },
        el('div', { class: 'file-item-info' },
            el('span', { class: 'file-item-name' }, item.file.name),
            el('span', { class: 'file-item-size' }, formatBytes(item.file.size))),
        remove);

    if (item.error) {
        return el('div', { class: 'privacy-card' }, head, el('p', { class: 'privacy-headline is-error' }, item.error));
    }

    const report = privacyReport(item.meta);
    const facts = report.facts.length
        ? el('dl', { class: 'privacy-facts' }, report.facts.flatMap((fact) => [
            el('dt', {}, fact.label),
            el('dd', { class: fact.sensitive ? 'is-sensitive' : null },
                fact.href
                    ? el('a', { href: fact.href, target: '_blank', rel: 'noopener' }, fact.value)
                    : fact.value),
        ]))
        : null;

    const blocks = report.blocks.length
        ? el('p', { class: 'privacy-blocks' }, `Hidden in the file: ${report.blocks
            .map((block) => `${block.kind} (${formatBytes(block.bytes)})`).join(', ')}`)
        : null;

    const all = report.allTags.length > report.facts.length
        ? el('details', { class: 'privacy-all' },
            el('summary', {}, `All ${report.allTags.length} fields`),
            el('dl', { class: 'privacy-facts' }, report.allTags.flatMap(([key, value]) => [
                el('dt', {}, key), el('dd', {}, value),
            ])))
        : null;

    return el('div', { class: 'privacy-card' },
        head,
        el('p', { class: `privacy-headline is-${report.level}` }, report.headline),
        facts, blocks, all);
}

function render() {
    const n = queue.length;
    ui.queueSummary.textContent = `${n} photo${n === 1 ? '' : 's'}`;
    ui.reportList.replaceChildren(...queue.map(renderReport));
    ui.cleanBtn.disabled = running || !queue.some((i) => !i.error);
}

function clearAll() {
    queue = [];
    results = [];
    urls.revokeAll();
    ui.workspace.hidden = true;
    ui.dropzone.hidden = false;
    ui.results.hidden = true;
    ui.resultList.replaceChildren();
    ui.reportList.replaceChildren();
    clearNotice(ui.notice);
}

/**
 * A copy without the metadata. JPEG/PNG/WebP are rewritten byte for byte;
 * HEIC cannot be (see metadata.js), so it is re-encoded as a JPEG, which by
 * construction carries nothing the canvas was not given.
 */
async function cleanOne(file) {
    const stripped = stripMetadata(await file.arrayBuffer());
    if (stripped) {
        return {
            blob: new Blob([stripped.bytes], { type: file.type || 'application/octet-stream' }),
            filename: file.name,
            originalSize: file.size,
            extra: [stripped.removed ? `${formatBytes(stripped.removed)} of metadata removed` : 'nothing to remove'],
        };
    }
    const source = await decodeImageFile(file);
    const blob = await canvasToBlob(drawWithBackground(source, 'image/jpeg'), 'image/jpeg', 0.92);
    source.close?.();
    // No originalSize: a JPEG against a HEIC is not a saving or a loss, just a
    // different format, and "92% larger" in red would read as a fault.
    return { blob, filename: `${stripExtension(file.name)}.jpg`, extra: ['converted to JPEG'] };
}

async function clean() {
    running = true;
    setBusy(ui.cleanBtn, true, 'Removing…');
    clearNotice(ui.notice);
    urls.revokeAll();
    results = [];
    const failures = [];

    for (const item of queue.filter((i) => !i.error)) {
        try {
            const out = await cleanOne(item.file);
            results.push({ ...out, preview: true, slot: urls, key: item.id });
        } catch (error) {
            failures.push({ filename: item.file.name, error: error?.message || 'Could not be cleaned.' });
        }
    }

    renderResultList(ui.resultList, { results, failures });
    ui.results.hidden = false;
    ui.downloadAllBtn.hidden = results.length < 2;
    ui.resultsInfo.textContent = `${results.length} clean cop${results.length === 1 ? 'y' : 'ies'}`;
    if (results.length) {
        showSuccess(ui.notice, 'Done. Nothing left your device.');
        announce(`${results.length} photo${results.length === 1 ? '' : 's'} cleaned`);
    }

    running = false;
    setBusy(ui.cleanBtn, false);
    render();
}

async function downloadAll() {
    setBusy(ui.downloadAllBtn, true, 'Zipping…');
    try {
        await saveAllAsZip(results.map((r) => ({ name: r.filename, data: r.blob })), 'clean-photos.zip');
    } catch (error) {
        showError(ui.notice, error?.message || 'Could not build the zip.');
    } finally {
        setBusy(ui.downloadAllBtn, false);
    }
}

createDropzone({
    dropzone: ui.dropzone,
    fileInput: ui.fileInput,
    browseBtn: ui.browseBtn,
    accept: ACCEPT,
    multiple: true,
    maxBytes: MAX_BYTES,
    paste: true,
    onFiles: addFiles,
    onReject: (rejection) => showError(ui.notice, rejection.message),
});

ui.addMoreBtn.addEventListener('click', () => ui.fileInput.click());
ui.clearBtn.addEventListener('click', clearAll);
ui.cleanBtn.addEventListener('click', clean);
ui.downloadAllBtn.addEventListener('click', downloadAll);
