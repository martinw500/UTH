// ============================================
// YouTube Downloader
// ============================================
//
// Two things shape this file.
//
// 1. The hosted backend is weak in specific, knowable ways: YouTube bot-checks
//    datacenter IPs, Vercel has no ffmpeg, and its responses are capped at a
//    few megabytes. The page's job is to say so *before* the click and to hand
//    over a route that works when the server cannot -- never to fail with
//    yt-dlp's own CLI advice, which is what it used to do.
// 2. The same page has to behave well against a local backend, where none of
//    those limits exist. `server_can_merge` and the backend hostname are what
//    it switches on.

import { byId } from '../../js/shared/dom.js';
import { showError, clearNotice } from '../../js/shared/notify.js';
import { copyWithFeedback } from '../../js/shared/clipboard.js';
import { formatDuration, formatViews, sanitiseFilename } from '../../js/shared/format.js';
import { API_CONFIG, apiUrl } from '../../js/shared/config.js';
import { putHandoff } from '../../js/shared/handoff.js';
import {
    messageFor,
    ytdlpCommand,
    deliverableWithAudio,
    silentOnly,
} from './yt-messages.js';

const fetchBtn = byId('fetchBtn');
const youtubeUrlInput = byId('youtubeUrl');
const loading = byId('loading');
const loadingText = byId('loadingText');
const results = byId('results');
const videoInfo = byId('videoInfo');
const qualityOptions = byId('qualityOptions');
const silentOptions = byId('silentOptions');
const advancedFormats = byId('advancedFormats');
const audioPanel = byId('audioPanel');
const audioOptions = byId('audioOptions');
const audioHint = byId('audioHint');
const hostNotice = byId('hostNotice');
const errorMsg = byId('errorMsg');

const helpPanel = byId('helpPanel');
const helpTitle = byId('helpTitle');
const helpBody = byId('helpBody');
const helpEscape = byId('helpEscape');
const helpTechnical = byId('helpTechnical');
const helpDetail = byId('helpDetail');
const retryBtn = byId('retryBtn');
const lowerQualityBtn = byId('lowerQualityBtn');
const ytdlpCmd = byId('ytdlpCmd');

// The hosted functions cannot return a body much beyond this. Checking the
// advertised size first means a too-big file is refused in a second, instead of
// after a minute of downloading that ends in a platform 504.
const HOSTED_RESPONSE_CAP = 4_200_000;

const isLocalBackend = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(API_CONFIG.BACKEND_URL);

let currentVideoData = null;
let currentVideoId = null;
/** What the user last asked for, so "Try again" repeats exactly that. */
let lastAttempt = null;

function isValidYouTubeUrl(url) {
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
}

function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
        /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

// ============================================
// Errors and the escape hatch
// ============================================

function hideHelp() {
    helpPanel.hidden = true;
    helpTechnical.hidden = true;
    helpDetail.textContent = '';
}

/**
 * Show a failure in words the reader can act on.
 *
 * `detail` is the raw upstream text. It goes into a collapsed <pre> via
 * textContent and nowhere else -- forwarding it as the headline is the exact
 * bug this page was rewritten to fix.
 */
