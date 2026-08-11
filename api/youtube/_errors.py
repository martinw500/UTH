"""Turn a yt-dlp exception into a stable machine code.

The leading underscore keeps Vercel from routing this file as a function.

Why this exists: yt-dlp writes for people holding a terminal. Its bot-check
message ends with "Use --cookies-from-browser or --cookies for the
authentication", which used to be forwarded verbatim to the browser. Someone who
just wants a video sees CLI flags they cannot act on.

So the server classifies and the **frontend** owns the wording -- see
`youtube-downloader/js/yt-messages.js`. Only the code crosses the wire as
something to render; the raw text travels as `detail` and is for logs and an
opt-in disclosure, never for the main error line.

Matching is on substrings of yt-dlp's English message. That is fragile by
nature, so every unmatched error must degrade to `unknown` with a generic,
still-actionable message rather than leaking the raw string.
"""

# Ordered: the first match wins, so the specific must come before the general.
# A bare "unavailable" appears inside several more specific messages, which is
# why `unavailable` sits last.
#
# `age_restricted` must stay above `bot_check`. YouTube phrases both as "Sign in
# to confirm ..." -- "your age" vs "you're not a bot" -- so bot_check's generic
# 'sign in to confirm' needle swallows the age case if it is checked first. That
# is not academic: it sends someone with an age-gated video to a retry button
# and a yt-dlp command, neither of which can help them.
_SIGNATURES = [
    ('age_restricted', (
        'confirm your age',
        'age-restricted',
        'age restricted',
        'inappropriate for some users',
    )),
    ('bot_check', (
        "confirm you're not a bot",
        'confirm youre not a bot',
        'sign in to confirm',
        'failed to extract any player response',
        'please sign in',
    )),
    ('members_only', (
        'members-only',
        'available to this channel',
        'join this channel',
    )),
    ('private', (
        'private video',
        'video is private',
        'sign in if you',
    )),
    ('geo_blocked', (
        'not available in your country',
        'not made this video available in your country',
        'blocked it in your country',
        'geo restriction',
        'geo-restricted',
    )),
    ('is_live', (
        'live event will begin',
        'premieres in',
        'this live stream recording is not available',
        'is not yet available',
    )),
    ('copyright', (
        'copyright grounds',
        'copyright claim',
    )),
    ('unsupported', (
        'unsupported url',
        'is not a valid url',
        'unable to extract',
    )),
    ('timeout', (
        'timed out',
        'timeout',
        'read operation',
    )),
    ('network', (
        'unable to download webpage',
        'connection reset',
        'connection aborted',
        'temporary failure in name resolution',
        'http error 5',
        'http error 429',
        'too many requests',
    )),
    ('unavailable', (
        'video unavailable',
        'has been removed',
        'removed by the uploader',
        'account associated with this video has been terminated',
        'this video is not available',
        'video has been terminated',
    )),
]

# What HTTP status each code should answer with. A blocked-by-YouTube result is
# not the client's fault and not really our server erroring either, but 502 is
# the honest reading: an upstream we depend on refused us.
_STATUS = {
    'bot_check': 502,
    'age_restricted': 403,
    'members_only': 403,
    'private': 403,
    'geo_blocked': 451,
    'copyright': 451,
    'is_live': 409,
    'unsupported': 400,
    'unavailable': 404,
    'timeout': 504,
    'network': 502,
    'too_large': 413,
    'unknown': 500,
}

# A terse fallback line, used only if a client somehow renders `error` directly.
# The real copy lives in yt-messages.js.
_FALLBACK_TEXT = {
    'bot_check': 'YouTube blocked this server. Try again, or download it on your own computer.',
    'age_restricted': 'This video is age-restricted, so it cannot be fetched without signing in.',
    'members_only': 'This video is for channel members only.',
    'private': 'This video is private.',
    'geo_blocked': 'This video is not available in the server\'s region.',
    'copyright': 'This video is blocked on copyright grounds.',
    'is_live': 'This is a live or upcoming stream, so there is nothing to download yet.',
    'unsupported': 'That link does not look like a YouTube video.',
    'unavailable': 'This video is unavailable. It may have been deleted or made private.',
    'timeout': 'YouTube took too long to respond.',
    'network': 'Could not reach YouTube.',
    'too_large': 'This file is too large for the hosted server to send.',
    'unknown': 'Something went wrong fetching this video.',
}


def classify(exc):
    """Return a stable code for `exc`. Never raises."""
    try:
        text = str(exc).lower()
    except Exception:
        return 'unknown'

    for code, needles in _SIGNATURES:
        for needle in needles:
            if needle in text:
                return code
    return 'unknown'


def error_payload(exc, code=None):
    """Build the JSON body and HTTP status for a failed request.

    `detail` carries the raw yt-dlp text. It is deliberately included -- being
    able to see what actually happened is worth a lot when someone reports a
    bug -- but the client must treat it as diagnostic text behind a toggle, and
    must never use it as the primary message or render it as HTML.
    """
    code = code or classify(exc)
    return {
        'error_code': code,
        'error': _FALLBACK_TEXT.get(code, _FALLBACK_TEXT['unknown']),
        'detail': str(exc),
    }, _STATUS.get(code, 500)
