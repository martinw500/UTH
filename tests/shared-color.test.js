// Colour spaces, contrast and palette maths in js/shared/color.js.
//
// Values are checked against published references (CIE LAB, Ottosson's OKLab,
// WCAG 2.1) rather than against whatever the implementation happens to return.

import {
    hexToRgb, rgbToHex, parseColor,
    rgbToHsv, hsvToRgb, rgbToCmyk, cmykToRgb,
    rgbToLab, labToRgb, rgbToLch,
    rgbToOklab, rgbToOklch, oklchToRgb,
    relativeLuminance, contrastRatio, wcagLevel, bestTextColor,
    harmony, shades, tints, tones,
    simulateColorBlindness, CVD_TYPES,
    extractPalette, nearestNamedColor, CSS_NAMED_COLORS,
    formatRgb, formatHsl, formatOklch,
} from '../js/shared/color.js';

const RED = { r: 255, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

const near = (actual, expected, tolerance = 0.05) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

describe('hex with alpha', () => {
    test('parses 8-digit hex', () => {
        expect(hexToRgb('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 0.502 });
    });

    test('parses 4-digit shorthand', () => {
        expect(hexToRgb('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 0.533 });
    });

    test('emits 8-digit hex when alpha is requested', () => {
        expect(rgbToHex({ r: 255, g: 0, b: 0, a: 0.5 }, { alpha: true })).toBe('#ff000080');
    });

    test('omits the alpha pair when fully opaque', () => {
        expect(rgbToHex({ r: 255, g: 0, b: 0, a: 1 }, { alpha: true })).toBe('#ff0000');
    });
});

describe('parseColor', () => {
    test.each([
        ['rgb(255, 0, 0)', { r: 255, g: 0, b: 0, a: 1 }],
        ['rgba(255,0,0,0.5)', { r: 255, g: 0, b: 0, a: 0.5 }],
        ['hsl(0, 100%, 50%)', { r: 255, g: 0, b: 0, a: 1 }],
        ['rebeccapurple', { r: 102, g: 51, b: 153, a: 1 }],
    ])('parses %s', (input, expected) => {
        expect(parseColor(input)).toEqual(expected);
    });

    test('accepts CSS Color 4 space-separated syntax', () => {
        expect(parseColor('rgb(255 0 0 / 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    });

    test('returns null rather than throwing on junk', () => {
        expect(parseColor('not-a-color')).toBeNull();
        expect(parseColor('')).toBeNull();
        expect(parseColor(null)).toBeNull();
    });
});

describe('HSV', () => {
    test('red is fully saturated at full value', () => {
        expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 100, v: 100 });
    });

    test('teal sits at 180 degrees, half value', () => {
        expect(rgbToHsv(0, 128, 128)).toEqual({ h: 180, s: 100, v: 50 });
    });

    test('round-trips', () => {
        expect(hsvToRgb(0, 100, 100)).toEqual(RED);
        expect(hsvToRgb(180, 100, 50)).toEqual({ r: 0, g: 128, b: 128 });
    });
});

describe('CMYK', () => {
    test('red is magenta plus yellow', () => {
        expect(rgbToCmyk(255, 0, 0)).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    });

    test('black is pure key', () => {
        expect(rgbToCmyk(0, 0, 0)).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    });

    test('round-trips', () => {
        expect(cmykToRgb(0, 100, 100, 0)).toEqual(RED);
    });
});

describe('CIE LAB / LCH', () => {
    // Reference values for sRGB primaries under a D65 white point.
    test('white is L=100 with no chroma', () => {
        const lab = rgbToLab(255, 255, 255);
        near(lab.l, 100);
        near(lab.a, 0);
        near(lab.b, 0);
    });

    test('red matches the published reference', () => {
        const lab = rgbToLab(255, 0, 0);
        near(lab.l, 53.24);
        near(lab.a, 80.09);
        near(lab.b, 67.20);
    });

    test('blue matches the published reference', () => {
        const lab = rgbToLab(0, 0, 255);
        near(lab.l, 32.30);
        near(lab.a, 79.19);
        near(lab.b, -107.86);
    });

    test('round-trips back to the original RGB', () => {
        const lab = rgbToLab(99, 102, 241);
        expect(labToRgb(lab.l, lab.a, lab.b)).toEqual({ r: 99, g: 102, b: 241 });
    });

    test('LCH is LAB in polar form', () => {
        const lch = rgbToLch(255, 0, 0);
        near(lch.l, 53.24);
        near(lch.c, 104.55);
        near(lch.h, 40.0, 0.1);
    });
});

describe('OKLab / OKLCH', () => {
    test('white is L=1 with no chroma', () => {
        const ok = rgbToOklab(255, 255, 255);
        near(ok.L, 1, 0.001);
        near(ok.a, 0, 0.001);
        near(ok.b, 0, 0.001);
    });

    test('red matches Ottosson reference values', () => {
        const ok = rgbToOklch(255, 0, 0);
        near(ok.L, 0.6280, 0.001);
        near(ok.c, 0.2577, 0.001);
        near(ok.h, 29.23, 0.05);
    });

    test('round-trips', () => {
        expect(oklchToRgb(0.6280, 0.2577, 29.23)).toEqual(RED);
    });
});

describe('contrast and WCAG', () => {
    test('black on white is the maximum ratio of 21', () => {
        expect(contrastRatio(BLACK, WHITE)).toBe(21);
    });

    test('a colour against itself is 1', () => {
        expect(contrastRatio(RED, RED)).toBe(1);
    });

    test('is order independent', () => {
        expect(contrastRatio(BLACK, WHITE)).toBe(contrastRatio(WHITE, BLACK));
    });

    test('mid grey on white is the familiar 4.48', () => {
        expect(contrastRatio(hexToRgb('#777777'), WHITE)).toBeCloseTo(4.48, 1);
    });

    test('relative luminance spans 0 to 1', () => {
        expect(relativeLuminance(0, 0, 0)).toBe(0);
        expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
    });

    test.each([
        [21, false, 'AAA'],
        [7, false, 'AAA'],
        [4.5, false, 'AA'],
        [3, false, 'AA Large'],
        [2.9, false, 'Fail'],
        [4.5, true, 'AAA'],
        [3, true, 'AA'],
        [2.9, true, 'Fail'],
    ])('ratio %s (large=%s) is %s', (ratio, large, expected) => {
        expect(wcagLevel(ratio, { large })).toBe(expected);
    });

    test('picks the more readable text colour', () => {
        expect(bestTextColor(WHITE)).toBe('#000000');
        expect(bestTextColor(BLACK)).toBe('#ffffff');
    });
});

describe('harmonies and ramps', () => {
    test('complementary is the opposite hue', () => {
        const [base, complement] = harmony(RED, 'complementary');
        expect(rgbToHex(base.r, base.g, base.b)).toBe('#ff0000');
        expect(rgbToHex(complement.r, complement.g, complement.b)).toBe('#00ffff');
    });

    test('triadic splits the wheel into thirds', () => {
        expect(harmony(RED, 'triadic').map(c => rgbToHex(c.r, c.g, c.b)))
            .toEqual(['#ff0000', '#00ff00', '#0000ff']);
    });

    test('monochromatic varies lightness, not hue', () => {
        const result = harmony(RED, 'monochromatic', { steps: 3 });
        expect(result).toHaveLength(3);
        expect(new Set(result.map(c => rgbToHsv(c.r, c.g, c.b).h))).toEqual(new Set([0]));
    });

    test('rejects an unknown scheme instead of returning nothing', () => {
        expect(() => harmony(RED, 'nonsense')).toThrow(/Unknown harmony/);
    });

    test('shades get progressively darker', () => {
        const ls = shades(RED, 4).map(c => relativeLuminance(c.r, c.g, c.b));
        for (let i = 1; i < ls.length; i += 1) expect(ls[i]).toBeLessThan(ls[i - 1]);
    });

    test('tints get progressively lighter', () => {
        const ls = tints(RED, 4).map(c => relativeLuminance(c.r, c.g, c.b));
        for (let i = 1; i < ls.length; i += 1) expect(ls[i]).toBeGreaterThan(ls[i - 1]);
    });

    test('tones get progressively less saturated', () => {
        const ss = tones(RED, 4).map(c => rgbToHsv(c.r, c.g, c.b).s);
        for (let i = 1; i < ss.length; i += 1) expect(ss[i]).toBeLessThan(ss[i - 1]);
    });
});

describe('colour vision deficiency simulation', () => {
    test('every supported type returns a valid colour', () => {
        for (const type of CVD_TYPES) {
            const out = simulateColorBlindness(RED, type);
            for (const channel of ['r', 'g', 'b']) {
                expect(out[channel]).toBeGreaterThanOrEqual(0);
                expect(out[channel]).toBeLessThanOrEqual(255);
            }
        }
    });

    test('achromatopsia produces a grey', () => {
        const out = simulateColorBlindness(RED, 'achromatopsia');
        expect(out.r).toBe(out.g);
        expect(out.g).toBe(out.b);
    });

    test('rejects an unknown type', () => {
        expect(() => simulateColorBlindness(RED, 'nope')).toThrow(/Unknown colour vision/);
    });
});

describe('palette extraction', () => {
    function imageDataOf(colors) {
        const data = new Uint8ClampedArray(colors.length * 4);
        colors.forEach(([r, g, b, a = 255], i) => {
            data.set([r, g, b, a], i * 4);
        });
        return { data, width: colors.length, height: 1 };
    }

    test('finds the distinct colours in a simple image', () => {
        const pixels = [];
        for (let i = 0; i < 40; i += 1) pixels.push([255, 0, 0]);
        for (let i = 0; i < 40; i += 1) pixels.push([0, 0, 255]);

        const palette = extractPalette(imageDataOf(pixels), 2, { sampleStep: 1 });
        expect(palette).toHaveLength(2);
        const hexes = palette.map(c => rgbToHex(c.r, c.g, c.b)).sort();
        expect(hexes).toEqual(['#0000ff', '#ff0000']);
    });

    test('orders by how much of the image each colour covers', () => {
        const pixels = [];
        for (let i = 0; i < 90; i += 1) pixels.push([255, 0, 0]);
        for (let i = 0; i < 10; i += 1) pixels.push([0, 0, 255]);

        const palette = extractPalette(imageDataOf(pixels), 2, { sampleStep: 1 });
        expect(rgbToHex(palette[0].r, palette[0].g, palette[0].b)).toBe('#ff0000');
        expect(palette[0].weight).toBeGreaterThan(palette[1].weight);
    });

    test('ignores near-transparent pixels', () => {
        const pixels = [
            ...Array.from({ length: 10 }, () => [255, 0, 0, 255]),
            ...Array.from({ length: 10 }, () => [0, 255, 0, 5]),
        ];
        const palette = extractPalette(imageDataOf(pixels), 2, { sampleStep: 1 });
        expect(palette.every(c => c.g < 128)).toBe(true);
    });

    test('returns an empty palette for a fully transparent image', () => {
        const pixels = Array.from({ length: 10 }, () => [1, 2, 3, 0]);
        expect(extractPalette(imageDataOf(pixels), 4, { sampleStep: 1 })).toEqual([]);
    });
});

describe('named colours', () => {
    test('includes the full CSS set', () => {
        expect(Object.keys(CSS_NAMED_COLORS).length).toBeGreaterThanOrEqual(147);
        expect(CSS_NAMED_COLORS.rebeccapurple).toBe('#663399');
    });

    test('every named value is a parseable hex colour', () => {
        for (const [name, hex] of Object.entries(CSS_NAMED_COLORS)) {
            expect(hexToRgb(hex)).not.toBeNull();
            expect(name).toMatch(/^[a-z]+$/);
        }
    });

    test('finds an exact name', () => {
        expect(nearestNamedColor(hexToRgb('#6a5acd')).name).toBe('slateblue');
    });

    test('finds the closest name for an off-by-one colour', () => {
        expect(nearestNamedColor(hexToRgb('#ff0001')).name).toBe('red');
    });
});

describe('formatting', () => {
    test('drops the alpha component when opaque', () => {
        expect(formatRgb({ r: 1, g: 2, b: 3 })).toBe('rgb(1, 2, 3)');
        expect(formatRgb({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgba(1, 2, 3, 0.5)');
    });

    test('emits hsl and hsla', () => {
        expect(formatHsl(RED)).toBe('hsl(0, 100%, 50%)');
        expect(formatHsl({ ...RED, a: 0.25 })).toBe('hsla(0, 100%, 50%, 0.25)');
    });

    test('emits CSS Color 4 oklch', () => {
        expect(formatOklch(RED)).toMatch(/^oklch\(62\.8% 0\.2577 29\.2\d?\)$/);
    });
});
