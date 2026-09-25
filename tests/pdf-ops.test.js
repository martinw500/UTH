// pdf-tools/js/pdf-ops.js, against the vendored pdf-lib it ships with.

import { PDFDocument } from '../js/vendor/pdf-lib.js';
import { loadPdf, pageCountOf } from '../pdf-tools/js/pdf-ops.js';

const fileOf = (bytes, name = 'doc.pdf') => ({
    name,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

async function plainPdf(pages = 2) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
    return doc.save();
}

/**
 * A one-page PDF whose trailer names an /Encrypt dictionary. pdf-lib cannot
 * create encrypted files, so this is written by hand; nothing here needs the
 * streams to really be encrypted, only the trailer to say they are.
 */
function encryptedPdf() {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
        '<< /Filter /Standard /V 1 /R 2 /O (xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) /U (xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) /P -4 >>',
    ];
    let body = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((object, i) => {
        offsets.push(body.length);
        body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(body);
}

describe('loadPdf', () => {
    test('opens an ordinary PDF', async () => {
        expect(await pageCountOf(fileOf(await plainPdf(3)))).toBe(3);
    });

    // pdf-lib cannot decrypt. With ignoreEncryption it loads the structure and
    // then writes still-encrypted streams into a file with no key, so every
    // operation produced blank or garbled pages while the page said "Done".
    test('refuses an encrypted PDF by name instead of producing garbage', async () => {
        await expect(loadPdf(fileOf(encryptedPdf(), 'statement.pdf')))
            .rejects.toThrow('statement.pdf is password-protected');
    });

    test('names a file that is not a PDF at all', async () => {
        await expect(loadPdf(fileOf(new TextEncoder().encode('hello'), 'notes.pdf')))
            .rejects.toThrow('notes.pdf could not be read as a PDF.');
    });
});
