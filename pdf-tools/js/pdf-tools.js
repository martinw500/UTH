// PDF tools page controller. Wiring only; the arithmetic is in
// js/shared/pdf-pages.js and the pdf-lib calls are in ./pdf-ops.js.

import { requireIds, setBusy } from '../../js/shared/dom.js';
import { formatBytes } from '../../js/shared/format.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { showError, showSuccess, clearNotice } from '../../js/shared/notify.js';
import { createUrlSlot } from '../../js/shared/objecturl.js';
import { attachDownload } from '../../js/shared/download.js';
import { buildZip } from '../../js/shared/zip.js';
import { parsePageRange, describePageRange } from '../../js/shared/pdf-pages.js';
import { savings } from '../../js/shared/compression.js';
import { openPdf, closePdf } from '../../js/shared/pdf-render.js';
import { createThumbGrid } from './thumbs.js';
import { createSigner } from './sign-ui.js';
import {
    pageCountOf,
    mergePdfs,
    extractPages,
    removePages,
    splitPdf,
    rotatePdf,
    imagesToPdf,
    optimisePdf,
    pdfToImages,
    signPdf,
} from './pdf-ops.js';

const MAX_FILES = 40;
const MAX_BYTES = 200 * 1024 * 1024;

const ui = requireIds(
    'dropzone', 'fileInput', 'browseBtn', 'notice',
    'workspace', 'queueSummary', 'fileList', 'addMoreBtn', 'clearBtn',
    'operation', 'opFields',
    'rangeField', 'pageRange', 'rangePreview', 'thumbGrid',
    'dpiField', 'pdfDpi',
    'signField', 'signPad', 'signText', 'signUploadBtn', 'signUpload', 'signClearBtn', 'signRemember',
    'signPage', 'signStage', 'signPageCanvas', 'signBox', 'signImg', 'signHandle',
    'splitField', 'splitMode', 'splitSize',
    'rotateField', 'rotateAngle',
    'imageField', 'pdfPageSize', 'pdfMargin', 'pdfMarginValue',
    'runBtn', 'progress', 'progressBar', 'progressText',
    'results', 'resultsInfo', 'resultList',
);

const resultUrl = createUrlSlot();
let queue = [];
let nextId = 1;

/**
 * Which fields each operation needs.
 *
 * Same idea as the converter hub's registry: the panel is driven by data, so a
 * new operation is a row here rather than another branch in a show/hide chain.
 */
const OPERATIONS = {
    merge: { label: 'Merge', fields: [], needs: 'pdf', min: 2 },
    extract: { label: 'Keep pages', fields: ['rangeField'], needs: 'pdf', min: 1, max: 1 },
    remove: { label: 'Remove pages', fields: ['rangeField'], needs: 'pdf', min: 1, max: 1 },
    split: { label: 'Split', fields: ['splitField'], needs: 'pdf', min: 1, max: 1 },
    rotate: { label: 'Rotate', fields: ['rangeField', 'rotateField'], needs: 'pdf', min: 1, max: 1 },
    optimise: { label: 'Optimise', fields: [], needs: 'pdf', min: 1, max: 1 },
    fromImages: { label: 'Images to PDF', fields: ['imageField'], needs: 'image', min: 1 },
    toImages: { label: 'Save as JPG', fields: ['rangeField', 'dpiField'], needs: 'pdf', min: 1, max: 1 },
    sign: { label: 'Sign', fields: ['signField'], needs: 'pdf', min: 1, max: 1 },
};

const ALL_FIELDS = ['rangeField', 'splitField', 'rotateField', 'imageField', 'dpiField', 'signField'];

/**
 * The pdf.js document for a queue item, opened once and shared by the
 * thumbnails and the signing stage. pdf-lib does the edits; this only renders.
 */
const docFor = (item) => (item.pdfjs ??= openPdf(item.file));
const closeDoc = (item) => item.pdfjs?.then(closePdf).catch(() => {});

/** The one readable PDF that previews are drawn from, if there is exactly one. */
const previewItem = () => (queue.length === 1 && queue[0].isPdf && !queue[0].error && queue[0].pageCount > 0
    ? queue[0] : null);

const thumbs = createThumbGrid({ grid: ui.thumbGrid, rangeInput: ui.pageRange, docFor });
const signer = createSigner({ ui, docFor, onChange: () => validate({ notify: false }) });

function refreshPreviews() {
    const op = currentOp();
    const item = previewItem();
    if (item && op.fields.includes('rangeField')) thumbs.show(item); else thumbs.hide();
    if (item && op.fields.includes('signField')) signer.show(item); else signer.hide();
}

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

function currentOp() {
    return OPERATIONS[ui.operation.value] ?? OPERATIONS.merge;
}

function updateFields() {
    const op = currentOp();
    for (const id of ALL_FIELDS) ui[id].hidden = !op.fields.includes(id);
    updateRangePreview();
    refreshPreviews();
    validate();
}

