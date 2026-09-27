#!/usr/bin/env node
/**
 * Drive the PDF tools in a real browser and inspect what comes out.
 *
 * Deliberately NOT part of `npm test`: it needs a browser and a running dev
 * server, and `npm test` gates the Vercel deploy.
 *
 * A PDF that "parses" proves very little -- readers are famously tolerant, and
 * a structurally valid file can still have the wrong page count or silently
 * lose its content. So each check reads the output back and asserts something
 * specific about it: how many pages there are, what rotation they carry, and
 * that the bytes begin and end the way the format requires.
 *
 *   npm run dev                # in another terminal
 *   npm run verify:pdf-tools
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const PAGE = `${BASE}/pdf-tools/`;

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

/**
 * Build a PDF in the page with pdf-lib, so no binary fixture is needed.
 * `rotate` pre-rotates every page, which is what makes "rotation is
 * cumulative" testable. The import is relative to the page: a root-absolute
 * one 404s under GitHub Pages' /UTH/ prefix.
 */
const MAKE_PDF = `async (pages, rotate = 0) => {
    const { PDFDocument, rgb, degrees } = await import(new URL('../js/vendor/pdf-lib.js', location.href).href);
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) {
        const p = doc.addPage([300, 400]);
        p.drawRectangle({ x: 20, y: 20, width: 260, height: 360, color: rgb(i / pages, 0.4, 0.8) });
        if (rotate) p.setRotation(degrees(rotate));
    }
    return Array.from(await doc.save());
}`;

/**
 * A one-page PDF whose trailer names an /Encrypt dictionary. pdf-lib cannot
 * create encrypted files, so it is written by hand, the same way as in
 * tests/pdf-ops.test.js.
 */
function encryptedPdf() {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
        '<< /Filter /Standard /V 1 /R 2 /O (xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) /U (xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) /P -4 >>',
    ];
    let body = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((object, i) => {
        offsets.push(body.length);
        body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
}

/**
 * Report what a produced PDF actually contains, read by something that is
 * not pdf-lib: poppler's pdfinfo. Asserting pdf-lib's output back through
 * pdf-lib would agree with any bug the two share.
 */
function inspectPdf(page, bytes) {
    const file = path.join(os.tmpdir(), `uth-verify-${process.pid}.pdf`);
    fs.writeFileSync(file, bytes);
    try {
        const text = execFileSync('pdfinfo', ['-f', '1', '-l', '9999', file], { encoding: 'latin1' });
        const pages = Number(/^Pages:\s+(\d+)/m.exec(text)?.[1]);
        const sizes = [...text.matchAll(/^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/gm)]
            .map((m) => ({ width: Number(m[1]), height: Number(m[2]) }));
        const rotations = [...text.matchAll(/^Page\s+\d+ rot:\s+(\d+)/gm)].map((m) => Number(m[1]));
        return { pages, sizes, rotations };
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!inspectPdf.warned) {
            console.log('  (pdfinfo is not on PATH; reading back with pdf-lib, which proves less)');
            inspectPdf.warned = true;
        }
        return inspectWithPdfLib(page, bytes);
    } finally {
        fs.rmSync(file, { force: true });
    }
}

/**
 * The fallback. Passed as a real function, not a template string:
 * page.evaluate treats a string as an expression and silently ignores the
 * argument, so every assertion would read undefined.
 */
function inspectWithPdfLib(page, bytes) {
    return page.evaluate(async (data) => {
        const { PDFDocument } = await import(new URL('../js/vendor/pdf-lib.js', location.href).href);
        const doc = await PDFDocument.load(new Uint8Array(data));
        return {
            pages: doc.getPageCount(),
            rotations: doc.getPages().map((p) => p.getRotation().angle),
            sizes: doc.getPages().map((p) => p.getSize()),
        };
    }, Array.from(bytes));
}

const MAKE_PNG = `(w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#22d3ee'; x.fillRect(0, 0, w, h);
    return new Promise((r) => c.toBlob((b) => {
        const fr = new FileReader();
        fr.onload = () => r(Array.from(new Uint8Array(fr.result)));
        fr.readAsArrayBuffer(b);
    }, 'image/png'));
}`;

async function reset(page) {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
}

async function upload(page, files) {
    await page.setInputFiles('#fileInput', files);
    await page.waitForSelector('#workspace:not([hidden])', { timeout: 10000 });
}

async function runAndCollect(page) {
    await page.click('#runBtn');
    await page.waitForSelector('#resultList a[download]', { timeout: 60000 });
    const href = await page.getAttribute('#resultList a[download]', 'href');
    const name = await page.getAttribute('#resultList a[download]', 'download');
    const bytes = Buffer.from(await page.evaluate(async (url) => {
        const b = await (await fetch(url)).arrayBuffer();
        return Array.from(new Uint8Array(b));
    }, href));
    return { name, bytes };
}


