/**
 * @jest-environment node
 */

// ============================================
// Deployed Site E2E Tests
// Tests the LIVE deployed site from a user's perspective.
// Verifies all pages load, resources are accessible, interactive
// elements are present, headers are correct, and features work.
// ============================================

// Override with SITE_URL to run against a Vercel preview deployment or a local
// server, e.g. `SITE_URL=https://uth-abc123.vercel.app npm run test:e2e`.
// Without this these tests can only ever validate what is already in production.
const SITE = (process.env.SITE_URL || 'https://useful-tool-hub.vercel.app').replace(/\/$/, '');

// Previews sit behind Vercel Deployment Protection, which answers every request
// with a 302 to its login page. Wrapped here so every fetch to SITE carries the
// bypass, including ones added later; other hosts are left alone.
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (BYPASS) {
    const plainFetch = globalThis.fetch;
    globalThis.fetch = (url, init = {}) => (String(url).startsWith(SITE)
        ? plainFetch(url, { ...init, headers: { ...init.headers, 'x-vercel-protection-bypass': BYPASS } })
        : plainFetch(url, init));
}

// Reuses the app's own chunk discovery so this file cannot drift from it.
import {
    FFMPEG_UMD_BASE,
    FFMPEG_CORE_BASE,
    findWorkerChunk,
    resolveWorkerChunk,
} from '../js/shared/ffmpeg.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const HTML_PAGES = [
    'index.html', 'feedback.html', 'image-converter/index.html', 'video-converter/index.html',
    'color-converter/index.html', 'youtube-downloader/index.html', 'instagram-downloader/index.html',
    'qr-generator/index.html', 'audio-converter/index.html', 'convert/index.html',
    'favicon-generator/index.html', 'pdf-tools/index.html', 'photo-privacy/index.html',
];

/** Local files the pages load, found by following script tags and imports. */
function servedFiles() {
    const seen = new Set();
    const visit = (file) => {
        if (seen.has(file) || !fs.existsSync(path.join(ROOT, file))) return;
        seen.add(file);
        if (!file.endsWith('.js')) return;
        const source = fs.readFileSync(path.join(ROOT, file), 'utf-8');
        for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
            visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
        }
    };
    for (const page of HTML_PAGES) {
        const html = fs.readFileSync(path.join(ROOT, page), 'utf-8');
        for (const match of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
            if (!/^([a-z]+:|\/\/)/i.test(match[1])) {
                visit(path.posix.normalize(path.posix.join(path.posix.dirname(page), match[1])));
            }
        }
    }
    // Chosen at runtime by name, so no import literal mentions them.
    visit('convert/js/engines/image.js');
    visit('convert/js/engines/media.js');
    for (const tool of ['video-converter', 'audio-converter', 'convert']) visit(`${tool}/coi-serviceworker.js`);
    return [...seen].sort();
}

// Increase timeout — network requests to the live site
jest.setTimeout(30000);

// Helper: fetch a page and return { status, headers, body }
async function fetchPage(path) {
    const url = `${SITE}${path}`;
    const res = await fetch(url);
    const body = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, body, url };
}

// Helper: HEAD request to check a resource exists
async function checkResource(url) {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return { status: res.status, ok: res.ok, url: res.url };
}

// ============================================
// 1. ALL PAGES LOAD SUCCESSFULLY
// ============================================

const PAGES = [
    { path: '/', name: 'Homepage' },
    { path: '/feedback.html', name: 'Feedback' },
    { path: '/image-converter/', name: 'Image Editor' },
    { path: '/video-converter/', name: 'Video Converter' },
    { path: '/color-converter/', name: 'Colour Picker' },
    { path: '/youtube-downloader/', name: 'YouTube Downloader' },
    { path: '/instagram-downloader/', name: 'Instagram Downloader' },
    { path: '/qr-generator/', name: 'QR Code Generator' },
    { path: '/audio-converter/', name: 'Audio Converter' },
    { path: '/convert/', name: 'File Converter' },
    { path: '/favicon-generator/', name: 'Favicon Generator' },
    { path: '/pdf-tools/', name: 'PDF Tools' },
    { path: '/photo-privacy/', name: 'Photo Privacy' },
];

