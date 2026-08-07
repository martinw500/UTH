// Image editor page controller.
//
// Wiring only: the maths lives in js/shared/{geometry,pipeline,compression,
// convolve,exif,image}.js and the rendering in ./render.js, both DOM-free and
// covered by tests. Anything here that grows a decision worth testing should
// move into ./editor-state.js.

import { requireIds, debounce, setBusy } from '../../js/shared/dom.js';
import { formatBytes } from '../../js/shared/format.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { showError, clearNotice, notify, announce } from '../../js/shared/notify.js';
import { createUrlSlot, createUrlPool } from '../../js/shared/objecturl.js';
import { readExifFromFile, summariseExif } from '../../js/shared/exif.js';
import {
    EXT_BY_MIME,
    canEncode,
    compressToTarget,
    decodeImageFile,
    drawWithBackground,
    encodeVerified,
    isLossless,
} from '../../js/shared/image.js';
import {
    COMPRESSION_PRESETS,
    describeTargetResult,
    parseTargetBytes,
    presetForQuality,
    qualityForPreset,
    savings,
} from '../../js/shared/compression.js';
import {
    createState,
    cloneState,
    outputSize,
    normaliseRotation,
    FULL_RECT,
} from '../../js/shared/pipeline.js';
import {
    centredRect,
    clampRect,
    elementToNormalised,
    moveRect,
    normalisedToPx,
    parseRatio,
    pxToNormalised,
    resizeRectByHandle,
} from '../../js/shared/geometry.js';
import {
    createBatch,
    createHistory,
    outputFilename,
    resolveResize,
    shouldAutoEstimate,
} from './editor-state.js';
import { renderState, previewScaleFor } from './render.js';

const MAX_FILES = 50;
const MAX_BYTES = 100 * 1024 * 1024;

const ui = requireIds(
    'dropzone', 'fileInput', 'browseBtn', 'editorNotice', 'editorWorkspace',
    'editorFilename', 'editorMeta', 'addMoreBtn', 'removeImageBtn',
    'batchStrip', 'batchCount', 'fileList', 'metadataNotice',
    'canvasWrapper', 'previewCanvas', 'cropOverlay', 'cropSelection', 'cropSizeLabel',
    'cropBtn', 'rotateLeftBtn', 'rotateRightBtn', 'flipHBtn', 'flipVBtn', 'undoBtn', 'resetBtn',
    'cropConfirmBar', 'cropInfo', 'applyCropBtn', 'cancelCropBtn',
    'cropAspect', 'cropCustomRatio', 'cropRatioW', 'cropRatioH',
    'cropX', 'cropY', 'cropW', 'cropH',
    'brightnessSlider', 'brightnessValue', 'contrastSlider', 'contrastValue',
    'saturationSlider', 'saturationValue', 'blurSlider', 'blurValue',
    'sharpenSlider', 'sharpenValue', 'grayscaleSlider', 'grayscaleValue',
    'sepiaSlider', 'sepiaValue', 'invertSlider', 'invertValue',
    'hueSlider', 'hueValue', 'straightenSlider', 'straightenValue',
    'autoCropStraighten', 'resetAdjustBtn',
    'resizeUnit', 'resizeWidth', 'resizeHeight', 'resizeMode', 'resizeHint',
    'resizeWidthLabel', 'resizeHeightLabel',
    'aspectLockBtn', 'applyResizeBtn', 'resetSizeBtn',
    'outputFormat', 'avifOption', 'qualityGroup', 'qualitySlider', 'qualityValue',
    'compressionGroup', 'compressionSelect', 'targetSizeGroup', 'targetSizeInput',
    'targetSizeUnit', 'matteGroup', 'matteColor',
    'exportBtn', 'cancelExportBtn', 'exportEstimate',
    'exportProgress', 'exportProgressBar', 'exportProgressText',
    'results', 'resultsInfo', 'downloadZipBtn', 'outputItem', 'outputPreview',
    'outputName', 'outputSize', 'outputSavings', 'downloadBtn', 'outputList',
);

const batch = createBatch();
const history = createHistory();
const singleUrl = createUrlSlot();
const batchUrls = createUrlPool();

let state = createState();
let cropping = false;
let cropRect = { ...FULL_RECT };
let aspectLocked = true;
let lastResizeEdited = 'width';
let exportAborted = false;
let estimateToken = 0;

