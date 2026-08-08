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

### Reuse these rather than writing them again

Each of these exists because the hand-rolled copies had already drifted:

| Need | Use |
| --- | --- |
| Accept dropped/picked files | `js/shared/dropzone.js` — validates on **both** paths. `onReject` fires once per file with a single object, never an array. |
| Save a produced file | `js/shared/download.js` — `saveBlob`, or `attachDownload` for a persistent button. Never hand-roll the anchor; the append and the ~1 s revoke are both load-bearing. |
| Show "here is your file" | `js/shared/result-card.js` — `renderResult` / `renderResultList`, size and savings included. |
| Hold a blob URL | `js/shared/objecturl.js` — a slot owns exactly one live URL. |
| Say something to the user | `js/shared/notify.js` — never `alert()`, never a silent return. |
| An absolute URL (worker, wasm) | `js/shared/site-url.js` — **not** `import.meta.url`, which is a parse error under Jest. |

## 2. Homepage — the registry, then the card

**`js/shared/tools.js` is the source of truth.** Add a frozen entry with
`id, title, href, category, tone, runs, desc, keywords`, then mirror it as a
`.tool-card` in `#toolsGrid` and bump **both** counters (`#toolCount`,
`#visibleCount`). `tests/tool-registry.test.js` asserts registry↔HTML parity —
a card without an entry, a mismatched counter, or a `tone` with no CSS class is
a red build.

The grid stays **static HTML**: `deployed-site.test.js` fetches raw HTML with no
JavaScript, and a crawler sees the same. The registry does not render it.

```html
<a href="word-counter/index.html" class="tool-card" data-tool="word-counter">
    <div class="tool-card-icon tone-cyan">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"> … </svg>
    </div>
    <div class="tool-card-content">
        <div class="tool-card-title">Word Counter</div>
        <div class="tool-card-desc">Count words, characters and reading time</div>
    </div>
    <div class="tool-card-footer">
        <span class="tool-card-runs">On device</span>
        <svg class="tool-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
    </div>
</a>
```

**The accent is a `tone-*` class, never an inline `style`.** Light mode cannot
reach an inline `color:`, and a pale tone tuned for near-black is invisible on
white. `tests/ui-chrome.test.js` fails on an inline icon colour.

Search (`js/shared/search.js`) **ranks rather than filters**, tokenises on
whitespace, expands synonyms and tolerates typos on words of four letters or
more. So `keywords` should carry the words people *say* — every synonym target
is asserted to exist somewhere in the registry, so a synonym cannot point at a
word no tool contains.

## 3. Tests

**`tests/html-structure.test.js`**
- add the page to `PAGES`
- add its files to `requiredFiles`
- add a `describe('<Tool> page structure')` asserting every control id exists

**`tests/deployed-site.test.js`**
- add to `PAGES`
- add its scripts (and any new `js/shared/*`) to the static-asset checks
- add a `describe('<Tool> — features present')` section

Careful: this suite is **not** run by `npm test` — it needs the network, so it
only runs in CI after a push. `tests/e2e-parity.test.js` reads the literals it
expects and checks them against the local HTML inside the hermetic suite, which
is what tells you a copy change will turn the E2E job red before you push.

**`tests/<tool>.test.js`** — picked up automatically by `testMatch`.

If the tool applies CSS classes from a shared module, add that module to
`SOURCES` in `tests/esm-conventions.test.js` — but write the class names as
**literals at the point they are applied**. The extractor reads them out of the
source, so a name passed into a helper as an argument is invisible to it, and
the file ends up listed as gated while actually being ungated.

House style: lowercase sentence-style test names stating the invariant or the bug
("rejects nonsense instead of printing NaN"), British spelling, and a comment
above any non-obvious test naming the real-world bug it pins.

## 3b. If the tool produces a file, add a `scripts/verify-<tool>.mjs`

Not optional, and not covered by anything above. jsdom has no canvas, no
`toBlob` and no `SharedArrayBuffer`, so for a tool that emits an artefact the
unit suite largely proves the code did not throw. Every `verify:*` script in this
repo caught a real bug while being written.

Copy the shape from an existing one and add the npm script. What they do:

- build their own fixtures **in the page** (canvas, `MediaRecorder`, pdf-lib) so
  no binary test files enter the repo;
- read the produced bytes back and assert something specific — magic bytes, page
  count, pixel dimensions — never just "a file appeared";
- **wait for the artefact to change, not merely to exist.** The previous run
  leaves a blob URL in the download link, so waiting on the selector alone reads
  a stale result and every assertion is silently one export behind;
- **verify with a different implementation than the one under test** where one
  exists. The zip writer is checked by unzipping with Info-ZIP; asserting our own
  byte layout back at ourselves would prove nothing.

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
```

Update **[STATE.md](../STATE.md) in the same commit**: the tool count near the top, and delete
anything the change made untrue. It is a description of the present, not a log.

For anything involving canvas pixels, `SharedArrayBuffer`, service workers or
file downloads, a green unit suite proves very little — check it in a browser.
`scripts/verify-converters.mjs` is the pattern to copy.