describe('All pages load with HTTP 200', () => {
    const pageResults = {};

    beforeAll(async () => {
        // Fetch all pages in parallel
        const results = await Promise.all(
            PAGES.map(async (p) => {
                const result = await fetchPage(p.path);
                pageResults[p.path] = result;
                return { ...p, ...result };
            })
        );
        // Store for later use
        pageResults._all = results;
    });

    PAGES.forEach((p) => {
        test(`${p.name} (${p.path}) returns 200`, () => {
            expect(pageResults[p.path].status).toBe(200);
        });

        test(`${p.name} has text/html content type`, () => {
            expect(pageResults[p.path].headers['content-type']).toContain('text/html');
        });
    });
});

// ============================================
// 2. HOMEPAGE — User can see and access all tools
// ============================================

describe('Homepage — all tools accessible', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/');
    });

    test('has hero section with title', () => {
        expect(page.body).toContain('The tools you need');
        expect(page.body).toContain('all in one place');
    });

    test('has search input', () => {
        expect(page.body).toContain('id="searchInput"');
        expect(page.body).toContain('Search tools');
    });

    // Retired from the hosted site; the page stays at its URL to say why.
    test('no longer links the YouTube downloader', () => {
        expect(page.body).not.toContain('href="youtube-downloader/index.html"');
    });

    test('has link to Instagram Downloader', () => {
        expect(page.body).toContain('href="instagram-downloader/index.html"');
        expect(page.body).toContain('Instagram Downloader');
    });

    test('has link to Image Editor', () => {
        expect(page.body).toContain('href="image-converter/index.html"');
        expect(page.body).toContain('Image Editor');
    });

    test('has link to Video Converter', () => {
        expect(page.body).toContain('href="video-converter/index.html"');
        expect(page.body).toContain('Video Converter');
    });

    test('has link to Colour Picker', () => {
        expect(page.body).toContain('href="color-converter/index.html"');
        expect(page.body).toContain('Colour Picker');
    });

    test('has link to QR Code Generator', () => {
        expect(page.body).toContain('href="qr-generator/index.html"');
        expect(page.body).toContain('QR Code Generator');
    });

    test('has link to Audio Converter', () => {
        expect(page.body).toContain('href="audio-converter/index.html"');
        expect(page.body).toContain('Audio Converter');
    });

    test('has navigation with Tools, Feedback, GitHub links', () => {
        expect(page.body).toContain('class="nav-link');
        expect(page.body).toContain('Feedback');
        expect(page.body).toContain('GitHub');
    });

    test('has footer', () => {
        expect(page.body).toContain('class="footer"');
        expect(page.body).toContain('Useful Tool Hub');
    });

    test('loads main stylesheet', () => {
        expect(page.body).toContain('href="styles.css"');
    });

    test('loads main script', () => {
        expect(page.body).toContain('src="script.js"');
    });
});

// ============================================
// 3. STYLESHEETS & SCRIPTS RESOLVE ON CDN
// ============================================

describe('Static assets are accessible on deployed site', () => {
    test('styles.css loads', async () => {
        const res = await checkResource(`${SITE}/styles.css`);
        expect(res.ok).toBe(true);
    });

    // Every file a page loads: its <script src> tags, then everything those
    // import, followed through the whole module graph of the local checkout.
    // A module page dies on the first failed import, and the hand-kept lists
    // this replaces had drifted: the convert, favicon and PDF tools' scripts,
    // pdf-lib, zip.js and the shared download and result modules were never
    // checked at all.
    test.each(servedFiles())('%s is served', async (file) => {
        const res = await checkResource(`${SITE}/${file}`);
        expect(res.ok).toBe(true);
    });
});

// ============================================
// 4. EXTERNAL DEPENDENCIES LOAD
// ============================================

