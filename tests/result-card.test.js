// js/shared/result-card.js
//
// The arithmetic and wording live in resultSummary, which is pure, because that
// is exactly where the convert hub and the image editor had drifted apart: the
// hub computed its own percentage inline and the editor mapped three savings
// directions through a two-way ternary.

import {
    renderFailure,
    renderResult,
    renderResultList,
    resultSummary,
} from '../js/shared/result-card.js';
import { createUrlPool, createUrlSlot } from '../js/shared/objecturl.js';

beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:fake');
    global.URL.revokeObjectURL = jest.fn();
});

describe('resultSummary', () => {
    test('leads with the output size', () => {
        expect(resultSummary({ originalSize: 2048, outputSize: 1024 }).text)
            .toBe('1.0 KB · 50% smaller');
    });

    test('says when the file got bigger, rather than showing a negative saving', () => {
        const summary = resultSummary({ originalSize: 1000, outputSize: 2000 });
        expect(summary.text).toContain('100% larger');
        expect(summary.direction).toBe('larger');
    });

    // The image editor painted this in the error colour, because it mapped
    // savings()'s three directions with a two-way ternary on 'smaller'. A
    // re-encode that changed nothing is a normal outcome, not a failure.
    test('same size is neutral, not an error', () => {
        expect(resultSummary({ originalSize: 1000, outputSize: 1000 }).savingsClass)
            .toBe('neutral');
    });

    test('smaller is positive and larger is negative', () => {
        expect(resultSummary({ originalSize: 1000, outputSize: 100 }).savingsClass)
            .toBe('positive');
        expect(resultSummary({ originalSize: 100, outputSize: 1000 }).savingsClass)
            .toBe('negative');
    });

    // A tool that made a file from nothing -- a QR code, a favicon set -- has no
    // "before" to compare against, and must not claim one.
    test('omits the comparison entirely when there is no original size', () => {
        expect(resultSummary({ outputSize: 1024 }).text).toBe('1.0 KB');
        expect(resultSummary({ originalSize: 0, outputSize: 1024 }).text).toBe('1.0 KB');
    });

    test('appends extra facts after the size', () => {
        expect(resultSummary({ outputSize: 1024, extra: ['3 pages'] }).text)
            .toBe('1.0 KB · 3 pages');
    });

    test('survives being asked about nothing at all', () => {
        expect(() => resultSummary()).not.toThrow();
    });
});

describe('renderResult', () => {
    const base = () => ({
        filename: 'out.webp',
        blob: new Blob(['abcd']),
        originalSize: 100,
        slot: createUrlSlot(),
    });

    test('names the file and wires the download button', () => {
        const row = renderResult(base());
        expect(row.querySelector('.output-item-name').textContent).toBe('out.webp');

        const link = row.querySelector('a');
        expect(link.download).toBe('out.webp');
        expect(link.href).toContain('blob:fake');
    });

    test('carries the savings class on the meta line', () => {
        const row = renderResult({ ...base(), blob: new Blob(['x']), originalSize: 1000 });
        expect(row.querySelector('.output-item-meta').classList).toContain('positive');
    });

    // Creating a second URL for the same bytes is how the editor used to leak.
    test('the preview and the download share one URL', () => {
        const row = renderResult({ ...base(), preview: true });
        expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(row.querySelector('img').src).toBe(row.querySelector('a').href);
    });

    test('no preview element unless one was asked for', () => {
        expect(renderResult(base()).querySelector('.output-item-preview')).toBeNull();
    });

    test('takes its URL from a pool when given a key', () => {
        const pool = createUrlPool();
        renderResult({ ...base(), slot: pool, key: 7 });
        expect(pool.get(7)).toBe('blob:fake');
    });

    test('extra actions render before the download button', () => {
        const button = document.createElement('button');
        button.textContent = 'Send to PDF Tools';
        const row = renderResult({ ...base(), actions: [button] });

        const actions = row.querySelector('.output-actions');
        expect(actions.contains(button)).toBe(true);
        // compareDocumentPosition: FOLLOWING means the link comes after.
        expect(actions.compareDocumentPosition(row.querySelector('a')))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    test('no actions container when there are no actions', () => {
        expect(renderResult(base()).querySelector('.output-actions')).toBeNull();
    });
});

describe('renderFailure', () => {
    test('names the file that failed and why', () => {
        const row = renderFailure({ filename: 'clip.mkv', error: 'Unsupported codec.' });
        expect(row.querySelector('.output-item-name').textContent).toBe('clip.mkv');
        expect(row.querySelector('.output-item-meta').textContent).toBe('Unsupported codec.');
        expect(row.classList).toContain('output-error');
    });

    test('still says something when no reason was given', () => {
        const row = renderFailure({ filename: 'clip.mkv' });
        expect(row.querySelector('.output-item-meta').textContent).not.toBe('');
    });
});

describe('renderResultList', () => {
    // In a batch where two of twenty failed, the eighteen that worked are the
    // answer; the apology can come after.
    test('successes come before failures', () => {
        const host = document.createElement('div');
        renderResultList(host, {
            results: [{ filename: 'a.webp', blob: new Blob(['a']), slot: createUrlSlot() }],
            failures: [{ filename: 'b.mkv', error: 'nope' }],
        });

        const rows = [...host.children];
        expect(rows).toHaveLength(2);
        expect(rows[0].classList).not.toContain('output-error');
        expect(rows[1].classList).toContain('output-error');
    });

    test('replaces whatever was there before, so a second run does not append', () => {
        const host = document.createElement('div');
        const once = () => renderResultList(host, {
            results: [{ filename: 'a.webp', blob: new Blob(['a']), slot: createUrlSlot() }],
        });
        once();
        once();
        expect(host.children).toHaveLength(1);
    });
});
