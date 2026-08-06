/**
 * ffmpeg.wasm loading.
 *
 * The worker-chunk discovery is the reason this module exists. @ffmpeg/ffmpeg
 * is webpack-built and its worker lives in a code-split file named after a
 * chunk id. That name used to be hardcoded, and a version bump 404ed it in
 * production (commit 085863b). Discovery has to survive the same bump, so the
 * fixtures below are real bundle text, not invented.
 */

import fs from 'fs';
import path from 'path';
import {
    FFMPEG_VERSION,
    FFMPEG_UMD_BASE,
    FFMPEG_CORE_BASE,
    FALLBACK_WORKER_CHUNK,
    findWorkerChunk,
    workerChunkFromMeta,
    resolveWorkerChunk,
    toBlobURL,
    ffmpegUnavailableReason,
    runFFmpeg,
    resetFFmpeg,
} from '../js/shared/ffmpeg.js';

// Lifted verbatim from @ffmpeg/ffmpeg@0.12.10 dist/umd/ffmpeg.js. Note that the
// string '814.ffmpeg.js' never appears: webpack emits the filename as
// `u: e => e + ".ffmpeg.js"` and calls it as `e.u(814)`. Searching the bundle
// for the literal name finds nothing, which is the trap this pins.
const REAL_BUNDLE = 'var e={m:{},d:(t,s)=>{},u:e=>e+".ffmpeg.js"};'
    + 'e.b=document.baseURI||self.location.href;'
    + 'new Worker(new URL(e.p+e.u(814),e.b),{type:void 0})';

const REAL_META = {
    package: '@ffmpeg/ffmpeg',
    version: '0.12.10',
    prefix: '/dist/umd/',
    files: [
        { path: '/dist/umd/814.ffmpeg.js', size: 2648, type: 'text/javascript' },
        { path: '/dist/umd/ffmpeg.js', size: 4126, type: 'text/javascript' },
        { path: '/dist/umd/814.ffmpeg.js.map', size: 10920, type: 'application/json' },
    ],
};

const ok = (body) => ({
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    arrayBuffer: async () => new ArrayBuffer(8),
});
const fail = (status = 404) => ({
    ok: false,
    status,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
});

beforeEach(() => resetFFmpeg());

describe('findWorkerChunk', () => {
    test('recovers the chunk name from real bundle text', () => {
        expect(findWorkerChunk(REAL_BUNDLE)).toBe('814.ffmpeg.js');
    });

    test('reads the id from the call site rather than assuming 814', () => {
        expect(findWorkerChunk(REAL_BUNDLE.replace('e.u(814)', 'e.u(297)')))
            .toBe('297.ffmpeg.js');
    });

    test('reads the suffix from the bundle rather than assuming .ffmpeg.js', () => {
        expect(findWorkerChunk(REAL_BUNDLE.replace('".ffmpeg.js"', '".worker.js"')))
            .toBe('814.worker.js');
    });

    test('survives different minifier variable names and spacing', () => {
        const renamed = 'var xyz={u: chunk => chunk + ".ffmpeg.js"}; xyz.u( 42 )';
        expect(findWorkerChunk(renamed)).toBe('42.ffmpeg.js');
    });

    test('returns null when the bundle does not look like this at all', () => {
        expect(findWorkerChunk('console.log("hello")')).toBeNull();
        expect(findWorkerChunk('')).toBeNull();
        expect(findWorkerChunk(undefined)).toBeNull();
    });

    test('returns null when only half the pattern is present', () => {
        expect(findWorkerChunk('var e={u:e=>e+".ffmpeg.js"}')).toBeNull();
        expect(findWorkerChunk('e.u(814)')).toBeNull();
    });
});

describe('workerChunkFromMeta', () => {
    test('picks the chunk out of a real unpkg listing', () => {
        expect(workerChunkFromMeta(REAL_META)).toBe('814.ffmpeg.js');
    });

    // The .map file also matches '814.ffmpeg.js' as a substring; taking it
    // would load JSON as a worker.
    test('does not mistake the source map for the chunk', () => {
        const mapFirst = { files: [REAL_META.files[2], REAL_META.files[0]] };
        expect(workerChunkFromMeta(mapFirst)).toBe('814.ffmpeg.js');
    });

    test('ignores the entry bundle, which has no numeric prefix', () => {
        expect(workerChunkFromMeta({ files: [{ path: '/dist/umd/ffmpeg.js' }] })).toBeNull();
    });

    test('tolerates junk', () => {
        expect(workerChunkFromMeta(null)).toBeNull();
        expect(workerChunkFromMeta({})).toBeNull();
        expect(workerChunkFromMeta({ files: 'nope' })).toBeNull();
        expect(workerChunkFromMeta({ files: [{}, { path: 42 }] })).toBeNull();
    });
});

