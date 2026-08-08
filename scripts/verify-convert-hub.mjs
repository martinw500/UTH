#!/usr/bin/env node
/**
 * Drive the converter hub in a real browser and check what comes out.
 *
 * Deliberately NOT part of `npm test`: it needs a browser, a running dev server
 * and the network, and `npm test` gates the Vercel deploy.
 *
 * The hub's whole design claim is that routing is data — so the things worth
 * checking here are the ones the registry cannot prove on its own: that the
 * page really detects the kind of a dropped file, that it offers only reachable
 * targets, that the option panel it renders matches the format chosen, and that
 * an image conversion does not drag ffmpeg down the wire.
 *
 *   npm run dev                  # in another terminal
 *   npm run verify:convert-hub
 */

import { chromium } from 'playwright';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');
const PAGE = `${BASE}/convert/`;

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

const MAKE_PNG = `(w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(255,0,0,1)';
    x.fillRect(w / 2, 0, w / 2, h);
    return new Promise((res) => c.toBlob((b) => {
        const r = new FileReader();
        r.onload = () => res(Array.from(new Uint8Array(r.result)));
        r.readAsArrayBuffer(b);
    }, 'image/png'));
}`;

async function dropPng(page, { width = 400, height = 200, name = 'fixture.png' } = {}) {
    const bytes = await page.evaluate(`(${MAKE_PNG})(${width}, ${height})`);
    await page.setInputFiles('#fileInput', {
        name, mimeType: 'image/png', buffer: Buffer.from(bytes),
    });
    await page.waitForSelector('#workspace:not([hidden])', { timeout: 10000 });
}

