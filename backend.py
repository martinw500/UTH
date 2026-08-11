"""
Unified Local Development Backend
Combines Instagram and YouTube downloaders for easy local testing
Run with: python backend.py
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from urllib.parse import urlparse
import instaloader
import requests
import base64
import re
import yt_dlp
import os
import shutil
import sys
import tempfile
import traceback

# The error classifier is shared with the deployed functions rather than copied.
# This is a plain local import of a sibling package directory -- safe here, and
# not the same thing as the unverified cross-directory import inside Vercel's
# Python runtime that STATE.md warns about.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'api', 'youtube'))
from _errors import error_payload  # noqa: E402

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

# =============================================================================
# INSTAGRAM DOWNLOADER
# =============================================================================

BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.instagram.com/',
    'Origin': 'https://www.instagram.com',
}


def get_instaloader():
    """Create a fresh Instaloader instance per request to avoid stale sessions"""
    loader = instaloader.Instaloader(
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        quiet=True,
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    )
    return loader

def fetch_post_with_retry(shortcode, max_retries=2):
    """Fetch Instagram post with retry logic"""
    import time
    last_error = None
    for attempt in range(max_retries):
        try:
            L = get_instaloader()
            post = instaloader.Post.from_shortcode(L.context, shortcode)
            _ = post.typename  # trigger actual fetch
            return post
        except Exception as e:
            last_error = e
            print(f'Attempt {attempt + 1} failed: {e}')
            if attempt < max_retries - 1:
                time.sleep(1)
    raise last_error

def fetch_image_as_base64(url):
    """Fetch an image and convert to base64 data URL"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.instagram.com/',
        }
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            content_type = response.headers.get('Content-Type', 'image/jpeg')
            base64_data = base64.b64encode(response.content).decode('utf-8')
            return f'data:{content_type};base64,{base64_data}'
    except Exception as e:
        print(f'Failed to fetch image as base64: {e}')
    return None

@app.route('/api/instagram', methods=['GET', 'OPTIONS'])
def get_instagram():
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        return '', 204
    
    url = request.args.get('url')
    
    if not url:
        return jsonify({'error': 'URL parameter required'}), 400
    
    try:
        # Extract shortcode from URL
        match = re.search(r'/(p|reel)/([A-Za-z0-9_-]+)', url)
        if not match:
            return jsonify({'error': 'Invalid Instagram URL'}), 400
        
        shortcode = match.group(2)
        print(f'\n=== Fetching Instagram post: {shortcode} ===')
        
        # Fetch post with retry logic
        post = fetch_post_with_retry(shortcode)
        
        media = []
        
        # Check if it's a sidecar (carousel/album)
        if post.typename == 'GraphSidecar':
            print(f'Found carousel with {post.mediacount} items')
            
            # Get all items in the carousel
            for i, node in enumerate(post.get_sidecar_nodes()):
                display_url = node.display_url
                
                # Fetch image as base64 to avoid CORS
                thumbnail_base64 = fetch_image_as_base64(display_url)
                
                if node.is_video:
                    video_url = node.video_url
                    print(f'  [{i+1}] Video: {video_url[:80]}...')
                    media.append({
                        'type': 'video',
                        'url_high': video_url,
                        'url_low': video_url,
                        'thumbnail': thumbnail_base64 or display_url
                    })
                else:
                    print(f'  [{i+1}] Image: {display_url[:80]}...')
                    media.append({
                        'type': 'image',
                        'url_high': display_url,
                        'url_low': display_url,
                        'thumbnail': thumbnail_base64 or display_url
                    })
        
        # Single image post
        elif post.typename == 'GraphImage':
            img_url = post.url
            print(f'Single image: {img_url[:80]}...')
            
            thumbnail_base64 = fetch_image_as_base64(img_url)
            
            media.append({
                'type': 'image',
                'url_high': img_url,
                'url_low': img_url,
                'thumbnail': thumbnail_base64 or img_url
            })
        
        # Single video post
        elif post.typename == 'GraphVideo':
            video_url = post.video_url
            print(f'Single video: {video_url[:80]}...')
            
            thumbnail_base64 = fetch_image_as_base64(post.url)
            
            media.append({
                'type': 'video',
                'url_high': video_url,
                'url_low': video_url,
                'thumbnail': thumbnail_base64 or post.url
            })
        
        print(f'Successfully fetched {len(media)} media items')
        
        return jsonify({
            'success': True,
            'media': media
        })
        
    except Exception as e:
        print(f'Error: {str(e)}')
        return jsonify({'error': f'Failed to fetch Instagram post: {str(e)}'}), 500


