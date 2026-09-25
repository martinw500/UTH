// favicon-generator/js/favicon.js — the decisions that need no canvas.

import {
    sizedSvg,
    buildManifest,
    buildHtmlSnippet,
    describeSize,
} from '../favicon-generator/js/favicon.js';

const attrs = (text) => {
    const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    return {
        width: svg.getAttribute('width'),
        height: svg.getAttribute('height'),
        viewBox: svg.getAttribute('viewBox'),
    };
};

describe('sizedSvg', () => {
    // A viewBox-only logo has no intrinsic size, so browsers drew it at 300x150
    // (or 0x0) and every icon was upscaled from that.
    test('a viewBox-only SVG is given a real size, keeping its aspect', () => {
        const out = sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>');
        expect(attrs(out)).toEqual({ width: '1024', height: '512', viewBox: '0 0 200 100' });
    });

    // Without a viewBox, a bigger width only enlarges the canvas; the drawing
    // stays 24px in the corner.
    test('a fixed-size icon SVG gets a viewBox so the drawing scales', () => {
        const out = sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>');
        expect(attrs(out)).toEqual({ width: '1024', height: '1024', viewBox: '0 0 24 24' });
    });

    test('keeps the drawing itself', () => {
        expect(sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10"/></svg>'))
            .toContain('<path d="M0 0h10"');
    });

    test('is null for text that is not an SVG', () => {
        expect(sizedSvg('not svg at all')).toBeNull();
        expect(sizedSvg('<html><body></body></html>')).toBeNull();
    });
});

describe('buildManifest', () => {
    test('lists only the sizes a manifest uses, smallest first', () => {
        const manifest = buildManifest({ name: 'Tools', sizes: [512, 16, 192, 32] });
        expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
        expect(manifest.icons[0].src).toBe('favicon-192x192.png');
    });

    test('short name falls back to the name', () => {
        expect(buildManifest({ name: 'Tools' }).short_name).toBe('Tools');
    });
});

describe('buildHtmlSnippet', () => {
    test('links the manifest only when asked to', () => {
        expect(buildHtmlSnippet()).toContain('site.webmanifest');
        expect(buildHtmlSnippet({ includeManifest: false })).not.toContain('site.webmanifest');
    });
});

describe('describeSize', () => {
    test('names known sizes and falls back to the dimensions', () => {
        expect(describeSize(180)).toBe('Apple touch icon');
        expect(describeSize(99)).toBe('99×99');
    });
});
