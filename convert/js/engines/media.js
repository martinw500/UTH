// Video and audio conversion, through ffmpeg.wasm.
//
// Reuses js/shared/ffmpeg.js -- the loader that memoises the load *promise*
// (not a flag set afterwards, which let two quick clicks download the core
// twice) and discovers the worker chunk name at runtime.
//
// Nothing at this module's top level touches ffmpeg, so loading this engine is
// cheap; the core is only fetched when a conversion actually runs. That is why
// the engines are imported lazily: a PNG-to-WebP job downloads none of it.

import { loadFFmpeg, runFFmpeg, ffmpegUnavailableReason } from '../../../js/shared/ffmpeg.js';
import { buildFFmpegArgs, getInputExt } from '../../../video-converter/js/video-args.js';
import { buildAudioArgs } from '../../../audio-converter/js/audio-args.js';
import { outputName } from '../../../js/shared/convert-registry.js';
import { parseTargetBytes } from '../../../js/shared/compression.js';
import { parseTime } from '../../../js/shared/format.js';

export const id = 'media';
export const kinds = Object.freeze(['video', 'audio']);

/**
 * Read a media file's duration without decoding it.
 *
 * Needed because trim and target-size bitrate both depend on it. Resolves to 0
 * rather than rejecting: a container the browser cannot preview may still be
 * one ffmpeg can convert, and a missing duration only disables those options.
 */
export function probeDuration(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const media = document.createElement('video');
        const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
        media.preload = 'metadata';
        media.onloadedmetadata = () => done(Number.isFinite(media.duration) ? media.duration : 0);
        media.onerror = () => done(0);
        media.src = url;
    });
}

/** Trim inputs are 'mm:ss' or 'hh:mm:ss' or bare seconds; blank means no trim. */
function resolveTrim(trim, duration) {
    const start = parseTime(trim?.start ?? '');
    const end = parseTime(trim?.end ?? '');
    return {
        startSec: Number.isFinite(start) ? start : 0,
        endSec: Number.isFinite(end) ? end : (duration || null),
    };
}

export async function convert(file, { target, options = {}, signal, onProgress = () => {} }) {
    const blocked = ffmpegUnavailableReason();
    if (blocked) throw new Error(blocked);

    onProgress({ phase: 'load', ratio: 0, note: 'Loading the converter…' });
    const ffmpeg = await loadFFmpeg({
        onProgress: ({ ratio }) => onProgress({
            phase: 'run', ratio: Math.max(0, Math.min(1, ratio)), note: 'Converting…',
        }),
        onStatus: (_phase, message) => onProgress({ phase: 'load', ratio: 0.05, note: message }),
    });
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const duration = await probeDuration(file);
    const { startSec, endSec } = resolveTrim(options.trim, duration);
    const inputName = `input.${getInputExt(file.name)}`;
    const outName = outputName(file.name, target);
    const outputFile = `output.${target.ext}`;

    const args = target.kind === 'audio'
        ? buildAudioArgs({
            input: inputName,
            output: outputFile,
            format: target.id,
            bitrate: options.bitrate ?? '192k',
            startSec,
            endSec,
            sourceDuration: duration,
            normalise: Boolean(options.normalise),
        })
        : buildFFmpegArgs(inputName, outputFile, target.id, options.videoQuality ?? 'medium', {
            startSec,
            endSec: endSec ?? NaN,
            videoDuration: duration || 60,
            resolution: options.resolution ?? 'original',
            fps: options.fps ?? 'original',
            audio: options.audioTrack ?? 'keep',
            targetBytes: parseTargetBytes(options.targetSize?.value, options.targetSize?.unit),
        });

    const blob = await runFFmpeg(ffmpeg, {
        inputName,
        inputFile: file,
        args,
        outputName: outputFile,
        mimeType: target.mime,
        onStatus: (phase, message) => onProgress({ phase, ratio: undefined, note: message }),
    });

    onProgress({ phase: 'done', ratio: 1, note: '' });
    return { blob, filename: outName, meta: { duration } };
}