describe('External CDN dependencies are accessible', () => {
    test('Google Fonts CSS loads', async () => {
        const res = await checkResource('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        expect(res.ok).toBe(true);
    });

    test('FFmpeg main script loads from unpkg', async () => {
        const res = await checkResource('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
        expect(res.ok).toBe(true);
    });

    test('FFmpeg util script loads from unpkg', async () => {
        const res = await checkResource('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js');
        expect(res.ok).toBe(true);
    });

    // Built from the shared constants rather than hardcoded, so a version bump
    // in one place cannot leave this file checking a URL the app never loads.
    test('FFmpeg core JS loads from unpkg', async () => {
        const res = await checkResource(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`);
        expect(res.ok).toBe(true);
    });

    test('FFmpeg core WASM loads from unpkg', async () => {
        const res = await checkResource(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`);
        expect(res.ok).toBe(true);
    });

    // This used to HEAD a hardcoded '814.ffmpeg.js'. That name is a webpack
    // chunk id: it 404s on a version bump, which broke production once
    // (085863b), and pinning it here meant the test broke with it. Discover the
    // name the same way the app does, then check that the discovered file
    // exists. Now a version bump cannot rot either.
    test('the worker chunk is discoverable and loads from unpkg', async () => {
        const chunk = await resolveWorkerChunk();
        expect(chunk).toMatch(/^\d+\.ffmpeg\.js$/);

        const res = await checkResource(`${FFMPEG_UMD_BASE}/${chunk}`);
        expect(res.ok).toBe(true);
    });

    // If discovery silently fell through to the fallback, the test above would
    // still pass today by luck. This asserts the mechanism actually worked.
    test('discovery reads the chunk from the bundle, not the fallback constant', async () => {
        const res = await fetch(`${FFMPEG_UMD_BASE}/ffmpeg.js`);
        expect(res.ok).toBe(true);
        expect(findWorkerChunk(await res.text())).toMatch(/^\d+\.ffmpeg\.js$/);
    });
});

// ============================================
// 5. VIDEO CONVERTER — Security headers & features
// ============================================

describe('Video Converter — security headers and features', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/video-converter/');
    });

    test('has Cross-Origin-Opener-Policy: same-origin header', () => {
        expect(page.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    // credentialless, not require-corp: require-corp would reject the unpkg
    // ffmpeg scripts, which are served without Cross-Origin-Resource-Policy.
    test('has Cross-Origin-Embedder-Policy: credentialless header', () => {
        expect(page.headers['cross-origin-embedder-policy']).toBe('credentialless');
    });

    test('loads FFmpeg scripts with crossorigin attribute', () => {
        expect(page.body).toMatch(/@ffmpeg\/ffmpeg[^<]*crossorigin/);
        expect(page.body).toMatch(/@ffmpeg\/util[^<]*crossorigin/);
    });

    test('has video file dropzone', () => {
        expect(page.body).toContain('id="dropzone"');
        expect(page.body).toContain('Drop a video here');
    });

    test('has file input accepting video types', () => {
        expect(page.body).toContain('id="fileInput"');
        expect(page.body).toContain('accept="video/*');
    });

    test('has browse button', () => {
        expect(page.body).toContain('id="browseBtn"');
        expect(page.body).toContain('browse files');
    });

    test('has convert button', () => {
        expect(page.body).toContain('id="convertBtn"');
        expect(page.body).toContain('Convert');
    });

    test('convert button is NOT disabled in HTML', () => {
        // The convert button should not have a disabled attribute in the static HTML
        const convertBtnMatch = page.body.match(/<button[^>]*id="convertBtn"[^>]*>/);
        expect(convertBtnMatch).not.toBeNull();
        expect(convertBtnMatch[0]).not.toContain('disabled');
    });

    test('has video preview element', () => {
        expect(page.body).toContain('id="videoPreview"');
    });

    test('has trim start and end inputs', () => {
        expect(page.body).toContain('id="trimStart"');
        expect(page.body).toContain('id="trimEnd"');
    });

    test('has output format selector with all formats', () => {
        expect(page.body).toContain('id="outputFormat"');
        expect(page.body).toContain('value="mp4"');
        expect(page.body).toContain('value="webm"');
        expect(page.body).toContain('value="gif"');
        expect(page.body).toContain('value="mp3"');
        expect(page.body).toContain('value="wav"');
    });

    test('has quality selector', () => {
        expect(page.body).toContain('id="qualitySelect"');
    });

    test('has resolution selector', () => {
        expect(page.body).toContain('id="resolutionSelect"');
    });

    test('has FPS selector', () => {
        expect(page.body).toContain('id="fpsSelect"');
    });

    test('has audio/mute toggle', () => {
        expect(page.body).toContain('id="audioSelect"');
    });

    test('has progress bar', () => {
        expect(page.body).toContain('id="progressBar"');
        expect(page.body).toContain('id="progressText"');
    });

    test('has error display', () => {
        expect(page.body).toContain('id="errorMsg"');
        expect(page.body).toContain('id="errorText"');
    });

    test('has download button for results', () => {
        expect(page.body).toContain('id="downloadBtn"');
    });

    test('has COI service worker registration script', () => {
        expect(page.body).toContain('coi-serviceworker.js');
    });

    test('notice uses user-friendly language', () => {
        // Should mention browser requirements in a user-friendly way
        expect(page.body).toContain('browser');
        expect(page.body).toContain('HTTPS');
    });
});

// ============================================
// 6. IMAGE EDITOR — all controls accessible
// ============================================

describe('Image Editor — all controls present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/image-converter/');
    });

    test('page loads successfully', () => {
        expect(page.status).toBe(200);
    });

    // Plural since the editor gained batch editing — it takes several images
    // at once now, and the copy says so.
    test('has file dropzone', () => {
        expect(page.body).toContain('id="dropzone"');
        expect(page.body).toContain('Drop images here');
    });

    test('has file input accepting images', () => {
        expect(page.body).toContain('id="fileInput"');
        expect(page.body).toContain('accept="image/*,.heic,.heif"');
    });

    test('has preview canvas', () => {
        expect(page.body).toContain('id="previewCanvas"');
    });

    test('has crop controls', () => {
        expect(page.body).toContain('id="cropBtn"');
    });

    test('has brightness adjustment', () => {
        expect(page.body).toContain('id="brightnessSlider"');
    });

    test('has contrast adjustment', () => {
        expect(page.body).toContain('id="contrastSlider"');
    });

    test('has saturation adjustment', () => {
        expect(page.body).toContain('id="saturationSlider"');
    });

    test('has resize width and height inputs', () => {
        expect(page.body).toContain('id="resizeWidth"');
        expect(page.body).toContain('id="resizeHeight"');
    });

    test('has aspect ratio lock', () => {
        expect(page.body).toContain('id="aspectLockBtn"');
    });

    test('has rotate buttons', () => {
        expect(page.body).toContain('id="rotateLeftBtn"');
        expect(page.body).toContain('id="rotateRightBtn"');
    });

    test('has flip buttons', () => {
        expect(page.body).toContain('id="flipHBtn"');
        expect(page.body).toContain('id="flipVBtn"');
    });

    test('has format selector', () => {
        expect(page.body).toContain('id="outputFormat"');
    });

    test('has compression preset selector', () => {
        expect(page.body).toContain('id="compressionSelect"');
    });

    test('has quality slider', () => {
        expect(page.body).toContain('id="qualitySlider"');
    });

    test('quality slider default matches compression preset', () => {
        // Default compression is "medium" = 60%
        const qualityMatch = page.body.match(/id="qualitySlider"[^>]*value="(\d+)"/);
        expect(qualityMatch).not.toBeNull();
        expect(parseInt(qualityMatch[1])).toBe(60);
    });

    test('has download button', () => {
        expect(page.body).toContain('id="downloadBtn"');
    });

    test('has reset button', () => {
        expect(page.body).toContain('id="resetBtn"');
    });

    test('has undo button', () => {
        expect(page.body).toContain('id="undoBtn"');
    });

    test('loads image-converter.js script', () => {
        expect(page.body).toContain('src="js/image-converter.js"');
    });
});