describe('resolveWorkerChunk', () => {
    test('prefers the bundle, and does not need the listing at all', async () => {
        const fetchImpl = jest.fn(async () => ok(REAL_BUNDLE));
        expect(await resolveWorkerChunk({ fetchImpl })).toBe('814.ffmpeg.js');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][0]).toBe(`${FFMPEG_UMD_BASE}/ffmpeg.js`);
    });

    test('falls back to the unpkg listing when the bundle is unreadable', async () => {
        const fetchImpl = jest.fn(async (url) =>
            (url.endsWith('?meta') ? ok(REAL_META) : ok('not a webpack bundle')));
        expect(await resolveWorkerChunk({ fetchImpl })).toBe('814.ffmpeg.js');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    test('falls back to the pinned name when both lookups fail', async () => {
        const fetchImpl = jest.fn(async () => fail());
        expect(await resolveWorkerChunk({ fetchImpl })).toBe(FALLBACK_WORKER_CHUNK);
    });

    test('a thrown fetch is treated as a failed tier, not a crash', async () => {
        const fetchImpl = jest.fn(async () => { throw new TypeError('offline'); });
        expect(await resolveWorkerChunk({ fetchImpl })).toBe(FALLBACK_WORKER_CHUNK);
    });

    test('malformed listing JSON does not stop the fallback', async () => {
        const fetchImpl = jest.fn(async (url) => (url.endsWith('?meta')
            ? { ok: true, status: 200, json: async () => { throw new Error('bad json'); } }
            : ok('nope')));
        expect(await resolveWorkerChunk({ fetchImpl })).toBe(FALLBACK_WORKER_CHUNK);
    });

    test('resolves once and reuses the answer', async () => {
        const fetchImpl = jest.fn(async () => ok(REAL_BUNDLE));
        const [a, b] = await Promise.all([
            resolveWorkerChunk({ fetchImpl }),
            resolveWorkerChunk({ fetchImpl }),
        ]);
        expect(a).toBe(b);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});

describe('ffmpegUnavailableReason', () => {
    const saved = {};

    beforeEach(() => {
        saved.SAB = global.SharedArrayBuffer;
        saved.WASM = global.FFmpegWASM;
        saved.Util = global.FFmpegUtil;
        global.SharedArrayBuffer = ArrayBuffer;
        global.FFmpegWASM = { FFmpeg: class {} };
        global.FFmpegUtil = { fetchFile: async () => new Uint8Array() };
    });

    afterEach(() => {
        global.SharedArrayBuffer = saved.SAB;
        global.FFmpegWASM = saved.WASM;
        global.FFmpegUtil = saved.Util;
    });

    test('null when everything needed is present', () => {
        expect(ffmpegUnavailableReason()).toBeNull();
    });

    // The usual cause is missing COOP/COEP headers, so the message has to point
    // at that rather than just saying "unsupported".
    test('explains a missing SharedArrayBuffer in terms of the headers', () => {
        delete global.SharedArrayBuffer;
        const reason = ffmpegUnavailableReason();
        expect(reason).toMatch(/SharedArrayBuffer/);
        expect(reason).toMatch(/COOP\/COEP/);
    });

    test('reports the library and the utilities separately', () => {
        delete global.FFmpegWASM;
        expect(ffmpegUnavailableReason()).toMatch(/FFmpeg library/);
        global.FFmpegWASM = { FFmpeg: class {} };
        delete global.FFmpegUtil;
        expect(ffmpegUnavailableReason()).toMatch(/FFmpeg utilities/);
    });
});

describe('toBlobURL', () => {
    beforeEach(() => {
        global.URL.createObjectURL = jest.fn(() => 'blob:stub');
    });

    test('re-serves a fetched asset as a blob URL', async () => {
        const fetchImpl = jest.fn(async () => ok('body'));
        expect(await toBlobURL('https://x/y.js', 'text/javascript', fetchImpl)).toBe('blob:stub');
    });

    test('surfaces the status when the asset is missing', async () => {
        const fetchImpl = jest.fn(async () => fail(503));
        await expect(toBlobURL('https://x/y.js', 'text/javascript', fetchImpl))
            .rejects.toThrow(/503/);
    });
});

describe('runFFmpeg', () => {
    let ffmpeg;
    let deleted;

    beforeEach(() => {
        global.FFmpegUtil = { fetchFile: async () => new Uint8Array([1, 2, 3]) };
        deleted = [];
        ffmpeg = {
            writeFile: jest.fn(async () => {}),
            exec: jest.fn(async () => 0),
            readFile: jest.fn(async () => new Uint8Array([1, 2, 3, 4])),
            deleteFile: jest.fn(async (name) => { deleted.push(name); }),
        };
    });

    const run = (overrides = {}) => runFFmpeg(ffmpeg, {
        inputName: 'input.mp4',
        inputFile: new Blob(['x']),
        args: ['-i', 'input.mp4', 'out.mp3'],
        outputName: 'out.mp3',
        mimeType: 'audio/mpeg',
        ...overrides,
    });

    test('returns the output as a blob of the requested type', async () => {
        const blob = await run();
        expect(blob.type).toBe('audio/mpeg');
        expect(blob.size).toBe(4);
    });

    // ffmpeg.wasm reports unreliable exit codes, so this must not be fatal.
    test('a non-zero exit code is not treated as failure on its own', async () => {
        ffmpeg.exec = jest.fn(async () => 1);
        await expect(run()).resolves.toBeInstanceOf(Blob);
    });

    test('a missing output becomes an actionable message', async () => {
        ffmpeg.readFile = jest.fn(async () => { throw new Error('ENOENT'); });
        await expect(run()).rejects.toThrow(/produced no output/);
    });

    test('a zero-byte output is reported rather than silently downloaded', async () => {
        ffmpeg.readFile = jest.fn(async () => new Uint8Array([]));
        await expect(run()).rejects.toThrow(/empty file/);
    });

    test('cleans up both virtual files on success', async () => {
        await run();
        expect(deleted).toEqual(['input.mp4', 'out.mp3']);
    });

    // The original code cleaned up only after a successful conversion, so a
    // failed one left the whole input file in the virtual filesystem.
    test('cleans up even when the conversion throws', async () => {
        ffmpeg.exec = jest.fn(async () => { throw new Error('boom'); });
        await expect(run()).rejects.toThrow('boom');
        expect(deleted).toEqual(['input.mp4', 'out.mp3']);
    });

    test('a failing cleanup does not mask the real error', async () => {
        ffmpeg.exec = jest.fn(async () => { throw new Error('the real problem'); });
        ffmpeg.deleteFile = jest.fn(async () => { throw new Error('cleanup failed'); });
        await expect(run()).rejects.toThrow('the real problem');
    });

    test('reports progress phases in order', async () => {
        const phases = [];
        await run({ onStatus: (phase) => phases.push(phase) });
        expect(phases).toEqual(['read', 'run', 'output']);
    });
});

describe('COI service worker', () => {
    // The one that actually took the tool down. A service worker registered
    // without { type: "module" } is a classic script, and `import.meta` is a
    // PARSE-time error there — so its presence anywhere in the file, even on a
    // branch the worker never runs, made registration fail with
    // "ServiceWorker script evaluation failed". SharedArrayBuffer then stayed
    // disabled everywhere the headers are not set server-side: GitHub Pages and
    // local dev. new Function() parses in classic (sloppy) mode, same as a
    // classic worker would.
    const files = ['video-converter/coi-serviceworker.js'];

    files.forEach((file) => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');

        test(`${file} parses as a classic script`, () => {
            expect(() => new Function(source)).not.toThrow();
        });

        // The parse check above is authoritative; this one exists to fail with
        // a message that names the problem instead of a bare SyntaxError.
        // Comments are stripped first, or the explanation of this very bug in
        // the source would trip it.
        test(`${file} contains no module-only syntax`, () => {
            const code = source
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');
            expect(code).not.toContain('import.meta');
            expect(code).not.toMatch(/^\s*(import|export)\s/m);
        });
    });
});

describe('version pinning', () => {
    // Bumping the version is fine; forgetting that deployed-site.test.js checks
    // the same URLs is not. Keep them in step.
    test('the UMD base is built from the pinned version', () => {
        expect(FFMPEG_UMD_BASE).toContain(`@ffmpeg/ffmpeg@${FFMPEG_VERSION}`);
    });

    // This pairing broke the converter in production and looks like a typo.
    //
    // Passing classWorkerURL makes FFmpeg.load() build the worker with
    // { type: "module" }, and module workers have no importScripts. The worker
    // falls back to `await import(coreURL)` and reads `.default`, which a UMD
    // script does not have — so a UMD core fails with the thoroughly unhelpful
    // "failed to import ffmpeg-core.js". The worker chunk itself must stay UMD
    // because the ESM worker's relative imports break once it is blobbed.
    // All four combinations were tried in a browser; only this one loads.
    test('the worker comes from the UMD build and the core from the ESM build', () => {
        expect(FFMPEG_UMD_BASE).toMatch(/\/dist\/umd$/);
        expect(FFMPEG_CORE_BASE).toMatch(/\/dist\/esm$/);
    });
});
