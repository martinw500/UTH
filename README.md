# Useful Tool Hub

A collection of useful tools in one place. I got tired of having to search up a ton of different
tools whenever I needed to use stuff, so I made this.

Will be updated with more tools as I build them out.

## Live Website

- **https://useful-tool-hub.vercel.app** — full site, including the downloaders
- **https://martinw500.github.io/UTH/** — same site on GitHub Pages (the downloaders call the
  Vercel API)

## Tools

| Tool | What it does | Runs |
| --- | --- | --- |
| **File Converter** | Images, video and audio between formats, in one place | browser |
| **YouTube Downloader** | Download videos in multiple formats and qualities | server |
| **Instagram Downloader** | Save photos and videos from public posts and reels | server |
| **Image Editor** | Crop, straighten, adjust, resize, compress — in batches | browser |
| **Video Converter** | MP4 / WEBM / GIF, trim, resize, extract audio | browser |
| **Audio Converter** | MP3 / M4A / OGG / Opus / WAV / FLAC, trim, extract from video | browser |
| **Colour Picker** | Convert between HEX, RGB and HSL | browser |
| **QR Code Generator** | Any text or link to a QR code, saved as PNG or SVG | browser |

"browser" means the file never leaves your machine.

## Documentation

| | |
| --- | --- |
| **[STATE.md](STATE.md)** | **Start here.** Current state, what's next, settled decisions. |
| [docs/SETUP.md](docs/SETUP.md) | Getting running on a new machine |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it fits together, and why |
| [docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md) | Checklist for adding a tool |
| [CLAUDE.md](CLAUDE.md) | Orientation for Claude Code sessions |

## Quick start

```bash
npm ci
npx playwright install chromium     # only for npm run verify:converters
pip install -r requirements.txt

npm run dev        # site on http://localhost:5500
npm run dev:api    # API on  http://localhost:5000  (only needed for the downloaders)
```

> **Do not open the HTML files straight from disk.** Several tools load ES modules, which browsers
> block over `file://`, so the page renders blank. Serve over HTTP with `npm run dev`.

Full details, including the ffmpeg/ffprobe prerequisite, in [docs/SETUP.md](docs/SETUP.md).

## Architecture in one paragraph

Static HTML/CSS/JS with **no framework, no bundler and no build step** — the files in the repo are
the files the browser loads. Python serverless functions under `api/` handle the two things a
browser cannot do (YouTube via `yt-dlp`, Instagram via `instaloader`); `backend.py` mirrors them
for local development. Everything else runs client-side via the Canvas API or ffmpeg.wasm. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project structure

```
index.html / styles.css / script.js   Homepage, global styles, search
js/config.js                          API base URL (local vs production)
js/shared/                            Shared ES modules (dom, format, image, colour, qr, ffmpeg…)
js/vendor/                            Vendored third-party code — see js/vendor/README.md
<tool>/index.html + <tool>/js/        One directory per tool
api/<name>/index.py                   Vercel serverless functions
backend.py                            Local dev mirror of the API
tests/                                Jest suite
scripts/verify-converters.mjs         Real-browser verification of the ffmpeg tools
```

## Tests

```bash
npm test                     # unit suite (~980 tests), no network needed
npm run verify:converters    # video + audio pages: real browser + ffprobe
npm run verify:image-editor  # image editor: real browser, checks exported bytes
npm run verify:convert-hub   # the convert/ hub: routing, options, a real MP4
npm run test:e2e             # checks the deployed site; SITE_URL to target a preview
```

The three `verify:*` scripts need `npm run dev` running in another terminal.

`npm test` is what Vercel runs on deploy, so a failure freezes deploys. For anything touching
canvas, workers or downloads, a green unit suite proves very little — jsdom has no canvas, no
`toBlob` and no `SharedArrayBuffer`, which is exactly where those bugs live. Use the `verify:*`
scripts; each one has caught a real bug that the unit suite could not see.

## Deployment

Push to `main`; both hosts update themselves and both gate on the test suite. Vercel also builds a
preview deployment for every branch. GitHub Actions can take ~15 minutes to create a run after a
push — an empty Actions list right afterwards means "not yet", not "broken".
