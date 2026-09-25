from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import re
import traceback
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

    Identical copies live in api/youtube/index.py and api/youtube/download.py
    (backend.py imports this one); scripts/verify-api.py checks that they agree.
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
    # Before the "unavailable" test: "HTTP Error 503: Service Unavailable" is
    # YouTube having a bad minute, not a removed video.
    if 'HTTP Error 5' in text or 'Service Unavailable' in text:
        return 'YouTube did not answer properly. Try again in a minute.', 503
    if 'Private video' in text or 'Video unavailable' in text or 'video is unavailable' in text.lower():
        return 'That video is private, removed or unavailable.', 404
    return 'Could not fetch that video. It may be age-restricted, region-locked or removed.', 502


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

@app.route('/api/youtube', methods=['GET', 'OPTIONS'])
def get_youtube():
    if request.method == 'OPTIONS':
        return '', 204
    
    if not request.args.get('url'):
        return jsonify({'error': 'URL parameter required'}), 400
    url = youtube_watch_url(request.args.get('url'))
    if not url:
        return jsonify({'error': 'That is not a link to a single YouTube video.'}), 400

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
                'formats': []
            }
            
            formats = info.get('formats', [])
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
                        filesize_str = f"{filesize / (1024*1024):.1f} MB"
                    else:
                        duration = info.get('duration', 0)
                        if duration and height:
                            bitrate_kbps = {
                                144: 200, 240: 400, 360: 800,
                                480: 1500, 720: 2500, 1080: 4500
                            }.get(height, 1000)
                            estimated_size = (bitrate_kbps * duration / 8) / 1024
                            filesize_str = f"~{estimated_size:.1f} MB"
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
            
            return jsonify(video_data)
        
    except Exception as e:
        print(f'Error: {type(e).__name__}: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        message, status = describe_youtube_error(e)
        return jsonify({'error': message, 'error_type': type(e).__name__}), status
