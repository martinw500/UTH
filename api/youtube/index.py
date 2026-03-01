from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import re
import traceback

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

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
    
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL parameter required'}), 400
    
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
        return jsonify({
            'error': f'Failed to fetch video: {str(e)}',
            'error_type': type(e).__name__
        }), 500