// ============================================
// Adjustment sliders
// ============================================

const ADJUST_CONTROLS = [
    ['brightness', ui.brightnessSlider, ui.brightnessValue, ''],
    ['contrast', ui.contrastSlider, ui.contrastValue, ''],
    ['saturation', ui.saturationSlider, ui.saturationValue, ''],
    ['blur', ui.blurSlider, ui.blurValue, ''],
    ['sharpen', ui.sharpenSlider, ui.sharpenValue, ''],
    ['grayscale', ui.grayscaleSlider, ui.grayscaleValue, ''],
    ['sepia', ui.sepiaSlider, ui.sepiaValue, ''],
    ['invert', ui.invertSlider, ui.invertValue, ''],
    ['hueRotate', ui.hueSlider, ui.hueValue, '°'],
];

function syncAdjustmentInputs() {
    for (const [key, slider, display, unit] of ADJUST_CONTROLS) {
        slider.value = String(state.adjust[key]);
        display.textContent = `${state.adjust[key]}${unit}`;
    }
    ui.straightenSlider.value = String(state.straighten);
    ui.straightenValue.textContent = `${state.straighten}°`;
    ui.autoCropStraighten.checked = state.autoCropStraighten;
}

// ============================================
// Preview
// ============================================

function currentItem() {
    return batch.selected();
}

function renderPreview() {
    const item = currentItem();
    if (!item?.source) return;

    const size = outputSize(item.width, item.height, state);
    const scale = previewScaleFor(
        size.width, size.height, ui.canvasWrapper.clientWidth || 800,
    );

    const canvas = renderState(item.source, state, {
        background: needsMatte() ? ui.matteColor.value : null,
        previewScale: scale,
        // Sharpening every preview frame is a full getImageData/putImageData
        // round trip; at slider speed that stutters. The export is not skipped.
        skipSharpen: true,
    });

    ui.previewCanvas.width = canvas.width;
    ui.previewCanvas.height = canvas.height;
    ui.previewCanvas.getContext('2d').drawImage(canvas, 0, 0);

    updateMeta();
    if (cropping) positionCropOverlay();
}

const renderPreviewSoon = debounce(renderPreview, 60);

function updateMeta() {
    const item = currentItem();
    if (!item) return;
    const size = outputSize(item.width, item.height, state);
    const changed = size.width !== item.width || size.height !== item.height;
    ui.editorFilename.textContent = item.name;
    ui.editorMeta.textContent = changed
        ? `${item.width} × ${item.height} → ${size.width} × ${size.height} · ${formatBytes(item.size)}`
        : `${item.width} × ${item.height} · ${formatBytes(item.size)}`;
}

// ============================================
// Loading
// ============================================

async function loadFiles(files) {
    clearNotice(ui.editorNotice);
    const added = batch.add(files.slice(0, MAX_FILES - batch.size));

    for (const item of added) {
        try {
            item.source = await decodeImageFile(item.file);
            item.width = item.source.width;
            item.height = item.source.height;
            item.exif = await readExifFromFile(item.file);
            item.status = 'ready';
        } catch {
            item.status = 'error';
            item.error = 'Could not decode this image.';
        }
    }

    const failed = added.filter((item) => item.status === 'error');
    if (failed.length) {
        showError(ui.editorNotice, failed.length === added.length
            ? 'None of those files could be opened as images.'
            : `${failed.length} of ${added.length} files could not be opened.`);
        for (const item of failed) batch.remove(item.id);
    }

    if (!batch.size) {
        showWorkspace(false);
        return;
    }

    ui.dropzone.style.display = 'none';
    showWorkspace(true);
    resetSizeInputs();
    renderBatchStrip();
    renderMetadataNotice();
    renderPreview();
    scheduleEstimate();
}

function showWorkspace(visible) {
    ui.editorWorkspace.style.display = visible ? '' : 'none';
    ui.dropzone.style.display = visible ? 'none' : '';
    ui.results.style.display = 'none';
}

function clearAll() {
    batch.clear();
    singleUrl.revoke();
    batchUrls.revokeAll();
    state = createState();
    history.reset(state);
    cropping = false;
    ui.cropOverlay.style.display = 'none';
    ui.cropConfirmBar.style.display = 'none';
    ui.cropBtn.classList.remove('active');
    syncAdjustmentInputs();
    clearNotice(ui.editorNotice);
    ui.metadataNotice.hidden = true;
    ui.outputList.replaceChildren();
    showWorkspace(false);
    updateUndoButton();
}

