// Converter hub page controller.
//
// Knows nothing about how any format is produced. It detects the kind of file
// dropped, asks the registry what that can become, renders the options the
// registry declares, and hands the job to whichever engine the registry names.
// Adding a format should never require an edit here.

import { requireIds, setBusy } from '../../js/shared/dom.js';
import { formatBytes } from '../../js/shared/format.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { showError, showSuccess, clearNotice, announce } from '../../js/shared/notify.js';
import { createUrlPool } from '../../js/shared/objecturl.js';
import { buildZip } from '../../js/shared/zip.js';
import {
    detectKind,
    targetsFor,
    findTarget,
    defaultTarget,
    describeKind,
} from '../../js/shared/convert-registry.js';
import { getEngine } from './engine-loader.js';
import { renderOptions } from './ui.js';

// Media is the constraint: ffmpeg.wasm's heap is fixed, and a large input plus
// a queue exhausts the tab with an error nobody can act on.
const MAX_FILES = 30;
const MAX_BYTES = 250 * 1024 * 1024;

const ui = requireIds(
    'dropzone', 'fileInput', 'browseBtn', 'notice',
    'workspace', 'queueSummary', 'fileList', 'clearBtn', 'addMoreBtn',
    'targetGroup', 'targetFormat', 'optionsPanel',
    'convertBtn', 'cancelBtn', 'progress', 'progressBar', 'progressText',
    'results', 'resultsInfo', 'outputList', 'downloadAllBtn',
);

const urls = createUrlPool();
let queue = [];
let nextId = 1;
let readOptions = () => ({});
let controller = null;

// ============================================
// Queue
// ============================================

/**
 * The kind the queue is converting.
 *
 * Mixed kinds have no single sensible target list, so the first file wins and
 * the rest are reported rather than silently dropped.
 */
function queueKind() {
    return queue[0]?.kind ?? 'unknown';
}

function addFiles(files) {
    clearNotice(ui.notice);
    const incoming = Array.from(files).map((file) => ({
        id: nextId++, file, name: file.name, size: file.size, kind: detectKind(file),
        status: 'pending', result: null, error: null,
    }));

    const usable = incoming.filter((item) => item.kind !== 'unknown');
    const unknown = incoming.length - usable.length;

    const kind = queue.length ? queueKind() : usable[0]?.kind;
    const matching = usable.filter((item) => item.kind === kind);
    const mismatched = usable.length - matching.length;

    queue = [...queue, ...matching].slice(0, MAX_FILES);

    if (!queue.length) {
        showError(ui.notice, 'Those files are not images, video or audio.');
        return;
    }
    if (unknown || mismatched) {
        showError(ui.notice, [
            unknown ? `${unknown} file${unknown === 1 ? '' : 's'} of an unrecognised type` : null,
            mismatched ? `${mismatched} file${mismatched === 1 ? '' : 's'} of a different kind — `
                + `this batch is converting ${describeKind(kind, 2).replace(/^\d+ /, '')}` : null,
        ].filter(Boolean).join('; ') + ' were skipped.');
    }

    populateTargets();
    renderQueue();
    showWorkspace(true);
}

function removeItem(id) {
    urls.revoke(id);
    queue = queue.filter((item) => item.id !== id);
    if (!queue.length) { clearAll(); return; }
    renderQueue();
}

function clearAll() {
    urls.revokeAll();
    queue = [];
    clearNotice(ui.notice);
    ui.outputList.replaceChildren();
    ui.results.hidden = true;
    showWorkspace(false);
}

function showWorkspace(visible) {
    ui.workspace.hidden = !visible;
    ui.dropzone.hidden = visible;
}

function renderQueue() {
    const kind = queueKind();
    ui.queueSummary.textContent = `${describeKind(kind, queue.length)} ready to convert`;

    ui.fileList.replaceChildren(...queue.map((item) => {
        const row = document.createElement('div');
        row.className = 'file-item';

        const info = document.createElement('div');
        info.className = 'file-item-info';
        const name = document.createElement('span');
        name.className = 'file-item-name';
        name.textContent = item.name;
        const size = document.createElement('span');
        size.className = 'file-item-size';
        size.textContent = formatBytes(item.size);
        info.append(name, size);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'file-item-remove';
        remove.setAttribute('aria-label', `Remove ${item.name}`);
        remove.textContent = '×';
        remove.addEventListener('click', () => removeItem(item.id));

        row.append(info, remove);
        return row;
    }));
}

// ============================================
// Targets and options
// ============================================

function populateTargets() {
    const kind = queueKind();
    const targets = targetsFor(kind);
    const previous = ui.targetFormat.value;

    ui.targetFormat.replaceChildren(...targets.map((target) => {
        const option = document.createElement('option');
        option.value = target.id;
        option.textContent = target.label;
        return option;
    }));

    ui.targetFormat.value = targets.some((t) => t.id === previous)
        ? previous
        : defaultTarget(kind) ?? targets[0]?.id ?? '';

    ui.targetGroup.hidden = targets.length === 0;
    refreshOptions();
}

function refreshOptions() {
    // Carry current values across a format change, so switching MP4 -> WebM
    // does not silently reset the resolution you just picked.
    const previous = readOptions();
    readOptions = renderOptions(ui.optionsPanel, ui.targetFormat.value, previous);
}

// ============================================
// Converting
// ============================================

