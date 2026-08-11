/**
 * Page-list arithmetic for the PDF toolkit.
 *
 * Only `pdf-ops.js` is exercised: it is pure, and it is where every off-by-one
 * that would silently shuffle someone's contract lives. pdf-lib itself is
 * vendored upstream code and is checked in a browser, not here.
 */

import {
    parsePageRange,
    formatPageRange,
    movePage,
    removePages,
    rotatePages,
    chunkPages,
    describePage,
    outputName,
} from '../pdf-toolkit/js/pdf-ops.js';

const pages = (count) => Array.from({ length: count }, (_, i) => ({
    docId: 'd1',
    pageIndex: i,
    rotation: 0,
}));

describe('parsePageRange', () => {
    test('reads single pages and returns zero-based indices', () => {
        expect(parsePageRange('1, 3', 10).pages).toEqual([0, 2]);
    });

    test('expands a range', () => {
        expect(parsePageRange('2-4', 10).pages).toEqual([1, 2, 3]);
    });

    test('mixes ranges and singles, sorted and de-duplicated', () => {
        expect(parsePageRange('5, 1-3, 2', 10).pages).toEqual([0, 1, 2, 4]);
    });

    // People type "12-" far more often than they look up the real last page.
    test('an open-ended range runs to the end of the document', () => {
        expect(parsePageRange('8-', 10).pages).toEqual([7, 8, 9]);
    });

    test('"end" and "last" both mean the final page', () => {
        expect(parsePageRange('9-end', 10).pages).toEqual([8, 9]);
        expect(parsePageRange('last', 10).pages).toEqual([9]);
    });

    test('a reversed range is read the obvious way round', () => {
        expect(parsePageRange('4-2', 10).pages).toEqual([1, 2, 3]);
    });

    test('whitespace alone separates terms, so a missing comma still works', () => {
        expect(parsePageRange('1 2 3', 10).pages).toEqual([0, 1, 2]);
    });

    // Clamping would turn "1-500" into the whole document without telling
    // anyone the 500 was a typo. Reporting it lets the page say so.
    test('an out-of-range term is reported, not clamped', () => {
        const { pages: parsed, errors } = parsePageRange('1-500', 10);
        expect(parsed).toEqual([]);
        expect(errors).toEqual(['1-500']);
    });

    test('one bad term does not discard the good ones', () => {
        const { pages: parsed, errors } = parsePageRange('1-2, banana, 5', 10);
        expect(parsed).toEqual([0, 1, 4]);
        expect(errors).toEqual(['banana']);
    });

    test('page zero is an error, since documents start at one', () => {
        expect(parsePageRange('0', 10).errors).toEqual(['0']);
    });

    test('empty or nonsensical input yields nothing rather than throwing', () => {
        expect(parsePageRange('', 10).pages).toEqual([]);
        expect(parsePageRange('   ', 10).pages).toEqual([]);
        expect(parsePageRange(null, 10).pages).toEqual([]);
        expect(parsePageRange('1-2', 0).pages).toEqual([]);
    });
});

describe('formatPageRange', () => {
    test('collapses consecutive pages into a run', () => {
        expect(formatPageRange([0, 1, 2, 4, 7, 8, 9])).toBe('1-3, 5, 8-10');
    });

    test('a single page is not written as a range', () => {
        expect(formatPageRange([3])).toBe('4');
    });

    test('sorts and de-duplicates whatever it is handed', () => {
        expect(formatPageRange([2, 0, 1, 2])).toBe('1-3');
    });

    test('round-trips through parsePageRange', () => {
        const text = '1-3, 5, 8-10';
        expect(formatPageRange(parsePageRange(text, 10).pages)).toBe(text);
    });

    test('nothing selected is an empty string', () => {
        expect(formatPageRange([])).toBe('');
    });
});

