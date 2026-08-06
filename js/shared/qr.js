// QR encoding, split so the interesting half is pure data.
//
// generateMatrix returns a plain grid of 1s and 0s with the quiet zone already
// baked in. Everything downstream (canvas, SVG) just draws that grid, so the
// renderers stay trivial and the encoding is testable in jsdom, which has no
// working canvas.

import qrcode from '../vendor/qrcode-generator.js';
import { stringToBytes } from '../vendor/qrcode-generator-utf8.js';
import { canvasToBlob } from './image.js';

// The vendored default truncates every character to one byte, so 'café' and
// anything non-Latin-1 encodes to mojibake with no error raised. See
// js/vendor/README.md. This override is load-bearing; tests/qr.test.js pins it.
qrcode.stringToBytes = stringToBytes;

export const ECC_LEVELS = ['L', 'M', 'Q', 'H'];

// Four light modules on every side. Below this, scanners struggle to find the
// symbol against surrounding content; it is the minimum the spec allows.
export const DEFAULT_BORDER = 4;

/**
 * Encode `text` into a square grid of modules.
 *
 * @returns {{size:number, version:number, ecc:string, border:number, modules:Uint8Array}}
 *   `modules` is row-major, `1` = dark, and `size` already includes the border.
 */
export function generateMatrix(text, { ecc = 'M', border = DEFAULT_BORDER } = {}) {
    if (typeof text !== 'string' || text === '') {
        throw new Error('Nothing to encode — enter some text or a URL.');
    }
    if (!ECC_LEVELS.includes(ecc)) {
        throw new Error(`Unknown error-correction level '${ecc}'. Use one of ${ECC_LEVELS.join(', ')}.`);
    }
    if (!Number.isInteger(border) || border < 0) {
        throw new Error('Border must be a non-negative whole number of modules.');
    }

    const qr = qrcode(0, ecc); // 0 = pick the smallest version that fits
    qr.addData(text);
    try {
        qr.make();
    } catch (err) {
        // Upstream throws a terse internal message here. Capacity is by far the
        // likeliest cause, and silently truncating would be worse than failing.
        throw new Error(
            `Text is too long to encode at error-correction level ${ecc}. `
            + 'Shorten it, or choose a lower level (L holds the most).',
            { cause: err },
        );
    }

    const count = qr.getModuleCount();
    const size = count + border * 2;
    const modules = new Uint8Array(size * size);

    for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
            // isDark takes (row, col); the output index is (y * size + x).
            // Swapping these transposes the symbol, which still looks like a
            // valid QR code but does not scan.
            if (qr.isDark(row, col)) {
                modules[(row + border) * size + (col + border)] = 1;
            }
        }
    }

    return { size, version: (count - 17) / 4, ecc, border, modules };
}

/** Read one module. Out-of-bounds reads are light, so callers need no guard. */
export function moduleAt(matrix, x, y) {
    const { size, modules } = matrix;
    if (x < 0 || y < 0 || x >= size || y >= size) return 0;
    return modules[y * size + x];
}

/** Total dark modules — handy for asserting a renderer drew all of them. */
export function countDark(matrix) {
    let total = 0;
    for (let i = 0; i < matrix.modules.length; i += 1) total += matrix.modules[i];
    return total;
}

/**
 * Render to an SVG string. Pure — no DOM, so it works anywhere.
 *
 * Horizontal runs collapse into one <rect>. One rect per module would emit
 * ~15,000 of them for a version-40 symbol, which is a slow, enormous file.
 */
export function matrixToSvg(matrix, {
    moduleSize = 8,
    dark = '#000000',
    light = '#ffffff',
    title,
} = {}) {
    const { size } = matrix;
    const pixels = size * moduleSize;
    const rects = [];

    for (let y = 0; y < size; y += 1) {
        let x = 0;
        while (x < size) {
            if (!moduleAt(matrix, x, y)) { x += 1; continue; }
            let run = 1;
            while (moduleAt(matrix, x + run, y)) run += 1;
            rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1"/>`);
            x += run;
        }
    }

    // viewBox is in module units so the geometry stays integral and the symbol
    // scales to any size without re-encoding; width/height carry the pixels.
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}"`,
        ` viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`,
        title ? `<title>${escapeXml(title)}</title>` : '',
        `<rect width="${size}" height="${size}" fill="${escapeXml(light)}"/>`,
        `<g fill="${escapeXml(dark)}">${rects.join('')}</g>`,
        '</svg>',
    ].join('');
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Draw onto a canvas, sizing it to fit. */
export function renderToCanvas(canvas, matrix, {
    moduleSize = 8,
    dark = '#000000',
    light = '#ffffff',
} = {}) {
    if (!canvas) throw new Error('No canvas supplied.');
    const ctx = canvas.getContext('2d');
    // jsdom returns null here unless the optional `canvas` package is
    // installed, and so do browsers that have run out of GPU contexts.
    if (!ctx) throw new Error('Could not get a 2D canvas context.');

    const { size } = matrix;
    canvas.width = size * moduleSize;
    canvas.height = size * moduleSize;

    ctx.fillStyle = light;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = dark;
    for (let y = 0; y < size; y += 1) {
        let x = 0;
        while (x < size) {
            if (!moduleAt(matrix, x, y)) { x += 1; continue; }
            let run = 1;
            while (moduleAt(matrix, x + run, y)) run += 1;
            ctx.fillRect(x * moduleSize, y * moduleSize, run * moduleSize, moduleSize);
            x += run;
        }
    }
    return canvas;
}

/** Render to a PNG blob via an offscreen canvas. */
export async function matrixToPngBlob(matrix, options = {}) {
    const canvas = document.createElement('canvas');
    renderToCanvas(canvas, matrix, options);
    return canvasToBlob(canvas, 'image/png');
}
