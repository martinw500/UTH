# Project State

**This file is the single source of truth for where the overhaul stands.** Read it first when
picking the work back up on a new machine or in a new session.

---

## How to maintain this file

> **This file describes the CURRENT state only. It is not a changelog and not a history.**
>
> - **If something in here is no longer true, delete it.** Do not append a correction, do not
>   leave it with a strikethrough, do not mark it "done" and keep it around. Remove it.
> - When a phase lands: delete its entry from *Next up*. Add something to *Done* only if a future
>   reader needs it. Add to *Constraints* or *Gotchas* only if it will bite someone later.
> - Finished work that constrains nothing and surprises nobody should leave **no trace here** —
>   that is what `git log` is for.
> - If this file and the code disagree, **the code wins**. Fix the file.
> - Target length: under ~200 lines. If it is growing, old content should have been deleted.
>
> Update this file in the same commit as the work it describes, not afterwards.

---

## Where the work lives

- **Remote:** `origin` → https://github.com/martinw500/UTH
- Work goes straight to `main` after `npm test` passes. It is a solo repo; PRs bought nothing that
  pushing does not, since CI and both deploy gates run on `main` too. The exception is anything
  touching `api/` — see the note under P-social below.

**Everything needed to pick the work up is in this repo.** *Next up* below is self-contained;
`docs/SETUP.md` covers a new machine. Earlier planning documents lived under `~/.claude/plans/`
and do **not** travel with a clone — nothing depends on them.

---

## What this project is

Vanilla HTML/CSS/JS static site. **No framework, no bundler, no build step.** Python Flask
serverless functions under `api/` on Vercel. Dual-deployed to GitHub Pages
(`https://martinw500.github.io/UTH/` — note the `/UTH/` subpath, so all hrefs must be relative)
and Vercel (`https://useful-tool-hub.vercel.app`, which is the only host that runs the API).

Ten tools: YouTube downloader, Instagram downloader (both server-backed), file converter (the
`convert/` hub), image editor, PDF tools, favicon generator, video converter, audio converter,
colour converter, QR generator.

---

## Done

### The tool registry and the homepage
`js/shared/tools.js` is the single source of truth for what tools exist, their copy, category and
tone. **It does not render the homepage** — the grid stays static HTML, because
`deployed-site.test.js` fetches raw HTML with no JavaScript and a crawler sees the same.
`tests/tool-registry.test.js` is what keeps the two from drifting, and it checks copy, keywords,
tones, category counts and both counters.

Search lives in `js/shared/search.js` and **ranks rather than filters**. People type what they want
to *do* ("shrink my photo"), not a tool name, and they typo; a binary substring filter answers both
with a blank page.

- **Synonyms are additive** — a word always searches for itself plus its expansions. Every synonym
  target is asserted to exist somewhere in the registry, so a synonym cannot point at a word no tool
  contains. That check found `grayscale`, a real image-editor feature that was unsearchable.
- **Typo tolerance is length-gated.** Words of three letters or fewer get none: at that length one
  edit reaches half the dictionary, so "gif" would match "if", "git" and "of".
- **Two tiers.** Every term matched and none fuzzily → a direct hit. Otherwise → *related*, shown
  under a quieter heading, because a guess presented like a result is a lie about confidence. A
  suggestion must cover at least half the query, or "pull the song out of a video" suggests
  everything that mentions video.

`script.js` is a **module** so it imports that logic instead of copying it — the duplicate it used
to carry would certainly have drifted. Ranking has to cross category boundaries, so searching moves
matched cards into one ranked list and clearing puts them back.

**`[hidden]` now carries `!important`.** The user-agent rule is the lowest possible specificity,
so any author `display` beats it; `.tool-card` is `display: flex`, which meant search filtered
correctly and then rendered the hidden cards anyway. `js/shared/dom.js` and `notify()` both toggle
that attribute, so it has to be reliable.


### Theming and site chrome
Hues live as **bare RGB channels** (`--primary-rgb: 99 102 241`) so a tint can be written
`rgb(var(--primary-rgb) / 0.08)` and still follow the theme. Forty-odd hardcoded
`rgba(99, 102, 241, …)` literals were why light mode was impossible before; a test now fails if one
comes back. Everything above that layer is semantic — ask for `--bg-surface`, never a raw colour.

