// ============================================
// YouTube Transcript
// ============================================
//
// Two requests, not one: the first lists what caption tracks exist, the second
// fetches the chosen one. Splitting them keeps each response small, and means
// the language menu appears immediately instead of after downloading a track
// the user may not want.

import { byId } from '../../js/shared/dom.js';
import { showError, clearNotice, showSuccess } from '../../js/shared/notify.js';
import { copyWithFeedback } from '../../js/shared/clipboard.js';
import { formatDuration, sanitiseFilename } from '../../js/shared/format.js';
import { apiUrl } from '../../js/shared/config.js';
import { parseTimedText, toSrt, toVtt, toPlainText, totalDuration } from '../../js/shared/subtitles.js';

const videoUrlInput = byId('videoUrl');
const fetchBtn = byId('fetchBtn');
const loading = byId('loading');
const loadingText = byId('loadingText');
const results = byId('results');
const videoInfo = byId('videoInfo');
const langSelect = byId('langSelect');
const formatSelect = byId('formatSelect');
const getBtn = byId('getBtn');
const copyBtn = byId('copyBtn');
const downloadBtn = byId('downloadBtn');
const trackNote = byId('trackNote');
const output = byId('output');
const errorMsg = byId('errorMsg');

let currentInfo = null;
let currentText = '';
let currentFilename = 'transcript.txt';

// Cached by "lang|source" so switching between plain text and SRT, or flipping
// timestamps on and off, does not re-hit the API for bytes we already hold.
const trackCache = new Map();

const LANGUAGE_NAMES = typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

function languageLabel(track) {
    let base = track.lang;
    if (LANGUAGE_NAMES) {
        try {
            base = LANGUAGE_NAMES.of(track.lang) || track.lang;
        } catch {
            base = track.name || track.lang;
        }
    }
    // Saying which is which matters: an auto track is machine transcription and
    // will have mistakes, and people should know that before they quote it.
    return track.source === 'auto'
        ? `${base} — auto-generated`
        : `${base} — by the creator`;
}

function isValidYouTubeUrl(url) {
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
}

function setLoading(active, message) {
    if (message) loadingText.textContent = message;
    loading.classList.toggle('active', active);
}

function renderVideoCard(info) {
    videoInfo.textContent = '';

    const meta = document.createElement('div');
    meta.className = 'video-meta';

    const title = document.createElement('div');
    title.className = 'video-title';
    title.textContent = info.title || 'Unknown';

    const row = document.createElement('div');
    row.className = 'video-details-row';
    for (const text of [info.channel || 'Unknown', formatDuration(info.duration)]) {
        const cell = document.createElement('div');
        cell.className = 'video-detail';
        cell.textContent = text;
        row.appendChild(cell);
    }

    meta.append(title, row);
    videoInfo.appendChild(meta);
}

async function findCaptions(url) {
    setLoading(true, 'Looking for captions...');
    results.classList.remove('active');
    clearNotice(errorMsg);
    hideOutput();
    fetchBtn.disabled = true;
    trackCache.clear();

    try {
        const response = await fetch(apiUrl('/api/youtube/subtitles', { url }));
        const data = await response.json().catch(() => null);

        if (!response.ok || !data || !data.success) {
            showError(errorMsg, serverMessage(data));
            return;
        }

        if (!data.tracks || !data.tracks.length) {
            showError(errorMsg, 'This video has no captions at all — not even '
                + 'auto-generated ones. That usually means the audio is music, or is in a '
                + 'language YouTube cannot transcribe.');
            return;
        }

        currentInfo = { ...data, url };
        renderVideoCard(data);

        langSelect.textContent = '';
        data.tracks.forEach((track) => {
            const option = document.createElement('option');
            option.value = `${track.lang}|${track.source}`;
            option.textContent = languageLabel(track);
            langSelect.appendChild(option);
        });

        results.classList.add('active');
    } catch (error) {
        showError(errorMsg, error instanceof TypeError
            ? 'Could not reach the server. It may still be waking up — the free hosting '
                + 'sleeps when idle, so the first request can take about ten seconds.'
            : 'Something went wrong looking for captions. Try again.');
    } finally {
        setLoading(false);
        fetchBtn.disabled = false;
    }
}

