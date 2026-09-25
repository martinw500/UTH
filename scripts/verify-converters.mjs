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
// Deliberately not a whole number: the trim fields show whole seconds, and an
// end of "00:00:06" used to cut the last 0.6 s off every untrimmed export.
const SOURCE_SECONDS = 6.6;

// format -> what ffprobe must report back
const VIDEO_CASES = [
    { fmt: 'mp4', codecs: ['h264', 'aac'], width: 640, height: 360 },
    { fmt: 'webm', codecs: ['vp8', 'vorbis'], width: 640, height: 360 },
    { fmt: 'gif', codecs: ['gif'], width: 480 },
    { fmt: 'mp3', codecs: ['mp3'] },
    { fmt: 'wav', codecs: ['pcm_s16le'] },
];

// Every codec here was confirmed present by running `ffmpeg -encoders` inside
// ffmpeg.wasm. ffprobe reports Opus in an Ogg container as "opus".
const AUDIO_CASES = [
    { fmt: 'mp3', codecs: ['mp3'] },
    { fmt: 'm4a', codecs: ['aac'] },
    { fmt: 'ogg', codecs: ['vorbis'] },
    { fmt: 'opus', codecs: ['opus'] },
    { fmt: 'wav', codecs: ['pcm_s16le'] },
    { fmt: 'flac', codecs: ['flac'] },
];

async function makeSample(name = 'sample.mp4', codecArgs = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']) {
    const out = path.join(WORK, name);
    await run('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', `testsrc=duration=${SOURCE_SECONDS}:size=640x360:rate=25`,
        '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SOURCE_SECONDS}`,
        ...codecArgs, '-shortest',
        out,
    ]);
    return out;
}