**A brand colour used as TEXT must use `--primary-readable`, not `--primary-light`.** The light
variant is tuned for near-black and falls to 2.98:1 on white. `verify:chrome` measures real
computed contrast on every page in both themes and fails under 4.5:1, which is how that was caught.

Per-tool accent colours are `tone-*` classes, not inline styles — light mode could not reach an
inline `color:`, and a pale tone that works on near-black is invisible on white.

Theme selection is a **classic inline `<head>` snippet** in every page. It cannot be an external
file: even a synchronous one can paint before it arrives, and the page flashes the wrong theme. The
same snippet sets `needs-http` for the `file://` guard. `js/site.js` (classic, deferred) handles
the toggle and the mobile nav; it is classic because half the pages are still classic scripts.

An explicit choice is stored in `localStorage` and wins over the OS; with nothing stored the page
follows `prefers-color-scheme` and `data-theme` stays absent.

**The mobile nav used to be unreachable** — `.nav-links` was `display: none` below 768px with
nothing to reveal it, so Feedback and GitHub could not be opened on any phone.


### PDF tools
Merge, keep/remove pages, split, rotate, optimise, and images→PDF, on **vendored pdf-lib** (ESM
build, so the page imports it directly instead of loading a classic script and reading a global).

**pdf-lib writes and edits PDFs; it does not render them.** There is no PDF→image operation because
that needs pdf.js — a separate, much larger dependency with its own worker. Do not add a
half-working one.

**"Optimise" is not image compression and must never be labelled as if it were.** All it does is
`save({ useObjectStreams: true })`, which restructures the object table for a usually single-digit
saving; the UI says "no smaller — this file was already efficiently structured" when that is the
truth. pdf-lib cannot touch embedded image streams at all. The only way to get the reductions people
expect from "compress PDF" is to rasterise every page, which destroys text selection, links and
accessibility — if that is ever added, call it "Flatten & compress (converts pages to images)".

Page ranges parse in `js/shared/pdf-pages.js`, deliberately separate from anything that opens a
document: `1-3, 7, 9-, last` is where the bugs live, and one-based in / zero-based out is converted
in exactly one place. Out-of-range numbers clamp and reversed ranges are read the way they were
meant, because "1-999" and "5-2" are typos, not errors.

Rotation is **cumulative** on whatever the page already carried — replacing it would silently
un-rotate pages that were already sideways.

`npm run verify:pdf-tools` builds fixtures with pdf-lib in the page, then reads every output back and
asserts page counts and rotations. A PDF that merely parses proves nothing; readers are famously
tolerant of malformed files.

### ZIP and ICO are hand-written, not vendored
`js/shared/zip.js` and `js/shared/ico.js` are both pure byte layout, which is exactly why they are
not libraries: every field can be asserted directly in jsdom, where a vendored bundle would be
opaque. `CompressionStream('deflate-raw')` does the DEFLATE; because complete Blobs are always in
hand, sizes and CRCs are known before writing, so **no data descriptors are needed** and the format
reduces to `[local header + data] × N`, `[central entry] × N`, EOCD.

`'auto'` **stores** already-compressed payloads (JPEG/PNG/MP4/MP3…). That is the better default, not
a shortcut — DEFLATE gains ~0% on them and costs real time. Zip64 is out of scope: >65535 entries or
>4 GB is refused with a clear message rather than written as a corrupt archive.

Both writers use **brand checks, not `instanceof`** (`ArrayBuffer.isView`, `Object.prototype
.toString`). A typed array that crossed a realm — from a worker, or from Node under test — is still
a real typed array but fails `instanceof` against the local constructor.

`npm run verify:favicon` extracts the archive with a **different** implementation (Info-ZIP, or
bsdtar) and checks every `.ico` offset lands on a real PNG. Asserting our own layout back at
ourselves would prove nothing. Note Git Bash's `tar` is GNU tar and **cannot read ZIP at all**;
the script tries several extractors and names the one that worked.

### Favicon generator
One image → every PNG size, a real multi-size `.ico`, a web manifest and a README, zipped. Squares
the source by **centre-cropping, not stretching**, and steps the downscale — 1024px straight to 16px
in one draw is what makes small icons mushy. Warns when the source is under 512px rather than
silently upscaling. The previews are canvases at their true pixel size, so the 16px preview shows
exactly the detail a 16px favicon has.

