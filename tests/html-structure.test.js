// ============================================
// HTML Structure & Integration Tests
// Validates all pages have proper structure, required elements,
// and no broken internal links
// ============================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readHtml(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

function fileExists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

// ============================================
// HTML PAGES TO TEST
// ============================================

const PAGES = [
    'index.html',
    'feedback.html',
    'image-converter/index.html',
    'video-converter/index.html',
    'color-converter/index.html',
    'youtube-downloader/index.html',
    'instagram-downloader/index.html',
    'qr-generator/index.html',
    'audio-converter/index.html',
];

// ============================================
// TESTS
// ============================================

describe('All pages exist', () => {
    PAGES.forEach(page => {
        test(`${page} exists`, () => {
            expect(fileExists(page)).toBe(true);
        });
    });
});

describe('All pages have valid HTML structure', () => {
    PAGES.forEach(page => {
        describe(page, () => {
            let html;

            beforeAll(() => {
                html = readHtml(page);
            });

            test('has DOCTYPE', () => {
                expect(html).toMatch(/<!DOCTYPE html>/i);
            });

            test('has html lang attribute', () => {
                expect(html).toMatch(/<html\s[^>]*lang="en"/);
            });

            test('has charset meta tag', () => {
                expect(html).toMatch(/<meta\s[^>]*charset="UTF-8"/i);
            });

            test('has viewport meta tag', () => {
                expect(html).toMatch(/<meta\s[^>]*name="viewport"/i);
            });

            test('has a title', () => {
                expect(html).toMatch(/<title>[^<]+<\/title>/);
            });

            test('has navigation', () => {
                expect(html).toContain('<nav');
            });

            test('has footer', () => {
                expect(html).toContain('<footer');
            });

            test('has closing body and html tags', () => {
                expect(html).toMatch(/<\/body>\s*<\/html>/);
            });
        });
    });
});

describe('Homepage structure', () => {
    let html;

    beforeAll(() => {
        html = readHtml('index.html');
    });

    test('has search input', () => {
        expect(html).toContain('id="searchInput"');
    });

    test('has tools grid', () => {
        expect(html).toContain('id="toolsGrid"');
    });

    test('has tool cards', () => {
        expect(html).toContain('class="tool-card"');
    });

    test('has links to all tool pages', () => {
        expect(html).toContain('href="youtube-downloader/index.html"');
        expect(html).toContain('href="instagram-downloader/index.html"');
        expect(html).toContain('href="image-converter/index.html"');
        expect(html).toContain('href="video-converter/index.html"');
        expect(html).toContain('href="color-converter/index.html"');
        expect(html).toContain('href="qr-generator/index.html"');
        expect(html).toContain('href="audio-converter/index.html"');
    });

    // Both counters are hardcoded in the markup and script.js never recomputes
    // #toolCount, so adding a tool and forgetting one of them ships a wrong
    // number to every visitor. Fail here instead.
    test('the hardcoded counters match the number of tool cards', () => {
        const cards = (html.match(/class="tool-card"/g) || []).length;
        expect(cards).toBeGreaterThan(0);
        expect(html).toMatch(new RegExp(`id="toolCount">${cards}<`));
        expect(html).toMatch(new RegExp(`id="visibleCount">${cards} tools<`));
    });

    test('loads main script', () => {
        expect(html).toContain('<script src="script.js"');
    });

    test('loads stylesheet', () => {
        expect(html).toContain('href="styles.css"');
    });
});

