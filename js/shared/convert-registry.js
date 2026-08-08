// What can be converted into what, as data.
//
// The routing table is the whole point of the converter hub: adding a format is
// a row here plus, at most, one branch inside one engine -- never a branch in
// the page controller. Everything in this file is pure, so the support matrix
// is testable without a browser, a canvas or ffmpeg.
//
// The engines themselves live in convert/js/engines/ and are loaded lazily, so
// converting a PNG to WebP downloads no ffmpeg at all.

import { getExtension, sanitiseFilename, stripExtension } from './format.js';

/** @typedef {'image'|'video'|'audio'|'unknown'} Kind */

export const KINDS = Object.freeze(['image', 'video', 'audio']);

/**
 * Extensions we accept per kind.
 *
 * MIME comes first when detecting, but it cannot be relied on alone: browsers
 * report an empty type for .mkv and .avi on some platforms, and Windows reports
 * .m4a as audio/mp4 which is indistinguishable from video/mp4 by prefix.
 */
const EXTENSIONS = Object.freeze({
    image: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif', 'svg', 'ico'],
    video: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'ogv', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv'],
    audio: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'wma', 'aiff'],
});

/**
 * Output targets.
 *
 * `engine` names the module under convert/js/engines/. `options` lists the
 * control ids from OPTION_SPECS that apply, so the UI is rendered from this
 * table rather than a hand-written show/hide cascade.
 */
