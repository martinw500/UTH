// Text from Image page controller. Wiring only: recognition is in
// js/shared/ocr.js, the tidying in js/shared/ocr-text.js.

import { requireIds, setBusy, el } from '../../js/shared/dom.js';
import { formatBytes, stripExtension } from '../../js/shared/format.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { showError, showSuccess, clearNotice, announce } from '../../js/shared/notify.js';
import { copyWithFeedback } from '../../js/shared/clipboard.js';
import { saveBlob } from '../../js/shared/download.js';
import { decodeImageFile } from '../../js/shared/image.js';
import { getString, setString } from '../../js/shared/storage.js';
import { openPdf, renderPage, closePdf } from '../../js/shared/pdf-render.js';
import { recognise, OCR_LANGUAGES } from '../../js/shared/ocr.js';
import { tidyOcrText, joinOcrPages } from '../../js/shared/ocr-text.js';

const MAX_FILES = 20;
const MAX_BYTES = 100 * 1024 * 1024;
// ponytail: a hard page cap, not a range picker; add one if long scans matter.
const MAX_PDF_PAGES = 50;
// ~216 dpi for a PDF page: tesseract wants ~300 dpi text, and most scans hold less.
const PDF_SCALE = 3;
const LANG_KEY = 'uth-ocr-lang';

const ui = requireIds(
    'dropzone', 'fileInput', 'browseBtn', 'notice',
    'workspace', 'queueSummary', 'addMoreBtn', 'clearBtn', 'fileList', 'ocrLang',
    'runBtn', 'progress', 'progressBar', 'progressText',
    'results', 'resultsInfo', 'copyBtn', 'downloadTxtBtn', 'ocrOutput',
);

let queue = [];
let running = false;

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

function addFiles(files) {
    queue.push(...files);
    const leftOut = Math.max(0, queue.length - MAX_FILES);
    queue = queue.slice(0, MAX_FILES);
    ui.dropzone.hidden = true;
    ui.workspace.hidden = false;
    clearNotice(ui.notice);
    render();
    if (leftOut) showError(ui.notice, `Up to ${MAX_FILES} files at a time, so ${leftOut} ${leftOut === 1 ? 'was' : 'were'} left out.`);
}

function render() {
    ui.queueSummary.textContent = `${queue.length} file${queue.length === 1 ? '' : 's'}`;
    ui.fileList.replaceChildren(...queue.map((file) => el('div', { class: 'file-item' },
        el('div', { class: 'file-item-info' },
            el('span', { class: 'file-item-name' }, file.name),
            el('span', { class: 'file-item-size' }, formatBytes(file.size))),
        el('div', { class: 'file-item-actions' },
            el('button', {
                type: 'button', class: 'file-item-remove', 'aria-label': `Remove ${file.name}`,
                onclick: () => {
                    queue = queue.filter((f) => f !== file);
                    if (!queue.length) clearAll(); else render();
                },
            }, '×')))));
    ui.runBtn.disabled = running || !queue.length;
}

function clearAll() {
    queue = [];
    ui.workspace.hidden = true;
    ui.dropzone.hidden = false;
    ui.results.hidden = true;
    ui.ocrOutput.value = '';
    clearNotice(ui.notice);
}

/** Each image, or each PDF page, as something tesseract can read, with a label. */
async function* pagesOf(file, notes) {
    if (!isPdf(file)) {
        // Through decodeImageFile so HEIC and EXIF rotation work, then onto a
        // canvas: tesseract cannot read an ImageBitmap.
        const bitmap = await decodeImageFile(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close?.();
        yield { source: file.name, image: canvas };
        return;
    }
    const doc = await openPdf(file);
    try {
        const count = Math.min(doc.numPages, MAX_PDF_PAGES);
        if (doc.numPages > MAX_PDF_PAGES) notes.push(`Only the first ${MAX_PDF_PAGES} pages of ${file.name} were read.`);
        for (let n = 1; n <= count; n += 1) {
            yield { source: `${file.name}, page ${n}`, image: await renderPage(doc, n, { scale: PDF_SCALE, maxPixels: 25e6 }) };
        }
    } finally {
        closePdf(doc);
    }
}

function showProgress(label, ratio) {
    ui.progressText.textContent = label;
    ui.progressBar.style.width = `${Math.round(ratio * 100)}%`;
}

async function run() {
    running = true;
    setBusy(ui.runBtn, true, 'Reading…');
    clearNotice(ui.notice);
    ui.results.hidden = true;
    ui.progress.hidden = false;
    const lang = ui.ocrLang.value;
    setString(LANG_KEY, lang);

    const parts = [];
    const notes = [];
    try {
        for (const [index, file] of queue.entries()) {
            for await (const { source, image } of pagesOf(file, notes)) {
                const step = (label, progress = 0) => showProgress(
                    `${label} — ${source}`, (index + progress) / queue.length);
                const { text } = await recognise(image, {
                    lang,
                    progress: ({ status, progress }) => step(
                        status === 'recognizing text' ? 'Reading' : 'Getting the reading engine ready', progress ?? 0),
                });
                image.width = 0; // release the pixels before the next page
                parts.push({ source, text: tidyOcrText(text) });
            }
        }
        const text = joinOcrPages(parts);
        ui.ocrOutput.value = text;
        ui.results.hidden = false;
        const words = text.split(/\s+/).filter(Boolean).length;
        ui.resultsInfo.textContent = `${words} word${words === 1 ? '' : 's'} from ${parts.length} `
            + `${parts.length === 1 ? 'image' : 'images and pages'}`;
        if (!words) showError(ui.notice, 'No text was found. Try a sharper image, or check the language.');
        else if (notes.length) showError(ui.notice, notes.join(' '));
        else showSuccess(ui.notice, 'Done. Nothing left your device.');
        announce(`${words} words recognised`);
    } catch (error) {
        showError(ui.notice, error?.message || 'Could not read that.');
    } finally {
        running = false;
        setBusy(ui.runBtn, false);
        ui.progress.hidden = true;
        showProgress('', 0);
        render();
    }
}

ui.ocrLang.replaceChildren(...OCR_LANGUAGES.map(([code, name]) => el('option', { value: code }, name)));
const savedLang = getString(LANG_KEY);
if (OCR_LANGUAGES.some(([code]) => code === savedLang)) ui.ocrLang.value = savedLang;

createDropzone({
    dropzone: ui.dropzone,
    fileInput: ui.fileInput,
    browseBtn: ui.browseBtn,
    accept: ['image/*', '.heic', '.heif', 'application/pdf', '.pdf'],
    multiple: true,
    maxBytes: MAX_BYTES,
    paste: true,
    onFiles: addFiles,
    onReject: (rejection) => showError(ui.notice, rejection.message),
});

ui.addMoreBtn.addEventListener('click', () => ui.fileInput.click());
ui.clearBtn.addEventListener('click', clearAll);
ui.runBtn.addEventListener('click', run);
ui.copyBtn.addEventListener('click', () => copyWithFeedback(ui.copyBtn, ui.ocrOutput.value));
ui.downloadTxtBtn.addEventListener('click', () => {
    const name = queue.length === 1 ? `${stripExtension(queue[0].name)}.txt` : 'text.txt';
    saveBlob(new Blob([ui.ocrOutput.value], { type: 'text/plain;charset=utf-8' }), name);
});
