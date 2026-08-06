// Colour maths. Pure -- no DOM, no state -- so every function here is directly
// testable against published reference values.
//
// Conventions: r/g/b are 0-255, h is 0-360, s/l/v are 0-100, a is 0-1.

/** Clamp and round a colour channel. NaN becomes 0 rather than propagating. */
export function clampChannel(value, min = 0, max = 255) {
    return Math.max(min, Math.min(max, Math.round(value) || 0));
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v, dp = 0) => {
    const f = 10 ** dp;
    const result = Math.round(v * f) / f;
    return result === 0 ? 0 : result;   // normalise -0
};

// ── Hex ──────────────────────────────────────────────────────────────

/**
 * Parse #rgb, #rgba, #rrggbb or #rrggbbaa. Returns null when unparseable.
 * Alpha is 0-1 and defaults to 1.
 */
export function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    let value = hex.trim().replace(/^#/, '');

    if (!/^[0-9a-fA-F]+$/.test(value)) return null;

    if (value.length === 3 || value.length === 4) {
        value = value.split('').map(c => c + c).join('');
    }
    if (value.length !== 6 && value.length !== 8) return null;

    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const rgb = { r, g, b };
    if (value.length === 8) rgb.a = round(parseInt(value.slice(6, 8), 16) / 255, 3);
    return rgb;
}

/**
 * RGB to hex. Accepts either (r, g, b) or ({r, g, b, a}).
 * Pass `{ alpha: true }` to emit 8 digits.
 */
export function rgbToHex(r, g, b, options = {}) {
    let alphaValue;
    if (r && typeof r === 'object') {
        options = g && typeof g === 'object' ? g : {};
        ({ g, b } = { g: r.g, b: r.b });
        alphaValue = r.a;
        r = r.r;
    }

    const hex = '#' + [r, g, b]
        .map(c => clampChannel(c).toString(16).padStart(2, '0'))
        .join('');

    if (options.alpha && alphaValue !== undefined && alphaValue < 1) {
        return hex + clampChannel(clamp01(alphaValue) * 255).toString(16).padStart(2, '0');
    }
    return hex;
}

// ── HSL ──────────────────────────────────────────────────────────────

export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            default: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s /= 100;
    l /= 100;

    if (s === 0) {
        const v = Math.round(l * 255);
        return { r: v, g: v, b: v };
    }

    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return {
        r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        g: Math.round(hue2rgb(p, q, h) * 255),
        b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
}

// ── HSV / HSB ────────────────────────────────────────────────────────

export function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;

    if (d !== 0) {
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            default: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return {
        h: Math.round(h * 360),
        s: Math.round((max === 0 ? 0 : d / max) * 100),
        v: Math.round(max * 100),
    };
}

export function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 60;
    s /= 100;
    v /= 100;

    const i = Math.floor(h);
    const f = h - i;
    const p = v * (1 - s);
    const q = v * (1 - s * f);
    const t = v * (1 - s * (1 - f));
    const table = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]];
    const [r, g, b] = table[i % 6];
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// ── CMYK ─────────────────────────────────────────────────────────────

export function rgbToCmyk(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const k = 1 - Math.max(r, g, b);
    if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
    return {
        c: Math.round(((1 - r - k) / (1 - k)) * 100),
        m: Math.round(((1 - g - k) / (1 - k)) * 100),
        y: Math.round(((1 - b - k) / (1 - k)) * 100),
        k: Math.round(k * 100),
    };
}

export function cmykToRgb(c, m, y, k) {
    c /= 100; m /= 100; y /= 100; k /= 100;
    return {
        r: Math.round(255 * (1 - c) * (1 - k)),
        g: Math.round(255 * (1 - m) * (1 - k)),
        b: Math.round(255 * (1 - y) * (1 - k)),
    };
}

// ── Linear light, LAB / LCH ──────────────────────────────────────────

/** sRGB gamma decode: 0-255 to linear 0-1. */
const srgbToLinear = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (c) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return clampChannel(v * 255);
};

// D65 white point.
const WHITE = { x: 0.95047, y: 1.0, z: 1.08883 };

export function rgbToXyz(r, g, b) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    return {
        x: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
        y: R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
        z: R * 0.0193339 + G * 0.1191920 + B * 0.9503041,
    };
}

export function xyzToRgb(x, y, z) {
    return {
        r: linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314),
        g: linearToSrgb(x * -0.9692660 + y * 1.8760108 + z * 0.0415560),
        b: linearToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252),
    };
}

