/**
 * QR encoding.
 *
 * The matrix is pure data, so almost everything here runs in jsdom without a
 * canvas. That is the point of splitting generateMatrix out from the renderers:
 * the part that can be silently, invisibly wrong is the part under test.
 */

import {
    ECC_LEVELS,
    DEFAULT_BORDER,
    generateMatrix,
    moduleAt,
    countDark,
    matrixToSvg,
    renderToCanvas,
} from '../js/shared/qr.js';
import qrcode from '../js/vendor/qrcode-generator.js';

// The canonical 7x7 finder pattern, one of which sits in three of the corners.
const FINDER = [
    '1111111',
    '1000001',
    '1011101',
    '1011101',
    '1011101',
    '1000001',
    '1111111',
].map(row => row.split('').map(Number));

function regionMatches(matrix, originX, originY, pattern) {
    return pattern.every((row, dy) =>
        row.every((want, dx) => moduleAt(matrix, originX + dx, originY + dy) === want));
}

describe('generateMatrix', () => {
    test('encodes a short URL into a version 2 symbol', () => {
        const m = generateMatrix('https://example.com', { ecc: 'M' });
        expect(m.version).toBe(2);
        // 25 modules for version 2, plus a 4-module quiet zone on each side.
        expect(m.size).toBe(25 + DEFAULT_BORDER * 2);
        expect(m.modules).toHaveLength(m.size * m.size);
    });

    test('the size reported matches the modules actually allocated', () => {
        for (const ecc of ECC_LEVELS) {
            const m = generateMatrix('hello world', { ecc });
            expect(m.modules).toHaveLength(m.size * m.size);
            expect(m.ecc).toBe(ecc);
        }
    });

    // A border that is off by one, or applied to only one axis, still produces
    // something QR-shaped. Checking the rings are clear catches it.
    test('the quiet zone is entirely light on all four sides', () => {
        const m = generateMatrix('quiet zone check', { border: 4 });
        for (let ring = 0; ring < 4; ring += 1) {
            for (let i = 0; i < m.size; i += 1) {
                expect(moduleAt(m, i, ring)).toBe(0);              // top
                expect(moduleAt(m, i, m.size - 1 - ring)).toBe(0); // bottom
                expect(moduleAt(m, ring, i)).toBe(0);              // left
                expect(moduleAt(m, m.size - 1 - ring, i)).toBe(0); // right
            }
        }
    });

    test('border: 0 removes the quiet zone entirely', () => {
        const bordered = generateMatrix('same text', { border: 4 });
        const bare = generateMatrix('same text', { border: 0 });
        expect(bare.size).toBe(bordered.size - 8);
        // A finder pattern starts in the very first cell when there is no border.
        expect(moduleAt(bare, 0, 0)).toBe(1);
    });

    // Reading isDark(row, col) into index (x * size + y) transposes the symbol.
    // A transposed QR still looks like a QR to a human and does not scan, so
    // the asymmetric finder-pattern layout is what catches it: three corners
    // have one, the bottom-right does not.
    test('finder patterns sit in three corners and not the fourth', () => {
        const m = generateMatrix('orientation matters', { border: 4 });
        const far = m.size - 4 - 7;

        expect(regionMatches(m, 4, 4, FINDER)).toBe(true);     // top-left
        expect(regionMatches(m, far, 4, FINDER)).toBe(true);   // top-right
        expect(regionMatches(m, 4, far, FINDER)).toBe(true);   // bottom-left
        expect(regionMatches(m, far, far, FINDER)).toBe(false); // bottom-right
    });

    test('longer text needs a bigger symbol', () => {
        const short = generateMatrix('hi');
        const long = generateMatrix('hi'.repeat(200));
        expect(long.size).toBeGreaterThan(short.size);
        expect(long.version).toBeGreaterThan(short.version);
    });

    test('stronger error correction needs a bigger symbol for the same text', () => {
        const text = 'x'.repeat(120);
        expect(generateMatrix(text, { ecc: 'H' }).version)
            .toBeGreaterThan(generateMatrix(text, { ecc: 'L' }).version);
    });

    describe('rejects bad input rather than encoding nonsense', () => {
        test('empty text', () => {
            expect(() => generateMatrix('')).toThrow(/Nothing to encode/);
        });

        test('non-string text', () => {
            expect(() => generateMatrix(null)).toThrow(/Nothing to encode/);
        });

        test('unknown error-correction level', () => {
            expect(() => generateMatrix('hi', { ecc: 'Z' })).toThrow(/error-correction/);
        });

        test('negative border', () => {
            expect(() => generateMatrix('hi', { border: -1 })).toThrow(/non-negative/);
        });

        // Truncating to whatever fits would produce a scannable code carrying
        // the wrong data, which is worse than refusing.
        test('text beyond the capacity of version 40', () => {
            expect(() => generateMatrix('x'.repeat(8000))).toThrow(/too long/i);
        });
    });
});