describe('Image Editor page structure', () => {
    let html;

    beforeAll(() => {
        html = readHtml('image-converter/index.html');
    });

    test('has dropzone', () => {
        expect(html).toContain('id="dropzone"');
    });

    test('has file input', () => {
        expect(html).toContain('id="fileInput"');
    });

    test('has preview canvas', () => {
        expect(html).toContain('id="previewCanvas"');
    });

    test('has crop controls', () => {
        expect(html).toContain('id="cropOverlay"');
        expect(html).toContain('id="applyCropBtn"');
        expect(html).toContain('id="cancelCropBtn"');
    });

    test('has adjustment sliders', () => {
        expect(html).toContain('id="brightnessSlider"');
        expect(html).toContain('id="contrastSlider"');
        expect(html).toContain('id="saturationSlider"');
        expect(html).toContain('id="blurSlider"');
    });

    test('has resize controls', () => {
        expect(html).toContain('id="resizeWidth"');
        expect(html).toContain('id="resizeHeight"');
        expect(html).toContain('id="applyResizeBtn"');
    });

    test('has export controls', () => {
        expect(html).toContain('id="outputFormat"');
        expect(html).toContain('id="qualitySlider"');
        expect(html).toContain('id="exportBtn"');
    });

    test('has toolbar buttons', () => {
        expect(html).toContain('id="rotateLeftBtn"');
        expect(html).toContain('id="rotateRightBtn"');
        expect(html).toContain('id="flipHBtn"');
        expect(html).toContain('id="flipVBtn"');
        expect(html).toContain('id="resetBtn"');
        expect(html).toContain('id="undoBtn"');
    });

    test('has download button', () => {
        expect(html).toContain('id="downloadBtn"');
    });

    test('quality slider and preset values are in sync', () => {
        // The default slider value should match the default compression preset (medium = 60%)
        const sliderMatch = html.match(/id="qualitySlider"[^>]*value="(\d+)"/);
        const labelMatch = html.match(/id="qualityValue">(\d+)</);
        expect(sliderMatch).not.toBeNull();
        expect(labelMatch).not.toBeNull();
        expect(sliderMatch[1]).toBe(labelMatch[1]);
    });
});

describe('Video Converter page structure', () => {
    let html;

    beforeAll(() => {
        html = readHtml('video-converter/index.html');
    });

    test('has dropzone', () => {
        expect(html).toContain('id="dropzone"');
    });

    test('has video preview', () => {
        expect(html).toContain('id="videoPreview"');
    });

    test('has trim controls', () => {
        expect(html).toContain('id="trimStart"');
        expect(html).toContain('id="trimEnd"');
    });

    test('has format select', () => {
        expect(html).toContain('id="outputFormat"');
    });

    test('has convert button', () => {
        expect(html).toContain('id="convertBtn"');
    });

    test('has progress bar', () => {
        expect(html).toContain('id="progressBar"');
    });

    test('has error display', () => {
        expect(html).toContain('id="errorMsg"');
    });

    test('loads FFmpeg libraries', () => {
        expect(html).toContain('@ffmpeg/ffmpeg');
        expect(html).toContain('@ffmpeg/util');
    });

    test('loads FFmpeg scripts with crossorigin', () => {
        expect(html).toMatch(/ffmpeg\.js[^>]*crossorigin/);
        expect(html).toMatch(/index\.js[^>]*crossorigin/);
    });

    test('has COOP/COEP service worker registration', () => {
        expect(html).toContain('coi-serviceworker');
    });

    test('COI service worker file exists', () => {
        expect(fileExists('video-converter/coi-serviceworker.js')).toBe(true);
    });
});

describe('Color Converter page structure', () => {
    let html;

    beforeAll(() => {
        html = readHtml('color-converter/index.html');
    });

    test('has color picker input', () => {
        expect(html).toContain('id="colorPicker"');
    });

    test('has hex input', () => {
        expect(html).toContain('id="hexInput"');
    });

    test('has RGB inputs', () => {
        expect(html).toContain('id="rInput"');
        expect(html).toContain('id="gInput"');
        expect(html).toContain('id="bInput"');
    });

    test('has HSL inputs', () => {
        expect(html).toContain('id="hInput"');
        expect(html).toContain('id="sInput"');
        expect(html).toContain('id="lInput"');
    });

    test('has copy buttons', () => {
        expect(html).toContain('copy-btn');
    });

    test('has color history', () => {
        expect(html).toContain('id="colorHistory"');
    });
});

