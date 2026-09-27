// Transcripts as the three things people want: SubRip, WebVTT, or prose.
//
// Pure: data in, strings out, so tests import the real thing. Ported from the
// unmerged youtube-error-recovery-and-transcript branch, minus its YouTube
// caption parser and the rolling-caption de-duplication that only YouTube's
// auto-captions needed (it would drop a real repeated "Yes." from Whisper).

function pad(value, width = 2) {
    return String(Math.floor(value)).padStart(width, '0');
}

/**
 * Seconds to `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT). Rounded to the
 * millisecond first, so 1.9996 s is 00:00:02,000 and not 00:00:01,1000.
 */
export function formatTimestamp(seconds, separator = ',') {
    const totalMs = Math.round(Math.max(0, Number(seconds) || 0) * 1000);
    const s = Math.floor(totalMs / 1000);
    return `${pad(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}${separator}${pad(totalMs % 1000, 3)}`;
}

/**
 * Whisper's `{ timestamp: [start, end], text }` chunks to cues.
 *
 * The last chunk's end is often null (the model stopped mid-sentence), and
 * sometimes a start is; both are filled from the neighbours or the audio's
 * length rather than written as 00:00:00. Empty chunks are dropped.
 */
export function fromWhisperChunks(chunks, duration = 0) {
    const cues = [];
    const list = (chunks ?? []).filter((chunk) => chunk?.text?.trim());
    list.forEach((chunk, i) => {
        const [rawStart, rawEnd] = chunk.timestamp ?? [];
        const start = Number.isFinite(rawStart) ? rawStart : (cues.at(-1)?.end ?? 0);
        const nextStart = list[i + 1]?.timestamp?.[0];
        let end = Number.isFinite(rawEnd) ? rawEnd : (Number.isFinite(nextStart) ? nextStart : duration);
        if (!(end > start)) end = start + 1;
        cues.push({ start, end, lines: [chunk.text.trim()] });
    });
    return cues;
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
        .map((cue) => [
            `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}`,
            cue.lines.join('\n'),
        ].join('\n'))
        .join('\n\n');
    return `WEBVTT\n\n${body}${cues.length ? '\n' : ''}`;
}

/**
 * Cues to readable prose. A pause longer than `paragraphGapSeconds` starts a
 * new paragraph -- the only paragraph boundary speech gives you.
 * `timestamps` prefixes each paragraph with [MM:SS], for skimming a long talk.
 */
export function toPlainText(cues, { timestamps = false, paragraphGapSeconds = 3 } = {}) {
    if (!cues.length) return '';
    const paragraphs = [[cues[0]]];
    for (let i = 1; i < cues.length; i += 1) {
        if (cues[i].start - cues[i - 1].end > paragraphGapSeconds) paragraphs.push([]);
        paragraphs.at(-1).push(cues[i]);
    }
    return paragraphs
        .map((p) => {
            const body = p.flatMap((cue) => cue.lines).join(' ').replace(/\s+/g, ' ').trim();
            if (!timestamps) return body;
            const at = p[0].start;
            return `[${pad(at / 60)}:${pad(at % 60)}] ${body}`;
        })
        .join('\n\n') + '\n';
}