# NOTE: duplicated from api/instagram/proxy.py so local dev has the route at all.
# Both copies move to api/_lib/ once cross-directory imports are verified on a
# Vercel preview deploy.
ALLOWED_HOST_SUFFIXES = ('cdninstagram.com', 'fbcdn.net', 'instagram.com')
UNSAFE_FILENAME_CHARS = re.compile(r'[^A-Za-z0-9._-]')


def is_allowed_media_url(media_url):
    """Allow only https URLs whose *hostname* is an Instagram CDN host.

    A substring check over the whole URL would let
    ``https://evil.com/?x=instagram.com`` through, making this an open relay.
    """
    try:
        parsed = urlparse(media_url)
    except ValueError:
        return False

    if parsed.scheme != 'https' or not parsed.hostname:
        return False

    host = parsed.hostname.lower().rstrip('.')
    return any(
        host == suffix or host.endswith('.' + suffix)
        for suffix in ALLOWED_HOST_SUFFIXES
    )


def safe_filename(name, fallback):
    if not name:
        return fallback
    cleaned = UNSAFE_FILENAME_CHARS.sub('_', name).strip('._')
    return cleaned[:100] or fallback


@app.route('/api/instagram/proxy', methods=['GET', 'OPTIONS'])
def proxy_media():
    """Stream Instagram media through us so the browser can fetch() it.

    Instagram's CDN sends no CORS headers, so a direct fetch()->Blob download
    fails; <img>/<video> rendering is unaffected and should not come through here.
    """
    if request.method == 'OPTIONS':
        return '', 204

    media_url = request.args.get('url')
    if not media_url:
        return jsonify({'error': 'URL parameter required'}), 400

    if not is_allowed_media_url(media_url):
        return jsonify({'error': 'Only Instagram media URLs are allowed'}), 403

    try:
        upstream = requests.get(media_url, headers=BROWSER_HEADERS, stream=True, timeout=30)
        if upstream.status_code != 200:
            return jsonify({'error': f'Instagram returned status {upstream.status_code}'}), 502

        content_type = upstream.headers.get('Content-Type', 'application/octet-stream')
        if 'video' in content_type:
            ext = 'mp4'
        elif 'image' in content_type:
            ext = content_type.split('/')[-1].replace('jpeg', 'jpg')
        else:
            ext = 'bin'

        basename = safe_filename(request.args.get('filename'), 'instagram_media')
        headers = {
            'Content-Type': content_type,
            'Content-Disposition': f'attachment; filename="{basename}.{ext}"',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300, s-maxage=86400',
        }
        content_length = upstream.headers.get('Content-Length')
        if content_length:
            headers['Content-Length'] = content_length

        def generate():
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk

        return Response(generate(), status=200, headers=headers)

    except requests.Timeout:
        return jsonify({'error': 'Request to Instagram timed out'}), 504
    except Exception as e:
        print(f'Proxy error: {e}')
        return jsonify({'error': f'Failed to proxy media: {str(e)}'}), 500


# =============================================================================
# YOUTUBE DOWNLOADER
#
# Mirrors api/youtube/{index,download,subtitles}.py, which are the deployed
# functions. The important difference is not the code but the machine: this one
# has ffmpeg and a residential IP, so it can merge streams and is rarely
# bot-checked. `server_can_merge` is what tells the frontend which it is talking
# to, so it can stop advertising qualities the host cannot actually deliver.
# =============================================================================

CHUNK = 64 * 1024

_BITRATE_BY_HEIGHT = {144: 200, 240: 400, 360: 800, 480: 1500, 720: 2500, 1080: 4500}

_AUDIO_MIME = {
    'm4a': 'audio/mp4',
    'mp4': 'audio/mp4',
    'webm': 'audio/webm',
    'opus': 'audio/ogg',
    'ogg': 'audio/ogg',
    'mp3': 'audio/mpeg',
}

# Browsers yt-dlp can lift cookies from. Anything else is rejected outright
# rather than passed through, so this can never become a way to hand yt-dlp an
# arbitrary string.
_COOKIE_BROWSERS = {'chrome', 'firefox', 'edge', 'brave', 'chromium', 'safari', 'opera', 'vivaldi'}


def _is_local_request():
    """True only for a request that came from this machine."""
    return request.remote_addr in ('127.0.0.1', '::1', 'localhost')