export function rgbToLab(r, g, b) {
    const { x, y, z } = rgbToXyz(r, g, b);
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
    const fx = f(x / WHITE.x);
    const fy = f(y / WHITE.y);
    const fz = f(z / WHITE.z);
    return {
        l: round(116 * fy - 16, 2),
        a: round(500 * (fx - fy), 2),
        b: round(200 * (fy - fz), 2),
    };
}

export function labToRgb(l, a, bb) {
    const fy = (l + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - bb / 200;
    const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (t - 4 / 29) * (108 / 841));
    return xyzToRgb(inv(fx) * WHITE.x, inv(fy) * WHITE.y, inv(fz) * WHITE.z);
}

/** LAB expressed in cylindrical coordinates. */
export function rgbToLch(r, g, b) {
    const { l, a, b: bb } = rgbToLab(r, g, b);
    const c = Math.sqrt(a * a + bb * bb);
    let h = (Math.atan2(bb, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { l: round(l, 2), c: round(c, 2), h: round(h, 2) };
}

// ── OKLab / OKLCH ────────────────────────────────────────────────────
// Björn Ottosson's perceptual space; the basis for CSS Color 4's oklch().

export function rgbToOklab(r, g, b) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);

    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);

    return {
        L: round(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 4),
        a: round(1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 4),
        b: round(0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s, 4),
    };
}

export function oklabToRgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;

    return {
        r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    };
}

