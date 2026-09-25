// ============================================
// Color Converter — HEX ↔ RGB ↔ HSL
// ============================================
//
// All the maths is js/shared/color.js. This page used to carry its own copies
// inside an IIFE while the tests exercised the shared module, so a bug in what
// actually shipped could never turn a test red.

import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, clampChannel } from '../../js/shared/color.js';
import { copyWithFeedback } from '../../js/shared/clipboard.js';

// DOM elements
const colorPicker = document.getElementById('colorPicker');
const colorSwatch = document.getElementById('colorSwatch');
const hexInput = document.getElementById('hexInput');
const rInput = document.getElementById('rInput');
const gInput = document.getElementById('gInput');
const bInput = document.getElementById('bInput');
const hInput = document.getElementById('hInput');
const sInput = document.getElementById('sInput');
const lInput = document.getElementById('lInput');
const rgbText = document.getElementById('rgbText');
const hslText = document.getElementById('hslText');
const cssOutput = document.getElementById('cssOutput');
const colorHistory = document.getElementById('colorHistory');
const clearHistory = document.getElementById('clearHistory');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

let history = [];
try {
    history = JSON.parse(localStorage.getItem('colorHistory') || '[]');
    // Sanitize: only keep valid hex colors
    history = history.filter(c => typeof c === 'string' && HEX_RE.test(c));
} catch (_) { /* localStorage unavailable */ }
let debounceTimer = null;

/** The fields' integer values, or null while any of them is empty or not a number. */
function readFields(inputs) {
    const values = inputs.map((input) => Number.parseInt(input.value, 10));
    return values.some(Number.isNaN) ? null : values;
}

// --- Update UI ---
function updateFromHex(hex, source) {
    const rgb = hexToRgb(hex);
    if (!rgb) return;

    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const hexClean = rgbToHex(rgb.r, rgb.g, rgb.b);

    if (source !== 'picker') colorPicker.value = hexClean;
    if (source !== 'hex') hexInput.value = hexClean;
    if (source !== 'rgb') {
        rInput.value = rgb.r;
        gInput.value = rgb.g;
        bInput.value = rgb.b;
    }
    if (source !== 'hsl') {
        hInput.value = hsl.h;
        sInput.value = hsl.s;
        lInput.value = hsl.l;
    }

    updateTexts(hexClean, rgb, hsl);
    updateSwatch(hexClean);
    // The starting colour is not something the user picked; recording it put
    // it back at the top of the history on every visit.
    if (source !== 'init') addToHistory(hexClean);
}

function updateFromRgb(r, g, b, source) {
    r = clampChannel(r);
    g = clampChannel(g);
    b = clampChannel(b);

    const hex = rgbToHex(r, g, b);
    const hsl = rgbToHsl(r, g, b);

    if (source !== 'picker') colorPicker.value = hex;
    if (source !== 'hex') hexInput.value = hex;
    if (source !== 'hsl') {
        hInput.value = hsl.h;
        sInput.value = hsl.s;
        lInput.value = hsl.l;
    }

    updateTexts(hex, { r, g, b }, hsl);
    updateSwatch(hex);
    addToHistory(hex);
}

function updateFromHsl(h, s, l, source) {
    h = clampChannel(h, 0, 360);
    s = clampChannel(s, 0, 100);
    l = clampChannel(l, 0, 100);

    const rgb = hslToRgb(h, s, l);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

    if (source !== 'picker') colorPicker.value = hex;
    if (source !== 'hex') hexInput.value = hex;
    if (source !== 'rgb') {
        rInput.value = rgb.r;
        gInput.value = rgb.g;
        bInput.value = rgb.b;
    }

    updateTexts(hex, rgb, { h, s, l });
    updateSwatch(hex);
    addToHistory(hex);
}

function updateTexts(hex, rgb, hsl) {
    rgbText.textContent = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    hslText.textContent = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    cssOutput.textContent = `--color: ${hex};`;
}

function updateSwatch(hex) {
    colorSwatch.style.background = hex;
}

// --- Event listeners ---
colorPicker.addEventListener('input', () => {
    updateFromHex(colorPicker.value, 'picker');
});

hexInput.addEventListener('input', () => {
    let val = hexInput.value.trim();
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val)) {
        updateFromHex(val, 'hex');
    }
});

// Backspacing a field to empty used to parse as 0 and turn the colour black
// mid-edit. Nothing updates until every field holds a number again; leaving a
// field shows the clamped value, so "300" does not sit next to rgb(255, …).
function bindFields(inputs, update) {
    for (const input of inputs) {
        input.addEventListener('input', () => {
            const values = readFields(inputs);
            if (values) update(...values);
        });
        input.addEventListener('change', () => {
            const value = Number.parseInt(input.value, 10);
            if (!Number.isNaN(value)) {
                input.value = clampChannel(value, Number(input.min) || 0, Number(input.max) || 255);
            }
        });
    }
}
bindFields([rInput, gInput, bInput], (r, g, b) => updateFromRgb(r, g, b, 'rgb'));
bindFields([hInput, sInput, lInput], (h, s, l) => updateFromHsl(h, s, l, 'hsl'));

