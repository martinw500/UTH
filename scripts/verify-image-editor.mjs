#!/usr/bin/env node
/**
 * Drive the image editor in a real browser and check the bytes it produces.
 *
 * Deliberately NOT part of `npm test`: it needs a browser and a running dev
 * server, and `npm test` gates the Vercel deploy.
 *
 * It exists because the interesting failures here are invisible to jsdom, which
 * has no canvas, no toBlob and no pixels:
 *   - a crop landing on different pixels than the overlay drew, because the
 *     rect was clamped in canvas pixels while drags were measured in CSS pixels;
 *   - a JPEG whose transparency composited to black instead of the matte;
 *   - a file saved as .webp that is really a PNG, because the browser silently
 *     substituted the format;
 *   - a resize that reports the right dimensions but samples badly.
 *
 *   npm run dev                    # in another terminal
 *   npm run verify:image-editor
 */

import { chromium } from 'playwright';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const PAGE = `${BASE}/image-converter/`;

const MAGIC = {
    'image/png': [0x89, 0x50, 0x4e, 0x47],
    'image/jpeg': [0xff, 0xd8, 0xff],
    'image/webp': [0x52, 0x49, 0x46, 0x46],  // "RIFF"; WEBP tag sits at byte 8
};

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

/**
 * A PNG with a transparent left half and an opaque red right half, built in the
 * page. Transparency is what makes the JPEG matte check meaningful.
 */
const MAKE_FIXTURE = `(width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255, 0, 0, 1)';
    ctx.fillRect(width / 2, 0, width / 2, height);
    return new Promise((resolve) => canvas.toBlob((b) => {
        const reader = new FileReader();
        reader.onload = () => resolve(Array.from(new Uint8Array(reader.result)));
        reader.readAsArrayBuffer(b);
    }, 'image/png'));
}`;

async function loadFixture(page, { width = 800, height = 400, name = 'fixture.png' } = {}) {
    const bytes = await page.evaluate(`(${MAKE_FIXTURE})(${width}, ${height})`);
    await page.setInputFiles('#fileInput', {
        name,
        mimeType: 'image/png',
        buffer: Buffer.from(bytes),
    });
    await page.waitForSelector('#editorWorkspace:not([style*="display: none"])', { timeout: 10000 });
}

/**
 * Export with the current settings and return the downloaded bytes.
 *
 * Waits for the href to *change*, not merely to be a blob: URL. The previous
 * export leaves one there, so waiting on the selector alone reads a stale
 * result and every assertion is silently one export behind.
 */
async function exportBytes(page) {
    const before = await page.getAttribute('#downloadBtn', 'href');
    await page.click('#exportBtn');
    await page.waitForFunction(
        (previous) => {
            const href = document.getElementById('downloadBtn')?.getAttribute('href');
            return href && href.startsWith('blob:') && href !== previous;
        },
        before,
        { timeout: 30000 },
    );
    const href = await page.getAttribute('#downloadBtn', 'href');
    return Buffer.from(await page.evaluate(async (url) => {
        const buffer = await (await fetch(url)).arrayBuffer();
        return Array.from(new Uint8Array(buffer));
    }, href));
}

/** Decode the exported bytes and read one pixel back. */
async function pixelAt(page, bytes, x, y) {
    return page.evaluate(async ({ data, x, y }) => {
        const blob = new Blob([new Uint8Array(data)]);
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3], w: bitmap.width, h: bitmap.height };
    }, { data: Array.from(bytes), x, y });
}

async function dimensions(page, bytes) {
    return page.evaluate(async (data) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)]));
        return { width: bitmap.width, height: bitmap.height };
    }, Array.from(bytes));
}