### The `convert/` hub
One page for image, video and audio conversion. **Routing is data, not code**:
`js/shared/convert-registry.js` holds the target table, which kinds reach which targets, and a
declarative `OPTION_SPECS`. `convert/js/ui.js` renders the option panel from that, so adding a
format is a row in the table plus at most one branch in one engine — never an edit to
`convert/js/main.js`, which knows nothing about how any format is produced.

Engines share one contract: `convert(file, { target, options, signal, onProgress })` →
`{ blob, filename, meta }`. They are loaded with a native dynamic `import()`, so an image job never
parses the media engine. The two ffmpeg UMD scripts are ~15 KB and load eagerly; the ~32 MB core
stays lazy inside `loadFFmpeg`, and `verify:convert-hub` asserts an image conversion fetches none of
it.

Detection is **extension first, MIME second**. Browsers report an empty type for `.mkv`/`.avi`/
`.mov`, and Windows reports `.m4a` as `audio/mp4`, which by prefix is indistinguishable from
`video/mp4`. Video can become audio (extracting a soundtrack); audio can never become video and
neither becomes an image — a frame grab is a different feature, not a format conversion.

Mixed input kinds are rejected with a message rather than silently dropped: one target list cannot
serve both. Conversion is **strictly serial** — ffmpeg.wasm has one fixed heap.

`convert/` needs its own `coi-serviceworker.js` copy (worker scope is per-directory) and its own
`vercel.json` header block, exactly like the two older converter pages.

### Image editor
**The crop rect is stored in normalised image space (0..1), not pixels.** It used to be clamped in
canvas-attribute pixels while drags were measured in CSS pixels via `getBoundingClientRect()`, so on
any viewport narrow enough to scale the canvas, crops landed somewhere other than where they were
drawn. Do not "simplify" this back to pixels. It is also what makes one crop rect apply correctly
across a batch of differently-sized images, and what lets the overlay position itself in percentages.

**There is exactly one renderer** (`image-converter/js/render.js`), used by both the preview and the
export. Previously the preview set `ctx.filter` while the export baked filters separately, and
geometry ops destructively flattened the backing canvas in between — so the preview showed something
the export did not produce. The edit is now a plain state object (`js/shared/pipeline.js`) that both
render from; undo is a stack of those rather than canvas snapshots.

Order is **crop → straighten → rotate/flip → resize → colour → sharpen**: geometry first so filters
are never resampled by a later scale, sharpen last so it works on the pixels that ship. Preview skips
the sharpen pass only — it is a full `getImageData`/`putImageData` round trip and stutters at slider
speed. Export never skips it.

A 1:1 crop on a 2000×1000 image is **0.5 × 1.0 in normalised space, not a normalised square**;
`applyAspect` divides the image's own aspect out. Getting that wrong is what makes "square" crops
rectangular.

`npm run verify:image-editor` drives a real browser and checks the actual bytes — magic numbers per
format, JPEG matte colour, resize dimensions, and a 1:1 crop at a 420px viewport. **Run it after
touching the editor or `js/shared/{geometry,pipeline,image}.js`.** jsdom has no canvas, so this is
the only thing that can catch the whole failure class. Needs `npm run dev` running.

### QR generator
Encoding is in `js/shared/qr.js`, which returns a plain grid with the quiet zone baked in, so the
canvas and SVG renderers stay trivial and the encoding is testable in jsdom (which has no canvas).

The library is **vendored**, not from a CDN. It needs two files: the main one defaults to
`charCodeAt(i) & 0xff`, so `☕` would encode as one wrong byte and decode to mojibake with no error
raised. `js/shared/qr.js` installs the UTF-8 converter on import and `tests/qr.test.js` pins it.
Read `js/vendor/README.md` before re-vendoring.

Do **not** verify a QR by diffing its matrix against another library — the mask pattern is chosen
by penalty scoring and two correct implementations legitimately differ. Decode it instead.

### The video converter was broken in production, and now is not
Two independent bugs, both invisible to the unit suite because neither shows up
until something actually converts a file.

1. **`coi-serviceworker.js` contained `import.meta`.** A service worker registered without
   `{ type: "module" }` is a classic script, where `import.meta` is a **parse-time** error — so its
   presence anywhere in the file, even on a branch the worker never reaches, made the whole script
   fail to evaluate. Registration failed with "ServiceWorker script evaluation failed",
   `crossOriginIsolated` stayed false, and `SharedArrayBuffer` was unavailable everywhere the
   headers are not set server-side: **GitHub Pages and local dev**. Vercel masked it.