async function updateRangePreview() {
    const op = currentOp();
    if (!op.fields.includes('rangeField') || !queue.length) {
        ui.rangePreview.textContent = '';
        return;
    }
    const first = queue[0];
    if (first.pageCount == null) return;
    const indices = parsePageRange(ui.pageRange.value, first.pageCount);
    const verb = ui.operation.value === 'remove' ? 'Removing' : 'Selecting';
    ui.rangePreview.textContent =
        `${verb} ${indices.length} of ${first.pageCount}: ${describePageRange(indices)}`;
}

// validate() runs whenever the queue or the operation changes, including mid-run,
// so it must not re-enable Run while a job is still going.
let running = false;

function validate({ notify = true } = {}) {
    const op = currentOp();
    const wrongKind = queue.filter((item) => (op.needs === 'pdf' ? !item.isPdf : item.isPdf));
    const unreadable = queue.find((item) => item.error);
    const tooFew = queue.length < op.min;
    const tooMany = op.max && queue.length > op.max;
    const unsigned = ui.operation.value === 'sign' && !signer.ready;

    ui.runBtn.disabled = running || tooFew || tooMany || wrongKind.length > 0
        || Boolean(unreadable) || queue.length === 0 || unsigned;
    if (running || !notify) return;

    if (!queue.length) { clearNotice(ui.notice); return; }
    if (unreadable) {
        showError(ui.notice, unreadable.error);
    } else if (wrongKind.length) {
        showError(ui.notice, op.needs === 'pdf'
            ? `${op.label} needs PDFs, but ${wrongKind.length} of these are images.`
            : `${op.label} needs images, but ${wrongKind.length} of these are PDFs.`);
    } else if (tooFew) {
        showError(ui.notice, `${op.label} needs at least ${op.min} files.`);
    } else if (tooMany) {
        showError(ui.notice, `${op.label} works on one file at a time.`);
    } else {
        clearNotice(ui.notice);
    }
}

async function addFiles(files) {
    for (const file of files) {
        const item = {
            id: nextId++, file, name: file.name, size: file.size,
            isPdf: isPdf(file), pageCount: null,
        };
        queue.push(item);
    }
    // Files past the cap used to vanish without a word.
    const leftOut = Math.max(0, queue.length - MAX_FILES);
    queue = queue.slice(0, MAX_FILES);

    ui.dropzone.hidden = true;
    ui.workspace.hidden = false;
    ui.results.hidden = true;
    renderQueue();

    // Page counts need the document open, so they arrive after the list does.
    for (const item of queue.filter((i) => i.isPdf && i.pageCount === null)) {
        try {
            item.pageCount = await pageCountOf(item.file);
        } catch (error) {
            item.pageCount = 0;
            item.error = error?.message || `${item.name} could not be read as a PDF.`;
        }
        renderQueue();
    }
    updateRangePreview();
    refreshPreviews();
    validate();
    if (leftOut) {
        showError(ui.notice, `Up to ${MAX_FILES} files at a time, so ${leftOut} `
            + `${leftOut === 1 ? 'was' : 'were'} left out.`);
    }
}

function renderQueue() {
    const pdfs = queue.filter((i) => i.isPdf).length;
    const images = queue.length - pdfs;
    ui.queueSummary.textContent = [
        pdfs ? `${pdfs} PDF${pdfs === 1 ? '' : 's'}` : null,
        images ? `${images} image${images === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' and ');

    ui.fileList.replaceChildren(...queue.map((item, index) => {
        const row = document.createElement('div');
        row.className = 'file-item';

        const info = document.createElement('div');
        info.className = 'file-item-info';
        const name = document.createElement('span');
        name.className = 'file-item-name';
        name.textContent = item.name;
        const meta = document.createElement('span');
        meta.className = 'file-item-size';
        meta.textContent = [
            formatBytes(item.size),
            item.error ? (/password/.test(item.error) ? 'password-protected' : 'could not be read') : null,
            item.pageCount ? `${item.pageCount} page${item.pageCount === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(' · ');
        info.append(name, meta);

        const actions = document.createElement('div');
        actions.className = 'file-item-actions';

        // Merge order is the list order, so it has to be changeable.
        if (queue.length > 1) {
            for (const [label, delta, disabled] of [
                ['↑', -1, index === 0], ['↓', 1, index === queue.length - 1],
            ]) {
                const move = document.createElement('button');
                move.type = 'button';
                move.className = 'btn btn-ghost btn-sm';
                move.textContent = label;
                move.disabled = disabled;
                move.setAttribute('aria-label', `Move ${item.name} ${delta < 0 ? 'up' : 'down'}`);
                move.addEventListener('click', () => {
                    const target = index + delta;
                    [queue[index], queue[target]] = [queue[target], queue[index]];
                    renderQueue();
                });
                actions.append(move);
            }
        }

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'file-item-remove';
        remove.setAttribute('aria-label', `Remove ${item.name}`);
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            queue = queue.filter((i) => i.id !== item.id);
            closeDoc(item);
            if (!queue.length) { clearAll(); return; }
            renderQueue();
            updateRangePreview();
            refreshPreviews();
            validate();
        });
        actions.append(remove);

        row.append(info, actions);
        return row;
    }));
}

