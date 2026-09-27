#!/usr/bin/env node
/**
 * Drive Text from Image in a real browser: draw known text, recognise it
 * through the page, and score the words that come back.
 *
 * Covers an image at two sizes and an image-only "scanned" PDF, which goes
 * through pdf.js before tesseract. Needs the network: tesseract's engine and
 * language data come from a pinned CDN (see js/shared/ocr.js).
 *
 * Deliberately NOT part of `npm test`: it needs a browser, a running dev
 * server and the network.
 *
 *   npm run dev                # in another terminal
 *   npm run verify:text-from-image
 */

import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const PAGE = `${BASE}/text-from-image/`;
const TEXT = [
    'Invoice number 20417 is due on the fifteenth of March.',
    'Please transfer the balance to the account below',
    'and quote your reference with the payment.',
];

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

/** Share of the expected words that came back, ignoring punctuation and case. */
function wordAccuracy(got) {
    const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const pool = words(got);
    const want = words(TEXT.join(' '));
    let hit = 0;
    for (const word of want) {
        const at = pool.indexOf(word);
        if (at !== -1) { hit += 1; pool.splice(at, 1); }
    }
    return hit / want.length;
}

/** The text drawn black on white, as PNG bytes. */
const MAKE_PNG = `async (lines, px) => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(px * 32); c.height = Math.ceil(px * 1.6 * (lines.length + 1));
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#111'; x.font = px + 'px Arial, Helvetica, sans-serif'; x.textBaseline = 'top';
    lines.forEach((line, i) => x.fillText(line, px, px * 0.8 + i * px * 1.6));
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
}`;

/** That PNG as the only thing on a PDF page: no text layer, like a scan. */
const MAKE_SCAN = `async (png) => {
    const { PDFDocument } = await import(new URL('../js/vendor/pdf-lib.js', location.href).href);
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(new Uint8Array(png));
    const page = doc.addPage([image.width / 2, image.height / 2]);
    page.drawImage(image, { x: 0, y: 0, width: image.width / 2, height: image.height / 2 });
    return Array.from(await doc.save());
}`;

async function recogniseThrough(page, files) {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.setInputFiles('#fileInput', files);
    await page.waitForSelector('#workspace:not([hidden])');
    await page.click('#runBtn');
    await page.waitForSelector('#results:not([hidden])', { timeout: 180000 });
    return page.inputValue('#ocrOutput');
}

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    try {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        console.log('\nImages');
        for (const px of [22, 40]) {
            const png = Buffer.from(await page.evaluate(`(${MAKE_PNG})(${JSON.stringify(TEXT)}, ${px})`));
            const text = await recogniseThrough(page, [{ name: `note-${px}.png`, mimeType: 'image/png', buffer: png }]);
            const score = wordAccuracy(text);
            check(score >= 0.95, `${px}px text is read back`, `${Math.round(score * 100)}% of words`);
        }

        console.log('\nA scanned PDF (image only, no text layer)');
        const png = Buffer.from(await page.evaluate(`(${MAKE_PNG})(${JSON.stringify(TEXT)}, 28)`));
        const scan = Buffer.from(await page.evaluate(`(${MAKE_SCAN})(${JSON.stringify(Array.from(png))})`));
        const text = await recogniseThrough(page, [
            { name: 'scan.pdf', mimeType: 'application/pdf', buffer: scan },
        ]);
        const score = wordAccuracy(text);
        check(score >= 0.95, 'its page is rendered and read', `${Math.round(score * 100)}% of words`);
        check(/20417/.test(text), 'numbers survive', text.match(/\d{4,}/)?.[0] ?? 'none');

        console.log('\nSaving it');
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadTxtBtn')]);
        const saved = fs.readFileSync(await download.path(), 'utf8');
        check(download.suggestedFilename() === 'scan.txt', 'named after the file', download.suggestedFilename());
        check(saved === await page.inputValue('#ocrOutput'), 'the .txt holds exactly what is shown');

        check(errors.length === 0, 'no console errors overall', errors.join(' | '));
    } finally {
        await browser.close();
    }

    console.log(failures === 0 ? '\nAll text-from-image checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
