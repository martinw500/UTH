// pdf.js: seeing PDF pages, where pdf-lib can only edit them.
//
// Vendored (legacy build: the modern one needs Promise.withResolvers, which
// iOS 17.0-17.3 lacks, and fails at import with a bare TypeError) and imported
// only on first use -- it is ~0.5 MB plus a 1.3 MB worker.
//
// **The worker is constructed here, at { type: 'module' }, and handed over as
// workerPort -- never workerSrc**, which lets pdf.js guess classic-vs-module
// from the URL. The .mjs -> .js rename makes any such guess wrong: the same
// trap as ffmpeg's classWorkerURL in CLAUDE.md.
//
// cmaps (CJK text), standard fonts and the wasm image decoders (JPEG 2000 and
// JBIG2, which scanned PDFs use) live under assets/pdfjs/, fetched on demand.

import { siteUrl } from './site-url.js';

let libPromise = null;

function loadPdfjs() {
    libPromise ??= import('../vendor/pdfjs.js').then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(siteUrl('js/vendor/pdfjs.worker.js'), { type: 'module' });
        return pdfjs;
    }).catch((error) => {
        libPromise = null;
        throw error;
    });
    return libPromise;
}

/** Open a File as a pdf.js document. Hand it to closePdf when done. */
export async function openPdf(file) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        cMapUrl: siteUrl('assets/pdfjs/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: siteUrl('assets/pdfjs/standard_fonts/'),
        wasmUrl: siteUrl('assets/pdfjs/wasm/'),
        iccUrl: siteUrl('assets/pdfjs/iccs/'),
        isEvalSupported: false,
    });
    try {
        return await task.promise;
    } catch (error) {
        if (error?.name === 'PasswordException') {
            throw new Error(`${file.name} is password-protected. Remove the password and try again.`);
        }
        throw new Error(`${file.name} could not be read as a PDF.`);
    }
}

/** Free a document and its worker-side state. v6 moved this to the loading task. */
export function closePdf(doc) {
    return doc?.loadingTask?.destroy();
}

/**
 * Render one page (1-based) to a canvas, as a viewer would show it: rotated by
 * the page's own /Rotate, cropped to its CropBox, on white.
 *
 * `width` sets the CSS width to render for (scaled by devicePixelRatio);
 * `scale` renders at a fixed scale instead (1 = 72 dpi). `maxPixels` caps the
 * canvas area, which a 300 dpi A0 poster would otherwise blow past.
 */
export async function renderPage(doc, pageNumber, { width, scale, maxPixels = 40e6 } = {}) {
    const page = await doc.getPage(pageNumber);
    try {
        const base = page.getViewport({ scale: 1 });
        let s = scale ?? ((width * (globalThis.devicePixelRatio || 1)) / base.width);
        const area = base.width * base.height * s * s;
        if (area > maxPixels) s *= Math.sqrt(maxPixels / area);

        const viewport = page.getViewport({ scale: s });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvas, viewport }).promise;
        return canvas;
    } finally {
        page.cleanup();
    }
}
