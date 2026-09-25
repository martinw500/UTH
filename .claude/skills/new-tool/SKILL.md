---
name: new-tool
description: Add a new tool to Useful Tool Hub end to end — page, registry entry, homepage card, tests, verify script, STATE.md. Use when the user asks to add, create or build a new tool or tool page on the site.
argument-hint: <what the tool does>
---

Build the tool described in: $ARGUMENTS

[docs/ADDING_A_TOOL.md](../../../docs/ADDING_A_TOOL.md) is the checklist. Read
it in full before writing anything, and follow it rather than this file wherever
the two seem to differ — this file only adds order and a finish line.

1. **Pick the id and scope.** Kebab-case directory name. Decide whether it runs
   on device or needs `api/`; on device is the default. If the tool overlaps an
   existing one (`js/shared/tools.js` lists them all), say so and ask before
   building a duplicate.
2. **Pure logic first**, in its own module, with its `tests/<tool>.test.js`
   importing the real module. Cover the edge cases a user will actually hit:
   empty input, huge input, non-ASCII text, bad files.
3. **The page**, copied from `qr-generator/index.html`, wiring only in
   `js/<tool>.js`. Reuse the `js/shared/*` modules from the checklist's table
   instead of writing new versions. For the look, use the `frontend-design`
   skill, but inside the site's existing `styles.css` language, not a new one.
4. **Homepage**: registry entry, static card, both counters.
5. **Test wiring**: `html-structure.test.js`, `deployed-site.test.js`, and
   `esm-conventions.test.js` if a shared module applies classes.
6. **If it produces a file**: `scripts/verify-<tool>.mjs` plus its npm script.
7. **STATE.md** — tool count, and anything the change made untrue.

## Done means

- `npm test` green.
- With `npm run dev` running, the tool clicked through in a real browser, and
  its `verify:*` script passing if it has one. A green jsdom suite alone does
  not count for canvas, workers, `SharedArrayBuffer` or downloads.
- Every href and import relative, every import with an explicit `.js`.

Report what was built, what was verified and how, and anything skipped. Don't
commit unless asked.
