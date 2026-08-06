// js/shared/ — format, config, storage, dropzone and the pure half of image.

import {
    formatBytes, stripExtension, getExtension, formatDuration,
    formatTime, parseTime, formatViews, sanitiseFilename, clamp,
} from '../js/shared/format.js';
import { resolveBackendUrl, apiUrl, API_CONFIG } from '../js/shared/config.js';
import * as storage from '../js/shared/storage.js';
import { createDropzone, matchesAccept } from '../js/shared/dropzone.js';
import { fitWithin, isLossless, MIME_BY_FORMAT, EXT_BY_MIME, MAX_CANVAS_DIMENSION } from '../js/shared/image.js';

describe('format', () => {
    test('formatBytes honours the MB precision each tool expects', () => {
        expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
        expect(formatBytes(1024 * 1024, { mbDecimals: 1 })).toBe('1.0 MB');
    });

    test('formatBytes rejects nonsense instead of printing NaN', () => {
        expect(formatBytes(NaN)).toBe('0 B');
        expect(formatBytes(-5)).toBe('0 B');
        expect(formatBytes(undefined)).toBe('0 B');
    });

    test('getExtension', () => {
        expect(getExtension('a.PNG')).toBe('png');
        expect(getExtension('a.b.tar')).toBe('tar');
        expect(getExtension('noext')).toBe('');
    });

    test('stripExtension leaves a dotfile with no name', () => {
        expect(stripExtension('.gitignore')).toBe('');
        expect(stripExtension('a.b.png')).toBe('a.b');
    });

    test('formatDuration switches to hours only when needed', () => {
        expect(formatDuration(65)).toBe('1:05');
        expect(formatDuration(3723)).toBe('1:02:03');
        expect(formatDuration(0)).toBe('0:00');
        expect(formatDuration(NaN)).toBe('0:00');
    });

    test('formatTime always pads to hh:mm:ss', () => {
        expect(formatTime(0)).toBe('00:00:00');
        expect(formatTime(3661)).toBe('01:01:01');
    });

    test('parseTime accepts ss, mm:ss and hh:mm:ss', () => {
        expect(parseTime('30')).toBe(30);
        expect(parseTime('05:30')).toBe(330);
        expect(parseTime('01:02:03')).toBe(3723);
        expect(parseTime('  30.5 ')).toBe(30.5);
    });

    test('parseTime returns NaN rather than a wrong number', () => {
        expect(parseTime('abc')).toBeNaN();
        expect(parseTime('1:2:3:4')).toBeNaN();
        expect(parseTime('')).toBeNaN();
        expect(parseTime('1:')).toBeNaN();
        expect(parseTime(null)).toBeNaN();
    });

    test('formatViews abbreviates', () => {
        expect(formatViews(999)).toBe('999');
        expect(formatViews(1500)).toBe('1.5K');
        expect(formatViews(2_400_000)).toBe('2.4M');
        expect(formatViews(3_200_000_000)).toBe('3.2B');
    });

    test('sanitiseFilename replaces reserved characters', () => {
        expect(sanitiseFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
        expect(sanitiseFilename('')).toBe('download');
        expect(sanitiseFilename('   ')).toBe('download');
        expect(sanitiseFilename(null)).toBe('download');
    });

    test('sanitiseFilename cannot produce a path traversal', () => {
        for (const input of ['../../etc/passwd', '..\\..\\windows\\system32', '/abs/path']) {
            const out = sanitiseFilename(input);
            expect(out).not.toMatch(/[/\\]/);
            expect(out.startsWith('.')).toBe(false);
        }
    });

    test('sanitiseFilename strips control characters', () => {
        expect(sanitiseFilename('a\u0000b\u0001c')).toBe('a-b-c');
        expect(sanitiseFilename('a\nb')).toBe('a-b');
    });

    test('sanitiseFilename caps length', () => {
        expect(sanitiseFilename('x'.repeat(500)).length).toBeLessThanOrEqual(120);
    });

    test('clamp', () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-1, 0, 10)).toBe(0);
        expect(clamp(11, 0, 10)).toBe(10);
    });
});

