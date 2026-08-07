import {
    parsePageRange,
    describePageRange,
    invertSelection,
    chunkPages,
    normalisePdfRotation,
    splitPartName,
} from '../js/shared/pdf-pages.js';

describe('parsePageRange', () => {
    // Users count pages from 1; every PDF API counts from 0. Doing that
    // conversion in exactly one place is the point of this function.
    test('a single page is one-based in, zero-based out', () => {
        expect(parsePageRange('1', 10)).toEqual([0]);
        expect(parsePageRange('3', 10)).toEqual([2]);
    });

    test('a range is inclusive at both ends', () => {
        expect(parsePageRange('2-4', 10)).toEqual([1, 2, 3]);
    });

    test('parts can be separated by commas, spaces or both', () => {
        expect(parsePageRange('1,3', 10)).toEqual([0, 2]);
        expect(parsePageRange('1 3', 10)).toEqual([0, 2]);
        expect(parsePageRange('1, 3-5,  8', 10)).toEqual([0, 2, 3, 4, 7]);
    });

    test('an open end means "to the end"', () => {
        expect(parsePageRange('8-', 10)).toEqual([7, 8, 9]);
    });

    test('an open start means "from the beginning"', () => {
        expect(parsePageRange('-3', 10)).toEqual([0, 1, 2]);
    });

    test('"last" is accepted', () => {
        expect(parsePageRange('last', 5)).toEqual([4]);
        expect(parsePageRange('3-last', 5)).toEqual([2, 3, 4]);
    });

    test.each(['', '   ', 'all', '*', null, undefined])(
        '%p means every page',
        (spec) => expect(parsePageRange(spec, 3)).toEqual([0, 1, 2]),
    );

    test('results are sorted and de-duplicated', () => {
        expect(parsePageRange('5,1,3,1,5', 10)).toEqual([0, 2, 4]);
        expect(parsePageRange('1-3,2-4', 10)).toEqual([0, 1, 2, 3]);
    });

    // "1-999" on a 10-page document means "all of it", not an error.
    test('out-of-range numbers are clamped, not rejected', () => {
        expect(parsePageRange('1-999', 3)).toEqual([0, 1, 2]);
        expect(parsePageRange('99', 3)).toEqual([]);
    });

    // A backwards range is a typo, not an empty selection.
    test('a reversed range is read the way it was meant', () => {
        expect(parsePageRange('5-2', 10)).toEqual([1, 2, 3, 4]);
    });

    test('page 0 and negatives are ignored rather than wrapping', () => {
        expect(parsePageRange('0', 5)).toEqual([]);
        expect(parsePageRange('0-2', 5)).toEqual([0, 1]);
    });

    test('garbage is skipped without taking the valid parts with it', () => {
        expect(parsePageRange('2, banana, 4', 10)).toEqual([1, 3]);
    });

    test('an empty document selects nothing whatever is asked for', () => {
        expect(parsePageRange('1-5', 0)).toEqual([]);
        expect(parsePageRange('all', 0)).toEqual([]);
    });
});

describe('describePageRange', () => {
    test('consecutive pages collapse into a range', () => {
        expect(describePageRange([0, 1, 2])).toBe('1–3');
    });

    test('separate pages are listed', () => {
        expect(describePageRange([0, 2, 4])).toBe('1, 3, 5');
    });

    test('runs and singles mix', () => {
        expect(describePageRange([0, 1, 2, 5, 7, 8])).toBe('1–3, 6, 8–9');
    });

    test('one page reads as a page, not a range', () => {
        expect(describePageRange([3])).toBe('4');
    });

    test('nothing selected says so', () => {
        expect(describePageRange([])).toBe('no pages');
    });

    test('round-trips with parsePageRange', () => {
        const indices = parsePageRange('1-3, 6, 8-9', 10);
        expect(parsePageRange(describePageRange(indices).replace(/–/g, '-'), 10)).toEqual(indices);
    });
});

describe('invertSelection', () => {
    test('returns what was not selected', () => {
        expect(invertSelection([0, 2], 5)).toEqual([1, 3, 4]);
    });

    test('selecting nothing keeps everything', () => {
        expect(invertSelection([], 3)).toEqual([0, 1, 2]);
    });

    test('selecting everything keeps nothing', () => {
        expect(invertSelection([0, 1, 2], 3)).toEqual([]);
    });
});

describe('chunkPages', () => {
    test('splits into equal chunks', () => {
        expect(chunkPages(6, 2)).toEqual([[0, 1], [2, 3], [4, 5]]);
    });

    test('the last chunk holds the remainder', () => {
        expect(chunkPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    });

    test('a chunk of one gives a file per page', () => {
        expect(chunkPages(3, 1)).toEqual([[0], [1], [2]]);
    });

    // A size of 0 would otherwise loop forever.
    test.each([0, -3, 0.4])('a size of %p is treated as one page', (size) => {
        expect(chunkPages(2, size)).toEqual([[0], [1]]);
    });

    test('an empty document yields no chunks', () => {
        expect(chunkPages(0, 2)).toEqual([]);
    });
});

describe('normalisePdfRotation', () => {
    test.each([
        [0, 0], [90, 90], [180, 180], [270, 270],
        [360, 0], [450, 90], [-90, 270], [-450, 270],
    ])('%i becomes %i', (input, expected) => {
        expect(normalisePdfRotation(input)).toBe(expected);
    });

    // PDF only allows multiples of 90; anything else must be snapped, not
    // written through and rejected by the reader.
    test('an off-axis angle snaps to the nearest quarter turn', () => {
        expect(normalisePdfRotation(80)).toBe(90);
        expect(normalisePdfRotation(100)).toBe(90);
    });
});

describe('splitPartName', () => {
    // Zero padding so a 12-part split sorts correctly in a file manager.
    test('pads the index to the width of the total', () => {
        expect(splitPartName('report.pdf', 0, 12)).toBe('report-01.pdf');
        expect(splitPartName('report.pdf', 11, 12)).toBe('report-12.pdf');
    });

    test('no padding is added when it is not needed', () => {
        expect(splitPartName('a.pdf', 0, 3)).toBe('a-1.pdf');
    });

    test('the original extension is replaced', () => {
        expect(splitPartName('scan.PDF', 0, 1)).toBe('scan-1.pdf');
    });

    test('a nameless input still produces a usable name', () => {
        expect(splitPartName('', 0, 1)).toBe('document-1.pdf');
    });
});
