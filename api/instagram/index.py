from flask import Flask, request, jsonify
from flask_cors import CORS
import instaloader
import requests
import base64
import re
import time

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
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
        user_agent=BROWSER_HEADERS['User-Agent']
    )
    return loader

def fetch_image_as_base64(url):
    """Fetch an image and convert to base64 data URL"""
    try:
        response = requests.get(url, headers=BROWSER_HEADERS, timeout=10)
        if response.status_code == 200:
            content_type = response.headers.get('Content-Type', 'image/jpeg')
            base64_data = base64.b64encode(response.content).decode('utf-8')
            return f'data:{content_type};base64,{base64_data}'
    except Exception as e:
        print(f'Failed to fetch image as base64: {e}')
    return None


# ── Fallback 1: Instagram embed page scraping ─────────────────────
def fetch_via_embed_page(shortcode):
    """Scrape the Instagram embed page for all carousel media.
    The embed page is less aggressively rate-limited than the GraphQL API
    and contains data for all items in a carousel post."""
    import json as _json

    embed_url = f'https://www.instagram.com/p/{shortcode}/embed/captioned/'
    print(f'Trying embed page fallback: {embed_url}')

    resp = requests.get(embed_url, headers={
        **BROWSER_HEADERS,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }, timeout=15)

    if resp.status_code != 200:
        print(f'Embed page returned {resp.status_code}')
        return None

    html = resp.text
    media = []

    # Strategy 1: Extract JSON data from the embedded script
    # Look for window.__additionalDataLoaded or similar JSON blobs
    json_patterns = [
        r'window\.__additionalDataLoaded\s*\(\s*[\'"][^\'"]*[\'"]\s*,\s*({.+?})\s*\)\s*;',
        r'"gql_data"\s*:\s*({.+?"shortcode_media".+?})\s*[,}]',
    ]

    post_data = None
    for pattern in json_patterns:
        m = re.search(pattern, html, re.DOTALL)
        if m:
            try:
                post_data = _json.loads(m.group(1))
                print(f'Found JSON data via pattern')
                break
            except _json.JSONDecodeError:
                continue

    if post_data:
        # Navigate to the shortcode_media object
        shortcode_media = None
        if 'shortcode_media' in post_data:
            shortcode_media = post_data['shortcode_media']
        elif 'graphql' in post_data and 'shortcode_media' in post_data.get('graphql', {}):
            shortcode_media = post_data['graphql']['shortcode_media']

        if shortcode_media:
            # Check for carousel (sidecar)
            sidecar = shortcode_media.get('edge_sidecar_to_children', {})
            edges = sidecar.get('edges', [])

            if edges:
                print(f'Found carousel with {len(edges)} items in embed data')
                for i, edge in enumerate(edges):
                    node = edge.get('node', {})
                    is_video = node.get('is_video', False)
                    display_url = node.get('display_url', '')

                    if not display_url:
                        continue

                    thumbnail_base64 = fetch_image_as_base64(display_url)

                    if is_video:
                        video_url = node.get('video_url', '')
                        media.append({
                            'type': 'video',
                            'url_high': video_url or display_url,
                            'url_low': video_url or display_url,
                            'thumbnail': thumbnail_base64 or display_url,
                            'is_proxied': False
                        })
                    else:
                        media.append({
                            'type': 'image',
                            'url_high': display_url,
                            'url_low': display_url,
                            'thumbnail': thumbnail_base64 or display_url
                        })
            else:
                # Single post from JSON
                is_video = shortcode_media.get('is_video', False)
                display_url = shortcode_media.get('display_url', '')
                if display_url:
                    thumbnail_base64 = fetch_image_as_base64(display_url)
                    if is_video:
                        video_url = shortcode_media.get('video_url', '')
                        media.append({
                            'type': 'video',
                            'url_high': video_url or display_url,
                            'url_low': video_url or display_url,
                            'thumbnail': thumbnail_base64 or display_url,
                            'is_proxied': False
                        })
                    else:
                        media.append({
                            'type': 'image',
                            'url_high': display_url,
                            'url_low': display_url,
                            'thumbnail': thumbnail_base64 or display_url
                        })

    # Strategy 2: Look for video URLs directly in HTML (video tags, og:video meta)
    if not media or all(m['type'] != 'video' for m in media):
        # Check for og:video meta tag
        og_video = re.search(
            r'<meta[^>]+(?:property|name)=["\']og:video["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.IGNORECASE
        )
        if not og_video:
            og_video = re.search(
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:video["\']',
                html, re.IGNORECASE
            )
        
        if og_video:
            video_url = og_video.group(1)
            print(f'Found og:video URL: {video_url[:80]}...')
            # Get thumbnail from og:image
            og_image = re.search(
                r'<meta[^>]+(?:property|name)=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
                html, re.IGNORECASE
            )
            thumb_url = og_image.group(1) if og_image else video_url
            thumbnail_base64 = fetch_image_as_base64(thumb_url)
            media = [{
                'type': 'video',
                'url_high': video_url,
                'url_low': video_url,
                'thumbnail': thumbnail_base64 or thumb_url,
                'is_proxied': False
            }]
        
        # Also check for <video> tags with src
        if not media:
            video_tags = re.findall(
                r'<video[^>]+src=["\']([^"\']+)["\']',
                html, re.IGNORECASE
            )
            for vid_url in video_tags:
                if 'cdninstagram.com' in vid_url or 'fbcdn.net' in vid_url:
                    print(f'Found video tag URL: {vid_url[:80]}...')
                    media.append({
                        'type': 'video',
                        'url_high': vid_url,
                        'url_low': vid_url,
                        'thumbnail': vid_url,
                        'is_proxied': False
                    })

    # Strategy 3: If no video found, try scraping image URLs from HTML
    if not media:
        # Look for high-res image URLs in the embed HTML (Instagram CDN pattern)
        img_urls = re.findall(
            r'(?:src|srcset|data-src)=["\']'
            r'(https://(?:scontent|instagram)[^"\']+?\.(?:jpg|jpeg|png|webp)[^"\']*)',
            html, re.IGNORECASE
        )
        # Deduplicate while preserving order
        seen = set()
        unique_urls = []
        for u in img_urls:
            # Normalize by removing size params for dedup
            norm = re.sub(r'&?se=\d+', '', u)
            if norm not in seen:
                seen.add(norm)
                unique_urls.append(u)

        # Filter out tiny profile pics / icons (they usually have s150x150 or similar)
        full_urls = [u for u in unique_urls if not re.search(r's\d{2,3}x\d{2,3}', u)]
        if not full_urls:
            full_urls = unique_urls

        if full_urls:
            print(f'Found {len(full_urls)} images via HTML scraping')
            for img_url in full_urls:
                thumbnail_base64 = fetch_image_as_base64(img_url)
                if thumbnail_base64:
                    media.append({
                        'type': 'image',
                        'url_high': img_url,
                        'url_low': img_url,
                        'thumbnail': thumbnail_base64
                    })

    if media:
        return media
    return None


# ── Fallback 1b: Direct page og:video scraping ───────────────────
def fetch_via_page_meta(shortcode):
    """Try fetching the actual Instagram post page for og:video meta tag.
    This can get video URLs for reels and video posts when embed page fails."""
    post_url = f'https://www.instagram.com/p/{shortcode}/'
    print(f'Trying direct page meta fallback: {post_url}')

    try:
        resp = requests.get(post_url, headers=BROWSER_HEADERS, timeout=15)
        if resp.status_code != 200:
            print(f'Direct page returned {resp.status_code}')
            return None

        html = resp.text

        # Look for og:video meta tag
        og_video = re.search(
            r'<meta[^>]+(?:property|name)=["\']og:video(?::url)?["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.IGNORECASE
        )
        if not og_video:
            og_video = re.search(
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:video(?::url)?["\']',
                html, re.IGNORECASE
            )

        if og_video:
            video_url = og_video.group(1)
            print(f'Found og:video in direct page: {video_url[:80]}...')

            # Get thumbnail
            og_image = re.search(
                r'<meta[^>]+(?:property|name)=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
                html, re.IGNORECASE
            )
            thumb_url = og_image.group(1) if og_image else ''
            thumbnail_base64 = fetch_image_as_base64(thumb_url) if thumb_url else None

            return [{
                'type': 'video',
                'url_high': video_url,
                'url_low': video_url,
                'thumbnail': thumbnail_base64 or thumb_url or video_url,
                'is_proxied': False
            }]

    except Exception as e:
        print(f'Direct page meta fallback failed: {e}')

    return None


# ── Fallback 2: Instagram oEmbed API ─────────────────────────────
def fetch_via_oembed(shortcode):
    """Last-resort fallback: use Instagram's oEmbed API for a thumbnail.
    Only returns the first image (no carousel/video support) but works
    when everything else is rate-limited on cloud IPs."""
    post_url = f'https://www.instagram.com/p/{shortcode}/'
    oembed_url = f'https://i.instagram.com/api/v1/oembed/?url={post_url}'
    print(f'Trying oEmbed fallback: {oembed_url}')

    resp = requests.get(oembed_url, headers={
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        'Accept': 'application/json',
    }, timeout=10)

    if resp.status_code != 200:
        print(f'oEmbed returned {resp.status_code}')
        return None

    data = resp.json()
    thumbnail_url = data.get('thumbnail_url')
    if not thumbnail_url:
        return None

    print(f'oEmbed thumbnail: {thumbnail_url[:80]}...')
    thumbnail_base64 = fetch_image_as_base64(thumbnail_url)

    if not thumbnail_base64:
        return None

    return [{
        'type': 'image',
        'url_high': thumbnail_url,
        'url_low': thumbnail_url,
        'thumbnail': thumbnail_base64
    }]


# ── Primary: instaloader approach ──────────────────────────────────
def fetch_via_instaloader(shortcode):
    """Primary approach using instaloader's GraphQL queries."""
    last_error = None
    for attempt in range(2):
        try:
            L = get_instaloader()
            post = instaloader.Post.from_shortcode(L.context, shortcode)
            _ = post.typename  # trigger actual fetch
            
            media = []
            
            if post.typename == 'GraphSidecar':
                print(f'Found carousel with {post.mediacount} items')
                for i, node in enumerate(post.get_sidecar_nodes()):
                    display_url = node.display_url
                    thumbnail_base64 = fetch_image_as_base64(display_url)
                    if node.is_video:
                        media.append({
                            'type': 'video',
                            'url_high': node.video_url,
                            'url_low': node.video_url,
                            'thumbnail': thumbnail_base64 or display_url
                        })
                    else:
                        media.append({
                            'type': 'image',
                            'url_high': display_url,
                            'url_low': display_url,
                            'thumbnail': thumbnail_base64 or display_url
                        })
            elif post.typename == 'GraphImage':
                img_url = post.url
                thumbnail_base64 = fetch_image_as_base64(img_url)
                media.append({
                    'type': 'image',
                    'url_high': img_url,
                    'url_low': img_url,
                    'thumbnail': thumbnail_base64 or img_url
                })
            elif post.typename == 'GraphVideo':
                video_url = post.video_url
                thumbnail_base64 = fetch_image_as_base64(post.url)
                media.append({
                    'type': 'video',
                    'url_high': video_url,
                    'url_low': video_url,
                    'thumbnail': thumbnail_base64 or post.url
                })
            
            if media:
                return media
            return None
            
        except Exception as e:
            last_error = e
            print(f'Instaloader attempt {attempt + 1} failed: {e}')
            if attempt < 1:
                time.sleep(1)
    
    raise last_error

@app.route('/api/instagram', methods=['GET', 'OPTIONS'])
def get_instagram():
    if request.method == 'OPTIONS':
        return '', 204
    
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL parameter required'}), 400
    
    match = re.search(r'/(p|reel)/([A-Za-z0-9_-]+)', url)
    if not match:
        return jsonify({'error': 'Invalid Instagram URL'}), 400
    
    shortcode = match.group(2)
    print(f'\n=== Fetching Instagram post: {shortcode} ===')
    
    # 1) Try instaloader (full quality, carousel support)
    try:
        media = fetch_via_instaloader(shortcode)
        if media:
            print(f'=== Instaloader success: {len(media)} items ===\n')
            return jsonify({'success': True, 'media': media})
    except Exception as e:
        print(f'Instaloader failed, trying embed page fallback: {e}')
    
    # 2) Try embed page scraping (carousel support, less rate-limited)
    try:
        media = fetch_via_embed_page(shortcode)
        if media:
            print(f'=== Embed page fallback success: {len(media)} items ===\n')
            return jsonify({'success': True, 'media': media})
    except Exception as e:
        print(f'Embed page fallback failed, trying direct page: {e}')
    
    # 3) Try direct page og:video meta (works for reels/video posts)
    try:
        media = fetch_via_page_meta(shortcode)
        if media:
            print(f'=== Direct page meta success: {len(media)} items ===\n')
            return jsonify({'success': True, 'media': media})
    except Exception as e:
        print(f'Direct page meta failed, trying oEmbed: {e}')
    
    # 4) Last resort: oEmbed API (first image only, no video)
    try:
        media = fetch_via_oembed(shortcode)
        if media:
            print(f'=== oEmbed fallback success: {len(media)} items ===\n')
            return jsonify({'success': True, 'media': media})
    except Exception as e:
        print(f'oEmbed fallback also failed: {e}')
    
    return jsonify({
        'error': 'Could not retrieve media from this Instagram post. Instagram may be blocking requests. Please try again in a few minutes.'
    }), 502
