// ============================================
// PDF Toolkit — client-side, using pdf-lib
// ============================================
//
// Nothing leaves the tab. That is the feature: the sites people currently use
// for this ask them to upload contracts and scanned passports to a stranger.
//
// The editor holds an ordered list of page *references* (`{ docId, pageIndex,
// rotation }`) rather than page objects. Loading a file only parses it; the
// document is not rewritten until Save, so reordering and rotating stay
// instant and reversible. All of that arithmetic lives in `pdf-ops.js`, which
// is pure and tested.

import { byId } from '../../js/shared/dom.js';
import { showError, showSuccess, clearNotice } from '../../js/shared/notify.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { formatBytes, stripExtension } from '../../js/shared/format.js';
import { PDFDocument, degrees } from '../../js/vendor/pdf-lib.js';
import {
    parsePageRange,
    formatPageRange,
    movePage,
    removePages,
    rotatePages,
    chunkPages,
    outputName,
} from './pdf-ops.js';

const dropzone = byId('dropzone');
const fileInput = byId('fileInput');
const browseBtn = byId('browseBtn');
const loading = byId('loading');
const loadingText = byId('loadingText');
const workspace = byId('workspace');
const pageGrid = byId('pageGrid');
const pageCountLabel = byId('pageCount');
const selectionNote = byId('selectionNote');
const rangeInput = byId('rangeInput');
const splitEvery = byId('splitEvery');
const errorMsg = byId('errorMsg');

const MAX_BYTES = 200 * 1024 * 1024;

/** docId -> { name, doc: PDFDocument } */
const sources = new Map();
let pages = [];
let selection = new Set();
let nextDocId = 0;

// ============================================
// Loading
// ============================================

async function addFiles(files) {
    clearNotice(errorMsg);
    loading.classList.add('active');

    try {
        for (const file of files) {
            loadingText.textContent = `Reading ${file.name}...`;
            // eslint-disable-next-line no-await-in-loop
            await addFile(file);
        }
        render();
        workspace.classList.add('active');
        dropzone.classList.add('dropzone-compact');
    } catch (error) {
        showError(errorMsg, error.message || 'That file could not be read.');
    } finally {
        loading.classList.remove('active');
        loadingText.textContent = 'Reading...';
    }
}

async function addFile(file) {
    const buffer = await file.arrayBuffer();
    const docId = `d${nextDocId += 1}`;

    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        let doc;
        try {
            // ignoreEncryption lets a "protected" PDF that only sets the
            // no-print flag still open. A genuinely password-encrypted file
            // still throws, and is reported as such.
            doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        } catch {
            throw new Error(`${file.name} could not be opened. If it is password-protected, `
                + 'remove the password in a PDF reader first.');
        }

        sources.set(docId, { name: file.name, doc });
        const count = doc.getPageCount();
        for (let i = 0; i < count; i += 1) {
            pages.push({ docId, pageIndex: i, rotation: 0 });
        }
        return;
    }

    // An image becomes a single-page PDF sized to the image, so it can be
    // merged and reordered exactly like any other page.
    const doc = await PDFDocument.create();
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    const embedded = isPng ? await doc.embedPng(buffer) : await doc.embedJpg(buffer);
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });

    sources.set(docId, { name: file.name, doc });
    pages.push({ docId, pageIndex: 0, rotation: 0 });
}

// ============================================
// Rendering
// ============================================