/** A 200x50 signature: left half ink, right half transparent, so a flipped or
 *  turned placement shows up as ink on the wrong side. */
const MAKE_SIGNATURE = `() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 50;
    c.getContext('2d').fillRect(0, 0, 100, 50);
    return new Promise((r) => c.toBlob(async (b) => r(Array.from(new Uint8Array(await b.arrayBuffer()))), 'image/png'));
}`;

/** Rasterise page 1 as a viewer shows it (pdftoppm applies /Rotate), grey. */
function rasterise(bytes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uth-ras-'));
    try {
        fs.writeFileSync(path.join(dir, 'in.pdf'), bytes);
        execFileSync('pdftoppm', ['-r', '72', '-f', '1', '-l', '1', '-png', path.join(dir, 'in.pdf'), path.join(dir, 'out')]);
        const png = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.png')));
        const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
            'stream=width,height', '-of', 'csv=p=0', png], { encoding: 'utf8' }).trim().split(',').map(Number);
        const grey = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
        return { w, h, grey };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** Bounding box of pixels that differ by more than a little. */
function changedBox(a, b) {
    let left = a.w; let top = a.h; let right = -1; let bottom = -1;
    for (let y = 0; y < a.h; y += 1) {
        for (let x = 0; x < a.w; x += 1) {
            if (Math.abs(a.grey[y * a.w + x] - b.grey[y * a.w + x]) > 40) {
                left = Math.min(left, x); right = Math.max(right, x);
                top = Math.min(top, y); bottom = Math.max(bottom, y);
            }
        }
    }
    return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

const pdfFile = (name, bytes) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    try {
        await reset(page);
        console.log('\nPage');
        check(errors.length === 0, 'no console errors on load', errors.join(' | '));

        const threePage = await page.evaluate(`(${MAKE_PDF})(3)`);
        const twoPage = await page.evaluate(`(${MAKE_PDF})(2)`);

        console.log('\nPage counts are read from the file, not guessed');
        await upload(page, [pdfFile('a.pdf', threePage)]);
        await page.waitForFunction(
            () => /\d+ pages/.test(document.getElementById('fileList')?.textContent ?? ''),
            null, { timeout: 15000 },
        );
        check(/3 pages/.test(await page.textContent('#fileList')), 'a 3-page PDF reports 3 pages');

        console.log('\nMerge');
        await reset(page);
        await upload(page, [pdfFile('a.pdf', threePage), pdfFile('b.pdf', twoPage)]);
        await page.selectOption('#operation', 'merge');
        let out = await runAndCollect(page);
        let info = await inspectPdf(page, out.bytes);
        check(out.bytes.slice(0, 5).toString('latin1') === '%PDF-', 'output starts with %PDF-');
        check(out.bytes.slice(-6).toString('latin1').includes('%%EOF'), 'output ends with %%EOF');
        check(info.pages === 5, 'merging 3 + 2 pages gives 5', `${info.pages} pages`);

        console.log('\nKeep only some pages');
        await reset(page);
        await upload(page, [pdfFile('a.pdf', threePage)]);
        await page.selectOption('#operation', 'extract');
        await page.fill('#pageRange', '1,3');
        out = await runAndCollect(page);
        info = await inspectPdf(page, out.bytes);
        check(info.pages === 2, 'keeping pages 1 and 3 leaves 2 pages', `${info.pages} pages`);

        console.log('\nRemove pages');
        await reset(page);
        await upload(page, [pdfFile('a.pdf', threePage)]);
        await page.selectOption('#operation', 'remove');
        await page.fill('#pageRange', '2');
        out = await runAndCollect(page);
        info = await inspectPdf(page, out.bytes);
        check(info.pages === 2, 'removing 1 of 3 pages leaves 2', `${info.pages} pages`);

        console.log('\nRotate');
        await reset(page);
        await upload(page, [pdfFile('a.pdf', threePage)]);
        await page.selectOption('#operation', 'rotate');
        await page.fill('#pageRange', 'all');
        await page.selectOption('#rotateAngle', '90');
        out = await runAndCollect(page);
        info = await inspectPdf(page, out.bytes);
        check(info.rotations.length === 3 && info.rotations.every((r) => r === 90),
            'every page is rotated 90°', info.rotations.join(','));

        // Rotation adds to what a page already carries; replacing it would
        // silently un-rotate pages that were already sideways.
        console.log('\nRotate an already-rotated PDF');
        await reset(page);
        await upload(page, [pdfFile('sideways.pdf', await page.evaluate(`(${MAKE_PDF})(2, 90)`))]);
        await page.selectOption('#operation', 'rotate');
        await page.fill('#pageRange', 'all');
        await page.selectOption('#rotateAngle', '90');
        out = await runAndCollect(page);
        info = await inspectPdf(page, out.bytes);
        check(info.rotations.length === 2 && info.rotations.every((r) => r === 180),
            'a page at 90° turned 90° more ends at 180°', info.rotations.join(','));

        console.log('\nSplit');
        await reset(page);
        await upload(page, [pdfFile('a.pdf', threePage)]);
        await page.selectOption('#operation', 'split');
        await page.selectOption('#splitMode', 'single');
        out = await runAndCollect(page);
        check(out.name.endsWith('.zip'), 'a split comes back as a zip', out.name);
        check(out.bytes.slice(0, 2).toString('latin1') === 'PK', 'and it is a real zip');
        const eocd = out.bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        check(eocd > 0 && out.bytes.readUInt16LE(eocd + 8) === 3,
            'the zip holds one file per page',
            `count=${eocd > 0 ? out.bytes.readUInt16LE(eocd + 8) : '?'}`);

        console.log('\nImages to PDF');
        await reset(page);
        const png = await page.evaluate(`(${MAKE_PNG})(400, 300)`);
        await upload(page, [
            { name: 'one.png', mimeType: 'image/png', buffer: Buffer.from(png) },
            { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(png) },
        ]);
        await page.selectOption('#operation', 'fromImages');
        out = await runAndCollect(page);
        info = await inspectPdf(page, out.bytes);
        check(info.pages === 2, 'two images become a two-page PDF', `${info.pages} pages`);

        // A phone photo: 400x300 pixels stored with EXIF orientation 6 (turn
        // 90° clockwise to display), named .png as a mismatched upload would
        // be. PDF viewers ignore EXIF, and the name used to route it to
        // embedPng, which threw.
        console.log('\nA sideways phone JPEG with the wrong extension');
        await reset(page);
        const rotated = await page.evaluate(async () => {
            const c = document.createElement('canvas');
            c.width = 400; c.height = 300;
            c.getContext('2d').fillRect(0, 0, 400, 300);
            const jpeg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg'))).arrayBuffer());
            // APP1 "Exif", big-endian TIFF, one IFD entry: Orientation (0x0112) = 6.
            const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
            const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
            const app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
            return [0xff, 0xd8, ...app1, ...jpeg.slice(2)];
        });
        await upload(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(rotated) }]);
        await page.selectOption('#operation', 'fromImages');
        out = await runAndCollect(page);
        info = await inspectPdf(page, out.bytes);
        const [size] = info.sizes;
        check(info.pages === 1, 'a JPEG named .png still converts', `${info.pages} page(s)`);
        check(Math.round(size.width) === 300 && Math.round(size.height) === 400,
            'and the page is upright (portrait)', `${size.width}x${size.height}`);

        // The operation must refuse mismatched input rather than producing a
        // broken file, since "merge" over images would silently do nothing.
        console.log('\nThumbnails');
        await reset(page);
        await upload(page, [pdfFile('six.pdf', await page.evaluate(`(${MAKE_PDF})(6)`))]);
        await page.selectOption('#operation', 'extract');
        await page.waitForSelector('#thumbGrid:not([hidden]) .pdf-thumb[data-state="done"] canvas', { timeout: 30000 });
        check(await page.locator('#thumbGrid .pdf-thumb').count() === 6, 'one thumbnail per page');
        await page.click('#thumbGrid .pdf-thumb[data-index="1"]');
        check(await page.inputValue('#pageRange') === '1, 3-6', 'clicking page 2 deselects it in the range',
            await page.inputValue('#pageRange'));
        await page.fill('#pageRange', '1-2');
        check(await page.getAttribute('#thumbGrid .pdf-thumb[data-index="4"]', 'aria-pressed') === 'false'
            && await page.getAttribute('#thumbGrid .pdf-thumb[data-index="0"]', 'aria-pressed') === 'true',
            'typing a range updates the highlight');

        // Rendered on demand: a long PDF must not render every page at once.
        await reset(page);
        await upload(page, [pdfFile('long.pdf', await page.evaluate(`(${MAKE_PDF})(80)`))]);
        await page.selectOption('#operation', 'extract');
        await page.waitForSelector('#thumbGrid .pdf-thumb[data-state="done"]', { timeout: 30000 });
        await page.waitForTimeout(1500);
        const rendered = await page.locator('#thumbGrid .pdf-thumb[data-state="done"]').count();
        check(rendered > 0 && rendered < 80, 'a long PDF renders only the pages in view', `${rendered} of 80`);

        console.log('\nSave pages as JPG');
        for (const [range, expected] of [['2', 1], ['1-3', 3]]) {
            await reset(page);
            await upload(page, [pdfFile('doc.pdf', await page.evaluate(`(${MAKE_PDF})(3)`))]);
            await page.selectOption('#operation', 'toImages');
            await page.fill('#pageRange', range);
            await page.selectOption('#pdfDpi', '150');
            const out = await runAndCollect(page);
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uth-jpg-'));
            try {
                let jpgs;
                if (expected === 1) {
                    fs.writeFileSync(path.join(dir, out.name), out.bytes);
                    jpgs = [out.name];
                } else {
                    fs.writeFileSync(path.join(dir, 'out.zip'), out.bytes);
                    execFileSync('unzip', ['-q', path.join(dir, 'out.zip'), '-d', dir]);
                    jpgs = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
                }
                check(jpgs.length === expected, `pages "${range}" give ${expected} JPEG${expected === 1 ? '' : 's'}`, jpgs.join(', '));
                const size = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height',
                    '-of', 'csv=p=0', path.join(dir, jpgs[0])], { encoding: 'utf8' }).trim();
                // 300 x 400 pt at 150 dpi.
                check(size === 'mjpeg,625,833', 'ffprobe reads a 150 dpi JPEG of the page', size);
                if (expected === 1) check(jpgs[0] === 'doc-page-2.jpg', 'named for its page', jpgs[0]);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }

        console.log('\nSign a page');
        const signature = Buffer.from(await page.evaluate(`(${MAKE_SIGNATURE})()`));
        for (const rotation of [0, 90]) {
            await reset(page);
            const original = Buffer.from(await page.evaluate(`(${MAKE_PDF})(1, ${rotation})`));
            await upload(page, [pdfFile('contract.pdf', original)]);
            await page.selectOption('#operation', 'sign');
            check(await page.isDisabled('#runBtn'), `/Rotate ${rotation}: Run waits for a signature`);
            await page.waitForFunction(() => document.getElementById('signPageCanvas').width > 300, null, { timeout: 30000 });
            await page.setInputFiles('#signUpload', { name: 'sig.png', mimeType: 'image/png', buffer: signature });
            await page.waitForSelector('#signBox:not([hidden])');
            // Move it off the default spot with the keyboard, the accessible way.
            await page.focus('#signBox');
            for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowLeft');
            const box = await page.$eval('#signBox', (el) => ['left', 'top', 'width', 'height']
                .map((k) => parseFloat(el.style[k]) / 100));
            const signed = await runAndCollect(page);
            check(inspectPdf(page, signed.bytes).pages === 1, `/Rotate ${rotation}: still one page`);

            const before = rasterise(original);
            const after = rasterise(signed.bytes);
            const ink = changedBox(before, after);
            // Ink is the signature's left half only; the right half is transparent.
            const want = {
                left: box[0] * after.w, top: box[1] * after.h,
                right: (box[0] + box[2] / 2) * after.w, bottom: (box[1] + box[3]) * after.h,
            };
            const near = (a, b) => Math.abs(a - b) <= 3;
            check(Boolean(ink) && near(ink.left, want.left) && near(ink.right, want.right)
                && near(ink.top, want.top) && near(ink.bottom, want.bottom),
                `/Rotate ${rotation}: the ink lands where the box was, right way up`,
                ink ? `ink ${ink.left},${ink.top}-${ink.right},${ink.bottom} want ${want.left.toFixed(0)},${want.top.toFixed(0)}-${want.right.toFixed(0)},${want.bottom.toFixed(0)}` : 'no ink found');
        }

        console.log('\nMismatched input is refused, not mangled');
        await reset(page);
        await upload(page, [{ name: 'one.png', mimeType: 'image/png', buffer: Buffer.from(png) }]);
        await page.selectOption('#operation', 'merge');
        check(await page.isDisabled('#runBtn'), 'Run is disabled for images under Merge');
        const notice = (await page.textContent('#notice')) ?? '';
        check(/image/i.test(notice), 'and the reason is stated', notice.trim());

        // pdf-lib cannot decrypt, so an encrypted file used to be "processed"
        // into blank pages with a success message.
        console.log('\nAn encrypted PDF is refused by name');
        await reset(page);
        await upload(page, [{ name: 'locked.pdf', mimeType: 'application/pdf', buffer: encryptedPdf() }]);
        await page.selectOption('#operation', 'rotate');
        await page.waitForFunction(() => /password/.test(document.getElementById('fileList')?.textContent ?? ''));
        check(await page.isDisabled('#runBtn'), 'Run is disabled');
        const locked = (await page.textContent('#notice')) ?? '';
        check(/locked\.pdf is password-protected/.test(locked), 'and the notice names the file', locked.trim());

        check(errors.length === 0, 'no console errors overall', errors.join(' | '));
    } finally {
        await browser.close();
    }

    console.log(failures === 0 ? '\nAll PDF checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
