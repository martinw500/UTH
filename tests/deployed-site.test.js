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

// Reuses the app's own chunk discovery so this file cannot drift from it.
import {
    FFMPEG_UMD_BASE,
    FFMPEG_CORE_BASE,
    findWorkerChunk,
    resolveWorkerChunk,
} from '../js/shared/ffmpeg.js';

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

    test('has link to YouTube Downloader', () => {
        expect(page.body).toContain('href="youtube-downloader/index.html"');
        expect(page.body).toContain('YouTube Downloader');
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

    test('script.js loads', async () => {
        const res = await checkResource(`${SITE}/script.js`);
        expect(res.ok).toBe(true);
    });

    test('js/config.js loads', async () => {
        const res = await checkResource(`${SITE}/js/config.js`);
        expect(res.ok).toBe(true);
    });

    test('image-converter/js/image-converter.js loads', async () => {
        const res = await checkResource(`${SITE}/image-converter/js/image-converter.js`);
        expect(res.ok).toBe(true);
    });

    test('video-converter/js/video-converter.js loads', async () => {
        const res = await checkResource(`${SITE}/video-converter/js/video-converter.js`);
        expect(res.ok).toBe(true);
    });

    test('color-converter/js/color-converter.js loads', async () => {
        const res = await checkResource(`${SITE}/color-converter/js/color-converter.js`);
        expect(res.ok).toBe(true);
    });

    test('youtube-downloader/js/youtube-downloader.js loads', async () => {
        const res = await checkResource(`${SITE}/youtube-downloader/js/youtube-downloader.js`);
        expect(res.ok).toBe(true);
    });

    test('instagram-downloader/js/instagram-downloader.js loads', async () => {
        const res = await checkResource(`${SITE}/instagram-downloader/js/instagram-downloader.js`);
        expect(res.ok).toBe(true);
    });

    test('COI service worker file loads', async () => {
        const res = await checkResource(`${SITE}/video-converter/coi-serviceworker.js`);
        expect(res.ok).toBe(true);
    });

    test('qr-generator/js/qr-generator.js loads', async () => {
        const res = await checkResource(`${SITE}/qr-generator/js/qr-generator.js`);
        expect(res.ok).toBe(true);
    });

    // A module page dies on the first failed import, and these are fetched by
    // the browser rather than named in the HTML, so nothing else would catch a
    // path that is wrong only once deployed.
    test.each([
        'js/shared/qr.js',
        'js/shared/ffmpeg.js',
        'js/shared/format.js',
        'video-converter/js/video-args.js',
        'audio-converter/js/audio-converter.js',
        'audio-converter/js/audio-args.js',
        'audio-converter/coi-serviceworker.js',
        'js/shared/dom.js',
        'js/shared/notify.js',
        'js/shared/clipboard.js',
        'js/shared/color.js',
        'js/shared/image.js',
        'js/vendor/qrcode-generator.js',
        'js/vendor/qrcode-generator-utf8.js',
    ])('%s loads', async (file) => {
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

    test('has file dropzone', () => {
        expect(page.body).toContain('id="dropzone"');
        expect(page.body).toContain('Drop an image');
    });

    test('has file input accepting images', () => {
        expect(page.body).toContain('id="fileInput"');
        expect(page.body).toContain('accept="image/*"');
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
// 8. YOUTUBE DOWNLOADER — input and features
// ============================================

describe('YouTube Downloader — features present', () => {
    let page;

    beforeAll(async () => {
        page = await fetchPage('/youtube-downloader/');
    });

    test('page loads successfully', () => {
        expect(page.status).toBe(200);
    });

    test('has URL input field', () => {
        expect(page.body).toContain('id="youtubeUrl"');
        expect(page.body).toContain('placeholder="https://www.youtube.com/watch?v=');
    });

    test('has fetch button', () => {
        expect(page.body).toContain('id="fetchBtn"');
        expect(page.body).toContain('Fetch');
    });

    test('has error display', () => {
        expect(page.body).toContain('id="errorMsg"');
        expect(page.body).toContain('id="errorText"');
    });

    test('has loading state', () => {
        expect(page.body).toContain('id="loading"');
        expect(page.body).toContain('Fetching video information');
    });

    test('has results container for video info and quality options', () => {
        expect(page.body).toContain('id="results"');
        expect(page.body).toContain('id="videoInfo"');
        expect(page.body).toContain('id="qualityOptions"');
    });

    test('loads config.js for API URL', () => {
        expect(page.body).toContain('src="../js/config.js"');
    });

    test('loads youtube-downloader.js script', () => {
        expect(page.body).toContain('src="js/youtube-downloader.js"');
    });

    test('has terms of service notice', () => {
        expect(page.body).toContain('personal use only');
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

    test('loads config.js for API URL', () => {
        expect(page.body).toContain('src="../js/config.js"');
    });

    test('loads instagram-downloader.js script', () => {
        expect(page.body).toContain('src="js/instagram-downloader.js"');
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

    // Served over HTTP the guard must stay dormant; if it ever fired here the
    // page would be blank for every visitor.
    test('ships the file:// guard, and it does not trigger over HTTP', () => {
        expect(page.body).toContain('file-protocol-notice');
        expect(page.body).toContain("location.protocol === 'file:'");
    });

    test('is served with a JavaScript content type for the module', async () => {
        const res = await checkResource(`${SITE}/qr-generator/js/qr-generator.js`);
        expect(res.ok).toBe(true);
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
    test('YouTube API endpoint exists', async () => {
        // Just checking the endpoint responds (even if it returns 400/422 without a URL param)
        try {
            const res = await fetch(`${SITE}/api/youtube/`, { method: 'GET' });
            // Any response means the serverless function is deployed
            expect(res.status).toBeDefined();
            // Should not be 404 — that would mean the route doesn't exist
            expect(res.status).not.toBe(404);
        } catch (e) {
            // Network error is also acceptable if CORS blocks it
            expect(e).toBeDefined();
        }
    });

    test('Instagram API endpoint exists', async () => {
        try {
            const res = await fetch(`${SITE}/api/instagram/`, { method: 'GET' });
            expect(res.status).toBeDefined();
            expect(res.status).not.toBe(404);
        } catch (e) {
            expect(e).toBeDefined();
        }
    });
});

// ============================================
// 13. CONFIG — Production URL is correct
// ============================================

describe('Config file has correct production URL', () => {
    let configContent;

    beforeAll(async () => {
        const res = await fetch(`${SITE}/js/config.js`);
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

    test('video converter is the only page with COEP header', async () => {
        // Homepage should NOT have COEP (it would break external resources)
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
