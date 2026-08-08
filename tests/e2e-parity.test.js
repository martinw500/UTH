// ============================================
// The E2E suite's expectations must hold locally first
//
// tests/deployed-site.test.js asserts literal strings against the LIVE site,
// and `npm test` excludes it because it needs the network. So changing a page's
// copy breaks it silently: the change passes every local check, ships, and the
// E2E job goes red after the push.
//
// That happened. The image editor's dropzone became "Drop images here" when it
// gained batch editing, while the E2E still expected "Drop an image", and it
// went unnoticed across several commits.
//
// This reads the expectations out of that file and checks them against the
// local HTML, so the same drift fails here first — in the hermetic suite that
// gates the deploy.
// ============================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const e2eSource = fs.readFileSync(path.join(__dirname, 'deployed-site.test.js'), 'utf-8');

/** '/convert/' -> 'convert/index.html'; '/' -> 'index.html'. */
function pageFileFor(routePath) {
    if (routePath === '/') return 'index.html';
    if (routePath.endsWith('.html')) return routePath.replace(/^\//, '');
    return `${routePath.replace(/^\/|\/$/g, '')}/index.html`;
}

/**
 * Pull out, per page, every literal the E2E expects in that page's body.
 *
 * Each block runs from one `fetchPage('<path>')` to the next, which is exactly
 * how the file is organised.
 */
function expectationsByPage() {
    const anchors = [...e2eSource.matchAll(/fetchPage\('([^']+)'\)/g)]
        .map((m) => ({ route: m[1], index: m.index }));

    const byPage = new Map();
    anchors.forEach((anchor, i) => {
        const end = i + 1 < anchors.length ? anchors[i + 1].index : e2eSource.length;
        const block = e2eSource.slice(anchor.index, end);

        const literals = [...block.matchAll(/page(?:body)?\.body\)\.toContain\('((?:[^'\\]|\\.)*)'\)/g)]
            .map((m) => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));

        if (!literals.length) return;
        const file = pageFileFor(anchor.route);
        byPage.set(file, [...(byPage.get(file) ?? []), ...literals]);
    });
    return byPage;
}

const PAGES = expectationsByPage();

describe('the E2E suite is parsed, not assumed', () => {
    // If the parse silently found nothing, every test below would vacuously
    // pass and this file would be worthless.
    test('expectations were actually extracted', () => {
        expect(PAGES.size).toBeGreaterThanOrEqual(8);
        const total = [...PAGES.values()].reduce((n, list) => n + list.length, 0);
        expect(total).toBeGreaterThan(100);
    });

    test('every page it targets exists locally', () => {
        for (const file of PAGES.keys()) {
            expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
        }
    });
});

describe('every string the E2E expects is present in the local page', () => {
    for (const [file, literals] of PAGES) {
        test(`${file}`, () => {
            const html = fs.readFileSync(path.join(ROOT, file), 'utf-8');
            const missing = [...new Set(literals)].filter((literal) => !html.includes(literal));
            expect(missing).toEqual([]);
        });
    }
});
