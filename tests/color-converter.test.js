// ============================================
// Color Converter — Unit Tests
// Tests for color math functions (HEX ↔ RGB ↔ HSL)
// ============================================

// Imports the real shared module. These assertions are unchanged from when
// they tested copy-pasted clones, so a green run proves the extraction into
// js/shared/color.js preserved behaviour.
import {
    hexToRgb,
    rgbToHex,
    rgbToHsl,
    hslToRgb,
    clampChannel as clamp,
} from '../js/shared/color.js';

// ============================================
// TESTS
// ============================================

describe('Color Converter — hexToRgb', () => {
    test('converts standard 6-digit hex', () => {
        expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
        expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
        expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
    });

    test('converts hex without hash prefix', () => {
        expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    });

    test('converts 3-digit shorthand hex', () => {
        expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
        expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
        expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    test('converts black and white', () => {
        expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
        expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    test('converts mixed case', () => {
        expect(hexToRgb('#AaBbCc')).toEqual({ r: 170, g: 187, b: 204 });
    });

    test('returns null for invalid hex', () => {
        expect(hexToRgb('#gggggg')).toBeNull();
        expect(hexToRgb('#12345')).toBeNull();   // 5 digits
        expect(hexToRgb('')).toBeNull();
        expect(hexToRgb('#')).toBeNull();
    });

    test('converts the default app color #6366f1', () => {
        expect(hexToRgb('#6366f1')).toEqual({ r: 99, g: 102, b: 241 });
    });
});

describe('Color Converter — rgbToHex', () => {
    test('converts primary colors', () => {
        expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
        expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
        expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    });

    test('converts black and white', () => {
        expect(rgbToHex(0, 0, 0)).toBe('#000000');
        expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    });

    test('clamps out-of-range values', () => {
        expect(rgbToHex(300, -10, 128)).toBe('#ff0080');
    });

    test('rounds floating point values', () => {
        expect(rgbToHex(127.6, 0.4, 255)).toBe('#8000ff');
    });

    test('pads single-digit hex values', () => {
        expect(rgbToHex(0, 0, 1)).toBe('#000001');
        expect(rgbToHex(15, 15, 15)).toBe('#0f0f0f');
    });
});

describe('Color Converter — rgbToHsl', () => {
    test('converts pure red', () => {
        const hsl = rgbToHsl(255, 0, 0);
        expect(hsl).toEqual({ h: 0, s: 100, l: 50 });
    });

    test('converts pure green', () => {
        const hsl = rgbToHsl(0, 255, 0);
        expect(hsl).toEqual({ h: 120, s: 100, l: 50 });
    });

    test('converts pure blue', () => {
        const hsl = rgbToHsl(0, 0, 255);
        expect(hsl).toEqual({ h: 240, s: 100, l: 50 });
    });

    test('converts white', () => {
        const hsl = rgbToHsl(255, 255, 255);
        expect(hsl).toEqual({ h: 0, s: 0, l: 100 });
    });

    test('converts black', () => {
        const hsl = rgbToHsl(0, 0, 0);
        expect(hsl).toEqual({ h: 0, s: 0, l: 0 });
    });

    test('converts gray (no saturation)', () => {
        const hsl = rgbToHsl(128, 128, 128);
        expect(hsl.s).toBe(0);
        expect(hsl.l).toBe(50);
    });

    test('converts a mid-range color', () => {
        const hsl = rgbToHsl(99, 102, 241);
        expect(hsl.h).toBeGreaterThanOrEqual(235);
        expect(hsl.h).toBeLessThanOrEqual(240);
        expect(hsl.s).toBeGreaterThan(50);
    });
});

describe('Color Converter — hslToRgb', () => {
    test('converts pure red from HSL', () => {
        const rgb = hslToRgb(0, 100, 50);
        expect(rgb).toEqual({ r: 255, g: 0, b: 0 });
    });

    test('converts pure green from HSL', () => {
        const rgb = hslToRgb(120, 100, 50);
        expect(rgb).toEqual({ r: 0, g: 255, b: 0 });
    });

    test('converts pure blue from HSL', () => {
        const rgb = hslToRgb(240, 100, 50);
        expect(rgb).toEqual({ r: 0, g: 0, b: 255 });
    });

    test('converts white from HSL', () => {
        const rgb = hslToRgb(0, 0, 100);
        expect(rgb).toEqual({ r: 255, g: 255, b: 255 });
    });

    test('converts black from HSL', () => {
        const rgb = hslToRgb(0, 0, 0);
        expect(rgb).toEqual({ r: 0, g: 0, b: 0 });
    });

    test('converts gray from HSL (zero saturation)', () => {
        const rgb = hslToRgb(180, 0, 50);
        expect(rgb.r).toBe(rgb.g);
        expect(rgb.g).toBe(rgb.b);
        expect(rgb.r).toBe(128);
    });
});

describe('Color Converter — Roundtrip conversions', () => {
    const testColors = [
        '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000',
        '#6366f1', '#22c55e', '#ef4444', '#f59e0b', '#06b6d4',
        '#aabbcc', '#123456', '#abcdef', '#fedcba'
    ];

    testColors.forEach(hex => {
        test(`hex → rgb → hex roundtrip for ${hex}`, () => {
            const rgb = hexToRgb(hex);
            expect(rgb).not.toBeNull();
            const result = rgbToHex(rgb.r, rgb.g, rgb.b);
            expect(result).toBe(hex);
        });
    });

    testColors.forEach(hex => {
        test(`hex → rgb → hsl → rgb → hex roundtrip for ${hex}`, () => {
            const rgb = hexToRgb(hex);
            expect(rgb).not.toBeNull();
            const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
            const rgb2 = hslToRgb(hsl.h, hsl.s, hsl.l);
            const result = rgbToHex(rgb2.r, rgb2.g, rgb2.b);
            // Allow ±2 for rounding (HSL intermediate rounding can accumulate)
            const origRgb = hexToRgb(hex);
            expect(Math.abs(rgb2.r - origRgb.r)).toBeLessThanOrEqual(2);
            expect(Math.abs(rgb2.g - origRgb.g)).toBeLessThanOrEqual(2);
            expect(Math.abs(rgb2.b - origRgb.b)).toBeLessThanOrEqual(2);
        });
    });
});

describe('Color Converter — clamp', () => {
    test('clamps below minimum', () => {
        expect(clamp(-10, 0, 255)).toBe(0);
    });

    test('clamps above maximum', () => {
        expect(clamp(300, 0, 255)).toBe(255);
    });

    test('passes through valid values', () => {
        expect(clamp(128, 0, 255)).toBe(128);
    });

    test('rounds floating point', () => {
        expect(clamp(127.6, 0, 255)).toBe(128);
        expect(clamp(127.4, 0, 255)).toBe(127);
    });

    test('handles NaN (defaults to 0)', () => {
        expect(clamp(NaN, 0, 255)).toBe(0);
    });
});