const startsWith = (buffer, magic) => magic.every((byte, i) => buffer[i] === byte);

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    try {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        console.log('\nPage loads as a module');
        check(consoleErrors.length === 0, 'no console errors on load', consoleErrors.join(' | '));
        check(await page.isVisible('#dropzone'), 'dropzone is visible');

        console.log('\nFormat is really the format');
        await loadFixture(page);
        for (const [mime, magic] of Object.entries(MAGIC)) {
            await page.selectOption('#outputFormat', mime);
            const bytes = await exportBytes(page);
            check(startsWith(bytes, magic), `${mime} has the right magic bytes`,
                [...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' '));
        }

        console.log('\nJPEG matte (transparency must not go black)');
        await page.selectOption('#outputFormat', 'image/jpeg');
        await page.fill('#matteColor', '#ffffff');
        let bytes = await exportBytes(page);
        let pixel = await pixelAt(page, bytes, 10, 10);   // the transparent half
        check(pixel.r > 240 && pixel.g > 240 && pixel.b > 240,
            'transparent area exports white, not black', `rgb(${pixel.r},${pixel.g},${pixel.b})`);

        console.log('\nMatte colour is honoured');
        await page.fill('#matteColor', '#0000ff');
        await page.dispatchEvent('#matteColor', 'input');
        bytes = await exportBytes(page);
        pixel = await pixelAt(page, bytes, 10, 10);
        check(pixel.b > 200 && pixel.r < 60, 'transparent area takes the chosen matte',
            `rgb(${pixel.r},${pixel.g},${pixel.b})`);

        console.log('\nResize');
        await page.reload({ waitUntil: 'networkidle' });
        await loadFixture(page, { width: 800, height: 400 });
        await page.selectOption('#outputFormat', 'image/png');
        await page.selectOption('#resizeUnit', 'px');
        await page.fill('#resizeWidth', '200');
        await page.dispatchEvent('#resizeWidth', 'input');
        await page.click('#applyResizeBtn');
        bytes = await exportBytes(page);
        let size = await dimensions(page, bytes);
        check(size.width === 200 && size.height === 100,
            'aspect lock derives the height', `${size.width}x${size.height}`);

        console.log('\nResize by percentage');
        await page.reload({ waitUntil: 'networkidle' });
        await loadFixture(page, { width: 800, height: 400 });
        await page.selectOption('#resizeUnit', 'percent');
        await page.fill('#resizeWidth', '25');
        await page.click('#applyResizeBtn');
        bytes = await exportBytes(page);
        size = await dimensions(page, bytes);
        check(size.width === 200 && size.height === 100,
            '25% scales both axes', `${size.width}x${size.height}`);

        // The bug this whole refactor exists for: the crop rect used to be
        // clamped in canvas-attribute pixels while drags were measured in CSS
        // pixels, so a narrow viewport cropped the wrong region.
        console.log('\nCrop lands correctly at a narrow viewport');
        await page.setViewportSize({ width: 420, height: 900 });
        await page.reload({ waitUntil: 'networkidle' });
        await loadFixture(page, { width: 1600, height: 800 });
        await page.click('#cropBtn');
        await page.waitForSelector('#cropOverlay:not([style*="display: none"])');
        await page.selectOption('#cropAspect', '1:1');
        await page.click('#applyCropBtn');
        bytes = await exportBytes(page);
        size = await dimensions(page, bytes);
        check(Math.abs(size.width - size.height) <= 2,
            'a 1:1 crop is square in output pixels', `${size.width}x${size.height}`);

        console.log('\nBatch');
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.reload({ waitUntil: 'networkidle' });
        const three = await Promise.all([1, 2, 3].map(async (n) => ({
            name: `img${n}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from(await page.evaluate(`(${MAKE_FIXTURE})(${100 * n}, ${80 * n})`)),
        })));
        await page.setInputFiles('#fileInput', three);
        await page.waitForSelector('#batchStrip:not([hidden])', { timeout: 10000 });
        check(await page.locator('.batch-item').count() === 3, 'three images are queued');
        await page.click('#exportBtn');
        await page.waitForSelector('#outputList .output-item', { timeout: 30000 });
        check(await page.locator('#outputList .output-item').count() === 3,
            'three results are produced');
        check(await page.isVisible('#downloadZipBtn'), 'the download-all button appears');

        // A zip rather than N downloads, because Chrome blocks rapid
        // successive downloads and a batch would silently arrive incomplete.
        const zip = await page.evaluate(async () => {
            const clicked = new Promise((resolve) => {
                const original = HTMLAnchorElement.prototype.click;
                HTMLAnchorElement.prototype.click = function intercept() {
                    if (this.download?.endsWith('.zip')) {
                        HTMLAnchorElement.prototype.click = original;
                        resolve(this.href);
                    } else {
                        original.call(this);
                    }
                };
            });
            document.getElementById('downloadZipBtn').click();
            const url = await clicked;
            const buffer = await (await fetch(url)).arrayBuffer();
            return Array.from(new Uint8Array(buffer));
        });
        const zipBytes = Buffer.from(zip);
        check(zipBytes.slice(0, 4).toString('latin1') === 'PK',
            'download-all produces a real zip', `${zipBytes.length} bytes`);
        // End of central directory, with the entry count in it.
        const eocd = zipBytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        check(eocd > 0 && zipBytes.readUInt16LE(eocd + 8) === 3,
            'the zip holds all three images', `count=${eocd > 0 ? zipBytes.readUInt16LE(eocd + 8) : '?'}`);

        check(consoleErrors.length === 0, 'no console errors overall', consoleErrors.join(' | '));
    } finally {
        await browser.close();
    }

    console.log(failures === 0 ? '\nAll image editor checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
