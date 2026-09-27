import {
    formatTimestamp, fromWhisperChunks, toSrt, toVtt, toPlainText,
} from '../js/shared/subtitles.js';

const cue = (start, end, text) => ({ start, end, lines: [text] });

describe('formatTimestamp', () => {
    test('pads every field so cue lines line up', () => {
        expect(formatTimestamp(3723.5)).toBe('01:02:03,500');
    });

    test('uses a dot for VTT', () => {
        expect(formatTimestamp(1.25, '.')).toBe('00:00:01.250');
    });

    test('clamps a negative time rather than emitting a minus sign', () => {
        expect(formatTimestamp(-4)).toBe('00:00:00,000');
    });

    // The branch this came from printed 00:00:01,1000 here.
    test('rounding up to the next second carries over', () => {
        expect(formatTimestamp(1.9996)).toBe('00:00:02,000');
        expect(formatTimestamp(59.9999)).toBe('00:01:00,000');
    });
});

describe('fromWhisperChunks', () => {
    test('maps timestamps and trims text', () => {
        expect(fromWhisperChunks([{ timestamp: [0, 2.5], text: ' Hello there.' }]))
            .toEqual([cue(0, 2.5, 'Hello there.')]);
    });

    // Whisper leaves the last end null when it stops mid-sentence.
    test('a missing end comes from the next start, or the audio length', () => {
        const cues = fromWhisperChunks([
            { timestamp: [0, null], text: 'one' },
            { timestamp: [3, null], text: 'two' },
        ], 7.2);
        expect(cues.map((c) => [c.start, c.end])).toEqual([[0, 3], [3, 7.2]]);
    });

    test('never writes a cue that ends before it starts', () => {
        const [only] = fromWhisperChunks([{ timestamp: [5, 5], text: 'x' }]);
        expect(only.end).toBeGreaterThan(only.start);
    });

    test('drops empty chunks and survives nothing at all', () => {
        expect(fromWhisperChunks([{ timestamp: [0, 1], text: '  ' }])).toEqual([]);
        expect(fromWhisperChunks(undefined)).toEqual([]);
    });
});

describe('toSrt', () => {
    test('numbers cues from one and uses comma decimals', () => {
        expect(toSrt([cue(0, 1.5, 'a'), cue(2, 3, 'b')]))
            .toBe('1\n00:00:00,000 --> 00:00:01,500\na\n\n2\n00:00:02,000 --> 00:00:03,000\nb\n');
    });

    test('an empty cue list produces an empty file, not a stray newline', () => {
        expect(toSrt([])).toBe('');
    });
});

describe('toVtt', () => {
    test('starts with the WEBVTT signature a player requires', () => {
        expect(toVtt([cue(0, 1, 'a')])).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\na\n');
    });
});

describe('toPlainText', () => {
    test('joins speech into prose', () => {
        expect(toPlainText([cue(0, 2, 'Hello'), cue(2, 4, 'world.')])).toBe('Hello world.\n');
    });

    test('starts a new paragraph after a pause in speech', () => {
        expect(toPlainText([cue(0, 2, 'First.'), cue(8, 9, 'Second.')])).toBe('First.\n\nSecond.\n');
    });

    // YouTube's rolling captions needed repeats dropped; real speech does not.
    test('keeps a line that really was said twice', () => {
        expect(toPlainText([cue(0, 1, 'Yes.'), cue(1, 2, 'Yes.')])).toBe('Yes. Yes.\n');
    });

    test('optional timestamps prefix each paragraph', () => {
        expect(toPlainText([cue(65, 66, 'Later.')], { timestamps: true })).toBe('[01:05] Later.\n');
    });

    test('empty input gives an empty string', () => {
        expect(toPlainText([])).toBe('');
    });
});
