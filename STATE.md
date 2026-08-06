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

- **Branch:** `fix/instagram-blur-hotfix` (branched from `main`)
- **Remote:** `origin` → https://github.com/martinw500/UTH

**The branch has not been pushed.** Push it before switching machines or the work is lost:

```bash
git push -u origin fix/instagram-blur-hotfix
```

The longer plan this work follows lives **outside the repo**, at
`~/.claude/plans/look-throgh-its-rlly-linked-origami.md` on the machine that generated it, so it
does **not** travel with a clone. *Next up* below is self-contained — work from it.

---

## What this project is

Vanilla HTML/CSS/JS static site. **No framework, no bundler, no build step.** Python Flask
serverless functions under `api/` on Vercel. Dual-deployed to GitHub Pages
(`https://martinw500.github.io/UTH/` — note the `/UTH/` subpath, so all hrefs must be relative)
and Vercel (`https://useful-tool-hub.vercel.app`, which is the only host that runs the API).

Five tools: YouTube downloader, Instagram downloader (both server-backed), image converter,
video converter (ffmpeg.wasm), colour converter (both client-only).

---

## Done

### P0 — Instagram downloads were blurry
The backend already resolved a full-resolution URL into `url_high`; the client threw it away and
downloaded `media.thumbnail`, a downscaled base64 preview. Images now download `url_high` through
`/api/instagram/proxy` (only `fetch()` needs CORS — `<img src>` does not, so previews hit the CDN
directly). Also: oEmbed now requests `maxwidth=1080`, the size-capped-URL filter tries rewriting
the CDN size segment upward instead of silently falling back to low-res, and re-encode defaults to
**Original** (no re-encode) rather than WebP at Chrome's default 0.80.

Dropped the MOV/AVI video format options — they only renamed an MP4 without transcoding.

**Also fixed here:** `api/instagram/proxy.py` checked `'instagram.com' in media_url`, a substring
match over the whole URL, so `https://evil.com/?x=instagram.com` passed. It was an open relay. Now
parses the URL and matches on hostname.

### P1 — CI could not catch regressions
`tests/deployed-site.test.js` hardcoded the production URL, so it could only ever confirm what was
already live. Now driven by `SITE_URL`; PR runs resolve and test that PR's Vercel preview. The
Pages deploy had no test gate at all and now depends on a unit-test job. Vercel's `buildCommand`
moved from `test:ci` to a new `test:build` (no coverage, no verbose, hermetic).

### P2a — shared modules
`js/shared/{format,config,dom,storage,notify,clipboard,dropzone,image,color}.js`. The image, video
and colour test files now import the real source **with their original assertions unchanged**, so
green means the extraction preserved behaviour. 245 → 363 tests.

**Nothing loads these yet** — no page was changed. The site is byte-identical at runtime.

Behaviour deliberately changed while extracting (each fixes a real bug):
- `resolveBackendUrl` sends Vercel *preview* deployments to their own API. Previously any hostname
  outside a two-entry allowlist fell through to `localhost:5000`, so the API was broken on every
  preview.
- `createDropzone` validates file type on the file-picker path, not just on drop.
- `compressToTarget` probes max quality first and falls back to downscaling — a 4000×3000 photo
  previously could not reach a small target at any quality.
- `drawWithBackground` mattes alpha-less formats, fixing JPEG export compositing transparency to black.
- `encodeVerified` reports when the browser substituted PNG for an unsupported format instead of
  saving a PNG named `.webp`.
- `extractPalette` refines median-cut buckets with k-means; median cut alone splits on pixel count,
  so a 90/10 image returned two muddy centroids instead of the two actual colours.

---

## Next up, in order

### P2b–h — finish the ESM migration (foundational, risky)
One PR per step; each independently green and deployable.
- **P2b** — `js/config.js` becomes a re-export shim of `js/shared/config.js`; convert the two pages
  that load it (`youtube-downloader`, `instagram-downloader`) to `<script type="module">`.
- **P2c–g** — one tool per PR: convert the IIFE to a module with real exports, delete its local
  helper copies in favour of `js/shared/*`, rewrite its test to import real source.
- **P2h** — `js/shared/tools.js` exporting a frozen `TOOLS[]`. **Keep the homepage grid as static
  HTML** and add `tests/tool-registry.test.js` asserting registry↔HTML parity and that
  `#toolCount` matches `TOOLS.length`. Client-rendering the grid would break every homepage
  assertion in `deployed-site.test.js` (it fetches raw HTML, no JS). Same reasoning for nav/footer:
  don't inject them, assert they match across all 7 pages. Rewrite `script.js` search to tokenise
  on whitespace (so "image convert" matches), debounce, and hide with `hidden` not `style.display`.

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
`814.ffmpeg.js` is a hardcoded webpack chunk hash that 404s on any version bump (it already broke
once, commit `085863b`) — and `tests/deployed-site.test.js` *pins* it, so the test breaks too.
Discover the chunk at runtime. Add a cancel button. VP9 instead of VP8.

### P9 — docs
`CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ADDING_A_TOOL.md`, `CONTRIBUTING.md`, README rewrite,
`docs/ROADMAP.md`, issue/PR templates. Reunify `backend.py` onto `api/_lib/`.

---

## Constraints (decided, do not relitigate)

- **Instagram stays anonymous.** No session cookies, no login, no third-party downloader APIs.
- **No bundler, no framework, no runtime build step.** ES modules with **explicit `.js`
  extensions** — browsers require them, Babel/Jest tolerate omission, so a missing one passes tests
  and 404s in production.
- **Relative hrefs only.** GitHub Pages serves from `/UTH/`; a root-absolute path breaks there.
- Babel is a **test-time devDependency only**. Nothing is compiled for deployment.

---

## Gotchas

- **The ESM migration will break `file://`.** `type="module"` is CORS-blocked on `file://`, and the
  README currently tells users to open HTML files directly. `npm run dev` (port 5500) and
  `npm run dev:api` (port 5000) exist for this. Ship the README fix and a **classic** (non-module)
  inline `<head>` guard that renders a visible banner in the same PR — a module under `file://`
  never executes, so the guard cannot itself be a module.
- **`api/_lib/` cross-directory imports are unverified on Vercel's Python runtime.** Confirm on a
  preview deploy before relying on it. This is why `backend.py` currently carries a duplicated
  proxy route with a note rather than importing a shared one.
- **`vercel.json` `functions.maxDuration: 60` is unverified** against the account plan. Try it on a
  preview first; fall back to the 10s default with a 2-strategy cascade if rejected.
- **PR-preview E2E needs `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` repo secrets.** Without them the
  job skips (deliberately — silently re-testing production would report a false pass).
- **Playwright is not installed.** jsdom cannot do canvas pixels, `toBlob`, `SharedArrayBuffer` or
  `EyeDropper`, which is exactly where the remaining image/video bugs live. Add it when P6/P7 need it.
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
```

**No automated test checks that a downloaded file is actually correct.** For any Instagram or
YouTube change, download a real asset and inspect it — pixel dimensions for images, `ffprobe` for
video. That is the entire point of the P0/P3/P4 work.
