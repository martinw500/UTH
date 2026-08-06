// Pure argument building for the audio converter.
//
// Kept free of the DOM so the command can be tested directly. The encoder list
// is not guessed: `ffmpeg -encoders` was run inside ffmpeg.wasm and every codec
// named here was present in @ffmpeg/core@0.12.6.

export const AUDIO_FORMATS = {
    mp3: { label: 'MP3', mime: 'audio/mpeg', codec: 'libmp3lame', bitrate: true },
    m4a: { label: 'M4A (AAC)', mime: 'audio/mp4', codec: 'aac', bitrate: true },
    ogg: { label: 'OGG (Vorbis)', mime: 'audio/ogg', codec: 'libvorbis', bitrate: true },
    opus: { label: 'Opus', mime: 'audio/ogg', codec: 'libopus', bitrate: true },
    wav: { label: 'WAV (uncompressed)', mime: 'audio/wav', codec: 'pcm_s16le', bitrate: false },
    flac: { label: 'FLAC (lossless)', mime: 'audio/flac', codec: 'flac', bitrate: false },
};

export const BITRATES = ['320k', '256k', '192k', '128k', '96k', '64k'];

export function getMimeType(fmt) {
    return AUDIO_FORMATS[fmt]?.mime || 'application/octet-stream';
}

export function supportsBitrate(fmt) {
    return Boolean(AUDIO_FORMATS[fmt]?.bitrate);
}

/**
 * Build the ffmpeg command line for an audio export.
 *
 * @param {object} options
 * @param {number} options.startSec    trim start, seconds
 * @param {number|null} options.endSec trim end, seconds
 * @param {number} options.sourceDuration seconds; used to decide whether a trim is real
 */
export function buildAudioArgs({
    input,
    output,
    format,
    bitrate = '192k',
    sampleRate = 'original',
    channels = 'original',
    startSec = 0,
    endSec = null,
    sourceDuration = 0,
    normalise = false,
    fadeIn = 0,
    fadeOut = 0,
} = {}) {
    const spec = AUDIO_FORMATS[format];
    if (!spec) throw new Error(`Unsupported output format: ${format}`);

    const start = Number.isFinite(startSec) && startSec > 0 ? startSec : 0;
    const end = Number.isFinite(endSec) ? endSec : null;
    const trimmed = start > 0
        || (end !== null && sourceDuration > 0 && end < sourceDuration - 0.05);
    const outDuration = trimmed && end !== null
        ? Math.max(0, end - start)
        : Math.max(0, sourceDuration - start);

    const args = [];

    // -ss BEFORE -i is input seeking: ffmpeg jumps straight to the point rather
    // than decoding and discarding everything before it. That matters for a long
    // podcast. The consequence is that the output timeline is rebased to zero,
    // so the end must be given as -t <duration> and NOT -to <absolute end>;
    // -to here would silently produce a clip of the wrong length.
    //
    // The video converter deliberately does the opposite (output seeking, after
    // -i) because it re-encodes the whole stream anyway. Do not "fix" one to
    // match the other.
    if (start > 0) args.push('-ss', String(start));
    args.push('-i', input);
    if (trimmed && end !== null) args.push('-t', String(outDuration));

    // Never carry a video stream through — cover art in an MP3 is a video
    // stream, and it turns an audio-only export into a broken file.
    args.push('-vn');
    args.push('-map_metadata', '0');

    const filters = [];
    if (normalise) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
    // The fade-out start is on the OUTPUT timeline, so it comes from the
    // trimmed duration, not the source duration.
    if (fadeOut > 0 && outDuration > fadeOut) {
        filters.push(`afade=t=out:st=${round3(outDuration - fadeOut)}:d=${fadeOut}`);
    }
    if (filters.length) args.push('-af', filters.join(','));

    if (sampleRate !== 'original') args.push('-ar', String(sampleRate));
    if (channels === 'mono') args.push('-ac', '1');
    else if (channels === 'stereo') args.push('-ac', '2');

    args.push('-c:a', spec.codec);
    if (spec.bitrate) args.push('-b:a', bitrate);
    else if (format === 'flac') args.push('-compression_level', '5');

    args.push(output);
    return args;
}

function round3(n) {
    return Math.round(n * 1000) / 1000;
}
