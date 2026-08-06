// ============================================
// Instagram Downloader
// ============================================
const fetchBtn = document.getElementById('fetchBtn');
const instagramUrlInput = document.getElementById('instagramUrl');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const imageGrid = document.getElementById('imageGrid');
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');
const downloadBtn = document.getElementById('downloadBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const resultsCount = document.getElementById('resultsCount');
const formatSelect = document.getElementById('formatSelect');
const videoFormatSelect = document.getElementById('videoFormatSelect');
const imageFormatGroup = document.getElementById('imageFormatGroup');
const videoFormatGroup = document.getElementById('videoFormatGroup');

let currentMedia = [];
let selectedIndices = new Set();

function isValidInstagramUrl(url) {
    return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?/.test(url);
}

// ── Media URL selection ───────────────────────────────────────────
// Previews and downloads need different URLs. An <img>/<video> src needs no
// CORS, so previews can point straight at the Instagram CDN. A fetch() -> Blob
// download does need CORS, so it must go through our proxy.

function proxyUrl(url, filename) {
    const params = new URLSearchParams({ url });
    if (filename) params.set('filename', filename);
    return `${API_CONFIG.BACKEND_URL}/api/instagram/proxy?${params}`;
}

// The full-resolution source. Never the base64 thumbnail: that is a downscaled
// preview, and downloading it was the cause of blurry saved files.
function pickDownloadUrl(media, filename) {
    const src = media.url_high || media.url_low;
    if (!src) return media.thumbnail || null;
    // Already-inlined data: URLs cannot be proxied; use them verbatim.
    if (src.startsWith('data:')) return src;
    return proxyUrl(src, filename);
}

// Prefer the direct CDN URL so previews cost us no proxy bandwidth. Callers
// fall back to the proxy via onerror if Instagram blocks the hotlink.
function pickPreviewUrl(media) {
    return media.url_high || media.url_low || media.thumbnail || null;
}

function showError(message) {
    errorText.innerHTML = `${message} <a href="troubleshooting.html" target="_blank" style="color: var(--primary-light); text-decoration: underline;">Need help?</a>`;
    errorMsg.classList.add('active');
}

function hideError() {
    errorMsg.classList.remove('active');
}

// Instagram sometimes only serves a size-capped preview from a cloud IP. Say so
// rather than letting a downscale look like the original file.
function showQualityNotice(degraded) {
    const notice = document.getElementById('qualityNotice');
    if (!notice) return;
    notice.hidden = !degraded;
}

async function fetchInstagramMedia(url) {
    loading.classList.add('active');
    results.classList.remove('active');
    hideError();
    fetchBtn.disabled = true;

    try {
        const response = await fetch(`${API_CONFIG.BACKEND_URL}/api/instagram?url=${encodeURIComponent(url)}`);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch Instagram media');
        }

        const data = await response.json();
        if (!data.success || !data.media || data.media.length === 0) {
            throw new Error('No media found in this post');
        }

        displayMedia(data.media, data);
    } catch (error) {
        if (error instanceof TypeError) {
            showError('Cannot connect to backend server. Please wait a moment and try again. The server may be starting up (cold start takes ~10s). <a href="troubleshooting.html" target="_blank" style="color: var(--primary-light); text-decoration: underline;">Need help?</a>');
        } else if (error.message.includes('rate') || error.message.includes('wait') || error.message.includes('429') || error.message.includes('401')) {
            showError('Instagram is temporarily blocking requests from our server. Please try again in a few minutes. <a href="troubleshooting.html" target="_blank" style="color: var(--primary-light); text-decoration: underline;">Need help?</a>');
        } else {
            showError(error.message || 'Failed to fetch Instagram media. Please try again in a few minutes.');
        }
        loading.classList.remove('active');
        fetchBtn.disabled = false;
    }
}

