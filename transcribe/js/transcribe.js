// Transcribe page controller. Decoding is in ./audio.js, Whisper runs in
// ./worker.js, and the output formats are js/shared/subtitles.js.

import { requireIds, setBusy, el } from '../../js/shared/dom.js';
import { formatBytes, formatDuration, stripExtension } from '../../js/shared/format.js';
import { createDropzone } from '../../js/shared/dropzone.js';
import { showError, showSuccess, clearNotice, announce } from '../../js/shared/notify.js';
import { copyWithFeedback } from '../../js/shared/clipboard.js';
import { saveBlob } from '../../js/shared/download.js';
import { getString, setString } from '../../js/shared/storage.js';
import { fromWhisperChunks, toSrt, toVtt, toPlainText } from '../../js/shared/subtitles.js';
import { decodeForWhisper } from './audio.js';

const MAX_BYTES = 1024 * 1024 * 1024;
const LANG_KEY = 'uth-asr-lang';
// Whisper language codes; '' lets it detect the language itself.
const LANGUAGES = [
    ['', 'Detect automatically'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'],
    ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian'], ['nl', 'Dutch'], ['pl', 'Polish'],
    ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['zh', 'Chinese'], ['ja', 'Japanese'],
    ['ko', 'Korean'], ['ar', 'Arabic'], ['hi', 'Hindi'],
];

const ui = requireIds(
    'dropzone', 'fileInput', 'browseBtn', 'notice',
    'workspace', 'fileName', 'replaceBtn', 'asrLang', 'runBtn', 'cancelBtn',
    'progress', 'progressBar', 'progressText',
    'results', 'resultsInfo', 'copyBtn', 'downloadTxtBtn', 'downloadSrtBtn', 'downloadVttBtn',
    'withTimes', 'transcriptOutput',
);

let file = null;
let cues = [];
let worker = null;
let cancel = null;

function choose([picked]) {
    file = picked;
    ui.fileName.textContent = file.name;
    ui.fileName.title = formatBytes(file.size);
    ui.dropzone.hidden = true;
    ui.workspace.hidden = false;
    ui.results.hidden = true;
    clearNotice(ui.notice);
}

function showProgress(text, ratio = null) {
    ui.progressText.textContent = text;
    ui.progressBar.style.width = ratio === null ? '100%' : `${Math.round(ratio * 100)}%`;
    ui.progressBar.classList.toggle('is-indeterminate', ratio === null);
}

/**
 * One transcription in the worker. The worker is kept between runs, so the
 * model loads once per visit; Cancel terminates it and the next run starts a
 * fresh one (the browser has cached the model files by then).
 */
function transcribe(audio, language, duration) {
    worker ??= new Worker('js/worker.js', { type: 'module' });
    const downloads = new Map();
    let started = 0;
    let ticker = null;

    return new Promise((resolve, reject) => {
        cancel = () => {
            worker.terminate();
            worker = null;
            reject(new DOMException('Cancelled', 'AbortError'));
        };
        worker.onerror = () => reject(new Error('The transcription engine could not start. Check your connection and try again.'));
        worker.onmessage = ({ data }) => {
            if (data.type === 'load' && data.total) {
                downloads.set(data.file, [data.loaded ?? 0, data.total]);
                const [loaded, total] = [...downloads.values()].reduce(([a, b], [l, t]) => [a + l, b + t], [0, 0]);
                showProgress(`Downloading the model — ${formatBytes(loaded)} of ${formatBytes(total)}`, loaded / total);
            } else if (data.type === 'transcribing') {
                // Whisper gives no progress of its own; say how long it has
                // been going, against the length of the recording.
                started = performance.now();
                const tick = () => showProgress(`Transcribing ${formatDuration(duration)} of audio… `
                    + `${formatDuration((performance.now() - started) / 1000)} so far`);
                tick();
                ticker = setInterval(tick, 1000);
            } else if (data.type === 'done') {
                resolve(data);
            } else if (data.type === 'error') {
                reject(new Error(/fetch|network/i.test(data.message)
                    ? 'Could not download the model. Check your connection and try again.'
                    : `Transcription failed: ${data.message}`));
            }
        };
        worker.postMessage({ audio, language }, [audio.buffer]);
    }).finally(() => {
        clearInterval(ticker);
        cancel = null;
    });
}

function render() {
    ui.transcriptOutput.value = toPlainText(cues, { timestamps: ui.withTimes.checked });
}

async function run() {
    setBusy(ui.runBtn, true, 'Working…');
    ui.cancelBtn.hidden = false;
    ui.results.hidden = true;
    ui.progress.hidden = false;
    clearNotice(ui.notice);
    const language = ui.asrLang.value;
    setString(LANG_KEY, language);

    try {
        showProgress('Reading the recording…');
        const { audio, duration } = await decodeForWhisper(file);
        const { chunks } = await transcribe(audio, language, duration);
        cues = fromWhisperChunks(chunks, duration);
        render();
        ui.results.hidden = false;
        const words = ui.transcriptOutput.value.split(/\s+/).filter(Boolean).length;
        ui.resultsInfo.textContent = `${words} words from ${formatDuration(duration)}`;
        if (words) {
            showSuccess(ui.notice, 'Done. Nothing left your device.');
            announce(`Transcribed ${words} words`);
        } else {
            showError(ui.notice, 'No speech was found in that recording.');
        }
    } catch (error) {
        if (error?.name !== 'AbortError') showError(ui.notice, error?.message || 'Could not transcribe that.');
    } finally {
        setBusy(ui.runBtn, false);
        ui.cancelBtn.hidden = true;
        ui.progress.hidden = true;
    }
}

const save = (text, ext, type) => saveBlob(
    new Blob([text], { type: `${type};charset=utf-8` }), `${stripExtension(file.name)}.${ext}`);

ui.asrLang.replaceChildren(...LANGUAGES.map(([code, name]) => el('option', { value: code }, name)));
const savedLang = getString(LANG_KEY);
if (LANGUAGES.some(([code]) => code === savedLang)) ui.asrLang.value = savedLang;

createDropzone({
    dropzone: ui.dropzone,
    fileInput: ui.fileInput,
    browseBtn: ui.browseBtn,
    accept: ['audio/*', 'video/*', '.m4a', '.mp3', '.wav', '.ogg', '.opus', '.flac', '.mp4', '.webm', '.mov'],
    multiple: false,
    maxBytes: MAX_BYTES,
    onFiles: choose,
    onReject: (rejection) => showError(ui.notice, rejection.message),
});

ui.replaceBtn.addEventListener('click', () => ui.fileInput.click());
ui.runBtn.addEventListener('click', run);
ui.cancelBtn.addEventListener('click', () => cancel?.());
ui.withTimes.addEventListener('change', render);
ui.copyBtn.addEventListener('click', () => copyWithFeedback(ui.copyBtn, ui.transcriptOutput.value));
ui.downloadTxtBtn.addEventListener('click', () => save(ui.transcriptOutput.value, 'txt', 'text/plain'));
ui.downloadSrtBtn.addEventListener('click', () => save(toSrt(cues), 'srt', 'application/x-subrip'));
ui.downloadVttBtn.addEventListener('click', () => save(toVtt(cues), 'vtt', 'text/vtt'));