// ============================================
// Batch strip
// ============================================

function renderBatchStrip() {
    const items = batch.list();
    ui.batchStrip.hidden = items.length < 2;
    ui.batchCount.textContent = `${items.length} image${items.length === 1 ? '' : 's'}`;

    ui.fileList.replaceChildren(...items.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'batch-item';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(item.id === batch.selectedId));
        if (item.id === batch.selectedId) button.classList.add('active');
        button.dataset.id = String(item.id);

        const name = document.createElement('span');
        name.className = 'batch-item-name';
        name.textContent = item.name;

        const meta = document.createElement('span');
        meta.className = 'batch-item-meta';
        meta.textContent = `${item.width}×${item.height}`;

        const remove = document.createElement('span');
        remove.className = 'batch-item-remove';
        remove.dataset.remove = String(item.id);
        remove.setAttribute('role', 'button');
        remove.setAttribute('aria-label', `Remove ${item.name}`);
        remove.textContent = '×';

        button.append(name, meta, remove);
        return button;
    }));
}

function renderMetadataNotice() {
    const item = currentItem();
    const lines = summariseExif(item?.exif);
    if (!lines.length) {
        ui.metadataNotice.hidden = true;
        return;
    }
    // Canvas re-encoding always drops this; there is no API to keep it. Saying
    // so is the only honest option, and it is genuinely useful for GPS.
    ui.metadataNotice.hidden = false;
    ui.metadataNotice.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = 'This image carries metadata that the export will not include:';
    const list = document.createElement('ul');
    for (const line of lines) {
        const entry = document.createElement('li');
        entry.textContent = line;
        list.append(entry);
    }
    ui.metadataNotice.append(heading, list);
}

// ============================================
// History
// ============================================

function commit(mutate) {
    history.push(state);
    const next = cloneState(state);
    mutate(next);
    state = next;
    history.replace(state);
    updateUndoButton();
    renderPreview();
    scheduleEstimate();
}

function updateUndoButton() {
    ui.undoBtn.disabled = !history.canUndo;
}

// ============================================
// Crop
// ============================================

function currentRatio() {
    const item = currentItem();
    if (ui.cropAspect.value === 'custom') {
        const w = Number(ui.cropRatioW.value);
        const h = Number(ui.cropRatioH.value);
        return w > 0 && h > 0 ? w / h : null;
    }
    const size = item ? outputSize(item.width, item.height, { ...state, crop: FULL_RECT }) : null;
    return parseRatio(ui.cropAspect.value, size?.width ?? 1, size?.height ?? 1);
}

function croppableSize() {
    const item = currentItem();
    if (!item) return { width: 1, height: 1 };
    // The crop rect is relative to the source, before any resize.
    const rotated = normaliseRotation(state.rotate) % 180 === 90;
    return rotated
        ? { width: item.height, height: item.width }
        : { width: item.width, height: item.height };
}

function enterCropMode() {
    if (!currentItem()) return;
    cropping = true;
    ui.cropBtn.classList.add('active');
    ui.cropOverlay.style.display = '';
    ui.cropConfirmBar.style.display = '';
    const { width, height } = croppableSize();
    cropRect = centredRect(currentRatio(), width, height, 0.8);
    positionCropOverlay();
    syncCropInputs();
}

function cancelCrop() {
    cropping = false;
    ui.cropBtn.classList.remove('active');
    ui.cropOverlay.style.display = 'none';
    ui.cropConfirmBar.style.display = 'none';
}

function positionCropOverlay() {
    // Positioned as percentages of the overlay, so the rect stays correct at any
    // rendered size. This is what the pixel-based version got wrong.
    ui.cropSelection.style.left = `${cropRect.x * 100}%`;
    ui.cropSelection.style.top = `${cropRect.y * 100}%`;
    ui.cropSelection.style.width = `${cropRect.w * 100}%`;
    ui.cropSelection.style.height = `${cropRect.h * 100}%`;

    const { width, height } = croppableSize();
    const px = normalisedToPx(cropRect, width, height);
    ui.cropSizeLabel.textContent = `${px.width} × ${px.height}`;
    ui.cropInfo.textContent = `Crop area: ${px.width} × ${px.height} px`;
}