function displayMedia(mediaArray, meta = {}) {
    currentMedia = mediaArray;
    selectedIndices.clear();
    imageGrid.innerHTML = '';
    showQualityNotice(meta.degraded || mediaArray.some(m => m.degraded));

    mediaArray.forEach((media, index) => {
        const item = document.createElement('div');
        item.className = 'media-item';
        item.dataset.index = index;
        item.dataset.type = media.type;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'media-checkbox';
        checkbox.dataset.index = index;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedIndices.add(index);
                item.classList.add('selected');
            } else {
                selectedIndices.delete(index);
                item.classList.remove('selected');
            }
            updateDownloadButtons();
        });

        const previewSrc = pickPreviewUrl(media);

        let mediaElement;
        if (media.type === 'video') {
            mediaElement = document.createElement('video');
            mediaElement.src = previewSrc;
            mediaElement.controls = true;
            mediaElement.poster = media.thumbnail || '';
            mediaElement.style.width = '100%';
            mediaElement.style.display = 'block';
        } else {
            mediaElement = document.createElement('img');
            mediaElement.src = previewSrc;
            mediaElement.alt = `Instagram ${media.type} ${index + 1}`;
            mediaElement.loading = 'lazy';
        }

        // If Instagram blocks the hotlink, retry through the proxy, then fall
        // back to whatever thumbnail the server gave us.
        let previewFallback = 0;
        mediaElement.addEventListener('error', () => {
            if (previewFallback === 0 && previewSrc && !previewSrc.startsWith('data:')) {
                previewFallback = 1;
                mediaElement.src = proxyUrl(previewSrc);
            } else if (previewFallback <= 1 && media.thumbnail && media.thumbnail !== previewSrc) {
                previewFallback = 2;
                mediaElement.src = media.thumbnail;
            }
        });

        mediaElement.addEventListener('click', (e) => {
            if (media.type === 'video' && e.target.tagName === 'VIDEO') return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });

        const badge = document.createElement('div');
        badge.className = 'media-badge';
        const typeIcon = media.type === 'video' ? '🎥 ' : '';
        badge.textContent = `${typeIcon}${index + 1}/${mediaArray.length}`;

        item.appendChild(checkbox);
        item.appendChild(mediaElement);
        item.appendChild(badge);
        imageGrid.appendChild(item);
    });

    loading.classList.remove('active');
    results.classList.add('active');
    fetchBtn.disabled = false;
    updateDownloadButtons();

    if (resultsCount) {
        const imageCount = mediaArray.filter(m => m.type !== 'video').length;
        const videoCount = mediaArray.filter(m => m.type === 'video').length;
        let countText = '';
        if (imageCount > 0 && videoCount > 0) {
            countText = `${mediaArray.length} items (${imageCount} image${imageCount > 1 ? 's' : ''}, ${videoCount} video${videoCount > 1 ? 's' : ''})`;
        } else if (imageCount > 0) {
            countText = `${imageCount} image${imageCount > 1 ? 's' : ''} found`;
        } else {
            countText = `${videoCount} video${videoCount > 1 ? 's' : ''} found`;
        }
        resultsCount.textContent = countText;
    }
}