// --- Copy buttons ---
// copyWithFeedback falls back to execCommand: navigator.clipboard is undefined
// outside a secure context, and calling it threw before any .catch could run.
document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (target) copyWithFeedback(btn, target.value !== undefined ? target.value : target.textContent);
    });
});

// --- History ---
function addToHistory(hex) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        hex = hex.toLowerCase();
        if (!HEX_RE.test(hex)) return;
        history = history.filter(c => c !== hex);
        history.unshift(hex);
        if (history.length > 20) history = history.slice(0, 20);
        try { localStorage.setItem('colorHistory', JSON.stringify(history)); } catch (_) {}
        renderHistory();
    }, 300);
}

function renderHistory() {
    colorHistory.replaceChildren(...history.filter(c => HEX_RE.test(c)).map((c) => {
        const btn = document.createElement('button');
        btn.className = 'color-history-item';
        btn.style.background = c;
        btn.title = c;
        btn.dataset.color = c;
        btn.addEventListener('click', () => updateFromHex(c, 'history'));
        return btn;
    }));
}

clearHistory.addEventListener('click', () => {
    // A pending debounced add would otherwise bring the history straight back.
    clearTimeout(debounceTimer);
    history = [];
    try { localStorage.removeItem('colorHistory'); } catch (_) {}
    colorHistory.innerHTML = '';
});

// --- Init ---
updateFromHex('#6366f1', 'init');
renderHistory();

// ==============================================
// IMAGE EYEDROPPER / COLOR PICKER FROM IMAGE
// ==============================================
const eyedropperDropzone = document.getElementById('eyedropperDropzone');
const eyedropperBrowseBtn = document.getElementById('eyedropperBrowseBtn');
const eyedropperFileInput = document.getElementById('eyedropperFileInput');
const eyedropperCanvasArea = document.getElementById('eyedropperCanvasArea');
const eyedropperFilename = document.getElementById('eyedropperFilename');
const eyedropperRemoveBtn = document.getElementById('eyedropperRemoveBtn');
const eyedropperCanvasWrapper = document.getElementById('eyedropperCanvasWrapper');
const eyedropperCanvas = document.getElementById('eyedropperCanvas');
const eyedropperMagnifier = document.getElementById('eyedropperMagnifier');
const magnifierCanvas = document.getElementById('magnifierCanvas');
const magnifierColorLabel = document.getElementById('magnifierColorLabel');
const eyedropperHint = document.getElementById('eyedropperHint');

let eyedropperImage = null;
let eyedropperCtx = null;
let magnifierCtx = null;

if (eyedropperCanvas) {
    eyedropperCtx = eyedropperCanvas.getContext('2d', { willReadFrequently: true });
    magnifierCtx = magnifierCanvas.getContext('2d');
}

// --- Dropzone events ---
if (eyedropperBrowseBtn) {
    eyedropperBrowseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        eyedropperFileInput.click();
    });
}

if (eyedropperDropzone) {
    eyedropperDropzone.addEventListener('click', (e) => {
        if (e.target !== eyedropperBrowseBtn) eyedropperFileInput.click();
    });

    eyedropperDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        eyedropperDropzone.classList.add('dragover');
    });

    eyedropperDropzone.addEventListener('dragleave', () => {
        eyedropperDropzone.classList.remove('dragover');
    });

    eyedropperDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        eyedropperDropzone.classList.remove('dragover');
        const f = e.dataTransfer.files[0];
        // Accept by extension too: Windows reports HEIC and some others as ''.
        if (f && (f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i.test(f.name))) {
            loadEyedropperImage(f);
        }
    });
}

if (eyedropperFileInput) {
    eyedropperFileInput.addEventListener('change', () => {
        if (eyedropperFileInput.files[0]) {
            loadEyedropperImage(eyedropperFileInput.files[0]);
            eyedropperFileInput.value = '';
        }
    });
}

function loadEyedropperImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        eyedropperImage = img;

        // Set canvas to full resolution for accurate pixel reading
        eyedropperCanvas.width = img.naturalWidth;
        eyedropperCanvas.height = img.naturalHeight;
        eyedropperCtx.drawImage(img, 0, 0);

        // Show canvas area, hide dropzone
        eyedropperDropzone.style.display = 'none';
        eyedropperCanvasArea.style.display = '';
        eyedropperFilename.textContent = file.name;
        eyedropperHint.textContent = 'Click on the image to pick a color';
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        eyedropperHint.textContent = 'Could not load image. Try another file.';
    };
    img.src = url;
}

// Remove image
if (eyedropperRemoveBtn) {
    eyedropperRemoveBtn.addEventListener('click', () => {
        eyedropperImage = null;
        eyedropperCanvas.width = 0;
        eyedropperCanvas.height = 0;
        eyedropperCanvasArea.style.display = 'none';
        eyedropperDropzone.style.display = '';
        eyedropperMagnifier.style.display = 'none';
    });
}

// --- Get pixel color at coordinates ---
function getPixelColor(x, y) {
    if (!eyedropperCtx || x < 0 || y < 0 || x >= eyedropperCanvas.width || y >= eyedropperCanvas.height) {
        return null;
    }
    const pixel = eyedropperCtx.getImageData(x, y, 1, 1).data;
    return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] };
}