2. **The UMD ffmpeg core was handed to a module worker.** Passing `classWorkerURL` makes
   `FFmpeg.load()` construct the worker with `{ type: "module" }`, and module workers have no
   `importScripts`. The worker falls back to `await import(coreURL)` and reads `.default`, which a
   UMD script does not have, so it failed with the misleading "failed to import ffmpeg-core.js" —
   **on Vercel too**. The worker chunk must stay UMD (the ESM worker's relative imports break once
   blobbed) while the core must be ESM. All four combinations were tried in a browser; only
   UMD-worker + ESM-core loads.

`npm run verify:converters` drives a real browser and ffprobes the output of both converters,
including a trimmed clip. **Run it after touching `js/shared/ffmpeg.js` or a converter page** — it
is the only thing that catches this class of bug. Needs `npm run dev` running (or `SITE_URL` set to
a deployment), plus ffmpeg and ffprobe on PATH.

### Audio converter
Shares `js/shared/ffmpeg.js` with the video converter, so it inherited the fixes above rather than
repeating them. Formats: MP3, M4A, OGG, **Opus**, WAV, FLAC. Accepts video input too — extracting
a soundtrack is the main use case, and `-vn` handles it.

The encoder list was **not guessed**: `ffmpeg -encoders` was run inside ffmpeg.wasm and checked.
`libopus` turned out to be present, contrary to expectation. Do the same before adding a format;
a missing encoder yields a zero-byte file and a baffling error.

**Its trimming deliberately differs from the video converter's.** It puts `-ss` *before* `-i`
(input seeking, so ffmpeg jumps instead of decoding and discarding — this matters on a 90-minute
podcast). That rebases the output timeline to zero, so the end must be `-t <duration>` and **not**
`-to <absolute end>`; `-to` there silently yields a clip of the wrong length. The video converter
seeks on the output because it re-encodes everything anyway. Don't "fix" one to match the other.

### Shared ffmpeg loader
`js/shared/ffmpeg.js` holds loading, worker-chunk discovery and the write/exec/read cycle. The
video converter uses it; the audio converter will. It never touches the DOM — both pages have
different markup, so all feedback goes out through `onProgress`/`onStatus`/`onLog` callbacks.

**The worker chunk is now discovered at runtime, which is what closed the old P8 item.**
`@ffmpeg/ffmpeg` is webpack-built and spawns its worker from a code-split file named after a chunk
id. The name `814.ffmpeg.js` **never appears as a literal in the bundle** — webpack emits
`u: e => e + ".ffmpeg.js"` and calls it as `e.u(814)` — so searching for the filename finds
nothing. `findWorkerChunk` reads the suffix function and the call site separately and recomposes
the name; verified against every published 0.12.x. Falls back to the unpkg `?meta` listing, then to
the pinned constant, then to loading without a worker URL at all.

`loadFFmpeg` memoises the **promise**, not a flag set after the await — the old code set
`ffmpegLoaded` only on completion, so two quick clicks would each build an instance and download
the core twice. `runFFmpeg` deletes both virtual files in a `finally`, so a failed conversion no
longer leaves the input in the virtual filesystem.

`video-converter/js/video-args.js` holds the pure argument builder, extracted so
`tests/video-converter.test.js` can import the real thing. It previously re-declared its own copy,
which meant those tests stayed green no matter what the shipped file did.

### P0/P1 — Instagram quality, and CI that can catch regressions
Details are in `git log` (`128c949`, `cf1c761`). What still constrains you:
- Instagram downloads `url_high` through `/api/instagram/proxy`. Only `fetch()` needs CORS —
  `<img src>` does not, so previews hit the CDN directly and must keep doing so.
- Re-encode defaults to **Original**. MOV/AVI were dropped: they renamed an MP4 without
  transcoding, so the extension lied about the container. Don't add them back.
- `tests/deployed-site.test.js` is driven by `SITE_URL`; PR runs test that PR's Vercel preview.

### Saving files — `js/shared/download.js`
This existed four times and the four copies **disagreed**. Two appended the anchor to the
document and waited 100 ms before revoking; two did neither — no append, `setTimeout(…, 0)`. Both
details are load-bearing and are now settled in one place:

