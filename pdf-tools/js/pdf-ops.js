// PDF operations, on vendored pdf-lib.
//
// pdf-lib writes and edits PDFs; it does not render them. Anything needing a
// page rasterised (PDF -> image) needs pdf.js as well, which is a separate and
// much larger dependency. That is why this file offers no such operation
// rather than faking one.

import { PDFDocument, degrees } from '../../js/vendor/pdf-lib.js';
import { parsePageRange, normalisePdfRotation, splitPartName } from '../../js/shared/pdf-pages.js';
import { sanitiseFilename, stripExtension } from '../../js/shared/format.js';

/** Encrypted PDFs are common enough that the error has to name the cause. */
export async function loadPdf(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
        // ignoreEncryption lets a password-less "protected" file still open;
        // a genuinely encrypted one still throws, and is reported as such.
        return await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (error) {
        if (/encrypt/i.test(error?.message ?? '')) {
            throw new Error(`${file.name} is password-protected. Remove the password and try again.`);
        }
        throw new Error(`${file.name} could not be read as a PDF.`);
    }
}

export async function pageCountOf(file) {
    return (await loadPdf(file)).getPageCount();
}

const outName = (name, suffix) =>
    `${sanitiseFilename(stripExtension(String(name).split(/[/\\]/).pop() ?? ''), 'document')}${suffix}.pdf`;

/**
 * Merge several PDFs, in the order given.
 *
 * copyPages carries the page's real content and resources across; pushing the
 * page object itself would leave it referencing the document it came from.
 */
export async function mergePdfs(files, { onProgress = () => {} } = {}) {
    if (files.length < 2) throw new Error('Merging needs at least two PDFs.');

    const merged = await PDFDocument.create();
    let done = 0;
    for (const file of files) {
        const source = await loadPdf(file);
        const pages = await merged.copyPages(source, source.getPageIndices());
        for (const page of pages) merged.addPage(page);
        done += 1;
        onProgress({ ratio: done / files.length, note: file.name });
    }

    return {
        blob: new Blob([await merged.save()], { type: 'application/pdf' }),
        filename: 'merged.pdf',
        pageCount: merged.getPageCount(),
    };
}

/** Keep only the selected pages. */
export async function extractPages(file, rangeSpec) {
    const source = await loadPdf(file);
    const indices = parsePageRange(rangeSpec, source.getPageCount());
    if (!indices.length) throw new Error('That range selects no pages.');

    const out = await PDFDocument.create();
    for (const page of await out.copyPages(source, indices)) out.addPage(page);

    return {
        blob: new Blob([await out.save()], { type: 'application/pdf' }),
        filename: outName(file.name, '-pages'),
        pageCount: indices.length,
    };
}

/** Drop the selected pages, keeping the rest. */
export async function removePages(file, rangeSpec) {
    const source = await loadPdf(file);
    const total = source.getPageCount();
    const drop = new Set(parsePageRange(rangeSpec, total));
    const keep = [];
    for (let i = 0; i < total; i += 1) if (!drop.has(i)) keep.push(i);
    if (!keep.length) throw new Error('That would remove every page.');

    const out = await PDFDocument.create();
    for (const page of await out.copyPages(source, keep)) out.addPage(page);

    return {
        blob: new Blob([await out.save()], { type: 'application/pdf' }),
        filename: outName(file.name, '-trimmed'),
        pageCount: keep.length,
    };
}

/**
 * Split into several documents.
 *
 * `mode` is 'every' (chunks of `size` pages) or 'single' (one file per page).
 * Returns entries ready for js/shared/zip.js.
 */
export async function splitPdf(file, { mode = 'every', size = 1, onProgress = () => {} } = {}) {
    const source = await loadPdf(file);
    const total = source.getPageCount();
    if (total < 2) throw new Error('This PDF has only one page, so there is nothing to split.');

    const chunkSize = mode === 'single' ? 1 : Math.max(1, Math.floor(size));
    const chunks = [];
    for (let start = 0; start < total; start += chunkSize) {
        chunks.push(
            Array.from({ length: Math.min(chunkSize, total - start) }, (_, i) => start + i),
        );
    }

    const parts = [];
    for (const [index, indices] of chunks.entries()) {
        const out = await PDFDocument.create();
        for (const page of await out.copyPages(source, indices)) out.addPage(page);
        parts.push({
            name: splitPartName(file.name, index, chunks.length),
            data: new Blob([await out.save()], { type: 'application/pdf' }),
        });
        onProgress({ ratio: (index + 1) / chunks.length, note: `part ${index + 1}` });
    }

    return parts;
}

