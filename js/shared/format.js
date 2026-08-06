// Formatting helpers shared by every tool.
//
// These were previously reimplemented per tool (formatSize in the image editor,
// formatBytes in the video converter, formatDuration in the YouTube downloader)
// and re-declared a third time inside the test files.

/**
 * Human-readable byte size.
 *
 * `mbDecimals` exists because the image editor showed 2 decimals for MB and the
 * video converter showed 1. Both call sites keep their original output.
 */
export function formatBytes(bytes, { mbDecimals = 2 } = {}) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(mbDecimals)} MB`;
}

/** Strip a trailing file extension: "a.b.png" -> "a.b" */
export function stripExtension(filename) {
    if (typeof filename !== 'string') return '';
    return filename.replace(/\.[^/.]+$/, '');
}

/** File extension in lower case, without the dot. "" if there isn't one. */
export function getExtension(filename) {
    if (typeof filename !== 'string') return '';
    const match = filename.match(/\.([^/.]+)$/);
    return match ? match[1].toLowerCase() : '';
}

/** Compact duration for display: 1:05, 1:02:03. */
export function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Zero-padded hh:mm:ss, for timeline scrubbers where width must not jump. */
export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

/** Parse "ss", "mm:ss" or "hh:mm:ss" into seconds. NaN if unparseable. */
export function parseTime(value) {
    if (typeof value !== 'string' || !value.trim()) return NaN;
    const parts = value.trim().split(':');
    if (parts.length > 3) return NaN;

    let seconds = 0;
    for (const part of parts) {
        if (!/^\d+(\.\d+)?$/.test(part.trim())) return NaN;
        seconds = seconds * 60 + parseFloat(part);
    }
    return seconds;
}

/** Abbreviated view/like counts: 1.2K, 3.4M, 5.6B. */
export function formatViews(views) {
    const n = Number(views);
    if (!Number.isFinite(n) || n < 0) return '0';
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(Math.floor(n));
}

/**
 * Make a string safe to use as a download filename.
 *
 * Strips path separators and the characters Windows rejects, so a video title
 * cannot escape the filename or produce an unsaveable file.
 */
export function sanitiseFilename(name, fallback = 'download') {
    if (typeof name !== 'string') return fallback;
    const cleaned = name
        .replace(/[/\\?%*:|"<>\x00-\x1f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .slice(0, 120);
    return cleaned || fallback;
}

/** Clamp a number into [min, max]. */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