describe('config.resolveBackendUrl', () => {
    test('local development talks to the local Flask server', () => {
        expect(resolveBackendUrl('localhost')).toBe('http://localhost:5000');
        expect(resolveBackendUrl('127.0.0.1')).toBe('http://localhost:5000');
        expect(resolveBackendUrl('')).toBe('http://localhost:5000');
    });

    test('a Vercel preview talks to its own API, not production', () => {
        // Otherwise a preview deployment can never exercise backend changes,
        // which defeats the point of having previews.
        expect(resolveBackendUrl('uth-git-abc123.vercel.app'))
            .toBe('https://uth-git-abc123.vercel.app');
    });

    test('Vercel production talks to itself', () => {
        expect(resolveBackendUrl('useful-tool-hub.vercel.app'))
            .toBe('https://useful-tool-hub.vercel.app');
    });

    test('GitHub Pages borrows the production API, since it has none', () => {
        expect(resolveBackendUrl('martinw500.github.io'))
            .toBe('https://useful-tool-hub.vercel.app');
    });

    test('an unrecognised host falls back to production rather than localhost', () => {
        expect(resolveBackendUrl('example.com')).toBe('https://useful-tool-hub.vercel.app');
    });
});

describe('config.apiUrl', () => {
    test('encodes parameters', () => {
        const url = apiUrl('/api/instagram', { url: 'https://x.test/a b?c=1' });
        expect(url).toContain('url=https%3A%2F%2Fx.test%2Fa+b%3Fc%3D1');
    });

    test('omits empty parameters', () => {
        expect(apiUrl('/api/x', { a: 1, b: null, c: undefined, d: '' }))
            .toBe(`${API_CONFIG.BACKEND_URL}/api/x?a=1`);
    });

    test('tolerates a path with no leading slash', () => {
        expect(apiUrl('api/x')).toBe(`${API_CONFIG.BACKEND_URL}/api/x`);
    });
});

describe('storage', () => {
    beforeEach(() => { window.localStorage.clear(); storage._reset(); });

    test('round-trips JSON', () => {
        expect(storage.setJSON('k', { a: 1 })).toBe(true);
        expect(storage.getJSON('k')).toEqual({ a: 1 });
    });

    test('returns the fallback for a missing key', () => {
        expect(storage.getJSON('nope', 'fallback')).toBe('fallback');
    });

    test('returns the fallback rather than throwing on corrupt JSON', () => {
        window.localStorage.setItem('bad', '{not json');
        expect(storage.getJSON('bad', [])).toEqual([]);
    });

    test('reports unavailable storage instead of throwing', () => {
        const spy = jest.spyOn(window.localStorage.__proto__, 'setItem')
            .mockImplementation(() => { throw new Error('QuotaExceededError'); });
        storage._reset();

        expect(storage.isAvailable()).toBe(false);
        expect(storage.setJSON('k', 1)).toBe(false);
        expect(storage.getJSON('k', 'fb')).toBe('fb');

        spy.mockRestore();
        storage._reset();
    });
});

describe('dropzone.matchesAccept', () => {
    const file = (name, type) => ({ name, type, size: 1 });

    test('matches a MIME glob', () => {
        expect(matchesAccept(file('a.png', 'image/png'), ['image/*'])).toBe(true);
        expect(matchesAccept(file('a.mp4', 'video/mp4'), ['image/*'])).toBe(false);
    });

    test('matches an exact MIME type', () => {
        expect(matchesAccept(file('a.png', 'image/png'), ['image/png'])).toBe(true);
        expect(matchesAccept(file('a.gif', 'image/gif'), ['image/png'])).toBe(false);
    });

    test('falls back to the extension when the browser reports no type', () => {
        // Windows often reports an empty type for less common formats.
        expect(matchesAccept(file('a.heic', ''), ['image/*', '.heic'])).toBe(true);
    });

    test('an empty accept list allows everything', () => {
        expect(matchesAccept(file('a.exe', 'application/x-msdownload'), [])).toBe(true);
    });
});