def _apply_cookies(opts):
    """Optionally read YouTube cookies from a locally installed browser.

    This is how you get past an age gate or a bot check, and it is deliberately
    available **only on this local dev server**, never on the deployed
    functions, and only to a request originating from this machine.

    The reason is not paranoia about the flag. A YouTube cookie is a live
    Google session credential. A hosted service that accepted one -- pasted in a
    form, or read on the user's behalf -- would be asking strangers to hand
    their signed-in account to someone else's server. On your own machine
    talking to your own browser profile, none of that is true, which is the
    situation yt-dlp's own documentation assumes.
    """
    browser = (request.args.get('cookies_from_browser') or '').strip().lower()
    if not browser:
        return opts
    if not _is_local_request():
        return opts
    if browser not in _COOKIE_BROWSERS:
        return opts
    opts['cookiesfrombrowser'] = (browser,)
    return opts


def _ydl_opts():
    return {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'socket_timeout': 30,
        # Use alternative player clients to bypass bot detection
        'extractor_args': {
            'youtube': {
                'player_client': ['mediaconnect', 'android', 'web'],
            }
        },
    }


def _clean_youtube_url(url):
    match = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', url or '')
    if match:
        return f'https://www.youtube.com/watch?v={match.group(1)}'
    return url


def _human_size(num_bytes):
    return f"{num_bytes / (1024 * 1024):.1f} MB"


def _pick_best_audio(formats):
    candidates = [
        f for f in formats
        if f.get('acodec') and f.get('acodec') != 'none' and f.get('vcodec') == 'none'
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda f: (f.get('ext') == 'm4a', f.get('abr') or 0))