describe('QR Generator page structure', () => {
    let html;

    beforeAll(() => {
        html = readHtml('qr-generator/index.html');
    });

    test('has the text input and its readouts', () => {
        expect(html).toContain('id="qrText"');
        expect(html).toContain('id="charCount"');
        expect(html).toContain('id="qrVersion"');
    });

    test('has the encoding controls', () => {
        expect(html).toContain('id="eccSelect"');
        expect(html).toContain('id="sizeSelect"');
        expect(html).toContain('id="darkColor"');
        expect(html).toContain('id="lightColor"');
    });

    test('offers all four error-correction levels', () => {
        ['L', 'M', 'Q', 'H'].forEach(level => {
            expect(html).toContain(`value="${level}"`);
        });
    });

    test('has the preview canvas', () => {
        expect(html).toContain('id="qrCanvas"');
    });

    test('has export buttons for PNG and SVG', () => {
        expect(html).toContain('id="downloadPngBtn"');
        expect(html).toContain('id="downloadSvgBtn"');
        expect(html).toContain('id="copySvgBtn"');
    });

    test('has a notice host for errors and contrast warnings', () => {
        expect(html).toContain('id="noticeHost"');
        expect(html).toContain('class="notice"');
    });

    test('loads its script as a module', () => {
        expect(html).toContain('<script type="module" src="js/qr-generator.js"></script>');
    });
});

describe('Audio Converter page structure', () => {
    let html;

    beforeAll(() => {
        html = readHtml('audio-converter/index.html');
    });

    test('has dropzone and file input', () => {
        expect(html).toContain('id="dropzone"');
        expect(html).toContain('id="fileInput"');
    });

    // Extracting audio from a video is the main use case, so the picker must
    // not filter video files out.
    test('accepts video files as well as audio', () => {
        expect(html).toMatch(/accept="[^"]*audio\/\*/);
        expect(html).toMatch(/accept="[^"]*video\/\*/);
    });

    test('has trim controls', () => {
        expect(html).toContain('id="trimStart"');
        expect(html).toContain('id="trimEnd"');
        expect(html).toContain('id="trimDuration"');
    });

    test('has the output settings', () => {
        expect(html).toContain('id="outputFormat"');
        expect(html).toContain('id="bitrateSelect"');
        expect(html).toContain('id="channelSelect"');
        expect(html).toContain('id="sampleRateSelect"');
        expect(html).toContain('id="normaliseCheck"');
    });

    test('offers every supported format', () => {
        ['mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac'].forEach(fmt => {
            expect(html).toContain(`value="${fmt}"`);
        });
    });

    test('has convert, progress and results', () => {
        expect(html).toContain('id="convertBtn"');
        expect(html).toContain('id="progressBar"');
        expect(html).toContain('id="downloadBtn"');
        expect(html).toContain('id="errorMsg"');
    });

    test('loads the FFmpeg libraries as classic scripts before the module', () => {
        expect(html).toContain('@ffmpeg/ffmpeg');
        expect(html).toContain('@ffmpeg/util');
        const ffmpegAt = html.indexOf('@ffmpeg/ffmpeg');
        const moduleAt = html.indexOf('type="module"');
        expect(ffmpegAt).toBeLessThan(moduleAt);
    });

    // Service worker scope is path-based, so this directory needs its own copy.
    test('registers a COI service worker that exists here', () => {
        expect(html).toContain('coi-serviceworker');
        expect(fileExists('audio-converter/coi-serviceworker.js')).toBe(true);
    });

    test('loads its script as a module', () => {
        expect(html).toContain('<script type="module" src="js/audio-converter.js"></script>');
    });
});

