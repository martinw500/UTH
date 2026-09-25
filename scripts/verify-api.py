"""
Check the Python API's input handling through Flask's test client.

Deliberately NOT part of `npm test` (which is Jest, and gates the deploy): this
needs the Python dependencies from requirements.txt. It needs no network --
yt-dlp and requests are replaced with fakes, so nothing here can reach
YouTube or Instagram.

    pip install -r requirements.txt
    npm run verify:api

The URL checks exist in two copies (api/youtube/index.py and download.py)
because cross-directory imports on Vercel are unverified; backend.py imports
index.py's. This asserts every route agrees, so a copy cannot drift unnoticed.
"""

import importlib.util
import io
import os
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# backend.py prints ✓; on a Windows console with piped output that is cp1252
# and the print raises inside the request, failing it for the wrong reason.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
failures = []


def check(ok, label, detail=''):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


# backend.py imports the api/ helpers as packages, as it does when run from the root.
sys.path.insert(0, ROOT)


def load(relative, name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, relative))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


index = load('api/youtube/index.py', 'yt_index')
download = load('api/youtube/download.py', 'yt_download')
proxy = load('api/instagram/proxy.py', 'ig_proxy')
backend = load('backend.py', 'backend')
YOUTUBE_COPIES = {'index.py': index, 'download.py': download, 'backend.py': backend}


class NoYtDlp:
    """Stands in for yt_dlp.YoutubeDL wherever a request must not reach it."""
    calls = 0

    def __init__(self, *args, **kwargs):
        NoYtDlp.calls += 1
        raise AssertionError('yt-dlp was reached')


print('\nOnly a single YouTube video reaches yt-dlp')
WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
CASES = {
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ': WATCH,
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ': WATCH,
    'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ': WATCH,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123': WATCH,
    'https://youtu.be/dQw4w9WgXcQ?t=42': WATCH,
    'https://www.youtube.com/shorts/dQw4w9WgXcQ': WATCH,
    'https://www.youtube.com/live/dQw4w9WgXcQ': WATCH,
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ': WATCH,
    'youtube.com/watch?v=dQw4w9WgXcQ': WATCH,
    # Everything below used to be passed to yt-dlp as-is.
    'http://127.0.0.1:8080/x.mp4': None,
    'http://169.254.169.254/latest/meta-data/': None,
    'https://evil.example/watch?v=dQw4w9WgXcQ': None,
    'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ': None,
    'https://www.youtube.com/playlist?list=PL1234567890': None,
    'https://www.youtube.com/@somechannel': None,
    'https://youtube.com/watch?v=<svg/onload=alert(1)>': None,
    'file:///etc/passwd': None,
    '': None,
}
for raw, expected in CASES.items():
    got = {name: module.youtube_watch_url(raw) for name, module in YOUTUBE_COPIES.items()}
    same = len(set(got.values())) == 1
    check(same and got['index.py'] == expected, repr(raw)[:70],
          '' if same else f'copies disagree: {got}')

print('\nThe endpoints refuse before yt-dlp runs')
for name, module, path in [
    ('index.py', index, '/api/youtube'),
    ('download.py', download, '/api/youtube/download'),
    ('backend.py', backend, '/api/youtube'),
    ('backend.py', backend, '/api/youtube/download'),
]:
    module.yt_dlp.YoutubeDL = NoYtDlp
    response = module.app.test_client().get(path, query_string={'url': 'http://127.0.0.1:8080/x.mp4'})
    check(response.status_code == 400, f'{name} {path} refuses a non-YouTube URL',
          f'{response.status_code}')
check(NoYtDlp.calls == 0, 'and yt-dlp was never constructed', f'{NoYtDlp.calls} calls')

print('\nUsers see a message, not yt-dlp output')
BOT = ("ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. "
       'Use --cookies-from-browser or --cookies for the authentication.')
for name, module in YOUTUBE_COPIES.items():
    message, status = module.describe_youtube_error(Exception(BOT))
    check(status == 503 and '--cookies' not in message, f'{name}: the bot check is explained', message)
    message, _ = module.describe_youtube_error(Exception('Unsupported URL: <svg/onload=alert(1)>'))
    check('<' not in message, f'{name}: error text never echoes the input', message)
    # "Service Unavailable" contains "unavailable", and used to tell users a
    # video that YouTube was merely slow to serve had been removed.
    message, status = module.describe_youtube_error(
        Exception('ERROR: unable to download video data: HTTP Error 503: Service Unavailable'))
    check(status == 503 and 'removed' not in message, f'{name}: a 503 is transient, not a removed video', message)


def fake_downloader(ext):
    class FakeYoutubeDL:
        def __init__(self, opts):
            self.template = opts['outtmpl']

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def download(self, urls):
            with open(self.template.replace('%(ext)s', ext), 'wb') as handle:
                handle.write(b'\x00\x00\x00\x18ftypmp42')
    return FakeYoutubeDL