export function rgbToOklch(r, g, b) {
    const { L, a, b: bb } = rgbToOklab(r, g, b);
    const c = Math.sqrt(a * a + bb * bb);
    let h = (Math.atan2(bb, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { L: round(L, 4), c: round(c, 4), h: round(h, 2) };
}

export function oklchToRgb(L, c, h) {
    const rad = (h * Math.PI) / 180;
    return oklabToRgb(L, c * Math.cos(rad), c * Math.sin(rad));
}

// ── Contrast / WCAG ──────────────────────────────────────────────────

export function relativeLuminance(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(c1, c2) {
    const l1 = relativeLuminance(c1.r, c1.g, c1.b);
    const l2 = relativeLuminance(c2.r, c2.g, c2.b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return round((hi + 0.05) / (lo + 0.05), 2);
}

/**
 * Highest WCAG level a ratio satisfies.
 * "Large" is >= 18.66px bold or >= 24px regular.
 */
export function wcagLevel(ratio, { large = false } = {}) {
    if (large) {
        if (ratio >= 4.5) return 'AAA';
        if (ratio >= 3) return 'AA';
        return 'Fail';
    }
    if (ratio >= 7) return 'AAA';
    if (ratio >= 4.5) return 'AA';
    if (ratio >= 3) return 'AA Large';
    return 'Fail';
}

/** Whether black or white text is more readable on this background. */
export function bestTextColor(rgb) {
    const onWhite = contrastRatio(rgb, { r: 255, g: 255, b: 255 });
    const onBlack = contrastRatio(rgb, { r: 0, g: 0, b: 0 });
    return onBlack >= onWhite ? '#000000' : '#ffffff';
}

// ── Harmonies and ramps ──────────────────────────────────────────────

export const HARMONY_ANGLES = {
    complementary: [0, 180],
    analogous: [-30, 0, 30],
    triadic: [0, 120, 240],
    tetradic: [0, 60, 180, 240],
    'split-complementary': [0, 150, 210],
    square: [0, 90, 180, 270],
};

/**
 * Hues related to a base colour by a named scheme.
 * `monochromatic` varies lightness instead of hue.
 */
export function harmony(rgb, scheme = 'complementary', { steps = 5 } = {}) {
    const base = rgbToHsl(rgb.r, rgb.g, rgb.b);

    if (scheme === 'monochromatic') {
        return Array.from({ length: steps }, (_, i) => {
            const l = Math.round(((i + 1) / (steps + 1)) * 100);
            return hslToRgb(base.h, base.s, l);
        });
    }

    const angles = HARMONY_ANGLES[scheme];
    if (!angles) throw new Error(`Unknown harmony scheme: ${scheme}`);
    return angles.map(offset => hslToRgb(base.h + offset, base.s, base.l));
}

/** Progressively darker variants (toward black). */
export function shades(rgb, steps = 5) {
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return Array.from({ length: steps }, (_, i) =>
        hslToRgb(h, s, Math.round(l * (1 - (i + 1) / (steps + 1)))));
}

/** Progressively lighter variants (toward white). */
export function tints(rgb, steps = 5) {
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return Array.from({ length: steps }, (_, i) =>
        hslToRgb(h, s, Math.round(l + (100 - l) * ((i + 1) / (steps + 1)))));
}

/** Progressively desaturated variants (toward grey). */
export function tones(rgb, steps = 5) {
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return Array.from({ length: steps }, (_, i) =>
        hslToRgb(h, Math.round(s * (1 - (i + 1) / (steps + 1))), l));
}

// ── Colour-vision deficiency simulation ──────────────────────────────
// Brettel/Viénot-style LMS projections. Approximate, but good enough to catch
// a palette where two swatches become indistinguishable.

const CVD_MATRICES = {
    protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
    deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
    tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
    achromatopsia: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
};

export const CVD_TYPES = Object.keys(CVD_MATRICES);

export function simulateColorBlindness(rgb, type) {
    const m = CVD_MATRICES[type];
    if (!m) throw new Error(`Unknown colour vision type: ${type}`);
    const { r, g, b } = rgb;
    return {
        r: clampChannel(r * m[0] + g * m[1] + b * m[2]),
        g: clampChannel(r * m[3] + g * m[4] + b * m[5]),
        b: clampChannel(r * m[6] + g * m[7] + b * m[8]),
    };
}

// ── Palette extraction ───────────────────────────────────────────────

/**
 * Dominant colours from raw ImageData, by median cut.
 *
 * `sampleStep` skips pixels; at 1 a 12MP photo would mean 12M iterations.
 */
export function extractPalette(imageData, count = 6, { sampleStep = 4 } = {}) {
    const { data } = imageData;
    const pixels = [];

    for (let i = 0; i < data.length; i += 4 * sampleStep) {
        // Skip near-transparent pixels; their colour is not really visible.
        if (data[i + 3] < 125) continue;
        pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
    if (pixels.length === 0) return [];

    // Median cut alone splits each bucket at its median *count*, so an image
    // that is 90% red and 10% blue yields two buckets that both contain red,
    // averaging to a muddy purple. Refining the centroids with k-means pulls
    // them back onto the actual clusters.
    const seeds = medianCut(pixels, Math.max(1, count))
        .filter(bucket => bucket.length > 0)
        .map(centroidOf);

    const { centroids, counts } = refineKMeans(pixels, seeds);
    const total = counts.reduce((a, b) => a + b, 0) || 1;

    return centroids
        .map((c, i) => ({
            r: Math.round(c[0]),
            g: Math.round(c[1]),
            b: Math.round(c[2]),
            weight: counts[i] / total,
        }))
        .filter(c => c.weight > 0)
        .sort((a, b) => b.weight - a.weight);
}

function centroidOf(bucket) {
    const sum = bucket.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
    return [sum[0] / bucket.length, sum[1] / bucket.length, sum[2] / bucket.length];
}

/** Lloyd's algorithm, seeded from median cut so it converges in a few passes. */
function refineKMeans(pixels, seeds, iterations = 6) {
    let centroids = seeds.map(c => [...c]);
    let counts = new Array(centroids.length).fill(0);

    for (let iter = 0; iter < iterations; iter += 1) {
        const sums = centroids.map(() => [0, 0, 0]);
        counts = new Array(centroids.length).fill(0);

        for (const p of pixels) {
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < centroids.length; i += 1) {
                const c = centroids[i];
                const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
                if (d < bestDist) { bestDist = d; best = i; }
            }
            sums[best][0] += p[0];
            sums[best][1] += p[1];
            sums[best][2] += p[2];
            counts[best] += 1;
        }

        let moved = false;
        const next = centroids.map((c, i) => {
            if (counts[i] === 0) return c;   // keep an emptied centroid in place
            const updated = [sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]];
            if (Math.abs(updated[0] - c[0]) > 0.5
                || Math.abs(updated[1] - c[1]) > 0.5
                || Math.abs(updated[2] - c[2]) > 0.5) moved = true;
            return updated;
        });

        centroids = next;
        if (!moved) break;
    }

    return { centroids, counts };
}

function medianCut(pixels, targetBuckets) {
    let buckets = [pixels];

    while (buckets.length < targetBuckets) {
        // Always split whichever bucket currently spans the widest range;
        // splitting the biggest bucket instead loses small vivid accents.
        let bestIndex = -1;
        let bestRange = -1;
        let bestChannel = 0;

        buckets.forEach((bucket, index) => {
            if (bucket.length < 2) return;
            for (let ch = 0; ch < 3; ch += 1) {
                let min = Infinity;
                let max = -Infinity;
                for (const p of bucket) {
                    if (p[ch] < min) min = p[ch];
                    if (p[ch] > max) max = p[ch];
                }
                if (max - min > bestRange) {
                    bestRange = max - min;
                    bestIndex = index;
                    bestChannel = ch;
                }
            }
        });

        if (bestIndex === -1 || bestRange <= 0) break;

        const bucket = buckets[bestIndex];
        bucket.sort((a, b) => a[bestChannel] - b[bestChannel]);
        const mid = Math.floor(bucket.length / 2);
        buckets.splice(bestIndex, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    return buckets;
}

// ── Named CSS colours ────────────────────────────────────────────────

export const CSS_NAMED_COLORS = Object.freeze({
    aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
    azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
    blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
    burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
    coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
    cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
    darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
    darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
    darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
    darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f',
    darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493',
    deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff',
    firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff',
    gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520',
    gray: '#808080', green: '#008000', greenyellow: '#adff2f', grey: '#808080',
    honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082',
    ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5',
    lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
    lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
    lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
    lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899',
    lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0',
    lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff',
    maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd',
    mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
    mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
    mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa',
    mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080',
    oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500',
    orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98',
    paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5',
    peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
    powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000',
    rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072',
    sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d',
    silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090',
    slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4',
    tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
    turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff',
    whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
});

/**
 * Closest CSS named colour, by CIE76 distance in LAB.
 *
 * LAB rather than RGB because RGB distance does not match how different two
 * colours actually look.
 */
export function nearestNamedColor(rgb) {
    const target = rgbToLab(rgb.r, rgb.g, rgb.b);
    let best = null;

    for (const [name, hex] of Object.entries(CSS_NAMED_COLORS)) {
        const candidate = hexToRgb(hex);
        const lab = rgbToLab(candidate.r, candidate.g, candidate.b);
        const distance = Math.hypot(target.l - lab.l, target.a - lab.a, target.b - lab.b);
        if (!best || distance < best.distance) {
            best = { name, hex, distance: round(distance, 2) };
        }
    }
    return best;
}

// ── Universal parser ─────────────────────────────────────────────────

/**
 * Parse hex, rgb()/rgba(), hsl()/hsla() or a CSS colour name.
 * Returns {r, g, b, a} or null.
 */
export function parseColor(input) {
    if (!input || typeof input !== 'string') return null;
    const value = input.trim().toLowerCase();

    const named = CSS_NAMED_COLORS[value];
    if (named) return { ...hexToRgb(named), a: 1 };

    if (value.startsWith('#') || /^[0-9a-f]{3,8}$/.test(value)) {
        const rgb = hexToRgb(value);
        return rgb ? { a: 1, ...rgb } : null;
    }

    const fn = value.match(/^(rgba?|hsla?)\s*\(([^)]+)\)$/);
    if (!fn) return null;

    // Accept both legacy comma syntax and CSS Color 4 space syntax.
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;

    const num = (s) => parseFloat(s);
    const alpha = parts[3] === undefined
        ? 1
        : clamp01(parts[3].endsWith('%') ? num(parts[3]) / 100 : num(parts[3]));

    if (fn[1].startsWith('rgb')) {
        const channel = (s) => (s.endsWith('%')
            ? clampChannel((num(s) / 100) * 255)
            : clampChannel(num(s)));
        return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
    }

    const rgb = hslToRgb(num(parts[0]), num(parts[1]), num(parts[2]));
    return { ...rgb, a: alpha };
}

// ── Formatting ───────────────────────────────────────────────────────

export function formatRgb({ r, g, b, a = 1 }) {
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${round(a, 3)})` : `rgb(${r}, ${g}, ${b})`;
}

export function formatHsl({ r, g, b, a = 1 }) {
    const { h, s, l } = rgbToHsl(r, g, b);
    return a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${round(a, 3)})` : `hsl(${h}, ${s}%, ${l}%)`;
}

export function formatHsv(rgb) {
    const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
    return `hsv(${h}, ${s}%, ${v}%)`;
}

export function formatCmyk(rgb) {
    const { c, m, y, k } = rgbToCmyk(rgb.r, rgb.g, rgb.b);
    return `cmyk(${c}%, ${m}%, ${y}%, ${k}%)`;
}

export function formatLab(rgb) {
    const { l, a, b } = rgbToLab(rgb.r, rgb.g, rgb.b);
    return `lab(${l}% ${a} ${b})`;
}

export function formatLch(rgb) {
    const { l, c, h } = rgbToLch(rgb.r, rgb.g, rgb.b);
    return `lch(${l}% ${c} ${h})`;
}

export function formatOklch(rgb) {
    const { L, c, h } = rgbToOklch(rgb.r, rgb.g, rgb.b);
    return `oklch(${round(L * 100, 2)}% ${round(c, 4)} ${h})`;
}

export function formatOklab(rgb) {
    const { L, a, b } = rgbToOklab(rgb.r, rgb.g, rgb.b);
    return `oklab(${round(L * 100, 2)}% ${a} ${b})`;
}
