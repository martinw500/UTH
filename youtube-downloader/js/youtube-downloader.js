// ============================================
// YouTube Downloader
// ============================================
//
// Everything the server sends is inserted as text, never as HTML. The error
// used to go through innerHTML, and it echoed the submitted URL back, so a URL
// carrying markup ran as script in the page.
//
// Only usable against a backend on this machine. YouTube bot-checks every
// cloud IP, so the hosted page shows why instead (see STATE.md).

import { API_CONFIG, apiUrl, errorFromResponse, resolveBackendUrl } from '../../js/shared/config.js';
import { el } from '../../js/shared/dom.js';
import { formatDuration, formatViews, sanitiseFilename } from '../../js/shared/format.js';
import { saveBlob } from '../../js/shared/download.js';

const fetchBtn = document.getElementById('fetchBtn');
const youtubeUrlInput = document.getElementById('youtubeUrl');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const videoInfo = document.getElementById('videoInfo');
const qualityOptions = document.getElementById('qualityOptions');
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
    views: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z', 'circle:12,12,3'],
    duration: ['circle:12,12,10', 'M12 6v6l4 2'],
    channel: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'circle:9,7,4'],
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
};

let currentVideo = null;

/**
 * A loose first check, so an obvious typo fails without a round trip. The
 * server decides what is really a video link; this used to be stricter than
 * the server and rejected m.youtube.com, /live/ and ?feature=share&v= links.
 */
export function looksLikeYouTubeUrl(url) {
    return /(^|\.|\/\/)(youtube\.com|youtu\.be)\//i.test(url);
}

function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const [key, value] of Object.entries({
        width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    })) svg.setAttribute(key, value);
    for (const shape of ICONS[name]) {
        const [kind, args] = shape.startsWith('circle:') ? ['circle', shape.slice(7).split(',')] : ['path', null];
        const node = document.createElementNS(SVG_NS, kind);
        if (args) ['cx', 'cy', 'r'].forEach((attr, i) => node.setAttribute(attr, args[i]));
        else node.setAttribute('d', shape);
        svg.append(node);
    }
    return svg;
}

function showError(message) {
    errorText.textContent = message;
    errorMsg.classList.add('active');
}

function hideError() {
    errorMsg.classList.remove('active');
}

function setLoading(on) {
    loading.classList.toggle('active', on);
    fetchBtn.disabled = on;
}

async function fetchYouTubeVideo(url) {
    setLoading(true);
    results.classList.remove('active');
    hideError();

    try {
        const response = await fetch(apiUrl('/api/youtube', { url }));
        if (!response.ok) throw new Error(await errorFromResponse(response, 'Could not fetch that video.'));

        const data = await response.json();
        if (!data.success) throw new Error('No video information found.');

        currentVideo = { ...data, url };
        displayVideoInfo(currentVideo);
    } catch (error) {
        showError(error instanceof TypeError
            ? 'Cannot reach the server. It may be starting up (about 10 seconds); try again.'
            : error.message);
    } finally {
        setLoading(false);
    }
}

function displayVideoInfo(data) {
    const detail = (name, text) => el('div', { class: 'video-detail' }, icon(name), ` ${text}`);

    videoInfo.replaceChildren(
        el('div', { class: 'video-thumbnail-wrap' },
            el('img', { src: data.thumbnail || '', alt: 'Video thumbnail' })),
        el('div', { class: 'video-meta' },
            el('div', { class: 'video-title' }, data.title || 'Untitled'),
            el('div', { class: 'video-details-row' },
                detail('views', data.views ? `${formatViews(data.views)} views` : 'Unknown'),
                detail('duration', data.duration ? formatDuration(data.duration) : 'Unknown'),
                detail('channel', data.channel || 'Unknown'))),
    );

    const formats = data.formats ?? [];
    qualityOptions.replaceChildren(...(formats.length
        ? formats.map((format) => {
            const button = el('button', { class: 'btn btn-primary btn-sm', type: 'button' },
                icon('download'), ' Download');
            button.addEventListener('click', () => downloadVideo(format, button));
            return el('div', { class: 'quality-item' },
                el('div', { class: 'quality-info' },
                    el('div', { class: 'quality-label' }, format.quality),
                    el('div', { class: 'quality-meta' }, `${format.ext} • ${format.filesize || 'Size unknown'}`)),
                button);
        })
        : [el('p', { style: { color: 'var(--text-muted)', textAlign: 'center', padding: '16px' } },
            'No download formats available.')]));

    results.classList.add('active');
}

/**
 * Fetched rather than handed to an <a download>. The anchor could not report
 * anything: a server error navigated away (cross-origin, the download
 * attribute is ignored) or failed silently, and the catch was dead code.
 */
async function downloadVideo(format, button) {
    button.disabled = true;
    const idle = button.textContent;
    button.textContent = 'Downloading…';
    hideError();

    try {
        const stem = sanitiseFilename(currentVideo.title, 'video');
        const response = await fetch(apiUrl('/api/youtube/download', {
            url: currentVideo.url, quality: format.quality, filename: stem,
        }));
        if (!response.ok) throw new Error(await errorFromResponse(response, 'Download failed. Try a different quality.'));
        const blob = await response.blob();
        // The server says what it actually sent; the listed format's ext can
        // name an MP4 ".webm".
        saveBlob(blob, `${stem}.${blob.type === 'video/webm' ? 'webm' : 'mp4'}`);
    } catch (error) {
        showError(error instanceof TypeError
            ? 'Cannot reach the server. It may be starting up (about 10 seconds); try again.'
            : error.message);
    } finally {
        button.disabled = false;
        button.replaceChildren(icon('download'), ` ${idle.trim()}`);
    }
}

if (API_CONFIG.BACKEND_URL === resolveBackendUrl('localhost')) {
    document.getElementById('retiredNotice').hidden = true;
    document.getElementById('localTool').hidden = false;
}

fetchBtn.addEventListener('click', () => {
    const url = youtubeUrlInput.value.trim();
    if (!url) { showError('Please enter a YouTube URL.'); return; }
    if (!looksLikeYouTubeUrl(url)) { showError('That does not look like a YouTube link.'); return; }
    fetchYouTubeVideo(url);
});

youtubeUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
});
