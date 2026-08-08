// Where the site root is.
//
// The site is served from `/` on Vercel and from `/UTH/` on GitHub Pages, so
// anything that needs an absolute URL -- a Worker script, a wasm asset, a link
// to another tool built from the registry's hrefs -- cannot be written as a
// literal path. `/js/vendor/x.js` 404s on Pages; `../js/vendor/x.js` is wrong
// from a page at a different depth.
//
// **This deliberately does not use `import.meta.url`**, which is the obvious
// answer and does not work here. Babel with `targets: {node:'current'}` passes
// `import.meta` through untouched into the CommonJS it hands Jest, and Jest
// parses that with `vm.Script`, which rejects it:
//
//     Cannot use 'import.meta' outside a module
//
// It is a **parse-time** error, so a single `import.meta.url` anywhere in a
// shared module makes the whole file un-importable under test -- with a
// SyntaxError that names no useful cause. That is the same shape as the
// `import.meta`-in-a-service-worker bug in CLAUDE.md, and the reason a plain
// DOM anchor is used instead.
//
// The anchor is `js/site.js`, which every page carries and which
// `tests/ui-chrome.test.js` already asserts on every nav page, so it cannot
// quietly disappear out from under this.

/** Roots already worked out, per document. Cleared by `_reset()`. */
let cache = new WeakMap();

/**
 * Absolute URL of the site root, with a trailing slash.
 *
 * Three sources, in falling order of confidence. The first two are real
 * elements whose `.src`/`.href` the browser has already resolved against the
 * page, so they carry the deployment's base path without anyone computing it.
 */
export function siteRoot(doc = document) {
    if (!doc) return './';
    const hit = cache.get(doc);
    if (hit) return hit;

    let root = null;

    // 1. js/site.js is on every page, classic and deferred, at a known depth
    //    from the root.
    const site = doc.querySelector('script[src$="js/site.js"]');
    if (site?.src) root = new URL('../', site.src).href;

    // 2. styles.css is the other universal asset, and sits at the root itself.
    if (!root) {
        const css = doc.querySelector('link[rel="stylesheet"][href$="styles.css"]');
        if (css?.href) root = new URL('./', css.href).href;
    }

    // 3. Nothing to anchor on. Correct only for a page at the root, so say so
    //    rather than returning a confidently wrong URL.
    if (!root) {
        root = new URL('./', doc.baseURI).href;
        console.warn(
            '[site-url] No js/site.js or styles.css to anchor on; '
            + `assuming the site root is ${root}. Paths will be wrong under /UTH/.`,
        );
    }

    cache.set(doc, root);
    return root;
}

/**
 * Resolve a repo-relative path against the site root.
 *
 * A leading slash is stripped rather than honoured: `/js/x.js` would resolve to
 * the origin root and lose the `/UTH/` prefix, which is exactly the 404 this
 * module exists to prevent.
 */
export function siteUrl(path, doc = document) {
    const clean = String(path ?? '').replace(/^\/+/, '');
    return new URL(clean, siteRoot(doc)).href;
}

/** Forget every resolved root. Test seam, mirroring storage.js. */
export function _reset() {
    cache = new WeakMap();
}
