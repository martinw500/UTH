# Adding a tool

Worked example: a client-side tool at `/word-counter/`. Background in
[ARCHITECTURE.md](ARCHITECTURE.md); setup in [SETUP.md](SETUP.md).

`ci.yml` derives its file lists from `git ls-files`, so **no CI changes are
needed** — that used to be three hand-maintained lists.

---

## 1. The tool itself

```
word-counter/index.html
word-counter/js/word-counter.js      wiring only
word-counter/js/word-count.js        pure logic, if there is any
```

Copy the page scaffolding verbatim from an existing tool — `qr-generator/index.html`
is the cleanest template. The parts that must match are asserted by tests:

- head: `charset`, `viewport`, `<title>X — Useful Tool Hub</title>`, meta description,
  `../favicon.svg`, the Inter font links, `../styles.css`
- the `<nav class="nav">` block, the `.breadcrumb`, the `.tool-header`, the `<footer class="footer">`
- **all hrefs relative** (`../index.html`, never `/index.html`)

If the page loads ES modules — it should — also copy:

```html
<!-- in <head>, classic and NOT a module -->
<script>if (location.protocol === 'file:') document.documentElement.classList.add('needs-http');</script>
```
```html
<!-- first thing in <body> -->
<div class="file-protocol-notice"> …explanation… </div>
```
```html
<!-- last thing in <body> -->
<script type="module" src="js/word-counter.js"></script>
```

Imports from a tool script go up two levels, always with the extension:

```js
import { byId, debounce } from '../../js/shared/dom.js';
```

**Put pure logic in its own module** and import it from both the page and the
test. A test that re-declares its own copy of a function is testing the copy.

## 2. Homepage — three edits in `index.html`

Add a `.tool-card` anchor to `#toolsGrid`, then bump **both** hardcoded counters
(`#toolCount` and `#visibleCount`). A test asserts they match the card count, so
forgetting one is a red build.

```html
<a href="word-counter/index.html" class="tool-card"
   data-keywords="word count counter characters letters text length reading time">
    <div class="tool-card-icon" style="background: rgba(59,130,246,0.12); color: #60a5fa;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"> … </svg>
    </div>
    <div class="tool-card-content">
        <div class="tool-card-title">Word Counter</div>
        <div class="tool-card-desc">Count words, characters and reading time</div>
    </div>
    <div class="tool-card-footer">
        <span class="tool-card-status live">Live</span>
        <svg class="tool-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
    </div>
</a>
```

Search is a **substring match** over the title, description and `data-keywords`
separately — it is not tokenised, so "word count" only matches if that exact
phrase appears in one of them. Pack in every phrasing someone might type.

## 3. Tests

**`tests/html-structure.test.js`**
- add the page to `PAGES`
- add its href to the homepage-links test
- add its files to `requiredFiles`
- add a `describe('<Tool> page structure')` asserting every control id exists

**`tests/deployed-site.test.js`**
- add to `PAGES`
- add a "has link to <Tool>" homepage test
- add its scripts (and any new `js/shared/*`) to the static-asset checks
- add a `describe('<Tool> — features present')` section

**`tests/<tool>.test.js`** — picked up automatically by `testMatch`.

House style: lowercase sentence-style test names stating the invariant or the bug
("rejects nonsense instead of printing NaN"), British spelling, and a comment
above any non-obvious test naming the real-world bug it pins.

## 4. Only if the tool needs it

**Special headers** (`vercel.json`) — only for ffmpeg.wasm tools, which need
COOP/COEP for `SharedArrayBuffer`. Add a `/your-tool/(.*)` entry, and copy
`coi-serviceworker.js` into the tool directory for GitHub Pages, since service
worker scope is path-based.

**A backend** — add `api/<name>/index.py` exporting a module-level Flask `app`.
The route decorator must declare the **full public path** (`@app.route('/api/name')`,
not `/`). Mirror it into `backend.py` for local dev. `vercel.json` needs nothing;
`/api/(.*)` already carries the CORS headers and Vercel discovers `.py` files
automatically.

**A third-party library** — vendor it into `js/vendor/` rather than using a CDN;
see `js/vendor/README.md` for why and for the licence/provenance requirements.
Vendor **single files, never a package directory** — Jest's `testMatch` is
`**/tests/**/*.test.js`, so a vendored `tests/` folder would enrol someone else's
suite into the deploy gate.

## 5. Before you push

```bash
npm test                    # must be green — it gates both deploys
npm run dev                 # then click through the tool in a real browser
npm run verify:pages        # add the new page to its PAGES list first
```

Update **[STATE.md](../STATE.md) in the same commit**: the tool count near the top, and delete
anything the change made untrue. It is a description of the present, not a log.

For anything involving canvas pixels, `SharedArrayBuffer`, service workers or
file downloads, a green unit suite proves very little — check it in a browser.
`scripts/verify-converters.mjs` is the pattern to copy.