function showFailure(code, { detail = '', retryLabel = 'Try again', canLowerQuality = false } = {}) {
    const message = messageFor(code);

    clearNotice(errorMsg);
    helpTitle.textContent = message.title;
    helpBody.textContent = message.body;

    retryBtn.hidden = !message.canRetry || !lastAttempt;
    retryBtn.textContent = retryLabel;
    lowerQualityBtn.hidden = !canLowerQuality || !nextLowerQuality();

    helpEscape.hidden = !message.canEscape;
    if (message.canEscape) refreshCommand();

    if (detail) {
        helpTechnical.hidden = false;
        helpDetail.textContent = detail;
    }

    helpPanel.hidden = false;
    helpPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Keep the copyable command matching the row the user actually pressed. */
function refreshCommand() {
    const command = ytdlpCommand({
        videoId: currentVideoId,
        quality: (lastAttempt && lastAttempt.quality) || '1080p',
        mode: (lastAttempt && lastAttempt.mode) || 'video',
    });
    ytdlpCmd.textContent = command || 'yt-dlp "paste the video link here"';
}

/** The next quality down from the last attempt, if the list offers one. */
function nextLowerQuality() {
    if (!lastAttempt || !currentVideoData || lastAttempt.mode === 'audio') return null;
    const ready = deliverableWithAudio(currentVideoData.formats, currentVideoData.server_can_merge);
    const index = ready.findIndex(f => f.quality === lastAttempt.quality);
    if (index === -1 || index + 1 >= ready.length) return null;
    return ready[index + 1];
}

// ============================================
// Fetching video information
// ============================================

async function fetchYouTubeVideo(url) {
    loadingText.textContent = 'Fetching video information...';
    loading.classList.add('active');
    results.classList.remove('active');
    clearNotice(errorMsg);
    hideHelp();
    fetchBtn.disabled = true;

    currentVideoId = extractVideoId(url);
    lastAttempt = { kind: 'fetch', url };

    try {
        if (!currentVideoId) {
            showFailure('unsupported');
            return;
        }

        const response = await fetch(apiUrl('/api/youtube', { url }));
        const data = await response.json().catch(() => null);

        if (!response.ok || !data) {
            showFailure((data && data.error_code) || 'unknown', { detail: data && data.detail });
            return;
        }
        if (!data.success) {
            showFailure(data.error_code || 'unknown', { detail: data.detail });
            return;
        }

        currentVideoData = data;
        currentVideoData.originalUrl = url;
        displayVideoInfo(data);
    } catch (error) {
        // A TypeError from fetch() means the request never completed -- the
        // backend is asleep, offline, or blocked -- not that YouTube said no.
        showFailure(error instanceof TypeError ? 'offline' : 'unknown', { detail: String(error) });
    } finally {
        loading.classList.remove('active');
        fetchBtn.disabled = false;
    }
}

// ============================================
// Rendering
// ============================================

function displayVideoInfo(data) {
    renderVideoCard(data);
    renderHostNotice(data);
    renderVideoFormats(data);
    renderAudio(data);

    results.classList.add('active');
}

function renderVideoCard(data) {
    videoInfo.textContent = '';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'video-thumbnail-wrap';
    if (data.thumbnail) {
        const img = document.createElement('img');
        img.src = data.thumbnail;
        img.alt = '';
        thumbWrap.appendChild(img);
    }

    const meta = document.createElement('div');
    meta.className = 'video-meta';

    const title = document.createElement('div');
    title.className = 'video-title';
    // textContent, not innerHTML: a video title is attacker-controlled text.
    title.textContent = data.title || 'Unknown';

    const row = document.createElement('div');
    row.className = 'video-details-row';
    for (const text of [formatViews(data.views), formatDuration(data.duration), data.channel || 'Unknown']) {
        const cell = document.createElement('div');
        cell.className = 'video-detail';
        cell.textContent = text;
        row.appendChild(cell);
    }

    meta.append(title, row);
    videoInfo.append(thumbWrap, meta);
}

function renderHostNotice(data) {
    if (data.server_can_merge) {
        hostNotice.hidden = true;
        return;
    }
    hostNotice.textContent = 'This site runs on free hosting that has no way to join a video '
        + 'track to a sound track, so it can only send files that already have both — and '
        + 'YouTube only offers those up to 360p. For anything sharper, use one of the two '
        + 'options under “Still not working?” below.';
    hostNotice.hidden = false;
}

function qualityRow(format, { silent = false } = {}) {
    const item = document.createElement('div');
    item.className = 'quality-item';

    const info = document.createElement('div');
    info.className = 'quality-info';

    const label = document.createElement('div');
    label.className = 'quality-label';
    label.textContent = format.quality;

    const metaText = document.createElement('div');
    metaText.className = 'quality-meta';
    metaText.textContent = silent
        ? `${format.ext} · ${format.filesize || 'Size unknown'} · no sound`
        : `${format.ext} · ${format.filesize || 'Size unknown'} · with sound`;

    info.append(label, metaText);

    const button = document.createElement('button');
    button.className = silent ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm';
    button.textContent = 'Download';
    button.addEventListener('click', () => startDownload(format, button, { mode: 'video' }));

    item.append(info, button);
    return item;
}

function renderVideoFormats(data) {
    const ready = deliverableWithAudio(data.formats, data.server_can_merge);
    const silent = silentOnly(data.formats, data.server_can_merge);

    qualityOptions.textContent = '';
    if (ready.length) {
        ready.forEach(format => qualityOptions.appendChild(qualityRow(format)));
    } else {
        const empty = document.createElement('p');
        empty.className = 'help-note';
        empty.textContent = 'No format with sound is available from this server. '
            + 'Use one of the options under “Still not working?” below.';
        qualityOptions.appendChild(empty);
        showFailure('too_large', { retryLabel: 'Try again' });
    }

    silentOptions.textContent = '';
    silent.forEach(format => silentOptions.appendChild(qualityRow(format, { silent: true })));
    advancedFormats.hidden = silent.length === 0;
}

function renderAudio(data) {
    audioOptions.textContent = '';
    if (!data.audio) {
        audioPanel.hidden = true;
        return;
    }

    const item = document.createElement('div');
    item.className = 'quality-item';

    const info = document.createElement('div');
    info.className = 'quality-info';
    const label = document.createElement('div');
    label.className = 'quality-label';
    label.textContent = 'Audio only';
    const metaText = document.createElement('div');
    metaText.className = 'quality-meta';
    metaText.textContent = [
        data.audio.ext ? data.audio.ext.toUpperCase() : 'M4A',
        data.audio.abr ? `${data.audio.abr} kbps` : null,
        data.audio.filesize,
    ].filter(Boolean).join(' · ');
    info.append(label, metaText);

    const actions = document.createElement('div');
    actions.className = 'quality-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-secondary btn-sm';
    saveBtn.textContent = `Save ${(data.audio.ext || 'm4a').toUpperCase()}`;
    saveBtn.addEventListener('click', () => startDownload({ quality: 'audio', ext: data.audio.ext }, saveBtn, { mode: 'audio' }));

    const mp3Btn = document.createElement('button');
    mp3Btn.className = 'btn btn-primary btn-sm';
    mp3Btn.textContent = 'Convert to MP3';
    mp3Btn.addEventListener('click', () => convertToMp3(mp3Btn));

    actions.append(saveBtn, mp3Btn);
    item.append(info, actions);
    audioOptions.appendChild(item);

    const tooBigForHandoff = !isLocalBackend
        && data.audio.filesize_bytes
        && data.audio.filesize_bytes > HOSTED_RESPONSE_CAP;

    audioHint.textContent = tooBigForHandoff
        ? 'This track is too big for the free hosting to send (its limit is about 4 MB, '
            + 'roughly four minutes of audio). Use one of the options under “Still not '
            + 'working?” — the yt-dlp command below already produces an MP3.'
        : 'MP3 conversion happens in your browser, using the audio converter. '
            + 'Nothing is uploaded anywhere.';
    mp3Btn.disabled = Boolean(tooBigForHandoff);
    audioPanel.hidden = false;
}

// ============================================
// Downloading
// ============================================

function downloadUrlFor(format, mode) {
    const ext = mode === 'audio' ? (format.ext || 'm4a') : (format.ext || 'mp4');
    const base = sanitiseFilename(currentVideoData.title || 'video');
    return {
        filename: `${base}.${ext}`,
        href: apiUrl('/api/youtube/download', {
            url: currentVideoData.originalUrl,
            quality: format.quality,
            filename: `${base}.${ext}`,
            mode,
        }),
    };
}

async function startDownload(format, button, { mode }) {
    if (!currentVideoData) return;
    lastAttempt = { kind: 'download', quality: format.quality, mode, format };
    hideHelp();

    const { filename, href } = downloadUrlFor(format, mode);
    const idleLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Starting...';

    try {
        if (isLocalBackend) {
            // Let the browser stream it straight to disk. A local download can
            // be hundreds of megabytes, which has no business passing through
            // a Blob in a tab's memory.
            triggerAnchorDownload(href, filename);
            return;
        }

        // Hosted: buffer instead, because the response cap keeps it small and
        // because a plain navigation would drop the user on a page of raw JSON
        // if the server refused.
        button.textContent = 'Downloading...';
        const blob = await fetchWithProgress(href, (pct) => {
            button.textContent = pct === null ? 'Downloading...' : `${pct}%`;
        });
        const objectUrl = URL.createObjectURL(blob);
        triggerAnchorDownload(objectUrl, filename);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
        showFailure(error.code || 'unknown', {
            detail: error.detail || String(error),
            canLowerQuality: mode === 'video',
        });
    } finally {
        button.disabled = false;
        button.textContent = idleLabel;
    }
}

function triggerAnchorDownload(href, filename) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 100);
}