/** Rotate the selected pages by a multiple of 90 degrees. */
export async function rotatePdf(file, { rangeSpec = 'all', angle = 90 } = {}) {
    const doc = await loadPdf(file);
    const indices = parsePageRange(rangeSpec, doc.getPageCount());
    if (!indices.length) throw new Error('That range selects no pages.');

    const turn = normalisePdfRotation(angle);
    for (const index of indices) {
        const page = doc.getPage(index);
        // Rotation is cumulative on whatever the page already had; replacing it
        // would silently un-rotate pages that were already sideways.
        page.setRotation(degrees(normalisePdfRotation(page.getRotation().angle + turn)));
    }

    return {
        blob: new Blob([await doc.save()], { type: 'application/pdf' }),
        filename: outName(file.name, '-rotated'),
        pageCount: doc.getPageCount(),
    };
}

/** Reorder pages to an explicit zero-based order. */
export async function reorderPdf(file, order) {
    const source = await loadPdf(file);
    const total = source.getPageCount();
    const valid = order.filter((i) => Number.isInteger(i) && i >= 0 && i < total);
    if (valid.length !== total) throw new Error('The new order must list every page exactly once.');

    const out = await PDFDocument.create();
    for (const page of await out.copyPages(source, valid)) out.addPage(page);

    return {
        blob: new Blob([await out.save()], { type: 'application/pdf' }),
        filename: outName(file.name, '-reordered'),
        pageCount: total,
    };
}

/** Page sizes in PDF points (72 per inch). */
export const PAGE_SIZES = Object.freeze({
    fit: null,                   // page matches the image
    a4: [595.28, 841.89],
    letter: [612, 792],
    a3: [841.89, 1190.55],
});

/**
 * Build a PDF from images, one per page.
 *
 * PDF natively understands JPEG and PNG and nothing else, so anything different
 * is re-encoded to PNG through a canvas first rather than being embedded as a
 * file the reader cannot decode.
 */
export async function imagesToPdf(files, {
    pageSize = 'fit', margin = 0, orientation = 'auto', onProgress = () => {},
} = {}) {
    if (!files.length) throw new Error('No images to put in a PDF.');

    const doc = await PDFDocument.create();
    let done = 0;

    for (const file of files) {
        const { bytes, type } = await toEmbeddable(file);
        const image = type === 'image/jpeg'
            ? await doc.embedJpg(bytes)
            : await doc.embedPng(bytes);

        let width;
        let height;
        if (pageSize === 'fit' || !PAGE_SIZES[pageSize]) {
            width = image.width + margin * 2;
            height = image.height + margin * 2;
        } else {
            const [a, b] = PAGE_SIZES[pageSize];
            const landscape = orientation === 'landscape'
                || (orientation === 'auto' && image.width > image.height);
            width = landscape ? b : a;
            height = landscape ? a : b;
        }

        const page = doc.addPage([width, height]);
        const usableW = Math.max(1, width - margin * 2);
        const usableH = Math.max(1, height - margin * 2);
        // Contain, never stretch: a distorted scan is worse than a bordered one.
        const scale = Math.min(usableW / image.width, usableH / image.height);
        const drawW = image.width * scale;
        const drawH = image.height * scale;

        page.drawImage(image, {
            x: (width - drawW) / 2,
            y: (height - drawH) / 2,
            width: drawW,
            height: drawH,
        });

        done += 1;
        onProgress({ ratio: done / files.length, note: file.name });
    }

    return {
        blob: new Blob([await doc.save()], { type: 'application/pdf' }),
        filename: files.length === 1 ? outName(files[0].name, '') : 'images.pdf',
        pageCount: doc.getPageCount(),
    };
}

/** JPEG and PNG pass through; anything else is re-encoded to PNG. */
async function toEmbeddable(file) {
    const type = (file.type || '').toLowerCase();
    if (type === 'image/jpeg' || type === 'image/png') {
        return { bytes: new Uint8Array(await file.arrayBuffer()), type };
    }

    const { decodeImageFile, canvasToBlob } = await import('../../js/shared/image.js');
    const source = await decodeImageFile(file);
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d').drawImage(source, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/png');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/png' };
}

/**
 * Rewrite the file with object streams on.
 *
 * This is a real but modest saving -- usually single-digit percent, from
 * restructuring the object table. It is **not** image recompression: pdf-lib
 * cannot touch embedded image streams at all. The UI must not call this
 * "compress" without saying what it does, because the only way to get the large
 * reductions people expect is to rasterise every page, which destroys text
 * selection, links and accessibility.
 */
export async function optimisePdf(file) {
    const doc = await loadPdf(file);
    const bytes = await doc.save({ useObjectStreams: true });
    return {
        blob: new Blob([bytes], { type: 'application/pdf' }),
        filename: outName(file.name, '-optimised'),
        pageCount: doc.getPageCount(),
        originalSize: file.size,
        newSize: bytes.length,
    };
}