describe('movePage', () => {
    // Dragging page 1 to position 5 should shuffle 2-5 up by one. A swap
    // implementation looks right in a two-page test and scrambles a real
    // document.
    test('inserts at the target rather than swapping', () => {
        const result = movePage(pages(5), 0, 3);
        expect(result.map(p => p.pageIndex)).toEqual([1, 2, 3, 0, 4]);
    });

    test('moves backwards too', () => {
        const result = movePage(pages(5), 4, 1);
        expect(result.map(p => p.pageIndex)).toEqual([0, 4, 1, 2, 3]);
    });

    test('a target past the end lands on the last position', () => {
        const result = movePage(pages(3), 0, 99);
        expect(result.map(p => p.pageIndex)).toEqual([1, 2, 0]);
    });

    test('an out-of-bounds source is a no-op', () => {
        expect(movePage(pages(3), 9, 0).map(p => p.pageIndex)).toEqual([0, 1, 2]);
    });

    test('does not mutate the input', () => {
        const original = pages(3);
        movePage(original, 0, 2);
        expect(original.map(p => p.pageIndex)).toEqual([0, 1, 2]);
    });
});

describe('removePages', () => {
    test('drops the listed positions', () => {
        expect(removePages(pages(5), [1, 3]).map(p => p.pageIndex)).toEqual([0, 2, 4]);
    });

    // Deleting by position while the array shrinks under you is the classic way
    // to remove the wrong pages; filtering sidesteps it.
    test('removes exactly the requested positions regardless of order', () => {
        expect(removePages(pages(5), [3, 1, 0]).map(p => p.pageIndex)).toEqual([2, 4]);
    });

    test('an empty list changes nothing', () => {
        expect(removePages(pages(3), [])).toHaveLength(3);
    });
});

describe('rotatePages', () => {
    test('rotates only the selected pages', () => {
        const result = rotatePages(pages(3), [1], 90);
        expect(result.map(p => p.rotation)).toEqual([0, 90, 0]);
    });

    test('accumulates across calls', () => {
        let result = rotatePages(pages(1), [0], 90);
        result = rotatePages(result, [0], 90);
        expect(result[0].rotation).toBe(180);
    });

    // Rotating left from 0 must give 270, not -90; a negative angle would be
    // written into the PDF and read back wrong by strict viewers.
    test('normalises a negative rotation into 0-359', () => {
        expect(rotatePages(pages(1), [0], -90)[0].rotation).toBe(270);
    });

    test('four right turns come back to where it started', () => {
        let result = pages(1);
        for (let i = 0; i < 4; i += 1) result = rotatePages(result, [0], 90);
        expect(result[0].rotation).toBe(0);
    });

    test('does not mutate the input', () => {
        const original = pages(2);
        rotatePages(original, [0], 90);
        expect(original[0].rotation).toBe(0);
    });
});

describe('chunkPages', () => {
    test('splits into equal chunks', () => {
        expect(chunkPages(pages(6), 2).map(c => c.length)).toEqual([2, 2, 2]);
    });

    test('the last chunk holds the remainder', () => {
        expect(chunkPages(pages(5), 2).map(c => c.length)).toEqual([2, 2, 1]);
    });

    test('a nonsensical size yields one chunk rather than looping forever', () => {
        expect(chunkPages(pages(3), 0)).toHaveLength(1);
        expect(chunkPages(pages(3), -1)).toHaveLength(1);
    });
});

describe('describePage', () => {
    test('names the source and the original page number', () => {
        expect(describePage({ pageIndex: 2, rotation: 0 }, 'report.pdf'))
            .toBe('report.pdf page 3');
    });

    test('mentions rotation only when there is some', () => {
        expect(describePage({ pageIndex: 0, rotation: 90 }, 'a.pdf'))
            .toBe('a.pdf page 1 · rotated 90°');
    });
});

describe('outputName', () => {
    test('says how many files were merged', () => {
        expect(outputName(['a.pdf', 'b.pdf', 'c.pdf'], 'merge')).toBe('a-and-2-more.pdf');
    });

    test('a single source just gains the action', () => {
        expect(outputName(['report.pdf'], 'extract')).toBe('report-extract.pdf');
    });

    // Otherwise repeated edits produce report-edited-edited-edited.pdf.
    test('does not stack the .pdf extension', () => {
        expect(outputName(['report.pdf'], 'edited')).toBe('report-edited.pdf');
        expect(outputName([], 'edited')).toBe('document-edited.pdf');
    });
});
