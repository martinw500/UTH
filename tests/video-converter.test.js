// ============================================
// Video Converter — Unit Tests
// Tests for helper functions and FFmpeg argument building
// ============================================

// Imports the real shared module. These assertions are unchanged from when
// they tested copy-pasted clones, so a green run proves the extraction into
// js/shared/format.js preserved behaviour.
import {
    formatBytes as sharedFormatBytes,
    stripExtension as stripExt,
    formatTime,
    parseTime,
} from '../js/shared/format.js';

// The video converter shows one decimal for MB; the image editor shows two.
const formatBytes = (bytes) => sharedFormatBytes(bytes, { mbDecimals: 1 });

function getInputExt(filename) {
    const m = filename.match(/(\.[^.]+)$/);
    return m ? m[1].toLowerCase() : '.mp4';
}

function getMimeType(fmt) {
    const map = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        gif: 'image/gif',
        mp3: 'audio/mpeg',
        wav: 'audio/wav'
    };
    return map[fmt] || 'application/octet-stream';
}

function buildFFmpegArgs(input, output, fmt, quality, options = {}) {
    const {
        startSec = NaN,
        endSec = NaN,
        videoDuration = 60,
        resolution = 'original',
        fps = 'original',
        audio = 'keep',
        targetBytes = null
    } = options;

    const args = ['-i', input];

    const isTrimmed = !isNaN(startSec) && !isNaN(endSec) && (startSec > 0 || endSec < videoDuration - 0.5);

    if (isTrimmed && startSec > 0) {
        args.push('-ss', String(startSec));
    }
    if (isTrimmed && endSec < videoDuration - 0.5) {
        args.push('-to', String(endSec));
    }

    const duration = isTrimmed ? (endSec - startSec) : videoDuration;

    if (fmt === 'gif') {
        let vf = 'fps=10,scale=480:-1:flags=lanczos';
        if (resolution !== 'original') {
            vf = `fps=10,scale=${resolution}:-1:flags=lanczos`;
        }
        if (fps !== 'original') {
            vf = vf.replace('fps=10', `fps=${fps}`);
        }
        args.push('-vf', vf, '-loop', '0');
    } else if (fmt === 'mp3') {
        const bitrates = { high: '320k', medium: '192k', low: '128k', verylow: '64k' };
        args.push('-vn', '-ab', bitrates[quality] || '192k');
    } else if (fmt === 'wav') {
        args.push('-vn');
    } else if (fmt === 'webm') {
        if (targetBytes && duration > 0) {
            const targetBitrate = Math.floor((targetBytes * 8) / duration);
            args.push('-c:v', 'libvpx', '-b:v', targetBitrate + '', '-c:a', 'libvorbis');
        } else {
            const crfMap = { high: '20', medium: '30', low: '40', verylow: '50' };
            const crf = crfMap[quality] || '30';
            args.push('-c:v', 'libvpx', '-crf', crf, '-b:v', '0', '-c:a', 'libvorbis');
        }
        const vfParts = [];
        if (resolution !== 'original') vfParts.push(`scale=${resolution}:-2`);
        if (fps !== 'original') vfParts.push(`fps=${fps}`);
        if (vfParts.length) args.push('-vf', vfParts.join(','));
        if (audio === 'mute') args.push('-an');
    } else if (fmt === 'mp4') {
        if (targetBytes && duration > 0) {
            const targetBitrate = Math.floor((targetBytes * 8) / duration);
            args.push('-c:v', 'libx264', '-b:v', targetBitrate + '', '-preset', 'fast', '-c:a', 'aac');
        } else {
            const crfMap = { high: '20', medium: '28', low: '35', verylow: '42' };
            const crf = crfMap[quality] || '28';
            args.push('-c:v', 'libx264', '-crf', crf, '-preset', 'fast', '-c:a', 'aac');
        }
        const vfParts = [];
        if (resolution !== 'original') vfParts.push(`scale=${resolution}:-2`);
        if (fps !== 'original') vfParts.push(`fps=${fps}`);
        if (vfParts.length) args.push('-vf', vfParts.join(','));
        if (audio === 'mute') args.push('-an');
    }

    args.push(output);
    return args;
}

