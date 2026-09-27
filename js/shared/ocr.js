// Text recognition with tesseract.js, loaded on first use.
//
// **Loaded from pinned CDN URLs, not vendored** -- a deliberate exception to
// js/vendor/README.md. The engine is ~5 MB of wasm and each language's model
// another few MB; vendoring them would put tens of megabytes in git for a
// feature most visits never touch. Every URL names an exact version and lives
// in a constant here, so nothing floats, and `import(URL)` takes a variable
// (a literal URL would fail esm-conventions.test.js, on purpose).
//
// Language data is cached by tesseract.js in IndexedDB after the first use.

export const TESSERACT_VERSION = '7.0.0';
const TESSERACT_ESM = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`;
const WORKER_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
const CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';
const LANG_DATA = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';

/** Offered in the page; tesseract codes, in rough order of how many people read them. */
export const OCR_LANGUAGES = Object.freeze([
    ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'],
    ['por', 'Portuguese'], ['ita', 'Italian'], ['nld', 'Dutch'], ['pol', 'Polish'],
    ['rus', 'Russian'], ['ukr', 'Ukrainian'], ['tur', 'Turkish'], ['chi_sim', 'Chinese (simplified)'],
    ['jpn', 'Japanese'], ['kor', 'Korean'], ['ara', 'Arabic'], ['hin', 'Hindi'],
]);

let worker = null; // { promise, lang }
let onProgress = () => {};

async function workerFor(lang) {
    if (worker?.lang === lang) return worker.promise;
    const previous = worker;
    worker = {
        lang,
        promise: (async () => {
            await previous?.promise.then((w) => w.terminate()).catch(() => {});
            // The ESM build wraps the UMD one: everything is on the default export.
            const { createWorker } = (await import(TESSERACT_ESM)).default;
            // One language at a time, so the path names it; tesseract appends
            // <lang>.traineddata.gz.
            return createWorker(lang, 1, {
                workerPath: WORKER_PATH,
                corePath: CORE_PATH,
                langPath: `${LANG_DATA}/${lang}/4.0.0_best_int`,
                // Every event comes here; the caller of the moment owns it.
                logger: (message) => onProgress(message),
            });
        })(),
    };
    worker.promise.catch(() => { worker = null; });
    return worker.promise;
}

/**
 * Recognise the text in one image (a canvas, ImageBitmap or Blob).
 * `progress({ status, progress })` reports model download and recognition.
 */
export async function recognise(image, { lang = 'eng', progress = () => {} } = {}) {
    onProgress = progress;
    try {
        const w = await workerFor(lang);
        const { data } = await w.recognize(image);
        return { text: data.text ?? '', confidence: data.confidence ?? 0 };
    } catch (error) {
        // Only a failed download gets this sentence; anything else is a bug and
        // keeps its own message, or it would be misreported as the network.
        if (/Failed to fetch|NetworkError|Load failed|importing a module script failed/i
            .test(String(error?.message ?? error))) {
            throw new Error('Could not download the text-recognition engine. Check your connection and try again.');
        }
        throw error;
    } finally {
        onProgress = () => {};
    }
}

