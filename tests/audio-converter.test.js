/**
 * Audio converter argument building.
 *
 * The seeking rules here are the subtle part and they differ deliberately from
 * the video converter's. Each one has a test naming the bug it prevents.
 *
 * The codec list is not guessed: `ffmpeg -encoders` was run inside ffmpeg.wasm
 * (@ffmpeg/core@0.12.6) and every codec asserted below was present.
 */

import {
    AUDIO_FORMATS,
    BITRATES,
    buildAudioArgs,
    getMimeType,
    supportsBitrate,
} from '../audio-converter/js/audio-args.js';

const base = {
    input: 'input.mp4',
    output: 'out.mp3',
    format: 'mp3',
    sourceDuration: 300,
};

const build = (over = {}) => buildAudioArgs({ ...base, ...over });

/** Value that follows a flag, e.g. after('-t') -> '30'. */
function after(args, flag) {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
}

describe('trimming', () => {
    // -ss before -i is input seeking: ffmpeg jumps to the point instead of
    // decoding and discarding everything before it. On a 90-minute podcast that
    // is the difference between instant and a very long wait.
    test('-ss comes before -i, not after', () => {
        const args = build({ startSec: 30, endSec: 60 });
        expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    });

    // Input seeking rebases the output timeline to zero, so the end has to be a
    // DURATION. Using -to here would treat 60 as an absolute source timestamp
    // and silently produce a 60s clip instead of a 30s one.
    test('the trim end is expressed as -t duration, never -to', () => {
        const args = build({ startSec: 30, endSec: 60 });
        expect(args).not.toContain('-to');
        expect(after(args, '-t')).toBe('30');
    });

    test('no -ss and no -t when the whole file is selected', () => {
        const args = build({ startSec: 0, endSec: 300, sourceDuration: 300 });
        expect(args).not.toContain('-ss');
        expect(args).not.toContain('-t');
    });

    test('a start with no end still trims from the start', () => {
        const args = build({ startSec: 10, endSec: null });
        expect(after(args, '-ss')).toBe('10');
        expect(args).not.toContain('-t');
    });

    // A user dragging the end marker to the very end should not be treated as a
    // trim; floating-point duration never lands exactly on the reported value.
    test('an end within a hair of the source duration is not a trim', () => {
        const args = build({ startSec: 0, endSec: 299.99, sourceDuration: 300 });
        expect(args).not.toContain('-t');
    });

    test('a negative or NaN start is ignored rather than emitted', () => {
        expect(build({ startSec: -5 })).not.toContain('-ss');
        expect(build({ startSec: NaN })).not.toContain('-ss');
    });
});

describe('codecs and containers', () => {
    test.each([
        ['mp3', 'libmp3lame'],
        ['m4a', 'aac'],
        ['ogg', 'libvorbis'],
        ['opus', 'libopus'],
        ['wav', 'pcm_s16le'],
        ['flac', 'flac'],
    ])('%s uses %s', (format, codec) => {
        expect(after(build({ format, output: `out.${format}` }), '-c:a')).toBe(codec);
    });

    test('lossless and uncompressed formats ignore the bitrate control', () => {
        for (const format of ['wav', 'flac']) {
            const args = build({ format, output: `out.${format}`, bitrate: '320k' });
            expect(args).not.toContain('-b:a');
        }
        expect(supportsBitrate('wav')).toBe(false);
        expect(supportsBitrate('flac')).toBe(false);
    });

    test('lossy formats carry the requested bitrate', () => {
        for (const format of ['mp3', 'm4a', 'ogg', 'opus']) {
            expect(after(build({ format, bitrate: '256k' }), '-b:a')).toBe('256k');
        }
    });

    test('flac asks for a compression level', () => {
        expect(after(build({ format: 'flac', output: 'out.flac' }), '-compression_level')).toBe('5');
    });

    test('an unknown format throws instead of producing a broken command', () => {
        expect(() => build({ format: 'aiff' })).toThrow(/Unsupported output format/);
    });

    test('every advertised format has a MIME type and a codec', () => {
        for (const [key, spec] of Object.entries(AUDIO_FORMATS)) {
            expect(spec.codec).toBeTruthy();
            expect(getMimeType(key)).toBe(spec.mime);
        }
    });

    test('unknown formats fall back to a generic MIME type', () => {
        expect(getMimeType('nope')).toBe('application/octet-stream');
    });
});

describe('stream handling', () => {
    // Cover art in an MP3 is a video stream. Without -vn it is carried into the
    // output and the "audio" file will not play in most players.
    test('-vn is always present, so cover art cannot break the output', () => {
        for (const format of Object.keys(AUDIO_FORMATS)) {
            expect(build({ format, output: `out.${format}` })).toContain('-vn');
        }
    });

    test('metadata is carried across', () => {
        expect(after(build(), '-map_metadata')).toBe('0');
    });

    test('channel and sample-rate overrides are only emitted when asked for', () => {
        const untouched = build({ channels: 'original', sampleRate: 'original' });
        expect(untouched).not.toContain('-ac');
        expect(untouched).not.toContain('-ar');

        expect(after(build({ channels: 'mono' }), '-ac')).toBe('1');
        expect(after(build({ channels: 'stereo' }), '-ac')).toBe('2');
        expect(after(build({ sampleRate: 22050 }), '-ar')).toBe('22050');
    });
});

describe('filters', () => {
    test('no -af at all when nothing needs filtering', () => {
        expect(build()).not.toContain('-af');
    });

    test('normalise adds loudnorm', () => {
        expect(after(build({ normalise: true }), '-af')).toContain('loudnorm=');
    });

    test('fade in starts at zero', () => {
        expect(after(build({ fadeIn: 3 }), '-af')).toContain('afade=t=in:st=0:d=3');
    });

    // The fade-out start is on the OUTPUT timeline. Computing it from the source
    // duration puts it past the end of a trimmed clip, so the fade never happens.
    test('fade out is positioned from the trimmed duration, not the source', () => {
        const args = build({ startSec: 60, endSec: 90, sourceDuration: 300, fadeOut: 5 });
        // 30s clip, 5s fade -> starts at 25s, not 295s.
        expect(after(args, '-af')).toContain('afade=t=out:st=25:d=5');
    });

    test('a fade longer than the clip is dropped rather than emitted negative', () => {
        const args = build({ startSec: 0, endSec: 2, sourceDuration: 300, fadeOut: 5 });
        expect(args.includes('-af') ? after(args, '-af') : '').not.toContain('afade=t=out');
    });

    test('filters combine in a single -af', () => {
        const args = build({ normalise: true, fadeIn: 1, fadeOut: 1, startSec: 0, endSec: 10 });
        const af = after(args, '-af');
        expect(args.filter(a => a === '-af')).toHaveLength(1);
        expect(af).toContain('loudnorm=');
        expect(af).toContain('afade=t=in');
        expect(af).toContain('afade=t=out');
    });
});

describe('command shape', () => {
    test('the output filename is last', () => {
        const args = build({ output: 'song.mp3' });
        expect(args[args.length - 1]).toBe('song.mp3');
    });

    test('the input follows -i', () => {
        expect(after(build({ input: 'clip.wav' }), '-i')).toBe('clip.wav');
    });

    test('every advertised bitrate is a plausible ffmpeg value', () => {
        BITRATES.forEach(b => expect(b).toMatch(/^\d+k$/));
    });
});