// ============================================
// TESTS
// ============================================

describe('Video Converter — formatBytes', () => {
    test('formats bytes', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(999)).toBe('999 B');
    });

    test('formats kilobytes', () => {
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(2048)).toBe('2.0 KB');
    });

    test('formats megabytes', () => {
        expect(formatBytes(1048576)).toBe('1.0 MB');
        expect(formatBytes(500 * 1024 * 1024)).toBe('500.0 MB');
    });
});

describe('Video Converter — formatTime', () => {
    test('formats zero', () => {
        expect(formatTime(0)).toBe('00:00:00');
    });

    test('formats seconds only', () => {
        expect(formatTime(45)).toBe('00:00:45');
    });

    test('formats minutes and seconds', () => {
        expect(formatTime(125)).toBe('00:02:05');
    });

    test('formats hours', () => {
        expect(formatTime(3661)).toBe('01:01:01');
    });

    test('formats large values', () => {
        expect(formatTime(7200)).toBe('02:00:00');
    });
});

describe('Video Converter — parseTime', () => {
    test('parses raw seconds', () => {
        expect(parseTime('30')).toBe(30);
        expect(parseTime('90')).toBe(90);
        expect(parseTime('30.5')).toBe(30.5);
    });

    test('parses HH:MM:SS format', () => {
        expect(parseTime('01:02:03')).toBe(3723);
        expect(parseTime('00:00:00')).toBe(0);
    });

    test('parses MM:SS format', () => {
        expect(parseTime('05:30')).toBe(330);
        expect(parseTime('00:45')).toBe(45);
    });

    test('handles whitespace', () => {
        expect(parseTime('  30  ')).toBe(30);
        expect(parseTime('  01:30  ')).toBe(90);
    });

    test('returns NaN for invalid input', () => {
        expect(parseTime('abc')).toBeNaN();
        expect(parseTime('1:2:3:4')).toBeNaN();
        expect(parseTime('')).toBeNaN();
    });
});

describe('Video Converter — getInputExt', () => {
    test('extracts common extensions', () => {
        expect(getInputExt('video.mp4')).toBe('.mp4');
        expect(getInputExt('video.webm')).toBe('.webm');
        expect(getInputExt('video.mkv')).toBe('.mkv');
        expect(getInputExt('video.avi')).toBe('.avi');
    });

    test('lowercases extensions', () => {
        expect(getInputExt('VIDEO.MP4')).toBe('.mp4');
        expect(getInputExt('file.MOV')).toBe('.mov');
    });

    test('returns .mp4 fallback for no extension', () => {
        expect(getInputExt('noext')).toBe('.mp4');
    });

    test('extracts last extension from multi-dot names', () => {
        expect(getInputExt('my.video.clip.mp4')).toBe('.mp4');
    });
});

describe('Video Converter — getMimeType', () => {
    test('maps video formats', () => {
        expect(getMimeType('mp4')).toBe('video/mp4');
        expect(getMimeType('webm')).toBe('video/webm');
    });

    test('maps image format (gif)', () => {
        expect(getMimeType('gif')).toBe('image/gif');
    });

    test('maps audio formats', () => {
        expect(getMimeType('mp3')).toBe('audio/mpeg');
        expect(getMimeType('wav')).toBe('audio/wav');
    });

    test('returns octet-stream for unknown', () => {
        expect(getMimeType('xyz')).toBe('application/octet-stream');
    });
});

describe('Video Converter — stripExt', () => {
    test('strips extensions', () => {
        expect(stripExt('video.mp4')).toBe('video');
        expect(stripExt('my.video.mp4')).toBe('my.video');
    });

    test('handles files without extension', () => {
        expect(stripExt('noext')).toBe('noext');
    });
});

