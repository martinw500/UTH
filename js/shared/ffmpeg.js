// Loading and running ffmpeg.wasm.
//
// This module never touches the DOM: both the video and audio converters have
// different markup, so all feedback goes out through callbacks. That is also
// what makes the interesting parts testable.
//
// The awkward part is the worker chunk. @ffmpeg/ffmpeg is webpack-built and
// spawns its worker from a separate code-split file whose name embeds a chunk
// id — '814.ffmpeg.js' today. Hardcoding that name has already broken
// production once (commit 085863b), so it is discovered at runtime instead and
// the constant survives only as a late fallback.

export const FFMPEG_VERSION = '0.12.10';
export const FFMPEG_CORE_VERSION = '0.12.6';

// The worker chunk comes from the UMD build...
export const FFMPEG_UMD_BASE = `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd`;

// ...but the core must be the ESM build, and this pairing is not arbitrary.
// Passing classWorkerURL makes FFmpeg.load() construct the worker with
// { type: "module" }, and module workers have no importScripts. The worker
// tries importScripts(coreURL) first, falls back to `await import(coreURL)`,
// and reads `.default` off the result — which a UMD script does not have. The
// UMD core therefore fails with the misleading "failed to import
// ffmpeg-core.js". Verified by loading all four combinations in a browser:
// only UMD worker + ESM core succeeds.
export const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;

/** Correct for every 0.12.x published so far, but only used if discovery fails. */
export const FALLBACK_WORKER_CHUNK = '814.ffmpeg.js';

// Webpack emits the chunk filename as a function of the id rather than a
// literal string:  u: e => e + ".ffmpeg.js"  ...called as  e.u(814).
// So the name '814.ffmpeg.js' never appears in the bundle and cannot be found
// by searching for it. These two patterns read the mechanism instead.
const CHUNK_SUFFIX_RE = /u\s*:\s*(\w+)\s*=>\s*\1\s*\+\s*["']([^"']+\.js)["']/;
const CHUNK_ID_RE = /\.u\(\s*(\d{1,6})\s*\)/;
const META_CHUNK_RE = /\/(\d{1,6}\.ffmpeg\.js)$/;

let loadPromise = null;
let workerChunkPromise = null;

/**
 * Recover the worker chunk filename from the bundle source.
 * @returns {string|null} e.g. '814.ffmpeg.js'
 */
export function findWorkerChunk(sourceText) {
    if (typeof sourceText !== 'string') return null;
    const suffix = sourceText.match(CHUNK_SUFFIX_RE);
    const id = sourceText.match(CHUNK_ID_RE);
    if (!suffix || !id) return null;
    return `${id[1]}${suffix[2]}`;
}

/** Recover it from an unpkg `?meta` directory listing instead. */
export function workerChunkFromMeta(meta) {
    const files = meta && Array.isArray(meta.files) ? meta.files : [];
    for (const file of files) {
        const match = typeof file?.path === 'string' && file.path.match(META_CHUNK_RE);
        if (match) return match[1];
    }
    return null;
}

/**
 * Work out the worker chunk name, cheapest source first.
 *
 * Memoised per page load rather than in sessionStorage: the bundle fetch is
 * already in the HTTP cache, and a stored value would go stale the moment
 * FFMPEG_VERSION changed.
 */
export async function resolveWorkerChunk({ fetchImpl = fetch } = {}) {
    if (workerChunkPromise) return workerChunkPromise;

    workerChunkPromise = (async () => {
        // 1. Read it out of the exact bundle the page already loaded, so it
        //    cannot disagree with the code that is running.
        try {
            const res = await fetchImpl(`${FFMPEG_UMD_BASE}/ffmpeg.js`);
            if (res.ok) {
                const found = findWorkerChunk(await res.text());
                if (found) return found;
            }
        } catch { /* fall through */ }

        // 2. Ask unpkg what is actually in the directory.
        try {
            const res = await fetchImpl(`${FFMPEG_UMD_BASE}/?meta`);
            if (res.ok) {
                const found = workerChunkFromMeta(await res.json());
                if (found) return found;
            }
        } catch { /* fall through */ }

        return FALLBACK_WORKER_CHUNK;
    })();

    return workerChunkPromise;
}

/**
 * Why ffmpeg cannot run here, or null if it can.
 *
 * Returns a message rather than a boolean because both converters show the
 * same explanation in more than one place.
 */
