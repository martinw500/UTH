# Vendored third-party code

Do not edit these files. To update one, re-vendor it from upstream and redo the
modifications listed below.

They are vendored rather than loaded from a CDN because this project has no
bundler, and because a pinned CDN URL has already broken production once — see
the `814.ffmpeg.js` note in `STATE.md`. A vendored file cannot 404, works
offline, and can be unit-tested directly.

**Vendor single files, never a whole package directory.** Jest's `testMatch` is
`**/tests/**/*.test.js`, so a vendored directory containing its own `tests/`
folder would silently enrol a third party's suite into `npm run test:build` —
which gates the Vercel deploy.

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
page rasterised (PDF → image, thumbnails) needs pdf.js as well, which is a
separate, larger dependency with its own worker. It is deliberately not
vendored yet — see the PDF entry in `STATE.md`.
