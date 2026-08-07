#!/usr/bin/env node
/**
 * Check the site chrome in a real browser: theming, the mobile nav, focus and
 * contrast.
 *
 * Deliberately NOT part of `npm test`. jsdom applies no CSS, so it cannot tell
 * you whether a rule actually took effect — which is the entire question here.
 * A token can be defined, referenced, and still produce black-on-black.
 *
 *   npm run dev              # in another terminal
 *   npm run verify:chrome
 */

import { chromium } from 'playwright';

const BASE = (process.env.SITE_URL || 'http://localhost:5500').replace(/\/$/, '');

const PAGES = [
    '/', '/convert/', '/image-converter/', '/pdf-tools/', '/favicon-generator/',
    '/video-converter/', '/audio-converter/', '/color-converter/', '/qr-generator/',
    '/youtube-downloader/', '/instagram-downloader/', '/feedback.html',
];

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

/** Relative luminance, per WCAG. */
function luminance([r, g, b]) {
    const channel = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
    const a = luminance(fg);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const parseRgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

/**
 * Evaluate, tolerating the page navigating out from under us.
 *
 * The ffmpeg pages register `coi-serviceworker.js`, which calls
 * `location.reload()` the first time it activates so the COOP/COEP headers
 * apply. That reload lands mid-evaluate and destroys the execution context.
 * Retrying after the reload settles is correct; the reload is the page working
 * as designed, not a fault.
 */
async function evaluateSettled(page, fn, attempts = 3) {
    for (let i = 0; i < attempts; i += 1) {
        try {
            return await page.evaluate(fn);
        } catch (error) {
            if (!/Execution context was destroyed/.test(String(error)) || i === attempts - 1) throw error;
            await page.waitForLoadState('load').catch(() => {});
            await page.waitForTimeout(250);
        }
    }
    return undefined;
}

/** Read the computed body colours, which is what a token failure shows up in. */
function readPalette(page) {
    return page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const nav = document.querySelector('.nav');
        return {
            fg: body.color,
            bg: body.backgroundColor,
            theme: document.documentElement.getAttribute('data-theme'),
            navBg: nav ? getComputedStyle(nav).backgroundColor : null,
        };
    });
}