function syncCropInputs() {
    const { width, height } = croppableSize();
    const px = normalisedToPx(cropRect, width, height);
    ui.cropX.value = String(px.x);
    ui.cropY.value = String(px.y);
    ui.cropW.value = String(px.width);
    ui.cropH.value = String(px.height);
}

function applyCropFromInputs() {
    const { width, height } = croppableSize();
    const next = pxToNormalised({
        x: Number(ui.cropX.value) || 0,
        y: Number(ui.cropY.value) || 0,
        width: Number(ui.cropW.value) || 1,
        height: Number(ui.cropH.value) || 1,
    }, width, height);
    cropRect = clampRect(next);
    positionCropOverlay();
}

// Pointer handling. One path for mouse and touch, in normalised coordinates.
let dragMode = null;      // 'move' | handle name
let dragOrigin = null;
let dragStartRect = null;

function pointerPosition(event) {
    const point = event.touches?.[0] ?? event;
    return elementToNormalised(point.clientX, point.clientY, ui.cropOverlay);
}

function onCropPointerDown(event) {
    if (!cropping) return;
    const handle = event.target?.dataset?.handle;
    const position = pointerPosition(event);

    const inside = position.x >= cropRect.x && position.x <= cropRect.x + cropRect.w
        && position.y >= cropRect.y && position.y <= cropRect.y + cropRect.h;

    if (!handle && !inside) return;
    dragMode = handle || 'move';
    dragOrigin = position;
    dragStartRect = { ...cropRect };
    event.preventDefault();
}

function onCropPointerMove(event) {
    if (!dragMode) return;
    const position = pointerPosition(event);
    const dx = position.x - dragOrigin.x;
    const dy = position.y - dragOrigin.y;
    const { width, height } = croppableSize();

    cropRect = dragMode === 'move'
        ? moveRect(dragStartRect, dx, dy)
        : resizeRectByHandle(dragStartRect, dragMode, dx, dy, {
            ratio: currentRatio(), srcW: width, srcH: height,
        });

    positionCropOverlay();
    syncCropInputs();
    event.preventDefault();
}

function onCropPointerUp() {
    dragMode = null;
}

// ============================================
// Resize
// ============================================

function resetSizeInputs() {
    const item = currentItem();
    if (!item) return;
    const size = outputSize(item.width, item.height, { ...state, resize: null });
    if (ui.resizeUnit.value === 'percent') {
        ui.resizeWidth.value = '100';
        ui.resizeHeight.value = '100';
    } else {
        ui.resizeWidth.value = String(size.width);
        ui.resizeHeight.value = String(size.height);
    }
    updateResizeHint();
}

function updateResizeUnitLabels() {
    const percent = ui.resizeUnit.value === 'percent';
    ui.resizeWidthLabel.textContent = percent ? 'Scale (%)' : 'Width (px)';
    ui.resizeHeightLabel.textContent = percent ? 'Scale (%)' : 'Height (px)';
    // A percentage scales both axes together, so a second field and the aspect
    // lock would both be meaningless.
    ui.resizeHeight.disabled = percent;
    ui.aspectLockBtn.disabled = percent;
}

function updateResizeHint() {
    const item = currentItem();
    if (!item) return;
    const size = outputSize(item.width, item.height, state);
    ui.resizeHint.textContent = batch.size > 1
        ? `Applied to all ${batch.size} images. Preview: ${size.width} × ${size.height}.`
        : `Output: ${size.width} × ${size.height}`;
}

function applyResize() {
    const item = currentItem();
    if (!item) return;
    const base = outputSize(item.width, item.height, { ...state, resize: null });
    const resolved = resolveResize({
        unit: ui.resizeUnit.value,
        width: ui.resizeWidth.value,
        height: ui.resizeHeight.value,
        lockAspect: aspectLocked,
        currentWidth: base.width,
        currentHeight: base.height,
        lastEdited: lastResizeEdited,
    });
    if (!resolved) return;
    commit((next) => { next.resize = { ...resolved, mode: ui.resizeMode.value }; });
    updateResizeHint();
}

