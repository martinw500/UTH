// Pure argument building for the video converter.
//
// Split out from video-converter.js so it can be tested without a DOM: it used
// to read the form controls directly, which meant the only way to check a
// command was to rebuild the function inside the test and hope the copy stayed
// in step with the original.

export function getInputExt(filename) {
    const m = filename.match(/(\.[^.]+)$/);
    return m ? m[1].toLowerCase() : '.mp4';
}

export function getMimeType(fmt) {
    const map = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        gif: 'image/gif',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
    };
    return map[fmt] || 'application/octet-stream';
}

/**
 * Build the ffmpeg command line.
 *
 * Note `-ss`/`-to` land after `-i`, which is output seeking: ffmpeg decodes and
 * discards everything before the start point. That is slower than seeking the
 * input but frame-accurate, and it keeps `-to` meaning an absolute timestamp on
 * the source timeline. The audio converter deliberately does the opposite —
 * see the comment there before making these two match.
 */
export function buildFFmpegArgs(input, output, fmt, quality, options = {}) {
    const {
        startSec = NaN,
        endSec = NaN,
        videoDuration = 60,
        resolution = 'original',
        fps = 'original',
        audio = 'keep',
        targetBytes = null,
    } = options;

    const args = ['-i', input];

    const isTrimmed = !isNaN(startSec) && !isNaN(endSec)
        && (startSec > 0 || endSec < videoDuration - 0.5);

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
            args.push('-c:v', 'libvpx', '-crf', crfMap[quality] || '30', '-b:v', '0', '-c:a', 'libvorbis');
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
            args.push('-c:v', 'libx264', '-crf', crfMap[quality] || '28', '-preset', 'fast', '-c:a', 'aac');
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
