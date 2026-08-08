// Favicon generator page controller. Wiring only.

import { requireIds, setBusy, debounce } from '../../js/shared/dom.js';
import { formatBytes } from '../../js/shared/format.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { showError, showSuccess, clearNotice } from '../../js/shared/notify.js';
import { copyWithFeedback } from '../../js/shared/clipboard.js';
import { createUrlSlot } from '../../js/shared/objecturl.js';
import { attachDownload } from '../../js/shared/download.js';
import { decodeImageFile } from '../../js/shared/image.js';
import { FAVICON_SIZES } from '../../js/shared/ico.js';
import {
    describeSize,
    renderIcon,
    buildHtmlSnippet,
    generateFaviconSet,
} from './favicon.js';

const ui = requireIds(
    'dropzone', 'fileInput', 'browseBtn', 'notice',
    'workspace', 'sourceName', 'clearBtn',
    'previewGrid', 'siteName', 'themeColor', 'padding', 'paddingValue',
    'useBackground', 'backgroundColor',
    'generateBtn', 'progress', 'progressBar', 'progressText',
    'results', 'resultsInfo', 'downloadZipBtn', 'snippet', 'copySnippetBtn',
);

const zipUrl = createUrlSlot();
let source = null;
let sourceName = '';

// The sizes worth showing at a glance; the zip always contains every size.
const PREVIEW_SIZES = [16, 32, 48, 180, 512];

async function loadFile(file) {
    clearNotice(ui.notice);
    try {
        source = await decodeImageFile(file);
    } catch {
        showError(ui.notice, 'That image could not be opened.');
        return;
    }

    sourceName = file.name;
    ui.sourceName.textContent = `${file.name} — ${source.width} × ${source.height}`;

    // A favicon has to survive being drawn at 16px, and upscaling a tiny source
    // to 512 for the manifest looks worse than saying so up front.
    if (Math.min(source.width, source.height) < 512) {
        showError(ui.notice,
            `This image is ${source.width}×${source.height}. The larger icons will be upscaled `
            + 'and look soft — a source of at least 512×512 gives much better results.');
    }

    ui.dropzone.hidden = true;
    ui.workspace.hidden = false;
    ui.results.hidden = true;
    renderPreviews();
}

function renderPreviews() {
    if (!source) return;
    const options = {
        background: ui.useBackground.checked ? ui.backgroundColor.value : null,
        padding: Number(ui.padding.value) / 100,
    };

    ui.previewGrid.replaceChildren(...PREVIEW_SIZES.map((size) => {
        const canvas = renderIcon(source, size, options);
        // Displayed at a fixed box so 16px and 512px sit side by side, but the
        // canvas itself is the real size, so 16px is genuinely 16px of detail.
        canvas.className = 'favicon-preview-canvas';

        const cell = document.createElement('div');
        cell.className = 'favicon-preview';
        const label = document.createElement('div');
        label.className = 'favicon-preview-label';
        label.textContent = `${size}px`;
        const purpose = document.createElement('div');
        purpose.className = 'favicon-preview-purpose';
        purpose.textContent = describeSize(size);

        cell.append(canvas, label, purpose);
        return cell;
    }));
}

const renderPreviewsSoon = debounce(renderPreviews, 80);

async function generate() {
    if (!source) return;
    clearNotice(ui.notice);
    setBusy(ui.generateBtn, true, 'Generating…');
    ui.progress.hidden = false;

    try {
        const { zip } = await generateFaviconSet(source, {
            sizes: FAVICON_SIZES,
            background: ui.useBackground.checked ? ui.backgroundColor.value : null,
            padding: Number(ui.padding.value) / 100,
            name: ui.siteName.value.trim() || 'My site',
            themeColor: ui.themeColor.value,
            onProgress: ({ ratio, note }) => {
                ui.progressBar.style.width = `${Math.round(ratio * 100)}%`;
                ui.progressText.textContent = note ? `Rendering ${note}…` : '';
            },
        });

        attachDownload(ui.downloadZipBtn, zip, 'favicons.zip', zipUrl);
        ui.resultsInfo.textContent =
            `${FAVICON_SIZES.length} PNGs, favicon.ico and a web manifest — ${formatBytes(zip.size)}`;
        ui.results.hidden = false;
        showSuccess(ui.notice, 'Done. Nothing left your device.');
    } catch (error) {
        showError(ui.notice, error?.message || 'Could not generate the icons.');
    } finally {
        setBusy(ui.generateBtn, false);
        ui.progress.hidden = true;
        ui.progressBar.style.width = '0%';
        ui.progressText.textContent = '';
    }
}

function clearAll() {
    source = null;
    sourceName = '';
    zipUrl.revoke();
    ui.workspace.hidden = true;
    ui.dropzone.hidden = false;
    ui.results.hidden = true;
    ui.previewGrid.replaceChildren();
    clearNotice(ui.notice);
}

createDropzone({
    dropzone: ui.dropzone,
    fileInput: ui.fileInput,
    browseBtn: ui.browseBtn,
    accept: ['image/*'],
    multiple: false,
    maxBytes: 50 * 1024 * 1024,
    paste: true,
    onFiles: (files) => loadFile(files[0]),
    onReject: (rejection) => showError(ui.notice, rejection.message),
});

ui.clearBtn.addEventListener('click', clearAll);
ui.generateBtn.addEventListener('click', generate);
ui.padding.addEventListener('input', () => {
    ui.paddingValue.textContent = `${ui.padding.value}%`;
    renderPreviewsSoon();
});
ui.useBackground.addEventListener('change', renderPreviews);
ui.backgroundColor.addEventListener('input', renderPreviewsSoon);
ui.copySnippetBtn.addEventListener('click', () => copyWithFeedback(ui.copySnippetBtn, ui.snippet.textContent));

ui.snippet.textContent = buildHtmlSnippet();
ui.paddingValue.textContent = `${ui.padding.value}%`;
