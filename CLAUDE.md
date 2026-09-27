# Useful Tool Hub — working notes

Read **[STATE.md](STATE.md)** first. It is the source of truth for what is done,
what is next, and which decisions are settled. This file is the short orientation.

- [docs/SETUP.md](docs/SETUP.md) — getting running on a new machine
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it fits together and why
- [docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md) — the checklist for a new tool;
  `/new-tool <what it does>` walks it end to end

## What this is

A static site of small tools. **No framework, no bundler, no build step** — the
files in the repo are the files the browser loads. Babel exists only so Jest can
import ES modules; nothing is compiled for deployment.

Dual-deployed: **Vercel** (whole site + `api/` Python functions) and **GitHub
Pages** (frontend only, served from `/UTH/`).

## Commands

```bash
npm test                    # unit suite, hermetic
npm run dev                 # static server on :5500  — required for module pages
npm run dev:api             # Flask backend on :5000
npm run test:e2e            # hits the live site; SITE_URL to target a preview
```

Real-browser checks. **All need `npm run dev` running**, and none are part of
`npm test` — they need a browser and a network, and `npm test` gates the deploy.
Run the one that covers what you touched:

```bash
npm run verify:converters    # video + audio pages; also needs ffmpeg/ffprobe on PATH
npm run verify:image-editor  # image editor: bytes, dragged crop, crop after rotate, undo
npm run verify:convert-hub   # convert/ hub: routing, options, cancel, a real MP4
npm run verify:favicon       # unzips the output with a DIFFERENT implementation
npm run verify:pdf-tools     # pdfinfo/pdftoppm read the output: pages, rotation, where a signature landed
npm run verify:photo-privacy # exiftool finds nothing identifying; pixels unchanged
npm run verify:chrome        # theming, nav, focus, contrast on every page
npm run verify:downloaders   # YouTube/Instagram pages; also needs npm run dev:api
npm run verify:api           # Python API input handling; no browser, no network
```

## Rules that are not preferences

- **Relative hrefs and imports only.** Pages serves from `/UTH/`; a root-absolute
  path 404s there.
- **Explicit `.js` on every import.** Babel tolerates omission, browsers do not —
  a missing one passes every test and 404s in production.
- **The homepage grid stays static HTML.** `deployed-site.test.js` fetches raw
  HTML with no JS; client-rendering it breaks every homepage assertion.
- **Keep `npm test` hermetic.** The same suite is `vercel.json`'s
  `buildCommand` (as `npm run test:build`), so a failure freezes both deploys. Network- or browser-dependent checks go in
  `deployed-site.test.js` or `scripts/`.
- **Pure logic lives in its own importable module**, and the test imports the
  real thing. A test carrying its own copy of a function is testing the copy —
  that is not hypothetical, it happened here three times.
- **Server text is inserted as text, never through `innerHTML`**, and a user's
  URL never reaches a fetching library as-is — rebuild it on an allowlisted host.
- **Update `STATE.md` in the same commit.** Delete what is no longer true; it
  describes the present, not history.

## Things that have actually broken this project

Each of these shipped to production and was invisible to a green test suite.

- **`import.meta` in a service worker.** A SW registered without
  `{ type: "module" }` is a classic script where `import.meta` is a *parse-time*
  error — its presence anywhere in the file, even on a dead branch, stops the
  whole script evaluating. Cross-origin isolation silently never turned on.
- **Feeding the UMD ffmpeg core to a module worker.** `classWorkerURL` makes
  ffmpeg build a `{ type: "module" }` worker, which has no `importScripts`; it
  falls back to `await import()` and reads `.default`, which UMD lacks. The
  worker must be UMD and the core must be ESM. Looks like a typo, isn't.
- **A hardcoded webpack chunk name** (`814.ffmpeg.js`) that 404s on version
  bumps. The name is never a literal in the bundle — webpack emits
  `u: e => e + ".ffmpeg.js"` and calls it `e.u(814)` — so it is discovered at
  runtime now.
- **A test that re-declared the function it was testing**, so it stayed green
  through any breakage of the real file.
- **Latin-1 truncation in the QR encoder.** `charCodeAt(i) & 0xff` turns `☕`
  into one wrong byte; the code scans fine and decodes to mojibake, no error.
- **A crop rect clamped in canvas pixels while drags were measured in CSS
  pixels.** The two units agree only when the canvas happens to be displayed at
  its attribute size, so every crop on a narrow viewport landed somewhere other
  than where it was drawn. It is stored normalised (0..1) now — don't "simplify"
  it back.
- **`createDropzone` calls `onReject` once per file with a single object**, not
  with an array. Two pages had written `rejections[0]`, so every rejection was
  swallowed and dropping an unsupported file gave no feedback at all.
- **The YouTube API passed any URL without a video id to yt-dlp**, whose generic
  extractor fetches whatever it is given: an SSRF and open relay. Only a URL
  rebuilt by `youtube_watch_url` reaches it now.
- **Preview space is not source space.** The image editor stored a crop drawn
  over the rotated preview as if it were in the source, so every crop after a
  rotate or flip kept the wrong region. `previewRectToCrop` does the mapping.
- **pdf-lib cannot decrypt.** With `ignoreEncryption` it happily wrote garbage
  from encrypted PDFs and reported success; they are refused at load.
- **Checks that could not fail.** An assertion inside a `try/catch` that caught
  its own failure; a regex whose `\b` had become a literal backspace byte; a
  narrow-viewport crop check that never dragged. **See a new check fail against
  the bug it guards — break the code on purpose — before trusting it.**

The pattern: for canvas pixels, `SharedArrayBuffer`, service workers, workers,
binary formats and downloads, **jsdom proves almost nothing**. Drive a real
browser and check the artefact — the `scripts/verify-*.mjs` files are the
template. Every one of them caught a real bug while being written.

Two rules those scripts follow, both learned the hard way:

- **Wait for the artefact to *change*, not merely to exist.** The previous run
  leaves a blob URL in the download link, so waiting on the selector alone reads
  a stale result and every assertion is silently one export behind.
- **Verify with a different implementation than the one under test.** The zip
  writer is checked by unzipping with Info-ZIP and PDFs are read back with
  pdfinfo; asserting our own byte layout back at ourselves would prove nothing.

## When verifying

- Don't conclude from one observation. GitHub Actions can take ~15 minutes to
  even create a run; an empty Actions list right after a push means "not yet".
- Don't diff a QR matrix against another library — the mask pattern is chosen by
  penalty scoring and two correct implementations legitimately differ. Decode it.
- Check both hosts. Vercel sets COOP/COEP headers server-side; GitHub Pages
  relies on a service worker, so a bug can be invisible on one and fatal on the
  other.
