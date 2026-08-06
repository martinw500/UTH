/**
 * Instagram downloader — media URL selection.
 *
 * These load the REAL source file into jsdom rather than re-declaring copies of
 * its helpers, so the tests fail if instagram-downloader.js drifts. The script
 * is a classic (non-module) script, so its top-level function declarations land
 * on `window`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKEND = 'https://backend.test';

const HTML = fs.readFileSync(
    path.join(ROOT, 'instagram-downloader', 'index.html'), 'utf8');

function loadTool() {
    const script = fs.readFileSync(
        path.join(ROOT, 'instagram-downloader', 'js', 'instagram-downloader.js'), 'utf8');

    const body = HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = body ? body[1] : HTML;
    global.API_CONFIG = { BACKEND_URL: BACKEND };

    // Indirect eval runs in global scope, so the script's top-level function
    // declarations become globals — the same way the browser loads it.
    (0, eval)(script);
    return global;
}

let win;
beforeAll(() => { win = loadTool(); });

describe('pickDownloadUrl', () => {
    test('routes the full-res URL through the proxy', () => {
        const url = win.pickDownloadUrl({ type: 'image', url_high: 'https://cdn.test/full.jpg' });
        expect(url.startsWith(`${BACKEND}/api/instagram/proxy?`)).toBe(true);
        expect(url).toContain(encodeURIComponent('https://cdn.test/full.jpg'));
    });

    test('never returns the base64 thumbnail when a full-res URL exists', () => {
        // The original bug: images downloaded `media.thumbnail`, a downscaled
        // preview, which is why saved files were blurry.
        const url = win.pickDownloadUrl({
            type: 'image',
            url_high: 'https://cdn.test/full.jpg',
            thumbnail: 'data:image/jpeg;base64,AAAA',
        });
        expect(url).not.toContain('base64');
        expect(url).toContain(encodeURIComponent('https://cdn.test/full.jpg'));
    });

    test('falls back to url_low when url_high is absent', () => {
        const url = win.pickDownloadUrl({ type: 'image', url_low: 'https://cdn.test/low.jpg' });
        expect(url).toContain(encodeURIComponent('https://cdn.test/low.jpg'));
    });

    test('passes a data: URL through instead of proxying it', () => {
        const data = 'data:image/jpeg;base64,AAAA';
        expect(win.pickDownloadUrl({ type: 'image', url_high: data })).toBe(data);
    });

    test('includes a filename so the download is not named instagram_media', () => {
        const url = win.pickDownloadUrl(
            { type: 'video', url_high: 'https://cdn.test/v.mp4' }, 'instagram_2');
        expect(url).toContain('filename=instagram_2');
    });

    test('returns null when there is nothing to download', () => {
        expect(win.pickDownloadUrl({ type: 'image' })).toBeNull();
    });
});

describe('pickPreviewUrl', () => {
    test('prefers the direct CDN URL so previews cost no proxy bandwidth', () => {
        expect(win.pickPreviewUrl({
            url_high: 'https://cdn.test/full.jpg',
            thumbnail: 'data:image/jpeg;base64,AAAA',
        })).toBe('https://cdn.test/full.jpg');
    });

    test('falls back to the thumbnail when no CDN URL is present', () => {
        expect(win.pickPreviewUrl({ thumbnail: 'data:image/jpeg;base64,AAAA' }))
            .toBe('data:image/jpeg;base64,AAAA');
    });
});

describe('extensionForBlob', () => {
    test.each([
        ['image/jpeg', 'image', 'jpg'],
        ['image/png', 'image', 'png'],
        ['image/webp', 'image', 'webp'],
        ['video/mp4', 'video', 'mp4'],
        ['video/quicktime', 'video', 'mov'],
    ])('%s (%s) -> .%s', (type, mediaType, expected) => {
        expect(win.extensionForBlob({ type }, mediaType)).toBe(expected);
    });

    test('falls back by media type when the server sends no content type', () => {
        expect(win.extensionForBlob({ type: '' }, 'video')).toBe('mp4');
        expect(win.extensionForBlob({ type: '' }, 'image')).toBe('jpg');
    });
});

describe('format options', () => {
    const html = fs.readFileSync(
        path.join(ROOT, 'instagram-downloader', 'index.html'), 'utf8');

    test('image format defaults to original so no re-encode happens', () => {
        expect(html).toMatch(/<option value="original" selected>/);
    });

    test('does not offer video formats it cannot actually transcode to', () => {
        // MOV/AVI options used to just rename an MP4, producing files some
        // players reject.
        expect(html).not.toMatch(/<option value="avi"/);
        expect(html).not.toMatch(/<option value="mov"/);
    });
});
