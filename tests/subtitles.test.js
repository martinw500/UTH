/**
 * The conversions behind the YouTube transcript tool.
 *
 * The rolling-duplicate case is the reason this module exists at all -- see the
 * comment at the top of js/shared/subtitles.js.
 */

import {
    parseTimedText,
    parseTimestamp,
    formatTimestamp,
    toSrt,
    toVtt,
    toPlainText,
    convert,
    totalDuration,
} from '../js/shared/subtitles.js';

const SIMPLE_VTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
hello there

00:00:03.500 --> 00:00:05.000
second line
`;

describe('parseTimestamp', () => {
    test('reads hours, minutes, seconds and milliseconds', () => {
        expect(parseTimestamp('01:02:03.500')).toBeCloseTo(3723.5, 3);
    });

    test('reads the two-part form WebVTT allows', () => {
        expect(parseTimestamp('02:03.250')).toBeCloseTo(123.25, 3);
    });

    test('accepts the comma SRT uses as a decimal separator', () => {
        expect(parseTimestamp('00:00:01,500')).toBeCloseTo(1.5, 3);
    });

    // "5" after the dot means 500ms. Parsing it as 5ms would drift a caption
    // by half a second, which is enough to look out of sync.
    test('treats a short fraction as tenths, not thousandths', () => {
        expect(parseTimestamp('00:00:01.5')).toBeCloseTo(1.5, 3);
    });

    test('returns null for something that is not a timestamp', () => {
        expect(parseTimestamp('not a time')).toBeNull();
        expect(parseTimestamp(undefined)).toBeNull();
    });
});

describe('formatTimestamp', () => {
    test('pads every field so cue lines line up', () => {
        expect(formatTimestamp(3723.5)).toBe('01:02:03,500');
    });

    test('uses a dot for VTT', () => {
        expect(formatTimestamp(1.25, '.')).toBe('00:00:01.250');
    });

    test('clamps a negative time rather than emitting a minus sign', () => {
        expect(formatTimestamp(-5)).toBe('00:00:00,000');
    });
});

describe('parseTimedText', () => {
    test('reads cues out of WebVTT', () => {
        const cues = parseTimedText(SIMPLE_VTT);
        expect(cues).toHaveLength(2);
        expect(cues[0]).toMatchObject({ start: 1, end: 3, lines: ['hello there'] });
    });

    test('reads SRT, which shares the same shape', () => {
        const cues = parseTimedText('1\n00:00:01,000 --> 00:00:02,000\nhi\n');
        expect(cues).toHaveLength(1);
        expect(cues[0].lines).toEqual(['hi']);
    });

    // YouTube's auto-caption VTT is full of <00:00:01.234> word timings and
    // <c> colour spans. Leaving them in makes the transcript unreadable.
    test('strips inline karaoke and styling tags', () => {
        const source = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n'
            + '<00:00:01.100><c>hello</c> <00:00:01.400><c>world</c>\n';
        expect(parseTimedText(source)[0].lines).toEqual(['hello world']);
    });

    test('ignores cue settings that trail the timing line', () => {
        const source = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start position:0%\nhi\n';
        expect(parseTimedText(source)).toHaveLength(1);
    });

    test('survives CRLF line endings', () => {
        expect(parseTimedText(SIMPLE_VTT.replace(/\n/g, '\r\n'))).toHaveLength(2);
    });

    test('returns an empty list rather than throwing on rubbish', () => {
        expect(parseTimedText('')).toEqual([]);
        expect(parseTimedText(null)).toEqual([]);
        expect(parseTimedText('WEBVTT\n\nnot a cue at all\n')).toEqual([]);
    });
});

describe('toSrt', () => {
    test('numbers cues from one and uses comma decimals', () => {
        const output = toSrt(parseTimedText(SIMPLE_VTT));
        expect(output).toContain('1\n00:00:01,000 --> 00:00:03,000\nhello there');
        expect(output).toContain('2\n00:00:03,500 --> 00:00:05,000\nsecond line');
    });

    test('an empty cue list produces an empty file, not a stray newline', () => {
        expect(toSrt([])).toBe('');
    });
});

describe('toVtt', () => {
    test('starts with the WEBVTT signature a player requires', () => {
        expect(toVtt(parseTimedText(SIMPLE_VTT)).startsWith('WEBVTT\n\n')).toBe(true);
    });
});

describe('toPlainText', () => {
    // The bug this whole module exists for. YouTube's auto-captions scroll two
    // lines at a time, so each cue repeats the previous cue's last line.
    // Concatenating naively doubles most of the transcript.
    test('drops the rolling repeat auto-captions emit', () => {
        const source = [
            'WEBVTT',
            '',
            '00:00:01.000 --> 00:00:03.000',
            'so what I want to do',
            '',
            '00:00:03.000 --> 00:00:05.000',
            'so what I want to do',
            'is show you the thing',
        ].join('\n');

        const text = toPlainText(parseTimedText(source));
        expect(text.match(/so what I want to do/g)).toHaveLength(1);
        expect(text).toContain('is show you the thing');
    });

    test('starts a new paragraph after a pause in speech', () => {
        const source = [
            'WEBVTT',
            '',
            '00:00:01.000 --> 00:00:02.000',
            'first thought',
            '',
            '00:00:20.000 --> 00:00:21.000',
            'much later',
        ].join('\n');

        expect(toPlainText(parseTimedText(source)).trim().split('\n\n')).toHaveLength(2);
    });

    test('optional timestamps prefix each paragraph', () => {
        expect(toPlainText(parseTimedText(SIMPLE_VTT), { timestamps: true })).toMatch(/^\[00:01\]/);
    });

    test('collapses the runs of whitespace captions are full of', () => {
        const source = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello     there\n';
        expect(toPlainText(parseTimedText(source))).toBe('hello there\n');
    });

    test('empty input gives an empty string, not "undefined"', () => {
        expect(toPlainText([])).toBe('');
    });
});

describe('convert', () => {
    test('routes to the right formatter', () => {
        expect(convert(SIMPLE_VTT, 'srt')).toContain('-->');
        expect(convert(SIMPLE_VTT, 'vtt').startsWith('WEBVTT')).toBe(true);
        expect(convert(SIMPLE_VTT, 'text')).toContain('hello there');
    });

    test('an unknown format falls back to plain text rather than throwing', () => {
        expect(convert(SIMPLE_VTT, 'nonsense')).toContain('hello there');
    });
});

describe('totalDuration', () => {
    test('is the end of the last cue', () => {
        expect(totalDuration(parseTimedText(SIMPLE_VTT))).toBe(5);
    });

    test('is zero for nothing', () => {
        expect(totalDuration([])).toBe(0);
    });
});
