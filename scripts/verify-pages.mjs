// Bounded browser check: load each page, fail on any console error or 404.
//
// This is the class of bug the unit suite structurally cannot see -- a module
// specifier missing its .js extension passes every jest test and 404s in a
// browser. Needs `npx serve -l 5500 .` already running.

import { chromium } from 'playwright';

const BASE = process.env.SITE_URL || 'http://localhost:5500';
// Directory URLs with the trailing slash, not `/index.html`. `serve` redirects
// the explicit filename to a clean URL *without* a trailing slash, which moves
// the document base up a level so every relative import resolves against the
// site root. That is a quirk of the dev server rather than of the pages, but
// requesting the wrong form turns the whole run into a wall of false 404s.
const PAGES = [
    '/',
    '/youtube-downloader/',
    '/youtube-transcript/',
    '/exif-viewer/',
    '/pdf-toolkit/',
    '/audio-converter/',
];

// Fonts and the API are expected to be unreachable in this harness.
const IGNORE = [/fonts\.googleapis/, /fonts\.gstatic/, /localhost:5000/, /favicon/];
const ignored = (url) => IGNORE.some((re) => re.test(url));

const browser = await chromium.launch();
let failures = 0;

for (const path of PAGES) {
    const page = await browser.newPage();
    const problems = [];

    page.on('console', (msg) => {
        if (msg.type() === 'error' && !ignored(msg.location().url || '')) {
            problems.push(`console: ${msg.text()}`);
        }
    });
    page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`));
    page.on('requestfailed', (req) => {
        if (ignored(req.url())) return;
        // The ffmpeg pages register coi-serviceworker, which reloads the page
        // once to turn on cross-origin isolation. That aborts the first
        // navigation by design, so ERR_ABORTED on the document is expected --
        // the `crossOriginIsolated` assertion below is what actually proves it
        // worked.
        const aborted = (req.failure()?.errorText || '').includes('ERR_ABORTED');
        if (aborted && req.url() === `${BASE}${path}`) return;
        problems.push(`failed: ${req.url()}`);
    });
    page.on('response', (res) => {
        if (res.status() >= 400 && !ignored(res.url())) {
            problems.push(`${res.status()}: ${res.url()}`);
        }
    });

    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 20000 });

    // The file:// guard hides the whole page; if it fired over http something
    // is badly wrong.
    const guarded = await page.evaluate(() =>
        document.documentElement.classList.contains('needs-http'));
    if (guarded) problems.push('the file:// guard fired over http');

    // The ffmpeg tools are useless without SharedArrayBuffer, and the headers
    // that enable it come from a service worker on this host.
    if (path === '/audio-converter/') {
        const isolated = await page.evaluate(() => self.crossOriginIsolated);
        if (!isolated) problems.push('cross-origin isolation did not turn on');
    }

    // A module that threw on import leaves its listeners unattached, which a
    // static HTML assertion would never notice.
    const wired = await page.evaluate(() => {
        const probe = document.querySelector('#fetchBtn, #stripBtn, #saveBtn, #searchInput, #convertBtn');
        return Boolean(probe);
    });
    if (!wired) problems.push('no recognised control found on the page');

    if (problems.length) {
        failures += 1;
        console.log(`FAIL ${path}`);
        for (const p of problems) console.log(`     ${p}`);
    } else {
        console.log(`ok   ${path}`);
    }

    await page.close();
}

// Exercise the pure modules in a real browser, not jsdom: this is where an
// import path that only jest resolves would blow up.
const page = await browser.newPage();
await page.goto(`${BASE}/pdf-toolkit/index.html`, { waitUntil: 'networkidle' });
const pdfLibOk = await page.evaluate(async () => {
    const { PDFDocument } = await import('/js/vendor/pdf-lib.js');
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save();
    return bytes.length > 0 && bytes[0] === 0x25; // '%' of %PDF
});
console.log(pdfLibOk ? 'ok   pdf-lib builds a real PDF in the browser' : 'FAIL pdf-lib');
if (!pdfLibOk) failures += 1;

const handoffOk = await page.evaluate(async () => {
    const { putHandoff, takeHandoff } = await import('/js/shared/handoff.js');
    const file = new File([new Uint8Array([1, 2, 3])], 'x.m4a', { type: 'audio/mp4' });
    const id = await putHandoff(file, { format: 'mp3' });
    const first = await takeHandoff(id);
    const second = await takeHandoff(id); // must be gone: entries are one-shot
    return Boolean(first && first.file.name === 'x.m4a' && first.meta.format === 'mp3') && second === null;
});
console.log(handoffOk ? 'ok   handoff stores, returns and then forgets a file' : 'FAIL handoff');
if (!handoffOk) failures += 1;

await browser.close();
console.log(failures ? `\n${failures} failing` : '\nall clear');
process.exit(failures ? 1 : 0);
