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
  pushing does not, since CI and both deploy gates run on `main` too.
- **The exception is anything touching `api/`: branch it and open a PR.** Not for review — for the
  Vercel preview deployment. The Python functions only ever really run on Vercel, and the things
  that break there (a serverless import that resolves locally and not in their runtime, the
  response cap, the function timeout) are invisible to `npm test` and to the local backend, which
  has ffmpeg and a residential IP. `tests/deployed-site.test.js` is driven by `SITE_URL`, so the
  PR job tests that PR's preview; merge once it is green.
  *(This used to say "see the note under P-social", which had already been deleted.)*

**Everything needed to pick the work up is in this repo.** *Next up* below is self-contained;
`docs/SETUP.md` covers a new machine. Earlier planning documents lived under `~/.claude/plans/`
and do **not** travel with a clone — nothing depends on them.

---

## What this project is

Vanilla HTML/CSS/JS static site. **No framework, no bundler, no build step.** Python Flask
serverless functions under `api/` on Vercel. Dual-deployed to GitHub Pages
(`https://martinw500.github.io/UTH/` — note the `/UTH/` subpath, so all hrefs must be relative)
and Vercel (`https://useful-tool-hub.vercel.app`, which is the only host that runs the API).

Ten tools: YouTube downloader, YouTube transcript, Instagram downloader (all server-backed),
image converter, video converter, audio converter (all ffmpeg.wasm), colour converter,
QR generator, PDF toolkit, EXIF viewer.

---

## Done

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

### The YouTube downloader stops lying, and has a way out
Three problems that compounded into "paste a link, get told to use
`--cookies-from-browser`".

1. **Errors were forwarded raw.** `api/youtube/_errors.py` now classifies a yt-dlp exception into
   a stable code (`bot_check`, `age_restricted`, `geo_blocked`, …) and the wording lives entirely
   client-side in `youtube-downloader/js/yt-messages.js`. The raw text still travels, as `detail`,
   but only into a collapsed `<details>` written with `textContent`. `messageFor()` falls back to a
   generic message for an unknown code and **never** to `detail` — `tests/youtube-downloader.test.js`
   pins that, and asserts no message mentions cookies or yt-dlp.
2. **The quality list promised what the host could not send** (the old P4). `/api/youtube` now
   ships `server_can_merge`; without ffmpeg the client shows only already-muxed formats as ready
   and pushes the rest into a collapsed "Advanced — silent" list, with a notice explaining the
   360p ceiling *before* the click.
3. **There was no second path.** A `bot_check` now renders a panel with a copyable `yt-dlp`
   command built from the row the user actually pressed, plus instructions for running the hub
   locally — which is the real fix, since a home IP is not bot-checked and has ffmpeg.

`send_file` is gone from both download paths in favour of a chunked generator that deletes its
`mkdtemp()` in a `finally`. Every download used to leak a temp directory. **This does not lift
Vercel's ~4.5 MB response cap** — that ceiling is why the escape hatch exists.

### YouTube → MP3, via the audio converter
`/api/youtube/download?mode=audio` serves `bestaudio[ext=m4a]` — no ffmpeg needed, so it is the
one thing the hosted backend does well. "Convert to MP3" fetches those bytes, parks them via
`js/shared/handoff.js` (a one-shot IndexedDB blob store) and navigates to
`audio-converter/index.html?handoff=<id>&format=mp3`, which picks the file up and preselects MP3.

The 4 MB cap is checked against `audio.filesize_bytes` *before* fetching, so a long track is
refused in a second with the yt-dlp route offered, instead of after a minute ending in a 504.

**`handoff.js` has no unit test**: jsdom provides no IndexedDB, and adding `fake-indexeddb` for one
module was not worth a dependency. Verify it by clicking it.

### Cookies are local-only, deliberately
`backend.py` accepts `?cookies_from_browser=chrome`, refuses it unless `request.remote_addr` is
loopback, and rejects any browser name outside a fixed allowlist. The deployed functions do not
accept it at all and there is no paste-your-cookie field anywhere.

A YouTube cookie is a live Google session credential. A hosted service that took one would be
asking strangers to hand their signed-in account to someone else's server. On your own machine
talking to your own browser profile that objection disappears — which is the situation yt-dlp's
own documentation assumes. Do not "improve" this by adding it to `api/`.

