# Architecture

Setup lives in [SETUP.md](SETUP.md); the checklist for a new tool is in
[ADDING_A_TOOL.md](ADDING_A_TOOL.md).

## The shape of it

A static site of independent tools, plus a small Python API for the two things
that cannot be done in a browser.

**No framework, no bundler, no build step.** The files in the repo are the files
the browser loads. Babel exists only so Jest can import ES modules at test time;
nothing is compiled for deployment.

```
Browser ──> GitHub Pages  (frontend only)
       └──> Vercel        (same frontend + /api/* serverless functions)
                              │
                              └──> instaloader ──> Instagram
```

Two hosts serve the same static files. Only Vercel runs the API.
`js/shared/config.js` picks the base URL from the hostname: a Vercel deployment,
production or preview, uses its own `/api/`; GitHub Pages borrows production's;
localhost uses the local `backend.py`.

## Layout

```
index.html            Homepage. Tool cards are static HTML — see "Why" below.
script.js             Homepage search/filter.
styles.css            All styling. Design tokens are CSS custom properties on :root.

js/shared/*.js        ES modules shared between tools. Pure ones are unit-tested;
                      the canvas, worker and download paths need scripts/.
                      Plumbing:  dom, format, storage, notify, clipboard,
                                 dropzone, objecturl, download, result-card,
                                 site-url, search, config
                      Maths:     geometry, pipeline, compression, convolve,
                                 exif, image, color, qr, zip, ico, pdf-pages
                      Media:     ffmpeg (loading and running ffmpeg.wasm)
                      Registries: tools (what tools exist),
                                 convert-registry (what converts to what)
js/vendor/*.js        Third-party code, vendored deliberately. See js/vendor/README.md.

<tool>/index.html     One directory per tool.
<tool>/js/<tool>.js   Its wiring. Pure logic belongs in a separate module.

api/<name>/*.py       Vercel serverless functions. One Flask app per file.
backend.py            Local dev mirror of the api/ functions. Vercel ignores it
                      (.vercelignore); GitHub Pages publishes it as a static
                      file, which is harmless since Pages runs nothing.

tests/                Jest. jsdom by default; deployed-site.test.js is node + live HTTP.
scripts/              Verification that needs a real browser.
```

## Two kinds of tool

**Client-side** (the convert hub, image, photo privacy, video, audio, PDF, favicon, colour, QR)
— everything happens in the browser. Canvas, ffmpeg.wasm, pdf-lib, or plain
maths. No server involved, nothing uploaded.

**Server-backed** (Instagram) — a Vercel function resolves media URLs with
`instaloader`, and a second function proxies the download so the browser can
fetch it despite CORS.

**Local only** (YouTube) — `api/youtube/` is in `.vercelignore`: YouTube answers
every cloud IP with a bot check, Vercel caps a response at ~4.5 MB and has no
ffmpeg. The page explains that unless its backend is on localhost, where
`backend.py` serves it with `yt-dlp` from `requirements-local.txt`.

The API only accepts what it can serve. `youtube_watch_url` rebuilds a watch URL
from an id on a YouTube host and only that reaches yt-dlp, whose generic
extractor would otherwise fetch any address it is given; the Instagram proxy
re-checks its host allowlist on every redirect, using the host `requests` will
really connect to rather than `urlparse`'s reading of it. Errors reach users as plain
sentences, never library output, which echoed the input back. The URL check is
copied into both YouTube functions until `api/_lib/` imports are proven on
Vercel (`backend.py`, which only runs locally, imports it), and
`scripts/verify-api.py` asserts the copies agree.

## Conventions that are load-bearing

### Relative paths only
GitHub Pages serves from `/UTH/`, so a root-absolute path like `/styles.css`
404s there. Every href and every import is relative.

### ES modules need explicit `.js` extensions
Browsers require them. Babel and Jest tolerate omission, so a missing extension
passes every test and 404s in production. `tests/esm-conventions.test.js`
enforces this, along with relative-only specifiers — bare specifiers like
`'lodash'` need a bundler or an import map, and this project has neither.

### Module pages need a `file://` guard
`type="module"` is CORS-blocked over `file://`, so the page renders blank with no
explanation. A **classic** inline `<head>` script sets `.needs-http` and CSS
swaps in a message. The guard cannot itself be a module — one would never run.

### The homepage grid stays static HTML
`tests/deployed-site.test.js` fetches raw HTML and never executes JavaScript.
Client-rendering the tool cards would break every homepage assertion. Same
reasoning for nav and footer: don't inject them, assert they match across pages.

### Pure logic goes in its own module
Not because it is tidier, but because the alternative rots. `tests/video-converter.test.js`
once re-declared its own copy of `buildFFmpegArgs`, so it stayed green no matter
what the shipped file did. The image editor's tests and the colour page did the
same thing until this was swept. Argument builders, encoders and converters live
in importable modules (`video-args.js`, `audio-args.js`, `js/shared/qr.js`,
`pdf-ops.js`, `favicon.js`) and the tests import the real thing. Page tests
(`*-page.test.js`) import the real page module into its real markup.

