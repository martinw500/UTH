"""
Unified Local Development Backend
Combines Instagram and YouTube downloaders for easy local testing
Run with: python backend.py
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import instaloader
import requests
import base64
import re
import yt_dlp
import sys
import traceback

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

# =============================================================================
# INSTAGRAM DOWNLOADER
# =============================================================================

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


# =============================================================================
# YOUTUBE DOWNLOADER
# =============================================================================

@app.route('/api/youtube', methods=['GET', 'OPTIONS'])
def get_youtube():
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        return '', 204
    
    url = request.args.get('url')
    
    if not url:
        return jsonify({'error': 'URL parameter required'}), 400
    
    # Clean the URL - remove playlist parameters to get just the video
    # Extract video ID and reconstruct clean URL
    video_id_match = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', url)
    if video_id_match:
        video_id = video_id_match.group(1)
        url = f'https://www.youtube.com/watch?v={video_id}'
        print(f"Cleaned URL to: {url}")
    
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
        return jsonify({
            'error': f'Failed to fetch video: {str(e)}',
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc()
        }), 500


@app.route('/api/youtube/download', methods=['GET'])
def download_youtube():
    """Download YouTube video using yt-dlp and stream to client"""
    video_url = request.args.get('url')
    quality = request.args.get('quality', '360p')
    filename = request.args.get('filename', 'video.mp4')
    
    if not video_url:
        return jsonify({'error': 'URL parameter required'}), 400
    
    try:
        from flask import Response
        import tempfile
        import os
        
        # Clean URL to remove playlist params
        video_id_match = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', video_url)
        if video_id_match:
            video_id = video_id_match.group(1)
            video_url = f'https://www.youtube.com/watch?v={video_id}'
        
        # Build format string based on quality
        height = quality.replace('p', '')
        # Prefer MP4 containers with audio; merge video+audio streams with ffmpeg
        format_string = f'bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
        
        # Create temp directory
        temp_dir = tempfile.mkdtemp()
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
        print(f"Downloading video at {quality} quality...")
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
        
        # Use send_file for proper file delivery
        from flask import send_file
        return send_file(
            downloaded_file,
            mimetype='video/mp4',
            as_attachment=True,
            download_name=filename
        )
            
    except Exception as e:
        print(f'\nDownload error: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        return jsonify({'error': f'Download failed: {str(e)}'}), 500


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