describe('Vendored libraries', () => {
    // Vendoring an MIT library carries an attribution obligation. A future
    // cleanup that deletes the licence file should fail the build.
    test('the QR library ships its licence and copyright holder', () => {
        const licence = fs.readFileSync(
            path.join(ROOT, 'js/vendor/qrcode-generator.LICENSE.txt'), 'utf-8');
        expect(licence).toContain('MIT');
        expect(licence).toContain('Kazuhiko Arase');
    });

    test('provenance is recorded so the file can be re-vendored', () => {
        const readme = fs.readFileSync(path.join(ROOT, 'js/vendor/README.md'), 'utf-8');
        expect(readme).toContain('kazuhikoarase/qrcode-generator');
        expect(readme).toMatch(/Version:\*\*\s*\d+\.\d+\.\d+/);
    });
});

describe('Required static assets exist', () => {
    const requiredFiles = [
        'styles.css',
        'script.js',
        'js/config.js',
        'image-converter/js/image-converter.js',
        'video-converter/js/video-converter.js',
        'color-converter/js/color-converter.js',
        'youtube-downloader/js/youtube-downloader.js',
        'instagram-downloader/js/instagram-downloader.js',
        'qr-generator/js/qr-generator.js',
        'video-converter/js/video-args.js',
        'audio-converter/js/audio-converter.js',
        'audio-converter/js/audio-args.js',
        'audio-converter/coi-serviceworker.js',
        'js/shared/qr.js',
        'js/shared/ffmpeg.js',
        'js/vendor/qrcode-generator.js',
        'js/vendor/qrcode-generator-utf8.js',
        'js/vendor/qrcode-generator.LICENSE.txt',
        'vercel.json',
    ];

    requiredFiles.forEach(file => {
        test(`${file} exists`, () => {
            expect(fileExists(file)).toBe(true);
        });
    });
});

describe('Internal links are valid', () => {
    test('homepage links point to existing pages', () => {
        const html = readHtml('index.html');
        const linkPattern = /href="([^"#]+\.html)"/g;
        let match;
        while ((match = linkPattern.exec(html)) !== null) {
            const href = match[1];
            // Skip external links
            if (href.startsWith('http')) continue;
            expect(fileExists(href)).toBe(true);
        }
    });

    PAGES.filter(p => p !== 'index.html').forEach(page => {
        test(`${page} nav links are valid`, () => {
            const html = readHtml(page);
            // Check ../index.html links (relative from subdir)
            if (html.includes('href="../index.html"')) {
                expect(fileExists('index.html')).toBe(true);
            }
            if (html.includes('href="../feedback.html"')) {
                expect(fileExists('feedback.html')).toBe(true);
            }
        });
    });
});

describe('Vercel configuration', () => {
    let config;

    beforeAll(() => {
        config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8'));
    });

    test('has valid JSON structure', () => {
        expect(config).toBeDefined();
        expect(config.version).toBe(2);
    });

    test('has API CORS headers', () => {
        const apiHeaders = config.headers.find(h => h.source.includes('/api/'));
        expect(apiHeaders).toBeDefined();
        const headerKeys = apiHeaders.headers.map(h => h.key);
        expect(headerKeys).toContain('Access-Control-Allow-Origin');
        expect(headerKeys).toContain('Access-Control-Allow-Methods');
    });

    // Both ffmpeg.wasm tools need cross-origin isolation for SharedArrayBuffer.
    test.each(['video-converter', 'audio-converter'])('%s has COOP/COEP headers', (tool) => {
        const entry = config.headers.find(h => h.source.includes(tool));
        expect(entry).toBeDefined();
        const headerKeys = entry.headers.map(h => h.key);
        expect(headerKeys).toContain('Cross-Origin-Opener-Policy');
        expect(headerKeys).toContain('Cross-Origin-Embedder-Policy');
    });
});

describe('Config file', () => {
    let configContent;

    beforeAll(() => {
        configContent = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf-8');
    });

    test('defines API_CONFIG', () => {
        expect(configContent).toContain('API_CONFIG');
    });

    test('has BACKEND_URL', () => {
        expect(configContent).toContain('BACKEND_URL');
    });

    test('has production URL', () => {
        expect(configContent).toContain('useful-tool-hub.vercel.app');
    });

    test('has development fallback', () => {
        expect(configContent).toContain('localhost');
    });
});
