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
import {
    pageCountOf,
    mergePdfs,
    extractPages,
    removePages,
    splitPdf,
    rotatePdf,
    imagesToPdf,
    optimisePdf,
} from './pdf-ops.js';

const MAX_FILES = 40;
const MAX_BYTES = 200 * 1024 * 1024;

const ui = requireIds(
    'dropzone', 'fileInput', 'browseBtn', 'notice',
    'workspace', 'queueSummary', 'fileList', 'addMoreBtn', 'clearBtn',
    'operation', 'opFields',
    'rangeField', 'pageRange', 'rangePreview',
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
};

const ALL_FIELDS = ['rangeField', 'splitField', 'rotateField', 'imageField'];

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

function currentOp() {
    return OPERATIONS[ui.operation.value] ?? OPERATIONS.merge;
}

function updateFields() {
    const op = currentOp();
    for (const id of ALL_FIELDS) ui[id].hidden = !op.fields.includes(id);
    updateRangePreview();
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

function validate() {
    const op = currentOp();
    const wrongKind = queue.filter((item) => (op.needs === 'pdf' ? !item.isPdf : item.isPdf));
    const tooFew = queue.length < op.min;
    const tooMany = op.max && queue.length > op.max;

    ui.runBtn.disabled = tooFew || tooMany || wrongKind.length > 0 || queue.length === 0;

    if (!queue.length) { clearNotice(ui.notice); return; }
    if (wrongKind.length) {
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
    queue = queue.slice(0, MAX_FILES);

    ui.dropzone.hidden = true;
    ui.workspace.hidden = false;
    ui.results.hidden = true;
    renderQueue();

    // Page counts need the document open, so they arrive after the list does.
    for (const item of queue.filter((i) => i.isPdf && i.pageCount === null)) {
        try {
            item.pageCount = await pageCountOf(item.file);
        } catch {
            item.pageCount = 0;
            item.error = 'unreadable';
        }
        renderQueue();
    }
    updateRangePreview();
    validate();
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
            item.error ? 'could not be read' : null,
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
            if (!queue.length) { clearAll(); return; }
            renderQueue();
            updateRangePreview();
            validate();
        });
        actions.append(remove);

        row.append(info, actions);
        return row;
    }));
}

function clearAll() {
    queue = [];
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
        setBusy(ui.runBtn, false);
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
    maxFiles: MAX_FILES,
    maxBytes: MAX_BYTES,
    paste: true,
    onFiles: addFiles,
    onReject: (rejection) => showError(ui.notice, rejection.message),
});

ui.addMoreBtn.addEventListener('click', () => ui.fileInput.click());
ui.clearBtn.addEventListener('click', clearAll);
ui.operation.addEventListener('change', updateFields);
ui.pageRange.addEventListener('input', updateRangePreview);
ui.splitMode.addEventListener('change', () => {
    ui.splitSize.disabled = ui.splitMode.value === 'single';
});
ui.pdfMargin.addEventListener('input', () => {
    ui.pdfMarginValue.textContent = `${ui.pdfMargin.value}pt`;
});
ui.runBtn.addEventListener('click', run);

updateFields();
ui.pdfMarginValue.textContent = `${ui.pdfMargin.value}pt`;
