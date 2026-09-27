// The tool registry.
//
// One place that knows what tools exist, what they are called, what they do and
// which group they belong to. Registering a tool used to mean five edits in
// lockstep — the card, both homepage counters, and PAGES in two test files —
// which drifted every time.
//
// **The homepage grid stays static HTML.** `tests/deployed-site.test.js`
// fetches raw HTML with no JavaScript, so a client-rendered grid would fail
// every homepage assertion, and the page would be blank to a crawler. This
// registry is the source of truth that a parity test checks the HTML against;
// it does not render it.

/** @typedef {'convert'|'edit'|'download'} CategoryId */

export const CATEGORIES = Object.freeze([
    Object.freeze({
        id: 'convert',
        label: 'Convert',
        blurb: 'Change a file from one format into another.',
    }),
    Object.freeze({
        id: 'edit',
        label: 'Create & edit',
        blurb: 'Make something, or change what you already have.',
    }),
    Object.freeze({
        id: 'download',
        label: 'Download',
        blurb: 'Pull media off the web. These are the only tools that use a server.',
    }),
]);

/**
 * Every tool, in the order the homepage shows them.
 *
 * `tone` must be one of the `tone-*` classes in styles.css.
 * `runs` is 'browser' or 'server' — the only two, and the distinction users
 * actually care about, since "browser" means the file never leaves the device.
 */
export const TOOLS = Object.freeze([
    Object.freeze({
        id: 'convert',
        title: 'File Converter',
        href: 'convert/index.html',
        category: 'convert',
        tone: 'tone-cyan',
        runs: 'browser',
        desc: 'Convert images, video and audio between formats — one place, no uploads',
        keywords: 'convert converter image video audio format png jpg webp avif mp4 webm gif mp3 wav flac transcode change turn into',
    }),
    Object.freeze({
        id: 'pdf-tools',
        title: 'PDF Tools',
        href: 'pdf-tools/index.html',
        category: 'convert',
        tone: 'tone-red',
        runs: 'browser',
        desc: 'Merge, split, rotate, sign and trim PDFs, or save pages as JPG',
        keywords: 'pdf merge split rotate combine join extract pages document images to pdf compress optimise sign signature jpg jpeg png picture convert thumbnails',
    }),
    Object.freeze({
        id: 'text-from-image',
        title: 'Text from Image',
        href: 'text-from-image/index.html',
        category: 'convert',
        tone: 'tone-purple',
        runs: 'browser',
        desc: 'Copy the text out of a screenshot, a photo of a page or a scanned PDF',
        keywords: 'ocr text from image picture photo screenshot scan scanned pdf copy extract read words recognise recognize document',
    }),
    Object.freeze({
        id: 'video-converter',
        title: 'Video Converter',
        href: 'video-converter/index.html',
        category: 'convert',
        tone: 'tone-purple',
        runs: 'browser',
        desc: 'MP4, WEBM and GIF — trim, resize and extract the audio',
        keywords: 'video convert mp4 webm gif mkv avi mov trim resize compress ffmpeg extract audio',
    }),
    Object.freeze({
        id: 'audio-converter',
        title: 'Audio Converter',
        href: 'audio-converter/index.html',
        category: 'convert',
        tone: 'tone-emerald',
        runs: 'browser',
        desc: 'MP3, M4A, OGG, Opus, WAV and FLAC — trim, or pull the sound out of a video',
        keywords: 'audio convert mp3 m4a ogg opus wav flac trim extract sound music bitrate normalise',
    }),

    Object.freeze({
        id: 'image-converter',
        title: 'Image Editor',
        href: 'image-converter/index.html',
        category: 'edit',
        tone: 'tone-green',
        runs: 'browser',
        desc: 'Crop, straighten, adjust, resize and compress — several images at once',
        keywords: 'image editor photo crop resize compress rotate straighten filter brightness contrast saturation sharpen grayscale greyscale sepia invert hue batch convert jpg jpeg png webp avif quality format picture',
    }),
    Object.freeze({
        id: 'photo-privacy',
        title: 'Photo Privacy',
        href: 'photo-privacy/index.html',
        category: 'edit',
        tone: 'tone-green',
        runs: 'browser',
        desc: 'See where, when and with what a photo was taken — then remove it',
        keywords: 'photo privacy metadata exif gps location remove strip clean hide camera date iphone heic safe share',
    }),
    Object.freeze({
        id: 'favicon-generator',
        title: 'Favicon Generator',
        href: 'favicon-generator/index.html',
        category: 'edit',
        tone: 'tone-amber',
        runs: 'browser',
        desc: 'One image into a full favicon set — .ico, every PNG size and a manifest',
        keywords: 'favicon icon ico generator apple touch manifest pwa website logo browser tab',
    }),
    Object.freeze({
        id: 'qr-generator',
        title: 'QR Code Generator',
        href: 'qr-generator/index.html',
        category: 'edit',
        tone: 'tone-indigo',
        runs: 'browser',
        desc: 'Any text or link into a QR code, saved as PNG or SVG',
        keywords: 'qr code generator barcode link url wifi vcard png svg scan',
    }),
    Object.freeze({
        id: 'color-converter',
        title: 'Colour Picker',
        href: 'color-converter/index.html',
        category: 'edit',
        tone: 'tone-pink',
        runs: 'browser',
        desc: 'Pick a colour and convert between HEX, RGB and HSL',
        keywords: 'colour color picker hex rgb hsl convert palette eyedropper contrast css',
    }),

    Object.freeze({
        id: 'instagram-downloader',
        title: 'Instagram Downloader',
        href: 'instagram-downloader/index.html',
        category: 'download',
        tone: 'tone-instagram',
        runs: 'server',
        desc: 'Save photos and videos from public Instagram posts and reels',
        keywords: 'instagram post reel image photo video download save carousel',
    }),
]);

export const TOOL_COUNT = TOOLS.length;

export function toolsInCategory(categoryId) {
    return TOOLS.filter((tool) => tool.category === categoryId);
}

export function findTool(id) {
    return TOOLS.find((tool) => tool.id === id) ?? null;
}