@app.route('/api/youtube', methods=['GET', 'OPTIONS'])
def get_youtube():
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        return '', 204

    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL parameter required', 'error_code': 'unsupported'}), 400

    url = _clean_youtube_url(url)
    print(f"Cleaned URL to: {url}")

    try:
        with yt_dlp.YoutubeDL(_apply_cookies(_ydl_opts())) as ydl:
            info = ydl.extract_info(url, download=False)

            video_data = {
                'success': True,
                'title': info.get('title', 'Unknown'),
                'channel': info.get('uploader', 'Unknown'),
                'duration': info.get('duration', 0),
                'views': info.get('view_count', 0),
                'thumbnail': info.get('thumbnail', ''),
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
                        kbps = _BITRATE_BY_HEIGHT.get(height, 1000)
                        filesize_str = f"~{(kbps * duration / 8) / 1024:.1f} MB"
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
                    'filesize_bytes': audio_bytes,
                }

            return jsonify(video_data)

    except Exception as e:
        print(f'Error: {type(e).__name__}: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        payload, status = error_payload(e)
        return jsonify(payload), status


def _stream_and_cleanup(path, temp_dir):
    """Yield the file in chunks, then remove the temp directory.

    The previous `send_file` left every `mkdtemp()` behind, so a local session
    slowly filled the temp folder with videos.
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


@app.route('/api/youtube/download', methods=['GET', 'OPTIONS'])
def download_youtube():
    """Download a YouTube video (or just its audio) and stream it to the client"""
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
        video_url = _clean_youtube_url(video_url)
        height = re.sub(r'\D', '', quality) or '360'
        has_ffmpeg = shutil.which('ffmpeg') is not None

        temp_dir = tempfile.mkdtemp()
        output_path = os.path.join(temp_dir, 'media.%(ext)s')

        ydl_opts = _apply_cookies(_ydl_opts())
        ydl_opts['outtmpl'] = output_path

        if mode == 'audio':
            ydl_opts['format'] = 'bestaudio[ext=m4a]/bestaudio'
        elif has_ffmpeg:
            ydl_opts['format'] = (
                f'bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/'
                f'bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
            )
            ydl_opts['merge_output_format'] = 'mp4'
            # faststart moves the index to the front, so the file plays before
            # it has finished copying rather than seeking badly.
            ydl_opts['postprocessor_args'] = {'ffmpeg': ['-movflags', 'faststart']}
        else:
            ydl_opts['format'] = f'best[height<={height}][ext=mp4]/best[height<={height}]/best'

        print(f"\n{'='*60}")
        print(f"Downloading {mode} at {quality}...")
        print(f"Format: {ydl_opts['format']}")
        print(f"{'='*60}\n")

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])

        downloaded_files = [f for f in os.listdir(temp_dir) if f.startswith('media.')]
        if not downloaded_files:
            raise Exception('No file was downloaded')

        downloaded_file = os.path.join(temp_dir, downloaded_files[0])
        size = os.path.getsize(downloaded_file)
        print(f"\n[ok] {downloaded_files[0]} - {size:,} bytes ({size/(1024*1024):.2f} MB)\n")
        if size == 0:
            raise Exception('Downloaded file is empty')

        ext = downloaded_files[0].rsplit('.', 1)[-1].lower()
        mimetype = _AUDIO_MIME.get(ext, 'audio/mpeg') if mode == 'audio' else 'video/mp4'
        safe_name = re.sub(r'[\r\n"\\]', '', filename) or f'download.{ext}'

        response = Response(
            _stream_and_cleanup(downloaded_file, temp_dir),
            mimetype=mimetype,
            direct_passthrough=True,
        )
        response.headers['Content-Disposition'] = f'attachment; filename="{safe_name}"'
        response.headers['Content-Length'] = str(size)
        response.headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Disposition'
        temp_dir = None
        return response

    except Exception as e:
        print(f'\nDownload error: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        payload, status = error_payload(e)
        return jsonify(payload), status
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


# =============================================================================
# YOUTUBE SUBTITLES / TRANSCRIPT
# =============================================================================

def _subtitle_tracks(info):
    """Flatten yt-dlp's two caption maps into one list the client can render.

    `subtitles` are tracks a human uploaded; `automatic_captions` are machine
    transcription. They are kept apart because the quality difference is large
    and the user should be able to see which they are getting.
    """
    tracks = []
    for source, key in (('manual', 'subtitles'), ('auto', 'automatic_captions')):
        for lang, entries in (info.get(key) or {}).items():
            if not entries:
                continue
            # Auto-captions exist in dozens of machine-translated variants that
            # are all rendered from the same source; listing them all buries the
            # real ones. Keep the originals.
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


def _pick_subtitle_entry(entries):
    """Prefer a timed text format we can actually parse."""
    by_ext = {e.get('ext'): e for e in entries if e.get('url')}
    for ext in ('vtt', 'srv3', 'srv1', 'ttml'):
        if ext in by_ext:
            return by_ext[ext]
    return next((e for e in entries if e.get('url')), None)


@app.route('/api/youtube/subtitles', methods=['GET', 'OPTIONS'])
def youtube_subtitles():
    """List a video's caption tracks, or fetch one.

    No ffmpeg, and the payload is kilobytes, so this is the one YouTube feature
    that behaves the same on free hosting as it does here.
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
        opts = _apply_cookies(_ydl_opts())
        opts['writesubtitles'] = True
        opts['writeautomaticsub'] = True

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        tracks = _subtitle_tracks(info)

        if not lang:
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

        fetched = requests.get(chosen['url'], timeout=20, headers=BROWSER_HEADERS)
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
        print(f'Subtitles error: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        payload, status = error_payload(e)
        return jsonify(payload), status



# =============================================================================
# HEALTH CHECK & ROOT
# =============================================================================

@app.route('/', methods=['GET'])
def root():
    return jsonify({
        'service': 'Unified Local Development Backend',
        'status': 'active',
        'endpoints': {
            '/api/instagram': 'Instagram Post Downloader',
            '/api/youtube': 'YouTube Video Downloader',
            '/health': 'Health check'
        }
    }), 200

@app.route('/health', methods=['GET'])
def health():
    try:
        import yt_dlp as test_ytdlp
        ytdlp_version = test_ytdlp.version.__version__
        ytdlp_status = 'imported successfully'
    except Exception as e:
        ytdlp_version = 'N/A'
        ytdlp_status = f'import failed: {str(e)}'
    
    try:
        import instaloader as test_insta
        insta_version = instaloader.__version__
        insta_status = 'imported successfully'
    except Exception as e:
        insta_version = 'N/A'
        insta_status = f'import failed: {str(e)}'
    
    return jsonify({
        'status': 'ok',
        'python_version': sys.version,
        'dependencies': {
            'yt-dlp': {
                'status': ytdlp_status,
                'version': ytdlp_version
            },
            'instaloader': {
                'status': insta_status,
                'version': insta_version
            }
        }
    }), 200


if __name__ == '__main__':
    print('\n' + '='*60)
    print('🚀 UNIFIED LOCAL DEVELOPMENT BACKEND')
    print('='*60)
    print('\n📍 Endpoints available:')
    print('   • http://localhost:5000/api/instagram')
    print('   • http://localhost:5000/api/youtube')
    print('   • http://localhost:5000/health')
    print('\n💡 Make sure your frontend is using localhost:5000')
    print('='*60 + '\n')
    
    app.run(host='0.0.0.0', port=5000, debug=True)