// --- Map mouse/touch to canvas coordinates ---
function getCanvasCoords(e) {
    const rect = eyedropperCanvas.getBoundingClientRect();
    const scaleX = eyedropperCanvas.width / rect.width;
    const scaleY = eyedropperCanvas.height / rect.height;

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    return {
        x: Math.floor((clientX - rect.left) * scaleX),
        y: Math.floor((clientY - rect.top) * scaleY),
        displayX: clientX - rect.left,
        displayY: clientY - rect.top,
        rectWidth: rect.width,
        rectHeight: rect.height
    };
}

// --- Draw magnifier ---
function drawMagnifier(canvasX, canvasY, displayX, displayY, rectWidth, rectHeight) {
    if (!magnifierCtx || !eyedropperCtx) return;

    const zoom = 8;
    const srcSize = Math.floor(magnifierCanvas.width / zoom);
    const halfSrc = Math.floor(srcSize / 2);

    // Clear magnifier
    magnifierCtx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);

    // Draw zoomed region
    const sx = canvasX - halfSrc;
    const sy = canvasY - halfSrc;
    magnifierCtx.imageSmoothingEnabled = false;
    magnifierCtx.drawImage(
        eyedropperCanvas,
        sx, sy, srcSize, srcSize,
        0, 0, magnifierCanvas.width, magnifierCanvas.height
    );

    // Position magnifier near the cursor but within bounds
    const magW = 110;
    const magH = 130;
    const wrapRect = eyedropperCanvasWrapper.getBoundingClientRect();
    let magX = displayX + 20;
    let magY = displayY - magH / 2;

    if (magX + magW > rectWidth) magX = displayX - magW - 20;
    if (magY < 0) magY = 0;
    if (magY + magH > rectHeight) magY = rectHeight - magH;

    eyedropperMagnifier.style.left = magX + 'px';
    eyedropperMagnifier.style.top = magY + 'px';
    eyedropperMagnifier.style.display = 'flex';

    // Update color label
    const color = getPixelColor(canvasX, canvasY);
    if (color) {
        const hex = rgbToHex(color.r, color.g, color.b);
        magnifierColorLabel.textContent = hex;
        magnifierColorLabel.style.background = hex;
        // Set text color for contrast
        const lum = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
        magnifierColorLabel.style.color = lum > 0.5 ? '#000' : '#fff';
    }
}

// --- Canvas mouse/touch events ---
if (eyedropperCanvasWrapper) {
    eyedropperCanvasWrapper.addEventListener('mousemove', (e) => {
        if (!eyedropperImage) return;
        const coords = getCanvasCoords(e);
        drawMagnifier(coords.x, coords.y, coords.displayX, coords.displayY, coords.rectWidth, coords.rectHeight);
    });

    eyedropperCanvasWrapper.addEventListener('mouseleave', () => {
        eyedropperMagnifier.style.display = 'none';
    });

    eyedropperCanvasWrapper.addEventListener('click', (e) => {
        if (!eyedropperImage) return;
        const coords = getCanvasCoords(e);
        const color = getPixelColor(coords.x, coords.y);
        if (color && color.a === 0) {
            // A transparent pixel has no colour; its RGB reads as black.
            eyedropperHint.textContent = 'That pixel is transparent. Pick somewhere with colour.';
        } else if (color) {
            const hex = rgbToHex(color.r, color.g, color.b);
            updateFromHex(hex, 'eyedropper');
            eyedropperHint.textContent = `Picked: ${hex} \u2014 rgb(${color.r}, ${color.g}, ${color.b})`;
            eyedropperHint.style.color = 'var(--primary)';
            setTimeout(() => {
                eyedropperHint.style.color = '';
            }, 2000);
        }
    });

    // Touch support
    eyedropperCanvasWrapper.addEventListener('touchmove', (e) => {
        if (!eyedropperImage) return;
        e.preventDefault();
        const coords = getCanvasCoords(e);
        drawMagnifier(coords.x, coords.y, coords.displayX, coords.displayY, coords.rectWidth, coords.rectHeight);
    }, { passive: false });

    eyedropperCanvasWrapper.addEventListener('touchend', (e) => {
        if (!eyedropperImage) return;
        // Pick the color at the last touch position
        const touch = e.changedTouches[0];
        const rect = eyedropperCanvas.getBoundingClientRect();
        const scaleX = eyedropperCanvas.width / rect.width;
        const scaleY = eyedropperCanvas.height / rect.height;
        const x = Math.floor((touch.clientX - rect.left) * scaleX);
        const y = Math.floor((touch.clientY - rect.top) * scaleY);
        const color = getPixelColor(x, y);
        if (color && color.a > 0) {
            const hex = rgbToHex(color.r, color.g, color.b);
            updateFromHex(hex, 'eyedropper');
            eyedropperHint.textContent = `Picked: ${hex} \u2014 rgb(${color.r}, ${color.g}, ${color.b})`;
        }
        eyedropperMagnifier.style.display = 'none';
    });
}
