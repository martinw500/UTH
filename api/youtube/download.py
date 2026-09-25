from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp
import re
import traceback
import tempfile
import os
import io
import shutil
from urllib.parse import urlsplit, parse_qs

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

YOUTUBE_HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'}
YOUTUBE_ID = re.compile(r'[A-Za-z0-9_-]{11}')
YOUTUBE_PATH_ID = re.compile(r'/(?:shorts|embed|live|v)/([^/?#]+)')


def youtube_watch_url(raw):
    """The canonical watch URL for one YouTube video, or None for anything else.

    Only this rebuilt URL ever reaches yt-dlp. When no id was found the user's
    URL used to be passed through as-is, and yt-dlp's generic extractor fetches
    whatever address it is given: an open relay, and an SSRF into anything this
    function can reach. Playlists and channels are refused too, since
    extract_info walks every video in them until the function is killed.

    Identical copies live in api/youtube/index.py, api/youtube/download.py and
    backend.py; scripts/verify-api.py checks that they agree.
    """
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    try:
        parts = urlsplit(raw if '://' in raw else f'https://{raw}')
        host = (parts.hostname or '').lower().rstrip('.')
    except ValueError:
        return None
    if parts.scheme not in ('http', 'https') or host not in YOUTUBE_HOSTS:
        return None
    if host == 'youtu.be':
        candidate = parts.path.strip('/').split('/')[0]
    else:
        in_path = YOUTUBE_PATH_ID.match(parts.path)
        candidate = in_path.group(1) if in_path else parse_qs(parts.query).get('v', [''])[0]
    if not YOUTUBE_ID.fullmatch(candidate):
        return None
    return f'https://www.youtube.com/watch?v={candidate}'


def describe_youtube_error(error):
    """A message and status for the user, never yt-dlp's own text.

    That text is command-line advice ("use --cookies-from-browser"), and
    echoing it reflected the submitted URL back into the page.
    """
    text = str(error)
    if 'confirm you' in text and 'bot' in text:
        return 'YouTube is blocking requests from this server right now. Try again later.', 503
    if '429' in text or 'Too Many Requests' in text:
        return 'YouTube is rate-limiting this server. Wait a few minutes and try again.', 503
    if 'Private video' in text or 'unavailable' in text.lower():
        return 'That video is private, removed or unavailable.', 404
    return 'Could not fetch that video. It may be age-restricted, region-locked or removed.', 502


@app.route('/api/youtube/download', methods=['GET', 'OPTIONS'])
def download_youtube():
    """Download YouTube video using yt-dlp and stream to client"""
    if request.method == 'OPTIONS':
        return '', 204
    
    if not request.args.get('url'):
        return jsonify({'error': 'URL parameter required'}), 400
    video_url = youtube_watch_url(request.args.get('url'))
    if not video_url:
        return jsonify({'error': 'That is not a link to a single YouTube video.'}), 400
    # Digits only: this lands inside a yt-dlp format expression.
    height = re.sub(r'\D', '', request.args.get('quality', '360p')) or '360'
    stem = os.path.splitext(request.args.get('filename', 'video'))[0] or 'video'

    # Removed in the finally. It used to be left behind on every request, so a
    # warm instance filled /tmp and then failed every download until a cold start.
    temp_dir = tempfile.mkdtemp()
    try:
        has_ffmpeg = shutil.which('ffmpeg') is not None
        
        if has_ffmpeg:
            format_string = f'bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
        else:
            # No ffmpeg available (e.g. Vercel serverless) - use combined formats only
            format_string = f'best[height<={height}][ext=mp4]/best[height<={height}]/best'
        
        output_path = os.path.join(temp_dir, 'video.%(ext)s')
        
        ydl_opts = {
            'format': format_string,
            'outtmpl': output_path,
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 30,
            # Use alternative player clients to bypass bot detection
            'extractor_args': {
                'youtube': {
                    'player_client': ['mediaconnect', 'android', 'web'],
                }
            },
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
            },
        }
        
        if has_ffmpeg:
            ydl_opts['merge_output_format'] = 'mp4'
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
        
        downloaded_files = [f for f in os.listdir(temp_dir) if f.startswith('video.')]
        if not downloaded_files:
            raise Exception('No file was downloaded')
        
        downloaded_file = os.path.join(temp_dir, downloaded_files[0])
        if os.path.getsize(downloaded_file) == 0:
            raise Exception('Downloaded file is empty')
        # Read before the finally deletes it. The extension comes from what
        # was actually downloaded; the client's guess could name an MP4 .webm.
        ext = os.path.splitext(downloaded_file)[1].lstrip('.') or 'mp4'
        with open(downloaded_file, 'rb') as handle:
            data = handle.read()
    except Exception as e:
        print(f'Download error: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        message, status = describe_youtube_error(e)
        return jsonify({'error': message}), status
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    return send_file(
        io.BytesIO(data),
        mimetype='video/webm' if ext == 'webm' else 'video/mp4',
        as_attachment=True,
        download_name=f'{stem}.{ext}',
    )
