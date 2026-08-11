from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import yt_dlp
import re
import traceback
import tempfile
import os
import shutil

from _errors import error_payload

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

CHUNK = 64 * 1024

_AUDIO_MIME = {
    'm4a': 'audio/mp4',
    'mp4': 'audio/mp4',
    'webm': 'audio/webm',
    'opus': 'audio/ogg',
    'ogg': 'audio/ogg',
    'mp3': 'audio/mpeg',
}


def _stream_and_cleanup(path, temp_dir):
    """Yield the file in chunks, then remove the temp directory.

    Two reasons this replaced `send_file`:

    1. `send_file` was handed a path inside a `tempfile.mkdtemp()` that nothing
       ever removed, so every download leaked a directory.
    2. It buffers, which is wasteful for a file this size.

    It does **not** lift Vercel's ~4.5 MB serverless response cap -- that ceiling
    is a property of the platform, not of how we write the body. It is exactly
    why the frontend offers a local/yt-dlp route when a download is too big.
    """
    try:
        with open(path, 'rb') as handle:
            while True:
                block = handle.read(CHUNK)
                if not block:
                    break
                yield block
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _build_opts(mode, height, output_path, has_ffmpeg):
    opts = {
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

    if mode == 'audio':
        # No ffmpeg needed: an audio-only stream is already a single file, so
        # this path works identically on the hosted backend and locally. M4A
        # first because it plays everywhere without conversion.
        opts['format'] = 'bestaudio[ext=m4a]/bestaudio'
        return opts

    if has_ffmpeg:
        opts['format'] = (
            f'bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/'
            f'bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
        )
        opts['merge_output_format'] = 'mp4'
    else:
        # Nothing here can mux, so only already-combined formats are possible.
        # YouTube caps those at 360p -- the client is told via `server_can_merge`
        # so it can say so up front instead of surprising the user afterwards.
        opts['format'] = f'best[height<={height}][ext=mp4]/best[height<={height}]/best'

    return opts


@app.route('/api/youtube/download', methods=['GET', 'OPTIONS'])
def download_youtube():
    """Download a YouTube video (or its audio track) and stream it to the client"""
    if request.method == 'OPTIONS':
        return '', 204

    video_url = request.args.get('url')
    quality = request.args.get('quality', '360p')
    filename = request.args.get('filename', 'video.mp4')
    mode = 'audio' if request.args.get('mode') == 'audio' else 'video'

    if not video_url:
        return jsonify({'error': 'URL parameter required', 'error_code': 'unsupported'}), 400

    temp_dir = None
    try:
        video_id_match = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', video_url)
        if video_id_match:
            video_id = video_id_match.group(1)
            video_url = f'https://www.youtube.com/watch?v={video_id}'

        height = re.sub(r'\D', '', quality) or '360'
        has_ffmpeg = shutil.which('ffmpeg') is not None

        temp_dir = tempfile.mkdtemp()
        output_path = os.path.join(temp_dir, 'media.%(ext)s')

        with yt_dlp.YoutubeDL(_build_opts(mode, height, output_path, has_ffmpeg)) as ydl:
            ydl.download([video_url])

        downloaded_files = [f for f in os.listdir(temp_dir) if f.startswith('media.')]
        if not downloaded_files:
            raise Exception('No file was downloaded')

        downloaded_file = os.path.join(temp_dir, downloaded_files[0])
        size = os.path.getsize(downloaded_file)
        if size == 0:
            raise Exception('Downloaded file is empty')

        ext = downloaded_files[0].rsplit('.', 1)[-1].lower()
        mimetype = _AUDIO_MIME.get(ext, 'audio/mpeg') if mode == 'audio' else 'video/mp4'

        # `filename` is put inside a quoted Content-Disposition, so strip the
        # characters that would let it break out of the quoting.
        safe_name = re.sub(r'[\r\n"\\]', '', filename) or f'download.{ext}'

        response = Response(
            _stream_and_cleanup(downloaded_file, temp_dir),
            mimetype=mimetype,
            direct_passthrough=True,
        )
        response.headers['Content-Disposition'] = f'attachment; filename="{safe_name}"'
        response.headers['Content-Length'] = str(size)
        # So the client can read the real size for the MP3 hand-off even when
        # the response is opaque to it in other respects.
        response.headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Disposition'
        # The generator owns the cleanup from here.
        temp_dir = None
        return response

    except Exception as e:
        print(f'Download error: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        payload, status = error_payload(e)
        return jsonify(payload), status
    finally:
        # Only reached if we failed before handing the directory to the streamer.
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
