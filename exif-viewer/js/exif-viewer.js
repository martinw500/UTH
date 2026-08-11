// ============================================
// EXIF Viewer & Remover
// ============================================
//
// Wiring only. Every byte-level decision lives in js/shared/exif.js, which is
// pure and unit-tested; this file reads a file, asks that module what is in it,
// and puts the answer on screen.

import { byId } from '../../js/shared/dom.js';
import { showError, showSuccess, clearNotice } from '../../js/shared/notify.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { formatBytes, stripExtension, getExtension } from '../../js/shared/format.js';
import {
    readMetadata,
    stripMetadata,
    presentTags,
    mapsUrl,
    SENSITIVE_TAGS,
} from '../../js/shared/exif.js';

const dropzone = byId('dropzone');
const fileInput = byId('fileInput');
const browseBtn = byId('browseBtn');
const results = byId('results');
const summary = byId('summary');
const tagTable = byId('tagTable');
const emptyNote = byId('emptyNote');
const gpsPanel = byId('gpsPanel');
const gpsValue = byId('gpsValue');
const gpsLink = byId('gpsLink');
const stripBtn = byId('stripBtn');
const clearBtn = byId('clearBtn');
const stripNote = byId('stripNote');
const errorMsg = byId('errorMsg');

const MAX_BYTES = 100 * 1024 * 1024;

let currentFile = null;
let currentBuffer = null;
let currentMeta = null;

function summaryCard(label, value, { alarming = false } = {}) {
    const card = document.createElement('div');
    card.className = alarming ? 'exif-card exif-card-alarm' : 'exif-card';

    const heading = document.createElement('div');
    heading.className = 'exif-card-label';
    heading.textContent = label;

    const body = document.createElement('div');
    body.className = 'exif-card-value';
    body.textContent = value;

    card.append(heading, body);
    return card;
}

function renderSummary(file, meta, tags) {
    summary.textContent = '';

    const sensitive = Object.keys(tags).filter(key => SENSITIVE_TAGS.has(key));
    const hasGps = Boolean(meta.gps);

    // Lead with the verdict. Someone opening this tool wants to know whether
    // they have a problem, not to read a table and work it out themselves.
    const verdict = hasGps
        ? 'Yes — including where it was taken'
        : (sensitive.length || Object.keys(tags).length)
            ? 'Yes'
            : 'Nothing found';

    summary.append(
        summaryCard('Is it leaking anything?', verdict, { alarming: hasGps || sensitive.length > 0 }),
        summaryCard('File', `${meta.format} · ${formatBytes(file.size)}`),
        summaryCard('Metadata blocks', String(meta.found.length)),
    );
}

function renderTags(tags) {
    tagTable.textContent = '';
    const entries = Object.entries(tags);

    emptyNote.hidden = entries.length > 0;
    if (!entries.length) return;

    // Sensitive rows first: the serial number that identifies your camera
    // across every photo you have ever posted is more interesting than the
    // metering mode, and burying it in alphabetical order hides it.
    entries.sort(([a], [b]) => {
        const weight = (key) => (SENSITIVE_TAGS.has(key) ? 0 : 1);
        return weight(a) - weight(b) || a.localeCompare(b);
    });

    for (const [key, value] of entries) {
        const row = document.createElement('tr');
        if (SENSITIVE_TAGS.has(key)) row.className = 'exif-row-sensitive';

        const nameCell = document.createElement('th');
        nameCell.scope = 'row';
        nameCell.textContent = key;

        const valueCell = document.createElement('td');
        // textContent: these strings come from a file someone else made.
        valueCell.textContent = value;

        row.append(nameCell, valueCell);
        tagTable.appendChild(row);
    }
}

function renderGps(gps) {
    if (!gps) {
        gpsPanel.hidden = true;
        return;
    }
    const parts = [`${gps.latitude}, ${gps.longitude}`];
    if (typeof gps.altitude === 'number') parts.push(`${gps.altitude} m above sea level`);
    gpsValue.textContent = parts.join(' · ');
    gpsLink.href = mapsUrl(gps);
    gpsPanel.hidden = false;
}

async function loadFile(file) {
    clearNotice(errorMsg);

    let buffer;
    try {
        buffer = await file.arrayBuffer();
    } catch {
        showError(errorMsg, 'That file could not be read.');
        return;
    }

    const meta = readMetadata(buffer);
    if (!meta) {
        showError(errorMsg, 'That does not look like a JPEG, PNG or WebP. Those are the '
            + 'three formats this tool can read and rewrite safely.');
        return;
    }

    currentFile = file;
    currentBuffer = buffer;
    currentMeta = meta;

    const tags = presentTags(meta.tags);
    renderSummary(file, meta, tags);
    renderTags(tags);
    renderGps(meta.gps);

    const blockList = meta.found.length
        ? meta.found.map(f => f.kind).join(', ')
        : 'nothing';
    stripNote.textContent = `Removes: ${blockList}. The picture itself is copied across `
        + 'untouched — it is not re-compressed, so the clean copy looks exactly like the '
        + 'original rather than slightly worse.';

    stripBtn.disabled = meta.found.length === 0;
    results.classList.add('active');
    dropzone.style.display = 'none';
}

function reset() {
    currentFile = null;
    currentBuffer = null;
    currentMeta = null;
    results.classList.remove('active');
    dropzone.style.display = '';
    fileInput.value = '';
    clearNotice(errorMsg);
}

function download() {
    if (!currentBuffer || !currentFile) return;

    const stripped = stripMetadata(currentBuffer);
    if (!stripped) {
        showError(errorMsg, 'Could not rewrite this file. Its structure is not one this '
            + 'tool recognises.');
        return;
    }

    const ext = getExtension(currentFile.name) || 'jpg';
    const name = `${stripExtension(currentFile.name)}-clean.${ext}`;
    const blob = new Blob([stripped.bytes], { type: currentFile.type || 'application/octet-stream' });
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

    showSuccess(errorMsg, `Saved ${name} — ${formatBytes(stripped.removed)} of metadata removed.`);
}

createDropzone({
    dropzone,
    fileInput,
    browseBtn,
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: MAX_BYTES,
    paste: true,
    onFiles: (files) => loadFile(files[0]),
    onReject: ({ message }) => showError(errorMsg, message),
});

stripBtn.addEventListener('click', download);
clearBtn.addEventListener('click', reset);