function syncLockedDimension(edited) {
    if (!aspectLocked || ui.resizeUnit.value === 'percent') return;
    const item = currentItem();
    if (!item) return;
    const base = outputSize(item.width, item.height, { ...state, resize: null });
    const resolved = resolveResize({
        unit: 'px',
        width: ui.resizeWidth.value,
        height: ui.resizeHeight.value,
        lockAspect: true,
        currentWidth: base.width,
        currentHeight: base.height,
        lastEdited: edited,
    });
    if (!resolved) return;
    if (edited === 'width') ui.resizeHeight.value = String(resolved.height);
    else ui.resizeWidth.value = String(resolved.width);
}

// ============================================
// Export settings
// ============================================

function needsMatte() {
    return !isLossless(ui.outputFormat.value) && ui.outputFormat.value === 'image/jpeg';
}

function updateExportUI() {
    const lossless = isLossless(ui.outputFormat.value);
    ui.qualityGroup.hidden = lossless;
    ui.compressionGroup.hidden = lossless;
    ui.matteGroup.hidden = !needsMatte();
    // PNG ignores quality entirely, but a target size is still reachable by
    // downscaling, so that field stays available.
    ui.targetSizeGroup.hidden = false;
}

function currentQuality() {
    return Number(ui.qualitySlider.value) / 100;
}

function syncPresetFromSlider() {
    ui.qualityValue.textContent = ui.qualitySlider.value;
    ui.compressionSelect.value = presetForQuality(currentQuality());
}

function syncSliderFromPreset() {
    const quality = qualityForPreset(ui.compressionSelect.value);
    if (quality === null) return;   // 'custom' — leave the slider alone
    ui.qualitySlider.value = String(Math.round(quality * 100));
    ui.qualityValue.textContent = ui.qualitySlider.value;
}

// ============================================
// Live size estimate
// ============================================

async function estimate() {
    const item = currentItem();
    if (!item?.source) return;

    const size = outputSize(item.width, item.height, state);
    if (!shouldAutoEstimate(size.width, size.height)) {
        ui.exportEstimate.textContent = `${size.width} × ${size.height} — too large to estimate live.`;
        return;
    }

    const token = ++estimateToken;
    try {
        const canvas = renderState(item.source, state, {
            background: needsMatte() ? ui.matteColor.value : null,
        });
        const source = needsMatte()
            ? drawWithBackground(canvas, ui.outputFormat.value, ui.matteColor.value)
            : canvas;
        const { blob, fellBack } = await encodeVerified(
            source, ui.outputFormat.value, currentQuality(),
        );
        // A slower earlier estimate must not overwrite a newer one.
        if (token !== estimateToken) return;

        const delta = savings(item.size, blob.size);
        ui.exportEstimate.textContent =
            `${size.width} × ${size.height} · ${formatBytes(item.size)} → about `
            + `${formatBytes(blob.size)}${delta.label ? ` (${delta.label})` : ''}`;

        if (fellBack) {
            notify(ui.editorNotice,
                'Your browser cannot encode that format and substituted PNG. '
                + 'Pick a different format, or the file will not match its extension.',
                { level: 'error' });
        }
    } catch {
        if (token === estimateToken) ui.exportEstimate.textContent = '';
    }
}

const scheduleEstimate = debounce(estimate, 300);

// ============================================
// Export
// ============================================

async function encodeItem(item) {
    const format = ui.outputFormat.value;
    const targetBytes = parseTargetBytes(ui.targetSizeInput.value, ui.targetSizeUnit.value);
    const background = needsMatte() ? ui.matteColor.value : '#ffffff';

    const canvas = renderState(item.source, state, {
        background: needsMatte() ? ui.matteColor.value : null,
    });

    if (targetBytes) {
        const result = await compressToTarget(canvas, format, targetBytes, {
            background,
            onProgress: ({ attempt, size }) => {
                ui.exportProgressText.textContent =
                    `Attempt ${attempt}: ${formatBytes(size)} (target ${formatBytes(targetBytes)})`;
            },
        });
        return { blob: result.blob, note: describeTargetResult(result, targetBytes, formatBytes) };
    }

    const source = drawWithBackground(canvas, format, background);
    const { blob } = await encodeVerified(source, format, currentQuality());
    return { blob, note: '' };
}