// ============================================
// 7. COLOUR PICKER — all inputs and features
// ============================================

describe('Colour Picker — all features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/color-converter/');
    });

    test('page loads successfully', () => {
        expect(page.status).toBe(200);
    });

    test('has native color picker input', () => {
        expect(page.body).toContain('type="color"');
        expect(page.body).toContain('id="colorPicker"');
    });

    test('has HEX input', () => {
        expect(page.body).toContain('id="hexInput"');
    });

    test('has RGB inputs (R, G, B)', () => {
        expect(page.body).toContain('id="rInput"');
        expect(page.body).toContain('id="gInput"');
        expect(page.body).toContain('id="bInput"');
    });

    test('has HSL inputs (H, S, L)', () => {
        expect(page.body).toContain('id="hInput"');
        expect(page.body).toContain('id="sInput"');
        expect(page.body).toContain('id="lInput"');
    });

    test('has RGB text output', () => {
        expect(page.body).toContain('id="rgbText"');
    });

    test('has HSL text output', () => {
        expect(page.body).toContain('id="hslText"');
    });

    test('has CSS output', () => {
        expect(page.body).toContain('id="cssOutput"');
    });

    test('has copy buttons for each format', () => {
        const copyButtons = page.body.match(/class="[^"]*copy-btn[^"]*"/g);
        expect(copyButtons).not.toBeNull();
        expect(copyButtons.length).toBeGreaterThanOrEqual(3);
    });

    test('has color history section', () => {
        expect(page.body).toContain('id="colorHistory"');
    });

    test('has clear history button', () => {
        expect(page.body).toContain('id="clearHistory"');
    });

    test('has image eyedropper / pick from image feature', () => {
        expect(page.body).toContain('id="eyedropperDropzone"');
        expect(page.body).toContain('id="eyedropperCanvas"');
        expect(page.body).toContain('Pick Color from Image');
    });

    test('has color swatch preview', () => {
        expect(page.body).toContain('id="colorSwatch"');
    });

    test('loads color-converter.js script', () => {
        expect(page.body).toContain('src="js/color-converter.js"');
    });
});