- **The anchor must be in the document.** A detached `<a>.click()` is ignored by Firefox. Chrome
  tolerates it, which is why the two detached copies looked fine to whoever wrote them.
- **The URL must outlive the click by ~1 s.** `.click()` returns when the event dispatches, not
  when the browser has finished reading the blob, so revoking on the next tick races that read and
  fails the download for a large file.

`attachDownload(anchor, blob, name, slot, key)` is the form for a **persistent** button: the slot
or pool from `objecturl.js` keeps owning the URL, so nothing revokes a URL still wired to a visible
preview. `saveRemote` is separate from `saveBlob` on purpose — the `download` attribute is
**ignored cross-origin**, which is why the YouTube download passes its filename to the backend as a
query parameter instead.

The two ffmpeg converter pages still hand-manage `currentOutputUrl`. That is correct as written and
they are on the redirect path anyway; `color-converter` and the two downloaders are classic scripts
and cannot import this until P2b/P2c.

### The result row — `js/shared/result-card.js`
`renderResult`/`renderFailure`/`renderResultList`, plus the pure `resultSummary`. The convert hub
and the image editor had grown near-identical copies and had **already drifted**: the hub computed
its own percentage inline instead of using `savings()`, and the editor coloured a byte-identical
re-encode as an error. Neither was a hard bug, which is why both survived.

The panel does not exist until the user acts, so nothing that reads raw HTML can see it — **the
static-HTML rule for the homepage grid does not apply here.** Each page keeps its own container and
heading, because those carry copy `e2e-parity.test.js` pins.

**Class names are written as literals at the point they are applied.** `esm-conventions.test.js`
extracts them from the source to check they are styled, and a name that arrives as a function
argument is invisible to it — which would leave the file *listed* as gated while actually being
ungated. A test asserts the extractor really found all eleven.

The `convert/` target-size chips are declared as `presets` on the option spec, so a format wanting
different shortcuts is a registry row. They are labelled **by size, not by service**: a chip saying
"Discord" would assert someone else's current upload limit, which changes without notice and would
be confidently wrong until a send failed. Clicking the active chip clears it — otherwise a preset
is a one-way door with no route back to "no target size".

### P2a — shared modules
`js/shared/{format,config,dom,storage,notify,clipboard,dropzone,image,color}.js`. The image, video
and colour test files now import the real source **with their original assertions unchanged**, so
green means the extraction preserved behaviour.

Loaded by the QR generator and both converters. The other four pages are still classic scripts
with their own helper copies — converting those is P2c–g.

### ESM groundwork
- **`file://` guard.** A classic inline `<head>` script sets `.needs-http`; CSS then hides the page
  and shows `.file-protocol-notice`. Module pages are silently blank from disk otherwise, and the
  guard cannot itself be a module. Every new module page needs it — `tests/esm-conventions.test.js`
  enforces that, plus the `.js`-extension rule and the shared-module class styling.
- **`notify()` adds only a *level* class plus `active`**, so page markup must supply the base
  `class="notice"`. `.notice.active:not([hidden])` is deliberate: an author `display` rule beats the
  UA `[hidden]` rule, so keying on `.active` alone leaves a cleared notice visible.
- **`#toolCount`/`#visibleCount` are asserted against the tool-card count**, so forgetting a counter
  is a red build.
- **`ci.yml`'s `validate` job derives its file list from `git ls-files`**, so **adding a tool needs
  no CI edit**. Its asset check reads each page's real `src`/`href`, which the old hand-maintained
  list could not — that is the 404 commit `085863b` had to fix.

Several behaviours were deliberately corrected during that extraction (preview-deploy API URLs,
dropzone type validation, compression fallback, JPEG matting, palette extraction). See `git log`
for `9e0160f` if one surprises you.

---

## Next up, in order

### The 2026 roadmap — four new tools, and making this feel like one product

Agreed scope, in build order. Steps 1–3 are **done** (`download.js`, `site-url.js`,
`result-card.js` — see *Done* above); what follows is what remains. Each step is its own commit,
independently green and deployable.

The bar every tool idea had to clear: **would a non-technical person hit this, and is the current
best answer "upload your private file to a stranger"?** Rejected on that basis, so nobody
re-proposes them: calculators, unit/currency converters, timers, password generators (one search
away, and every phone ships one), and JSON/base64/regex/markdown/UUID/lorem-ipsum (developer
tooling — near-zero overlap with the people who want an Instagram downloader).