/**
 * Fetch a download, reporting progress, and turn a JSON error body into an
 * exception carrying the server's error code.
 */
async function fetchWithProgress(href, onProgress) {
    let response;
    try {
        response = await fetch(href);
    } catch (err) {
        throw Object.assign(new Error('network'), { code: 'offline', detail: String(err) });
    }

    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw Object.assign(new Error('server refused'), {
            code: (data && data.error_code) || 'unknown',
            detail: data && data.detail,
        });
    }

    const total = Number(response.headers.get('Content-Length')) || 0;

    // Older browsers, and any response without a readable stream, still work --
    // they just get an indeterminate label instead of a percentage.
    if (!response.body || !response.body.getReader) {
        onProgress(null);
        return response.blob();
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress(total ? Math.min(99, Math.round((received / total) * 100)) : null);
    }
    return new Blob(chunks);
}

// ============================================
// MP3 hand-off to the audio converter
// ============================================

/**
 * Fetch the audio track, park it in IndexedDB, and open the audio converter on
 * top of it with MP3 preselected.
 *
 * The conversion itself is ffmpeg.wasm in the user's browser. Doing it here
 * instead would mean either an ffmpeg the hosted server does not have, or a
 * second 30 MB ffmpeg core downloaded onto this page for a job the audio
 * converter already does well.
 */
