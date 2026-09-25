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

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const PAGE = `${BASE}/pdf-tools/`;

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

/** Build a PDF in the page with pdf-lib, so no binary fixture is needed. */
const MAKE_PDF = `async (pages) => {
    const { PDFDocument, rgb } = await import('/js/vendor/pdf-lib.js');
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) {
        const p = doc.addPage([300, 400]);
        p.drawRectangle({ x: 20, y: 20, width: 260, height: 360, color: rgb(i / pages, 0.4, 0.8) });
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
 * Read a produced PDF back with pdf-lib and report what it actually contains.
 *
 * Passed as a real function, not a template string: page.evaluate treats a
 * string as an expression and silently ignores the argument, so a stringified
 * version of this would return the function itself and every assertion would
 * read undefined.
 */
function inspectPdf(page, bytes) {
    return page.evaluate(async (data) => {
        const { PDFDocument } = await import('/js/vendor/pdf-lib.js');
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
        check(info.rotations.every((r) => r === 90),
            'every page is rotated 90°', info.rotations.join(','));

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
