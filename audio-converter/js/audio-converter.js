// ============================================
// Audio Converter — client-side, using FFmpeg.wasm
// ============================================

import {
    formatBytes as sharedFormatBytes,
    stripExtension as stripExt,
    formatTime,
    parseTime,
} from '../../js/shared/format.js';
import {
    loadFFmpeg,
    runFFmpeg,
    ffmpegUnavailableReason,
} from '../../js/shared/ffmpeg.js';
import { takeHandoff } from '../../js/shared/handoff.js';
import { buildAudioArgs, getMimeType, supportsBitrate } from './audio-args.js';

(function () {
    'use strict';

    // One decimal for MB, matching the video converter.
    const formatBytes = (bytes) => sharedFormatBytes(bytes, { mbDecimals: 1 });

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.getElementById('browseBtn');
    const editorWorkspace = document.getElementById('editorWorkspace');
    const editorFilename = document.getElementById('editorFilename');
    const editorMeta = document.getElementById('editorMeta');
    const clearFileBtn = document.getElementById('clearFileBtn');
    const audioPreview = document.getElementById('audioPreview');

    const trimStart = document.getElementById('trimStart');
    const trimEnd = document.getElementById('trimEnd');
    const trimDuration = document.getElementById('trimDuration');
    const setStartBtn = document.getElementById('setStartBtn');
    const setEndBtn = document.getElementById('setEndBtn');
    const resetTrimBtn = document.getElementById('resetTrimBtn');

    const outputFormat = document.getElementById('outputFormat');
    const bitrateGroup = document.getElementById('bitrateGroup');
    const bitrateSelect = document.getElementById('bitrateSelect');
    const channelSelect = document.getElementById('channelSelect');
    const sampleRateSelect = document.getElementById('sampleRateSelect');
    const normaliseCheck = document.getElementById('normaliseCheck');
    const convertBtn = document.getElementById('convertBtn');

    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    const errorMsg = document.getElementById('errorMsg');
    const errorText = document.getElementById('errorText');

    const results = document.getElementById('results');
    const resultsInfo = document.getElementById('resultsInfo');
    const outputName = document.getElementById('outputName');
    const outputSize = document.getElementById('outputSize');
    const outputSavings = document.getElementById('outputSavings');
    const downloadBtn = document.getElementById('downloadBtn');
    const outputPreview = document.getElementById('outputPreview');

    let currentFile = null;
    let sourceDuration = 0;
    let currentOutputUrl = null;
    let previewUrl = null;

    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

    function showError(msg) {
        errorText.textContent = msg;
        errorMsg.classList.add('active');
    }

    function hideError() {
        errorMsg.classList.remove('active');
    }

    // Loading, worker-chunk discovery and the write/exec/read cycle are shared
    // with the video converter; this page only moves its own progress bar.
    function ensureFFmpeg() {
        return loadFFmpeg({
            onProgress: ({ percent }) => {
                progressBar.style.width = percent + '%';
                progressText.textContent = `Converting... ${percent}%`;
            },
            onLog: (message) => console.log('[FFmpeg]', message),
            onStatus: (phase, message) => {
                progressText.textContent = message;
                if (phase === 'core') progressBar.style.width = '0%';
            },
        });
    }

    // --- Dropzone ---
    browseBtn.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('click', (e) => {
        if (e.target !== browseBtn) fileInput.click();
    });

    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const f = e.dataTransfer.files[0];
        if (f) setFile(f);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) { setFile(fileInput.files[0]); fileInput.value = ''; }
    });

    function setFile(file) {
        if (file.size > MAX_FILE_SIZE) {
            showError(`File is too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(MAX_FILE_SIZE)}.`);
            return;
        }

        currentFile = file;
        hideError();

        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        // An <audio> element plays the audio track of a video file too, which is
        // all this tool needs for scrubbing to a trim point.
        audioPreview.src = previewUrl;

        audioPreview.onloadedmetadata = () => {
            sourceDuration = audioPreview.duration;
            editorFilename.textContent = file.name;
            editorMeta.textContent = `${formatBytes(file.size)} · ${formatTime(sourceDuration)}`;
            trimStart.value = formatTime(0);
            trimEnd.value = formatTime(sourceDuration);
            updateTrimDuration();
        };

        audioPreview.onerror = () => {
            showError('This file could not be read as audio. It may be an unsupported '
                + 'container, or the video may have no audio track.');
        };

        dropzone.style.display = 'none';
        editorWorkspace.style.display = '';
        results.style.display = 'none';
        progress.style.display = 'none';
    }

    clearFileBtn.addEventListener('click', () => {
        currentFile = null;
        if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
        if (currentOutputUrl) { URL.revokeObjectURL(currentOutputUrl); currentOutputUrl = null; }
        audioPreview.src = '';
        outputPreview.src = '';
        dropzone.style.display = '';
        editorWorkspace.style.display = 'none';
        results.style.display = 'none';
        progress.style.display = 'none';
        hideError();
    });

    // --- Trim ---
    function updateTrimDuration() {
        const start = parseTime(trimStart.value);
        const end = parseTime(trimEnd.value);
        if (isNaN(start) || isNaN(end) || end <= start) {
            trimDuration.textContent = '—';
        } else {
            trimDuration.textContent = formatTime(end - start);
        }
    }

    trimStart.addEventListener('input', updateTrimDuration);
    trimEnd.addEventListener('input', updateTrimDuration);

    setStartBtn.addEventListener('click', () => {
        trimStart.value = formatTime(audioPreview.currentTime);
        updateTrimDuration();
    });

    setEndBtn.addEventListener('click', () => {
        trimEnd.value = formatTime(audioPreview.currentTime);
        updateTrimDuration();
    });

    resetTrimBtn.addEventListener('click', () => {
        trimStart.value = formatTime(0);
        trimEnd.value = formatTime(sourceDuration);
        updateTrimDuration();
    });

    // --- Format UI ---
    function updateFormatUI() {
        bitrateGroup.style.display = supportsBitrate(outputFormat.value) ? '' : 'none';
    }

    outputFormat.addEventListener('change', updateFormatUI);
    updateFormatUI();

    // --- Hand-off from another tool ---
    //
    // The YouTube downloader fetches an audio track and parks it in IndexedDB,
    // then sends the user here with `?handoff=<id>&format=mp3`. Picking it up
    // is the whole difference between "one click for an MP3" and "download a
    // file, find it, come back, drag it in".
    //
    // takeHandoff() deletes what it reads, so a refresh does not silently
    // re-import a file the user has already dealt with.
    (async function intakeHandoff() {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('handoff');
        if (!id) return;

        // Drop the id from the address bar either way: it is single-use, and
        // leaving it there makes a bookmark or a shared link look meaningful.
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState(null, '', clean);

        const handed = await takeHandoff(id);
        if (!handed) {
            showError('That file was not waiting for us any more. Drop it in below, '
                + 'or go back and try again.');
            return;
        }

        const wanted = params.get('format');
        if (wanted && [...outputFormat.options].some(o => o.value === wanted)) {
            outputFormat.value = wanted;
            updateFormatUI();
        }

        setFile(handed.file);
    })();

    // --- Convert ---
    convertBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        hideError();
        results.style.display = 'none';
        progress.style.display = '';
        convertBtn.disabled = true;

        try {
            const ffmpeg = await ensureFFmpeg();

            const fmt = outputFormat.value;
            const inputName = 'input' + inputExt(currentFile.name);
            const outName = `${stripExt(currentFile.name)}.${fmt}`;

            const start = parseTime(trimStart.value);
            const end = parseTime(trimEnd.value);
            if (!isNaN(start) && !isNaN(end) && end <= start) {
                throw new Error('The trim end must come after the trim start.');
            }

            const args = buildAudioArgs({
                input: inputName,
                output: outName,
                format: fmt,
                bitrate: bitrateSelect.value,
                sampleRate: sampleRateSelect.value,
                channels: channelSelect.value,
                startSec: isNaN(start) ? 0 : start,
                endSec: isNaN(end) ? null : end,
                sourceDuration,
                normalise: normaliseCheck.checked,
            });
            console.log('[FFmpeg] Command:', args.join(' '));

            const blob = await runFFmpeg(ffmpeg, {
                inputName,
                inputFile: currentFile,
                args,
                outputName: outName,
                mimeType: getMimeType(fmt),
                onStatus: (phase, message) => {
                    progressText.textContent = message;
                    if (phase === 'read') progressBar.style.width = '5%';
                    if (phase === 'run') progressBar.style.width = '10%';
                    if (phase === 'output') progressBar.style.width = '95%';
                },
            });

            if (currentOutputUrl) URL.revokeObjectURL(currentOutputUrl);
            currentOutputUrl = URL.createObjectURL(blob);

            outputName.textContent = outName;
            outputSize.textContent = formatBytes(blob.size);

            const savings = (currentFile.size - blob.size) / currentFile.size * 100;
            if (savings > 0.5) {
                outputSavings.textContent = `${savings.toFixed(1)}% smaller`;
                outputSavings.className = 'output-savings positive';
            } else if (savings < -0.5) {
                outputSavings.textContent = `${Math.abs(savings).toFixed(1)}% larger`;
                outputSavings.className = 'output-savings negative';
            } else {
                outputSavings.textContent = 'about the same size';
                outputSavings.className = 'output-savings';
            }

            resultsInfo.textContent = `Converted to ${fmt.toUpperCase()} · ${formatBytes(blob.size)}`;
            downloadBtn.href = currentOutputUrl;
            downloadBtn.download = outName;
            outputPreview.src = currentOutputUrl;
            results.style.display = '';
            progress.style.display = 'none';

        } catch (err) {
            console.error('Conversion error:', err);
            showError('Conversion failed: ' + (err.message || 'Unknown error. Try a different format.'));
            progress.style.display = 'none';
        }

        convertBtn.disabled = false;
    });

    function inputExt(filename) {
        const m = filename.match(/(\.[^.]+)$/);
        return m ? m[1].toLowerCase() : '.mp3';
    }

    console.log('Audio Converter initialized');

    // A soft warning only: the COI service worker may still be activating, and
    // it reloads the page once it takes control.
    const blocker = ffmpegUnavailableReason();
    if (blocker) console.warn('[FFmpeg]', blocker);
})();