## ffmpeg.wasm

The video and audio converters and the hub's media engine share
`js/shared/ffmpeg.js`. It never touches the DOM, so all feedback goes out through
`onProgress` / `onStatus` / `onLog` callbacks, which follow the latest
`loadFFmpeg` caller since the instance is shared. `terminateFFmpeg` is the only
way to cancel a running conversion, and a crash discards the instance so the next
run loads a fresh one.

Three non-obvious things it handles:

1. **The worker chunk name is discovered at runtime.** `@ffmpeg/ffmpeg` is
   webpack-built and spawns its worker from a code-split file named after a chunk
   id. The name is *never a literal in the bundle* — webpack emits
   `u: e => e + ".ffmpeg.js"` and calls it as `e.u(814)` — so searching for the
   filename finds nothing. Hardcoding it broke production once.
2. **The worker comes from the UMD build, the core from the ESM build.** Passing
   `classWorkerURL` makes ffmpeg construct a `{ type: "module" }` worker, and
   module workers have no `importScripts`; it falls back to `await import()` and
   reads `.default`, which a UMD script does not have. This pairing looks like a
   typo and is not.
3. **Cross-origin isolation.** ffmpeg.wasm needs `SharedArrayBuffer`, which needs
   COOP/COEP headers. Vercel sets them via `vercel.json`. GitHub Pages cannot set
   headers at all, so each converter directory carries a `coi-serviceworker.js`
   that adds them and reloads the page. Service worker scope is path-based, hence
   one copy per directory. That file must parse as a **classic** script — it once
   contained `import.meta`, a parse-time error there, and silently never
   registered.

None of that is visible to jsdom, which is why the `scripts/verify-*.mjs` family exists.

## Testing layers

| Layer | File(s) | Catches |
| --- | --- | --- |
| Pure logic | `tests/*.test.js` | Wrong output for given input |
| Page wiring | `tests/*-page.test.js`, `tests/convert-ui.test.js` | An id the HTML lacks; state bugs in the handlers |
| Markup | `tests/html-structure.test.js` | Missing controls, any relative href/src that does not resolve, counter drift |
| Conventions | `tests/esm-conventions.test.js` | Import paths that 404 only in a browser |
| Deployed site | `tests/deployed-site.test.js` | Headers, and a 404 on any file a page loads (found by following imports) |
| API | `scripts/verify-api.py` | URLs that must never reach yt-dlp, redirects off the allowlist, temp files left behind |
| Real browser | `scripts/verify-*.mjs` | Everything above missed |

**The last row is not optional.** jsdom has no canvas, no `toBlob` and no
`SharedArrayBuffer`, so for anything producing a file the unit suite mostly
proves the code did not throw. Two ffmpeg bugs shipped to production while 500+
tests were green, and every `verify:*` script since has caught a real bug while
being written.

The scripts:

| Script | Proves |
| --- | --- |
| `verify-converters.mjs` | video/audio pages convert and ffprobe agrees, incl. trims, unplayable inputs, sample rate |
| `verify-image-editor.mjs` | magic bytes, JPEG matte, a dragged crop at a narrow viewport, crop after rotate, undo, preview size |
| `verify-convert-hub.mjs` | routing, rendered options, a real MP4, cancel then convert, per-file progress, no ffmpeg for images |
| `verify-favicon.mjs` | a **different** unzip reads the archive; .ico offsets hit real PNGs; SVG sources rasterise large |
| `verify-pdf-tools.mjs` | pages, sizes and rotations read back by **pdfinfo**; encrypted input refused; thumbnails render lazily; JPG export read by **ffprobe**; signatures land where placed at `/Rotate` 0 and 90, checked by rasterising with **pdftoppm** |
| `verify-photo-privacy.mjs` | **exiftool** finds no location, camera or serial; the ICC profile survives; **ffmpeg** decodes identical pixels; HEIC becomes JPEG |
| `verify-chrome.mjs` | theming, mobile nav, focus and real contrast on every page |
| `verify-downloaders.mjs` | server text is inserted as text; plain-text platform errors read as sentences |

Two rules for writing one. **Wait for the artefact to change, not merely to
exist** — the previous run leaves a blob URL behind, so waiting on the selector
alone reads a stale result and every assertion is one export behind. And
**verify with a different implementation than the one under test** where one
exists: asserting our own zip byte layout back at ourselves would prove nothing.
A new check should also be seen to fail against the bug it guards before it is
trusted — several here passed happily until someone broke the code on purpose.

## Deployment gating

`vercel.json` sets `buildCommand: "npm run test:build"`, and `deploy.yml` gates
Pages on a test job. **A failing unit test freezes both deploys.** Keep the unit
suite hermetic — anything needing the network or a browser belongs in
`deployed-site.test.js` or `scripts/`, both of which are excluded.
