#!/usr/bin/env node
/**
 * Drive the favicon generator in a real browser and take the zip apart.
 *
 * Deliberately NOT part of `npm test`: it needs a browser and a running dev
 * server, and `npm test` gates the Vercel deploy.
 *
 * Both container formats here are hand-written, so the unit tests assert the
 * byte layout we *intended*. This checks the layout the platform actually
 * accepts: that Node can unzip the archive, and that the browser will decode
 * the PNGs inside it at the sizes claimed. A ZIP that only opens in Windows
 * Explorer, or an .ico with a wrong offset, both pass a layout test and fail in
 * the real world.
 *
 *   npm run dev              # in another terminal
 *   npm run verify:favicon
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const PAGE = `${BASE}/favicon-generator/`;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'uth-favicon-'));

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

/**
 * An unzip implementation that is not ours.
 *
 * Tried in order, because there is no one tool present everywhere: Git Bash
 * ships GNU tar, which cannot read ZIP at all, while Windows ships bsdtar at a
 * fixed path and most Unix systems have Info-ZIP. Whichever answers first is
 * used, and the check reports which — if none is available the check fails
 * loudly rather than quietly passing.
 */
const EXTRACTORS = [
    { name: 'unzip', list: ['-Z1', 'favicons.zip'], extract: ['-o', '-q', 'favicons.zip'] },
    { name: 'C:/Windows/System32/tar.exe', list: ['-tf', 'favicons.zip'], extract: ['-xf', 'favicons.zip'] },
    { name: 'bsdtar', list: ['-tf', 'favicons.zip'], extract: ['-xf', 'favicons.zip'] },
];

function findExtractor(cwd) {
    for (const tool of EXTRACTORS) {
        try {
            const listing = execFileSync(tool.name, tool.list, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            if (listing.trim()) return { tool, listing };
        } catch { /* try the next one */ }
    }
    return null;
}

/** A 1024px source with an obvious asymmetric mark, so cropping is visible. */
const MAKE_LOGO = `() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = '#6366f1'; x.fillRect(0, 0, 1024, 1024);
    x.fillStyle = '#fbbf24'; x.fillRect(0, 0, 512, 512);
    return new Promise((r) => c.toBlob((b) => {
        const fr = new FileReader();
        fr.onload = () => r(Array.from(new Uint8Array(fr.result)));
        fr.readAsArrayBuffer(b);
    }, 'image/png'));
}`;

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    try {
        await page.goto(PAGE, { waitUntil: 'networkidle' });
        console.log('\nPage');
        check(errors.length === 0, 'no console errors on load', errors.join(' | '));

        const logo = await page.evaluate(`(${MAKE_LOGO})()`);
        await page.setInputFiles('#fileInput', {
            name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logo),
        });
        await page.waitForSelector('#workspace:not([hidden])', { timeout: 10000 });

        console.log('\nPreview');
        const previews = await page.$$eval('.favicon-preview-canvas',
            (nodes) => nodes.map((n) => n.width));
        check(previews.length >= 5, 'several sizes are previewed', previews.join(','));
        // A 16px preview must be a real 16px canvas, or it is not showing what
        // the icon will actually look like.
        check(previews.includes(16) && previews.includes(512),
            'previews are rendered at their true pixel size', previews.join(','));

        console.log('\nGenerate');
        await page.click('#generateBtn');
        await page.waitForSelector('#results:not([hidden])', { timeout: 60000 });
        const href = await page.getAttribute('#downloadZipBtn', 'href');
        const zipBytes = Buffer.from(await page.evaluate(async (url) => {
            const b = await (await fetch(url)).arrayBuffer();
            return Array.from(new Uint8Array(b));
        }, href));
        check(zipBytes.length > 0, 'a zip was produced', `${zipBytes.length} bytes`);

        const zipPath = path.join(WORK, 'favicons.zip');
        fs.writeFileSync(zipPath, zipBytes);

        // The real test of the hand-written writer: a tool that seeks the
        // central directory, rather than scanning for local headers.
        console.log('\nThe zip is readable by something that is not us');
        // Relative paths with cwd throughout, never absolute ones: GNU tar
        // reads "C:\..." as a remote host spec and fails to resolve it.
        const found = findExtractor(WORK);
        check(found !== null, 'an independent unzip reads the central directory',
            found ? `via ${found.tool.name}` : 'no unzip tool available on PATH');
        const listing = found?.listing ?? '';

        const names = listing.split('\n').map((s) => s.trim()).filter(Boolean);
        check(names.includes('favicon.ico'), 'contains favicon.ico', names.length ? '' : '(no listing)');
        check(names.includes('site.webmanifest'), 'contains the web manifest');
        check(names.some((n) => /favicon-512x512\.png$/.test(n)), 'contains the 512px PNG');
        check(names.length >= 11, 'contains every size plus the extras', `${names.length} entries`);

        console.log('\nExtracted contents are valid');
        if (found) {
            try {
                execFileSync(found.tool.name, found.tool.extract, { cwd: WORK, stdio: 'ignore' });
            } catch { /* reported below by the file checks */ }
        }

        const icoPath = path.join(WORK, 'favicon.ico');
        if (fs.existsSync(icoPath)) {
            const ico = fs.readFileSync(icoPath);
            check(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1,
                'favicon.ico has an icon header');
            const count = ico.readUInt16LE(4);
            let offsetsOk = count > 0;
            for (let i = 0; i < count; i += 1) {
                const entry = 6 + i * 16;
                const length = ico.readUInt32LE(entry + 8);
                const offset = ico.readUInt32LE(entry + 12);
                // Each payload must be a real PNG at the offset claimed.
                if (offset + length > ico.length
                    || ico.readUInt32BE(offset) !== 0x89504e47) offsetsOk = false;
            }
            check(offsetsOk, `all ${count} icon offsets point at a real PNG`);
        } else {
            check(false, 'favicon.ico was extracted');
        }

        const manifestPath = path.join(WORK, 'site.webmanifest');
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            check(Array.isArray(manifest.icons) && manifest.icons.length > 0,
                'the manifest is valid JSON listing icons',
                manifest.icons?.map((i) => i.sizes).join(','));
        } else {
            check(false, 'the manifest was extracted');
        }

        // Decode the PNGs back in the browser: the size on the label has to be
        // the size in the pixels.
        console.log('\nThe PNGs really are the sizes they claim');
        for (const size of [16, 32, 180, 512]) {
            const file = path.join(WORK, `favicon-${size}x${size}.png`);
            if (!fs.existsSync(file)) { check(false, `favicon-${size}x${size}.png exists`); continue; }
            const dims = await page.evaluate(async (data) => {
                const bmp = await createImageBitmap(new Blob([new Uint8Array(data)]));
                return { w: bmp.width, h: bmp.height };
            }, Array.from(fs.readFileSync(file)));
            check(dims.w === size && dims.h === size,
                `favicon-${size}x${size}.png decodes at ${size}x${size}`, `${dims.w}x${dims.h}`);
        }

        check(errors.length === 0, 'no console errors overall', errors.join(' | '));
    } finally {
        await browser.close();
        fs.rmSync(WORK, { recursive: true, force: true });
    }

    console.log(failures === 0 ? '\nAll favicon checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