/** Audio only, in a container Chrome cannot play, so no duration ever loads. */
async function makeAiff() {
    const out = path.join(WORK, 'sample.aiff');
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SOURCE_SECONDS}`, out]);
    return out;
}

async function probe(file) {
    const { stdout } = await run('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-show_entries', 'stream=codec_name,width,height,sample_rate',
        '-of', 'json', file,
    ]);
    const data = JSON.parse(stdout);
    return {
        duration: Number(data.format.duration),
        codecs: data.streams.map(s => s.codec_name),
        width: data.streams.find(s => s.width)?.width,
        height: data.streams.find(s => s.height)?.height,
        sampleRate: Number(data.streams.find(s => s.sample_rate)?.sample_rate) || undefined,
    };
}

const failures = [];

function check(label, condition, detail) {
    if (!condition) failures.push(`${label}: ${detail}`);
    return condition;
}

async function runTool(page, toolPath, cases, {
    expectSeconds = SOURCE_SECONDS, extra = null, file = sample, sampleRate, notIdentical = false,
    reload = true,
} = {}) {
    console.log(`\n=== ${toolPath} ===`);
    // reload: false keeps the page as the previous run left it, which is the
    // only way to see state leaking from one file to the next.
    if (reload) {
        await page.goto(`${BASE}${toolPath}`);
        // The COI service worker reloads the page once it controls it. Without
        // this nothing can convert at all, which is exactly the bug that shipped.
        try {
            await page.waitForFunction(() => window.crossOriginIsolated === true, { timeout: 25000 });
            console.log('cross-origin isolated: yes\n');
        } catch {
            failures.push(`${toolPath}: never became cross-origin isolated (SharedArrayBuffer unavailable)`);
            return;
        }
    }

    for (const { fmt, codecs, width, height } of cases) {
        process.stdout.write(`${fmt.padEnd(5)} `);
        await page.setInputFiles('#fileInput', file);
        await page.waitForSelector('#editorWorkspace', { state: 'visible' });
        await page.selectOption('#outputFormat', fmt);
        if (extra) await extra(page);
        await page.click('#convertBtn');

        try {
            await page.waitForSelector('#results', { state: 'visible', timeout: 180000 });
        } catch {
            const message = await page.textContent('#errorText').catch(() => 'no #results and no error shown');
            console.log(`FAILED — ${message}`);
            failures.push(`${toolPath} ${fmt}: ${message}`);
            await page.click('#clearFileBtn');
            continue;
        }

        const href = await page.getAttribute('#downloadBtn', 'href');
        const name = await page.getAttribute('#downloadBtn', 'download');
        const bytes = await page.evaluate(async (u) => {
            const buf = await (await fetch(u)).arrayBuffer();
            return Array.from(new Uint8Array(buf));
        }, href);

        const outPath = path.join(WORK, `${toolPath.replace(/\W/g, '')}-${name}`);
        fs.writeFileSync(outPath, Buffer.from(bytes));

        const info = await probe(outPath);
        const label = `${toolPath} ${fmt}`;
        const ok = [
            check(label, Math.abs(info.duration - expectSeconds) < 0.25,
                `duration ${info.duration}s, expected ~${expectSeconds}s`),
            ...codecs.map(c => check(label, info.codecs.includes(c),
                `missing codec ${c} (got ${info.codecs.join(', ')})`)),
            width === undefined || check(label, info.width === width, `width ${info.width}, expected ${width}`),
            height === undefined || check(label, info.height === height, `height ${info.height}, expected ${height}`),
            sampleRate === undefined || check(label, info.sampleRate === sampleRate,
                `sample rate ${info.sampleRate}, expected ${sampleRate}`),
            !notIdentical || check(label, !fs.readFileSync(file).equals(Buffer.from(bytes)),
                'the output is byte-for-byte the input'),
        ].every(Boolean);

        console.log(`${ok ? 'ok  ' : 'BAD '} ${(bytes.length / 1024).toFixed(0).padStart(5)} KB  `
            + `${info.duration.toFixed(2)}s  ${info.codecs.join('+')}`
            + `${info.width ? `  ${info.width}x${info.height}` : ''}`);

        await page.click('#clearFileBtn');
    }
}

const sample = await makeSample();
console.log(`sample: ${sample}`);
console.log(`target: ${BASE}`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => failures.push(`page error: ${e.message}`));

await runTool(page, '/video-converter/', VIDEO_CASES);
await runTool(page, '/audio-converter/', AUDIO_CASES);

// Trimming is where the -t vs -to distinction bites: get it wrong and the clip
// silently comes out the wrong length, which no structural check would notice.
console.log('\n=== /audio-converter/ trim 1.0s -> 3.5s ===');
await runTool(page, '/audio-converter/', [{ fmt: 'mp3', codecs: ['mp3'] }], {
    expectSeconds: 2.5,
    extra: async (p) => {
        await p.fill('#trimStart', '00:00:01');
        await p.fill('#trimEnd', '00:00:03.5');
    },
});

// ffmpeg's virtual input was "input.mp4", so a file called input.mp4 converted
// to MP4 got an output name equal to the input: ffmpeg refused, and the
// untouched original came back as the "converted" file.
console.log('\n=== /video-converter/ a file named input.mp4 ===');
await runTool(page, '/video-converter/', [{ fmt: 'mp4', codecs: ['h264'] }], {
    file: await makeSample('input.mp4'), notIdentical: true,
});

// A new file used to inherit the last file's trim start. The AVI matters: Chrome
// cannot preview it, so nothing else overwrites the stale value.
console.log('\n=== /video-converter/ trim start does not leak to the next file ===');
await runTool(page, '/video-converter/', [{ fmt: 'mp4', codecs: ['h264'] }], {
    expectSeconds: SOURCE_SECONDS - 2,
    extra: (p) => p.fill('#trimStart', '00:00:02'),
});
await runTool(page, '/video-converter/', [{ fmt: 'mp4', codecs: ['h264'] }], {
    file: await makeSample('sample.avi', ['-c:v', 'mpeg4', '-c:a', 'mp3']),
    reload: false,
});

// The browser cannot play AIFF, so both trim fields stayed at 00:00:00 and the
// converter refused: "the trim end must come after the trim start".
console.log('\n=== /audio-converter/ a file the browser cannot play ===');
await runTool(page, '/audio-converter/', [{ fmt: 'mp3', codecs: ['mp3'] }], { file: await makeAiff() });

// loudnorm outputs 192 kHz unless told otherwise, and WAV accepts it.
console.log('\n=== /audio-converter/ normalise keeps a sane sample rate ===');
await runTool(page, '/audio-converter/', [{ fmt: 'wav', codecs: ['pcm_s16le'] }], {
    sampleRate: 48000,
    extra: (p) => p.check('#normaliseCheck'),
});

await browser.close();

console.log();
if (failures.length) {
    console.error(`FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log(`All ${VIDEO_CASES.length + AUDIO_CASES.length + 6} conversions produced correct media.`);
fs.rmSync(WORK, { recursive: true, force: true });
