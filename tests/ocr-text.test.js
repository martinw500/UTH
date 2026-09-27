import { tidyOcrText, joinOcrPages } from '../js/shared/ocr-text.js';

describe('tidyOcrText', () => {
    test('rejoins a word hyphenated across a line break', () => {
        expect(tidyOcrText('an exam-\nple of it')).toBe('an example of it');
    });

    test('works for accented lowercase too', () => {
        expect(tidyOcrText('la répé-\ntition')).toBe('la répétition');
    });

    // A real hyphen at a line end: rejoining would corrupt it.
    test('leaves a hyphen before a digit or a capital alone', () => {
        expect(tidyOcrText('COVID-\n19')).toBe('COVID-\n19');
        expect(tidyOcrText('well-\nKnown')).toBe('well-\nKnown');
    });

    // Addresses and lists live in the line breaks.
    test('keeps line breaks', () => {
        expect(tidyOcrText('10 Downing St\nLondon\nSW1A 2AA')).toBe('10 Downing St\nLondon\nSW1A 2AA');
    });

    test('collapses spaces and blank lines, and trims', () => {
        expect(tidyOcrText('  one   two  \n\n\n\nthree \f\n')).toBe('one two\n\nthree');
    });

    test('normalises Windows line endings', () => {
        expect(tidyOcrText('a\r\nb\rc')).toBe('a\nb\nc');
    });

    test('empty in, empty out', () => {
        expect(tidyOcrText('')).toBe('');
        expect(tidyOcrText(null)).toBe('');
    });
});

describe('joinOcrPages', () => {
    test('one page is just its text', () => {
        expect(joinOcrPages([{ source: 'a.png', text: 'hello' }])).toBe('hello');
    });

    test('several are headed by where they came from, and empty pages say so', () => {
        expect(joinOcrPages([
            { source: 'scan.pdf, page 1', text: 'first' },
            { source: 'scan.pdf, page 2', text: ' ' },
        ])).toBe('— scan.pdf, page 1 —\nfirst\n\n— scan.pdf, page 2 —\n(no text found)');
    });
});
