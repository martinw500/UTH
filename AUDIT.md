# Audit — September 2026

Working list for the audit-fixes branch. Review baseline: `b14e8fd`.
Delete this file once every box is ticked or explained.

Order: broken tests first (they hide bugs), then High, backend safety, Medium, Low,
remaining tests, CI, docs.

## Tests that cannot catch what they claim
- [x] T1 `tests/image-editor.test.js:138-229` tests re-declared copies of `previewScaleFor` and the aspect helpers
- [x] T2 `tests/color-converter.test.js` tests `js/shared/color.js`, which the page never loads (→ #25)
- [x] T3 `tests/shared-modules.test.js:107-126` tests `js/shared/config.js`, which ships nowhere (→ #30)
- [x] T4 ~~compares 4 bytes to `'PK'`~~ — false alarm: the literal held raw `` bytes. Rewritten as visible escapes
- [x] T5 `tests/deployed-site.test.js:929-951` try/catch swallows the 404 assertion

## High
- [x] 1 `setBusy` never restores the idle label (`js/shared/dom.js:56`)
- [x] 2 Image editor crop lands in the wrong place after rotate/flip/straighten
- [x] 3 Slider undo loses the pre-drag value (`image-converter.js:822-839`)
- [x] 4 Encrypted PDFs processed into broken output, reported as success (`pdf-ops.js:13-25`)
- [x] 5 Long filenames lose their extension (`format.js:91` via `download.js:126`)
- [x] 6 Audio converter rejects files the browser cannot preview (`audio-converter.js:215-219`)
- [x] 7 Cancel shows the previous run's results (`image-converter.js:628-666`, `convert/js/main.js:177-238`)

## Downloaders / backend (safety only; P3/P4 stay on the roadmap)
- [x] 27 SSRF: YouTube API passes any URL to yt-dlp's generic extractor
- [x] 28 `mkdtemp()` never removed (`api/youtube/download.py:41`, `backend.py:408`)
- [x] 29 Self-XSS via `innerHTML` in `youtube-downloader.js:32` and `displayVideoInfo`
- [x] 26 Non-JSON error bodies parsed as JSON on both downloaders
- [x] 30 Downloaders load legacy `js/config.js` → previews call localhost (P2b)
- [x] 35 Instagram proxy follows redirects past the allowlist (`proxy.py:71`, `backend.py:227`)
- [x] 34 `backend.py` runs `debug=True` on `0.0.0.0`
- [x] 31 Client URL validation rejects real YouTube/Instagram URLs
- [x] 32 Raw yt-dlp bot-check text shown to users
- [x] 33 YouTube download errors invisible; extension can mismatch container

## Medium
- [x] 8 Canvas PNG fallback ignored → `.webp` that is really PNG
- [x] 9 Crop label / numeric fields / aspect wrong after a first crop (`croppableSize`)
- [x] 10 PDF Run button re-enabled mid-run (`pdf-tools.js:94`)
- [x] 11 Images→PDF ignores EXIF orientation; MIME-mismatched file throws raw error
- [x] 12 Hub progress shows item 1's name, sits at 100% on later runs (`ffmpeg.js:154-164`)
- [x] 13 Hub engine import failure leaves UI stuck (`convert/js/main.js:192`)
- [x] 14 Hub: unpreviewable video gets a fake 60 s duration (`media.js:46,82`)
- [x] 15 Trim end floored → end of file cut, `-to` added unasked
- [x] 16 loudnorm + WAV/FLAC + keep-original rate → 192 kHz
- [x] 17 Video converter keeps the previous file's trim start / metadata
- [ ] 18 Favicon from viewBox-only SVG rasterised tiny then upscaled
- [x] 19 ffmpeg non-zero exit reported as success; `input.mp4 → mp4` returns the original
- [x] 20 ffmpeg crash leaves the engine dead until reload
- [x] 21 Target size overshoots (audio + container not budgeted)
- [x] 22 Hub options drop target size / trim on format change
- [x] 23 Hub Cancel cannot stop the current file
- [x] 24 Straighten ignored by `outputSize` (`pipeline.js:108-123`)
- [x] 25 Colour page runs its own copy of the maths (P2c) + P7 bug trio

## Low
- [ ] L-a Edge crop handles snap back with an aspect ratio (`geometry.js:114`)
- [x] L-b Opus + 44.1/22.05 kHz fails (`audio-args.js:89`)
- [ ] L-c Page range `20-` on a 10-page PDF selects page 10 (`pdf-pages.js:53-60`)
- [ ] L-d `MAX_CANVAS_DIMENSION` never enforced (`image.js:9`)
- [ ] L-e Files over the batch cap dropped silently (image 50, PDF 40, hub 30)
- [x] L-f Video converter drops unsupported files silently
- [x] L-g `input..mp4` double dot (`media.js:65`)
- [x] L-h ffmpeg blob URLs never revoked
- [ ] L-i `reorderPdf` accepts duplicate pages
- [ ] L-j Image preview width only shrinks (verify in a browser first)
- [ ] L-k `parseColor` accepts garbage / out-of-range (`color.js:627`)
- [ ] L-l Search spelling hints fire on correct words; accented words split
- [x] L-m YouTube keyword `mp3` promises audio the tool cannot produce
- [x] L-n Instagram duplicate "Need help?" link, unreachable rate-limit branch
- [ ] L-o QR textarea has no `maxlength`
- [ ] L-p `requirements.txt` unpinned

## Remaining test gaps
- [ ] T6 Narrow-viewport crop check never drags
- [ ] T7 `verify-pdf-tools` reads back with pdf-lib; root-absolute import; no pre-rotated fixture
- [ ] T8 Only one of three `coi-serviceworker.js` parse-checked
- [ ] T9 `/convert/` COOP/COEP headers untested
- [ ] T10 ffmpeg version literals in HTML not tied to `FFMPEG_VERSION`
- [ ] T11 Dead `matchesQuery` and its tests
- [ ] T12 "nav links are valid" cannot fail
- [ ] T13 QR page test waits on real timers
- [ ] T14 `deployed-site.test.js` lacks convert / favicon / pdf-tools coverage; misnamed tests
- [ ] T15 Unit tests for `setBusy`, `pdf-ops.js`, `favicon.js`, `sanitiseFilename`

## CI
- [ ] C1 `sleep 30` before production E2E can test the previous deploy
- [ ] C2 Node 20 (EOL) in workflows
- [ ] C3 No `concurrency:` group on Pages deploy
- [ ] C4 `ci.yml:81` step name overstates what it greps

## Docs (last)
- [ ] D  README, STATE.md, CLAUDE.md, docs/ against the code

## Deferred (stays on the STATE.md roadmap)
P3 Instagram rewrite; P4 YouTube 360p / `send_file` cap; Safari COEP `credentialless`
(verify on real Safari first); streaming zip writer; folding converters into the hub.