async function convertToMp3(button) {
    if (!currentVideoData || !currentVideoData.audio) return;
    lastAttempt = { kind: 'download', quality: 'audio', mode: 'audio' };
    hideHelp();

    const idleLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Fetching audio...';

    try {
        const { filename, href } = downloadUrlFor(
            { quality: 'audio', ext: currentVideoData.audio.ext },
            'audio',
        );

        const blob = await fetchWithProgress(href, (pct) => {
            button.textContent = pct === null ? 'Fetching audio...' : `${pct}%`;
        });

        const file = new File([blob], filename, { type: blob.type || 'audio/mp4' });
        const id = await putHandoff(file, { format: 'mp3', from: 'youtube' });

        button.textContent = 'Opening converter...';
        window.location.href = `../audio-converter/index.html?handoff=${encodeURIComponent(id)}&format=mp3`;
    } catch (error) {
        // A storage failure is not a YouTube failure, so it gets its own line
        // rather than being folded into the generic message.
        if (error && error.code) {
            showFailure(error.code, { detail: error.detail || String(error) });
        } else {
            showError(errorMsg, 'Could not hand the audio to the converter — your browser '
                + 'may be blocking storage in private mode. Use “Save M4A” instead, then drop '
                + 'the file into the audio converter yourself.');
        }
        button.disabled = false;
        button.textContent = idleLabel;
    }
}

// ============================================
// Event listeners
// ============================================

fetchBtn.addEventListener('click', () => {
    const url = youtubeUrlInput.value.trim();
    if (!url) {
        showError(errorMsg, 'Paste a YouTube link first.');
        return;
    }
    if (!isValidYouTubeUrl(url)) {
        showError(errorMsg, 'That does not look like a YouTube link. It should start with '
            + 'youtube.com or youtu.be.');
        return;
    }
    fetchYouTubeVideo(url);
});

youtubeUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
});

retryBtn.addEventListener('click', () => {
    if (!lastAttempt) return;
    if (lastAttempt.kind === 'fetch') {
        fetchYouTubeVideo(lastAttempt.url);
        return;
    }
    hideHelp();
    const row = qualityOptions.querySelector('.btn') || audioOptions.querySelector('.btn');
    if (row) row.click();
});

lowerQualityBtn.addEventListener('click', () => {
    const lower = nextLowerQuality();
    if (!lower) return;
    hideHelp();
    const buttons = Array.from(qualityOptions.querySelectorAll('.quality-item .btn'));
    const ready = deliverableWithAudio(currentVideoData.formats, currentVideoData.server_can_merge);
    const index = ready.findIndex(f => f.quality === lower.quality);
    if (buttons[index]) buttons[index].click();
});

byId('copyInstallBtn').addEventListener('click', (e) => copyWithFeedback(e.currentTarget, 'pip install yt-dlp'));
byId('copyCmdBtn').addEventListener('click', (e) => copyWithFeedback(e.currentTarget, ytdlpCmd.textContent));
byId('copyDevBtn').addEventListener('click', (e) => copyWithFeedback(e.currentTarget, 'npm run dev'));
byId('copyApiBtn').addEventListener('click', (e) => copyWithFeedback(e.currentTarget, 'npm run dev:api'));
