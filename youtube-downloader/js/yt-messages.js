/**
 * User-facing copy for YouTube failures, and the commands we offer as a way out.
 *
 * The server sends a stable `error_code` (see `api/youtube/_errors.py`) and the
 * raw yt-dlp text as `detail`. All wording lives here, on the client, for two
 * reasons: the copy can change without a redeploy of the Python functions, and
 * it keeps `detail` structurally unable to become the thing a user reads. The
 * bug that started this was yt-dlp's own advice -- "Use --cookies-from-browser"
 * -- reaching someone who has never opened a terminal.
 *
 * Pure module: no DOM, no network. `tests/youtube-downloader.test.js` imports it.
 */

/** Codes where retrying is worth a click, because the cause is not about this video. */
const RETRYABLE = new Set(['bot_check', 'timeout', 'network', 'unknown']);

/**
 * Codes where running it yourself genuinely fixes it. A private video stays
 * private on your laptop, so offering a command there would be a lie -- the
 * escape hatch is only shown where it actually helps.
 */
const ESCAPABLE = new Set(['bot_check', 'age_restricted', 'geo_blocked', 'timeout', 'network', 'too_large', 'unknown']);

const MESSAGES = {
    bot_check: {
        title: 'YouTube blocked our server',
        body: 'YouTube does this to shared cloud servers, sometimes at random. '
            + 'It is not about you, and nothing is wrong with your link.',
    },
    age_restricted: {
        title: 'This video is age-restricted',
        body: 'YouTube only hands it over to a signed-in account, and this site '
            + 'never asks you to sign in to anything.',
    },
    members_only: {
        title: 'This video is for channel members',
        body: 'Only paying members of the channel can watch it, so there is '
            + 'nothing here to download.',
    },
    private: {
        title: 'This video is private',
        body: 'The owner has restricted it to people they invited. Check the '
            + 'link, or ask them to make it unlisted.',
    },
    geo_blocked: {
        title: 'Not available in the server\'s country',
        body: 'The uploader limited this video to certain countries, and our '
            + 'server is not in one of them.',
    },
    copyright: {
        title: 'Blocked on copyright grounds',
        body: 'YouTube has blocked this video at the rights holder\'s request.',
    },
    is_live: {
        title: 'This is a live or upcoming stream',
        body: 'There is no finished file to download yet. Try again once the '
            + 'stream has ended and YouTube has published the recording.',
    },
    unsupported: {
        title: 'That link does not look like a YouTube video',
        body: 'Paste the address of a single video — something like '
            + 'youtube.com/watch?v=… or youtu.be/… . Playlists and channel '
            + 'pages will not work.',
    },
    unavailable: {
        title: 'This video is not available',
        body: 'It has probably been deleted, made private, or the channel was '
            + 'removed. Double-check the link.',
    },
    timeout: {
        title: 'YouTube took too long to answer',
        body: 'This is usually temporary. Give it a moment and try again.',
    },
    network: {
        title: 'Could not reach YouTube',
        body: 'The connection between our server and YouTube failed. This is '
            + 'usually temporary.',
    },
    too_large: {
        title: 'This file is too big to send from our server',
        body: 'The free hosting this runs on can only send small files. Longer '
            + 'videos have to be downloaded on your own computer.',
    },
    offline: {
        title: 'Could not reach the server',
        body: 'It may still be waking up — the free hosting sleeps when it is '
            + 'idle, and the first request can take about ten seconds.',
    },
    unknown: {
        title: 'Something went wrong',
        body: 'We could not fetch this video, and the reason was not one we '
            + 'recognise. Trying again often works.',
    },
};

/**
 * Look up copy for a server error code.
 *
 * An unrecognised code must fall back to the generic message and never to the
 * server's `detail` string — that fallback is the whole point of this file.
 */
export function messageFor(code) {
    const key = MESSAGES[code] ? code : 'unknown';
    return {
        code: key,
        title: MESSAGES[key].title,
        body: MESSAGES[key].body,
        canRetry: RETRYABLE.has(key),
        canEscape: ESCAPABLE.has(key),
    };
}

/** The canonical watch URL for a video id — safe to embed in a shell command. */
export function watchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Build the yt-dlp command that does what the user just clicked.
 *
 * Built here rather than server-side so it always matches the row they pressed,
 * including on a request that never reached the server. `videoId` is the
 * 11-character id, so the interpolated URL cannot contain quotes or shell
 * metacharacters regardless of what was pasted into the box.
 */
export function ytdlpCommand({ videoId, quality = '1080p', mode = 'video' } = {}) {
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    const url = watchUrl(videoId);

    if (mode === 'audio') {
        return `yt-dlp -x --audio-format mp3 -o "%(title)s.%(ext)s" "${url}"`;
    }

    const height = String(quality).replace(/\D/g, '') || '1080';
    const selector = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
    return `yt-dlp -f "${selector}" --merge-output-format mp4 -o "%(title)s.%(ext)s" "${url}"`;
}

/**
 * Which qualities this backend can actually deliver *with sound*.
 *
 * Without ffmpeg, only progressive (already-muxed) formats can be sent, and
 * YouTube caps those at 360p. The old UI listed 1080p anyway and handed back
 * 360p without a word; this is what lets the page say so before the click.
 */
export function deliverableWithAudio(formats, serverCanMerge) {
    if (!Array.isArray(formats)) return [];
    if (serverCanMerge) return formats.slice();
    return formats.filter(f => f.has_audio);
}

/** Formats the page must present as silent, so nobody downloads one by accident. */
export function silentOnly(formats, serverCanMerge) {
    if (!Array.isArray(formats)) return [];
    if (serverCanMerge) return [];
    return formats.filter(f => !f.has_audio);
}