async function exportAll() {
    const items = batch.list().filter((item) => item.source);
    if (!items.length) return;

    exportAborted = false;
    clearNotice(ui.editorNotice);
    setBusy(ui.exportBtn, true, 'Exporting…');
    ui.cancelExportBtn.hidden = items.length < 2;
    ui.exportProgress.hidden = items.length < 2;
    batchUrls.revokeAll();
    ui.outputList.replaceChildren();

    const extension = EXT_BY_MIME[ui.outputFormat.value] ?? 'png';
    let completed = 0;
    let lastNote = '';

    try {
        // Strictly serial. Encoding 50 large images in parallel will exhaust the
        // tab's memory and fail with nothing useful to show the user.
        for (const item of items) {
            if (exportAborted) break;
            ui.exportProgressText.textContent = `Encoding ${item.name}…`;

            try {
                const { blob, note } = await encodeItem(item);
                lastNote = note || lastNote;
                item.result = { blob, filename: outputFilename(item.name, extension) };
                item.status = 'done';
            } catch {
                item.status = 'error';
                item.error = 'Encoding failed.';
            }

            completed += 1;
            const percent = Math.round((completed / items.length) * 100);
            ui.exportProgressBar.style.width = `${percent}%`;
        }

        showResults(items, lastNote);
    } finally {
        setBusy(ui.exportBtn, false);
        ui.cancelExportBtn.hidden = true;
        ui.exportProgress.hidden = true;
        ui.exportProgressBar.style.width = '0%';
        ui.exportProgressText.textContent = '';
    }
}

function showResults(items, note) {
    const done = items.filter((item) => item.status === 'done' && item.result);
    if (!done.length) {
        showError(ui.editorNotice, 'Nothing could be exported.');
        return;
    }

    ui.results.style.display = '';
    ui.exportEstimate.textContent = note;

    const single = done.length === 1;
    ui.outputItem.hidden = !single;
    ui.downloadZipBtn.hidden = single;
    ui.resultsInfo.textContent = single
        ? '1 image exported'
        : `${done.length} of ${items.length} images exported`;

    if (single) {
        const item = done[0];
        const url = singleUrl.set(item.result.blob);
        ui.outputPreview.src = url;
        ui.outputName.textContent = item.result.filename;
        ui.outputSize.textContent = formatBytes(item.result.blob.size);
        const delta = savings(item.size, item.result.blob.size);
        ui.outputSavings.textContent = delta.label;
        ui.outputSavings.className =
            `output-savings ${delta.direction === 'smaller' ? 'positive' : 'negative'}`;
        ui.downloadBtn.href = url;
        ui.downloadBtn.download = item.result.filename;
        ui.outputList.replaceChildren();
    } else {
        ui.outputList.replaceChildren(...done.map((item) => renderResultRow(item)));
    }

    announce(`${done.length} image${done.length === 1 ? '' : 's'} exported`);
}

function renderResultRow(item) {
    const url = batchUrls.set(item.id, item.result.blob);
    const row = document.createElement('div');
    row.className = 'output-item';

    const preview = document.createElement('div');
    preview.className = 'output-item-preview';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    preview.append(img);

    const info = document.createElement('div');
    info.className = 'output-item-info';
    const name = document.createElement('div');
    name.className = 'output-item-name';
    name.textContent = item.result.filename;
    const meta = document.createElement('div');
    meta.className = 'output-item-meta';
    const delta = savings(item.size, item.result.blob.size);
    meta.textContent = `${formatBytes(item.result.blob.size)}${delta.label ? ` · ${delta.label}` : ''}`;
    info.append(name, meta);

    const link = document.createElement('a');
    link.className = 'btn btn-primary btn-sm';
    link.href = url;
    link.download = item.result.filename;
    link.textContent = 'Download';

    row.append(preview, info, link);
    return row;
}

/**
 * Download every result.
 *
 * Not a ZIP yet -- js/shared/zip.js arrives with the converter hub. Browsers
 * throttle rapid successive downloads, hence the stagger.
 */
function downloadAll() {
    const done = batch.list().filter((item) => item.status === 'done' && item.result);
    done.forEach((item, index) => {
        setTimeout(() => {
            const link = document.createElement('a');
            link.href = batchUrls.get(item.id);
            link.download = item.result.filename;
            link.click();
        }, index * 350);
    });
}

// ============================================
// Wiring
// ============================================