function clearAll() {
    queue.forEach(closeDoc);
    queue = [];
    thumbs.hide();
    signer.hide();
    resultUrl.revoke();
    ui.workspace.hidden = true;
    ui.dropzone.hidden = false;
    ui.results.hidden = true;
    ui.resultList.replaceChildren();
    clearNotice(ui.notice);
}

const onProgress = ({ ratio, note }) => {
    ui.progressBar.style.width = `${Math.round((ratio ?? 0) * 100)}%`;
    ui.progressText.textContent = note ? `Working on ${note}…` : '';
};

async function run() {
    const operation = ui.operation.value;
    const files = queue.map((item) => item.file);

    clearNotice(ui.notice);
    running = true;
    setBusy(ui.runBtn, true, 'Working…');
    ui.progress.hidden = false;
    ui.results.hidden = true;

    try {
        let result;
        switch (operation) {
            case 'merge':
                result = await mergePdfs(files, { onProgress });
                break;
            case 'extract':
                result = await extractPages(files[0], ui.pageRange.value);
                break;
            case 'remove':
                result = await removePages(files[0], ui.pageRange.value);
                break;
            case 'rotate':
                result = await rotatePdf(files[0], {
                    rangeSpec: ui.pageRange.value, angle: Number(ui.rotateAngle.value),
                });
                break;
            case 'optimise':
                result = await optimisePdf(files[0]);
                break;
            case 'fromImages':
                result = await imagesToPdf(files, {
                    pageSize: ui.pdfPageSize.value,
                    margin: Number(ui.pdfMargin.value),
                    onProgress,
                });
                break;
            case 'toImages': {
                const images = await pdfToImages(files[0], {
                    rangeSpec: ui.pageRange.value, dpi: Number(ui.pdfDpi.value), onProgress,
                });
                result = images.length === 1
                    ? { blob: images[0].data, filename: images[0].name, pageCount: null, note: '1 image' }
                    : {
                        blob: await buildZip(images),
                        filename: `${images[0].name.replace(/-page-\d+\.jpg$/, '')}-pages.zip`,
                        pageCount: null,
                        note: `${images.length} images`,
                    };
                break;
            }
            case 'sign':
                result = await signPdf(files[0], signer.value());
                break;
            case 'split': {
                const parts = await splitPdf(files[0], {
                    mode: ui.splitMode.value,
                    size: Number(ui.splitSize.value),
                    onProgress,
                });
                result = {
                    blob: await buildZip(parts),
                    filename: 'split.pdf.zip',
                    pageCount: null,
                    note: `${parts.length} files`,
                };
                break;
            }
            default:
                throw new Error('Unknown operation.');
        }

        showResult(result, operation);
    } catch (error) {
        showError(ui.notice, error?.message || 'That did not work.');
    } finally {
        running = false;
        setBusy(ui.runBtn, false);
        // Button state only: the notice may be holding this run's error.
        validate({ notify: false });
        ui.progress.hidden = true;
        ui.progressBar.style.width = '0%';
        ui.progressText.textContent = '';
    }
}

function showResult(result, operation) {
    ui.results.hidden = false;

    const details = [
        formatBytes(result.blob.size),
        result.pageCount ? `${result.pageCount} page${result.pageCount === 1 ? '' : 's'}` : null,
        result.note ?? null,
    ];

    // Be specific about what "optimise" achieved, since the honest answer is
    // usually "not much" -- see the note in pdf-ops.js.
    if (operation === 'optimise') {
        const delta = savings(result.originalSize, result.newSize);
        details.push(delta.direction === 'smaller' && delta.percent > 0
            ? `${delta.percent}% smaller`
            : 'no smaller — this file was already efficiently structured');
    }

    ui.resultsInfo.textContent = details.filter(Boolean).join(' · ');

    const link = document.createElement('a');
    link.className = 'btn btn-primary btn-sm';
    link.textContent = `Download ${result.filename}`;
    attachDownload(link, result.blob, result.filename, resultUrl);

    ui.resultList.replaceChildren(link);
    showSuccess(ui.notice, 'Done. Nothing left your device.');
}

createDropzone({
    dropzone: ui.dropzone,
    fileInput: ui.fileInput,
    browseBtn: ui.browseBtn,
    accept: ['application/pdf', '.pdf', 'image/*'],
    multiple: true,
    maxBytes: MAX_BYTES,
    paste: true,
    onFiles: addFiles,
    onReject: (rejection) => showError(ui.notice, rejection.message),
});

ui.addMoreBtn.addEventListener('click', () => ui.fileInput.click());
ui.clearBtn.addEventListener('click', clearAll);
ui.operation.addEventListener('change', updateFields);
ui.pageRange.addEventListener('input', () => { updateRangePreview(); thumbs.sync(); });
ui.splitMode.addEventListener('change', () => {
    ui.splitSize.disabled = ui.splitMode.value === 'single';
});
ui.pdfMargin.addEventListener('input', () => {
    ui.pdfMarginValue.textContent = `${ui.pdfMargin.value}pt`;
});
ui.runBtn.addEventListener('click', run);

updateFields();
ui.pdfMarginValue.textContent = `${ui.pdfMargin.value}pt`;
