"""
Unified Local Development Backend
Combines Instagram and YouTube downloaders for easy local testing
Run with: python backend.py
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from urllib.parse import urlparse, urlsplit, urljoin, parse_qs
import instaloader
import requests
import base64
import re
import yt_dlp
import sys
import os
import io
import shutil
import tempfile
import traceback

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


def fetch_allowed(media_url):
    """GET a media URL, following redirects only while they stay on allowed hosts.

    requests follows redirects on its own, and the allowlist used to be checked
    on the first URL only, so an open redirect on any instagram.com host would
    have let this fetch anything. Returns None when a hop leaves the allowlist.
    """
    url = media_url
    for _ in range(4):
        upstream = requests.get(url, headers=BROWSER_HEADERS, stream=True, timeout=30,
                                allow_redirects=False)
        if not upstream.is_redirect:
            return upstream
        url = urljoin(url, upstream.headers.get('Location', ''))
        upstream.close()
        if not is_allowed_media_url(url):
            return None
    return None


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
        upstream = fetch_allowed(media_url)
        if upstream is None:
            return jsonify({'error': 'Only Instagram media URLs are allowed'}), 403
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
        return jsonify({'error': 'Could not fetch that file from Instagram.'}), 502


# =============================================================================
# YOUTUBE DOWNLOADER
# =============================================================================

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


@app.route('/api/youtube', methods=['GET', 'OPTIONS'])
def get_youtube():
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        return '', 204
    
    if not request.args.get('url'):
        return jsonify({'error': 'URL parameter required'}), 400
    url = youtube_watch_url(request.args.get('url'))
    if not url:
        return jsonify({'error': 'That is not a link to a single YouTube video.'}), 400
    
    try:
        # yt-dlp options - use defaults for best format discovery
        ydl_opts = {
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
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Get video information
            video_data = {
                'success': True,
                'title': info.get('title', 'Unknown'),
                'channel': info.get('uploader', 'Unknown'),
                'duration': info.get('duration', 0),
                'views': info.get('view_count', 0),
                'thumbnail': info.get('thumbnail', ''),
                'formats': []
            }
            
            # Filter and sort formats
            formats = info.get('formats', [])
            
            # Collect all video formats with different qualities
            quality_map = {}
            
            for fmt in formats:
                # Skip audio-only formats
                if fmt.get('vcodec') == 'none':
                    continue
                
                height = fmt.get('height')
                if not height:
                    continue
                
                quality_label = f"{height}p"
                
                # Prefer formats with audio, but include video-only if that's all we have
                has_audio = fmt.get('acodec') != 'none'
                
                # Only replace if we don't have this quality yet, or if this one has audio and the stored one doesn't
                if quality_label not in quality_map or (has_audio and not quality_map[quality_label].get('has_audio', False)):
                    filesize = fmt.get('filesize') or fmt.get('filesize_approx')
                    if filesize and filesize > 0:
                        filesize_str = f"{filesize / (1024*1024):.1f} MB"
                    else:
                        # Estimate based on duration and quality if available
                        duration = info.get('duration', 0)
                        if duration and height:
                            # Rough estimate: bitrate varies by quality
                            bitrate_kbps = {
                                144: 200, 240: 400, 360: 800, 
                                480: 1500, 720: 2500, 1080: 4500
                            }.get(height, 1000)
                            estimated_size = (bitrate_kbps * duration / 8) / 1024  # MB
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
            
            # Convert to list and sort by height
            video_data['formats'] = sorted(quality_map.values(), key=lambda x: x['height'], reverse=True)
            
            return jsonify(video_data)
        
    except Exception as e:
        error_msg = f'{type(e).__name__}: {str(e)}'
        print(f'Error: {error_msg}')
        print(f'Traceback: {traceback.format_exc()}')
        # The traceback stays in this console; it used to be sent to the page.
        message, status = describe_youtube_error(e)
        return jsonify({'error': message, 'error_type': type(e).__name__}), status


@app.route('/api/youtube/download', methods=['GET'])
def download_youtube():
    """Download YouTube video using yt-dlp and stream to client"""
    if not request.args.get('url'):
        return jsonify({'error': 'URL parameter required'}), 400
    video_url = youtube_watch_url(request.args.get('url'))
    if not video_url:
        return jsonify({'error': 'That is not a link to a single YouTube video.'}), 400
    height = re.sub(r'\D', '', request.args.get('quality', '360p')) or '360'
    stem = os.path.splitext(request.args.get('filename', 'video'))[0] or 'video'

    temp_dir = tempfile.mkdtemp()
    try:
        # Prefer MP4 containers with audio; merge video+audio streams with ffmpeg
        format_string = f'bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
        
        output_path = os.path.join(temp_dir, 'video.%(ext)s')
        
        ydl_opts = {
            'format': format_string,
            'outtmpl': output_path,
            'quiet': False,
            'no_warnings': False,
            'merge_output_format': 'mp4',
            'socket_timeout': 30,
            # Use alternative player clients to bypass bot detection
            'extractor_args': {
                'youtube': {
                    'player_client': ['mediaconnect', 'android', 'web'],
                }
            },
            # Fix metadata so video files are playable
            'postprocessor_args': {
                'ffmpeg': ['-movflags', 'faststart'],
            },
            'prefer_ffmpeg': True,
            'writethumbnail': False,
            'embedthumbnail': False,
            'postprocessors': [
                {
                    'key': 'FFmpegVideoRemuxer',
                    'preferedformat': 'mp4',
                },
                {
                    'key': 'FFmpegMetadata',
                    'add_metadata': True,
                },
            ],
        }
        
        print(f"\n{'='*60}")
        print(f"Downloading video at up to {height}p...")
        print(f"Format: {format_string}")
        print(f"{'='*60}\n")
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            result = ydl.download([video_url])
        
        # Find the downloaded file
        downloaded_files = [f for f in os.listdir(temp_dir) if f.startswith('video.')]
        if not downloaded_files:
            raise Exception('No file was downloaded')
        
        downloaded_file = os.path.join(temp_dir, downloaded_files[0])
        file_size = os.path.getsize(downloaded_file)
        
        print(f"\n✓ Downloaded: {downloaded_files[0]}")
        print(f"✓ Size: {file_size:,} bytes ({file_size/(1024*1024):.2f} MB)\n")
        
        if file_size == 0:
            raise Exception('Downloaded file is empty')
        ext = os.path.splitext(downloaded_file)[1].lstrip('.') or 'mp4'
        with open(downloaded_file, 'rb') as handle:
            data = handle.read()
    except Exception as e:
        print(f'\nDownload error: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        message, status = describe_youtube_error(e)
        return jsonify({'error': message}), status
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    from flask import send_file
    return send_file(
        io.BytesIO(data),
        mimetype='video/webm' if ext == 'webm' else 'video/mp4',
        as_attachment=True,
        download_name=f'{stem}.{ext}',
    )


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
    
    # Loopback, and no Werkzeug debugger: 0.0.0.0 with debug=True exposed an
    # interactive console to anyone on the same network. Opt in explicitly.
    app.run(
        host=os.environ.get('BACKEND_HOST', '127.0.0.1'),
        port=5000,
        debug=os.environ.get('FLASK_DEBUG') == '1',
    )