// ============================================
// 8. YOUTUBE DOWNLOADER — retired, explains itself
// ============================================

describe('YouTube Downloader — says why it is switched off', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/youtube-downloader/');
    });

    test('page loads successfully', () => {
        expect(page.status).toBe(200);
    });

    test('explains why, and how to run it locally', () => {
        expect(page.body).toContain('id="retiredNotice"');
        expect(page.body).toContain('only works on your own computer');
        expect(page.body).toContain('requirements-local.txt');
    });

    // The module reveals the form only against a local backend.
    test('ships the form hidden', () => {
        expect(page.body).toContain('id="localTool" hidden');
        expect(page.body).toContain('type="module" src="js/youtube-downloader.js"');
    });
});

// ============================================
// 9. INSTAGRAM DOWNLOADER — input and features
// ============================================

describe('Instagram Downloader — features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/instagram-downloader/');
    });

    test('page loads successfully', () => {
        expect(page.status).toBe(200);
    });

    test('has URL input field', () => {
        expect(page.body).toContain('id="instagramUrl"');
        expect(page.body).toContain('placeholder="https://www.instagram.com/p/');
    });

    test('has fetch button', () => {
        expect(page.body).toContain('id="fetchBtn"');
        expect(page.body).toContain('Fetch');
    });

    test('has error display', () => {
        expect(page.body).toContain('id="errorMsg"');
    });

    test('has loading state', () => {
        expect(page.body).toContain('id="loading"');
    });

    test('has media grid for results', () => {
        expect(page.body).toContain('id="imageGrid"');
    });

    test('has select all button', () => {
        expect(page.body).toContain('id="selectAllBtn"');
    });

    test('has download button', () => {
        expect(page.body).toContain('id="downloadBtn"');
    });

    test('has image format selector (JPG/PNG/WebP)', () => {
        expect(page.body).toContain('id="formatSelect"');
        expect(page.body).toContain('value="jpg"');
        expect(page.body).toContain('value="png"');
        expect(page.body).toContain('value="webp"');
    });

    // MOV and AVI were dropped deliberately: they only renamed an MP4 without
    // transcoding, so the extension lied about the container. Original is now
    // the only choice — it saves Instagram's file untouched.
    test('has video format selector offering only the untouched original', () => {
        expect(page.body).toContain('id="videoFormatSelect"');
        expect(page.body).toContain('value="original"');
        expect(page.body).not.toContain('value="mov"');
        expect(page.body).not.toContain('value="avi"');
    });

    test('has troubleshooting link', () => {
        expect(page.body).toContain('troubleshooting.html');
        expect(page.body).toContain('Need help?');
    });

    test('loads instagram-downloader.js as a module', () => {
        expect(page.body).toContain('type="module" src="js/instagram-downloader.js"');
    });

    test('has public posts notice', () => {
        expect(page.body).toContain('public Instagram posts');
    });
});

// ============================================
// 9b. QR CODE GENERATOR — controls and module loading
// ============================================

