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

`ffmpeg` on PATH also unlocks the local YouTube downloader's full quality range:
`api/` and `backend.py` both check for it at request time and report the answer
to the frontend as `server_can_merge`. Without it the local backend behaves like
the hosted one and can only serve 360p.

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
npx playwright install chromium     # browser for verify:converters — npm ci does NOT do this
pip install -r requirements.txt     # Flask backend deps
```

`npx playwright install` downloads ~115 MB to a shared location outside the repo
(`~/AppData/Local/ms-playwright` on Windows). It is a separate step from `npm ci`
and is easy to forget; `verify:converters` and `verify:pages` both fail without it.

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

`js/shared/config.js` auto-detects localhost and points the frontend at the local
backend, so no configuration is needed. (`js/config.js` is the old classic-script
version, still loaded by the Instagram page alone.)

You only need `dev:api` if you are working on the YouTube tools or the Instagram
downloader. Every other tool is client-side.

**The local backend is not just a convenience for the YouTube tools — it is
strictly better than the hosted one.** It has ffmpeg, so it can merge separate
video and audio streams and offer every quality; and it runs on a residential IP,
which YouTube bot-checks far less than the datacenter IPs the deployed functions
sit on. When the live site says "YouTube blocked our server", this is the fix it
points people at.

## 4. Check everything works

```bash
npm test                    # 851 unit tests, no network needed
npm run verify:pages        # real browser; needs `npm run dev` running
npm run verify:yt-errors    # the yt-dlp error classifier; no server needed
npm run verify:converters   # real browser + ffprobe; needs `npm run dev` running
```

`verify:converters` is the important one after any change to `js/shared/ffmpeg.js`
or either converter. It drives a real browser and ffprobes the output, because
the bugs that actually broke production were invisible to the unit suite. It can
also be pointed at a deployment:

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
| `npm run verify:pages` | Opens every module page in Chromium; fails on any console error or 404. |
| `npm run verify:yt-errors` | Checks the Python yt-dlp error classifier against real upstream messages. |

`verify:pages` catches what jsdom structurally cannot: an import specifier missing
its `.js`, a path only jest can resolve, a module that threw before wiring its
listeners. It is also the only coverage `js/shared/handoff.js` has, since jsdom
provides no IndexedDB.

Run `verify:yt-errors` after touching `api/youtube/_errors.py`. The matching is
substring-based over English text yt-dlp can reword at any release, and getting it
wrong is silent — the user simply gets advice for a problem they do not have.

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
