# Vendored third-party code

Do not edit these files. To update one, re-vendor it from upstream and redo the
modifications listed below.

They are vendored rather than loaded from a CDN because this project has no
bundler, and because a pinned CDN URL has already broken production once — see
the `814.ffmpeg.js` note in `STATE.md`. A vendored file cannot 404, works
offline, and can be unit-tested directly.

**Two deliberate exceptions load from pinned CDN URLs instead:** tesseract.js
(OCR; `js/shared/ocr.js`) and transformers.js with the Whisper model
(`transcribe/js/worker.js`). Their wasm and models run to tens of megabytes —
~77 MB for Whisper alone — that would sit in git for one tool each. Every URL
names an exact version (the model an exact revision) and lives in a constant in
those files; update them there, not here.

**Vendor single files, never a whole package directory.** Jest ignores
`js/vendor/`, but the rule keeps this folder auditable, and anywhere else a
package's own `tests/` folder would match `**/tests/**/*.test.js` and silently
enrol a third party's suite into `npm run test:build`, which gates the Vercel
deploy.

---

## qrcode-generator

- **Upstream:** https://github.com/kazuhikoarase/qrcode-generator
- **Package:** `qrcode-generator` on npm
- **Version:** 2.0.4
- **Licence:** MIT — see `qrcode-generator.LICENSE.txt`

| File here | From the npm tarball |
| --- | --- |
| `qrcode-generator.js` | `dist/qrcode.mjs` |
| `qrcode-generator-utf8.js` | `dist/qrcode_UTF8.mjs` |

**Modifications: none.** Both files are byte-for-byte copies; only the names
changed, so that `tests/esm-conventions.test.js` sees the `.js` extension the
browser requires.

### Why the second file

`qrcode-generator.js` defaults to a Latin-1 byte conversion:

```js
qrcode.stringToBytes = function (s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) bytes.push(s.charCodeAt(i) & 0xff);
    return bytes;
};
```

That truncates every non-Latin-1 character to one byte, so `☕` (U+2615) encodes
as `0x15` and the QR decodes to mojibake — silently, with no error. Upstream
ships the UTF-8 converter separately, and `js/shared/qr.js` installs it:

```js
qrcode.stringToBytes = stringToBytes;   // from qrcode-generator-utf8.js
```

`tests/qr.test.js` pins this. Do not remove the override.

---

## pdf-lib

- **Upstream:** https://github.com/Hopding/pdf-lib
- **Package:** `pdf-lib` on npm
- **Version:** 1.17.1
- **Licence:** MIT — see `pdf-lib.LICENSE.md`. The bundle also embeds tslib
  (Microsoft, Apache-2.0); its notice is in the file header, which is why the
  header must not be stripped.

| File here | From the npm tarball |
| --- | --- |
| `pdf-lib.js` | `dist/pdf-lib.esm.min.js` |

- **SHA-256:** `72c052d97b4d5d9fa6cdbdcb7ad709f03d4ddb1122390cb3afeba4d88651d969`
- **Modifications: none.** A byte-for-byte copy, renamed.

The **ESM** build is vendored, not the UMD one, so the PDF pages can `import`
it directly instead of loading a classic script first and reading a global.

Re-vendor with:

```bash
curl -sSL -o js/vendor/pdf-lib.js \
  https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js
```

**pdf-lib writes and edits PDFs; it does not render them.** Anything needing a
page rasterised (PDF → image, thumbnails, the signing stage) goes through
pdf.js, below.

---

## libheif-js

- **Upstream:** https://github.com/catdad-experiments/libheif-js (an Emscripten
  build of https://github.com/strukturag/libheif, with libde265 for HEVC)
- **Package:** `libheif-js` on npm
- **Version:** 1.23.2
- **Licence:** **LGPL-3.0** — see `libheif.LICENSE.txt`, which is the package's
  `libheif-wasm/LICENSE` (the LGPL and the GPL text it incorporates). The first
  non-permissive file here. It is shipped **unmodified** as a separate,
  dynamically loaded file, which is what the LGPL asks: anyone can swap in their
  own build of the library. **Do not edit it, inline it or minify it into
  another file** — that would make the including code a combined work.

| File here | From the npm tarball |
| --- | --- |
| `libheif-bundle.js` | `libheif-wasm/libheif-bundle.mjs` |

- **SHA-256:** `d05292271af008d300cc75be374feb8fd35b418a71420a556c3fb817f662b502`
- **Modifications: none.** A byte-for-byte copy, renamed to `.js`.

The **wasm-bundle** build: the ~1.4 MB `.wasm` is base64-inlined, so there is no
second file whose path has to resolve under `/UTH/`. About 2 MB, and loaded only
by `js/shared/heic.js`, which `decodeImageFile` imports only after the browser's
own decoder has failed on a HEIC file — Safari decodes HEIC natively, so most
iPhone users never download it.

**Decode only.** HEIC *encoding* needs x265, which is GPL-2.0 and would
relicense the site.

Re-vendor with:

```bash
curl -sSL -o js/vendor/libheif-bundle.js \
  https://cdn.jsdelivr.net/npm/libheif-js@1.23.2/libheif-wasm/libheif-bundle.mjs
```

---

## pdf.js

- **Upstream:** https://github.com/mozilla/pdf.js
- **Package:** `pdfjs-dist` on npm
- **Version:** 6.3.289
- **Licence:** Apache-2.0 — see `pdfjs.LICENSE.txt`. The fonts and wasm decoders
  under `assets/pdfjs/` carry their own licence files alongside them.

| File here | From the npm tarball |
| --- | --- |
| `pdfjs.js` | `legacy/build/pdf.min.mjs` |
| `pdfjs.worker.js` | `legacy/build/pdf.worker.min.mjs` |
| `../../assets/pdfjs/{cmaps,standard_fonts,wasm,iccs}/` | the directories of the same names |

- **SHA-256:** `pdfjs.js` `f401927e692efc7735e0cd528c490d0dd31b7f0972c122b7040df805be45cce4`,
  `pdfjs.worker.js` `a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e`
- **Modifications: none.** Byte-for-byte copies, renamed to `.js`.

The **legacy** build, because the modern one needs `Promise.withResolvers` and
iOS 17.0–17.3 fails at import with a bare `TypeError`. **The two files must be
the same version** — pdf.js refuses a mismatched worker — and
`tests/html-structure.test.js` checks it, and that this entry names it.

The asset directories are not single files, which is why they live under
`assets/pdfjs/` rather than here. They are fetched only when a document needs
them: cmaps for CJK text, standard fonts for PDFs that do not embed theirs,
and wasm decoders for JPEG 2000 and JBIG2 images, which scanned PDFs use.

**The worker is attached through `workerPort`, never `workerSrc`** — see
`js/shared/pdf-render.js`.

Re-vendor with:

```bash
npm pack pdfjs-dist@6.3.289 && tar xzf pdfjs-dist-6.3.289.tgz
cp package/legacy/build/pdf.min.mjs js/vendor/pdfjs.js
cp package/legacy/build/pdf.worker.min.mjs js/vendor/pdfjs.worker.js
cp package/LICENSE js/vendor/pdfjs.LICENSE.txt
rm -rf assets/pdfjs && mkdir -p assets/pdfjs
cp -R package/cmaps package/standard_fonts package/wasm package/iccs assets/pdfjs/
```