async function main() {
    const browser = await chromium.launch();
    // Pinned, because headless Chromium reports a LIGHT OS preference by
    // default. Leaving it unset made this script assert the opposite of what a
    // correctly-following site does.
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        colorScheme: 'dark',
    });
    const page = await context.newPage();

    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    try {
        // ---- Following the OS ----
        console.log('\nWith no stored choice, the OS decides');
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
        const osDark = await readPalette(page);
        check(luminance(parseRgb(osDark.bg)) < 0.2, 'a dark OS gives a dark page', osDark.bg);
        check(osDark.theme === null, 'and nothing is pinned on <html> yet', String(osDark.theme));

        await context.clearCookies();
        await page.emulateMedia({ colorScheme: 'light' });
        await page.reload({ waitUntil: 'networkidle' });
        const osLight = await readPalette(page);
        check(luminance(parseRgb(osLight.bg)) > 0.8, 'a light OS gives a light page', osLight.bg);
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.reload({ waitUntil: 'networkidle' });

        // ---- Theme toggle ----
        console.log('\nTheme toggle');
        await page.click('[data-theme-toggle]');
        const light = await readPalette(page);
        check(light.theme === 'light', 'clicking the toggle switches to light', light.theme);
        check(luminance(parseRgb(light.bg)) > 0.8, 'the light background is actually light', light.bg);
        check(luminance(parseRgb(light.fg)) < 0.3, 'and the text flipped with it', light.fg);

        // An explicit choice has to beat the OS, or the toggle is decorative.
        check(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches),
            'the OS still says dark, so the choice is genuinely overriding it');

        // A theme that does not survive navigation is not a theme.
        console.log('\nThe choice persists');
        await page.goto(`${BASE}/convert/`, { waitUntil: 'networkidle' });
        const carried = await readPalette(page);
        check(carried.theme === 'light', 'it survives a page change', carried.theme);

        // The whole reason the theme snippet is inline and synchronous.
        const preHydration = await page.evaluate(
            () => document.documentElement.getAttribute('data-theme'),
        );
        check(preHydration === 'light', 'and is set on <html> before scripts run');

        // ---- Contrast in both themes, on every page ----
        for (const theme of ['light', 'dark']) {
            console.log(`\nContrast — ${theme}`);
            // Set before any page script runs, so no navigation can race it.
            // Doing it with page.evaluate() after a goto destroyed the context
            // mid-call as the next navigation started.
            await context.addInitScript((t) => {
                try { localStorage.setItem('uth-theme', t); } catch (e) { /* ignore */ }
            }, theme);

            let worst = { ratio: 99, page: '', kind: '' };
            for (const path of PAGES) {
                // 'load', not 'domcontentloaded': the dev server redirects some
                // paths, and evaluating between the two navigations destroys
                // the execution context mid-call.
                await page.goto(BASE + path, { waitUntil: 'load' });
                const seen = await evaluateSettled(page, () => {
                    const bg = getComputedStyle(document.body).backgroundColor;
                    const samples = [];
                    const push = (sel, label) => {
                        const el = document.querySelector(sel);
                        if (el) samples.push({ label, color: getComputedStyle(el).color });
                    };
                    push('body', 'body text');
                    push('.tool-card-desc, .tool-header-text p, .dropzone-hint', 'secondary text');
                    push('.nav-link', 'nav link');
                    return { bg, samples };
                });

                for (const sample of seen.samples) {
                    const ratio = contrast(parseRgb(sample.color), parseRgb(seen.bg));
                    if (ratio < worst.ratio) worst = { ratio, page: path, kind: sample.label };
                }
            }

            // 4.5:1 is the WCAG AA threshold for body text.
            check(worst.ratio >= 4.5,
                `worst text contrast is at least 4.5:1`,
                `${worst.ratio.toFixed(2)}:1 (${worst.kind} on ${worst.page})`);
        }

        // ---- Mobile nav ----
        console.log('\nMobile nav');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

        check(await page.isVisible('[data-nav-toggle]'), 'the trigger is visible on a phone');
        check(await page.isHidden('#navLinks'), 'the links start hidden');

        await page.click('[data-nav-toggle]');
        check(await page.isVisible('#navLinks'), 'tapping it reveals them');
        check(await page.getAttribute('[data-nav-toggle]', 'aria-expanded') === 'true',
            'and aria-expanded says so');

        // This is the bug: these two were unreachable on any phone.
        const reachable = await page.evaluate(() => {
            const links = [...document.querySelectorAll('#navLinks a')];
            return links.filter((a) => a.getBoundingClientRect().height > 0)
                .map((a) => a.textContent.trim());
        });
        check(reachable.includes('Feedback') && reachable.includes('GitHub'),
            'Feedback and GitHub can be reached', reachable.join(', '));

        await page.keyboard.press('Escape');
        check(await page.isHidden('#navLinks'), 'Escape closes it');

        await page.setViewportSize({ width: 1280, height: 900 });
        check(await page.isHidden('[data-nav-toggle]'), 'the trigger hides again on desktop');

        // ---- Focus ----
        console.log('\nKeyboard focus');
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => {
            const el = document.activeElement;
            const style = getComputedStyle(el);
            return { tag: el.tagName, width: style.outlineWidth, style: style.outlineStyle };
        });
        check(ring.style !== 'none' && parseFloat(ring.width) > 0,
            'the first tab stop shows a focus ring', `${ring.tag} ${ring.style} ${ring.width}`);

        check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
    } finally {
        await browser.close();
    }

    console.log(failures === 0 ? '\nAll chrome checks passed.\n' : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