createDropzone({
    dropzone: ui.dropzone,
    fileInput: ui.fileInput,
    browseBtn: ui.browseBtn,
    accept: ['image/*'],
    multiple: true,
    maxFiles: MAX_FILES,
    maxBytes: MAX_BYTES,
    paste: true,
    onFiles: (files) => loadFiles(Array.from(files)),
    onReject: (rejections) => {
        const first = rejections[0];
        if (first) showError(ui.editorNotice, first.message);
    },
});

ui.addMoreBtn.addEventListener('click', () => ui.fileInput.click());
ui.removeImageBtn.addEventListener('click', clearAll);

ui.fileList.addEventListener('click', (event) => {
    const removeId = event.target?.dataset?.remove;
    if (removeId) {
        event.stopPropagation();
        batchUrls.revoke(Number(removeId));
        batch.remove(Number(removeId));
        if (!batch.size) { clearAll(); return; }
        renderBatchStrip();
        renderMetadataNotice();
        renderPreview();
        return;
    }
    const button = event.target?.closest?.('.batch-item');
    if (!button) return;
    batch.select(Number(button.dataset.id));
    renderBatchStrip();
    renderMetadataNotice();
    resetSizeInputs();
    renderPreview();
    scheduleEstimate();
});

for (const [key, slider, display, unit] of ADJUST_CONTROLS) {
    slider.addEventListener('input', () => {
        state.adjust[key] = Number(slider.value);
        display.textContent = `${slider.value}${unit}`;
        history.replace(state);
        renderPreviewSoon();
        scheduleEstimate();
    });
    // One undo step per gesture, not per pixel of slider travel.
    slider.addEventListener('change', () => history.push(state));
}

ui.straightenSlider.addEventListener('input', () => {
    state.straighten = Number(ui.straightenSlider.value);
    ui.straightenValue.textContent = `${ui.straightenSlider.value}°`;
    history.replace(state);
    renderPreviewSoon();
});
ui.straightenSlider.addEventListener('change', () => { history.push(state); scheduleEstimate(); });
ui.autoCropStraighten.addEventListener('change', () => {
    commit((next) => { next.autoCropStraighten = ui.autoCropStraighten.checked; });
});

ui.resetAdjustBtn.addEventListener('click', () => {
    commit((next) => {
        next.adjust = { ...createState().adjust };
        next.straighten = 0;
    });
    syncAdjustmentInputs();
});

ui.cropBtn.addEventListener('click', () => (cropping ? cancelCrop() : enterCropMode()));
ui.cancelCropBtn.addEventListener('click', cancelCrop);
ui.applyCropBtn.addEventListener('click', () => {
    // Compose with any existing crop rather than replacing it, so two
    // successive crops behave the way the preview implied.
    commit((next) => {
        next.crop = {
            x: state.crop.x + cropRect.x * state.crop.w,
            y: state.crop.y + cropRect.y * state.crop.h,
            w: state.crop.w * cropRect.w,
            h: state.crop.h * cropRect.h,
        };
        next.resize = null;
    });
    cancelCrop();
    resetSizeInputs();
});

ui.cropAspect.addEventListener('change', () => {
    ui.cropCustomRatio.hidden = ui.cropAspect.value !== 'custom';
    const { width, height } = croppableSize();
    cropRect = centredRect(currentRatio(), width, height, Math.max(cropRect.w, cropRect.h));
    positionCropOverlay();
    syncCropInputs();
});
for (const input of [ui.cropRatioW, ui.cropRatioH]) {
    input.addEventListener('input', () => {
        if (ui.cropAspect.value !== 'custom') return;
        const { width, height } = croppableSize();
        cropRect = centredRect(currentRatio(), width, height, Math.max(cropRect.w, cropRect.h));
        positionCropOverlay();
        syncCropInputs();
    });
}
for (const input of [ui.cropX, ui.cropY, ui.cropW, ui.cropH]) {
    input.addEventListener('change', applyCropFromInputs);
}

ui.cropOverlay.addEventListener('mousedown', onCropPointerDown);
ui.cropOverlay.addEventListener('touchstart', onCropPointerDown, { passive: false });
window.addEventListener('mousemove', onCropPointerMove);
window.addEventListener('touchmove', onCropPointerMove, { passive: false });
window.addEventListener('mouseup', onCropPointerUp);
window.addEventListener('touchend', onCropPointerUp);

