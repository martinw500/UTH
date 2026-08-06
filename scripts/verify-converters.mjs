#!/usr/bin/env node
/**
 * Drive the ffmpeg.wasm converters in a real browser and check the output.
 *
 * Deliberately NOT part of `npm test`: it needs a browser, a running dev server
 * and the network, and `npm test` gates the Vercel deploy. Run it by hand after
 * touching js/shared/ffmpeg.js or either converter page.
 *
 * It exists because the whole failure class here is invisible to jsdom. Two
 * real bugs shipped to production undetected by 500+ green unit tests:
 *   - coi-serviceworker.js contained `import.meta`, a parse error in a classic
 *     worker, so cross-origin isolation never turned on outside Vercel;
 *   - the UMD ffmpeg core was passed to a module worker, which cannot
 *     importScripts, so loading failed with "failed to import ffmpeg-core.js".
 * Both only show up when something actually converts a file.
 *
 *   npm run dev                 # in another terminal
 *   npm run verify:converters
 */

import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'uth-verify-'));
const SOURCE_SECONDS = 6;

// format -> what ffprobe must report back
const CASES = [
    { fmt: 'mp4', codecs: ['h264', 'aac'], width: 640, height: 360 },
    { fmt: 'webm', codecs: ['vp8', 'vorbis'], width: 640, height: 360 },
    { fmt: 'gif', codecs: ['gif'], width: 480 },
    { fmt: 'mp3', codecs: ['mp3'] },
    { fmt: 'wav', codecs: ['pcm_s16le'] },
];

async function makeSample() {
    const out = path.join(WORK, 'sample.mp4');
    await run('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', `testsrc=duration=${SOURCE_SECONDS}:size=640x360:rate=25`,
        '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SOURCE_SECONDS}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        out,
    ]);
    return out;
}

async function probe(file) {
    const { stdout } = await run('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-show_entries', 'stream=codec_name,width,height',
        '-of', 'json', file,
    ]);
    const data = JSON.parse(stdout);
    return {
        duration: Number(data.format.duration),
        codecs: data.streams.map(s => s.codec_name),
        width: data.streams.find(s => s.width)?.width,
        height: data.streams.find(s => s.height)?.height,
    };
}

const failures = [];

function check(label, condition, detail) {
    if (!condition) failures.push(`${label}: ${detail}`);
    return condition;
}

const sample = await makeSample();
console.log(`sample: ${sample}`);
console.log(`target: ${BASE}/video-converter/\n`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => failures.push(`page error: ${e.message}`));

await page.goto(`${BASE}/video-converter/`);
// The COI service worker reloads the page once it controls it. Without this the
// converter cannot start at all, which is exactly the bug that shipped.
try {
    await page.waitForFunction(() => window.crossOriginIsolated === true, { timeout: 25000 });
    console.log('cross-origin isolated: yes\n');
} catch {
    failures.push('page never became cross-origin isolated (SharedArrayBuffer unavailable)');
}

for (const { fmt, codecs, width, height } of CASES) {
    process.stdout.write(`${fmt.padEnd(5)} `);
    await page.setInputFiles('#fileInput', sample);
    await page.waitForSelector('#editorWorkspace', { state: 'visible' });
    await page.selectOption('#outputFormat', fmt);
    await page.click('#convertBtn');

    try {
        await page.waitForSelector('#results', { state: 'visible', timeout: 180000 });
    } catch {
        const message = await page.textContent('#errorText').catch(() => 'no #results and no error shown');
        console.log(`FAILED — ${message}`);
        failures.push(`${fmt}: ${message}`);
        await page.click('#clearFileBtn');
        continue;
    }

    const href = await page.getAttribute('#downloadBtn', 'href');
    const name = await page.getAttribute('#downloadBtn', 'download');
    const bytes = await page.evaluate(async (u) => {
        const buf = await (await fetch(u)).arrayBuffer();
        return Array.from(new Uint8Array(buf));
    }, href);

    const outPath = path.join(WORK, name);
    fs.writeFileSync(outPath, Buffer.from(bytes));

    const info = await probe(outPath);
    const ok = [
        check(fmt, Math.abs(info.duration - SOURCE_SECONDS) < 0.5,
            `duration ${info.duration}s, expected ~${SOURCE_SECONDS}s`),
        ...codecs.map(c => check(fmt, info.codecs.includes(c),
            `missing codec ${c} (got ${info.codecs.join(', ')})`)),
        width === undefined || check(fmt, info.width === width, `width ${info.width}, expected ${width}`),
        height === undefined || check(fmt, info.height === height, `height ${info.height}, expected ${height}`),
    ].every(Boolean);

    console.log(`${ok ? 'ok  ' : 'BAD '} ${(bytes.length / 1024).toFixed(0).padStart(5)} KB  `
        + `${info.duration.toFixed(2)}s  ${info.codecs.join('+')}`
        + `${info.width ? `  ${info.width}x${info.height}` : ''}`);

    await page.click('#clearFileBtn');
}

await browser.close();

console.log();
if (failures.length) {
    console.error(`FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log(`All ${CASES.length} conversions produced correct media.`);
fs.rmSync(WORK, { recursive: true, force: true });