export function ffmpegUnavailableReason() {
    let hasSAB = false;
    try {
        hasSAB = typeof SharedArrayBuffer !== 'undefined';
    } catch { hasSAB = false; }

    if (!hasSAB) {
        return 'This browser has SharedArrayBuffer disabled, which ffmpeg.wasm needs. '
            + 'That usually means the page was served without the COOP/COEP security headers. '
            + 'Try a modern browser over HTTPS.';
    }
    if (typeof FFmpegWASM === 'undefined') {
        return 'The FFmpeg library did not load. Refresh the page and try again.';
    }
    if (typeof FFmpegUtil === 'undefined') {
        return 'The FFmpeg utilities did not load. Refresh the page and try again.';
    }
    return null;
}

/** Fetch a cross-origin asset and re-serve it as a same-origin blob URL. */
export async function toBlobURL(url, mimeType, fetchImpl = fetch) {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

function attachListeners(instance, { onProgress, onLog } = {}) {
    instance.on('progress', ({ progress }) => {
        const ratio = Number.isFinite(progress) ? progress : 0;
        const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
        if (onProgress) onProgress({ percent, ratio });
    });
    instance.on('log', ({ message }) => {
        if (onLog) onLog(message);
    });
    return instance;
}

/**
 * Load ffmpeg.wasm once per page.
 *
 * The promise itself is memoised, not a "loaded" flag set after the await —
 * two calls in flight at the same time would otherwise each build an instance
 * and download the core twice.
 */
export async function loadFFmpeg({ onProgress, onLog, onStatus } = {}) {
    if (loadPromise) return loadPromise;

    const status = (phase, message) => { if (onStatus) onStatus(phase, message); };

    loadPromise = (async () => {
        const unavailable = ffmpegUnavailableReason();
        if (unavailable) throw new Error(unavailable);

        const { FFmpeg } = FFmpegWASM;
        let instance = attachListeners(new FFmpeg(), { onProgress, onLog });

        try {
            status('core', 'Loading FFmpeg (first time may take a moment)...');
            const coreURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
            const wasmURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm');

            status('worker', 'Starting FFmpeg worker...');
            const chunk = await resolveWorkerChunk();
            // Same-origin blob, because a worker cannot be constructed from a
            // cross-origin URL — which is what breaks this on GitHub Pages.
            const classWorkerURL = await toBlobURL(`${FFMPEG_UMD_BASE}/${chunk}`, 'text/javascript');

            status('load', 'Preparing FFmpeg...');
            try {
                await instance.load({ coreURL, wasmURL, classWorkerURL });
            } catch (primaryErr) {
                // Some environments only work without an explicit worker URL.
                console.warn('[FFmpeg] load with classWorkerURL failed, retrying without:', primaryErr);
                instance = attachListeners(new FFmpeg(), { onProgress, onLog });
                await instance.load({ coreURL, wasmURL });
            }
        } catch (err) {
            // Clear the memo so a later attempt can genuinely retry.
            loadPromise = null;
            throw new Error(`Failed to load the FFmpeg engine: ${err.message || err}`);
        }

        return instance;
    })();

    return loadPromise;
}

/**
 * Write the input, run the command, read the output back as a Blob.
 *
 * ffmpeg.wasm's exit codes are not trustworthy, so a non-zero code is only
 * logged; the real signals that something went wrong are readFile throwing and
 * a zero-byte result. Both are turned into messages a user can act on.
 */
export async function runFFmpeg(ffmpeg, {
    inputName,
    inputFile,
    args,
    outputName,
    mimeType,
    onStatus,
}) {
    const status = (phase, message) => { if (onStatus) onStatus(phase, message); };
    const { fetchFile } = FFmpegUtil;

    try {
        status('read', 'Reading file...');
        await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

        status('run', 'Converting...');
        const exitCode = await ffmpeg.exec(args);
        if (exitCode !== 0) console.warn('[FFmpeg] non-zero exit code:', exitCode);

        status('output', 'Reading output...');
        let data;
        try {
            data = await ffmpeg.readFile(outputName);
        } catch {
            throw new Error('Conversion produced no output. The input format or the settings '
                + 'chosen may not be supported — try a different output format.');
        }

        const blob = new Blob([data.buffer], { type: mimeType });
        if (blob.size === 0) {
            throw new Error('Conversion produced an empty file. Try different settings '
                + 'or a different format.');
        }
        return blob;
    } finally {
        // In a finally so a failed conversion does not leave the virtual
        // filesystem holding a copy of the input.
        for (const name of [inputName, outputName]) {
            try {
                await ffmpeg.deleteFile(name);
            } catch { /* not every path creates both */ }
        }
    }
}

/** Drop the memoised instance. Tests use this; a cancel button would too. */
export function resetFFmpeg() {
    loadPromise = null;
    workerChunkPromise = null;
}
