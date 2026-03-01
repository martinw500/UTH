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

    console.log('Color Converter initialized');
})();
