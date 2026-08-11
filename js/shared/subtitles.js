/**
 * Turn YouTube's timed text into the three things people actually want:
 * WebVTT, SubRip, or readable prose.
 *
 * Pure: strings in, strings out, no DOM and no network, so
 * `tests/subtitles.test.js` imports the real thing.
 *
 * The hard part is not the format. It is that YouTube's auto-captions are
 * written for a *rolling two-line display*, so consecutive cues repeat the
 * previous line as they scroll:
 *
 *     00:01.0 --> 00:03.0   so what I want to do here
 *     00:03.0 --> 00:05.0   so what I want to do here
 *                           is show you the thing
 *
 * Concatenating those naively doubles most of the transcript. `toPlainText`
 * drops a line that the previous cue already ended with, which is what makes
 * the output readable rather than a stutter.
 */

const TIMESTAMP = /(\d{1,3}):(\d{2}):(\d{2})[.,](\d{1,3})|(\d{1,3}):(\d{2})[.,](\d{1,3})/;
const CUE_SEPARATOR = /-->/;

/** Inline karaoke/position markup: <00:00:01.234>, <c.colorE5E5E5>, </c>. */
const INLINE_TAGS = /<\/?[^>]+>/g;

/** Cue settings that trail the timestamp line: align:start position:0%. */
const CUE_SETTINGS = /\s+(?:align|position|size|line|vertical|region):\S+/g;

/**
 * Parse WebVTT (and the SRT that shares its shape) into cues.
 * Returns `[{ start, end, lines }]` with times in seconds.
 */
export function parseTimedText(source) {
    if (typeof source !== 'string' || !source.trim()) return [];

    const text = source.replace(/\r\n?/g, '\n');
    const cues = [];

    for (const block of text.split(/\n{2,}/)) {
        const lines = block.split('\n');
        const timingIndex = lines.findIndex(line => CUE_SEPARATOR.test(line));
        if (timingIndex === -1) continue;

        const [rawStart, rawEnd] = lines[timingIndex]
            .replace(CUE_SETTINGS, '')
            .split(CUE_SEPARATOR)
            .map(part => part.trim());

        const start = parseTimestamp(rawStart);
        const end = parseTimestamp(rawEnd);
        if (start === null) continue;

        const body = lines
            .slice(timingIndex + 1)
            .map(line => line.replace(INLINE_TAGS, '').trim())
            .filter(Boolean);

        if (!body.length) continue;
        cues.push({ start, end: end === null ? start : end, lines: body });
    }

    return cues;
}

/** `HH:MM:SS.mmm` or `MM:SS.mmm` to seconds. Returns null if it is neither. */
export function parseTimestamp(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(TIMESTAMP);
    if (!match) return null;

    if (match[1] !== undefined) {
        const [, h, m, s, ms] = match;
        return Number(h) * 3600 + Number(m) * 60 + Number(s) + msToSeconds(ms);
    }
    const [, , , , , m, s, ms] = match;
    return Number(m) * 60 + Number(s) + msToSeconds(ms);
}

function msToSeconds(ms) {
    // "5" means 500ms, not 5ms -- it is a fraction, so pad rather than parse.
    return Number(String(ms).padEnd(3, '0')) / 1000;
}

function pad(value, width = 2) {
    return String(Math.floor(value)).padStart(width, '0');
}

/** Seconds to `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT). */
export function formatTimestamp(seconds, separator = ',') {
    const safe = Math.max(0, Number(seconds) || 0);
    const ms = Math.round((safe - Math.floor(safe)) * 1000);
    return `${pad(safe / 3600)}:${pad((safe / 60) % 60)}:${pad(safe % 60)}${separator}${pad(ms, 3)}`;
}

/** Cues to SubRip. */
export function toSrt(cues) {
    return cues
        .map((cue, index) => [
            index + 1,
            `${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}`,
            cue.lines.join('\n'),
        ].join('\n'))
        .join('\n\n')
        + (cues.length ? '\n' : '');
}

/** Cues to WebVTT. */
export function toVtt(cues) {
    const body = cues
        .map(cue => [
            `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}`,
            cue.lines.join('\n'),
        ].join('\n'))
        .join('\n\n');
    return `WEBVTT\n\n${body}${cues.length ? '\n' : ''}`;
}

/**
 * Cues to readable prose, with the rolling-window duplication removed.
 *
 * `timestamps` prefixes each paragraph with `[MM:SS]`, which is what you want
 * for skimming a long talk and useless for pasting into a document.
 */
export function toPlainText(cues, { timestamps = false, paragraphGapSeconds = 3 } = {}) {
    const spoken = [];
    let previousLast = null;

    for (const cue of cues) {
        for (const line of cue.lines) {
            // The rolling-caption repeat: this cue re-states the tail of the
            // last one so the viewer can read two lines at a time.
            if (line === previousLast) continue;
            spoken.push({ text: line, start: cue.start });
            previousLast = line;
        }
    }

    if (!spoken.length) return '';

    const paragraphs = [];
    let current = [spoken[0]];

    for (let i = 1; i < spoken.length; i += 1) {
        // A real pause in speech is the only paragraph boundary available;
        // captions carry no punctuation reliably enough to split on.
        const gap = spoken[i].start - spoken[i - 1].start;
        if (gap > paragraphGapSeconds) {
            paragraphs.push(current);
            current = [];
        }
        current.push(spoken[i]);
    }
    paragraphs.push(current);

    return paragraphs
        .filter(p => p.length)
        .map((p) => {
            const body = p.map(entry => entry.text).join(' ').replace(/\s+/g, ' ').trim();
            if (!timestamps) return body;
            const at = p[0].start;
            return `[${pad(at / 60)}:${pad(at % 60)}] ${body}`;
        })
        .join('\n\n') + '\n';
}

/** One call for the page: raw timed text plus a target format. */
export function convert(source, format, options = {}) {
    const cues = parseTimedText(source);
    if (format === 'srt') return toSrt(cues);
    if (format === 'vtt') return toVtt(cues);
    return toPlainText(cues, options);
}

/** How long the transcript covers, for the "12:34 of captions" line. */
export function totalDuration(cues) {
    if (!cues.length) return 0;
    return cues[cues.length - 1].end;
}
