// ============================================
// Video Converter — Full-featured client-side using FFmpeg.wasm
// ============================================

(function () {
    'use strict';

    // --- DOM Elements ---
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.getElementById('browseBtn');
    const editorWorkspace = document.getElementById('editorWorkspace');
    const editorFilename = document.getElementById('editorFilename');
    const editorMeta = document.getElementById('editorMeta');
    const clearFileBtn = document.getElementById('clearFileBtn');
    const videoPreview = document.getElementById('videoPreview');

    // Trim
    const trimStart = document.getElementById('trimStart');
    const trimEnd = document.getElementById('trimEnd');
    const trimDuration = document.getElementById('trimDuration');
    const setStartBtn = document.getElementById('setStartBtn');
    const setEndBtn = document.getElementById('setEndBtn');

    // Format & Quality
    const outputFormat = document.getElementById('outputFormat');
    const qualityGroup = document.getElementById('qualityGroup');
    const qualitySelect = document.getElementById('qualitySelect');
    const resolutionGroup = document.getElementById('resolutionGroup');
    const resolutionSelect = document.getElementById('resolutionSelect');
    const targetSizeInput = document.getElementById('targetSizeInput');
    const targetSizeUnit = document.getElementById('targetSizeUnit');
    const targetSizeGroup = document.getElementById('targetSizeGroup');
    const fpsGroup = document.getElementById('fpsGroup');
    const fpsSelect = document.getElementById('fpsSelect');
    const muteGroup = document.getElementById('muteGroup');
    const audioSelect = document.getElementById('audioSelect');
    const convertBtn = document.getElementById('convertBtn');

    // Progress
    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    // Error
    const errorMsg = document.getElementById('errorMsg');
    const errorText = document.getElementById('errorText');

    // Results
    const results = document.getElementById('results');
    const resultsInfo = document.getElementById('resultsInfo');
    const outputName = document.getElementById('outputName');
    const outputSize = document.getElementById('outputSize');
    const outputSavings = document.getElementById('outputSavings');
    const downloadBtn = document.getElementById('downloadBtn');

    // --- State ---
    let currentFile = null;
    let videoDuration = 0;
    let ffmpegInstance = null;
    let ffmpegLoaded = false;
    let currentOutputUrl = null;
    let previewUrl = null;

    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

    // --- Helpers ---
    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function stripExt(name) {
        return name.replace(/\.[^.]+$/, '');
    }

    function showError(msg) {
        errorText.textContent = msg;
        errorMsg.classList.add('active');
    }

    function hideError() {
        errorMsg.classList.remove('active');
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function parseTime(str) {
        str = str.trim();
        // Accept seconds directly
        if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);

        const parts = str.split(':').map(Number);
        if (parts.some(isNaN)) return NaN;

        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return NaN;
    }

    // --- FFmpeg Setup ---
    // Helper: fetch a URL and convert to a same-origin blob URL (fixes CORS worker issues on GitHub Pages)
    async function toBlobURL(url, mimeType) {
        const response = await fetch(url);
        const buf = await response.arrayBuffer();
        const blob = new Blob([buf], { type: mimeType });
        return URL.createObjectURL(blob);
    }

    async function loadFFmpeg() {
        if (ffmpegLoaded) return;

        const { FFmpeg } = FFmpegWASM;
        ffmpegInstance = new FFmpeg();

        ffmpegInstance.on('progress', ({ progress: p }) => {
            const pct = Math.min(100, Math.max(0, Math.round(p * 100)));
            progressBar.style.width = pct + '%';
            progressText.textContent = `Converting... ${pct}%`;
        });

        ffmpegInstance.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
        });

        progressText.textContent = 'Loading FFmpeg (first time may take a moment)...';
        progressBar.style.width = '0%';

        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        const ffmpegBaseURL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd';

        // Use blob URLs to avoid cross-origin worker restriction on GitHub Pages
        const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
        const workerURL = await toBlobURL(`${ffmpegBaseURL}/814.ffmpeg.js`, 'text/javascript');

        await ffmpegInstance.load({
            coreURL,
            wasmURL,
            classWorkerURL: workerURL,
        });

        ffmpegLoaded = true;
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
        if (f && (f.type.startsWith('video/') || /\.(mkv|avi|mov|webm|mp4|ogg)$/i.test(f.name))) {
            setFile(f);
        }
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

        // Set up preview
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        videoPreview.src = previewUrl;

        videoPreview.onloadedmetadata = () => {
            videoDuration = videoPreview.duration;
            editorFilename.textContent = file.name;
            editorMeta.textContent = `${formatBytes(file.size)} · ${formatTime(videoDuration)}`;
            trimEnd.value = formatTime(videoDuration);
            updateTrimDuration();
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
        videoPreview.src = '';
        dropzone.style.display = '';
        editorWorkspace.style.display = 'none';
        results.style.display = 'none';
        progress.style.display = 'none';
        hideError();
    });

    // --- Trim Controls ---
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
        trimStart.value = formatTime(videoPreview.currentTime);
        updateTrimDuration();
    });

    setEndBtn.addEventListener('click', () => {
        trimEnd.value = formatTime(videoPreview.currentTime);
        updateTrimDuration();
    });

    // --- Format Change ---
    outputFormat.addEventListener('change', updateFormatUI);

    function updateFormatUI() {
        const fmt = outputFormat.value;
        const isAudio = fmt === 'mp3' || fmt === 'wav';
        const isGif = fmt === 'gif';

        qualityGroup.style.display = (isAudio || isGif) ? 'none' : '';
        resolutionGroup.style.display = isAudio ? 'none' : '';
        targetSizeGroup.style.display = (isAudio || isGif) ? 'none' : '';
        fpsGroup.style.display = isAudio ? 'none' : '';
        muteGroup.style.display = (isAudio || isGif) ? 'none' : '';
    }

    updateFormatUI();

    // --- Convert ---
    convertBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        hideError();
        results.style.display = 'none';
        progress.style.display = '';
        convertBtn.disabled = true;

        try {
            await loadFFmpeg();

            const { fetchFile } = FFmpegUtil;
            const fmt = outputFormat.value;
            const quality = qualitySelect.value;
            const inputName = 'input' + getInputExt(currentFile.name);
            const outName = stripExt(currentFile.name) + '.' + fmt;

            progressText.textContent = 'Reading file...';
            progressBar.style.width = '5%';

            await ffmpegInstance.writeFile(inputName, await fetchFile(currentFile));

            progressText.textContent = 'Converting...';
            progressBar.style.width = '10%';

            const args = buildFFmpegArgs(inputName, outName, fmt, quality);
            console.log('[FFmpeg] Command:', args.join(' '));
            await ffmpegInstance.exec(args);

            progressText.textContent = 'Reading output...';
            progressBar.style.width = '95%';

            if (currentOutputUrl) URL.revokeObjectURL(currentOutputUrl);

            const data = await ffmpegInstance.readFile(outName);
            const blob = new Blob([data.buffer], { type: getMimeType(fmt) });
            const url = URL.createObjectURL(blob);
            currentOutputUrl = url;

            // Show result
            outputName.textContent = outName;
            outputSize.textContent = formatBytes(blob.size);

            const savingsNum = (currentFile.size - blob.size) / currentFile.size * 100;
            if (savingsNum > 0) {
                outputSavings.textContent = savingsNum.toFixed(1) + '% smaller';
                outputSavings.className = 'output-savings positive';
            } else if (savingsNum < 0) {
                outputSavings.textContent = Math.abs(savingsNum).toFixed(1) + '% larger';
                outputSavings.className = 'output-savings negative';
            } else {
                outputSavings.textContent = 'Same size';
                outputSavings.className = 'output-savings';
            }

            resultsInfo.textContent = `Converted to ${fmt.toUpperCase()} · ${formatBytes(blob.size)}`;
            downloadBtn.href = url;
            downloadBtn.download = outName;
            results.style.display = '';
            progress.style.display = 'none';

            // Cleanup temp files
            try {
                await ffmpegInstance.deleteFile(inputName);
                await ffmpegInstance.deleteFile(outName);
            } catch (_) { /* ignore */ }

        } catch (err) {
            console.error('Conversion error:', err);
            showError('Conversion failed: ' + (err.message || 'Unknown error. Try a different format or smaller file.'));
            progress.style.display = 'none';
        }

        convertBtn.disabled = false;
    });

    function getInputExt(filename) {
        const m = filename.match(/(\.[^.]+)$/);
        return m ? m[1].toLowerCase() : '.mp4';
    }

    function buildFFmpegArgs(input, output, fmt, quality) {
        const args = ['-i', input];

        // Trim
        const startSec = parseTime(trimStart.value);
        const endSec = parseTime(trimEnd.value);
        const isTrimmed = !isNaN(startSec) && !isNaN(endSec) && (startSec > 0 || endSec < videoDuration - 0.5);

        if (isTrimmed && startSec > 0) {
            args.push('-ss', String(startSec));
        }
        if (isTrimmed && endSec < videoDuration - 0.5) {
            args.push('-to', String(endSec));
        }

        // Resolution
        const resolution = resolutionSelect.value;

        // FPS
        const fps = fpsSelect.value;

        // Audio
        const audio = audioSelect.value;

        // Target file size
        const targetBytes = getTargetBytes();
        const duration = isTrimmed ? (endSec - startSec) : videoDuration;

        if (fmt === 'gif') {
            let vf = 'fps=10,scale=480:-1:flags=lanczos';
            if (resolution !== 'original') {
                vf = `fps=10,scale=${resolution}:-1:flags=lanczos`;
            }
            if (fps !== 'original') {
                vf = vf.replace('fps=10', `fps=${fps}`);
            }
            args.push('-vf', vf, '-loop', '0');
        } else if (fmt === 'mp3') {
            const bitrates = { high: '320k', medium: '192k', low: '128k', verylow: '64k' };
            args.push('-vn', '-ab', bitrates[quality] || '192k');
        } else if (fmt === 'wav') {
            args.push('-vn');
        } else if (fmt === 'webm') {
            let crf;
            if (targetBytes && duration > 0) {
                const targetBitrate = Math.floor((targetBytes * 8) / duration);
                args.push('-c:v', 'libvpx', '-b:v', targetBitrate + '', '-c:a', 'libvorbis');
            } else {
                const crfMap = { high: '20', medium: '30', low: '40', verylow: '50' };
                crf = crfMap[quality] || '30';
                args.push('-c:v', 'libvpx', '-crf', crf, '-b:v', '0', '-c:a', 'libvorbis');
            }

            // Resolution & FPS filter
            const vfParts = [];
            if (resolution !== 'original') vfParts.push(`scale=${resolution}:-2`);
            if (fps !== 'original') vfParts.push(`fps=${fps}`);
            if (vfParts.length) args.push('-vf', vfParts.join(','));

            if (audio === 'mute') args.push('-an');
        } else if (fmt === 'mp4') {
            if (targetBytes && duration > 0) {
                const targetBitrate = Math.floor((targetBytes * 8) / duration);
                args.push('-c:v', 'libx264', '-b:v', targetBitrate + '', '-preset', 'fast', '-c:a', 'aac');
            } else {
                const crfMap = { high: '20', medium: '28', low: '35', verylow: '42' };
                const crf = crfMap[quality] || '28';
                args.push('-c:v', 'libx264', '-crf', crf, '-preset', 'fast', '-c:a', 'aac');
            }

            // Resolution & FPS filter
            const vfParts = [];
            if (resolution !== 'original') vfParts.push(`scale=${resolution}:-2`);
            if (fps !== 'original') vfParts.push(`fps=${fps}`);
            if (vfParts.length) args.push('-vf', vfParts.join(','));

            if (audio === 'mute') args.push('-an');
        }

        args.push(output);
        return args;
    }

    function getTargetBytes() {
        const val = parseInt(targetSizeInput.value);
        if (!val || val <= 0) return null;
        return targetSizeUnit.value === 'mb' ? val * 1024 * 1024 : val * 1024;
    }

    function getMimeType(fmt) {
        const map = {
            mp4: 'video/mp4',
            webm: 'video/webm',
            gif: 'image/gif',
            mp3: 'audio/mpeg',
            wav: 'audio/wav'
        };
        return map[fmt] || 'application/octet-stream';
    }

    console.log('Video Converter initialized');
})();
