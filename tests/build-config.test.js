// ============================================
// Build and test configuration invariants
//
// These are the settings that, when wrong, fail silently or fail only in
// production. tests/esm-conventions.test.js covers import specifiers and the
// classes the shared modules apply; this covers the tooling around them.
// ============================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('jest is configured so vendored code cannot break the build', () => {
    const pkg = JSON.parse(read('package.json'));

    // testMatch is '**/tests/**/*.test.js'. Several publishable packages ship
    // their own tests/ directory, so without this Jest collects them, they fail
    // against our environment, and vercel.json's buildCommand (npm run
    // test:build) goes red -- which freezes deploys for an unrelated reason.
    test('vendored packages are excluded from test collection', () => {
        expect(pkg.jest.testPathIgnorePatterns).toContain('/vendor/');
    });

    // Duplicate `name` fields across vendored package.json files otherwise
    // trigger a jest-haste-map naming collision.
    test('vendored packages are excluded from module resolution', () => {
        expect(pkg.jest.modulePathIgnorePatterns).toContain('<rootDir>/js/vendor/');
    });

    test('browser specs are excluded from the jsdom suite', () => {
        expect(pkg.jest.testPathIgnorePatterns).toContain('/tests/browser/');
    });

    // A CLI --testPathIgnorePatterns REPLACES the configured array rather than
    // extending it, so a script passing that flag silently discards every
    // exclusion above. The scripts used to do exactly that.
    test('only test:e2e overrides the ignore list, and only to opt back in', () => {
        const overriding = Object.entries(pkg.scripts)
            .filter(([name, cmd]) => name !== 'test:e2e' && cmd.includes('--testPathIgnorePatterns'))
            .map(([name]) => name);
        expect(overriding).toEqual([]);
        expect(pkg.jest.testPathIgnorePatterns).toContain('deployed-site');
        expect(pkg.scripts['test:e2e']).toContain('--testPathIgnorePatterns');
    });

    test('the deploy gate runs the unit suite', () => {
        const vercel = JSON.parse(read('vercel.json'));
        expect(vercel.buildCommand).toContain('test:build');
    });
});

describe('styles.css defines every custom property it uses', () => {
    const css = read('styles.css');

    // An undefined custom property resolves to nothing and the declaration is
    // dropped, silently. --radius was referenced by two rules for months while
    // resolving to no radius at all.
    test('no var() reference is undefined', () => {
        const defined = new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
        const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
        expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    });

    test('the spacing scale exists', () => {
        expect(css).toMatch(/--space-1:/);
        expect(css).toMatch(/--space-8:/);
    });

    // createDropzone toggles .dragover on whatever host it is handed, which was
    // only styled for one specific class.
    test('a generic dropzone host gets drag feedback', () => {
        expect(css).toMatch(/\[data-dropzone\]\.dragover/);
    });
});