### P2a — shared modules
`js/shared/{format,config,dom,storage,notify,clipboard,dropzone,image,color}.js`. The image, video
and colour test files now import the real source **with their original assertions unchanged**, so
green means the extraction preserved behaviour. 245 → 363 tests.

Loaded by the QR generator and both converters. The other four pages are still classic scripts
with their own helper copies — converting those is P2c–g.

### The three new tools
- **YouTube transcript** (`/youtube-transcript/`, `api/youtube/subtitles.py`). The one YouTube
  feature that behaves the same on free hosting as it does locally: no ffmpeg, and the payload is
  kilobytes. Two requests — list the caption tracks, then fetch one — because the signed caption
  URLs are short-lived and the language menu should appear before any track is downloaded.
  `js/shared/subtitles.js` does VTT → SRT/VTT/prose. Its one non-obvious job is dropping the
  **rolling repeat**: auto-captions restate the previous cue's last line so the viewer can read
  two lines at a time, and concatenating naively doubles most of the transcript.
- **EXIF viewer** (`/exif-viewer/`, `js/shared/exif.js`). Hand-written JPEG/PNG/WebP metadata
  parser — no vendored dependency, and pure ArrayBuffer work, so jsdom tests it properly for once.
  The stripper **rebuilds the container byte-for-byte** with the metadata segments dropped. Do not
  replace this with a canvas round-trip: that re-encodes the photo, which is the flaw in most
  online EXIF removers. `tests/exif.test.js` builds its fixtures byte by byte rather than checking
  in binaries, and asserts the image data is copied through unchanged.
  It decodes text by hand instead of with `TextDecoder`, which jest's jsdom does not define as a
  global — and Latin-1 is the correct decoding for PNG `tEXt` anyway.
- **PDF toolkit** (`/pdf-toolkit/`, pdf-lib vendored at `js/vendor/pdf-lib.js`, ~510 KB, the
  largest file in the repo). Merge, split, reorder, rotate, delete, images → PDF, all client-side.
  The editor holds page *references* (`{ docId, pageIndex, rotation }`) and only rewrites the
  document on save, so reordering is instant and rotation is reversible; that arithmetic lives in
  `pdf-toolkit/js/pdf-ops.js` and is tested.
  **No page thumbnails, deliberately.** pdf-lib cannot rasterise; rendering would mean vendoring
  pdf.js and its worker too. Pages are numbered cards. If thumbnails ever justify that second
  dependency, that is a decision to make on purpose.

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

### P2b–h — finish the ESM migration (foundational, risky)
One PR per step; each independently green and deployable.
- **P2b** — `instagram-downloader` is the last page still loading `js/config.js` as a classic
  script. Convert it to `<script type="module">` importing `js/shared/config.js`, then delete
  `js/config.js` and the `global.API_CONFIG` mock in `tests/instagram-downloader.test.js`. The
  YouTube downloader already moved; `js/config.js` survives only for this one page.
- **P2c–g** — one tool at a time: convert the IIFE to a module, delete its local helper copies in
  favour of `js/shared/*`, and rewrite its test to import real source. The video converter, audio
  converter and YouTube downloader are done; image converter, colour picker and the Instagram
  downloader remain.
- **P2h** — `js/shared/tools.js` exporting a frozen `TOOLS[]`, plus `tests/tool-registry.test.js`
  asserting registry↔HTML parity. **Keep the homepage grid as static HTML** — client-rendering it
  would break every homepage assertion in `deployed-site.test.js`, which fetches raw HTML with no
  JS. Same reasoning for nav/footer: don't inject them, assert they match across every page.
  Rewrite `script.js` search to tokenise on whitespace (so "image convert" matches), debounce, and
  hide with `hidden` not `style.display`. *(The counter check is already done — see Done above.)*

### P3 — Instagram backend rewrite
Extract `api/_lib/` (leading underscore ⇒ Vercel does not route it). Add a `Deadline` budget —
the cascade can currently spend 15+15+10s **plus an extra 10s request per image** because it
base64-inlines every image, blowing past the function limit so users get a platform 504 instead of
the friendly error. Reorder strategies: embed-page scrape first, instaloader demoted (it is the
most expensive *and* the most blocked on cloud IPs, yet runs first today). Exponential backoff with
jitter. Drop base64 from the response. Edge-cache 200s only (`s-maxage=600`); `no-store` on errors
or a transient Instagram block gets cached for everyone. HMAC-sign proxy URLs, failing **open** to
allowlist-only when `PROXY_SECRET` is unset.

