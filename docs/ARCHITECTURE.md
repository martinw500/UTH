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
                              └──> yt-dlp / instaloader ──> YouTube, Instagram
```

Two hosts serve the same static files. Only Vercel runs the API, so both
frontends call `https://useful-tool-hub.vercel.app/api/...` in production.
`js/config.js` picks the right base URL from the hostname.

## Layout

```
index.html            Homepage. Tool cards are static HTML — see "Why" below.
script.js             Homepage search/filter.
styles.css            All styling. Design tokens are CSS custom properties on :root.

js/config.js          API base URL (classic script, loaded by the downloaders).
js/shared/*.js        ES modules shared between tools. Fully unit-tested.
                      geometry, pipeline, compression, convolve, exif, zip, ico,
                      convert-registry, pdf-pages, ffmpeg, image, colour, qr…
                      Geometry, edit pipeline, compression, zip, ico, exif,
                      convert-registry, pdf-pages, ffmpeg, colour, qr…
js/vendor/*.js        Third-party code, vendored deliberately. See js/vendor/README.md.

<tool>/index.html     One directory per tool.
<tool>/js/<tool>.js   Its wiring. Pure logic belongs in a separate module.

api/<name>/index.py   Vercel serverless function. Flask app per file.
backend.py            Local dev mirror of the api/ functions. Excluded from deploys.

tests/                Jest. jsdom by default; deployed-site.test.js is node + live HTTP.
scripts/              Verification that needs a real browser.
```

## Two kinds of tool

**Client-side** (image, video, audio, colour, QR) — everything happens in the
browser. Canvas, ffmpeg.wasm, or plain maths. No server involved, nothing
uploaded.

**Server-backed** (YouTube, Instagram) — a Vercel function resolves media URLs
with `yt-dlp` / `instaloader`, and a second function proxies the download so the
browser can fetch it despite CORS.

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
what the shipped file did. Argument builders, encoders and converters now live in
importable modules (`video-args.js`, `audio-args.js`, `js/shared/qr.js`) and the
tests import the real thing.

## ffmpeg.wasm

Both converters share `js/shared/ffmpeg.js`. It never touches the DOM — the two
pages have different markup, so all feedback goes out through
`onProgress` / `onStatus` / `onLog` callbacks.

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
| Page wiring | `tests/qr-generator-page.test.js` | An id in the script that the HTML does not have |
| Markup | `tests/html-structure.test.js` | Missing controls, broken internal links, counter drift |
| Conventions | `tests/esm-conventions.test.js` | Import paths that 404 only in a browser |
| Deployed site | `tests/deployed-site.test.js` | Headers, 404s, CDN availability |
| Real browser | `scripts/verify-*.mjs` | Everything above missed |

**The last row is not optional.** jsdom has no canvas, no `toBlob` and no
`SharedArrayBuffer`, so for anything producing a file the unit suite mostly
proves the code did not throw. Two ffmpeg bugs shipped to production while 500+
tests were green, and every `verify:*` script since has caught a real bug while
being written.

There is one script per artefact-producing tool:

| Script | Proves |
| --- | --- |
| `verify-converters.mjs` | video/audio pages convert, ffprobe agrees |
| `verify-image-editor.mjs` | format magic bytes, JPEG matte, crop at a narrow viewport |
| `verify-convert-hub.mjs` | routing, rendered options, a real MP4, no ffmpeg for images |
| `verify-favicon.mjs` | a **different** unzip reads the archive; .ico offsets hit real PNGs |
| `verify-pdf-tools.mjs` | page counts and rotations, read back out of the output |

Two habits they all follow. **Wait for the artefact to change, not merely to
exist** — the previous run leaves a blob URL behind, so waiting on the selector
alone reads a stale result and every assertion is one export behind. And
**verify with a different implementation than the one under test**: asserting
our own zip byte layout back at ourselves would prove nothing.

## Deployment gating

`vercel.json` sets `buildCommand: "npm run test:build"`, and `deploy.yml` gates
Pages on a test job. **A failing unit test freezes both deploys.** Keep the unit
suite hermetic — anything needing the network or a browser belongs in
`deployed-site.test.js` or `scripts/`, both of which are excluded.
