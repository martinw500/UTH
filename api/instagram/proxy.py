from flask import Flask, request, jsonify, Response
from flask_cors import CORS
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

    # Only allow proxying Instagram CDN URLs for security
    if not any(domain in media_url for domain in ['cdninstagram.com', 'fbcdn.net', 'instagram.com']):
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

        headers = {
            'Content-Type': content_type,
            'Content-Disposition': f'attachment; filename="instagram_media.{ext}"',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300',
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