### P5 — CSS, accessibility, theming *(P5b is independent and high-impact)*
- **P5a** hygiene, zero visual change: `--radius` is used but never defined (silently resolves to
  0); delete dead `.resize-inputs`/`.resize-x`; merge the two `@media (max-width:768px)` blocks.
- **P5b** — **mobile nav is unreachable.** `styles.css` hides `.nav-links` at ≤768px with no
  hamburger, so Feedback and GitHub cannot be reached on any phone. Then: `for` on the 23
  unlabelled `<label>`s, `:focus-visible` rings, `prefers-reduced-motion`.
- **P5c** light/dark theme. Anti-FOUC needs a **classic** inline `<head>` script — a module is
  deferred and would flash.

### P6 — image converter
Correctness first (JPEG-to-black, leaked object URLs on the failure path, preview/export filter
mismatch), then export pipeline, then batch/multi-file, then the crop coordinate bug (`cropRect` is
clamped in canvas-attribute pixels while mouse coords come from `getBoundingClientRect()` in CSS
pixels, so crops land wrong whenever the container is narrower than the canvas), then EXIF.

### P7 — colour toolkit
Bugs first (history is polluted on page load; Clear doesn't stick because a pending debounce
resurrects it; RGB fields snap to black when you backspace). Then wire up the maths already sitting
in `js/shared/color.js`: harmonies, shades/tints/tones, WCAG checker, HSV/CMYK/LAB/LCH/OKLCH,
palette extraction, native `EyeDropper` API. Then permalinks and export formats.

### P8 — video converter
Add a cancel button. VP9 instead of VP8.

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

- **Module pages do not work over `file://`.** `type="module"` is CORS-blocked there. The guard
  and the README fix are shipped, so the page explains itself rather than rendering blank — but
  local testing of any module page needs `npm run dev` (port 5500), not a double-click.
- **`api/_lib/` cross-directory imports are unverified on Vercel's Python runtime.** Confirm on a
  preview deploy before relying on it. This is why `backend.py` currently carries a duplicated
  proxy route with a note rather than importing a shared one.
- **`api/youtube/_errors.py` is a *same-directory* sibling import**, which is a different and much
  safer case than the one above — but it is still unconfirmed on a preview deploy. If
  `from _errors import error_payload` fails there, inline the mapper into `index.py`,
  `download.py` and `subtitles.py` with a note, matching the precedent the proxy route set.
  All three YouTube functions break together if this is wrong, so check it first.
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
npm test              # unit suite (currently 363 passing)
npm run test:build    # what Vercel runs on deploy — must stay green or deploys freeze
npm run dev           # static server on :5500
npm run dev:api       # Flask backend on :5000
SITE_URL=https://<preview>.vercel.app npm run test:e2e

npm run verify:converters   # real browser + ffprobe; needs `npm run dev` running
npm run verify:pages        # real browser; loads every module page, fails on any 404
npm run verify:yt-errors    # the yt-dlp error classifier, against real upstream messages
```

`verify:yt-errors` is a script rather than a jest test because the classifier is Python and there
is no Python test runner here. **Run it after touching `api/youtube/_errors.py`.** Matching is
substring-based over English text yt-dlp can reword at any release, and a mis-classification is
silent — the user simply gets advice for the wrong problem.

`verify:pages` is the cheap version of `verify:converters`: it opens each page in
Chromium and fails on a console error, an uncaught exception or a 404. That catches the
missing-`.js`-extension class of bug, an import that only jest can resolve, and a module that
threw before wiring its listeners — none of which a jsdom test can see. It also round-trips
`js/shared/handoff.js` through real IndexedDB, which is the only coverage that module has.

**Request directory URLs with the trailing slash** (`/pdf-toolkit/`, not
`/pdf-toolkit/index.html`). `serve` redirects the explicit filename to a clean URL without a
trailing slash, which moves the document base up a level and makes every relative import resolve
against the site root — a wall of false 404s that looks exactly like a real bug.

**No automated test checks that a downloaded file is actually correct.** For any Instagram or
YouTube change, download a real asset and inspect it — pixel dimensions for images, `ffprobe` for
video. Same for the tools that write files: `ffprobe` the MP3 the hand-off produces, re-open a
stripped photo in the viewer *and* check its pixels were not re-encoded, and open a merged PDF in
a real reader rather than the browser's viewer.
