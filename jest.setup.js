// Web APIs that jsdom does not provide, but every current browser does.
//
// Without these, code that is perfectly correct in a browser cannot even be
// imported under test -- which would push it out of the unit suite and into the
// browser-only scripts, where it is far more expensive to cover.

const { TextEncoder, TextDecoder } = require('node:util');

if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoder;
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoder;

// jsdom's Blob has no arrayBuffer(); Node's does.
if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = require('node:buffer').Blob;
} else if (typeof globalThis.Blob.prototype.arrayBuffer !== 'function') {
    const NodeBlob = require('node:buffer').Blob;
    globalThis.Blob = NodeBlob;
}

// CompressionStream is deliberately NOT polyfilled. js/shared/zip.js falls back
// to storing when it is missing, and that fallback is a real code path worth
// exercising -- a polyfill here would hide it.
