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

function showError(message) {
    errorText.innerHTML = `${message} <a href="troubleshooting.html" target="_blank" style="color: var(--primary-light); text-decoration: underline;">Need help?</a>`;
    errorMsg.classList.add('active');
}

function hideError() {
    errorMsg.classList.remove('active');
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

        displayMedia(data.media);
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

function displayMedia(mediaArray) {
    currentMedia = mediaArray;
    selectedIndices.clear();
    imageGrid.innerHTML = '';

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

        let mediaElement;
        if (media.type === 'video') {
            mediaElement = document.createElement('video');
            mediaElement.src = media.url_high;
            mediaElement.controls = true;
            mediaElement.poster = media.thumbnail;
            mediaElement.style.width = '100%';
            mediaElement.style.display = 'block';
        } else {
            mediaElement = document.createElement('img');
            mediaElement.src = media.thumbnail;
            mediaElement.alt = `Instagram ${media.type} ${index + 1}`;
            mediaElement.loading = 'lazy';
        }

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

async function convertImageFormat(base64Data, format, mediaType) {
    if (mediaType === 'video') return base64Data;
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
            const quality = format === 'jpg' ? 0.95 : undefined;
            canvas.toBlob((blob) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }, mimeType, quality);
        };
        img.onerror = reject;
        img.src = base64Data;
    });
}

async function downloadFile(urlOrBase64, filename, format, mediaType) {
    try {
        let downloadData;
        if (mediaType === 'video') {
            // Use our backend proxy to avoid CORS issues with Instagram CDN URLs
            const proxyUrl = `${API_CONFIG.BACKEND_URL}/api/instagram/proxy?url=${encodeURIComponent(urlOrBase64)}`;
            try {
                const response = await fetch(proxyUrl);
                if (response.ok) {
                    const blob = await response.blob();
                    downloadData = URL.createObjectURL(blob);
                } else {
                    // Fallback: try direct fetch
                    const directResp = await fetch(urlOrBase64);
                    const blob = await directResp.blob();
                    downloadData = URL.createObjectURL(blob);
                }
            } catch {
                // Last resort: open URL directly (won't trigger save-as but user can right-click save)
                downloadData = urlOrBase64;
            }
        } else {
            if (format !== 'jpg' && format !== 'original' && !urlOrBase64.includes('image/jpeg')) {
                downloadData = await convertImageFormat(urlOrBase64, format, mediaType);
            } else {
                downloadData = urlOrBase64;
            }
        }

        const a = document.createElement('a');
        a.href = downloadData;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            if (mediaType === 'video' && downloadData.startsWith('blob:')) URL.revokeObjectURL(downloadData);
        }, 100);
        return true;
    } catch {
        return false;
    }
}

async function downloadAll() {
    if (currentMedia.length === 0) { showError('No media to download'); return; }
    if (selectedIndices.size === 0) { showError('Please select images to download by clicking on them'); return; }

    const indicesToDownload = Array.from(selectedIndices).sort((a, b) => a - b);
    const imageFormat = formatSelect.value;
    const videoFormat = videoFormatSelect.value;
    let successCount = 0;

    for (let i = 0; i < indicesToDownload.length; i++) {
        const index = indicesToDownload[i];
        const media = currentMedia[index];
        const isVideo = media.type === 'video';
        const ext = isVideo ? videoFormat : imageFormat;
        const filename = `instagram_${index + 1}.${ext}`;
        const downloadUrl = isVideo ? media.url_high : media.thumbnail;
        const success = await downloadFile(downloadUrl, filename, ext, media.type);
        if (success) successCount++;
        if (i < indicesToDownload.length - 1) await new Promise(r => setTimeout(r, 300));
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

console.log('Instagram Downloader initialized');
