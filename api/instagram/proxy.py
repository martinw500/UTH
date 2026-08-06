from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from urllib.parse import urlparse
import re
import requests

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "OPTIONS"], "allow_headers": ["Content-Type"]}})

BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.instagram.com/',
    'Origin': 'https://www.instagram.com',
}

ALLOWED_HOST_SUFFIXES = ('cdninstagram.com', 'fbcdn.net', 'instagram.com')

# Anything that could escape the filename in a Content-Disposition header or
# redirect the write elsewhere on the client.
UNSAFE_FILENAME_CHARS = re.compile(r'[^A-Za-z0-9._-]')


def is_allowed_media_url(media_url):
    """Allow only https URLs whose *hostname* is an Instagram CDN host.

    Checking the whole URL for a substring would let
    ``https://evil.com/?x=instagram.com`` through, turning this endpoint into an
    open relay.
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
    """Proxy Instagram media (videos/images) to avoid CORS issues.
    The browser can't fetch Instagram CDN URLs directly due to CORS,
    so we proxy the content through our backend."""
    if request.method == 'OPTIONS':
        return '', 204

    media_url = request.args.get('url')
    if not media_url:
        return jsonify({'error': 'URL parameter required'}), 400

    if not is_allowed_media_url(media_url):
        return jsonify({'error': 'Only Instagram media URLs are allowed'}), 403

    try:
        # Stream the response from Instagram
        upstream = requests.get(media_url, headers=BROWSER_HEADERS, stream=True, timeout=30)

        if upstream.status_code != 200:
            return jsonify({'error': f'Instagram returned status {upstream.status_code}'}), 502

        content_type = upstream.headers.get('Content-Type', 'application/octet-stream')
        content_length = upstream.headers.get('Content-Length')

        # Determine filename from content type
        if 'video' in content_type:
            ext = 'mp4'
        elif 'image' in content_type:
            ext = content_type.split('/')[-1].replace('jpeg', 'jpg')
        else:
            ext = 'bin'

        # A given signed CDN URL always returns the same bytes, so it is safe
        # for the edge to hold onto this for a long time.
        basename = safe_filename(request.args.get('filename'), 'instagram_media')
        headers = {
            'Content-Type': content_type,
            'Content-Disposition': f'attachment; filename="{basename}.{ext}"',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300, s-maxage=86400',
        }
        if content_length:
            headers['Content-Length'] = content_length

        # Stream chunks to avoid loading entire file into memory
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
