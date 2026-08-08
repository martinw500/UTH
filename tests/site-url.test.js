// js/shared/site-url.js
//
// The whole point of this module is the difference between the two deploys, so
// every test runs the same page at both `/` (Vercel) and `/UTH/` (GitHub
// Pages). The resolution reads `.src`/`.href`, which only the browser's own
// base-URL resolution fills in, so each case needs a document at a real URL.
//
// A `<base href>` sets that, rather than `new JSDOM(html, { url })`: jsdom 28
// cannot be require()d from inside the jsdom test environment, because a
// transitive dependency ships ESM that Jest does not transform under
// node_modules. `<base>` is the documented way to set a document base URL and
// needs nothing extra.

const { siteRoot, siteUrl, _reset } = require('../js/shared/site-url.js');

const SITE_SCRIPT = '<script src="{P}js/site.js" defer></script>';
const STYLESHEET = '<link rel="stylesheet" href="{P}styles.css">';

/**
 * A page served from `root` at repo-relative `page`.
 *
 * The two are separate arguments because the depth cannot be read back off a
 * URL: `/UTH/index.html` is a root page under a base path and writes
 * `js/site.js`, while `/convert/index.html` is one level down and writes
 * `../js/site.js`. Telling them apart is the entire job of this module, so the
 * fixture must not try to guess it either.
 */
function pageAt(root, page = 'index.html', parts = [SITE_SCRIPT, STYLESHEET]) {
    const prefix = page.includes('/') ? '../' : '';
    const doc = document.implementation.createHTMLDocument('');
    const base = doc.createElement('base');
    base.setAttribute('href', root + page);
    doc.head.append(base);
    doc.head.insertAdjacentHTML('beforeend', parts.map((p) => p.replace(/\{P\}/g, prefix)).join('\n'));
    return doc;
}

const VERCEL = 'https://useful-tool-hub.vercel.app/';
const PAGES = 'https://martinw500.github.io/UTH/';

beforeEach(() => _reset());

describe('siteRoot', () => {
    test('finds the root from a page at the root', () => {
        expect(siteRoot(pageAt(VERCEL, 'index.html'))).toBe(VERCEL);
    });

    test('finds the root from a tool page one level down', () => {
        expect(siteRoot(pageAt(VERCEL, 'convert/index.html'))).toBe(VERCEL);
    });

    // The reason this module exists. Pages serves the whole site from /UTH/,
    // so the root is not the origin and cannot be assumed to be.
    test('keeps the /UTH/ prefix on GitHub Pages', () => {
        expect(siteRoot(pageAt(PAGES, 'index.html'))).toBe(PAGES);
        expect(siteRoot(pageAt(PAGES, 'convert/index.html'))).toBe(PAGES);
    });

    test('falls back to the stylesheet when the script tag is gone', () => {
        expect(siteRoot(pageAt(PAGES, 'convert/index.html', [STYLESHEET]))).toBe(PAGES);
    });

    // A wrong answer that looks confident is worse than a wrong answer that
    // says so, because the 404 it causes appears only on one of the two hosts.
    test('warns rather than guessing silently when there is nothing to anchor on', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        expect(siteRoot(pageAt(PAGES, 'convert/index.html', []))).toBe(`${PAGES}convert/`);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('/UTH/'));
        warn.mockRestore();
    });

    test('resolves each document once', () => {
        const doc = pageAt(PAGES, 'convert/index.html');
        const spy = jest.spyOn(doc, 'querySelector');
        siteRoot(doc);
        const afterFirst = spy.mock.calls.length;
        siteRoot(doc);
        expect(spy.mock.calls.length).toBe(afterFirst);
        spy.mockRestore();
    });

    test('_reset forgets what it resolved', () => {
        const doc = pageAt(PAGES, 'convert/index.html');
        siteRoot(doc);
        const spy = jest.spyOn(doc, 'querySelector');
        _reset();
        siteRoot(doc);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('siteUrl', () => {
    test('resolves an asset from a deep page on both hosts', () => {
        expect(siteUrl('js/vendor/pdfjs-worker.js', pageAt(VERCEL, 'convert/index.html')))
            .toBe(`${VERCEL}js/vendor/pdfjs-worker.js`);
        expect(siteUrl('js/vendor/pdfjs-worker.js', pageAt(PAGES, 'convert/index.html')))
            .toBe(`${PAGES}js/vendor/pdfjs-worker.js`);
    });

    test('resolves a tool href written from the homepage\'s point of view', () => {
        // The registry stores 'pdf-tools/index.html'. Used raw from inside
        // convert/, that would ask for convert/pdf-tools/index.html.
        expect(siteUrl('pdf-tools/index.html', pageAt(PAGES, 'convert/index.html')))
            .toBe(`${PAGES}pdf-tools/index.html`);
    });

    // A leading slash resolves against the ORIGIN, which drops /UTH/ and 404s
    // on Pages -- the exact failure this module is here to prevent.
    test('a leading slash is stripped, not honoured', () => {
        expect(siteUrl('/js/vendor/x.js', pageAt(PAGES, 'convert/index.html')))
            .toBe(`${PAGES}js/vendor/x.js`);
    });

    test('never emits a path that has lost the base prefix', () => {
        const doc = pageAt(PAGES, 'image-converter/index.html');
        for (const p of ['js/vendor/x.js', '/js/vendor/x.js', 'assets/pdfjs/cmaps/']) {
            expect(new URL(siteUrl(p, doc)).pathname.startsWith('/UTH/')).toBe(true);
        }
    });

    test('an empty path is the root itself', () => {
        expect(siteUrl('', pageAt(PAGES, 'convert/index.html'))).toBe(PAGES);
    });
});

// This is why the DOM is used as the anchor at all. If this ever starts
// passing, import.meta.url has become usable and the comment in site-url.js
// should be revisited -- but until then it is a parse-time error that would
// make any shared module carrying it un-importable under Jest, with a
// SyntaxError that names no cause.
describe('why not import.meta.url', () => {
    test('import.meta survives Babel and is a parse error in Jest', () => {
        const babel = require('@babel/core');
        const vm = require('node:vm');

        const code = babel.transformSync('const u = import.meta.url;', {
            filename: 'x.js',
            presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        }).code;

        expect(code).toContain('import.meta');
        expect(() => new vm.Script(code)).toThrow(/import\.meta/);
    });
});