describe('QR Code Generator — features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/qr-generator/');
    });

    test('has the text input', () => {
        expect(page.body).toContain('id="qrText"');
    });

    test('has the encoding controls', () => {
        expect(page.body).toContain('id="eccSelect"');
        expect(page.body).toContain('id="sizeSelect"');
        expect(page.body).toContain('id="darkColor"');
        expect(page.body).toContain('id="lightColor"');
    });

    test('has the preview canvas', () => {
        expect(page.body).toContain('id="qrCanvas"');
    });

    test('has PNG, SVG and copy export buttons', () => {
        expect(page.body).toContain('id="downloadPngBtn"');
        expect(page.body).toContain('id="downloadSvgBtn"');
        expect(page.body).toContain('id="copySvgBtn"');
    });

    test('loads its script as a module', () => {
        expect(page.body).toContain('type="module"');
        expect(page.body).toContain('src="js/qr-generator.js"');
    });

    // Whether it stays dormant over HTTP needs a browser; verify:chrome loads
    // every page and would see a blank one.
    test('ships the file:// guard', () => {
        expect(page.body).toContain('file-protocol-notice');
        expect(page.body).toContain("location.protocol === 'file:'");
    });

    // Browsers refuse to run a module served with a non-JavaScript MIME type.
    test('is served with a JavaScript content type for the module', async () => {
        const res = await fetch(`${SITE}/qr-generator/js/qr-generator.js`, { method: 'HEAD' });
        expect(res.ok).toBe(true);
        expect(res.headers.get('content-type')).toMatch(/javascript/);
    });

    test('says processing is local', () => {
        expect(page.body).toContain('locally in your browser');
    });
});

// ============================================
// 9c. AUDIO CONVERTER — controls and isolation headers
// ============================================

describe('Audio Converter — features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/audio-converter/');
    });

    // ffmpeg.wasm needs SharedArrayBuffer, which needs cross-origin isolation.
    // Vercel supplies these; GitHub Pages relies on the COI service worker.
    test('is served with COOP and COEP headers', () => {
        expect(page.headers['cross-origin-opener-policy']).toBe('same-origin');
        expect(page.headers['cross-origin-embedder-policy']).toBe('credentialless');
    });

    test('has dropzone accepting audio and video', () => {
        expect(page.body).toContain('id="dropzone"');
        expect(page.body).toMatch(/accept="[^"]*audio\/\*/);
        expect(page.body).toMatch(/accept="[^"]*video\/\*/);
    });

    test('has trim controls', () => {
        expect(page.body).toContain('id="trimStart"');
        expect(page.body).toContain('id="trimEnd"');
    });

    test('offers every supported output format', () => {
        ['mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac'].forEach(fmt => {
            expect(page.body).toContain(`value="${fmt}"`);
        });
    });

    test('has convert button and progress bar', () => {
        expect(page.body).toContain('id="convertBtn"');
        expect(page.body).toContain('id="progressBar"');
    });

    test('loads its script as a module', () => {
        expect(page.body).toContain('src="js/audio-converter.js"');
        expect(page.body).toContain('type="module"');
    });

    // Service worker scope is path-based, so a copy must live in this directory.
    test('its own COI service worker is reachable', async () => {
        const res = await checkResource(`${SITE}/audio-converter/coi-serviceworker.js`);
        expect(res.ok).toBe(true);
    });

    test('says processing is local', () => {
        expect(page.body).toContain('locally in your browser');
    });
});

// ============================================
// 9d. CONVERT HUB, FAVICON GENERATOR, PDF TOOLS
// ============================================
// These three shipped without E2E coverage, so e2e-parity.test.js had nothing
// to guard for them either.

describe('File Converter — features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/convert/');
    });

    test('is served with COOP and COEP headers', () => {
        expect(page.headers['cross-origin-opener-policy']).toBe('same-origin');
        expect(page.headers['cross-origin-embedder-policy']).toBe('credentialless');
    });

    test('has the queue, target picker and options panel', () => {
        expect(page.body).toContain('id="dropzone"');
        expect(page.body).toContain('id="fileList"');
        expect(page.body).toContain('id="targetFormat"');
        expect(page.body).toContain('id="optionsPanel"');
    });

    test('can convert, cancel and download everything', () => {
        expect(page.body).toContain('id="convertBtn"');
        expect(page.body).toContain('id="cancelBtn"');
        expect(page.body).toContain('id="downloadAllBtn"');
    });

    test('loads its script as a module, with the file:// guard', () => {
        expect(page.body).toContain('type="module"');
        expect(page.body).toContain('file-protocol-notice');
    });

    test('its own COI service worker is reachable', async () => {
        const res = await checkResource(`${SITE}/convert/coi-serviceworker.js`);
        expect(res.ok).toBe(true);
    });
});

