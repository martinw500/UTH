// ============================================
// Image Editor — Unit Tests
// Tests for helper functions and logic
// ============================================

// Replicate pure helper functions from image-converter.js for testing

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function stripExtension(name) {
    return name.replace(/\.[^.]+$/, '');
}

function buildFilterString(brightness, contrast, saturation, blur) {
    let filter = '';
    if (brightness !== 0) filter += `brightness(${1 + brightness / 100}) `;
    if (contrast !== 0) filter += `contrast(${1 + contrast / 100}) `;
    if (saturation !== 0) filter += `saturate(${1 + saturation / 100}) `;
    if (blur > 0) filter += `blur(${blur}px) `;
    return filter.trim() || 'none';
}

const FORMAT_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const COMPRESSION_QUALITY = { none: 1.0, light: 0.8, medium: 0.6, heavy: 0.4, extreme: 0.2 };

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
        expect(buildFilterString(50, 0, 0, 0)).toBe('brightness(1.5)');
        expect(buildFilterString(-50, 0, 0, 0)).toBe('brightness(0.5)');
    });

    test('builds contrast filter', () => {
        expect(buildFilterString(0, 100, 0, 0)).toBe('contrast(2)');
    });

    test('builds saturation filter', () => {
        expect(buildFilterString(0, 0, -50, 0)).toBe('saturate(0.5)');
    });

    test('builds blur filter', () => {
        expect(buildFilterString(0, 0, 0, 5)).toBe('blur(5px)');
    });

    test('builds combined filters', () => {
        const result = buildFilterString(20, 30, -10, 2);
        expect(result).toContain('brightness(1.2)');
        expect(result).toContain('contrast(1.3)');
        expect(result).toContain('saturate(0.9)');
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
    function calculatePreviewScale(editWidth, editHeight, containerWidth, maxH = 500) {
        const maxW = containerWidth || 800;
        return Math.min(1, maxW / editWidth, maxH / editHeight);
    }

    test('does not upscale small images', () => {
        const scale = calculatePreviewScale(400, 300, 800);
        expect(scale).toBe(1);
    });

    test('scales down wide images', () => {
        const scale = calculatePreviewScale(1600, 300, 800);
        expect(scale).toBe(0.5);
    });

    test('scales down tall images', () => {
        const scale = calculatePreviewScale(400, 1000, 800);
        expect(scale).toBe(0.5);
    });

    test('scales proportionally for large images', () => {
        const scale = calculatePreviewScale(4000, 3000, 800);
        // maxW/W = 0.2, maxH/H = 500/3000 = 0.167
        expect(scale).toBeCloseTo(500 / 3000, 5);
    });

    test('uses fallback width of 800 when container is 0', () => {
        const scale = calculatePreviewScale(1600, 300, 0);
        expect(scale).toBe(0.5);
    });
});

describe('Image Editor — Crop coordinate conversion', () => {
    function previewToEditCoords(cropRect, editWidth, editHeight, previewWidth, previewHeight) {
        const scaleX = editWidth / previewWidth;
        const scaleY = editHeight / previewHeight;
        return {
            sx: Math.round(cropRect.x * scaleX),
            sy: Math.round(cropRect.y * scaleY),
            sw: Math.round(cropRect.w * scaleX),
            sh: Math.round(cropRect.h * scaleY),
        };
    }

    test('maps preview to full-resolution coords at 1:1 scale', () => {
        const result = previewToEditCoords({ x: 10, y: 20, w: 100, h: 50 }, 800, 600, 800, 600);
        expect(result).toEqual({ sx: 10, sy: 20, sw: 100, sh: 50 });
    });

    test('maps preview to full-resolution coords at 2x scale', () => {
        const result = previewToEditCoords({ x: 10, y: 20, w: 100, h: 50 }, 1600, 1200, 800, 600);
        expect(result).toEqual({ sx: 20, sy: 40, sw: 200, sh: 100 });
    });

    test('maps zero crop rect', () => {
        const result = previewToEditCoords({ x: 0, y: 0, w: 0, h: 0 }, 1000, 1000, 500, 500);
        expect(result).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    });
});

describe('Image Editor — Aspect ratio lock', () => {
    function calculateAspectHeight(width, editWidth, editHeight) {
        const ratio = editHeight / editWidth;
        return Math.round(width * ratio);
    }

    function calculateAspectWidth(height, editWidth, editHeight) {
        const ratio = editWidth / editHeight;
        return Math.round(height * ratio);
    }

    test('maintains 16:9 aspect ratio from width', () => {
        const h = calculateAspectHeight(1920, 1920, 1080);
        expect(h).toBe(1080);
    });

    test('maintains 16:9 aspect ratio from height', () => {
        const w = calculateAspectWidth(1080, 1920, 1080);
        expect(w).toBe(1920);
    });

    test('maintains 1:1 aspect ratio', () => {
        expect(calculateAspectHeight(500, 1000, 1000)).toBe(500);
        expect(calculateAspectWidth(500, 1000, 1000)).toBe(500);
    });

    test('maintains 4:3 aspect ratio', () => {
        const h = calculateAspectHeight(800, 800, 600);
        expect(h).toBe(600);
    });
});
