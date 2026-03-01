// ============================================
// Image Editor / Converter — Full-featured client-side image editor
// Uses Canvas API — no server needed
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
    const removeImageBtn = document.getElementById('removeImageBtn');
    const canvasWrapper = document.getElementById('canvasWrapper');
    const previewCanvas = document.getElementById('previewCanvas');
    const previewCtx = previewCanvas.getContext('2d');

    // Crop elements
    const cropOverlay = document.getElementById('cropOverlay');
    const cropSelection = document.getElementById('cropSelection');
    const cropSizeLabel = document.getElementById('cropSizeLabel');
    const cropConfirmBar = document.getElementById('cropConfirmBar');
    const cropInfo = document.getElementById('cropInfo');
    const cropBtn = document.getElementById('cropBtn');
    const applyCropBtn = document.getElementById('applyCropBtn');
    const cancelCropBtn = document.getElementById('cancelCropBtn');

    // Toolbar
    const rotateLeftBtn = document.getElementById('rotateLeftBtn');
    const rotateRightBtn = document.getElementById('rotateRightBtn');
    const flipHBtn = document.getElementById('flipHBtn');
    const flipVBtn = document.getElementById('flipVBtn');
    const resetBtn = document.getElementById('resetBtn');

    // Adjustments
    const brightnessSlider = document.getElementById('brightnessSlider');
    const contrastSlider = document.getElementById('contrastSlider');
    const saturationSlider = document.getElementById('saturationSlider');
    const blurSlider = document.getElementById('blurSlider');
    const brightnessValue = document.getElementById('brightnessValue');
    const contrastValue = document.getElementById('contrastValue');
    const saturationValue = document.getElementById('saturationValue');
    const blurValue = document.getElementById('blurValue');

    // Resize
    const resizeWidth = document.getElementById('resizeWidth');
    const resizeHeight = document.getElementById('resizeHeight');
    const applyResizeBtn = document.getElementById('applyResizeBtn');

    // Export
    const outputFormat = document.getElementById('outputFormat');
    const qualityGroup = document.getElementById('qualityGroup');
    const qualitySlider = document.getElementById('qualitySlider');
    const qualityValue = document.getElementById('qualityValue');
    const compressionSelect = document.getElementById('compressionSelect');
    const targetSizeInput = document.getElementById('targetSizeInput');
    const targetSizeUnit = document.getElementById('targetSizeUnit');
    const exportBtn = document.getElementById('exportBtn');
    const exportEstimate = document.getElementById('exportEstimate');

    // Results
    const results = document.getElementById('results');
    const resultsInfo = document.getElementById('resultsInfo');
    const outputPreview = document.getElementById('outputPreview');
    const outputName = document.getElementById('outputName');
    const outputSize = document.getElementById('outputSize');
    const outputSavings = document.getElementById('outputSavings');
    const downloadBtn = document.getElementById('downloadBtn');

    // --- State ---
    let originalImage = null;         // original Image element
    let originalFileName = '';
    let originalFileSize = 0;
    let editCanvas = null;             // off-screen canvas holding current edit state
    let editCtx = null;
    let isCropping = false;
    let cropRect = { x: 0, y: 0, w: 0, h: 0 };
    let cropDrag = null;
    let outputUrl = null;

    // --- Helpers ---
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function stripExtension(name) {
        return name.replace(/\.[^.]+$/, '');
    }

    const FORMAT_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

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
        if (f && f.type.startsWith('image/')) loadFile(f);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) { loadFile(fileInput.files[0]); fileInput.value = ''; }
    });

    // --- Load Image ---
    function loadFile(file) {
        originalFileName = file.name;
        originalFileSize = file.size;

        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            originalImage = img;

            // Initialize edit canvas
            editCanvas = document.createElement('canvas');
            editCanvas.width = img.naturalWidth;
            editCanvas.height = img.naturalHeight;
            editCtx = editCanvas.getContext('2d');
            editCtx.drawImage(img, 0, 0);

            // Update UI
            editorFilename.textContent = escapeHtml(file.name);
            editorMeta.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${formatSize(file.size)}`;
            resizeWidth.placeholder = img.naturalWidth;
            resizeHeight.placeholder = img.naturalHeight;

            dropzone.style.display = 'none';
            editorWorkspace.style.display = '';
            results.style.display = 'none';

            resetAdjustments();
            renderPreview();
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            alert('Could not load this image.');
        };
        img.src = url;
    }

    // --- Remove Image ---
    removeImageBtn.addEventListener('click', () => {
        originalImage = null;
        editCanvas = null;
        editCtx = null;
        cancelCrop();
        dropzone.style.display = '';
        editorWorkspace.style.display = 'none';
        results.style.display = 'none';
        if (outputUrl) { URL.revokeObjectURL(outputUrl); outputUrl = null; }
    });

    // --- Preview Rendering (with CSS filters for live preview) ---
    function renderPreview() {
        if (!editCanvas) return;

        const maxW = canvasWrapper.clientWidth || 800;
        const maxH = 500;
        const scale = Math.min(1, maxW / editCanvas.width, maxH / editCanvas.height);

        previewCanvas.width = Math.round(editCanvas.width * scale);
        previewCanvas.height = Math.round(editCanvas.height * scale);

        // Apply CSS filter string for live preview
        const filterStr = buildFilterString();
        previewCtx.filter = filterStr;
        previewCtx.drawImage(editCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
        previewCtx.filter = 'none';
    }

    function buildFilterString() {
        const b = parseInt(brightnessSlider.value);
        const c = parseInt(contrastSlider.value);
        const s = parseInt(saturationSlider.value);
        const bl = parseInt(blurSlider.value);

        let filter = '';
        if (b !== 0) filter += `brightness(${1 + b / 100}) `;
        if (c !== 0) filter += `contrast(${1 + c / 100}) `;
        if (s !== 0) filter += `saturate(${1 + s / 100}) `;
        if (bl > 0) filter += `blur(${bl}px) `;

        return filter.trim() || 'none';
    }

    // --- Adjustment Sliders ---
    function setupSlider(slider, display) {
        slider.addEventListener('input', () => {
            display.textContent = slider.value;
            renderPreview();
        });
    }

    setupSlider(brightnessSlider, brightnessValue);
    setupSlider(contrastSlider, contrastValue);
    setupSlider(saturationSlider, saturationValue);
    setupSlider(blurSlider, blurValue);

    function resetAdjustments() {
        brightnessSlider.value = 0; brightnessValue.textContent = '0';
        contrastSlider.value = 0; contrastValue.textContent = '0';
        saturationSlider.value = 0; saturationValue.textContent = '0';
        blurSlider.value = 0; blurValue.textContent = '0';
    }

    // --- Apply filters permanently to editCanvas (called before export/crop/resize) ---
    function bakeFilters() {
        const filterStr = buildFilterString();
        if (filterStr === 'none') return; // nothing to bake

        const temp = document.createElement('canvas');
        temp.width = editCanvas.width;
        temp.height = editCanvas.height;
        const tctx = temp.getContext('2d');
        tctx.filter = filterStr;
        tctx.drawImage(editCanvas, 0, 0);

        editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
        editCtx.drawImage(temp, 0, 0);

        resetAdjustments();
    }

    // --- Rotate & Flip ---
    rotateLeftBtn.addEventListener('click', () => rotate(-90));
    rotateRightBtn.addEventListener('click', () => rotate(90));
    flipHBtn.addEventListener('click', () => flip('h'));
    flipVBtn.addEventListener('click', () => flip('v'));

    function rotate(deg) {
        bakeFilters();
        const temp = document.createElement('canvas');
        const isRightAngle = Math.abs(deg) === 90;
        temp.width = isRightAngle ? editCanvas.height : editCanvas.width;
        temp.height = isRightAngle ? editCanvas.width : editCanvas.height;
        const tctx = temp.getContext('2d');

        tctx.translate(temp.width / 2, temp.height / 2);
        tctx.rotate((deg * Math.PI) / 180);
        tctx.drawImage(editCanvas, -editCanvas.width / 2, -editCanvas.height / 2);

        editCanvas.width = temp.width;
        editCanvas.height = temp.height;
        editCtx.drawImage(temp, 0, 0);

        updateMetaDisplay();
        renderPreview();
    }

    function flip(dir) {
        bakeFilters();
        const temp = document.createElement('canvas');
        temp.width = editCanvas.width;
        temp.height = editCanvas.height;
        const tctx = temp.getContext('2d');

        if (dir === 'h') {
            tctx.translate(temp.width, 0);
            tctx.scale(-1, 1);
        } else {
            tctx.translate(0, temp.height);
            tctx.scale(1, -1);
        }
        tctx.drawImage(editCanvas, 0, 0);

        editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
        editCtx.drawImage(temp, 0, 0);
        renderPreview();
    }

    function updateMetaDisplay() {
        editorMeta.textContent = `${editCanvas.width} × ${editCanvas.height} · ${formatSize(originalFileSize)}`;
    }

    // --- Reset ---
    resetBtn.addEventListener('click', () => {
        if (!originalImage) return;
        cancelCrop();

        editCanvas.width = originalImage.naturalWidth;
        editCanvas.height = originalImage.naturalHeight;
        editCtx.drawImage(originalImage, 0, 0);

        resetAdjustments();
        updateMetaDisplay();
        renderPreview();
    });

    // ==============================================
    // CROP FUNCTIONALITY
    // ==============================================
    let cropStartPos = null;

    cropBtn.addEventListener('click', () => {
        if (isCropping) { cancelCrop(); return; }
        enterCropMode();
    });

    function enterCropMode() {
        isCropping = true;
        cropBtn.classList.add('active');
        cropOverlay.style.display = '';
        cropConfirmBar.style.display = '';

        // Default crop: center 80%
        const defaultW = Math.round(previewCanvas.width * 0.8);
        const defaultH = Math.round(previewCanvas.height * 0.8);
        const defaultX = Math.round((previewCanvas.width - defaultW) / 2);
        const defaultY = Math.round((previewCanvas.height - defaultH) / 2);

        cropRect = { x: defaultX, y: defaultY, w: defaultW, h: defaultH };
        updateCropUI();
    }

    function cancelCrop() {
        isCropping = false;
        cropBtn.classList.remove('active');
        cropOverlay.style.display = 'none';
        cropConfirmBar.style.display = 'none';
        cropDrag = null;
    }

    cancelCropBtn.addEventListener('click', cancelCrop);

    applyCropBtn.addEventListener('click', () => {
        if (!isCropping) return;

        bakeFilters();

        // Convert crop rect from preview coords to actual image coords
        const scaleX = editCanvas.width / previewCanvas.width;
        const scaleY = editCanvas.height / previewCanvas.height;

        const sx = Math.round(cropRect.x * scaleX);
        const sy = Math.round(cropRect.y * scaleY);
        const sw = Math.round(cropRect.w * scaleX);
        const sh = Math.round(cropRect.h * scaleY);

        if (sw < 1 || sh < 1) { cancelCrop(); return; }

        const imageData = editCtx.getImageData(sx, sy, sw, sh);
        editCanvas.width = sw;
        editCanvas.height = sh;
        editCtx.putImageData(imageData, 0, 0);

        cancelCrop();
        updateMetaDisplay();
        renderPreview();
    });

    function updateCropUI() {
        // Clamp crop rect
        cropRect.x = Math.max(0, Math.min(cropRect.x, previewCanvas.width - 10));
        cropRect.y = Math.max(0, Math.min(cropRect.y, previewCanvas.height - 10));
        cropRect.w = Math.max(10, Math.min(cropRect.w, previewCanvas.width - cropRect.x));
        cropRect.h = Math.max(10, Math.min(cropRect.h, previewCanvas.height - cropRect.y));

        cropSelection.style.left = cropRect.x + 'px';
        cropSelection.style.top = cropRect.y + 'px';
        cropSelection.style.width = cropRect.w + 'px';
        cropSelection.style.height = cropRect.h + 'px';

        // Show actual pixel dimensions
        const scaleX = editCanvas.width / previewCanvas.width;
        const scaleY = editCanvas.height / previewCanvas.height;
        const realW = Math.round(cropRect.w * scaleX);
        const realH = Math.round(cropRect.h * scaleY);
        cropSizeLabel.textContent = `${realW} × ${realH}`;
        cropInfo.textContent = `Crop area: ${realW} × ${realH} px`;
    }

    // Crop drag handlers
    cropOverlay.addEventListener('mousedown', onCropMouseDown);
    cropOverlay.addEventListener('touchstart', onCropTouchStart, { passive: false });

    function onCropMouseDown(e) {
        e.preventDefault();
        const handle = e.target.dataset?.handle;
        const rect = cropOverlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (handle) {
            cropDrag = { type: 'resize', handle, startX: x, startY: y, origRect: { ...cropRect } };
        } else if (isInsideCrop(x, y)) {
            cropDrag = { type: 'move', startX: x, startY: y, origRect: { ...cropRect } };
        } else {
            // Start new crop from click position
            cropRect = { x, y, w: 0, h: 0 };
            cropDrag = { type: 'new', startX: x, startY: y };
        }

        document.addEventListener('mousemove', onCropMouseMove);
        document.addEventListener('mouseup', onCropMouseUp);
    }

    function onCropTouchStart(e) {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        const touch = e.touches[0];
        const rect = cropOverlay.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        const handle = e.target.dataset?.handle;
        if (handle) {
            cropDrag = { type: 'resize', handle, startX: x, startY: y, origRect: { ...cropRect } };
        } else if (isInsideCrop(x, y)) {
            cropDrag = { type: 'move', startX: x, startY: y, origRect: { ...cropRect } };
        } else {
            cropRect = { x, y, w: 0, h: 0 };
            cropDrag = { type: 'new', startX: x, startY: y };
        }

        document.addEventListener('touchmove', onCropTouchMove, { passive: false });
        document.addEventListener('touchend', onCropTouchEnd);
    }

    function onCropMouseMove(e) {
        const rect = cropOverlay.getBoundingClientRect();
        handleCropMove(e.clientX - rect.left, e.clientY - rect.top);
    }

    function onCropTouchMove(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = cropOverlay.getBoundingClientRect();
        handleCropMove(touch.clientX - rect.left, touch.clientY - rect.top);
    }

    function handleCropMove(x, y) {
        if (!cropDrag) return;

        const dx = x - cropDrag.startX;
        const dy = y - cropDrag.startY;
        const maxW = previewCanvas.width;
        const maxH = previewCanvas.height;

        if (cropDrag.type === 'move') {
            let newX = cropDrag.origRect.x + dx;
            let newY = cropDrag.origRect.y + dy;
            newX = Math.max(0, Math.min(newX, maxW - cropRect.w));
            newY = Math.max(0, Math.min(newY, maxH - cropRect.h));
            cropRect.x = newX;
            cropRect.y = newY;
        } else if (cropDrag.type === 'new') {
            const sx = cropDrag.startX;
            const sy = cropDrag.startY;
            cropRect.x = Math.min(sx, x);
            cropRect.y = Math.min(sy, y);
            cropRect.w = Math.abs(x - sx);
            cropRect.h = Math.abs(y - sy);
        } else if (cropDrag.type === 'resize') {
            const o = cropDrag.origRect;
            const h = cropDrag.handle;

            if (h.includes('e')) cropRect.w = Math.max(10, o.w + dx);
            if (h.includes('s')) cropRect.h = Math.max(10, o.h + dy);
            if (h.includes('w')) {
                cropRect.x = o.x + dx;
                cropRect.w = o.w - dx;
                if (cropRect.w < 10) { cropRect.x = o.x + o.w - 10; cropRect.w = 10; }
            }
            if (h.includes('n')) {
                cropRect.y = o.y + dy;
                cropRect.h = o.h - dy;
                if (cropRect.h < 10) { cropRect.y = o.y + o.h - 10; cropRect.h = 10; }
            }
        }

        updateCropUI();
    }

    function onCropMouseUp() {
        cropDrag = null;
        document.removeEventListener('mousemove', onCropMouseMove);
        document.removeEventListener('mouseup', onCropMouseUp);
    }

    function onCropTouchEnd() {
        cropDrag = null;
        document.removeEventListener('touchmove', onCropTouchMove);
        document.removeEventListener('touchend', onCropTouchEnd);
    }

    function isInsideCrop(x, y) {
        return x >= cropRect.x && x <= cropRect.x + cropRect.w &&
               y >= cropRect.y && y <= cropRect.y + cropRect.h;
    }

    // ==============================================
    // RESIZE
    // ==============================================
    applyResizeBtn.addEventListener('click', () => {
        const w = parseInt(resizeWidth.value);
        const h = parseInt(resizeHeight.value);
        if (!w && !h) return;

        bakeFilters();

        let targetW = w || Math.round((h / editCanvas.height) * editCanvas.width);
        let targetH = h || Math.round((w / editCanvas.width) * editCanvas.height);

        if (targetW < 1 || targetH < 1) return;

        const temp = document.createElement('canvas');
        temp.width = targetW;
        temp.height = targetH;
        const tctx = temp.getContext('2d');
        tctx.drawImage(editCanvas, 0, 0, targetW, targetH);

        editCanvas.width = targetW;
        editCanvas.height = targetH;
        editCtx.drawImage(temp, 0, 0);

        resizeWidth.value = '';
        resizeHeight.value = '';
        updateMetaDisplay();
        renderPreview();
    });

    // Resize presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.percent) {
                const pct = parseInt(btn.dataset.percent) / 100;
                resizeWidth.value = Math.round(editCanvas.width * pct);
                resizeHeight.value = Math.round(editCanvas.height * pct);
            } else {
                resizeWidth.value = btn.dataset.w;
                resizeHeight.value = btn.dataset.h;
            }
        });
    });

    // ==============================================
    // EXPORT
    // ==============================================
    const COMPRESSION_QUALITY = { none: 1.0, light: 0.8, medium: 0.6, heavy: 0.4, extreme: 0.2 };

    outputFormat.addEventListener('change', updateExportUI);
    compressionSelect.addEventListener('change', onCompressionChange);
    qualitySlider.addEventListener('input', () => {
        qualityValue.textContent = qualitySlider.value;
    });

    function updateExportUI() {
        const fmt = outputFormat.value;
        const isPng = fmt === 'image/png';
        qualityGroup.style.display = isPng ? 'none' : '';
        compressionSelect.closest('.setting-group').style.display = isPng ? 'none' : '';
        targetSizeInput.closest('.setting-group').style.display = isPng ? 'none' : '';
    }

    function onCompressionChange() {
        const val = compressionSelect.value;
        if (val !== 'none') {
            const q = Math.round(COMPRESSION_QUALITY[val] * 100);
            qualitySlider.value = q;
            qualityValue.textContent = q;
        }
    }

    // Initialize UI state
    updateExportUI();
    onCompressionChange();

    exportBtn.addEventListener('click', async () => {
        if (!editCanvas) return;

        exportBtn.disabled = true;
        exportBtn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0;"></div> Exporting...';
        exportEstimate.textContent = '';

        // Bake adjustments into a final export canvas
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = editCanvas.width;
        exportCanvas.height = editCanvas.height;
        const ectx = exportCanvas.getContext('2d');
        const filterStr = buildFilterString();
        ectx.filter = filterStr;
        ectx.drawImage(editCanvas, 0, 0);
        ectx.filter = 'none';

        const format = outputFormat.value;
        const targetBytes = getTargetBytes();

        let blob;
        try {
            if (targetBytes) {
                blob = await compressToTargetSize(exportCanvas, format, targetBytes);
            } else {
                const quality = format === 'image/png' ? undefined : qualitySlider.value / 100;
                blob = await canvasToBlob(exportCanvas, format, quality);
            }
        } catch (err) {
            exportEstimate.textContent = 'Export failed: ' + err.message;
            exportBtn.disabled = false;
            restoreExportBtn();
            return;
        }

        // Display result
        if (outputUrl) URL.revokeObjectURL(outputUrl);
        outputUrl = URL.createObjectURL(blob);

        const ext = FORMAT_EXT[format] || 'png';
        const outFileName = stripExtension(originalFileName) + '.' + ext;

        outputPreview.src = outputUrl;
        outputName.textContent = escapeHtml(outFileName);
        outputSize.textContent = formatSize(blob.size);

        const savingsNum = originalFileSize > 0 ? ((originalFileSize - blob.size) / originalFileSize) * 100 : 0;
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

        downloadBtn.href = outputUrl;
        downloadBtn.download = outFileName;

        resultsInfo.textContent = `${editCanvas.width} × ${editCanvas.height} · ${formatSize(blob.size)}`;
        results.style.display = '';

        exportBtn.disabled = false;
        restoreExportBtn();
    });

    function restoreExportBtn() {
        exportBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export &amp; Download';
    }

    function getTargetBytes() {
        const val = parseInt(targetSizeInput.value);
        if (!val || val <= 0) return null;
        const unit = targetSizeUnit.value;
        return unit === 'mb' ? val * 1024 * 1024 : val * 1024;
    }

    function canvasToBlob(canvas, format, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error('Export failed')),
                format,
                quality
            );
        });
    }

    async function compressToTargetSize(canvas, format, targetBytes) {
        let lo = 0.01, hi = 1.0;
        let bestBlob = null;
        const maxIter = 10;

        // Binary search for the right quality
        for (let i = 0; i < maxIter; i++) {
            const mid = (lo + hi) / 2;
            const blob = await canvasToBlob(canvas, format, mid);

            if (blob.size <= targetBytes) {
                bestBlob = blob;
                lo = mid;
            } else {
                hi = mid;
            }

            // Close enough (within 5% of target)
            if (bestBlob && Math.abs(bestBlob.size - targetBytes) / targetBytes < 0.05) break;
        }

        if (!bestBlob) {
            // Even lowest quality is too big — return the smallest we got
            bestBlob = await canvasToBlob(canvas, format, 0.01);
            exportEstimate.textContent = `⚠ Could not reach target (min: ${formatSize(bestBlob.size)})`;
        } else {
            exportEstimate.textContent = `✓ Compressed to ${formatSize(bestBlob.size)} (target: ${formatSize(targetBytes)})`;
        }

        return bestBlob;
    }

    // --- Window resize handler ---
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (editCanvas) renderPreview(); }, 150);
    });

    // Initialize — hide quality/compression for PNG (default)
    qualityGroup.style.display = 'none';

    console.log('Image Editor / Converter initialized');
})();
