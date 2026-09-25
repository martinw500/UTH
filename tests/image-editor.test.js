// ============================================
// Image Editor — Unit Tests
// Tests for helper functions and logic
// ============================================

// Imports the real shared modules. These assertions are unchanged from when
// they tested copy-pasted clones, so a green run proves the extraction
// preserved behaviour.
import { formatBytes as formatSize, stripExtension } from '../js/shared/format.js';
import { EXT_BY_MIME as FORMAT_EXT } from '../js/shared/image.js';
import { COMPRESSION_PRESETS as COMPRESSION_QUALITY } from '../js/shared/compression.js';
import { buildFilterString as buildFilter, IDENTITY_ADJUST } from '../js/shared/pipeline.js';
import { heightForWidth, widthForHeight } from '../js/shared/geometry.js';
import { previewScaleFor } from '../image-converter/js/render.js';

// The clone this file used to carry emitted decimal multipliers --
// `brightness(1.5)` -- while the shipped editor emitted percentages,
// `brightness(150%)`. Equivalent in CSS, but it meant these assertions had
// never once described the code that actually ran. The percentage form is kept
// because that is what ships; the expectations below are corrected to match.
const buildFilterString = (brightness, contrast, saturation, blur) =>
    buildFilter({ ...IDENTITY_ADJUST, brightness, contrast, saturation, blur });

// ============================================
// TESTS
// ============================================

describe('Image Editor — formatSize', () => {
    test('formats bytes', () => {
        expect(formatSize(0)).toBe('0 B');
        expect(formatSize(500)).toBe('500 B');
        expect(formatSize(1023)).toBe('1023 B');
    });

    test('formats kilobytes', () => {
        expect(formatSize(1024)).toBe('1.0 KB');
        expect(formatSize(1536)).toBe('1.5 KB');
        expect(formatSize(10240)).toBe('10.0 KB');
        expect(formatSize(512 * 1024)).toBe('512.0 KB');
    });

    test('formats megabytes', () => {
        expect(formatSize(1024 * 1024)).toBe('1.00 MB');
        expect(formatSize(5.5 * 1024 * 1024)).toBe('5.50 MB');
        expect(formatSize(100 * 1024 * 1024)).toBe('100.00 MB');
    });
});

describe('Image Editor — stripExtension', () => {
    test('strips common image extensions', () => {
        expect(stripExtension('photo.jpg')).toBe('photo');
        expect(stripExtension('image.png')).toBe('image');
        expect(stripExtension('pic.webp')).toBe('pic');
    });

    test('strips only the last extension', () => {
        expect(stripExtension('file.backup.jpg')).toBe('file.backup');
    });

    test('handles files with no extension', () => {
        expect(stripExtension('noext')).toBe('noext');
    });

    test('handles dotfiles', () => {
        expect(stripExtension('.gitignore')).toBe('');
    });
});

describe('Image Editor — buildFilterString', () => {
    test('returns "none" when all adjustments are zero', () => {
        expect(buildFilterString(0, 0, 0, 0)).toBe('none');
    });

    test('builds brightness filter', () => {
        expect(buildFilterString(50, 0, 0, 0)).toBe('brightness(150%)');
        expect(buildFilterString(-50, 0, 0, 0)).toBe('brightness(50%)');
    });

    test('builds contrast filter', () => {
        expect(buildFilterString(0, 100, 0, 0)).toBe('contrast(200%)');
    });

    test('builds saturation filter', () => {
        expect(buildFilterString(0, 0, -50, 0)).toBe('saturate(50%)');
    });

    test('builds blur filter', () => {
        expect(buildFilterString(0, 0, 0, 5)).toBe('blur(5px)');
    });

    test('builds combined filters', () => {
        const result = buildFilterString(20, 30, -10, 2);
        expect(result).toContain('brightness(120%)');
        expect(result).toContain('contrast(130%)');
        expect(result).toContain('saturate(90%)');
        expect(result).toContain('blur(2px)');
    });

    test('does not include blur when zero', () => {
        expect(buildFilterString(50, 0, 0, 0)).not.toContain('blur');
    });
});

describe('Image Editor — FORMAT_EXT mapping', () => {
    test('maps MIME types to extensions', () => {
        expect(FORMAT_EXT['image/png']).toBe('png');
        expect(FORMAT_EXT['image/jpeg']).toBe('jpg');
        expect(FORMAT_EXT['image/webp']).toBe('webp');
    });

    test('returns undefined for unknown types', () => {
        expect(FORMAT_EXT['image/bmp']).toBeUndefined();
    });
});

describe('Image Editor — COMPRESSION_QUALITY presets', () => {
    test('has correct quality values', () => {
        expect(COMPRESSION_QUALITY.none).toBe(1.0);
        expect(COMPRESSION_QUALITY.light).toBe(0.8);
        expect(COMPRESSION_QUALITY.medium).toBe(0.6);
        expect(COMPRESSION_QUALITY.heavy).toBe(0.4);
        expect(COMPRESSION_QUALITY.extreme).toBe(0.2);
    });

    test('quality values are between 0 and 1', () => {
        Object.values(COMPRESSION_QUALITY).forEach(val => {
            expect(val).toBeGreaterThan(0);
            expect(val).toBeLessThanOrEqual(1);
        });
    });

    test('quality values decrease with more compression', () => {
        expect(COMPRESSION_QUALITY.none).toBeGreaterThan(COMPRESSION_QUALITY.light);
        expect(COMPRESSION_QUALITY.light).toBeGreaterThan(COMPRESSION_QUALITY.medium);
        expect(COMPRESSION_QUALITY.medium).toBeGreaterThan(COMPRESSION_QUALITY.heavy);
        expect(COMPRESSION_QUALITY.heavy).toBeGreaterThan(COMPRESSION_QUALITY.extreme);
    });
});

describe('Image Editor — Preview scaling logic', () => {
    // This block used to test a function declared inside this file, so it
    // stayed green whatever happened to the one the page imports.
    test('does not upscale small images', () => {
        expect(previewScaleFor(400, 300, 800)).toBe(1);
    });

    test('scales down wide images', () => {
        expect(previewScaleFor(1600, 300, 800)).toBe(0.5);
    });

    test('scales down tall images', () => {
        expect(previewScaleFor(400, 1000, 800)).toBe(0.5);
    });

    test('scales proportionally for large images', () => {
        // maxW/W = 0.2, maxH/H = 500/3000 = 0.167
        expect(previewScaleFor(4000, 3000, 800)).toBeCloseTo(500 / 3000, 5);
    });

    test('uses fallback width of 800 when container is 0', () => {
        expect(previewScaleFor(1600, 300, 0)).toBe(0.5);
    });
});

describe('Image Editor — Aspect ratio lock', () => {
    test('maintains 16:9 aspect ratio from width', () => {
        expect(heightForWidth(1920, 1920, 1080)).toBe(1080);
    });

    test('maintains 16:9 aspect ratio from height', () => {
        expect(widthForHeight(1080, 1920, 1080)).toBe(1920);
    });

    test('maintains 1:1 aspect ratio', () => {
        expect(heightForWidth(500, 1000, 1000)).toBe(500);
        expect(widthForHeight(500, 1000, 1000)).toBe(500);
    });

    test('maintains 4:3 aspect ratio', () => {
        expect(heightForWidth(800, 800, 600)).toBe(600);
    });
});