describe('Video Converter — buildFFmpegArgs', () => {
    test('builds basic MP4 conversion args', () => {
        const args = buildFFmpegArgs('input.webm', 'output.mp4', 'mp4', 'medium');
        expect(args[0]).toBe('-i');
        expect(args[1]).toBe('input.webm');
        expect(args).toContain('-c:v');
        expect(args).toContain('libx264');
        expect(args).toContain('-crf');
        expect(args).toContain('28'); // medium CRF
        expect(args[args.length - 1]).toBe('output.mp4');
    });

    test('builds high quality MP4 args', () => {
        const args = buildFFmpegArgs('input.webm', 'output.mp4', 'mp4', 'high');
        expect(args).toContain('20'); // high CRF
    });

    test('builds WEBM conversion args', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.webm', 'webm', 'medium');
        expect(args).toContain('libvpx');
        expect(args).toContain('libvorbis');
    });

    test('builds GIF args', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.gif', 'gif', 'medium');
        expect(args).toContain('-vf');
        expect(args).toContain('-loop');
        expect(args).toContain('0');
    });

    test('builds MP3 extraction args', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.mp3', 'mp3', 'medium');
        expect(args).toContain('-vn');
        expect(args).toContain('-ab');
        expect(args).toContain('192k');
    });

    test('builds WAV extraction args', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.wav', 'wav', 'medium');
        expect(args).toContain('-vn');
    });

    test('includes trim args when trimmed', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.mp4', 'mp4', 'medium', {
            startSec: 5,
            endSec: 30,
            videoDuration: 60
        });
        expect(args).toContain('-ss');
        expect(args).toContain('5');
        expect(args).toContain('-to');
        expect(args).toContain('30');
    });

    test('does not include trim args when not trimmed', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.mp4', 'mp4', 'medium', {
            startSec: 0,
            endSec: 60,
            videoDuration: 60
        });
        expect(args).not.toContain('-ss');
        expect(args).not.toContain('-to');
    });

    test('includes resolution filter for MP4', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.mp4', 'mp4', 'medium', {
            resolution: '1280'
        });
        expect(args).toContain('-vf');
        const vfIdx = args.indexOf('-vf');
        expect(args[vfIdx + 1]).toContain('scale=1280:-2');
    });

    test('includes FPS filter for MP4', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.mp4', 'mp4', 'medium', {
            fps: '30'
        });
        expect(args).toContain('-vf');
        const vfIdx = args.indexOf('-vf');
        expect(args[vfIdx + 1]).toContain('fps=30');
    });

    test('mutes audio when requested', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.mp4', 'mp4', 'medium', {
            audio: 'mute'
        });
        expect(args).toContain('-an');
    });

    test('calculates target bitrate for MP4', () => {
        const targetBytes = 8 * 1024 * 1024; // 8 MB
        const args = buildFFmpegArgs('input.mp4', 'output.mp4', 'mp4', 'medium', {
            targetBytes,
            videoDuration: 60
        });
        const expectedBitrate = Math.floor((targetBytes * 8) / 60);
        expect(args).toContain('-b:v');
        expect(args).toContain(String(expectedBitrate));
    });

    test('uses custom resolution for GIF', () => {
        const args = buildFFmpegArgs('input.mp4', 'output.gif', 'gif', 'medium', {
            resolution: '640'
        });
        const vfIdx = args.indexOf('-vf');
        expect(args[vfIdx + 1]).toContain('scale=640');
    });

    test('MP3 quality presets produce correct bitrates', () => {
        const highArgs = buildFFmpegArgs('input.mp4', 'output.mp3', 'mp3', 'high');
        expect(highArgs).toContain('320k');

        const lowArgs = buildFFmpegArgs('input.mp4', 'output.mp3', 'mp3', 'low');
        expect(lowArgs).toContain('128k');

        const vlArgs = buildFFmpegArgs('input.mp4', 'output.mp3', 'mp3', 'verylow');
        expect(vlArgs).toContain('64k');
    });
});