- **4 — HEIC input, and a photo-privacy tool.** One release, one story.
  `decodeImageFile` in `js/shared/image.js` is the single branch point: try `createImageBitmap`
  first (Safari decodes HEIC natively, so most iPhone users download nothing), and only on failure
  `await import('./heic.js')`. That one edit gives HEIC to the image editor, the favicon generator
  and `convert/` at once. `EXTENSIONS.image` gains `heic, heif, hif`; **no new `TARGETS` row** —
  HEIC is input-only by construction.
  **The `accept` lists are not optional**: iOS and Windows often report `file.type === ''` for
  `.heic`, so `image/*` will not match in `matchesAccept` and the file is silently rejected on
  exactly the devices this targets. Add `.heic,.heif` in `convert/`, `image-converter/`,
  `favicon-generator/`.
  Vendor the **wasm-bundle** build of `libheif-js` (wasm base64-inlined), not the split
  `.mjs` + `.wasm` pair — a separate `.wasm` needs its own path resolution under `/UTH/`.
  **Licence: LGPL-3.0-or-later**, the first non-permissive thing in `js/vendor/`. Fine to ship
  unmodified as a dynamically-loaded file with upstream and version recorded; write
  *do not edit this file* in `js/vendor/README.md`. **Decode only** — HEIC encoding needs x265
  (GPL-2.0) and would relicense the site.
  The privacy tool is mostly presentation over `js/shared/exif.js`, which already reads camera,
  date and GPS: show what the photo is carrying, then strip it (re-encoding through canvas already
  drops everything). Its value is entirely in the reveal.

- **5 — global `Ctrl+K` and recent tools.** Today `script.js` binds it on the homepage only.
  Extract an overlay that reuses the existing ranked `searchTools`, and put it on every page.
  Recent tools go in `localStorage` via `js/shared/storage.js`, capped at 5, and must be
  **JS-appended, not part of the static grid** — `deployed-site.test.js` counts `.tool-card` in raw
  HTML.

- **6 — QR / barcode scanner.** Read codes as well as write them. Vendor **jsQR** (~40 KB, MIT)
  exactly as `qrcode-generator.js` was. Camera via `getUserMedia` with a real permission-denied
  path; images via the existing dropzone. Classify the payload (URL / WiFi / vCard) so the result
  means something.

- **7 — tool-to-tool handoff.** The thing that turns ten pages into one product.
  **IndexedDB**, keyed store, pointer in the URL (`?handoff=<id>`) — `sessionStorage` is
  strings-only, so a 4 MB WebP base64s to 5.3 MB against a ~5 MB cap and throws.
  Split `js/shared/handoff.js` (the whole protocol, against an injected store) from
  `js/shared/handoff-idb.js` (~70 lines, the only file naming `indexedDB`), because **jsdom has no
  `indexedDB` at all** and a bare `_reset()` is not enough — the default store must arrive by lazy
  `import()` so jsdom never loads it.
  Registry gains `accepts`/`produces` over a `FAMILIES` superset (`image|video|audio|pdf`) with a
  new `detectFamily()`. **Do not add `'pdf'` to `KINDS`** — `convert-registry.test.js` asserts
  every kind has a reachable default target, and `convert/js/main.js` would admit PDFs into a queue
  with none. Build hrefs with `siteUrl()`; the registry's are written from the homepage's point of
  view. Guard, in order: Firefox private mode throws from `indexedDB.open` **synchronously** (wrap
  the call, not just `onerror`); Safari can leave `open()` firing nothing (race a 3 s timer);
  `send()` must await the transaction before navigating; claim must be get+delete in **one**
  transaction. When IndexedDB is unavailable, render no buttons at all rather than dead ones.
  Then: drop a file anywhere on the homepage → `detectFamily` picks the tool → handoff carries it.