async function convertAll() {
    const target = findTarget(ui.targetFormat.value);
    if (!target || !queue.length) return;

    clearNotice(ui.notice);
    urls.revokeAll();
    ui.outputList.replaceChildren();
    ui.results.hidden = true;

    controller = new AbortController();
    setBusy(ui.convertBtn, true, 'Converting…');
    ui.cancelBtn.hidden = false;
    ui.progress.hidden = false;

    const options = readOptions();
    const { convert } = await getEngine(target.engine);

    let done = 0;
    try {
        // Serial, always. ffmpeg.wasm has one fixed heap, and even for images
        // encoding a queue in parallel will exhaust the tab.
        for (const item of queue) {
            if (controller.signal.aborted) break;

            ui.progressText.textContent = `${item.name} — starting…`;
            try {
                const result = await convert(item.file, {
                    target,
                    options,
                    signal: controller.signal,
                    onProgress: ({ ratio, note }) => {
                        const base = done / queue.length;
                        const span = 1 / queue.length;
                        const overall = base + span * (Number.isFinite(ratio) ? ratio : 0.5);
                        ui.progressBar.style.width = `${Math.round(overall * 100)}%`;
                        ui.progressText.textContent = `${item.name}${note ? ` — ${note}` : ''}`;
                    },
                });
                item.result = result;
                item.status = 'done';
            } catch (error) {
                if (error?.name === 'AbortError') break;
                item.status = 'error';
                item.error = error?.message || 'Conversion failed.';
            }
            done += 1;
            ui.progressBar.style.width = `${Math.round((done / queue.length) * 100)}%`;
        }

        showResults();
    } finally {
        setBusy(ui.convertBtn, false);
        ui.cancelBtn.hidden = true;
        ui.progress.hidden = true;
        ui.progressBar.style.width = '0%';
        ui.progressText.textContent = '';
        controller = null;
    }
}

function showResults() {
    const succeeded = queue.filter((item) => item.status === 'done' && item.result);
    const failed = queue.filter((item) => item.status === 'error');

    if (!succeeded.length) {
        showError(ui.notice, failed[0]?.error ?? 'Nothing was converted.');
        return;
    }

    ui.results.hidden = false;
    ui.downloadAllBtn.hidden = succeeded.length < 2;
    ui.resultsInfo.textContent = failed.length
        ? `${succeeded.length} converted, ${failed.length} failed`
        : `${succeeded.length} file${succeeded.length === 1 ? '' : 's'} converted`;

    ui.outputList.replaceChildren(
        ...succeeded.map(renderResultRow),
        ...failed.map(renderFailureRow),
    );

    if (failed.length) {
        showError(ui.notice, `${failed[0].name}: ${failed[0].error}`);
    } else {
        showSuccess(ui.notice, 'Done. Your files never left this device.');
    }
    announce(`${succeeded.length} file${succeeded.length === 1 ? '' : 's'} converted`);
}

function renderResultRow(item) {
    const url = urls.set(item.id, item.result.blob);
    const row = document.createElement('div');
    row.className = 'output-item';

    const info = document.createElement('div');
    info.className = 'output-item-info';
    const name = document.createElement('div');
    name.className = 'output-item-name';
    name.textContent = item.result.filename;
    const meta = document.createElement('div');
    meta.className = 'output-item-meta';
    const ratio = item.size > 0 ? Math.round((1 - item.result.blob.size / item.size) * 100) : 0;
    meta.textContent = `${formatBytes(item.result.blob.size)}`
        + (ratio > 0 ? ` · ${ratio}% smaller` : ratio < 0 ? ` · ${-ratio}% larger` : '');
    info.append(name, meta);

    const link = document.createElement('a');
    link.className = 'btn btn-primary btn-sm';
    link.href = url;
    link.download = item.result.filename;
    link.textContent = 'Download';

    row.append(info, link);
    return row;
}

function renderFailureRow(item) {
    const row = document.createElement('div');
    row.className = 'output-item output-error';
    const info = document.createElement('div');
    info.className = 'output-item-info';
    const name = document.createElement('div');
    name.className = 'output-item-name';
    name.textContent = item.name;
    const meta = document.createElement('div');
    meta.className = 'output-item-meta';
    meta.textContent = item.error;
    info.append(name, meta);
    row.append(info);
    return row;
}

/**
 * Download every result as one zip.
 *
 * A zip rather than N downloads: browsers throttle rapid successive downloads
 * and Chrome blocks them outright after a handful, so a large batch silently
 * arrived incomplete.
 */
async function downloadAll() {
    const done = queue.filter((item) => item.status === 'done' && item.result);
    if (!done.length) return;

    setBusy(ui.downloadAllBtn, true, 'Zipping…');
    try {
        const zip = await buildZip(done.map((item) => ({
            name: item.result.filename,
            data: item.result.blob,
        })));
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zip);
        link.download = 'converted.zip';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 0);
    } catch (error) {
        showError(ui.notice, error?.message || 'Could not build the zip.');
    } finally {
        setBusy(ui.downloadAllBtn, false);
    }
}

// ============================================
// Wiring
// ============================================

createDropzone({
    dropzone: ui.dropzone,
    fileInput: ui.fileInput,
    browseBtn: ui.browseBtn,
    accept: ['image/*', 'video/*', 'audio/*', '.mkv', '.avi', '.mov', '.flac', '.opus', '.m4a'],
    multiple: true,
    maxFiles: MAX_FILES,
    maxBytes: MAX_BYTES,
    paste: true,
    onFiles: addFiles,
    // One call per rejected file, not an array of them.
    onReject: (rejection) => showError(ui.notice, rejection.message),
});

ui.addMoreBtn.addEventListener('click', () => ui.fileInput.click());
ui.clearBtn.addEventListener('click', clearAll);
ui.targetFormat.addEventListener('change', refreshOptions);
ui.convertBtn.addEventListener('click', convertAll);
ui.cancelBtn.addEventListener('click', () => controller?.abort());
ui.downloadAllBtn.addEventListener('click', downloadAll);

showWorkspace(false);
