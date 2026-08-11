# Read me before merging this branch

**Delete this file as part of the merge.** It exists only while
`youtube-error-recovery-and-transcript` is unmerged.

This branch was written on a base **16 commits behind `origin/main`** and has
**not** been rebased. The base is a clean ancestor — nothing diverged, nothing
upstream was touched — but `origin/main` independently shipped overlapping work
in the meantime. Resolving the conflicts mechanically would throw away one side
or the other.

```bash
git fetch origin
git log --oneline HEAD..origin/main      # the 16
git diff --name-only HEAD origin/main    # what they touched
```

## Take as-is — upstream touched none of it

`api/youtube/` (`_errors.py`, `index.py`, `download.py`, `subtitles.py`),
`backend.py`, `youtube-downloader/`, `youtube-transcript/`,
`js/shared/subtitles.js`, `js/shared/handoff.js`, `scripts/verify-pages.mjs`,
`scripts/verify-yt-errors.py`, and their tests.

This is the part that answers the original complaint, and it is uncontested.

## Decisions, not conflicts

| This branch | Upstream (`origin/main`) | Suggested |
| --- | --- | --- |
| `pdf-toolkit/` | `pdf-tools/` (commit `df3860b`) | **Drop mine.** Upstream's is broader — `optimisePdf`, `PAGE_SIZES`, `imagesToPdf` — and is wired into the tool registry. Worth porting: my `parsePageRange` returns `{ pages, errors }` and reports an out-of-range term instead of clamping it, so `1-500` on a 10-page file tells you the 500 was a typo rather than silently selecting everything. Its tests come with it. |
| `js/shared/exif.js` — parse **and strip** | `js/shared/exif.js` — parse only (`parseExif`, `summariseExif`, `readExifFromFile`) | **Keep upstream's reader, port my stripper onto it.** Upstream has no removal path at all. Mine rebuilds JPEG/PNG/WebP byte-for-byte rather than re-encoding through a canvas, which is the whole point — a canvas round-trip silently recompresses the photo. Different APIs, so this is a real merge. |
| `js/vendor/pdf-lib.js`, `pdf-lib.LICENSE.txt` | same bundle, `pdf-lib.LICENSE.md` | **Take upstream's.** Delete my duplicate licence file. |
| `index.html` with hand-written tool cards | tool-registry app shell (`784a0a1`, `js/shared/tools.js`) | **Drop my edits entirely.** Register the new tools in `tools.js` instead. My hardcoded `#toolCount` / `#visibleCount` bumps are meaningless against the registry. |
| `js/shared/handoff.js` | `js/shared/download.js`, `js/shared/objecturl.js` | Probably keep mine — cross-page transfer is a different job from saving a file — but check for overlap before assuming. |
| `STATE.md`, `CLAUDE.md`, `README.md`, `docs/*` | rewritten upstream (`c615219`, `a5348d7`) | **Re-apply my notes onto theirs.** Do not overwrite; upstream's rewrite is newer than my edits. |

## Then

1. `npm test` — 851 passed on this branch's base; expect the count to move once
   upstream's suites join.
2. `npm run verify:pages` and `npm run verify:yt-errors`.
3. **Open a PR rather than pushing to `main`** — this touches `api/`, and the
   Vercel preview is the only place `from _errors import error_payload` can be
   proven. It is a same-directory sibling import, safer than the `api/_lib/`
   case `STATE.md` warns about, but still unconfirmed on their Python runtime.
   All three YouTube functions fail together if it is wrong.
4. **Nothing here was run against live YouTube.** Every API check used mocked
   responses. Pull a real video through `npm run dev:api` before trusting it.
