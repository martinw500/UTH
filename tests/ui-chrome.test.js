// ============================================
// Site chrome: theming, navigation, focus, labels
//
// These are the things that are invisible until someone uses a keyboard, a
// phone, or a light-mode OS — which is exactly why they need pinning.
// ============================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const PAGES = fs.readdirSync(ROOT, { withFileTypes: true })
    .flatMap((entry) => {
        if (entry.isFile() && entry.name.endsWith('.html')) return [entry.name];
        if (!entry.isDirectory()) return [];
        if (['node_modules', '.git', 'coverage', 'js', 'api', 'tests', 'scripts', 'docs'].includes(entry.name)) return [];
        return fs.readdirSync(path.join(ROOT, entry.name))
            .filter((f) => f.endsWith('.html'))
            .map((f) => `${entry.name}/${f}`);
    });

/** Pages carrying the standard nav. The Instagram help page has its own shell. */
const NAV_PAGES = PAGES.filter((p) => read(p).includes('class="nav-inner"'));

describe('the page set under test is real', () => {
    test('every tool page was found', () => {
        expect(PAGES.length).toBeGreaterThanOrEqual(12);
        expect(PAGES).toContain('index.html');
        expect(PAGES).toContain('convert/index.html');
    });
});

// ============================================
// Theming
// ============================================

describe('theme', () => {
    const css = read('styles.css');

    test('a light theme exists', () => {
        expect(css).toMatch(/:root\[data-theme="light"\]/);
    });

    test('it follows the OS until the user chooses', () => {
        expect(css).toMatch(/@media \(prefers-color-scheme: light\)/);
        // :not([data-theme]) is what makes an explicit choice win over the OS.
        expect(css).toMatch(/:root:not\(\[data-theme\]\)/);
    });

    test('color-scheme is declared, so form controls and scrollbars follow', () => {
        expect(css).toMatch(/color-scheme:\s*dark/);
        expect(css).toMatch(/color-scheme:\s*light/);
    });

    // Hues live as bare channels so a tint can be written
    // rgb(var(--primary-rgb) / 0.08) and still follow the theme.
    test('hues are stored as channels, not colours', () => {
        for (const name of ['primary', 'accent', 'success', 'error', 'warning']) {
            expect(css).toMatch(new RegExp(`--${name}-rgb:\\s*\\d+ \\d+ \\d+`));
        }
    });

    // Forty-odd of these are why light mode was impossible before.
    test('no rule hardcodes a brand hue as rgba()', () => {
        const body = css.slice(css.indexOf('html {'));
        const offenders = [...body.matchAll(/rgba\(\s*(99|34|239|245|6)\s*,/g)].map((m) => m[0]);
        expect(offenders).toEqual([]);
    });

    test.each(NAV_PAGES)('%s applies the stored theme before first paint', (page) => {
        const html = read(page);
        const head = html.slice(0, html.indexOf('</head>'));
        expect(head).toContain("localStorage.getItem('uth-theme')");
        expect(head).toContain('data-theme');
    });

    // An external script — even without defer — can paint before it arrives,
    // and the page would flash the wrong theme.
    test.each(NAV_PAGES)('%s does that inline, not from a file', (page) => {
        const html = read(page);
        const head = html.slice(0, html.indexOf('</head>'));
        const block = head.split('<script').find((c) => c.includes('uth-theme'));
        expect(block).toBeDefined();
        expect(block.slice(0, block.indexOf('>'))).not.toContain('src=');
        expect(block.slice(0, block.indexOf('>'))).not.toContain('type="module"');
    });

    test.each(NAV_PAGES)('%s loads the toggle script and has a toggle', (page) => {
        const html = read(page);
        expect(html).toMatch(/<script src="(\.\.\/)?js\/site\.js" defer><\/script>/);
        expect(html).toContain('data-theme-toggle');
    });
});

// ============================================
// Navigation
// ============================================

describe('mobile navigation', () => {
    const css = read('styles.css');

    // .nav-links was display:none below 768px with nothing to reveal it, so
    // Feedback and GitHub could not be reached on a phone at all.
    test('the links are reachable below the breakpoint', () => {
        const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
        expect(mobile).toMatch(/\.nav-links\.open/);
        expect(mobile).toMatch(/\.nav-toggle\s*\{[^}]*display:\s*grid/);
    });

    test.each(NAV_PAGES)('%s has a trigger wired to the list', (page) => {
        const html = read(page);
        expect(html).toContain('data-nav-toggle');
        expect(html).toContain('id="navLinks"');
        expect(html).toMatch(/aria-controls="navLinks"/);
        expect(html).toMatch(/aria-expanded="false"/);
    });
});

// ============================================
// Focus and motion
// ============================================

describe('keyboard and motion', () => {
    const css = read('styles.css');

    test('focus is visible', () => {
        expect(css).toMatch(/:focus-visible/);
        expect(css).toMatch(/outline:\s*2px solid/);
    });

    test('motion can be turned down', () => {
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    });

    // 0s would stop transitionend/animationend firing, and some cleanup
    // handlers wait on those.
    test('reduced motion shortens animations rather than removing them', () => {
        const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
        expect(block).toMatch(/animation-duration:\s*1ms/);
        expect(block).toMatch(/transition-duration:\s*1ms/);
        expect(block).not.toMatch(/animation-duration:\s*0s/);
    });
});

// ============================================
// Labels
// ============================================

describe('form labels', () => {
    // A <label> with neither `for` nor a nested control announces as an orphan,
    // which is worse than no label at all.
    test.each(PAGES)('%s has no orphan labels', (page) => {
        const html = read(page);
        const orphans = [];
        for (const match of html.matchAll(/<label([^>]*)>([\s\S]*?)<\/label>/g)) {
            const attrs = match[1];
            const inner = match[2];
            const hasFor = /\bfor=/.test(attrs);
            const wrapsControl = /<(input|select|textarea)\b/.test(inner);
            if (!hasFor && !wrapsControl) orphans.push(inner.trim().slice(0, 40));
        }
        expect(orphans).toEqual([]);
    });

    test.each(PAGES)('%s points every for= at an id that exists', (page) => {
        const html = read(page);
        const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
        const dangling = [...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((target) => !ids.has(target));
        expect(dangling).toEqual([]);
    });
});

// ============================================
// Tone classes
// ============================================

describe('tool accent tones', () => {
    // These were inline `style="color: #f87171"`, which light mode could not
    // reach — a pale tone that works on near-black is invisible on white.
    test('no icon carries an inline colour any more', () => {
        for (const page of PAGES) {
            expect(read(page)).not.toMatch(/tool-(card|header)-icon[^"]*"\s+style=/);
        }
    });

    test('every tone class used is defined in the stylesheet', () => {
        const css = read('styles.css');
        const used = new Set();
        for (const page of PAGES) {
            for (const m of read(page).matchAll(/class="[^"]*\b(tone-[a-z]+)\b/g)) used.add(m[1]);
        }
        expect(used.size).toBeGreaterThan(0);
        for (const tone of used) expect(css).toContain(`.${tone}`);
    });
});