print('\nDownloads clean up and name the file by what was downloaded')
for name, module in [('download.py', download), ('backend.py', backend)]:
    made = []
    real_mkdtemp = tempfile.mkdtemp
    module.tempfile.mkdtemp = lambda: made.append(real_mkdtemp()) or made[-1]
    module.yt_dlp.YoutubeDL = fake_downloader('webm')
    try:
        client = module.app.test_client()
        response = client.get('/api/youtube/download', query_string={
            'url': 'https://youtu.be/dQw4w9WgXcQ', 'quality': '720p', 'filename': 'My clip.mp4',
        }, buffered=True)
        disposition = response.headers.get('Content-Disposition', '')
        response.get_data()
        # buffered=True closes the response iterator, as a server does at the
        # end of a response; backend.py cleans up then.
        check(response.status_code == 200 and 'My clip.webm' in disposition,
              f'{name}: served as .webm, the extension actually downloaded', disposition)
        check(made and not os.path.exists(made[0]), f'{name}: the temp directory is removed')
        # The client sends a bare title; splitext used to cut it at its last dot.
        response = client.get('/api/youtube/download', query_string={
            'url': 'https://youtu.be/dQw4w9WgXcQ', 'filename': 'Episode 1.5 Recap',
        }, buffered=True)
        disposition = response.headers.get('Content-Disposition', '')
        check('Episode 1.5 Recap.webm' in disposition, f'{name}: a title with a dot keeps it', disposition)
    finally:
        module.tempfile.mkdtemp = real_mkdtemp

print('\nThe local Instagram route does not echo exception text')
backend.fetch_post_with_retry = lambda shortcode: (_ for _ in ()).throw(
    Exception("401 Unauthorized - 'Please wait a few minutes before you try again.'"))
response = backend.app.test_client().get('/api/instagram', query_string={
    'url': 'https://www.instagram.com/p/ABC123/'})
error = response.get_json().get('error', '')
check(response.status_code == 502 and '401' not in error and 'blocking' in error,
      'a rate limit reads as a sentence', error)


class FakeResponse:
    def __init__(self, status, location=None):
        self.status_code = status
        self.is_redirect = location is not None
        self.headers = {'Location': location} if location else {'Content-Type': 'image/jpeg'}

    def iter_content(self, chunk_size):
        yield b'\xff\xd8\xff'

    def close(self):
        pass


print('\nThe Instagram proxy checks the host requests will really connect to')
# urlparse read cdninstagram.com as the host of the first two; requests
# (urllib3) connects to evil.com. That was an open relay on the deployed API.
for name, module in [('proxy.py', proxy), ('backend.py', backend)]:
    for url, allowed in [
        ('https://evil.com\\@cdninstagram.com/x', False),
        ('https://evil.com%5C@cdninstagram.com/x', False),
        ('https://user@scontent.cdninstagram.com/x', False),
        ('https://scontent.cdninstagram.com/v/a b.jpg', False),
        ('http://scontent.cdninstagram.com/v/a.jpg', False),
        ('https://evil.com/?x=instagram.com', False),
        ('https://scontent.cdninstagram.com/v/a.jpg?stp=1&_nc=2', True),
        ('https://instagram.fhel1-1.fna.fbcdn.net/v/a.jpg', True),
    ]:
        check(module.is_allowed_media_url(url) is allowed, f'{name}: {url}', f'expected {allowed}')

print('\nThe Instagram proxy re-checks every redirect')
CDN = 'https://scontent.cdninstagram.com/v/a.jpg'
for name, module in [('proxy.py', proxy), ('backend.py', backend)]:
    fetched = []

    def fake_get(url, **kwargs):
        fetched.append(url)
        if url == CDN:
            return FakeResponse(302, 'http://169.254.169.254/latest/meta-data/')
        if url == CDN + '?hop':
            return FakeResponse(302, 'https://instagram.fhel1-1.fna.fbcdn.net/a.jpg')
        return FakeResponse(200)

    module.requests.get = fake_get
    client = module.app.test_client()
    response = client.get('/api/instagram/proxy', query_string={'url': CDN})
    check(response.status_code == 403 and len(fetched) == 1,
          f'{name}: a redirect off the allowlist is refused, not followed', f'{response.status_code}, {fetched}')
    fetched.clear()
    response = client.get('/api/instagram/proxy', query_string={'url': CDN + '?hop'})
    check(response.status_code == 200 and len(fetched) == 2,
          f'{name}: a redirect to another Instagram CDN host is followed', f'{response.status_code}')

print(f"\n{'All API checks passed.' if not failures else f'{len(failures)} check(s) failed.'}\n")
sys.exit(1 if failures else 0)
