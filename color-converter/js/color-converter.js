// ============================================
// Color Converter — HEX ↔ RGB ↔ HSL
// ============================================

(function () {
    'use strict';

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

    let history = [];
    try {
        history = JSON.parse(localStorage.getItem('colorHistory') || '[]');
        // Sanitize: only keep valid hex colors
        history = history.filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
    } catch (_) { /* localStorage unavailable */ }
    let debounceTimer = null;

    const HEX_RE = /^#[0-9a-fA-F]{6}$/;

    // --- Color math ---
    function hexToRgb(hex) {
        hex = hex.replace(/^#/, '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        if (hex.length !== 6) return null;
        const n = parseInt(hex, 16);
        if (isNaN(n)) return null;
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(c => {
            const h = Math.max(0, Math.min(255, Math.round(c))).toString(16);
            return h.length === 1 ? '0' + h : h;
        }).join('');
    }

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }

        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100)
        };
    }

    function hslToRgb(h, s, l) {
        h /= 360; s /= 100; l /= 100;

        if (s === 0) {
            const v = Math.round(l * 255);
            return { r: v, g: v, b: v };
        }

        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;

        return {
            r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
            g: Math.round(hue2rgb(p, q, h) * 255),
            b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
        };
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
        addToHistory(hexClean);
    }

    function updateFromRgb(r, g, b, source) {
        r = clamp(r, 0, 255);
        g = clamp(g, 0, 255);
        b = clamp(b, 0, 255);

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
        h = clamp(h, 0, 360);
        s = clamp(s, 0, 100);
        l = clamp(l, 0, 100);

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

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, Math.round(v) || 0));
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

    [rInput, gInput, bInput].forEach(input => {
        input.addEventListener('input', () => {
            updateFromRgb(
                parseInt(rInput.value) || 0,
                parseInt(gInput.value) || 0,
                parseInt(bInput.value) || 0,
                'rgb'
            );
        });
    });

    [hInput, sInput, lInput].forEach(input => {
        input.addEventListener('input', () => {
            updateFromHsl(
                parseInt(hInput.value) || 0,
                parseInt(sInput.value) || 0,
                parseInt(lInput.value) || 0,
                'hsl'
            );
        });
    });

    // --- Copy buttons ---
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const el = document.getElementById(targetId);
            if (!el) return;

            const text = el.value !== undefined ? el.value : el.textContent;
            navigator.clipboard.writeText(text).then(() => {
                const origHTML = btn.innerHTML;
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
                setTimeout(() => { btn.innerHTML = origHTML; }, 1500);
            }).catch(() => {
                // Clipboard API unavailable (HTTP or permission denied)
                const origHTML = btn.innerHTML;
                btn.innerHTML = 'Failed';
                setTimeout(() => { btn.innerHTML = origHTML; }, 1500);
            });
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
        colorHistory.innerHTML = history
            .filter(c => HEX_RE.test(c))
            .map(c =>
                `<button class="color-history-item" style="background: ${c};" title="${c}" data-color="${c}"></button>`
            ).join('');

        colorHistory.querySelectorAll('.color-history-item').forEach(btn => {
            btn.addEventListener('click', () => {
                updateFromHex(btn.dataset.color, 'history');
            });
        });
    }

    clearHistory.addEventListener('click', () => {
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
            if (f && f.type.startsWith('image/')) loadEyedropperImage(f);
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
            if (color) {
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
            if (color) {
                const hex = rgbToHex(color.r, color.g, color.b);
                updateFromHex(hex, 'eyedropper');
                eyedropperHint.textContent = `Picked: ${hex} \u2014 rgb(${color.r}, ${color.g}, ${color.b})`;
            }
            eyedropperMagnifier.style.display = 'none';
        });
    }

    console.log('Color Converter initialized');
})();
