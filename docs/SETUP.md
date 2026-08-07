# Setting up on a new machine

Everything below assumes a clone of https://github.com/martinw500/UTH.

---

## 1. Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| **Node.js** | 20 or newer (CI pins 20; 22 works) | tests, dev server |
| **Python** | 3.12 (see `.python-version`) | the local API backend |
| **Git** | any | — |
| **ffmpeg** + **ffprobe** | any recent | **only** `npm run verify:converters` |
| **unzip** or bsdtar | any | **only** `npm run verify:favicon` (Windows has bsdtar built in) |

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
pip install -r requirements.txt     # Flask backend deps
```

`npx playwright install` downloads ~115 MB to a shared location outside the repo
(`~/AppData/Local/ms-playwright` on Windows). It is a separate step from `npm ci`
and is easy to forget; every `verify:*` script fails without it.

A virtualenv for the Python side is optional but tidy:

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows;  source .venv/bin/activate  elsewhere
pip install -r requirements.txt
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

`js/config.js` auto-detects localhost and points the frontend at the local
backend, so no configuration is needed.

You only need `dev:api` if you are working on the YouTube or Instagram
downloaders. Every other tool is client-side.

## 4. Check everything works

```bash
npm test                     # ~1200 unit tests, no network needed

# Real-browser checks. All need `npm run dev` running in another terminal.
npm run verify:converters    # video + audio pages (also needs ffmpeg/ffprobe)
npm run verify:image-editor  # image editor: exported bytes, crop at a narrow viewport
npm run verify:convert-hub   # convert/ hub: routing, rendered options, a real MP4
npm run verify:favicon       # unzips the output with a DIFFERENT implementation
npm run verify:pdf-tools     # reads produced PDFs back, checks pages and rotation
```

The `verify:*` scripts matter more than their runtime suggests. jsdom has no
canvas, no `toBlob` and no `SharedArrayBuffer`, so the unit suite cannot see the
class of bug that has actually broken this project — **every one of these scripts
caught a real bug while being written.** Run whichever covers what you touched;
`verify:converters` is the one after any change to `js/shared/ffmpeg.js`.

Each can be pointed at a deployment instead of localhost:

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
a change before it reaches production. To have CI test previews automatically, add
two repository secrets (Settings → Secrets and variables → Actions):

- `VERCEL_TOKEN` — Vercel dashboard → Account Settings → Tokens
- `VERCEL_PROJECT_ID` — Vercel project → Settings → General

Without them the E2E job **skips** rather than silently re-testing production and
reporting a false pass.

## 6. Where to pick the work back up

**[STATE.md](../STATE.md) is the source of truth** for what is done, what is
next, and which decisions are settled. Read it first. It is deliberately kept
short and current — if something in it is no longer true, delete it.

See also [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together, and
[ADDING_A_TOOL.md](ADDING_A_TOOL.md) when building something new.
