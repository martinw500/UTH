#!/usr/bin/env node
/**
 * Drive the photo privacy page in a real browser, then check what it produced
 * with exiftool -- a different implementation from the one under test, which
 * is the point: asserting our own byte layout back at ourselves proves nothing.
 *
 * For each format it checks that the location, camera and serial number are
 * gone, that the JPEG kept its colour profile, and that the pixels decode
 * identically (ffmpeg, again not our code). HEIC comes back as a JPEG.
 *
 * Deliberately NOT part of `npm test`: it needs a browser, a running dev
 * server, exiftool and ffmpeg. macOS additionally builds a HEIC with `sips`.
 *
 *   npm run dev                # in another terminal
 *   npm run verify:photo-privacy
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const PAGE = `${BASE}/photo-privacy/`;
const P3 = '/System/Library/ColorSync/Profiles/Display P3.icc';

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const has = (cmd) => { try { run(cmd, ['-ver']); return true; } catch { try { run(cmd, ['-version']); return true; } catch { return false; } } };

const IDENTITY = [
    '-GPSLatitude=51.5007', '-GPSLatitudeRef=N', '-GPSLongitude=0.1246', '-GPSLongitudeRef=W',
    '-Make=Apple', '-Model=iPhone 15 Pro', '-SerialNumber=SN-0042', '-Artist=Jane Doe',
];

function exif(file) {
    return JSON.parse(run('exiftool', ['-j', '-G', file]).toString())[0];
}

/**
 * Keys exiftool reports that identify a place, a person or a camera. The ICC
 * profile is kept on purpose, and its DeviceModel field names the display the
 * profile describes (blank in Apple's own), not the camera.
 */
function identifying(tags) {
    return Object.keys(tags).filter((k) => !k.startsWith('ICC_Profile:')
        && /GPS|Model|Make|SerialNumber|Artist/.test(k));
}

/** Decoded pixels, by ffmpeg. Equal hashes mean the picture was not touched. */
function pixelHash(file) {
    const raw = run('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    return crypto.createHash('sha256').update(raw).digest('hex');
}

async function main() {
    for (const tool of ['exiftool', 'ffmpeg']) {
        if (!has(tool)) { console.error(`${tool} is required (brew install ${tool}).`); process.exit(1); }
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uth-privacy-'));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    try {
        // ---- Fixtures ----
        const jpg = path.join(dir, 'holiday.jpg');
        const png = path.join(dir, 'screenshot.png');
        const webp = path.join(dir, 'shared.webp');
        const heic = path.join(dir, 'IMG_0001.heic');
        run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', '-q:v', '3', jpg]);
        run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240', '-frames:v', '1', png]);
        await page.goto(PAGE, { waitUntil: 'networkidle' });
        fs.writeFileSync(webp, Buffer.from(await page.evaluate(async () => {
            const c = document.createElement('canvas');
            c.width = 200; c.height = 150;
            const x = c.getContext('2d');
            x.fillStyle = '#16a34a'; x.fillRect(0, 0, 200, 150);
            x.fillStyle = '#fff'; x.fillRect(40, 40, 60, 60);
            const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.9));
            return Array.from(new Uint8Array(await blob.arrayBuffer()));
        })));
        const withIcc = fs.existsSync(P3);
        run('exiftool', ['-q', '-overwrite_original', ...IDENTITY, ...(withIcc ? [`-ICC_Profile<=${P3}`] : []), jpg]);
        run('exiftool', ['-q', '-overwrite_original', ...IDENTITY, png]);
        run('exiftool', ['-q', '-overwrite_original', ...IDENTITY, webp]);
        const withHeic = (() => { try { run('sips', ['-s', 'format', 'heic', png, '--out', heic]); return true; } catch { return false; } })();
        if (withHeic) run('exiftool', ['-q', '-overwrite_original', ...IDENTITY, heic]);

        const inputs = [jpg, png, webp, ...(withHeic ? [heic] : [])];
        for (const file of inputs) {
            check(identifying(exif(file)).length >= 4, `fixture ${path.basename(file)} carries identifying tags`);
        }
        if (!withIcc) console.log('  --   no Display P3 profile on this machine; ICC check skipped');
        if (!withHeic) console.log('  --   no sips on this machine; HEIC check skipped');

        // ---- The reveal ----
        console.log('\nWhat the page shows');
        await page.setInputFiles('#fileInput', inputs);
        await page.waitForSelector('#workspace:not([hidden])');
        await page.waitForFunction((n) => document.querySelectorAll('.privacy-card').length === n, inputs.length);
        const cards = await page.$$eval('.privacy-card', (nodes) => nodes.map((n) => n.textContent));
        check(cards.every((t) => /says where it was taken/.test(t)), 'every photo is flagged as giving away a location');
        check(cards.every((t) => /51\.5007, -0\.1246/.test(t)), 'with the coordinates, west as negative');
        check(cards.every((t) => /iPhone 15 Pro/.test(t)), 'and the camera');
        const mapLink = await page.getAttribute('.privacy-facts a', 'href');
        check(/openstreetmap\.org\/\?mlat=51\.5007&mlon=-0\.1246/.test(mapLink ?? ''), 'the location links to a map', mapLink);

        // ---- Clean ----
        console.log('\nWhat comes out');
        await page.click('#cleanBtn');
        await page.waitForFunction((n) => document.querySelectorAll('#resultList a[download]').length === n, inputs.length, { timeout: 60000 });
        const outputs = await page.$$eval('#resultList a[download]', (links) => links.map((a) => ({ href: a.href, name: a.download })));
        const saved = {};
        for (const { href, name } of outputs) {
            const bytes = await page.evaluate(async (url) => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), href);
            const out = path.join(dir, `clean-${name}`);
            fs.writeFileSync(out, Buffer.from(bytes));
            saved[name] = out;
        }

        for (const input of inputs) {
            const base = path.basename(input);
            const isHeic = base.endsWith('.heic');
            const name = isHeic ? base.replace(/\.heic$/, '.jpg') : base;
            const out = saved[name];
            check(Boolean(out), `${base} produced ${name}`);
            if (!out) continue;

            const left = identifying(exif(out));
            check(left.length === 0, `${name}: exiftool finds no location, camera, serial or artist`, left.join(', '));
            if (isHeic) {
                check(fs.readFileSync(out).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), `${name} is a JPEG`);
                const tags = exif(out);
                check(tags['File:ImageWidth'] === 320 && tags['File:ImageHeight'] === 240, `${name} keeps the size`,
                    `${tags['File:ImageWidth']}x${tags['File:ImageHeight']}`);
            } else {
                check(pixelHash(out) === pixelHash(input), `${name}: pixels decode identically (not recompressed)`);
                check(fs.statSync(out).size < fs.statSync(input).size, `${name} is smaller`);
            }
        }
        if (withIcc) {
            const desc = exif(saved['holiday.jpg'])['ICC_Profile:ProfileDescription'];
            check(desc === 'Display P3', 'the JPEG kept its Display P3 colour profile', desc);
        }

        check(await page.isVisible('#downloadAllBtn'), 'several results offer Download all');
        check(errors.length === 0, 'no console errors overall', errors.join(' | '));
    } finally {
        await browser.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log(failures === 0 ? '\nAll photo privacy checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
