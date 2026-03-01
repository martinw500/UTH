from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp
import re
import traceback
import tempfile
import os
import shutil

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

@app.route('/api/youtube/download', methods=['GET', 'OPTIONS'])
def download_youtube():
    """Download YouTube video using yt-dlp and stream to client"""
    if request.method == 'OPTIONS':
        return '', 204
    
    video_url = request.args.get('url')
    quality = request.args.get('quality', '360p')
    filename = request.args.get('filename', 'video.mp4')
    
    if not video_url:
        return jsonify({'error': 'URL parameter required'}), 400
    
    try:
        video_id_match = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', video_url)
        if video_id_match:
            video_id = video_id_match.group(1)
            video_url = f'https://www.youtube.com/watch?v={video_id}'
        
        height = quality.replace('p', '')
        has_ffmpeg = shutil.which('ffmpeg') is not None
        
        if has_ffmpeg:
            format_string = f'bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
        else:
            # No ffmpeg available (e.g. Vercel serverless) - use combined formats only
            format_string = f'best[height<={height}][ext=mp4]/best[height<={height}]/best'
        
        temp_dir = tempfile.mkdtemp()
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
        
        return send_file(
            downloaded_file,
            mimetype='video/mp4',
            as_attachment=True,
            download_name=filename
        )
            
    except Exception as e:
        print(f'Download error: {str(e)}')
        print(f'Traceback: {traceback.format_exc()}')
        return jsonify({'error': f'Download failed: {str(e)}'}), 500
