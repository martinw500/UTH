"""Check the yt-dlp error classifier against real upstream messages.

Run with `npm run verify:yt-errors` (or `python scripts/verify-yt-errors.py`).

This is a script rather than a jest test because the classifier is Python and
this repo has no Python test runner. It is worth having anyway: the matching is
substring-based over English text yt-dlp can reword at any time, and a
mis-classification is silent -- the user just gets advice for the wrong problem.

It also pins an ordering trap that was live for exactly one commit. YouTube
phrases the age gate and the bot check the same way, "Sign in to confirm your
age" and "Sign in to confirm you're not a bot", so the generic `bot_check`
needle swallows the age case unless `age_restricted` is tested first.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api', 'youtube'))
from _errors import classify, error_payload  # noqa: E402

BOT_CHECK = (
    "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. "
    "Use --cookies-from-browser or --cookies for the authentication. "
    "See https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
)

CASES = [
    (BOT_CHECK, 'bot_check'),
    ("ERROR: [youtube] xx: Sign in to confirm your age. This video may be inappropriate for some users.", 'age_restricted'),
    ("ERROR: [youtube] xx: Private video. Sign in if you have been granted access to this video", 'private'),
    ("ERROR: [youtube] xx: Join this channel to get access to members-only content", 'members_only'),
    ("ERROR: [youtube] xx: Video unavailable. This video has been removed by the uploader", 'unavailable'),
    ("ERROR: [youtube] xx: The uploader has not made this video available in your country", 'geo_blocked'),
    ("ERROR: [youtube] xx: This video is no longer available due to a copyright claim", 'copyright'),
    ("ERROR: [youtube] xx: This live event will begin in 3 hours", 'is_live'),
    ("ERROR: unable to download video data: The read operation timed out", 'timeout'),
    ("ERROR: Unable to download webpage: HTTP Error 503: Service Unavailable", 'network'),
    ("ERROR: Unsupported URL: https://example.com/not-a-video", 'unsupported'),
    ("KeyError: 'a shape of failure nobody has seen yet'", 'unknown'),
]


def main():
    failures = 0

    for text, expected in CASES:
        actual = classify(Exception(text))
        ok = actual == expected
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {expected:<15} -> {actual}")

    payload, status = error_payload(Exception(BOT_CHECK))

    # The bug this whole classifier exists to prevent: the raw yt-dlp string,
    # with its CLI flags, must never be the message a reader is shown.
    checks = [
        ('code is bot_check', payload['error_code'] == 'bot_check'),
        ('status is 502', status == 502),
        ('the readable line has no CLI flags', '--cookies' not in payload['error']),
        ('the raw text survives in detail', '--cookies-from-browser' in payload['detail']),
    ]
    print()
    for label, ok in checks:
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {label}")

    print()
    print('all clear' if not failures else f'{failures} failing')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