describe('Favicon Generator — features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/favicon-generator/');
    });

    test('has the source dropzone and previews', () => {
        expect(page.body).toContain('id="dropzone"');
        expect(page.body).toContain('id="previewGrid"');
    });

    test('has the padding, background and manifest settings', () => {
        expect(page.body).toContain('id="padding"');
        expect(page.body).toContain('id="useBackground"');
        expect(page.body).toContain('id="siteName"');
        expect(page.body).toContain('id="themeColor"');
    });

    test('generates a zip and an HTML snippet', () => {
        expect(page.body).toContain('id="generateBtn"');
        expect(page.body).toContain('id="downloadZipBtn"');
        expect(page.body).toContain('id="snippet"');
    });

    test('loads its script as a module, with the file:// guard', () => {
        expect(page.body).toContain('type="module"');
        expect(page.body).toContain('file-protocol-notice');
    });
});

describe('PDF Tools — features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/pdf-tools/');
    });

    test('offers every operation', () => {
        ['merge', 'extract', 'remove', 'split', 'rotate', 'optimise', 'fromImages', 'toImages', 'sign'].forEach((op) => {
            expect(page.body).toContain(`value="${op}"`);
        });
    });

    test('has the page range, run button and results', () => {
        expect(page.body).toContain('id="pageRange"');
        expect(page.body).toContain('id="thumbGrid"');
        expect(page.body).toContain('id="signPad"');
        expect(page.body).toContain('id="runBtn"');
        expect(page.body).toContain('id="resultList"');
    });

    test('loads its script as a module, with the file:// guard', () => {
        expect(page.body).toContain('type="module"');
        expect(page.body).toContain('file-protocol-notice');
    });
});

describe('Photo Privacy — features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/photo-privacy/');
    });

    test('has the dropzone, clean button and results', () => {
        expect(page.body).toContain('id="dropzone"');
        expect(page.body).toContain('id="cleanBtn"');
        expect(page.body).toContain('id="resultList"');
    });

    test('accepts iPhone HEIC', () => {
        expect(page.body).toContain('.heic,.heif');
    });

    test('says photos are never uploaded', () => {
        expect(page.body).toContain('Your photos are never uploaded');
    });

    test('loads its script as a module, with the file:// guard', () => {
        expect(page.body).toContain('type="module" src="js/photo-privacy.js"');
        expect(page.body).toContain('file-protocol-notice');
    });
});

// ============================================
// 10. FEEDBACK PAGE — form accessible
// ============================================

describe('Feedback page — form and features', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/feedback.html');
    });

    test('page loads successfully', () => {
        expect(page.status).toBe(200);
    });

    test('has feedback form', () => {
        expect(page.body).toContain('id="feedbackForm"');
    });

    test('has name input (optional)', () => {
        expect(page.body).toContain('id="name"');
    });

    test('has email input (optional)', () => {
        expect(page.body).toContain('id="email"');
    });

    test('has feedback type selector', () => {
        expect(page.body).toContain('id="type"');
        expect(page.body).toContain('Suggestion');
        expect(page.body).toContain('Bug Report');
        expect(page.body).toContain('Feature Request');
    });

    test('has message textarea (required)', () => {
        expect(page.body).toContain('id="message"');
        expect(page.body).toMatch(/<textarea[^>]*required/);
    });

    test('has submit button', () => {
        expect(page.body).toContain('Submit Feedback');
    });

    test('form has Formspree action', () => {
        expect(page.body).toContain('formspree.io');
    });

    test('has message box for success/error feedback', () => {
        expect(page.body).toContain('id="messageBox"');
    });
});

// ============================================
// 11. NAVIGATION — all pages have working nav
// ============================================

