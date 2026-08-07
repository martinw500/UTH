// Building a favicon set from one image.
//
// DOM-free apart from the canvases it creates, so the decisions -- which sizes,
// what the manifest says, what goes in the HTML snippet -- are all testable.

import { FAVICON_SIZES, ICO_SIZES, buildIco } from '../../js/shared/ico.js';
import { canvasToBlob, downscaleStepped } from '../../js/shared/image.js';
import { buildZip } from '../../js/shared/zip.js';

/** What each generated PNG is for, so the UI can explain itself. */
export const SIZE_PURPOSE = Object.freeze({
    16: 'Browser tab',
    32: 'Taskbar and bookmarks',
    48: 'Windows site icon',
    64: 'High-DPI tab',
    128: 'Chrome Web Store',
    180: 'Apple touch icon',
    192: 'Android home screen',
    256: 'Windows tile',
    512: 'PWA splash screen',
});

export function describeSize(size) {
    return SIZE_PURPOSE[size] ?? `${size}×${size}`;
}

/**
 * Render a square icon of `size` from a source image.
 *
 * Squares the source by centre-cropping rather than stretching -- a squashed
 * logo is worse than a cropped one -- and steps the downscale, since going from
 * a 1024px logo straight to 16px in one draw is what makes small icons mushy.
 */
export function renderIcon(source, size, { background = null, padding = 0 } = {}) {
    const side = Math.min(source.width, source.height);
    const sx = (source.width - side) / 2;
    const sy = (source.height - side) / 2;

    const square = document.createElement('canvas');
    square.width = side;
    square.height = side;
    square.getContext('2d').drawImage(source, sx, sy, side, side, 0, 0, side, side);

    const inset = Math.round(size * Math.min(0.4, Math.max(0, padding)));
    const inner = Math.max(1, size - inset * 2);
    const scaled = inner < side ? downscaleStepped(square, inner, inner) : square;

    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d');
    if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, size, size);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scaled, inset, inset, inner, inner);
    return out;
}

/** The web app manifest a generated set should ship with. */
export function buildManifest({ name = 'My site', shortName = '', sizes = [192, 512], themeColor = '#ffffff' } = {}) {
    return {
        name,
        short_name: shortName || name,
        icons: sizes
            .filter((size) => size >= 192)
            .sort((a, b) => a - b)
            .map((size) => ({
                src: `favicon-${size}x${size}.png`,
                sizes: `${size}x${size}`,
                type: 'image/png',
                purpose: 'any maskable',
            })),
        theme_color: themeColor,
        background_color: themeColor,
        display: 'standalone',
    };
}

/**
 * The markup to paste into <head>.
 *
 * Deliberately short: modern browsers need far less than the twenty-tag blocks
 * favicon generators used to emit. favicon.ico is listed because it is what a
 * bare request for /favicon.ico gets, which some crawlers still do.
 */
export function buildHtmlSnippet({ includeManifest = true } = {}) {
    const lines = [
        '<link rel="icon" href="/favicon.ico" sizes="any">',
        '<link rel="icon" type="image/png" href="/favicon-32x32.png" sizes="32x32">',
        '<link rel="apple-touch-icon" href="/favicon-180x180.png">',
    ];
    if (includeManifest) lines.push('<link rel="manifest" href="/site.webmanifest">');
    return lines.join('\n');
}

/**
 * Generate the whole set and pack it into a zip.
 *
 * @param {ImageBitmap|HTMLImageElement} source
 */
export async function generateFaviconSet(source, {
    sizes = FAVICON_SIZES,
    icoSizes = ICO_SIZES,
    background = null,
    padding = 0,
    name = 'My site',
    shortName = '',
    themeColor = '#ffffff',
    onProgress = () => {},
} = {}) {
    const wanted = [...new Set([...sizes, ...icoSizes])].sort((a, b) => a - b);
    const pngs = new Map();

    let done = 0;
    for (const size of wanted) {
        const canvas = renderIcon(source, size, { background, padding });
        pngs.set(size, await canvasToBlob(canvas, 'image/png'));
        done += 1;
        onProgress({ ratio: done / (wanted.length + 1), note: `${size}×${size}` });
    }

    onProgress({ ratio: 0.95, note: 'Packing favicon.ico' });
    const ico = await buildIco(
        icoSizes.filter((size) => pngs.has(size)).map((size) => ({ size, data: pngs.get(size) })),
    );

    const manifest = buildManifest({ name, shortName, sizes, themeColor });
    const entries = [
        { name: 'favicon.ico', data: ico },
        ...sizes.filter((size) => pngs.has(size))
            .map((size) => ({ name: `favicon-${size}x${size}.png`, data: pngs.get(size) })),
        { name: 'site.webmanifest', data: JSON.stringify(manifest, null, 2) },
        { name: 'README.txt', data: readme() },
    ];

    onProgress({ ratio: 1, note: '' });
    return { zip: await buildZip(entries), ico, pngs, manifest };
}

function readme() {
    return [
        'Favicon set',
        '===========',
        '',
        'Copy every file into the root of your site, then paste this into <head>:',
        '',
        buildHtmlSnippet(),
        '',
        'favicon.ico contains the small sizes in one file. It is what a bare',
        'request for /favicon.ico returns, which some crawlers still rely on.',
        '',
        'Generated with Useful Tool Hub — https://github.com/martinw500/UTH',
    ].join('\n');
}
