from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import re
import shutil
import traceback

from _errors import error_payload

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

# Rough kbps by height, for when YouTube reports no filesize. Only used to
# render a "~12.3 MB" hint, so being off by a third is fine.
_BITRATE_BY_HEIGHT = {144: 200, 240: 400, 360: 800, 480: 1500, 720: 2500, 1080: 4500}


def get_ydl_opts():
    """Get yt-dlp options optimized for serverless environments"""
    return {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'socket_timeout': 30,
        # Use alternative player clients to bypass YouTube bot detection on cloud IPs
        'extractor_args': {
            'youtube': {
                'player_client': ['mediaconnect', 'android', 'web'],
            }
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        },
    }


def _human_size(num_bytes):
    return f"{num_bytes / (1024 * 1024):.1f} MB"


def _estimated_size(duration, height):
    kbps = _BITRATE_BY_HEIGHT.get(height, 1000)
    return (kbps * duration / 8) / 1024


def _pick_best_audio(formats):
    """The audio-only stream we would hand back for `mode=audio`.

    Audio-only is the one thing the hosted backend does well: it is a single
    progressive stream, so no ffmpeg is needed to mux anything, and a song-length
    track is small enough to clear the serverless response cap.
    """
    candidates = [
        f for f in formats
        if f.get('acodec') and f.get('acodec') != 'none' and f.get('vcodec') == 'none'
    ]
    if not candidates:
        return None

    # Mirror the `bestaudio[ext=m4a]/bestaudio` preference the download endpoint
    # uses, so the size shown here is the size actually delivered. M4A first
    # because it needs no conversion to be playable basically everywhere.
    def rank(f):
        return (f.get('ext') == 'm4a', f.get('abr') or 0)

    return max(candidates, key=rank)


@app.route('/api/youtube', methods=['GET', 'OPTIONS'])
def get_youtube():
    if request.method == 'OPTIONS':
        return '', 204

    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL parameter required', 'error_code': 'unsupported'}), 400

    # Clean URL - extract video ID
    video_id_match = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', url)
    if video_id_match:
        video_id = video_id_match.group(1)
        url = f'https://www.youtube.com/watch?v={video_id}'

    try:
        ydl_opts = get_ydl_opts()

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            video_data = {
                'success': True,
                'title': info.get('title', 'Unknown'),
                'channel': info.get('uploader', 'Unknown'),
                'duration': info.get('duration', 0),
                'views': info.get('view_count', 0),
                'thumbnail': info.get('thumbnail', ''),
                # Whether THIS host can mux a separate video and audio stream
                # together. Vercel has no ffmpeg, so it cannot -- and the client
                # needs to know, because without it the only formats that arrive
                # with sound are progressive ones, which YouTube caps at 360p.
                # Without this flag the UI offered 1080p and quietly served 360p.
                'server_can_merge': shutil.which('ffmpeg') is not None,
                'formats': [],
                'audio': None,
            }

            formats = info.get('formats', [])
            duration = info.get('duration', 0)
            quality_map = {}

            for fmt in formats:
                if fmt.get('vcodec') == 'none':
                    continue

                height = fmt.get('height')
                if not height:
                    continue

                quality_label = f"{height}p"
                has_audio = fmt.get('acodec') != 'none'

                if quality_label not in quality_map or (has_audio and not quality_map[quality_label].get('has_audio', False)):
                    filesize = fmt.get('filesize') or fmt.get('filesize_approx')
                    if filesize and filesize > 0:
                        filesize_str = _human_size(filesize)
                    elif duration and height:
                        filesize_str = f"~{_estimated_size(duration, height):.1f} MB"
                    else:
                        filesize_str = "Size unknown"

                    quality_map[quality_label] = {
                        'quality': quality_label,
                        'ext': fmt.get('ext', 'mp4'),
                        'url': fmt.get('url', ''),
                        'filesize': filesize_str,
                        'format_id': fmt.get('format_id', ''),
                        'has_audio': has_audio,
                        'height': height
                    }

            video_data['formats'] = sorted(quality_map.values(), key=lambda x: x['height'], reverse=True)
            video_data['formats'] = video_data['formats'][:6]

            best_audio = _pick_best_audio(formats)
            if best_audio:
                audio_bytes = best_audio.get('filesize') or best_audio.get('filesize_approx')
                if audio_bytes and audio_bytes > 0:
                    audio_size = _human_size(audio_bytes)
                else:
                    abr = best_audio.get('abr') or 128
                    audio_bytes = int((abr * (duration or 0) / 8) * 1024) or None
                    audio_size = f"~{audio_bytes / (1024 * 1024):.1f} MB" if audio_bytes else "Size unknown"

                video_data['audio'] = {
                    'ext': best_audio.get('ext', 'm4a'),
                    'abr': round(best_audio.get('abr') or 0),
                    'filesize': audio_size,
                    # Bytes, not a string: the client needs to compare this
                    # against the response cap before it tries to fetch the
                    # bytes into memory for the MP3 hand-off.
                    'filesize_bytes': audio_bytes,
                }

            return jsonify(video_data)

    except Exception as e:
        print(f'Error: {type(e).__name__}: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        payload, status = error_payload(e)
        return jsonify(payload), status