describe('createDropzone', () => {
    let dropzone; let fileInput; let onFiles; let onReject; let zone;

    const makeFile = (name, type, size = 10) => {
        const f = new File(['x'], name, { type });
        Object.defineProperty(f, 'size', { value: size });
        return f;
    };

    const fireChange = (files) => {
        Object.defineProperty(fileInput, 'files', { value: files, configurable: true });
        fileInput.dispatchEvent(new Event('change'));
    };

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="dz"><button id="browse">Browse</button></div>
            <input type="file" id="fi">`;
        dropzone = document.getElementById('dz');
        fileInput = document.getElementById('fi');
        onFiles = jest.fn();
        onReject = jest.fn();
    });

    afterEach(() => zone?.destroy());

    test('validates type on the file-picker path, not just on drop', () => {
        // The original bug: drop was guarded but the picker was not, and the
        // accept attribute is only a hint the browser may ignore.
        zone = createDropzone({ dropzone, fileInput, accept: ['image/*'], onFiles, onReject });

        fireChange([makeFile('a.mp4', 'video/mp4')]);

        expect(onFiles).not.toHaveBeenCalled();
        expect(onReject).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'type' }));
    });

    test('accepts a valid file', () => {
        zone = createDropzone({ dropzone, fileInput, accept: ['image/*'], onFiles, onReject });
        fireChange([makeFile('a.png', 'image/png')]);
        expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.png' })]);
    });

    test('rejects an oversized file', () => {
        zone = createDropzone({ dropzone, fileInput, maxBytes: 5, onFiles, onReject });
        fireChange([makeFile('big.png', 'image/png', 100)]);
        expect(onFiles).not.toHaveBeenCalled();
        expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ reason: 'size' }));
    });

    test('takes only the first file when multiple is off', () => {
        zone = createDropzone({ dropzone, fileInput, onFiles, onReject });
        fireChange([makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')]);
        expect(onFiles.mock.calls[0][0]).toHaveLength(1);
        expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ reason: 'count' }));
    });

    test('passes every file through when multiple is on', () => {
        zone = createDropzone({ dropzone, fileInput, multiple: true, onFiles });
        fireChange([makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')]);
        expect(onFiles.mock.calls[0][0]).toHaveLength(2);
        expect(fileInput.multiple).toBe(true);
    });

    test('resets the input so the same file can be chosen twice', () => {
        zone = createDropzone({ dropzone, fileInput, onFiles });
        fireChange([makeFile('a.png', 'image/png')]);
        expect(fileInput.value).toBe('');
    });

    test('only clears the highlight once every nested dragleave has fired', () => {
        // A plain toggle makes the dropzone flicker as the pointer crosses
        // child elements, because each child fires its own dragleave.
        zone = createDropzone({ dropzone, fileInput, onFiles });

        dropzone.dispatchEvent(new Event('dragenter', { bubbles: true }));
        dropzone.dispatchEvent(new Event('dragenter', { bubbles: true }));
        expect(dropzone.classList.contains('dragover')).toBe(true);

        dropzone.dispatchEvent(new Event('dragleave', { bubbles: true }));
        expect(dropzone.classList.contains('dragover')).toBe(true);

        dropzone.dispatchEvent(new Event('dragleave', { bubbles: true }));
        expect(dropzone.classList.contains('dragover')).toBe(false);
    });

    test('destroy detaches every listener', () => {
        zone = createDropzone({ dropzone, fileInput, onFiles });
        zone.destroy();
        zone = null;
        fireChange([makeFile('a.png', 'image/png')]);
        expect(onFiles).not.toHaveBeenCalled();
    });
});

describe('image (pure helpers)', () => {
    test('fitWithin leaves a small image alone', () => {
        expect(fitWithin(100, 50, 1000)).toEqual({ width: 100, height: 50, scale: 1 });
    });

    test('fitWithin preserves aspect ratio when shrinking', () => {
        const r = fitWithin(4000, 2000, 1000);
        expect(r.width).toBe(1000);
        expect(r.height).toBe(500);
        expect(r.scale).toBeCloseTo(0.25);
    });

    test('quality is meaningless for PNG', () => {
        expect(isLossless('image/png')).toBe(true);
        expect(isLossless('image/jpeg')).toBe(false);
    });

    test('format and MIME maps agree', () => {
        expect(MIME_BY_FORMAT.jpg).toBe('image/jpeg');
        expect(EXT_BY_MIME['image/jpeg']).toBe('jpg');
        expect(EXT_BY_MIME[MIME_BY_FORMAT.webp]).toBe('webp');
    });

    test('canvas dimension cap matches the browser limit', () => {
        expect(MAX_CANVAS_DIMENSION).toBe(16384);
    });
});