const optionIds = (page) => page.$$eval(
    '#optionsPanel [id^="opt-"]', (nodes) => nodes.map((n) => n.id).sort(),
);

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    // Every network request, so we can prove ffmpeg is not fetched for images.
    const requested = [];
    page.on('request', (r) => requested.push(r.url()));

    try {
        await page.goto(PAGE, { waitUntil: 'networkidle' });
        console.log('\nPage');
        check(errors.length === 0, 'no console errors on load', errors.join(' | '));
        check(await page.isVisible('#dropzone'), 'dropzone is visible');
        check(await page.isHidden('#workspace'), 'workspace is hidden until a file arrives');

        console.log('\nDetection and routing');
        await dropPng(page);
        const imageTargets = await page.$$eval('#targetFormat option', (o) => o.map((n) => n.value));
        check(imageTargets.includes('webp') && imageTargets.includes('png'),
            'an image offers image formats', imageTargets.join(','));
        check(!imageTargets.some((v) => ['mp4', 'mp3', 'webm'].includes(v)),
            'an image does not offer media formats', imageTargets.join(','));
        check(await page.inputValue('#targetFormat') === 'webp',
            'the default image target is WebP');

        console.log('\nOptions are rendered from the registry');
        check((await optionIds(page)).includes('opt-quality'), 'WebP offers quality');

        await page.selectOption('#targetFormat', 'png');
        let ids = await optionIds(page);
        check(!ids.includes('opt-quality'), 'PNG drops quality — it is lossless', ids.join(','));
        check(!ids.includes('opt-matte'), 'PNG drops the matte — it has alpha', ids.join(','));

        await page.selectOption('#targetFormat', 'jpg');
        ids = await optionIds(page);
        check(ids.includes('opt-quality'), 'JPEG offers quality');
        check(ids.includes('opt-matte'), 'JPEG offers a background — it has no alpha');

        // Rendered from the registry's `presets`, so this also proves the
        // declarative route works for something other than a plain control.
        console.log('\nTarget-size presets');
        await page.selectOption('#targetFormat', 'webp');
        const chips = page.locator('#optionsPanel .resize-presets .preset-btn');
        check(await chips.count() > 0, 'the size chips render', `${await chips.count()} chips`);

        const tenMb = page.locator('#optionsPanel .preset-btn', { hasText: '10 MB' });
        await tenMb.click();
        check(await page.inputValue('#opt-targetSize') === '10',
            'a chip fills in the size');
        check(await page.inputValue('#opt-targetSize-unit') === 'mb',
            'and switches the unit to match');
        check((await tenMb.getAttribute('class')).includes('is-active'),
            'and shows which one is in force');

        // A preset must not be a one-way door: there was no other way to get
        // back to "no target size" once one had been clicked.
        await tenMb.click();
        check(await page.inputValue('#opt-targetSize') === '',
            'clicking the active chip clears it again');
        check(!(await tenMb.getAttribute('class')).includes('is-active'),
            'and stops showing as active');

        // Typing by hand must light the matching chip, or the two controls
        // disagree about the same number.
        await page.fill('#opt-targetSize', '25');
        check((await page.locator('#optionsPanel .preset-btn', { hasText: '25 MB' })
            .getAttribute('class')).includes('is-active'),
            'typing a size lights the chip that matches');
        await page.fill('#opt-targetSize', '');

        console.log('\nConversion');
        await page.click('#convertBtn');
        await page.waitForSelector('#outputList .output-item a[download]', { timeout: 30000 });
        const href = await page.getAttribute('#outputList a[download]', 'href');
        const name = await page.getAttribute('#outputList a[download]', 'download');
        const bytes = Buffer.from(await page.evaluate(async (url) => {
            const b = await (await fetch(url)).arrayBuffer();
            return Array.from(new Uint8Array(b));
        }, href));
        check(name === 'fixture.webp', 'output is named for the target format', name);
        check(bytes.slice(0, 4).toString('latin1') === 'RIFF'
            && bytes.slice(8, 12).toString('latin1') === 'WEBP',
            'output really is a WebP', bytes.slice(0, 12).toString('latin1'));

        // The reason the engines are imported lazily at all.
        console.log('\nAn image conversion does not download ffmpeg');
        const ffmpegHits = requested.filter((u) => /ffmpeg-core|\.wasm/.test(u));
        check(ffmpegHits.length === 0, 'no ffmpeg core was fetched', ffmpegHits.join(' | '));

        console.log('\nBatch');
        await page.reload({ waitUntil: 'networkidle' });
        const many = await Promise.all([1, 2, 3].map(async (n) => ({
            name: `img${n}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from(await page.evaluate(`(${MAKE_PNG})(${60 * n}, ${40 * n})`)),
        })));
        await page.setInputFiles('#fileInput', many);
        await page.waitForSelector('#workspace:not([hidden])');
        check(await page.locator('#fileList .file-item').count() === 3, 'three files queued');
        await page.click('#convertBtn');
        await page.waitForSelector('#downloadAllBtn:not([hidden])', { timeout: 30000 });
        check(await page.locator('#outputList .output-item').count() === 3, 'three results');

        // Mixed kinds have no single sensible target list.
        console.log('\nMixed input kinds are reported, not silently dropped');
        await page.reload({ waitUntil: 'networkidle' });
        await dropPng(page);
        await page.setInputFiles('#fileInput', [{
            name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello'),
        }]);
        await page.waitForSelector('#notice.active', { timeout: 5000 });
        const notice = await page.textContent('#notice');
        check(/not a supported|unrecognised|skipped/i.test(notice) && notice.includes('notes.txt'),
            'the skipped file is named in the notice', notice.trim());

        // Proves the media engine is reached and ffmpeg actually runs. Slow --
        // it downloads the ~32 MB core -- so it is last and skippable.
        if (!process.env.SKIP_MEDIA) {
            console.log('\nMedia engine (downloads ffmpeg, slow)');
            await page.reload({ waitUntil: 'networkidle' });
            check(await page.evaluate(() => window.crossOriginIsolated) === true,
                'the page is cross-origin isolated, so SharedArrayBuffer works');

            const webm = await page.evaluate(async () => {
                const c = document.createElement('canvas');
                c.width = 320; c.height = 240;
                const x = c.getContext('2d');
                const rec = new MediaRecorder(c.captureStream(10), { mimeType: 'video/webm' });
                const chunks = [];
                rec.ondataavailable = (e) => chunks.push(e.data);
                rec.start();
                for (let i = 0; i < 20; i += 1) {
                    x.fillStyle = `hsl(${i * 18},80%,50%)`;
                    x.fillRect(0, 0, 320, 240);
                    await new Promise((r) => setTimeout(r, 50));
                }
                rec.stop();
                await new Promise((r) => { rec.onstop = r; });
                return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
            });

            await page.setInputFiles('#fileInput', {
                name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(webm),
            });
            await page.waitForSelector('#workspace:not([hidden])');

            const videoTargets = await page.$$eval('#targetFormat option', (o) => o.map((n) => n.value));
            check(videoTargets.includes('mp4') && videoTargets.includes('mp3'),
                'a video offers both video and audio targets', videoTargets.join(','));

            await page.selectOption('#targetFormat', 'mp4');
            await page.click('#convertBtn');
            await page.waitForSelector('#outputList .output-item a[download]', { timeout: 240000 });
            const mp4 = await page.evaluate(async (url) => {
                const a = new Uint8Array(await (await fetch(url)).arrayBuffer());
                return { len: a.length, tag: String.fromCharCode(...a.slice(4, 8)) };
            }, await page.getAttribute('#outputList a[download]', 'href'));
            // 'ftyp' is the MP4 box type; a renamed WebM would not have it.
            check(mp4.tag === 'ftyp' && mp4.len > 0, 'the output really is an MP4',
                `${mp4.len} bytes, box=${mp4.tag}`);
        }

        check(errors.length === 0, 'no console errors overall', errors.join(' | '));
    } finally {
        await browser.close();
    }

    console.log(failures === 0 ? '\nAll converter hub checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
