#!/usr/bin/env node
/**
 * Drive the YouTube and Instagram pages in a real browser, against the local
 * Flask backend, without touching YouTube or Instagram.
 *
 * Deliberately NOT part of `npm test`: it needs a browser, the dev server and
 * the backend. Every request here is refused by our own API before it could
 * reach upstream, so the checks are about how the pages handle answers:
 *   - an error that echoes a URL carrying markup must not run it;
 *   - a platform error that is plain text must read as a sentence, not JSON noise;
 *   - the help link appears once.
 *
 *   npm run dev          # in one terminal
 *   npm run dev:api      # in another
 *   npm run verify:downloaders
 */

import { chromium } from 'playwright';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

async function submit(page, input, url) {
    await page.fill(input, url);
    await page.click('#fetchBtn');
    await page.waitForSelector('#errorMsg.active', { timeout: 30000 });
    return (await page.textContent('#errorText')).trim();
}

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    try {
        console.log('\nYouTube');
        await page.goto(`${BASE}/youtube-downloader/`, { waitUntil: 'networkidle' });
        check(errors.length === 0, 'loads as a module with no errors', errors.join(' | '));

        // The server refuses this, and the old page put its reply through
        // innerHTML, which echoed the URL back.
        const xss = 'https://youtube.com/watch?v=<img src=x onerror="window.__xss=1">';
        const message = await submit(page, '#youtubeUrl', xss);
        check(!(await page.evaluate(() => window.__xss)), 'markup in the URL does not run', message);
        check(await page.locator('#errorText img').count() === 0, 'and is not inserted as an element');

        // A Vercel timeout arrives as plain text; response.json() used to throw
        // and the SyntaxError was shown verbatim.
        await page.route('**/api/youtube?**', (route) => route.fulfill({
            status: 504, contentType: 'text/plain', body: 'An error occurred with your deployment',
        }));
        const timeout = await submit(page, '#youtubeUrl', 'https://youtu.be/dQw4w9WgXcQ');
        check(/took too long/.test(timeout) && !/JSON|token/.test(timeout),
            'a plain-text 504 reads as a sentence', timeout);
        await page.unroute('**/api/youtube?**');

        console.log('\nInstagram');
        await page.goto(`${BASE}/instagram-downloader/`, { waitUntil: 'networkidle' });
        check(errors.length === 0, 'loads as a module with no errors', errors.join(' | '));
        await page.route('**/api/instagram?**', (route) => route.fulfill({
            status: 504, contentType: 'text/html', body: '<html><body>Gateway Timeout</body></html>',
        }));
        const igTimeout = await submit(page, '#instagramUrl', 'https://www.instagram.com/someone/p/ABC123/');
        check(/took too long/.test(igTimeout), 'a profile-scoped link is sent, and an HTML 504 reads as a sentence', igTimeout);
        check(await page.locator('#errorText a').count() === 1, 'the help link appears once');

        check(errors.length === 0, 'no page errors overall', errors.join(' | '));
    } finally {
        await browser.close();
    }

    console.log(failures === 0 ? '\nAll downloader checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