describe('Navigation is consistent across all pages', () => {
    const pageData = {};

    beforeAll(async () => {
        const results = await Promise.all(
            PAGES.map(async (p) => {
                const result = await fetchPage(p.path);
                pageData[p.path] = result;
                return result;
            })
        );
    });

    PAGES.forEach((p) => {
        test(`${p.name} has navigation bar`, () => {
            expect(pageData[p.path].body).toContain('class="nav"');
        });

        test(`${p.name} has brand link back to home`, () => {
            expect(pageData[p.path].body).toContain('Useful Tool Hub');
            // All sub-pages link to ../index.html or index.html
            expect(pageData[p.path].body).toMatch(/href="[^"]*index\.html"/);
        });

        test(`${p.name} has footer`, () => {
            expect(pageData[p.path].body).toContain('class="footer"');
        });

        test(`${p.name} has GitHub link`, () => {
            expect(pageData[p.path].body).toContain('github.com/martinw500/UTH');
        });
    });
});

// ============================================
// 12. API ENDPOINTS — backend accessible
// ============================================

describe('API endpoints are reachable', () => {
    // These used to wrap the assertion in try/catch, so a 404 threw, was
    // caught, and passed. Node's fetch has no CORS to excuse a failure.
    // No trailing slash: that is the path the page calls. The JSON body
    // proves the function ran, not just routed.
    test('instagram API endpoint answers', async () => {
        const res = await fetch(`${SITE}/api/instagram`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'URL parameter required' });
    });

    // .vercelignore keeps it off Vercel; the code stays for local use.
    test('the YouTube API is not deployed', async () => {
        const res = await fetch(`${SITE}/api/youtube`);
        expect(res.status).toBe(404);
    });
});

// ============================================
// 13. CONFIG — Production URL is correct
// ============================================

describe('Config file has correct production URL', () => {
    let configContent;

    beforeAll(async () => {
        const res = await fetch(`${SITE}/js/shared/config.js`);
        configContent = await res.text();
    });

    test('contains the production backend URL', () => {
        expect(configContent).toContain('useful-tool-hub.vercel.app');
    });

    test('defines API_CONFIG or BACKEND_URL', () => {
        expect(configContent).toMatch(/API_CONFIG|BACKEND_URL/);
    });
});

// ============================================
// 14. NO BROKEN INTERNAL LINKS
// ============================================

describe('Internal navigation links resolve', () => {
    test('homepage tool card links all resolve to 200', async () => {
        const page = await fetchPage('/');
        // Extract tool card hrefs
        const links = [...page.body.matchAll(/href="([^"]+\/index\.html)"/g)].map(m => m[1]);
        expect(links.length).toBeGreaterThanOrEqual(7);

        const results = await Promise.all(
            links.map(async (link) => {
                const res = await checkResource(`${SITE}/${link}`);
                return { link, ok: res.ok, status: res.status };
            })
        );

        results.forEach(r => {
            expect(r.ok).toBe(true);
        });
    });

    test('feedback link resolves', async () => {
        const res = await checkResource(`${SITE}/feedback.html`);
        expect(res.ok).toBe(true);
    });

    test('troubleshooting page resolves', async () => {
        const res = await checkResource(`${SITE}/instagram-downloader/troubleshooting.html`);
        expect(res.ok).toBe(true);
    });
});

// ============================================
// 15. SECURITY & BEST PRACTICES
// ============================================

describe('Security and best practices', () => {
    test('site is served over HTTPS', () => {
        expect(SITE).toMatch(/^https:\/\//);
    });

    // COEP on the homepage would block its cross-origin resources.
    test('the homepage is not served with COEP', async () => {
        const homepage = await fetchPage('/');
        expect(homepage.headers['cross-origin-embedder-policy']).toBeUndefined();
    });

    test('all pages have proper charset', async () => {
        const results = await Promise.all(
            PAGES.map(p => fetchPage(p.path))
        );
        results.forEach(r => {
            expect(r.body).toMatch(/charset="?UTF-8"?/i);
        });
    });

    test('all pages have viewport meta tag', async () => {
        const results = await Promise.all(
            PAGES.map(p => fetchPage(p.path))
        );
        results.forEach(r => {
            expect(r.body).toContain('viewport');
        });
    });
});
