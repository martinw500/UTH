from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import re
import requests
import traceback

from _errors import error_payload

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}


def _ydl_opts():
    return {
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 30,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['mediaconnect', 'android', 'web'],
            }
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        },
    }


def _clean_youtube_url(url):
    match = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', url or '')
    if match:
        return f'https://www.youtube.com/watch?v={match.group(1)}'
    return url


def _pick_subtitle_entry(entries):
    """Prefer a timed-text format we can actually parse."""
    by_ext = {e.get('ext'): e for e in entries if e.get('url')}
    for ext in ('vtt', 'srv3', 'srv1', 'ttml'):
        if ext in by_ext:
            return by_ext[ext]
    return next((e for e in entries if e.get('url')), None)


def _subtitle_tracks(info):
    """Flatten yt-dlp's two caption maps into one list the client can render.

    `subtitles` are tracks a human uploaded; `automatic_captions` are machine
    transcription. Kept apart because the quality difference is large and the
    user should be able to see which one they are getting.
    """
    tracks = []
    for source, key in (('manual', 'subtitles'), ('auto', 'automatic_captions')):
        for lang, entries in (info.get(key) or {}).items():
            if not entries:
                continue
            # YouTube offers auto-captions machine-translated into ~100 further
            # languages, all rendered from the same source track. Listing them
            # buries the handful that are real, so only the originals are kept.
            if source == 'auto' and '-' in lang and not lang.startswith('zh'):
                continue
            best = _pick_subtitle_entry(entries)
            if not best:
                continue
            tracks.append({
                'lang': lang,
                'name': (entries[0] or {}).get('name') or lang,
                'source': source,
                'url': best.get('url'),
                'ext': best.get('ext'),
            })
    tracks.sort(key=lambda t: (t['source'] != 'manual', t['lang']))
    return tracks


@app.route('/api/youtube/subtitles', methods=['GET', 'OPTIONS'])
def youtube_subtitles():
    """List a video's caption tracks, or fetch one.

    Without a `lang` this returns the menu; with one it returns that track's raw
    timed text. Conversion to SRT or plain prose happens in the browser
    (`js/shared/subtitles.js`), which keeps this function to one job.

    This is the YouTube feature best suited to free hosting: no ffmpeg is
    involved and the payload is kilobytes, so it is nowhere near the response
    cap that limits video downloads.
    """
    if request.method == 'OPTIONS':
        return '', 204

    url = request.args.get('url')
    lang = request.args.get('lang')
    source = request.args.get('source', 'manual')

    if not url:
        return jsonify({'error': 'URL parameter required', 'error_code': 'unsupported'}), 400

    try:
        url = _clean_youtube_url(url)

        with yt_dlp.YoutubeDL(_ydl_opts()) as ydl:
            info = ydl.extract_info(url, download=False)

        tracks = _subtitle_tracks(info)

        if not lang:
            # The caption URLs are short-lived and signed, so they are stripped
            # from the menu; the client asks for one by language instead.
            return jsonify({
                'success': True,
                'title': info.get('title', 'Unknown'),
                'channel': info.get('uploader', 'Unknown'),
                'duration': info.get('duration', 0),
                'tracks': [{k: v for k, v in t.items() if k != 'url'} for t in tracks],
            })

        chosen = next(
            (t for t in tracks if t['lang'] == lang and t['source'] == source),
            next((t for t in tracks if t['lang'] == lang), None),
        )
        if not chosen:
            return jsonify({
                'error': 'That language is not available for this video.',
                'error_code': 'no_subtitles',
            }), 404

        fetched = requests.get(chosen['url'], timeout=20, headers=FETCH_HEADERS)
        fetched.raise_for_status()

        return jsonify({
            'success': True,
            'title': info.get('title', 'Unknown'),
            'lang': chosen['lang'],
            'source': chosen['source'],
            'ext': chosen['ext'],
            'content': fetched.text,
        })

    except Exception as e:
        print(f'Subtitles error: {type(e).__name__}: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        payload, status = error_payload(e)
        return jsonify(payload), status
