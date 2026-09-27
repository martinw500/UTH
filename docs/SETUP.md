# Setting up on a new machine

Everything below assumes a clone of https://github.com/martinw500/UTH.

---

## 1. Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| **Node.js** | 22 (CI pins 22; jsdom needs at least 20.19) | tests, dev server |
| **Python** | 3.12 (see `.python-version`) | the local API backend, `npm run verify:api` |
| **Git** | any | — |
| **ffmpeg** + **ffprobe** | any recent | the `verify:*` scripts that read media back: converters, convert-hub (HEIC), photo-privacy, pdf-tools |
| **unzip** or bsdtar | any | `npm run verify:favicon` and `verify:pdf-tools` (Windows has bsdtar built in) |
| **pdfinfo**, **pdftoppm** (poppler) | any | `npm run verify:pdf-tools` reads output back with them, and rasterises signed pages to find the ink |
| **exiftool** | any | `npm run verify:photo-privacy` reads the cleaned photos back with it (and ffmpeg). On macOS it also uses `sips` to make a HEIC |

`ffmpeg`/`ffprobe` must be **on your PATH**, not just installed. On Windows:

```powershell
winget install Gyan.FFmpeg
```

Then reopen the terminal and check:

```bash
node -v && python --version && ffmpeg -version | head -1 && ffprobe -version | head -1
```

Nothing in the deployed site uses your local ffmpeg — the converters run
[ffmpeg.wasm](https://ffmpegwasm.netlify.app/) in the browser. It is only used to
*verify* their output.

## 2. Install

```bash
npm ci                              # exact versions from package-lock.json
npx playwright install chromium     # browser for every verify:* script — npm ci does NOT do this
pip install -r requirements-local.txt   # Flask backend deps, plus yt-dlp
```

`npx playwright install` downloads ~115 MB to a shared location outside the repo
(`~/AppData/Local/ms-playwright` on Windows). It is a separate step from `npm ci`
and is easy to forget; every `verify:*` script fails without it.

A virtualenv for the Python side is optional but tidy:

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows;  source .venv/bin/activate  elsewhere
pip install -r requirements-local.txt
```

## 3. Run it

Two servers, two terminals:

```bash
npm run dev        # static site on http://localhost:5500
npm run dev:api    # Flask API on  http://localhost:5000
```

Then open **http://localhost:5500/**.

> **Do not open the HTML files directly from disk.** Several pages load ES
> modules, which browsers block over `file://` — the page renders blank. Those
> pages detect it and show an explanation, but the fix is always `npm run dev`.

`js/shared/config.js` picks the API from the hostname: localhost talks to the
local backend, a Vercel deployment (production or preview) to its own `/api/`,
and GitHub Pages to production. No configuration is needed.

`backend.py` listens on 127.0.0.1 with Flask's debugger off. Set
`BACKEND_HOST=0.0.0.0` to reach it from another device, and `FLASK_DEBUG=1` for
the debugger — never both on a network you do not trust.

You only need `dev:api` if you are working on the YouTube or Instagram
downloaders. Every other tool is client-side.

## 4. Check everything works

```bash
npm test                     # ~1600 unit tests, no network needed

# Real-browser checks. All need `npm run dev` running in another terminal.
npm run verify:converters    # video + audio pages (also needs ffmpeg/ffprobe)
npm run verify:image-editor  # image editor: exported bytes, crop, undo, preview size
npm run verify:convert-hub   # convert/ hub: routing, rendered options, cancel, a real MP4
npm run verify:favicon       # unzips the output with a DIFFERENT implementation
npm run verify:pdf-tools     # pdfinfo/pdftoppm read the output: pages, rotation, where a signature landed
npm run verify:photo-privacy # exiftool finds nothing identifying; ffmpeg decodes identical pixels
npm run verify:text-from-image # OCRs known text back, from an image and a scanned PDF (needs network)
npm run verify:transcribe    # transcribes speech made by macOS `say` (needs network and macOS)
npm run verify:chrome        # theming, mobile nav, focus, contrast on every page
npm run verify:downloaders   # YouTube/Instagram pages; also needs `npm run dev:api`

# No browser: the Python API through Flask's test client, upstream faked out.
npm run verify:api
```

The `verify:*` scripts matter more than their runtime suggests. jsdom has no
canvas, no `toBlob` and no `SharedArrayBuffer`, so the unit suite cannot see the
class of bug that has actually broken this project — **every one of these scripts
caught a real bug while being written.** Run whichever covers what you touched;
`verify:converters` is the one after any change to `js/shared/ffmpeg.js`.

Each browser script can be pointed at a deployment instead of localhost:

```bash
SITE_URL=https://useful-tool-hub.vercel.app npm run verify:converters
```

### The other test commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit suite. Hermetic — no network, no browser. |
| `npm run test:build` | **What Vercel runs on deploy.** If it fails, deploys freeze. |
| `npm run test:ci` | Same plus coverage; what GitHub Actions runs. |
| `npm run test:e2e` | Fetches the **live deployed site**. Set `SITE_URL` to target a preview. |

## 5. Deployment

Push to `main` and both hosts update themselves:

- **Vercel** — https://useful-tool-hub.vercel.app — the whole site **and** the
  `api/` serverless functions. Deploys via its own Git integration.
- **GitHub Pages** — https://martinw500.github.io/UTH/ — frontend only, no API.
  Deploys via `.github/workflows/deploy.yml`.

Both gate on the test suite. **GitHub Actions can take ~15 minutes to even create
a run** after a push — an empty Actions list right after pushing means "not yet",
not "broken".

Vercel also builds a **preview deployment for every branch**, which is how to test
a change before it reaches production. CI finds the deployment for the exact
commit it is testing through the Vercel API — the PR's preview, or on a push the
production build — which needs two repository secrets (Settings → Secrets and
variables → Actions):

- `VERCEL_TOKEN` — Vercel dashboard → Account Settings → Tokens
- `VERCEL_PROJECT_ID` — Vercel project → Settings → General

Without them a PR's E2E job **skips** rather than silently re-testing production
and reporting a false pass, and a push falls back to a fixed wait before testing
production.

## 6. Where to pick the work back up

**[STATE.md](../STATE.md) is the source of truth** for what is done, what is
next, and which decisions are settled. Read it first. It is deliberately kept
short and current — if something in it is no longer true, delete it.

See also [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together, and
[ADDING_A_TOOL.md](ADDING_A_TOOL.md) when building something new.
