/**
 * The copy and the quality logic behind the YouTube downloader.
 *
 * The bug being pinned here shipped: yt-dlp's own error text -- "Sign in to
 * confirm you're not a bot. Use --cookies-from-browser ..." -- was forwarded
 * straight to the page, so a non-technical user was handed CLI flags. These
 * tests assert that no code path can put the server's raw string in front of a
 * reader, and that the quality list stops promising what the host cannot send.
 */

import {
    messageFor,
    ytdlpCommand,
    watchUrl,
    deliverableWithAudio,
    silentOnly,
} from '../youtube-downloader/js/yt-messages.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('messageFor', () => {
    test('gives a plain-English title and body for a known code', () => {
        const message = messageFor('bot_check');
        expect(message.title).toMatch(/blocked/i);
        expect(message.body.length).toBeGreaterThan(20);
    });

    // The whole point of the module: an unrecognised code must not fall through
    // to whatever the server said.
    test('an unknown code degrades to the generic message', () => {
        expect(messageFor('some_new_code_from_the_future').code).toBe('unknown');
        expect(messageFor(undefined).code).toBe('unknown');
        expect(messageFor(null).title).toBe(messageFor('unknown').title);
    });

    test('no message mentions cookies, yt-dlp flags, or a terminal', () => {
        const codes = [
            'bot_check', 'age_restricted', 'members_only', 'private', 'geo_blocked',
            'copyright', 'is_live', 'unsupported', 'unavailable', 'timeout',
            'network', 'too_large', 'offline', 'unknown',
        ];
        for (const code of codes) {
            const { title, body } = messageFor(code);
            expect(`${title} ${body}`).not.toMatch(/--cookies|yt-dlp|stderr|traceback/i);
        }
    });

    test('offers a retry only where retrying could plausibly work', () => {
        expect(messageFor('bot_check').canRetry).toBe(true);
        expect(messageFor('network').canRetry).toBe(true);
        // A deleted video will still be deleted in five seconds.
        expect(messageFor('unavailable').canRetry).toBe(false);
        expect(messageFor('private').canRetry).toBe(false);
    });

    // Telling someone to run yt-dlp on a private video would waste their time:
    // it is private on their laptop too.
    test('offers the escape hatch only where running it locally actually helps', () => {
        expect(messageFor('bot_check').canEscape).toBe(true);
        expect(messageFor('geo_blocked').canEscape).toBe(true);
        expect(messageFor('too_large').canEscape).toBe(true);
        expect(messageFor('private').canEscape).toBe(false);
        expect(messageFor('members_only').canEscape).toBe(false);
        expect(messageFor('is_live').canEscape).toBe(false);
    });
});

describe('ytdlpCommand', () => {
    test('builds a video command carrying the chosen height', () => {
        const command = ytdlpCommand({ videoId: VIDEO_ID, quality: '1080p' });
        expect(command).toContain('height<=1080');
        expect(command).toContain(watchUrl(VIDEO_ID));
    });

    test('audio mode asks for an MP3, since that is what the button promised', () => {
        const command = ytdlpCommand({ videoId: VIDEO_ID, mode: 'audio' });
        expect(command).toContain('--audio-format mp3');
        expect(command).not.toContain('bestvideo');
    });

    // The command is pasted into a shell. Interpolating raw user input would be
    // a command-injection hole, so only an id matching YouTube's own format is
    // ever put in the string.
    test('refuses anything that is not an eleven-character video id', () => {
        expect(ytdlpCommand({ videoId: '"; rm -rf ~; echo "' })).toBeNull();
        expect(ytdlpCommand({ videoId: 'short' })).toBeNull();
        expect(ytdlpCommand({})).toBeNull();
    });

    test('a quality with no digits falls back rather than emitting "height<=', () => {
        expect(ytdlpCommand({ videoId: VIDEO_ID, quality: 'best' })).toContain('height<=1080');
    });
});

describe('deliverableWithAudio', () => {
    const formats = [
        { quality: '1080p', has_audio: false },
        { quality: '720p', has_audio: false },
        { quality: '360p', has_audio: true },
    ];

    // The P4 bug: with no ffmpeg the server can only send already-muxed
    // formats, which YouTube caps at 360p -- but the UI listed 1080p and
    // silently handed back 360p.
    test('without ffmpeg, only formats that already carry sound are offered', () => {
        expect(deliverableWithAudio(formats, false)).toEqual([{ quality: '360p', has_audio: true }]);
    });

    test('with ffmpeg, every format is offered because the server can merge', () => {
        expect(deliverableWithAudio(formats, true)).toHaveLength(3);
    });

    test('the silent list is what the ready list left behind', () => {
        expect(silentOnly(formats, false).map(f => f.quality)).toEqual(['1080p', '720p']);
        // Nothing is silent when the server can add the audio itself.
        expect(silentOnly(formats, true)).toEqual([]);
    });

    test('a missing format list is an empty list, not a crash', () => {
        expect(deliverableWithAudio(undefined, false)).toEqual([]);
        expect(silentOnly(null, false)).toEqual([]);
    });

    test('does not mutate the array it was given', () => {
        const original = [...formats];
        deliverableWithAudio(formats, true).push({ quality: 'fake' });
        expect(formats).toEqual(original);
    });
});
