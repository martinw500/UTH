// Pure argument building for the video converter.
//
// Split out from video-converter.js so it can be tested without a DOM: it used
// to read the form controls directly, which meant the only way to check a
// command was to rebuild the function inside the test and hope the copy stayed
// in step with the original.

import { reachesEnd } from '../../js/shared/format.js';

/** Audio bitrate a target-size export reserves before sizing the video. */
const TARGET_AUDIO_BITS = 128000;

/**
 * Video bitrate that keeps the whole file near `targetBytes`: 5% for the
 * container, and the audio's fixed share first. Giving video the whole budget
 * put every target-size export over the target.
 */
function targetVideoBitrate(targetBytes, duration, withAudio) {
    const total = (targetBytes * 8 * 0.95) / duration;
    return Math.max(50000, Math.floor(total - (withAudio ? TARGET_AUDIO_BITS : 0)));
}

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
        videoDuration = 0,
        resolution = 'original',
        fps = 'original',
        audio = 'keep',
        targetBytes = null,
    } = options;

    const args = ['-i', input];

    // videoDuration is 0 when the browser could not read it. Then a typed end
    // is still honoured, but a target size cannot be computed.
    const start = Number.isFinite(startSec) && startSec > 0 ? startSec : 0;
    const end = Number.isFinite(endSec) && !reachesEnd(endSec, videoDuration) ? endSec : null;

    // Said plainly here: otherwise the duration clamps to 0 and a target size
    // blames the browser for not knowing the video's length.
    if (end !== null && end <= start) throw new Error('The trim end must come after the trim start.');

    if (start > 0) args.push('-ss', String(start));
    if (end !== null) args.push('-to', String(end));

    const duration = Math.max(0, (end ?? videoDuration) - start);
    if (targetBytes && !(duration > 0) && (fmt === 'mp4' || fmt === 'webm')) {
        throw new Error(`A target size needs the video's length, which this browser `
            + 'cannot read for this file. Pick a quality instead, or set a trim end.');
    }
    const withAudio = audio !== 'mute';

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
            args.push('-c:v', 'libvpx', '-b:v', String(targetVideoBitrate(targetBytes, duration, withAudio)));
            if (withAudio) args.push('-c:a', 'libvorbis', '-b:a', '128k');
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
            args.push('-c:v', 'libx264', '-b:v', String(targetVideoBitrate(targetBytes, duration, withAudio)),
                '-preset', 'fast');
            if (withAudio) args.push('-c:a', 'aac', '-b:a', '128k');
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