ui.rotateLeftBtn.addEventListener('click', () => commit((next) => {
    next.rotate = normaliseRotation(next.rotate - 90);
    next.resize = null;
}));
ui.rotateRightBtn.addEventListener('click', () => commit((next) => {
    next.rotate = normaliseRotation(next.rotate + 90);
    next.resize = null;
}));
ui.flipHBtn.addEventListener('click', () => commit((next) => { next.flipH = !next.flipH; }));
ui.flipVBtn.addEventListener('click', () => commit((next) => { next.flipV = !next.flipV; }));

ui.undoBtn.addEventListener('click', () => {
    const previous = history.undo();
    if (!previous) return;
    state = previous;
    syncAdjustmentInputs();
    resetSizeInputs();
    updateUndoButton();
    renderPreview();
    scheduleEstimate();
});

ui.resetBtn.addEventListener('click', () => {
    commit((next) => Object.assign(next, createState()));
    syncAdjustmentInputs();
    resetSizeInputs();
    cancelCrop();
});

ui.resizeUnit.addEventListener('change', () => { updateResizeUnitLabels(); resetSizeInputs(); });
ui.resizeWidth.addEventListener('input', () => { lastResizeEdited = 'width'; syncLockedDimension('width'); });
ui.resizeHeight.addEventListener('input', () => { lastResizeEdited = 'height'; syncLockedDimension('height'); });
ui.applyResizeBtn.addEventListener('click', applyResize);
ui.resizeMode.addEventListener('change', () => {
    if (state.resize) commit((next) => { next.resize = { ...next.resize, mode: ui.resizeMode.value }; });
});
ui.resetSizeBtn.addEventListener('click', () => {
    commit((next) => { next.resize = null; });
    resetSizeInputs();
});

ui.aspectLockBtn.addEventListener('click', () => {
    aspectLocked = !aspectLocked;
    ui.aspectLockBtn.classList.toggle('active', aspectLocked);
    ui.aspectLockBtn.setAttribute('aria-pressed', String(aspectLocked));
    ui.aspectLockBtn.title = aspectLocked ? 'Aspect ratio locked' : 'Aspect ratio unlocked';
});

for (const button of document.querySelectorAll('.preset-btn')) {
    button.addEventListener('click', () => {
        const item = currentItem();
        if (!item) return;
        const base = outputSize(item.width, item.height, { ...state, resize: null });

        if (button.dataset.percent) {
            ui.resizeUnit.value = 'percent';
            updateResizeUnitLabels();
            ui.resizeWidth.value = button.dataset.percent;
        } else {
            ui.resizeUnit.value = 'px';
            updateResizeUnitLabels();
            ui.resizeWidth.value = button.dataset.w;
            ui.resizeHeight.value = button.dataset.h;
        }
        // Presets used only to fill the fields, leaving the user to press
        // Resize as well. Undo covers the mistake if this was not wanted.
        applyResize();
        void base;
    });
}

ui.outputFormat.addEventListener('change', () => { updateExportUI(); scheduleEstimate(); });
ui.qualitySlider.addEventListener('input', () => { syncPresetFromSlider(); scheduleEstimate(); });
ui.compressionSelect.addEventListener('change', () => { syncSliderFromPreset(); scheduleEstimate(); });
ui.targetSizeInput.addEventListener('input', scheduleEstimate);
ui.targetSizeUnit.addEventListener('change', scheduleEstimate);
ui.matteColor.addEventListener('input', () => { renderPreviewSoon(); scheduleEstimate(); });

ui.exportBtn.addEventListener('click', exportAll);
ui.cancelExportBtn.addEventListener('click', () => { exportAborted = true; });
ui.downloadZipBtn.addEventListener('click', downloadAll);

window.addEventListener('resize', debounce(() => { if (batch.size) renderPreview(); }, 150));

// AVIF encoding is not universal; offering it where it silently falls back to
// PNG would produce a .avif file containing a PNG.
if (!canEncode('image/avif')) ui.avifOption.remove();

updateExportUI();
updateResizeUnitLabels();
syncAdjustmentInputs();
syncPresetFromSlider();
updateUndoButton();

// Keep the preset dropdown honest about the initial slider value.
if (COMPRESSION_PRESETS[ui.compressionSelect.value] === undefined) syncPresetFromSlider();