/**
 * Wording for a server error. The API's `detail` field carries raw yt-dlp text
 * and is deliberately not shown -- see `youtube-downloader/js/yt-messages.js`
 * for why that mattered enough to be a rule.
 */
function serverMessage(data) {
    const code = data && data.error_code;
    if (code === 'no_subtitles') return 'That language is not available for this video.';
    if (code === 'bot_check') {
        return 'YouTube blocked our server for this video. It does that to shared cloud '
            + 'servers at random — wait a moment and try again.';
    }
    if (code === 'unavailable' || code === 'private') {
        return 'This video is not available. It may have been deleted or made private.';
    }
    if (code === 'unsupported') {
        return 'That link does not look like a single YouTube video.';
    }
    return 'Could not get captions for this video. Trying again often works.';
}

async function loadTrack() {
    if (!currentInfo) return null;
    const [lang, source] = langSelect.value.split('|');
    const key = `${lang}|${source}`;
    if (trackCache.has(key)) return trackCache.get(key);

    const response = await fetch(apiUrl('/api/youtube/subtitles', {
        url: currentInfo.url,
        lang,
        source,
    }));
    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.success) {
        throw new Error(serverMessage(data));
    }

    const cues = parseTimedText(data.content);
    trackCache.set(key, cues);
    return cues;
}

function hideOutput() {
    output.hidden = true;
    output.textContent = '';
    copyBtn.hidden = true;
    downloadBtn.hidden = true;
    trackNote.textContent = '';
}

async function buildTranscript() {
    clearNotice(errorMsg);
    getBtn.disabled = true;
    const idleLabel = getBtn.textContent;
    getBtn.textContent = 'Working...';

    try {
        const cues = await loadTrack();
        if (!cues || !cues.length) {
            showError(errorMsg, 'That caption track turned out to be empty.');
            hideOutput();
            return;
        }

        const format = formatSelect.value;
        if (format === 'srt') {
            currentText = toSrt(cues);
        } else if (format === 'vtt') {
            currentText = toVtt(cues);
        } else {
            currentText = toPlainText(cues, { timestamps: format === 'text-stamped' });
        }

        const ext = format === 'srt' ? 'srt' : format === 'vtt' ? 'vtt' : 'txt';
        const [lang] = langSelect.value.split('|');
        currentFilename = `${sanitiseFilename(currentInfo.title || 'transcript')}.${lang}.${ext}`;

        // textContent: a transcript is text from a stranger's video.
        output.textContent = currentText;
        output.hidden = false;
        copyBtn.hidden = false;
        downloadBtn.hidden = false;

        const words = currentText.trim().split(/\s+/).filter(Boolean).length;
        trackNote.textContent = `${cues.length} caption lines · about ${words.toLocaleString()} words · `
            + `covers ${formatDuration(Math.round(totalDuration(cues)))}`;
    } catch (error) {
        showError(errorMsg, error.message || 'Could not build the transcript.');
        hideOutput();
    } finally {
        getBtn.disabled = false;
        getBtn.textContent = idleLabel;
    }
}

// ============================================
// Event listeners
// ============================================

fetchBtn.addEventListener('click', () => {
    const url = videoUrlInput.value.trim();
    if (!url) {
        showError(errorMsg, 'Paste a YouTube link first.');
        return;
    }
    if (!isValidYouTubeUrl(url)) {
        showError(errorMsg, 'That does not look like a YouTube link. It should start with '
            + 'youtube.com or youtu.be.');
        return;
    }
    findCaptions(url);
});

videoUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
});

getBtn.addEventListener('click', buildTranscript);

// Changing either dropdown invalidates what is on screen. Clearing it is
// honest; leaving stale SRT under a heading that now says "plain text" is not.
langSelect.addEventListener('change', hideOutput);
formatSelect.addEventListener('change', () => {
    if (!output.hidden) buildTranscript();
});

copyBtn.addEventListener('click', (e) => copyWithFeedback(e.currentTarget, currentText));

downloadBtn.addEventListener('click', () => {
    const blob = new Blob([currentText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFilename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
    }, 100);
    showSuccess(errorMsg, `Saved as ${currentFilename}`);
});