function render() {
    pageGrid.textContent = '';

    pages.forEach((page, index) => {
        const source = sources.get(page.docId);
        const card = document.createElement('div');
        card.className = 'pdf-page-card';
        card.classList.toggle('selected', selection.has(index));
        card.tabIndex = 0;
        card.draggable = true;
        card.dataset.index = String(index);
        card.setAttribute('role', 'button');
        card.setAttribute('aria-pressed', selection.has(index) ? 'true' : 'false');

        const number = document.createElement('div');
        number.className = 'pdf-page-number';
        number.textContent = String(index + 1);

        const origin = document.createElement('div');
        origin.className = 'pdf-page-origin';
        origin.textContent = source ? source.name : 'page';
        origin.title = source ? `${source.name} — page ${page.pageIndex + 1}` : '';

        const detail = document.createElement('div');
        detail.className = 'pdf-page-detail';
        detail.textContent = page.rotation ? `rotated ${page.rotation}°` : `was page ${page.pageIndex + 1}`;

        card.append(number, origin, detail);
        pageGrid.appendChild(card);
    });

    const fileCount = sources.size;
    pageCountLabel.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'}`
        + (fileCount > 1 ? ` from ${fileCount} files` : '');

    selectionNote.textContent = selection.size
        ? `Selected: ${formatPageRange([...selection])}`
        : 'Click pages to select them, or drag a page to move it. '
            + 'With nothing selected, Save writes every page.';

    rangeInput.value = selection.size ? formatPageRange([...selection]) : '';
}

function toggleSelection(index, additive) {
    if (!additive) {
        // A plain click on an already-only-selected page clears it, so there is
        // always a way back to "nothing selected" without a separate button.
        const wasOnly = selection.size === 1 && selection.has(index);
        selection.clear();
        if (!wasOnly) selection.add(index);
    } else if (selection.has(index)) {
        selection.delete(index);
    } else {
        selection.add(index);
    }
    render();
}

/** Which pages an action applies to — the selection, or everything. */
function targetIndices() {
    return selection.size ? [...selection].sort((a, b) => a - b) : pages.map((_, i) => i);
}

// ============================================
// Building output
// ============================================

async function buildPdf(pageRefs) {
    const out = await PDFDocument.create();

    // copyPages is batched per source document because each call re-serialises
    // the source; calling it once per page on a 300-page file is visibly slow.
    const byDoc = new Map();
    pageRefs.forEach((ref, position) => {
        if (!byDoc.has(ref.docId)) byDoc.set(ref.docId, []);
        byDoc.get(ref.docId).push({ ref, position });
    });

    const copied = new Array(pageRefs.length);
    for (const [docId, entries] of byDoc) {
        const source = sources.get(docId);
        if (!source) continue;
        // eslint-disable-next-line no-await-in-loop
        const results = await out.copyPages(source.doc, entries.map(e => e.ref.pageIndex));
        results.forEach((page, i) => { copied[entries[i].position] = { page, ref: entries[i].ref }; });
    }

    for (const item of copied) {
        if (!item) continue;
        if (item.ref.rotation) {
            // Add to whatever rotation the page already carried, rather than
            // replacing it — a scan that was already sideways stays correct.
            const existing = item.page.getRotation().angle || 0;
            item.page.setRotation(degrees((existing + item.ref.rotation) % 360));
        }
        out.addPage(item.page);
    }

    return out.save();
}

function download(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
    }, 100);
}

function sourceNames() {
    return [...sources.values()].map(s => stripExtension(s.name));
}

async function withBusy(button, work) {
    const idle = button.textContent;
    button.disabled = true;
    button.textContent = 'Working...';
    clearNotice(errorMsg);
    try {
        await work();
    } catch (error) {
        showError(errorMsg, error.message || 'Could not build the PDF.');
    } finally {
        button.disabled = false;
        button.textContent = idle;
    }
}

// ============================================
// Events
// ============================================

createDropzone({
    dropzone,
    fileInput,
    browseBtn,
    accept: ['application/pdf', 'image/jpeg', 'image/png'],
    multiple: true,
    maxBytes: MAX_BYTES,
    maxFiles: 50,
    onFiles: addFiles,
    onReject: ({ message }) => showError(errorMsg, message),
});

pageGrid.addEventListener('click', (event) => {
    const card = event.target.closest('.pdf-page-card');
    if (!card) return;
    toggleSelection(Number(card.dataset.index), event.metaKey || event.ctrlKey || event.shiftKey);
});

pageGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.pdf-page-card');
    if (!card) return;
    event.preventDefault();
    toggleSelection(Number(card.dataset.index), event.shiftKey);
});

// --- Drag to reorder ---
let draggingFrom = null;

pageGrid.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.pdf-page-card');
    if (!card) return;
    draggingFrom = Number(card.dataset.index);
    // Firefox will not start a drag without data on the transfer.
    event.dataTransfer.setData('text/plain', String(draggingFrom));
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
});