describe('UTF-8 handling', () => {
    // The vendored library defaults to `charCodeAt(i) & 0xff`, so every
    // character above U+00FF is truncated to a single wrong byte and the QR
    // decodes to mojibake with no error. js/shared/qr.js installs the UTF-8
    // converter on import; this pins that it stayed installed.
    test('the UTF-8 byte converter is installed on the shared instance', () => {
        expect(qrcode.stringToBytes('☕')).toEqual([0xe2, 0x98, 0x95]);
        expect(qrcode.stringToBytes('é')).toEqual([0xc3, 0xa9]);
        expect(qrcode.stringToBytes('a')).toEqual([0x61]);
    });

    test('accented and non-Latin text encodes without throwing', () => {
        for (const text of ['café', '☕', 'naïve résumé', '日本語', '🎉']) {
            const m = generateMatrix(text);
            expect(m.size).toBeGreaterThan(0);
            expect(countDark(m)).toBeGreaterThan(0);
        }
    });

    test('a multi-byte character carries more payload than its ASCII lookalike', () => {
        // 'e' is one byte, 'é' is two, so at some length the accented string
        // needs a larger symbol. If Latin-1 truncation were in play they would
        // match, because both would encode as one byte per character.
        const ascii = generateMatrix('e'.repeat(150), { ecc: 'M' });
        const utf8 = generateMatrix('é'.repeat(150), { ecc: 'M' });
        expect(utf8.version).toBeGreaterThan(ascii.version);
    });
});

describe('matrixToSvg', () => {
    let matrix;
    let svg;

    beforeAll(() => {
        matrix = generateMatrix('https://example.com/svg', { ecc: 'M' });
        svg = matrixToSvg(matrix, { moduleSize: 8 });
    });

    test('is a well-formed svg element', () => {
        expect(svg.startsWith('<svg ')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    test('viewBox is in module units and width/height in pixels', () => {
        expect(svg).toContain(`viewBox="0 0 ${matrix.size} ${matrix.size}"`);
        expect(svg).toContain(`width="${matrix.size * 8}"`);
        expect(svg).toContain(`height="${matrix.size * 8}"`);
    });

    // Runs are collapsed into single rects, so the rect count is not the module
    // count -- but every dark module must still be covered exactly once.
    test('the drawn runs cover every dark module and no more', () => {
        const widths = Array.from(svg.matchAll(/<rect x="\d+" y="\d+" width="(\d+)" height="1"\/>/g))
            .reduce((sum, m) => sum + Number(m[1]), 0);
        expect(widths).toBe(countDark(matrix));
    });

    test('collapsing runs emits fewer rects than dark modules', () => {
        const rects = (svg.match(/<rect x=/g) || []).length;
        expect(rects).toBeLessThan(countDark(matrix));
    });

    test('carries no script content', () => {
        expect(svg).not.toContain('<script');
    });

    test('a title is included when given, and escaped', () => {
        const titled = matrixToSvg(matrix, { title: 'Tom & "Jerry" <b>' });
        expect(titled).toContain('<title>Tom &amp; &quot;Jerry&quot; &lt;b&gt;</title>');
    });

    test('no title element when none is given', () => {
        expect(svg).not.toContain('<title>');
    });

    test('colours are applied', () => {
        const coloured = matrixToSvg(matrix, { dark: '#123456', light: '#fedcba' });
        expect(coloured).toContain('fill="#123456"');
        expect(coloured).toContain('fill="#fedcba"');
    });
});

describe('renderToCanvas', () => {
    // jsdom has no 2D context unless the optional `canvas` package is installed.
    // The guard turns that into a clear message instead of a TypeError on null.
    test('reports a missing 2D context rather than throwing on null', () => {
        const canvas = document.createElement('canvas');
        const matrix = generateMatrix('canvas guard');
        expect(() => renderToCanvas(canvas, matrix)).toThrow(/2D canvas context/);
    });

    test('requires a canvas', () => {
        expect(() => renderToCanvas(null, generateMatrix('x'))).toThrow(/No canvas/);
    });

    describe('with a stubbed 2D context', () => {
        const MODULE = 4;
        let matrix;
        let canvas;
        let fills;

        beforeAll(() => {
            matrix = generateMatrix('https://example.com/canvas', { ecc: 'M' });
            fills = [];
            canvas = document.createElement('canvas');
            canvas.getContext = () => ({
                fillStyle: '',
                fillRect: (...args) => fills.push(args),
            });
            renderToCanvas(canvas, matrix, { moduleSize: MODULE });
        });

        test('sizes the canvas from the matrix and module size', () => {
            expect(canvas.width).toBe(matrix.size * MODULE);
            expect(canvas.height).toBe(matrix.size * MODULE);
        });

        // The run-length loop here is a second implementation of the one in
        // matrixToSvg. Checking the painted area against the module count keeps
        // the two from silently disagreeing.
        test('paints exactly the dark modules, over one background fill', () => {
            const [background, ...modules] = fills;
            expect(background).toEqual([0, 0, canvas.width, canvas.height]);

            const painted = modules.reduce((sum, [, , w, h]) => sum + (w * h), 0);
            expect(painted).toBe(countDark(matrix) * MODULE * MODULE);
        });

        test('every painted run lands on the module grid and inside the canvas', () => {
            fills.slice(1).forEach(([x, y, w, h]) => {
                expect(x % MODULE).toBe(0);
                expect(y % MODULE).toBe(0);
                expect(h).toBe(MODULE);
                expect(x + w).toBeLessThanOrEqual(canvas.width);
                expect(y + h).toBeLessThanOrEqual(canvas.height);
            });
        });
    });
});

describe('moduleAt', () => {
    test('reads outside the grid as light instead of undefined', () => {
        const m = generateMatrix('bounds');
        expect(moduleAt(m, -1, 0)).toBe(0);
        expect(moduleAt(m, 0, -1)).toBe(0);
        expect(moduleAt(m, m.size, 0)).toBe(0);
        expect(moduleAt(m, 0, m.size)).toBe(0);
    });
});
