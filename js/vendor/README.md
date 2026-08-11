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

## pdf-lib

- **Upstream:** https://github.com/Hopding/pdf-lib
- **Package:** `pdf-lib` on npm
- **Version:** 1.17.1
- **Licence:** MIT — see `pdf-lib.LICENSE.txt`

| File here | From the npm tarball |
| --- | --- |
| `pdf-lib.js` | `dist/pdf-lib.esm.min.js` |

**Modifications: the trailing `//# sourceMappingURL=` comment was deleted.** The
map file is not vendored, so the comment only produced a 404 in devtools. The
bundle is otherwise byte-for-byte upstream.

The **ESM** build, not the UMD one: this project has no bundler, and the page
imports it as a module like everything else. It is self-contained — the bundle
has no `import` statements at all, so there is nothing for a browser to resolve
and nothing for `tests/esm-conventions.test.js` to object to.

It is the single largest file in the repo at ~510 KB. That buys merge, split,
reorder, rotate and image-to-PDF entirely in the browser, with no upload of
documents that are frequently contracts, passports or medical records.

**No page rendering.** pdf-lib cannot rasterise, so the toolkit shows pages as
numbered cards rather than thumbnails. Thumbnails would mean vendoring pdf.js
and its worker as well — a much larger second dependency for a preview.

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
