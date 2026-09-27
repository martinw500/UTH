#!/usr/bin/env node
/**
 * Drive Transcribe in a real browser on real speech: macOS `say` speaks a
 * known sentence, ffmpeg wraps it as M4A and inside an MP4 video, and the page
 * transcribes both. Checks the words, that SRT timings are well-formed and in
 * order, that Cancel leaves the page usable, and that a file the browser
 * cannot decode is sent to the converter with a sentence, not a stack trace.
 *
 * Needs the network (the model is ~77 MB from Hugging Face, the runtime from a
 * pinned CDN; see transcribe/js/worker.js), ffmpeg, and macOS for `say`.
 * Deliberately NOT part of `npm test`.
 *
 *   npm run dev                # in another terminal
 *   npm run verify:transcribe
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const PAGE = `${BASE}/transcribe/`;
const SPOKEN = 'The meeting is on Thursday at three o\'clock in room four. '
    + 'Please bring the signed contract and your laptop.';
const KEY_WORDS = ['meeting', 'thursday', 'room', 'contract', 'laptop'];

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

const srtTime = (t) => {
    const [h, m, rest] = t.split(':');
    const [s, ms] = rest.split(',');
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
};

async function transcribe(page, file) {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.setInputFiles('#fileInput', file);
    await page.waitForSelector('#workspace:not([hidden])');
    await page.selectOption('#asrLang', 'en');
    await page.click('#runBtn');
    await page.waitForSelector('#results:not([hidden]), #notice.active', { timeout: 600000 });
    return page.inputValue('#transcriptOutput');
}

async function download(page, button) {
    const [file] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
    return { name: file.suggestedFilename(), text: fs.readFileSync(await file.path(), 'utf8') };
}

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uth-asr-'));
    const aiff = path.join(dir, 'speech.aiff');
    const m4a = path.join(dir, 'memo.m4a');
    const mp4 = path.join(dir, 'clip.mp4');
    try {
        execFileSync('say', ['-o', aiff, SPOKEN]);
    } catch {
        console.error('This check needs macOS `say` to produce speech.');
        process.exit(1);
    }
    execFileSync('ffmpeg', ['-v', 'error', '-i', aiff, '-c:a', 'aac', m4a]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=10', '-i', aiff,
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    try {
        console.log('\nA voice memo (M4A)');
        const text = (await transcribe(page, m4a)).toLowerCase();
        const missing = KEY_WORDS.filter((w) => !text.includes(w));
        check(!missing.length, 'the key words come back', missing.length ? `missing: ${missing.join(', ')}` : text.trim());

        const srt = await download(page, '#downloadSrtBtn');
        check(srt.name === 'memo.srt', 'the .srt is named after the recording', srt.name);
        const times = [...srt.text.matchAll(/^(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})$/gm)]
            .map((m) => [srtTime(m[1]), srtTime(m[2])]);
        check(times.length > 0, 'the .srt has cues', `${times.length}`);
        check(times.every(([s, e], i) => e > s && (i === 0 || s >= times[i - 1][0])),
            'every cue ends after it starts, and they run in order');
        const vtt = await download(page, '#downloadVttBtn');
        check(vtt.text.startsWith('WEBVTT\n\n'), 'the .vtt carries the header players require');

        await page.check('#withTimes');
        check(/^\[00:00\] /.test(await page.inputValue('#transcriptOutput')), 'timestamps can be shown');

        console.log('\nThe soundtrack of a video (MP4)');
        const fromVideo = (await transcribe(page, mp4)).toLowerCase();
        check(KEY_WORDS.every((w) => fromVideo.includes(w)), 'a video is transcribed from its audio');

        console.log('\nCancel');
        await page.goto(PAGE, { waitUntil: 'networkidle' });
        await page.setInputFiles('#fileInput', m4a);
        await page.click('#runBtn');
        await page.waitForSelector('#cancelBtn:not([hidden])');
        await page.click('#cancelBtn');
        await page.waitForFunction(() => !document.getElementById('runBtn').disabled);
        check(!(await page.isVisible('#notice.active')), 'cancelling is not reported as an error');
        await page.click('#runBtn');
        await page.waitForSelector('#results:not([hidden])', { timeout: 600000 });
        check((await page.inputValue('#transcriptOutput')).toLowerCase().includes('contract'),
            'and the next run works');

        console.log('\nA file the browser cannot decode');
        await page.goto(PAGE, { waitUntil: 'networkidle' });
        await page.setInputFiles('#fileInput', { name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(4096, 7) });
        await page.click('#runBtn');
        await page.waitForSelector('#notice.active', { timeout: 30000 });
        const notice = await page.textContent('#notice');
        check(/File Converter/.test(notice) && notice.includes('broken.mp3'), 'says so and points at the converter', notice.trim());

        const unexpected = errors.filter((e) => !/decode|EncodingError/i.test(e));
        check(unexpected.length === 0, 'no console errors overall', unexpected.join(' | '));
    } finally {
        await browser.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log(failures === 0 ? '\nAll transcribe checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
