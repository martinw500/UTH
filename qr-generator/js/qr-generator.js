// ====  QR Code Generator — encode text or a URL, save as PNG or SVG  ====
//
// The encoding lives in js/shared/qr.js; this file is only wiring.

import { byId, debounce } from '../../js/shared/dom.js';
import { showError, clearNotice, notify } from '../../js/shared/notify.js';
import { copyWithFeedback } from '../../js/shared/clipboard.js';
import { hexToRgb, contrastRatio } from '../../js/shared/color.js';
import {
    generateMatrix,
    matrixToSvg,
    renderToCanvas,
    matrixToPngBlob,
} from '../../js/shared/qr.js';

const qrText = byId('qrText');
const eccSelect = byId('eccSelect');
const sizeSelect = byId('sizeSelect');
const darkColor = byId('darkColor');
const lightColor = byId('lightColor');
const qrCanvas = byId('qrCanvas');
const charCount = byId('charCount');
const qrVersion = byId('qrVersion');
const noticeHost = byId('noticeHost');
const downloadPngBtn = byId('downloadPngBtn');
const downloadSvgBtn = byId('downloadSvgBtn');
const copySvgBtn = byId('copySvgBtn');

// Last successful render, so the download buttons never re-encode and can never
// disagree with what is on screen.
let current = null;

/** Module size that lands closest to the requested image size without exceeding it. */
function moduleSizeFor(matrixSize, targetPixels) {
    return Math.max(1, Math.floor(targetPixels / matrixSize));
}

function setExportsEnabled(enabled) {
    for (const btn of [downloadPngBtn, downloadSvgBtn, copySvgBtn]) btn.disabled = !enabled;
}

function render() {
    const text = qrText.value;
    charCount.textContent = `${text.length} character${text.length === 1 ? '' : 's'}`;

    if (text === '') {
        current = null;
        qrVersion.textContent = '';
        setExportsEnabled(false);
        clearNotice(noticeHost);
        qrCanvas.width = 0;
        qrCanvas.height = 0;
        return;
    }

    let matrix;
    try {
        matrix = generateMatrix(text, { ecc: eccSelect.value });
    } catch (err) {
        current = null;
        qrVersion.textContent = '';
        setExportsEnabled(false);
        showError(noticeHost, err.message);
        return;
    }

    const dark = darkColor.value;
    const light = lightColor.value;
    const moduleSize = moduleSizeFor(matrix.size, Number(sizeSelect.value));

    try {
        renderToCanvas(qrCanvas, matrix, { moduleSize, dark, light });
    } catch (err) {
        current = null;
        setExportsEnabled(false);
        showError(noticeHost, err.message);
        return;
    }

    current = { matrix, moduleSize, dark, light };
    qrVersion.textContent = `Version ${matrix.version} · ${matrix.size}x${matrix.size} modules`;
    setExportsEnabled(true);
    warnAboutContrast(dark, light);
}

/**
 * Scanners look for a dark symbol on a light background. Inverted or low-contrast
 * codes are structurally valid and simply do not scan, which is a confusing way
 * to fail, so say so up front.
 */
function warnAboutContrast(dark, light) {
    const darkRgb = hexToRgb(dark);
    const lightRgb = hexToRgb(light);
    if (!darkRgb || !lightRgb) return clearNotice(noticeHost);

    const ratio = contrastRatio(darkRgb, lightRgb);
    const darkLuminance = 0.2126 * darkRgb.r + 0.7152 * darkRgb.g + 0.0722 * darkRgb.b;
    const lightLuminance = 0.2126 * lightRgb.r + 0.7152 * lightRgb.g + 0.0722 * lightRgb.b;

    if (darkLuminance > lightLuminance) {
        notify(noticeHost, 'The foreground is lighter than the background. Most scanners '
            + 'expect a dark code on a light background and will not read this.',
        { level: 'error' });
    } else if (ratio < 4) {
        notify(noticeHost, `Contrast is low (${ratio}:1). This may not scan reliably — `
            + 'aim for a dark foreground on a light background.', { level: 'error' });
    } else {
        clearNotice(noticeHost);
    }
}

function filenameStem() {
    const text = qrText.value.trim();
    const slug = text
        .replace(/^https?:\/\//, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .toLowerCase();
    return slug ? `qr-${slug}` : 'qr-code';
}

function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

function currentSvg() {
    return matrixToSvg(current.matrix, {
        moduleSize: current.moduleSize,
        dark: current.dark,
        light: current.light,
    });
}

downloadPngBtn.addEventListener('click', async () => {
    if (!current) return;
    try {
        const blob = await matrixToPngBlob(current.matrix, {
            moduleSize: current.moduleSize,
            dark: current.dark,
            light: current.light,
        });
        saveBlob(blob, `${filenameStem()}.png`);
    } catch (err) {
        showError(noticeHost, `Could not create the PNG: ${err.message}`);
    }
});

downloadSvgBtn.addEventListener('click', () => {
    if (!current) return;
    saveBlob(new Blob([currentSvg()], { type: 'image/svg+xml' }), `${filenameStem()}.svg`);
});

copySvgBtn.addEventListener('click', () => {
    if (!current) return;
    copyWithFeedback(copySvgBtn, currentSvg());
});

// Typing re-encodes on every keystroke; debounce so a long URL is not encoded
// dozens of times on the way in.
qrText.addEventListener('input', debounce(render, 150));
for (const control of [eccSelect, sizeSelect, darkColor, lightColor]) {
    control.addEventListener('input', render);
}

render();
