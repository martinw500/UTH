/**
 * QR generator page wiring.
 *
 * tests/qr.test.js covers the encoding. This covers the thing unit tests cannot:
 * that every id the script looks up actually exists in the shipped HTML. A typo
 * there makes byId return null and the page dies on the first property access,
 * with the markup and the script each looking fine in isolation.
 *
 * jsdom has no 2D canvas context, so one is stubbed. Only the calls the renderer
 * makes are implemented.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'qr-generator', 'index.html'), 'utf-8');

function stubCanvas() {
    const calls = { fillRect: [], fillStyleSet: [] };
    const ctx = {
        set fillStyle(value) { calls.fillStyleSet.push(value); },
        get fillStyle() { return calls.fillStyleSet[calls.fillStyleSet.length - 1]; },
        fillRect: (...args) => calls.fillRect.push(args),
    };
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
    HTMLCanvasElement.prototype.toBlob = jest.fn(cb => cb(new Blob(['png'], { type: 'image/png' })));
    return calls;
}

describe('QR generator page', () => {
    let calls;

    beforeAll(async () => {
        const body = HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        document.body.innerHTML = body ? body[1] : HTML;
        calls = stubCanvas();
        // Imported after the DOM exists: the module reads elements at load time,
        // exactly as a browser does with a deferred module script.
        await import('../qr-generator/js/qr-generator.js');
    });

    test('renders on load without any element lookup returning null', () => {
        // Reaching fillRect at all means every byId resolved and generateMatrix ran.
        expect(calls.fillRect.length).toBeGreaterThan(0);
    });

    test('sizes the canvas to the encoded symbol', () => {
        const canvas = document.getElementById('qrCanvas');
        expect(canvas.width).toBeGreaterThan(0);
        expect(canvas.width).toBe(canvas.height);
    });

    test('reports the character count and symbol version', () => {
        const text = document.getElementById('qrText').value;
        expect(document.getElementById('charCount').textContent)
            .toBe(`${text.length} characters`);
        expect(document.getElementById('qrVersion').textContent).toMatch(/^Version \d+ · \d+x\d+ modules$/);
    });

    test('export buttons are enabled once something is encoded', () => {
        expect(document.getElementById('downloadPngBtn').disabled).toBe(false);
        expect(document.getElementById('downloadSvgBtn').disabled).toBe(false);
        expect(document.getElementById('copySvgBtn').disabled).toBe(false);
    });

    test('the default foreground and background pass the contrast check', () => {
        const notice = document.getElementById('noticeHost');
        expect(notice.hidden).toBe(true);
    });

    // A light-on-dark QR is structurally valid and simply will not scan, which
    // is a baffling way to fail if nothing says so.
    test('warns when the foreground is lighter than the background', () => {
        const dark = document.getElementById('darkColor');
        const light = document.getElementById('lightColor');
        dark.value = '#ffffff';
        light.value = '#000000';
        dark.dispatchEvent(new Event('input'));

        const notice = document.getElementById('noticeHost');
        expect(notice.hidden).toBe(false);
        expect(notice.classList.contains('notice-error')).toBe(true);
        expect(notice.textContent).toMatch(/lighter than the background/);

        dark.value = '#000000';
        light.value = '#ffffff';
        dark.dispatchEvent(new Event('input'));
        expect(document.getElementById('noticeHost').hidden).toBe(true);
    });

    test('clearing the text disables the exports and clears the notice', () => {
        const input = document.getElementById('qrText');
        const previous = input.value;

        input.value = '';
        input.dispatchEvent(new Event('input'));
        // The input handler is debounced, so wait past the delay.
        return new Promise(resolve => setTimeout(() => {
            expect(document.getElementById('downloadPngBtn').disabled).toBe(true);
            expect(document.getElementById('charCount').textContent).toBe('0 characters');

            input.value = previous;
            input.dispatchEvent(new Event('input'));
            setTimeout(resolve, 200);
        }, 200));
    });
});
