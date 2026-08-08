/**
 * Conventions that only break in a browser.
 *
 * Babel rewrites imports for Jest, so a specifier missing its `.js` extension
 * passes every other test in this suite and then 404s in production. Same shape
 * of problem for the other rules here: each one is invisible to unit tests and
 * fatal on the deployed site. Keep the rules narrow — this file gates the Vercel
 * build (`vercel.json` buildCommand), so a false positive freezes deploys.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', '.venv', '__pycache__', 'tests']);

function walk(dir, ext, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walk(full, ext, found);
        } else if (entry.name.endsWith(ext)) {
            found.push(path.relative(ROOT, full).split(path.sep).join('/'));
        }
    }
    return found;
}

const JS_FILES = walk(ROOT, '.js');
const HTML_FILES = walk(ROOT, '.html');

// Static import/export-from specifiers. Dynamic import() is deliberately
// included — it has the same resolution rules and the same failure mode.
const SPECIFIER_RE = /(?:^|\s)(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|(?:^|\s)import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersIn(source) {
    const out = [];
    let match;
    SPECIFIER_RE.lastIndex = 0;
    while ((match = SPECIFIER_RE.exec(source)) !== null) {
        out.push(match[1] || match[2] || match[3]);
    }
    return out;
}

describe('module specifiers resolve in a browser', () => {
    const withImports = JS_FILES
        .map(file => ({ file, specs: specifiersIn(fs.readFileSync(path.join(ROOT, file), 'utf-8')) }))
        .filter(entry => entry.specs.length > 0);

    test('at least one source file is scanned, so a broken walker cannot pass silently', () => {
        expect(withImports.length).toBeGreaterThan(0);
    });

    withImports.forEach(({ file, specs }) => {
        describe(file, () => {
            specs.forEach(spec => {
                // A bare specifier like 'lodash' needs a bundler or an import
                // map to resolve. This project has neither, by constraint.
                test(`'${spec}' is a relative path`, () => {
                    expect(spec.startsWith('./') || spec.startsWith('../')).toBe(true);
                });

                test(`'${spec}' has an explicit .js extension`, () => {
                    expect(spec).toMatch(/\.js$/);
                });

                test(`'${spec}' points at a file that exists`, () => {
                    const resolved = path.resolve(ROOT, path.dirname(file), spec);
                    expect(fs.existsSync(resolved)).toBe(true);
                });
            });
        });
    });
});

describe('pages that load ES modules', () => {
    const modulePages = HTML_FILES.filter(file =>
        /<script[^>]*\btype="module"/.test(fs.readFileSync(path.join(ROOT, file), 'utf-8')));

    modulePages.forEach(file => {
        describe(file, () => {
            let html;
            beforeAll(() => { html = fs.readFileSync(path.join(ROOT, file), 'utf-8'); });

            // Opened straight from disk, a module page renders blank: the module
            // is CORS-blocked and nothing reports why. The guard explains it.
            test('carries the file:// guard', () => {
                expect(html).toContain('needs-http');
                expect(html).toContain('file-protocol-notice');
            });

            test('the guard is a classic script, not a module', () => {
                const guard = html.match(/<script(?![^>]*\btype="module")[^>]*>([\s\S]*?)<\/script>/);
                expect(guard).not.toBeNull();
                expect(guard[1]).toContain('needs-http');
            });
        });
    });
});

describe('shared modules are never loaded as classic scripts', () => {
    HTML_FILES.forEach(file => {
        test(`${file} does not load js/shared or js/vendor without type="module"`, () => {
            const html = fs.readFileSync(path.join(ROOT, file), 'utf-8');
            const tags = html.match(/<script[^>]*\bsrc="[^"]*js\/(shared|vendor)\/[^"]*"[^>]*>/g) || [];
            // A classic <script> throws on the first `export` and the page dies.
            tags.forEach(tag => expect(tag).toMatch(/\btype="module"/));
        });
    });
});

describe('styles.css defines the classes the shared modules apply', () => {
    // Derived from source rather than hardcoded, so adding a class to notify.js
    // without styling it fails here instead of shipping an invisible message.
    const SOURCES = [
        'js/shared/notify.js',
        'js/shared/clipboard.js',
        'js/shared/result-card.js',
    ];

    function classNamesIn(source) {
        const names = new Set();
        for (const call of source.match(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g) || []) {
            for (const quoted of call.match(/['"]([\w-]+)['"]/g) || []) names.add(quoted.slice(1, -1));
        }
        for (const assign of source.match(/\.className\s*=\s*['"]([\w-]+)['"]/g) || []) {
            names.add(assign.replace(/.*['"]([\w-]+)['"]$/, '$1'));
        }
        // Lookup tables such as notify.js's LEVEL_CLASS.
        for (const block of source.match(/const\s+\w*CLASS\w*\s*=\s*\{[\s\S]*?\}/g) || []) {
            for (const value of block.match(/:\s*['"]([\w-]+)['"]/g) || []) {
                names.add(value.replace(/.*['"]([\w-]+)['"]$/, '$1'));
            }
        }
        return names;
    }

    const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf-8');
    const applied = new Set();
    SOURCES.forEach(file => {
        classNamesIn(fs.readFileSync(path.join(ROOT, file), 'utf-8')).forEach(n => applied.add(n));
    });

    test('the extractor found the known notice classes', () => {
        expect(applied.has('notice-error')).toBe(true);
        expect(applied.has('copied')).toBe(true);
    });

    // The extractor only sees class names written as literals at the point they
    // are applied. result-card.js builds several elements through a helper, and
    // if that helper took the class as an argument every one of them would be
    // invisible here -- leaving the file listed as gated while actually being
    // ungated, which is worse than not listing it. This is what catches that.
    test('the extractor found the result-card classes, not just the row', () => {
        for (const name of [
            'output-item', 'output-error', 'output-item-preview', 'output-item-info',
            'output-item-name', 'output-item-meta', 'output-savings', 'output-actions',
            'positive', 'negative', 'neutral',
        ]) {
            expect(applied).toContain(name);
        }
    });

    Array.from(applied).sort().forEach(name => {
        test(`.${name} is styled`, () => {
            expect(css).toContain(`.${name}`);
        });
    });
});