- **8 — screen + webcam recorder.** `getDisplayMedia` + `MediaRecorder`, **zero dependencies**.
  Watch: Safari has no `getDisplayMedia` audio and different MIME support (probe, don't assume);
  `MediaRecorder` WebM carries no duration until remuxed, so seek bars misbehave; long recordings
  need `ondataavailable` chunking, not one in-memory blob.

- **9 — pdf.js: page thumbnails, PDF→JPG, honest flatten-compress.** The biggest item; one
  dependency unlocks four features, including seeing pages instead of typing `1-3, 7` blind.
  Vendor `legacy/build/pdf.min.mjs` and `pdf.worker.min.mjs` (**legacy** — the modern build needs
  `Promise.withResolvers`, and iOS 17.0–17.3 would fail at import with a bare `TypeError`).
  **Attach the worker with `GlobalWorkerOptions.workerPort`, constructing the `Worker` ourselves at
  `{ type: 'module' }` — never `workerSrc`**, which lets pdf.js guess classic-vs-module, and the
  `.mjs`→`.js` rename makes any extension heuristic wrong. That is the `classWorkerURL` trap again.
  Pin that both files carry the same version literal. Keep `js/vendor/` literally single-files-only
  and put `cmaps/` and `standard_fonts/` under `assets/pdfjs/`. **Do not add `coi-serviceworker.js`
  to `pdf-tools/`** — pdf.js needs no `SharedArrayBuffer`. Render thumbnails on demand via
  `IntersectionObserver` at concurrency 1; a 400-page PDF rendered eagerly OOMs the tab.
  Stays in `pdf-tools/` — routing PDFs into `convert/` is separable and needs
  `engineFor(target, kind)` overrides, since `engine` is currently a property of the target.

Deferred, deliberately: **sign/fill a PDF** (unblocked by step 9), **image joiner**, and
**PWA/offline** — the last collides with the `coi-serviceworker.js` in three directories and is its
own project if ever.

### P2b–g — finish the ESM migration (foundational, risky)
One PR per step; each independently green and deployable.
- **P2b** — `js/config.js` becomes a re-export shim of `js/shared/config.js`; convert the two pages
  that load it (`youtube-downloader`, `instagram-downloader`) to `<script type="module">`.
- **P2c–g** — one tool at a time: convert the IIFE to a module, delete its local helper copies in
  favour of `js/shared/*`, and rewrite its test to import real source. The video converter and
  image editor are done; **colour picker and the two downloaders remain** — and until they are
  modules they cannot use `js/shared/download.js`, so they still carry their own save helpers.

### Fold the old converter pages into the hub
While doing it, move the video converter to **VP9** (`libvpx-vp9 -row-mt 1`) instead of VP8, and give
GIF a `palettegen`/`paletteuse` pass — the single-pass GIF visibly bands.

`video-converter/` and `audio-converter/` now duplicate what `convert/` does. Turn them into thin
redirects (a visible link, not just `<meta refresh>`) once the hub has been live long enough to
trust. **Do it alone, in its own commit** — it is the only step that deletes assertions rather than
adding them, ~30 of them across `html-structure` and `deployed-site`, plus their `vercel.json`
blocks and `coi-serviceworker.js` copies.

### P3 — Instagram backend rewrite
Extract `api/_lib/` (leading underscore ⇒ Vercel does not route it). Add a `Deadline` budget —
the cascade can currently spend 15+15+10s **plus an extra 10s request per image** because it
base64-inlines every image, blowing past the function limit so users get a platform 504 instead of
the friendly error. Reorder strategies: embed-page scrape first, instaloader demoted (it is the
most expensive *and* the most blocked on cloud IPs, yet runs first today). Exponential backoff with
jitter. Drop base64 from the response. Edge-cache 200s only (`s-maxage=600`); `no-store` on errors
or a transient Instagram block gets cached for everyone. HMAC-sign proxy URLs, failing **open** to
allowlist-only when `PROXY_SECRET` is unset.

### P4 — YouTube tells the truth *(independent of P2/P3, can be done any time)*
Production silently serves 360p when the UI says 1080p: Vercel has no ffmpeg, so
`api/youtube/download.py:33-39` falls back to progressive muxed MP4, which YouTube only serves at
360p. `api/youtube/index.py:71` **already computes `has_audio`** and ships it — the client just
ignores it, so this is mostly a labelling fix. Split formats into "video + audio, ready to
download" vs a collapsed "advanced (no audio)". Also replace the `send_file` download path: it
buffers the whole file against Vercel's ~4.5 MB response cap.

### P5a — CSS hygiene, zero visual change
Merge the two `@media (max-width: 768px)` blocks, and delete `.resize-inputs` (styles.css:1675 and
3225) — nothing in any HTML or JS references it.

**`.resize-x` is NOT dead** — `convert/js/ui.js` uses it for the arrow between the trim fields, so
an older note here telling you to delete it was wrong. `--radius` *is* defined (styles.css:126);
the same note claimed it was not. Both were checked before this entry was rewritten.

### P7 — colour toolkit
Bugs first (history is polluted on page load; Clear doesn't stick because a pending debounce
resurrects it; RGB fields snap to black when you backspace). Then wire up the maths already sitting
in `js/shared/color.js`: harmonies, shades/tints/tones, WCAG checker, HSV/CMYK/LAB/LCH/OKLCH,
palette extraction, native `EyeDropper` API. Then permalinks and export formats.

### P9 — docs
Done: `CLAUDE.md`, `docs/SETUP.md`, `docs/ARCHITECTURE.md`, `docs/ADDING_A_TOOL.md`, README rewrite.
Still open: `CONTRIBUTING.md`, issue/PR templates, and reunifying `backend.py` onto `api/_lib/`
(blocked on the same unverified cross-directory import as P3).

---

## Constraints (decided, do not relitigate)

- **Instagram stays anonymous.** No session cookies, no login, no third-party downloader APIs.
- **Media proxies validate on parsed hostname, never a substring of the URL.**
  `api/instagram/proxy.py` once checked `'instagram.com' in media_url`, so
  `https://evil.com/?x=instagram.com` passed — it was an open relay. Any new proxy parses with
  `urlparse`, requires https, lowercases, strips a trailing dot, and matches
  `host == suffix or host.endswith('.' + suffix)`.
- **No bundler, no framework, no runtime build step.** ES modules with **explicit `.js`
  extensions** — browsers require them, Babel/Jest tolerate omission, so a missing one would pass
  tests and 404 in production. `tests/esm-conventions.test.js` now enforces this, along with
  relative-only specifiers (a bare `'lodash'` needs a bundler or an import map; there is neither).
- **Relative hrefs only.** GitHub Pages serves from `/UTH/`; a root-absolute path breaks there.
- Babel is a **test-time devDependency only**. Nothing is compiled for deployment.

---

## Gotchas

- **`npm test` does not run `deployed-site.test.js`** — it needs the network, so it only runs in
  CI after a push. That means a copy change can pass everything locally, ship, and turn the E2E job
  red afterwards. `tests/e2e-parity.test.js` closes the gap: it reads the literals that suite
  expects and checks them against the local HTML, in the hermetic suite. If you change wording on a
  page, that is what tells you.

- **Module pages do not work over `file://`.** `type="module"` is CORS-blocked there. The guard
  and the README fix are shipped, so the page explains itself rather than rendering blank — but
  local testing of any module page needs `npm run dev` (port 5500), not a double-click.
- **`api/_lib/` cross-directory imports are unverified on Vercel's Python runtime.** Confirm on a
  preview deploy before relying on it. This is why `backend.py` currently carries a duplicated
  proxy route with a note rather than importing a shared one.
- **`vercel.json` `functions.maxDuration: 60` is unverified** against the account plan. Try it on a
  preview first; fall back to the 10s default with a 2-strategy cascade if rejected.
- **PR-preview E2E needs `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` repo secrets.** Without them the
  job skips (deliberately — silently re-testing production would report a false pass).
- **jsdom cannot see the bugs that matter most here** — canvas pixels, `toBlob`,
  `SharedArrayBuffer`, service workers, `EyeDropper`. Playwright is now a devDependency and
  `npm run verify:converters` uses it; extend that approach for P6/P7 rather than trusting a green
  unit suite.
- `npm audit` reports 5 high-severity advisories. All are transitive **dev-only** deps of
  jest/jsdom (`ws`, `undici`, `js-yaml`, `picomatch`, `brace-expansion`). Nothing ships to users.

---

## Verifying

```bash
npm test              # unit suite (currently 1518 passing)
npm run test:build    # what Vercel runs on deploy — must stay green or deploys freeze
npm run dev           # static server on :5500
npm run dev:api       # Flask backend on :5000
SITE_URL=https://<preview>.vercel.app npm run test:e2e

npm run verify:converters   # real browser + ffprobe; needs `npm run dev` running
```

**No automated test checks that a downloaded file is actually correct.** For any Instagram or
YouTube change, download a real asset and inspect it — pixel dimensions for images, `ffprobe` for
video. That is the entire point of the P0/P3/P4 work.