function updateDownloadButtons() {
    if (!downloadBtn) return;
    const count = selectedIndices.size;
    downloadBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        Download Selected (${count})
    `;

    if (selectAllBtn && currentMedia.length > 0) {
        selectAllBtn.textContent = selectedIndices.size === currentMedia.length ? 'Deselect All' : 'Select All';
    }
    updateFormatDropdown();
}

function updateFormatDropdown() {
    if (selectedIndices.size === 0) {
        imageFormatGroup.style.display = 'flex';
        videoFormatGroup.style.display = 'none';
        return;
    }
    let hasImages = false, hasVideos = false;
    selectedIndices.forEach(index => {
        if (currentMedia[index].type === 'video') hasVideos = true;
        else hasImages = true;
    });
    imageFormatGroup.style.display = (hasImages || (!hasImages && !hasVideos)) ? 'flex' : 'none';
    videoFormatGroup.style.display = hasVideos ? 'flex' : 'none';
}

const IMAGE_MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' };

function extensionForBlob(blob, mediaType) {
    const type = (blob.type || '').toLowerCase();
    if (type.includes('png')) return 'png';
    if (type.includes('webp')) return 'webp';
    if (type.includes('gif')) return 'gif';
    if (type.includes('mp4')) return 'mp4';
    if (type.includes('webm')) return 'webm';
    if (type.includes('quicktime')) return 'mov';
    if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
    return mediaType === 'video' ? 'mp4' : 'jpg';
}

// Re-encode an image to another format. Lossy targets get an explicit quality:
// leaving it undefined makes Chrome default to 0.80, stacking a second
// generation of compression artifacts on top of Instagram's own.
async function reencodeImage(blob, format) {
    const mimeType = IMAGE_MIME[format];
    if (!mimeType) return blob;

    const objectUrl = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Could not decode image'));
            image.src = objectUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (mimeType === 'image/jpeg') {
            // JPEG has no alpha channel; without a matte, transparency
            // composites to black.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);

        const quality = mimeType === 'image/png' ? undefined : 0.92;
        const encoded = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
        // A browser that cannot encode the requested format silently hands back
        // a PNG. Keep the original rather than mislabel it.
        if (!encoded || encoded.type !== mimeType) return blob;
        return encoded;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function saveBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
    }, 100);
}

async function fetchBlob(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.blob();
}

async function downloadFile(media, basename, format) {
    const proxied = pickDownloadUrl(media, basename);
    if (!proxied) return false;
    const direct = media.url_high || media.url_low;

    let blob = null;
    try {
        blob = await fetchBlob(proxied);
    } catch {
        // The proxy may be cold, rate-limited, or down. Instagram's CDN
        // sometimes allows a direct cross-origin fetch; it costs one try.
        if (direct && direct !== proxied) {
            try { blob = await fetchBlob(direct); } catch { /* fall through */ }
        }
    }

    if (!blob) {
        // Last resort: hand the URL to the browser. Cross-origin responses
        // ignore the download attribute, so this may open a tab instead of
        // saving, but it beats failing silently.
        const a = document.createElement('a');
        a.href = proxied;
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 100);
        return false;
    }

    if (media.type !== 'video' && IMAGE_MIME[format] && blob.type !== IMAGE_MIME[format]) {
        try { blob = await reencodeImage(blob, format); } catch { /* keep original */ }
    }

    saveBlob(blob, `${basename}.${extensionForBlob(blob, media.type)}`);
    return true;
}

async function downloadAll() {
    if (currentMedia.length === 0) { showError('No media to download'); return; }
    if (selectedIndices.size === 0) { showError('Please select images to download by clicking on them'); return; }

    const indicesToDownload = Array.from(selectedIndices).sort((a, b) => a - b);
    const imageFormat = formatSelect.value;
    const videoFormat = videoFormatSelect.value;

    hideError();
    downloadBtn.disabled = true;
    let successCount = 0;

    try {
        for (let i = 0; i < indicesToDownload.length; i++) {
            const index = indicesToDownload[i];
            const media = currentMedia[index];
            const format = media.type === 'video' ? videoFormat : imageFormat;
            if (await downloadFile(media, `instagram_${index + 1}`, format)) successCount++;
            if (i < indicesToDownload.length - 1) await new Promise(r => setTimeout(r, 300));
        }
    } finally {
        downloadBtn.disabled = false;
        updateDownloadButtons();
    }

    if (successCount < indicesToDownload.length) {
        const failed = indicesToDownload.length - successCount;
        showError(`${failed} of ${indicesToDownload.length} download${failed > 1 ? 's' : ''} could not be saved automatically. Instagram may be rate-limiting our server &mdash; try again in a minute.`);
    }
}

// Event listeners
fetchBtn.addEventListener('click', () => {
    const url = instagramUrlInput.value.trim();
    if (!url) { showError('Please enter an Instagram URL'); return; }
    if (!isValidInstagramUrl(url)) { showError('Please enter a valid Instagram post URL (e.g., https://www.instagram.com/p/...)'); return; }
    fetchInstagramMedia(url);
});

instagramUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
});

downloadBtn.addEventListener('click', () => downloadAll());

selectAllBtn.addEventListener('click', () => {
    if (currentMedia.length === 0) return;
    const allSelected = selectedIndices.size === currentMedia.length;

    if (allSelected) {
        selectedIndices.clear();
        document.querySelectorAll('.media-item').forEach(item => {
            item.classList.remove('selected');
            const cb = item.querySelector('.media-checkbox');
            if (cb) cb.checked = false;
        });
    } else {
        selectedIndices.clear();
        document.querySelectorAll('.media-item').forEach((item, index) => {
            selectedIndices.add(index);
            item.classList.add('selected');
            const cb = item.querySelector('.media-checkbox');
            if (cb) cb.checked = true;
        });
    }
    updateDownloadButtons();
});
