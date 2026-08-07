# Useful Tool Hub — working notes

Read **[STATE.md](STATE.md)** first. It is the source of truth for what is done,
what is next, and which decisions are settled. This file is the short orientation.

- [docs/SETUP.md](docs/SETUP.md) — getting running on a new machine
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it fits together and why
- [docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md) — the checklist for a new tool

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
npm run verify:converters   # real browser + ffprobe; needs `npm run dev` running
npm run test:e2e            # hits the live site; SITE_URL to target a preview
```

## Rules that are not preferences

- **Relative hrefs and imports only.** Pages serves from `/UTH/`; a root-absolute
  path 404s there.
- **Explicit `.js` on every import.** Babel tolerates omission, browsers do not —
  a missing one passes every test and 404s in production.
- **The homepage grid stays static HTML.** `deployed-site.test.js` fetches raw
  HTML with no JS; client-rendering it breaks every homepage assertion.
- **Keep `npm test` hermetic.** It is `vercel.json`'s `buildCommand`, so a
  failure freezes both deploys. Network- or browser-dependent checks go in
  `deployed-site.test.js` or `scripts/`.
- **Pure logic lives in its own importable module**, and the test imports the
  real thing. A test carrying its own copy of a function is testing the copy —
  that is not hypothetical, it happened here.
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

The pattern: for canvas pixels, `SharedArrayBuffer`, service workers, workers and
downloads, **jsdom proves almost nothing**. Drive a real browser and check the
artefact — `scripts/verify-converters.mjs` is the template.

## When verifying

- Don't conclude from one observation. GitHub Actions can take ~15 minutes to
  even create a run; an empty Actions list right after a push means "not yet".
- Don't diff a QR matrix against another library — the mask pattern is chosen by
  penalty scoring and two correct implementations legitimately differ. Decode it.
- Check both hosts. Vercel sets COOP/COEP headers server-side; GitHub Pages
  relies on a service worker, so a bug can be invisible on one and fatal on the
  other.