export const TARGETS = Object.freeze([
    // --- image -> image (canvas, no dependencies) ---
    { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', kind: 'image', engine: 'image', lossless: true, options: ['resize', 'targetSize'] },
    { id: 'jpg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', kind: 'image', engine: 'image', options: ['quality', 'resize', 'targetSize', 'matte'] },
    { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', kind: 'image', engine: 'image', options: ['quality', 'resize', 'targetSize'] },
    { id: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', kind: 'image', engine: 'image', options: ['quality', 'resize', 'targetSize'] },

    // --- video -> video/animation ---
    { id: 'mp4', label: 'MP4 (H.264)', mime: 'video/mp4', ext: 'mp4', kind: 'video', engine: 'media', options: ['videoQuality', 'resolution', 'fps', 'audioTrack', 'trim', 'targetSize'] },
    { id: 'webm', label: 'WebM (VP8)', mime: 'video/webm', ext: 'webm', kind: 'video', engine: 'media', options: ['videoQuality', 'resolution', 'fps', 'audioTrack', 'trim', 'targetSize'] },
    { id: 'gif', label: 'Animated GIF', mime: 'image/gif', ext: 'gif', kind: 'video', engine: 'media', options: ['resolution', 'fps', 'trim'] },

    // --- video/audio -> audio. Extracting a soundtrack is the main use case. ---
    { id: 'mp3', label: 'MP3', mime: 'audio/mpeg', ext: 'mp3', kind: 'audio', engine: 'media', options: ['bitrate', 'trim', 'normalise'] },
    { id: 'm4a', label: 'M4A (AAC)', mime: 'audio/mp4', ext: 'm4a', kind: 'audio', engine: 'media', options: ['bitrate', 'trim', 'normalise'] },
    { id: 'ogg', label: 'OGG (Vorbis)', mime: 'audio/ogg', ext: 'ogg', kind: 'audio', engine: 'media', options: ['bitrate', 'trim', 'normalise'] },
    { id: 'opus', label: 'Opus', mime: 'audio/ogg', ext: 'opus', kind: 'audio', engine: 'media', options: ['bitrate', 'trim', 'normalise'] },
    { id: 'wav', label: 'WAV (uncompressed)', mime: 'audio/wav', ext: 'wav', kind: 'audio', engine: 'media', options: ['trim', 'normalise'] },
    { id: 'flac', label: 'FLAC (lossless)', mime: 'audio/flac', ext: 'flac', kind: 'audio', engine: 'media', options: ['trim', 'normalise'] },
]);

/**
 * Which target kinds each input kind can produce.
 *
 * Video can become audio (extract the soundtrack) but audio can never become
 * video, and neither crosses to image -- a "frame grab" is a different feature
 * with different controls, not a format conversion.
 */
const ROUTES = Object.freeze({
    image: ['image'],
    video: ['video', 'audio'],
    audio: ['audio'],
});

/** Sensible default output per input kind. */
const DEFAULT_TARGET = Object.freeze({
    image: 'webp',   // meaningfully smaller than PNG or JPEG at equal quality
    video: 'mp4',
    audio: 'mp3',
});

/**
 * Declarative option specs. `showWhen` is evaluated against the chosen target's
 * `options` list, so convert/js/ui.js can render the panel generically.
 */
export const OPTION_SPECS = Object.freeze([
    {
        id: 'quality', label: 'Quality', type: 'range', min: 1, max: 100, default: 80,
        hint: 'Higher keeps more detail and makes a bigger file.',
    },
    {
        id: 'videoQuality', label: 'Quality', type: 'select', default: 'medium',
        choices: [
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
            { value: 'verylow', label: 'Very low' },
        ],
    },
    {
        id: 'resize', label: 'Resize', type: 'select', default: 'original',
        choices: [
            { value: 'original', label: 'Original size' },
            { value: '3840', label: 'Max 3840px' },
            { value: '1920', label: 'Max 1920px' },
            { value: '1280', label: 'Max 1280px' },
            { value: '800', label: 'Max 800px' },
            { value: '500', label: 'Max 500px' },
        ],
    },
    {
        id: 'resolution', label: 'Resolution', type: 'select', default: 'original',
        choices: [
            { value: 'original', label: 'Original' },
            { value: '1920', label: '1080p' },
            { value: '1280', label: '720p' },
            { value: '854', label: '480p' },
            { value: '640', label: '360p' },
            { value: '426', label: '240p' },
        ],
    },
    {
        id: 'fps', label: 'Frame rate', type: 'select', default: 'original',
        choices: [
            { value: 'original', label: 'Original' },
            { value: '60', label: '60 fps' },
            { value: '30', label: '30 fps' },
            { value: '24', label: '24 fps' },
            { value: '15', label: '15 fps' },
            { value: '10', label: '10 fps' },
        ],
    },
    {
        id: 'bitrate', label: 'Bitrate', type: 'select', default: '192k',
        choices: ['320k', '256k', '192k', '128k', '96k', '64k']
            .map((value) => ({ value, label: value })),
    },
    {
        id: 'audioTrack', label: 'Audio', type: 'select', default: 'keep',
        choices: [
            { value: 'keep', label: 'Keep audio' },
            { value: 'mute', label: 'Remove audio' },
        ],
    },
    { id: 'normalise', label: 'Normalise loudness', type: 'checkbox', default: false },
    {
        id: 'trim', label: 'Trim', type: 'trim', default: null,
        hint: 'Leave blank to convert the whole file.',
    },
    {
        id: 'targetSize', label: 'Target file size', type: 'size', default: null,
        // "Small enough to send" is the actual goal behind most conversions,
        // and typing a number is a worse way to express it than picking one.
        //
        // The chips are labelled by SIZE, not by service. A chip saying
        // "Discord" or "Gmail" would be asserting a third party's current
        // upload limit, which changes without notice -- Discord's free limit
        // has already moved once -- and a stale number here would be
        // confidently wrong in a way nobody would notice until a send failed.
        presets: [
            { label: '1 MB', value: 1, unit: 'mb' },
            { label: '5 MB', value: 5, unit: 'mb' },
            { label: '10 MB', value: 10, unit: 'mb' },
            { label: '25 MB', value: 25, unit: 'mb' },
        ],
        hint: 'Optional. Compresses towards this size — email and chat apps usually cap attachments around 25 MB.',
    },
    {
        id: 'matte', label: 'Background', type: 'colour', default: '#ffffff',
        hint: 'Fills transparency — this format has no alpha channel.',
    },
]);

const SPEC_BY_ID = new Map(OPTION_SPECS.map((spec) => [spec.id, spec]));

export function optionSpec(id) {
    return SPEC_BY_ID.get(id) ?? null;
}

/**
 * What kind of file is this?
 *
 * MIME first, extension as the fallback. Extension wins for the container
 * formats browsers report as an empty string, which is most of the interesting
 * video ones.
 */
export function detectKind(file) {
    const type = (file?.type || '').toLowerCase();
    const ext = getExtension(file?.name || '');

    // An extension we recognise beats a vague MIME type: Windows reports .m4a
    // as audio/mp4 and .mp4 as video/mp4, but reports .mkv as nothing at all.
    for (const kind of KINDS) {
        if (EXTENSIONS[kind].includes(ext)) return kind;
    }

    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';

    return 'unknown';
}

/** Every target reachable from this input kind. */
export function targetsFor(kind) {
    const allowed = ROUTES[kind] ?? [];
    return TARGETS.filter((target) => allowed.includes(target.kind));
}

export function findTarget(id) {
    return TARGETS.find((target) => target.id === id) ?? null;
}

export function engineFor(target) {
    return typeof target === 'string' ? findTarget(target)?.engine ?? null : target?.engine ?? null;
}

export function isSupported(kind, targetId) {
    return targetsFor(kind).some((target) => target.id === targetId);
}

export function defaultTarget(kind) {
    return DEFAULT_TARGET[kind] ?? null;
}

/** Which option controls apply to a target, in the order they should render. */
export function optionsFor(targetId) {
    const target = findTarget(targetId);
    if (!target) return [];
    return target.options.map((id) => optionSpec(id)).filter(Boolean);
}

/** Default values for a target's options, as a plain object. */
export function defaultOptions(targetId) {
    const values = {};
    for (const spec of optionsFor(targetId)) values[spec.id] = spec.default;
    return values;
}

/**
 * Output filename for an input.
 *
 * The name comes from a dropped file, so it is reduced to its leaf and
 * sanitised here rather than at the call site.
 */
export function outputName(inputName, target) {
    const spec = typeof target === 'string' ? findTarget(target) : target;
    const ext = spec?.ext ?? 'bin';
    const leaf = String(inputName ?? '').split(/[/\\]/).pop() ?? '';
    const stem = sanitiseFilename(stripExtension(leaf), 'converted');
    return `${stem || 'converted'}.${ext}`;
}

/** Human label for a kind, for the "3 videos, 1 image" summary line. */
export function describeKind(kind, count = 1) {
    const nouns = { image: 'image', video: 'video', audio: 'audio file', unknown: 'file' };
    const noun = nouns[kind] ?? 'file';
    if (count === 1) return `1 ${noun}`;
    return `${count} ${noun === 'audio file' ? 'audio files' : `${noun}s`}`;
}
