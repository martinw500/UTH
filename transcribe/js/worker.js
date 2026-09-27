// Whisper, off the main thread, so a long transcription never freezes the page.
//
// A module worker, built by the page with { type: 'module' }. transformers.js
// comes from a pinned CDN URL (the model alone is ~77 MB, so vendoring was
// never on the table; see STATE.md) and its bundled onnxruntime fetches its
// wasm from a CDN path pinned to the same build. Single-threaded: the page is
// not cross-origin isolated and does not need to be.

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const MODEL = 'onnx-community/whisper-base';
const REVISION = '1846881b6b3a3024392c1eea3ad983695bc23925';

let recogniser = null;

function load(onProgress) {
    recogniser ??= (async () => {
        const { pipeline, env } = await import(TRANSFORMERS);
        env.allowLocalModels = false;
        // q8 on wasm: ~77 MB, cached by the browser after the first run.
        return pipeline('automatic-speech-recognition', MODEL, {
            revision: REVISION, dtype: 'q8', device: 'wasm', progress_callback: onProgress,
        });
    })();
    recogniser.catch(() => { recogniser = null; });
    return recogniser;
}

self.addEventListener('message', async ({ data }) => {
    const post = (message) => self.postMessage(message);
    try {
        const run = await load(({ status, file, loaded, total }) => post({ type: 'load', status, file, loaded, total }));
        post({ type: 'transcribing' });
        const out = await run(data.audio, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: true,
            task: 'transcribe',
            language: data.language || null, // null: Whisper detects it
        });
        post({ type: 'done', text: out.text, chunks: out.chunks ?? [] });
    } catch (error) {
        post({ type: 'error', message: String(error?.message ?? error) });
    }
});