pageGrid.addEventListener('dragend', () => {
    draggingFrom = null;
    pageGrid.querySelectorAll('.dragging, .drop-target')
        .forEach(el => el.classList.remove('dragging', 'drop-target'));
});

pageGrid.addEventListener('dragover', (event) => {
    if (draggingFrom === null) return;
    event.preventDefault();
    const card = event.target.closest('.pdf-page-card');
    pageGrid.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    if (card) card.classList.add('drop-target');
});

pageGrid.addEventListener('drop', (event) => {
    if (draggingFrom === null) return;
    event.preventDefault();
    const card = event.target.closest('.pdf-page-card');
    if (!card) return;
    pages = movePage(pages, draggingFrom, Number(card.dataset.index));
    // Indices no longer mean what they did, so the selection is stale.
    selection.clear();
    draggingFrom = null;
    render();
});

rangeInput.addEventListener('change', () => {
    const { pages: parsed, errors } = parsePageRange(rangeInput.value, pages.length);
    selection = new Set(parsed);
    render();
    if (errors.length) {
        showError(errorMsg, `Ignored: ${errors.join(', ')}. Use page numbers within `
            + `1-${pages.length}, like "1-3, 5, 8-end".`);
    }
});

byId('selectAllBtn').addEventListener('click', () => {
    selection = selection.size === pages.length ? new Set() : new Set(pages.map((_, i) => i));
    render();
});

byId('clearBtn').addEventListener('click', () => {
    sources.clear();
    pages = [];
    selection.clear();
    nextDocId = 0;
    fileInput.value = '';
    workspace.classList.remove('active');
    dropzone.classList.remove('dropzone-compact');
    clearNotice(errorMsg);
});

byId('rotateLeftBtn').addEventListener('click', () => {
    pages = rotatePages(pages, targetIndices(), -90);
    render();
});

byId('rotateRightBtn').addEventListener('click', () => {
    pages = rotatePages(pages, targetIndices(), 90);
    render();
});

byId('deleteBtn').addEventListener('click', () => {
    if (!selection.size) {
        showError(errorMsg, 'Select the pages to delete first — otherwise this would empty '
            + 'the whole document.');
        return;
    }
    pages = removePages(pages, [...selection]);
    selection.clear();
    if (!pages.length) {
        showError(errorMsg, 'That removed every page. Add a file to start again.');
    }
    render();
});

byId('extractBtn').addEventListener('click', (event) => withBusy(event.currentTarget, async () => {
    if (!selection.size) throw new Error('Select some pages first.');
    const chosen = [...selection].sort((a, b) => a - b).map(i => pages[i]);
    const bytes = await buildPdf(chosen);
    const name = outputName(sourceNames(), 'extract');
    download(bytes, name);
    showSuccess(errorMsg, `Saved ${name} — ${chosen.length} pages, ${formatBytes(bytes.length)}.`);
}));

byId('saveBtn').addEventListener('click', (event) => withBusy(event.currentTarget, async () => {
    if (!pages.length) throw new Error('There is nothing to save.');
    const bytes = await buildPdf(pages);
    const name = outputName(sourceNames(), sources.size > 1 ? 'merge' : 'edited');
    download(bytes, name);
    showSuccess(errorMsg, `Saved ${name} — ${pages.length} pages, ${formatBytes(bytes.length)}.`);
}));

byId('splitBtn').addEventListener('click', (event) => withBusy(event.currentTarget, async () => {
    if (!pages.length) throw new Error('There is nothing to split.');
    const size = Math.max(1, Number(splitEvery.value) || 1);
    const chunks = chunkPages(pages, size);
    if (chunks.length === 1) throw new Error('That would produce a single file. Choose a '
        + 'smaller number of pages per file.');

    const base = stripExtension(sourceNames()[0] || 'document');
    for (let i = 0; i < chunks.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const bytes = await buildPdf(chunks[i]);
        download(bytes, `${base}-part-${i + 1}.pdf`);
    }
    showSuccess(errorMsg, `Saved ${chunks.length} files.`);
}));
